// Проходимость карты ГЕРОЕМ НАСТОЯЩИМ КОДОМ ИГРЫ (26.11.2026, переписан в
// «Правки 26.11 (мосты)»). Read-only.
//
//   node tools/hero_reach.mjs [буквы]            отчёт
//   node tools/hero_reach.mjs --check [буквы]    то же, код 1 при нарушениях
//   node tools/hero_reach.mjs Y --json out.json  ещё и рёбра клеток в файл
//
// Движение — src/explore/heroMove.ts, ТЕ ЖЕ функции, что зовёт тикер
// Explore.tsx (стены и полоса '=' по X, толчок и срез прыжка, гравитация,
// приземление, удар головой), плюс константы из src/explore/constants.ts. Модули
// грузит vite (ssrLoadModule) — как в игре, без копии формул. Порядок вызовов за
// кадр — как в тикере: x += vx → resolveHeroWalls → толчок (на земле или в
// койот-окно) → heroJumpCut → heroGravityAndCollide → койот.
//
// ДВЕ ПРОВЕРКИ:
//  1. Волна: поиск в ширину по всем вводам (влево/стоять/вправо × прыжок /
//     держать / отпустить) от каждой клетки стояния — дойти до каждой клетки от
//     старта и вернуться.
//  2. ЕСТЕСТВЕННЫЙ ВВОД (её не было — потому 26.11 и пропустили низкий мост на Y):
//     игрок стоит у края своей площадки в сторону цели (клетка стояния выше на
//     1–2, dx 1–2), держит прыжок и жмёт к цели, пока не окажется над ней. Если так цель не
//     берётся (а подобрав середину ступени и момент отпускания — берётся), это
//     капкан: игрок жмёт как обычно и не поднимается. Волна 1 его не видит — она
//     ищет ЛЮБОЙ ввод. На Y так было у концов настила: в прыжке верх бокса героя
//     опущен на JUMP_HIT_OFFSET_Y = 40 px, а полоса '=' — 28 px, и герой со
//     ступени подлезал под край моста и бился о него головой.
// Не повторено: враги, сундуки и обелиски (тела-стены — 4g/4h check_map_slots.py),
// рывок.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MAPS = process.env.HERO_MAPS || path.join(ROOT, 'public', 'assets', 'maps') // HERO_MAPS — другая папка (сверить старую сетку)

// Капканы «естественного ввода», которые Андрей видел и пока оставил (решение
// нужно его): полки-лестницы W из двух клеток '==' по диагонали со сдвигом в
// клетку — та же причина (бокс в прыжке подлезает под полосу). Подъём полки даёт
// подъём на 3, сдвиг вбок переносит капкан на соседнюю. См. docs/maps.md,
// «Правки 26.11 (мосты)».
const ACCEPTED_NATURAL = {
  W: new Set(['6,9>7,7', '6,23>7,21', '20,16>19,14', '20,30>19,28', '51,19>52,17', '51,33>52,31', '65,12>64,10', '65,26>64,24',
    '6,9>8,7', '6,23>8,21', '20,16>18,14', '20,30>18,28', '51,19>53,17', '51,33>53,31', '65,12>63,10', '65,26>63,24']),
}

async function loadEngine() {
  const { createServer } = await import('vite')
  const server = await createServer({ root: ROOT, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } })
  const move = await server.ssrLoadModule('/src/explore/heroMove.ts')
  const C = await server.ssrLoadModule('/src/explore/constants.ts')
  return { server, move, C }
}

export function loadGrid(file) {
  return fs.readFileSync(file, 'utf8').split('\n').map((r) => r.replace(/\r$/, '')).filter((r) => r.length > 0).map((r) => r.split(''))
}

export function standingCells(grid) {
  const H = grid.length, W = grid[0].length
  const air = (c) => c === '.' || c === '^'
  const S = new Set()
  for (let y = 1; y < H - 1; y++) for (let x = 0; x < W; x++) {
    if (air(grid[y][x]) && air(grid[y - 1][x]) && (grid[y + 1][x] === '#' || grid[y + 1][x] === '=')) S.add(x + ',' + y)
  }
  return S
}

function makeStepper(engine, grid) {
  const { move, C } = engine
  const T = C.TILE_SIZE
  const worldW = grid[0].length * T
  const dMS = 1000 / 60
  const COY = C.COYOTE_MS
  // s: {x, y, vx, vy, onGround, pending, airMs, coy}
  return (s, dir, jump, held) => {
    const phys = { x: s.x, y: s.y, vx: 0, vy: s.vy, onGround: s.onGround }
    const cut = { pending: s.pending, airMs: s.airMs }
    let coy = Math.max(0, s.coy - dMS)
    const startX = phys.x, startY = phys.y
    const headOffset = phys.onGround ? 0 : C.JUMP_HIT_OFFSET_Y
    phys.vx = dir * C.MOVE_SPEED
    phys.x += phys.vx
    move.resolveHeroWalls(grid, phys, startX, headOffset, worldW)
    let jumped = false
    if (jump && (phys.onGround || coy > 0)) { move.heroJumpStart(phys, cut); coy = 0; jumped = true }
    move.heroJumpCut(phys, cut, held, dMS, jumped)
    const was = phys.onGround
    move.heroGravityAndCollide(grid, phys, startY, 1)
    if (was && !phys.onGround && !jumped) coy = COY
    if (phys.onGround) coy = 0
    return { x: phys.x, y: phys.y, vy: phys.vy, onGround: phys.onGround, pending: cut.pending, airMs: Math.min(cut.airMs, 400), coy }
  }
}

const keyOf = (s) => `${s.x}|${Math.round(s.y * 100)}|${Math.round(s.vy * 1000)}|${s.onGround ? 1 : 0}|${s.pending ? Math.round(s.airMs) : -1}|${Math.round(s.coy)}`

function cellOf(s, S, T, PW, PH) {
  const cy = Math.round((s.y + PH) / T) - 1
  const c = Math.floor((s.x + PW / 2) / T)
  if (S.has(c + ',' + cy)) return c + ',' + cy
  for (const cx of [Math.floor((s.x + 1) / T), Math.floor((s.x + PW - 1) / T)]) if (S.has(cx + ',' + cy)) return cx + ',' + cy
  return null
}

// Отпустить кнопку прыжка — на этих кадрах от толчка (все подряд взрывают перебор).
const CUT_AT_MS = [117, 150, 200, 250, 317, 400, 500]

function standPositions(step, k, S, C, grid) {
  const T = C.TILE_SIZE, PW = C.PLAYER_WIDTH, PH = C.PLAYER_HEIGHT
  const [cx, cy] = k.split(',').map(Number)
  const y0 = (cy + 1) * T - PH
  const out = []
  for (let x = cx * T - PW + 2; x <= cx * T + T - 2; x += 2) {
    const s = { x, y: y0, vy: 0, onGround: true, pending: false, airMs: 0, coy: 0 }
    const t = step(s, 0, false, true)
    if (!t.onGround || t.x !== x || Math.abs(t.y - y0) > 0.01) continue
    if (cellOf(t, S, T, PW, PH) !== k) continue
    // В стойке бокс героя не задевает '#' и полосу '=' (верхние 44% клетки):
    // иначе телепорт ставит героя телом в полосу у края моста, куда пешком не
    // зайти (на земле полоса бьёт с макушки).
    let inside = false
    for (let c = Math.floor(x / T); c <= Math.floor((x + PW - 1) / T) && !inside; c++) {
      for (let r = Math.floor(y0 / T); r <= Math.floor((y0 + PH - 1) / T); r++) {
        const ch = grid[r]?.[c]
        if (ch === '#' || (ch === '=' && y0 < r * T + T * 0.44)) { inside = true; break }
      }
    }
    if (inside) continue
    out.push(t)
  }
  return out
}

function cellEdges(engine, grid) {
  const { C } = engine
  const T = C.TILE_SIZE, PW = C.PLAYER_WIDTH, PH = C.PLAYER_HEIGHT
  const step = makeStepper(engine, grid)
  const S = standingCells(grid)
  const edges = new Map()
  const dMS = 1000 / 60
  for (const k of S) {
    const out = new Set()
    const seen = new Set()
    const q = []
    for (const t of standPositions(step, k, S, C, grid)) { const kk = keyOf(t); if (!seen.has(kk)) { seen.add(kk); q.push([t, 0]) } }
    for (let i = 0; i < q.length; i++) {
      const [s, f] = q[i]
      if (f > 150) continue
      const opts = []
      for (const dir of [-1, 0, 1]) {
        if (s.onGround || s.coy > 0) opts.push([dir, true, true])
        opts.push([dir, false, true])
        if (s.pending && CUT_AT_MS.some((m) => Math.abs(s.airMs + dMS - m) < dMS / 2)) opts.push([dir, false, false])
      }
      for (const [dir, jump, held] of opts) {
        const n = step(s, dir, jump, held)
        if (n.y > grid.length * T) continue
        if (n.onGround) {
          const c = cellOf(n, S, T, PW, PH)
          if (c !== null && c !== k) { out.add(c); continue }
          if (c === null) continue
        }
        const kk = keyOf(n)
        if (seen.has(kk)) continue
        seen.add(kk)
        q.push([n, n.onGround ? 0 : f + 1])
      }
    }
    edges.set(k, out)
  }
  return { S, edges, step }
}

function waveFrom(edges, start, reverse) {
  const adj = new Map()
  if (reverse) { for (const [a, outs] of edges) for (const b of outs) { if (!adj.has(b)) adj.set(b, []); adj.get(b).push(a) } }
  else for (const [a, outs] of edges) adj.set(a, [...outs])
  const seen = new Set([start])
  const q = [start]
  for (let i = 0; i < q.length; i++) for (const n of adj.get(q[i]) ?? []) if (!seen.has(n)) { seen.add(n); q.push(n) }
  return seen
}

// Естественный ввод: с края площадки в сторону цели, направление и прыжок зажаты.
function naturalTraps(engine, grid, S, edges, step) {
  const { C } = engine
  const T = C.TILE_SIZE, PW = C.PLAYER_WIDTH, PH = C.PLAYER_HEIGHT
  const traps = []
  for (const a of S) {
    const [ax, ay] = a.split(',').map(Number)
    for (const dy of [1, 2]) for (const dx of [-2, -1, 1, 2]) {
      const b = `${ax + dx},${ay - dy}`
      if (!S.has(b) || !edges.get(a)?.has(b)) continue
      const dir = dx > 0 ? 1 : -1
      const pos = standPositions(step, a, S, C, grid)
      if (!pos.length) continue
      // край площадки в сторону цели — дальняя позиция по dir
      const edge = pos.reduce((m, p) => (p.x * dir > m.x * dir ? p : m))
      let s = edge, ok = false, left = false
      // Жмёт к цели, пока середина героя не над её клеткой, потом отпускает
      // направление; прыжок держит.
      const bx0 = (ax + dx) * T
      for (let f = 0; f < 150; f++) {
        const mid = s.x + PW / 2
        const d = mid < bx0 + 8 ? 1 : mid > bx0 + T - 8 ? -1 : 0
        s = step(s, f === 0 ? dir : d, f === 0, true)
        if (!s.onGround) left = true
        // Держа направление, герой садится и дальше цели — засчитываем любую
        // клетку той же высоты или выше.
        if (left && s.onGround) { const c = cellOf(s, S, T, PW, PH); ok = c !== null && Number(c.split(',')[1]) <= ay - dy; break }
      }
      if (!ok) traps.push(`${a}>${b}`)
    }
  }
  return traps
}

async function main() {
  const args = process.argv.slice(2)
  const check = args.includes('--check')
  const ji = args.indexOf('--json')
  const jsonOut = ji >= 0 ? args[ji + 1] : null
  const letters = args.filter((a, i) => !a.startsWith('--') && (ji < 0 || i !== ji + 1))
  const files = fs.readdirSync(MAPS).filter((f) => /^map_[A-Z0-9]+_.*\.txt$/.test(f))
  const want = letters.length ? letters : [...new Set(files.map((f) => f.split('_')[1]))].sort()
  const engine = await loadEngine()
  const dump = {}
  let bad = 0
  try {
    for (const L of want) {
      const txt = files.filter((f) => f.split('_')[1] === L)
      if (txt.length !== 1) { console.log(`${L}: .txt не один — ${txt}`); bad++; continue }
      const grid = loadGrid(path.join(MAPS, txt[0]))
      const slots = JSON.parse(fs.readFileSync(path.join(MAPS, `map_${L}_slots.json`), 'utf8'))
      const start = slots.start.join(',')
      const t0 = Date.now()
      const { S, edges, step } = cellEdges(engine, grid)
      const f = waveFrom(edges, start, false)
      const b = waveFrom(edges, start, true)
      const lostF = [...S].filter((c) => !f.has(c)).sort()
      const lostB = [...S].filter((c) => f.has(c) && !b.has(c)).sort()
      const traps = naturalTraps(engine, grid, S, edges, step)
      const acc = ACCEPTED_NATURAL[L] ?? new Set()
      const newTraps = traps.filter((t) => !acc.has(t))
      const accTraps = traps.filter((t) => acc.has(t))
      console.log(`== ${L} (${txt[0]}): клеток ${S.size}, туда ${f.size}, обратно ${[...f].filter((c) => b.has(c)).length}; капканов естественного ввода ${newTraps.length}${accTraps.length ? ` (+${accTraps.length} принятых)` : ''}; ${((Date.now() - t0) / 1000).toFixed(1)} с`)
      if (lostF.length) console.log(`   не дойти: ${lostF.join(' ')}`)
      if (lostB.length) console.log(`   не вернуться: ${lostB.join(' ')}`)
      if (newTraps.length) console.log(`   капкан (с края, к цели, прыжок зажат — не берётся): ${newTraps.join(' ')}`)
      if (accTraps.length) console.log(`   принято (полки-лестницы, решение Андрея): ${accTraps.join(' ')}`)
      if (lostF.length || lostB.length || newTraps.length) bad++
      dump[L] = { lostF, lostB, traps }
    }
  } finally {
    await engine.server.close()
  }
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(dump))
  if (check) process.exitCode = bad ? 1 : 0
}

main()
