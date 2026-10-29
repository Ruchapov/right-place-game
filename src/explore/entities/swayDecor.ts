import { Container, MeshPlane, Sprite, Texture } from 'pixi.js'
import * as C from '../constants'
import { windAt } from './atmosphere'

// КАЧАЮЩИЙСЯ ДЕКОР (29.10.2026): камыш и осока болота (B2, C2).
//
// Формула — мувера «grass» одобренного образца four-theme-atmosphere-v2 (числа —
// SWAY_* в constants.ts, сила — sway темы): волна
//   wave = sin(t·1.35 + фаза)·0.28 + ветер·0.72,
// строка стебля на высоте y (0 — макушка, h — корень) сдвигается вбок на
//   wave · sway · (1 − y/h)^1.8.
// Корень (нижняя точка) стоит, макушка ходит сильнее всего. Ветер — тот же
// windAt, что сносит частицы атмосферы, и часы те же: старт с ATMO_START_TIME_S,
// шаг не длиннее ATMO_MAX_DT_S. Фаза у каждого экземпляра своя (манифест слоя),
// у одинаковых стеблей B2 и C2 они чуть разные.
//
// Стебли вынуты из готового слоя карты (их контактные тени в слое остались) —
// поэтому эта система рисует их ВСЕГДА, даже когда атмосферы нет:
// - animate: true — сетка MeshPlane в SWAY_ROWS строк, в тике сдвигаются вершины;
// - animate: false (без WebGL или при «уменьшении движения») — обычный спрайт
//   в покое, на своём месте. Запасной рендерер Canvas2D сетки не рисует.
// Узел кладётся в контейнер мира ПОВЕРХ слоя карты и ПОД шипы — как декор лежал
// в слое. Шаг — только из тикера Explore.tsx; своего requestAnimationFrame нет.
// Текстуры стеблей — СВОИ, не из кэша Assets (loadSwayTextures): их уничтожает
// Explore.tsx в cleanup, и следующий setup() (смена карты) грузит новые. Через
// общий кэш выгрузка старого забега могла бы уничтожить текстуру, которую уже
// взял новый. dispose снимает только узлы.

/** Свои текстуры стеблей по адресам; промах загрузки — ошибка (стеблей нет в слое). */
export async function loadSwayTextures(srcs: string[]): Promise<Map<string, Texture>> {
  const out = new Map<string, Texture>()
  await Promise.all([...new Set(srcs)].map(async (src) => {
    const res = await fetch(src)
    if (!res.ok) throw new Error(`Стебель болота не загрузился: ${src} — ${res.status}`)
    out.set(src, Texture.from(await createImageBitmap(await res.blob())))
  }))
  return out
}

export type SwayDecorItem = { texture: Texture; x: number; y: number; w: number; h: number; phase: number }

export type SwayDecorDeps = {
  parent: Container
  items: SwayDecorItem[]
  /** Сила раскачивания темы (ATMOSPHERE[тема].sway). */
  sway: number
  animate: boolean
}

type Bending = { mesh: MeshPlane; item: SwayDecorItem; base: Float32Array }

export function createSwayDecorSystem(deps: SwayDecorDeps) {
  const root = new Container()
  root.label = 'sway-decor'
  deps.parent.addChild(root)

  const rows = C.SWAY_ROWS
  // Доля сдвига строки r (0 — макушка): (1 − y/h)^1.8 — одна на все стебли.
  const flex = new Float32Array(rows + 1)
  for (let r = 0; r <= rows; r++) flex[r] = Math.pow(1 - r / rows, C.SWAY_FLEX_POW)

  const bending: Bending[] = []
  for (const item of deps.items) {
    if (!deps.animate) {
      const s = new Sprite(item.texture)
      s.position.set(item.x, item.y)
      root.addChild(s)
      continue
    }
    const mesh = new MeshPlane({ texture: item.texture, verticesX: 2, verticesY: rows + 1 })
    mesh.position.set(item.x, item.y)
    root.addChild(mesh)
    bending.push({ mesh, item, base: new Float32Array(mesh.geometry.positions) })
  }

  let time = C.ATMO_START_TIME_S

  function update(deltaMS: number) {
    if (bending.length === 0) return
    time += Math.min(C.ATMO_MAX_DT_S, Math.max(0, deltaMS) / 1000)
    const wind = windAt(time)
    for (const b of bending) {
      const wave = Math.sin(time * C.SWAY_WAVE_FREQ + b.item.phase) * C.SWAY_WAVE_OSC + wind * C.SWAY_WAVE_WIND
      const amp = wave * deps.sway
      const pos = b.mesh.geometry.positions
      // Вершины строки r — по две (левая и правая): индексы 4r и 4r + 2 по x.
      for (let r = 0; r <= rows; r++) {
        const dx = amp * flex[r]
        pos[4 * r] = b.base[4 * r] + dx
        pos[4 * r + 2] = b.base[4 * r + 2] + dx
      }
      b.mesh.geometry.getBuffer('aPosition').update()
    }
  }

  function dispose() {
    root.destroy({ children: true })
  }

  return { update, dispose }
}
