// ЛИСТЫ СПРАЙТОВ ПО РАЗМЕРУ ЭКРАНА И ПЛОТНАЯ УПАКОВКА КАДРОВ (16.11.2026).
// docs/explore-engine.md, «Видеопамять забега»; docs/art-pipeline.md.
//
//   node tools/make_sprite_res.mjs --archive   — один раз: скопировать полноразмерные
//                                                оригиналы из public/ в архив арта
//   node tools/make_sprite_res.mjs [фильтр]    — пересобрать листы из оригиналов
//                                                (фильтр — подстрока пути) и манифест
//   node tools/make_sprite_res.mjs --check     — только сверить: файлы на диске того
//                                                размера, что в манифесте, и в папках
//                                                спрайтов нет листа без записи
//
// Что делает с листом:
//   1. Коэффициент: масштаб отрисовки (px мира на px листа) × WORLD_SCALE 0.55 ×
//      2 (наибольший resolution рендерера), вверх до 0.05, не больше 1 (cap — ниже
//      для боссов). На любом экране на пиксель экрана — не меньше пикселя текстуры.
//   2. Упаковка (листы с клетками): у каждого кадра обрезаются прозрачные поля
//      (альфа > 0 — видимое, ничего не режется) с запасом MARGIN, кадры
//      укладываются полками в атлас. У листов одной ГРУППЫ (облики героя и маска
//      плаща одного листа) — одна раскладка: рамка кадра — объединение рамок.
//   3. Атлас (в пикселях оригинала) уменьшается LANCZOS-ом в коэффициент раз.
// Игра грузит лист с resolution = коэффициент и ЛОГИЧЕСКИМ размером атласа, а
// кадры режет по манифесту (frame + orig + trim у Texture, spriteLoader.ts):
// клетки, якоря, точки и масштаб в коде — в пикселях исходного листа, как были.
//
// Оригиналы: D:\dev\right-place-art\archive\game-assets-old\sheets-full-2026-11-16\
// (тот же путь, что в public/), у боссов — boss-sheets-full-2026-11-13\<папка>\.
// Уменьшать всегда ОТ оригинала. Новый лист героя, врага, маски или крупного
// эффекта — сначала положить полный в архив, потом внести сюда и прогнать.
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..')
const ART = process.env.RIGHT_PLACE_ART || 'D:/dev/right-place-art'
const ARCHIVE = path.join(ART, 'archive/game-assets-old/sheets-full-2026-11-16')
const BOSS_ARCHIVE = path.join(ART, 'archive/game-assets-old/boss-sheets-full-2026-11-13')
const PUB = path.join(ROOT, 'public/assets')
const MANIFEST = path.join(ROOT, 'src/explore/sheetRes.ts')
const WORLD_SCALE = 0.55
const MAX_DPR = 2
const MAX_TEX = 4096

// --- Таблицы клеток читаются из исходников игры (своей копии чисел нет) ---
const constantsSrc = fs.readFileSync(path.join(ROOT, 'src/explore/constants.ts'), 'utf8')
const ncSrc = fs.readFileSync(path.join(ROOT, 'src/explore/ncSheets.ts'), 'utf8')
const consts = {}
for (const m of constantsSrc.matchAll(/^export const (\w+) = (-?[\d.]+)\b/gm)) consts[m[1]] = Number(m[2])
for (const m of constantsSrc.matchAll(/^(?:export )?const (\w+) = `\$\{import\.meta\.env\.BASE_URL\}assets\/([^`]+)`/gm)) consts[m[1]] = m[2]
const val = (s) => {
  s = s.trim()
  if (/^-?[\d.]+$/.test(s)) return Number(s)
  if (!(s in consts)) throw new Error(`constants.ts: нет константы ${s}`)
  return consts[s]
}
const relSrc = (s) => {
  s = s.trim()
  let m = s.match(/^`\$\{(\w+)\}([^`]+)`$/)
  if (m) return (m[1] === 'B' ? '' : val(m[1])) + m[2].replace(/^assets\//, '')
  return val(s)
}

/** Лист: путь от public/assets, клетка, число кадров, колонки. */
const sheets = new Map()
function addSheet(rel, cellW, cellH, count, cols) {
  if (sheets.has(rel)) return
  sheets.set(rel, { rel, cellW, cellH, count, cols })
}
// Таблицы вида «key: { src: …, cellW: …, cellH: …, cols: …, count: … }».
for (const table of ['ZVONAR_SHEETS', 'GATEKEEPER_SHEETS', 'ABBOT_SHEETS']) {
  const start = constantsSrc.indexOf(`export const ${table} = {`)
  const body = constantsSrc.slice(start, constantsSrc.indexOf('} as const', start))
  for (const m of body.matchAll(/src: ([^,]+), +cellW: (\w+), cellH: (\w+), (?:cols: (\w+), count: (\w+)|count: (\w+), cols: (\w+))/g)) {
    const cols = m[4] ?? m[7]
    const count = m[5] ?? m[6]
    addSheet(relSrc(m[1]), val(m[2]), val(m[3]), val(count), val(cols))
  }
}
for (const m of ncSrc.matchAll(/src: (`[^`]+`), cellW: (\d+), cellH: (\d+), count: (\d+), cols: (\d+)/g)) {
  addSheet(relSrc(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]))
}
// Остальные листы — по именам констант (как их режет assets.ts / Explore.tsx).
const byConst = (prefix, count = `${prefix}_COUNT`, cols = `${prefix}_COLS`, cw = `${prefix}_CELL_W`, ch = `${prefix}_CELL_H`) =>
  addSheet(val(`${prefix}_SRC`), val(cw), val(ch), val(count), val(cols))
for (const p of ['BOSS_IDLE', 'BOSS_WALK', 'BOSS_MELEE', 'BOSS_MELEE2', 'BOSS_HURT', 'BOSS_DEATH', 'BOSS_RANGED', 'BOSS_STOMP', 'BOSS_SPIKE_IMPACT', 'HERO_COMBO']) byConst(p)
addSheet(val('HERO_BLOCK_SRC'), val('HERO_BLOCK_CELL_W'), val('HERO_BLOCK_CELL_H'), val('HERO_BLOCK_COUNT'), val('HERO_BLOCK_COLS'))
addSheet(val('PARRY_SPARK_SRC'), val('PARRY_SPARK_CELL'), val('PARRY_SPARK_CELL'), val('PARRY_SPARK_COUNT'), val('PARRY_SPARK_COLS'))
addSheet(val('PARRY_SPARK_RED_SRC'), val('PARRY_SPARK_CELL'), val('PARRY_SPARK_CELL'), val('PARRY_SPARK_COUNT'), val('PARRY_SPARK_COLS'))
addSheet(val('OBELISK_IDLE_SRC'), val('OBELISK_FRAME_W'), val('OBELISK_FRAME_H'), val('OBELISK_IDLE_COUNT'), 10)
addSheet(val('OBELISK_BURNING_SRC'), val('OBELISK_FRAME_W'), val('OBELISK_FRAME_H'), val('OBELISK_BURNING_COUNT'), 10)
addSheet(val('SMUGGLER_SRC'), 230, 296, 14, 14)
addSheet(val('CHEST_OPEN_SRC'), 140, 178, 13, 13) // как loadChestAssets
addSheet(val('CHEST_TRAP_SRC'), 190, 137, 14, 14)
addSheet(val('STARBLOOM_IDLE_SRC'), val('STARBLOOM_IDLE_CELL_W'), val('STARBLOOM_IDLE_CELL_H'), val('STARBLOOM_IDLE_COUNT'), val('STARBLOOM_SHEET_COLS'))
addSheet(val('STARBLOOM_CUT_SRC'), val('STARBLOOM_CUT_CELL_W'), val('STARBLOOM_CUT_CELL_H'), val('STARBLOOM_CUT_COUNT'), val('STARBLOOM_SHEET_COLS'))
for (const [srcC, countC] of [['BARREL_HIT_SRC', 'BARREL_HIT_COUNT'], ['BARREL_BREAK_SRC', 'BARREL_BREAK_COUNT'], ['JAR_BREAK_SRC', 'JAR_BREAK_COUNT']]) {
  const dir = constantsSrc.match(/const BREAKABLES_DIR = `\$\{import\.meta\.env\.BASE_URL\}assets\/([^`]+)`/)[1]
  const file = constantsSrc.match(new RegExp(`export const ${srcC} = \`\\$\\{BREAKABLES_DIR\\}/([^\`]+)\``))[1]
  addSheet(`${dir}/${file}`, val('BREAKABLE_CELL_W'), val('BREAKABLE_CELL_H'), val(countC), val('BREAKABLE_SHEET_COLS'))
}
addSheet('sprites/beast/idle.png', 600, 288, 24, 12)
addSheet('sprites/beast/walk.png', 600, 288, 16, 12)
addSheet('sprites/beast/attack.png', 600, 288, 24, 12)
addSheet('sprites/beast/hurt.png', 600, 288, 12, 12)
addSheet('sprites/beast/death.png', 600, 288, 18, 12)
// Герой: клетка 394×296, 12 колонок; число кадров — как в loadHeroSheets.
const HERO_COUNTS = { idle: 24, run: 21, jump: 24, attack: 14, drink: 14, hurt: 10, death: 18, cast_v2: val('HERO_CAST_COUNT') }
const heroGroups = {}
for (const [name, count] of Object.entries(HERO_COUNTS)) {
  const files = [`sprites/hero/${name}.png`]
  for (const armor of ['crimson', 'gold', 'violet']) files.push(`sprites/hero/skins/armor_${armor}/${name}.png`)
  if (name === 'attack') {
    for (const armor of ['none', 'crimson', 'gold', 'violet']) for (const c of ['gold', 'red', 'violet']) files.push(`sprites/hero/skins/armor_${armor}/attack_${c}.png`)
  }
  files.push(`sprites/hero/skins/masks/${name}_cloak.png`)
  for (const f of files) if (fs.existsSync(path.join(PUB, f)) || fs.existsSync(path.join(ARCHIVE, f))) addSheet(f, val('HERO_CELL_W'), val('HERO_CELL_H'), count, 12)
  heroGroups[name] = files.filter((f) => sheets.has(f))
}
{
  const files = ['sprites/hero/block.png', 'sprites/hero/skins/armor_crimson/block.png', 'sprites/hero/skins/armor_gold/block.png', 'sprites/hero/skins/armor_violet/block.png', 'sprites/hero/skins/masks/block_cloak.png']
  for (const f of files) addSheet(f, val('HERO_BLOCK_CELL_W'), val('HERO_BLOCK_CELL_H'), val('HERO_BLOCK_COUNT'), val('HERO_BLOCK_COLS'))
  heroGroups.block = files
}

// --- Масштаб отрисовки (px мира на px листа) — откуда число, в комментарии ---
const HERO = val('HERO_DRAW_H') / val('HERO_CELL_H') // 140/296
const NC_DRAW = { fencer: 128, gravedigger: 135, crossbowman: 128, stoker: 145, beetle: 75, serpent: 250, crowking: 235 } // ncConstants NC_DRAW_H
const NC_BODY = { fencer: 257.6, gravedigger: 303.8, crossbowman: 282.8, stoker: 303.8, beetle: 189.8, serpent: 335.0, crowking: 326.0 } // NC_BODY_H
// Боссы — в листе на экране почти 1:1 (нужно 0.8–0.95). Нужный коэффициент
// получил только Король: замер 16.11.2026 (худший забег — C2, 4 вида врагов,
// плащ) — с ним пик 246 МБ из 250; Твари, Настоятелю и Змею полного не хватило
// бы 16 / 58 / 75 МБ, у них прежние 0.5 (docs/explore-engine.md, «Видеопамять
// забега»).
const BOSS_CAP = { boss: 0.5, abbot: 0.5, serpent: 0.5, crowking: 1 }
function scaleFor(rel) {
  const dir = rel.split('/').slice(0, -1).join('/')
  const file = rel.split('/').pop()
  if (rel === val('HERO_COMBO_SRC')) return { s: HERO * val('HERO_COMBO_SIZE_MULT') }
  if (rel === val('PARRY_SPARK_SRC')) return { s: HERO * val('PARRY_SPARK_SCALE') }
  if (rel === val('PARRY_SPARK_RED_SRC')) return { s: HERO * val('CRIT_SPARK_SCALE') }
  if (dir.startsWith('sprites/hero')) return { s: HERO }
  if (dir === 'sprites/beast') return { s: val('BEAST_CELL_RENDER_H') / 288 }
  if (dir === 'sprites/zvonar') return { s: val('ZVONAR_SCALE') }
  if (dir === 'sprites/gatekeeper') return { s: val('GATEKEEPER_SCALE') }
  if (dir === 'sprites/abbot') return { s: val('ABBOT_SCALE'), cap: BOSS_CAP.abbot }
  if (dir === 'sprites/boss') return { s: val('BOSS_DRAW_H') / val('BOSS_IDLE_CELL_H'), cap: BOSS_CAP.boss }
  const nc = { fencer: 'fencer', gravedigger: 'gravedigger', crossbowman: 'crossbowman', stoker: 'stoker', beetle: 'beetle', serpent: 'serpent', crowking: 'crowking' }[dir.split('/')[1]]
  if (dir.startsWith('sprites/') && nc) return { s: NC_DRAW[nc] / NC_BODY[nc], cap: BOSS_CAP[nc] ?? 1 }
  if (rel === val('BOSS_SPIKE_IMPACT_SRC')) return { s: val('BOSS_SPIKE_IMPACT_DRAW_H') / val('BOSS_SPIKE_IMPACT_CELL_H') }
  if (rel === val('SMUGGLER_SRC')) return { s: val('SMUGGLER_DRAW_H') / 296 }
  if (rel === val('CHEST_OPEN_SRC')) return { s: val('CHEST_DRAW_H') / 178 }
  if (rel === val('CHEST_TRAP_SRC')) return { s: val('CHEST_TRAP_DRAW_H') / 137 }
  if (file.startsWith('Obelisk_')) return { s: val('OBELISK_DRAW_H') / val('OBELISK_FRAME_H') }
  if (file.startsWith('starbloom_')) return { s: val('STARBLOOM_DRAW_H') / val('STARBLOOM_CUT_CELL_H') }
  if (dir.endsWith('breakables')) return { s: val('BARREL_DRAW_H') / val('BREAKABLE_ART_H') }
  throw new Error(`нет масштаба отрисовки для ${rel}`)
}
const factorOf = (rel) => {
  const { s, cap = 1 } = scaleFor(rel)
  const need = Math.ceil(Math.round(s * WORLD_SCALE * MAX_DPR * 1e6) / 1e6 / 0.05 - 1e-9) * 0.05
  return Math.round(Math.min(1, cap, need) * 100) / 100
}

// Листы, которые в упаковку и уменьшение НЕ идут (маленькие или режутся вручную):
// они прописаны тут, чтобы --check знал, что их пропустили осознанно.
const KEEP = new Set([
  'sprites/hero/parry_spark_Red.png', // крит Клинка, 0.2 МБ видеопамяти; нужно 0.5 — выигрыш копеечный
  'sprites/zvonar/Zvonar_Wave_Impact_v2.png', // рисуется ×0.96 — нужен коэффициент 1
  'vfx/ash_fire.webp', // огонь кольца Пепла, 2.2 МБ, только с кольцом
])

// Файлы в папках спрайтов, которые игра НЕ грузит (история, запас) — --check их
// не требует. Начнёт грузить — убрать отсюда и обработать.
const UNUSED = new Set([
  'sprites/gatekeeper/Gatekeeper_Attack.webp', // прежняя атака Привратника (до тарана 12.10.2026)
])

// Группы (одна раскладка на группу): облики героя и маска плаща одного листа.
const groups = []
const inGroup = new Set()
for (const files of Object.values(heroGroups)) { groups.push(files); files.forEach((f) => inGroup.add(f)) }
for (const rel of sheets.keys()) if (!inGroup.has(rel) && !KEEP.has(rel)) groups.push([rel])

// --- Пиксели ---
function origPath(rel) {
  const boss = /^sprites\/(boss|abbot|serpent|crowking)\//.exec(rel)
  if (boss) return path.join(BOSS_ARCHIVE, rel.replace(/^sprites\//, ''))
  return path.join(ARCHIVE, rel)
}
async function readRGBA(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, w: info.width, h: info.height }
}

function trimBox(img, cx, cy, cw, ch) {
  let x0 = cw, y0 = ch, x1 = -1, y1 = -1
  for (let y = 0; y < ch; y++) {
    const row = ((cy + y) * img.w + cx) * 4 + 3
    for (let x = 0; x < cw; x++) {
      if (img.data[row + x * 4] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
    }
  }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1]
}

/** Полки: кадры по убыванию высоты слева направо; ширина атласа — наименьшая площадь. */
function shelfPack(boxes, pad, maxW, maxH) {
  const order = boxes.map((b, i) => i).sort((a, b) => boxes[b].h - boxes[a].h || boxes[b].w - boxes[a].w)
  const widest = Math.max(...boxes.map((b) => b.w))
  let best = null
  const area = boxes.reduce((a, b) => a + (b.w + pad) * (b.h + pad), 0)
  for (let W = widest; W <= maxW; W += Math.max(8, Math.floor(widest / 8))) {
    const pos = new Array(boxes.length)
    let x = 0, y = 0, shelfH = 0
    for (const i of order) {
      const b = boxes[i]
      if (x + b.w > W) { y += shelfH + pad; x = 0; shelfH = 0 }
      pos[i] = [x, y]
      x += b.w + pad
      shelfH = Math.max(shelfH, b.h)
    }
    const H = y + shelfH
    if (H > maxH) continue
    const score = W * H
    if (!best || score < best.score) best = { W, H, pos, score }
    if (W * W > area * 6) break
  }
  if (!best) throw new Error('кадры не помещаются в атлас')
  return best
}

async function encode(rel, raw, w, h, pw, ph) {
  let img = sharp(raw, { raw: { width: w, height: h, channels: 4 } })
  if (pw !== w || ph !== h) img = img.resize(pw, ph, { kernel: 'lanczos3', fit: 'fill' })
  if (rel.endsWith('.webp')) img = img.webp({ quality: 92, alphaQuality: 100, effort: 6 })
  else img = img.png({ compressionLevel: 9, adaptiveFiltering: true })
  const out = path.join(PUB, rel)
  await img.toFile(out + '.tmp')
  fs.renameSync(out + '.tmp', out)
}

async function buildGroup(files, manifest) {
  const spec = sheets.get(files[0])
  for (const f of files) {
    const s = sheets.get(f)
    if (s.cellW !== spec.cellW || s.cellH !== spec.cellH || s.count !== spec.count || s.cols !== spec.cols) throw new Error(`группа ${files[0]}: у ${f} другая сетка`)
  }
  const f = factorOf(files[0])
  const imgs = []
  for (const rel of files) {
    const img = await readRGBA(origPath(rel))
    const rows = Math.ceil(spec.count / spec.cols)
    const needW = spec.cellW * Math.min(spec.count, spec.cols)
    if (img.w < needW || img.h < spec.cellH * rows) throw new Error(`${rel}: оригинал ${img.w}×${img.h} меньше сетки ${needW}×${spec.cellH * rows}`)
    imgs.push({ rel, img, mask: rel.includes('/masks/') })
  }
  const { cellW: cw, cellH: ch, count, cols } = spec
  const margin = Math.ceil(2 / f) + 1
  const pad = Math.ceil(2 / f) + 1
  // Рамка кадра — объединение по листам группы (маска плаща не в счёт: она
  // может быть непрозрачной везде; её пиксели вне героя не читаются).
  const boxes = []
  for (let i = 0; i < count; i++) {
    const cx = (i % cols) * cw, cy = Math.floor(i / cols) * ch
    let u = null
    for (const { img, mask } of imgs) {
      if (mask) continue
      const b = trimBox(img, cx, cy, cw, ch)
      if (!b) continue
      u = u ? [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])] : b
    }
    if (!u) u = [0, 0, 1, 1]
    const x0 = Math.max(0, u[0] - margin), y0 = Math.max(0, u[1] - margin)
    const x1 = Math.min(cw, u[2] + margin), y1 = Math.min(ch, u[3] + margin)
    boxes.push({ cx, cy, tx: x0, ty: y0, w: x1 - x0, h: y1 - y0 })
  }
  const maxL = Math.floor(MAX_TEX / f) - 2
  const pack = shelfPack(boxes, pad, maxL, maxL)
  const W = pack.W, H = pack.H
  const pw = Math.max(1, Math.round(W * f)), ph = Math.max(1, Math.round(H * f))
  const frames = []
  boxes.forEach((b, i) => frames.push(pack.pos[i][0], pack.pos[i][1], b.w, b.h, b.tx, b.ty))
  const before = files.length * cw * cols * ch * Math.ceil(count / cols) * 4
  for (const { rel, img } of imgs) {
    const atlas = Buffer.alloc(W * H * 4)
    boxes.forEach((b, i) => {
      const [ax, ay] = pack.pos[i]
      for (let y = 0; y < b.h; y++) {
        const src = ((b.cy + b.ty + y) * img.w + b.cx + b.tx) * 4
        img.data.copy(atlas, ((ay + y) * W + ax) * 4, src, src + b.w * 4)
      }
    })
    await encode(rel, atlas, W, H, pw, ph)
    manifest[rel] = { w: W, h: H, res: f, cell: [cw, ch, count, cols], frames }
  }
  const after = files.length * pw * ph * 4
  console.log(`${files[0].padEnd(52)} ×${files.length}  f=${f.toFixed(2)}  ${(before / 1048576).toFixed(1)} → ${(after / 1048576).toFixed(1)} МБ  (${pw}×${ph})`)
}

// Одиночные картинки без клеток — только коэффициент.
const PLAIN = {
  'objects/traps/GargoylePost_Fire.png': () => val('GARGOYLE_SCALE'), // кадры режет loadTrapArt по логическому размеру
  'vfx/Boss_Wave.png': () => val('BOSS_WAVE_DRAW_H') / val('BOSS_WAVE_CELL_H'), // режет loadBossWave пополам по логическим клеткам
}
async function buildPlain(rel, s, manifest) {
  const f = Math.min(1, Math.ceil(s() * WORLD_SCALE * MAX_DPR / 0.05 - 1e-9) * 0.05)
  const img = await readRGBA(origPath(rel))
  const pw = Math.round(img.w * f), ph = Math.round(img.h * f)
  await encode(rel, img.data, img.w, img.h, pw, ph)
  manifest[rel] = { w: img.w, h: img.h, res: Math.round(f * 100) / 100 }
  console.log(`${rel.padEnd(52)} plain f=${f.toFixed(2)}  ${(img.w * img.h * 4 / 1048576).toFixed(1)} → ${(pw * ph * 4 / 1048576).toFixed(1)} МБ`)
}

function writeManifest(manifest) {
  const keys = Object.keys(manifest).sort()
  const lines = keys.map((k) => {
    const e = manifest[k]
    const extra = e.frames ? `, cell: [${e.cell.join(', ')}], frames: [${e.frames.join(',')}]` : ''
    return `  '${k}': { w: ${e.w}, h: ${e.h}, res: ${e.res}${extra} },`
  })
  const text = `// СГЕНЕРИРОВАНО tools/make_sprite_res.mjs — руками не править, перегенерировать.
// Листы спрайтов по размеру экрана и с плотной упаковкой кадров (16.11.2026,
// docs/explore-engine.md, «Видеопамять забега»). Ключ — путь от assets/.
//   w, h  — ЛОГИЧЕСКИЙ размер листа (в пикселях исходного листа); файл на диске
//           в res раз меньше по стороне, грузится с resolution = res;
//   cell  — исходная сетка [ширина клетки, высота, кадров, колонок];
//   frames — у упакованных: на кадр [x, y, w, h, tx, ty] — где кадр лежит в
//           атласе и где его прямоугольник в исходной клетке (trim).
export type SheetRes = {
  w: number
  h: number
  res: number
  cell?: readonly [number, number, number, number]
  frames?: readonly number[]
}
export const SHEET_RES: Record<string, SheetRes> = {
${lines.join('\n')}
}
`
  fs.writeFileSync(MANIFEST, text)
}

function readManifest() {
  if (!fs.existsSync(MANIFEST)) return {}
  const text = fs.readFileSync(MANIFEST, 'utf8')
  const out = {}
  for (const m of text.matchAll(/^ {2}'([^']+)': \{ w: (\d+), h: (\d+), res: ([\d.]+)(?:, cell: \[([^\]]+)\], frames: \[([^\]]*)\])? \},$/gm)) {
    out[m[1]] = { w: +m[2], h: +m[3], res: +m[4], cell: m[5] ? m[5].split(',').map(Number) : undefined, frames: m[6] ? m[6].split(',').map(Number) : undefined }
  }
  return out
}

const args = process.argv.slice(2)
if (args[0] === '--archive') {
  let n = 0
  for (const rel of [...sheets.keys(), ...Object.keys(PLAIN)]) {
    if (/^sprites\/(boss|abbot|serpent|crowking)\//.test(rel)) continue
    const dst = path.join(ARCHIVE, rel)
    if (fs.existsSync(dst)) continue
    const src = path.join(PUB, rel)
    const m = readManifest()[rel]
    if (m) throw new Error(`${rel}: уже обработан (есть в манифесте) — в public не оригинал`)
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.copyFileSync(src, dst)
    n++
  }
  console.log(`в архив скопировано ${n} файлов → ${ARCHIVE}`)
} else if (args[0] === '--check') {
  const manifest = readManifest()
  const problems = []
  for (const [rel, e] of Object.entries(manifest)) {
    const file = path.join(PUB, rel)
    if (!fs.existsSync(file)) { problems.push(`${rel}: файла нет`); continue }
    const meta = await sharp(file).metadata()
    const pw = Math.max(1, Math.round(e.w * e.res)), ph = Math.max(1, Math.round(e.h * e.res))
    if (meta.width !== pw || meta.height !== ph) problems.push(`${rel}: на диске ${meta.width}×${meta.height}, по манифесту ${pw}×${ph}`)
    if (e.frames && e.frames.length !== e.cell[2] * 6) problems.push(`${rel}: кадров в раскладке ${e.frames.length / 6}, а в сетке ${e.cell[2]}`)
    const s = sheets.get(rel)
    if (e.cell && s && (s.cellW !== e.cell[0] || s.cellH !== e.cell[1] || s.count !== e.cell[2] || s.cols !== e.cell[3])) problems.push(`${rel}: сетка в коде ${s.cellW}×${s.cellH}/${s.count}/${s.cols}, в манифесте ${e.cell.join('/')}`)
  }
  for (const rel of [...sheets.keys(), ...Object.keys(PLAIN)]) if (!manifest[rel] && !KEEP.has(rel)) problems.push(`${rel}: лист в таблицах игры, но не обработан`)
  // Все картинки в папках спрайтов и эффектов: каждая либо в манифесте, либо
  // мелкая (меньше 2 МБ видеопамяти), либо в KEEP.
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])
  for (const dir of ['sprites', 'skills', 'vfx', 'objects']) {
    for (const file of walk(path.join(PUB, dir))) {
      if (!/\.(png|webp)$/i.test(file)) continue
      const rel = path.relative(PUB, file).split(path.sep).join('/')
      if (manifest[rel] || KEEP.has(rel)) continue
      const meta = await sharp(file).metadata()
      if (meta.width * meta.height * 4 >= 2 * 1048576 && !UNUSED.has(rel)) problems.push(`${rel}: ${meta.width}×${meta.height} (${(meta.width * meta.height * 4 / 1048576).toFixed(1)} МБ) — нет записи в манифесте`)
    }
  }
  if (problems.length) { console.log(problems.join('\n')); process.exitCode = 1 } else console.log(`манифест: ${Object.keys(manifest).length} листов, всё сходится`)
} else {
  const filter = args[0]
  const manifest = readManifest()
  for (const files of groups) {
    if (filter && !files.some((f) => f.includes(filter))) continue
    await buildGroup(files, manifest)
    writeManifest(manifest) // после каждой группы: упавший проход не теряет сделанное
  }
  for (const [rel, s] of Object.entries(PLAIN)) {
    if (filter && !rel.includes(filter)) continue
    await buildPlain(rel, s, manifest)
  }
  writeManifest(manifest)
}
