import type { MutableRefObject } from 'react'
import { Graphics, Sprite } from 'pixi.js'
import type { Container, Texture } from 'pixi.js'
import type { DamageSource, Grid } from '../types'
import * as C from '../constants'
import * as N from '../ncConstants'
import { isSolid } from '../collision'

/**
 * СНАРЯДЫ НОВЫХ ВРАГОВ И ЗМЕЯ (09.11.2026): ком гробокопателя, грязь жука —
 * дугой; болт арбалетчика и кости Змея — по прямой. Один список на всех:
 * выпустивший может умереть, а снаряд долетает сам (как волна Звонаря).
 *
 * Попадание — ПАРИРУЕМЫЙ урон (takeDamage): отбитый снаряд гаснет без урона,
 * стрелка не оглушает (как волна Звонаря и шип босса). Рывок проходит сквозь
 * снаряд, и тот летит дальше.
 *
 * Все снаряды нарисованы летящими ВЛЕВО и в масштабе листов хозяина: их
 * рисуют тем же множителем «пиксель листа → пиксель мира», что тело.
 */
export type NcProjectileKind = 'clod' | 'mud' | 'bolt' | 'bones'

type Projectile = {
  kind: NcProjectileKind
  sprite: Sprite
  vx: number // px/с
  vy: number // px/с
  gravity: number
  travelled: number
  maxTravel: number
  damage: number
  owner: DamageSource
  /** Полубокс попадания по герою, px мира. */
  hw: number
  hh: number
}

// Крошки кома и пятно грязи — простая графика, без арта (задача).
type Burst = {
  g: Graphics
  ms: number
  life: number
  kind: 'crumbs' | 'splat'
  x: number
  y: number
  parts: { dx: number; dy: number; vx: number; vy: number; r: number }[]
}

export type NcProjectileDeps = {
  worldContainer: Container
  grid: Grid
  getPlayerCombatBox: () => { x: number; y: number; w: number; h: number }
  /** Парируемый урон; true — герой отбил. */
  takeDamage: (amount: number, source?: DamageSource) => boolean
  dashing: MutableRefObject<boolean>
  /** Грязь попала (не отбита) — замедлить героя. */
  slowHero: () => void
}

export type FireSpec = {
  kind: NcProjectileKind
  texture: Texture
  /** Масштаб «px листа → px мира» хозяина. */
  scale: number
  x: number
  y: number
  damage: number
  owner: DamageSource
  /** Прямые: направление полёта (единичный вектор). Дуга: точка, куда целились. */
  dirX?: number
  dirY?: number
  targetX?: number
  targetY?: number
}

export function createNcProjectileSystem(deps: NcProjectileDeps) {
  let shots: Projectile[] = []
  let bursts: Burst[] = []

  function fire(spec: FireSpec) {
    const sprite = new Sprite(spec.texture)
    sprite.anchor.set(0.5, 0.5)
    const s = spec.scale
    let vx: number
    let vy: number
    let gravity = 0
    let maxTravel: number
    if (spec.kind === 'clod' || spec.kind === 'mud') {
      // Дуга в точку, где герой стоял в момент броска: время полёта — от
      // дистанции (в пределах), скорости — из него.
      const dx = (spec.targetX ?? spec.x) - spec.x
      const dy = (spec.targetY ?? spec.y) - spec.y
      const t = Math.min(N.ARC_MAX_T, Math.max(N.ARC_MIN_T, Math.abs(dx) / N.ARC_SPEED_X))
      gravity = N.ARC_GRAVITY
      vx = dx / t
      vy = (dy - 0.5 * gravity * t * t) / t
      maxTravel = 40 * C.TILE_SIZE
    } else {
      const speed = spec.kind === 'bolt' ? N.BOLT_SPEED : N.BONES_SPEED
      vx = (spec.dirX ?? -1) * speed
      vy = (spec.dirY ?? 0) * speed
      maxTravel = (spec.kind === 'bolt' ? N.BOLT_RANGE_TILES : N.BONES_RANGE_TILES) * C.TILE_SIZE
    }
    // Нарисован летящим влево: вправо — зеркало; прямые повёрнуты по полёту.
    sprite.scale.set(vx > 0 ? -s : s, s)
    if (spec.kind === 'bones' || spec.kind === 'bolt') {
      sprite.rotation = vx > 0 ? Math.atan2(vy, vx) : Math.atan2(-vy, -vx)
    }
    sprite.x = spec.x
    sprite.y = spec.y
    deps.worldContainer.addChild(sprite)
    const w = spec.texture.width * s
    const h = spec.texture.height * s
    shots.push({
      kind: spec.kind,
      sprite,
      vx,
      vy,
      gravity,
      travelled: 0,
      maxTravel,
      damage: spec.damage,
      owner: spec.owner,
      // Бокс попадания — чуть меньше картинки: край снаряда не бьёт.
      hw: Math.max(8, w * 0.35),
      hh: Math.max(6, h * 0.35),
    })
  }

  function spawnBurst(kind: Burst['kind'], x: number, y: number) {
    const g = new Graphics()
    g.x = x
    g.y = y
    deps.worldContainer.addChild(g)
    const parts: Burst['parts'] = []
    if (kind === 'crumbs') {
      for (let i = 0; i < 9; i++) {
        const a = -Math.PI * (0.1 + 0.8 * Math.random())
        const sp = 90 + Math.random() * 160
        parts.push({ dx: 0, dy: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 2 + Math.random() * 3 })
      }
    }
    bursts.push({ g, ms: 0, life: kind === 'crumbs' ? 450 : N.MUD_SPLAT_MS, kind, x, y, parts })
  }

  function removeShot(p: Projectile) {
    deps.worldContainer.removeChild(p.sprite)
    p.sprite.destroy()
  }

  function update(deltaMS: number) {
    const dt = deltaMS / 1000
    if (shots.length > 0) {
      const alive: Projectile[] = []
      for (const p of shots) {
        p.vy += p.gravity * dt
        const stepX = p.vx * dt
        const stepY = p.vy * dt
        p.sprite.x += stepX
        p.sprite.y += stepY
        p.travelled += Math.hypot(stepX, stepY)
        if (p.gravity > 0) p.sprite.rotation += (p.vx > 0 ? 1 : -1) * N.ARC_SPIN * dt

        let remove = false
        // Герой — первым (как у волны Звонаря): снаряд, догнавший героя у
        // стены, бьёт его, а не гаснет о кладку.
        if (!deps.dashing.current) {
          const b = deps.getPlayerCombatBox()
          const overlap =
            b.x < p.sprite.x + p.hw && b.x + b.w > p.sprite.x - p.hw &&
            b.y < p.sprite.y + p.hh && b.y + b.h > p.sprite.y - p.hh
          if (overlap) {
            remove = true
            const parried = deps.takeDamage(p.damage, p.owner)
            if (!parried && p.kind === 'mud') deps.slowHero()
            if (p.kind === 'clod') spawnBurst('crumbs', p.sprite.x, p.sprite.y)
          }
        }
        if (!remove) {
          const frontX = p.sprite.x + Math.sign(p.vx) * p.hw
          const hitWall = isSolid(deps.grid, C.TILE_SIZE, frontX, p.sprite.y)
          const hitFloor = p.vy > 0 && isSolid(deps.grid, C.TILE_SIZE, p.sprite.x, p.sprite.y + p.hh)
          if (hitWall || hitFloor) {
            remove = true
            if (p.kind === 'clod') spawnBurst('crumbs', p.sprite.x, p.sprite.y + (hitFloor ? p.hh : 0))
            else if (p.kind === 'mud' && hitFloor) {
              // Пятно ложится на пол: верх клетки под снарядом.
              const floorY = Math.floor((p.sprite.y + p.hh) / C.TILE_SIZE) * C.TILE_SIZE
              spawnBurst('splat', p.sprite.x, floorY)
            } else if (p.kind === 'mud') spawnBurst('crumbs', p.sprite.x, p.sprite.y)
          }
        }
        if (!remove && p.travelled >= p.maxTravel) remove = true
        if (remove) removeShot(p)
        else alive.push(p)
      }
      shots = alive
    }

    if (bursts.length > 0) {
      const alive: Burst[] = []
      for (const b of bursts) {
        b.ms += deltaMS
        const k = 1 - b.ms / b.life
        if (k <= 0) {
          deps.worldContainer.removeChild(b.g)
          b.g.destroy()
          continue
        }
        b.g.clear()
        if (b.kind === 'crumbs') {
          for (const part of b.parts) {
            part.vy += 900 * dt
            part.dx += part.vx * dt
            part.dy += part.vy * dt
            b.g.circle(part.dx, part.dy, part.r).fill({ color: N.CLOD_CRUMB_COLOR, alpha: Math.min(1, k * 1.4) })
          }
        } else {
          // Пятно грязи: плоский эллипс на полу, за секунду исчезает.
          const grow = Math.min(1, b.ms / 120)
          b.g.ellipse(0, -3, 26 * grow, 7 * grow).fill({ color: N.MUD_SPLAT_COLOR, alpha: 0.85 * k })
          b.g.ellipse(-12 * grow, -5, 7 * grow, 4 * grow).fill({ color: 0x4a3622, alpha: 0.8 * k })
          b.g.ellipse(14 * grow, -4, 6 * grow, 3 * grow).fill({ color: 0x4a3622, alpha: 0.8 * k })
        }
        alive.push(b)
      }
      bursts = alive
    }
  }

  function dispose() {
    for (const p of shots) removeShot(p)
    for (const b of bursts) {
      deps.worldContainer.removeChild(b.g)
      b.g.destroy()
    }
    shots = []
    bursts = []
  }

  return { fire, update, dispose }
}

export type NcProjectileSystem = ReturnType<typeof createNcProjectileSystem>
