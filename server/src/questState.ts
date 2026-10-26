// Состояние ежедневных заданий героя (Character.questState) и все его правила —
// ЧИСТЫЕ функции: ни DB, ни HTTP, как runState.ts. Читатели у этого JSON два:
// ручки заданий (routes/quests.ts) и финиш забега (routes/run.ts), который
// двигает прогресс активного задания и начисляет награду. Колонка `Json?` схемой
// не проверяется, поэтому разбор и правила живут в одном месте — второй набор
// рядом разъехался бы с первым молча.
//
// Правила (docs/daily-quests.md):
//   • до QUEST_UNLOCK_LEVEL набора нет; с него — набор из QUEST_SET_SIZE разных
//     заданий, случайно из доступных по надетым навыкам на момент броска;
//   • активно одно задание; взять можно любое невзятое из набора; взял другое,
//     пока есть активное, — активное пропадает вместе с прогрессом;
//   • шаг = сколько заданий набора уже вынуто (выполнено или пропало); на каждом
//     шаге одна замена невзятого задания на случайное новое; не использовал —
//     сгорает при переходе на следующий шаг;
//   • таймер набора — QUEST_SET_MS от того, как взято ПЕРВОЕ задание набора;
//     истёк — новый набор при ближайшем обращении (settleQuestState). Невзятые
//     пропадают, недоделанное активное остаётся активным («переходящее»).
import {
  QUESTS,
  QUEST_SET_SIZE,
  QUEST_SET_MS,
  QUEST_UNLOCK_LEVEL,
  QUEST_FAST_RUN_MS,
  QUEST_NON_ATTACK_SKILLS,
  parseQuestId,
  questById,
  questReward,
  questAvailable,
  type QuestId,
  type QuestMetric,
  type QuestReward,
} from './quests.js'
import { RUN_MANA_MAX, RUN_MANA_DROP_MAX, SKILL_BOOK_SKILL_IDS } from './game.js'
import type { SkillBookSkillId } from './consumables.js'
import { type ActiveExploreRun, readRunPotionsDrunk, readRunConfirmedAt, readRunStartedAt } from './runState.js'

// --- Форма ---

/**
 * Место в наборе:
 *   open   — невзятое, его можно взять или заменить;
 *   active — взятое и ещё не выполненное (такое место одно, и только если
 *            активное задание из этого набора, а не переходящее);
 *   done   — выполнено;
 *   lost   — пропало: взяли другое, пока это было активным.
 */
export type QuestSlotStatus = 'open' | 'active' | 'done' | 'lost'
export type QuestSlot = { id: QuestId; status: QuestSlotStatus }

/**
 * Активное задание. carried — переходящее: взято из ПРОШЛОГО набора, его таймер
 * истёк, а задание недоделано. В текущем наборе его нет; взял любое задание
 * нового набора — оно пропадает. progress — всегда меньше цели: дошло до цели —
 * задание выполнено и активным быть перестаёт.
 */
export type QuestActive = { id: QuestId; progress: number; carried: boolean }

/**
 * Всё состояние заданий героя — то, что лежит в Character.questState.
 *   set            — задания набора по местам, ровно QUEST_SET_SIZE, без повторов;
 *   setStartedAt   — когда взято первое задание набора (мс, часы сервера); null —
 *                    ни одно не взято, таймер не идёт;
 *   replacedAtStep — на каком шаге потрачена замена; null — в этом наборе не
 *                    тратилась. Замена есть, пока оно не равно текущему шагу;
 *   active         — активное задание или null.
 */
export type QuestState = {
  set: QuestSlot[]
  setStartedAt: number | null
  replacedAtStep: number | null
  active: QuestActive | null
}

/**
 * Результат чтения — ТРИ различимых состояния, как у readSmugglerDeal:
 *   none      — колонка пуста: набора ещё не было (герой ниже порога или до
 *               этой правки);
 *   state     — годное состояние;
 *   malformed — поле есть, но испорчено. Свалить его в none значило бы молча
 *               отнять активное задание с прогрессом и выдать новый набор.
 */
export type QuestStateRead =
  | { kind: 'none' }
  | { kind: 'state'; state: QuestState }
  | { kind: 'malformed' }

const SLOT_STATUSES: readonly QuestSlotStatus[] = ['open', 'active', 'done', 'lost']

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0
}

/**
 * СТРОГИЙ разбор: любое отклонение — null. Проверяется и форма, и согласованность
 * полей между собой: пишет состояние только этот модуль, и рассогласованное
 * (два активных места, активное место без активного задания, прогресс за целью)
 * может значить только порчу — молча «починить» его нельзя.
 */
export function parseQuestState(raw: unknown): QuestState | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>

  if (!Array.isArray(record.set) || record.set.length !== QUEST_SET_SIZE) return null
  const set: QuestSlot[] = []
  for (const item of record.set) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null
    const slot = item as Record<string, unknown>
    const id = parseQuestId(slot.id)
    if (id === null || set.some((s) => s.id === id)) return null
    if (!SLOT_STATUSES.includes(slot.status as QuestSlotStatus)) return null
    set.push({ id, status: slot.status as QuestSlotStatus })
  }

  const setStartedAt = record.setStartedAt
  if (setStartedAt !== null && !isPositiveInt(setStartedAt)) return null

  const replacedAtStep = record.replacedAtStep
  if (replacedAtStep !== null && !(typeof replacedAtStep === 'number' && Number.isInteger(replacedAtStep) && replacedAtStep >= 0 && replacedAtStep < QUEST_SET_SIZE)) return null

  const active = parseQuestActive(record.active)
  if (active === undefined) return null

  // Активное место в наборе — ровно у активного задания из этого набора.
  const activeSlots = set.filter((s) => s.status === 'active')
  if (active !== null && !active.carried) {
    if (activeSlots.length !== 1 || activeSlots[0].id !== active.id) return null
  } else {
    if (activeSlots.length !== 0) return null
    // Переходящее в текущий набор не попадает (его исключает бросок и замена).
    if (active !== null && set.some((s) => s.id === active.id)) return null
  }

  return { set, setStartedAt, replacedAtStep, active }
}

// Активное задание из questState: null — его нет, undefined — поле испорчено.
function parseQuestActive(raw: unknown): QuestActive | null | undefined {
  if (raw === null) return null
  if (typeof raw !== 'object' || raw === undefined || Array.isArray(raw)) return undefined
  const a = raw as Record<string, unknown>
  const id = parseQuestId(a.id)
  const quest = id === null ? null : questById(id)
  if (id === null || quest === null) return undefined
  if (!(typeof a.progress === 'number' && Number.isInteger(a.progress) && a.progress >= 0 && a.progress < quest.goal)) return undefined
  if (typeof a.carried !== 'boolean') return undefined
  return { id, progress: a.progress, carried: a.carried }
}

/** Состояние из колонки Character.questState (null — none). */
export function readQuestState(raw: unknown): QuestStateRead {
  if (raw === null || raw === undefined) return { kind: 'none' }
  const parsed = parseQuestState(raw)
  return parsed === null ? { kind: 'malformed' } : { kind: 'state', state: parsed }
}

// --- Шаг и замена ---

/** Шаг набора: сколько заданий уже вынуто — выполнено или пропало. */
export function questStep(state: QuestState): number {
  return state.set.filter((s) => s.status === 'done' || s.status === 'lost').length
}

/** Есть ли замена на этом шаге: осталось что заменять, и на этом шаге она не тратилась. */
export function questReplaceAvailable(state: QuestState): boolean {
  return state.set.some((s) => s.status === 'open') && state.replacedAtStep !== questStep(state)
}

// --- Броски ---

export type Rng = () => number

/** k случайных разных из списка (частичная тасовка Фишера — Йетса). */
function pickRandom<T>(items: readonly T[], k: number, rng: Rng): T[] {
  const pool = [...items]
  const out: T[] = []
  for (let i = 0; i < k && pool.length > 0; i++) {
    const j = Math.floor(rng() * pool.length)
    out.push(pool[j])
    pool.splice(j, 1)
  }
  return out
}

/** Задания, которые могут выпасть сейчас: по надетым навыкам и без исключённых. */
function candidateIds(equippedSkills: readonly string[], exclude: readonly QuestId[]): QuestId[] {
  return QUESTS.filter((q) => questAvailable(q, equippedSkills) && !exclude.includes(q.id)).map((q) => q.id)
}

/**
 * Новый набор: QUEST_SET_SIZE разных заданий из доступных, кроме `exclude`
 * (переходящего — иначе взять его же из нового набора значило бы потерять его).
 * Нехватка кандидатов недостижима (сверка каталога ниже), поэтому громко.
 */
function rollQuestSet(equippedSkills: readonly string[], exclude: readonly QuestId[], rng: Rng): QuestSlot[] {
  const ids = pickRandom(candidateIds(equippedSkills, exclude), QUEST_SET_SIZE, rng)
  if (ids.length < QUEST_SET_SIZE) {
    throw new Error(`questState: на набор не хватило заданий (${ids.length} из ${QUEST_SET_SIZE})`)
  }
  return ids.map((id) => ({ id, status: 'open' }))
}

// Набор и замена исключают до QUEST_SET_SIZE + 1 заданий (набор целиком и
// переходящее), и хотя бы одно должно остаться при любом снаряжении — то есть
// среди заданий без требований. Громко и при старте, а не броском посреди
// запроса: каталог правят руками.
if (QUESTS.filter((q) => q.requirement === 'none').length < QUEST_SET_SIZE + 2) {
  throw new Error('questState: в каталоге мало заданий без требований — набор или замена могут не собраться')
}

// --- Время: новый набор по таймеру ---

/**
 * Привести состояние к «сейчас» — лениво, без крона:
 *   • набора нет, а уровень уже не ниже порога — первый набор;
 *   • таймер набора истёк — новый набор; невзятые пропадают вместе со старым,
 *     недоделанное активное становится переходящим со своим прогрессом.
 * changed — состояние другое, его надо записать. Уровень — серверный
 * (calculateLevel), навыки — надетые сейчас: требования проверяются в момент
 * броска.
 */
export function settleQuestState(
  current: QuestState | null,
  level: number,
  equippedSkills: readonly string[],
  nowMs: number,
  rng: Rng = Math.random,
): { state: QuestState | null; changed: boolean } {
  if (current === null) {
    if (level < QUEST_UNLOCK_LEVEL) return { state: null, changed: false }
    return {
      state: { set: rollQuestSet(equippedSkills, [], rng), setStartedAt: null, replacedAtStep: null, active: null },
      changed: true,
    }
  }
  if (current.setStartedAt === null || nowMs - current.setStartedAt < QUEST_SET_MS) {
    return { state: current, changed: false }
  }
  const carried = current.active === null ? null : { ...current.active, carried: true }
  return {
    state: {
      set: rollQuestSet(equippedSkills, carried === null ? [] : [carried.id], rng),
      setStartedAt: null,
      replacedAtStep: null,
      active: carried,
    },
    changed: true,
  }
}

// --- Взять и заменить ---

export type QuestRefusal = 'not-in-set' | 'already-taken' | 'no-replacement' | 'nothing-to-pick'

/**
 * Взять задание набора. Активное из этого набора пропадает (место — lost),
 * переходящее — тоже (место у него нет). Первое взятое задание набора запускает
 * таймер.
 */
export function takeQuest(
  state: QuestState,
  id: QuestId,
  nowMs: number,
): { ok: true; state: QuestState; lost: QuestId | null } | { ok: false; reason: QuestRefusal } {
  const slot = state.set.find((s) => s.id === id)
  if (!slot) return { ok: false, reason: 'not-in-set' }
  if (slot.status !== 'open') return { ok: false, reason: 'already-taken' }
  return {
    ok: true,
    lost: state.active?.id ?? null,
    state: {
      set: state.set.map((s) => (s.id === id ? { id, status: 'active' } : s.status === 'active' ? { id: s.id, status: 'lost' } : s)),
      setStartedAt: state.setStartedAt ?? nowMs,
      replacedAtStep: state.replacedAtStep,
      active: { id, progress: 0, carried: false },
    },
  }
}

/**
 * Заменить невзятое задание набора случайным новым — не из тех, что уже в наборе
 * (включая заменяемое), и не активным. Одна замена на шаг; таймер не запускает.
 * Требования по навыкам — на момент замены.
 */
export function replaceQuest(
  state: QuestState,
  id: QuestId,
  equippedSkills: readonly string[],
  rng: Rng = Math.random,
): { ok: true; state: QuestState; newId: QuestId } | { ok: false; reason: QuestRefusal } {
  const slot = state.set.find((s) => s.id === id)
  if (!slot) return { ok: false, reason: 'not-in-set' }
  if (slot.status !== 'open') return { ok: false, reason: 'already-taken' }
  if (!questReplaceAvailable(state)) return { ok: false, reason: 'no-replacement' }
  const exclude = [...state.set.map((s) => s.id), ...(state.active ? [state.active.id] : [])]
  const [newId] = pickRandom(candidateIds(equippedSkills, exclude), 1, rng)
  if (newId === undefined) return { ok: false, reason: 'nothing-to-pick' }
  return {
    ok: true,
    newId,
    state: {
      ...state,
      set: state.set.map((s) => (s.id === id ? { id: newId, status: 'open' } : s)),
      replacedAtStep: questStep(state),
    },
  }
}

// --- Прогресс за забег ---

/** Счётчики тела финиша для заданий. null — поля нет или оно негодно: «неизвестно». */
export type QuestRunCounters = {
  parries: number | null
  manaCollected: number | null
  manaSpent: number | null
  spikeHits: number | null
  skillCasts: number | null
}

export const QUEST_RUN_COUNTER_FIELDS = ['parries', 'manaCollected', 'manaSpent', 'spikeHits', 'skillCasts'] as const

/**
 * Счётчики из тела финиша — МЯГКО и поэлементно, как skillUses: кривое поле не
 * валит финиш. Но, в отличие от skillUses, поля нет — null, а не ноль: у
 * старого клиента ноль попаданий на шипы значил бы «Тихий шаг» за любую
 * вылазку. invalid — поля, которые были, но не прошли (для лога).
 */
export function parseQuestRunCounters(body: unknown): { counters: QuestRunCounters; invalid: string[] } {
  const record = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
  const counters: QuestRunCounters = { parries: null, manaCollected: null, manaSpent: null, spikeHits: null, skillCasts: null }
  const invalid: string[] = []
  for (const key of QUEST_RUN_COUNTER_FIELDS) {
    const v = record[key]
    if (v === undefined) continue
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0) counters[key] = v
    else invalid.push(key)
  }
  return { counters, invalid }
}

/** Всё, что вылазка дала заданиям, — из своего currentRun и счётчиков тела. */
export type QuestRunFacts = {
  beastGroups: number
  zvonarGroups: number
  gatekeeperGroups: number
  chests: number
  mimics: number
  obelisks: number
  /** Выпито зелий по записи /run/sip; null — запись испорчена. */
  potionsDrunk: number | null
  /** Результативные применения навыков, кроме QUEST_NON_ATTACK_SKILLS. */
  skillHits: number
  counters: QuestRunCounters
  /** От подтверждения (или старта) до финиша; null — момента нет (старый забег). */
  durationMs: number | null
}

/**
 * Собрать факты вылазки. Закрытые события — те же провалидированные индексы, что
 * у трофеев (parseClosedEventIndices); вид группы и мимик — из СВОЕГО currentRun.
 * Группа без enemyKind — звериная (забег старого сервера, тот же договор, что у
 * клиента).
 *
 * Мана сверяется с тем, сколько её вообще могло быть: с убитого не больше
 * RUN_MANA_DROP_MAX, а потратить можно не больше старта и собранного. Число
 * врагов — всех в забеге, а не в закрытых группах: недобитая группа ману тоже
 * роняла. Лишнее срезается, clamped — для лога.
 *
 * Длительность — от момента подтверждения (/run/ready); его нет (забег
 * подтвердили глотком или срезом) — от старта: это всегда дольше, то есть
 * против игрока.
 */
export function collectQuestRunFacts(
  run: ActiveExploreRun,
  closedEvents: readonly number[],
  skillUses: Record<SkillBookSkillId, number>,
  counters: QuestRunCounters,
  finishedAtMs: number,
): { facts: QuestRunFacts; clamped: string[] } {
  const events = Array.isArray(run.events) ? run.events : []
  const closed = closedEvents.map((i) => events[i]).filter((ev) => ev !== undefined)
  const groupsOf = (kind: 'beast' | 'zvonar' | 'gatekeeper') =>
    closed.filter((ev) => ev.kind === 'enemy' && (ev.enemyKind ?? 'beast') === kind).length

  const kills = events.reduce((sum, ev) => sum + (ev.kind === 'enemy' ? ev.clusterPoints?.length ?? 0 : ev.kind === 'boss' ? 1 : 0), 0)
  const clamped: string[] = []
  const capped = { ...counters }
  const collectedMax = RUN_MANA_DROP_MAX * kills
  if (capped.manaCollected !== null && capped.manaCollected > collectedMax) {
    clamped.push('manaCollected')
    capped.manaCollected = collectedMax
  }
  const spentMax = RUN_MANA_MAX + collectedMax
  if (capped.manaSpent !== null && capped.manaSpent > spentMax) {
    clamped.push('manaSpent')
    capped.manaSpent = spentMax
  }

  const drunk = readRunPotionsDrunk(run)
  const since = readRunConfirmedAt(run) ?? readRunStartedAt(run)

  return {
    clamped,
    facts: {
      beastGroups: groupsOf('beast'),
      zvonarGroups: groupsOf('zvonar'),
      gatekeeperGroups: groupsOf('gatekeeper'),
      chests: closed.filter((ev) => ev.kind === 'chest').length,
      mimics: closed.filter((ev) => ev.kind === 'chest' && ev.isMimic === true).length,
      obelisks: closed.filter((ev) => ev.kind === 'obelisk').length,
      potionsDrunk: drunk === null ? null : drunk.reduce((sum, n) => sum + n, 0),
      skillHits: SKILL_BOOK_SKILL_IDS
        .filter((id) => !QUEST_NON_ATTACK_SKILLS.includes(id))
        .reduce((sum, id) => sum + skillUses[id], 0),
      counters: capped,
      durationMs: since === null ? null : Math.max(0, finishedAtMs - since),
    },
  }
}

/** Сколько вылазка дала заданию с этим metric. «Неизвестно» — ноль, против игрока. */
export function questDelta(metric: QuestMetric, facts: QuestRunFacts): number {
  const c = facts.counters
  switch (metric) {
    case 'runs': return 1
    case 'runNoPotion': return facts.potionsDrunk === 0 ? 1 : 0
    case 'beastGroups': return facts.beastGroups
    case 'zvonarGroups': return facts.zvonarGroups
    case 'gatekeeperGroups': return facts.gatekeeperGroups
    case 'parries': return c.parries ?? 0
    case 'skillHits': return facts.skillHits
    case 'chests': return facts.chests
    case 'mimics': return facts.mimics
    case 'obelisks': return facts.obelisks
    case 'manaCollected': return c.manaCollected ?? 0
    case 'manaSpent': return c.manaSpent ?? 0
    case 'runNoSkills': return c.skillCasts === 0 ? 1 : 0
    case 'runNoSpikes': return c.spikeHits === 0 ? 1 : 0
    case 'fastRun': return facts.durationMs !== null && facts.durationMs < QUEST_FAST_RUN_MS ? 1 : 0
  }
}

export type QuestCompletion = { questId: QuestId; reward: QuestReward }

/**
 * Продвинуть активное задание живой вылазкой. Дошло до цели — выполнено:
 * активного больше нет, место в наборе — done (у переходящего места нет), и
 * награда на уровне `rewardLevel`. Активного нет или вылазка ему ничего не
 * дала — состояние то же (changed false).
 */
export function applyRunToQuests(
  state: QuestState,
  facts: QuestRunFacts,
  rewardLevel: number,
): { state: QuestState; changed: boolean; completed: QuestCompletion | null } {
  const active = state.active
  const quest = active === null ? null : questById(active.id)
  if (active === null || quest === null) return { state, changed: false, completed: null }
  const delta = questDelta(quest.metric, facts)
  if (delta <= 0) return { state, changed: false, completed: null }
  const progress = Math.min(quest.goal, active.progress + delta)
  if (progress < quest.goal) {
    return { state: { ...state, active: { ...active, progress } }, changed: true, completed: null }
  }
  return {
    state: {
      ...state,
      set: active.carried ? state.set : state.set.map((s) => (s.id === active.id ? { id: s.id, status: 'done' } : s)),
      active: null,
    },
    changed: true,
    completed: { questId: active.id, reward: questReward(quest, rewardLevel) },
  }
}

// --- Вид для клиента ---

/**
 * Что получает клиент (ручки заданий и финиш). Названия и описания он берёт из
 * своего каталога по id — сервер шлёт только id, статусы и числа.
 *   unlocked / unlockLevel — открыты ли задания и с какого уровня;
 *   set                    — задания набора: статус, цель, прогресс (только у
 *                            активного, иначе null), награда на текущем уровне;
 *   replaceAvailable       — есть ли замена на этом шаге;
 *   nextSetInMs            — через сколько мс от ответа придёт новый набор; null —
 *                            таймер не запущен (ни одно задание набора не взято).
 *                            Относительным числом, а не моментом: часы телефона с
 *                            часами сервера не сверены;
 *   carried                — переходящее задание из прошлого набора, или null.
 */
export type QuestView = {
  unlocked: boolean
  unlockLevel: number
  set: { id: QuestId; status: QuestSlotStatus; goal: number; progress: number | null; reward: QuestReward }[]
  replaceAvailable: boolean
  nextSetInMs: number | null
  carried: { id: QuestId; goal: number; progress: number; reward: QuestReward } | null
}

export function questView(state: QuestState | null, level: number, nowMs: number): QuestView {
  const unlocked = level >= QUEST_UNLOCK_LEVEL
  if (state === null) {
    return { unlocked, unlockLevel: QUEST_UNLOCK_LEVEL, set: [], replaceAvailable: false, nextSetInMs: null, carried: null }
  }
  const goalOf = (id: QuestId) => questById(id)?.goal ?? 0
  const rewardOf = (id: QuestId): QuestReward => {
    const quest = questById(id)
    return quest === null ? { gold: 0, hunterBadges: 0, rp: 0 } : questReward(quest, level)
  }
  const active = state.active
  return {
    unlocked,
    unlockLevel: QUEST_UNLOCK_LEVEL,
    set: state.set.map((s) => ({
      id: s.id,
      status: s.status,
      goal: goalOf(s.id),
      progress: s.status === 'active' && active !== null && !active.carried ? active.progress : null,
      reward: rewardOf(s.id),
    })),
    replaceAvailable: questReplaceAvailable(state),
    nextSetInMs: state.setStartedAt === null ? null : Math.max(0, state.setStartedAt + QUEST_SET_MS - nowMs),
    carried: active !== null && active.carried
      ? { id: active.id, goal: goalOf(active.id), progress: active.progress, reward: rewardOf(active.id) }
      : null,
  }
}
