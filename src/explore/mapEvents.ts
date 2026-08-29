import type { BackdropPreset } from '../mapRenderer'
import * as C from './constants'
import type { EventCandidate } from './types'
import { pickRandom } from './utils'

export function backdropForMap(mapFile: string): BackdropPreset {
  const mapId = mapFile.match(/^map_([^_]+)_/)?.[1] ?? mapFile
  return C.BACKDROP_BY_MAP[mapId] ?? 'graveyard'
}

// Слот-файл называется по mapId, а не по полному имени карты: map_A_serpentine.txt
// и map_C_boss_descent.txt (два слова после id) оба -> map_<id>_slots.json.
// Берём именно первый токен после "map_", а не отбрасываем последний "_xxx.txt" —
// иначе на многословных именах (boss_descent) получим не тот файл.
//
// Карта D — ИСКЛЮЧЕНИЕ из этого правила: у неё слоты по СОСТОЯНИЮ (OPEN/SEALED
// заваливаемого тайника, см. CLAUDE.md), не по первому токену — файлы называются
// map_D_OPEN_slots.json / map_D_SEALED_slots.json, а не map_D_slots.json. Для
// map_D_* берём ВСЁ имя без ".txt" и добавляем "_slots.json".
export function slotsFileForMap(mapFile: string): string {
  if (mapFile.startsWith('map_D_')) {
    return `${mapFile.replace(/\.txt$/, '')}_slots.json`
  }
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

  return candidates
}
