import { AnimatedSprite } from 'pixi.js'
import type { Container, Texture } from 'pixi.js'
import * as C from '../constants'

// Звёздоцвет (Мастер, docs/crafter.md, решено 26.10.2026): цветок на карте,
// которого в забеге может и не быть. Есть ли он и где растёт, решает сервер на
// старте (0,5% с 5 уровня, клетка из reward-слотов, не занятая событием) — здесь
// только картинка и удар. Срубается одним взмахом меча: играет анимация
// «срубили», над цветком всплывает пыльца, и факт уходит в финиш
// (starbloomCut), где сервер кладёт Звёздную пыльцу в добычу.
export type StarbloomDeps = {
  worldContainer: Container
  idle: Texture[]
  cut: Texture[]
  /** Клетка карты [x, y] из ответа старта. */
  tile: [number, number]
  findGroundSurfaceY: (left: number, width: number, footGuess: number) => number | null
  /** Цветок срублен: точка над ним, мировые координаты. */
  onCut: (x: number, y: number) => void
}

export function createStarbloomSystem(deps: StarbloomDeps) {
  const [tileX, tileY] = deps.tile
  const centerX = tileX * C.TILE_SIZE + C.TILE_SIZE / 2
  const footGuess = (tileY + 1) * C.TILE_SIZE
  const floorY = deps.findGroundSurfaceY(centerX - C.STARBLOOM_HITBOX_W / 2, C.STARBLOOM_HITBOX_W, footGuess) ?? footGuess
  // Один масштаб на оба листа: клетки по высоте почти равны (225 и 227), и
  // цветок не должен прыгать в размере на переключении.
  const scale = C.STARBLOOM_DRAW_H / C.STARBLOOM_IDLE_CELL_H

  const sprite = new AnimatedSprite(deps.idle)
  sprite.anchor.set(C.STARBLOOM_IDLE_ANCHOR_X, 1)
  sprite.scale.set(scale)
  sprite.x = centerX
  sprite.y = floorY
  sprite.loop = true
  sprite.animationSpeed = C.STARBLOOM_ANIM_SPEED
  sprite.play()
  deps.worldContainer.addChild(sprite)

  const hitbox = { x: centerX - C.STARBLOOM_HITBOX_W / 2, y: floorY - C.STARBLOOM_DRAW_H, width: C.STARBLOOM_HITBOX_W, height: C.STARBLOOM_DRAW_H }
  let cut = false

  /** Взмах меча с этим хитбоксом. true — цветок срублен именно сейчас. */
  function strike(hb: { x: number; y: number; width: number; height: number }): boolean {
    if (cut) return false
    const overlap = hb.x < hitbox.x + hitbox.width && hb.x + hb.width > hitbox.x && hb.y < hitbox.y + hitbox.height && hb.y + hb.height > hitbox.y
    if (!overlap) return false
    cut = true
    sprite.textures = deps.cut
    sprite.anchor.set(C.STARBLOOM_CUT_ANCHOR_X, 1)
    sprite.loop = false
    sprite.animationSpeed = C.STARBLOOM_ANIM_SPEED
    // Доиграла — стоит на последнем кадре (срубленный стебель).
    sprite.onComplete = () => sprite.gotoAndStop(deps.cut.length - 1)
    sprite.gotoAndPlay(0)
    deps.onCut(centerX, floorY - C.STARBLOOM_DRAW_H)
    return true
  }

  function dispose() {
    sprite.destroy()
  }

  return { strike, dispose, isCut: () => cut }
}
