// Покадровая проходимость карты ГЕРОЕМ (26.11.2026) — той же физикой, что в
// Explore.tsx (горизонталь и вертикаль тикера, collision.ts), без упрощений
// модели прыжка map_tools.py. Read-only.
//
//   node tools/hero_reach.mjs [буквы]          отчёт
//   node tools/hero_reach.mjs Y --json out.json   ещё и рёбра клеток в файл
//
// Что повторено из игры (60 к/с, dt = 1): vx = ±MOVE_SPEED сразу (разгона нет);
// стена по X — три точки бокса 54×128 (верх с headOffset 40 в воздухе,
// середина, ноги) и полоса '=' (верхние 44% клетки) с защитой «уже в полосе»;
// прыжок −11.5, гравитация 0.31, MAX_FALL 20; срез прыжка ×0.5 не раньше
// 110 мс от толчка (отпустил кнопку); удар головой sweepHeadBlock и откат
// «уже внутри на старте кадра»; приземление sweepFootBlock; койот 80 мс.
// Не повторено: враги, сундуки, обелиски (тела-стены), ступень героя (её у героя
// нет), рывок.
//
// Метод: для каждой клетки стояния — поиск в ширину по состояниям героя
// (x, y, vy, на земле, срез, койот) от стойки в этой клетке, со всеми
// вводами каждый кадр (влево/стоять/вправо × прыжок/срез). Стоит на земле в
// другой клетке — ребро. Потом волны туда (от старта) и обратно (к старту).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MAPS = path.join(ROOT, 'public', 'assets', 'maps')
const T = 64
const PW = 54
const PH = 128
const HEAD_OFF = 40
const BAND = T * 0.44
const MOVE = 4
const JV = 11.5
const G = 0.31
const MAX_FALL = 20
const CUT = 0.5
const MIN_HOLD_F = Math.ceil(110 / (1000 / 60)) // кадров до среза
const COYOTE_F = Math.floor(80 / (1000 / 60))
const AIR_MAX_F = 150
// Отпустить кнопку прыжка — на этих кадрах от толчка (срез ×0.5). Все кадры
// подряд взрывают перебор, а высоты среза между ними отличаются меньше 8 px.
const CUT_AT = new Set([7, 9, 12, 15, 19, 24, 30])

export function loadGrid(file) {
  return fs.readFileSync(file, 'utf8').split('\n').map((r) => r.replace(/\r$/, '')).filter((r) => r.length > 0)
}

export function makeWorld(grid) {
  const H = grid.length
  const W = grid[0].length
  const at = (cx, cy) => grid[cy][cx]
  const isSolid = (px, py) => {
    const cx = Math.floor(px / T), cy = Math.floor(py / T)
    if (cy < 0) return false
    if (cy >= H) return true
    if (cx < 0 || cx >= W) return true
    return at(cx, cy) === '#'
  }
  const bandBlocking = (px, top, bottom) => {
    const cx = Math.floor(px / T)
    if (cx < 0 || cx >= W) return false
    const a = Math.floor(top / T), b = Math.floor((bottom - 1) / T)
    for (let cy = a; cy <= b; cy++) {
      if (cy < 0 || cy >= H || at(cx, cy) !== '=') continue
      const ct = cy * T
      if (top < ct + BAND && bottom > ct) return true
    }
    return false
  }
  const overlapBand = (left, top, bottom) => {
    const x0 = Math.floor(left / T), x1 = Math.floor((left + PW - 1) / T)
    const a = Math.floor(top / T), b = Math.floor((bottom - 1) / T)
    for (let cy = a; cy <= b; cy++) {
      if (cy < 0 || cy >= H) continue
      const ct = cy * T
      if (!(top < ct + BAND && bottom > ct)) continue
      for (let cx = x0; cx <= x1; cx++) if (cx >= 0 && cx < W && at(cx, cy) === '=') return true
    }
    return false
  }
  const headBottom = (cx, cy) => {
    if (cy < 0) return null
    if (cy >= H || cx < 0 || cx >= W) return cy * T + T
    const ch = at(cx, cy)
    if (ch === '#') return cy * T + T
    if (ch === '=') return cy * T + BAND
    return null
  }
  const footTop = (cx, cy) => {
    if (cy < 0) return null
    if (cy >= H || cx < 0 || cx >= W) return cy * T
    const ch = at(cx, cy)
    return ch === '#' || ch === '=' ? cy * T : null
  }
  const sweepHead = (x, prevHead, head) => {
    const xs = [x + 1, x + PW / 2, x + PW - 1]
    let push = null
    for (let cy = Math.floor(head / T); cy <= Math.floor(prevHead / T); cy++) {
      for (const px of xs) {
        const bb = headBottom(Math.floor(px / T), cy)
        if (bb === null) continue
        if (prevHead >= bb && head < bb) push = push === null ? bb : Math.max(push, bb)
      }
    }
    return push
  }
  const overlapStart = (x, top, bottom) => {
    const xs = [x + 1, x + PW / 2, x + PW - 1]
    for (let cy = Math.floor(top / T); cy <= Math.floor((bottom - 1) / T); cy++) {
      for (const px of xs) {
        const bb = headBottom(Math.floor(px / T), cy)
        if (bb === null) continue
        if (top < bb && bottom > cy * T) return true
      }
    }
    return false
  }
  const sweepFoot = (x, prevFoot, foot) => {
    const xs = [x + 1, x + PW / 2, x + PW - 1]
    let push = null
    for (let cy = Math.floor(prevFoot / T); cy <= Math.floor(foot / T); cy++) {
      for (const px of xs) {
        const bt = footTop(Math.floor(px / T), cy)
        if (bt === null) continue
        if (prevFoot <= bt && foot > bt) push = push === null ? bt : Math.min(push, bt)
      }
    }
    return push
  }
  // Один кадр тикера. s: {x, y, vy, g (onGround), cut (срез ещё возможен),
  // air (кадров от толчка), coy (кадров койота)}. dir ∈ −1/0/1, jump — нажал,
  // held — держит кнопку прыжка.
  const step = (s, dir, jump, held) => {
    const startX = s.x, startY = s.y
    const headOffset = s.g ? 0 : HEAD_OFF
    let x = s.x + dir * MOVE
    let y = s.y, vy = s.vy, g = s.g, cut = s.cut, air = s.air, coy = s.coy
    if (dir > 0) {
      const px = x + PW - 1
      let hit = isSolid(px, y + headOffset + 1) || isSolid(px, y + PH / 2) || isSolid(px, y + PH - 1)
      if (!hit && !overlapBand(startX, y + headOffset, y + PH) && bandBlocking(px, y + headOffset, y + PH)) hit = true
      if (hit) x = Math.floor((x + PW) / T) * T - PW
    } else if (dir < 0) {
      const px = x
      let hit = isSolid(px, y + headOffset + 1) || isSolid(px, y + PH / 2) || isSolid(px, y + PH - 1)
      if (!hit && !overlapBand(startX, y + headOffset, y + PH) && bandBlocking(px, y + headOffset, y + PH)) hit = true
      if (hit) x = (Math.floor(x / T) + 1) * T
    }
    x = Math.min(Math.max(x, 0), grid[0].length * T - PW)
    coy = Math.max(0, coy - 1)
    let jumped = false
    if (jump && (g || coy > 0)) {
      vy = -JV; g = false; cut = true; air = 0; coy = 0; jumped = true
    }
    if (cut) {
      if (vy >= 0) cut = false
      else if (!jumped) {
        air += 1
        if (!held && air >= MIN_HOLD_F) { vy *= CUT; cut = false }
      }
    }
    const was = g
    vy = Math.min(vy + G, MAX_FALL)
    y += vy
    g = false
    if (vy > 0) {
      const bt = sweepFoot(x, startY + PH, y + PH)
      if (bt !== null) { y = bt - PH; vy = 0; g = true }
    } else if (vy < 0) {
      const ho = HEAD_OFF // в этой ветке герой уже не на земле
      const push = sweepHead(x, startY + ho, y + ho)
      if (push !== null) { y = push - ho; vy = 0 }
      else if (overlapStart(x, startY + ho, startY + PH)) { y = startY; vy = 0 }
    }
    if (was && !g && !jumped) coy = COYOTE_F
    if (g) coy = 0
    return { x, y, vy, g, cut, air: Math.min(air, 40), coy }
  }
  return { H, W, step, isSolid }
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

const keyOf = (s) => `${s.x}|${Math.round(s.y * 100)}|${Math.round(s.vy * 1000)}|${s.g ? 1 : 0}|${s.cut ? s.air : -1}|${s.coy}`

// Клетка, в которой герой стоит: под серединой; середина над пустотой — та
// клетка бокса, что держит.
function cellOf(s, S) {
  const cy = Math.round((s.y + PH) / T) - 1
  const c = Math.floor((s.x + PW / 2) / T)
  if (S.has(c + ',' + cy)) return c + ',' + cy
  for (const cx of [Math.floor((s.x + 1) / T), Math.floor((s.x + PW - 1) / T)]) if (S.has(cx + ',' + cy)) return cx + ',' + cy
  return null
}

export function cellEdges(grid) {
  const world = makeWorld(grid)
  const S = standingCells(grid)
  const edges = new Map()
  for (const k of S) {
    const [cx, cy] = k.split(',').map(Number)
    const out = new Set()
    const seen = new Set()
    const q = []
    const y0 = (cy + 1) * T - PH
    for (let x = cx * T - PW + 2; x <= cx * T + T - 2; x += 2) {
      let s = { x, y: y0, vy: 0, g: true, cut: false, air: 0, coy: 0 }
      // Стоит ли тут вообще: кадр без ввода — на земле и на месте.
      const t = world.step(s, 0, false, false)
      if (!t.g || t.x !== x || Math.abs(t.y - y0) > 0.01) continue
      if (cellOf(t, S) !== k) continue
      const kk = keyOf(t)
      if (!seen.has(kk)) { seen.add(kk); q.push([t, 0]) }
    }
    for (let i = 0; i < q.length; i++) {
      const [s, f] = q[i]
      if (f > AIR_MAX_F) continue
      const opts = []
      for (const dir of [-1, 0, 1]) {
        if (s.g || s.coy > 0) opts.push([dir, true, true])
        opts.push([dir, false, true])
        if (s.cut && CUT_AT.has(s.air + 1)) opts.push([dir, false, false])
      }
      for (const [dir, jump, held] of opts) {
        const n = world.step(s, dir, jump, held)
        if (n.y > grid.length * T) continue
        if (n.g) {
          const c = cellOf(n, S)
          if (c !== null && c !== k) { out.add(c); continue }
          if (c === null) continue
        }
        const kk = keyOf(n)
        if (seen.has(kk)) continue
        seen.add(kk)
        q.push([n, n.g ? 0 : f + 1])
      }
    }
    edges.set(k, out)
  }
  return { S, edges }
}

export function waveFrom(edges, start, reverse) {
  const adj = new Map()
  if (reverse) {
    for (const [a, outs] of edges) for (const b of outs) { if (!adj.has(b)) adj.set(b, []); adj.get(b).push(a) }
  } else for (const [a, outs] of edges) adj.set(a, [...outs])
  const seen = new Set([start])
  const q = [start]
  for (let i = 0; i < q.length; i++) for (const n of adj.get(q[i]) ?? []) if (!seen.has(n)) { seen.add(n); q.push(n) }
  return seen
}

function main() {
  const args = process.argv.slice(2)
  const ji = args.indexOf('--json')
  const jsonOut = ji >= 0 ? args[ji + 1] : null
  const letters = args.filter((a, i) => !a.startsWith('--') && (ji < 0 || i !== ji + 1))
  const files = fs.readdirSync(MAPS).filter((f) => /^map_[A-Z0-9]+_.*\.txt$/.test(f))
  const want = letters.length ? letters : [...new Set(files.map((f) => f.split('_')[1]))].sort()
  const dump = {}
  let bad = 0
  for (const L of want) {
    const txt = files.filter((f) => f.split('_')[1] === L)
    if (txt.length !== 1) { console.log(`${L}: .txt не один — ${txt}`); continue }
    const grid = loadGrid(path.join(MAPS, txt[0]))
    const slots = JSON.parse(fs.readFileSync(path.join(MAPS, `map_${L}_slots.json`), 'utf8'))
    const start = slots.start.join(',')
    const t0 = Date.now()
    const { S, edges } = cellEdges(grid)
    const f = waveFrom(edges, start, false)
    const b = waveFrom(edges, start, true)
    const lostF = [...S].filter((c) => !f.has(c))
    const lostB = [...S].filter((c) => f.has(c) && !b.has(c))
    console.log(`== ${L} (${txt[0]}): клеток ${S.size}, туда ${f.size}, обратно ${[...f].filter((c) => b.has(c)).length}, ${((Date.now() - t0) / 1000).toFixed(1)} с`)
    if (lostF.length) console.log(`   не дойти: ${lostF.sort().join(' ')}`)
    if (lostB.length) console.log(`   не вернуться: ${lostB.sort().join(' ')}`)
    if (lostF.length || lostB.length) bad++
    dump[L] = { S: [...S], edges: Object.fromEntries([...edges].map(([k, v]) => [k, [...v]])), lostF, lostB }
  }
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(dump))
  process.exitCode = bad ? 1 : 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
