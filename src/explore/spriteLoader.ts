import { Assets, Rectangle, Texture } from 'pixi.js'
import { HALF_RES_SHEETS } from './halfResSheets'

/**
 * Лист, уменьшенный вдвое (13.11.2026, листы боссов): файл на диске вдвое
 * меньше по стороне, а координаты в коде — по-прежнему в пикселях ИСХОДНОГО
 * листа. Источнику ставится resolution 0.5 и исходный логический размер
 * (HALF_RES_SHEETS): нарезка, якоря, точки и масштаб отрисовки не меняются,
 * видеопамяти — вчетверо меньше. Повторный вызов на том же источнике (кэш
 * Assets) ничего не меняет.
 */
export function applyHalfRes(url: string, texture: Texture): void {
  const key = Object.keys(HALF_RES_SHEETS).find((k) => url.endsWith('/' + k))
  if (key === undefined) return
  const [w, h] = HALF_RES_SHEETS[key]
  const source = texture.source
  if (source.resolution !== 0.5) source.resolution = 0.5
  // Нечётный исходный размер: половина округлена вверх — логический размер
  // ставится ровно исходный (UV = кадр / логический размер).
  source.width = w
  source.height = h
}

// Режет спрайт-лист на кадры: cols колонок в ряд, дальше перенос вниз.
// Все кадры анимации хранятся в одном base.source (не отдельные Texture.from
// на кадр) — Pixi может переиспользовать GPU-текстуру между Texture-обрезками.
export async function loadSheetFrames(url: string, frameW: number, frameH: number, count: number, cols = 12): Promise<Texture[]> {
  const base = await Assets.load(url)
  applyHalfRes(url, base)
  base.source.scaleMode = 'linear' // сглаженное масштабирование — герой сильно уменьшается с 512px, 'nearest' даёт дрожащие края
  const frames: Texture[] = []
  for (let i = 0; i < count; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    frames.push(new Texture({
      source: base.source,
      frame: new Rectangle(col * frameW, row * frameH, frameW, frameH),
    }))
  }
  return frames
}
