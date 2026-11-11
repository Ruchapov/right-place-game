// Готовые слои шести новых карт (10.11.2026) — из пакета передачи Codex.
//
//   node tools/build_map_art_new_six.mjs B D F         собрать, сверить, записать в public/ и src/
//   node tools/build_map_art_new_six.mjs --check B D F только собрать и сверить, ничего не писать
//
// Без букв — все карты скрипта. Собранные карты ЗАМЕНЯЮТ свои строки в манифесте,
// строки остальных карт остаются как были.
//
// С 11.11.2026 здесь же две болотные карты W (swamp-well) и Y (swamp-yards) —
// пакет maps/swamp/new-two/handoff-2026-11 (тот же формат; высота фона и
// прозрачность ближнего слоя у него в render-config.backgrounds[]).
//
// ОТКУДА. Пакет maps/new-six/handoff-six-maps-2026-11-10 архива арта
// (D:\dev\right-place-art, переменная RIGHT_PLACE_ART); его ведёт Codex, сюда он
// не пишет. Все входы сверяются с manifest.json пакета (sha256): пакет поменяли —
// скрипт остановится.
//
// ЧТО. В игру идёт world-overlay.png (platforms + decor одной картинкой) — без
// изменений, 64 px на тайл. Слой шире 4096 px (потолок текстуры телефона) режется
// по ширине на части, кратные клетке, ДО сжатия — как болото C2
// (build_map_art.mjs). Сжатие: без потерь → почти без потерь 60 → 40; частей
// столько, чтобы каждая влезла в MAP_LAYER_MAX и была не шире 4096. PSNR каждой
// части печатается; ниже 40 дБ — стоп.
//
// ФОН. background-far/mid.webp пакета байт в байт совпадают с фонами тем в игре
// (bg_<тема>_far/mid.webp) — скрипт это сверяет и файлы не копирует. По карте
// берутся из render-config.json высота фона в мире (staticBackgroundHeight) и
// вуаль (veilRGBA); они идут в манифест полем backdrop.
//
// ПРОВЕРКИ: размер слоя = сетка × 64; сетка .txt в игре = сетка пакета; слой
// против сетки (твердь закрыта, верх '#' на линии тайла — geometryCheck, как в
// build_map_art.mjs, — в отчёт); части встык = исходный слой байт в байт; ошибка
// у стыка после сжатия не больше, чем по части.
import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

sharp.cache(false)
sharp.concurrency(1)

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ART = (process.env.RIGHT_PLACE_ART ?? 'D:/dev/right-place-art').replaceAll('\\', '/')
const PACK_SIX = `${ART}/maps/new-six/handoff-six-maps-2026-11-10`
const PACK_SWAMP = `${ART}/maps/swamp/new-two/handoff-2026-11`
const CHECK_ONLY = process.argv.includes('--check')
const TILE = 64
const TEXTURE_MAX_SIDE = 4096
const MAP_LAYER_MAX = 1_500_000
const PSNR_MIN = 40
// буква → ключ пакета и тема (BACKDROP_BY_MAP, src/explore/constants.ts)
const MAPS = {
  A: { key: 'burial-quarter', theme: 'graveyard' },
  B: { key: 'procession', theme: 'graveyard' },
  C: { key: 'casting-yards', theme: 'foundry' },
  D: { key: 'workshops', theme: 'foundry' },
  E: { key: 'three-halls', theme: 'flooded_crypt' },
  F: { key: 'eastern-stair', theme: 'flooded_crypt' },
  W: { key: 'swamp-well', theme: 'swamp', pack: PACK_SWAMP },
  Y: { key: 'swamp-yards', theme: 'swamp', pack: PACK_SWAMP },
}

function fail(msg) { console.error(`\nСТОП: ${msg}`); process.exit(1) }
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const manifests = {}
function pinned(rel, pack = PACK_SIX) {
  const file = `${pack}/${rel}`
  manifests[pack] ??= JSON.parse(fs.readFileSync(`${pack}/manifest.json`, 'utf8'))
  if (!fs.existsSync(file)) fail(`нет файла пакета ${file}`)
  if (manifests[pack][rel] !== sha(file)) fail(`файл пакета ${rel} не тот, что в manifest.json`)
  return file
}
const raw = (input) => sharp(input).ensureAlpha().raw().toBuffer()
const mb = (n) => (n / 1_000_000).toFixed(2) + ' МБ'

function gridChecksum(rows) {
  let h = 0x811c9dc5
  const text = rows.join('\n')
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h >>> 0
}
const gridRows = (text) => text.split(/\r?\n/).filter((r) => r.length > 0)

function psnr(a, b) {
  let se = 0, n = 0, alphaMax = 0
  for (let i = 0; i < a.length; i += 4) {
    alphaMax = Math.max(alphaMax, Math.abs(a[i + 3] - b[i + 3]))
    if (a[i + 3] < 8) continue
    for (let c = 0; c < 3; c++) { const d = a[i + c] - b[i + c]; se += d * d }
    n += 3
  }
  const mse = se / Math.max(1, n)
  return mse === 0 ? Infinity : Math.round(10 * Math.log10(255 * 255 / mse) * 100) / 100
}

/** Слой против сетки — та же сверка, что geometryCheck в build_map_art.mjs. */
function geometryCheck(layer, W, rows) {
  const HT = rows.length, WT = rows[0].length
  const alpha = (x, y) => layer[(y * W + x) * 4 + 3]
  const at = (x, y) => rows[y]?.[x]
  let thinInner = 0, thinEdge = 0, surfOff = 0, thinOff = 0, airBlocked = 0
  for (let ty = 0; ty < HT; ty++) for (let tx = 0; tx < WT; tx++) {
    const ch = at(tx, ty)
    let opaque = 0
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) if (alpha(tx * TILE + x, ty * TILE + y) >= 128) opaque++
    const cover = opaque / (TILE * TILE)
    if (ch === '#') {
      if (at(tx, ty + 1) !== '#') { if (cover < 0.45) thinEdge++ } else if (cover < 0.97) thinInner++
    } else if (cover > 0.9) airBlocked++
    if ((ch === '#' || ch === '=') && at(tx, ty - 1) !== '#') {
      for (let x = 0; x < TILE; x++) {
        let first = TILE
        for (let y = 0; y < TILE; y++) if (alpha(tx * TILE + x, ty * TILE + y) >= 128) { first = y; break }
        if (ch === '#') surfOff = Math.max(surfOff, first); else thinOff = Math.max(thinOff, first)
      }
    }
  }
  return { thinInner, thinEdge, surfOff, thinOff, airBlocked }
}

async function buildMap(letter) {
  const { key, theme, pack = PACK_SIX } = MAPS[letter]
  const file = `map_${letter}_${key}.txt`
  console.log(`\n== ${letter} — ${key} (${file})`)
  const overlay = pinned(`${key}/world-overlay.png`, pack)
  const config = JSON.parse(fs.readFileSync(pinned(`${key}/render-config.json`, pack), 'utf8'))
  const packRows = gridRows(fs.readFileSync(pinned(`${key}/${key}.txt`, pack), 'utf8'))
  const rows = gridRows(fs.readFileSync(path.join(REPO, 'public/assets/maps', file), 'utf8'))
  if (rows.join('\n') !== packRows.join('\n')) fail(`сетка ${file} в игре не совпадает с ${key}.txt пакета`)
  if (config.theme !== theme) fail(`тема ${key} в пакете ${config.theme}, в скрипте ${theme}`)
  for (const layer of ['far', 'mid']) {
    const game = path.join(REPO, `public/assets/maps/backgrounds/bg_${theme}_${layer}.webp`)
    if (sha(pinned(`${key}/background-${layer}.webp`, pack)) !== sha(game)) fail(`фон ${key}/background-${layer}.webp не совпадает с ${path.basename(game)} — нужен свой файл фона`)
  }
  const meta = await sharp(overlay).metadata()
  const W = meta.width, H = meta.height
  if (W !== rows[0].length * TILE || H !== rows.length * TILE) fail(`слой ${W}×${H}, а сетка ${rows[0].length}×${rows.length} тайлов`)
  const layer = await raw(overlay)
  const g = geometryCheck(layer, W, rows)
  console.log(`  слой ${W}×${H}; против сетки: просветы в тверди ${g.thinInner}, тонкая нижняя кромка ${g.thinEdge}, верх '#' макс ${g.surfOff} px, верх '=' макс ${g.thinOff} px, воздух закрыт камнем ${g.airBlocked}`)
  if (g.surfOff > 2) fail(`верх опорной поверхности '#' карты ${letter} не на линии тайла (${g.surfOff} px)`)

  const ladder = [['без потерь', { lossless: true, effort: 6 }], ['почти без потерь 60', { nearLossless: true, quality: 60, effort: 6 }], ['почти без потерь 40', { nearLossless: true, quality: 40, effort: 6 }]]
  let slices = null
  for (let n = Math.ceil(W / TEXTURE_MAX_SIDE); !slices; n++) {
    if (n > 16) fail(`слой ${letter} не уложился в ${mb(MAP_LAYER_MAX)} на часть и при 16 частях`)
    const cellsPer = Math.ceil(W / TILE / n)
    const parts = []
    for (let k = 0, x = 0; x < W; k++, x += cellsPer * TILE) {
      const width = Math.min(cellsPer * TILE, W - x)
      const png = await sharp(overlay).extract({ left: x, top: 0, width, height: H }).png().toBuffer()
      const rawPart = await raw(png)
      let pick = null
      for (const [label, opts] of ladder) {
        const buf = await sharp(png).webp(opts).toBuffer()
        if (buf.length <= MAP_LAYER_MAX) { pick = { label, buf, psnr: psnr(rawPart, await raw(buf)) }; break }
      }
      if (!pick) { console.log(`  ${n} част.: часть ${k + 1} (${width} px) не влезает — режем мельче`); parts.length = 0; break }
      parts.push({ x, width, rawPart, webp: pick.buf, quality: pick.label, psnr: pick.psnr })
    }
    if (parts.length) slices = parts.map((s, k) => ({ ...s, file: `map_${letter}_${key}_${k + 1}.webp` }))
  }
  for (const s of slices) {
    console.log(`  — ${s.file}: x ${s.x}..${s.x + s.width - 1}, ${s.width}×${H}, «${s.quality}», ${mb(s.webp.length)}, PSNR ${s.psnr} дБ`)
    if (s.psnr < PSNR_MIN) fail(`часть ${s.file}: PSNR ${s.psnr} дБ ниже ${PSNR_MIN}`)
  }
  let bad = 0
  for (const s of slices) for (let y = 0; y < H; y++) if (Buffer.compare(s.rawPart.subarray(y * s.width * 4, (y + 1) * s.width * 4), layer.subarray((y * W + s.x) * 4, (y * W + s.x + s.width) * 4)) !== 0) bad++
  if (bad) fail(`части слоя ${letter}, положенные встык, не дают исходный слой (${bad} строк)`)
  let seamMax = 0, allMax = 0
  for (const s of slices) {
    const dec = await raw(s.webp)
    for (let y = 0; y < H; y++) for (let x = 0; x < s.width; x++) {
      const i = (y * s.width + x) * 4, j = (y * W + s.x + x) * 4
      let d = Math.abs(dec[i + 3] - layer[j + 3])
      for (let c = 0; c < 3; c++) d = Math.max(d, Math.round(Math.abs(dec[i + c] * dec[i + 3] - layer[j + c] * layer[j + 3]) / 255))
      allMax = Math.max(allMax, d)
      if ((s.x > 0 && x < 2) || (s.x + s.width < W && x >= s.width - 2)) seamMax = Math.max(seamMax, d)
    }
  }
  console.log(`  стык: встык до сжатия — байт в байт; после сжатия у стыка макс ${seamMax}, по слою макс ${allMax}`)
  if (seamMax > allMax) fail(`ошибка у стыка ${seamMax} больше, чем по слою ${allMax}`)
  const [vr, vg, vb, va] = config.veilRGBA
  // Шесть карт: staticBackgroundHeight и midOpacity; болото new-two: backgrounds[] (renderedSize, opacity).
  const bgs = config.backgrounds
  const worldHeight = config.staticBackgroundHeight ?? bgs?.[0]?.renderedSize?.[1]
  const midAlpha = config.midOpacity ?? bgs?.find((b) => b.file === 'background-mid.webp')?.opacity
  if (!(worldHeight > 0) || !(midAlpha >= 0)) fail(`render-config ${key}: нет высоты фона или прозрачности ближнего слоя`)
  const backdrop = { worldHeight, dimColor: (vr << 16) | (vg << 8) | vb, dimAlpha: va, midAlpha }
  console.log(`  фон: тема ${theme}, высота в мире ${backdrop.worldHeight} px (карта ${H}), вуаль (${vr},${vg},${vb}) ${va}/255, ближний слой ${backdrop.midAlpha}`)
  return { letter, file, W, H, slices, checksum: gridChecksum(rows), backdrop, total: slices.reduce((t, s) => t + s.webp.length, 0) }
}

const letters = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const chosen = letters.length ? letters : Object.keys(MAPS)
for (const l of chosen) if (!MAPS[l]) fail(`нет карты ${l}`)
const built = []
for (const l of chosen) built.push(await buildMap(l))

if (CHECK_ONLY) {
  let differ = 0
  for (const m of built) for (const s of m.slices) {
    const p = path.join(REPO, 'public/assets/maps/art', s.file)
    const same = fs.existsSync(p) && Buffer.compare(fs.readFileSync(p), s.webp) === 0
    if (!same) differ++
    console.log(`  ${s.file}: ${same ? 'совпадает' : 'РАСХОДИТСЯ'}`)
  }
  process.exit(differ ? 1 : 0)
}

const artDir = path.join(REPO, 'public/assets/maps/art')
for (const m of built) for (const s of m.slices) fs.writeFileSync(path.join(artDir, s.file), s.webp)
const hex = (n) => `0x${n.toString(16).padStart(8, '0')}`
const manifestPath = path.join(REPO, 'src/explore/mapArtManifestNewSix.ts')
const builtFiles = new Set(built.map((m) => m.file))
const keptLines = fs.existsSync(manifestPath)
  ? fs.readFileSync(manifestPath, 'utf8').split('\n').filter((l) => /^  'map_[^']+\.txt': /.test(l) && !builtFiles.has(l.match(/^  '([^']+)'/)[1]))
  : []
const ts = `// СГЕНЕРИРОВАНО tools/build_map_art_new_six.mjs — руками не править, пересобирать скриптом.
//
// Готовые слои шести новых карт (10.11.2026, пакет new-six/handoff-six-maps-2026-11-10)
// и болотных W, Y (11.11.2026, пакет swamp/new-two/handoff-2026-11):
// world-overlay.png, нарезанный по ширине (не шире 4096 px), части ставятся встык с x.
// gridChecksum — сумма сетки .txt, под которую собран слой. backdrop — вид фона по
// карте из render-config.json пакета: файлы фона — темы (байт в байт те же),
// высота фона в мире, вуаль (цвет и альфа из 255), прозрачность ближнего слоя.
import type { MapArtEntry } from './mapArtManifest'

export const MAP_ART_NEW_SIX: Record<string, MapArtEntry> = {
${[...keptLines, ...built.map((m) => `  '${m.file}': { file: '${m.slices[0].file}', width: ${m.W}, height: ${m.H}, gridChecksum: ${hex(m.checksum)}, slices: [${m.slices.map((s) => `{ file: '${s.file}', x: ${s.x}, width: ${s.width} }`).join(', ')}], backdrop: { worldHeight: ${m.backdrop.worldHeight}, dimColor: 0x${m.backdrop.dimColor.toString(16).padStart(6, '0')}, dimAlpha: ${m.backdrop.dimAlpha} / 255, midAlpha: ${m.backdrop.midAlpha} } },`)].sort().join('\n')}
}
`
fs.writeFileSync(manifestPath, ts)
console.log('\nЗаписано:')
for (const m of built) console.log(`  ${m.file}: ${m.slices.length} част., всего ${mb(m.total)}`)
console.log('  src/explore/mapArtManifestNewSix.ts')
