// Летопись героя (17.11.2026): общие счётчики за всё время — таблица HeroStats,
// 1:1 с Character. Пишет их ТОЛЬКО settleExploreRun (routes/run.ts) в той же
// транзакции, что закрывает забег: upsert + increment. Повтор финиша второй раз
// не считает — запись стоит после условного updateMany по currentRun, а повтор
// по ключу `finish:<runId>` до settleExploreRun вовсе не доходит.
//
// ⚠️ Вход, закрывший брошенный забег СМЕРТЬЮ (closeRunIfStillOpen, auth.ts),
// сюда НЕ пишет — по условию задачи пишет только settleExploreRun. Вход,
// закрывший забег ПРОЙДЕННЫМ по снимку, идёт через settleExploreRun и пишет.
//
// Что отдаётся клиенту — HeroStatsView (копия типа — в src/api.ts). Строки нет
// — нули и since: null («летопись начнётся с первой вылазки»).
import type { Prisma, PrismaClient, HeroStats } from '@prisma/client'

export type HeroStatsView = {
  runsTotal: number
  runsCompleted: number
  runsDied: number
  killsTotal: number
  killsElite: number
  bossesKilled: number
  chestsOpened: number
  breakablesBroken: number
  potionsDrunk: number
  parries: number
  trophiesEarned: number
  questsCompleted: number
  timeInRunsMs: number
  /** С какого момента ведётся летопись (ISO); null — строки ещё нет. */
  since: string | null
}

/**
 * Прибавка одного забега — то, что settleExploreRun кладёт increment'ами.
 * trapDeaths (20.11.2026) — смерть от ловушки или шипов; клиенту в летописи не
 * отдаётся: по нему считается тайное достижение trap_10 (achievements.ts).
 */
export type HeroStatsDelta = Omit<HeroStatsView, 'since'> & { trapDeaths: number }

const ZERO: Omit<HeroStatsView, 'since'> = {
  runsTotal: 0, runsCompleted: 0, runsDied: 0,
  killsTotal: 0, killsElite: 0, bossesKilled: 0,
  chestsOpened: 0, breakablesBroken: 0, potionsDrunk: 0, parries: 0,
  trophiesEarned: 0, questsCompleted: 0, timeInRunsMs: 0,
}

export function heroStatsView(row: HeroStats | null): HeroStatsView {
  if (row === null) return { ...ZERO, since: null }
  return {
    runsTotal: row.runsTotal,
    runsCompleted: row.runsCompleted,
    runsDied: row.runsDied,
    killsTotal: row.killsTotal,
    killsElite: row.killsElite,
    bossesKilled: row.bossesKilled,
    chestsOpened: row.chestsOpened,
    breakablesBroken: row.breakablesBroken,
    potionsDrunk: row.potionsDrunk,
    parries: row.parries,
    trophiesEarned: row.trophiesEarned,
    questsCompleted: row.questsCompleted,
    // BigInt в JSON не уходит; часы в вылазках до 2^53 мс не дорастут.
    timeInRunsMs: Number(row.timeInRunsMs),
    since: row.createdAt.toISOString(),
  }
}

/** Счётчики героя для ответа (вход, профиль, финиш, руна). */
export async function heroStatsOf(db: PrismaClient | Prisma.TransactionClient, characterId: number): Promise<HeroStatsView> {
  return heroStatsView(await db.heroStats.findUnique({ where: { characterId } }))
}

/** Положить прибавку забега: строки нет — создаётся с ней, есть — increment. */
export async function addHeroStats(tx: Prisma.TransactionClient, characterId: number, d: HeroStatsDelta): Promise<void> {
  const increment = Object.fromEntries(
    (Object.keys(d) as (keyof HeroStatsDelta)[]).map((k) => [k, { increment: k === 'timeInRunsMs' ? BigInt(d[k]) : d[k] }]),
  ) as Prisma.HeroStatsUpdateInput
  await tx.heroStats.upsert({
    where: { characterId },
    create: { characterId, ...d, timeInRunsMs: BigInt(d.timeInRunsMs) },
    update: increment,
  })
}
