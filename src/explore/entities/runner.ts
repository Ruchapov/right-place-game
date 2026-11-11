import { Graphics } from 'pixi.js'
import type { MutableRefObject } from 'react'
import type { AnimatedSprite, Container, Texture } from 'pixi.js'
import type { Enemy, Grid, MapEvent, PlayerPhysics } from '../types'
import * as C from '../constants'
import { isSolid, sweepFootBlock } from '../collision'
import { lineOfSight } from '../vision'
import { destroyMark } from '../perception'
import { redrawEnemyHpBar, type BeastFrames } from './enemy'

// БЕГЛЕЦ (11.11.2026, событие 'runner', docs/explore-features.md).
//
// Обычный зверь (листы beast, спавнит его система зверя), но поведение — своё,
// и ведёт его этот модуль; entities/enemy.ts таких пропускает (enemy.runner).
// Лежит в общем enemiesRef, поэтому меч, навыки, лёд, отдача и вспышка удара
// работают по нему сами. Урон — счётчиком ударов, а не HP (RUNNER_HITS, см.
// damageEnemy в Explore.tsx): каждое попадание мечом или навыком снимает треть.
//
//   asleep  — стоит в idle на своей точке. Просыпается, когда герой ближе
//             RUNNER_WAKE_TILES и виден (чистый луч), или от удара.
//   fleeing — бежит ОТ героя со скоростью RUNNER_SPEED_MULT × MOVE_SPEED. Не
//             прыгает никогда; у края платформы падает вниз гравитацией; у стены
//             разворачивается и RUNNER_PASS_MS бежит мимо героя (сквозь него —
//             тела Беглеца нет). Не атакует, шипов не боится. Таймер
//             RUNNER_TIME_MS — HUD поверх экрана, как у обелисков.
//   gone    — не пойман: исчез в клубе дыма, через RUNNER_RESPAWN_MS снова
//             спит на своей точке со всеми ударами. Героя не убивает.
// Убит — смерть зверя, труп, мана и closeEvent с наградой над трупом.

export type RunnerDeps = {
  phys: PlayerPhysics
  getPlayerCombatBox: () => { x: number; y: number; w: number; h: number }
  grid: Grid
  worldContainer: Container
  enemies: MutableRefObject<Enemy[]>
  events: MutableRefObject<MapEvent[]>
  beastFrames: MutableRefObject<BeastFrames | null>
  /** Спавн зверя (система зверя) — Беглец его же объект Enemy. */
  spawnBeast: (tileX: number, tileY: number, eventIndex: number) => Enemy
  /** Свечение Беглеца (eliteGlow, вид 'runner'). */
  attachGlow: (enemy: Enemy) => void
  playSpriteAnim: (sprite: AnimatedSprite, frames: Texture[], speed: number, loop: boolean) => void
  findGroundSurfaceY: (x: number, width: number, footY: number) => number | null
  closeEvent: (index: number, worldX?: number, worldY?: number) => void
  dropMana: (worldX: number, worldY: number) => void
  smoke: (x: number, y: number, count: number, ms: number, spread: number) => void
  /** Таймер погони для HUD: целые секунды или null (нет погони). */
  onHud: (secondsLeft: number | null) => void
}

type Spark = { g: Graphics; vx: number; vy: number; lifeMs: number }

export function createRunnerSystem(deps: RunnerDeps) {
  const runners: Enemy[] = []
  const worldWidthPx = deps.grid[0].length * C.TILE_SIZE
  const T = C.TILE_SIZE
  const W = C.ENEMY_WIDTH
  const H = C.ENEMY_HEIGHT

  // След искр — заранее созданный пул, в тикере только числа.
  const sparks: Spark[] = []
  for (let i = 0; i < C.RUNNER_SPARK_COUNT; i++) {
    const g = new Graphics().circle(0, 0, 2.6).fill({ color: C.RUNNER_GLOW_TINT })
    g.blendMode = 'add'
    g.visible = false
    deps.worldContainer.addChild(g)
    sparks.push({ g, vx: 0, vy: 0, lifeMs: 0 })
  }
  let sparkEveryMs = 0
  let hudSeconds: number | null = null

  function spawn(tileX: number, tileY: number, eventIndex: number): Enemy {
    const enemy = deps.spawnBeast(tileX, tileY, eventIndex)
    enemy.runner = {
      phase: 'asleep',
      hitsLeft: C.RUNNER_HITS,
      timerMs: 0,
      homeX: enemy.x,
      homeY: enemy.y,
      dir: 1,
      passMs: 0,
      woken: false,
    }
    deps.attachGlow(enemy)
    runners.push(enemy)
    return enemy
  }

  function setVisible(enemy: Enemy, on: boolean) {
    enemy.sprite.visible = on
    enemy.hpBarBg.visible = on
    enemy.hpBarFill.visible = on
  }

  function spawnSpark(x: number, y: number) {
    const s = sparks.find((p) => p.lifeMs <= 0)
    if (!s) return
    s.lifeMs = C.RUNNER_SPARK_MS
    s.vx = (Math.random() - 0.5) * 40
    s.vy = -20 - Math.random() * 40
    s.g.position.set(x + (Math.random() - 0.5) * 20, y + (Math.random() - 0.5) * 24)
    s.g.visible = true
  }

  function setHud(seconds: number | null) {
    if (seconds === hudSeconds) return
    hudSeconds = seconds
    deps.onHud(seconds)
  }

  // Не пойман — исчез. Из enemiesRef он уходит, чтобы ни меч, ни навыки его не
  // задевали, пока его нет; вернётся на свою точку тем же объектом.
  function vanish(enemy: Enemy) {
    const r = enemy.runner!
    deps.smoke(enemy.x + W / 2, enemy.y + H / 2, C.RUNNER_SMOKE_COUNT, C.RUNNER_SMOKE_MS, 60)
    r.phase = 'gone'
    r.timerMs = C.RUNNER_RESPAWN_MS
    setVisible(enemy, false)
    const i = deps.enemies.current.indexOf(enemy)
    if (i !== -1) deps.enemies.current.splice(i, 1)
  }

  function respawn(enemy: Enemy) {
    const r = enemy.runner!
    r.phase = 'asleep'
    r.hitsLeft = C.RUNNER_HITS
    r.woken = false
    r.passMs = 0
    enemy.x = r.homeX
    enemy.y = r.homeY
    enemy.vy = 0
    enemy.hp = enemy.maxHp
    enemy.hurtTimer = 0
    enemy.stunTimer = 0
    enemy.parryStunTimer = 0
    enemy.knockMs = 0
    redrawEnemyHpBar(enemy)
    setVisible(enemy, true)
    deps.enemies.current.push(enemy)
  }

  function update(dt: number, deltaMS: number, heroDead: boolean) {
    let hud: number | null = null
    const frames = deps.beastFrames.current
    for (let i = runners.length - 1; i >= 0; i--) {
      const enemy = runners[i]
      const r = enemy.runner!

      if (enemy.dead) {
        // Смерть зверя: доиграла и подержалась — труп убираем, мана, событие.
        const done = frames && (enemy.sprite.currentFrame >= frames.death.length - 1 || !enemy.sprite.playing)
        if (done) {
          enemy.deathHoldTimer += deltaMS
          if (enemy.deathHoldTimer >= C.DEATH_HOLD_MS) {
            const deathX = enemy.sprite.x
            const deathY = enemy.sprite.y - enemy.sprite.height
            deps.dropMana(enemy.x + W / 2, enemy.y + H / 2)
            deps.worldContainer.removeChild(enemy.rect, enemy.sprite, enemy.hpBarBg, enemy.hpBarFill)
            enemy.rect.destroy()
            enemy.sprite.destroy()
            enemy.hpBarBg.destroy()
            enemy.hpBarFill.destroy()
            destroyMark(enemy, deps.worldContainer)
            const k = deps.enemies.current.indexOf(enemy)
            if (k !== -1) deps.enemies.current.splice(k, 1)
            runners.splice(i, 1)
            const ev = deps.events.current[enemy.eventIndex]
            if (ev) ev.remainingEnemies = 0
            deps.closeEvent(enemy.eventIndex, deathX, deathY)
          }
        }
        continue
      }

      if (r.phase === 'gone') {
        r.timerMs -= deltaMS
        if (r.timerMs <= 0) respawn(enemy)
        continue
      }

      // Лёд — пауза, как у зверя: спрайт замирает, тело не двигается. Таймер
      // погони при этом идёт: заморозить Беглеца — честный способ его поймать.
      const wasStunned = enemy.stunTimer > 0
      enemy.stunTimer = Math.max(0, enemy.stunTimer - deltaMS)
      enemy.parryStunTimer = Math.max(0, enemy.parryStunTimer - deltaMS)
      if (r.phase === 'fleeing') {
        r.timerMs -= deltaMS
        // Смерть героя погоню не продолжает: HUD гаснет вместе с забегом.
        if (!heroDead) hud = Math.max(hud ?? 0, Math.ceil(r.timerMs / 1000))
        if (r.timerMs <= 0) {
          vanish(enemy)
          continue
        }
      }
      if (enemy.stunTimer > 0) {
        if (enemy.sprite.playing) enemy.sprite.stop()
        syncSprite(enemy)
        continue
      }
      if (wasStunned && !enemy.sprite.playing) enemy.sprite.play()

      // Гравитация — та же, что у зверя: у края он просто падает.
      enemy.vy = Math.min(enemy.vy + C.GRAVITY * dt, C.MAX_FALL)
      const prevFoot = enemy.y + H
      enemy.y += enemy.vy * dt
      const top = sweepFootBlock(deps.grid, T, enemy.x, W, prevFoot, enemy.y + H)
      if (top !== null) {
        enemy.y = top - H
        enemy.vy = 0
      }

      const box = deps.getPlayerCombatBox()
      const heroCx = box.x + box.w / 2
      const myCx = enemy.x + W / 2
      const prevX = enemy.x

      if (r.phase === 'asleep') {
        const near = Math.hypot(heroCx - myCx, (deps.phys.y + C.PLAYER_HEIGHT) - (enemy.y + H)) < C.RUNNER_WAKE_TILES * T
        const sees = near && !heroDead && (
          lineOfSight(deps.grid, myCx, enemy.y + H * 0.3, heroCx, deps.phys.y + C.PLAYER_HEIGHT * 0.3)
          || lineOfSight(deps.grid, myCx, enemy.y + H * 0.3, heroCx, deps.phys.y + C.PLAYER_HEIGHT * 0.7))
        if (r.woken || sees) {
          r.phase = 'fleeing'
          r.timerMs = C.RUNNER_TIME_MS
          r.dir = myCx >= heroCx ? 1 : -1
          r.passMs = 0
        }
      }

      if (r.phase === 'fleeing' && enemy.hurtTimer <= 0) {
        if (r.passMs > 0) r.passMs = Math.max(0, r.passMs - deltaMS)
        else if (myCx !== heroCx) r.dir = myCx > heroCx ? 1 : -1
        // Стена (или край мира) впереди — разворот и бег мимо героя.
        const lead = r.dir > 0 ? enemy.x + W + 2 : enemy.x - 2
        const blocked = lead < 0 || lead >= worldWidthPx
          || isSolid(deps.grid, T, lead, enemy.y + 1)
          || isSolid(deps.grid, T, lead, enemy.y + H / 2)
          || isSolid(deps.grid, T, lead, enemy.y + H - 1)
        if (blocked) {
          r.dir = r.dir > 0 ? -1 : 1
          r.passMs = C.RUNNER_PASS_MS
        } else {
          enemy.x = Math.max(0, Math.min(worldWidthPx - W, enemy.x + r.dir * C.MOVE_SPEED * C.RUNNER_SPEED_MULT * dt))
        }
        enemy.facing = r.dir
      }

      // Вид: hurt > бег > стойка; лист и якорь — зверя.
      if (frames) {
        if (enemy.hurtTimer > 0) {
          enemy.hurtTimer = Math.max(0, enemy.hurtTimer - deltaMS)
          deps.playSpriteAnim(enemy.sprite, frames.hurt, C.BEAST_HURT_ANIM_SPEED, false)
        } else if (enemy.x !== prevX) {
          deps.playSpriteAnim(enemy.sprite, frames.walk, C.WALK_ANIM_CHASE, true)
        } else {
          deps.playSpriteAnim(enemy.sprite, frames.idle, C.BEAST_IDLE_ANIM_SPEED, true)
        }
      }
      // След искр, пока бежит.
      if (enemy.x !== prevX) {
        sparkEveryMs -= deltaMS
        if (sparkEveryMs <= 0) {
          sparkEveryMs = C.RUNNER_SPARK_EVERY_MS
          spawnSpark(enemy.x + W / 2 - r.dir * W * 0.3, enemy.y + H * 0.55)
        }
      }
      syncSprite(enemy)
    }

    for (const s of sparks) {
      if (s.lifeMs <= 0) continue
      s.lifeMs -= deltaMS
      if (s.lifeMs <= 0) {
        s.g.visible = false
        continue
      }
      s.g.x += s.vx * deltaMS / 1000
      s.g.y += s.vy * deltaMS / 1000
      s.g.alpha = s.lifeMs / C.RUNNER_SPARK_MS
    }
    setHud(hud)
  }

  // Спрайт и полоса HP — как у зверя (enemy.ts): ноги на поверхность пола.
  function syncSprite(enemy: Enemy) {
    const foot = enemy.y + H
    const surface = deps.findGroundSurfaceY(enemy.x, W, foot)
    enemy.sprite.x = enemy.x + W / 2
    enemy.sprite.y = (surface ?? foot) + C.FOOT_TUNE
    enemy.sprite.scale.x = enemy.facing === -1 ? Math.abs(enemy.sprite.scale.x) : -Math.abs(enemy.sprite.scale.x)
    enemy.hpBarBg.x = enemy.x
    enemy.hpBarBg.y = enemy.y - C.ENEMY_HPBAR_OFFSET_Y - C.ENEMY_HP_BAR_MARGIN - C.ENEMY_HP_BAR_HEIGHT
    enemy.hpBarFill.x = enemy.x
    enemy.hpBarFill.y = enemy.hpBarBg.y
  }

  /**
   * Попадание по Беглецу (damageEnemy): сколько HP снять этим ударом — треть,
   * последний удар — остаток. Тик кровотечения ударом не считается (0).
   * Спящий от удара просыпается. null — по нему сейчас не бьют (его нет).
   */
  function hitAmount(enemy: Enemy, isTick: boolean): number | null {
    const r = enemy.runner
    if (!r || r.phase === 'gone') return null
    if (isTick) return 0
    r.woken = true
    r.hitsLeft = Math.max(0, r.hitsLeft - 1)
    return r.hitsLeft === 0 ? enemy.hp : Math.ceil(enemy.maxHp / C.RUNNER_HITS)
  }

  function dispose() {
    for (const s of sparks) if (!s.g.destroyed) s.g.destroy()
    sparks.length = 0
    // Исчезнувший Беглец не в enemiesRef и не в мире как видимый — его узлы
    // всё равно в worldContainer и уйдут вместе с ним (app.destroy).
    runners.length = 0
  }

  return { spawn, update, hitAmount, dispose }
}
