import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { randomUUID } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { PrismaClient, Prisma } from '@prisma/client'
import { regenerateEnergy, refundEnergy, applyStatGrowth, applySkillUsesGrowth, calculateLevel, itemSellPrice, TROPHY_GOLD_RATE, type SkillLevelUp } from '../game.js'
import { rollRunEvents, clientRunEvents, KNOWN_MAP_FILES, pickRunMapFile, SMUGGLER_MULT, SMUGGLER_STEAL_FRAC, SMUGGLER_STEAL_CHANCE, type RunEvent } from '../runEvents.js'
import { POTION_TIER_COUNT, MAX_SIPS_PER_RUN, MAX_POTIONS_PER_PURCHASE, potionTierByNumber, parsePurchaseCount, emptyPotionStock } from '../potions.js'
import { BAG_CAPACITY, MAX_CONSUMABLES_PER_PURCHASE, RUN_CONSUMABLE_SLOTS, MAX_EQUIPPED_SKILLS, consumableById, runSlotConsumableById, consumableAttackBonus, consumableSkillBook, consumableSellPrice, parseConsumableCount, parseSkillBookId, parseSkillBookSkillId, type Consumable, type ConsumableId, type SkillBookId, type SkillBookSkillId } from '../consumables.js'
import { UPGRADES, upgradeBonus, upgradePrice, parseUpgradeKind, type UpgradeKind } from '../upgrades.js'
import { SCROLLS_PER_BOOK, SCROLL_SELL_PRICE, parseScrollId, scrollById, type ScrollId } from '../scrolls.js'
import { ITEM_DROP_FLOOR_TIER, rollEventDrop, rollEventExtraDrop, rollRunDrops, parseEventDrop, type DropIntent, type EventDrop } from '../runDrops.js'
import { CLASS_ITEMS, classItemById, parseClassItemId, type ClassItemId } from '../classItems.js'
// Форма currentRun, её читатели и потолки на выпитое — в общем модуле: тот же
// JSON читает и /auth/login, закрывая брошенный забег (см. runState.ts, шапка).
import {
  type ActiveExploreRun,
  readRunPotionsDrunk,
  readRunConfirmed,
  parseRunProgress,
  coerceRunProgress,
  clampRunProgress,
  runPotionStock,
  runSipsAllowed,
  clampPotionsSpent,
  subtractPotionStock,
  potionStockOf,
  consumableStockOf,
  scrollStockOf,
  classItemStockOf,
  type ConsumableColumns,
  type ClassItemColumns,
  skillLevelsOf,
  skillLevelGrowthColumns,
  skillUsesOf,
  skillUsesToColumns,
  upgradesOf,
  readConsumablesUsed,
  readSmugglerDeal,
  type SmugglerDeal,
  readRunProgress,
  emptyRunProgress,
  parseRequestId,
  readRunId,
  readRunStartedAt,
  readRunSipIds,
  readyWindowOpen,
  judgeUnshownCancel,
} from '../runState.js'

const prisma = new PrismaClient()
const RUN_COST = 3 // DEV: снижено с 10 для тестов (вернуть 10 перед релизом)

// --- Ключи идемпотентности, id забега, блокировка строки персонажа (15.10.2026) ---

/**
 * Отказ по существу, брошенный ИЗНУТРИ транзакции. Бросок откатывает её целиком
 * — вместе со строкой ключа идемпотентности, — и обработчик превращает его в
 * обычный ответ. Так отказ («не хватило золота») ключ не тратит: повтор с тем же
 * ключом после пополнения золота применится, а не ответит чужим «уже сделано».
 */
class RouteRejection extends Error {
  constructor(readonly status: number, readonly body: Record<string, unknown>) {
    super(`route rejection ${status}`)
  }
}

// Ключ сохранённого итога финиша. Двоеточия в id запроса быть не может
// (parseRequestId), поэтому ключ покупки с ним не совпадёт никогда.
const FINISH_ENDPOINT = 'finish-explore'
function finishKey(runId: string): string {
  return `finish:${runId}`
}

/** Ключи старше этого удаляются при записи нового (клиент держит ключ минуты). */
const IDEMPOTENCY_KEY_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Необязательный id запроса из тела. undefined — поля нет (клиент старее
 * 15.10.2026, ключа нет — поведение прежнее); 'invalid' — поле есть, но не id:
 * это сломанный клиент, отказ 400, а не тихое «без ключа» — иначе повтор,
 * от которого ключ и заведён, прошёл бы молча.
 */
function readOptionalRequestId(raw: unknown): string | null | 'invalid' {
  if (raw === undefined) return null
  return parseRequestId(raw) ?? 'invalid'
}

type AppliedOnce<T> = { replayed: false; value: T } | { replayed: true; response: Prisma.JsonValue | null }

/**
 * Применяет действие РОВНО ОДИН РАЗ на ключ.
 *
 * Строка ключа пишется ПЕРВОЙ в той же транзакции, что и действие. Второй запрос
 * с тем же ключом упирается в уникальный индекс (characterId, key): пока первая
 * транзакция открыта, вставка ждёт её, а после коммита падает с P2002 — и вся
 * вторая транзакция откатывается, не списав ничего. Ответ ему — «уже сделано»
 * (replayed), вызывающий отдаёт текущее состояние из БД.
 *
 * Ключа нет (старый клиент) — действие идёт в своей транзакции, без строки ключа.
 *
 * Бросает RouteRejection из действия как есть и 409 'Idempotency key reused',
 * если тем же ключом уже воспользовалась ДРУГАЯ ручка (ошибка клиента: ответить
 * ей чужим «уже сделано» значило бы соврать).
 */
async function applyOnce<T>(
  characterId: number,
  key: string | null,
  endpoint: string,
  log: FastifyRequest['log'],
  action: (db: Prisma.TransactionClient) => Promise<T>,
): Promise<AppliedOnce<T>> {
  // Без ключа — тоже транзакция: действие может блокировать строку персонажа
  // (lockCharacterRow), а блокировка живёт только внутри транзакции.
  if (key === null) return { replayed: false, value: await prisma.$transaction((tx) => action(tx)) }
  let value: T
  try {
    value = await prisma.$transaction(async (tx) => {
      await tx.idempotencyKey.create({ data: { characterId, key, endpoint } })
      return action(tx)
    })
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e
    const stored = await prisma.idempotencyKey.findUnique({ where: { characterId_key: { characterId, key } } })
    if (!stored) throw e // P2002 без строки — не наш случай, пусть падает громко
    if (stored.endpoint !== endpoint) {
      log.warn({ characterId, key, endpoint, storedEndpoint: stored.endpoint }, 'idempotency key reused on another endpoint')
      throw new RouteRejection(409, { error: 'Idempotency key reused' })
    }
    log.info({ characterId, key, endpoint }, 'idempotent replay: request already applied, not applying again')
    return { replayed: true, response: stored.response }
  }
  await pruneIdempotencyKeys(characterId, log)
  return { replayed: false, value }
}

// Уборка старых ключей персонажа. Лучшее усилие: сбой здесь не отменяет уже
// применённое действие, поэтому только громкий лог.
async function pruneIdempotencyKeys(characterId: number, log: FastifyRequest['log']): Promise<void> {
  try {
    await prisma.idempotencyKey.deleteMany({
      where: { characterId, createdAt: { lt: new Date(Date.now() - IDEMPOTENCY_KEY_TTL_MS) } },
    })
  } catch (e) {
    log.error({ characterId, err: e }, 'idempotency keys: prune failed')
  }
}

/**
 * Сверка id забега, названного клиентом, с id открытого забега.
 *   'ok'       — совпал, или клиент id не прислал (клиент старее 15.10.2026);
 *   'invalid'  — прислал не id: сломанный клиент, отказ 400;
 *   'mismatch' — id от ДРУГОГО забега: запрос запоздал и пришёл, когда игрок
 *                уже начал новый забег. Применить его к новому забегу значило бы
 *                закрыть, напоить или подтвердить не тот забег.
 * У забега без id (начат старым сервером) любой присланный id — чужой: старый
 * сервер id не выдавал, и клиент получить его мог только от другого забега.
 */
function checkRunId(run: ActiveExploreRun, raw: unknown): 'ok' | 'invalid' | 'mismatch' {
  if (raw === undefined) return 'ok'
  const claimed = parseRequestId(raw)
  if (claimed === null) return 'invalid'
  const actual = readRunId(run)
  return actual !== null && actual === claimed ? 'ok' : 'mismatch'
}

// Ответ на непрошедшую сверку id забега — один текст на все ручки забега.
function runIdRejection(verdict: 'invalid' | 'mismatch'): { status: number; body: { error: string } } {
  return verdict === 'invalid'
    ? { status: 400, body: { error: 'Invalid runId' } }
    : { status: 400, body: { error: 'Run mismatch' } }
}

/**
 * Блокирует строку персонажа до конца транзакции (SELECT … FOR UPDATE).
 *
 * Нужна там, где проверка не выражается фильтром условной записи — занятость
 * сумки это COUNT по другой таблице (InventoryItem) плюс склад книг. Без
 * блокировки два запроса, посчитавшие «29 / 30» одновременно, оба положат
 * вещь в последнюю ячейку. С ней второй ждёт коммита первого и считает уже
 * «30 / 30». Работает только между теми, кто блокирует: сейчас это сборка
 * книги и финиш забега (добыча).
 */
async function lockCharacterRow(tx: Prisma.TransactionClient, userId: number): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Character" WHERE "userId" = ${userId} FOR UPDATE`
}

/**
 * Сколько ячеек сумки занято — ровно та же сумма, что считает клиент (bagUsed в
 * App.tsx): ненадетые предметы плюс по ячейке на КАЖДЫЙ вид расходника, которого
 * не ноль, плюс по ячейке на каждый предмет класса с takesCell (сейчас только
 * Печать отречения), которого не ноль. Зелья, страницы и Осколки души ячеек не
 * тратят (docs/items.md, «ПРАВИЛО ВМЕСТИМОСТИ»).
 *
 * Одна функция на всех, кто кладёт вещь в сумку (15.10.2026): добыча на финише,
 * сборка книги, покупка расходника, снятие предмета. Звать ВНУТРИ транзакции
 * после lockCharacterRow и со складом, прочитанным под той же блокировкой, —
 * иначе два запроса посчитают одну и ту же свободную ячейку.
 *
 * `classStock` обязательным параметром, а не «по умолчанию пусто»: забытая
 * Печать у одного из четырёх вызывающих дала бы 31 / 30 молча.
 */
async function bagCellsUsed(
  db: Prisma.TransactionClient,
  characterId: number,
  stock: Record<ConsumableId, number>,
  classStock: Record<ClassItemId, number>,
): Promise<number> {
  const equipmentCells = await db.inventoryItem.count({ where: { characterId, equipped: false } })
  const classCells = CLASS_ITEMS.filter((spec) => spec.takesCell && classStock[spec.id] > 0).length
  return equipmentCells + Object.values(stock).filter((n) => n > 0).length + classCells
}

// Прибавка к складу ОДНОГО предмета класса и фильтр/списание для продажи —
// готовыми куска́ми для условных записей (дроп на финише, продажа). Switch по
// ClassItemId — тот же приём, что у страниц и книг: третий предмет без ветки
// здесь не скомпилируется.
function classItemStockIncrement(id: ClassItemId, count: number): Prisma.CharacterUpdateManyMutationInput {
  switch (id) {
    case 'soul_shard': return { soulShards: { increment: count } }
    case 'renounce_seal': return { renounceSeals: { increment: count } }
  }
}

function classItemStockFilter(id: ClassItemId): Prisma.CharacterWhereInput {
  switch (id) {
    case 'soul_shard': return { soulShards: { gte: 1 } }
    case 'renounce_seal': return { renounceSeals: { gte: 1 } }
  }
}

function classItemStockDecrement(id: ClassItemId): Prisma.CharacterUpdateManyMutationInput {
  switch (id) {
    case 'soul_shard': return { soulShards: { decrement: 1 } }
    case 'renounce_seal': return { renounceSeals: { decrement: 1 } }
  }
}

// Изменение склада зелий ПО ТИРАМ (индекс = тир-1) — кусками для условной
// записи: increment на разницу и фильтр «не уйти в минус» для тиров, где
// разница отрицательная.
//
// Разница, а не абсолютное значение (potionStockToColumns), — в этом и правка
// 15.10.2026: абсолютное значение пишется от СНИМКА, прочитанного в начале
// обработчика, и затирает всё, что легло между чтением и записью. Так покупка
// зелья со второго устройства в окне финиша пропадала: финиш писал склад
// «до покупки минус выпитое».
// Фильтр gte: в схеме нет ограничения «не меньше нуля», а снимок мог устареть и
// в сторону уменьшения. Не сошлось — 0 строк, вызывающий отвечает 409, и
// клиент повторяет с новым чтением.
const POTION_COLUMNS = ['potionT1', 'potionT2', 'potionT3', 'potionT4', 'potionT5'] as const
function potionStockDelta(delta: number[]): {
  where: Prisma.CharacterWhereInput
  data: Prisma.CharacterUpdateManyMutationInput
} {
  if (delta.length !== POTION_TIER_COUNT || POTION_COLUMNS.length !== POTION_TIER_COUNT) {
    throw new Error(`potionStockDelta: expected ${POTION_TIER_COUNT} tiers, got ${delta.length}`)
  }
  const where: Prisma.CharacterWhereInput = {}
  const data: Prisma.CharacterUpdateManyMutationInput = {}
  POTION_COLUMNS.forEach((column, i) => {
    const d = delta[i]
    if (!Number.isInteger(d)) throw new Error(`potionStockDelta: non-integer delta for ${column}: ${d}`)
    if (d === 0) return
    data[column] = { increment: d }
    if (d < 0) where[column] = { gte: -d }
  })
  return { where, data }
}

// Фильтр «запаса каждого взятого хватает» и списание — готовыми куска́ми для
// условной записи старта забега. Оба собираются ОДНИМ проходом по списку, чтобы
// фильтр и декремент не могли разойтись по составу.
//
// switch по id, как и в consumableStockIncrement ниже, и по той же причине:
// добавление нового расходника в ConsumableId развалит сборку, пока сюда не
// допишут ветку, — молча забыть колонку невозможно.
function consumableRunSpend(specs: Consumable[]): {
  where: Prisma.CharacterWhereInput
  data: Prisma.CharacterUpdateManyMutationInput
} {
  const where: Prisma.CharacterWhereInput = {}
  const data: Prisma.CharacterUpdateManyMutationInput = {}
  for (const spec of specs) {
    switch (spec.id) {
      case 'whetstone':
        // gte: 1, а не gte: count — повторы в гнёздах запрещены, каждый взятый
        // расходник ровно один (см. проверку дубликатов в старте).
        where.whetstones = { gte: 1 }
        break
      case 'charm_death':
        where.charms = { gte: 1 }
        break
    }
    // Списывает старт ТОЛЬКО spendAt: 'start'. У 'effect' (оберег) запас
    // проверяется фильтром выше — взять оберег без оберега нельзя, — но
    // decrement здесь НЕ ставится: он спишется на финише, и только если
    // сработал. Иначе игрок платил бы за спасение, которого не было.
    if (spec.spendAt !== 'start') continue
    switch (spec.id) {
      case 'whetstone':
        data.whetstones = { decrement: 1 }
        break
      case 'charm_death':
        data.charms = { decrement: 1 }
        break
    }
  }
  return { where, data }
}

// Прибавка к складу ОДНОГО расходника, готовым куском data для update.
//
// switch по id, а НЕ вычисляемый ключ `{ [spec.column]: ... }`: вычисляемый
// пришлось бы приводить кастом к Prisma-типу, и опечатка в имени колонки прошла
// бы мимо проверки типов, проявившись только в рантайме. Здесь же добавление
// нового расходника в ConsumableId РАЗВАЛИТ СБОРКУ, пока сюда не допишут ветку —
// именно то, что нужно: молча забыть колонку невозможно.
function consumableStockIncrement(id: ConsumableId, count: number): Prisma.CharacterUpdateManyMutationInput {
  switch (id) {
    case 'whetstone':
      return { whetstones: { increment: count } }
    case 'charm_death':
      return { charms: { increment: count } }
    // Книги: только increment при покупке. Списания нет ни у одной ветки —
    // применение книги к скиллу не реализовано (spendAt: 'apply'), а в забег
    // книга не едет вовсе (runSlot: false), поэтому в consumableRunSpend выше её
    // не бывает: старт принимает только runSlotConsumableById.
    case 'book_fire':
      return { bookFire: { increment: count } }
    case 'book_ice':
      return { bookIce: { increment: count } }
    case 'book_bleed':
      return { bookBleed: { increment: count } }
    case 'book_heal':
      return { bookHeal: { increment: count } }
    case 'book_dash':
      return { bookDash: { increment: count } }
  }
}

// Фильтр «книга на складе есть» и её списание — готовыми куска́ми для условной
// записи трёх ручек (надеть / улучшить / продать). Обе функции switch'ат по
// УЗКОМУ типу SkillBookId, а не по всему ConsumableId: иначе пришлось бы писать
// заведомо недостижимые ветки для камня и оберега, а шестая книга добавилась бы
// молча, без колонки. Здесь же она развалит сборку.
function bookStockFilter(id: SkillBookId): Prisma.CharacterWhereInput {
  switch (id) {
    case 'book_fire': return { bookFire: { gte: 1 } }
    case 'book_ice': return { bookIce: { gte: 1 } }
    case 'book_bleed': return { bookBleed: { gte: 1 } }
    case 'book_heal': return { bookHeal: { gte: 1 } }
    case 'book_dash': return { bookDash: { gte: 1 } }
  }
}

function bookStockDecrement(id: SkillBookId): Prisma.CharacterUpdateManyMutationInput {
  switch (id) {
    case 'book_fire': return { bookFire: { decrement: 1 } }
    case 'book_ice': return { bookIce: { decrement: 1 } }
    case 'book_bleed': return { bookBleed: { decrement: 1 } }
    case 'book_heal': return { bookHeal: { decrement: 1 } }
    case 'book_dash': return { bookDash: { decrement: 1 } }
  }
}

// Фильтр «страниц на складе хватает», их списание и их начисление — готовыми
// куска́ми для условных записей (собрать книгу / продать страницу / дроп на
// финише). Switch по ScrollId по той же причине, что у книг выше: вычисляемый
// ключ `{ [column]: … }` пришлось бы приводить кастом к Prisma-типу, и опечатка
// в имени колонки прошла бы мимо проверки типов, а шестая страница без ветки
// здесь не скомпилируется вовсе.
//
// `min` параметром, а не константой: у сборки книги порог SCROLLS_PER_BOOK, у
// продажи — 1, и два почти одинаковых switch'а разъехались бы при добавлении
// страницы.
function scrollStockFilter(id: ScrollId, min: number): Prisma.CharacterWhereInput {
  switch (id) {
    case 'scroll_fire': return { scrollFire: { gte: min } }
    case 'scroll_ice': return { scrollIce: { gte: min } }
    case 'scroll_bleed': return { scrollBleed: { gte: min } }
    case 'scroll_heal': return { scrollHeal: { gte: min } }
    case 'scroll_dash': return { scrollDash: { gte: min } }
  }
}

function scrollStockDecrement(id: ScrollId, count: number): Prisma.CharacterUpdateManyMutationInput {
  switch (id) {
    case 'scroll_fire': return { scrollFire: { decrement: count } }
    case 'scroll_ice': return { scrollIce: { decrement: count } }
    case 'scroll_bleed': return { scrollBleed: { decrement: count } }
    case 'scroll_heal': return { scrollHeal: { decrement: count } }
    case 'scroll_dash': return { scrollDash: { decrement: count } }
  }
}

function scrollStockIncrement(id: ScrollId, count: number): Prisma.CharacterUpdateManyMutationInput {
  switch (id) {
    case 'scroll_fire': return { scrollFire: { increment: count } }
    case 'scroll_ice': return { scrollIce: { increment: count } }
    case 'scroll_bleed': return { scrollBleed: { increment: count } }
    case 'scroll_heal': return { scrollHeal: { increment: count } }
    case 'scroll_dash': return { scrollDash: { increment: count } }
  }
}

// Фильтр «набор навыков не изменился с момента чтения» — для условной записи
// ручек «надеть» и «забыть».
//
// ⚠️ Пустой набор проверяется isEmpty, а НЕ equals: [] — это документированный
// способ Prisma сравнить скалярный список с пустым, и именно этот случай самый
// частый (первая книга у героя без навыков). Полагаться здесь на равенство с
// пустым массивом нельзя: промах фильтра означал бы 409 на КАЖДОЙ первой книге,
// то есть «надеть навык невозможно» у нового игрока.
function equippedSkillsUnchanged(prev: string[]): Prisma.StringNullableListFilter<'Character'> {
  return prev.length === 0 ? { isEmpty: true } : { equals: prev }
}

// +1 к уровню навыка за книгу, готовым куском data. Тот же приём и та же
// причина, что выше: switch по SkillBookSkillId, шестой навык без ветки не
// скомпилируется.
//
// ⚠️ ВТОРОЙ путь роста тех же колонок — применения за забег
// (skillLevelGrowthColumns, runState.ts). Два писателя и есть причина, по которой
// оба растят уровень increment'ом, а не вычисленным числом.
function skillLevelIncrement(skillId: SkillBookSkillId): Prisma.CharacterUpdateManyMutationInput {
  switch (skillId) {
    case 'fireball': return { skillLevelFireball: { increment: 1 } }
    case 'iceball': return { skillLevelIceball: { increment: 1 } }
    case 'slash': return { skillLevelSlash: { increment: 1 } }
    case 'heal': return { skillLevelHeal: { increment: 1 } }
    case 'dash': return { skillLevelDash: { increment: 1 } }
  }
}

/**
 * Ответ ВСЕХ ШЕСТИ ручек книг и страниц: состояние, которое они могут изменить,
 * целиком (надеть / забыть / улучшить / продать книгу, собрать книгу / продать
 * страницу).
 *
 * Один ответ на шесть ручек намеренно. Каждая меняет своё подмножество (надеть —
 * набор и склад, продать — склад и золото, улучшить — склад и уровень), но клиент
 * рисует эти четыре поля в трёх местах сразу («Персонаж», сумка, шапка с золотом),
 * и отдавать каждой ручке свой огрызок значило бы разложить по клиенту четыре
 * разных мержа, три из которых оставляли бы часть экрана устаревшей.
 *
 * Всё ПЕРЕЧИТАНО из БД после записи, а не вычислено из прочитанного до неё:
 * decrement/increment считала база.
 */
async function sendSkillState(request: FastifyRequest, reply: FastifyReply, userId: number) {
  const updated = await prisma.character.findUnique({ where: { userId } })
  if (!updated) {
    // Персонаж существовал строкой выше, исчезнуть мог только удалением в ту же
    // секунду. Запись УЖЕ применена, поэтому подставлять правдоподобные числа
    // нельзя: соврать о складе и золоте хуже, чем громко отказать.
    request.log.error({ userId }, 'skill book action applied but character could not be read back')
    return reply.status(500).send({ error: 'Action applied but state could not be read' })
  }
  return reply.send({
    gold: updated.gold,
    consumables: consumableStockOf(updated),
    // Склад страниц — в том же ответе, хотя четыре ручки книг его не меняют:
    // ручки СТРАНИЦ (собрать книгу / продать страницу) отвечают этой же
    // функцией, и отдавать им свой огрызок значило бы развести по клиенту два
    // разных мержа для одного и того же экрана сумки.
    scrolls: scrollStockOf(updated),
    // Предметы классов (18.10.2026) — в том же ответе по той же причине, что
    // страницы рядом: ручка их продажи отвечает этой же функцией, а мерж у
    // клиента один на все ручки сумки.
    classItems: classItemStockOf(updated),
    equippedSkills: updated.equippedSkills,
    skillLevels: skillLevelsOf(updated),
  })
}

// --- Дроп за забег: из брошенных костей (runDrops.ts) в записи БД и в ответ ---

/**
 * Одна единица добычи в ответе финиша.
 *
 * Размеченный union, а не плоское `{ icon, nameRu }`: ИМЯ и ИКОНКУ клиент берёт
 * из СВОИХ каталогов (scrolls.ts, potions.ts, consumables.ts) по id, а не из
 * ответа сервера. Присылать готовый путь к картинке нельзя — он зависит от
 * BASE_URL (GitHub Pages живёт в подкаталоге), которого на сервере нет;
 * присылать готовое имя можно было бы, но тогда оно стало бы ЧЕТВЁРТЫМ
 * экземпляром названий, живущих в байт-в-байт каталогах.
 *
 * Снаряжение — исключение и единственное поле с текстом: его названия лежат
 * ТОЛЬКО в БД (таблица Item), клиентского каталога предметов нет вовсе
 * (удалён 20.09.2026). Слот и тир едут рядом, потому что иконку предмета клиент
 * собирает из них (itemIconSrc), а не из Item.iconPath — тот указывает в
 * неполный набор и клиентом не читается (см. комментарий в App.tsx).
 *
 * ⚠️ КОПИЯ этого типа живёт в src/api.ts — менять парами (сверяющего скрипта у
 * RunResultSummary нет, см. CLAUDE.md, таблица копий клиент/сервер).
 */
export type RunDrop =
  | { category: 'equipment'; nameRu: string; slot: string; tier: number }
  | { category: 'scroll'; id: string }
  | { category: 'potion'; tier: number }
  | { category: 'book'; id: string }
  // Предметы классов (18.10.2026): имя и иконку клиент берёт из своего каталога
  // classItems.ts по категории — у каждой категории один вид.
  | { category: 'soul_shard' }
  | { category: 'renounce_seal' }

/**
 * Выбирает КОНКРЕТНУЮ вещь под брошенный интент.
 *
 * Зовётся на СТАРТЕ забега (чтобы всплывашка в бою показала ту же иконку, что
 * потом ляжет в сумку) и запасным путём на финише — для забегов, начатых старым
 * сервером, у которых добычи в событиях нет.
 *
 * null — вещь выбрать не удалось; вызывающий обязан считать это «ничего не
 * выпало». Такое возможно только при незасеянном каталоге предметов, и об этом
 * пишется error: молча терять пятую часть всей добычи нельзя.
 */
async function resolveDropIntent(
  intent: DropIntent,
  characterLevel: number,
  log: FastifyRequest['log'],
): Promise<EventDrop | null> {
  switch (intent.category) {
    case 'equipment': {
      // Какие тиры «открыты», решает САМА БД по levelRequired — второго
      // экземпляра правила «тир × 5» на сервере нет. ITEM_DROP_FLOOR_TIER
      // добавлен через OR, а не через max(): до 5 уровня открытых тиров нет
      // вовсе, и без пола каждый пятый бросок уходил бы в пустоту (см.
      // комментарий к константе в runDrops.ts).
      const pool = await prisma.item.findMany({
        where: {
          slot: intent.slot,
          OR: [{ levelRequired: { lte: characterLevel } }, { tier: ITEM_DROP_FLOOR_TIER }],
        },
        select: { id: true, nameRu: true, slot: true, tier: true },
      })
      if (pool.length === 0) {
        log.error({ slot: intent.slot, characterLevel }, 'run drops: no catalog item for slot')
        return null
      }
      const item = pool[Math.floor(Math.random() * pool.length)]
      return { category: 'equipment', itemId: item.id, nameRu: item.nameRu, slot: item.slot, tier: item.tier }
    }
    case 'scroll':
      return { category: 'scroll', id: intent.scrollId }
    case 'book':
      return { category: 'book', id: intent.bookId }
    case 'potion':
      return { category: 'potion', tier: intent.tier }
    case 'soul_shard':
      return { category: 'soul_shard' }
    case 'renounce_seal':
      return { category: 'renounce_seal' }
  }
}

/**
 * Разыгрывает добычу КАЖДОГО события и вешает её на сами события — это и есть
 * то, что /run/start-explore кладёт в currentRun и отдаёт клиенту.
 *
 * Поле `drop` ставится ВСЕГДА, в том числе `null` («бросок был, не выпало»):
 * по наличию ключа финиш отличает такой забег от начатого старым сервером, где
 * добычи нет вовсе и её надо бросать запасным путём.
 *
 * `extraDrop` (18.10.2026) — вторая добыча, отдельным броском: Печать отречения
 * с босса. Тоже ставится всегда, null у всех остальных событий.
 */
async function attachEventDrops(
  events: RunEvent[],
  characterLevel: number,
  luck: number,
  log: FastifyRequest['log'],
): Promise<RunEvent[]> {
  const out: RunEvent[] = []
  for (const event of events) {
    const intent = rollEventDrop(event.kind, characterLevel, luck)
    const drop = intent === null ? null : await resolveDropIntent(intent, characterLevel, log)
    const extraIntent = rollEventExtraDrop(event.kind, characterLevel, luck)
    const extraDrop = extraIntent === null ? null : await resolveDropIntent(extraIntent, characterLevel, log)
    out.push({ ...event, drop, extraDrop })
  }
  return out
}

/**
 * Добыча закрытых событий, ПРОЧИТАННАЯ из currentRun.
 *
 * null — забег начат СТАРЫМ сервером (ни у одного события нет ключа `drop`), и
 * вызывающий обязан бросить кости запасным путём. Пустой массив — забег новый,
 * но не выпало ничего: это РАЗНЫЕ вещи, и свести их значило бы либо бросать
 * второй раз поверх уже показанного игроку, либо молча лишать добычи забеги
 * старого сервера.
 *
 * Испорченная запись (колонка Json? схемой не проверяется) — НЕ повод завалить
 * весь финиш, в отличие от smugglerDeal и consumablesUsed рядом. Те решают,
 * сколько трофеев начислить и списывать ли оберег, и ошибиться там дороже, чем
 * отказать. Здесь же цена — одна строка добычи: завалив финиш, мы отняли бы у
 * игрока ещё и трофеи со статами за весь забег. Поэтому громкий error, и эта
 * запись пропускается.
 */
function storedEventDrops(run: ActiveExploreRun, closed: number[], log: FastifyRequest['log']): EventDrop[] | null {
  const anyStored = run.events.some((ev) => ev !== null && typeof ev === 'object' && 'drop' in ev)
  if (!anyStored) return null
  const out: EventDrop[] = []
  for (const index of closed) {
    const event = run.events[index]
    if (!event) continue
    const parsed = parseEventDrop(event.drop ?? null)
    if (parsed.kind === 'malformed') {
      log.error({ index, drop: event.drop }, 'finish-explore: currentRun.events[].drop is malformed')
    } else if (parsed.kind === 'drop') {
      out.push(parsed.drop)
    }
    // Вторая добыча (Печать с босса, 18.10.2026). Поля нет — забег начат
    // сервером старше 18.10.2026, второй добычи у него не было, и запасного
    // броска за неё не нужно (см. RunEvent.extraDrop). Испорчено — тем же
    // громким error и пропуском, что у drop выше.
    if (event.extraDrop !== undefined) {
      const extra = parseEventDrop(event.extraDrop)
      if (extra.kind === 'malformed') {
        log.error({ index, extraDrop: event.extraDrop }, 'finish-explore: currentRun.events[].extraDrop is malformed')
      } else if (extra.kind === 'drop') {
        out.push(extra.drop)
      }
    }
  }
  return out
}

/** Добыча, разложенная по тому, как её применять и что показать игроку. */
type AppliedDrops = {
  /** Что игрок получил. */
  gained: RunDrop[]
  /** Что выпало, но не влезло в сумку — показывается отдельной строкой. */
  lost: RunDrop[]
  /** Строки Item, которые надо создать в инвентаре (снаряжение). */
  itemIds: string[]
  /** Прибавки к колонкам страниц и книг — готовым куском data условной записи. */
  stockData: Prisma.CharacterUpdateManyMutationInput
  /** Прибавка зелий ПО ТИРАМ (индекс = тир-1) — складывается со складом ДО записи. */
  potionGain: number[]
}

/**
 * Применяет уже выбранную добычу: считает вместимость и собирает куски записи.
 *
 * ПРАВИЛО ВМЕСТИМОСТИ (docs/items.md). Ячейку тратят: снаряжение — ВСЕГДА (в БД
 * каждый предмет отдельная строка, стакинга нет), книга — ТОЛЬКО если её вида
 * ещё нет в сумке (одна ячейка на вид с бейджем «×N»). Страницы и зелья —
 * никогда. Не влезло — пропало, это решение дизайнера, и игрок узнаёт об этом
 * строкой «Сумка полна, пропало: …», а не тишиной.
 *
 * ⚠️ Вместимость считается ЗДЕСЬ, на финише, а не на старте вместе с броском —
 * и это осознанно: за забег сумка меняется (выпало снаряжение, докупили книгу),
 * и решать судьбу добычи по вместимости получасовой давности было бы неверно.
 * Поэтому всплывашка в бою показывает предмет ВСЕГДА, а «не влезло» игрок видит
 * только на экране итогов.
 *
 * Зовётся ВНУТРИ транзакции финиша, после lockCharacterRow (15.10.2026):
 * занятость сумки — COUNT по другой таблице, фильтром записи она не
 * выражается, и до блокировки сборка книги со второго устройства могла занять
 * ту же последнюю ячейку. `db` — клиент этой транзакции.
 * Блокируют и считают ячейки этой же функцией все, кто кладёт вещь в сумку:
 * сборка книги, покупка расходника, снятие предмета (bagCellsUsed).
 */
async function applyDrops(
  db: Prisma.TransactionClient,
  drops: EventDrop[],
  character: { id: number } & ConsumableColumns & ClassItemColumns,
  log: FastifyRequest['log'],
): Promise<AppliedDrops> {
  const gained: RunDrop[] = []
  const lost: RunDrop[] = []
  const itemIds: string[] = []
  const potionGain = new Array(POTION_TIER_COUNT).fill(0) as number[]
  const scrollGain = {} as Record<ScrollId, number>
  const bookGain = {} as Record<SkillBookId, number>
  const classGain = {} as Record<ClassItemId, number>
  // Ничего не выпало — самый частый исход, и он не должен стоить лишнего
  // запроса к БД: подсчёт занятых ячеек ниже нужен только тогда, когда есть что
  // в них класть.
  if (drops.length === 0) {
    return { gained, lost, itemIds, stockData: {}, potionGain }
  }

  // Занятые ячейки ДО добычи — ровно та же сумма, что считает клиент (bagUsed в
  // App.tsx): ненадетые предметы плюс по ячейке на КАЖДЫЙ вид расходника,
  // которого не ноль. Расхождение здесь означало бы, что игрок видит «28 / 30»,
  // а сервер считает сумку полной.
  const bookStock = { ...consumableStockOf(character) }
  // Изменяемая копия по той же причине, что bookStock: две Печати за один забег
  // (два босса не бывает, но правило не должно на это опираться) займут одну
  // ячейку.
  const classStock = { ...classItemStockOf(character) }
  let cellsUsed = await bagCellsUsed(db, character.id, bookStock, classStock)

  for (const drop of drops) {
    switch (drop.category) {
      case 'equipment': {
        const view: RunDrop = { category: 'equipment', nameRu: drop.nameRu, slot: drop.slot, tier: drop.tier }
        if (cellsUsed >= BAG_CAPACITY) {
          lost.push(view)
          continue
        }
        cellsUsed++
        itemIds.push(drop.itemId)
        gained.push(view)
        break
      }
      case 'book': {
        const view: RunDrop = { category: 'book', id: drop.id }
        // Ячейка нужна только под ПЕРВУЮ книгу этого вида: вторая ложится
        // бейджем «×2» в ту же ячейку. bookStock — изменяемая копия, поэтому
        // две книги одного вида за один забег тоже занимают одну ячейку.
        const needsCell = bookStock[drop.id] === 0
        if (needsCell && cellsUsed >= BAG_CAPACITY) {
          lost.push(view)
          continue
        }
        if (needsCell) cellsUsed++
        bookStock[drop.id]++
        bookGain[drop.id] = (bookGain[drop.id] ?? 0) + 1
        gained.push(view)
        break
      }
      case 'scroll': {
        // Страницы ячейку не тратят — проверять вместимость нечего.
        scrollGain[drop.id] = (scrollGain[drop.id] ?? 0) + 1
        gained.push({ category: 'scroll', id: drop.id })
        break
      }
      case 'potion': {
        potionGain[drop.tier - 1] = (potionGain[drop.tier - 1] ?? 0) + 1
        gained.push({ category: 'potion', tier: drop.tier })
        break
      }
      case 'soul_shard':
      case 'renounce_seal': {
        // Предметы классов (18.10.2026). Занимает ли ячейку — решает каталог
        // (takesCell): Осколок — нет, как страницы; Печать — да, но, как книга,
        // только ПЕРВАЯ штука: вторая ложится бейджем «×2» в ту же ячейку.
        const id: ClassItemId = drop.category
        const spec = classItemById(id)
        if (spec === null) {
          // Недостижимо, пока категории добычи и id каталога совпадают
          // (switch выше не скомпилировался бы без ветки). Не начислять то,
          // чего нет в каталоге, — громко.
          log.error({ id }, 'finish-explore: class item drop is not in the catalog')
          continue
        }
        const view: RunDrop = { category: drop.category }
        const needsCell = spec.takesCell && classStock[id] === 0
        if (needsCell && cellsUsed >= BAG_CAPACITY) {
          lost.push(view)
          continue
        }
        if (needsCell) cellsUsed++
        classStock[id]++
        classGain[id] = (classGain[id] ?? 0) + 1
        gained.push(view)
        break
      }
    }
  }

  // Прибавки собираются в ОДИН кусок data — это часть той же условной записи,
  // что закрывает забег, а не отдельный update: иначе повтор финиша мог бы
  // выдать добычу второй раз.
  let stockData: Prisma.CharacterUpdateManyMutationInput = {}
  for (const [id, count] of Object.entries(scrollGain) as [ScrollId, number][]) {
    stockData = { ...stockData, ...scrollStockIncrement(id, count) }
  }
  for (const [id, count] of Object.entries(bookGain) as [SkillBookId, number][]) {
    stockData = { ...stockData, ...consumableStockIncrement(id, count) }
  }
  for (const [id, count] of Object.entries(classGain) as [ClassItemId, number][]) {
    stockData = { ...stockData, ...classItemStockIncrement(id, count) }
  }

  return { gained, lost, itemIds, stockData, potionGain }
}

// --- Общее для финиша и обеих ручек Контрабандиста ---

// Индексы закрытых событий из тела запроса: только целые, в диапазоне, без
// повторов. Мусор (отрицательное, дробное, вне диапазона, дубли) отбрасывается
// молча — он не должен ни портить сумму, ни валить запрос. ОДНА функция на всех
// читателей намеренно: расхождение в валидации между ставкой и финишем дало бы
// разные суммы на одних и тех же данных.
function parseClosedEventIndices(raw: unknown, run: ActiveExploreRun): number[] {
  const list = Array.isArray(raw) ? raw : []
  return [...new Set(list.filter((i) => Number.isInteger(i) && i >= 0 && i < run.events.length))]
}

// Индекс события Контрабандиста в забеге, или -1 если его в этом забеге нет.
// Событие в розыгрыше одно (см. runEvents.ts), findIndex этого достаточно.
function smugglerEventIndex(run: ActiveExploreRun): number {
  return run.events.findIndex((e) => e.kind === 'smuggler')
}

// Сумма trophyReward перечисленных событий, КРОМЕ самого Контрабандиста. Его
// собственный trophyReward сейчас всегда 0 (runEvents.ts), но исключается явно:
// иначе появление у него награды молча удвоило бы ставку.
function trophySumOf(run: ActiveExploreRun, indices: number[]): number {
  const smuggler = smugglerEventIndex(run)
  return indices.reduce((sum, i) => (i === smuggler ? sum : sum + run.events[i].trophyReward), 0)
}

// Ставка сделки: банк персонажа ПЛЮС трофеи событий, закрытых к этому моменту.
// Банк входит целиком — в этом весь смысл механики (на кону всё накопленное, не
// выручка одного забега). Суммы берутся из СВОЕГО currentRun.events, клиент
// называет только индексы.
function stakeFromClosedEvents(bank: number, run: ActiveExploreRun, closed: number[]): number {
  return bank + trophySumOf(run, closed)
}

// Read & verify the JWT from the Authorization header. Returns userId or null.
function getUserId(request: FastifyRequest): number | null {
  const auth = request.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) return null
  const token = auth.slice('Bearer '.length)
  try {
    const jwtSecret = process.env.JWT_SECRET || 'fallback-secret'
    const payload = jwt.verify(token, jwtSecret)
    if (typeof payload === 'string') return null
    return payload.userId as number
  } catch {
    return null
  }
}

// Тело обеих ручек Контрабандиста (/run/smuggler-quote и /run/smuggler-deal):
// индексы событий, закрытых к моменту обращения. Валидируются так же, как
// closedEvents финиша (parseClosedEventIndices) — суммы наград клиент не
// присылает вовсе.
// runId (15.10.2026) — id забега, см. checkRunId.
type SmugglerBody = { closedEvents?: number[]; runId?: unknown }

// Body shape for POST /run/start-explore. mapFile is optional — omitted →
// the server picks one itself (pickRunMapFile); the debug map switcher
// (App.tsx) still sends an explicit one, still validated below.
type StartExploreBody = {
  mapFile?: string
  // id расходников из гнёзд подготовки. Поля НЕТ — забег без расходников: так
  // шлёт клиент до появления гнёзд, и отказывать ему нельзя.
  consumables?: string[]
}
// Body shape for POST /run/finish-explore. closedEvents — indices into the
// ActiveExploreRun.events array (see FinishExplore route below for how
// they're validated).
// ⚠️ smugglerOutcome БОЛЬШЕ НЕ ЧИТАЕТСЯ: исход сделки бросает сервер
// (/run/smuggler-deal) и хранит в currentRun.smugglerDeal. Поле оставлено в
// типе только потому, что старый клиент его ещё присылает — принять и
// проигнорировать дешевле, чем отказывать всему финишу. Новый клиент его
// слать не должен. runId (15.10.2026) — id забега из ответа старта: по нему
// финиш отличает повтор своего же забега (отдаёт сохранённый итог) от
// запоздавшего финиша прошлого забега (отказ 'Run mismatch'). attackDamageDealt/
// skillDamageDealt/healedAmount/damageTaken — RAW counters accumulated by
// the client over the whole run (Explore.tsx: attackDamageDealtRef/
// skillDamageDealtRef/healedAmountRef/damageTakenRef), NOT pre-computed stat
// gains — the server runs them through applyStatGrowth itself, after
// clamping to the anti-cheat caps below (see the route).
type FinishExploreBody = {
  runId?: unknown
  closedEvents: number[]
  died: boolean
  smugglerOutcome?: 'gain' | 'steal'
  attackDamageDealt?: number
  skillDamageDealt?: number
  healedAmount?: number
  damageTaken?: number
  // How many potions of EACH tier the client drank this run (Explore.tsx counts
  // them at the gulp frame, not on button press) — index = tier-1. Never
  // trusted as-is: capped per tier against what THIS run was issued
  // (currentRun.potions), then capped again against the run's sip allowance.
  potionsDrunkByTier?: number[]
  // Сколько РЕЗУЛЬТАТИВНЫХ применений каждого навыка насчитал клиент
  // (Explore.tsx: skillUsesRef — по факту попадания, не по нажатию). Из них
  // сервер растит уровни навыков — своей формулой и своими порогами
  // (applySkillUsesGrowth, game.ts). Разбирается ТЕМ ЖЕ coerceRunProgress, что
  // четыре счётчика выше (мягко, поэлементно), поэтому старый клиент
  // без этого поля просто не растит уровни.
  skillUses?: Record<string, number>
  // Сработал ли оберег от смерти в этом забеге. Спасение считает КЛИЕНТ (бой
  // целиком на нём), и серверу остаётся тот же уровень доверия, что у `died`:
  // проверить можно только то, что оберег вообще был взят в забег
  // (currentRun.consumablesUsed) и что он ещё на складе.
  charmUsed?: boolean
}
// Body shape for POST /run/sip — один глоток, тир 1..POTION_TIER_COUNT.
// sipId (15.10.2026) — id ЭТОГО глотка, один на все попытки повтора: глоток,
// чья первая попытка дошла, а ответ потерялся, повтор не запишет второй раз.
// runId — id забега (см. checkRunId).
type SipBody = { tier?: number; sipId?: unknown; runId?: unknown }
// Shared "run result" shape — one results screen for both ways an Explore
// run can end: the client explicitly finishing it (POST /run/finish-explore)
// or the server finding a stale one still open on the NEXT login (POST
// /auth/login, see auth.ts) and closing it as a death. `interrupted`
// distinguishes the two (false = client-reported finish, true = server
// found it abandoned).
// ⚠️ Поля `items` здесь БОЛЬШЕ НЕТ (30.09.2026). Оно было заготовкой под дроп и
// типом `never[]`, то есть не могло нести ничего; дроп приехал смешанный
// (снаряжение + страницы + зелья + книги), и вместо мёртвой заготовки теперь
// два честных поля — `drops` и `dropsLost`. `bonuses` осталось: система
// «сердца босса» (выбор стата предметом) по-прежнему не начата.
// strengthGained/enduranceGained/agilityGained/leveledUp — added for the
// results-screen stat growth display (see /run/finish-explore); an
// interrupted run (auth.ts) never calls applyStatGrowth, so it always
// reports zeros/false there, same convention as items/bonuses above.
// trophies/strength/endurance/agility/level — the character's CURRENT
// (post-update) absolute values, not deltas — the client merges those
// straight into `player` via setPlayer(prev => ({...prev, ...})). Explore never had that
// wiring at all (onRunComplete was dead code) — this is what finally closes
// that gap (see App.tsx handleExploreRunComplete). Returning absolute
// values, not deltas, means the client can never compute a wrong number by
// adding a gain to a stale base — it just overwrites with what the server
// already wrote to the DB.
export type RunResultSummary = {
  interrupted: boolean
  died: boolean
  trophiesEarned: number
  trophiesLost: number
  eventsClosed: number
  eventsTotal: number
  /**
   * Добыча забега — что РЕАЛЬНО начислено этой же записью (см. applyDrops).
   * Пустой список — законный и частый исход: ни одно закрытое событие не
   * прошло первый бросок.
   * ⚠️ Это НЕ повтор броска: с 30.09.2026 добыча разыграна на старте, лежит в
   * currentRun.events[i].drop и уже показана игроку всплывашкой. Здесь она
   * только начисляется.
   */
  drops: RunDrop[]
  /**
   * Что выпало, но пропало из-за полной сумки. Отдельным списком, а не флагом
   * внутри drops: игрок должен увидеть ИМЕННО то, что потерял, — иначе правило
   * «не влезло, значит пропало» выглядит как пропажа без причины.
   */
  dropsLost: RunDrop[]
  bonuses: never[]
  strengthGained: number
  enduranceGained: number
  agilityGained: number
  leveledUp: boolean
  trophies: number
  strength: number
  endurance: number
  agility: number
  level: number
  // Potion stock per tier left AFTER this run's drinks were deducted (index =
  // tier-1) — absolute, like trophies/strength above. The client merges it into
  // `player` so the shop doesn't keep showing the pre-run counts.
  potions: number[]
  // Уровни, полученные НЕ от статов (сейчас только убийство босса в Explore,
  // +1, см. bossClosed в /run/finish-explore) — level выше УЖЕ включает этот
  // бонус (calculateLevel складывает их), это поле для клиента/аналитики
  // отдельно, не источник истины само по себе.
  bonusLevels: number
  /**
   * Склад расходников по id каталога ПОСЛЕ забега. Нужен, чтобы сработавший
   * оберег сразу исчез из инвентаря и из гнезда, а не ждал следующего логина.
   * ⚠️ КОПИЯ этого типа живёт в src/api.ts — менять парами (см. CLAUDE.md,
   * таблица копий клиент/сервер: у RunResultSummary сверяющего скрипта нет).
   */
  consumables: Record<string, number>
  /**
   * Склад СТРАНИЦ по id каталога после забега. Нужен по той же причине, что
   * consumables рядом: выпавшая страница обязана появиться в сумке сразу, а не
   * ждать следующего логина.
   */
  scrolls: Record<string, number>
  /**
   * Склад предметов классов (Осколок души, Печать отречения) по id каталога
   * после забега, 18.10.2026. Та же причина, что у scrolls рядом.
   */
  classItems: Record<string, number>
  /**
   * Навыки, у которых ЗА ЭТОТ ЗАБЕГ вырос уровень, с НОВЫМ уровнем
   * каждого (02.10.2026). Пустой список — самый частый исход (первый уровень
   * стоит 30 применений), и экран итогов тогда ничего о навыках не рисует.
   * Считает сервер, а не клиент сравнением двух наборов: пороги и остатки
   * живут только в БД.
   */
  skillLevelUps: SkillLevelUp[]
  /**
   * Уровни и остатки применений ПОСЛЕ забега — абсолютные, как
   * trophies/strength выше. Без них полоса «X / Y» и «Уровень N» в карточке
   * навыка показывали бы дорановые числа до следующего логина.
   */
  skillLevels: Record<string, number>
  skillUses: Record<string, number>
}

export async function runRoutes(server: FastifyInstance) {
  // Start a map-based Explore run: spend energy, roll 3 events for the given
  // map (server/src/runEvents.ts), save them as the active run.
  server.post<{ Body: StartExploreBody }>('/run/start-explore', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    // Refuse to start over an existing run — starting fresh here would
    // silently discard whatever is in progress.
    if (character.currentRun !== null) {
      return reply.status(400).send({ error: 'A run is already in progress' })
    }

    // Not sent — server rolls a map itself (pickRunMapFile). Sent — exact
    // match against the whitelist, not a prefix/regex check, so the client
    // can't hand us an arbitrary filename to read off disk (this path is
    // still used by the debug map switcher in App.tsx).
    const { mapFile: requestedMapFile } = request.body
    let mapFile: string
    if (requestedMapFile === undefined) {
      mapFile = pickRunMapFile()
    } else {
      if (!(KNOWN_MAP_FILES as readonly string[]).includes(requestedMapFile)) {
        return reply.status(400).send({ error: 'Unknown mapFile' })
      }
      mapFile = requestedMapFile
    }

    // --- Расходники из гнёзд подготовки ---
    //
    // Поля нет — забег без расходников (так шлёт клиент до появления гнёзд).
    // Есть, но не массив — ОТКАЗ, а не «считаем, что не брали»: тихо
    // проигнорировать значило бы начать забег без камня, который игрок
    // положил, и списать энергию за это.
    const rawConsumables = request.body?.consumables
    const takenSpecs: Consumable[] = []
    if (rawConsumables !== undefined) {
      if (!Array.isArray(rawConsumables)) {
        return reply.status(400).send({ error: 'consumables must be an array' })
      }
      if (rawConsumables.length > RUN_CONSUMABLE_SLOTS) {
        return reply.status(400).send({ error: 'Too many consumables', slots: RUN_CONSUMABLE_SLOTS })
      }
      const stock = consumableStockOf(character)
      for (const raw of rawConsumables) {
        // Только id из каталога И только с флагом runSlot. «Нет такого id» и
        // «есть, но в гнездо не идёт» дают один отказ намеренно (см.
        // runSlotConsumableById).
        const spec = typeof raw === 'string' ? runSlotConsumableById(raw) : null
        if (spec === null) {
          return reply.status(400).send({ error: 'Unknown consumable' })
        }
        // Повторы запрещены: одно гнездо — один предмет, и два одинаковых id
        // означали бы либо два гнезда с одним камнем, либо попытку списать
        // один раз, а получить эффект дважды.
        if (takenSpecs.some((s) => s.id === spec.id)) {
          return reply.status(400).send({ error: 'Duplicate consumable' })
        }
        // Запаса должно хватать. Проверка здесь — ради понятного текста ошибки;
        // ГАРАНТИЮ даёт фильтр условной записи ниже (между этой проверкой и
        // записью склад может измениться).
        if ((stock[spec.id] ?? 0) < 1) {
          return reply.status(400).send({ error: 'Consumable not in stock', id: spec.id })
        }
        takenSpecs.push(spec)
      }
    }
    const takenIds = takenSpecs.map((s) => s.id)

    // Энергия и НОВЫЙ момент отсчёта — одним вызовом: в lastEnergyUpdate ниже
    // пишется именно regen.lastEnergyUpdate, а не `new Date()`, иначе недобранный
    // остаток минуты сгорал бы на каждом старте забега (см. regenerateEnergy в
    // game.ts, правка 04.10.2026). RUN_COST в этот расчёт не входит вовсе,
    // поэтому смена 3 -> 10 перед релизом его не трогает.
    const regen = regenerateEnergy(character.energy, character.lastEnergyUpdate)
    if (regen.energy < RUN_COST) {
      return reply.status(400).send({ error: 'Not enough energy', energy: regen.energy })
    }

    const newEnergy = regen.energy - RUN_COST
    const maxHp = character.endurance * 8
    // Снимок склада ПО ТИРАМ + отдельный лимит глотков. Раньше здесь был один
    // Math.min(potionCharges, 3), смешивавший «сколько есть» и «сколько можно».
    const potionStock = potionStockOf(character)
    const potionSips = Math.min(MAX_SIPS_PER_RUN, potionStock.reduce((sum, n) => sum + n, 0))

    const equippedItems = await prisma.inventoryItem.findMany({
      where: { characterId: character.id, equipped: true },
      include: { item: true },
    })
    // Броня = надетые предметы + КУПЛЕННАЯ закалка брони. Прибавку считает общий
    // каталог (upgradeBonus), тот же, что на клиенте: два умножения count на шаг
    // разошлись бы, и сервер начал бы считать забег не той бронёй, что показана
    // игроку на экране «Персонаж».
    const totalArmor = equippedItems.reduce((sum, inv) => sum + (inv.item.armor ?? 0), 0)
      + upgradeBonus('armor', upgradesOf(character))

    // level больше не колонка в БД — вычисляется на месте из статов+бонуса
    // (см. game.ts calculateLevel), никогда не читается напрямую.
    const characterLevel = calculateLevel(character.strength, character.agility, character.endurance, character.bonusLevels)
    const events = await attachEventDrops(
      rollRunEvents(mapFile, characterLevel),
      characterLevel,
      character.luck,
      request.log,
    )

    // confirmed: false — забег создан, но игрок его ещё не видел. Снимет флаг
    // POST /run/ready, когда клиент построит мир (а также первый глоток или
    // срез прогресса — любая реальная игра, см. /run/sip и /run/progress).
    // Пока флаг не снят, вход закроет забег БЕЗ штрафа и вернёт энергию:
    // упавшая текстура или оборванная сеть на экране "ПОДГОТОВКА" не должны
    // стоить игроку банка трофеев (см. judgeInterruptedRun в runState.ts).
    //
    // spentEnergy — СПИСАННОЕ ИМЕННО СЕЙЧАС, выражением от тех же двух чисел,
    // что уходят в запись ниже, а не копией RUN_COST. Сегодня это одно и то же
    // (regen.energy >= RUN_COST проверено выше, клэмпа между ними нет), но
    // привязка к фактической разнице переживёт и смену константы, и появление
    // любых скидок: вернуть при закрытии обязаны ровно то, что сняли.
    const spentEnergy = regen.energy - newEnergy
    // consumablesUsed кладём ТОЛЬКО когда что-то взяли: у забега без расходников
    // поля нет вовсе, и readConsumablesUsed читает это как честное «не брали»
    // (тот же договор, что у potionsDrunk и smugglerDeal).
    // runId — id этого забега: клиент называет его во всех запросах забега, и
    // запрос от ПРОШЛОГО забега, доползший после старта нового, получит отказ,
    // а не ляжет в новый (см. checkRunId). startedAt — от него отсчитывается
    // окно подтверждения (READY_WINDOW_MS, runState.ts).
    const runId = randomUUID()
    const activeRun: ActiveExploreRun = {
      mode: 'explore', mapFile, events, hp: maxHp, maxHp, potions: potionStock, sips: potionSips,
      confirmed: false, spentEnergy, runId, startedAt: Date.now(),
      ...(takenIds.length > 0 ? { consumablesUsed: takenIds } : {}),
    }

    // Условная запись. Раньше здесь был обычный update — его хватало, пока старт
    // только списывал энергию. Теперь он списывает ещё и склад расходников, и
    // проверка «хватает ли» обязана стоять В ФИЛЬТРЕ, а не только выше: между
    // чтением персонажа и этой строкой камень мог уйти на другой забег или
    // прийти покупкой.
    //   currentRun пустой — та же защита, что проверка выше, но неустранимая
    //     гонкой: два одновременных старта не откроют два забега и не спишут
    //     камень дважды.
    //   запас каждого взятого >= 1 — consumableRunSpend собирает фильтр и
    //     декремент одним проходом, поэтому разойтись по составу они не могут.
    // Склад, энергия и currentRun пишутся ОДНОЙ записью: забег либо начат с
    // оплаченным камнем, либо не начат вовсе.
    const spend = consumableRunSpend(takenSpecs)
    const written = await prisma.character.updateMany({
      where: {
        userId,
        currentRun: { equals: Prisma.DbNull },
        ...spend.where,
      },
      data: {
        energy: newEnergy,
        // С ПЕРЕНОСОМ остатка минуты (см. regen выше). Если игрок был под
        // потолком, regen.lastEnergyUpdate равен now — накопленного банка у
        // полной энергии нет намеренно.
        lastEnergyUpdate: regen.lastEnergyUpdate,
        currentRun: activeRun as unknown as Prisma.InputJsonValue,
        ...spend.data,
      },
    })
    if (written.count === 0) {
      // Не записано НИЧЕГО: ни энергия, ни склад, ни забег. Поэтому повтор
      // клиентом безопасен — в отличие от прежнего update, который в такой
      // гонке молча перезаписал бы чужой забег.
      return reply.status(409).send({ error: 'State changed, retry' })
    }

    // Что из розыгрыша видит клиент — награды, вид врагов и, с 13.10.2026,
    // решение «ловушка или обычный» у каждого сундука — собирает
    // clientRunEvents (runEvents.ts); там же записано, почему каждое из полей
    // отдаётся. Берётся из ТОГО ЖЕ массива events, что записан в currentRun выше:
    // финиш начислит ровно то, что клиент сейчас получит и покажет.
    const clientEvents = clientRunEvents(events)

    // Множитель урона обычной атаки на ВЕСЬ забег:
    //   attackMult = 1 + сумма attackBonus взятых расходников
    // Ничего не взяли — ровно 1 (не 1.0-с-погрешностью: пустая сумма даёт целое).
    // Сумма, а не «бонус камня»: со вторым предметом, дающим урон, формула
    // останется той же, и править её не придётся.
    // Считает СЕРВЕР и по СПИСАННОМУ списку, а не по телу запроса: клиент не
    // должен иметь возможности включить эффект, не потратив предмет.
    const attackMult = takenSpecs.reduce((mult, spec) => mult + consumableAttackBonus(spec), 1)

    // Склад расходников ПОСЛЕ списания — ПЕРЕЧИТАННЫЙ из базы, а не посчитанный
    // как «снимок минус взятое».
    // Снимок для этого не годится: фильтр гарантировал только «запаса хватало»,
    // но не «запас был равен снимку». Между чтением персонажа и записью склад мог
    // вырасти покупкой с другого устройства — тогда снимок 1 − 1 = 0, а в базе
    // 2, и клиент показал бы ноль при непустом складе. Decrement считала БАЗА,
    // и единственный честный способ назвать итог — спросить её.
    const updated = await prisma.character.findUnique({ where: { userId } })
    if (!updated) {
      // Персонаж существовал строкой выше (updateMany нашёл его) — исчезнуть мог
      // только удалением в ту же секунду. Подставлять правдоподобные числа
      // нельзя: забег УЖЕ начат. Отказ здесь безопасен — забег остался
      // неподтверждённым (confirmed: false), и вход закроет его БЕЗ штрафа с
      // возвратом энергии (см. judgeInterruptedRun).
      request.log.error({ userId }, 'start-explore: character vanished between write and read-back')
      return reply.status(500).send({ error: 'Run started but stock could not be read' })
    }
    const consumablesAfter = consumableStockOf(updated)

    return reply.send({
      energy: newEnergy,
      mapFile,
      events: clientEvents,
      maxHp,
      level: characterLevel,
      potions: potionStock,
      sips: potionSips,
      armor: totalArmor,
      attackMult,
      consumables: consumablesAfter,
      // Какие расходники сервер РЕАЛЬНО принял в этот забег. Клиент из них
      // узнаёт, что у него на руках оберег (эффект считает он), а не полагается
      // на свой же список из гнёзд: принять сервер мог не всё, и расходиться
      // этим двум спискам нельзя.
      consumablesTaken: takenIds,
      // Id забега (15.10.2026). Клиент возвращает его в ready / sip / progress /
      // сделке / финише / отмене; старый клиент поле просто не читает.
      runId,
    })
  })

  // Подтверждение старта: клиент дошёл до готовности ПОКАЗАТЬ забег (мир
  // построен, ассеты загружены). До этого момента забег для игрока не
  // существовал, и если приложение закрыли раньше — вход вернёт энергию и не
  // тронет банк трофеев (см. judgeInterruptedRun в runState.ts и /auth/login).
  //
  // Идемпотентен: повтор на уже подтверждённом забеге НИЧЕГО не пишет и
  // отвечает тем же 200. Так повтор после оборванного по таймауту запроса
  // безопасен — тот же приём, что у 409 на финише.
  server.post<{ Body: { runId?: unknown } | undefined }>('/run/ready', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    const run = character.currentRun as unknown as ActiveExploreRun | null
    if (!run || run.mode !== 'explore') {
      return reply.status(400).send({ error: 'No active explore run' })
    }
    const runIdCheck = checkRunId(run, request.body?.runId)
    if (runIdCheck !== 'ok') {
      const rejection = runIdRejection(runIdCheck)
      return reply.status(rejection.status).send(rejection.body)
    }

    const confirmed = readRunConfirmed(run)
    if (confirmed === null) {
      request.log.error(
        { userId, confirmed: run.confirmed },
        'ready: currentRun.confirmed is malformed, treating the run as already confirmed',
      )
    }
    // Уже подтверждён (или забег старого формата, без поля) — писать нечего.
    if (confirmed !== false) {
      return reply.send({ confirmed: true })
    }

    // Окно подтверждения закрыто (READY_WINDOW_MS, runState.ts). Честный клиент
    // сюда не попадает: он подтверждается сразу после загрузки, а загрузка
    // сторожится 60 с. Опоздавшее подтверждение — признак клиента, который
    // играл неподтверждённым и решил подтвердиться задним числом; такой забег
    // остаётся неподтверждённым, и его финиш пойдёт штрафным путём.
    if (!readyWindowOpen(run, Date.now())) {
      request.log.warn({ userId, startedAt: run.startedAt }, 'ready: confirmation window expired, run stays unconfirmed')
      return reply.status(400).send({ error: 'Ready window expired' })
    }

    const nextRun: ActiveExploreRun = { ...run, confirmed: true }

    // Условная запись — тот же приём и те же касты, что у /run/sip ниже.
    const written = await prisma.character.updateMany({
      where: { userId, currentRun: { equals: character.currentRun as unknown as Prisma.InputJsonValue } },
      data: { currentRun: nextRun as unknown as Prisma.InputJsonValue },
    })
    if (written.count === 0) {
      return reply.status(409).send({ error: 'Run state changed, retry' })
    }

    return reply.send({ confirmed: true })
  })

  // Отмена НЕ ПОКАЗАННОГО забега (15.10.2026). Клиент зовёт её, когда не
  // дождался подтверждения старта (/run/ready) и показывает экран ошибки
  // вместо игры. Подтверждение при этом могло ДОЙТИ (ответ потерялся по
  // дороге) — и тогда забег на сервере подтверждён, а следующий вход закрыл
  // бы его как смерть, сжигая весь банк трофеев за забег, которого игрок не
  // видел. Отмена закрывает его так же, как вход закрывает неподтверждённый:
  // без штрафа, с возвратом энергии.
  //
  // Условия — judgeUnshownCancel (runState.ts): окно подтверждения
  // (READY_WINDOW_MS от старта) не прошло, в забеге не играли (ни среза с
  // уроном или лечением, ни глотка), сделки с Контрабандистом не было.
  // runId ОБЯЗАТЕЛЕН: отменить можно только тот забег, который клиент знает
  // по имени, — запоздавшая отмена прошлого забега не закроет новый.
  //
  // Новой лазейки нет: в то же окно изменённый клиент и без этой ручки мог не
  // подтверждаться и закрыть забег без штрафа (см. READY_WINDOW_MS).
  server.post<{ Body: { runId?: unknown } | undefined }>('/run/cancel-unshown', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const claimed = parseRequestId(request.body?.runId)
    if (claimed === null) return reply.status(400).send({ error: 'Invalid runId' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    const run = character.currentRun as unknown as ActiveExploreRun | null
    if (!run || run.mode !== 'explore') {
      return reply.status(400).send({ error: 'No active explore run' })
    }
    if (readRunId(run) !== claimed) {
      return reply.status(400).send({ error: 'Run mismatch' })
    }

    const judgement = judgeUnshownCancel(run, Date.now())
    for (const problem of judgement.loud) {
      request.log.error({ userId, problem }, `cancel-unshown: ${problem}`)
    }
    if (judgement.verdict === 'refuse') {
      request.log.warn({ userId, reason: judgement.reason }, 'cancel-unshown: refused')
      return reply.status(400).send({ error: 'Run cannot be cancelled', reason: judgement.reason })
    }

    // Возврат энергии — тем же расчётом и с тем же переносом остатка, что у
    // входа на неподтверждённом забеге (refundEnergy, game.ts). Трофеи, зелья,
    // статы и склад в data НЕТ вовсе: забега, которого не видели, не было.
    const refund = refundEnergy(character.energy, character.lastEnergyUpdate, judgement.spentEnergy)
    // Условная запись по прочитанному currentRun — тот же приём, что у
    // /run/sip: глоток или срез, успевшие лечь между чтением и записью, уже
    // доказали игру, и отменять такой забег нельзя.
    const written = await prisma.character.updateMany({
      where: { userId, currentRun: { equals: character.currentRun as unknown as Prisma.InputJsonValue } },
      data: {
        currentRun: Prisma.DbNull,
        energy: refund.energy,
        lastEnergyUpdate: refund.lastEnergyUpdate,
      },
    })
    if (written.count === 0) {
      return reply.status(409).send({ error: 'Run state changed, retry' })
    }
    request.log.info({ userId, runId: claimed, energyRefunded: refund.refunded }, 'cancel-unshown: run cancelled without penalty')
    return reply.send({ cancelled: true, energyRefunded: refund.refunded })
  })

  // Зафиксировать ОДИН выпитый глоток по тиру — в currentRun, а не в складе.
  // Колонки potionT1..T5 здесь НЕ трогаются: списание со склада остаётся одним
  // пакетом в /run/finish-explore, иначе выпитое спишется дважды.
  //
  // Потолки — те же, что у finish-explore (ступени 2 и 3 там), но превышение
  // здесь ОТКАЗ 400, а не тихое срезание: о рассинхроне клиент должен узнать на
  // самом глотке.
  server.post<{ Body: SipBody }>('/run/sip', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    const run = character.currentRun as unknown as ActiveExploreRun | null
    if (!run || run.mode !== 'explore') {
      return reply.status(400).send({ error: 'No active explore run' })
    }

    const runIdCheck = checkRunId(run, request.body?.runId)
    if (runIdCheck !== 'ok') {
      const rejection = runIdRejection(runIdCheck)
      return reply.status(rejection.status).send(rejection.body)
    }

    const rawTier = request.body?.tier
    const tierSpec = Number.isInteger(rawTier) ? potionTierByNumber(rawTier as number) : null
    if (tierSpec === null) {
      return reply.status(400).send({ error: 'Unknown potion tier' })
    }
    const tierIndex = tierSpec.tier - 1

    const sipId = readOptionalRequestId(request.body?.sipId)
    if (sipId === 'invalid') {
      return reply.status(400).send({ error: 'Invalid sipId' })
    }

    const drunk = readRunPotionsDrunk(run)
    if (drunk === null) {
      request.log.error({ userId, potionsDrunk: run.potionsDrunk }, 'sip: currentRun.potionsDrunk is malformed')
      return reply.status(500).send({ error: 'Corrupt run state' })
    }
    const sipIds = readRunSipIds(run)
    if (sipIds === null) {
      // Испорченный список нельзя прочитать как пустой: это записало бы повтор
      // второй раз — ровно то, от чего список заведён.
      request.log.error({ userId, sipIds: run.sipIds }, 'sip: currentRun.sipIds is malformed')
      return reply.status(500).send({ error: 'Corrupt run state' })
    }

    // Повтор уже записанного глотка (первая попытка дошла, ответ потерялся) —
    // отвечаем тем, что записано, и НЕ пишем ничего. Проверка стоит ДО
    // потолков: последний разрешённый глоток, повторённый, иначе получил бы
    // 'No sips left', и клиент решил бы, что глоток не записан.
    if (sipId !== null && sipIds.includes(sipId)) {
      request.log.info({ userId, sipId }, 'sip: replay of an already recorded sip, not recording again')
      const allowed = runSipsAllowed(run)
      const total = drunk.reduce((sum, n) => sum + n, 0)
      return reply.send({ potionsDrunk: drunk, sipsLeft: Math.max(0, allowed - total), replayed: true })
    }

    // Потолок по тиру — снимок склада на старте забега (потолок 1 clampPotionsSpent).
    const runStock = runPotionStock(run)
    const issued = runStock[tierIndex] ?? 0
    if (drunk[tierIndex] + 1 > issued) {
      return reply.status(400).send({ error: 'Tier stock exhausted', tier: tierSpec.tier, issued, drunk: drunk[tierIndex] })
    }
    // Потолок по сумме — run.sips (потолок 2 clampPotionsSpent), с тем же
    // откатом на MAX_SIPS_PER_RUN для нецелого значения.
    const sipsAllowed = runSipsAllowed(run)
    const drunkTotal = drunk.reduce((sum, n) => sum + n, 0)
    if (drunkTotal + 1 > sipsAllowed) {
      return reply.status(400).send({ error: 'No sips left', sips: sipsAllowed, drunk: drunkTotal })
    }

    const nextDrunk = [...drunk]
    nextDrunk[tierIndex] += 1
    // Глоток — доказательство реальной игры, поэтому он же подтверждает забег
    // (лишнего запроса не появляется: запись currentRun здесь и так идёт).
    // Условие СТРОГО `=== false`: у забега без поля и у подтверждённого объект
    // не меняется ни на байт, иначе условная запись ниже дралась бы сама с
    // собой на ровном месте.
    // Подтверждает только в окне подтверждения (READY_WINDOW_MS): иначе клиент,
    // игравший неподтверждённым, подтверждался бы глотком задним числом. Вне
    // окна глоток всё равно записывается — и как признак игры закрывает забег
    // при входе штрафным путём.
    const nextRun: ActiveExploreRun = {
      ...run,
      potionsDrunk: nextDrunk,
      ...(sipId !== null ? { sipIds: [...sipIds, sipId] } : {}),
      ...(run.confirmed === false && readyWindowOpen(run, Date.now()) ? { confirmed: true } : {}),
    }

    // Условная запись: применяется, только если currentRun в базе всё ещё РОВНО
    // тот, что прочитан выше (jsonb-сравнение, порядок ключей не важен). Без
    // этого read-modify-write гонялся бы: два глотка подряд теряли бы
    // инкремент, а finish-explore или вход, закрывшие забег между чтением и
    // записью, получили бы currentRun обратно — забег "воскрес" бы, старт
    // следующего упёрся бы в 'A run is already in progress', а ближайший вход
    // закрыл бы его как смерть.
    const written = await prisma.character.updateMany({
      where: { userId, currentRun: { equals: character.currentRun as unknown as Prisma.InputJsonValue } },
      data: { currentRun: nextRun as unknown as Prisma.InputJsonValue },
    })
    if (written.count === 0) {
      return reply.status(409).send({ error: 'Run state changed, retry' })
    }

    return reply.send({ potionsDrunk: nextDrunk, sipsLeft: sipsAllowed - (drunkTotal + 1) })
  })

  // Срез сырых счётчиков забега в currentRun.progress. Нужен ровно для одного:
  // у забега, брошенного закрытием приложения, /auth/login применяет последний
  // срез и рост статов больше не теряется (без него смерть растила статы, а
  // закрытие — нет, и правило "закрыть приложение не выгоднее смерти"
  // нарушалось в обе стороны).
  //
  // ЗАМЕНА, а не сложение: клиент присылает накопленное С НАЧАЛА ЗАБЕГА, и
  // потерянный по дороге срез ничего не ломает — следующий перезапишет всё
  // равно. Сложение потребовало бы дельт, а дельта, доставленная дважды
  // (повтор после таймаута), посчиталась бы дважды.
  //
  // Потолки здесь НЕ применяются намеренно: они зависят от уровня персонажа на
  // момент ПРИМЕНЕНИЯ и считаются один раз там, где срез превращается в статы
  // (clampRunProgress в /auth/login и в финише). Хранится сырьё.
  server.post<{ Body: unknown }>('/run/progress', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    const run = character.currentRun as unknown as ActiveExploreRun | null
    if (!run || run.mode !== 'explore') {
      return reply.status(400).send({ error: 'No active explore run' })
    }

    const runIdCheck = checkRunId(run, (request.body as { runId?: unknown } | null)?.runId)
    if (runIdCheck !== 'ok') {
      const rejection = runIdRejection(runIdCheck)
      return reply.status(rejection.status).send(rejection.body)
    }

    // СТРОГО, в отличие от финиша: срез целиком наш собственный формат, и
    // частично разобранному верить нельзя — испорченное поле здесь означает
    // сломанного клиента, о котором надо узнать сразу, а не рост статов,
    // тихо посчитанный от нуля.
    const progress = parseRunProgress(request.body)
    if (progress === null) {
      return reply.status(400).send({ error: 'Invalid progress' })
    }

    // Срез с ненулевыми счётчиками — такое же доказательство игры, что и
    // глоток выше, и подтверждает забег тем же способом и с тем же строгим
    // `=== false` (забег без поля остаётся байт в байт прежним) — и тоже
    // только в окне подтверждения (см. /run/sip).
    const nextRun: ActiveExploreRun = {
      ...run,
      progress,
      ...(run.confirmed === false && readyWindowOpen(run, Date.now()) ? { confirmed: true } : {}),
    }

    // Условная запись — ровно та же, что у /run/sip выше, и по той же причине:
    // read-modify-write иначе гоняется. Отдельно важно, что срез НЕ может
    // воскресить уже закрытый забег — финиш или вход, обнулившие currentRun
    // между чтением и записью, не совпадут с фильтром, и запись не применится.
    const written = await prisma.character.updateMany({
      where: { userId, currentRun: { equals: character.currentRun as unknown as Prisma.InputJsonValue } },
      data: { currentRun: nextRun as unknown as Prisma.InputJsonValue },
    })
    if (written.count === 0) {
      return reply.status(409).send({ error: 'Run state changed, retry' })
    }

    return reply.send({ progress })
  })

  // Finish a map-based Explore run: award trophies for the events the client
  // closed (amounts come ONLY from the server's own currentRun.events, never
  // from the request body), apply the Contrabandist deal already recorded in
  // currentRun.smugglerDeal (the multiplier itself was applied at deal time, in
  // /run/smuggler-deal — NOT here, and never from the request body),
  // zero trophies on death, close currentRun.
  server.post<{ Body: FinishExploreBody }>('/run/finish-explore', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    // --- Повтор финиша того же забега (15.10.2026) ---
    //
    // Финиш, чья первая попытка дошла и закрыла забег, а ответ потерялся,
    // раньше получал 400 'No active explore run', и игрок видел «Забег уже
    // закрыт на сервере» без чисел. Теперь итог каждого финиша сохраняется под
    // ключом `finish:<runId>`, и повтор с тем же runId получает ЕГО — те же
    // числа, ничего не записав второй раз. Проверка стоит ДО «есть ли открытый
    // забег»: у повтора его уже нет.
    // Тело не объект (null, массив, строка) — отказ, а не 500 на первом же
    // request.body.died ниже.
    if (typeof request.body !== 'object' || request.body === null || Array.isArray(request.body)) {
      return reply.status(400).send({ error: 'Invalid body' })
    }
    const claimedRunId = readOptionalRequestId(request.body?.runId)
    if (claimedRunId === 'invalid') {
      return reply.status(400).send({ error: 'Invalid runId' })
    }
    if (claimedRunId !== null) {
      const stored = await prisma.idempotencyKey.findUnique({
        where: { characterId_key: { characterId: character.id, key: finishKey(claimedRunId) } },
      })
      if (stored && stored.endpoint === FINISH_ENDPOINT && stored.response !== null) {
        request.log.info({ userId, runId: claimedRunId }, 'finish-explore: replay of an already finished run, returning the stored result')
        return reply.send(stored.response)
      }
    }

    // This endpoint only ever makes sense for a currentRun that
    // /run/start-explore itself created (mode: 'explore').
    const run = character.currentRun as unknown as ActiveExploreRun | null
    if (!run || run.mode !== 'explore') {
      return reply.status(400).send({ error: 'No active explore run' })
    }
    // Финиш ПРОШЛОГО забега, доползший после старта нового, не должен закрыть
    // новый своими числами.
    const runIdCheck = checkRunId(run, request.body?.runId)
    if (runIdCheck !== 'ok') {
      request.log.warn({ userId, claimedRunId, runId: run.runId }, 'finish-explore: runId does not match the open run')
      const rejection = runIdRejection(runIdCheck)
      return reply.status(rejection.status).send(rejection.body)
    }

    // --- Неподтверждённый забег на финише (15.10.2026) ---
    //
    // Честный клиент неподтверждённый забег не показывает вовсе (Explore.tsx
    // запускает игру только после ответа /run/ready), значит и финишировать
    // его не может. Финиш неподтверждённого забега — изменённый клиент,
    // который не подтверждался, чтобы держать бесплатную страховку: плохой
    // забег — убить приложение (вход закроет без штрафа), хороший — прийти на
    // финиш. Такой финиш идёт ШТРАФНЫМ путём, как у входа: смерть, ни одного
    // закрытого события (ни трофеев, ни добычи, ни уровня босса), оберег не
    // списан, статы и зелья — по тому, что сервер записал сам (срез и глотки),
    // а не по телу запроса.
    // Только у забегов нового формата (есть startedAt): забег, начатый до
    // 15.10.2026, окна подтверждения не знал, и для него поведение прежнее —
    // предупреждение в лог.
    const confirmedRead = readRunConfirmed(run)
    const unconfirmedPenalty = confirmedRead === false && readRunStartedAt(run) !== null
    if (confirmedRead === false) {
      request.log.warn(
        { userId, penalty: unconfirmedPenalty },
        unconfirmedPenalty
          ? 'finish-explore: unconfirmed run finished, closing it on the penalty path'
          : 'finish-explore: run was never confirmed by /run/ready (old run format, no penalty)',
      )
    }

    const died = request.body.died === true || unconfirmedPenalty
    // Индексы закрытых событий — общая валидация (parseClosedEventIndices):
    // та же, что у обеих ручек Контрабандиста, иначе ставка и финиш посчитали бы
    // разные суммы на одних и тех же данных.
    const closedEvents = unconfirmedPenalty ? [] : parseClosedEventIndices(request.body.closedEvents, run)

    // --- Трофеи за забег ---
    //
    // Банк ДО забега. Он же банк на СТАРТЕ: за время открытого забега трофеи в
    // БД не меняет ничего (сверено по всем записям в server/src — обмен на
    // золото фильтром требует пустой currentRun, покупка зелий трофеи не
    // трогает, а /auth/login меняет их только ВМЕСТЕ с закрытием забега, после
    // которого этот обработчик получит 400/409).
    // --- Оберег от смерти ---
    //
    // Списывается ТОЛЬКО если сработал (spendAt: 'effect'), поэтому единственное
    // место, где он уходит со склада, — эта условная запись финиша.
    //
    // Доверие клиенту здесь ровно такое же, как у `died`: спасение происходит в
    // бою, а бой целиком на клиенте. Что сервер ПРОВЕРЯЕТ — что оберег реально
    // был взят в забег (свой список в currentRun.consumablesUsed, не слово
    // клиента). Соврать «спас» без взятого оберега нельзя.
    const charmUsed = !unconfirmedPenalty && request.body.charmUsed === true
    const usedRead = readConsumablesUsed(run)
    if (usedRead.kind === 'malformed') {
      // Список взятого испорчен — проверить право на списание нечем. Молча
      // пропустить значило бы или отобрать оберег даром, или отдать спасение
      // бесплатно.
      request.log.error({ userId, consumablesUsed: run.consumablesUsed }, 'finish-explore: currentRun.consumablesUsed is malformed')
      return reply.status(500).send({ error: 'Corrupt run state' })
    }
    const takenInRun = usedRead.kind === 'used' ? usedRead.ids : []
    if (charmUsed && !takenInRun.includes('charm_death')) {
      request.log.warn({ userId, takenInRun }, 'finish-explore: charmUsed without a charm taken into the run')
      return reply.status(400).send({ error: 'Charm was not taken into this run' })
    }

    const bank = character.trophies
    const dealRead = readSmugglerDeal(run)
    if (dealRead.kind === 'malformed') {
      // Итог посчитать нечем: сделка была, но её числа испорчены. Молча
      // посчитать «как будто сделки не было» нельзя — это тихо отменило бы
      // кражу или отняло выигрыш.
      request.log.error({ userId, smugglerDeal: run.smugglerDeal }, 'finish-explore: currentRun.smugglerDeal is malformed')
      return reply.status(500).send({ error: 'Corrupt run state' })
    }

    // Итоговый банк ПОСЛЕ забега (при смерти обнуляется ниже).
    //   Сделка была: множитель уже применён к ставке в момент сделки
    //     (deal.after), и к результату прибавляется ТОЛЬКО добыча событий,
    //     закрытых ПОСЛЕ неё. Закрытое до сделки второй раз не считается — оно
    //     уже внутри deal.stake.
    //   Сделки не было: банк плюс вся добыча, без множителя — прежнее поведение.
    let total: number
    if (dealRead.kind === 'deal') {
      const deal = dealRead.deal
      const before = new Set(deal.closedBefore)
      const afterDealIndices = closedEvents.filter((i) => !before.has(i))
      total = deal.after + trophySumOf(run, afterDealIndices)
    } else {
      total = bank + trophySumOf(run, closedEvents)
    }

    // ⚠️ Поле smugglerOutcome из тела запроса НЕ ЧИТАЕТСЯ вообще — исход бросает
    // сервер в /run/smuggler-deal и хранит в currentRun.smugglerDeal. Старый
    // клиент поле ещё присылает; оно игнорируется намеренно, а не по забывчивости
    // (прежняя схема позволяла всегда присылать 'gain').
    // Убийство босса — bonusLevels += 1 (см. задачу). "Закрыт" здесь значит
    // ТО ЖЕ самое, что уже решает выплату трофеев выше (closedEvents,
    // провалидированные индексы в run.events ИЗ currentRun, не из тела
    // запроса) — тот же уровень доверия клиенту, что и у trophySum, отдельный
    // сырой флаг "bossKilled" от клиента не заводим и не читаем. run.events[i]
    // само по себе доказывает, что босс в ЭТОМ забеге был (currentRun —
    // серверные данные), а не то, что клиент придумал.
    const bossClosed = closedEvents.some((i) => run.events[i].kind === 'boss')

    const newTrophies = total
    // Насколько банк изменился за забег. ⚠️ МОЖЕТ БЫТЬ ОТРИЦАТЕЛЬНЫМ и нулём не
    // обрезается: при краже у Контрабандиста итог законно меньше банка на
    // старте, и это ровно то, что игрок должен увидеть. Math.max(0, …) здесь
    // превратил бы потерю в правдоподобный ноль (см. CLAUDE.md, запрет тихих
    // фолбэков).
    const earned = newTrophies - bank
    // trophiesLost — the balance actually wiped by death (the character's
    // PRE-update total, not just this run's earned amount): on a normal
    // (non-death) finish nothing was lost, so 0.
    // Не меняется этой правкой: смерть по-прежнему жжёт ВЕСЬ предрановый банк.
    const trophiesLost = died ? bank : 0

    // --- Stat growth (see game.ts applyStatGrowth) — applies regardless of
    // died: the player still dealt/took damage over the run either way. ---
    // level больше не колонка в БД — вычисляется на месте (тот же приём, что
    // в остальных эндпоинтах этого файла), нужен ДО роста статов — и для
    // потолка урона (масштаб врага на текущем уровне), и для сравнения
    // "levelUp?" после.
    const characterLevel = calculateLevel(character.strength, character.agility, character.endurance, character.bonusLevels)

    // Четыре сырых счётчика из тела — МЯГКИЙ разбор (кривое поле становится
    // нулём, остальные живут): у старого клиента их может не быть вовсе, а
    // отказывать всему финишу из-за одного числа нельзя, забег уже сыгран.
    // Штрафной путь неподтверждённого забега — по записанному сервером срезу,
    // как у входа: телу такого клиента верить не в чем.
    const reportedProgress = unconfirmedPenalty
      ? (readRunProgress(run) ?? emptyRunProgress())
      : coerceRunProgress(request.body)

    // Потолки — общий расчёт (clampRunProgress, runState.ts): ТОТ ЖЕ, которым
    // /auth/login обрабатывает срез брошенного забега. Здесь остаются только
    // логи: что именно срезано и в каком забеге.
    const capped = clampRunProgress(reportedProgress, run, characterLevel)
    if (capped.dealtScale < 1) {
      request.log.warn(
        {
          userId,
          combinedAttackSkill: reportedProgress.attackDamageDealt + reportedProgress.skillDamageDealt,
          maxDamageDealt: capped.maxDamageDealt,
          enemyCount: capped.enemyCount,
          bossCount: capped.bossCount,
          characterLevel,
        },
        'finish-explore: attackDamageDealt+skillDamageDealt exceeded cap, clamped',
      )
    }
    if (reportedProgress.damageTaken > capped.maxDamageTaken) {
      request.log.warn(
        { userId, damageTaken: reportedProgress.damageTaken, maxDamageTaken: capped.maxDamageTaken, runMaxHp: run.maxHp, sips: runSipsAllowed(run) },
        'finish-explore: damageTaken exceeded cap, clamped',
      )
    }
    if (reportedProgress.healedAmount > capped.maxHealed) {
      request.log.warn(
        { userId, healedAmount: reportedProgress.healedAmount, maxHealed: capped.maxHealed },
        'finish-explore: healedAmount exceeded cap, clamped',
      )
    }

    // --- Рост УРОВНЕЙ НАВЫКОВ (02.10.2026) ---
    // Тот же источник, что у роста статов (сырьё из тела финиша, прошедшее
    // те же мягкий разбор и потолки), и та же функция, что у /auth/login на
    // брошенном забеге (applySkillUsesGrowth, game.ts). Смерть рост НЕ отменяет —
    // ровно как у статов выше: навыки были применены по-настоящему, и сгорают
    // только трофеи.
    const skillLevelsBefore = skillLevelsOf(character)
    const skillGrowth = applySkillUsesGrowth(skillLevelsBefore, skillUsesOf(character), capped.progress.skillUses)

    // bonusLevels инкрементируется здесь, ДО applyStatGrowth — level (снимок)
    // обязан пересчитаться уже с новым bonusLevels в той же формуле
    // (calculateLevel внутри applyStatGrowth), а не отдельно поверх.
    const newBonusLevels = character.bonusLevels + (bossClosed ? 1 : 0)

    // --- Списание выпитых зелий, по тирам ---
    // Ступень 1: разбор поля. Мусор (нет поля, не массив, не целое, отрицательное,
    // NaN) обнуляется поэлементно — тем же приёмом, что кривые индексы
    // closedEvents выше: не 400, но и не молчаливая догадка. Ноль значит
    // «списывать нечего», он же достаётся старому клиенту, который поля не шлёт.
    const rawDrunk = request.body.potionsDrunkByTier
    const reportedDrunk: number[] = new Array(POTION_TIER_COUNT).fill(0)
    if (Array.isArray(rawDrunk)) {
      for (let i = 0; i < POTION_TIER_COUNT; i++) {
        const v = rawDrunk[i]
        if (Number.isInteger(v) && (v as number) >= 0) reportedDrunk[i] = v as number
      }
    }

    // Сверка с тем, что накопил /run/sip в currentRun. Только ПРЕДУПРЕЖДЕНИЕ:
    // списание по-прежнему идёт от числа клиента (ступени 2–3 ниже), расхождение
    // здесь — сигнал о рассинхроне клиента и сервера, а не повод отказать.
    const recordedDrunk = readRunPotionsDrunk(run)
    if (recordedDrunk === null || reportedDrunk.some((n, i) => n !== recordedDrunk[i])) {
      request.log.warn(
        { userId, reportedDrunk, rawReported: rawDrunk, recordedDrunk, rawRecorded: run.potionsDrunk },
        'finish-explore: potionsDrunkByTier differs from /run/sip record in currentRun',
      )
    }

    // Ступень 2: оба потолка — по каждому тиру (против снимка run.potions из
    // currentRun, а не из тела запроса) и по сумме глотков. Арифметика и
    // порядок среза живут в clampPotionsSpent (runState.ts): /auth/login
    // списывает зелья брошенного забега теми же потолками, и разойтись им
    // нельзя. Тот же уровень доверия клиенту, что у потолка урона выше.
    const runStock = runPotionStock(run)
    const sipsAllowed = runSipsAllowed(run)
    // Штрафной путь — выпитое по записи /run/sip, как у входа.
    const drunkToSpend = unconfirmedPenalty ? (recordedDrunk ?? emptyPotionStock()) : reportedDrunk
    const potionsSpent = clampPotionsSpent(drunkToSpend, runStock, sipsAllowed)
    if (drunkToSpend.some((n, i) => n !== potionsSpent[i])) {
      request.log.warn(
        { userId, reportedDrunk, potionsSpent, runStock, sipsAllowed },
        'finish-explore: potionsDrunkByTier exceeded per-tier or sip cap, clamped',
      )
    }

    // --- Добыча забега ---
    //
    // ⚠️ КОСТИ ЗДЕСЬ БОЛЬШЕ НЕ БРОСАЮТСЯ (30.09.2026). Добыча каждого события
    // разыграна на СТАРТЕ и лежит в currentRun.events[i].drop — игрок уже видел
    // её всплывашкой в момент закрытия события. Бросить второй раз значило бы
    // выдать НЕ ТО, что показали.
    //
    // Набор событий — ТОТ ЖЕ closedEvents, по которому выше посчитаны трофеи:
    // два разных набора дали бы добычу с события, за которое трофеев не
    // начислено.
    //
    // ЗАПАСНОЙ ПУТЬ: забег, начатый СТАРЫМ сервером, добычи в событиях не имеет
    // (поля `drop` нет вовсе) — для него кости бросаются здесь, как и раньше.
    // Отличить его от «нового забега, где ничего не выпало» можно только по
    // наличию ключа, поэтому storedEventDrops и возвращает null, а не пустой
    // список (см. его комментарий).
    //
    // died в этот расчёт НЕ передаётся вовсе: добыча начисляется и при смерти
    // (решение дизайнера — сгорают только трофеи, см. docs/items.md). Отсутствие
    // параметра и есть гарантия, что смерть сюда не просочится.
    const storedDrops = storedEventDrops(run, closedEvents, request.log)
    const eventDrops = storedDrops ?? await (async () => {
      const intents = rollRunDrops(run.events, closedEvents, characterLevel, character.luck)
      const resolved: EventDrop[] = []
      for (const intent of intents) {
        const drop = await resolveDropIntent(intent, characterLevel, request.log)
        if (drop !== null) resolved.push(drop)
      }
      return resolved
    })()
    // Вместимость (applyDrops) и склад зелий считаются ВНУТРИ транзакции ниже,
    // под блокировкой строки персонажа, — см. там.

    const growth = applyStatGrowth(
      character.strength, character.strengthProgress, capped.progress.attackDamageDealt,
      character.endurance, character.enduranceProgress, capped.progress.damageTaken,
      character.agility, character.agilityProgress, capped.progress.skillDamageDealt + capped.progress.healedAmount,
      run.maxHp,
      run.hp,
      newBonusLevels,
    )

    // Условная запись — ТОТ ЖЕ приём, что у /run/sip и /run/progress выше:
    // применяется, только если currentRun в базе всё ещё РОВНО тот, что
    // прочитан в начале обработчика (jsonb-сравнение, порядок ключей не
    // важен). Между чтением и этой строкой забег мог закрыть /auth/login —
    // игрок убил приложение, не дождавшись "Сохраняем итоги...", и зашёл
    // заново. Без фильтра финиш писал бы поверх результата входа от своего,
    // уже устаревшего снимка статов и трофеев.
    // До неё нет ни записей в БД, ни ответа клиенту — только warn'ы, описывающие
    // расчёт. Поэтому отказ здесь не может оставить забег закрытым наполовину.
    //
    // ⚠️ ТРАНЗАКЦИЯ, а не одиночный updateMany, как было до 30.09.2026. Причина
    // ровно одна и та же, что у POST /character/sell-item (второе и последнее
    // место с транзакцией в server/src): записей стало ДВЕ — колонки персонажа
    // и строки инвентаря под выпавшее снаряжение, — а порознь они дают либо
    // предмет, выданный за незакрытый забег, либо закрытый забег без обещанной
    // добычи. Везде, где записей одна, проект по-прежнему обходится условным
    // updateMany: транзакция дороже и блокирует строки.
    //
    // Транзакция берётся ВСЕГДА, даже когда снаряжение не выпало и запись опять
    // одна. Развилка «есть предмет — транзакция, нет — просто update» дала бы
    // два пути закрытия забега, которые обязаны совпадать во всём остальном, и
    // разъехались бы при первой же правке одного из них.
    //
    // ⚠️ С 15.10.2026 транзакция начинается с БЛОКИРОВКИ строки персонажа
    // (lockCharacterRow) и перечитывает его под ней. Под блокировкой считаются
    // две вещи, которые фильтром условной записи не выражаются:
    //   • вместимость сумки (applyDrops) — COUNT по InventoryItem; без
    //     блокировки сборка книги со второго устройства занимала ту же последнюю
    //     ячейку;
    //   • склад зелий — пишется РАЗНИЦЕЙ (increment), а не абсолютным
    //     значением от снимка начала обработчика: абсолютное затирало покупку
    //     зелья, сделанную между чтением и записью.
    const txResult = await prisma.$transaction(async (tx) => {
      await lockCharacterRow(tx, userId)
      const fresh = await tx.character.findUnique({ where: { userId } })
      if (!fresh) return null
      // Вместимость считается ЗДЕСЬ, а не на старте вместе с броском: за забег
      // сумка меняется, и «не влезло» должно решаться по её состоянию на конец.
      const resolvedDrops = await applyDrops(tx, eventDrops, fresh, request.log)
      // Склад после забега: свежий склад минус выпитое (никогда не в минус — см.
      // subtractPotionStock) плюс выпавшее. Пишется разницей со свежим складом.
      const freshPotions = potionStockOf(fresh)
      const newPotionStock = subtractPotionStock(freshPotions, potionsSpent)
        .map((n, i) => n + (resolvedDrops.potionGain[i] ?? 0))
      const potionChange = potionStockDelta(newPotionStock.map((n, i) => n - freshPotions[i]))
      const result = await tx.character.updateMany({
        where: {
          userId,
          currentRun: { equals: character.currentRun as unknown as Prisma.InputJsonValue },
          // Оберег списывается только если он ещё на складе. Фильтр, а не проверка
          // выше: в схеме нет ограничения «не меньше нуля», и уйти в минус нельзя
          // дать никаким стечением обстоятельств. Не сработал — условия нет вовсе.
          ...(charmUsed ? { charms: { gte: 1 } } : {}),
          // Склад зелий не уйдёт в минус (под блокировкой не сдвинется, но
          // гарантирует это фильтр, а не надежда).
          ...potionChange.where,
        },
        data: {
          // decrement, а не вычисленное значение: в ТОЙ ЖЕ записи, что трофеи,
          // зелья и закрытие забега — списание и закрытие происходят вместе либо
          // не происходят вовсе.
          ...(charmUsed ? { charms: { decrement: 1 } } : {}),
          trophies: died ? 0 : newTrophies,
          strength: growth.strength,
          strengthProgress: growth.strengthProgress,
          endurance: growth.endurance,
          enduranceProgress: growth.enduranceProgress,
          agility: growth.agility,
          agilityProgress: growth.agilityProgress,
          bonusLevels: newBonusLevels,
          level: growth.level, // денормализованный снимок — см. комментарий к полю в schema.prisma
          // Списывается НЕЗАВИСИМО от died: зелья выпиты по-настоящему, и смерть
          // не должна становиться способом сэкономить склад (та же логика, что у
          // роста статов выше). Обнуление трофеев рядом на эти поля не влияет —
          // разные колонки, один атомарный update. РАЗНИЦЕЙ, не абсолютом — см.
          // potionStockDelta.
          ...potionChange.data,
          // Выпавшие страницы и книги — increment'ами В ЭТОЙ ЖЕ записи. Поэтому
          // повтор финиша не может выдать добычу дважды: второй запрос либо
          // упрётся в пустой currentRun (400 выше), либо не найдёт строку по
          // фильтру и получит 409, ничего не записав.
          ...resolvedDrops.stockData,
          // Уровни навыков — increment'ами на прирост (skillLevelGrowthColumns), остатки
          // применений — абсолютными значениями (остаток приращением не
          // выражается). В ТОЙ ЖЕ записи, что трофеи и закрытие забега:
          // повтор финиша не начислит применения дважды по той же причине, что
          // не выдаст дважды добычу.
          ...skillLevelGrowthColumns(skillLevelsBefore, skillGrowth.levels),
          ...skillUsesToColumns(skillGrowth.uses),
          currentRun: Prisma.DbNull,
        },
      })
      // 0 строк — забег закрыли между чтением и записью. Возвращаемся ДО
      // создания предметов: иначе снаряжение легло бы в сумку за забег, который
      // закрыл кто-то другой.
      if (result.count === 0) return null
      for (const itemId of resolvedDrops.itemIds) {
        await tx.inventoryItem.create({ data: { characterId: character.id, itemId } })
      }
      return { count: result.count, resolvedDrops, newPotionStock }
    }, { maxWait: 10000, timeout: 15000 })
    if (txResult === null) {
      // Тот же код и текст, что у /run/sip и /run/progress: клиент уже умеет
      // повторять финиш на 409 теми же данными (api.ts, finishRunExplore).
      // Повтор безопасен именно потому, что здесь НИЧЕГО не записано.
      return reply.status(409).send({ error: 'Run state changed, retry' })
    }
    const { count: written, resolvedDrops, newPotionStock } = txResult
    if (written !== 1) {
      // Недостижимо, пока Character.userId объявлен @unique (schema.prisma) —
      // фильтр по нему может дать только 0 или 1 строку. Если это всё же
      // случилось, откатить уже нечего: запись применена к нескольким
      // персонажам. Поэтому громко в лог и дальше обычный ответ — тихо
      // проглотить такое нельзя, но и врать клиенту, что забег не сохранён,
      // тоже: его собственная строка записана верно.
      request.log.error(
        { userId, count: written },
        'finish-explore: conditional write matched an unexpected number of characters',
      )
    }

    // Склад расходников, страниц и зелий после забега — ПЕРЕЧИТАННЫЙ из БД,
    // всегда (с 15.10.2026; раньше только когда менялись расходники или
    // страницы): склад зелий теперь пишется разницей, и итог посчитала база,
    // включая покупку со второго устройства между чтением и записью.
    let consumablesAfterFinish = consumableStockOf(character)
    let scrollsAfterFinish = scrollStockOf(character)
    let classItemsAfterFinish = classItemStockOf(character)
    let potionsAfterFinish = newPotionStock
    {
      const reread = await prisma.character.findUnique({ where: { userId } })
      if (reread) {
        consumablesAfterFinish = consumableStockOf(reread)
        scrollsAfterFinish = scrollStockOf(reread)
        classItemsAfterFinish = classItemStockOf(reread)
        potionsAfterFinish = potionStockOf(reread)
      } else {
        // Строка исчезла между записью и чтением — практически невозможно
        // (updateMany только что её нашёл). Ответ 500 здесь был бы хуже
        // неточного числа: забег УЖЕ закрыт, и клиент потерял бы весь экран
        // итогов. Поэтому громкий лог и арифметика от снимка, а не тишина.
        request.log.error({ userId }, 'finish-explore: character vanished before consumable read-back')
        if (charmUsed) {
          consumablesAfterFinish = { ...consumablesAfterFinish, charm_death: Math.max(0, consumablesAfterFinish.charm_death - 1) }
        }
      }
    }

    const result: RunResultSummary = {
      interrupted: false,
      died,
      trophiesEarned: earned,
      trophiesLost,
      eventsClosed: closedEvents.length,
      eventsTotal: run.events.length,
      drops: resolvedDrops.gained,
      dropsLost: resolvedDrops.lost,
      bonuses: [],
      strengthGained: growth.strength - character.strength,
      enduranceGained: growth.endurance - character.endurance,
      agilityGained: growth.agility - character.agility,
      leveledUp: growth.level > characterLevel,
      trophies: died ? 0 : newTrophies,
      strength: growth.strength,
      endurance: growth.endurance,
      agility: growth.agility,
      level: growth.level,
      potions: potionsAfterFinish,
      bonusLevels: newBonusLevels,
      consumables: consumablesAfterFinish,
      scrolls: scrollsAfterFinish,
      classItems: classItemsAfterFinish,
      // Уровни навыков НЕ перечитываются из БД, в отличие от склада выше:
      // здесь нужны ИМЕННО те числа, которые посчитал рост (из них же
      // собран skillLevelUps), а не всё, что успело случиться с колонкой после:
      // перечитанный уровень с чужим +1 от книги рассказал бы про забег неправду.
      // Расхождение с БД возможно только при покупке книги со второго
      // устройства ровно в окне финиша, и лечится «Обновить баланс».
      skillLevelUps: skillGrowth.levelUps,
      skillLevels: skillGrowth.levels,
      skillUses: skillGrowth.uses,
    }

    // Итог — под ключом `finish:<runId>`, чтобы повтор этого финиша (ответ
    // потерялся, «Повторить сохранение») получил те же числа. Отдельной
    // записью ПОСЛЕ транзакции: итог собран из перечитанного склада. От
    // двойного применения защищает не эта строка, а фильтр по currentRun
    // выше; здесь — только удобство повтора, поэтому сбой — громкий лог, а не
    // отказ уже сохранённому забегу.
    const finishedRunId = readRunId(run)
    if (finishedRunId !== null) {
      try {
        await prisma.idempotencyKey.create({
          data: {
            characterId: character.id,
            key: finishKey(finishedRunId),
            endpoint: FINISH_ENDPOINT,
            response: result as unknown as Prisma.InputJsonValue,
          },
        })
        await pruneIdempotencyKeys(character.id, request.log)
      } catch (e) {
        request.log.error({ userId, runId: finishedRunId, err: e }, 'finish-explore: run closed, but the result could not be stored for replay')
      }
    }
    return reply.send(result)
  })

  // --- Контрабандист: предложение и сделка ---
  //
  // Две ручки вместо одной, потому что у них РАЗНАЯ природа: quote только
  // считает и ничего не пишет (её можно звать сколько угодно, например пока
  // игрок стоит перед панелью), а deal делает неповторимый бросок и пишет его
  // результат. Смешать их в одну значило бы бросать кости на каждое открытие
  // панели.
  //
  // Тело у обеих одно: closedEvents — индексы событий, закрытых К ЭТОМУ
  // МОМЕНТУ. Суммы наград клиент не присылает и не может: они лежат в
  // currentRun.events на сервере (см. stakeFromClosedEvents).

  // Сколько стоит на кону и что будет при удаче. ТОЛЬКО чтение — ни одной записи.
  server.post<{ Body: SmugglerBody }>('/run/smuggler-quote', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    const run = character.currentRun as unknown as ActiveExploreRun | null
    if (!run || run.mode !== 'explore') {
      return reply.status(400).send({ error: 'No active explore run' })
    }
    const runIdCheck = checkRunId(run, request.body?.runId)
    if (runIdCheck !== 'ok') {
      const rejection = runIdRejection(runIdCheck)
      return reply.status(rejection.status).send(rejection.body)
    }
    if (smugglerEventIndex(run) < 0) {
      return reply.status(400).send({ error: 'No smuggler in this run' })
    }

    // Сделка уже была — предложение бессмысленно: второй раз ставку не делают,
    // и показать «на кону N» после броска значило бы соврать.
    const dealRead = readSmugglerDeal(run)
    if (dealRead.kind === 'malformed') {
      request.log.error({ userId, smugglerDeal: run.smugglerDeal }, 'smuggler-quote: currentRun.smugglerDeal is malformed')
      return reply.status(500).send({ error: 'Corrupt run state' })
    }
    if (dealRead.kind === 'deal') {
      return reply.status(409).send({ error: 'Deal already made' })
    }

    const closedEvents = parseClosedEventIndices(request.body?.closedEvents, run)
    const stake = stakeFromClosedEvents(character.trophies, run, closedEvents)

    return reply.send({ stake, ifGain: Math.round(stake * SMUGGLER_MULT) })
  })

  // Сама сделка: бросок и запись результата.
  //
  // ⚠️ ИСХОД БРОСАЕТ СЕРВЕР. Поле smugglerOutcome из тела финиша больше не
  // читается вовсе — прежняя схема («клиент присылает исход, сервер верит на
  // слово») позволяла всегда присылать 'gain'.
  //
  // ИДЕМПОТЕНТНОСТЬ обязательна и держится на самой сделке в currentRun: бросок
  // неповторим, поэтому повторный запрос (потерянный ответ, двойной тап, второе
  // устройство) возвращает УЖЕ СОХРАНЁННОЕ, а не бросает заново. Без этого
  // повтор был бы способом перебросить неудачу.
  server.post<{ Body: SmugglerBody }>('/run/smuggler-deal', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    const run = character.currentRun as unknown as ActiveExploreRun | null
    if (!run || run.mode !== 'explore') {
      return reply.status(400).send({ error: 'No active explore run' })
    }
    const runIdCheck = checkRunId(run, request.body?.runId)
    if (runIdCheck !== 'ok') {
      const rejection = runIdRejection(runIdCheck)
      return reply.status(rejection.status).send(rejection.body)
    }
    if (smugglerEventIndex(run) < 0) {
      return reply.status(400).send({ error: 'No smuggler in this run' })
    }

    const dealRead = readSmugglerDeal(run)
    if (dealRead.kind === 'malformed') {
      request.log.error({ userId, smugglerDeal: run.smugglerDeal }, 'smuggler-deal: currentRun.smugglerDeal is malformed')
      return reply.status(500).send({ error: 'Corrupt run state' })
    }
    // Уже сделана — отдаём то же самое, БЕЗ броска и без записи.
    if (dealRead.kind === 'deal') {
      const { outcome, stake, after } = dealRead.deal
      return reply.send({ outcome, stake, after })
    }

    const closedBefore = parseClosedEventIndices(request.body?.closedEvents, run)
    const stake = stakeFromClosedEvents(character.trophies, run, closedBefore)

    const outcome: SmugglerDeal['outcome'] = Math.random() < SMUGGLER_STEAL_CHANCE ? 'steal' : 'gain'
    const after = outcome === 'gain'
      ? Math.round(stake * SMUGGLER_MULT)
      : Math.round(stake * (1 - SMUGGLER_STEAL_FRAC))

    const deal: SmugglerDeal = { closedBefore, stake, outcome, after }
    const nextRun: ActiveExploreRun = { ...run, smugglerDeal: deal }

    // Условная запись — тот же приём и те же касты, что у /run/sip и финиша:
    // применяется, только если currentRun в базе всё ещё РОВНО тот, что прочитан
    // выше. Между чтением и записью забег мог закрыть финиш или /auth/login —
    // без фильтра сделка «воскресила» бы закрытый забег.
    const written = await prisma.character.updateMany({
      where: { userId, currentRun: { equals: character.currentRun as unknown as Prisma.InputJsonValue } },
      data: { currentRun: nextRun as unknown as Prisma.InputJsonValue },
    })
    if (written.count === 0) {
      // Бросок при этом НЕ сохранён и на следующей попытке будет сделан заново.
      // Это верно: раз забега уже нет, то и сделки в нём быть не может.
      return reply.status(409).send({ error: 'Run state changed, retry' })
    }

    return reply.send({ outcome, stake, after })
  })

  // --- КНИГИ НАВЫКОВ: надеть / забыть / улучшить / продать ---
  //
  // ⚠️ Прежний POST /character/skills УДАЛЁН вместе с этой четвёркой (29.09.2026).
  // Он принимал любой набор из пяти id и записывал его без всяких условий, то есть
  // выдавал навык БЕСПЛАТНО — а по решению дизайнера навык бывает только от книги.
  // Заводить вместо него «правильный» обобщённый setter нельзя по той же причине:
  // клиент не должен называть итоговый набор, он называет ДЕЙСТВИЕ (надел эту
  // книгу / забыл этот навык), а набор считает сервер.
  //
  // Общее у всех четырёх:
  //   • запись УСЛОВНАЯ (updateMany с фильтром), как у buy-consumable, и она же
  //     сама себе проверка: «книга на складе» и «набор навыков не менялся» стоят
  //     в where, а не в if выше, поэтому между проверкой и записью ничего не
  //     влезет. 0 строк → отказ, и не записано НИЧЕГО (списание книги, уровень и
  //     equippedSkills всегда в одном UPDATE);
  //   • ответ перечитывается из БД (gold/consumables/equippedSkills/skillLevels)
  //     — decrement/increment считала база, и единственный честный способ назвать
  //     итог — спросить её;
  //   • ключа идемпотентности нет ни у одной: повтор спишет вторую книгу. Клиент
  //     повторов не делает (см. таблицу таймаутов в CLAUDE.md).

  // Надеть навык из книги. Книга УХОДИТ со склада: она не «экипирована», а
  // потрачена — снять навык («забыть») её не вернёт, это решение дизайнера.
  server.post<{ Body: { id?: string } }>('/character/equip-book', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const bookId = parseSkillBookId(request.body?.id)
    if (bookId === null) return reply.status(400).send({ error: 'Unknown book' })
    const spec = consumableById(bookId)
    const skillId = spec === null ? null : consumableSkillBook(spec)
    if (skillId === null) {
      // Недостижимо: parseSkillBookId пропускает только id книг, а у книги эффект
      // skillBook по построению каталога. Но молча продолжать нельзя — это
      // означало бы, что каталог разъехался сам с собой.
      request.log.error({ bookId }, 'equip-book: книга без навыка в каталоге')
      return reply.status(500).send({ error: 'Catalog mismatch' })
    }

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    const equipped = character.equippedSkills
    if (equipped.includes(skillId)) return reply.status(400).send({ error: 'Skill already equipped' })
    if (equipped.length >= MAX_EQUIPPED_SKILLS) {
      return reply.status(400).send({ error: 'No free skill slot', max: MAX_EQUIPPED_SKILLS })
    }

    // Фильтр по ПРОЧИТАННОМУ набору (equals), а не по «нет такого навыка»: так
    // ловится и параллельное надевание второго навыка, которое иначе прошло бы
    // мимо потолка и дало бы три навыка в двух гнёздах.
    const written = await prisma.character.updateMany({
      where: { userId, equippedSkills: equippedSkillsUnchanged(equipped), ...bookStockFilter(bookId) },
      data: { equippedSkills: [...equipped, skillId], ...bookStockDecrement(bookId) },
    })
    if (written.count === 0) {
      // Две причины неразличимы по числу строк: книга кончилась ИЛИ набор навыков
      // изменился. Обе — «попробуй ещё раз с актуальными данными», и клиент в
      // обоих случаях перечитывает профиль, поэтому отдаём один код.
      return reply.status(409).send({ error: 'State changed, retry' })
    }

    return await sendSkillState(request, reply, userId)
  })

  // Забыть навык: снимается из equippedSkills, книга НЕ возвращается, уровень
  // навыка СОХРАНЯЕТСЯ (решение дизайнера — оба пункта).
  server.post<{ Body: { skillId?: string } }>('/character/forget-skill', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const skillId = parseSkillBookSkillId(request.body?.skillId)
    if (skillId === null) return reply.status(400).send({ error: 'Unknown skill' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    const equipped = character.equippedSkills
    if (!equipped.includes(skillId)) return reply.status(400).send({ error: 'Skill not equipped' })

    const written = await prisma.character.updateMany({
      where: { userId, equippedSkills: equippedSkillsUnchanged(equipped) },
      data: { equippedSkills: equipped.filter((s) => s !== skillId) },
    })
    if (written.count === 0) return reply.status(409).send({ error: 'State changed, retry' })

    return await sendSkillState(request, reply, userId)
  })

  // Улучшить навык книгой: книга списывается, уровень +1. Работает и для
  // НЕнадетого навыка — уровень принадлежит герою, а не гнезду.
  server.post<{ Body: { id?: string } }>('/character/upgrade-skill', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const bookId = parseSkillBookId(request.body?.id)
    if (bookId === null) return reply.status(400).send({ error: 'Unknown book' })
    const spec = consumableById(bookId)
    const skillId = spec === null ? null : consumableSkillBook(spec)
    if (skillId === null) {
      request.log.error({ bookId }, 'upgrade-skill: книга без навыка в каталоге')
      return reply.status(500).send({ error: 'Catalog mismatch' })
    }

    // Персонажа читать НЕ НУЖНО: ни одной проверки от его состояния здесь нет —
    // потолка уровня нет (что даёт уровень, ещё не решено), надетость роли не
    // играет, а «книга есть» проверяет сам фильтр записи. Лишнее чтение только
    // добавило бы окно между проверкой и записью.
    const written = await prisma.character.updateMany({
      where: { userId, ...bookStockFilter(bookId) },
      data: { ...bookStockDecrement(bookId), ...skillLevelIncrement(skillId) },
    })
    if (written.count === 0) {
      // Персонажа не читали, поэтому 0 строк значит ЛИБО «нет книги», ЛИБО «нет
      // персонажа». Второе — у авторизованного пользователя аномалия, и
      // притворяться, что дело в книге, не стоит: различаем одним чтением.
      const exists = await prisma.character.findUnique({ where: { userId }, select: { id: true } })
      if (!exists) return reply.status(404).send({ error: 'Character not found' })
      return reply.status(400).send({ error: 'No book in stock' })
    }

    return await sendSkillState(request, reply, userId)
  })

  // Продать книгу: списывается, золото +consumableSellPrice (цена/10 из каталога,
  // одна функция на клиент и сервер — на кнопке то же число, что начислит сервер).
  server.post<{ Body: { id?: string } }>('/character/sell-book', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const bookId = parseSkillBookId(request.body?.id)
    if (bookId === null) return reply.status(400).send({ error: 'Unknown book' })
    const spec = consumableById(bookId)
    if (spec === null) {
      request.log.error({ bookId }, 'sell-book: id книги нет в каталоге')
      return reply.status(500).send({ error: 'Catalog mismatch' })
    }
    const payout = consumableSellPrice(spec)

    const written = await prisma.character.updateMany({
      where: { userId, ...bookStockFilter(bookId) },
      data: { ...bookStockDecrement(bookId), gold: { increment: payout } },
    })
    if (written.count === 0) {
      const exists = await prisma.character.findUnique({ where: { userId }, select: { id: true } })
      if (!exists) return reply.status(404).send({ error: 'Character not found' })
      return reply.status(400).send({ error: 'No book in stock' })
    }

    return await sendSkillState(request, reply, userId)
  })

  // --- СТРАНИЦЫ КНИГ: собрать книгу / продать страницу ---
  //
  // Третьего действия у страницы нет: в магазине страниц НЕТ и быть не должно
  // (решение дизайнера — они только выпадают в забегах), а применять их к навыку
  // напрямую нельзя, только через собранную книгу.
  //
  // Общее с четвёркой книг выше: запись УСЛОВНАЯ и сама себе проверка запаса,
  // ответ перечитан из БД (sendSkillState), ключа идемпотентности нет — повтор
  // потратит вторые страницы, поэтому клиент повторов не делает.

  // Собрать книгу из SCROLLS_PER_BOOK страниц. Страницы уходят, книга ложится в
  // сумку — то есть ячейку она ТРАТИТ, если книги этого вида ещё нет.
  server.post<{ Body: { id?: string } }>('/character/assemble-book', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const scrollId = parseScrollId(request.body?.id)
    if (scrollId === null) return reply.status(400).send({ error: 'Unknown scroll' })
    const scroll = scrollById(scrollId)
    // Книга страницы — СТРОКА из каталога страниц, а не импортированный
    // SkillBookId: каталоги лежат в байт-в-байт копиях и друг друга не
    // импортируют (см. шапку scrolls.ts). Поэтому проверка РАНТАЙМОВАЯ, и
    // расхождение каталогов даёт громкий 500, а не молча собранную пустоту.
    const bookId = scroll === null ? null : parseSkillBookId(scroll.bookId)
    if (scroll === null || bookId === null) {
      request.log.error({ scrollId, bookId: scroll?.bookId }, 'assemble-book: страница ссылается на книгу, которой нет в каталоге расходников')
      return reply.status(500).send({ error: 'Catalog mismatch' })
    }

    // Вместимость — ТО ЖЕ правило, что у добычи на финише: ячейка нужна только
    // под ПЕРВУЮ книгу этого вида. Занятость сумки — COUNT по другой таблице, в
    // Prisma-фильтр она не выражается, поэтому с 15.10.2026 проверка и запись
    // идут в ТРАНЗАКЦИИ под блокировкой строки персонажа (lockCharacterRow).
    // Раньше две сборки разных книг (или сборка и финиш забега с добычей) с
    // двух устройств одновременно видели «29 / 30» и обе занимали последнюю
    // ячейку — 31 / 30. Теперь вторая ждёт коммита первой и видит «30 / 30».
    type AssembleOutcome = 'ok' | 'no-character' | 'bag-full' | 'no-scrolls'
    const outcome = await prisma.$transaction(async (tx): Promise<AssembleOutcome> => {
      await lockCharacterRow(tx, userId)
      const character = await tx.character.findUnique({ where: { userId } })
      if (!character) return 'no-character'

      const stock = consumableStockOf(character)
      if (stock[bookId] === 0 && await bagCellsUsed(tx, character.id, stock, classItemStockOf(character)) >= BAG_CAPACITY) return 'bag-full'

      // Списание страниц и прибавка книги — в ОДНОМ update, вместе с фильтром
      // «страниц хватает».
      const written = await tx.character.updateMany({
        where: { userId, ...scrollStockFilter(scrollId, SCROLLS_PER_BOOK) },
        data: {
          ...scrollStockDecrement(scrollId, SCROLLS_PER_BOOK),
          ...consumableStockIncrement(bookId, 1),
        },
      })
      return written.count === 0 ? 'no-scrolls' : 'ok'
    })
    switch (outcome) {
      case 'no-character':
        return reply.status(404).send({ error: 'Character not found' })
      case 'bag-full':
        return reply.status(400).send({ error: 'Bag is full', capacity: BAG_CAPACITY })
      case 'no-scrolls':
        // Страниц не хватило. Тот же код, что и раньше: клиент на него уже
        // перечитывает профиль.
        return reply.status(409).send({ error: 'State changed, retry' })
      case 'ok':
        return await sendSkillState(request, reply, userId)
    }
  })

  // Продать ОДНУ страницу за SCROLL_SELL_PRICE золота. Без подтверждения на
  // клиенте — как у книги: страница не уникальна, их копятся десятки.
  server.post<{ Body: { id?: string } }>('/character/sell-scroll', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const scrollId = parseScrollId(request.body?.id)
    if (scrollId === null) return reply.status(400).send({ error: 'Unknown scroll' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    const written = await prisma.character.updateMany({
      where: { userId, ...scrollStockFilter(scrollId, 1) },
      data: {
        ...scrollStockDecrement(scrollId, 1),
        // increment, а не вычисленное значение: иначе параллельная покупка
        // затёрла бы золото прочитанным снимком.
        gold: { increment: SCROLL_SELL_PRICE },
      },
    })
    if (written.count === 0) return reply.status(409).send({ error: 'State changed, retry' })

    return await sendSkillState(request, reply, userId)
  })

  // --- ПРЕДМЕТЫ КЛАССОВ: продать один Осколок души или одну Печать отречения ---
  //
  // 18.10.2026. Единственное действие с ними, пока самих классов нет
  // (docs/classes.md): применить их нечем. Цена — из общего каталога
  // (classItems.ts: 50 и 500), а не из тела: клиент называет только id, и на
  // его кнопке то же число, что начислит эта ручка.
  //
  // Тот же приём, что у sell-book: запись УСЛОВНАЯ и сама себе проверка запаса
  // (фильтр «есть хотя бы один», списание и золото increment'ом в одном
  // update), ответ перечитан из БД (sendSkillState). Ключа идемпотентности нет —
  // повтор продаст вторую штуку, поэтому клиент не повторяет вовсе, а при
  // потерянном ответе требует сверки баланса.
  server.post<{ Body: { id?: unknown } }>('/character/sell-class-item', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const itemId = parseClassItemId(request.body?.id)
    if (itemId === null) return reply.status(400).send({ error: 'Unknown class item' })
    const spec = classItemById(itemId)
    if (spec === null) {
      request.log.error({ itemId }, 'sell-class-item: id есть в списке, но нет в каталоге')
      return reply.status(500).send({ error: 'Catalog mismatch' })
    }

    const written = await prisma.character.updateMany({
      where: { userId, ...classItemStockFilter(itemId) },
      data: {
        ...classItemStockDecrement(itemId),
        // increment, а не вычисленное значение: иначе параллельная покупка
        // затёрла бы золото прочитанным снимком.
        gold: { increment: spec.sellPrice },
      },
    })
    if (written.count === 0) {
      const exists = await prisma.character.findUnique({ where: { userId }, select: { id: true } })
      if (!exists) return reply.status(404).send({ error: 'Character not found' })
      return reply.status(400).send({ error: 'No class item in stock' })
    }

    return await sendSkillState(request, reply, userId)
  })

  // Покупка ОДНОГО зелья указанного тира. Цена и уровень открытия берутся из
  // каталога (src/potions.ts, копия server/src/potions.ts), НЕ из тела запроса:
  // клиент называет только тир. Раньше эндпоинт параметров не принимал вовсе и
  // продавал одно абстрактное зелье за захардкоженные 20 золота.
  //
  // ⚠️ С 15.10.2026 запись АТОМАРНАЯ и с ключом идемпотентности:
  //   • раньше здесь был обычный update с АБСОЛЮТНЫМИ значениями от снимка
  //     (gold: character.gold − цена, склад «прочитанный + N»). Всё, что легло
  //     между чтением и записью — обмен трофеев, вторая покупка, финиш забега
  //     со второго устройства, — затиралось снимком. Теперь золото — decrement
  //     с фильтром gte (как у buy-consumable), склад — increment;
  //   • requestId в теле — ключ идемпотентности (applyOnce): покупка, чей ответ
  //     потерялся, при повторе с тем же ключом не спишет золото второй раз.
  server.post<{ Body: { tier?: number; count?: number; requestId?: unknown } }>('/character/buy-potion', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    const rawTier = request.body?.tier
    const tierSpec = Number.isInteger(rawTier) ? potionTierByNumber(rawTier as number) : null
    if (tierSpec === null) {
      return reply.status(400).send({ error: 'Unknown potion tier' })
    }

    // Сколько штук. Поля нет — ровно одно, как шлёт клиент без счётчика: его
    // ответ обязан остаться прежним до байта. Разбор — чистой функцией из
    // каталога (parsePurchaseCount), там же потолок.
    const count = parsePurchaseCount(request.body?.count)
    if (count === null) {
      return reply.status(400).send({ error: 'Invalid count', max: MAX_POTIONS_PER_PURCHASE })
    }

    // Уровень открытия — та же чистая функция от статов, что и везде в файле
    // (колонка Character.level её НЕ источник, только снимок).
    const characterLevel = calculateLevel(character.strength, character.agility, character.endurance, character.bonusLevels)
    if (characterLevel < tierSpec.levelRequired) {
      return reply.status(400).send({ error: 'Tier not unlocked', levelRequired: tierSpec.levelRequired })
    }

    const requestId = readOptionalRequestId(request.body?.requestId)
    if (requestId === 'invalid') return reply.status(400).send({ error: 'Invalid requestId' })

    // Цена ВСЕЙ покупки. Прежний ответ 400 и то же поле price (цена за штуку —
    // клиент показывает её в строке отказа), добавился только total.
    // Проверки «хватает ли золота» до записи БОЛЬШЕ НЕТ: её делает фильтр
    // записи, и стоит она ПОСЛЕ ключа — повтор уже применённой покупки при
    // нехватке золота обязан получить «уже сделано», а не 'Not enough gold'.
    const totalPrice = tierSpec.price * count
    const gain = emptyPotionStock()
    gain[tierSpec.tier - 1] = count
    const stockChange = potionStockDelta(gain)

    let applied: AppliedOnce<void>
    try {
      applied = await applyOnce(character.id, requestId, 'buy-potion', request.log, async (db) => {
        const written = await db.character.updateMany({
          where: { userId, gold: { gte: totalPrice } },
          data: { gold: { decrement: totalPrice }, ...stockChange.data },
        })
        if (written.count === 0) {
          throw new RouteRejection(400, { error: 'Not enough gold', price: tierSpec.price, total: totalPrice })
        }
      })
    } catch (e) {
      if (e instanceof RouteRejection) return reply.status(e.status).send(e.body)
      throw e
    }

    // Перечитываем — decrement/increment считала база. И при повторе тоже:
    // ответ — ТЕКУЩЕЕ состояние, а не сохранённое, чтобы экран не откатился.
    const updated = await prisma.character.findUnique({ where: { userId } })
    if (!updated) {
      request.log.error({ userId }, 'buy-potion: character vanished between write and read-back')
      return reply.status(500).send({ error: 'Purchase applied but balance could not be read' })
    }
    return reply.send({
      gold: updated.gold,
      potions: potionStockOf(updated),
      ...(applied.replayed ? { replayed: true } : {}),
    })
  })

  // Покупка расходника (сейчас в каталоге один — точильный камень).
  //
  // ОТДЕЛЬНЫЙ эндпоинт, а не обобщённый buy-potion, и это осознанно: у зелий
  // своя форма ответа (`{gold, potions[5]}`), которую клиент разбирает тем же
  // кодом, что и GET /character/profile, и ломать её ради второго товара нельзя.
  // Плюс у покупки нет ключа идемпотентности (открытая задача), и разветвление
  // одного обработчика по типу товара распространило бы эту дыру на оба товара
  // сразу. Общего кода для выноса тут на три строки — дублирование дешевле.
  // requestId (15.10.2026) — ключ идемпотентности, см. applyOnce и buy-potion.
  server.post<{ Body: { id?: string; count?: number; requestId?: unknown } }>('/character/buy-consumable', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    // id — только из каталога. Цена, уровень и эффект берутся ОТТУДА, не из тела
    // запроса: клиент называет лишь, что покупает.
    const rawId = request.body?.id
    const spec = typeof rawId === 'string' ? consumableById(rawId) : null
    if (spec === null) {
      return reply.status(400).send({ error: 'Unknown consumable' })
    }

    // count обязателен и проверяется чистой функцией из каталога (там же
    // потолок). Отсутствующее поле — отказ, а не «одна штука»: у этого эндпоинта
    // нет старого клиента, чей формат надо сохранять.
    const count = parseConsumableCount(request.body?.count)
    if (count === null) {
      return reply.status(400).send({ error: 'Invalid count', max: MAX_CONSUMABLES_PER_PURCHASE })
    }

    // Уровень — та же чистая функция от статов, что и везде в файле (колонка
    // Character.level ей НЕ источник, только снимок).
    const characterLevel = calculateLevel(character.strength, character.agility, character.endurance, character.bonusLevels)
    if (characterLevel < spec.levelRequired) {
      return reply.status(400).send({ error: 'Not unlocked', levelRequired: spec.levelRequired })
    }

    const totalPrice = spec.price * count

    const requestId = readOptionalRequestId(request.body?.requestId)
    if (requestId === 'invalid') return reply.status(400).send({ error: 'Invalid requestId' })

    // Запись АТОМАРНАЯ и сама себе проверка золота: условие `gold >= total`
    // стоит в фильтре, а не в if выше. Поэтому между проверкой и списанием
    // ничего не может влезть — параллельная покупка или обмен трофеев не дадут
    // уйти в минус, потому что второй запрос просто не найдёт строку.
    //   decrement/increment, а не вычисленные значения: иначе параллельная
    //   запись золота была бы затёрта прочитанным снимком.
    // ⚠️ В схеме НЕТ ограничения «не меньше нуля» на gold, так что фильтр здесь —
    // единственное, что держит баланс неотрицательным. Убрать его нельзя.
    // С ключом (requestId) — внутри applyOnce: повтор той же покупки не спишет
    // золото второй раз.
    let applied: AppliedOnce<void>
    try {
      applied = await applyOnce(character.id, requestId, 'buy-consumable', request.log, async (db) => {
        // Вместимость (15.10.2026). Каждый расходник занимает ячейку, но одну на
        // вид: новая ячейка нужна, только если этого вида на складе ещё нет.
        // Раньше не проверялось вовсе — сумку можно было переполнить покупкой.
        // Под блокировкой строки — см. bagCellsUsed.
        await lockCharacterRow(db, userId)
        const fresh = await db.character.findUnique({ where: { userId } })
        if (!fresh) throw new RouteRejection(404, { error: 'Character not found' })
        const stock = consumableStockOf(fresh)
        if (stock[spec.id] === 0 && await bagCellsUsed(db, fresh.id, stock, classItemStockOf(fresh)) >= BAG_CAPACITY) {
          throw new RouteRejection(400, { error: 'Bag is full', capacity: BAG_CAPACITY })
        }
        const written = await db.character.updateMany({
          where: { userId, gold: { gte: totalPrice } },
          data: {
            gold: { decrement: totalPrice },
            ...consumableStockIncrement(spec.id, count),
          },
        })
        if (written.count === 0) {
          // Строка есть (findUnique выше её нашёл), значит не сошлось ИМЕННО золото.
          // price — цена за штуку, total — за всю покупку: клиент показывает обе.
          throw new RouteRejection(400, { error: 'Not enough gold', price: spec.price, total: totalPrice })
        }
      })
    } catch (e) {
      if (e instanceof RouteRejection) return reply.status(e.status).send(e.body)
      throw e
    }

    // Перечитываем — не вычисляем из старого снимка: decrement/increment считала
    // БАЗА, и единственный честный способ назвать итог — спросить её.
    const updated = await prisma.character.findUnique({ where: { userId } })
    if (!updated) {
      // Персонаж существовал строкой выше. Исчезнуть он мог только удалением в
      // ту же секунду. Подставлять правдоподобные числа нельзя: покупка УЖЕ
      // применена, и соврать о балансе хуже, чем громко отказать.
      request.log.error({ userId }, 'buy-consumable: character vanished between write and read-back')
      return reply.status(500).send({ error: 'Purchase applied but balance could not be read' })
    }

    return reply.send({
      gold: updated.gold,
      consumables: consumableStockOf(updated),
      ...(applied.replayed ? { replayed: true } : {}),
    })
  })

  // Обмен трофеев на золото — операция МЕЖДУ забегами (из меню), не путать с
  // Контрабандистом: тот меняет трофеи на трофеи ВНУТРИ забега (SMUGGLER_MULT
  // в finish-explore выше), здесь же рискованная валюта переводится в
  // стабильную по курсу TROPHY_GOLD_RATE (game.ts).
  //
  // Обмен только ПОЛНЫЙ: весь банк разом. Частичного нет намеренно — сумма
  // тогда приходила бы от клиента, и её пришлось бы проверять ещё и на
  // отрицательные/дробные/превышающие банк значения; полный обмен не берёт из
  // тела запроса ничего вообще, поэтому подделывать в нём нечего.
  //
  // Тело — пустой объект {}: ни одно поле не читается.
  server.post('/character/exchange-trophies', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    // Открытый забег — отказ. Банк трофеев в этот момент ещё не решён: финиш
    // его либо пополнит, либо сожжёт целиком (смерть), и /auth/login делает то
    // же самое с брошенным забегом. Обменять банк посреди забега значило бы
    // вынести трофеи из-под риска, ради которого они и существуют (см.
    // CLAUDE.md, Economy: трофеи — рискованная валюта).
    if (character.currentRun !== null) {
      return reply.status(400).send({ error: 'Run in progress' })
    }

    const trophies = character.trophies
    // Нечего менять — честный отказ, а не «успешный» обмен нуля на ноль:
    // клиент обязан отличать «обменял» от «обменивать было нечего».
    if (trophies <= 0) {
      return reply.status(400).send({ error: 'No trophies to exchange' })
    }

    // floor, а не round: округление в пользу игрока здесь дало бы золото из
    // воздуха. При TROPHY_GOLD_RATE >= 1 дробной части не возникает вовсе —
    // см. предупреждение у самой константы (game.ts) о курсе ниже 1.
    const goldGained = Math.floor(trophies * TROPHY_GOLD_RATE)

    // Условная запись — ТОТ ЖЕ приём, что у /run/sip и /run/finish-explore
    // выше: применяется, только если в базе всё ещё РОВНО то состояние, что
    // прочитано в начале обработчика.
    //   trophies в фильтре — против параллельного финиша забега и /auth/login:
    //     оба пишут трофеи (начисляют или обнуляют), и обмен по устаревшему
    //     снимку выдал бы золото за банк, которого уже нет.
    //   пустой currentRun в фильтре — против старта забега, успевшего
    //     открыться между чтением и записью: проверка выше к этому моменту уже
    //     устарела бы.
    // Совпало 0 строк — не записано НИЧЕГО (одна запись на весь обработчик,
    // до неё в БД не ушло ни байта), поэтому повтор клиентом безопасен.
    const written = await prisma.character.updateMany({
      where: { userId, trophies, currentRun: { equals: Prisma.DbNull } },
      data: {
        // increment, а не вычисленное `character.gold + goldGained`: золото
        // могло измениться между чтением и записью (/character/buy-potion его
        // списывает и в этот фильтр не попадает — currentRun он не читает и не
        // пишет, см. CLAUDE.md, «Покупка зелья в окне финиша»). Вычисленное
        // значение затёрло бы покупку старым снимком, increment ложится поверх
        // актуального числа.
        gold: { increment: goldGained },
        trophies: 0,
      },
    })
    if (written.count === 0) {
      return reply.status(409).send({ error: 'State changed, retry' })
    }
    if (written.count !== 1) {
      // Недостижимо, пока Character.userId объявлен @unique (schema.prisma).
      // Тот же громкий лог, что у finish-explore: откатить уже нечего, но
      // проглотить молча запись, задевшую чужих персонажей, нельзя.
      request.log.error(
        { userId, count: written.count },
        'exchange-trophies: conditional write matched an unexpected number of characters',
      )
    }

    // Перечитываем — не вычисляем из старого снимка: increment выше посчитала
    // БАЗА, и единственный честный способ назвать итоговое золото — спросить
    // её. goldGained остаётся тем числом, на которое написан increment: именно
    // его игрок увидит прибавкой.
    const updated = await prisma.character.findUnique({ where: { userId } })
    if (!updated) {
      // Персонаж существовал строкой выше (updateMany нашёл его) — исчезнуть
      // он мог только удалением в ту же секунду. Подставлять сюда
      // правдоподобные числа нельзя: обмен УЖЕ применён, и соврать о балансе
      // хуже, чем громко отказать.
      request.log.error({ userId }, 'exchange-trophies: character vanished between write and read-back')
      return reply.status(500).send({ error: 'Exchange applied but balance could not be read' })
    }

    return reply.send({ gold: updated.gold, trophies: updated.trophies, goldGained })
  })

  // Профиль для сверки баланса — ТОЛЬКО чтение. Нужен магазину, чтобы обновить
  // золото и склад, не устраивая ради этого полный логин: /auth/login закрывает
  // открытый currentRun (как смерть, если забег был подтверждён), и делать это
  // побочным эффектом кнопки «обновить» нельзя.
  // Поэтому здесь НЕТ ни одной записи, currentRun не читается и не трогается,
  // энергия не пересчитывается: расчёт энергии сдвигает lastEnergyUpdate у
  // вызывающих её эндпоинтов, а тихо терять остаток минуты на каждом обновлении
  // витрины — цена на пустом месте.
  //
  // ?requestIds=a,b (15.10.2026) — ключи покупок, исход которых клиенту
  // неизвестен (ответ потерялся). В ответе appliedRequestIds — какие из них
  // сервер уже применил. Клиент забывает применённые ключи, и следующая покупка
  // того же товара — новая, а не «уже сделано» (см. keyedPurchase в src/api.ts).
  // Только чтение, как и весь профиль.
  server.get<{ Querystring: { requestIds?: string } }>('/character/profile', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    // Негодные id отбрасываются молча: это вопрос «что из этого уже сделано», и
    // мусорный id честно отвечается «не сделано». Потолок — чтобы запрос не
    // превращался в выборку по сотне ключей.
    const askedIds = typeof request.query?.requestIds === 'string'
      ? request.query.requestIds.split(',').map(parseRequestId).filter((id): id is string => id !== null).slice(0, 20)
      : []
    const appliedRequestIds = askedIds.length === 0 ? [] : (await prisma.idempotencyKey.findMany({
      where: { characterId: character.id, key: { in: askedIds } },
      select: { key: true },
    })).map((row) => row.key)

    // gold/potions — той же формы и тем же помощником, что у buy-potion выше:
    // клиент разбирает оба ответа одним кодом. Сверх них профиль несёт ещё два
    // поля, которых у покупки нет:
    //   trophies — банк трофеев. Нужен обмену (POST /character/exchange-trophies
    //     выше): без него единственным источником трофеев остаётся ответ логина,
    //     а тот закрывает открытый забег и кнопкой «обновить» вызываться не
    //     имеет права.
    //   trophyGoldRate — курс обмена. Отдаётся числом ИМЕННО ЗДЕСЬ, чтобы на
    //     клиенте не заводить копию константы (см. TROPHY_GOLD_RATE в game.ts).
    return reply.send({
      gold: character.gold,
      trophies: character.trophies,
      potions: potionStockOf(character),
      // Запас расходников — объектом по id каталога (`{whetstone: N}`), а не
      // массивом как зелья: у зелий индекс = тир-1 и порядок фиксирован
      // каталогом, а у расходников порядка нет вовсе, и позиционный массив
      // молча съехал бы при добавлении второго вида.
      consumables: consumableStockOf(character),
      // Запас страниц — той же формы и по той же причине, что расходники выше.
      // Отдельным полем, а не внутри consumables: страницы ячейку сумки НЕ
      // тратят, и свалить их в один объект значило бы заставить клиента
      // различать «что тратит ячейку» по id, а не по источнику данных.
      scrolls: scrollStockOf(character),
      // Предметы классов (18.10.2026) — той же формы и по той же причине, что
      // страницы выше. Отдельным полем: свой каталог, в витрине их нет.
      classItems: classItemStockOf(character),
      // Надетые навыки и их уровни. Появились здесь вместе с ручками книг
      // (29.09.2026): «Обновить баланс» — единственный путь сверить состояние без
      // полного логина, а логин закрывает открытый забег и кнопкой вызываться не
      // имеет права. Без этих двух полей после продажи или улучшения книги в
      // другой вкладке экран «Персонаж» остался бы с устаревшими числами.
      equippedSkills: character.equippedSkills,
      skillLevels: skillLevelsOf(character),
      // Применения, накопленные в счёт следующего уровня (02.10.2026) —
      // рядом с уровнями и по той же причине: из них рисуется полоса «X / Y» в
      // карточке навыка, и «Обновить баланс» обязан её обновлять.
      skillUses: skillUsesOf(character),
      // Счётчики улучшений — от них зависят и урон, и броня на экране
      // «Персонаж», значит «Обновить баланс» обязан их обновлять: иначе после
      // покупки улучшения во второй вкладке экран остался бы со старыми числами.
      upgrades: upgradesOf(character),
      trophyGoldRate: TROPHY_GOLD_RATE,
      appliedRequestIds,
    })
  })

  // Покупка улучшения («закалки»). Цену считает СЕРВЕР по своему счётчику: в теле
  // только вид улучшения, число оттуда не читается вовсе.
  //
  // Запись АТОМАРНАЯ и сама себе проверка, как у buy-consumable: условия «золота
  // хватает» И «счётчик тот же, что прочитан» стоят в фильтре, а не в if выше.
  // Второе обязательно — иначе две параллельные покупки прошли бы обе по цене
  // первой, то есть игрок получил бы второе улучшение дешевле прейскуранта.
  //
  // requestId (15.10.2026) — ключ идемпотентности, см. applyOnce. Фильтр по
  // счётчику от повтора НЕ спасает: запрос, доползший после сверки баланса,
  // прочитает уже новый счётчик и купит второе улучшение по новой цене.
  server.post<{ Body: { kind?: string; requestId?: unknown } }>('/character/buy-upgrade', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const kind = parseUpgradeKind(request.body?.kind)
    if (kind === null) return reply.status(400).send({ error: 'Unknown upgrade' })
    const requestId = readOptionalRequestId(request.body?.requestId)
    if (requestId === 'invalid') return reply.status(400).send({ error: 'Invalid requestId' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    const bought = upgradesOf(character)[kind]
    const price = upgradePrice(bought)

    // Колонка выбирается switch'ем по виду, а не вычисляемым ключом: вычисляемый
    // пришлось бы приводить кастом к типу Prisma, и опечатка в имени колонки
    // прошла бы мимо проверки типов. Новый вид улучшения без ветки здесь не
    // скомпилируется — ровно то, что нужно.
    const where: Prisma.CharacterWhereInput = { userId, gold: { gte: price } }
    const data: Prisma.CharacterUpdateManyMutationInput = { gold: { decrement: price } }
    switch (kind) {
      case 'attack':
        where.attackUpgrades = bought
        data.attackUpgrades = { increment: 1 }
        break
      case 'armor':
        where.armorUpgrades = bought
        data.armorUpgrades = { increment: 1 }
        break
    }

    let applied: AppliedOnce<void>
    try {
      applied = await applyOnce(character.id, requestId, 'buy-upgrade', request.log, async (db) => {
        const written = await db.character.updateMany({ where, data })
        if (written.count === 0) {
          // Не сошлось ЛИБО золото, ЛИБО счётчик (кто-то купил это же улучшение
          // параллельно, и цена уже другая). Для игрока это одно и то же действие —
          // обновить данные и решить заново, поэтому код один.
          throw new RouteRejection(409, { error: 'State changed, retry', price })
        }
      })
    } catch (e) {
      if (e instanceof RouteRejection) return reply.status(e.status).send(e.body)
      throw e
    }

    const updated = await prisma.character.findUnique({ where: { userId } })
    if (!updated) {
      request.log.error({ userId }, 'buy-upgrade: character vanished between write and read-back')
      return reply.status(500).send({ error: 'Purchase applied but balance could not be read' })
    }
    return reply.send({
      gold: updated.gold,
      upgrades: upgradesOf(updated),
      ...(applied.replayed ? { replayed: true } : {}),
    })
  })

  // Продажа предмета из инвентаря. Цену считает сервер (itemSellPrice), клиент
  // называет только строку инвентаря.
  //
  // ⚠️ ЕДИНСТВЕННОЕ место в server/src, где нужна ТРАНЗАКЦИЯ: записей две —
  // удаление строки инвентаря и начисление золота, — и порознь они дают либо
  // предмет, проданный бесплатно, либо золото из воздуха. Везде в проекте
  // атомарность держится на том, что запись одна; здесь это невозможно.
  //
  // Условие «не надет» стоит и в проверке до транзакции (чтобы ответить по
  // существу), и в самом deleteMany (чтобы выдержать гонку с надеванием).
  server.post<{ Body: { inventoryItemId?: string } }>('/character/sell-item', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const inventoryItemId = request.body?.inventoryItemId
    if (typeof inventoryItemId !== 'string' || inventoryItemId === '') {
      return reply.status(400).send({ error: 'Invalid inventoryItemId' })
    }

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    const row = await prisma.inventoryItem.findFirst({
      where: { id: inventoryItemId, characterId: character.id },
      include: { item: true },
    })
    // Чужая или несуществующая строка — один ответ намеренно: различать их
    // значило бы подсказывать, какие id существуют у других игроков.
    if (!row) return reply.status(404).send({ error: 'Item not found' })
    if (row.equipped) return reply.status(400).send({ error: 'Item is equipped' })

    const price = itemSellPrice(row.item.tier)

    const goldAfter = await prisma.$transaction(async (tx) => {
      const deleted = await tx.inventoryItem.deleteMany({
        where: { id: inventoryItemId, characterId: character.id, equipped: false },
      })
      // 0 строк — предмет уже продали или успели надеть между чтением и записью.
      // Возвращаем null, золото НЕ начисляем; ничего отменять не нужно, потому
      // что до этого момента транзакция не писала ничего.
      if (deleted.count === 0) return null
      const updated = await tx.character.update({
        where: { id: character.id },
        data: { gold: { increment: price } },
      })
      return updated.gold
    })
    if (goldAfter === null) return reply.status(409).send({ error: 'State changed, retry' })

    return reply.send({ gold: goldAfter, soldPrice: price, inventoryItemId })
  })

  server.get('/character/inventory', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    const inventoryItems = await prisma.inventoryItem.findMany({
      where: { characterId: character.id },
      include: { item: true },
      orderBy: { acquiredAt: 'asc' },
    })

    return reply.send({
      inventory: inventoryItems.map((inv) => ({
        inventoryItemId: inv.id,
        equipped: inv.equipped,
        // Цена продажи — ГОТОВЫМ числом с сервера (itemSellPrice, game.ts), а не
        // формулой на клиенте: копия арифметики разошлась бы с тем, что реально
        // начислит POST /character/sell-item, и кнопка обещала бы не ту сумму.
        sellPrice: itemSellPrice(inv.item.tier),
        item: {
          id: inv.item.id,
          slot: inv.item.slot,
          tier: inv.item.tier,
          nameRu: inv.item.nameRu,
          iconPath: inv.item.iconPath,
          levelRequired: inv.item.levelRequired,
          damage: inv.item.damage,
          armor: inv.item.armor,
          moveSpeed: inv.item.moveSpeed,
          luck: inv.item.luck,
        },
      })),
    })
  })

  server.post<{ Body: { inventoryItemId?: unknown; equip?: unknown } | null }>('/character/equip', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    // Тело проверяется явно (15.10.2026): раньше недостающий или нестроковый id
    // доходил до Prisma и отвечал 500 с её внутренним текстом.
    const inventoryItemId = request.body?.inventoryItemId
    const equip = request.body?.equip
    if (typeof inventoryItemId !== 'string' || inventoryItemId === '') {
      return reply.status(400).send({ error: 'Invalid inventoryItemId' })
    }
    if (typeof equip !== 'boolean') {
      return reply.status(400).send({ error: 'Invalid equip' })
    }

    // level больше не колонка в БД — вычисляется на месте из статов+бонуса
    // (см. game.ts calculateLevel), никогда не читается напрямую.
    const characterLevel = calculateLevel(character.strength, character.agility, character.endurance, character.bonusLevels)

    // Всё — одной транзакцией под блокировкой строки персонажа (15.10.2026):
    //   • снятие кладёт предмет в сумку, и место в ней проверяет СЕРВЕР —
    //     раньше это делал только клиент (гасил «Снять» при полной сумке), и
    //     изменённый клиент переполнял сумку;
    //   • надевание — две записи (снять старый, надеть новый), и порознь они
    //     могли оставить слот пустым или, при двух надеваниях сразу, с двумя
    //     предметами.
    type EquipOutcome =
      | { kind: 'ok'; equippedItemId: string | null; unequippedItemId: string | null }
      | { kind: 'reject'; status: number; error: string }
    const outcome = await prisma.$transaction(async (tx): Promise<EquipOutcome> => {
      await lockCharacterRow(tx, userId)
      const inventoryItem = await tx.inventoryItem.findUnique({
        where: { id: inventoryItemId },
        include: { item: true },
      })
      if (!inventoryItem || inventoryItem.characterId !== character.id) {
        return { kind: 'reject', status: 404, error: 'Inventory item not found' }
      }

      if (equip) {
        if (characterLevel < inventoryItem.item.levelRequired) {
          return { kind: 'reject', status: 400, error: 'Недостаточный уровень' }
        }
        // Предмет из сумки уходит в слот, прежний из слота — в сумку: ячеек
        // столько же, проверять вместимость не нужно.
        const currentlyEquipped = await tx.inventoryItem.findFirst({
          where: { characterId: character.id, equipped: true, item: { slot: inventoryItem.item.slot } },
        })
        if (currentlyEquipped) {
          await tx.inventoryItem.update({ where: { id: currentlyEquipped.id }, data: { equipped: false } })
        }
        await tx.inventoryItem.update({ where: { id: inventoryItem.id }, data: { equipped: true } })
        return { kind: 'ok', equippedItemId: inventoryItem.id, unequippedItemId: currentlyEquipped ? currentlyEquipped.id : null }
      }

      // Снятие: надетый предмет займёт ячейку. Текст отказа — по-русски, как
      // «Недостаточный уровень» выше: клиент показывает 400 этой ручки как есть.
      if (inventoryItem.equipped) {
        const fresh = await tx.character.findUnique({ where: { userId } })
        if (!fresh) return { kind: 'reject', status: 404, error: 'Character not found' }
        if (await bagCellsUsed(tx, fresh.id, consumableStockOf(fresh), classItemStockOf(fresh)) >= BAG_CAPACITY) {
          return { kind: 'reject', status: 400, error: 'Сумка полна — освободи ячейку.' }
        }
      }
      await tx.inventoryItem.update({ where: { id: inventoryItem.id }, data: { equipped: false } })
      return { kind: 'ok', equippedItemId: null, unequippedItemId: inventoryItem.id }
    })

    if (outcome.kind === 'reject') return reply.status(outcome.status).send({ error: outcome.error })
    return reply.send({
      success: true,
      equippedItemId: outcome.equippedItemId,
      unequippedItemId: outcome.unequippedItemId,
    })
  })
}