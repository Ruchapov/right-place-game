import { Graphics } from 'pixi.js'
import type { Container } from 'pixi.js'

// Клуб дыма (11.11.2026): серые частицы расходятся и гаснут. Им гаснет огонёк
// Носителя огня (над головой героя) и исчезает непойманный Беглец.
// Частицы — заранее созданный пул кружков; в тикере только числа, без аллокаций.

const POOL = 32

type Puff = { g: Graphics; vx: number; vy: number; lifeMs: number; maxMs: number; r: number }

export function createSmokePuffSystem(deps: { parent: Container }) {
  const puffs: Puff[] = []
  for (let i = 0; i < POOL; i++) {
    const g = new Graphics().circle(0, 0, 10).fill({ color: 0x8a8590 })
    g.visible = false
    deps.parent.addChild(g)
    puffs.push({ g, vx: 0, vy: 0, lifeMs: 0, maxMs: 1, r: 1 })
  }

  /** count частиц из точки (x, y) мира, живут ms; spread — разлёт, px. */
  function spawn(x: number, y: number, count: number, ms: number, spread: number) {
    let left = count
    for (const p of puffs) {
      if (left === 0) break
      if (p.lifeMs > 0) continue
      left--
      const a = Math.random() * Math.PI * 2
      const speed = (0.4 + Math.random() * 0.6) * spread / (ms / 1000)
      p.vx = Math.cos(a) * speed
      p.vy = Math.sin(a) * speed * 0.6 - spread * 0.8 / (ms / 1000)
      p.lifeMs = ms * (0.75 + Math.random() * 0.25)
      p.maxMs = p.lifeMs
      p.r = spread * (0.22 + Math.random() * 0.18) / 10
      p.g.position.set(x + (Math.random() - 0.5) * spread * 0.3, y + (Math.random() - 0.5) * spread * 0.3)
      p.g.visible = true
    }
  }

  function update(deltaMS: number) {
    const dt = deltaMS / 1000
    for (const p of puffs) {
      if (p.lifeMs <= 0) continue
      p.lifeMs -= deltaMS
      if (p.lifeMs <= 0) {
        p.g.visible = false
        continue
      }
      const k = p.lifeMs / p.maxMs
      p.g.x += p.vx * dt
      p.g.y += p.vy * dt
      p.g.scale.set(p.r * (1.6 - 0.6 * k))
      p.g.alpha = 0.7 * k
    }
  }

  function dispose() {
    for (const p of puffs) if (!p.g.destroyed) p.g.destroy()
    puffs.length = 0
  }

  return { spawn, update, dispose }
}
