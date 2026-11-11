// Живой огонь на декоре карт (12.11.2026): стирает нарисованное пламя свечей и огонёк
// в нише колонны-опоры со слоя карты (world-overlay.png пакета) — огонь рисует игра
// шейдером (src/explore/entities/candleFlames.ts) от точки фитиля.
//
// Модуль зовёт build_map_art_new_six.mjs: стирает пламя в буфере слоя ДО нарезки и
// сжатия и пишет точки фитилей в src/explore/liveDecorManifest.ts. Отдельно:
//   node tools/live_decor_flames.mjs   — отчёт + картинки без пламени в art-src/live-decor/
//
// КАК. Пламя ищется не на слое (там воск кладбища и склепа почти того же тона), а на
// ИСХОДНОЙ картинке предмета из архива арта — на прозрачном фоне. Правило из задания:
// тёплый яркий пиксель r > 200, g > 120, b < 170, r − b > 60 (у бледного пламени
// литейной ещё r > 215, g > 170, r − b > 45); пятно дорастает в светлую сердцевину и
// полупрозрачный тёплый ореол, но не ниже фитиля. Фитиль — самая нижняя точка пятна.
// Маска переносится в рамку предмета (x, y, width, height из decor-/added-layout.json
// пакета: предмет вписан в рамку целиком), расширяется на 1 px и стирается со слоя
// (прозрачным); ниже фитиля и тёмные непрозрачные пиксели (сам фитиль) не трогаются.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ART = (process.env.RIGHT_PLACE_ART ?? 'D:/dev/right-place-art').replaceAll('\\', '/')
// имя предмета в layout пакета → вид и исходник
export const CANDLE_ASSETS = {
  'decor_candles.png': { kind: 'candles', count: 2, src: `${ART}/maps/crypt/approved_v1/decor/decor_candles.png` },
  'decor_candle.png': { kind: 'candle', count: 1, src: `${ART}/maps/crypt/approved_v1/decor/decor_candle.png` },
  'candles.png': { kind: 'foundry', count: 2, src: `${ART}/maps/abbey/stage-17-redrawn-decor/parts/candles.png` },
}

const lumOf = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b
function isFlame(r, g, b, a) {
  if (a < 40) return false
  if (r > 200 && g > 120 && b < 170 && r - b > 60) return true
  return r > 215 && g > 170 && r - b > 45
}
// дорастание: светлая сердцевина (непрозрачная — только очень светлая) или полупрозрачный
// тёплый/светлый ореол; непрозрачный тёплый пиксель — это уже воск
function isFlameish(r, g, b, a) {
  if (a < 12) return false
  const lum = lumOf(r, g, b)
  if (a >= 250) return lum > 215
  return lum > 150 || (r > g && g >= b && r - b > 30)
}

function blobs(mask, w, h) {
  const seen = new Uint8Array(w * h), res = []
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || seen[i]) continue
    const st = [i], px = []
    seen[i] = 1
    while (st.length) {
      const p = st.pop()
      px.push(p)
      const x = p % w, y = (p / w) | 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const q = ny * w + nx
        if (mask[q] && !seen[q]) { seen[q] = 1; st.push(q) }
      }
    }
    res.push(px)
  }
  return res
}

/**
 * Пламя на картинке предмета (RGBA, w×h): маска пламени с ореолом и огни
 * { x, y — фитиль; w, h — размер яркого пятна } в пикселях картинки.
 */
export function findFlames(img, w, h, count) {
  const seed = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) if (isFlame(img[i * 4], img[i * 4 + 1], img[i * 4 + 2], img[i * 4 + 3])) seed[i] = 1
  const mask = new Uint8Array(w * h), flames = []
  // Тёплым бывает и освещённый воск у фитиля, поэтому огни — самые ВЕРХНИЕ пятна:
  // по одному на свечу (count), разнесённые по x не меньше чем на пятую ширины картинки.
  const all = blobs(seed, w, h).filter((b) => b.length >= 3).map((px) => {
    let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1
    for (const p of px) { const x = p % w, y = (p / w) | 0; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y) }
    return { px, minX, maxX, minY, maxY, cx: (minX + maxX) / 2 }
  }).sort((a, b) => a.minY - b.minY)
  const picked = []
  for (const b of all) if (picked.length < count && picked.every((p) => Math.abs(p.cx - b.cx) > w * 0.2)) picked.push(b)
  for (const top of picked) {
    // бледное пламя литейной распадается на куски по высоте — подцепить те, что ниже
    // вплотную (до 4 px) и не шире пламени в полтора раза (освещённый воск шире)
    let { minX, maxX, minY, maxY } = top
    const sb = [...top.px]
    for (const b of all) {
      if (b === top || picked.includes(b)) continue
      if (Math.abs(b.cx - top.cx) <= w * 0.1 && b.minY <= maxY + 4 && b.minY > minY && b.maxX - b.minX <= (top.maxX - top.minX + 1) * 1.5) {
        sb.push(...b.px); minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY)
      }
    }
    let sx = 0, n = 0
    for (const p of sb) if (((p / w) | 0) === maxY) { sx += p % w; n++ }
    flames.push({ x: sx / n + 0.5, y: maxY + 1, w: maxX - minX + 1, h: maxY - minY + 1 })
    const grow = Math.max(3, Math.round((maxX - minX + 1) * 0.6))
    const st = [...sb]
    for (const p of sb) mask[p] = 1
    while (st.length) {
      const p = st.pop(), x = p % w, y = (p / w) | 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy
        if (nx < minX - grow || nx > maxX + grow || ny < minY - grow || ny > maxY || nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const q = ny * w + nx
        if (mask[q]) continue
        if (isFlameish(img[q * 4], img[q * 4 + 1], img[q * 4 + 2], img[q * 4 + 3])) { mask[q] = 1; st.push(q) }
      }
    }
  }
  // фитиль и тёмное под пламенем не стирать
  for (let i = 0; i < w * h; i++) if (mask[i] && img[i * 4 + 3] > 200 && lumOf(img[i * 4], img[i * 4 + 1], img[i * 4 + 2]) < 90) mask[i] = 0
  return { mask, flames }
}

const cache = new Map()
export async function loadAsset(asset) {
  if (!cache.has(asset)) {
    const { data, info } = await sharp(CANDLE_ASSETS[asset].src).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    cache.set(asset, { img: data, w: info.width, h: info.height, ...findFlames(data, info.width, info.height, CANDLE_ASSETS[asset].count) })
  }
  return cache.get(asset)
}

/** Стирает пламя предмета `e` (рамка в слое) и возвращает огни в px мира. */
export function eraseInLayer(layer, W, H, e, src) {
  const sx = src.w / e.width, sy = src.h / e.height
  const region = new Uint8Array(e.width * e.height)
  for (let y = 0; y < e.height; y++) for (let x = 0; x < e.width; x++) {
    let hit = false
    for (let v = Math.floor(y * sy); v < Math.ceil((y + 1) * sy) && !hit; v++) for (let u = Math.floor(x * sx); u < Math.ceil((x + 1) * sx) && !hit; u++) if (src.mask[v * src.w + u]) hit = true
    if (hit) region[y * e.width + x] = 1
  }
  const r1 = (n) => Math.round(n * 10) / 10
  const flames = src.flames.map((f) => ({ x: r1(e.x + f.x / sx), y: r1(e.y + f.y / sy), w: r1(f.w / sx), h: r1(f.h / sy) }))
  for (let y = 0; y < e.height; y++) for (let x = 0; x < e.width; x++) {
    let near = region[y * e.width + x]
    for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1 && !near; dx++) {
      const nx = x + dx, ny = y + dy
      if (nx >= 0 && ny >= 0 && nx < e.width && ny < e.height && region[ny * e.width + nx]) near = 1
    }
    if (!near) continue
    // ниже фитиля ближайшего огня — воск
    const wk = flames.reduce((a, b) => (Math.abs(b.x - e.x - x) < Math.abs(a.x - e.x - x) ? b : a))
    if (e.y + y + 0.5 > wk.y) continue
    const gx = e.x + x, gy = e.y + y
    if (gx < 0 || gy < 0 || gx >= W || gy >= H) continue
    const i = (gy * W + gx) * 4
    // фитиль и непрозрачный не светлый край воска (у литейных свечей он рыжий) — оставить
    if (layer[i + 3] > 200 && lumOf(layer[i], layer[i + 1], layer[i + 2]) < 80) continue
    if (layer[i + 3] > 230 && lumOf(layer[i], layer[i + 1], layer[i + 2]) < 170) continue
    layer[i] = 0; layer[i + 1] = 0; layer[i + 2] = 0; layer[i + 3] = 0
  }
  return flames
}

function walk(x, out = []) {
  if (Array.isArray(x)) for (const v of x) walk(v, out)
  else if (x && typeof x === 'object') { if (typeof x.asset === 'string') out.push(x); else for (const v of Object.values(x)) walk(v, out) }
  return out
}

/** Свечи карты из layout-файлов пакета. */
export function candlePlacements(packDir, key) {
  const out = []
  for (const name of ['decor-layout.json', 'added-layout.json']) {
    const f = `${packDir}/${key}/${name}`
    if (fs.existsSync(f)) for (const e of walk(JSON.parse(fs.readFileSync(f, 'utf8')))) if (CANDLE_ASSETS[e.asset]) out.push(e)
  }
  return out
}

/**
 * Огонёк в нише колонны-опоры. Колонна есть только на B (procession), и в layout пакета
 * её нет (README пакета) — пятно ищется по слою в рамке ниши (NICHES, замер по слою) и
 * закрашивается тёмно-коричневым #46301e (стенка ниши), не прозрачным.
 */
export const NICHES = { procession: [{ x: 3216, y: 2360, width: 34, height: 44 }] }
const NICHE_FILL = [0x46, 0x30, 0x1e]
export function eraseNiche(layer, W, box) {
  const bw = box.width, bh = box.height
  const mask = new Uint8Array(bw * bh)
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const i = ((box.y + y) * W + box.x + x) * 4
    const r = layer[i], g = layer[i + 1], b = layer[i + 2]
    if (layer[i + 3] > 200 && r > 150 && g > 90 && r - b > 60) mask[y * bw + x] = 1
  }
  // огонёк — самое большое пятно (блик на краю подставки — отдельное, мелкое)
  const flame = blobs(mask, bw, bh).sort((p, q) => q.length - p.length)[0]
  if (!flame) return null
  let maxY = -1, sx = 0, n = 0
  for (const p of flame) maxY = Math.max(maxY, (p / bw) | 0)
  for (const p of flame) if (((p / bw) | 0) === maxY) { sx += p % bw; n++ }
  // пятно, светлая сердцевина и тёплый отсвет вокруг (до 3 px) — на тон стенки ниши
  const set = new Set(flame)
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    let near = false
    for (let dy = -3; dy <= 3 && !near; dy++) for (let dx = -3; dx <= 3 && !near; dx++) if (set.has((y + dy) * bw + x + dx)) near = true
    if (!near) continue
    const i = ((box.y + y) * W + box.x + x) * 4
    const r = layer[i], g = layer[i + 1], b = layer[i + 2]
    const lum = lumOf(r, g, b)
    if (layer[i + 3] > 200 && ((r - b > 40 && lum > 70) || lum > 170)) { layer[i] = NICHE_FILL[0]; layer[i + 1] = NICHE_FILL[1]; layer[i + 2] = NICHE_FILL[2] }
  }
  return { x: Math.round((box.x + sx / n + 0.5) * 10) / 10, y: box.y + maxY + 1, w: 9, h: 14 }
}

// Запуск отдельно: отчёт по исходникам и картинки без пламени (для глаза).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../art-src/live-decor')
  fs.mkdirSync(outDir, { recursive: true })
  for (const asset of Object.keys(CANDLE_ASSETS)) {
    const a = await loadAsset(asset)
    const img = Buffer.from(a.img)
    for (let i = 0; i < a.w * a.h; i++) if (a.mask[i]) { img[i * 4] = 0; img[i * 4 + 1] = 0; img[i * 4 + 2] = 0; img[i * 4 + 3] = 0 }
    const out = path.join(outDir, asset.replace('.png', '_noflame.png'))
    await sharp(img, { raw: { width: a.w, height: a.h, channels: 4 } }).png().toFile(out)
    console.log(`${asset} ${a.w}×${a.h}: огней ${a.flames.length} — ${a.flames.map((f) => `фитиль (${f.x}, ${f.y}), пламя ${f.w}×${f.h}`).join('; ')}`)
  }
}
