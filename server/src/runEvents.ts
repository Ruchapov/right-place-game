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
// src/App.tsx) — источник правды для валидации mapFile из запроса клиента
// (сверка на ТОЧНОЕ совпадение, не префикс/regex — см. POST /run/start-explore
// в run.ts).
// 10.11.2026: прежние A–F (Серпантин, Разлом, Спуск к боссу, Тайник D_OPEN /
// D_SEALED, Башни, Святилище) заменены шестью новыми картами пакета
// new-six/handoff-six-maps-2026-11-10 (docs/maps.md, «Шесть новых карт»). Ключ
// пакета — второй токен имени: первый (буква) по-прежнему выбирает слоты
// (slotsFileForMap) и тему (themeForMap).
export const KNOWN_MAP_FILES = [
  'map_A_burial-quarter.txt',
  'map_B_procession.txt',
  'map_C_casting-yards.txt',
  'map_D_workshops.txt',
  'map_E_three-halls.txt',
  'map_F_eastern-stair.txt',
  // Болото (29.10.2026): имена с вторым токеном, чтобы первый (B2, C2) не путался
  // с B и C — по нему slotsFileForMap берёт слоты, а клиент — тему фона.
  'map_B2_swamp.txt',
  'map_C2_swamp_boss.txt',
  // Болото (11.11.2026): Трясинный колодец (босс) и Затопленный погост.
  'map_W_swamp-well.txt',
  'map_Y_swamp-yards.txt',
] as const

export type MapFile = (typeof KNOWN_MAP_FILES)[number]

// Логический пул карт для авто-выбора сервером, когда клиент не прислал
// mapFile (см. POST /run/start-explore). Десять слотов с равным шансом (с 11.11.2026 + W, Y).
// До 10.11.2026 слот D разыгрывал ещё OPEN/SEALED тайника — у новой D тайника нет.
const MAP_POOL = ['A', 'B', 'C', 'D', 'E', 'F', 'B2', 'C2', 'W', 'Y'] as const

// Выбирает карту забега сама (см. POST /run/start-explore: mapFile в теле
// запроса теперь необязателен). Возвращает готовое имя файла из
// KNOWN_MAP_FILES — дальше по коду (rollRunEvents/slotsFileForMap/
// pickChosenEvents) не отличается от mapFile, присланного клиентом.
export function pickRunMapFile(): MapFile {
  const slot = MAP_POOL[Math.floor(Math.random() * MAP_POOL.length)]
  switch (slot) {
    case 'A': return 'map_A_burial-quarter.txt'
    case 'B': return 'map_B_procession.txt'
    case 'C': return 'map_C_casting-yards.txt'
    case 'D': return 'map_D_workshops.txt'
    case 'E': return 'map_E_three-halls.txt'
    case 'F': return 'map_F_eastern-stair.txt'
    case 'B2': return 'map_B2_swamp.txt'
    case 'C2': return 'map_C2_swamp_boss.txt'
    case 'W': return 'map_W_swamp-well.txt'
    case 'Y': return 'map_Y_swamp-yards.txt'
  }
}

// --- Константы, перенесённые с клиента (src/explore/constants.ts) ---
// Значения — 1:1 с клиентом на момент переноса. Если на клиенте изменятся,
// здесь придётся обновить руками — общего источника констант нет.
export const EVENTS_PER_RUN = 3 // constants.ts:763
export const BOSS_SPAWN_CHANCE = 0.3 // constants.ts:767
export const CHEST_MIMIC_CHANCE = 0.2 // constants.ts:371
// 1 → 1.5 (30.10.2026, «забег насыщеннее»): в группе 5 врагов вместо 3;
// 1.5 → 1.25 (08.11.2026): в группе 4 врага (GROUP_SIZE, runExtras.ts). Пара
// на клиенте — TROPHY_MULT_ENEMY в constants.ts (её читает только офлайн-заглушка).
export const TROPHY_MULT_ENEMY = 1.25 // constants.ts:457
export const TROPHY_MULT_CHEST = 3 // constants.ts:458
export const TROPHY_MULT_OBELISK = 2 // constants.ts:459
export const TROPHY_MULT_BOSS = 4 // constants.ts:460
// Носитель огня и Беглец (11.11.2026, docs/explore-features.md). Пары на клиенте —
// TROPHY_MULT_FLAME / TROPHY_MULT_RUNNER в constants.ts (их читает офлайн-заглушка).
export const TROPHY_MULT_FLAME = 3
export const TROPHY_MULT_RUNNER = 3
export const TROPHY_BASE = 12.5 // constants.ts:452
export const TROPHY_LEVEL_POWER = 0.446 // constants.ts:453
export const TROPHY_SPREAD = 0.4 // constants.ts:454, разброс +-20%
// Контрабандист (POST /run/smuggler-quote и /run/smuggler-deal).
//
// Множитель применяется к СТАВКЕ — банку трофеев персонажа ПЛЮС трофеи событий,
// закрытых ДО сделки (см. stakeFromClosedEvents в routes/run.ts). Не к добыче
// забега и не к отдельному событию: на кону всё накопленное, в этом и смысл
// трофеев как рискованной валюты (решение дизайнера).
//
// ⚠️ БРОСОК ТЕПЕРЬ СЕРВЕРНЫЙ. Раньше исход присылал клиент полем
// smugglerOutcome, а сервер верил на слово (известное слабое место, см.
// CLAUDE.md). Теперь SMUGGLER_STEAL_CHANCE живёт здесь, бросает
// /run/smuggler-deal, результат пишется в currentRun.smugglerDeal, и финиш
// читает ЕГО, а не тело запроса.
export const SMUGGLER_MULT = 1.5 // constants.ts:429
export const SMUGGLER_STEAL_FRAC = 0.5 // constants.ts:431
// Вероятность кражи вместо удачи. Копия клиентской SMUGGLER_STEAL_CHANCE
// (constants.ts:790), но источник правды теперь ЗДЕСЬ: клиентская осталась
// только у офлайн-заглушки всплывашки и на исход больше не влияет.
export const SMUGGLER_STEAL_CHANCE = 0.2 // constants.ts:790

/**
 * Чьей окажется группа врагов: веса трёх видов (06.10.2026).
 *
 * Звери 45%, Звонари 30%, Привратники 25% — решение дизайнера. Это ВЕСА, а не
 * проценты: rollEnemyKind делит на их сумму, так что правка одного числа не
 * требует подгонять остальные под сотню.
 *
 * ⚠️ Живут ТОЛЬКО ЗДЕСЬ, копии на клиенте НЕТ и заводить не надо: бросает
 * сервер, клиент получает готовый `enemyKind` в событии и просто рисует то,
 * что сказано. Это тот же приём, что у TROPHY_GOLD_RATE (CLAUDE.md, таблица
 * копий): передать значением дешевле, чем держать ещё одну ручную копию без
 * сверяющего скрипта.
 *
 * Офлайн-заглушка клиента (вне Telegram) бросает своими числами и с этими НЕ
 * сверяется намеренно — она и так помечена оранжевой плашкой «ЗАГЛУШКА».
 *
 * Прежняя ZVONAR_GROUP_CHANCE = 0.3 (один бросок «Звонарь или зверь») заменена
 * этой таблицей: доля Звонарей осталась 30%, Привратники забрали свои 25% у
 * зверей.
 */
export const ENEMY_GROUP_WEIGHTS: Partial<Record<RunEnemyKind, number>> = {
  beast: 45,
  zvonar: 30,
  gatekeeper: 25,
}

/**
 * Тема карты — по её id (map_<id>_…), как BACKDROP_BY_MAP на клиенте
 * (src/explore/constants.ts): A, B — кладбище; C, D — литейная; E, F —
 * затопленный склеп; B2, C2, W, Y — болото (новые шесть карт, 10.11.2026; до этого
 * A, F — кладбище, B, D — склеп, C, E — литейная).
 */
export type MapTheme = 'graveyard' | 'flooded_crypt' | 'foundry' | 'swamp'
export function themeForMap(mapFile: string): MapTheme | null {
  const id = mapFile.match(/^map_([^_]+)_/)?.[1] ?? ''
  if (id === 'A' || id === 'B') return 'graveyard'
  if (id === 'E' || id === 'F') return 'flooded_crypt'
  if (id === 'C' || id === 'D') return 'foundry'
  if (id === 'B2' || id === 'C2' || id === 'W' || id === 'Y') return 'swamp'
  return null
}

/**
 * Веса видов групп ПО ТЕМЕ КАРТЫ (09.11.2026, решение дизайнера): к прежним
 * трём добавлены Безликий фехтовальщик и Арбалетчик (везде) и «свой» враг темы —
 * Гробокопатель на кладбище, Кочегар в литейной, Навозник на болоте. Группы
 * по-прежнему однородные. Неизвестная тема — прежняя таблица.
 */
export const ENEMY_GROUP_WEIGHTS_BY_THEME: Record<MapTheme, Partial<Record<RunEnemyKind, number>>> = {
  graveyard: { beast: 20, zvonar: 15, gatekeeper: 15, fencer: 15, crossbowman: 15, gravedigger: 20 },
  flooded_crypt: { beast: 25, zvonar: 20, gatekeeper: 20, fencer: 20, crossbowman: 15 },
  foundry: { beast: 20, zvonar: 15, gatekeeper: 15, fencer: 15, crossbowman: 15, stoker: 20 },
  swamp: { beast: 20, zvonar: 15, gatekeeper: 15, fencer: 15, crossbowman: 15, beetle: 20 },
}

/**
 * Сундук (09.11.2026): три исхода — обычный 70%, мимик 20% (CHEST_MIMIC_CHANCE),
 * Тень 10%. Тень: трофеи сундука × CHEST_SHADOW_TROPHY_MULT; начисляются (вместе
 * с добычей), только если Тень убита — клиент закрывает событие сундука её
 * смертью, а финиш начисляет только закрытые события.
 */
export const CHEST_SHADOW_CHANCE = 0.1
export const CHEST_SHADOW_TROPHY_MULT = 1.5

/**
 * Какой босс выйдет на карте с местом босса (09.11.2026): на C — Тварь / Змей /
 * Король, на C2 и W (ABBOT_MAP_PREFIXES, game.ts) — Настоятель / Змей / Король, по трети. Отдаётся клиенту полем
 * bossKind события boss; клиент своего броска не делает.
 */
export type RunBossKind = 'werewolf' | 'abbot' | 'serpent' | 'crowking'
export function rollBossKind(mapFile: string): RunBossKind {
  const first: RunBossKind = ABBOT_MAP_PREFIXES.some((p) => mapFile.startsWith(p)) ? 'abbot' : 'werewolf'
  const pool: RunBossKind[] = [first, 'serpent', 'crowking']
  return pool[Math.floor(Math.random() * pool.length)]
}

/**
 * Один бросок вида группы по весам выше. Порядок перебора — порядок ключей
 * таблицы; на вероятности он не влияет.
 *
 * Последний вид возвращается и «на остаток»: при roll, равном сумме весов из-за
 * округления чисел с плавающей точкой, цикл иначе не вернул бы ничего.
 *
 * Привратник — только с GATEKEEPER_MIN_LEVEL (08.11.2026, общий runExtras.ts):
 * ниже его вес 0, звери и Звонари делятся по своим весам (45 : 30).
 */
export function rollEnemyKind(characterLevel: number, mapFile = ''): RunEnemyKind {
  const theme = themeForMap(mapFile)
  const table = theme ? ENEMY_GROUP_WEIGHTS_BY_THEME[theme] : ENEMY_GROUP_WEIGHTS
  const weight = (k: RunEnemyKind): number =>
    k === 'gatekeeper' && !(characterLevel >= GATEKEEPER_MIN_LEVEL) ? 0 : table[k] ?? 0
  const kinds = (Object.keys(table) as RunEnemyKind[]).filter((k) => weight(k) > 0)
  const total = kinds.reduce((sum, k) => sum + weight(k), 0)
  let roll = Math.random() * total
  for (const kind of kinds) {
    roll -= weight(kind)
    if (roll < 0) return kind
  }
  return kinds[kinds.length - 1]
}

// --- Типы ---

import type { EventDrop } from './runDrops.js'
import { ABBOT_MAP_PREFIXES } from './game.js'
import { ELITE_CHANCE, GATEKEEPER_MIN_LEVEL, GROUP_SIZE, PATROL_EVENT_CLEARANCE, TROPHY_MULT_PATROL, eliteGroupTrophies, pickPatrolSpots, remainingPoints, scatterGroupPoints } from './runExtras.js'

export type RunEventKind = 'enemy' | 'chest' | 'smuggler' | 'puzzle' | 'boss' | 'obelisk' | 'flame' | 'runner'

/**
 * Виды событий, которые выпадают только клиенту, назвавшему их в теле старта
 * (`eventKinds`, 11.11.2026). Telegram держит старый бандл в кэше: старый клиент
 * поля не шлёт, рисовать эти события не умеет — и не получает их никогда.
 */
export const OPT_IN_EVENT_KINDS = ['flame', 'runner'] as const
export type OptInEventKind = (typeof OPT_IN_EVENT_KINDS)[number]

/** Разбор `eventKinds` тела старта: нет поля — []; не массив — null (отказ 400). */
export function parseOptInEventKinds(raw: unknown): OptInEventKind[] | null {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) return null
  // Незнакомые строки молча пропускаются: клиент новее сервера может прислать
  // вид, которого здесь ещё нет, — его просто не будет в пуле.
  return OPT_IN_EVENT_KINDS.filter((k) => raw.includes(k))
}

/**
 * Чья это группа врагов. Только для kind === 'enemy'.
 *
 * 'beast'      — зверь ближнего боя, как было всегда;
 * 'zvonar'     — Звонарь, дальний бой (04.10.2026);
 * 'gatekeeper' — Привратник, ближний бой с дверью-щитом (06.10.2026).
 *
 * Группа ОДНОРОДНАЯ: смешанных нет. Трофеи и добыча у всех трёх одинаковые —
 * бросок вида идёт ПОСЛЕ них и на них не влияет (см. rollRunEvents).
 */
export type RunEnemyKind = 'beast' | 'zvonar' | 'gatekeeper' | 'fencer' | 'gravedigger' | 'crossbowman' | 'stoker' | 'beetle'
export const RUN_ENEMY_KINDS: readonly RunEnemyKind[] = ['beast', 'zvonar', 'gatekeeper', 'fencer', 'gravedigger', 'crossbowman', 'stoker', 'beetle']

// Кандидат из пула — эквивалент EventCandidate на клиенте (src/explore/types.ts:12).
type EventCandidate = {
  kind: RunEventKind
  x: number
  y: number
  clusterPoints?: [number, number][]
  /** Чаша Носителя огня (только flame): x, y — жаровня. */
  goal?: [number, number]
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
  /**
   * Чаша Носителя огня (11.11.2026) — только у kind === 'flame'; x, y — жаровня.
   * Обе — точки reward карты, самые далёкие друг от друга из свободных.
   */
  goal?: [number, number]
  trophyReward: number
  /**
   * Ловушка или обычный сундук — только для kind === 'chest'.
   *
   * Бросок ОДИН, здесь, на старте забега (CHEST_MIMIC_CHANCE в rollRunEvents), и
   * с 13.10.2026 он же уходит клиенту (clientRunEvents ниже): какой сундук
   * взорвётся, решает сервер, клиент своего броска не делает. До этого клиент
   * бросал сам, на первом ударе по сундуку, и два броска не совпадали: сундук
   * взрывался, а сервер считал его обычным и начислял трофеи, — и наоборот.
   */
  isMimic?: boolean
  /** Тень из сундука (09.11.2026) — только у chest; поля нет — Тени нет. */
  isShadow?: boolean
  /** Какой босс (09.11.2026) — только у boss; поля нет — по карте (забег раньше). */
  bossKind?: RunBossKind
  /**
   * Чья группа — только для kind === 'enemy' (04.10.2026).
   *
   * Поля НЕТ — забег начат СТАРЫМ сервером, где Звонаря не существовало: такую
   * группу клиент обязан читать как звериную. Отдельного значения под это не
   * заводим ровно потому, что отсутствие и значит «звери».
   */
  enemyKind?: RunEnemyKind
  /**
   * Элитный враг группы (30.10.2026) — индекс в clusterPoints. Только у
   * kind === 'enemy', с шансом ELITE_CHANCE (runExtras.ts). Поля НЕТ — элиты
   * нет (и у забегов, начатых раньше). Его трофеи уже внутри trophyReward
   * (eliteGroupTrophies), его HP — ×ELITE_HP_MULT в потолке (clampRunProgress).
   */
  eliteIndex?: number
  /**
   * Что выпадет с этого события, разыгранное НА СТАРТЕ (30.09.2026).
   *
   *   EventDrop — выпало вот это;
   *   null      — бросок был, не выпало ничего (самый частый исход);
   *   поля НЕТ  — забег НАЧАТ СТАРЫМ СЕРВЕРОМ, добыча в нём не разыграна вовсе.
   *
   * Три состояния, а не два, и свести их нельзя: «не выпало» и «сервер тогда
   * этого не умел» требуют РАЗНОГО поведения на финише — в первом случае не
   * начислять ничего, во втором бросить кости запасным путём (rollRunDrops).
   *
   * Импорт типа — только типовой (`import type`), поэтому цикла с runDrops.ts
   * (он импортирует отсюда RunEvent/RunEventKind, тоже типами) в рантайме нет:
   * оба импорта стираются при компиляции.
   */
  drop?: EventDrop | null
  /**
   * ВТОРАЯ добыча события — отдельный бросок поверх `drop` (18.10.2026). Сейчас
   * это только Печать отречения с босса (rollEventExtraDrop в runDrops.ts), у
   * остальных событий здесь всегда null.
   *
   * Те же три состояния, что у `drop`, но «поля нет» значит другое: забег начат
   * сервером старше 18.10.2026, и второй добычи у него не было вовсе. Бросать
   * за него кости запасным путём НЕ нужно — `drop` у такого забега уже есть, а
   * Печати тогда в игре не существовало.
   */
  extraDrop?: EventDrop | null
  /**
   * Руна (09.11.2026, docs/items.md, «РУНЫ») — третий, отдельный бросок поверх
   * всей добычи, только у групп врагов и боссов (rollRune, runes.ts). null — не
   * выпало (или событие не того вида). Поля нет — забег начат сервером старше
   * 09.11.2026: рун тогда не было, бросать за него нечего.
   */
  runeDrop?: EventDrop | null
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
// calculateLevel(character.strength, character.agility, character.endurance,
// character.bonusLevels), см. вызов в routes/run.ts — уровень не хранится
// колонкой, эта функция ничего о его источнике не знает).
export function rollTrophies(multiplier: number, level: number): number {
  const spread = (1 - TROPHY_SPREAD / 2) + Math.random() * TROPHY_SPREAD
  return Math.round(TROPHY_BASE * Math.pow(level, TROPHY_LEVEL_POWER) * spread * multiplier)
}

// Имя слот-файла по имени карты — та же схема, что slotsFileForMap в
// src/explore/mapEvents.ts: map_<id>_slots.json по первому токену. Ветки
// map_D_* (слоты по состоянию тайника OPEN/SEALED) нет с 10.11.2026 — у новой
// D тайника нет.
export function slotsFileForMap(mapFile: string): string {
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
function buildEventCandidates(slots: SlotsFile, optIn: readonly OptInEventKind[]): EventCandidate[] {
  const candidates: EventCandidate[] = []

  // Кластер — «билет» группы в розыгрыше (их число — шанс выпасть группе), а
  // её точки не его: группе их раздаёт scatterEnemyGroups из общего пула
  // (30.10.2026). Здесь clusterPoints — заглушка до раздачи.
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

  // Носитель огня и Беглец (11.11.2026) — по ОДНОМУ кандидату на карту, как
  // обелиск, и только клиенту, который их знает. Точки здесь — заглушка: их
  // раздают placeFlame / placeRunner ПОСЛЕ выбора тройки (жаровне и чаше нужны
  // свободные от сундуков точки reward, Беглецу — свободная от групп точка врагов).
  const rewardPoints = (slots.reward ?? []).filter(isPointXY)
  if (optIn.includes('flame') && rewardPoints.length >= 3) {
    candidates.push({ kind: 'flame', x: rewardPoints[0][0], y: rewardPoints[0][1] })
  }
  const enemyPool = enemyPointPool(slots)
  if (optIn.includes('runner') && enemyPool.length > 0) {
    candidates.push({ kind: 'runner', x: enemyPool[0][0], y: enemyPool[0][1] })
  }

  return candidates
}

// Выбор тройки с гарантией босса — та же логика и тот же порядок проверок, что
// офлайн-заглушка в Explore.tsx:
//   1) бросок BOSS_SPAWN_CHANCE -> если выпал И боссу есть кандидат, он
//      гарантированно первым
//   2) иначе обычный pickRandom по всему пулу (босс-кандидат, если он был,
//      исключается из пула заранее, чтобы pickRandom не мог вытащить его
//      сам по себе при непрошедшем броске)
// До 10.11.2026 первой шла гарантия Контрабандиста на map_D_OPEN; у новой D
// тайника и Контрабандиста нет, а на E (three-halls) он — обычный кандидат пула.
function pickChosenEvents(eventPool: EventCandidate[]): EventCandidate[] {
  const bossIndex = eventPool.findIndex((ev) => ev.kind === 'boss')
  const bossWillSpawn = bossIndex !== -1 && Math.random() < BOSS_SPAWN_CHANCE

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
  flame: TROPHY_MULT_FLAME,
  runner: TROPHY_MULT_RUNNER,
}

// Точка входа модуля: читает слот-файл карты, выбирает тройку событий по
// тем же правилам и гарантиям, что клиент, и разыгрывает награду для
// каждого. characterLevel идёт в rollTrophies вместо клиентской заглушки
// PLAYER_LEVEL_FALLBACK.
// Общий пул точек врагов карты: точки ВСЕХ enemyClusters (30.10.2026).
function enemyPointPool(slots: SlotsFile): [number, number][] {
  return (slots.enemyClusters ?? []).flatMap((cluster) =>
    Array.isArray(cluster?.points) ? cluster.points.filter(isPointXY) : [])
}

// Раздаёт группам-событиям точки из общего пула вразброс (scatterGroupPoints):
// вторая группа — из оставшихся после первой. x, y группы — первая её точка.
function scatterEnemyGroups(slots: SlotsFile, chosen: EventCandidate[]): EventCandidate[] {
  let pool = enemyPointPool(slots)
  return chosen.map((ev) => {
    if (ev.kind !== 'enemy') return ev
    const points = scatterGroupPoints(pool, GROUP_SIZE)
    pool = remainingPoints(pool, points)
    const first = points[0]
    return first ? { ...ev, x: first[0], y: first[1], clusterPoints: points } : { ...ev, clusterPoints: [] }
  })
}

const pointKey = (p: readonly [number, number]) => `${p[0]},${p[1]}`

/** Все клетки события: группа — её точки, огонь — жаровня и чаша, прочие — x, y. */
export function eventPointsOf(ev: { x: number; y: number; clusterPoints?: [number, number][]; goal?: [number, number] }): [number, number][] {
  const own: [number, number][] = ev.clusterPoints ?? [[ev.x, ev.y]]
  return ev.goal ? [...own, ev.goal] : own
}

/** Самая далёкая друг от друга пара точек (по прямой); меньше двух — null. */
function farthestPair(points: [number, number][]): [[number, number], [number, number]] | null {
  let best: [[number, number], [number, number]] | null = null
  let bestD = -1
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1])
      if (d > bestD) { bestD = d; best = [points[i], points[j]] }
    }
  }
  return best
}

/**
 * Замена события, которому не нашлось места (11.11.2026): случайный кандидат
 * пула, которого нет в тройке. Не босс (у босса свой бросок), не Носитель огня и
 * не Беглец (их точки уже не раздать), не группа (её точки раздаются отдельно),
 * не сундук на клетках огня. Нет такого — null, и событий будет на одно меньше.
 */
function replacementFor(pool: EventCandidate[], chosen: EventCandidate[]): EventCandidate | null {
  const flameCells = new Set(chosen.flatMap((ev) => ev.kind === 'flame' ? eventPointsOf(ev).map(pointKey) : []))
  const chosenCells = new Set(chosen.map((ev) => `${ev.kind}:${ev.x},${ev.y}`))
  const free = pool.filter((c) =>
    !chosenCells.has(`${c.kind}:${c.x},${c.y}`)
    && c.kind !== 'boss' && c.kind !== 'flame' && c.kind !== 'runner' && c.kind !== 'enemy'
    && !(c.kind === 'chest' && flameCells.has(pointKey([c.x, c.y]))))
  return pickRandom(free, 1)[0] ?? null
}

/**
 * Жаровня и чаша Носителя огня — до раздачи групп: из точек reward без сундуков
 * тройки берётся самая далёкая пара, кто из них жаровня — 50/50. Пары нет —
 * событие заменяется другим кандидатом пула.
 */
function placeFlame(slots: SlotsFile, pool: EventCandidate[], chosen: EventCandidate[]): EventCandidate[] {
  const i = chosen.findIndex((ev) => ev.kind === 'flame')
  if (i === -1) return chosen
  const chestCells = new Set(chosen.filter((ev) => ev.kind === 'chest').map((ev) => pointKey([ev.x, ev.y])))
  const free = (slots.reward ?? []).filter(isPointXY).filter((p) => !chestCells.has(pointKey(p)))
  const pair = farthestPair(free)
  if (pair) {
    const [a, b] = Math.random() < 0.5 ? pair : [pair[1], pair[0]]
    return chosen.map((ev, k) => k === i ? { ...ev, x: a[0], y: a[1], goal: [b[0], b[1]] } : ev)
  }
  const rest = chosen.filter((_, k) => k !== i)
  const swap = replacementFor(pool, rest)
  return swap ? [...rest.slice(0, i), swap, ...rest.slice(i)] : rest
}

/**
 * Точка Беглеца — после раздачи групп: случайная из оставшихся точек врагов, не
 * ближе PATROL_EVENT_CLEARANCE (на том же ряду, как у патрульных) к клеткам
 * других событий. Нет такой — событие заменяется другим кандидатом пула.
 */
function placeRunner(slots: SlotsFile, pool: EventCandidate[], chosen: EventCandidate[]): EventCandidate[] {
  const i = chosen.findIndex((ev) => ev.kind === 'runner')
  if (i === -1) return chosen
  const others = chosen.filter((_, k) => k !== i)
  const groupPoints = others.flatMap((ev) => ev.kind === 'enemy' ? ev.clusterPoints ?? [] : [])
  const otherCells = others.flatMap(eventPointsOf)
  const clear = (p: [number, number]) =>
    otherCells.every((q) => q[1] !== p[1] || Math.abs(q[0] - p[0]) >= PATROL_EVENT_CLEARANCE)
  const spot = pickRandom(remainingPoints(enemyPointPool(slots), groupPoints).filter(clear), 1)[0]
  if (spot) return chosen.map((ev, k) => k === i ? { ...ev, x: spot[0], y: spot[1] } : ev)
  const swap = replacementFor(pool, others)
  return swap ? [...others.slice(0, i), swap, ...others.slice(i)] : others
}

/**
 * optIn — виды из OPT_IN_EVENT_KINDS, которые клиент назвал в `eventKinds`
 * (11.11.2026): только они попадают в пул.
 */
export function rollRunEvents(mapFile: string, characterLevel: number, optIn: readonly OptInEventKind[] = []): RunEvent[] {
  const slots = readSlots(mapFile)
  const eventPool = buildEventCandidates(slots, optIn)
  const picked = placeFlame(slots, eventPool, pickChosenEvents(eventPool))
  const chosenEvents = placeRunner(slots, eventPool, scatterEnemyGroups(slots, picked))

  return chosenEvents.map((ev) => {
    const multiplier = TROPHY_MULT_BY_KIND[ev.kind]

    if (ev.kind === 'chest') {
      // ЕДИНСТВЕННЫЙ бросок «ловушка или нет» на весь забег (13.10.2026): его
      // получает и клиент — по нему он играет взрыв и бьёт героя, — и финиш,
      // через trophyReward ниже.
      // Один бросок на три исхода (09.11.2026): мимик, Тень, обычный.
      const roll = Math.random()
      const isMimic = roll < CHEST_MIMIC_CHANCE
      const isShadow = !isMimic && roll < CHEST_MIMIC_CHANCE + CHEST_SHADOW_CHANCE
      return {
        ...ev,
        isMimic,
        isShadow,
        // Мимик — без трофеев. Добыча у него разыгрывается как у обычного
        // сундука (attachEventDrops в routes/run.ts на isMimic не смотрит).
        // Тень — трофеи ×1.5; сундук закрывается только её смертью.
        trophyReward: isMimic ? 0
          : isShadow ? Math.round(CHEST_SHADOW_TROPHY_MULT * rollTrophies(multiplier!, characterLevel))
            : rollTrophies(multiplier!, characterLevel),
      }
    }

    if (ev.kind === 'enemy') {
      // Вид врагов — отдельный бросок ПОСЛЕ награды и НЕЗАВИСИМО от неё:
      // трофеи и добыча у группы Звонарей и Привратников ровно те же, что у
      // звериной (решение дизайнера), поэтому множитель здесь ни при чём.
      const base = multiplier !== undefined ? rollTrophies(multiplier, characterLevel) : 0
      // Элита (30.10.2026): один случайный враг группы с шансом ELITE_CHANCE.
      // Его лишние доли трофеев — сразу в trophyReward: всплывашка группы одна,
      // и финиш начислит ровно то, что она покажет.
      const size = ev.clusterPoints?.length ?? 0
      const elite = size > 0 && Math.random() < ELITE_CHANCE
      return {
        ...ev,
        trophyReward: elite ? eliteGroupTrophies(base, size) : base,
        enemyKind: rollEnemyKind(characterLevel, mapFile),
        ...(elite ? { eliteIndex: Math.floor(Math.random() * size) } : {}),
      }
    }

    if (ev.kind === 'boss') {
      return {
        ...ev,
        trophyReward: rollTrophies(multiplier!, characterLevel),
        bossKind: rollBossKind(mapFile),
      }
    }

    return {
      ...ev,
      trophyReward: multiplier !== undefined ? rollTrophies(multiplier, characterLevel) : 0,
    }
  })
}

/**
 * Патрульный (30.10.2026): одиночный враг вне событий. Стоит на точке группы,
 * которая в этот забег НЕ выпала событием. Это не событие: его нет в HUD, на
 * конец забега он не влияет, добычи у него нет. Убитых клиент называет на
 * финише индексами (killedPatrols), сервер прибавляет их trophyReward.
 * Элиты у патрульных нет.
 */
export type RunPatrol = {
  x: number
  y: number
  enemyKind: RunEnemyKind
  trophyReward: number
}

/**
 * До PATROLS_PER_RUN патрульных (30.10.2026): из точек общего пула, которые не
 * достались группам-событиям, не ближе PATROL_EVENT_CLEARANCE клеток (на том же
 * ряду) к точке любого выпавшего события и не ближе GROUP_MIN_GAP друг к другу
 * (pickPatrolSpots, runExtras.ts). Мест меньше — патрульных меньше.
 */
export function rollRunPatrols(mapFile: string, events: RunEvent[], characterLevel: number): RunPatrol[] {
  const slots = readSlots(mapFile)
  const groupPoints = events.flatMap((ev) => ev.kind === 'enemy' ? ev.clusterPoints ?? [] : [])
  // Жаровня, чаша и Беглец (11.11.2026) — тоже клетки событий; точка Беглеца
  // вычитается из пула явно (клиренс и так не пустил бы на неё).
  const eventPoints: [number, number][] = events.flatMap(eventPointsOf)
  const runnerPoints: [number, number][] = events.filter((ev) => ev.kind === 'runner').map((ev) => [ev.x, ev.y])
  return pickPatrolSpots(remainingPoints(enemyPointPool(slots), [...groupPoints, ...runnerPoints]), eventPoints).map(([x, y]) => ({
    x,
    y,
    enemyKind: rollEnemyKind(characterLevel, mapFile),
    trophyReward: rollTrophies(TROPHY_MULT_PATROL, characterLevel),
  }))
}

/**
 * Событие в том виде, в каком его получает клиент в ответе /run/start-explore.
 * Копия формы на клиенте — StartExploreEvent в src/api.ts; менять только парой
 * (общего пакета нет, скрипта сверки тоже).
 */
export type ClientRunEvent = {
  kind: RunEventKind
  x: number
  y: number
  clusterPoints?: [number, number][]
  /** Чаша Носителя огня (11.11.2026) — только у flame. */
  goal?: [number, number]
  enemyKind?: RunEnemyKind
  /** Элитный враг группы (30.10.2026); поля нет — элиты нет. */
  eliteIndex?: number
  isMimic?: boolean
  /** Тень из сундука (09.11.2026). */
  isShadow?: boolean
  /** Какой босс (09.11.2026). */
  bossKind?: RunBossKind
  trophyReward: number
  drop: ClientEventDrop | null
  /** Вторая добыча (Печать с босса), 18.10.2026. null — не выпало. */
  extraDrop: ClientEventDrop | null
  /** Руна (09.11.2026). null — не выпало. */
  runeDrop: ClientEventDrop | null
}

/** Добыча в том виде, в каком её видит клиент: снаряжение — без itemId. */
type ClientEventDrop =
  | { category: 'equipment'; nameRu: string; slot: string; tier: number }
  | Exclude<EventDrop, { category: 'equipment' }>

/**
 * Что из розыгрыша уезжает клиенту. Чистая функция: вынесена из обработчика
 * /run/start-explore 13.10.2026, чтобы «что видит клиент» проверялось без базы.
 *
 * ⚠️ НАГРАДЫ УЕЗЖАЮТ КЛИЕНТУ (30.09.2026), и это смена решения, а не недосмотр.
 * Раньше trophyReward намеренно оставался на сервере, чтобы игрок не видел
 * награду через DevTools до того, как её заработал. Цена была в другом:
 * всплывашку в бою клиент рисовал СВОИМ броском, и она не сходилась с тем, что
 * сервер потом начислял. Дизайнер выбрал честные числа в бою; «взломанный клиент
 * может узнать добычу заранее» принято сознательно.
 *
 * ⚠️ isMimic ТОЖЕ ОТДАЁТСЯ (13.10.2026) — у каждого сундука, и только у него.
 * По нему клиент решает, играть ли взрыв и бить ли героя; своего броска у него
 * больше нет. Новой утечки это не добавляет: мимик и раньше вычислялся по
 * trophyReward (у него ровно 0, у обычного сундука всегда больше) — принято
 * дизайнером 30.09.2026.
 * Значение уходит КАК ЕСТЬ, без приведения к false: сундук без решения — ошибка
 * розыгрыша, и клиент обязан увидеть её отсутствием поля (он отказывается
 * показывать такой забег), а не получить выдуманное «обычный».
 *
 * itemId выпавшего снаряжения клиенту НЕ отдаётся: ему хватает slot+tier, чтобы
 * собрать путь к иконке, а строка таблицы Item нужна только финишу.
 */
export function clientRunEvents(events: RunEvent[]): ClientRunEvent[] {
  return events.map((ev) => ({
    kind: ev.kind,
    x: ev.x,
    y: ev.y,
    ...(ev.clusterPoints ? { clusterPoints: ev.clusterPoints } : {}),
    ...(ev.kind === 'flame' && ev.goal ? { goal: ev.goal } : {}),
    // Чья группа (04.10.2026). Отдаётся ТОЛЬКО если сервер её разыграл: у
    // забега, начатого старым сервером, поля нет вовсе, и клиент читает это
    // как «звери» — см. readEnemyKind в src/api.ts.
    ...(ev.enemyKind ? { enemyKind: ev.enemyKind } : {}),
    ...(ev.eliteIndex !== undefined ? { eliteIndex: ev.eliteIndex } : {}),
    ...(ev.kind === 'chest' ? { isMimic: ev.isMimic } : {}),
    // Тень (09.11.2026) — только если сервер её разыграл: у старого забега поля нет.
    ...(ev.kind === 'chest' && ev.isShadow !== undefined ? { isShadow: ev.isShadow } : {}),
    ...(ev.kind === 'boss' && ev.bossKind ? { bossKind: ev.bossKind } : {}),
    trophyReward: ev.trophyReward,
    drop: clientEventDrop(ev.drop),
    // Вторая добыча уходит ВСЕГДА, null у событий без неё: клиент старше
    // 18.10.2026 незнакомое поле не читает, а новому так не нужно отличать
    // «не выпало» от «сервер не умел» — Печать он показывает только присланной.
    extraDrop: clientEventDrop(ev.extraDrop),
    // Руна (09.11.2026) — тоже всегда, null без неё; клиент старше её не читает.
    runeDrop: clientEventDrop(ev.runeDrop),
  }))
}

function clientEventDrop(drop: EventDrop | null | undefined): ClientEventDrop | null {
  if (drop === undefined || drop === null) return null
  return drop.category === 'equipment'
    ? { category: 'equipment', nameRu: drop.nameRu, slot: drop.slot, tier: drop.tier }
    : drop
}

/**
 * Место Звёздоцвета (docs/crafter.md, 29.10.2026): одна из точек награды (reward)
 * той же карты, на которой в этом забеге НЕ стоит событие, — там ровный пол и
 * свободное место под объект размером с сундук. Свободных нет — null, и цветка
 * в этом забеге не будет: ставить его поверх сундука нельзя.
 */
export function pickStarbloomPoint(mapFile: string, events: RunEvent[]): [number, number] | null {
  const slots = readSlots(mapFile)
  // Чаша Носителя огня — тоже занятая клетка (11.11.2026).
  const taken = new Set(events.flatMap(eventPointsOf).map(pointKey))
  const free = (slots.reward ?? []).filter(isPointXY).filter((p) => !taken.has(`${p[0]},${p[1]}`))
  return pickRandom(free, 1)[0] ?? null
}
