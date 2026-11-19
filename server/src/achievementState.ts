// Достижения (20.11.2026, docs/achievements.md) — запись в базу.
//
// grantRunAchievements зовёт ТОЛЬКО settleExploreRun (routes/run.ts), внутри
// ТОЙ ЖЕ транзакции, что закрывает забег, после условной записи и после
// addHeroStats. Поэтому повтор финиша награду второй раз не выдаст: он либо
// получит сохранённый итог по ключу `finish:<runId>`, либо упрётся в пустой
// currentRun, и до этого места не дойдёт вовсе. Вторая страховка —
// unique(characterId, key) в таблице Achievement.
//
// Предметы, которые занимают ячейку, подчиняются вместимости (bagFits). Не
// влезло — достижение всё равно получено, но rewardPending = true: награда
// целиком ждёт «Забрать» (claimAchievementReward, POST /achievements/claim).
import type { Character, Prisma } from '@prisma/client'
import { bagCapacity, bagFits } from './consumables.js'
import { calculateLevel } from './game.js'
import { classItemStockOf, consumableStockOf } from './runState.js'
import { bagCellsUsed, consumableStockIncrement } from './routes/run.js'
import {
  achievementByKey,
  achievementView,
  newAchievements,
  rewardCells,
  type AchievementReward,
  type AchievementRunFacts,
  type AchievementSpec,
  type AchievementView,
} from './achievements.js'

/** Новое за вылазку — то, что уходит в ответ финиша (`achievements`). */
export type AchievementGrant = AchievementView

/**
 * Данные записи наград поверх снимка `ch` (прочитанного под блокировкой строки).
 * Статы — абсолютными числами от снимка и уровень — calculateLevel заново, как
 * после финиша; удача не уходит ниже нуля. Остальное — increment'ами.
 */
function rewardsData(ch: Character, rewards: readonly AchievementReward[]): Prisma.CharacterUpdateInput {
  const sum = { strength: 0, agility: 0, endurance: 0, luck: 0 }
  let bagCells = 0
  let patches = 0
  const runes = { attack: 0, armor: 0, luck: 0 }
  const items = new Map<string, number>()
  for (const r of rewards) {
    for (const [k, v] of Object.entries(r.stats ?? {})) sum[k as keyof typeof sum] += v ?? 0
    bagCells += r.bagCells ?? 0
    patches += r.patches ?? 0
    for (const [k, v] of Object.entries(r.runes ?? {})) runes[k as keyof typeof runes] += v ?? 0
    for (const it of r.items ?? []) items.set(it.id, (items.get(it.id) ?? 0) + it.count)
  }
  const data: Prisma.CharacterUpdateInput = {}
  const statsChanged = sum.strength !== 0 || sum.agility !== 0 || sum.endurance !== 0
  if (statsChanged) {
    const strength = ch.strength + sum.strength
    const agility = ch.agility + sum.agility
    const endurance = ch.endurance + sum.endurance
    Object.assign(data, { strength, agility, endurance, level: calculateLevel(strength, agility, endurance, ch.bonusLevels) })
  }
  if (sum.luck !== 0) data.luck = Math.max(0, ch.luck + sum.luck)
  if (bagCells > 0) data.bagBonusCells = { increment: bagCells }
  if (patches > 0) data.patchCount = { increment: patches }
  if (runes.attack > 0) data.runeAttack = { increment: runes.attack }
  if (runes.armor > 0) data.runeArmor = { increment: runes.armor }
  if (runes.luck > 0) data.runeLuck = { increment: runes.luck }
  for (const [id, count] of items) Object.assign(data, consumableStockIncrement(id as Parameters<typeof consumableStockIncrement>[0], count))
  return data
}

/**
 * Проверить и выдать достижения этой вылазки. Внутри транзакции settleExploreRun,
 * под блокировкой строки персонажа, ПОСЛЕ основной записи финиша и addHeroStats.
 */
export async function grantRunAchievements(
  tx: Prisma.TransactionClient,
  userId: number,
  characterId: number,
  run: AchievementRunFacts,
): Promise<AchievementGrant[]> {
  const statsRow = await tx.heroStats.findUnique({ where: { characterId } })
  if (statsRow === null) return []
  const earnedRows = await tx.achievement.findMany({ where: { characterId }, select: { key: true } })
  const fresh = newAchievements(new Set(earnedRows.map((r) => r.key)), statsRow, run)
  if (fresh.length === 0) return []

  const ch = await tx.character.findUnique({ where: { userId } })
  if (!ch) return []
  // Ячейки, подаренные этим же заходом, считаются сразу: «+1 ячейка» и книги в
  // одной вылазке — книги уже в новую вместимость.
  const capacity = bagCapacity(ch.bagBonusCells + fresh.reduce((s, a) => s + (a.reward.bagCells ?? 0), 0))
  let used = fresh.some((a) => rewardCells(a.reward) > 0)
    ? await bagCellsUsed(tx, characterId, consumableStockOf(ch), classItemStockOf(ch))
    : 0
  const granted: AchievementSpec[] = []
  const pending: AchievementSpec[] = []
  for (const a of fresh) {
    const need = rewardCells(a.reward)
    if (need > 0 && !bagFits(used, need, capacity)) {
      pending.push(a)
      continue
    }
    used += need
    granted.push(a)
  }
  const data = rewardsData(ch, granted.map((a) => a.reward))
  if (Object.keys(data).length > 0) await tx.character.update({ where: { userId }, data })
  const now = new Date()
  const out: AchievementGrant[] = []
  for (const a of fresh) {
    const rewardPending = pending.includes(a)
    await tx.achievement.create({ data: { characterId, key: a.key, earnedAt: now, rewardPending } })
    const view = achievementView({ key: a.key, earnedAt: now, rewardPending })
    if (view) out.push(view)
  }
  return out
}

export type ClaimOutcome =
  | { kind: 'ok'; replayed: boolean }
  | { kind: 'reject'; status: number; body: Record<string, unknown> }

/**
 * Забрать отложенную награду (POST /achievements/claim). Под блокировкой строки;
 * влезть должна ВСЯ награда. Повтор безопасен: награда уже выдана — ok/replayed,
 * ничего не пишется (условная запись по rewardPending: true).
 */
export async function claimAchievementReward(
  tx: Prisma.TransactionClient,
  userId: number,
  key: string,
): Promise<ClaimOutcome> {
  const spec = achievementByKey(key)
  if (!spec) return { kind: 'reject', status: 400, body: { error: 'Unknown achievement' } }
  const ch = await tx.character.findUnique({ where: { userId } })
  if (!ch) return { kind: 'reject', status: 404, body: { error: 'Character not found' } }
  // Статы финиш пишет абсолютом со снимка — забирать в вылазке нельзя (правило
  // Ловчего, CLAUDE.md). Меню в забеге закрыто, это страховка.
  if (ch.currentRun !== null) return { kind: 'reject', status: 400, body: { error: 'Run in progress' } }
  const row = await tx.achievement.findUnique({ where: { characterId_key: { characterId: ch.id, key } } })
  if (!row) return { kind: 'reject', status: 404, body: { error: 'Achievement not earned' } }
  if (!row.rewardPending) return { kind: 'ok', replayed: true }
  const need = rewardCells(spec.reward)
  const capacity = bagCapacity(ch.bagBonusCells + (spec.reward.bagCells ?? 0))
  if (need > 0) {
    const used = await bagCellsUsed(tx, ch.id, consumableStockOf(ch), classItemStockOf(ch))
    if (!bagFits(used, need, capacity)) {
      return { kind: 'reject', status: 400, body: { error: 'Bag is full', used, need, free: Math.max(0, capacity - used) } }
    }
  }
  const flipped = await tx.achievement.updateMany({ where: { id: row.id, rewardPending: true }, data: { rewardPending: false } })
  if (flipped.count === 0) return { kind: 'ok', replayed: true }
  const data = rewardsData(ch, [spec.reward])
  if (Object.keys(data).length > 0) await tx.character.update({ where: { userId }, data })
  return { kind: 'ok', replayed: false }
}
