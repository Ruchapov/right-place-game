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
//
// ДЕКОР БЕЗ ПРЕДМЕТОВ НА ШИПАХ (28.10.2026). В игру идёт слой по РАБОЧЕЙ
// раскладке декора — maps/graveyard/decor-spikes-2026-10-28/: та же раскладка
// одобренной версии без предметов, чья видимая часть ложилась на шип из пула
// slots.hazard (removed.json там же). Сверки 1 и 2 по-прежнему идут по ОДОБРЕННОЙ
// раскладке — они доказывают, что части те же; затем скрипт собирает слой по
// рабочей и проверяет, что он отличается от одобренного ТОЛЬКО в пикселях
// удалённых предметов (у кладбищенского декора контактных теней нет).
import fs from 'node:fs'
import crypto from 'node:crypto'
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
// Рабочая раскладка декора без предметов на шипах. sha256 закреплены: файл
// поменяли — скрипт остановится, а не соберёт молча другой слой.
const CLEAN = `${ARCHIVE}/decor-spikes-2026-10-28/`
const CLEAN_LAYOUT = {
  [`${WK}small-map-layout.json`]: { file: `${CLEAN}small-map-layout.json`, sha: '9ec2b2b68cb6262a08a5ddaf5bde58b6f0677186593efb787ceaf0b7cca0c1a2' },
  [`${WK}map-f-audit.json`]: { file: `${CLEAN}map-f-audit.json`, sha: '815c2666ffe1564a15502e8ea258e2ac51d0046ec240ea9166944f42dc73b42f' },
}
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

function pinnedClean(layout) {
  const c = CLEAN_LAYOUT[layout]
  if (!c) fail(`нет рабочей раскладки для ${layout}`)
  if (!fs.existsSync(c.file)) fail(`нет рабочей раскладки ${c.file}`)
  const got = crypto.createHash('sha256').update(fs.readFileSync(c.file)).digest('hex')
  if (got !== c.sha) fail(`рабочая раскладка ${c.file} не та: sha256 ${got}, ожидался ${c.sha}`)
  return c.file
}

/**
 * Предметы, которых нет в рабочей раскладке. Рабочая обязана быть подмножеством
 * одобренной — ни одного нового или сдвинутого предмета.
 */
function removedDecor(approvedLayout, cleanLayout) {
  const a = JSON.parse(fs.readFileSync(approvedLayout, 'utf8')).decor.map((d) => JSON.stringify(d))
  const c = JSON.parse(fs.readFileSync(cleanLayout, 'utf8')).decor.map((d) => JSON.stringify(d))
  const left = [...a]
  for (const d of c) { const i = left.indexOf(d); if (i < 0) fail(`в рабочей раскладке ${cleanLayout} предмет, которого нет в одобренной: ${d}`); left.splice(i, 1) }
  return left.map((d) => JSON.parse(d))
}

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
 * сверяется слой платформ. В игре с 08.10.2026 ближний слой непрозрачный, а
 * вуаль 0.42 (BACKDROP_LOOK в src/mapRenderer.ts), но здесь 0.55 и 0.22 менять
 * нельзя — сборки перестанут сходиться с сохранёнными рендерами байт в байт.
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
async function decorOps(decor, roundDecor, ops, W, HEIGHT) {
  for (const d of decor) {
    const candle = ['candle', 'candles'].includes(d.id)
    const w = roundDecor ? Math.round(d.w) : d.w, h = roundDecor ? Math.round(d.h) : d.h
    const im = await sharp(`${H}decor_${d.id}.png`).resize(w, h).modulate({ brightness: candle ? 0.9 : 0.76, saturation: candle ? 0.72 : 0.55 }).png().toBuffer()
    await place(ops, im, d.x, d.y, W, HEIGHT)
  }
}

async function foregroundOps({ W, HEIGHT, platforms, support, layout, roundDecor }) {
  const ops = []
  const sp = await sharp(`${H}column_support_approved.png`).resize(246, support.height).modulate({ brightness: 1.05, saturation: 0.8 }).png().toBuffer()
  await place(ops, sp, support.x, support.y, W, HEIGHT)
  await place(ops, fs.readFileSync(platforms), 0, 0, W, HEIGHT)
  const decor = JSON.parse(fs.readFileSync(layout, 'utf8')).decor
  await decorOps(decor, roundDecor, ops, W, HEIGHT)
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
  // Слой игры — по рабочей раскладке (без предметов на шипах) и след удалённых
  // предметов: где они непрозрачны хоть немного. Только там слой вправе отличаться.
  const cleanLayout = pinnedClean(cfg.layout)
  const clean = await raw(await blank(W, HEIGHT).composite((await foregroundOps({ ...cfg, layout: cleanLayout })).ops).png().toBuffer())
  const gone = removedDecor(cfg.layout, cleanLayout)
  const goneOps = []
  await decorOps(gone, cfg.roundDecor, goneOps, W, HEIGHT)
  const goneRaw = await raw(await blank(W, HEIGHT).composite(goneOps).png().toBuffer())
  const removedMask = new Uint8Array(W * HEIGHT)
  for (let p = 0; p < W * HEIGHT; p++) if (goneRaw[p * 4 + 3] > 0) removedMask[p] = 1
  return { layer, clean, removedMask, removed: gone, bg, hero }
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
  const clean = Buffer.from(a.clean)
  body.copy(clean, 1472 * W * 4)
  return { id: 'A', file: 'map_A_serpentine.txt', W, HEIGHT, layer, clean, removedMask: a.removedMask, removed: a.removed, bg: a.bg, hero: a.hero, approved: `${WK}approved_v4/map-a-full.png` }
}

async function buildF() {
  const W = 3072, HEIGHT = 1408
  const common = { W, HEIGHT, layout: `${WK}map-f-audit.json`, roundDecor: false, hero: [322, 1151] }
  const strictSupport = JSON.parse(fs.readFileSync(`${WK}f-strict-review/support-contact.json`, 'utf8'))
  const solidSupport = JSON.parse(fs.readFileSync(`${WK}f-solid-masses-review/support-audit.json`, 'utf8'))
  const strict = await assembly('f-strict-review', { ...common, platforms: `${WK}f-strict-review/platforms-alpha.png`, support: { x: strictSupport.x, y: strictSupport.y, height: 356 }, full: `${WK}f-strict-review/map-f-full.png` })
  const seamless = await assembly('f-seamless-review', { ...common, platforms: `${WK}f-seamless-review/platforms-alpha.png`, support: { x: 1050, y: 948, height: 356 }, full: `${WK}f-seamless-review/map-f-full.png` })
  const solid = await assembly('f-solid-masses-review', { ...common, platforms: `${WK}f-solid-masses-review/platforms-alpha.png`, support: { x: solidSupport.x, y: solidSupport.y, height: solidSupport.height }, full: `${WK}f-solid-masses-review/map-f-full.png` })
  // Мозаика одна и та же для одобренного слоя и для слоя по рабочей раскладке.
  const mosaic = (key) => {
    const layer = Buffer.from(strict[key])
    const copyRect = (src, x, y, w, h) => { for (let yy = y; yy < y + h; yy++) src.copy(layer, (yy * W + x) * 4, (yy * W + x) * 4, (yy * W + x + w) * 4) }
    // approved_v2: фасады пяти блоков из f-seamless (ниже карниза в 18 px).
    for (const [x, y, w, h] of [[32, 11, 1, 2], [33, 10, 2, 3], [35, 11, 3, 2], [44, 19, 1, 3], [45, 18, 3, 4]]) copyRect(seamless[key], x * 64, y * 64 + 18, w * 64, h * 64 - 18)
    // Нижние кромки из f-solid-masses: сперва три полосы мостов, потом две полосы блоков.
    for (const [x, y, w, h] of [[64, 414, 1536, 34], [640, 926, 1024, 34], [0, 1374, 2816, 34]]) copyRect(solid[key], x, y, w, h)
    for (const [x, y, w, h] of [[2048, 804, 384, 28], [2816, 1380, 256, 28]]) copyRect(solid[key], x, y, w, h)
    return layer
  }
  return { id: 'F', file: 'map_F_sanctuary.txt', W, HEIGHT, layer: mosaic('layer'), clean: mosaic('clean'), removedMask: strict.removedMask, removed: strict.removed, bg: strict.bg, hero: strict.hero, approved: `${WK}approved_v3/map-f-full.png` }
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
    for (const i of residual) {
      const p = i / 4, x = p % W, y = (p - x) / W; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y)
      // Остаток — камень платформ; на месте удалённого предмета его брать нельзя:
      // там одобренная картинка показывает предмет, которого в слое игры уже нет.
      if (m.removedMask[p]) fail(`остаток карты ${m.id} попал на след удалённого предмета (x ${x}, y ${y}).`)
      for (let c = 0; c < 3; c++) { m.layer[i + c] = approved[i + c]; m.clean[i + c] = approved[i + c] }
      m.layer[i + 3] = 255; m.clean[i + 3] = 255
    }
    console.log(`  остаток: ${residual.length} пикселей взяты из одобренной картинки как непрозрачные (рамка x ${x0}..${x1}, y ${y0}..${y1})`)
    layerPng = await pngOf(m.layer, W, HEIGHT)
    composed = await compose(layerPng)
  }
  m.residual = residual.length
  const d = diffStats(composed, approved)
  console.log(`  слой на одобренном фоне против одобренной картинки: отличается ${d.differing} из ${d.pixels} пикселей (${(100 * d.differing / d.pixels).toFixed(3)}%), больше чем на 2 единицы — ${d.over2}, максимум ${d.max}`)
  if (d.over2 > 0 || d.max > 2) fail(`слой карты ${m.id} не совпадает с одобренной картинкой: ${d.over2} пикселей расходятся больше чем на 2 единицы (макс ${d.max}).`)
  // Слой игры — по рабочей раскладке. Отличаться от одобренного он вправе только
  // в следе удалённых предметов (m.removedMask); всё остальное — байт в байт.
  let changed = 0, outside = 0
  for (let p = 0; p < W * HEIGHT; p++) {
    const i = p * 4
    if (m.layer[i] === m.clean[i] && m.layer[i + 1] === m.clean[i + 1] && m.layer[i + 2] === m.clean[i + 2] && m.layer[i + 3] === m.clean[i + 3]) continue
    changed++
    if (!m.removedMask[p]) outside++
  }
  console.log(`  без предметов на шипах (${m.removed.map((d) => `${d.id} ${d.x},${d.y}`).join('; ')}): изменилось ${changed} пикселей, вне следа удалённых — ${outside}`)
  if (outside) fail(`слой карты ${m.id} по рабочей раскладке изменился вне удалённых предметов: ${outside} пикселей.`)
  m.layerApproved = m.layer
  m.layer = m.clean
  layerPng = await pngOf(m.layer, W, HEIGHT)

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
  fs.writeFileSync(`${EXPORT}/${stem}_layer_approved_lossless.png`, await pngOf(m.layerApproved, W, HEIGHT))
  fs.writeFileSync(`${EXPORT}/${stem}_removed_mask.png`, await sharp(Buffer.from(m.removedMask.map((v) => v * 255)), { raw: { width: W, height: HEIGHT, channels: 1 } }).png().toBuffer())
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

// ---------------------------------------------------------------------------
// БОЛОТО: B2 и C2 (29.10.2026). Источник — рабочая версия архива
// maps/swamp/approved-maps-v1-steps-2026-10-29: одобренные approved-maps-v1
// (платформы approved-architecture-v1 + декор stage-09) без предметов на шипах
// (28.10.2026) и со ступенями из '#' (29.10.2026, решение Андрея: обязательный
// подъём только по кладке, без прыжков на 3 вверх). Слой = платформы + декор.
// Проверки: файлы те самые (sha256); слой отличается от ОДОБРЕННОГО только в
// changed-mask.png (ступени и удалённый декор); слой против сетки.
// C2 шириной 6144 px в одну текстуру не влезает (потолок 4096 по стороне):
// слой режется по ширине на равные части (slices в манифесте), игра ставит их
// встык. Части режутся ДО сжатия, поэтому стык — граница пикселей, без сдвига.
const SWAMP = `${ART}/maps/swamp`
const SWAMP_WORK = `${SWAMP}/approved-maps-v1-steps-2026-10-29`
const SWAMP_OK = `${SWAMP}/approved-maps-v1`
const TEXTURE_MAX_SIDE = 4096
const pin = (file, sha) => {
  if (!fs.existsSync(file)) fail(`нет исходника ${file}`)
  const got = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  if (got !== sha) fail(`исходник ${file} не тот: sha256 ${got}, ожидался ${sha}`)
  return file
}
const SWAMP_MAPS = [
  {
    id: 'B2', file: 'map_B2_swamp.txt',
    platforms: [`${SWAMP_WORK}/B2/map-B2-platforms-64px.png`, '4e379f5719b700131366f00925a446812bc1217fbc43281aeeb02fd3726d0890'],
    decor: [`${SWAMP_WORK}/B2/map-B2-decor-64px.png`, 'c39458319cc6c1c27375cb601ebc7ea58ca15e70d7f33680b4df31e7809a482d'],
    mask: [`${SWAMP_WORK}/B2/changed-mask.png`, 'c9be08658d270e9f286df4c80a16bf6278343d27df362f40d65e7cc55229b13a'],
    approvedPlatforms: [`${SWAMP_OK}/approved-architecture-v1/maps/map-B2-platforms-64px.png`, '629ab7f1beb61f6ea3f64226df12f114a2cf89691fb1d63b658f3c7a77342a69'],
    approvedDecor: [`${SWAMP_OK}/stage-09-ground-contact/map-B2-decor-64px.png`, '6e4c88b77c82733aa1382088d9b4f19132dafef8817b37b8c0d5151a6be6b3fa'],
  },
  {
    id: 'C2', file: 'map_C2_swamp_boss.txt',
    platforms: [`${SWAMP_WORK}/C2/map-C2-platforms-64px.png`, 'dd491d0c740bb18d4113fa42297e761f4f09afef3f522ba0bd60e387884dc74d'],
    decor: [`${SWAMP_WORK}/C2/map-C2-decor-64px.png`, '17ff1a6c13e1e4e426f896548612cf0861d6ac8779ce17f46ca77039a79158f3'],
    mask: [`${SWAMP_WORK}/C2/changed-mask.png`, 'ccc755ca7cf04a33f67430bfcb6e183a2b4d24833d03df0ba876190498077ffd'],
    approvedPlatforms: [`${SWAMP_OK}/approved-architecture-v1/maps/map-C2-platforms-64px.png`, '758cd05288b43147d4271127495709622a7cac7e398f044a1fc78d6e9720b6a2'],
    approvedDecor: [`${SWAMP_OK}/stage-09-ground-contact/map-C2-decor-64px.png`, '6d50dfaba3a93735e1e31981e28d0d0da63059023cea93afde4db093d2721be8'],
  },
]
// Фон болота: одобренные слои, обрезанные сверху на 450 px — так их кадрировал
// предпросмотр (build-full-maps.py, «убрана часть неба»). Высоту под карту
// задаёт игра (worldHeight 'map' в BACKDROP_LOOK), вуаль (20,23,27,155) — тоже она.
const SWAMP_BG = {
  far: [`${SWAMP_OK}/approved-architecture-v1/backgrounds/swamp-far.png`, '39248ef44605fc1eb205daad8be17c8da2193f9a90c3184c3b0f79a492deadae'],
  mid: [`${SWAMP_OK}/approved-architecture-v1/backgrounds/swamp-near.png`, '122deda5d5fd44d5ab8bd0ed324bf45b7aa07730fe87b60f43b44af01cb73609'],
}
const SWAMP_BG_CROP_TOP = 450

async function buildSwamp(m) {
  console.log(`\n== Карта ${m.id} (${m.file}, болото)`)
  for (const k of ['platforms', 'decor', 'mask', 'approvedPlatforms', 'approvedDecor']) pin(...m[k])
  const meta = await sharp(m.platforms[0]).metadata()
  const W = meta.width, HEIGHT = meta.height
  const rows = readGrid(m.file)
  if (rows[0].length * TILE !== W || rows.length * TILE !== HEIGHT) fail(`размер слоя ${W}×${HEIGHT} не равен сетке ${rows[0].length}×${rows.length} тайлов`)
  const layerPng = await blank(W, HEIGHT).composite([{ input: m.platforms[0] }, { input: m.decor[0] }]).png().toBuffer()
  const layer = await raw(layerPng)
  const approved = await raw(await blank(W, HEIGHT).composite([{ input: m.approvedPlatforms[0] }, { input: m.approvedDecor[0] }]).png().toBuffer())
  const mask = await sharp(m.mask[0]).extractChannel(0).raw().toBuffer()
  let changed = 0, outside = 0
  for (let p = 0; p < W * HEIGHT; p++) {
    const i = p * 4
    let d = 0
    for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(layer[i + c] - approved[i + c]))
    // ±1 — округление наложения: маску считал PIL, слой сводит sharp.
    if (d <= 1) continue
    changed++
    if (!mask[p]) outside++
  }
  console.log(`  против одобренного (платформы + декор approved-maps-v1): изменилось ${changed} пикселей (ступени и удалённый декор), вне changed-mask — ${outside}`)
  if (outside) fail(`слой карты ${m.id} отличается от одобренного вне разрешённой маски: ${outside} пикселей.`)
  const g = geometryCheck(layer, W, rows)
  console.log(`  твердь '#': ${g.solidCells} клеток; с просветами внутри массива — ${g.thinInner.length}; нижних клеток, закрытых меньше чем на 45% — ${g.thinEdge.length}`)
  if (g.thinInner.length || g.thinEdge.length) fail(`слой карты ${m.id} не закрывает твердь: ${JSON.stringify([...g.thinInner, ...g.thinEdge].slice(0, 8))}`)
  console.log(`  верх поверхности '#': смещение макс ${g.surfaceOffsetMax} px; полки '=': макс ${g.thinOffsetMax} px; воздух закрыт камнем больше чем на 90% — ${g.airBlocked}`)
  // Полки '=' болота — одобренные бревенчатые доски (approved-platforms-v1): верх
  // бревна в среднем на ~5 px ниже линии клетки, у скруглённых концов ниже. Это
  // вид одобренного арта, поэтому стоп только по '#'; полки — в отчёт.
  if (g.surfaceOffsetMax > 2) fail(`верх опорной поверхности '#' карты ${m.id} не на линии тайла.`)
  if (g.airBlocked) fail(`на карте ${m.id} камень закрывает клетки воздуха ${JSON.stringify(g.airBlockedList)}.`)
  // Части по ширине. Обычное сжатие с потерями на этой текстуре (корни, мох)
  // даёт лишь 31–35 дБ даже на q98 — цвет у него прорежен вдвое. Поэтому для
  // болота качество не ниже «почти без потерь 40» (~41 дБ, как у слоя D): частей
  // столько, чтобы КАЖДАЯ в нём влезла в MAP_LAYER_MAX и была не шире
  // TEXTURE_MAX_SIDE. Ширина части кратна клетке.
  const ladder = [['без потерь', { lossless: true, effort: 6 }], ['почти без потерь 60', { nearLossless: true, quality: 60, effort: 6 }], ['почти без потерь 40', { nearLossless: true, quality: 40, effort: 6 }]]
  let slices = null
  for (let n = Math.ceil(W / TEXTURE_MAX_SIDE); !slices; n++) {
    if (n > 8) fail(`слой карты ${m.id} не уложился в ${kb(MAP_LAYER_MAX)} на часть и при 8 частях`)
    const cellsPer = Math.ceil(W / TILE / n)
    const tryParts = []
    for (let k = 0, x = 0; x < W; k++, x += cellsPer * TILE) {
      const width = Math.min(cellsPer * TILE, W - x)
      const png = await sharp(layerPng).extract({ left: x, top: 0, width, height: HEIGHT }).png().toBuffer()
      const rawPart = await raw(png)
      let pick = null
      for (const [label, opts] of ladder) {
        const buf = await sharp(png).webp(opts).toBuffer()
        if (buf.length <= MAP_LAYER_MAX) { pick = { label, buf, psnr: psnr(rawPart, await raw(buf)).psnr }; break }
      }
      if (!pick) { console.log(`  ${n} част.: часть ${k + 1} (${width} px) не влезает — режем мельче`); tryParts.length = 0; break }
      tryParts.push({ x, width, png, rawPart, webp: pick.buf, quality: pick.label, psnr: pick.psnr })
    }
    if (tryParts.length) slices = tryParts.map((s, k) => ({ ...s, file: m.file.replace(/\.txt$/, '') + (tryParts.length > 1 ? `_${k + 1}` : '') + '.webp' }))
  }
  for (const s of slices) console.log(`  — ${s.file}: x ${s.x}..${s.x + s.width - 1}, ${s.width}×${HEIGHT}, «${s.quality}», ${mb(s.webp.length)}, PSNR ${s.psnr} дБ`)
  if (slices.length > 1) {
    // Стык: пиксели частей, положенных встык, — ровно исходный слой (до сжатия).
    let bad = 0
    for (const s of slices) for (let y = 0; y < HEIGHT; y++) if (Buffer.compare(s.rawPart.subarray(y * s.width * 4, (y + 1) * s.width * 4), layer.subarray((y * W + s.x) * 4, (y * W + s.x + s.width) * 4)) !== 0) bad++
    if (bad) fail(`части слоя ${m.id}, положенные встык, не дают исходный слой (${bad} строк).`)
    // После сжатия: ошибка у стыка (по 2 столбца с каждой стороны) не больше, чем по части в целом.
    let seamMax = 0, allMax = 0
    for (const s of slices) {
      const dec = await raw(s.webp)
      for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < s.width; x++) {
        const i = (y * s.width + x) * 4, j = (y * W + s.x + x) * 4
        // Видимый цвет — умноженный на альфу: near-lossless меняет цвет почти
        // прозрачных пикселей, а на экране от него остаётся доля альфы.
        let d = Math.abs(dec[i + 3] - layer[j + 3])
        for (let c = 0; c < 3; c++) d = Math.max(d, Math.round(Math.abs(dec[i + c] * dec[i + 3] - layer[j + c] * layer[j + 3]) / 255))
        allMax = Math.max(allMax, d)
        if ((s.x > 0 && x < 2) || (s.x + s.width < W && x >= s.width - 2)) seamMax = Math.max(seamMax, d)
      }
    }
    console.log(`  стык частей: встык до сжатия — байт в байт; после сжатия у стыка макс ${seamMax}, по слою макс ${allMax}`)
  }
  fs.mkdirSync(`${ART}/game-export/swamp`, { recursive: true })
  fs.writeFileSync(`${ART}/game-export/swamp/${m.file.replace(/\.txt$/, '')}_layer_lossless.png`, layerPng)
  return { ...m, W, HEIGHT, rows, slices, checksum: gridChecksum(rows), changed }
}

async function swampBackgrounds() {
  const out = []
  for (const name of ['far', 'mid']) {
    const src = pin(...SWAMP_BG[name])
    const meta = await sharp(src).metadata()
    const png = await sharp(src).extract({ left: 0, top: SWAMP_BG_CROP_TOP, width: meta.width, height: meta.height - SWAMP_BG_CROP_TOP }).png().toBuffer()
    console.log(`\n== Фон болота, ${name}: ${meta.width}×${meta.height} → обрезка сверху ${SWAMP_BG_CROP_TOP} px → ${meta.width}×${meta.height - SWAMP_BG_CROP_TOP}`)
    const pick = await encodeUnder(png, await raw(png), BACKDROP_MAX, `фон болота ${name}`)
    console.log(`  выбрано «${pick.label}»: ${kb(pick.buf.length)}`)
    out.push({ name, buf: pick.buf, width: meta.width, height: meta.height - SWAMP_BG_CROP_TOP, quality: pick.label })
  }
  return out
}

const maps = [await verifyAndEncode(await (console.log('== Сборки карты A'), buildA())), await verifyAndEncode(await (console.log('\n== Сборки карты F'), buildF()))]
const bgs = await backgrounds()
const swamps = []
for (const m of SWAMP_MAPS) swamps.push(await buildSwamp(m))
const swampBgs = await swampBackgrounds()

if (CHECK_ONLY) { console.log('\n--check: в проект ничего не записано.'); process.exit(0) }

const artDir = path.join(REPO, 'public/assets/maps/art')
fs.mkdirSync(artDir, { recursive: true })
for (const m of maps) fs.writeFileSync(path.join(artDir, m.file.replace(/\.txt$/, '.webp')), m.webp)
for (const b of bgs) fs.writeFileSync(path.join(REPO, `public/assets/maps/backgrounds/bg_graveyard_${b.name}.webp`), b.buf)
for (const m of swamps) for (const s of m.slices) fs.writeFileSync(path.join(artDir, s.file), s.webp)
for (const b of swampBgs) fs.writeFileSync(path.join(REPO, `public/assets/maps/backgrounds/bg_swamp_${b.name}.webp`), b.buf)

const sliceList = (m) => (m.slices.length > 1 ? `, slices: [${m.slices.map((s) => `{ file: '${s.file}', x: ${s.x}, width: ${s.width} }`).join(', ')}]` : '')
const manifest = `// СГЕНЕРИРОВАНО tools/build_map_art.mjs — руками не править, пересобирать скриптом.
//
// Готовые слои платформ и декора карт A, F и болота (B2, C2). gridChecksum —
// контрольная сумма сетки .txt, под которую слой собран: поменяют геометрию карты
// и не пересоберут слой — картинка разойдётся со столкновениями, и игра скажет об
// этом в консоли. slices — слой шире потолка текстуры (4096 px) нарезан по
// ширине: части ставятся встык с x, file тогда — первая часть.
export type MapArtSlice = { file: string; x: number; width: number }
export type MapArtEntry = { file: string; width: number; height: number; gridChecksum: number; slices?: MapArtSlice[] }

export const MAP_ART: Record<string, MapArtEntry> = {
${maps.map((m) => `  '${m.file}': { file: '${m.file.replace(/\.txt$/, '.webp')}', width: ${m.W}, height: ${m.HEIGHT}, gridChecksum: 0x${m.checksum.toString(16).padStart(8, '0')} },`).join('\n')}
${swamps.map((m) => `  '${m.file}': { file: '${m.slices[0].file}', width: ${m.W}, height: ${m.HEIGHT}, gridChecksum: 0x${m.checksum.toString(16).padStart(8, '0')}${sliceList(m)} },`).join('\n')}
}
`
fs.writeFileSync(path.join(REPO, 'src/explore/mapArtManifest.ts'), manifest)

console.log('\n== Записано')
for (const m of maps) console.log(`  public/assets/maps/art/${m.file.replace(/\.txt$/, '.webp')}  ${m.W}×${m.HEIGHT}  ${mb(m.webp.length)}  сжатие: ${m.quality}`)
for (const b of bgs) console.log(`  public/assets/maps/backgrounds/bg_graveyard_${b.name}.webp  ${b.width}×${b.height}  ${kb(b.buf.length)}  сжатие: ${b.quality}`)
for (const m of swamps) for (const s of m.slices) console.log(`  public/assets/maps/art/${s.file}  ${s.width}×${m.HEIGHT} (x ${s.x})  ${mb(s.webp.length)}  сжатие: ${s.quality}`)
for (const b of swampBgs) console.log(`  public/assets/maps/backgrounds/bg_swamp_${b.name}.webp  ${b.width}×${b.height}  ${kb(b.buf.length)}  сжатие: ${b.quality}`)
console.log('  src/explore/mapArtManifest.ts')
console.log(`  слои без потерь и сверка: ${EXPORT}, ${ART}/game-export/swamp`)
