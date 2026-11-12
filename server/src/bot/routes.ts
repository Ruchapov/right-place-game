// Ручки игрока для бота (13.11.2026):
//   GET  /character/notify-settings — {botAllowed, botBlocked, settings}
//   POST /character/notify-settings — {settings: {energy?, quests?, …}} — частично
//   POST /character/bot-allowed     — клиент получил согласие requestWriteAccess
//   POST /character/channel-reward  — +50 RP за подписку на @rightplace_news
// и хук lastActiveAt: запрос с валидным JWT отмечает «игрок в игре» не чаще
// раза в минуту (кэш в памяти процесса), не дожидаясь записи и не падая.
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { getUserId } from '../routes/run.js'
import { CHANNEL_USERNAME, getChatMember } from './telegram.js'
import { NOTIFY_SETTING_KEYS, notifySettingsJson, readNotifySettings } from './notify.js'

const prisma = new PrismaClient()

export const CHANNEL_REWARD_RP = 50
const ACTIVE_WRITE_MS = 60_000
const lastActiveWrite = new Map<number, number>()

/** onRequest-хук корня (index.ts): в плагине он видел бы только свои ручки. */
export async function trackActivity(request: FastifyRequest): Promise<void> {
  if (!request.headers.authorization) return
  const userId = getUserId(request)
  if (userId === null) return
  const now = Date.now()
  if (now - (lastActiveWrite.get(userId) ?? 0) < ACTIVE_WRITE_MS) return
  lastActiveWrite.set(userId, now)
  prisma.character.updateMany({ where: { userId }, data: { lastActiveAt: new Date(now) } })
    .catch((e) => request.log.warn({ userId, err: e }, 'bot: lastActiveAt write failed'))
}

export async function botPlayerRoutes(server: FastifyInstance) {
  async function settingsView(userId: number) {
    const c = await prisma.character.findUnique({ where: { userId }, select: { botAllowed: true, botBlocked: true, notifySettings: true } })
    if (!c) return null
    return { botAllowed: c.botAllowed, botBlocked: c.botBlocked, settings: readNotifySettings(c.notifySettings) }
  }

  server.get('/character/notify-settings', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })
    const view = await settingsView(userId)
    if (!view) return reply.status(404).send({ error: 'Character not found' })
    return reply.send(view)
  })

  server.post<{ Body: { settings?: unknown } }>('/character/notify-settings', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })
    const raw = request.body?.settings
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return reply.status(400).send({ error: 'Invalid settings' })
    const patch = raw as Record<string, unknown>
    for (const [k, v] of Object.entries(patch)) {
      if (!(NOTIFY_SETTING_KEYS as readonly string[]).includes(k) || typeof v !== 'boolean') return reply.status(400).send({ error: 'Invalid settings', key: k })
    }
    const c = await prisma.character.findUnique({ where: { userId }, select: { id: true, notifySettings: true } })
    if (!c) return reply.status(404).send({ error: 'Character not found' })
    const next = { ...readNotifySettings(c.notifySettings), ...(patch as Record<string, boolean>) }
    await prisma.character.update({ where: { id: c.id }, data: { notifySettings: notifySettingsJson(next) } })
    return reply.send(await settingsView(userId))
  })

  server.post('/character/bot-allowed', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })
    const res = await prisma.character.updateMany({ where: { userId }, data: { botAllowed: true, botBlocked: false } })
    if (res.count === 0) return reply.status(404).send({ error: 'Character not found' })
    return reply.send(await settingsView(userId))
  })

  server.post('/character/channel-reward', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })
    const c = await prisma.character.findUnique({ where: { userId }, select: { id: true, channelRewardAt: true, user: { select: { telegramId: true } } } })
    if (!c) return reply.status(404).send({ error: 'Character not found' })
    if (c.channelRewardAt !== null) return reply.status(409).send({ error: 'already' })
    const member = await getChatMember(CHANNEL_USERNAME, c.user.telegramId)
    if (!member.ok) {
      // «user not found» / «PARTICIPANT_ID_INVALID» — не подписан; прочее (бот не
      // админ канала, сеть) — проверить не смогли.
      if (/user not found|participant_id_invalid/i.test(member.description)) return reply.status(400).send({ error: 'not_subscribed' })
      request.log.error({ status: member.status, description: member.description }, 'channel-reward: getChatMember failed')
      return reply.status(503).send({ error: 'check_failed' })
    }
    if (!['member', 'administrator', 'creator'].includes(member.result.status)) return reply.status(400).send({ error: 'not_subscribed' })
    const res = await prisma.character.updateMany({
      where: { id: c.id, channelRewardAt: null },
      data: { rp: { increment: CHANNEL_REWARD_RP }, channelRewardAt: new Date() },
    })
    if (res.count === 0) return reply.status(409).send({ error: 'already' })
    const after = await prisma.character.findUnique({ where: { id: c.id }, select: { rp: true } })
    request.log.info({ characterId: c.id }, 'channel-reward: granted')
    return reply.send({ rp: after?.rp ?? 0, rpGained: CHANNEL_REWARD_RP, channelRewardClaimed: true })
  })
}
