// Серверный розыгрыш "3 события за забег" — портирован по поведению (не по
// коду) с src/explore/mapEvents.ts (buildEventCandidates) и с блока выбора
// тройки в src/Explore.tsx. Источник данных — server/src/maps/*_slots.json
// (см. AUDIT.md §7 — синхронизированы с public/assets/maps/ вручную, но это
// не гарантия на будущее: файлы могут снова разойтись).

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// --- Пути ---
// Считаем от расположения САМОГО этого файла, а не от process.cwd() —
// см. отчёт в чате про dist/maps (после tsc-сборки папки maps там нет,
// см. заметку в конце файла).
const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const MAPS_DIR = join(MODULE_DIR, 'maps')

// Белый список карт, которые реально существуют на клиенте (EXPLORE_MAPS в
// src/App.tsx + D_OPEN/D_SEALED, см. "D Тайник (50/50)" там же) — источник
// правды для валидации mapFile из запроса клиента (сверка на ТОЧНОЕ
// совпадение, не префикс/regex — см. POST /run/start-explore в run.ts).
export const KNOWN_MAP_FILES = [
  'map_A_serpentine.txt',
  'map_B_razlom.txt',
  'map_C_boss_descent.txt',
  'map_D_OPEN.txt',
  'map_D_SEALED.txt',
  'map_E_towers.txt',
  'map_F_sanctuary.txt',
] as const

export type MapFile = (typeof KNOWN_MAP_FILES)[number]

// --- Константы, перенесённые с клиента (src/explore/constants.ts) ---
// Значения — 1:1 с клиентом на момент переноса. Если на клиенте изменятся,
// здесь придётся обновить руками — общего источника констант нет.
export const EVENTS_PER_RUN = 3 // constants.ts:763
export const BOSS_SPAWN_CHANCE = 0.3 // constants.ts:767
export const CHEST_MIMIC_CHANCE = 0.2 // constants.ts:371
export const TROPHY_MULT_ENEMY = 1 // constants.ts:457
export const TROPHY_MULT_CHEST = 3 // constants.ts:458
export const TROPHY_MULT_OBELISK = 2 // constants.ts:459
export const TROPHY_MULT_BOSS = 4 // constants.ts:460
export const TROPHY_BASE = 12.5 // constants.ts:452
export const TROPHY_LEVEL_POWER = 0.446 // constants.ts:453
export const TROPHY_SPREAD = 0.4 // constants.ts:454, разброс +-20%

// --- Типы ---

export type RunEventKind = 'enemy' | 'chest' | 'smuggler' | 'puzzle' | 'boss' | 'obelisk'

// Кандидат из пула — эквивалент EventCandidate на клиенте (src/explore/types.ts:12).
type EventCandidate = {
  kind: RunEventKind
  x: number
  y: number
  clusterPoints?: [number, number][]
}

// Итоговое разыгранное событие — то, что кладётся в currentRun/отдаётся клиенту.
// trophyReward === 0 для smuggler/puzzle: на клиенте для этих двух типов
// rollTrophies вообще не вызывается (нет TROPHY_MULT_SMUGGLER/PUZZLE) — здесь
// повторяем то же самое, а не изобретаем множитель, которого нет в оригинале.
export type RunEvent = {
  kind: RunEventKind
  x: number
  y: number
  clusterPoints?: [number, number][]
  trophyReward: number
  isMimic?: boolean // только для kind === 'chest'
}

type SlotsFile = {
  enemyClusters?: { points?: unknown }[]
  reward?: unknown[]
  npc?: { smuggler?: unknown; puzzle?: unknown }
  boss?: unknown
  obelisk?: { points?: unknown }
}

function isPointXY(value: unknown): value is [number, number] {
  return Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'number'
}

// "N без повторов" — тот же алгоритм, что pickRandom в src/explore/utils.ts:
// копия массива, случайный индекс, splice, пока не наберём count или не
// кончится пул. Если в пуле меньше count — отдаёт весь пул, без ошибки.
function pickRandom<T>(items: T[], count: number): T[] {
  const pool = [...items]
  const picked: T[] = []
  while (pool.length > 0 && picked.length < count) {
    const i = Math.floor(Math.random() * pool.length)
    picked.push(pool[i])
    pool.splice(i, 1)
  }
  return picked
}

// Та же формула, что rollTrophies в src/explore/rewards.ts — level передаётся
// параметром (на клиенте там PLAYER_LEVEL_FALLBACK=1, на сервере — реальный
// character.level).
export function rollTrophies(multiplier: number, level: number): number {
  const spread = (1 - TROPHY_SPREAD / 2) + Math.random() * TROPHY_SPREAD
  return Math.round(TROPHY_BASE * Math.pow(level, TROPHY_LEVEL_POWER) * spread * multiplier)
}

// Имя слот-файла по имени карты — та же схема, что slotsFileForMap в
// src/explore/mapEvents.ts:20-26, включая ветку map_D_* (слоты по СОСТОЯНИЮ
// OPEN/SEALED, не по первому токену — см. CLAUDE.md "Особая механика:
// тайник карты D").
export function slotsFileForMap(mapFile: string): string {
  if (mapFile.startsWith('map_D_')) {
    return `${mapFile.replace(/\.txt$/, '')}_slots.json`
  }
  const mapId = mapFile.match(/^map_([^_]+)_/)?.[1] ?? mapFile
  return `map_${mapId}_slots.json`
}

function readSlots(mapFile: string): SlotsFile {
  const path = join(MAPS_DIR, slotsFileForMap(mapFile))
  const raw = readFileSync(path, 'utf-8')
  return JSON.parse(raw) as SlotsFile
}

// Пул кандидатов — эквивалент buildEventCandidates в src/explore/mapEvents.ts:38-74.
// Порядок типов в пуле тот же: enemy, chest, smuggler, puzzle, boss, obelisk.
function buildEventCandidates(slots: SlotsFile): EventCandidate[] {
  const candidates: EventCandidate[] = []

  for (const cluster of slots.enemyClusters ?? []) {
    const points = Array.isArray(cluster?.points) ? cluster.points.filter(isPointXY) : []
    const first = points[0]
    if (first) candidates.push({ kind: 'enemy', x: first[0], y: first[1], clusterPoints: points })
  }
  for (const point of slots.reward ?? []) {
    if (isPointXY(point)) candidates.push({ kind: 'chest', x: point[0], y: point[1] })
  }
  for (const point of Array.isArray(slots.npc?.smuggler) ? slots.npc.smuggler : []) {
    if (isPointXY(point)) candidates.push({ kind: 'smuggler', x: point[0], y: point[1] })
  }
  for (const point of Array.isArray(slots.npc?.puzzle) ? slots.npc.puzzle : []) {
    if (isPointXY(point)) candidates.push({ kind: 'puzzle', x: point[0], y: point[1] })
  }
  if (isPointXY(slots.boss)) candidates.push({ kind: 'boss', x: slots.boss[0], y: slots.boss[1] })

  // Обелиск — ОДИН кандидат на всё событие (не по одному на точку, иначе
  // за забег могло бы выпасть несколько обелиск-событий сразу) — та же
  // причина и тот же приём (pickRandom одной точки уже здесь, при сборке
  // пула), что и в mapEvents.ts:64-71.
  const obeliskPoints = Array.isArray(slots.obelisk?.points) ? (slots.obelisk.points as unknown[]).filter(isPointXY) : []
  const obeliskStart = pickRandom(obeliskPoints, 1)[0]
  if (obeliskStart) candidates.push({ kind: 'obelisk', x: obeliskStart[0], y: obeliskStart[1] })

  return candidates
}

// Выбор тройки с гарантиями — та же логика и тот же порядок проверок, что
// Explore.tsx:483-503:
//   1) map_D_OPEN* -> смуглер, если есть в пуле, гарантированно первым
//   2) иначе бросок BOSS_SPAWN_CHANCE -> если выпал И боссу есть кандидат,
//      он гарантированно первым
//   3) иначе обычный pickRandom по всему пулу (босс-кандидат, если он был,
//      исключается из пула заранее, чтобы pickRandom не мог вытащить его
//      сам по себе при непрошедшем броске)
// Если гарантированного кандидата в пуле нет (index === -1) — просто
// проваливаемся к следующей проверке, как и клиент.
function pickChosenEvents(mapFile: string, eventPool: EventCandidate[]): EventCandidate[] {
  const smugglerIndex = mapFile.startsWith('map_D_OPEN')
    ? eventPool.findIndex((ev) => ev.kind === 'smuggler')
    : -1
  const bossIndex = eventPool.findIndex((ev) => ev.kind === 'boss')
  const bossWillSpawn = bossIndex !== -1 && Math.random() < BOSS_SPAWN_CHANCE

  if (smugglerIndex !== -1) {
    const smugglerCandidate = eventPool[smugglerIndex]
    const restPool = eventPool.filter((_, i) => i !== smugglerIndex)
    return [smugglerCandidate, ...pickRandom(restPool, EVENTS_PER_RUN - 1)]
  }
  if (bossWillSpawn) {
    const bossCandidate = eventPool[bossIndex]
    const restPool = eventPool.filter((_, i) => i !== bossIndex)
    return [bossCandidate, ...pickRandom(restPool, EVENTS_PER_RUN - 1)]
  }
  const poolWithoutBoss = bossIndex !== -1 ? eventPool.filter((_, i) => i !== bossIndex) : eventPool
  return pickRandom(poolWithoutBoss, EVENTS_PER_RUN)
}

// Множитель trophyReward по типу события — те же TROPHY_MULT_* что на
// клиенте (см. константы выше). smuggler/puzzle сюда не попадают: на
// клиенте для них rollTrophies не вызывается вообще (нет соответствующих
// множителей), поэтому здесь у них trophyReward всегда 0.
const TROPHY_MULT_BY_KIND: Partial<Record<RunEventKind, number>> = {
  enemy: TROPHY_MULT_ENEMY,
  chest: TROPHY_MULT_CHEST,
  obelisk: TROPHY_MULT_OBELISK,
  boss: TROPHY_MULT_BOSS,
}

// Точка входа модуля: читает слот-файл карты, выбирает тройку событий по
// тем же правилам и гарантиям, что клиент, и разыгрывает награду для
// каждого. characterLevel идёт в rollTrophies вместо клиентской заглушки
// PLAYER_LEVEL_FALLBACK.
export function rollRunEvents(mapFile: string, characterLevel: number): RunEvent[] {
  const slots = readSlots(mapFile)
  const eventPool = buildEventCandidates(slots)
  const chosenEvents = pickChosenEvents(mapFile, eventPool)

  return chosenEvents.map((ev) => {
    const multiplier = TROPHY_MULT_BY_KIND[ev.kind]

    if (ev.kind === 'chest') {
      const isMimic = Math.random() < CHEST_MIMIC_CHANCE
      return {
        ...ev,
        isMimic,
        // Мимик — чистое наказание, без награды (Explore.tsx:2042: rollTrophies
        // вызывается только "if (!chest.isMimic)").
        trophyReward: isMimic ? 0 : rollTrophies(multiplier!, characterLevel),
      }
    }

    return {
      ...ev,
      trophyReward: multiplier !== undefined ? rollTrophies(multiplier, characterLevel) : 0,
    }
  })
}
