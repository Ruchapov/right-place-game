import { Sprite } from 'pixi.js'
import type { Container, Texture } from 'pixi.js'

// ГЛУХАЯ СТЕНА ЗА КРАЕМ КАРТЫ (31.10.2026). В низком горизонтальном экране
// камера останавливается раньше края карты на ширину блоков кнопок (боковые
// поля, measureCameraFields в Explore.tsx) — чтобы у края карты герой не стоял
// под кнопками. Слева и справа от карты стоит стена: две готовые картинки
// (mapArt.walls), собранные tools/build_map_walls.py из тех же частей кладки и
// тем же способом, что сплошные массы этой карты в архиве арта, — как если бы в
// .txt добавили по 12 столбцов «#» во всю высоту. Рисуются как есть: без
// отражения, затемнения и повтора.
//
// История: 30.10.2026 здесь была отражённая крайняя полоса слоя (казалось, что
// там проход); 31.10.2026 утром — вырезанный кусок слоя зеркалом 2×2 с тенью
// шва (виден зеркальный узор, затемнение смотрелось плохо).
//
// Только картинка: коллизий за краем нет (сетка кончается на краю), и герой за
// край не проходит, как и раньше. В вертикали поля нулевые, стены не видно.
export type MapEdgesDeps = {
  worldContainer: Container
  // Стены слева и справа; источники принадлежат Assets.
  wallLeft: Texture
  wallRight: Texture
  mapWidth: number
}

export function createMapEdges(deps: MapEdgesDeps) {
  const left = new Sprite(deps.wallLeft)
  left.x = -deps.wallLeft.width
  left.y = 0
  const right = new Sprite(deps.wallRight)
  right.x = deps.mapWidth
  right.y = 0
  deps.worldContainer.addChild(left, right)

  function dispose() {
    for (const s of [left, right]) if (!s.destroyed) s.destroy()
  }

  return { dispose }
}
