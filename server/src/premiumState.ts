// «Печать Колокола» на сервере (25.11.2026, docs/premium.md): то, что нужно
// только серверу поверх общего каталога premium.ts. Активен ли премиум — ТОЛЬКО
// isPremium из premium.ts; здесь — обёртки для мест, где премиум меняет расчёт.
import { bagCapacity } from './consumables.js'
import { isPremium, premiumBagCells, PREMIUM_STAT_GROWTH_MULT, type PremiumUntil } from './premium.js'

type PremiumHolder = { premiumUntil?: PremiumUntil }

/**
 * Вместимость сумки героя СЕЙЧАС: базовая + ячейки достижений и покупок +
 * премиум. Её зовут все пути в сумку (финиш, покупки, склад гильдии…) — голый
 * bagCapacity(bonusCells, 0) отнял бы у героя с премиумом 10 ячеек.
 */
export function heroBagCapacity(ch: PremiumHolder & { bagBonusCells: number }, nowMs: number = Date.now()): number {
  return bagCapacity(ch.bagBonusCells, premiumBagCells(isPremium(ch, nowMs)))
}

/**
 * Премиум ЭТОГО забега: снимок старта (currentRun.premium) ИЛИ премиум сейчас.
 * Снимок — чтобы забег, начатый с печатью, не терял бонусы, если она угасла
 * посреди вылазки; «сейчас» — чтобы забег, начатый до покупки на втором
 * устройстве, их получил. Оба пути — через isPremium.
 */
export function runPremium(run: { premium?: unknown }, ch: PremiumHolder, nowMs: number): boolean {
  return run.premium === true || isPremium(ch, nowMs)
}

/**
 * Входы роста статов (applyStatGrowth) — ОДНА функция для финиша и для входа
 * (брошенный забег). Множитель премиума — ПОСЛЕ потолков clampRunProgress:
 * потолки ограничивают, сколько урона и лечения забег мог дать, а печать
 * удваивает рост от честного числа.
 */
export function statGrowthInputs(
  progress: { attackDamageDealt: number; damageTaken: number; skillDamageDealt: number; healedAmount: number },
  premium: boolean,
): { attack: number; taken: number; skill: number } {
  const m = premium ? PREMIUM_STAT_GROWTH_MULT : 1
  return {
    attack: progress.attackDamageDealt * m,
    taken: progress.damageTaken * m,
    skill: (progress.skillDamageDealt + progress.healedAmount) * m,
  }
}
