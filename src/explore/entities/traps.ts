// ЛОВУШКИ ЗАБЕГА (13.11.2026) — docs/explore-features.md, «Ловушки».
//
// Четыре вида, все из пулов слот-файла (сколько за забег — trapsPerRun):
//   • выдвижные шипы (hazard) — цикл спрятаны → предупреждение → выдвинуты;
//   • горгулья с нажимной плитой — наступил на плиту, из пасти летит огонь;
//   • сталактит — вошёл в зону под ним, он дрожит и падает, одноразовый;
//   • пила на рельсе — диск ездит туда-сюда.
//
// ОБЩИЕ ПРАВИЛА (одна копия на все модули врагов — enemy.ts, ncEnemy.ts,
// shadow.ts зовут ЭТИ функции, а не повторяют логику):
//   • isTrapImmune — боссы (их нет в списке врагов вовсе), Звонарь, Привратник,
//     вызванные Настоятелем и Беглец ловушек не замечают: не ранятся, не
//     останавливаются, плиту и сталактит не включают;
//   • blocksStep — «шаг вперёд упирается в ловушку». Враг НЕ в погоне (патруль,
//     осмотр, поиск, зов стаи в пути) считает стеной любую ловушку и не
//     спрыгивает на неё сверху. В погоне — не заходит на выдвинутые шипы и под
//     пилу (ждёт, пока диск ближе 2 клеток), а спрятанные шипы, плиту и зону
//     сталактита проходит;
//   • урон врагу — TRAP_ENEMY_DAMAGE_FRAC его maxHp (вверх) через общий
//     damageEnemy (смерть — тот же путь, что от меча), потом окно
//     TRAP_ENEMY_IFRAME_MS. Враг вне погоны ловушками не ранится («без игрока
//     враги не страдают»); втолкнутый Тараном или Телекинезом
//     (trapExposedMs > 0) — ранится любой;
//   • урон герою — через обычный applyDamage как непарируемый
//     (takeDamageUnblockable; гасит огонёк Носителя огня), огонь горгульи —
//     парируемый. Окно TRAP_HERO_IFRAME_MS одно на все ловушки.
//   • снаряды врагов с ловушками не взаимодействуют.
//
// Рисуются ПОВЕРХ слоя карты и живого декора, но ПОД героем и врагами — узел
// вставляет Explore.tsx в нужное место списка мира (parent + index).
import { Container, Graphics, Sprite, Texture } from 'pixi.js'
import * as C from '../constants'
import { isSolid } from '../collision'
import { SPIKE_H_RATIO } from '../../mapRenderer'
import type { Enemy, Grid } from '../types'

export type GargoyleSlot = { x: number; y: number; dir: 1 | -1; plate: [number, number] }
export type StalactiteSlot = { x: number; y: number; ceil: number }
export type SawSlot = { x0: number; x1: number; y: number }

export type GargoyleMeta = { frames: number; fps: number; eyesLitFrame: number; mouthOpenFrame: number; mouthX: number; mouthY: number; frameW: number; frameH: number }

export type TrapTextures = {
  spike: Texture
  spikeGlint: Texture | null
  gargoyleFrames: Texture[]
  fireball: Texture
  plateUp: Texture
  plateDown: Texture
  stalactite: Texture
  rubble: Texture
  sawBlade: Texture
  sawRail: Texture
}

export type TrapsDeps = {
  parent: Container
  /** Позиция узла в списке мира: над слоем и живым декором, под героем. */
  index: number
  grid: Grid
  spikes: [number, number][]
  gargoyles: GargoyleSlot[]
  stalactites: StalactiteSlot[]
  saws: SawSlot[]
  textures: TrapTextures
  gargoyle: GargoyleMeta
  enemies: { current: Enemy[] }
  /** Боевой бокс героя (тот же, что бьют враги). */
  heroBox: () => { x: number; y: number; w: number; h: number }
  /** Тело героя для шипов: x, ширина, верх (замеренная макушка), низ (ступни). */
  heroSpikeBody: () => { x: number; w: number; top: number; bottom: number }
  heroOnGround: () => boolean
  heroMaxHp: number
  /** Множитель урона шипов от снаряжения (gearRef.spikeMult). */
  spikeMult: number
  heroDead: () => boolean
  hurtHero: (amount: number) => void
  /** Парируемый удар (огонь горгульи). true — отбит. */
  hurtHeroParryable: (amount: number) => boolean
  /** «Тихий шаг» — удар шипов карты по герою. */
  onHeroSpikeHit: () => void
  /** Урон врагу ловушкой (общий damageEnemy). true — умер. */
  damageEnemy: (enemy: Enemy, amount: number, sourceX: number) => boolean
  hitReaction: (enemy: Enemy) => void
  reduceMotion: boolean
  glintAlpha: (tS: number) => number
}

const T = C.TILE_SIZE

/** Невосприимчивые к ловушкам (боссов нет в списке врагов вовсе). */
export function isTrapImmune(e: Enemy): boolean {
  return e.runner !== undefined || e.kind === 'zvonar' || e.kind === 'gatekeeper' || e.summoned === true
}

function chasing(e: Enemy): boolean {
  return e.aggroMemoryTimer > 0
}

function exposed(e: Enemy): boolean {
  return (e.trapExposedMs ?? 0) > 0
}

function boxesOverlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

function enemyBox(e: Enemy) {
  return { x: e.x, y: e.y, w: e.width, h: e.height }
}

// --- состояния ---

type Spike = {
  cx: number; cy: number
  phaseMs: number
  ext: number // 0..1 — насколько выдвинут
  node: Container; sprite: Sprite; glint: Sprite | null; slit: Graphics
}

type Gargoyle = {
  slot: GargoyleSlot
  sprite: Sprite; plateUp: Sprite; plateDown: Sprite
  firing: boolean; frameMs: number; fired: boolean
  plateMs: number // >0 — плита нажата, перезарядка
  press: number // 0..1 — анимация нажатия
  wallX: number; floorY: number
}

type Fireball = { sprite: Sprite; x: number; y: number; dir: 1 | -1; travelled: number; t: number }

type Stalactite = {
  slot: StalactiteSlot
  sprite: Sprite; rubble: Sprite
  state: 'idle' | 'shake' | 'fall' | 'done'
  ms: number; vy: number; baseX: number; topY: number
}

type Saw = { slot: SawSlot; blade: Sprite; x: number; dir: 1 | -1; minX: number; maxX: number; floorY: number; angle: number }

type Dust = { g: Graphics; vx: number; vy: number; life: number; max: number }

export function createTrapsSystem(deps: TrapsDeps) {
  const root = new Container()
  root.label = 'traps'
  deps.parent.addChildAt(root, Math.min(deps.index, deps.parent.children.length))
  const tx = deps.textures
  const W = deps.grid[0]?.length ?? 0

  // Клетки ловушек ряда стояния → для blocksStep.
  type Cell = { kind: 'spike'; s: Spike } | { kind: 'plate' } | { kind: 'stal'; s: Stalactite } | { kind: 'rail'; s: Saw }
  const cells = new Map<number, Cell>()
  const key = (cx: number, cy: number) => cy * W + cx

  // --- шипы: фаза по группам соседних ---
  const spikes: Spike[] = []
  const bandH = T * SPIKE_H_RATIO
  const sortedSpikes = [...deps.spikes].sort((a, b) => a[1] - b[1] || a[0] - b[0])
  let groupPhase = 0
  let prev: [number, number] | null = null
  for (const [cx, cy] of sortedSpikes) {
    if (!prev || prev[1] !== cy || cx - prev[0] !== 1) groupPhase = Math.random() * C.SPIKE_CYCLE_MS
    prev = [cx, cy]
    const node = new Container()
    node.x = cx * T
    node.y = cy * T
    const slit = new Graphics().rect(6, T - 3, T - 12, 3).fill({ color: 0x0b0806, alpha: 0.9 })
    const sprite = new Sprite(tx.spike)
    const mask = new Graphics().rect(0, 0, T, T).fill(0xffffff)
    node.addChild(slit, sprite, mask)
    sprite.mask = mask
    let glint: Sprite | null = null
    if (tx.spikeGlint && !deps.reduceMotion) {
      glint = new Sprite(tx.spikeGlint)
      glint.mask = mask
      node.addChild(glint)
    }
    root.addChild(node)
    const s: Spike = { cx, cy, phaseMs: groupPhase, ext: 0, node, sprite, glint, slit }
    spikes.push(s)
    cells.set(key(cx, cy), { kind: 'spike', s })
  }

  // --- горгульи и плиты ---
  const gargoyles: Gargoyle[] = []
  const gm = deps.gargoyle
  for (const slot of deps.gargoyles) {
    const floorY = (slot.y + 1) * T
    const wallX = slot.dir === 1 ? slot.x * T : (slot.x + 1) * T
    const sprite = new Sprite(tx.gargoyleFrames[0])
    sprite.scale.set(C.GARGOYLE_SCALE * slot.dir, C.GARGOYLE_SCALE)
    sprite.x = wallX
    sprite.y = floorY - 2 * T
    const plateX = slot.plate[0] * T
    const mk = (tex: Texture) => {
      const p = new Sprite(tex)
      p.scale.set(C.PLATE_SCALE)
      p.x = plateX
      p.y = floorY - tex.height * C.PLATE_SCALE + 4
      return p
    }
    const plateUp = mk(tx.plateUp)
    const plateDown = mk(tx.plateDown)
    plateDown.alpha = 0
    root.addChild(plateDown, plateUp, sprite)
    gargoyles.push({ slot, sprite, plateUp, plateDown, firing: false, frameMs: 0, fired: false, plateMs: 0, press: 0, wallX, floorY })
    cells.set(key(slot.plate[0], slot.y), { kind: 'plate' })
    cells.set(key(slot.plate[0] + 1, slot.y), { kind: 'plate' })
  }
  const fireballs: Fireball[] = []

  // --- сталактиты ---
  const stalactites: Stalactite[] = []
  for (const slot of deps.stalactites) {
    const sprite = new Sprite(tx.stalactite)
    const sc = (2 * T) / tx.stalactite.width
    sprite.scale.set(sc)
    const baseX = slot.x * T
    const topY = (slot.ceil + 1) * T - 4
    sprite.x = baseX
    sprite.y = topY
    const rubble = new Sprite(tx.rubble)
    rubble.scale.set((2 * T) / tx.rubble.width)
    rubble.x = baseX
    rubble.y = (slot.y + 1) * T - tx.rubble.height * rubble.scale.y + 6
    rubble.visible = false
    root.addChild(rubble, sprite)
    const s: Stalactite = { slot, sprite, rubble, state: 'idle', ms: 0, vy: 0, baseX, topY }
    stalactites.push(s)
    cells.set(key(slot.x, slot.y), { kind: 'stal', s })
    cells.set(key(slot.x + 1, slot.y), { kind: 'stal', s })
  }

  // --- пилы ---
  const saws: Saw[] = []
  for (const slot of deps.saws) {
    const floorY = (slot.y + 1) * T
    const blade = new Sprite(tx.sawBlade)
    blade.anchor.set(0.5)
    blade.scale.set(T / tx.sawBlade.height)
    const bladeMask = new Graphics().rect(slot.x0 * T - T, floorY - 2 * T, (slot.x1 - slot.x0 + 3) * T, 2 * T + 4).fill(0xffffff)
    blade.mask = bladeMask
    root.addChild(bladeMask, blade)
    const railH = tx.sawRail.height * (T / tx.sawRail.width)
    for (let cx = slot.x0; cx <= slot.x1; cx++) {
      const r = new Sprite(tx.sawRail)
      r.scale.set(T / tx.sawRail.width)
      r.x = cx * T
      r.y = floorY - railH * 0.6
      root.addChild(r)
    }
    const minX = slot.x0 * T + T / 2
    const maxX = slot.x1 * T + T / 2
    const s: Saw = { slot, blade, x: minX + Math.random() * (maxX - minX), dir: Math.random() < 0.5 ? 1 : -1, minX, maxX, floorY, angle: 0 }
    blade.x = s.x
    blade.y = floorY - C.SAW_CENTER_ABOVE_FLOOR
    saws.push(s)
    for (let cx = slot.x0; cx <= slot.x1; cx++) cells.set(key(cx, slot.y), { kind: 'rail', s })
  }

  // --- пыль и искры (общий маленький пул) ---
  const dust: Dust[] = []
  function puff(x: number, y: number, n: number, color: number, spread: number, up: number): void {
    if (deps.reduceMotion) return
    for (let i = 0; i < n && dust.length < 60; i++) {
      const g = new Graphics().circle(0, 0, 1.5 + Math.random() * 1.5).fill({ color, alpha: 0.85 })
      g.x = x + (Math.random() - 0.5) * spread
      g.y = y
      root.addChild(g)
      const max = 400 + Math.random() * 400
      dust.push({ g, vx: (Math.random() - 0.5) * 120, vy: -up * Math.random(), life: max, max })
    }
  }

  // --- урон ---
  let heroIframeMs = 0
  const enemyIframe = new Map<Enemy, number>()

  function hurtHeroFrac(frac: number): void {
    if (heroIframeMs > 0 || deps.heroDead()) return
    heroIframeMs = C.TRAP_HERO_IFRAME_MS
    deps.hurtHero(deps.heroMaxHp * frac)
  }

  /** Может ли ловушка сейчас ранить врага (и ранит, если да). true — задет. */
  function hitEnemy(e: Enemy, sourceX: number): boolean {
    if (e.dead || isTrapImmune(e)) return false
    if (!chasing(e) && !exposed(e)) return false
    if ((enemyIframe.get(e) ?? 0) > 0) return false
    enemyIframe.set(e, C.TRAP_ENEMY_IFRAME_MS)
    const amount = Math.ceil(e.maxHp * C.TRAP_ENEMY_DAMAGE_FRAC)
    const died = deps.damageEnemy(e, amount, sourceX)
    if (!died) deps.hitReaction(e)
    return true
  }

  /** Тело, способное включить плиту или сталактит: герой — всегда; враг — в погоне или втолкнутый. */
  function triggers(e: Enemy): boolean {
    return !e.dead && !isTrapImmune(e) && (chasing(e) || exposed(e))
  }

  function onCellRow(e: Enemy, cy: number): boolean {
    return Math.abs(e.y + e.height - (cy + 1) * T) < 6
  }

  // --- шипы: состояние по фазе ---
  function spikeExtAt(ms: number): { ext: number; warn: boolean; armed: boolean } {
    const t = ms % C.SPIKE_CYCLE_MS
    if (t < C.SPIKE_HIDDEN_MS) return { ext: 0, warn: false, armed: false }
    const w = t - C.SPIKE_HIDDEN_MS
    if (w < C.SPIKE_WARN_MS) return { ext: C.SPIKE_WARN_PEEK, warn: true, armed: false }
    const e = w - C.SPIKE_WARN_MS
    if (e < C.SPIKE_MOVE_MS) return { ext: C.SPIKE_WARN_PEEK + (1 - C.SPIKE_WARN_PEEK) * (e / C.SPIKE_MOVE_MS), warn: false, armed: true }
    if (e < C.SPIKE_EXTENDED_MS - C.SPIKE_MOVE_MS) return { ext: 1, warn: false, armed: true }
    const r = (e - (C.SPIKE_EXTENDED_MS - C.SPIKE_MOVE_MS)) / C.SPIKE_MOVE_MS
    return { ext: 1 - r, warn: false, armed: false }
  }

  let timeMs = 0

  function update(deltaMS: number): void {
    timeMs += deltaMS
    const dt = deltaMS / 1000
    heroIframeMs = Math.max(0, heroIframeMs - deltaMS)
    for (const [e, ms] of enemyIframe) {
      if (ms - deltaMS <= 0 || e.dead) enemyIframe.delete(e)
      else enemyIframe.set(e, ms - deltaMS)
    }
    const hero = deps.heroBox()
    const body = deps.heroSpikeBody()
    const enemies = deps.enemies.current
    const glintA = deps.reduceMotion ? 0 : deps.glintAlpha(timeMs / 1000)

    // Шипы.
    for (const s of spikes) {
      const st = spikeExtAt(timeMs + s.phaseMs)
      s.ext = st.ext
      s.sprite.y = (1 - st.ext) * bandH + (st.warn && !deps.reduceMotion ? (Math.random() - 0.5) * 2 * C.SPIKE_WARN_JITTER_PX : 0)
      s.sprite.x = st.warn && !deps.reduceMotion ? (Math.random() - 0.5) * 2 * C.SPIKE_WARN_JITTER_PX : 0
      s.sprite.visible = st.ext > 0
      s.slit.visible = st.ext < 0.5
      if (s.glint) {
        s.glint.y = s.sprite.y
        s.glint.alpha = st.ext >= 1 ? glintA : 0
      }
      if (!st.armed) continue
      const cellBottom = (s.cy + 1) * T
      const top = cellBottom - bandH * st.ext
      const x0 = s.cx * T
      // Герой: зубья выдвинуты или выезжают под ним.
      if (body.x < x0 + T && body.x + body.w > x0 && body.top < cellBottom && body.bottom > top) {
        if (heroIframeMs <= 0 && !deps.heroDead()) {
          deps.onHeroSpikeHit()
          hurtHeroFrac(C.SPIKE_DAMAGE_RATIO * deps.spikeMult)
        }
      }
      for (const e of enemies) {
        if (e.x < x0 + T && e.x + e.width > x0 && e.y < cellBottom && e.y + e.height > top) hitEnemy(e, x0 + T / 2)
      }
    }

    // Горгульи.
    const frameMsLen = 1000 / gm.fps
    for (const g of gargoyles) {
      const px0 = g.slot.plate[0] * T
      const plateBox = { x: px0 + 4, y: g.floorY - 8, w: 2 * T - 8, h: 10 }
      if (g.plateMs > 0) {
        g.plateMs = Math.max(0, g.plateMs - deltaMS)
        g.press = Math.min(1, g.press + deltaMS / C.PLATE_PRESS_MS)
      } else {
        g.press = Math.max(0, g.press - deltaMS / C.PLATE_PRESS_MS)
        let pressed = deps.heroOnGround() && !deps.heroDead() && boxesOverlap({ x: hero.x, y: hero.y + hero.h - 4, w: hero.w, h: 6 }, plateBox)
        if (!pressed) {
          for (const e of enemies) {
            if (triggers(e) && onCellRow(e, g.slot.y) && boxesOverlap({ x: e.x, y: e.y + e.height - 4, w: e.width, h: 6 }, plateBox)) { pressed = true; break }
          }
        }
        if (pressed && !g.firing) {
          g.plateMs = C.PLATE_RECHARGE_MS
          g.firing = true
          g.fired = false
          g.frameMs = 0
        }
      }
      g.plateUp.alpha = 1 - g.press
      g.plateDown.alpha = g.press
      if (g.firing) {
        g.frameMs += deltaMS
        const f = Math.floor(g.frameMs / frameMsLen)
        if (f >= gm.frames) {
          g.firing = false
          g.sprite.texture = deps.textures.gargoyleFrames[0]
        } else {
          g.sprite.texture = deps.textures.gargoyleFrames[f]
          if (!g.fired && f >= gm.mouthOpenFrame) {
            g.fired = true
            const mx = g.wallX + g.slot.dir * gm.mouthX * C.GARGOYLE_SCALE
            const my = g.sprite.y + gm.mouthY * C.GARGOYLE_SCALE
            const sp = new Sprite(deps.textures.fireball)
            sp.anchor.set(0.82, 0.55)
            sp.scale.set(C.GARGOYLE_FIREBALL_SCALE * g.slot.dir, C.GARGOYLE_FIREBALL_SCALE)
            sp.x = mx
            sp.y = my
            root.addChild(sp)
            fireballs.push({ sprite: sp, x: mx, y: my, dir: g.slot.dir, travelled: 0, t: 0 })
            puff(mx, my, 6, 0xffb040, 10, 60)
          }
        }
      }
    }

    // Огонь горгульи: летит до стены, бьёт первого на пути.
    for (let i = fireballs.length - 1; i >= 0; i--) {
      const fb = fireballs[i]
      const step = C.GARGOYLE_FIREBALL_SPEED * dt
      fb.x += fb.dir * step
      fb.travelled += step
      fb.t += deltaMS
      const r = C.GARGOYLE_FIREBALL_R
      let gone = fb.travelled > C.GARGOYLE_FIREBALL_MAX_PX || isSolid(deps.grid, T, fb.x + fb.dir * r * 0.5, fb.y)
      const ball = { x: fb.x - r, y: fb.y - r, w: 2 * r, h: 2 * r }
      if (!gone && !deps.heroDead() && boxesOverlap(ball, hero)) {
        // Огонь парируется; отбитый гаснет искрами без урона.
        const parried = deps.hurtHeroParryable(deps.heroMaxHp * C.GARGOYLE_FIRE_DAMAGE_FRAC)
        if (!parried) heroIframeMs = Math.max(heroIframeMs, 200)
        gone = true
      }
      if (!gone) {
        for (const e of enemies) {
          if (e.dead || isTrapImmune(e) || !boxesOverlap(ball, enemyBox(e))) continue
          // Огонь бьёт любого живого врага на пути (он летит, а не лежит), но
          // окно ловушек у врага общее.
          if ((enemyIframe.get(e) ?? 0) <= 0) {
            enemyIframe.set(e, C.TRAP_ENEMY_IFRAME_MS)
            const died = deps.damageEnemy(e, Math.ceil(e.maxHp * C.TRAP_ENEMY_DAMAGE_FRAC), fb.x - fb.dir * T)
            if (!died) deps.hitReaction(e)
          }
          gone = true
          break
        }
      }
      if (gone) {
        puff(fb.x, fb.y, 10, 0xff8a30, 14, 140)
        fb.sprite.destroy()
        fireballs.splice(i, 1)
        continue
      }
      fb.sprite.x = fb.x
      fb.sprite.y = fb.y
      if (!deps.reduceMotion) {
        const k = 1 + 0.08 * Math.sin(fb.t / 35)
        fb.sprite.scale.set(C.GARGOYLE_FIREBALL_SCALE * fb.dir * k, C.GARGOYLE_FIREBALL_SCALE * k)
        fb.sprite.alpha = 0.85 + 0.15 * Math.sin(fb.t / 23)
        if (Math.random() < dt * 30) puff(fb.x - fb.dir * 20, fb.y, 1, 0xffc060, 8, 40)
      }
    }

    // Сталактиты.
    for (const s of stalactites) {
      if (s.state === 'done') continue
      const zone = { x: s.slot.x * T, y: (s.slot.ceil + 1) * T, w: 2 * T, h: (s.slot.y - s.slot.ceil) * T }
      if (s.state === 'idle') {
        let enter = !deps.heroDead() && boxesOverlap(hero, zone)
        if (!enter) for (const e of enemies) if (triggers(e) && boxesOverlap(enemyBox(e), zone)) { enter = true; break }
        if (enter) { s.state = 'shake'; s.ms = 0 }
      } else if (s.state === 'shake') {
        s.ms += deltaMS
        s.sprite.x = s.baseX + (deps.reduceMotion ? 0 : Math.sin(s.ms / 18) * C.STALACTITE_SHAKE_PX)
        if (Math.random() < dt * 25) puff(s.baseX + T * (0.3 + Math.random() * 1.4), zone.y + 2, 1, 0xb8b0a0, 4, -20)
        if (s.ms >= C.STALACTITE_SHAKE_MS) { s.state = 'fall'; s.vy = 0; s.sprite.x = s.baseX }
      } else if (s.state === 'fall') {
        s.vy += C.STALACTITE_GRAVITY * dt
        s.sprite.y += s.vy * dt
        const tipY = s.sprite.y + s.sprite.height * 0.95
        const tip = { x: s.baseX + T * 0.6, y: tipY - 40, w: T * 0.8, h: 40 }
        const floorY = (s.slot.y + 1) * T
        let hit = false
        if (!deps.heroDead() && boxesOverlap(tip, hero)) {
          hurtHeroFrac(C.STALACTITE_DAMAGE_FRAC)
          hit = true
        }
        if (!hit) {
          for (const e of enemies) {
            if (e.dead || isTrapImmune(e) || !boxesOverlap(tip, enemyBox(e))) continue
            // Падающий камень бьёт и того, кто под ним случайно (втолкнут или в
            // погоне); спокойного врага туда не заносит — он считает зону стеной.
            hitEnemy(e, s.baseX + T)
            hit = true
            break
          }
        }
        if (hit || tipY >= floorY) {
          s.state = 'done'
          s.sprite.visible = false
          s.rubble.visible = true
          puff(s.baseX + T, floorY - 4, 14, 0xb8b0a0, 2 * T, 160)
          cells.delete(key(s.slot.x, s.slot.y))
          cells.delete(key(s.slot.x + 1, s.slot.y))
        }
      }
    }

    // Пилы.
    for (const s of saws) {
      s.x += s.dir * C.SAW_SPEED * dt
      if (s.x >= s.maxX) { s.x = s.maxX; s.dir = -1 }
      if (s.x <= s.minX) { s.x = s.minX; s.dir = 1 }
      s.angle += (s.dir * C.SAW_SPEED * dt) / (T / 2)
      s.blade.x = s.x
      s.blade.rotation = s.angle
      const cx = s.x
      const cy = s.floorY - C.SAW_CENTER_ABOVE_FLOOR
      const r = C.SAW_RADIUS
      const touches = (b: { x: number; y: number; w: number; h: number }) => {
        const nx = Math.max(b.x, Math.min(cx, b.x + b.w))
        const ny = Math.max(b.y, Math.min(cy, b.y + b.h))
        return (nx - cx) ** 2 + (ny - cy) ** 2 < r * r
      }
      if (!deps.heroDead() && touches(hero)) hurtHeroFrac(C.SAW_DAMAGE_FRAC)
      for (const e of enemies) if (touches(enemyBox(e))) hitEnemy(e, cx)
    }

    // Пыль и искры.
    for (let i = dust.length - 1; i >= 0; i--) {
      const d = dust[i]
      d.life -= deltaMS
      if (d.life <= 0) { d.g.destroy(); dust.splice(i, 1); continue }
      d.vy += 300 * dt
      d.g.x += d.vx * dt
      d.g.y += d.vy * dt
      d.g.alpha = d.life / d.max
    }
  }

  /**
   * Упирается ли шаг врага в ловушку. leadX — передний край тела после шага,
   * feetY — его ступни. Зовут модули врагов (enemy.ts, ncEnemy.ts, shadow.ts) в
   * том же месте, где проверяют стену и край.
   */
  function blocksStep(e: Enemy, leadX: number, feetY: number): boolean {
    if (isTrapImmune(e) || exposed(e)) return false
    const cx = Math.floor(leadX / T)
    let cy = Math.floor((feetY + 1) / T) - 1
    const chase = chasing(e)
    // Нет пола впереди: спокойный враг не спрыгивает на ловушку сверху.
    if (!chase && !isSolid(deps.grid, T, leadX, (cy + 1) * T + 1)) {
      let y = cy + 1
      while (y < deps.grid.length && !isSolid(deps.grid, T, leadX, (y + 1) * T + 1)) y++
      cy = y
    }
    const c = cells.get(key(cx, cy))
    if (!c) return false
    if (!chase) return true
    if (c.kind === 'spike') return c.s.ext > 0.3
    if (c.kind === 'rail') return Math.abs(c.s.x - leadX) < C.SAW_CHASE_WAIT_PX
    return false
  }

  function dispose(): void {
    for (const fb of fireballs) fb.sprite.destroy()
    fireballs.length = 0
    dust.length = 0
    enemyIframe.clear()
    root.destroy({ children: true })
  }

  /** Для замеров: состояние шипов и ловушек. */
  function debug() {
    return {
      spikes: spikes.map((s) => ({ cx: s.cx, cy: s.cy, ext: s.ext })),
      gargoyles: gargoyles.map((g) => ({ x: g.slot.x, y: g.slot.y, dir: g.slot.dir, plate: g.slot.plate[0], firing: g.firing, plateMs: g.plateMs })),
      fireballs: fireballs.map((f) => ({ x: f.x, y: f.y, dir: f.dir })),
      stalactites: stalactites.map((s) => ({ x: s.slot.x, y: s.slot.y, ceil: s.slot.ceil, state: s.state })),
      saws: saws.map((s) => ({ x0: s.slot.x0, x1: s.slot.x1, y: s.slot.y, bladeX: s.x, dir: s.dir })),
    }
  }

  // Для замеров (автоплейтест находит узел по метке 'traps'): состояние и
  // blocksStep — без хуков в Explore.tsx. В игре никто это поле не читает.
  ;(root as unknown as { trapsProbe: unknown }).trapsProbe = { debug, blocksStep }

  return { update, blocksStep, dispose, debug }
}

export type TrapsSystem = ReturnType<typeof createTrapsSystem>
