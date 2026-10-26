// Форма активного забега (Character.currentRun), ЧИСТЫЕ читатели к ней и
// потолки на выпитое за забег — плюс раскладка склада зелий по колонкам
// potionT1..T5. Ни DB, ни HTTP, как и в game.ts.
//
// Почему отдельным файлом, а не внутри routes/run.ts, где всё это выросло:
// читателей у одного и того же JSON стало ДВА. Первый — /run/sip и
// /run/finish-explore (routes/run.ts), второй — /auth/login (routes/auth.ts),
// который закрывает брошенный забег как смерть и с этого момента тоже
// списывает выпитые зелья. Колонка объявлена `Json?`, схема её содержимое не
// проверяет ничем, так что второй валидатор и второй набор потолков,
// написанные рядом с первыми, разъехались бы с ними МОЛЧА — ровно тот отказ,
// который в этом проекте уже случался с анти-чит-потолком по зельям (см.
// CLAUDE.md, "Анти-чит-потолки ломаются молча при смене формы данных").
//
// Здесь же живут potionStockOf/potionStockToColumns: склад зелий существует в
// двух видах — снимок ПО ТИРАМ внутри currentRun и пять колонок Character, —
// и обоим эндпоинтам нужны оба. Держать их порознь значило бы развести
// соответствие "индекс массива ↔ номер колонки" по трём файлам.
import { MAX_SIPS_PER_RUN, POTION_TIER_COUNT, POTION_TIERS, emptyPotionStock } from './potions.js'
import { scaledBossMaxHp, scaledEnemyMaxHp, scaledGatekeeperMaxHp, SKILL_BOOK_SKILL_IDS, RUN_MANA_MAX, RUN_MANA_DROP_MAX, HEAL_MANA_COST, HEAL_COOLDOWN_MS, healSkillPerUse } from './game.js'
import type { RunEvent } from './runEvents.js'
import { runSlotConsumableById, consumableReviveFrac, RUN_CONSUMABLE_SLOTS, type ConsumableId, type SkillBookSkillId } from './consumables.js'
import type { UpgradeCounts } from './upgrades.js'
import type { ScrollId } from './scrolls.js'
import type { ClassItemId } from './classItems.js'
import { parseHeroClassId, parseHeroClassTier, parseHeroClassWire, heroClassToWire, bloodClassEffects, magicClassEffects, type HeroClassId, type HeroClassTier, type HeroClassState } from './heroClasses.js'

// Shape of the active run stored in Character.currentRun for the
// map-based Explore flow (POST /run/start-explore). `mode: 'explore'` is
// the tag that identifies this shape in the JSON field.
// `events` carries the FULL roll. The client gets the version built by
// clientRunEvents (runEvents.ts) in /run/start-explore's response: rewards
// since 30.09.2026 and each chest's isMimic since 13.10.2026 do leave the
// server; the itemId of a dropped piece of equipment does not.
// `potions` — снимок склада ПО ТИРАМ на момент старта (длина POTION_TIER_COUNT,
// индекс = тир-1), `sips` — сколько глотков вообще разрешено за забег
// (MAX_SIPS_PER_RUN, но не больше суммы запаса). Раньше здесь был один скаляр,
// который смешивал две разные вещи: сколько есть и сколько можно выпить.
// `potionsDrunk` — выпитое за забег ПО ТИРАМ, пишет /run/sip по одному глотку.
// Склад (potionT1..T5) оно не трогает — списание одним пакетом в
// /run/finish-explore либо, у брошенного забега, в /auth/login. Необязательное:
// у забега без глотков и у забега, начатого до появления /run/sip, поля нет.
// Читать только через readRunPotionsDrunk.
// `progress` — последний СРЕЗ сырых счётчиков забега, пишет /run/progress
// ЗАМЕНОЙ (клиент шлёт накопленное с начала забега, а не дельту, поэтому
// потерянный по дороге срез ничего не ломает — следующий перезапишет). Нужен
// ровно для одного: у брошенного забега /auth/login больше не теряет ни рост
// статов, ни рост уровней навыков (skillUses внутри того же среза).
// Необязательное, читать только через readRunProgress.
// `confirmed` — дошёл ли клиент до готовности показать игру (POST /run/ready).
// Забег, брошенный ДО этого момента, игрок не видел вовсе: закрывать его как
// смерть значит штрафовать за упавшую текстуру или оборванную сеть. Поля НЕТ у
// всех забегов, созданных до появления фичи, — они подтверждены по определению
// (см. readRunConfirmed).
// `spentEnergy` — сколько энергии реально списал старт ИМЕННО этого забега.
// Хранится числом, а не берётся из RUN_COST на момент закрытия: константа
// меняется (сейчас 3, перед релизом 10), и забег, начатый до её смены, обязан
// вернуть списанное, а не нынешнее.
// `runId` (15.10.2026) — случайный id ЭТОГО забега, его называет старт и
// клиент присылает обратно во всех запросах забега. Без него сервер не
// отличал запоздавший запрос ПРОШЛОГО забега от запроса текущего: финиш,
// глоток или срез, доползшие после того, как игрок начал новый забег, легли
// бы в новый. Поля нет у забегов, начатых до 15.10.2026, — для них проверки
// нет (читать через readRunId).
// `startedAt` (15.10.2026) — момент старта, мс от эпохи, по часам СЕРВЕРА. От
// него отсчитывается окно подтверждения READY_WINDOW_MS (см. ниже). Поля нет
// у старых забегов — окна у них нет (readRunStartedAt).
// `sipIds` (15.10.2026) — id уже записанных глотков (клиент даёт id глотку и
// повторяет его со всеми попытками /run/sip). Повтор после таймаута, первая
// попытка которого всё же дошла, не запишет глоток второй раз. Длина не больше
// числа глотков за забег. Поля нет — глотков с id не было (readRunSipIds).
// `heroClass` (26.10.2026) — класс героя НА СТАРТЕ забега, из колонок
// персонажа (не от клиента): null — класса нет, {id, tier} — класс. Бой
// классом не меняется посреди забега, и потолок полученного урона
// (clampRunProgress) обязан считаться по тому же классу, по которому клиент
// лечил. Поля нет у забегов, начатых до 26.10.2026, — класса у них нет
// (читать через readRunHeroClass).
// `healSkill` (26.10.2026, вечер) — навык «Исцеление» НА СТАРТЕ забега, из
// колонок персонажа: null — не надет; {level, endurance} — надет, его уровень
// и выносливость героя (от неё лечит импульс). Клиент снимает силу навыка один
// раз в начале забега, а за забег книгу могут улучшить или навык забыть со
// второго устройства — потолок обязан считаться по тому, с чем забег начат.
// Поля нет у забегов, начатых раньше, — запаса под исцеление у них нет, как
// было (читать через readRunHealSkill).
export type ActiveExploreRun = { mode: 'explore'; mapFile: string; events: RunEvent[]; hp: number; maxHp: number; potions: number[]; sips: number; potionsDrunk?: number[]; progress?: RunProgress; confirmed?: boolean; spentEnergy?: number; smugglerDeal?: SmugglerDeal; consumablesUsed?: ConsumableId[]; runId?: string; startedAt?: number; sipIds?: string[]; heroClass?: { id: HeroClassId; tier: HeroClassTier } | null; healSkill?: RunHealSkill | null }

export type RunHealSkill = { level: number; endurance: number }

// Сырьё для роста статов за забег — ровно те четыре числа, что клиент копит в
// Explore.tsx (attackDamageDealtRef/skillDamageDealtRef/healedAmountRef/
// damageTakenRef) и уже шлёт в /run/finish-explore. Не приросты статов:
// формулу считает сервер (applyStatGrowth в game.ts), клиент только меряет
// фактически нанесённое/полученное/вылеченное.
export type RunProgress = {
  attackDamageDealt: number
  skillDamageDealt: number
  healedAmount: number
  damageTaken: number
  /**
   * Сколько РЕЗУЛЬТАТИВНЫХ применений каждого навыка клиент насчитал за забег
   * (02.10.2026). Пятое поле того же среза, и это намеренно: применения
   * приходят тем же путём и по тем же правилам, что четыре счётчика выше
   * (срез /run/progress заменой + финиш), поэтому смерть и брошенный забег
   * обрабатывают их тем же кодом — нового правила не заводилось.
   *
   * Что считается применением — правило КЛИЕНТА (он один знает, попал ли
   * удар): шары, рывок и кровотечение задели хотя бы одного врага, исцеление
   * восстановило больше нуля HP, не больше одного за нажатие. См.
   * docs/skills.md.
   *
   * Всегда ПОЛНЫЙ объект по пяти навыкам каталога: у забега без среза и у
   * забега, начатого до появления поля, это честные нули (см. parseRunProgress).
   */
  skillUses: Record<SkillBookSkillId, number>
}

const RUN_PROGRESS_FIELDS = ['attackDamageDealt', 'skillDamageDealt', 'healedAmount', 'damageTaken'] as const

export function emptySkillUses(): Record<SkillBookSkillId, number> {
  const out = {} as Record<SkillBookSkillId, number>
  for (const id of SKILL_BOOK_SKILL_IDS) out[id] = 0
  return out
}

// Годное применение — ЦЕЛОЕ неотрицательное число, в отличие от счётчиков урона
// выше (там допустима дробь: урон тика кровотечения считается долей hp). Нажатий
// не бывает полтора, и дробь здесь означала бы испорченное поле.
function isSkillUseValue(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0
}

// СТРОГО: либо все пять навыков названы годными числами, либо null. Так читается
// присланный срез и то, что мы сами положили в currentRun.
function parseSkillUses(raw: unknown): Record<SkillBookSkillId, number> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const out = emptySkillUses()
  for (const id of SKILL_BOOK_SKILL_IDS) {
    const v = record[id]
    if (!isSkillUseValue(v)) return null
    out[id] = v
  }
  return out
}

// МЯГКО, поэлементно — для тела финиша, где каждое поле необязательное.
function coerceSkillUses(raw: unknown): Record<SkillBookSkillId, number> {
  const out = emptySkillUses()
  if (typeof raw !== 'object' || raw === null) return out
  const record = raw as Record<string, unknown>
  for (const id of SKILL_BOOK_SKILL_IDS) {
    const v = record[id]
    if (isSkillUseValue(v)) out[id] = v
  }
  return out
}

export function emptyRunProgress(): RunProgress {
  return { attackDamageDealt: 0, skillDamageDealt: 0, healedAmount: 0, damageTaken: 0, skillUses: emptySkillUses() }
}

// Годное значение счётчика — конечное неотрицательное число. Отдельной функцией,
// потому что политики у двух читателей РАЗНЫЕ (строгая и мягкая, см. ниже), а
// само правило "что такое годное число" обязано быть одно. NaN/Infinity
// отсекаются здесь: дальше они ушли бы в Float-колонку прогресса и тихо
// испортили бы рост статов навсегда.
function isRunProgressValue(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

// СТРОГО: либо все четыре числа годные, либо null. Так читается то, что
// написали МЫ САМИ (currentRun.progress) и тело /run/progress — частично
// испорченному срезу верить нельзя ни в одном поле, а молча подставить нули
// значило бы списать рост статов за весь забег как ноль, ничего не сказав.
export function parseRunProgress(raw: unknown): RunProgress | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const out = emptyRunProgress()
  for (const key of RUN_PROGRESS_FIELDS) {
    const v = record[key]
    if (!isRunProgressValue(v)) return null
    out[key] = v
  }
  // Применения навыков — ОТДЕЛЬНО от цикла выше: это вложенный объект, а не
  // число. Поля нет вовсе — честные нули, а не отказ: так шлёт клиент старее
  // 02.10.2026 и так выглядит срез, записанный прежним сервером (тот же
  // договор, что у readRunProgress с отсутствующим progress). Поле есть, но
  // негодное — null, как и у четырёх счётчиков: испорченному срезу нельзя
  // верить ни в одном поле.
  if (record.skillUses !== undefined) {
    const uses = parseSkillUses(record.skillUses)
    if (uses === null) return null
    out.skillUses = uses
  }
  return out
}

// МЯГКО, поэлементно: негодное поле становится нулём, остальные живут. Так
// читается тело /run/finish-explore — там каждое из четырёх полей
// необязательное (клиент постарше их вовсе не шлёт), и отказывать всему финишу
// из-за одного кривого числа нельзя: забег уже сыгран. Тот же приём, что у
// кривых индексов closedEvents.
export function coerceRunProgress(raw: unknown): RunProgress {
  const out = emptyRunProgress()
  if (typeof raw !== 'object' || raw === null) return out
  const record = raw as Record<string, unknown>
  for (const key of RUN_PROGRESS_FIELDS) {
    const v = record[key]
    if (isRunProgressValue(v)) out[key] = v
  }
  out.skillUses = coerceSkillUses(record.skillUses)
  return out
}

// Срез из currentRun. Поля нет — срезов ещё не было: честные нули, а не
// догадка (тот же договор, что у readRunPotionsDrunk выше). Поле есть, но не
// проходит строгую проверку — null: вызывающий обязан сказать об этом громко.
export function readRunProgress(run: ActiveExploreRun): RunProgress | null {
  const raw: unknown = run.progress
  if (raw === undefined) return emptyRunProgress()
  return parseRunProgress(raw)
}

// Подтверждён ли забег. true — да (включая забеги БЕЗ поля: все они созданы до
// появления /run/ready и подтверждены по определению, это факт, а не догадка).
// false — нет. null — поле есть, но не boolean: состояние испорчено, и
// вызывающий обязан сказать об этом громко.
//
// ⚠️ Испорченное поле вызывающий обязан трактовать как ПОДТВЕРЖДЁННЫЙ забег, то
// есть против игрока. Обратное сделало бы порчу currentRun выгодной: «непонятно
// что» означало бы закрытие без штрафа, то есть бесплатную страховку от смерти
// (см. CLAUDE.md, Design Decisions — вариант А).
export function readRunConfirmed(run: ActiveExploreRun): boolean | null {
  const raw: unknown = run.confirmed
  if (raw === undefined) return true
  if (typeof raw !== 'boolean') return null
  return raw
}

// --- Id забега, момент старта, id глотков (15.10.2026) ---

// Годный id запроса или забега: 8–64 символа из букв, цифр, '-' и '_'. Клиент
// шлёт UUID (36 символов); правило шире, чтобы не завязываться на один формат,
// но достаточно узкое, чтобы в БД и в лог не попадал произвольный мусор.
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/
export function parseRequestId(raw: unknown): string | null {
  return typeof raw === 'string' && REQUEST_ID_RE.test(raw) ? raw : null
}

// Id забега. null — поля нет (забег начат до 15.10.2026) ИЛИ оно испорчено:
// в обоих случаях проверять запросы забега не по чему, и вызывающий пропускает
// проверку. Испорченное поле при этом не даёт ничего «лишнего» — без id
// поведение ровно прежнее.
export function readRunId(run: ActiveExploreRun): string | null {
  return parseRequestId(run.runId)
}

// Момент старта (мс от эпохи). null — поля нет или оно не целое положительное
// число: окна подтверждения у такого забега нет, поведение прежнее.
export function readRunStartedAt(run: ActiveExploreRun): number | null {
  const raw: unknown = run.startedAt
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) return null
  return raw
}

// Окно подтверждения: сколько после старта забег ещё можно ПОДТВЕРДИТЬ
// (POST /run/ready, первый глоток, первый срез) и сколько его можно отменить
// как не показанный (POST /run/cancel-unshown).
//
// Зачем окно. Неподтверждённый забег вход закрывает без штрафа — так и
// задумано для забега, который игрок не увидел. Но «не увидел» сервер знает
// только со слов клиента: изменённый клиент мог не слать /run/ready (и ни
// глотков, ни срезов), играть весь забег и, если всё плохо, убить приложение
// бесплатно, а если хорошо — подтвердиться перед финишем. Теперь подтвердиться
// можно только в первые READY_WINDOW_MS, а финиш неподтверждённого забега
// идёт штрафным путём (см. /run/finish-explore). Бесплатная страховка
// сжимается с «весь забег» до этого окна.
//
// Почему 120 с. Честный клиент шлёт /run/ready сразу после загрузки: она
// сторожится LOAD_WATCHDOG_MS = 60 с (src/Explore.tsx), у самого подтверждения
// бюджет 24 с (READY_TOTAL_BUDGET_MS, src/api.ts), и оба отсчёта начинаются не
// раньше, чем сервер записал startedAt. Итого не позже 84 с; 36 с — запас.
// ⚠️ Поднимут сторож загрузки или бюджет подтверждения — поднимать и это число,
// иначе медленная, но честная загрузка получит отказ подтверждения.
// ⚠️ Число — решение по балансу (сколько секунд бесплатной страховки остаётся
// у изменённого клиента), а не только техническое.
export const READY_WINDOW_MS = 120_000

// Открыто ли ещё окно подтверждения. Забег без startedAt (старый) — окна нет,
// подтверждать можно всегда, как раньше.
export function readyWindowOpen(run: ActiveExploreRun, nowMs: number): boolean {
  const startedAt = readRunStartedAt(run)
  return startedAt === null || nowMs - startedAt <= READY_WINDOW_MS
}

// Уже записанные id глотков. Три состояния, как у readConsumablesUsed: поля
// нет — пустой список (честное «не было»); испорчено — null, вызывающий
// обязан отказать громко: свалить порчу в пустой список значило бы записать
// повтор второй раз, то есть ровно ту беду, от которой поле заведено.
export function readRunSipIds(run: ActiveExploreRun): string[] | null {
  const raw: unknown = run.sipIds
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length > MAX_SIPS_PER_RUN) return null
  const out: string[] = []
  for (const id of raw) {
    const parsed = parseRequestId(id)
    if (parsed === null) return null
    out.push(parsed)
  }
  return out
}

// Списанная этим забегом энергия. null — поля нет ИЛИ оно не целое
// неотрицательное число; у неподтверждённого забега это ошибка данных, о
// которой вызывающий обязан сказать громко, а не подставить RUN_COST молча:
// константа менялась, и её нынешнее значение ничего не доказывает про этот
// забег.
export function readRunSpentEnergy(run: ActiveExploreRun): number | null {
  const raw: unknown = run.spentEnergy
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) return null
  return raw
}

// --- Расходники, взятые в забег (POST /run/start-explore) ---
//
// Пишется ОДИН раз, на старте, вместе со списанием склада, и потом только
// читается. Список id, а не количеств: повторы в гнёздах запрещены (одно гнездо
// — один предмет), поэтому каждый взятый расходник ровно один.
//
// Нужен затем, чтобы эффект забега считался от того, что РЕАЛЬНО списано, а не
// от того, что клиент прислал в очередном запросе: множитель урона живёт весь
// забег, и пересчитывать его по телу запроса значило бы верить клиенту в том,
// что он уже «оплатил» камнем.

// Результат чтения списка — ТРИ различимых состояния, как у сделки
// Контрабандиста (readSmugglerDeal ниже): «поля нет» и «поле испорчено» обязаны
// различаться. Свалить их в пустой массив значило бы тихо отменить уже списанный
// расходник — игрок заплатил, а эффекта нет.
export type ConsumablesUsedRead =
  | { kind: 'none' }
  | { kind: 'used'; ids: ConsumableId[] }
  | { kind: 'malformed' }

// СТРОГИЙ разбор: любое отклонение — malformed. Требования те же, что проверял
// старт: только id каталога с флагом runSlot, без повторов, не больше
// RUN_CONSUMABLE_SLOTS. Проверяем повторно при чтении, а не доверяем своей же
// записи: колонка Json схемой не проверяется, и испорченный извне список не
// должен молча дать эффект, которого игрок не покупал.
export function parseConsumablesUsed(raw: unknown): ConsumableId[] | null {
  if (!Array.isArray(raw)) return null
  if (raw.length > RUN_CONSUMABLE_SLOTS) return null
  const out: ConsumableId[] = []
  for (const item of raw) {
    if (typeof item !== 'string') return null
    const spec = runSlotConsumableById(item)
    if (spec === null) return null
    if (out.includes(spec.id)) return null
    out.push(spec.id)
  }
  return out
}

// Взятые расходники из currentRun. Поля нет — не брали ничего (честное
// состояние: до появления фичи его не было ни у одного забега, и брать тогда
// было нечего).
export function readConsumablesUsed(run: ActiveExploreRun): ConsumablesUsedRead {
  const raw: unknown = run.consumablesUsed
  if (raw === undefined) return { kind: 'none' }
  const parsed = parseConsumablesUsed(raw)
  if (parsed === null) return { kind: 'malformed' }
  return { kind: 'used', ids: parsed }
}

// --- Сделка с Контрабандистом (POST /run/smuggler-deal) ---
//
// Пишется ОДИН раз за забег и потом только читается: бросок удачи/кражи
// неповторим, поэтому повторный запрос обязан вернуть уже сохранённое (см.
// идемпотентность эндпоинта), а финиш — посчитать итог по ЭТИМ числам, а не
// бросить заново.
//   closedBefore — индексы событий, закрытых К МОМЕНТУ сделки. Нужны финишу,
//     чтобы отделить добычу ДО сделки (она уже внутри stake и умножена) от
//     добычи ПОСЛЕ (прибавляется без множителя). Без этого списка финиш
//     посчитал бы закрытое до сделки дважды.
//   stake — банк персонажа + трофеи событий из closedBefore, то есть то, что
//     стояло на кону.
//   outcome — исход СЕРВЕРНОГО броска.
//   after — сколько стало из stake после множителя. Хранится готовым числом, а
//     не пересчитывается на финише: пересчёт по константам разошёлся бы с тем,
//     что игрок увидел, если константы поменяют посреди живого забега.
export type SmugglerDeal = {
  closedBefore: number[]
  stake: number
  outcome: 'gain' | 'steal'
  after: number
}

// Результат чтения сделки — ТРИ различимых состояния, а не два. «Сделки не
// было» и «поле испорчено» обязаны различаться: свалить их в один null значило
// бы посчитать испорченную сделку как отсутствующую, то есть тихо отменить
// кражу (или отнять выигрыш) — ровно тот молчаливый фолбэк, который в проекте
// запрещён.
export type SmugglerDealRead =
  | { kind: 'none' }
  | { kind: 'deal'; deal: SmugglerDeal }
  | { kind: 'malformed' }

// СТРОГИЙ разбор: любое отклонение — malformed, вызывающий обязан сказать громко.
// Числа требуются целыми неотрицательными (stake складывается из целых
// trophyReward и целого банка, after — результат Math.round), индексы — целыми
// неотрицательными; верхнюю границу индекса здесь не проверяем, её знает только
// вызывающий (длина run.events), и он же её применяет.
export function parseSmugglerDeal(raw: unknown): SmugglerDeal | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>

  const closedBefore = record.closedBefore
  if (!Array.isArray(closedBefore)) return null
  if (!closedBefore.every((i) => Number.isInteger(i) && (i as number) >= 0)) return null

  const stake = record.stake
  if (!Number.isInteger(stake) || (stake as number) < 0) return null

  const after = record.after
  if (!Number.isInteger(after) || (after as number) < 0) return null

  const outcome = record.outcome
  if (outcome !== 'gain' && outcome !== 'steal') return null

  return {
    closedBefore: [...(closedBefore as number[])],
    stake: stake as number,
    outcome,
    after: after as number,
  }
}

// Сделка из currentRun. Поля нет — сделки не было (честное состояние, а не
// догадка: до появления фичи его не было ни у одного забега, и тогда обмена у
// Контрабандиста через сервер тоже не существовало).
export function readSmugglerDeal(run: ActiveExploreRun): SmugglerDealRead {
  const raw: unknown = run.smugglerDeal
  if (raw === undefined) return { kind: 'none' }
  const parsed = parseSmugglerDeal(raw)
  if (parsed === null) return { kind: 'malformed' }
  return { kind: 'deal', deal: parsed }
}

// Что делать с забегом, найденным открытым при входе (см. /auth/login).
//   'penalty'   — закрыть как смерть: обнулить трофеи, списать выпитое,
//                 применить рост статов. Прежнее и единственное поведение.
//   'abandoned' — закрыть БЕЗ штрафа и вернуть spentEnergy: игрок не увидел
//                 забег вовсе.
// `loud` — всё, что вызывающий ОБЯЗАН записать в log.error. Пустой массив
// значит «данные чистые».
export type InterruptedRunJudgement = {
  verdict: 'penalty' | 'abandoned'
  /** Сколько энергии вернуть. Осмысленно только при 'abandoned', иначе 0. */
  spentEnergy: number
  loud: string[]
}

// Чистая функция: ни Prisma, ни логов, ни времени — только форма currentRun.
// Правило одно на все ветки: ЛЮБОЕ сомнение трактуется против игрока, то есть
// в пользу штрафного пути. Иначе порча или недосказанность в currentRun
// становятся выгодны, и «убить приложение» снова обгоняет честную смерть.
export function judgeInterruptedRun(run: ActiveExploreRun): InterruptedRunJudgement {
  const loud: string[] = []
  const penalty = (): InterruptedRunJudgement => ({ verdict: 'penalty', spentEnergy: 0, loud })

  const confirmed = readRunConfirmed(run)
  if (confirmed === null) {
    loud.push('currentRun.confirmed is malformed, treating the run as confirmed')
    return penalty()
  }
  if (confirmed) return penalty()

  // Дальше — только неподтверждённые. Признак реальной игры закрывает
  // бесплатную страховку: клиент, который «забыл» подтвердиться, но успел
  // подраться и выпить зелье, закрывается обычным путём.
  const spentEnergy = proveNotPlayed(run, loud)
  if (spentEnergy === null) return penalty()
  return { verdict: 'abandoned', spentEnergy, loud }
}

// Доказывает, что в забеге НЕ играли, и возвращает, сколько энергии вернуть.
// null — доказать не вышло (есть признак игры, данные испорчены или неизвестно,
// сколько списал старт); причину порчи функция дописывает в `loud`.
// Общая для двух читателей: вход, закрывающий неподтверждённый забег
// (judgeInterruptedRun выше), и отмена не показанного забега
// (judgeUnshownCancel ниже). Разные правила «что считается игрой» у них
// разъехались бы молча, а это ровно граница между штрафом и его отсутствием.
function proveNotPlayed(run: ActiveExploreRun, loud: string[]): number | null {
  const progress = readRunProgress(run)
  if (progress === null) {
    // Испорченный срез не может ДОКАЗАТЬ отсутствие игры — значит не доказывает.
    loud.push('currentRun.progress is malformed, cannot prove the run was never played')
    return null
  }
  // Применений навыков здесь НЕТ намеренно, и это не пробел: результативное
  // применение по построению даёт либо урон (шары, рывок, кровотечение), либо
  // лечение (исцеление), то есть одно из четырёх чисел ниже уже не ноль.
  // Отдельное условие было бы пятым способом сказать то же самое — и новым
  // правилом там, где задача просила его не заводить.
  const played =
    progress.attackDamageDealt > 0 || progress.skillDamageDealt > 0 ||
    progress.healedAmount > 0 || progress.damageTaken > 0
  if (played) return null

  const drunk = readRunPotionsDrunk(run)
  if (drunk === null) {
    loud.push('currentRun.potionsDrunk is malformed, cannot prove the run was never played')
    return null
  }
  if (drunk.some((n) => n > 0)) return null

  const spentEnergy = readRunSpentEnergy(run)
  if (spentEnergy === null) {
    // Вернуть нечего — сколько списали, неизвестно. Закрываем обычным путём:
    // выдумывать число (RUN_COST «на сегодня») нельзя, оно уже не то.
    loud.push('currentRun.spentEnergy is missing or malformed on an unconfirmed run, falling back to the penalty path')
    return null
  }
  return spentEnergy
}

// Можно ли отменить забег как НЕ ПОКАЗАННЫЙ (POST /run/cancel-unshown).
//
// Зачем. Подтверждение старта (/run/ready) могло дойти до сервера, а ответ —
// потеряться: клиент показывает экран ошибки и игру не запускает, а забег на
// сервере уже подтверждён, и следующий вход закрыл бы его как смерть, со
// сгоранием всего банка трофеев. Клиент, не дождавшийся подтверждения,
// просит отменить забег — и сервер соглашается, только если:
//   • отмена пришла в окне подтверждения (READY_WINDOW_MS от старта);
//   • в забеге не играли — то же доказательство, что у входа (proveNotPlayed);
//   • сделки с Контрабандистом не было (она бывает только в показанном забеге).
// Флаг confirmed здесь НЕ читается намеренно: отменять надо именно забег,
// подтверждённый без ведома клиента.
//
// Новой лазейки это не открывает: в те же секунды изменённый клиент и так мог
// просто не подтверждаться и закрыть забег без штрафа. Окно у обоих путей одно.
export type UnshownCancelJudgement =
  | { verdict: 'cancel'; spentEnergy: number; loud: string[] }
  | { verdict: 'refuse'; reason: 'no-window' | 'window-expired' | 'played' | 'smuggler-deal'; loud: string[] }

export function judgeUnshownCancel(run: ActiveExploreRun, nowMs: number): UnshownCancelJudgement {
  const loud: string[] = []
  // Забег без startedAt (начат до 15.10.2026) окна не имеет — отменять его
  // нельзя вовсе: иначе «отмена» работала бы в любой момент забега.
  if (readRunStartedAt(run) === null) return { verdict: 'refuse', reason: 'no-window', loud }
  if (!readyWindowOpen(run, nowMs)) return { verdict: 'refuse', reason: 'window-expired', loud }
  if (run.smugglerDeal !== undefined) return { verdict: 'refuse', reason: 'smuggler-deal', loud }
  const spentEnergy = proveNotPlayed(run, loud)
  if (spentEnergy === null) return { verdict: 'refuse', reason: 'played', loud }
  return { verdict: 'cancel', spentEnergy, loud }
}

// Во что превратились потолки: сами числа плюс всё, что нужно вызывающему для
// лога. Чистая функция ничего не пишет в лог сама — контекст (кто, какой
// забег, откуда пришли числа: из тела финиша или из среза брошенного забега)
// у каждого свой, тот же договор, что у clampPotionsSpent ниже.
export type ClampedRunProgress = {
  progress: RunProgress
  /** <1 — суммарный нанесённый урон срезан во столько раз. */
  dealtScale: number
  maxDamageDealt: number
  maxDamageTaken: number
  /** Потолок лечения — maxHp забега плюс запас под навык «Исцеление» (healSkillMax). */
  maxHealed: number
  /**
   * Сколько из maxDamageTaken — запас под лечение класса «Кровь» (26.10.2026);
   * 0 — у забега этого класса нет.
   */
  classHealMax: number
  /** Класс забега, по которому считался запас ('malformed' — считался как без класса). */
  runHeroClass: HeroClassState | 'malformed'
  /**
   * Сколько HP самое большее вернул навык «Исцеление» за забег — входит и в
   * maxDamageTaken, и в maxHealed. 0 — навык не надет на старте (или забег
   * начат до записи healSkill).
   */
  healSkillMax: number
  /** Сколько применений «Исцеления» допущено в healSkillMax — для логов. */
  healUsesMax: number
  /** Сколько из maxDamageTaken — подъём оберегом от смерти; 0 — оберег не взят. */
  charmHealMax: number
  /** Исцеление забега, по которому считался запас ('malformed' — считался как не надетое). */
  runHealSkill: RunHealSkill | null | 'malformed'
  enemyCount: number
  bossCount: number
}

// Вероятность, с которой ЧЕСТНЫЙ Повелитель стихий превысит запас под
// бесплатные применения исцеления (freeUsesBound ниже). Строгого максимума у
// бесплатных применений нет: бросок «бесплатно» (10%) может выпасть сколько
// угодно раз подряд. Поэтому граница вероятностная — одна на миллиард забегов,
// то есть «никогда» за жизнь игры, — а не «среднее», которое резало бы каждого
// второго везучего. Превысит — срежется ровно лишнее, не весь рост.
export const FREE_SKILL_TAIL_PROBABILITY = 1e-9

// P(Bin(n, p) ≥ k) — в логарифмах: на длинном ряду (1 − p)^n ушло бы в ноль
// раньше, чем кончатся заметные члены.
function binomialTailAtLeast(n: number, k: number, p: number): number {
  if (k <= 0) return 1
  if (k > n) return 0
  let logPmf = n * Math.log1p(-p)
  const logOdds = Math.log(p) - Math.log1p(-p)
  let tail = 0
  for (let j = 0; j <= n; j++) {
    if (j >= k) tail += Math.exp(logPmf)
    logPmf += Math.log((n - j) / (j + 1)) + logOdds
  }
  return tail
}

/**
 * Сколько БЕСПЛАТНЫХ применений навыка допустить сверх `paid` оплаченных, когда
 * каждое применение бесплатно с шансом `chance` (Повелитель стихий, бросок в
 * paySkill клиента — после проверки цены: без маны на полную цену бесплатного
 * применения не бывает).
 *
 * Бесплатных F перед `paid`-м оплаченным — отрицательное биномиальное:
 * P(F ≥ k) = P(среди первых paid + k − 1 применений не меньше k бесплатных).
 * Ответ — наименьшее f, при котором P(F > f) ≤ FREE_SKILL_TAIL_PROBABILITY.
 * Не по карману ни одно (paid = 0) — бесплатных тоже нет. Шанса нет — 0.
 * Цикл ограничен сверху: при сломанном шансе (≥ 1) он не крутится вечно, а
 * отдаёт большое КОНЕЧНОЕ число — бесконечность в потолке дала бы NaN.
 */
export function freeUsesBound(paid: number, chance: number): number {
  if (!(chance > 0) || paid <= 0) return 0
  const LIMIT = 10_000
  for (let k = 1; k <= LIMIT; k++) {
    if (binomialTailAtLeast(paid + k - 1, k, chance) <= FREE_SKILL_TAIL_PROBABILITY) return k - 1
  }
  return LIMIT
}

// Анти-чит-потолки на сырьё роста статов. ОДНА копия на оба пути: тело
// /run/finish-explore и срез брошенного забега в /auth/login. Разъехаться им
// нельзя — иначе закрытое приложение растило бы статы не так, как честная
// смерть, то есть ровно тем способом, которым закрытие становится выгоднее
// (см. CLAUDE.md, вариант А).
//
// Потолок нанесённого — суммарное HP врагов ЭТОГО забега (clusterPoints у
// событий kind:'enemy' из run.events, то есть из currentRun, а не из тела
// запроса; HP одного врага — по виду группы, у Привратника оно в полтора раза
// больше звериного), ПЛЮС число боссов × HP босса на том
// же уровне (scaledBossMaxHp — множитель BOSS_HP_MULT поверх scaledEnemyMaxHp,
// см. game.ts) — иначе забег с одним боссом и без обычных врагов давал потолок
// 0 и обрезал весь урон. Всё вместе × запас 1.5 (промахи/оверкилл). Меч и
// скиллы режутся ОДНИМ множителем: потолок общий, а какая доля чья — знает
// только клиент.
//
// Потолок полученного — maxHp ЭТОГО забега × (1 + глотки забега × максимальная
// доля лечения по каталогу) × запас 1.5. Максимум по каталогу, а не 0.25, как
// было до тиров: потолок обязан быть не ниже того, что честный игрок реально
// мог восстановить, иначе он молча срежет ему рост выносливости.
//
// Плюс запас под лечение класса «Кровь» (26.10.2026) — его тоже честный игрок
// реально восстанавливает. Класс — ЗАБЕГА (run.heroClass, записан стартом из
// колонок персонажа), а не слово клиента. Запас — ТЕОРЕТИЧЕСКИЙ МАКСИМУМ, без
// угадывания статов:
//   • кровотечение и Кровавый клинок лечат долей НАНЕСЁННОГО урона (0.5 и 0.1),
//     а нанести за забег можно не больше суммарного HP его врагов и боссов
//     (клиент копит урон, обрезанный остатком HP цели, — каждая единица HP
//     врага «наносится» один раз). Значит, их лечение вместе не больше
//     0.5 × (HP врагов + HP боссов): худший случай — всё добито кровотечением;
//   • Пир (Владыка) — 5% maxHp за убийство кровоточащего, убийств не больше,
//     чем врагов и боссов в забеге.
// Множитель ×1.5 к этому запасу НЕ применяется: он и так точная верхняя
// граница (округление лечения у клиента — вниз).
// Плата кровью (Владыка) — расход HP, а не полученный урон: в damageTaken она
// не идёт и потолок не трогает.
//
// Плюс запас под навык «Исцеление» и под оберег от смерти (26.10.2026, вечер) —
// до этого их покрывал только ×1.5 базовой части, и честному игроку с
// исцелением в долгом забеге его не хватало. Оба — точные верхние границы, тоже
// без ×1.5 (healSkillReserve и charmReserve ниже, там разобрано каждое число).
// Полученный урон клиент копит обрезанным остатком HP героя (actualDamage в
// applyDamage, Explore.tsx), поэтому за забег его не больше, чем здоровья было
// на старте плюс всё, что вернули: зелья, класс, исцеление, оберег. ×1.5 у
// базовой части оставлен как был: эта правка потолок только поднимает.
//
// Потолок лечения (healedAmount) — maxHp забега плюс тот же запас исцеления.
// healedAmount клиент копит ТОЛЬКО через healPlayer: зелья и «Исцеление»;
// лечение класса и оберег туда не идут (и ловкость не растят). Зелья
// укладываются в maxHp: 3 глотка × 30% старшего тира = 90%. А с исцелением
// прежний потолок maxHp резал рост ловкости уже после пяти применений у героя
// 10/10/10 (80 HP, исцеление 16 за применение).
//
// Ветки «Магия» и «Клинок» (26.10.2026) запаса под УРОН не получают ни в одном
// потолке, и это проверено, а не забыто. +15% к шарам, Таяние (×2), +15% к мечу
// и крит (×2) — множители урона, а нанесённый урон клиент копит ОБРЕЗАННЫМ
// остатком HP цели (damageEnemy / damageBoss в Explore.tsx): множитель даёт
// добить врага быстрее, но не нанести больше его HP, и сверх hpPool не набрать
// никаким множителем. Казнь — удар ровно на остаток HP цели, тоже не больше.
// Лечения у этих веток нет. Одно исключение — бесплатный навык Повелителя
// стихий: он даёт больше применений исцеления, чем оплачено маной, и входит в
// запас исцеления (healSkillReserve).
//
// `nowMs` — часы сервера в момент закрытия забега (финиш или вход). Нужны
// одному случаю — Владыке крови с исцелением (см. healSkillReserve).
//
// ⚠️ run.maxHp приводится к числу ЯВНО. Испорченный currentRun дал бы NaN,
// NaN дошёл бы до applyStatProgress — а там сравнение с порогом на NaN не
// выполняется ни в одну сторону, и цикл `while` крутился бы вечно, вешая весь
// сервер на запросе, который обязан выжить при любом содержимом currentRun
// (это ЛОГИН). Сами четыре числа уже конечны: их пропустил parse/coerce выше.
export function clampRunProgress(raw: RunProgress, run: ActiveExploreRun, characterLevel: number, nowMs: number): ClampedRunProgress {
  const events = Array.isArray(run.events) ? run.events : []
  // HP группы — по её ВИДУ (06.10.2026): у Привратника 150% HP зверя, и посчитай
  // мы его группу как звериную, она одна выбрала бы весь запас ×1.5 — честному
  // игроку потолок начал бы срезать рост силы, молча. Вид берётся из СВОЕГО
  // currentRun (его бросил этот же сервер на старте), а не из тела запроса.
  // Любое другое значение, включая отсутствие поля, считается звериным: у
  // Звонаря HP меньше, и такой счёт потолок только завышает.
  const enemyGroups = events.filter((ev) => ev.kind === 'enemy')
  // Число врагов в потолок больше не входит (его заменила сумма HP ниже), но
  // остаётся в ответе функции: по нему читаются логи расхождений на финише.
  const enemyCount = enemyGroups.reduce((sum, ev) => sum + (ev.clusterPoints?.length ?? 0), 0)
  const enemyHpTotal = enemyGroups.reduce((sum, ev) => {
    const perEnemy = ev.enemyKind === 'gatekeeper' ? scaledGatekeeperMaxHp(characterLevel) : scaledEnemyMaxHp(characterLevel)
    return sum + (ev.clusterPoints?.length ?? 0) * perEnemy
  }, 0)
  const bossCount = events.filter((ev) => ev.kind === 'boss').length
  const hpPool = enemyHpTotal + bossCount * scaledBossMaxHp(characterLevel)
  const maxDamageDealt = hpPool * 1.5

  const combinedDealt = raw.attackDamageDealt + raw.skillDamageDealt
  const dealtScale = combinedDealt > maxDamageDealt && combinedDealt > 0 ? maxDamageDealt / combinedDealt : 1

  const runMaxHp = isRunProgressValue(run.maxHp) ? run.maxHp : 0
  const maxHealFrac = Math.max(...POTION_TIERS.map((t) => t.healFrac))
  // Испорченный класс забега — как без класса: запас меньше, то есть трактовка
  // против игрока, как у всех потолков. Вызывающий видит это по runHeroClass.
  const runHeroClass = readRunHeroClass(run)
  const blood = bloodClassEffects(runHeroClass === 'malformed' ? 'none' : runHeroClass)
  const classHealMax =
    Math.max(blood.bleedHealFrac, blood.bladeHealFrac) * hpPool
    + blood.feastHealFrac * runMaxHp * (enemyCount + bossCount)
  const runHealSkill = readRunHealSkill(run)
  const heal = healSkillReserve(run, runHealSkill, runHeroClass === 'malformed' ? 'none' : runHeroClass, enemyCount + bossCount, nowMs)
  const charmHealMax = charmReserve(run, runMaxHp)
  const maxDamageTaken = runMaxHp * (1 + runSipsAllowed(run) * maxHealFrac) * 1.5 + classHealMax + heal.hp + charmHealMax
  const maxHealed = runMaxHp + heal.hp

  return {
    progress: {
      attackDamageDealt: Math.round(raw.attackDamageDealt * dealtScale),
      skillDamageDealt: Math.round(raw.skillDamageDealt * dealtScale),
      healedAmount: Math.min(raw.healedAmount, maxHealed),
      damageTaken: Math.min(raw.damageTaken, maxDamageTaken),
      // Применения навыков проходят ЗДЕСЬ БЕЗ ПОТОЛКА, и это осознанно, а не
      // забытая проверка. Вывести его не из чего: урон ограничен числом врагов
      // забега, а число РЕЗУЛЬТАТИВНЫХ нажатий — нет (забег не ограничен по
      // времени, кулдаун позволяет бить одну цель сколько угодно раз). Любое
      // выдуманное число резало бы рост навыка честному игроку — ровно та
      // ошибка, от которой потолок полученного урона уже лечили (см. шапку).
      // Поэтому применения — то же доверие клиенту, что и весь бой: см.
      // CLAUDE.md, Design Decisions, «Модель сетевой авторитетности боя НЕ
      // выбрана». Строка обязана остаться даже без потолка: забудь её — и
      // применения молча пропадут на пути к росту уровня.
      skillUses: raw.skillUses,
    },
    dealtScale,
    maxDamageDealt,
    maxDamageTaken,
    maxHealed,
    classHealMax,
    runHeroClass,
    healSkillMax: heal.hp,
    healUsesMax: heal.uses,
    charmHealMax,
    runHealSkill,
    enemyCount,
    bossCount,
  }
}

// Запас под навык «Исцеление»: сколько применений МОГЛО быть за забег × сколько
// HP самое большее возвращает одно (healSkillPerUse, game.ts). Сила — по уровню
// и выносливости, записанным на СТАРТЕ (run.healSkill): клиент снимает её там
// же, один раз, а не по колонкам на финише. Не надет на старте — 0.
//
// Сколько применений — его ограничивает мана, и считается она по правилам боя:
//   • забег начинается с полного запаса — RUN_MANA_MAX (10);
//   • мана приходит только с убитых: с каждого врага и с каждого босса не
//     больше RUN_MANA_DROP_MAX (2) шаров по 1. Шанс выпадения (50%, у
//     Повелителя 75%) на границу не влияет — берём случай «выпало всё»;
//   • итого за забег пришло не больше 10 + 2 × (врагов + боссов); выше потолка
//     10 мана сгорает, а это только уменьшает её, так что граница верна;
//   • одно применение стоит HEAL_MANA_COST (3), и нажать его можно только при
//     мане ≥ 3, поэтому оплаченных — не больше floor(маны / 3). Худший случай —
//     вся мана ушла на исцеление, другие навыки её только отнимают.
// Повелитель стихий: каждое применение бесплатно с шансом 10% — сверх
// оплаченных допускается freeUsesBound (вероятностная граница, см. там).
// Владыка крови: недостающую ману платит HP — 3 × ceil(5% maxHp) за применение,
// а возвращает оно 2 × floor(0.8 × выносливость) ≈ 20% maxHp (maxHp = 8 ×
// выносливость). Применение за кровь окупается само (у героя 25/25/25: цена
// 30 HP, лечение 40), и мана его больше не ограничивает. Остаётся одно —
// перезарядка: не чаще раза в HEAL_COOLDOWN_MS (5 с) игрового времени, а
// игровое время тикает не быстрее часов (ticker.deltaMS). Значит, применений не
// больше 1 + floor((часы сервера сейчас − startedAt) / 5 с) — и не меньше, чем
// у героя без Платы кровью. Цена кровью из запаса НЕ вычитается: граница выше
// настоящей, но не ниже. Нет startedAt (порча — у забега с классом он есть
// всегда) — считаем как без Платы кровью, против игрока.
function healSkillReserve(
  run: ActiveExploreRun,
  heal: RunHealSkill | null | 'malformed',
  heroClass: HeroClassState,
  kills: number,
  nowMs: number,
): { hp: number; uses: number } {
  if (heal === null || heal === 'malformed') return { hp: 0, uses: 0 }
  const manaTotal = RUN_MANA_MAX + RUN_MANA_DROP_MAX * kills
  const paidUses = Math.floor(manaTotal / HEAL_MANA_COST)
  let uses = paidUses + freeUsesBound(paidUses, magicClassEffects(heroClass).freeSkillChance)
  if (bloodClassEffects(heroClass).manaHpFrac > 0) {
    const startedAt = readRunStartedAt(run)
    if (startedAt !== null && Number.isFinite(nowMs)) {
      uses = Math.max(uses, 1 + Math.floor(Math.max(0, nowMs - startedAt) / HEAL_COOLDOWN_MS))
    }
  }
  return { hp: uses * healSkillPerUse(heal.level, heal.endurance), uses }
}

// Запас под оберег от смерти: смертельный удар вместо смерти поднимает героя с
// max(1, floor(maxHp × reviveFrac)) HP (applyDamage в Explore.tsx), и ОДИН раз
// за забег — после спасения оберег гаснет. Взят ли он — по СВОЕМУ списку
// взятых расходников (consumablesUsed пишет старт вместе со списанием), а не по
// слову клиента; повторов в списке не бывает. Доля — из общего каталога
// (consumableReviveFrac, сейчас 0.5). Испорченный список — 0, против игрока.
function charmReserve(run: ActiveExploreRun, runMaxHp: number): number {
  const used = readConsumablesUsed(run)
  if (used.kind !== 'used') return 0
  let hp = 0
  for (const id of used.ids) {
    const spec = runSlotConsumableById(id)
    const frac = spec === null ? null : consumableReviveFrac(spec)
    if (frac !== null) hp += Math.max(1, Math.floor(runMaxHp * frac))
  }
  return hp
}

// Выпитое по тирам из currentRun. Поля нет — глотков не было: это честные нули,
// а не догадка. Поле есть, но не массив из POTION_TIER_COUNT неотрицательных
// целых — null: состояние испорчено, и вызывающий обязан сказать об этом
// громко, а не считать с нуля.
export function readRunPotionsDrunk(run: ActiveExploreRun): number[] | null {
  const raw: unknown = run.potionsDrunk
  if (raw === undefined) return emptyPotionStock()
  if (!Array.isArray(raw) || raw.length !== POTION_TIER_COUNT) return null
  if (!raw.every((n) => Number.isInteger(n) && (n as number) >= 0)) return null
  return [...(raw as number[])]
}

// Снимок склада ПО ТИРАМ, выданный на ЭТОТ забег. Пустой массив у забега с
// испорченным полем — потолок по каждому тиру тогда 0, то есть списать нельзя
// ничего: строгая сторона, как и везде в подсчёте выпитого.
export function runPotionStock(run: ActiveExploreRun): number[] {
  return Array.isArray(run.potions) ? run.potions : []
}

// Лимит глотков за ЭТОТ забег. Нецелое/отсутствующее — откат на общий
// MAX_SIPS_PER_RUN, тот же, что кладёт в забег /run/start-explore.
export function runSipsAllowed(run: ActiveExploreRun): number {
  return Number.isInteger(run.sips) ? run.sips : MAX_SIPS_PER_RUN
}

// Сколько зелий КАЖДОГО ТИРА разрешено списать за забег — два потолка подряд,
// поверх уже разобранного числа выпитого (мусор вызывающий обнуляет до входа
// сюда, см. readRunPotionsDrunk и разбор тела в /run/finish-explore).
//
// Потолок 1, ПО КАЖДОМУ ТИРУ: не больше, чем этот забег выдал (runStock —
// снимок из currentRun, не из тела запроса). Именно он не даёт списать выпитое
// дорогое как дешёвое: заявить T5 больше, чем на забег было выдано T5, нельзя.
//
// Потолок 2, ПО СУММЕ: не больше sipsAllowed глотков независимо от тиров.
// Излишек срезается с МЛАДШИХ тиров вверх (строгая сторона: дорогие списания
// сохраняются). Сюда попадают только враньё и ошибка счёта — ни то, ни другое
// не должно оборачиваться подарком.
//
// Чистая функция: ничего не логирует. Расхождение с тем, что просили списать,
// вызывающий замечает сравнением со своим входом и пишет в лог сам — контекст
// (кто, какой забег, откуда пришло число) у каждого свой.
export function clampPotionsSpent(drunk: number[], runStock: number[], sipsAllowed: number): number[] {
  const spent = drunk.map((n, i) => Math.min(n, runStock[i] ?? 0))

  let overflow = spent.reduce((sum, n) => sum + n, 0) - sipsAllowed
  for (let i = 0; i < POTION_TIER_COUNT && overflow > 0; i++) {
    const cut = Math.min(spent[i], overflow)
    spent[i] -= cut
    overflow -= cut
  }
  return spent
}

// Склад после списания. Никогда не в минус, даже если склад сдвинулся между
// стартом забега и списанием (например, покупка посреди забега).
export function subtractPotionStock(stock: number[], spent: number[]): number[] {
  return stock.map((n, i) => Math.max(0, n - (spent[i] ?? 0)))
}

// Склад зелий персонажа как массив по тирам (индекс = тир-1) и обратно в поля
// Prisma. Пять колонок вместо Json — цена за атомарные +1/-1 в общем update;
// эти две функции держат разложение в ОДНОМ месте, чтобы номера тиров не
// расползлись строковыми ключами по эндпоинтам.
// --- Расходники: колонки Character <-> объект по id каталога ---
//
// Живёт ЗДЕСЬ, рядом с раскладкой зелий, а не в consumables.ts: тот файл обязан
// быть байт-в-байт с клиентским, а имена колонок БД клиенту не нужны и знать их
// ему незачем.
//
// Новый расходник = новая колонка в схеме + миграция + строка здесь + вариант в
// ConsumableId (consumables.ts). Забыть последнее нельзя: switch в
// consumableStockIncrement (routes/run.ts) не скомпилируется без нового варианта.
export type ConsumableColumns = {
  whetstones: number
  charms: number
  bookFire: number
  bookIce: number
  bookBleed: number
  bookHeal: number
  bookDash: number
}

/**
 * Запас расходников объектом по id каталога — форма ответов клиенту.
 *
 * ⚠️ Отдавать НУЖНО ВСЕ id каталога: клиентский readConsumables (src/api.ts)
 * требует их все и на неполном объекте возвращает null, то есть «запас
 * неизвестен» — прочерки вместо чисел на витрине, в сумке и в гнёздах. Поэтому
 * колонки книг обязаны попасть сюда ОДНОВРЕМЕННО с появлением id book_* в
 * каталоге, а сервер выкладываться раньше клиента (обычный порядок проекта).
 */
export function consumableStockOf(character: ConsumableColumns): Record<ConsumableId, number> {
  return {
    whetstone: character.whetstones,
    charm_death: character.charms,
    book_fire: character.bookFire,
    book_ice: character.bookIce,
    book_bleed: character.bookBleed,
    book_heal: character.bookHeal,
    book_dash: character.bookDash,
  }
}

// --- Страницы книг: колонки Character <-> объект по id каталога ---
//
// Рядом с раскладкой расходников и по тем же причинам: имена колонок клиенту не
// нужны, а форма ответа — объект по id, не позиционный массив (порядка у
// страниц нет, и массив молча съехал бы при добавлении шестой).
//
// Новая страница = новая колонка в схеме + миграция + строка здесь + вариант в
// SCROLL_IDS (scrolls.ts). Забыть последнее нельзя: switch в
// scrollStockIncrement/scrollStockFilter (routes/run.ts) не скомпилируется без
// нового варианта. Забыть строку ЗДЕСЬ тоже нельзя, но цена ошибки другая — не
// сборка, а экран: Record<ScrollId, number> без ключа не скомпилируется на
// сервере, зато неполный объект, дошедший до клиента, readScrolls целиком
// превратит в null, то есть «запас неизвестен» у ВСЕХ страниц сразу.
export type ScrollColumns = {
  scrollFire: number
  scrollIce: number
  scrollBleed: number
  scrollHeal: number
  scrollDash: number
}

/**
 * Запас страниц объектом по id каталога — форма ответов клиенту (логин,
 * профиль, обе ручки страниц, финиш забега).
 *
 * ⚠️ Отдавать НУЖНО ВСЕ id каталога: клиентский readScrolls (src/api.ts)
 * требует их все и на неполном объекте возвращает null. Та же дисциплина, что у
 * consumableStockOf и skillLevelsOf рядом.
 *
 * Перечислением, а не циклом по каталогу: ровно как consumableStockOf и
 * skillLevelsOf ниже — тип Record<ScrollId, number> не соберётся, если забыть
 * строку, а цикл по SCROLLS потребовал бы второй карты id→колонка.
 */
export function scrollStockOf(character: ScrollColumns): Record<ScrollId, number> {
  return {
    scroll_fire: character.scrollFire,
    scroll_ice: character.scrollIce,
    scroll_bleed: character.scrollBleed,
    scroll_heal: character.scrollHeal,
    scroll_dash: character.scrollDash,
  }
}

// --- Предметы классов: колонки Character <-> объект по id каталога ---
//
// Осколок души и Печать отречения (18.10.2026, каталог classItems.ts). Те же
// причины, что у страниц выше: имена колонок клиенту не нужны, форма ответа —
// объект по id. Отдельным объектом, а не внутри consumables: каталог у них
// свой, и в магазине их нет — сложи их в consumables, readConsumables на
// клиенте стал бы ждать их в витрине и в гнёздах подготовки.
export type ClassItemColumns = {
  soulShards: number
  renounceSeals: number
}

/**
 * Запас предметов классов объектом по id каталога — форма ответов клиенту
 * (логин, профиль, ручки книг/страниц/продажи, финиш забега).
 *
 * ⚠️ Отдавать НУЖНО ОБА id: клиентский readClassItems (src/api.ts) требует все
 * id каталога и на неполном объекте возвращает null — та же дисциплина, что у
 * consumableStockOf и scrollStockOf.
 */
export function classItemStockOf(character: ClassItemColumns): Record<ClassItemId, number> {
  return {
    soul_shard: character.soulShards,
    renounce_seal: character.renounceSeals,
  }
}

// --- Класс героя: две колонки Character <-> HeroClassState ---
//
// 20.10.2026, каталог heroClasses.ts. classId — ветка или null, classTier —
// ступень 1..2 или 0. Схема пару не проверяет (classId — просто строка), поэтому
// читать её ТОЛЬКО здесь: испорченная пара — класс без ступени, ступень без
// класса, id не из каталога — возвращается 'malformed', а НЕ «класса нет».
// Свалить её в 'none' значило бы тихо отнять у игрока оплаченный класс и дать
// выбрать его второй раз за полную цену.
export type HeroClassColumns = {
  classId: string | null
  classTier: number
}

export function heroClassOf(character: HeroClassColumns): HeroClassState | 'malformed' {
  if (character.classId === null) return character.classTier === 0 ? 'none' : 'malformed'
  const id = parseHeroClassId(character.classId)
  const tier = parseHeroClassTier(character.classTier)
  return id === null || tier === null ? 'malformed' : { id, tier }
}

/**
 * Класс героя, записанный в забег на старте (поле heroClass в currentRun).
 * Поля нет — забег начат до 26.10.2026, класса у него нет: 'none'. Поле есть, но
 * негодное — 'malformed': его пишет только сам сервер, и испорченное значение —
 * повод сказать громко, а не тихо считать «без класса».
 */
export function readRunHeroClass(run: ActiveExploreRun): HeroClassState | 'malformed' {
  if (run.heroClass === undefined) return 'none'
  return parseHeroClassWire(run.heroClass) ?? 'malformed'
}

/**
 * «Исцеление», записанное в забег на старте (поле healSkill в currentRun).
 * null — не надето, ИЛИ поля нет вовсе (забег начат до 26.10.2026, вечер): у
 * такого забега запаса под исцеление нет, ровно как было до правки. Поле есть,
 * но негодное — 'malformed': его пишет только сам сервер, и порча — повод
 * сказать громко; запас тогда 0, против игрока, как у всех потолков.
 */
export function readRunHealSkill(run: ActiveExploreRun): RunHealSkill | null | 'malformed' {
  const raw: unknown = run.healSkill
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) return 'malformed'
  const { level, endurance } = raw as Record<string, unknown>
  if (typeof level !== 'number' || !Number.isInteger(level) || level < 1) return 'malformed'
  if (typeof endurance !== 'number' || !Number.isInteger(endurance) || endurance < 0) return 'malformed'
  return { level, endurance }
}

/**
 * Поле heroClass для ответов логина и профиля: null — класса нет, {id, tier} —
 * есть. Испорченная пара колонок — поля НЕТ вовсе (клиент покажет «класс
 * неизвестен») и громкий лог, а не null: null значил бы «класса нет», то есть
 * неправду о том, что оплачено. Вход при этом обязан открываться — отказывать
 * из-за класса нельзя (то же правило, что у всего ответа логина).
 */
export function heroClassField(
  state: HeroClassState | 'malformed',
  log: { error: (obj: object, msg: string) => void },
  userId: number,
): { heroClass?: { id: HeroClassId; tier: HeroClassTier } | null } {
  if (state === 'malformed') {
    log.error({ userId }, 'hero class: corrupt classId/classTier pair — field left out of the response')
    return {}
  }
  return { heroClass: heroClassToWire(state) }
}

// --- Уровни навыков: колонки Character <-> объект по id навыка ---
//
// Рядом с раскладкой расходников и по тем же причинам: имена колонок клиенту не
// нужны, а форма ответа — объект по id навыка, не позиционный массив (порядка у
// навыков нет, и массив молча съехал бы при добавлении шестого).
//
// Новый навык = новая колонка + миграция + строка здесь + ветка в
// skillLevelIncrement (routes/run.ts). Забыть последнюю нельзя — switch по
// SkillBookSkillId не скомпилируется.
export type SkillLevelColumns = {
  skillLevelFireball: number
  skillLevelIceball: number
  skillLevelSlash: number
  skillLevelHeal: number
  skillLevelDash: number
}

/**
 * Уровни навыков объектом по id навыка — форма ответов клиенту (логин, профиль,
 * все четыре ручки книг).
 *
 * ⚠️ Отдавать НУЖНО ВСЕ пять: клиентский readSkillLevels требует их все и на
 * неполном объекте возвращает null, то есть «уровни неизвестны» — прочерк вместо
 * числа в карточке навыка. Та же дисциплина, что у consumableStockOf выше.
 */
export function skillLevelsOf(character: SkillLevelColumns): Record<SkillBookSkillId, number> {
  return {
    fireball: character.skillLevelFireball,
    iceball: character.skillLevelIceball,
    slash: character.skillLevelSlash,
    heal: character.skillLevelHeal,
    dash: character.skillLevelDash,
  }
}

/**
 * Колонка уровня по id навыка. switch, а не сборка имени строкой: шестой
 * навык без ветки не скомпилируется, а склеенное имя промолчало бы и дало
 * несуществующую колонку в рантайме.
 */
function skillLevelColumnOf(skillId: SkillBookSkillId): keyof SkillLevelColumns {
  switch (skillId) {
    case 'fireball': return 'skillLevelFireball'
    case 'iceball': return 'skillLevelIceball'
    case 'slash': return 'skillLevelSlash'
    case 'heal': return 'skillLevelHeal'
    case 'dash': return 'skillLevelDash'
  }
}

/**
 * Кусок `data` с ПРИБАВКАМИ к уровням — только те навыки, что РЕАЛЬНО
 * выросли; ни один не вырос — пустой объект, то есть этих колонок в UPDATE
 * нет вовсе.
 *
 * ОДНА копия на оба пути закрытия забега (финиш и логин) — та же причина, что
 * у самой формулы роста в game.ts.
 *
 * ⚠️ Именно ПРИБАВКА, а не готовое значение: у уровня ЕСТЬ второй
 * писатель — книга (POST /character/upgrade-skill, +1), и запись вычисленным
 * числом затёрла бы его +1, случившийся между чтением персонажа и закрытием
 * забега. Тот же довод, что у золота в /character/exchange-trophies. Остаток
 * применений — наоборот, абсолютный (skillUsesToColumns): «было 20, стало 5,
 * потому что порог вычли» приращением не выражается, а второго писателя у
 * них нет: книга счётчик не трогает (решение дизайнера).
 *
 * Тип написан руками, а не взят из Prisma: этот файл по-прежнему не знает ни
 * о БД, ни о HTTP (см. шапку), а по форме он совместим с update-вводом Prisma.
 */
export type SkillLevelIncrements = Partial<Record<keyof SkillLevelColumns, { increment: number }>>

export function skillLevelGrowthColumns(
  before: Record<SkillBookSkillId, number>,
  after: Record<SkillBookSkillId, number>,
): SkillLevelIncrements {
  const data: SkillLevelIncrements = {}
  for (const skillId of SKILL_BOOK_SKILL_IDS) {
    const gain = after[skillId] - before[skillId]
    if (gain > 0) data[skillLevelColumnOf(skillId)] = { increment: gain }
  }
  return data
}

// --- Применения навыков: колонки Character <-> объект по id навыка ---
//
// Рядом с уровнями и теми же двумя функциями: счётчик едет клиенту
// (полоса «X / Y» в карточке навыка) и пишется на закрытии забега
// АБСОЛЮТНЫМ значением (остаток после вычета порогов), а НЕ increment'ом:
// остаток приращением не выражается. Безопасно именно здесь и только
// здесь: эти колонки не пишет БОЛЬШЕ НИКТО — ни магазин, ни ручки книг
// (книга растит УРОВЕНЬ и счётчик не трогает, см. upgrade-skill).
export type SkillUsesColumns = {
  skillUsesFireball: number
  skillUsesIceball: number
  skillUsesSlash: number
  skillUsesHeal: number
  skillUsesDash: number
}

/** Применения объектом по id навыка — форма ответов (логин, профиль, финиш). */
export function skillUsesOf(character: SkillUsesColumns): Record<SkillBookSkillId, number> {
  return {
    fireball: character.skillUsesFireball,
    iceball: character.skillUsesIceball,
    slash: character.skillUsesSlash,
    heal: character.skillUsesHeal,
    dash: character.skillUsesDash,
  }
}

/**
 * Обратное преобразование — готовый кусок `data` для Prisma (тот же приём, что
 * potionStockToColumns). Забыть строку нельзя ни тут, ни в skillUsesOf —
 * Record<SkillBookSkillId, number> без ключа не соберётся.
 */
export function skillUsesToColumns(uses: Record<SkillBookSkillId, number>): SkillUsesColumns {
  return {
    skillUsesFireball: uses.fireball,
    skillUsesIceball: uses.iceball,
    skillUsesSlash: uses.slash,
    skillUsesHeal: uses.heal,
    skillUsesDash: uses.dash,
  }
}

// --- Улучшения: колонки Character <-> счётчики каталога ---
//
// Рядом с раскладкой расходников и уровней навыков, по той же причине: имена
// колонок клиенту не нужны, а форма ответа — объект по виду улучшения.
export type UpgradeColumns = { attackUpgrades: number; armorUpgrades: number }

/** Счётчики улучшений в форме каталога — ответы клиенту и расчёт прибавок. */
export function upgradesOf(character: UpgradeColumns): UpgradeCounts {
  return { attack: character.attackUpgrades, armor: character.armorUpgrades }
}

export type PotionColumns = { potionT1: number; potionT2: number; potionT3: number; potionT4: number; potionT5: number }

export function potionStockOf(character: PotionColumns): number[] {
  return [character.potionT1, character.potionT2, character.potionT3, character.potionT4, character.potionT5]
}

export function potionStockToColumns(stock: number[]): PotionColumns {
  return {
    potionT1: stock[0],
    potionT2: stock[1],
    potionT3: stock[2],
    potionT4: stock[3],
    potionT5: stock[4],
  }
}
