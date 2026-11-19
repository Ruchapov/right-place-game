import type { MutableRefObject } from 'react'
import { Graphics, Sprite } from 'pixi.js'
import type { Container, Texture } from 'pixi.js'
import type { DamageSource, Grid } from '../types'
import * as C from '../constants'
import * as N from '../ncConstants'
import { isSolid } from '../collision'
import { standLineY } from '../utils'
import { playSfx } from '../../audio/sound'

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

// Крошки кома — простая графика. Лужа грязи (17.11.2026) — спрайт из
// mud_puddle_{1,2,3}.png (случайный вариант и зеркало), брызги — те же крошки.
type Burst = {
  g: Graphics
  /** Спрайт лужи (splat), null — у крошек. */
  sprite: Sprite | null
  flip: number
  ms: number
  life: number
  kind: 'crumbs' | 'splat'
  x: number
  y: number
  parts: { dx: number; dy: number; vx: number; vy: number; r: number }[]
  color: number
}

export type NcProjectileDeps = {
  worldContainer: Container
  grid: Grid
  getPlayerCombatBox: () => { x: number; y: number; w: number; h: number }
  /** Парируемый урон; true — герой отбил. */
  takeDamage: (amount: number, source?: DamageSource) => boolean
  dashing: MutableRefObject<boolean>
  /**
   * Замедлить героя на ms (берётся больший остаток): попадание грязью — SLOW_MS,
   * стояние в луже — MUD_PUDDLE_LINGER_MS каждый тик, пока стоит.
   */
  slowHero: (ms: number) => void
  /** Картинки луж навозника (17.11.2026); пусто — лужа не рисуется, но замедляет. */
  mudPuddles: () => Texture[]
  /** Стоит ли герой на земле (лужа под ногами или ниже точки попадания). */
  heroOnGround: () => boolean
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

  /**
   * Лужа целиком на полу (18.11.2026): центр сдвигается внутрь площадки, если
   * у края половина лужи повисла бы над пустотой. y — верх клетки пола.
   */
  function puddleCenterX(x: number, y: number): number {
    const T = C.TILE_SIZE
    const r = Math.round(y / T)
    const floorCell = (cx: number) => isSolid(deps.grid, T, cx * T + T / 2, r * T + 1) && !isSolid(deps.grid, T, cx * T + T / 2, r * T + 1 - T)
    let left = Math.floor(x / T)
    let right = left
    while (floorCell(left - 1)) left--
    while (floorCell(right + 1)) right++
    const half = (N.MUD_PUDDLE_W_TILES * T) / 2
    const lo = left * T + half
    const hi = (right + 1) * T - half
    return lo <= hi ? Math.min(hi, Math.max(lo, x)) : (left * T + (right + 1) * T) / 2
  }

  function spawnBurst(kind: Burst['kind'], x: number, y: number) {
    let sprite: Sprite | null = null
    let flip = 1
    // y — верх клетки пола (по нему проверка «герой стоит в луже»); рисуется лужа
    // на линии ступней — той же standLineY, что сажает героя и врагов (18.11.2026:
    // на линии клетки она висела на FOOT_TUNE выше их ступней).
    let drawY = y
    if (kind === 'splat') {
      x = puddleCenterX(x, y)
      drawY = standLineY(y)
      const tex = deps.mudPuddles()
      if (tex.length > 0) {
        sprite = new Sprite(tex[Math.floor(Math.random() * tex.length)])
        // Низ видимой лужи (54 px из 56) — на линии ступней.
        sprite.anchor.set(0.5, N.MUD_PUDDLE_ANCHOR_Y)
        flip = Math.random() < 0.5 ? -1 : 1
        sprite.x = x
        sprite.y = drawY
        deps.worldContainer.addChild(sprite)
      }
    }
    const g = new Graphics()
    g.x = x
    g.y = drawY
    deps.worldContainer.addChild(g)
    const parts: Burst['parts'] = []
    // Крошки кома; у лужи — пара брызг-капель цвета грязи в момент удара.
    const n = kind === 'crumbs' ? 9 : N.MUD_SPLASH_DROPS
    for (let i = 0; i < n; i++) {
      const a = -Math.PI * (0.1 + 0.8 * Math.random())
      const sp = 90 + Math.random() * 160
      parts.push({ dx: 0, dy: kind === 'splat' ? -4 : 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 2 + Math.random() * 3 })
    }
    const color = kind === 'splat' ? N.MUD_DROP_COLOR : N.CLOD_CRUMB_COLOR
    bursts.push({ g, sprite, flip, ms: 0, life: kind === 'crumbs' ? 450 : N.MUD_SPLAT_MS, kind, x, y, parts, color })
  }

  /**
   * Ближайший пол под точкой (x, y): верх первой твёрдой клетки, над которой
   * воздух, не глубже maxTiles клеток. null — пола нет.
   */
  function floorBelow(x: number, y: number, maxTiles: number): number | null {
    const T = C.TILE_SIZE
    const startRow = Math.floor(y / T)
    for (let r = startRow; r <= startRow + maxTiles; r++) {
      const cellY = r * T + 1
      if (isSolid(deps.grid, T, x, cellY) && !isSolid(deps.grid, T, x, cellY - T)) return r * T
    }
    return null
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
            if (!parried && p.kind === 'mud') deps.slowHero(N.SLOW_MS)
            // Ком грязи попал в героя (17.11.2026) — лужа тоже ложится на пол:
            // под ногами героя; в прыжке — под точкой попадания, на ближайший
            // пол ниже, не дальше MUD_PUDDLE_DROP_TILES клеток; пола нет — без лужи.
            if (p.kind === 'mud') {
              const onGround = deps.heroOnGround()
              const cx = b.x + b.w / 2
              const floorY = onGround
                ? floorBelow(cx, b.y + b.h - 2, 1)
                : floorBelow(p.sprite.x, p.sprite.y, N.MUD_PUDDLE_DROP_TILES)
              if (floorY !== null) spawnBurst('splat', onGround ? cx : p.sprite.x, floorY)
            }
            if (p.kind === 'clod') { spawnBurst('crumbs', p.sprite.x, p.sprite.y); playSfx('gravedigger_dirt', { volume: 0.6, x: p.sprite.x, y: p.sprite.y }) }
          }
        }
        if (!remove) {
          const frontX = p.sprite.x + Math.sign(p.vx) * p.hw
          const hitWall = isSolid(deps.grid, C.TILE_SIZE, frontX, p.sprite.y)
          const hitFloor = p.vy > 0 && isSolid(deps.grid, C.TILE_SIZE, p.sprite.x, p.sprite.y + p.hh)
          if (hitWall || hitFloor) {
            remove = true
            if (p.kind === 'clod') { spawnBurst('crumbs', p.sprite.x, p.sprite.y + (hitFloor ? p.hh : 0)); playSfx('gravedigger_dirt', { volume: 0.6, x: p.sprite.x, y: p.sprite.y }) }
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
          removeBurst(b)
          continue
        }
        b.g.clear()
        if (b.kind === 'crumbs') {
          for (const part of b.parts) {
            part.vy += 900 * dt
            part.dx += part.vx * dt
            part.dy += part.vy * dt
            b.g.circle(part.dx, part.dy, part.r).fill({ color: b.color, alpha: Math.min(1, k * 1.4) })
          }
        } else if (b.sprite) {
          // Лужа-спрайт (17.11.2026): «шлепок» — ширина 0.6 → 1 за
          // MUD_PUDDLE_SPLAT_IN_MS, потом прежнее плавное исчезновение. Брызги
          // летят первые 450 мс.
          const left = b.life - b.ms
          const a = left < N.MUD_PUDDLE_FADE_MS ? left / N.MUD_PUDDLE_FADE_MS : 1
          const t = Math.min(1, b.ms / N.MUD_PUDDLE_SPLAT_IN_MS)
          const sc = (N.MUD_PUDDLE_W_TILES * C.TILE_SIZE) / b.sprite.texture.width
          b.sprite.scale.set(b.flip * sc * (0.6 + 0.4 * t), sc)
          b.sprite.alpha = a
          if (b.ms < 450) {
            const ka = 1 - b.ms / 450
            for (const part of b.parts) {
              part.vy += 900 * dt
              part.dx += part.vx * dt
              part.dy += part.vy * dt
              b.g.circle(part.dx, part.dy, part.r).fill({ color: b.color, alpha: Math.min(1, ka * 1.4) })
            }
          }
        } else {
          // Лужа грязи (13.11.2026): видна и на тёмных картах — тёмная охра с
          // каймой и светлым бликом сверху, ширина 1.2 клетки; 4 с, потом плавно
          // гаснет. Герой в ней замедлен (ниже, после отрисовки).
          const grow = Math.min(1, b.ms / 120)
          const left = b.life - b.ms
          const a = left < N.MUD_PUDDLE_FADE_MS ? left / N.MUD_PUDDLE_FADE_MS : 1
          const rx = (N.MUD_PUDDLE_W_TILES * C.TILE_SIZE) / 2 * grow
          b.g.ellipse(0, -2, rx + 2, 9 * grow).fill({ color: N.MUD_PUDDLE_RIM_COLOR, alpha: 0.9 * a })
          b.g.ellipse(0, -3, rx, 7 * grow).fill({ color: N.MUD_PUDDLE_COLOR, alpha: 0.95 * a })
          b.g.ellipse(-rx * 0.25, -6, rx * 0.45, 2 * grow).fill({ color: N.MUD_PUDDLE_SHINE_COLOR, alpha: 0.75 * a })
          b.g.ellipse(rx * 0.45, -5, rx * 0.12, 1.5 * grow).fill({ color: N.MUD_PUDDLE_SHINE_COLOR, alpha: 0.6 * a })
        }
        alive.push(b)
      }
      bursts = alive
    }

    // Герой стоит в луже — замедлен, пока стоит, и ещё MUD_PUDDLE_LINGER_MS.
    // «Стоит» — низ его бокса у пола лужи (±8 px) и середина над её шириной.
    if (bursts.length > 0) {
      const hb = deps.getPlayerCombatBox()
      const feetY = hb.y + hb.h
      const cx = hb.x + hb.w / 2
      for (const b of bursts) {
        if (b.kind !== 'splat') continue
        const rx = (N.MUD_PUDDLE_W_TILES * C.TILE_SIZE) / 2
        if (Math.abs(feetY - b.y) <= 8 && Math.abs(cx - b.x) <= rx) {
          deps.slowHero(N.MUD_PUDDLE_LINGER_MS)
          break
        }
      }
    }
  }

  function removeBurst(b: Burst) {
    deps.worldContainer.removeChild(b.g)
    b.g.destroy()
    if (b.sprite) {
      deps.worldContainer.removeChild(b.sprite)
      b.sprite.destroy()
    }
  }

  function dispose() {
    for (const p of shots) removeShot(p)
    for (const b of bursts) removeBurst(b)
    shots = []
    bursts = []
  }

  return { fire, update, dispose }
}

export type NcProjectileSystem = ReturnType<typeof createNcProjectileSystem>
