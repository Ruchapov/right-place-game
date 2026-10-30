import { Rectangle, Sprite, Texture } from 'pixi.js'
import type { Container } from 'pixi.js'
import * as C from '../constants'

// ПРОДОЛЖЕНИЕ КАРТЫ ЗА КРАЕМ (30.10.2026). В низком горизонтальном экране
// камера останавливается раньше края карты на ширину блоков кнопок (боковые
// поля, measureCameraFields в Explore.tsx) — чтобы у края карты герой не стоял
// под кнопками. В поле за краем раньше был виден только фон. Теперь там
// крайняя полоса готового слоя карты, отражённая у края (пол и стены
// продолжаются), и затемнение, растущее к краю экрана.
//
// Только картинка: коллизий за краем нет (сетка кончается на краю), и герой за
// край не проходит, как и раньше. Текстуры не копируются — отражение берёт
// рамку (frame) той же текстуры слоя; своя у модуля только текстура градиента.
// В вертикали поля нулевые, и полос не видно вовсе.
export type MapEdgesDeps = {
  worldContainer: Container
  // Части готового слоя слева направо (mapArt.slices) и их текстуры.
  slices: { x: number; width: number }[]
  textures: Texture[]
  mapWidth: number
  mapHeight: number
}

export function createMapEdges(deps: MapEdgesDeps) {
  const owned: Texture[] = []
  const sprites: Sprite[] = []

  // Затемнение: горизонтальный градиент, прозрачный у края карты и почти
  // сплошной у дальнего края полосы.
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 1
  const ctx = canvas.getContext('2d')!
  const grad = ctx.createLinearGradient(0, 0, 256, 0)
  const c = C.MAP_EDGE_SHADE_COLOR
  grad.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${C.MAP_EDGE_SHADE_NEAR})`)
  grad.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},${C.MAP_EDGE_SHADE_FAR})`)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 256, 1)
  const shade = Texture.from(canvas)
  owned.push(shade)

  function side(dir: -1 | 1) {
    const i = dir < 0 ? 0 : deps.textures.length - 1
    const tex = deps.textures[i]
    const slice = deps.slices[i]
    const w = Math.min(C.MAP_EDGE_EXTEND_PX, slice.width)
    // Крайняя полоса слоя: у левого края — первые w px, у правого — последние.
    const frame = new Rectangle(dir < 0 ? 0 : slice.width - w, 0, w, deps.mapHeight)
    const strip = new Texture({ source: tex.source, frame })
    owned.push(strip)
    // Отражение у края: scale.x = −1, спрайт рисуется влево от своего x.
    const mirror = new Sprite(strip)
    mirror.scale.x = -1
    mirror.x = dir < 0 ? 0 : deps.mapWidth + w
    mirror.y = 0
    deps.worldContainer.addChild(mirror)
    sprites.push(mirror)
    // Затемнение над полосой: растёт от края карты наружу.
    const dark = new Sprite(shade)
    dark.width = w
    dark.height = deps.mapHeight
    if (dir < 0) { dark.scale.x = -Math.abs(dark.scale.x); dark.x = 0 } else dark.x = deps.mapWidth
    dark.y = 0
    deps.worldContainer.addChild(dark)
    sprites.push(dark)
  }
  side(-1)
  side(1)

  function dispose() {
    for (const s of sprites) if (!s.destroyed) s.destroy()
    sprites.length = 0
    // Рамки — без источника (источник принадлежит слою карты); градиент — свой целиком.
    for (const t of owned) t.destroy(t === shade)
    owned.length = 0
  }

  return { dispose }
}
