import { type Container, Graphics, Sprite } from 'pixi.js'
import * as C from '../constants'
import type { Chest } from '../types'

// БЛИК НА СУНДУКАХ (12.11.2026, задание shaders_task/task-freeze-candles.md, эталон —
// decor_preview.mp4, «блик на кольце» — колец на земле нет, блик на сундуках).
// Раз в CHEST_GLINT_PERIOD_MS по закрытому сундуку проходит диагональная светлая
// полоса (CHEST_GLINT_SWEEP_MS) только по его непрозрачным пикселям, в конце — звёздочка
// в верхнем углу. Без фильтров: копия кадра сундука с blendMode 'add' под маской-полосой
// (маска есть только пока полоса идёт). У каждого сундука свой сдвиг по времени.
// Открытый и открывающийся сундук блика не даёт; мимик блестит так же, как обычный
// (иначе его было бы видно до удара — Critical Gotchas, «Мимика решает СЕРВЕР»).

type Entry = { chest: Chest; copy: Sprite; band: Graphics; star: Graphics; offset: number }

export function createChestGlintSystem(chests: Chest[]) {
  const entries: Entry[] = []
  let timeMs = 0

  function ensure(chest: Chest, k: number): Entry | null {
    const parent = chest.sprite.parent as Container | null
    if (!parent) return null
    const copy = new Sprite(chest.sprite.texture)
    copy.blendMode = 'add'
    copy.alpha = C.CHEST_GLINT_ALPHA
    copy.visible = false
    // Маска: сама не рисуется (Pixi v8 исключает её из отрисовки), visible не трогаем.
    const band = new Graphics()
    const star = new Graphics()
    const s = C.CHEST_GLINT_STAR_SIZE
    star.poly([0, -s, s * 0.18, -s * 0.18, s, 0, s * 0.18, s * 0.18, 0, s, -s * 0.18, s * 0.18, -s, 0, -s * 0.18, -s * 0.18]).fill({ color: 0xffffff })
    star.circle(0, 0, s * 0.22).fill({ color: 0xfff4c8 })
    star.blendMode = 'add'
    star.visible = false
    const at = parent.getChildIndex(chest.sprite) + 1
    parent.addChildAt(copy, at)
    parent.addChild(band)
    parent.addChild(star)
    copy.mask = band
    const e = { chest, copy, band, star, offset: (k * 977) % C.CHEST_GLINT_PERIOD_MS }
    entries.push(e)
    return e
  }

  function update(deltaMS: number, left: number, right: number) {
    timeMs += deltaMS
    chests.forEach((chest, k) => {
      let e = entries.find((x) => x.chest === chest)
      if (!e) {
        if (chest.opened || chest.opening) return
        e = ensure(chest, k) ?? undefined
        if (!e) return
      }
      const sp = chest.sprite
      const off = chest.opened || chest.opening || sp.destroyed || !sp.visible || sp.x < left - 100 || sp.x > right + 100
      const t = (timeMs + e.offset) % C.CHEST_GLINT_PERIOD_MS
      const sweep = t < C.CHEST_GLINT_SWEEP_MS
      e.copy.visible = !off && sweep
      if (e.copy.visible) {
        e.copy.texture = sp.texture
        e.copy.anchor.copyFrom(sp.anchor)
        e.copy.position.copyFrom(sp.position)
        e.copy.scale.copyFrom(sp.scale)
        // полоса — параллелограмм наискось, едет слева направо через рамку сундука
        const w = Math.abs(sp.width), h = Math.abs(sp.height)
        const x0 = sp.x - sp.anchor.x * w, y0 = sp.y - sp.anchor.y * h
        const bw = w * C.CHEST_GLINT_BAND
        const p = t / C.CHEST_GLINT_SWEEP_MS
        const cx = x0 - bw - h * 0.5 + p * (w + 2 * bw + h)
        e.band.clear().poly([cx, y0, cx + bw, y0, cx + bw - h * 0.6, y0 + h, cx - h * 0.6, y0 + h]).fill({ color: 0xffffff })
      }
      // звёздочка — в конце прохода, в правом верхнем углу
      const starT = t - C.CHEST_GLINT_SWEEP_MS * 0.8
      const starOn = !off && starT >= 0 && starT < C.CHEST_GLINT_STAR_MS
      e.star.visible = starOn
      if (starOn) {
        const w = Math.abs(sp.width), h = Math.abs(sp.height)
        e.star.x = sp.x - sp.anchor.x * w + w * 0.82
        e.star.y = sp.y - sp.anchor.y * h + h * 0.12
        const q = starT / C.CHEST_GLINT_STAR_MS
        e.star.scale.set(Math.sin(q * Math.PI))
        e.star.rotation = q * 1.2
        e.star.alpha = 0.9
      }
    })
  }

  function dispose() {
    for (const e of entries) {
      for (const d of [e.copy, e.band, e.star]) if (!d.destroyed) d.destroy()
    }
    entries.length = 0
  }

  return { update, dispose }
}
