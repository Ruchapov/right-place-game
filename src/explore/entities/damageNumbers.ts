import { Text } from 'pixi.js'
import type { Container } from 'pixi.js'
import * as C from '../constants'

// ЦИФРЫ УРОНА (16.11.2026, docs/explore-engine.md, «Комбо из трёх ударов»).
// Над врагом — настоящий снятый урон удара мечом: обычный — белый 22 px,
// сильный (удар 3 комбо) и крит — жёлтый 30 px с «!». Над героем — красная
// цифра с минусом. Всплывает на DAMAGE_NUMBER_RISE_PX за DAMAGE_NUMBER_MS и
// гаснет, чёрная обводка.
//
// Пул: текст не создаётся на каждый удар — доигравший прячется и ждёт
// следующего. Новые объекты появляются, только если одновременно висит больше
// цифр, чем бывало до сих пор, — и остаются в пуле. Стиль меняется только на
// смене вида цифры (белая / жёлтая / красная).

export type DamageNumberKind = 'normal' | 'big' | 'hero'

type Item = { text: Text; kind: DamageNumberKind | null; msLeft: number; startY: number }

/** 12 345 → «12,3к»; меньше 10 000 — как есть. */
export function formatDamage(n: number): string {
  if (n < 10000) return String(n)
  const k = Math.floor(n / 100) / 10
  return `${String(k).replace('.', ',')}к`
}

export function createDamageNumberSystem(deps: { worldContainer: Container }) {
  const pool: Item[] = []

  function styleFor(item: Item, kind: DamageNumberKind) {
    if (item.kind === kind) return
    item.kind = kind
    const big = kind === 'big'
    const st = item.text.style
    st.fontSize = big ? C.DAMAGE_NUMBER_BIG_SIZE : C.DAMAGE_NUMBER_SIZE
    st.fill = kind === 'hero' ? C.DAMAGE_NUMBER_HERO_COLOR : big ? C.DAMAGE_NUMBER_BIG_COLOR : C.DAMAGE_NUMBER_COLOR
  }

  /** Цифра в мировой точке (x — центр, y — низ надписи на старте). */
  function spawn(x: number, y: number, amount: number, kind: DamageNumberKind) {
    if (!(amount > 0)) return
    let item = pool.find((p) => p.msLeft <= 0)
    if (!item) {
      const text = new Text({
        text: '',
        style: {
          fontFamily: 'Georgia, serif',
          fontWeight: 'bold',
          fontSize: C.DAMAGE_NUMBER_SIZE,
          fill: C.DAMAGE_NUMBER_COLOR,
          stroke: { color: 0x000000, width: 4 },
        },
      })
      text.anchor.set(0.5, 1)
      text.visible = false
      deps.worldContainer.addChild(text)
      item = { text, kind: null, msLeft: 0, startY: 0 }
      pool.push(item)
    }
    styleFor(item, kind)
    const s = formatDamage(Math.round(amount))
    item.text.text = kind === 'hero' ? `-${s}` : kind === 'big' ? `${s}!` : s
    item.text.x = x
    item.text.y = y
    item.text.alpha = 1
    item.text.visible = true
    // Поверх всего мира: последним ребёнком.
    deps.worldContainer.addChild(item.text)
    item.startY = y
    item.msLeft = C.DAMAGE_NUMBER_MS
  }

  function update(deltaMS: number) {
    for (const p of pool) {
      if (p.msLeft <= 0) continue
      p.msLeft = Math.max(0, p.msLeft - deltaMS)
      const t = 1 - p.msLeft / C.DAMAGE_NUMBER_MS
      // Подъём с замедлением к концу; гаснет вторую половину пути.
      p.text.y = p.startY - C.DAMAGE_NUMBER_RISE_PX * (1 - (1 - t) * (1 - t))
      p.text.alpha = t < 0.5 ? 1 : 1 - (t - 0.5) / 0.5
      if (p.msLeft <= 0) p.text.visible = false
    }
  }

  function dispose() {
    for (const p of pool) {
      deps.worldContainer.removeChild(p.text)
      p.text.destroy()
    }
    pool.length = 0
  }

  return { spawn, update, dispose }
}
