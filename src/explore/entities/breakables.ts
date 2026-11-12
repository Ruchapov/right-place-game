import { AnimatedSprite } from 'pixi.js'
import type { Container, Texture } from 'pixi.js'
import * as C from '../constants'
import { BREAKABLE_HITS, type BreakableKind, type RunBreakable } from '../../breakables'

// Бочки и кувшины (12.11.2026, docs/explore-features.md). Где стоят, что внутри
// и сколько их — решил сервер на старте (общий каталог breakables.ts); здесь
// только картинка и удары. Бьются только мечом, как Звёздоцвет: кувшин с одного
// взмаха (покой → разлёт), бочка с двух (покой → удар → стоит треснувшая;
// второй взмах → разлёт). Кучка обломков лежит до конца забега и ничему не
// мешает — у предметов нет столкновений. Что выпало, показывает вызывающий
// (onBreak): всплывашка, мана, здоровье, индекс в финиш.
export type BreakableAssets = {
  barrelIdle: Texture[]
  barrelHit: Texture[]
  barrelCracked: Texture[]
  barrelBreak: Texture[]
  jarIdle: Texture[]
  jarBreak: Texture[]
}

export type BreakablesDeps = {
  worldContainer: Container
  assets: BreakableAssets
  /** Предметы из ответа старта; null — кривая запись, не рисуется (индексы прочих те же). */
  items: (RunBreakable | null)[]
  findGroundSurfaceY: (left: number, width: number, footGuess: number) => number | null
  /** Предмет разбит: его индекс и точка над ним, мировые координаты. */
  onBreak: (index: number, x: number, y: number) => void
}

type Box = { x: number; y: number; width: number; height: number }

type Piece = {
  index: number
  kind: BreakableKind
  sprite: AnimatedSprite
  hitbox: Box
  hits: number
  lastSwing: number
  broken: boolean
  centerX: number
  topY: number
}

export function createBreakablesSystem(deps: BreakablesDeps) {
  const { assets } = deps
  const pieces: Piece[] = []

  deps.items.forEach((item, index) => {
    if (item === null) return
    const isBarrel = item.kind === 'barrel'
    const drawH = isBarrel ? C.BARREL_DRAW_H : C.JAR_DRAW_H
    const hitW = isBarrel ? C.BARREL_HITBOX_W : C.JAR_HITBOX_W
    const centerX = item.x * C.TILE_SIZE + C.TILE_SIZE / 2
    const footGuess = (item.y + 1) * C.TILE_SIZE
    const floorY = deps.findGroundSurfaceY(centerX - hitW / 2, hitW, footGuess) ?? footGuess
    // Один масштаб на все листы предмета: кадр у всех один, 305×165.
    const scale = drawH / C.BREAKABLE_ART_H
    const sprite = new AnimatedSprite(isBarrel ? assets.barrelIdle : assets.jarIdle)
    sprite.anchor.set((isBarrel ? C.BARREL_CENTER_X : C.JAR_CENTER_X) / C.BREAKABLE_CELL_W, C.BREAKABLE_FLOOR_Y / C.BREAKABLE_CELL_H)
    sprite.scale.set(scale)
    sprite.x = centerX
    sprite.y = floorY
    sprite.loop = false
    sprite.animationSpeed = C.BREAKABLE_ANIM_SPEED
    sprite.gotoAndStop(0)
    deps.worldContainer.addChild(sprite)
    pieces.push({
      index,
      kind: item.kind,
      sprite,
      hitbox: { x: centerX - hitW / 2, y: floorY - drawH, width: hitW, height: drawH },
      hits: 0,
      lastSwing: -1,
      broken: false,
      centerX,
      topY: floorY - drawH,
    })
  })

  // Лист один раз, без повтора; доиграл — стоит на последнем кадре (then —
  // что поставить потом: у бочки после удара — треснувшая).
  function playOnce(sprite: AnimatedSprite, frames: Texture[], then?: Texture[]) {
    sprite.textures = frames
    sprite.loop = false
    sprite.animationSpeed = C.BREAKABLE_ANIM_SPEED
    sprite.onComplete = () => {
      if (then) {
        sprite.textures = then
        sprite.gotoAndStop(0)
      } else {
        sprite.gotoAndStop(frames.length - 1)
      }
    }
    sprite.gotoAndPlay(0)
  }

  /**
   * Взмах меча с этим хитбоксом. Один взмах — один удар по каждому предмету
   * (swingId — номер взмаха, как у врагов): хитбокс живёт несколько кадров.
   */
  function strike(hb: Box, swingId: number) {
    for (const p of pieces) {
      if (p.broken || p.lastSwing === swingId) continue
      const h = p.hitbox
      const overlap = hb.x < h.x + h.width && hb.x + hb.width > h.x && hb.y < h.y + h.height && hb.y + hb.height > h.y
      if (!overlap) continue
      p.lastSwing = swingId
      p.hits += 1
      if (p.hits >= BREAKABLE_HITS[p.kind]) {
        p.broken = true
        playOnce(p.sprite, p.kind === 'barrel' ? assets.barrelBreak : assets.jarBreak)
        deps.onBreak(p.index, p.centerX, p.topY)
      } else {
        playOnce(p.sprite, assets.barrelHit, assets.barrelCracked)
      }
    }
  }

  function dispose() {
    for (const p of pieces) p.sprite.destroy()
    pieces.length = 0
  }

  return { strike, dispose }
}
