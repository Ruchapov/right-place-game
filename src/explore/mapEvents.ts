import type { BackdropPreset } from '../mapRenderer'
import * as C from './constants'
import type { EventCandidate } from './types'
import { pickRandom } from './utils'
import { PATROL_EVENT_CLEARANCE, remainingPoints } from '../runExtras'

export function backdropForMap(mapFile: string): BackdropPreset {
  const mapId = mapFile.match(/^map_([^_]+)_/)?.[1] ?? mapFile
  const theme = C.BACKDROP_BY_MAP[mapId]
  if (theme) return theme
  // Неизвестная карта — громко: иначе она молча получила бы фон кладбища.
  console.error(`backdropForMap: у карты ${mapFile} (id ${mapId}) нет темы в BACKDROP_BY_MAP — фон кладбища как запасной`)
  return 'graveyard'
}

// Слот-файл называется по mapId, а не по полному имени карты:
// map_C_casting-yards.txt и map_C2_swamp_boss.txt -> map_C_slots.json и
// map_C2_slots.json. Берём именно первый токен после "map_", а не отбрасываем
// последний "_xxx.txt" — иначе на многословных именах получим не тот файл.
// Исключения для карты D (слоты по состоянию тайника OPEN/SEALED) нет с
// 10.11.2026: у новой D тайника нет.
export function slotsFileForMap(mapFile: string): string {
  const mapId = mapFile.match(/^map_([^_]+)_/)?.[1] ?? mapFile
  return `map_${mapId}_slots.json`
}

export function isPointXY(value: unknown): value is [number, number] {
  return Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'number'
}

// Собирает ВСЕ доступные точки-кандидаты события из пулов слот-файла карты.
// enemyCluster (3 врага) считается ОДНИМ событием — x/y (для HUD/логов) берём
// из первой точки, но clusterPoints несёт ВСЕ валидные точки кластера, чтобы
// на споне поставить весь кластер, а не одного врага. npc.smuggler/npc.puzzle/
// boss могут отсутствовать (null) — на карте A их нет, но механизм общий для
// всех карт A-F.
export function buildEventCandidates(slots: unknown): EventCandidate[] {
  const s = slots as {
    enemyClusters?: { points?: unknown }[]
    reward?: unknown[]
    npc?: { smuggler?: unknown; puzzle?: unknown }
    boss?: unknown
    obelisk?: { points?: unknown }
  } | null
  const candidates: EventCandidate[] = []

  for (const cluster of s?.enemyClusters ?? []) {
    const points = Array.isArray(cluster?.points) ? cluster.points.filter(isPointXY) : []
    const first = points[0]
    if (first) candidates.push({ kind: 'enemy', x: first[0], y: first[1], clusterPoints: points })
  }
  for (const point of s?.reward ?? []) {
    if (isPointXY(point)) candidates.push({ kind: 'chest', x: point[0], y: point[1] })
  }
  for (const point of Array.isArray(s?.npc?.smuggler) ? s.npc.smuggler : []) {
    if (isPointXY(point)) candidates.push({ kind: 'smuggler', x: point[0], y: point[1] })
  }
  for (const point of Array.isArray(s?.npc?.puzzle) ? s.npc.puzzle : []) {
    if (isPointXY(point)) candidates.push({ kind: 'puzzle', x: point[0], y: point[1] })
  }
  if (isPointXY(s?.boss)) candidates.push({ kind: 'boss', x: s.boss[0], y: s.boss[1] })

  // Обелиски (карта F) — ОДИН кандидат на всё событие (не по одному на
  // точку, иначе за забег могло бы выпасть несколько обелиск-событий сразу).
  // Точка старта обелиска выбирается pickRandom'ом из пула здесь же; полный
  // пул для доспавна оставшихся трёх (после первого удара) хранится отдельно
  // в obeliskCandidatesRef (см. setup()), не в этом кандидате.
  const obeliskPoints = Array.isArray(s?.obelisk?.points) ? (s.obelisk.points as unknown[]).filter(isPointXY) : []
  const obeliskStart = pickRandom(obeliskPoints, 1)[0]
  if (obeliskStart) candidates.push({ kind: 'obelisk', x: obeliskStart[0], y: obeliskStart[1] })

  // Носитель огня и Беглец (11.11.2026) — по одному кандидату, как на сервере
  // (buildEventCandidates в server/src/runEvents.ts). Точки — заглушка: их
  // раздают devPlaceFlame / devPlaceRunner ниже, после выбора тройки.
  const rewardPoints = (s?.reward ?? []).filter(isPointXY)
  if (rewardPoints.length >= 3) candidates.push({ kind: 'flame', x: rewardPoints[0][0], y: rewardPoints[0][1] })
  const enemyPool = enemyPointPool(slots)
  if (enemyPool.length > 0) candidates.push({ kind: 'runner', x: enemyPool[0][0], y: enemyPool[0][1] })

  return candidates
}

// --- Офлайн-заглушка: места Носителя огня и Беглеца (11.11.2026) ---
// Те же правила, что placeFlame / placeRunner на сервере (runEvents.ts); здесь
// — только чтобы событие можно было проверить вне Telegram. Сверять не надо.

function enemyPointPool(slots: unknown): [number, number][] {
  const clusters = (slots as { enemyClusters?: { points?: unknown }[] } | null)?.enemyClusters ?? []
  return clusters.flatMap((c) => Array.isArray(c?.points) ? c.points.filter(isPointXY) : [])
}

const pointKey = (p: readonly [number, number]) => `${p[0]},${p[1]}`

/** Все клетки события: группа — её точки, огонь — жаровня и чаша, прочие — x, y. */
export function eventCells(ev: EventCandidate): [number, number][] {
  const own: [number, number][] = ev.clusterPoints ?? [[ev.x, ev.y]]
  return ev.goal ? [...own, ev.goal] : own
}

function devReplacement(pool: EventCandidate[], chosen: EventCandidate[]): EventCandidate | null {
  const flameCells = new Set(chosen.flatMap((ev) => ev.kind === 'flame' ? eventCells(ev).map(pointKey) : []))
  const taken = new Set(chosen.map((ev) => `${ev.kind}:${ev.x},${ev.y}`))
  const free = pool.filter((c) => !taken.has(`${c.kind}:${c.x},${c.y}`)
    && c.kind !== 'boss' && c.kind !== 'flame' && c.kind !== 'runner' && c.kind !== 'enemy'
    && !(c.kind === 'chest' && flameCells.has(pointKey([c.x, c.y]))))
  return pickRandom(free, 1)[0] ?? null
}

/** Жаровня и чаша — самая далёкая пара точек reward без сундуков; кто где — 50/50. */
export function devPlaceFlame(slots: unknown, pool: EventCandidate[], chosen: EventCandidate[]): EventCandidate[] {
  const i = chosen.findIndex((ev) => ev.kind === 'flame')
  if (i === -1) return chosen
  const chestCells = new Set(chosen.filter((ev) => ev.kind === 'chest').map((ev) => pointKey([ev.x, ev.y])))
  const free = ((slots as { reward?: unknown[] } | null)?.reward ?? []).filter(isPointXY).filter((p) => !chestCells.has(pointKey(p)))
  let best: [[number, number], [number, number]] | null = null
  let bestD = -1
  for (let a = 0; a < free.length; a++) {
    for (let b = a + 1; b < free.length; b++) {
      const d = Math.hypot(free[a][0] - free[b][0], free[a][1] - free[b][1])
      if (d > bestD) { bestD = d; best = [free[a], free[b]] }
    }
  }
  if (best) {
    const [s, g] = Math.random() < 0.5 ? best : [best[1], best[0]]
    return chosen.map((ev, k) => k === i ? { ...ev, x: s[0], y: s[1], goal: [g[0], g[1]] } : ev)
  }
  const rest = chosen.filter((_, k) => k !== i)
  const swap = devReplacement(pool, rest)
  return swap ? [...rest.slice(0, i), swap, ...rest.slice(i)] : rest
}

/** Беглец — свободная от групп точка врагов, не ближе PATROL_EVENT_CLEARANCE к другим событиям. */
export function devPlaceRunner(slots: unknown, pool: EventCandidate[], chosen: EventCandidate[]): EventCandidate[] {
  const i = chosen.findIndex((ev) => ev.kind === 'runner')
  if (i === -1) return chosen
  const others = chosen.filter((_, k) => k !== i)
  const groupPoints = others.flatMap((ev) => ev.kind === 'enemy' ? ev.clusterPoints ?? [] : [])
  const otherCells = others.flatMap(eventCells)
  const clear = (p: [number, number]) =>
    otherCells.every((q) => q[1] !== p[1] || Math.abs(q[0] - p[0]) >= PATROL_EVENT_CLEARANCE)
  const spot = pickRandom(remainingPoints(enemyPointPool(slots), groupPoints).filter(clear), 1)[0]
  if (spot) return chosen.map((ev, k) => k === i ? { ...ev, x: spot[0], y: spot[1] } : ev)
  const swap = devReplacement(pool, others)
  return swap ? [...others.slice(0, i), swap, ...others.slice(i)] : others
}

// --- Ловушки (13.11.2026): пулы слот-файла и trapsPerRun (tools/place_traps.py) ---

export type TrapsPerRun = { spikes: number; gargoyles: number; stalactites: number; saws: number }

function count(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : fallback
}

/**
 * Сколько ловушек каждого вида за забег. Нет поля (слот-файл старше 13.11.2026)
 * — прежние HAZARD_SPIKES_PER_RUN шипов и ни одной новой ловушки, а не ошибка:
 * у такой карты пулов новых ловушек нет вовсе.
 */
export function readTrapsPerRun(raw: unknown): TrapsPerRun {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return {
    spikes: count(r.spikes, C.HAZARD_SPIKES_PER_RUN),
    gargoyles: count(r.gargoyles, 0),
    stalactites: count(r.stalactites, 0),
    saws: count(r.saws, 0),
  }
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

export function isGargoyleSlot(v: unknown): v is { x: number; y: number; dir: 1 | -1; plate: [number, number] } {
  const o = v as Record<string, unknown> | null
  return !!o && isInt(o.x) && isInt(o.y) && (o.dir === 1 || o.dir === -1) && isPointXY(o.plate)
}

export function isStalactiteSlot(v: unknown): v is { x: number; y: number; ceil: number } {
  const o = v as Record<string, unknown> | null
  return !!o && isInt(o.x) && isInt(o.y) && isInt(o.ceil)
}

export function isSawSlot(v: unknown): v is { x0: number; x1: number; y: number } {
  const o = v as Record<string, unknown> | null
  return !!o && isInt(o.x0) && isInt(o.x1) && isInt(o.y) && o.x1 > o.x0
}
