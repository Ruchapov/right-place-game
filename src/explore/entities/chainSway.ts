import { Container, Sprite, type Texture } from 'pixi.js'
import * as C from '../constants'

// ЦЕПЬ-МАЯТНИК (12.11.2026, задание shaders_task/task-freeze-candles.md, эталон —
// decor_preview.mp4). Цепь висит на кольце: спрайт поворачивается вокруг центра
// верхнего кольца (anchor), просто rotation, без фильтров:
//   • всегда — тихое покачивание CHAIN_IDLE_AMP·sin(t·CHAIN_IDLE_FREQ);
//   • герой пробегает или делает рывок ближе CHAIN_PUSH_RADIUS по x — толчок
//     угловой скорости в сторону его движения;
//   • физика acc = −STIFF·sin(ang) − DAMP·vel, сама затухает за 2–3 с, не больше ±15°.
//
// ⚠️ На картах игры на 12.11.2026 висячих цепей НЕТ: у шести новых карт A–F и болота
// декор без цепей (в литейной — лежачие floor-chain, они не качаются). Цепь рисуется
// отдельным спрайтом, а НЕ из слоя карты (public/assets/decor/chain.webp — decor_chain.png
// кладбищенского набора, 73×288, кольцо сверху): чтобы повесить цепь, достаточно точки
// подвеса в CHAINS ниже — Explore.tsx загрузит лист и создаст систему сам.

export type ChainItem = {
  texture: Texture
  /** Точка подвеса (центр верхнего кольца), мировые px. */
  x: number
  y: number
  /** Мировой размер спрайта. */
  w: number
  h: number
  /** Подвес в долях текстуры (центр кольца). */
  pivotU: number
  pivotV: number
}

/** Висячие цепи по картам (имя .txt → точки). Пусто: на картах их нет (см. выше). */
export const CHAINS: Record<string, Omit<ChainItem, 'texture'>[]> = {}
/** Лист цепи (подвес — центр верхнего кольца, pivotU 0.5, pivotV 0.075 — замер по картинке). */
export const CHAIN_TEXTURE = 'assets/decor/chain.webp'

type Entry = { sprite: Sprite; ang: number; vel: number; phase: number }

export function createChainSwaySystem(parent: Container, items: ChainItem[]) {
  const entries: Entry[] = items.map((it) => {
    const s = new Sprite(it.texture)
    s.anchor.set(it.pivotU, it.pivotV)
    s.x = it.x
    s.y = it.y
    s.width = it.w
    s.height = it.h
    parent.addChild(s)
    return { sprite: s, ang: 0, vel: 0, phase: Math.random() * Math.PI * 2 }
  })
  let timeS = 0

  /** hero — центр героя и его скорость по x (px/с); dashing — идёт рывок. */
  function update(deltaMS: number, hero: { x: number; y: number; vx: number; dashing: boolean }, left: number, right: number) {
    const dt = Math.min(deltaMS, 50) / 1000
    timeS += dt
    for (const e of entries) {
      const s = e.sprite
      const near = Math.abs(hero.x - s.x) < C.CHAIN_PUSH_RADIUS && hero.y > s.y && hero.y < s.y + s.height + 40
      if (near && (hero.dashing || Math.abs(hero.vx) > 30)) {
        const push = (hero.dashing ? 2 : 1) * C.CHAIN_PUSH_VEL * Math.sign(hero.vx || 1)
        if (Math.abs(e.vel) < Math.abs(push)) e.vel = push
      }
      const acc = -C.CHAIN_STIFF * Math.sin(e.ang) - C.CHAIN_DAMP * e.vel
      e.vel += acc * dt
      e.ang = Math.max(-C.CHAIN_MAX_ANGLE, Math.min(C.CHAIN_MAX_ANGLE, e.ang + e.vel * dt))
      s.visible = s.x + s.height >= left && s.x - s.height <= right
      if (s.visible) s.rotation = e.ang + C.CHAIN_IDLE_AMP * Math.sin(timeS * C.CHAIN_IDLE_FREQ + e.phase)
    }
  }

  function dispose() {
    for (const e of entries) if (!e.sprite.destroyed) e.sprite.destroy()
    entries.length = 0
  }

  return { update, dispose }
}
