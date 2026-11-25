// GET /cron/tick?key=CRON_SECRET (13.11.2026) — зовёт cron-job.org раз в минуту.
//
// За вызов: (а) полная энергия, (б) новый набор заданий, (в) «вернись» через 3 и
// 7 дней, (г) отправка очереди BotNotification. Ответ — JSON со счётчиками.
//
// Строка очереди закрывается выставленным sentAt; error говорит, почему её не
// отправили ('expired', 'in_game', 'blocked', 'not_allowed', 'disabled'),
// а у отправленной error NULL. Сбой Bot API (не 403) — строка остаётся в очереди
// с error и sendAfter через 5 минут, пока не истечёт (48 ч от постановки).
import type { FastifyInstance, FastifyBaseLogger } from 'fastify'
import { PrismaClient, Prisma } from '@prisma/client'
import { MAX_ENERGY, ENERGY_REGEN_MS } from '../energy.js'
import { QUEST_SET_MS, QUEST_UNLOCK_LEVEL } from '../quests.js'
import { readQuestState } from '../questState.js'
import { calculateLevel } from '../game.js'
import { sendCard } from './telegram.js'
import { nextSendTime, parseNotifyKind, queueNotification, readNotifySettings, renderNotification, type NotifySettingKey } from './notify.js'

const prisma = new PrismaClient()

const DAY_MS = 24 * 3600_000
const COMEBACK_1_MS = 3 * DAY_MS
const COMEBACK_2_MS = 7 * DAY_MS
const IN_GAME_MS = 15 * 60_000
const EXPIRE_MS = 48 * 3600_000
/**
 * Не больше 2 «фоновых» звонов игроку за 24 часа (решение Андрея 13.11.2026):
 * полная энергия, новые задания, «вернись». Гильдия и друзья — ответ на действие
 * другого игрока, в лимит не идут и его не тратят. Напоминания «Печати
 * Колокола» (premium_*) — тоже вне лимита: о купленном за RP молчать нельзя.
 */
const LIMITED_KINDS: readonly string[] = ['energy', 'quests', 'comeback']
const MAX_LIMITED_PER_DAY = 2
const MAX_PER_TICK = 300
const SEND_GAP_MS = 40 // 25 в секунду
const RETRY_MS = 5 * 60_000
/** Сколько персонажей за вызов проверяют энергия и задания. */
const SCAN_LIMIT = 5000

const SETTING_OF: Record<string, NotifySettingKey> = {
  energy: 'energy', quests: 'quests', friend_joined: 'friends', friend_reward: 'friends',
  guild_request: 'guild', guild_accepted: 'guild', guild_declined: 'guild', comeback: 'comeback',
  premium_3d: 'premium', premium_1d: 'premium', premium_end: 'premium',
}

const reachable = { botAllowed: true, botBlocked: false } as const

async function scanEnergy(now: Date): Promise<number> {
  const rows = await prisma.character.findMany({
    where: { ...reachable, energy: { lt: MAX_ENERGY } },
    select: { id: true, energy: true, lastEnergyUpdate: true, energyNotifiedAt: true },
    take: SCAN_LIMIT,
  })
  let queued = 0
  for (const c of rows) {
    const fullAt = c.lastEnergyUpdate.getTime() + (MAX_ENERGY - c.energy) * ENERGY_REGEN_MS
    if (fullAt > now.getTime()) continue
    if (c.energyNotifiedAt !== null && c.energyNotifiedAt >= c.lastEnergyUpdate) continue
    // Отметка — условной записью: два вызова разом не поставят два звона.
    const marked = await prisma.character.updateMany({
      where: { id: c.id, energyNotifiedAt: c.energyNotifiedAt },
      data: { energyNotifiedAt: now },
    })
    if (marked.count > 0 && await queueNotification(c.id, 'energy')) queued++
  }
  return queued
}

async function scanQuests(now: Date): Promise<number> {
  const rows = await prisma.character.findMany({
    where: { ...reachable, questState: { not: Prisma.DbNull } },
    select: { id: true, questState: true, questsNotifiedAt: true, strength: true, agility: true, endurance: true, bonusLevels: true },
    take: SCAN_LIMIT,
  })
  let queued = 0
  for (const c of rows) {
    if (calculateLevel(c.strength, c.agility, c.endurance, c.bonusLevels) < QUEST_UNLOCK_LEVEL) continue
    const read = readQuestState(c.questState)
    if (read.kind !== 'state' || read.state.setStartedAt === null) continue
    const readyAt = read.state.setStartedAt + QUEST_SET_MS
    if (readyAt > now.getTime()) continue
    if (c.questsNotifiedAt !== null && c.questsNotifiedAt.getTime() >= readyAt) continue
    const marked = await prisma.character.updateMany({
      where: { id: c.id, questsNotifiedAt: c.questsNotifiedAt },
      data: { questsNotifiedAt: now },
    })
    if (marked.count > 0 && await queueNotification(c.id, 'quests')) queued++
  }
  return queued
}

async function scanComeback(now: Date): Promise<number> {
  let queued = 0
  for (const [stage, ageMs] of [[1, COMEBACK_1_MS], [2, COMEBACK_2_MS]] as const) {
    const rows = await prisma.character.findMany({
      where: { ...reachable, comebackStage: stage - 1, lastSeenAt: { lt: new Date(now.getTime() - ageMs) } },
      select: { id: true },
      take: SCAN_LIMIT,
    })
    for (const c of rows) {
      const marked = await prisma.character.updateMany({ where: { id: c.id, comebackStage: stage - 1 }, data: { comebackStage: stage } })
      if (marked.count > 0 && await queueNotification(c.id, 'comeback', { stage })) queued++
    }
  }
  return queued
}

/**
 * «Печать Колокола» (25.11.2026, docs/premium.md): за 3 дня, за 1 день и в
 * момент конца — каждое ровно один раз за срок. premiumNoticeStage — сколько
 * уже ушло (покупка ставит 0); отметка — условной записью по прежней ступени,
 * как у «вернись», поэтому два вызова разом второй звон не поставят. Опоздали
 * (сервер лежал) — ставится только самая поздняя из наступивших ступеней, а
 * пропущенные отмечаются: «за 3 дня» после конца звонить бессмысленно.
 * Выключено в настройках или боту писать нельзя — queueNotification не
 * поставит, но ступень всё равно отмечена: ровно один раз, а не «пока не включит».
 */
const PREMIUM_STAGES: readonly { stage: number; beforeMs: number; kind: 'premium_3d' | 'premium_1d' | 'premium_end' }[] = [
  { stage: 1, beforeMs: 3 * DAY_MS, kind: 'premium_3d' },
  { stage: 2, beforeMs: DAY_MS, kind: 'premium_1d' },
  { stage: 3, beforeMs: 0, kind: 'premium_end' },
]

async function scanPremium(now: Date): Promise<number> {
  const rows = await prisma.character.findMany({
    where: { premiumUntil: { not: null, lte: new Date(now.getTime() + 3 * DAY_MS) }, premiumNoticeStage: { lt: 3 } },
    select: { id: true, premiumUntil: true, premiumNoticeStage: true },
    take: SCAN_LIMIT,
  })
  let queued = 0
  for (const c of rows) {
    const left = c.premiumUntil!.getTime() - now.getTime()
    const due = PREMIUM_STAGES.filter((s) => left <= s.beforeMs).at(-1)
    if (!due || due.stage <= c.premiumNoticeStage) continue
    const marked = await prisma.character.updateMany({
      where: { id: c.id, premiumNoticeStage: c.premiumNoticeStage, premiumUntil: c.premiumUntil },
      data: { premiumNoticeStage: due.stage },
    })
    if (marked.count > 0 && await queueNotification(c.id, due.kind)) queued++
  }
  return queued
}

type QueueCounters = { sent: number; failed: number; skippedInGame: number; deferred: number; expired: number; dropped: number }

async function sendQueue(now: Date, log: FastifyBaseLogger): Promise<QueueCounters> {
  const n: QueueCounters = { sent: 0, failed: 0, skippedInGame: 0, deferred: 0, expired: 0, dropped: 0 }
  const due = await prisma.botNotification.findMany({
    where: { sentAt: null, sendAfter: { lte: now } },
    orderBy: { id: 'asc' },
    take: MAX_PER_TICK,
    include: { character: { select: { botAllowed: true, botBlocked: true, notifySettings: true, lastActiveAt: true, user: { select: { telegramId: true } } } } },
  })
  // Отправленные игроку за сутки звоны из лимита: моменты, по персонажу.
  const sentDay = new Map<number, number[]>()
  const ids = [...new Set(due.map((d) => d.characterId))]
  if (ids.length > 0) {
    const recent = await prisma.botNotification.findMany({
      where: { characterId: { in: ids }, kind: { in: [...LIMITED_KINDS] }, sentAt: { gte: new Date(now.getTime() - DAY_MS) }, error: null },
      select: { characterId: true, sentAt: true },
    })
    for (const r of recent) {
      const list = sentDay.get(r.characterId) ?? []
      list.push(r.sentAt!.getTime())
      sentDay.set(r.characterId, list)
    }
  }
  const close = (id: number, error: string) => prisma.botNotification.update({ where: { id }, data: { sentAt: now, error } })
  const defer = (id: number, at: Date) => prisma.botNotification.update({ where: { id }, data: { sendAfter: nextSendTime(at) } })

  let first = true
  for (const d of due) {
    const c = d.character
    if (now.getTime() - d.createdAt.getTime() > EXPIRE_MS) { await close(d.id, 'expired'); n.expired++; continue }
    if (c.botBlocked) { await close(d.id, 'blocked'); n.dropped++; continue }
    if (!c.botAllowed) { await close(d.id, 'not_allowed'); n.dropped++; continue }
    const setting = SETTING_OF[d.kind]
    if (setting && !readNotifySettings(c.notifySettings)[setting]) { await close(d.id, 'disabled'); n.dropped++; continue }
    const view = renderNotification(d.kind, d.payload)
    if (view === null) { await close(d.id, `unknown kind ${d.kind}`); n.dropped++; continue }

    // Игрок в игре: о полной энергии и заданиях он и так видит, остальное — позже.
    if (c.lastActiveAt !== null && now.getTime() - c.lastActiveAt.getTime() < IN_GAME_MS) {
      const kind = parseNotifyKind(d.kind)
      if (kind === 'energy' || kind === 'quests') { await close(d.id, 'in_game'); n.skippedInGame++ }
      else { await defer(d.id, new Date(c.lastActiveAt.getTime() + IN_GAME_MS)); n.deferred++ }
      continue
    }
    const limited = LIMITED_KINDS.includes(d.kind)
    const day = (sentDay.get(d.characterId) ?? []).filter((t) => now.getTime() - t < DAY_MS).sort((a, b) => a - b)
    if (limited && day.length >= MAX_LIMITED_PER_DAY) {
      await defer(d.id, new Date(day[day.length - MAX_LIMITED_PER_DAY] + DAY_MS))
      n.deferred++
      continue
    }

    if (!first) await new Promise((r) => setTimeout(r, SEND_GAP_MS))
    first = false
    const res = await sendCard(c.user.telegramId.toString(), view.photo, view.caption, view.keyboard)
    if (res.ok) {
      await prisma.botNotification.update({ where: { id: d.id }, data: { sentAt: new Date(), error: null } })
      if (limited) {
        day.push(Date.now())
        sentDay.set(d.characterId, day)
      }
      n.sent++
    } else if (res.status === 403) {
      await close(d.id, `blocked: ${res.description}`.slice(0, 500))
      n.dropped++
    } else {
      await prisma.botNotification.update({
        where: { id: d.id },
        data: { error: res.description.slice(0, 500), sendAfter: new Date(now.getTime() + RETRY_MS) },
      })
      log.warn({ notificationId: d.id, status: res.status, description: res.description }, 'bot: send failed, will retry')
      n.failed++
    }
  }
  return n
}

let running = false

export async function cronRoutes(server: FastifyInstance) {
  server.get<{ Querystring: { key?: string } }>('/cron/tick', async (request, reply) => {
    const secret = process.env.CRON_SECRET
    if (!secret || request.query.key !== secret) return reply.status(401).send({ error: 'Unauthorized' })
    if (running) return reply.send({ busy: true })
    running = true
    const started = Date.now()
    try {
      const now = new Date()
      const energy = await scanEnergy(now)
      const quests = await scanQuests(now)
      const comeback = await scanComeback(now)
      const premium = await scanPremium(now)
      const queue = await sendQueue(new Date(), request.log)
      return reply.send({ queued: { energy, quests, comeback, premium }, queue, ms: Date.now() - started })
    } catch (e) {
      request.log.error({ err: e }, 'cron: tick failed')
      return reply.status(500).send({ error: 'Tick failed' })
    } finally {
      running = false
    }
  })
}
