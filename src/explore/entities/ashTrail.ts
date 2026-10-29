import { AnimatedSprite } from 'pixi.js'
import type { Container, Texture } from 'pixi.js'
import * as C from '../constants'
import type { Boss, Enemy } from '../types'

// Кольцо Пепла (Мастер, docs/crafter.md, решено 25.10.2026, вариант 3): рывок
// оставляет на земле огненный след на RING_ASH_TRAIL_MS. Враг, задевший след,
// загорается на RING_ASH_BURN_MS и раз в RING_ASH_TICK_MS получает урон одного
// тика кровотечения. Огонь достаёт его и после выхода из следа; повторное
// касание горящего врага продлевает горение, а не зажигает второй огонь.
//
// След тянется за героем, пока идёт рывок (dashing), — одна полоса на рывок,
// растянутая от точки старта до текущего X. Урон и его учёт — у вызывающего
// (burnEnemy/burnBoss: damageEnemy/damageBoss с 'tick' и skillDamageDealt).
export type AshTrailDeps = {
  worldContainer: Container
  frames: Texture[]
  dashing: { current: boolean }
  /** X центра героя и Y его ступней, мировые координаты. */
  heroFoot: () => { x: number; y: number }
  enemies: () => readonly Enemy[]
  boss: () => Boss | null
  burnEnemy: (enemy: Enemy) => void
  burnBoss: () => void
  trailMs: number
  burnMs: number
  tickMs: number
}

type Segment = { sprite: AnimatedSprite; x0: number; x1: number; footY: number; msLeft: number; growing: boolean }
type Burn = { msLeft: number; tickLeft: number }

export function createAshTrailSystem(deps: AshTrailDeps) {
  const segments: Segment[] = []
  const burns = new Map<Enemy, Burn>()
  let bossBurn: Burn | null = null
  let current: Segment | null = null

  function layout(seg: Segment) {
    const left = Math.min(seg.x0, seg.x1)
    const w = Math.max(C.ASH_FIRE_MIN_W, Math.abs(seg.x1 - seg.x0))
    seg.sprite.x = left + Math.abs(seg.x1 - seg.x0) / 2
    seg.sprite.y = seg.footY
    seg.sprite.width = w
    seg.sprite.height = C.ASH_FIRE_DRAW_H
  }

  function startSegment(x: number, footY: number): Segment {
    let seg = segments.find((s) => !s.sprite.visible)
    if (!seg) {
      const sprite = new AnimatedSprite(deps.frames)
      sprite.anchor.set(0.5, C.ASH_FIRE_ANCHOR_Y)
      sprite.loop = true
      sprite.animationSpeed = C.ASH_FIRE_ANIM_SPEED
      sprite.blendMode = 'add'
      deps.worldContainer.addChild(sprite)
      seg = { sprite, x0: 0, x1: 0, footY: 0, msLeft: 0, growing: false }
      segments.push(seg)
    }
    seg.x0 = x
    seg.x1 = x
    seg.footY = footY
    seg.msLeft = deps.trailMs
    seg.growing = true
    seg.sprite.alpha = 1
    seg.sprite.visible = true
    seg.sprite.gotoAndPlay(Math.floor(Math.random() * deps.frames.length))
    layout(seg)
    return seg
  }

  function touches(seg: Segment, x: number, y: number, w: number, h: number): boolean {
    const half = Math.max(C.ASH_FIRE_MIN_W, Math.abs(seg.x1 - seg.x0)) / 2
    const cx = (seg.x0 + seg.x1) / 2
    return x < cx + half && x + w > cx - half && y < seg.footY && y + h > seg.footY - C.ASH_FIRE_HIT_H
  }

  function ignite(burn: Burn | undefined | null): Burn {
    if (burn) { burn.msLeft = deps.burnMs; return burn }
    // Первый урон — через секунду после касания, как у тика кровотечения.
    return { msLeft: deps.burnMs, tickLeft: deps.tickMs }
  }

  // false — горение кончилось.
  function tickBurn(burn: Burn, dtMs: number, hit: () => void): boolean {
    burn.tickLeft -= dtMs
    if (burn.tickLeft <= 0 && burn.msLeft > 0) {
      burn.tickLeft += deps.tickMs
      hit()
    }
    burn.msLeft -= dtMs
    return burn.msLeft > 0
  }

  function update(dtMs: number) {
    // След растёт за героем, пока идёт рывок; кончился рывок — полоса застыла.
    if (deps.dashing.current) {
      const foot = deps.heroFoot()
      if (!current) current = startSegment(foot.x, foot.y)
      current.x1 = foot.x
      current.msLeft = deps.trailMs
      layout(current)
    } else if (current) {
      current.growing = false
      current = null
    }

    for (const seg of segments) {
      if (!seg.sprite.visible) continue
      if (!seg.growing) {
        seg.msLeft -= dtMs
        if (seg.msLeft <= 0) { seg.sprite.visible = false; seg.sprite.stop(); continue }
        seg.sprite.alpha = Math.min(1, seg.msLeft / C.ASH_FIRE_FADE_MS)
      }
      for (const enemy of deps.enemies()) {
        if (enemy.dead) continue
        if (touches(seg, enemy.x, enemy.y, enemy.width, enemy.height)) burns.set(enemy, ignite(burns.get(enemy)))
      }
      const boss = deps.boss()
      if (boss && !boss.dead && touches(seg, boss.x, boss.y, C.BOSS_WIDTH, C.BOSS_HEIGHT)) bossBurn = ignite(bossBurn)
    }

    for (const [enemy, burn] of burns) {
      if (enemy.dead || !tickBurn(burn, dtMs, () => deps.burnEnemy(enemy))) burns.delete(enemy)
    }
    if (bossBurn) {
      const boss = deps.boss()
      if (!boss || boss.dead || !tickBurn(bossBurn, dtMs, deps.burnBoss)) bossBurn = null
    }
  }

  function clear() {
    for (const seg of segments) { seg.sprite.visible = false; seg.sprite.stop() }
    burns.clear()
    bossBurn = null
    current = null
  }

  function dispose() {
    clear()
    for (const seg of segments) seg.sprite.destroy()
    segments.length = 0
  }

  return { update, clear, dispose }
}
