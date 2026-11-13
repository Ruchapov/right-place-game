import type { MutableRefObject } from 'react'
import { AnimatedSprite, Graphics } from 'pixi.js'
import type { Container, Filter, Texture } from 'pixi.js'
import type { DamageSource, Enemy, Grid, MapEvent, PlayerPhysics } from '../types'
import * as C from '../constants'
import * as N from '../ncConstants'
import { isSolid, sweepFootBlock, cellFootBlockTop } from '../collision'
import { clamp, parryStunFrame } from '../utils'
import { destroyMark } from '../perception'
import { scaledEnemyAttackDamage, scaledEnemyMaxHp } from '../scaling'
import { redrawEnemyHpBar } from './enemy'
import { newNcState } from './ncEnemy'
import { createShadowFilter, filterUniforms, syncFigureUniforms } from './ncFilters'

/**
 * ТЕНЬ ИЗ СУНДУКА (09.11.2026). Сундук с Тенью (решение сервера, isShadow)
 * открывается фиолетовым светом, гаснет, и над ним поднимается Тень — листы
 * самого героя, отражённые лицом к нему, через фильтр «Тень» (ncFilters.ts).
 * Появление — снизу вверх, ≈1.2 с; пока поднимается, не бьёт и урона не
 * получает.
 *
 * Поведение — враг ближнего боя без прыжков: бежит к герою, бьёт атакой
 * героя. Перед КАЖДЫМ ударом 0.4 с горят глаза (ярче и крупнее) — это и есть
 * замах. HP = 3 × зверь, урон = 1 × зверь. Хитстан — лист ранения героя.
 *
 * Лежит в общем enemiesRef (kind 'shadow'): меч, навыки, лёд и парирование —
 * как у всех. Событие сундука закрывает её смерть: трофеи сундука (у сундука
 * с Тенью сервер их уже умножил ×1.5) и добыча — только за победу.
 */
export type ShadowFrames = {
  idle: Texture[]
  run: Texture[]
  attack: Texture[]
  hurt: Texture[]
  death: Texture[]
}

export type ShadowDeps = {
  /** Ловушки как стена (13.11.2026) — см. EnemyDeps.trapBlocks в enemy.ts. */
  trapBlocks?: (enemy: Enemy, leadX: number, feetY: number) => boolean
  phys: PlayerPhysics
  getPlayerCombatBox: () => { x: number; y: number; w: number; h: number }
  pushPlayerOutX: (
    body: { x: number; y: number; width: number; height: number },
    playerBox: { x: number; y: number; w: number; h: number },
  ) => void
  findGroundSurfaceY: (x: number, width: number, footY: number) => number | null
  closeEvent: (index: number, worldX?: number, worldY?: number) => void
  takeDamage: (amount: number, source?: DamageSource) => boolean
  events: MutableRefObject<MapEvent[]>
  worldContainer: Container
  grid: Grid
  enemies: MutableRefObject<Enemy[]>
  characterLevel: MutableRefObject<number>
  frames: ShadowFrames
  /** WebGL есть — фильтр «Тень»; нет — запасной tint. */
  useFilter: boolean
}

const REVEAL_MS = 1200
const EYES_MS = 400
const HERO_SPEEDS = { idle: 0.15, run: 0.37, attack: C.ATTACK_ANIM_SPEED, death: C.DEATH_ANIM_SPEED }
/** Высота тела героя в клетке листа, px (кадр 0 idle: верх 10, ноги 282). */
const HERO_BODY_SHEET_PX = 272
/** Поза оглушения — кадр 5 листа hurt героя (самый «глубокий»). */
const SHADOW_STUN_POSE = 5
const SHADOW_SPEED = 2.6

export function createShadowSystem(deps: ShadowDeps) {
  const worldWidthPx = deps.grid[0].length * C.TILE_SIZE
  const scale = C.HERO_DRAW_H / deps.frames.idle[0].height
  // Один фильтр на каждую Тень: у каждой свои появление и глаза.
  const filters = new Map<Enemy, Filter>()
  let timeMs = 0

  function setAnim(e: Enemy, name: keyof ShadowFrames, loop: boolean, speed: number) {
    const nc = e.nc!
    if (nc.anim === name) return
    nc.anim = name
    e.sprite.textures = deps.frames[name]
    e.sprite.loop = loop
    e.sprite.animationSpeed = speed
    e.sprite.gotoAndPlay(0)
  }

  /** Тень над сундуком: центр по X, пол — floorY. */
  function spawn(centerX: number, floorY: number, eventIndex: number, faceDir: 1 | -1): Enemy {
    const w = C.PLAYER_WIDTH
    const h = C.PLAYER_HEIGHT
    const rect = new Graphics().rect(0, 0, w, h).fill(C.ENEMY_COLOR)
    rect.visible = false
    deps.worldContainer.addChild(rect)
    const sprite = new AnimatedSprite(deps.frames.idle)
    sprite.anchor.set(0.5, 1)
    sprite.scale.set(scale)
    sprite.roundPixels = false
    deps.worldContainer.addChild(sprite)
    const hpBarBg = new Graphics().rect(0, 0, w, C.ENEMY_HP_BAR_HEIGHT).fill(0x221e2b)
    deps.worldContainer.addChild(hpBarBg)
    const hpBarFill = new Graphics()
    deps.worldContainer.addChild(hpBarFill)
    const level = deps.characterLevel.current
    const maxHp = Math.round(N.SHADOW_HP_MULT * scaledEnemyMaxHp(level))
    const nc = newNcState()
    nc.reveal = 0
    const e: Enemy = {
      kind: 'shadow',
      width: w,
      height: h,
      x: clamp(centerX - w / 2, 0, worldWidthPx - w),
      y: floorY - h,
      vy: 0,
      hp: maxHp,
      maxHp,
      lastHitSwingId: 0,
      attackTimer: 0,
      windingUp: false,
      windupTimer: 0,
      windupMs: EYES_MS + (C.ATTACK_STRIKE_FRAME / (C.ATTACK_ANIM_SPEED * 60)) * 1000,
      waveCooldownMs: 0,
      zvonarAnim: null,
      eventIndex,
      spawnX: centerX,
      patrolDir: 1,
      facing: faceDir,
      rect,
      sprite,
      attackAnimPlaying: false,
      attackHitApplied: false,
      hurtTimer: 0,
      stunCount: 0,
      poiseImmuneTimer: 0,
      aggroMemoryTimer: 1,
      investigateX: null,
      investigateTimer: 0,
      investigateLookTimer: 0,
      stunTimer: 0,
      parryStunTimer: 0,
      dead: false,
      deathHoldTimer: 0,
      attackDamage: Math.ceil(N.SHADOW_DMG_MULT * scaledEnemyAttackDamage(level)),
      hpBarBg,
      hpBarFill,
      nc,
    }
    setAnim(e, 'idle', true, HERO_SPEEDS.idle)
    if (deps.useFilter) {
      const f = createShadowFilter()
      sprite.filters = [f]
      filters.set(e, f)
    } else {
      sprite.tint = 0x2a1840
    }
    layout(e)
    redrawEnemyHpBar(e)
    hpBarBg.visible = false
    hpBarFill.visible = false
    deps.enemies.current.push(e)
    return e
  }

  function playDeath(e: Enemy) {
    e.attackAnimPlaying = false
    e.windingUp = false
    e.nc!.action = null
    e.nc!.eyesMs = 0
    setAnim(e, 'death', false, HERO_SPEEDS.death)
  }

  function layout(e: Enemy) {
    const footBottom = e.y + e.height
    const surfaceY = deps.findGroundSurfaceY(e.x, e.width, footBottom)
    e.sprite.x = e.x + e.width / 2
    e.sprite.y = (surfaceY ?? footBottom) + C.FOOT_TUNE
    // Лист героя смотрит ВПРАВО по умолчанию.
    e.sprite.scale.set(e.facing === 1 ? scale : -scale, scale)
    e.rect.x = e.x
    e.rect.y = e.y
    e.hpBarBg.x = e.x
    e.hpBarBg.y = e.y - C.ENEMY_HPBAR_OFFSET_Y - C.ENEMY_HP_BAR_MARGIN - C.ENEMY_HP_BAR_HEIGHT
    e.hpBarFill.x = e.x
    e.hpBarFill.y = e.hpBarBg.y
  }

  function stepX(e: Enemy, dir: 1 | -1, dt: number, allowDrop: boolean) {
    const nextX = e.x + dir * SHADOW_SPEED * dt
    const lead = dir > 0 ? nextX + e.width : nextX
    if (isSolid(deps.grid, C.TILE_SIZE, lead, e.y + 1) || isSolid(deps.grid, C.TILE_SIZE, lead, e.y + e.height / 2) || isSolid(deps.grid, C.TILE_SIZE, lead, e.y + e.height - 1)) return false
    if (e.vy === 0 && deps.trapBlocks?.(e, lead, e.y + e.height)) return false
    if (!allowDrop && e.vy === 0 && cellFootBlockTop(deps.grid, C.TILE_SIZE, Math.floor(lead / C.TILE_SIZE), Math.floor((e.y + e.height) / C.TILE_SIZE)) === null) return false
    e.x = clamp(nextX, 0, worldWidthPx - e.width)
    return true
  }

  function update(dt: number, deltaMS: number) {
    timeMs += deltaMS
    for (let i = 0; i < deps.enemies.current.length; i++) {
      const e = deps.enemies.current[i]
      if (e.kind !== 'shadow' || !e.nc) continue
      const nc = e.nc
      const f = filters.get(e)
      if (f) {
        const u = filterUniforms(f)
        u.uTime = timeMs / 1000
        u.uReveal = nc.reveal
        u.uEyes = nc.eyesMs > 0 ? 1 : 0
        syncFigureUniforms(f, e.sprite, HERO_BODY_SHEET_PX)
      }

      if (e.dead) {
        const done = e.sprite.currentFrame >= deps.frames.death.length - 1 || !e.sprite.playing
        if (done) {
          e.deathHoldTimer += deltaMS
          if (e.deathHoldTimer >= C.DEATH_HOLD_MS) {
            const x = e.sprite.x
            const y = e.y
            deps.worldContainer.removeChild(e.rect, e.sprite, e.hpBarBg, e.hpBarFill)
            e.rect.destroy()
            e.sprite.destroy()
            e.hpBarBg.destroy()
            e.hpBarFill.destroy()
            destroyMark(e, deps.worldContainer)
            filters.get(e)?.destroy()
            filters.delete(e)
            deps.enemies.current.splice(i, 1)
            i--
            deps.closeEvent(e.eventIndex, x, y)
          }
        }
        continue
      }

      // Появление: стоит и поднимается снизу вверх.
      if (nc.reveal < 1) {
        nc.reveal = Math.min(1, nc.reveal + deltaMS / REVEAL_MS)
        if (nc.reveal >= 1) {
          e.hpBarBg.visible = true
          e.hpBarFill.visible = true
        }
        layout(e)
        continue
      }

      e.poiseImmuneTimer = Math.max(0, e.poiseImmuneTimer - deltaMS)
      const wasStunned = e.stunTimer > 0
      e.stunTimer = Math.max(0, e.stunTimer - deltaMS)
      if (e.stunTimer > 0) {
        if (e.sprite.playing) e.sprite.stop()
        deps.pushPlayerOutX({ x: e.x, y: e.y, width: e.width, height: e.height }, deps.getPlayerCombatBox())
        continue
      }
      e.parryStunTimer = Math.max(0, e.parryStunTimer - deltaMS)
      if (e.parryStunTimer > 0) {
        nc.action = null
        nc.eyesMs = 0
        if (nc.anim !== 'hurt') setAnim(e, 'hurt', false, 0)
        const frame = parryStunFrame(e.parryStunTimer, SHADOW_STUN_POSE, deps.frames.hurt.length - 1)
        if (e.sprite.playing || e.sprite.currentFrame !== frame) e.sprite.gotoAndStop(frame)
        deps.pushPlayerOutX({ x: e.x, y: e.y, width: e.width, height: e.height }, deps.getPlayerCombatBox())
        layout(e)
        continue
      }
      if (wasStunned && !e.sprite.playing) e.sprite.play()
      if (nc.action && !e.attackAnimPlaying) { nc.action = null; nc.eyesMs = 0 }

      // Гравитация.
      e.vy = Math.min(e.vy + C.GRAVITY * dt, C.MAX_FALL)
      const prevFoot = e.y + e.height
      e.y += e.vy * dt
      const top = sweepFootBlock(deps.grid, C.TILE_SIZE, e.x, e.width, prevFoot, e.y + e.height)
      if (top !== null) { e.y = top - e.height; e.vy = 0 }

      const pb = deps.getPlayerCombatBox()
      const dx = pb.x + pb.w / 2 - (e.x + e.width / 2)
      const gap = Math.max(0, Math.abs(dx) - pb.w / 2 - e.width / 2)
      const sameTier = pb.y < e.y + e.height && pb.y + pb.h > e.y
      nc.cooldownMs = Math.max(0, nc.cooldownMs - deltaMS)
      const prevX = e.x

      if (e.hurtTimer <= 0 && !nc.action) {
        const toward: 1 | -1 = dx >= 0 ? 1 : -1
        e.facing = toward
        if (sameTier && gap <= C.PLAYER_ATTACK_RANGE * 0.8 && nc.cooldownMs <= 0) {
          // Замах: 0.4 с горят глаза, потом атака героя.
          nc.action = 'eyes'
          nc.eyesMs = EYES_MS
          e.attackAnimPlaying = true
          e.windingUp = true
          e.windupTimer = 0
          nc.hitDone = false
        } else if (gap > C.PLAYER_ATTACK_RANGE * 0.6) {
          const playerBelow = deps.phys.onGround && (deps.phys.y + C.PLAYER_HEIGHT) - (e.y + e.height) >= C.ENEMY_DROP_MIN_PX && !sameTier
          stepX(e, toward, dt, playerBelow || e.vy !== 0)
        }
      }

      if (e.hurtTimer > 0) {
        e.hurtTimer = Math.max(0, e.hurtTimer - deltaMS)
        setAnim(e, 'hurt', false, deps.frames.hurt.length / ((C.ENEMY_HURT_MS / 1000) * 60))
      } else if (nc.action === 'eyes') {
        e.windupTimer += deltaMS
        nc.eyesMs = Math.max(0, nc.eyesMs - deltaMS)
        setAnim(e, 'idle', true, HERO_SPEEDS.idle)
        if (nc.eyesMs <= 0) {
          nc.action = 'attack'
          setAnim(e, 'attack', false, HERO_SPEEDS.attack)
        }
      } else if (nc.action === 'attack') {
        e.windupTimer += deltaMS
        if (!nc.hitDone && e.sprite.currentFrame >= C.ATTACK_STRIKE_FRAME) {
          nc.hitDone = true
          e.windingUp = false
          e.stunCount = 0
          const r = C.PLAYER_ATTACK_RANGE
          const zoneL = e.facing === 1 ? e.x + e.width : e.x - r
          const p2 = deps.getPlayerCombatBox()
          if (p2.x < zoneL + r && p2.x + p2.w > zoneL && p2.y < e.y + e.height && p2.y + p2.h > e.y) {
            if (deps.takeDamage(e.attackDamage, e)) {
              e.parryStunTimer = C.PARRY_STUN_MS
              e.attackAnimPlaying = false
              nc.action = null
            }
          }
        }
        if (nc.action === 'attack' && (e.sprite.currentFrame >= deps.frames.attack.length - 1 || !e.sprite.playing)) {
          nc.action = null
          e.attackAnimPlaying = false
          e.windingUp = false
          nc.cooldownMs = N.NC_ATTACK_COOLDOWN_MS
        }
      } else if (e.x !== prevX) {
        setAnim(e, 'run', true, HERO_SPEEDS.run)
      } else {
        setAnim(e, 'idle', true, HERO_SPEEDS.idle)
      }

      deps.pushPlayerOutX({ x: e.x, y: e.y, width: e.width, height: e.height }, deps.getPlayerCombatBox())
      layout(e)
    }
  }

  function dispose() {
    for (const f of filters.values()) f.destroy()
    filters.clear()
  }

  return { spawn, update, dispose, playDeath }
}

export type ShadowSystem = ReturnType<typeof createShadowSystem>
