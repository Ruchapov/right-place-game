import { Sprite, Texture, TilingSprite } from 'pixi.js'
import type { Container } from 'pixi.js'
import * as C from '../constants'

// ГЛУХАЯ СТЕНА ЗА КРАЕМ КАРТЫ (31.10.2026). В низком горизонтальном экране
// камера останавливается раньше края карты на ширину блоков кнопок (боковые
// поля, measureCameraFields в Explore.tsx) — чтобы у края карты герой не стоял
// под кнопками. Поле за краем заливается сплошной кладкой этой же карты: плитка
// камня, вырезанная из толщи её стен (tools/build_map_walls.py, файл —
// mapArt.wall), повторённая по всему полю от верха до низа экрана, чуть
// темнее карты. На самом шве — тень шириной MAP_EDGE_SEAM_PX: самая тёмная у
// края карты, она показывает, что стена начинается ровно там, где герой
// упирается.
//
// До 31.10.2026 здесь была отражённая крайняя полоса слоя карты: на телефоне
// коридор, пол и колонны продолжались, и казалось, что там проход.
//
// Только картинка: коллизий за краем нет (сетка кончается на краю), и герой за
// край не проходит, как и раньше. В вертикали поля нулевые, стены не видно.
export type MapEdgesDeps = {
  worldContainer: Container
  // Плитка стены (бесшовная, зеркало 2×2); источник принадлежит Assets.
  wall: Texture
  mapWidth: number
  mapHeight: number
}

export function createMapEdges(deps: MapEdgesDeps) {
  const sprites: (Sprite | TilingSprite)[] = []

  // Тень шва: горизонтальный градиент, плотный у края карты, прозрачный дальше.
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 1
  const ctx = canvas.getContext('2d')!
  const grad = ctx.createLinearGradient(0, 0, 256, 0)
  const c = C.MAP_EDGE_SHADE_COLOR
  grad.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${C.MAP_EDGE_SHADE_NEAR})`)
  grad.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 256, 1)
  const shade = Texture.from(canvas)

  // По высоте — с запасом в высоту карты сверху и снизу: какой бы кусок мира ни
  // показала камера рядом с краем, в поле нет просвета фона.
  const top = -deps.mapHeight
  const height = deps.mapHeight * 3
  const w = C.MAP_EDGE_EXTEND_PX

  function side(dir: -1 | 1) {
    const x0 = dir < 0 ? -w : deps.mapWidth
    const wall = new TilingSprite({ texture: deps.wall, width: w, height })
    wall.x = x0
    wall.y = top
    // Узор привязан к шву: от края карты плитка начинается целой.
    wall.tilePosition.x = dir < 0 ? w % deps.wall.width : 0
    wall.tilePosition.y = -top % deps.wall.height
    wall.tint = C.MAP_EDGE_WALL_TINT
    deps.worldContainer.addChild(wall)
    sprites.push(wall)
    const dark = new Sprite(shade)
    dark.width = C.MAP_EDGE_SEAM_PX
    dark.height = height
    // У левой стены градиент отражён: плотный край — справа, у шва.
    if (dir < 0) { dark.scale.x = -Math.abs(dark.scale.x); dark.x = 0 } else dark.x = deps.mapWidth
    dark.y = top
    deps.worldContainer.addChild(dark)
    sprites.push(dark)
  }
  side(-1)
  side(1)

  function dispose() {
    for (const s of sprites) if (!s.destroyed) s.destroy()
    sprites.length = 0
    // Градиент — свой целиком; плитка стены — Assets, её не трогаем.
    shade.destroy(true)
  }

  return { dispose }
}
