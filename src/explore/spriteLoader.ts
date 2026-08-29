import { Assets, Rectangle, Texture } from 'pixi.js'

// Режет спрайт-лист на кадры: cols колонок в ряд, дальше перенос вниз.
// Все кадры анимации хранятся в одном base.source (не отдельные Texture.from
// на кадр) — Pixi может переиспользовать GPU-текстуру между Texture-обрезками.
export async function loadSheetFrames(url: string, frameW: number, frameH: number, count: number, cols = 12): Promise<Texture[]> {
  const base = await Assets.load(url)
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
