// Готовые слои карт A и F для игры — из одобренных исходников архива арта.
//
//   node tools/build_map_art.mjs            собрать, сверить, записать в public/ и src/
//   node tools/build_map_art.mjs --check    только собрать и сверить, ничего не писать в проект
//
// ЧТО ДЕЛАЕТ. Одобренные предпросмотры (A — approved_v4, F — approved_v3) — это
// непрозрачные картинки «фон + платформы + декор + фигурка героя». Игре нужен
// слой БЕЗ фона и героя: фон у неё живой (параллакс), герой свой. Слой
// собирается из тех же частей и теми же операциями, что и предпросмотры:
// сохранённый слой платформ каждой сборки (platforms-alpha.png), опора, декор
// по раскладке. Затем скрипт САМ проверяет три вещи и падает, если хоть одна
// не сошлась:
//   1. каждая исходная сборка воспроизводится БАЙТ В БАЙТ (значит, части,
//      раскладка декора и версия sharp те же, что были у автора предпросмотра);
//   2. слой, положенный на одобренный фон, даёт одобренную картинку;
//   3. слой совпадает с сеткой столкновений из .txt.
//
// ОТКУДА БЕРЁТ. Архив арта лежит ВНЕ репозитория (D:\dev\right-place-art), его
// ведёт Codex; сюда он не пишет. Путь можно сменить переменной RIGHT_PLACE_ART.
// В репозитории (art-src/) лежит только урезанная копия исходников — слоёв
// platforms-alpha и одобренных рендеров в ней нет, поэтому скрипт читает архив.
//
// КАК УСТРОЕНЫ ОДОБРЕННЫЕ КАРТИНКИ (выяснено чтением скриптов архива):
//   A v4 = сборка a-final-review, у которой строки с 1472-й заменены сплошной
//          полосой панелей основания (preview-a-panel-foundation.cjs).
//   F v3 = мозаика трёх сборок по прямоугольным маскам: основа f-strict-review,
//          пять блоков из f-seamless-review (restore-f-approved-panels.cjs),
//          пять полос нижней кромки из f-solid-masses-review
//          (restore-f-chipped-bottom.cjs + fix-f-block-bottoms.cjs).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

sharp.cache(false)
sharp.concurrency(1)

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ART = (process.env.RIGHT_PLACE_ART ?? 'D:/dev/right-place-art').replaceAll('\\', '/')
const ARCHIVE = `${ART}/maps/graveyard`
const H = `${ARCHIVE}/handoff/`
const WK = `${ARCHIVE}/work/`
// Сюда — слои без потерь и картинки сверки. Вне репозитория: это рабочие файлы.
const EXPORT = `${ART}/game-export/graveyard`
const CHECK_ONLY = process.argv.includes('--check')
const TILE = 64
// Сколько пикселей на карту разрешено добрать из одобренной картинки, если их не
// удалось воспроизвести из частей. Больше — уже не «поправка», а другая картинка.
const RESIDUAL_LIMIT = 400
// Потолки размера файлов — в байтах, по строгому (десятичному) счёту мегабайта.
const MAP_LAYER_MAX = 1_500_000
const BACKDROP_MAX = 600_000

const blank = (w, h, bg = '#00000000') => sharp({ create: { width: w, height: h, channels: 4, background: bg } })
const raw = (input) => sharp(input).ensureAlpha().raw().toBuffer()
const pngOf = (buf, w, h) => sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()

/** Та же постановка детали, что place() в скриптах архива: округление и обрезка по холсту. */
async function place(list, input, x, y, W, HEIGHT) {
  x = Math.round(x); y = Math.round(y)
  const m = await sharp(input).metadata()
  const left = Math.max(0, -x), top = Math.max(0, -y)
  const width = Math.min(m.width - left, W - Math.max(0, x)), height = Math.min(m.height - top, HEIGHT - Math.max(0, y))
  if (width <= 0 || height <= 0) return
  if (left || top || width !== m.width || height !== m.height) input = await sharp(input).extract({ left, top, width, height }).png().toBuffer()
  list.push({ input, left: Math.max(0, x), top: Math.max(0, y) })
}

/**
 * Одобренный фон предпросмотра: дальний слой, ближний с прозрачностью 0.55, вуаль 0.22.
 * ⚠️ Это фон ЗАМОРОЖЕННЫХ снимков (A v4, F v3): по нему воспроизводятся сборки и
 * сверяется слой платформ. В игре ближний слой с 08.10.2026 непрозрачный
 * (BACKDROP_LOOK в src/mapRenderer.ts), но здесь 0.55 менять нельзя — сборки
 * перестанут сходиться с сохранёнными рендерами байт в байт.
 */
async function backgroundOps(W, HEIGHT) {
  const ops = []
  for (const [name, opacity] of [['far', 1], ['mid', 0.55]]) {
    let im = sharp(`${H}bg_graveyard_${name}_approved.png`).resize({ height: 1800 })
    if (opacity !== 1) im = im.ensureAlpha().linear([1, 1, 1, opacity], [0, 0, 0, 0])
    const b = await im.png().toBuffer(), m = await sharp(b).metadata()
    for (let x = 0; x < W; x += m.width) await place(ops, b, x, 0, W, HEIGHT)
  }
  await place(ops, await blank(W, HEIGHT, { r: 24, g: 22, b: 30, alpha: 0.22 }).png().toBuffer(), 0, 0, W, HEIGHT)
  return ops
}

/** Передний план одной сборки: опора, сохранённый слой платформ, декор. Без фона и героя. */
async function foregroundOps({ W, HEIGHT, platforms, support, layout, roundDecor }) {
  const ops = []
  const sp = await sharp(`${H}column_support_approved.png`).resize(246, support.height).modulate({ brightness: 1.05, saturation: 0.8 }).png().toBuffer()
  await place(ops, sp, support.x, support.y, W, HEIGHT)
  await place(ops, fs.readFileSync(platforms), 0, 0, W, HEIGHT)
  const decor = JSON.parse(fs.readFileSync(layout, 'utf8')).decor
  for (const d of decor) {
    const candle = ['candle', 'candles'].includes(d.id)
    const w = roundDecor ? Math.round(d.w) : d.w, h = roundDecor ? Math.round(d.h) : d.h
    const im = await sharp(`${H}decor_${d.id}.png`).resize(w, h).modulate({ brightness: candle ? 0.9 : 0.76, saturation: candle ? 0.72 : 0.55 }).png().toBuffer()
    await place(ops, im, d.x, d.y, W, HEIGHT)
  }
  return { ops, decorCount: decor.length }
}

async function heroOp(x, y, W, HEIGHT) {
  const ops = []
  await place(ops, await sharp(`${H}hero_preview.png`).resize({ height: 140 }).png().toBuffer(), x, y, W, HEIGHT)
  return ops
}

/** Сколько пикселей различается и насколько. */
function diffStats(a, b) {
  if (a.length !== b.length) throw new Error(`разные размеры буферов: ${a.length} и ${b.length}`)
  let differing = 0, over2 = 0, max = 0
  for (let i = 0; i < a.length; i += 4) {
    let d = 0
    for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(a[i + c] - b[i + c]))
    if (d) { differing++; if (d > 2) over2++; if (d > max) max = d }
  }
  return { pixels: a.length / 4, differing, over2, max }
}

/** FNV-1a (32 бита) по тексту сетки. Та же функция — в src/explore/mapArt.ts. */
function gridChecksum(rows) {
  let h = 0x811c9dc5
  const text = rows.join('\n')
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h >>> 0
}

function readGrid(file) {
  const text = fs.readFileSync(path.join(REPO, 'public/assets/maps', file), 'utf8')
  return text.split(/\r?\n/).filter((r) => r.length > 0)
}

/**
 * Сверка слоя с сеткой столкновений. Твердь '#' обязана быть закрыта камнем,
 * верх опорной поверхности — стоять на линии тайла, а в клетках, где герой
 * стоит и идёт, не должно быть сплошного камня, которого нет в столкновениях.
 */
function geometryCheck(layer, W, rows) {
  const HT = rows.length, WT = rows[0].length
  const alpha = (x, y) => layer[(y * W + x) * 4 + 3]
  const at = (x, y) => rows[y]?.[x]
  const solid = (x, y) => at(x, y) === '#'
  let solidCells = 0, worstSolid = 1; const thinInner = [], thinEdge = []
  let surfaces = 0, offMax = 0, offSum = 0; const offHist = {}
  let thinCells = 0, thinOffMax = 0
  let airCells = 0, airBlocked = 0; const airBlockedList = []
  for (let ty = 0; ty < HT; ty++) for (let tx = 0; tx < WT; tx++) {
    const ch = at(tx, ty)
    let opaque = 0
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) if (alpha(tx * TILE + x, ty * TILE + y) >= 128) opaque++
    const cover = opaque / (TILE * TILE)
    if (ch === '#') {
      solidCells++
      if (cover < worstSolid) worstSolid = cover
      // Клетка, под которой тверди нет (низ висящего массива или низ карты), может
      // кончаться неровной сколотой кромкой — просветы внизу там законны. Внутри
      // массива и у его верха просветов быть не должно вовсе.
      const bottomEdge = !solid(tx, ty + 1)
      if (bottomEdge) { if (cover < 0.45) thinEdge.push([tx, ty, Math.round(cover * 100)]) }
      else if (cover < 0.97) thinInner.push([tx, ty, Math.round(cover * 100)])
    } else {
      // Клетка, в которой герой может находиться телом: воздух над опорой.
      airCells++
      if (cover > 0.9) { airBlocked++; if (airBlockedList.length < 8) airBlockedList.push([tx, ty, Math.round(cover * 100)]) }
    }
    if ((ch === '#' || ch === '=') && !solid(tx, ty - 1)) {
      // Верх опорной поверхности: первая непрозрачная строка от линии тайла вниз,
      // в каждом столбце клетки. 0 — камень начинается ровно там, где стоит герой.
      for (let x = 0; x < TILE; x++) {
        let first = TILE
        for (let y = 0; y < TILE; y++) if (alpha(tx * TILE + x, ty * TILE + y) >= 128) { first = y; break }
        if (ch === '#') { surfaces++; offSum += first; offMax = Math.max(offMax, first); offHist[first] = (offHist[first] ?? 0) + 1 }
        else { thinCells++; thinOffMax = Math.max(thinOffMax, first) }
      }
    }
  }
  const topOffsets = Object.entries(offHist).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}px×${v}`)
  return { solidCells, thinInner, thinEdge, worstSolidCover: Math.round(worstSolid * 1000) / 10, surfaceColumns: surfaces, surfaceOffsetMax: offMax, surfaceOffsetMean: Math.round((offSum / Math.max(1, surfaces)) * 100) / 100, topOffsets, thinColumns: thinCells, thinOffsetMax: thinOffMax, airCells, airBlocked, airBlockedList }
}

/** PSNR по видимым пикселям: цвет сравнивается там, где слой непрозрачен хотя бы частично. */
function psnr(a, b) {
  let se = 0, n = 0, alphaMax = 0
  for (let i = 0; i < a.length; i += 4) {
    alphaMax = Math.max(alphaMax, Math.abs(a[i + 3] - b[i + 3]))
    if (a[i + 3] < 8) continue
    for (let c = 0; c < 3; c++) { const d = a[i + c] - b[i + c]; se += d * d }
    n += 3
  }
  const mse = se / Math.max(1, n)
  return { psnr: mse === 0 ? Infinity : Math.round(10 * Math.log10(255 * 255 / mse) * 100) / 100, alphaMaxDiff: alphaMax }
}

/**
 * Самое качественное сжатие, которое укладывается в потолок размера. Порядок —
 * от «без потерь» к «с потерями»; берётся ПЕРВОЕ подходящее, следующее за ним
 * печатается для сравнения. Альфа у вариантов с потерями хранится без потерь.
 */
async function encodeUnder(png, original, maxBytes, what) {
  const ladder = [
    ['без потерь', { lossless: true, effort: 6 }],
    ['почти без потерь 60', { nearLossless: true, quality: 60, effort: 6 }],
    ['почти без потерь 40', { nearLossless: true, quality: 40, effort: 6 }],
    ...[98, 96, 94, 92, 90, 86, 82].map((q) => [`q${q}`, { quality: q, alphaQuality: 100, effort: 6, smartSubsample: true }]),
  ]
  let pick = null, after = 0
  for (const [label, opts] of ladder) {
    const buf = await sharp(png).webp(opts).toBuffer()
    const q = psnr(original, await raw(buf))
    const fits = buf.length <= maxBytes
    console.log(`  ${label}: ${kb(buf.length)}, PSNR ${q.psnr} дБ, альфа ±${q.alphaMaxDiff}${fits ? '' : ' — не влезает'}`)
    if (!pick && fits) { pick = { label, buf, psnr: q.psnr }; continue }
    if (pick && ++after >= 1) break
  }
  if (!pick) fail(`${what}: не уместился в ${kb(maxBytes)} ни в одном варианте сжатия`)
  return pick
}

const fail = (msg) => { console.error('\nСТОП: ' + msg); process.exit(1) }
const mb = (n) => (n / 1048576).toFixed(2) + ' МиБ'
const kb = (n) => Math.round(n / 1024) + ' КБ'

// ---------------------------------------------------------------------------

async function assembly(name, cfg) {
  const { W, HEIGHT } = cfg
  const bg = await backgroundOps(W, HEIGHT)
  const fg = await foregroundOps(cfg)
  const hero = await heroOp(cfg.hero[0], cfg.hero[1], W, HEIGHT)
  // (1) сборка воспроизводится байт в байт — одним вызовом composite, как в скрипте автора
  const again = await raw(await blank(W, HEIGHT, '#27272d').composite([...bg, ...fg.ops, ...hero]).png().toBuffer())
  const stored = await raw(cfg.full)
  const d = diffStats(again, stored)
  console.log(`  сборка ${name}: декора ${fg.decorCount}, отличий от сохранённого рендера ${d.differing} из ${d.pixels} (макс ${d.max})`)
  // Малое расхождение не валит прогон: такие пиксели добираются ниже, из одобренной
  // картинки (см. verifyAndEncode), и их число печатается. Большое — стоп: значит,
  // исходники или sharp не те, что были у автора предпросмотра.
  if (d.differing > RESIDUAL_LIMIT) fail(`сборка ${name} не воспроизвелась: ${d.differing} пикселей отличаются.`)
  const layer = await raw(await blank(W, HEIGHT).composite(fg.ops).png().toBuffer())
  return { layer, bg, hero }
}

async function buildA() {
  const W = 3072, HEIGHT = 1536
  const sc = JSON.parse(fs.readFileSync(`${WK}a-final-review/support-contact.json`, 'utf8'))
  const a = await assembly('a-final-review', {
    W, HEIGHT, platforms: `${WK}a-final-review/platforms-alpha.png`, support: { x: sc.x, y: sc.y, height: sc.height },
    layout: `${WK}small-map-layout.json`, roundDecor: true, hero: [830, 767], full: `${WK}a-final-review/map-a-full.png`,
  })
  // Основание: строки с 1472-й — сплошная полоса панелей (preview-a-panel-foundation.cjs).
  const panel = fs.readFileSync(`${WK}f-panel-wall-study/approved-panel.png`)
  const head = fs.readFileSync(`${WK}f-panel-wall-study/approved-skull-column.png`)
  const rail = fs.readFileSync(`${WK}f-panel-wall-study/approved-rail.png`)
  const ops = []
  for (let x = 0; x < W; x += 124) { const w = Math.min(128, W - x); ops.push({ input: await sharp(panel).extract({ left: 0, top: 0, width: w, height: 64 }).png().toBuffer(), left: x, top: 0 }) }
  for (const x of [0, W - 60]) ops.push({ input: await sharp(head).extract({ left: 0, top: 0, width: 60, height: 64 }).png().toBuffer(), left: x, top: 0 })
  for (let x = 0; x < W; x += 124) ops.push({ input: await sharp(rail).extract({ left: 0, top: 0, width: Math.min(128, W - x), height: 8 }).png().toBuffer(), left: x, top: 0 })
  const body = await sharp({ create: { width: W, height: 64, channels: 4, background: '#6a6455' } }).composite(ops).raw().toBuffer()
  const layer = Buffer.from(a.layer)
  body.copy(layer, 1472 * W * 4)
  return { id: 'A', file: 'map_A_serpentine.txt', W, HEIGHT, layer, bg: a.bg, hero: a.hero, approved: `${WK}approved_v4/map-a-full.png` }
}

async function buildF() {
  const W = 3072, HEIGHT = 1408
  const common = { W, HEIGHT, layout: `${WK}map-f-audit.json`, roundDecor: false, hero: [322, 1151] }
  const strictSupport = JSON.parse(fs.readFileSync(`${WK}f-strict-review/support-contact.json`, 'utf8'))
  const solidSupport = JSON.parse(fs.readFileSync(`${WK}f-solid-masses-review/support-audit.json`, 'utf8'))
  const strict = await assembly('f-strict-review', { ...common, platforms: `${WK}f-strict-review/platforms-alpha.png`, support: { x: strictSupport.x, y: strictSupport.y, height: 356 }, full: `${WK}f-strict-review/map-f-full.png` })
  const seamless = await assembly('f-seamless-review', { ...common, platforms: `${WK}f-seamless-review/platforms-alpha.png`, support: { x: 1050, y: 948, height: 356 }, full: `${WK}f-seamless-review/map-f-full.png` })
  const solid = await assembly('f-solid-masses-review', { ...common, platforms: `${WK}f-solid-masses-review/platforms-alpha.png`, support: { x: solidSupport.x, y: solidSupport.y, height: solidSupport.height }, full: `${WK}f-solid-masses-review/map-f-full.png` })
  const layer = Buffer.from(strict.layer)
  const copyRect = (src, x, y, w, h) => { for (let yy = y; yy < y + h; yy++) src.copy(layer, (yy * W + x) * 4, (yy * W + x) * 4, (yy * W + x + w) * 4) }
  // approved_v2: фасады пяти блоков из f-seamless (ниже карниза в 18 px).
  for (const [x, y, w, h] of [[32, 11, 1, 2], [33, 10, 2, 3], [35, 11, 3, 2], [44, 19, 1, 3], [45, 18, 3, 4]]) copyRect(seamless.layer, x * 64, y * 64 + 18, w * 64, h * 64 - 18)
  // Нижние кромки из f-solid-masses: сперва три полосы мостов, потом две полосы блоков.
  for (const [x, y, w, h] of [[64, 414, 1536, 34], [640, 926, 1024, 34], [0, 1374, 2816, 34]]) copyRect(solid.layer, x, y, w, h)
  for (const [x, y, w, h] of [[2048, 804, 384, 28], [2816, 1380, 256, 28]]) copyRect(solid.layer, x, y, w, h)
  return { id: 'F', file: 'map_F_sanctuary.txt', W, HEIGHT, layer, bg: strict.bg, hero: strict.hero, approved: `${WK}approved_v3/map-f-full.png` }
}

async function verifyAndEncode(m) {
  const { W, HEIGHT } = m
  console.log(`\n== Карта ${m.id}: ${W}×${HEIGHT}`)
  // (2) слой на одобренном фоне даёт одобренную картинку
  const approved = await raw(m.approved)
  const compose = async (png) => raw(await blank(W, HEIGHT, '#27272d').composite([...m.bg, { input: png, left: 0, top: 0 }, ...m.hero]).png().toBuffer())
  let layerPng = await pngOf(m.layer, W, HEIGHT)
  let composed = await compose(layerPng)
  // Остаток: пиксели, которые из частей не воспроизвелись (у сборки f-strict сохранённый
  // слой платформ на 3 px уже сохранённого рендера). Берём их из одобренной картинки
  // как непрозрачные — это камень блока, фон сквозь него не виден.
  const residual = []
  for (let i = 0; i < composed.length; i += 4) {
    let dd = 0
    for (let c = 0; c < 3; c++) dd = Math.max(dd, Math.abs(composed[i + c] - approved[i + c]))
    if (dd > 2) residual.push(i)
  }
  if (residual.length > RESIDUAL_LIMIT) fail(`слой карты ${m.id} расходится с одобренной картинкой в ${residual.length} пикселях — это больше допустимого остатка (${RESIDUAL_LIMIT}).`)
  if (residual.length) {
    let x0 = W, x1 = -1, y0 = HEIGHT, y1 = -1
    for (const i of residual) { const p = i / 4, x = p % W, y = (p - x) / W; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); for (let c = 0; c < 3; c++) m.layer[i + c] = approved[i + c]; m.layer[i + 3] = 255 }
    console.log(`  остаток: ${residual.length} пикселей взяты из одобренной картинки как непрозрачные (рамка x ${x0}..${x1}, y ${y0}..${y1})`)
    layerPng = await pngOf(m.layer, W, HEIGHT)
    composed = await compose(layerPng)
  }
  m.residual = residual.length
  const d = diffStats(composed, approved)
  console.log(`  слой на одобренном фоне против одобренной картинки: отличается ${d.differing} из ${d.pixels} пикселей (${(100 * d.differing / d.pixels).toFixed(3)}%), больше чем на 2 единицы — ${d.over2}, максимум ${d.max}`)
  if (d.over2 > 0 || d.max > 2) fail(`слой карты ${m.id} не совпадает с одобренной картинкой: ${d.over2} пикселей расходятся больше чем на 2 единицы (макс ${d.max}).`)
  // (3) слой против сетки столкновений
  const rows = readGrid(m.file)
  if (rows[0].length * TILE !== W || rows.length * TILE !== HEIGHT) fail(`размер слоя ${W}×${HEIGHT} не равен сетке ${rows[0].length}×${rows.length} тайлов`)
  const g = geometryCheck(m.layer, W, rows)
  console.log(`  твердь '#': ${g.solidCells} клеток; с просветами внутри массива — ${g.thinInner.length}${g.thinInner.length ? ' ' + JSON.stringify(g.thinInner.slice(0, 12)) : ''}; нижних клеток, закрытых меньше чем на 45% — ${g.thinEdge.length}; наименьшее покрытие ${g.worstSolidCover}% (у нижней сколотой кромки)`)
  if (g.thinInner.length || g.thinEdge.length) fail(`слой карты ${m.id} не закрывает твердь: внутри массива ${g.thinInner.length} клеток с просветами, у нижней кромки ${g.thinEdge.length} закрыты меньше чем наполовину.`)
  if (g.surfaceOffsetMax > 2 || g.thinOffsetMax > 2) fail(`верх опорной поверхности карты ${m.id} не на линии тайла: смещение до ${Math.max(g.surfaceOffsetMax, g.thinOffsetMax)} px.`)
  console.log(`  верх поверхности '#': ${g.surfaceColumns} столбцов, смещение от линии тайла — макс ${g.surfaceOffsetMax} px, среднее ${g.surfaceOffsetMean} px (чаще всего: ${g.topOffsets.join(', ')})`)
  console.log(`  полки '=': ${g.thinColumns} столбцов, смещение верха макс ${g.thinOffsetMax} px`)
  console.log(`  воздух: ${g.airCells} клеток, из них закрыто камнем больше чем на 90% — ${g.airBlocked}${g.airBlocked ? ' ' + JSON.stringify(g.airBlockedList) : ''}`)
  // Запись без потерь — в рабочую папку экспорта, вне репозитория.
  fs.mkdirSync(EXPORT, { recursive: true })
  const stem = m.file.replace(/\.txt$/, '')
  fs.writeFileSync(`${EXPORT}/${stem}_layer_lossless.png`, layerPng)
  // Сжатие. Альфа без потерь: кромка слоя обязана остаться той же.
  const pick = await encodeUnder(layerPng, m.layer, MAP_LAYER_MAX, `слой карты ${m.id}`)
  console.log(`  выбрано «${pick.label}»: ${mb(pick.buf.length)} (PNG без потерь — ${mb(layerPng.length)})`)
  return { ...m, rows, layerPng, webp: pick.buf, quality: pick.label, psnr: pick.psnr, checksum: gridChecksum(rows), fidelity: d, geometry: g }
}

async function backgrounds() {
  console.log('\n== Фон кладбища')
  const out = []
  for (const name of ['far', 'mid']) {
    const src = `${H}bg_graveyard_${name}_approved.png`
    const meta = await sharp(src).metadata()
    const orig = await raw(src)
    console.log(`  — ${name}, ${meta.width}×${meta.height}, исходник ${mb(fs.statSync(src).size)}`)
    const chosen = await encodeUnder(fs.readFileSync(src), orig, BACKDROP_MAX, `слой фона ${name}`)
    console.log(`  выбрано «${chosen.label}»: ${kb(chosen.buf.length)}`)
    out.push({ name, width: meta.width, height: meta.height, srcBytes: fs.statSync(src).size, quality: chosen.label, buf: chosen.buf, psnr: chosen.psnr })
  }
  return out
}

const maps = [await verifyAndEncode(await (console.log('== Сборки карты A'), buildA())), await verifyAndEncode(await (console.log('\n== Сборки карты F'), buildF()))]
const bgs = await backgrounds()

if (CHECK_ONLY) { console.log('\n--check: в проект ничего не записано.'); process.exit(0) }

const artDir = path.join(REPO, 'public/assets/maps/art')
fs.mkdirSync(artDir, { recursive: true })
for (const m of maps) fs.writeFileSync(path.join(artDir, m.file.replace(/\.txt$/, '.webp')), m.webp)
for (const b of bgs) fs.writeFileSync(path.join(REPO, `public/assets/maps/backgrounds/bg_graveyard_${b.name}.webp`), b.buf)

const manifest = `// СГЕНЕРИРОВАНО tools/build_map_art.mjs — руками не править, пересобирать скриптом.
//
// Готовые слои платформ и декора карт A и F. gridChecksum — контрольная сумма
// сетки .txt, под которую слой собран: поменяют геометрию карты и не пересоберут
// слой — картинка разойдётся со столкновениями, и игра скажет об этом в консоли.
export type MapArtEntry = { file: string; width: number; height: number; gridChecksum: number }

export const MAP_ART: Record<string, MapArtEntry> = {
${maps.map((m) => `  '${m.file}': { file: '${m.file.replace(/\.txt$/, '.webp')}', width: ${m.W}, height: ${m.HEIGHT}, gridChecksum: 0x${m.checksum.toString(16).padStart(8, '0')} },`).join('\n')}
}
`
fs.writeFileSync(path.join(REPO, 'src/explore/mapArtManifest.ts'), manifest)

console.log('\n== Записано')
for (const m of maps) console.log(`  public/assets/maps/art/${m.file.replace(/\.txt$/, '.webp')}  ${m.W}×${m.HEIGHT}  ${mb(m.webp.length)}  сжатие: ${m.quality}`)
for (const b of bgs) console.log(`  public/assets/maps/backgrounds/bg_graveyard_${b.name}.webp  ${b.width}×${b.height}  ${kb(b.buf.length)}  сжатие: ${b.quality}`)
console.log('  src/explore/mapArtManifest.ts')
console.log(`  слои без потерь и сверка: ${EXPORT}`)
