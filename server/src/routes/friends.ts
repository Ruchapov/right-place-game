// Приглашения друзей (12.11.2026, docs/referral.md): список друзей, награда
// пригласившему кнопкой «Забрать», награда приглашённому сама (вход и финиш).
//
//   GET  /character/friends            — ссылка, кто позвал меня, мои друзья
//   POST /character/friends/claim      — забрать награду за одного друга
//   POST /character/friends/claim-all  — забрать за всех готовых разом
//
// Привязка друга — в /auth/login (routes/auth.ts), только при создании игрока.
// Ограничений на число друзей и наград нет (решение владельца 12.11.2026).
//
// ⚠️ Уведомлений бота нет: server/src/bot/notify.ts в проекте отсутствует. Когда
// он появится — queueNotification(inviterId, 'friend_joined' | 'friend_reward', …)
// лучшим усилием, в try/catch, после привязки (auth.ts) и в grantInviteeReward ниже.
import { randomBytes } from 'node:crypto'
import { FastifyInstance, FastifyBaseLogger } from 'fastify'
import { PrismaClient, Prisma } from '@prisma/client'
import { calculateLevel } from '../game.js'
import { REFERRAL_CODE_LENGTH, REFERRAL_GOLD, REFERRAL_LEVEL, REFERRAL_RP, friendState, referralUrl, type FriendState } from '../referral.js'
import { getUserId } from './run.js'

const prisma = new PrismaClient()

function newReferralCode(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (const b of randomBytes(REFERRAL_CODE_LENGTH)) out += alphabet[b % alphabet.length]
  return out
}

/** Код персонажа; нет — создаётся (условной записью: два GET разом дадут один код). */
async function ensureReferralCode(characterId: number): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const cur = await prisma.character.findUnique({ where: { id: characterId }, select: { referralCode: true } })
    if (!cur) throw new Error('character vanished')
    if (cur.referralCode) return cur.referralCode
    try {
      await prisma.character.updateMany({ where: { id: characterId, referralCode: null }, data: { referralCode: newReferralCode() } })
    } catch (e) {
      // совпал чужой код (уникальный индекс) — ещё раз с новым
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e
    }
  }
  throw new Error('referral code: 5 collisions in a row')
}

export type ReferralReward = { inviterName: string }

/**
 * Награда приглашённому: есть пригласивший, награды ещё не было, уровень
 * (calculateLevel) не ниже REFERRAL_LEVEL и забега нет — +REFERRAL_GOLD золота и
 * +REFERRAL_RP RP одной условной записью (повтор и гонка второй раз не дадут).
 * Зовут вход (после закрытия брошенного забега) и финиш. Возвращает имя
 * пригласившего и золото/RP после записи, или null, если награды не было.
 * Сбой — громкий лог и null: вход и финиш от награды не падают.
 */
export async function grantInviteeReward(characterId: number, log: FastifyBaseLogger): Promise<(ReferralReward & { gold: number; rp: number }) | null> {
  try {
    const c = await prisma.character.findUnique({
      where: { id: characterId },
      select: { invitedById: true, inviteeRewardAt: true, currentRun: true, strength: true, agility: true, endurance: true, bonusLevels: true },
    })
    if (!c || c.invitedById === null || c.inviteeRewardAt !== null || c.currentRun !== null) return null
    if (calculateLevel(c.strength, c.agility, c.endurance, c.bonusLevels) < REFERRAL_LEVEL) return null
    const now = new Date()
    const res = await prisma.character.updateMany({
      where: { id: characterId, invitedById: { not: null }, inviteeRewardAt: null, currentRun: { equals: Prisma.DbNull } },
      data: { gold: { increment: REFERRAL_GOLD }, rp: { increment: REFERRAL_RP }, inviteeRewardAt: now, referralReadyAt: now },
    })
    if (res.count === 0) return null
    const [after, inviter] = await Promise.all([
      prisma.character.findUnique({ where: { id: characterId }, select: { gold: true, rp: true } }),
      prisma.character.findUnique({ where: { id: c.invitedById }, select: { user: { select: { firstName: true } } } }),
    ])
    log.info({ characterId, inviterId: c.invitedById }, 'referral: invitee reward granted')
    return { inviterName: inviter?.user.firstName ?? 'друг', gold: after?.gold ?? 0, rp: after?.rp ?? 0 }
  } catch (e) {
    log.error({ characterId, err: e }, 'referral: invitee reward failed')
    return null
  }
}

type FriendView = { id: number; name: string; level: number; state: FriendState }
type FriendsResponse = {
  link: string
  invitedBy: { name: string; rewardReceived: boolean } | null
  friends: FriendView[]
}

async function friendsView(characterId: number): Promise<FriendsResponse> {
  const code = await ensureReferralCode(characterId)
  const me = await prisma.character.findUnique({
    where: { id: characterId },
    select: { inviteeRewardAt: true, invitedBy: { select: { user: { select: { firstName: true } } } } },
  })
  const rows = await prisma.character.findMany({
    where: { invitedById: characterId },
    orderBy: { id: 'desc' },
    select: { id: true, strength: true, agility: true, endurance: true, bonusLevels: true, inviterClaimedAt: true, user: { select: { firstName: true } } },
  })
  return {
    link: referralUrl(code),
    invitedBy: me?.invitedBy ? { name: me.invitedBy.user.firstName, rewardReceived: me.inviteeRewardAt !== null } : null,
    friends: rows.map((r) => {
      const level = calculateLevel(r.strength, r.agility, r.endurance, r.bonusLevels)
      return { id: r.id, name: r.user.firstName, level, state: friendState(level, r.inviterClaimedAt !== null) }
    }),
  }
}

/** Отказ внутри транзакции забора — откатывает её и уходит ответом. */
class ClaimRejection extends Error {
  constructor(public status: number, public body: Record<string, unknown>) { super(String(body.error)) }
}

export async function friendRoutes(server: FastifyInstance) {
  server.get('/character/friends', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })
    const me = await prisma.character.findUnique({ where: { userId }, select: { id: true } })
    if (!me) return reply.status(404).send({ error: 'Character not found' })
    return reply.send(await friendsView(me.id))
  })

  /**
   * Забор за друзей `ids` (null — за всех готовых). Одна транзакция: друзья
   * помечаются условной записью (inviterClaimedAt: null), моё золото и RP —
   * increment'ом на число реально помеченных, с фильтром «нет забега» (как обмен
   * трофеев: финиш пишет золото приращением, но правило одно на все награды).
   */
  async function claim(userId: number, friendId: number | null) {
    return prisma.$transaction(async (tx) => {
      const me = await tx.character.findUnique({ where: { userId }, select: { id: true, currentRun: true } })
      if (!me) throw new ClaimRejection(404, { error: 'Character not found' })
      if (me.currentRun !== null) throw new ClaimRejection(400, { error: 'Run in progress' })
      const candidates = await tx.character.findMany({
        where: { invitedById: me.id, ...(friendId !== null ? { id: friendId } : { inviterClaimedAt: null }) },
        select: { id: true, strength: true, agility: true, endurance: true, bonusLevels: true, inviterClaimedAt: true },
      })
      if (friendId !== null) {
        const f = candidates[0]
        if (!f) throw new ClaimRejection(404, { error: 'Friend not found' })
        if (f.inviterClaimedAt !== null) throw new ClaimRejection(409, { error: 'Already claimed' })
        if (calculateLevel(f.strength, f.agility, f.endurance, f.bonusLevels) < REFERRAL_LEVEL) throw new ClaimRejection(400, { error: 'Not ready' })
      }
      const ready = candidates.filter((f) => f.inviterClaimedAt === null && calculateLevel(f.strength, f.agility, f.endurance, f.bonusLevels) >= REFERRAL_LEVEL).map((f) => f.id)
      if (ready.length === 0) throw new ClaimRejection(400, { error: 'Not ready' })
      const marked = await tx.character.updateMany({ where: { id: { in: ready }, invitedById: me.id, inviterClaimedAt: null }, data: { inviterClaimedAt: new Date() } })
      if (marked.count === 0) throw new ClaimRejection(409, { error: 'Already claimed' })
      const paid = await tx.character.updateMany({
        where: { id: me.id, currentRun: { equals: Prisma.DbNull } },
        data: { gold: { increment: REFERRAL_GOLD * marked.count }, rp: { increment: REFERRAL_RP * marked.count } },
      })
      if (paid.count === 0) throw new ClaimRejection(400, { error: 'Run in progress' })
      const after = await tx.character.findUnique({ where: { id: me.id }, select: { gold: true, rp: true } })
      return { characterId: me.id, claimed: marked.count, gold: after!.gold, rp: after!.rp }
    })
  }

  async function handleClaim(userId: number, friendId: number | null, reply: import('fastify').FastifyReply, log: FastifyBaseLogger) {
    try {
      const r = await claim(userId, friendId)
      log.info({ userId, friendId, claimed: r.claimed }, 'referral: inviter claimed')
      return reply.send({ claimed: r.claimed, gold: r.gold, rp: r.rp, goldGained: REFERRAL_GOLD * r.claimed, rpGained: REFERRAL_RP * r.claimed, ...(await friendsView(r.characterId)) })
    } catch (e) {
      if (e instanceof ClaimRejection) return reply.status(e.status).send(e.body)
      throw e
    }
  }

  server.post<{ Body: { friendId?: unknown } }>('/character/friends/claim', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })
    const friendId = request.body?.friendId
    if (typeof friendId !== 'number' || !Number.isInteger(friendId) || friendId <= 0) return reply.status(400).send({ error: 'Invalid friendId' })
    return handleClaim(userId, friendId, reply, request.log)
  })

  server.post('/character/friends/claim-all', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })
    return handleClaim(userId, null, reply, request.log)
  })
}
