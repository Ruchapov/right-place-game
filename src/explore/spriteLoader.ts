import { Assets, Rectangle, Texture } from 'pixi.js'
import type { SheetRes } from './sheetRes'

// ЗАГРУЗКА КАРТИНОК ЗАБЕГА — ТОЛЬКО ЧЕРЕЗ loadTexture / loadSheetFrames (16.11.2026,
// docs/explore-engine.md, «Видеопамять забега»). Две вещи, которые голый
// Assets.load не делает:
//
// 1. Лист по размеру экрана (манифест sheetRes.ts, tools/make_sprite_res.mjs):
//    файл на диске уменьшен в res раз по стороне, а координаты в коде — в
//    пикселях ИСХОДНОГО листа. Источнику ставится resolution = res и исходный
//    логический размер; у упакованных листов кадры режутся по раскладке
//    манифеста (frame + orig + trim): спрайт ведёт себя как с полной клеткой —
//    якорь, размер, texture.width прежние, а пустого воздуха в видеопамяти нет.
//    Голый Assets.load нарезал бы такой лист неверно.
// 2. Учёт забега: каждый адрес, запрошенный, пока идёт забег, записывается в его
//    набор, и после забега (endRunAssets из cleanup Explore.tsx) всё, что больше
//    никто не держит, выгружается из кэша Assets — и из видеопамяти, и из
//    обычной памяти. Голый Assets.load — лист, который висит в памяти до
//    перезагрузки страницы.

let manifestLoad: Promise<Record<string, SheetRes>> | null = null
/** Манифест — отдельным чанком: в меню он не нужен. */
function sheetManifest(): Promise<Record<string, SheetRes>> {
  manifestLoad ??= import('./sheetRes').then((m) => m.SHEET_RES)
  return manifestLoad
}

/** Ключ манифеста: путь от assets/ без query. */
function sheetKey(url: string): string {
  const i = url.indexOf('/assets/')
  return (i < 0 ? url : url.slice(i + '/assets/'.length)).split('?')[0]
}

// --- Учёт забега ---
// Счётчик наборов, держащих адрес: StrictMode и смена карты монтируют setup()
// заново, и выгрузка прошлого забега не должна снять лист, уже взятый новым.
const held = new Map<string, number>()
let currentRun: Set<string> | null = null

/** Начало забега (setup): дальше каждая загрузка пишется в этот набор. */
export function beginRunAssets(): Set<string> {
  const run = new Set<string>()
  currentRun = run
  return run
}

function hold(run: Set<string>, url: string): void {
  if (run.has(url)) return
  run.add(url)
  held.set(url, (held.get(url) ?? 0) + 1)
}

/**
 * Забег кончился — отпустить его картинки. Что больше никто не держит,
 * выгружается (Assets.unload: текстура уничтожается, видеопамять и картинка в
 * обычной памяти освобождаются) через секунду — если за это время новый забег
 * её не взял.
 */
export function endRunAssets(run: Set<string>): void {
  if (currentRun === run) currentRun = null
  const urls = [...run]
  run.clear()
  for (const url of urls) held.set(url, Math.max(0, (held.get(url) ?? 0) - 1))
  window.setTimeout(() => unloadFree(urls), 1000)
}

function unloadFree(urls: string[]): void {
  const free = urls.filter((url) => (held.get(url) ?? 0) === 0)
  if (free.length === 0) return
  for (const url of free) held.delete(url)
  Assets.unload(free).catch((err) => console.error('Explore: не выгрузились картинки забега', err))
}

/** Что держит учёт сейчас (для ?debugMem=1). */
export function heldAssetCount(): number {
  let n = 0
  for (const v of held.values()) if (v > 0) n++
  return n
}

/**
 * Ставит источнику коэффициент и исходный логический размер из манифеста.
 * Базовой текстуре (одиночная картинка: волна, шип, огонь горгульи) — ещё и
 * рамку в логических пикселях. Повторный вызов на той же текстуре (кэш Assets)
 * ничего не меняет.
 */
function applySheetRes(texture: Texture, e: SheetRes | undefined): void {
  if (!e) return
  const source = texture.source
  if (source.resolution !== e.res) source.resolution = e.res
  // Логический размер — ровно исходный (UV = кадр / логический размер):
  // pixelWidth / res после округления мог бы разойтись на долю пикселя.
  source.width = e.w
  source.height = e.h
  if (texture.frame.width !== e.w || texture.frame.height !== e.h) {
    texture.frame.x = 0
    texture.frame.y = 0
    texture.frame.width = e.w
    texture.frame.height = e.h
    if (texture.orig !== texture.frame) {
      texture.orig.width = e.w
      texture.orig.height = e.h
    }
    texture.update()
  }
}

/**
 * Одна картинка забега. `track: false` — без учёта забега (маска плаща: её
 * выгружает сам вызывающий сразу после перекраски).
 */
export async function loadTexture(url: string, opts: { track?: boolean } = {}): Promise<Texture> {
  const run = opts.track === false ? null : currentRun
  if (run) hold(run, url)
  const [texture, manifest] = await Promise.all([Assets.load(url) as Promise<Texture>, sheetManifest()])
  applySheetRes(texture, manifest[sheetKey(url)])
  // Пришла, когда забега уже нет (setup отменён и следующий не начался) —
  // никто её не отпустит: выгрузить, если её никто не держит.
  if (opts.track !== false && run === null) window.setTimeout(() => unloadFree([url]), 1000)
  return texture
}

// Режет спрайт-лист на кадры: cols колонок в ряд, дальше перенос вниз.
// Все кадры анимации хранятся в одном base.source (не отдельные Texture.from
// на кадр) — Pixi может переиспользовать GPU-текстуру между Texture-обрезками.
// Упакованный лист (в манифесте есть frames) режется по раскладке: сетка листа
// в манифесте обязана совпасть с той, что просит код, — иначе громкая ошибка.
export async function loadSheetFrames(url: string, frameW: number, frameH: number, count: number, cols = 12): Promise<Texture[]> {
  const base = await loadTexture(url)
  const e = (await sheetManifest())[sheetKey(url)]
  base.source.scaleMode = 'linear' // сглаженное масштабирование — герой сильно уменьшается с 512px, 'nearest' даёт дрожащие края
  const frames: Texture[] = []
  if (e?.frames && e.cell) {
    const [cw, ch, n, c] = e.cell
    if (cw !== frameW || ch !== frameH || c !== cols || n < count) {
      throw new Error(`${sheetKey(url)}: код режет клетку ${frameW}×${frameH}, ${count} кадров по ${cols}, а лист упакован из ${cw}×${ch}, ${n} по ${c} — перегенерировать tools/make_sprite_res.mjs`)
    }
    for (let i = 0; i < count; i++) {
      const [x, y, w, h, tx, ty] = e.frames.slice(i * 6, i * 6 + 6)
      frames.push(new Texture({
        source: base.source,
        frame: new Rectangle(x, y, w, h),
        orig: new Rectangle(0, 0, frameW, frameH),
        trim: new Rectangle(tx, ty, w, h),
      }))
    }
    return frames
  }
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
