// Ручки достижений (20.11.2026, docs/achievements.md):
//   GET  /achievements        — полученные (новые сверху), титул, ячейки сумки;
//   POST /achievements/claim  — забрать награду, не влезшую в сумку;
//   POST /achievements/title  — выбрать титул из полученных или снять его.
// Выдаёт достижения не эта ручка, а финиш (settleExploreRun, routes/run.ts).
// Каталог условий клиенту не уходит: все достижения тайные.
import { FastifyInstance, FastifyReply } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { achievementView, achievementByKey, type AchievementView } from '../achievements.js'
import { claimAchievementReward } from '../achievementState.js'
import { consumableStockOf, runesOf } from '../runState.js'
import { getUserId, lockCharacterRow } from './run.js'

const prisma = new PrismaClient()

/** Полное состояние достижений героя — ответ всех трёх ручек. */
async function sendAchievements(reply: FastifyReply, userId: number, extra: Record<string, unknown> = {}) {
  const character = await prisma.character.findUnique({ where: { userId } })
  if (!character) return reply.status(404).send({ error: 'Character not found' })
  const rows = await prisma.achievement.findMany({ where: { characterId: character.id }, orderBy: [{ earnedAt: 'desc' }, { id: 'desc' }] })
  const list = rows.map(achievementView).filter((v): v is AchievementView => v !== null)
  return reply.send({
    achievements: list,
    bagBonusCells: character.bagBonusCells,
    // После «Забрать» — склад, руны, статы и нашивки: награда могла изменить всё.
    consumables: consumableStockOf(character),
    runes: runesOf(character),
    luck: character.luck,
    strength: character.strength,
    agility: character.agility,
    endurance: character.endurance,
    level: character.level,
    patchCount: character.patchCount,
    ...extra,
  })
}

export async function achievementRoutes(server: FastifyInstance) {
  server.get('/achievements', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Unauthorized' })
    return sendAchievements(reply, userId)
  })

  server.post<{ Body: { key?: unknown } }>('/achievements/claim', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Unauthorized' })
    const key = request.body?.key
    if (typeof key !== 'string' || achievementByKey(key) === null) return reply.status(400).send({ error: 'Unknown achievement' })
    const outcome = await prisma.$transaction(async (tx) => {
      await lockCharacterRow(tx, userId)
      return claimAchievementReward(tx, userId, key)
    }, { maxWait: 10000, timeout: 15000 })
    if (outcome.kind === 'reject') return reply.status(outcome.status).send(outcome.body)
    if (!outcome.replayed) request.log.info({ userId, key }, 'achievements: reward claimed')
    return sendAchievements(reply, userId, { replayed: outcome.replayed })
  })
  // Титулы убраны 23.11.2026 (решение Андрея): ручки POST /achievements/title
  // больше нет, колонка Character.titleKey в базе осталась, но её никто не
  // читает и не отдаёт.
}
