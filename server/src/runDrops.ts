// Дроп за забег: что выпадает из закрытых событий на финише.
//
// ЧИСТЫЙ модуль — ни DB, ни HTTP, как game.ts и runState.ts. Здесь живут ВСЕ
// шансы и доли дропа (одним местом, по условию задачи) и сам розыгрыш; тот, кто
// превращает выпавшее в записи БД, — POST /run/finish-explore (routes/run.ts).
//
// ⚠️ Дроп разыгрывает СЕРВЕР и только он. Своей копии шансов у клиента нет и
// быть не должно — иначе получилось бы то же расхождение, что было у всплывашек
// с трофеями: клиент показывал одно, сервер начислял другое.
//
// ⚠️ БРОСОК ПЕРЕЕХАЛ НА СТАРТ ЗАБЕГА (30.09.2026). Раньше он делался на финише,
// и клиенту до конца забега показывать было нечего. Теперь /run/start-explore
// разыгрывает добычу КАЖДОГО события сразу, кладёт её в currentRun.events и
// отдаёт клиенту — чтобы в момент закрытия события всплыли РЕАЛЬНЫЕ трофеи и
// РЕАЛЬНЫЙ предмет, а не клиентская выдумка. Решение дизайнера: взломанный
// клиент может узнать добычу заранее, и это принято.
//
// ⚠️ Предмет снаряжения ВЫБИРАЕТСЯ ИМЕННО НА СТАРТЕ, конкретной строкой каталога,
// а не «слотом, который доберут на финише». Иначе иконка во всплывашке (она
// зависит от слота И ТИРА) могла бы не совпасть с тем, что реально выдадут.
//
// Начисление при этом осталось на финише и в ТОЙ ЖЕ записи, что закрывает
// забег: только там известно, какие события закрыты, и только так повтор финиша
// не выдаёт добычу дважды.

import type { RunEvent, RunEventKind } from './runEvents.js'
import { POTION_TIERS } from './potions.js'
import { SCROLLS, type ScrollId } from './scrolls.js'
import { SKILL_BOOK_IDS, type SkillBookId } from './consumables.js'

/**
 * Бросок 1 — выпало ли ВООБЩЕ что-нибудь с этого события, до поправки на удачу.
 *
 * Record по ВСЕМ видам событий, а не Partial с «остальное ноль»: шестой вид
 * события без строки здесь не скомпилируется, и забыть назначить ему шанс
 * невозможно. Именно так уже ошиблись бы на puzzle — у него дропа нет, и это
 * решение, а не пропуск.
 *
 * smuggler: 0 — Контрабандист исключён из дропа ПО УСЛОВИЮ ЗАДАЧИ. Ноль здесь
 * дублируется явной проверкой в rollRunDrops (событие сделки пропускается по
 * kind), и это не избыточность: ноль в таблице — «шанс такой», проверка —
 * «этого события в дропе нет вовсе», и путать их нельзя, если шанс когда-нибудь
 * поднимут.
 */
export const DROP_CHANCE_BY_KIND: Record<RunEventKind, number> = {
  enemy: 0.5,
  chest: 1,
  obelisk: 1,
  boss: 0.5,
  puzzle: 0,
  smuggler: 0,
}

/**
 * Сколько шанса дропа даёт ОДНА единица удачи: +1% относительно базового шанса
 * (шанс × (1 + 0.01 × luck)), а не +1 процентный пункт.
 *
 * ⚠️ Это ПЕРВОЕ место в server/src, которое вообще читает Character.luck: до
 * 30.09.2026 колонка не читалась и не писалась нигде (см. CLAUDE.md). Источника
 * удачи в игре по-прежнему нет — её даёт только амулет, а надетые предметы в
 * этот расчёт не входят, — поэтому у живого игрока множитель сейчас всегда
 * ровно 1. Формула заведена сразу, чтобы появившийся источник удачи не требовал
 * второй правки дропа.
 */
export const DROP_LUCK_PER_POINT = 0.01

/** Потолок шанса. Сундук и обелиск уже на нём, удача их не переполняет. */
export const DROP_CHANCE_MAX = 1

/** Что именно выпало. Четыре категории — бросок 2. */
export type DropCategory = 'equipment' | 'scroll' | 'potion' | 'book'

/**
 * Бросок 2 — ЧТО выпало, весами. Не долями и не процентами: веса складываются в
 * 100 у обеих таблиц, но проверять это равенство код не обязан — бросок идёт по
 * сумме, какой бы она ни была, и правка одного веса не требует пересчёта
 * остальных.
 *
 * Две таблицы, потому что у босса книга ЦЕННЕЕ (10 против 3), а страница
 * соответственно реже: босс редок и должен ощущаться ценным (Design Decisions,
 * «Философия босса»). Снаряжение и зелье у обоих одинаковы намеренно — их доля
 * от редкости источника не зависит.
 */
export const DROP_WEIGHTS_COMMON: Record<DropCategory, number> = {
  equipment: 20,
  scroll: 47,
  potion: 30,
  book: 3,
}
export const DROP_WEIGHTS_BOSS: Record<DropCategory, number> = {
  equipment: 20,
  scroll: 40,
  potion: 30,
  book: 10,
}

/**
 * Шесть слотов снаряжения — те же строки, что в Item.slot (схема объявляет его
 * свободной строкой, не enum) и в HERO_SLOTS на клиенте.
 *
 * Список ЗДЕСЬ, а не запросом «какие слоты вообще бывают» к БД: слот выбирается
 * равновероятно, и равновероятность по фактически существующим строкам молча
 * перекосилась бы, если бы в каталоге у одного слота оказалось больше записей.
 */
export const EQUIPMENT_SLOTS = ['weapon', 'helmet', 'armor', 'gloves', 'boots', 'amulet'] as const
export type EquipmentSlot = typeof EQUIPMENT_SLOTS[number]

/**
 * Тир, который выпадает даже тогда, когда по уровню не открыт НИ ОДИН.
 *
 * У предметов levelRequired = тир × 5, то есть до 5 уровня открытых тиров нет
 * вовсе, и без этого пола каждый пятый бросок (вес снаряжения 20 из 100) у
 * нового игрока уходил бы в пустоту — молча, без единой строки в ответе. Пол
 * ровно один тир: предмет падает, но НАДЕТЬ его получится только с 5 уровня
 * (порог проверяет POST /character/equip и не меняется этим решением). Падение
 * и надевание — разные права, и связывать их одним порогом незачем.
 */
export const ITEM_DROP_FLOOR_TIER = 1

/**
 * Что выпало, ДО выбора конкретной строки каталога. Снаряжение названо только
 * слотом: строку выбирает тот, у кого есть БД (resolveDropIntents в
 * routes/run.ts), по уровню героя — иначе правило «тир не выше открытого по
 * уровню» пришлось бы повторить здесь вторым экземпляром levelRequired.
 *
 * Промежуточный тип: наружу (в currentRun и клиенту) уезжает уже EventDrop.
 */
export type DropIntent =
  | { category: 'equipment'; slot: EquipmentSlot }
  | { category: 'scroll'; scrollId: ScrollId }
  | { category: 'potion'; tier: number }
  | { category: 'book'; bookId: SkillBookId }

/**
 * Что выпало, УЖЕ разрешённое до конкретной вещи. Это форма, которая живёт в
 * `currentRun.events[i].drop` и (без itemId) уезжает клиенту.
 *
 * `itemId` — строка таблицы Item, выбранная НА СТАРТЕ. Клиенту она не нужна и не
 * отдаётся: ему хватает slot+tier, чтобы собрать путь к иконке (itemIconSrc), а
 * имя нужно только экрану итогов. Финишу она нужна, чтобы создать
 * InventoryItem РОВНО ТОТ, что показали игроку.
 */
export type EventDrop =
  | { category: 'equipment'; itemId: string; nameRu: string; slot: string; tier: number }
  | { category: 'scroll'; id: ScrollId }
  | { category: 'potion'; tier: number }
  | { category: 'book'; id: SkillBookId }

/** Равновероятный выбор одного элемента. Пустой список — null, не исключение. */
function pickOne<T>(items: readonly T[]): T | null {
  if (items.length === 0) return null
  return items[Math.floor(Math.random() * items.length)]
}

/**
 * Шанс дропа с одного события С УЧЁТОМ удачи, срезанный потолком.
 *
 * Отдельной экспортируемой функцией, а не выражением внутри цикла: ровно это
 * число захотят проверить, когда начнут спорить о балансе дропа.
 */
export function dropChanceFor(kind: RunEventKind, luck: number): number {
  const base = DROP_CHANCE_BY_KIND[kind]
  // Отрицательная или нечисловая удача не должна СНИЖАТЬ шанс ниже базового и не
  // должна давать NaN: колонка luck ничем не ограничена в схеме.
  const luckMult = Number.isFinite(luck) ? 1 + Math.max(0, luck) * DROP_LUCK_PER_POINT : 1
  return Math.min(DROP_CHANCE_MAX, base * luckMult)
}

/** Категория по весам: бросок по сумме весов, первый превышенный порог. */
function pickCategory(weights: Record<DropCategory, number>): DropCategory | null {
  const entries = Object.entries(weights) as [DropCategory, number][]
  const total = entries.reduce((sum, [, w]) => sum + Math.max(0, w), 0)
  if (!(total > 0)) return null
  let roll = Math.random() * total
  for (const [category, weight] of entries) {
    roll -= Math.max(0, weight)
    if (roll < 0) return category
  }
  // Недостижимо при total > 0, но возвращать «первую попавшуюся» молча нельзя —
  // пусть вызывающий увидит null и решит сам.
  return null
}

/**
 * Что выпало внутри категории. Всё по ОДНОЙ штуке, выбор равновероятный.
 *
 * Уровень нужен зельям (свой levelRequired у каждого тира) и не нужен
 * снаряжению — там открытость тира решает БД, см. DropIntent выше.
 */
function rollWithinCategory(category: DropCategory, level: number): DropIntent | null {
  switch (category) {
    case 'equipment': {
      const slot = pickOne(EQUIPMENT_SLOTS)
      return slot === null ? null : { category: 'equipment', slot }
    }
    case 'scroll': {
      const scroll = pickOne(SCROLLS)
      return scroll === null ? null : { category: 'scroll', scrollId: scroll.id }
    }
    case 'potion': {
      // «Любой открытый тир» — по levelRequired КАТАЛОГА, не по номеру тира: у
      // зелий пороги 1/5/10/20/30, а не тир × 5, и арифметикой их не угадать.
      // Тир 1 открыт с первого уровня, поэтому пустым список быть не может, и
      // пола, как у снаряжения, здесь не нужно.
      const open = POTION_TIERS.filter((t) => t.levelRequired <= level)
      const tier = pickOne(open)
      return tier === null ? null : { category: 'potion', tier: tier.tier }
    }
    case 'book': {
      const bookId = pickOne(SKILL_BOOK_IDS)
      return bookId === null ? null : { category: 'book', bookId: bookId as SkillBookId }
    }
  }
}

/**
 * Два броска для ОДНОГО события: выпало ли вообще и что именно.
 *
 * Контрабандист исключается ПО ВИДУ события, а не по индексу: у него свой
 * обмен, и добыча с него дизайном не предусмотрена. Загадке шанс 0 назначен в
 * таблице выше — это решение, а не пропуск.
 *
 * null — ничего не выпало. Самый частый исход (с группы врагов — половина
 * бросков), и вызывающий обязан считать его нормой, а не сбоем.
 */
export function rollEventDrop(kind: RunEventKind, level: number, luck: number): DropIntent | null {
  if (kind === 'smuggler') return null
  if (!(Math.random() < dropChanceFor(kind, luck))) return null
  const weights = kind === 'boss' ? DROP_WEIGHTS_BOSS : DROP_WEIGHTS_COMMON
  const category = pickCategory(weights)
  if (category === null) return null
  return rollWithinCategory(category, level)
}

/**
 * Разбор добычи, ПРОЧИТАННОЙ из currentRun.events[i].drop.
 *
 * Колонка currentRun объявлена `Json?`, схема её содержимое не проверяет ничем,
 * поэтому сохранённая добыча перепроверяется по каталогам — ровно та же
 * дисциплина, что у readConsumablesUsed и readSmugglerDeal (runState.ts):
 * испорченное извне поле не должно дать предмет, которого игрок не выбивал.
 *
 * Три состояния, и они РАЗНЫЕ:
 *   'none'      — поле есть и равно null: бросок был, ничего не выпало;
 *   'drop'      — годная добыча;
 *   'malformed' — поле есть, но не разбирается.
 * Отсутствие поля (`undefined`) — НЕ состояние этой функции: оно означает забег,
 * начатый старым сервером, и решается выше по стеку (см. storedEventDrops).
 */
export function parseEventDrop(raw: unknown): { kind: 'none' } | { kind: 'drop'; drop: EventDrop } | { kind: 'malformed' } {
  if (raw === null) return { kind: 'none' }
  if (typeof raw !== 'object') return { kind: 'malformed' }
  const d = raw as Record<string, unknown>
  switch (d.category) {
    case 'equipment':
      if (typeof d.itemId !== 'string' || d.itemId === '') return { kind: 'malformed' }
      if (typeof d.nameRu !== 'string' || typeof d.slot !== 'string') return { kind: 'malformed' }
      if (!Number.isInteger(d.tier)) return { kind: 'malformed' }
      return { kind: 'drop', drop: { category: 'equipment', itemId: d.itemId, nameRu: d.nameRu, slot: d.slot, tier: d.tier as number } }
    case 'scroll': {
      // По КАТАЛОГУ, а не «строка непустая»: подменённый id иначе дал бы
      // страницу, которой нет, и свалил бы switch по колонкам на финише.
      const spec = typeof d.id === 'string' ? SCROLLS.find((x) => x.id === d.id) : undefined
      return spec === undefined ? { kind: 'malformed' } : { kind: 'drop', drop: { category: 'scroll', id: spec.id } }
    }
    case 'book': {
      const known = typeof d.id === 'string' && (SKILL_BOOK_IDS as readonly string[]).includes(d.id)
      return known ? { kind: 'drop', drop: { category: 'book', id: d.id as SkillBookId } } : { kind: 'malformed' }
    }
    case 'potion': {
      const spec = POTION_TIERS.find((t) => t.tier === d.tier)
      return spec === undefined ? { kind: 'malformed' } : { kind: 'drop', drop: { category: 'potion', tier: spec.tier } }
    }
    default:
      return { kind: 'malformed' }
  }
}

/**
 * Розыгрыш добычи за забег: по два броска на КАЖДОЕ закрытое событие.
 *
 * `closed` — уже провалидированные индексы событий (parseClosedEventIndices в
 * routes/run.ts), те же самые, по которым считаются трофеи: два разных набора
 * дали бы добычу с события, за которое не начислены трофеи.
 *
 * Контрабандист исключается ПО ВИДУ события, а не по индексу: у него свой
 * обмен, и добыча с него дизайном не предусмотрена.
 *
 * Смерть на результат НЕ влияет и в аргументах не участвует вовсе — добыча
 * начисляется и при died (решение дизайнера: сгорают только трофеи, см.
 * docs/items.md, «ВЫПАДЕНИЕ ПРЕДМЕТОВ»). Отсутствие параметра здесь и есть
 * гарантия, что кто-то не начнёт «учитывать смерть» по месту.
 *
 * ⚠️ ЭТО ЗАПАСНОЙ ПУТЬ (с 30.09.2026). Забеги, начатые новым сервером, несут
 * добычу в самих событиях (`drop`), и финиш берёт её оттуда — иначе он бросил бы
 * кости второй раз и выдал НЕ ТО, что игрок видел во всплывашках. Эта функция
 * остаётся для забегов, НАЧАТЫХ СТАРЫМ СЕРВЕРОМ: у их событий поля `drop` нет
 * вовсе, и другого способа что-то им начислить нет. Удалять её можно будет
 * только когда такие забеги заведомо закончились.
 */
export function rollRunDrops(
  events: RunEvent[],
  closed: number[],
  level: number,
  luck: number,
): DropIntent[] {
  const out: DropIntent[] = []
  for (const index of closed) {
    const event = events[index]
    if (!event) continue
    const intent = rollEventDrop(event.kind, level, luck)
    if (intent !== null) out.push(intent)
  }
  return out
}
