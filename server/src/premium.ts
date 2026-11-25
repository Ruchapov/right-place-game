// «Печать Колокола» — премиум за RP (25.11.2026, docs/premium.md).
//
// ОБЩИЙ каталог клиента и сервера: src/premium.ts ↔ server/src/premium.ts,
// байт в байт (tools/check_potion_sync.py). Других общих файлов не импортирует —
// как и остальные каталоги этой пары; тиры зелий в premiumGiftTier передаёт
// вызывающий.
//
// Что здесь: цена и срок, числа всех бонусов, единственная проверка «премиум
// активен» (isPremium) и строка «осталось N дн. M ч». Чего здесь нет: записи в
// базу (POST /character/buy-premium, routes/run.ts) и напоминаний бота
// (bot/cron.ts, scanPremium).

/** Цена в RP. */
export const PREMIUM_PRICE_RP = 500
/** Срок одной покупки. Автопродления нет. */
export const PREMIUM_DAYS = 30
export const PREMIUM_MS = PREMIUM_DAYS * 24 * 60 * 60 * 1000

/** Подарок при каждой покупке: столько зелий самого сильного тира, открытого уровню. */
export const PREMIUM_GIFT_POTIONS = 100

/** +25% трофеев живой вылазки (к заработанным в ней, вниз). */
export const PREMIUM_TROPHY_BONUS_FRAC = 0.25
/** Заданий в наборе с премиумом — questSetSize в quests.ts. */
/** Прибавка к удаче (к Character.luck при расчёте, в колонку не пишется). */
export const PREMIUM_LUCK = 5
/** Прибавка ячеек сумки. */
export const PREMIUM_BAG_CELLS = 10
/** Шанс появления босса на картах с боссом (без премиума — BOSS_SPAWN_CHANCE, 0.3). */
export const PREMIUM_BOSS_SPAWN_CHANCE = 0.6
/** Множитель прокачки силы, выносливости и ловкости (после потолков). */
export const PREMIUM_STAT_GROWTH_MULT = 2

/** Срок премиума героя: Date (сервер, Prisma), ISO-строка или мс (клиент), null — не было. */
export type PremiumUntil = Date | string | number | null | undefined

function untilMs(until: PremiumUntil): number | null {
  if (until === null || until === undefined) return null
  const ms = until instanceof Date ? until.getTime() : typeof until === 'string' ? Date.parse(until) : until
  return typeof ms === 'number' && Number.isFinite(ms) ? ms : null
}

/**
 * ЕДИНСТВЕННАЯ проверка «премиум активен». Её читают все бонусы — сервер и
 * клиент; своей проверки срока по месту быть не должно.
 */
export function isPremium(ch: { premiumUntil?: PremiumUntil }, nowMs: number): boolean {
  const ms = untilMs(ch.premiumUntil)
  return ms !== null && ms > nowMs
}

/** Сколько мс осталось (0 — не активен). */
export function premiumLeftMs(ch: { premiumUntil?: PremiumUntil }, nowMs: number): number {
  const ms = untilMs(ch.premiumUntil)
  return ms === null ? 0 : Math.max(0, ms - nowMs)
}

/** «12 дн. 4 ч», «5 ч 30 мин» в последние сутки, «меньше минуты». */
export function premiumLeftLine(leftMs: number): string {
  const min = Math.floor(leftMs / 60000)
  const d = Math.floor(min / (24 * 60))
  const h = Math.floor((min % (24 * 60)) / 60)
  const m = min % 60
  if (d > 0) return `${d} дн. ${h} ч`
  if (h > 0) return `${h} ч ${m} мин`
  if (m > 0) return `${m} мин`
  return 'меньше минуты'
}

/**
 * Тир подарка: индекс самого сильного тира, чей порог уровня не выше уровня
 * героя. levelRequired — пороги тиров по порядку (POTION_TIERS.map(t => t.levelRequired)).
 */
export function premiumGiftTier(level: number, levelRequired: readonly number[]): number {
  let best = 0
  for (let i = 0; i < levelRequired.length; i++) if (levelRequired[i] <= level) best = i
  return best
}

/** Прибавка трофеев за живую вылазку с премиумом: вниз, только к заработанному. */
export function premiumTrophyBonus(earned: number, premium: boolean): number {
  return premium && earned > 0 ? Math.floor(earned * PREMIUM_TROPHY_BONUS_FRAC) : 0
}

/** Удача с прибавкой премиума. */
export function premiumLuck(luck: number, premium: boolean): number {
  return luck + (premium ? PREMIUM_LUCK : 0)
}

/** Ячейки сумки сверх базовых от премиума. */
export function premiumBagCells(premium: boolean): number {
  return premium ? PREMIUM_BAG_CELLS : 0
}
