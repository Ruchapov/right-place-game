// Готовые слои карт склепа (B, D_OPEN, D_SEALED) и литейной (E) — из одобренных
// исходников архива арта, и фоны обеих тем.
//
//   node tools/build_map_art_crypt_foundry.mjs           собрать, сверить, записать в public/ и src/
//   node tools/build_map_art_crypt_foundry.mjs --check   только собрать и сверить, в проект ничего не писать
//
// Карты A и F собирает другой скрипт — tools/build_map_art.mjs; этот их не трогает
// и пишет свой манифест (src/explore/mapArtManifestCryptFoundry.ts).
//
// ОТКУДА БЕРЁТ. Архив арта ВНЕ репозитория (D:\dev\right-place-art, переменная
// RIGHT_PLACE_ART), его ведёт Codex. Источники — замороженные одобренные версии:
//   склеп     maps/crypt/approved_v2 (12.10.2026): export/<карта>/platforms.png
//             (платформы и опора) + decor.png; фоны export/backgrounds/;
//   литейная  maps/abbey/approved_v3 (15.10.2026): maps/<карта>/map-<карта>-platforms.png
//             + map-<карта>-decor.png; фоны approved-backgrounds-v1/.
// Контрольная сумма каждого исходника записана ниже: архив поменяли — скрипт
// остановится, а не соберёт молча другую картинку.
//
// ⚠️ Карта C (литейная) здесь НАМЕРЕННО отсутствует: в approved_v3 висящая
// колонна-стенка x=42 нарисована на 25 px левее своей клетки столкновений
// (одобренный сдвиг, правила литейной). Решение Андрея 19.10.2026: ждать новой
// версии от Codex, где колонна стоит на сетке, и до неё C рисуется старой
// плиткой. Придёт версия — добавить C в MAPS ниже (слой = платформы + колонны +
// декор, у её опоры x=27 — клетки воздуха в allowCovered), и проверка сетки
// сама скажет, сошлось ли.
//
// ЧТО ПРОВЕРЯЕТ (и падает, если хоть что-то не сошлось):
//   1. исходники — те самые замороженные файлы (sha256);
//   2. слой, положенный на фон предпросмотра, даёт одобренную картинку. Фон
//      предпросмотра — оба слоя, ужатые до высоты карты, плиткой от x=0, и вуаль
//      (так их собирали скрипты Codex). Codex уменьшал в Python (PIL), здесь —
//      sharp; программы дают разницу до 9 единиц из 255 (замер 19.10.2026: 99.96%
//      пикселей — не больше 2). Поэтому камень и декор (непрозрачные пиксели
//      слоя) сверяются строго, ±1, а где сквозь слой виден фон — с допуском;
//   3. слой против сетки столкновений — та же проверка, что у A и F в
//      build_map_art.mjs (своя копия: тот скрипт этой задачей не трогается).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

sharp.cache(false)
sharp.concurrency(1)

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ART = (process.env.RIGHT_PLACE_ART ?? 'D:/dev/right-place-art').replaceAll('\\', '/')
const CRYPT = `${ART}/maps/crypt/approved_v2`
const ABBEY = `${ART}/maps/abbey`
const CHECK_ONLY = process.argv.includes('--check')
const TILE = 64
// Потолки размера файлов — в байтах, по строгому (десятичному) счёту мегабайта; те же, что у A и F.
const MAP_LAYER_MAX = 1_500_000
const BACKDROP_MAX = 600_000
// Сверка с одобренной картинкой: непрозрачный пиксель слоя — не больше 1 единицы
// (округление при сведении декора с платформами); там, где виден фон, — не больше
// BG_TOLERANCE и не больше BG_OVER2_SHARE пикселей с разницей больше 2.
const BG_TOLERANCE = 12
const BG_OVER2_SHARE = 0.002

/**
 * Темы: фон и вуаль предпросмотров. Высота картинки фона в игре — решение
 * Андрея 19.10.2026: по самой высокой карте темы (склеп — D, 1792; литейная —
 * C, 1664). Это ровно плотность предпросмотра этой карты; на остальных фон
 * ужимается видеокартой.
 */
const THEMES = {
  flooded_crypt: {
    exportDir: `${ART}/game-export/crypt/game-build`,
    veilAlpha: 107,
    height: 1792,
    far: { file: `${CRYPT}/export/backgrounds/crypt-far.png`, sha: 'd02f3b23218275f4eda1ba7b24075db7cd841ba955319f71c30ede5da321b8db' },
    mid: { file: `${CRYPT}/export/backgrounds/crypt-near.png`, sha: '0a222e0582b870329b0e968aeeed8e907cd1e656dd1b40fa691591a666ab3dd6' },
  },
  foundry: {
    exportDir: `${ART}/game-export/abbey/game-build`,
    // Правило литейной: «Актуальная вуаль предпросмотров C/E и переноса в игру:
    // RGBA(24,22,30,150)». Старый background-settings.json фонов пишет 107 — он
    // старше этого правила; одобренные C и E собраны со 150.
    veilAlpha: 150,
    height: 1664,
    far: { file: `${ABBEY}/approved-backgrounds-v1/abbey-far.png`, sha: '2628ff2bb93c5d9f691c544dc9b12db31b3349bc6ffbde1e0424606eaf61d0e9' },
    mid: { file: `${ABBEY}/approved-backgrounds-v1/abbey-near.png`, sha: 'fd8d2d644d5540565a3b46c18d0e43e051af28f3a4f95300b2d753bb92e434ed' },
  },
}

/**
 * Карты. parts — слои снизу вверх, full — одобренная картинка. hero — рамка
 * фигурки героя на одобренной картинке склепа (её там нарисовали под декором),
 * в сверке не участвует. allowCovered — клетки воздуха, которые законно закрыты
 * камнем больше чем на 90% (опора — декор без столкновений); у этих четырёх карт
 * таких нет.
 */
const MAPS = [
  {
    id: 'B', file: 'map_B_razlom.txt', theme: 'flooded_crypt',
    parts: [
      { file: `${CRYPT}/export/B/platforms.png`, sha: 'c7fc885dc49a9549cd076b2da5107ac324739360a686cdbec022a7191888ce13' },
      { file: `${CRYPT}/export/B/decor.png`, sha: 'a367fbf83fc327e3e989da253da47618b5113b9068f8c1e1d1e7fe9372044026' },
    ],
    full: { file: `${CRYPT}/B/full.png`, sha: 'f1cc14a655e71c10bdd2a58add82c298f8b47892f370c0d709726387a78b5bdf' },
    hero: [320, 506, 91, 134],
    allowCovered: [],
  },
  {
    id: 'D_OPEN', file: 'map_D_OPEN.txt', theme: 'flooded_crypt',
    parts: [
      { file: `${CRYPT}/export/D_OPEN/platforms.png`, sha: 'b073fceaae279a04bb40e38deb210400f90537381ca0c84192a2ab38916ff186' },
      { file: `${CRYPT}/export/D_OPEN/decor.png`, sha: '34ab1d2c10484abe6222b27b4e640d456787d2bcaf7066f662fceaf75a739418' },
    ],
    full: { file: `${CRYPT}/D_OPEN/full.png`, sha: '70f8677669a3675646068de36dd3901e97fa0038834b744d0f6ee85c0a178a70' },
    hero: [384, 762, 91, 134],
    allowCovered: [],
  },
  {
    id: 'D_SEALED', file: 'map_D_SEALED.txt', theme: 'flooded_crypt',
    parts: [
      { file: `${CRYPT}/export/D_SEALED/platforms.png`, sha: '68bbf6b1e36d807ceab647171df7137594f0e844192d128084a7054ccc0f3981' },
      // Декор у OPEN и SEALED — один и тот же файл (так в approved_v2).
      { file: `${CRYPT}/export/D_SEALED/decor.png`, sha: '34ab1d2c10484abe6222b27b4e640d456787d2bcaf7066f662fceaf75a739418' },
    ],
    full: { file: `${CRYPT}/D_SEALED/full.png`, sha: '3e591b359750d4ae0e979485950fb7356dd6532ab868e1a83a6557d8d6d62894' },
    hero: [384, 762, 91, 134],
    allowCovered: [],
  },
  {
    // Опоры на E нет: map-E-support.png в approved_v3 полностью прозрачный.
    id: 'E', file: 'map_E_towers.txt', theme: 'foundry',
    parts: [
      { file: `${ABBEY}/approved_v3/maps/E/map-E-platforms.png`, sha: 'a96eb67e36bc108f1037ee1ea423a5d165b0e96c9be3885f90556e8803467690' },
      { file: `${ABBEY}/approved_v3/maps/E/map-E-decor.png`, sha: 'f3928b0f69e54114f21e0e2fcd5420a47b99887ff23c704367f75e5710957eec' },
    ],
    full: { file: `${ABBEY}/approved_v3/maps/E/map-E-full.png`, sha: '3c8355ab88b6eeab1d837aef8a344b43ebe60f94be4ab4051d9044c03bd08731' },
    hero: null,
    allowCovered: [],
  },
]

const blank = (w, h, bg = '#00000000') => sharp({ create: { width: w, height: h, channels: 4, background: bg } })
const raw = (input) => sharp(input).ensureAlpha().raw().toBuffer()
const pngOf = (buf, w, h) => sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
const fail = (msg) => { console.error('\nСТОП: ' + msg); process.exit(1) }
const mb = (n) => (n / 1048576).toFixed(2) + ' МиБ'
const kb = (n) => Math.round(n / 1024) + ' КБ'

function pinned({ file, sha }) {
  if (!fs.existsSync(file)) fail(`нет исходника ${file}`)
  const got = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  if (got !== sha) fail(`исходник ${file} не тот, что одобрен: sha256 ${got}, ожидался ${sha}`)
  return file
}

/** Фон предпросмотра: оба слоя ужаты до высоты карты, плиткой от x=0, сверху вуаль (24,22,30). */
async function previewBackground(theme, W, H) {
  const ops = []
  for (const layer of [theme.far, theme.mid]) {
    const m = await sharp(layer.file).metadata()
    const w = Math.round((m.width * H) / m.height)
    const b = await sharp(layer.file).resize(w, H, { kernel: 'lanczos3' }).png().toBuffer()
    for (let x = 0; x < W; x += w) {
      const ww = Math.min(w, W - x)
      ops.push({ input: ww < w ? await sharp(b).extract({ left: 0, top: 0, width: ww, height: H }).png().toBuffer() : b, left: x, top: 0 })
    }
  }
  ops.push({ input: { create: { width: W, height: H, channels: 4, background: { r: 24, g: 22, b: 30, alpha: theme.veilAlpha / 255 } } }, left: 0, top: 0 })
  return blank(W, H).composite(ops).png().toBuffer()
}

/** FNV-1a (32 бита) по тексту сетки. Та же функция — в src/explore/mapArt.ts и в build_map_art.mjs. */
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
 * Сверка слоя с сеткой столкновений — копия geometryCheck из build_map_art.mjs.
 * Твердь '#' обязана быть закрыта камнем, верх опорной поверхности — стоять на
 * линии тайла, а в клетках, где герой стоит и идёт, не должно быть сплошного
 * камня, которого нет в столкновениях.
 */
function geometryCheck(layer, W, rows) {
  const HT = rows.length, WT = rows[0].length
  const alpha = (x, y) => layer[(y * W + x) * 4 + 3]
  const at = (x, y) => rows[y]?.[x]
  const solid = (x, y) => at(x, y) === '#'
  let solidCells = 0, worstSolid = 1; const thinInner = [], thinEdge = []
  let surfaces = 0, offMax = 0, offSum = 0; const offHist = {}
  let thinCells = 0, thinOffMax = 0
  let airCells = 0; const airBlockedList = []
  for (let ty = 0; ty < HT; ty++) for (let tx = 0; tx < WT; tx++) {
    const ch = at(tx, ty)
    let opaque = 0
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) if (alpha(tx * TILE + x, ty * TILE + y) >= 128) opaque++
    const cover = opaque / (TILE * TILE)
    if (ch === '#') {
      solidCells++
      if (cover < worstSolid) worstSolid = cover
      // Низ висящего массива (под клеткой тверди нет) может кончаться сколотой кромкой.
      const bottomEdge = !solid(tx, ty + 1)
      if (bottomEdge) { if (cover < 0.45) thinEdge.push([tx, ty, Math.round(cover * 100)]) }
      else if (cover < 0.97) thinInner.push([tx, ty, Math.round(cover * 100)])
    } else {
      airCells++
      if (cover > 0.9) airBlockedList.push([tx, ty, Math.round(cover * 100)])
    }
    if ((ch === '#' || ch === '=') && !solid(tx, ty - 1)) {
      for (let x = 0; x < TILE; x++) {
        let first = TILE
        for (let y = 0; y < TILE; y++) if (alpha(tx * TILE + x, ty * TILE + y) >= 128) { first = y; break }
        if (ch === '#') { surfaces++; offSum += first; offMax = Math.max(offMax, first); offHist[first] = (offHist[first] ?? 0) + 1 }
        else { thinCells++; thinOffMax = Math.max(thinOffMax, first) }
      }
    }
  }
  const topOffsets = Object.entries(offHist).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}px×${v}`)
  return { solidCells, thinInner, thinEdge, worstSolidCover: Math.round(worstSolid * 1000) / 10, surfaceColumns: surfaces, surfaceOffsetMax: offMax, surfaceOffsetMean: Math.round((offSum / Math.max(1, surfaces)) * 100) / 100, topOffsets, thinColumns: thinCells, thinOffsetMax: thinOffMax, airCells, airBlockedList }
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
 * Мелкая деталь: средний модуль лапласиана яркости по непрозрачным пикселям.
 * Отношение «после сжатия / до» заметно меньше 100% — сжатие съело деталь (мыло).
 */
function detail(buf, W, H) {
  const Y = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++) Y[i] = 0.2126 * buf[i * 4] + 0.7152 * buf[i * 4 + 1] + 0.0722 * buf[i * 4 + 2]
  let s = 0, n = 0
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x
    if (buf[i * 4 + 3] < 250 || buf[(i - 1) * 4 + 3] < 250 || buf[(i + 1) * 4 + 3] < 250 || buf[(i - W) * 4 + 3] < 250 || buf[(i + W) * 4 + 3] < 250) continue
    s += Math.abs(4 * Y[i] - Y[i - 1] - Y[i + 1] - Y[i - W] - Y[i + W]); n++
  }
  return s / Math.max(1, n)
}

/**
 * Самое качественное сжатие, которое укладывается в потолок размера (та же
 * лестница, что у A и F). Берётся ПЕРВОЕ подходящее, следующее печатается для
 * сравнения. Альфа у вариантов с потерями хранится без потерь.
 */
async function encodeUnder(png, original, W, H, maxBytes, what) {
  const ladder = [
    ['без потерь', { lossless: true, effort: 6 }],
    ['почти без потерь 60', { nearLossless: true, quality: 60, effort: 6 }],
    ['почти без потерь 40', { nearLossless: true, quality: 40, effort: 6 }],
    ...[98, 96, 94, 92, 90, 88, 86, 82].map((q) => [`q${q}`, { quality: q, alphaQuality: 100, effort: 6, smartSubsample: true }]),
  ]
  const d0 = detail(original, W, H)
  let pick = null
  for (const [label, opts] of ladder) {
    const buf = await sharp(png).webp(opts).toBuffer()
    const dec = await raw(buf)
    const q = psnr(original, dec)
    const det = Math.round((1000 * detail(dec, W, H)) / d0) / 10
    const fits = buf.length <= maxBytes
    console.log(`  ${label}: ${kb(buf.length)}, PSNR ${q.psnr} дБ, альфа ±${q.alphaMaxDiff}, деталь ${det}%${fits ? '' : ' — не влезает'}`)
    if (!pick && fits) { pick = { label, buf, psnr: q.psnr, alphaMaxDiff: q.alphaMaxDiff, detail: det }; continue }
    if (pick) break
  }
  if (!pick) fail(`${what}: не уместился в ${kb(maxBytes)} ни в одном варианте сжатия`)
  return pick
}

/** Фрагмент «до | после сжатия» в 2× (ближайший сосед) — для глаза. Окно — где больше всего непрозрачного. */
async function fragment(beforePng, afterWebp, W, H, out, onDark) {
  const FW = 420, FH = 300
  const a = await raw(beforePng)
  let best = null
  for (let y = 0; y + FH <= H; y += 64) for (let x = 0; x + FW <= W; x += 64) {
    let n = 0
    for (let yy = y; yy < y + FH; yy += 6) for (let xx = x; xx < x + FW; xx += 6) if (a[(yy * W + xx) * 4 + 3] > 250) n++
    if (!best || n > best.n) best = { n, x, y }
  }
  const box = { left: best.x, top: best.y, width: FW, height: FH }
  const crop = async (input) => {
    let b = await sharp(input).extract(box).png().toBuffer()
    if (onDark) b = await blank(FW, FH, '#27272d').composite([{ input: b }]).png().toBuffer()
    return sharp(b).resize(FW * 2, FH * 2, { kernel: 'nearest' }).png().toBuffer()
  }
  await blank(FW * 4 + 12, FH * 2, '#ff00ff').composite([{ input: await crop(beforePng), left: 0, top: 0 }, { input: await crop(afterWebp), left: FW * 2 + 12, top: 0 }]).png().toFile(out)
  return box
}

// ---------------------------------------------------------------------------

const report = { built: new Date().toISOString(), maps: [], backgrounds: [] }

async function buildMap(m) {
  const theme = THEMES[m.theme]
  console.log(`\n== Карта ${m.id} (${m.file}, тема ${m.theme})`)
  for (const p of [...m.parts, m.full]) pinned(p)
  const fullMeta = await sharp(m.full.file).metadata()
  const W = fullMeta.width, H = fullMeta.height
  const rows = readGrid(m.file)
  if (rows[0].length * TILE !== W || rows.length * TILE !== H) fail(`размер одобренной картинки ${W}×${H} не равен сетке ${rows[0].length}×${rows.length} тайлов`)
  for (const p of m.parts) {
    const pm = await sharp(p.file).metadata()
    if (pm.width !== W || pm.height !== H) fail(`${p.file}: ${pm.width}×${pm.height}, а карта ${W}×${H}`)
  }
  // Слой игры: части по порядку, без фона и без героя.
  const layerPng = await blank(W, H).composite(m.parts.map((p) => ({ input: p.file, left: 0, top: 0 }))).png().toBuffer()
  const layer = await raw(layerPng)

  // (2) слой на фоне предпросмотра против одобренной картинки
  const bg = await previewBackground(theme, W, H)
  const composed = await raw(await sharp(bg).composite([{ input: layerPng, left: 0, top: 0 }]).png().toBuffer())
  const approved = await raw(m.full.file)
  let opaque = 0, opaqueDiff = 0, opaqueMax = 0, seen = 0, seenMax = 0, seenOver2 = 0, heroSkipped = 0
  for (let p = 0; p < W * H; p++) {
    const x = p % W, y = (p - x) / W
    if (m.hero && x >= m.hero[0] - 2 && x < m.hero[0] + m.hero[2] + 2 && y >= m.hero[1] - 2 && y < m.hero[1] + m.hero[3] + 2) { heroSkipped++; continue }
    const i = p * 4
    let d = 0
    for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(composed[i + c] - approved[i + c]))
    if (layer[i + 3] === 255) { opaque++; if (d) opaqueDiff++; opaqueMax = Math.max(opaqueMax, d) }
    else { seen++; seenMax = Math.max(seenMax, d); if (d > 2) seenOver2++ }
  }
  console.log(`  против одобренной картинки: камень и декор (${opaque} пикселей) — отличается ${opaqueDiff}, максимум ${opaqueMax}; где виден фон (${seen}) — максимум ${seenMax}, больше 2 у ${seenOver2} (${(100 * seenOver2 / seen).toFixed(3)}%)${m.hero ? `; рамка героя пропущена (${heroSkipped})` : ''}`)
  if (opaqueMax > 1) fail(`слой карты ${m.id} не совпадает с одобренной картинкой в камне и декоре: расхождение до ${opaqueMax}.`)
  if (seenMax > BG_TOLERANCE || seenOver2 > seen * BG_OVER2_SHARE) fail(`слой карты ${m.id}: там, где виден фон, расхождение больше допуска разницы программ (макс ${seenMax}, больше 2 у ${seenOver2}).`)

  // (3) слой против сетки столкновений
  const g = geometryCheck(layer, W, rows)
  console.log(`  твердь '#': ${g.solidCells} клеток; с просветами внутри массива — ${g.thinInner.length}${g.thinInner.length ? ' ' + JSON.stringify(g.thinInner.slice(0, 12)) : ''}; нижних клеток, закрытых меньше чем на 45% — ${g.thinEdge.length}; наименьшее покрытие ${g.worstSolidCover}%`)
  if (g.thinInner.length || g.thinEdge.length) fail(`слой карты ${m.id} не закрывает твердь.`)
  console.log(`  верх поверхности '#': ${g.surfaceColumns} столбцов, смещение от линии тайла — макс ${g.surfaceOffsetMax} px, среднее ${g.surfaceOffsetMean} px (${g.topOffsets.join(', ')})`)
  console.log(`  полки '=': ${g.thinColumns} столбцов, смещение верха макс ${g.thinOffsetMax} px`)
  if (g.surfaceOffsetMax > 2 || g.thinOffsetMax > 2) fail(`верх опорной поверхности карты ${m.id} не на линии тайла.`)
  const allowed = new Set(m.allowCovered.map(([x, y]) => `${x},${y}`))
  const blocked = g.airBlockedList.filter(([x, y]) => !allowed.has(`${x},${y}`))
  console.log(`  воздух: ${g.airCells} клеток, закрыто камнем больше чем на 90% — ${g.airBlockedList.length}${g.airBlockedList.length ? ' ' + JSON.stringify(g.airBlockedList) : ''}`)
  if (blocked.length) fail(`на карте ${m.id} камень закрывает клетки воздуха ${JSON.stringify(blocked)} — герой пройдёт сквозь нарисованный камень.`)

  // Сжатие. Альфа без потерь: кромка слоя обязана остаться той же.
  const pick = await encodeUnder(layerPng, layer, W, H, MAP_LAYER_MAX, `слой карты ${m.id}`)
  console.log(`  выбрано «${pick.label}»: ${mb(pick.buf.length)} (PNG без потерь — ${mb(layerPng.length)})`)
  const srcBytes = m.parts.reduce((s, p) => s + fs.statSync(p.file).size, 0)
  return { ...m, W, H, rows, layerPng, pick, srcBytes, fidelity: { opaque, opaqueDiff, opaqueMax, seen, seenMax, seenOver2 }, geometry: g }
}

async function buildBackground(themeId, name) {
  const theme = THEMES[themeId]
  const src = pinned(theme[name])
  const m = await sharp(src).metadata()
  const w = Math.round((m.width * theme.height) / m.height)
  console.log(`\n== Фон ${themeId}, ${name}: ${m.width}×${m.height} → ${w}×${theme.height}, исходник ${mb(fs.statSync(src).size)}`)
  const png = await sharp(src).resize(w, theme.height, { kernel: 'lanczos3' }).png().toBuffer()
  const pick = await encodeUnder(png, await raw(png), w, theme.height, BACKDROP_MAX, `фон ${themeId} ${name}`)
  console.log(`  выбрано «${pick.label}»: ${kb(pick.buf.length)}`)
  return { themeId, name, src, srcW: m.width, srcH: m.height, srcBytes: fs.statSync(src).size, W: w, H: theme.height, png, pick }
}

const maps = []
for (const m of MAPS) maps.push(await buildMap(m))
const bgs = []
for (const themeId of Object.keys(THEMES)) for (const name of ['far', 'mid']) bgs.push(await buildBackground(themeId, name))

// Слои без потерь, фрагменты «до/после» и отчёт — в рабочую папку экспорта, вне репозитория.
for (const t of Object.values(THEMES)) fs.mkdirSync(t.exportDir, { recursive: true })
for (const m of maps) {
  const dir = THEMES[m.theme].exportDir
  const stem = m.file.replace(/\.txt$/, '')
  fs.writeFileSync(`${dir}/${stem}_layer_lossless.png`, m.layerPng)
  const box = await fragment(m.layerPng, m.pick.buf, m.W, m.H, `${dir}/compress_${stem}_before_after.png`, true)
  report.maps.push({ id: m.id, file: m.file, size: [m.W, m.H], sourcePngBytes: m.srcBytes, losslessPngBytes: m.layerPng.length, webpBytes: m.pick.buf.length, quality: m.pick.label, psnr: m.pick.psnr, alphaMaxDiff: m.pick.alphaMaxDiff, detailPercent: m.pick.detail, fragmentBox: box, fidelity: m.fidelity, gridChecksum: '0x' + gridChecksum(m.rows).toString(16).padStart(8, '0') })
}
for (const b of bgs) {
  const dir = THEMES[b.themeId].exportDir
  const box = await fragment(b.png, b.pick.buf, b.W, b.H, `${dir}/compress_bg_${b.themeId}_${b.name}_before_after.png`, false)
  report.backgrounds.push({ theme: b.themeId, layer: b.name, source: b.src, sourceSize: [b.srcW, b.srcH], sourcePngBytes: b.srcBytes, size: [b.W, b.H], webpBytes: b.pick.buf.length, quality: b.pick.label, psnr: b.pick.psnr, detailPercent: b.pick.detail, fragmentBox: box })
}
for (const t of Object.keys(THEMES)) {
  fs.writeFileSync(`${THEMES[t].exportDir}/report.json`, JSON.stringify({ built: report.built, maps: report.maps.filter((m) => MAPS.find((x) => x.id === m.id).theme === t), backgrounds: report.backgrounds.filter((b) => b.theme === t) }, null, 2))
}

if (CHECK_ONLY) { console.log('\n--check: в проект ничего не записано (отчёт и фрагменты — в game-export).'); process.exit(0) }

const artDir = path.join(REPO, 'public/assets/maps/art')
fs.mkdirSync(artDir, { recursive: true })
for (const m of maps) fs.writeFileSync(path.join(artDir, m.file.replace(/\.txt$/, '.webp')), m.pick.buf)
for (const b of bgs) fs.writeFileSync(path.join(REPO, `public/assets/maps/backgrounds/bg_${b.themeId}_${b.name}.webp`), b.pick.buf)

const manifest = `// СГЕНЕРИРОВАНО tools/build_map_art_crypt_foundry.mjs — руками не править, пересобирать скриптом.
//
// Готовые слои платформ и декора карт склепа (B, D_OPEN, D_SEALED) и литейной (E).
// Слои карт A и F — в mapArtManifest.ts (их собирает tools/build_map_art.mjs).
// gridChecksum — контрольная сумма сетки .txt, под которую слой собран: поменяют
// геометрию карты и не пересоберут слой — картинка разойдётся со столкновениями,
// и игра скажет об этом в консоли.
import type { MapArtEntry } from './mapArtManifest'

export const MAP_ART_CRYPT_FOUNDRY: Record<string, MapArtEntry> = {
${maps.map((m) => `  '${m.file}': { file: '${m.file.replace(/\.txt$/, '.webp')}', width: ${m.W}, height: ${m.H}, gridChecksum: 0x${gridChecksum(m.rows).toString(16).padStart(8, '0')} },`).join('\n')}
}
`
fs.writeFileSync(path.join(REPO, 'src/explore/mapArtManifestCryptFoundry.ts'), manifest)

console.log('\n== Записано')
for (const m of maps) console.log(`  public/assets/maps/art/${m.file.replace(/\.txt$/, '.webp')}  ${m.W}×${m.H}  ${mb(m.pick.buf.length)}  сжатие: ${m.pick.label}`)
for (const b of bgs) console.log(`  public/assets/maps/backgrounds/bg_${b.themeId}_${b.name}.webp  ${b.W}×${b.H}  ${kb(b.pick.buf.length)}  сжатие: ${b.pick.label}`)
console.log('  src/explore/mapArtManifestCryptFoundry.ts')
console.log(`  слои без потерь, фрагменты и отчёт: ${Object.values(THEMES).map((t) => t.exportDir).join(', ')}`)
