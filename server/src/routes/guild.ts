// Гильдии (30.10.2026, docs/guilds.md): создание и вступление, роли, чат, казна,
// здания, склад, котёл, библиотека, алтарь.
//
// Правила и цены — в общем каталоге guild.ts (копия у клиента, сверяет
// check_potion_sync.py); здесь только проверки, записи и ответы.
//
// Как устроены записи. Каждое изменение — ОДНА транзакция (applyOnce из
// routes/run.ts: с requestId — ровно один раз на ключ, без него — просто
// транзакция). Внутри порядок блокировок ОДИН на все ручки, иначе две ручки
// встали бы друг другу поперёк (глава исключает того, кто в ту же секунду берёт
// книгу):
//   1. строка Guild — SELECT … FOR UPDATE (lockGuild);
//   2. только после неё — строка своего Character (lockCharacterRow), если ручка
//      кладёт вещь в сумку.
// Членство и роль перечитываются ПОСЛЕ блокировки гильдии: исключённый в
// соседней транзакции получит отказ, а не книгу. Деньги и запасы — условными
// записями (gte в фильтре), так что минус не выходит ни при какой гонке.
//
// Ответ каждой ручки, кроме списков и чата, — полное состояние гильдии глазами
// игрока (GuildMeView): клиенту не нужно собирать его из кусков.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { PrismaClient, Prisma } from '@prisma/client'
import { randomBytes } from 'node:crypto'
import {
  GUILD_CREATE_RP,
  GUILD_MAX_DEPUTIES,
  GUILD_REJOIN_COOLDOWN_MS,
  GUILD_LEADER_INACTIVE_MS,
  GUILD_BUILDING_MAX,
  GUILD_BUILDING_LABEL,
  GUILD_CAULDRON_COOLDOWN_MS,
  GUILD_LIBRARY_COOLDOWN_MS,
  GUILD_PRAYER_DURATION_MS,
  GUILD_PRAYER_PCT,
  GUILD_PRAYER_CRIT_PCT,
  GUILD_PRAYER_LABEL,
  GUILD_CHAT_MAX_LEN,
  GUILD_CHAT_COOLDOWN_MS,
  GUILD_CHAT_KEEP,
  GUILD_STORAGE_MAX_PER_ACTION,
  guildMemberCap,
  guildUpgradeCost,
  guildStorageCapacity,
  guildBooksFreeInStorage,
  guildCauldronYield,
  guildLibraryCostsElite,
  guildPrayerCritChance,
  guildBuffPctAt,
  guildNameKey,
  parseGuildName,
  parseGuildTag,
  parseGuildJoinMode,
  parseGuildEmblem,
  parseGuildBuilding,
  parseGuildStorageKind,
  parseGuildPrayer,
  parseGuildInviteCode,
  parseGuildAmount,
  parseGuildRole,
  type GuildRole,
  type GuildBuilding,
  type GuildStorageKind,
} from '../guild.js'
import { CONSUMABLES, SKILL_BOOK_IDS, bagFits, consumableById, type ConsumableId } from '../consumables.js'
import { CLASS_ITEMS, classItemById, parseClassItemId } from '../classItems.js'
import { scrollById } from '../scrolls.js'
import { POTION_TIERS } from '../potions.js'
import { calculateLevel } from '../game.js'
import {
  consumableStockOf,
  classItemStockOf,
  potionStockOf,
  type ConsumableColumns,
} from '../runState.js'
import {
  getUserId,
  RouteRejection,
  applyOnce,
  readOptionalRequestId,
  lockCharacterRow,
  bagCellsUsed,
  consumableStockIncrement,
  classItemStockIncrement,
  classItemStockFilter,
  classItemStockDecrement,
} from './run.js'

const prisma = new PrismaClient()
type Db = Prisma.TransactionClient | PrismaClient

// Колонка склада по id расходника — для взноса на склад гильдии (списание
// любого расходника). Record: новый расходник без колонки здесь не соберётся.
const CONSUMABLE_COLUMN: Record<ConsumableId, keyof ConsumableColumns> = {
  whetstone: 'whetstones',
  charm_death: 'charms',
  reflect_potion: 'reflectPotions',
  book_fire: 'bookFire',
  book_ice: 'bookIce',
  book_bleed: 'bookBleed',
  book_heal: 'bookHeal',
  book_dash: 'bookDash',
}

const POTION_COLUMNS = ['potionT1', 'potionT2', 'potionT3', 'potionT4', 'potionT5'] as const

// --- Общие куски ---

async function lockGuild(tx: Prisma.TransactionClient, guildId: number): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Guild" WHERE "id" = ${guildId} FOR UPDATE`
}

/** Код приглашения — 12 знаков base62. Коллизия упрётся в уникальный индекс. */
function newInviteCode(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = randomBytes(12)
  let out = ''
  for (const b of bytes) out += alphabet[b % alphabet.length]
  return out
}

/** Удаляет сообщения гильдии старше GUILD_CHAT_KEEP последних. */
async function pruneChat(db: Db, guildId: number): Promise<void> {
  const edge = await db.guildMessage.findMany({
    where: { guildId },
    orderBy: { id: 'desc' },
    skip: GUILD_CHAT_KEEP,
    take: 1,
    select: { id: true },
  })
  if (edge.length > 0) {
    await db.guildMessage.deleteMany({ where: { guildId, id: { lte: edge[0].id } } })
  }
}

/** Системная строка в чат гильдии (серым на клиенте). */
async function systemMessage(db: Db, guildId: number, text: string): Promise<void> {
  await db.guildMessage.create({ data: { guildId, characterId: null, text } })
  await pruneChat(db, guildId)
}

async function characterName(db: Db, characterId: number): Promise<string> {
  const row = await db.character.findUnique({ where: { id: characterId }, select: { user: { select: { firstName: true } } } })
  return row?.user.firstName ?? 'Кто-то'
}

/** Сколько ещё ждать до вступления после выхода, мс; 0 — можно. */
function rejoinWaitMs(guildLeftAt: Date | null, now: number): number {
  if (guildLeftAt === null) return 0
  return Math.max(0, guildLeftAt.getTime() + GUILD_REJOIN_COOLDOWN_MS - now)
}

/** Сколько ещё ждать до действия с кулдауном, мс; 0 — можно. */
function cooldownWaitMs(at: Date | null, cooldownMs: number, now: number): number {
  if (at === null) return 0
  return Math.max(0, at.getTime() + cooldownMs - now)
}

/** Баффы алтаря обнуляются при выходе, исключении и роспуске. */
const CLEAR_BUFFS = { buffAttackPct: 0, buffAttackUntil: null, buffArmorPct: 0, buffArmorUntil: null }

/**
 * Глава неактивен 14 дней — главенство переходит заместителю с самым свежим
 * входом, нет заместителей — участнику с самым свежим входом. Зовётся под
 * блокировкой гильдии из каждой пишущей ручки и из GET /guild/me.
 * lastSeenAt null — вход ещё не записывался (герой не заходил с выкладки
 * гильдий): считаем активным, а не брошенным, иначе в первый же день главенство
 * ушло бы у всех.
 */
async function ensureActiveLeader(tx: Prisma.TransactionClient, guildId: number, now: number): Promise<void> {
  const members = await tx.guildMember.findMany({
    where: { guildId },
    select: { id: true, characterId: true, role: true, character: { select: { lastSeenAt: true, user: { select: { firstName: true } } } } },
  })
  const leader = members.find((m) => m.role === 'leader')
  if (!leader) {
    // Гильдия без главы — недостижимо по ручкам, но лечится той же передачей.
    if (members.length === 0) return
  } else {
    const seen = leader.character.lastSeenAt
    if (seen === null || now - seen.getTime() < GUILD_LEADER_INACTIVE_MS) return
  }
  const others = members.filter((m) => m !== leader)
  if (others.length === 0) return
  const fresh = (m: typeof others[number]) => m.character.lastSeenAt?.getTime() ?? 0
  const deputies = others.filter((m) => m.role === 'deputy').sort((a, b) => fresh(b) - fresh(a))
  const pool = deputies.length > 0 ? deputies : [...others].sort((a, b) => fresh(b) - fresh(a))
  const heir = pool[0]
  if (leader) await tx.guildMember.update({ where: { id: leader.id }, data: { role: 'member' } })
  await tx.guildMember.update({ where: { id: heir.id }, data: { role: 'leader' } })
  await systemMessage(tx, guildId, `Глава не появлялся 14 дней. Новый глава — ${heir.character.user.firstName}.`)
}

type Membership = { guildId: number; role: GuildRole }

/** Членство под блокировкой гильдии (после lockGuild). null — не в этой гильдии. */
async function membershipIn(tx: Db, characterId: number, guildId: number): Promise<Membership | null> {
  const m = await tx.guildMember.findUnique({ where: { characterId } })
  if (!m || m.guildId !== guildId) return null
  const role = parseGuildRole(m.role)
  if (role === null) throw new Error(`guild: corrupt role ${m.role} for character ${characterId}`)
  return { guildId, role }
}

/**
 * Открывает транзакцию над гильдией игрока: находит его гильдию, блокирует её
 * строку, передаёт главенство, если глава неактивен, и перечитывает членство.
 * Не в гильдии — 400 'Not in a guild'.
 */
async function withMyGuild<T>(
  tx: Prisma.TransactionClient,
  characterId: number,
  now: number,
  action: (m: Membership) => Promise<T>,
): Promise<T> {
  const pre = await tx.guildMember.findUnique({ where: { characterId }, select: { guildId: true } })
  if (!pre) throw new RouteRejection(400, { error: 'Not in a guild' })
  await lockGuild(tx, pre.guildId)
  await ensureActiveLeader(tx, pre.guildId, now)
  const m = await membershipIn(tx, characterId, pre.guildId)
  if (!m) throw new RouteRejection(409, { error: 'State changed, retry' })
  return action(m)
}

function requireRole(m: Membership, allowed: GuildRole[]): void {
  if (!allowed.includes(m.role)) throw new RouteRejection(403, { error: 'Not allowed for your role', role: m.role })
}

/** Места на складе, занятые прямо сейчас (книги со 2 уровня библиотеки — даром). */
async function storageUsed(db: Db, guildId: number, libraryLevel: number): Promise<number> {
  const rows = await db.guildStorage.findMany({ where: { guildId }, select: { kind: true, ref: true, count: true } })
  const booksFree = guildBooksFreeInStorage(libraryLevel)
  return rows.reduce((sum, r) => {
    if (booksFree && r.kind === 'consumable' && (SKILL_BOOK_IDS as readonly string[]).includes(r.ref)) return sum
    return sum + r.count
  }, 0)
}

/**
 * Вступление в гильдию — общий кусок для открытой гильдии, принятой заявки и
 * приглашения. Зовётся под блокировкой гильдии. Проверяет кулдаун выхода и
 * места; уникальный индекс GuildMember.characterId держит «один герой — одна
 * гильдия» даже при гонке.
 */
async function addMember(tx: Prisma.TransactionClient, guildId: number, characterId: number, now: number): Promise<void> {
  const guild = await tx.guild.findUnique({ where: { id: guildId } })
  if (!guild) throw new RouteRejection(404, { error: 'Guild not found' })
  const ch = await tx.character.findUnique({ where: { id: characterId }, select: { guildLeftAt: true, user: { select: { firstName: true } } } })
  if (!ch) throw new RouteRejection(404, { error: 'Character not found' })
  const wait = rejoinWaitMs(ch.guildLeftAt, now)
  if (wait > 0) throw new RouteRejection(400, { error: 'Rejoin cooldown', retryInMs: wait })
  const already = await tx.guildMember.findUnique({ where: { characterId } })
  if (already) throw new RouteRejection(400, { error: 'Already in a guild' })
  const count = await tx.guildMember.count({ where: { guildId } })
  if (count >= guildMemberCap(guild.level)) throw new RouteRejection(400, { error: 'Guild is full', cap: guildMemberCap(guild.level) })
  await tx.guildMember.create({ data: { guildId, characterId, role: 'member' } })
  // Заявки героя в другие гильдии больше не нужны.
  await tx.guildRequest.deleteMany({ where: { characterId } })
  await systemMessage(tx, guildId, `${ch.user.firstName} вступает в гильдию.`)
}

// --- Вид гильдии для клиента ---

type GuildSummary = {
  id: number
  name: string
  tag: string
  level: number
  members: number
  cap: number
  joinMode: string
  emblem: { symbol: number; frame: number; bg: number; color: number }
}

function summaryOf(g: {
  id: number; name: string; tag: string; level: number; joinMode: string
  emblemSymbol: number; emblemFrame: number; emblemBg: number; emblemColor: number
  _count: { members: number }
}): GuildSummary {
  return {
    id: g.id,
    name: g.name,
    tag: g.tag,
    level: g.level,
    members: g._count.members,
    cap: guildMemberCap(g.level),
    joinMode: g.joinMode,
    emblem: { symbol: g.emblemSymbol, frame: g.emblemFrame, bg: g.emblemBg, color: g.emblemColor },
  }
}

/**
 * Полное состояние «моя гильдия» глазами игрока. guild: null — не в гильдии
 * (тогда кулдаун вступления и мои заявки). Кошелёк — для экрана: золото,
 * элитные трофеи, RP, склады; абсолютные числа из базы.
 */
async function buildMeView(db: Db, characterId: number, now: number) {
  const ch = await db.character.findUnique({ where: { id: characterId } })
  if (!ch) throw new RouteRejection(404, { error: 'Character not found' })
  const wallet = {
    gold: ch.gold,
    eliteTrophies: ch.eliteTrophies,
    rp: ch.rp,
    potions: potionStockOf(ch),
    consumables: consumableStockOf(ch),
    classItems: classItemStockOf(ch),
  }
  const me = await db.guildMember.findUnique({ where: { characterId } })
  if (!me) {
    const requests = await db.guildRequest.findMany({ where: { characterId }, select: { guildId: true } })
    return {
      guild: null,
      rejoinInMs: rejoinWaitMs(ch.guildLeftAt, now),
      myRequests: requests.map((r) => r.guildId),
      createCostRp: GUILD_CREATE_RP,
      wallet,
    }
  }
  const g = await db.guild.findUnique({ where: { id: me.guildId }, include: { _count: { select: { members: true } } } })
  if (!g) throw new RouteRejection(500, { error: 'Corrupt guild state' })
  const role = parseGuildRole(me.role) ?? 'member'
  const members = await db.guildMember.findMany({
    where: { guildId: g.id },
    orderBy: { joinedAt: 'asc' },
    select: {
      characterId: true, role: true, joinedAt: true,
      character: { select: { strength: true, agility: true, endurance: true, bonusLevels: true, lastSeenAt: true, user: { select: { firstName: true } } } },
    },
  })
  const storageRows = await db.guildStorage.findMany({ where: { guildId: g.id }, orderBy: { id: 'asc' } })
  const itemIds = storageRows.filter((r) => r.kind === 'item').map((r) => r.ref)
  const items = itemIds.length > 0 ? await db.item.findMany({ where: { id: { in: itemIds } } }) : []
  const itemById = new Map(items.map((it) => [it.id, it]))
  const canReview = role === 'leader' || role === 'deputy'
  const requests = canReview
    ? await db.guildRequest.findMany({
        where: { guildId: g.id },
        orderBy: { createdAt: 'asc' },
        select: { characterId: true, createdAt: true, character: { select: { strength: true, agility: true, endurance: true, bonusLevels: true, user: { select: { firstName: true } } } } },
      })
    : []
  return {
    guild: {
      ...summaryOf(g),
      inviteCode: g.inviteCode,
      gold: g.gold,
      eliteTrophies: g.eliteTrophies,
      buildings: {
        level: g.level,
        storage: g.storageLevel,
        cauldron: g.cauldronLevel,
        library: g.libraryLevel,
        altar: g.altarLevel,
      },
      storageUsed: await storageUsed(db, g.id, g.libraryLevel),
      storageCap: guildStorageCapacity(g.storageLevel),
      createdAt: g.createdAt.getTime(),
    },
    role,
    members: members.map((m) => ({
      characterId: m.characterId,
      name: m.character.user.firstName,
      role: m.role,
      level: calculateLevel(m.character.strength, m.character.agility, m.character.endurance, m.character.bonusLevels),
      lastSeenAt: m.character.lastSeenAt?.getTime() ?? null,
      joinedAt: m.joinedAt.getTime(),
    })),
    storage: storageRows.map((r) => {
      const it = r.kind === 'item' ? itemById.get(r.ref) : undefined
      return {
        kind: r.kind,
        ref: r.ref,
        count: r.count,
        ...(it ? { item: { nameRu: it.nameRu, slot: it.slot, tier: it.tier } } : {}),
      }
    }),
    requests: requests.map((r) => ({
      characterId: r.characterId,
      name: r.character.user.firstName,
      level: calculateLevel(r.character.strength, r.character.agility, r.character.endurance, r.character.bonusLevels),
      createdAt: r.createdAt.getTime(),
    })),
    me: {
      characterId,
      cauldronInMs: cooldownWaitMs(ch.cauldronAt, GUILD_CAULDRON_COOLDOWN_MS, now),
      libraryInMs: cooldownWaitMs(ch.libraryAt, GUILD_LIBRARY_COOLDOWN_MS, now),
      buffs: {
        attack: { pct: guildBuffPctAt(ch.buffAttackPct, ch.buffAttackUntil?.getTime() ?? null, now), untilMs: ch.buffAttackUntil?.getTime() ?? null },
        armor: { pct: guildBuffPctAt(ch.buffArmorPct, ch.buffArmorUntil?.getTime() ?? null, now), untilMs: ch.buffArmorUntil?.getTime() ?? null },
      },
    },
    wallet,
  }
}

// --- Ответы ---

/** Превращает отказ и гонки Prisma в понятные 4xx. Остальное — пусть падает. */
function sendFailure(request: FastifyRequest, reply: FastifyReply, e: unknown) {
  if (e instanceof RouteRejection) return reply.status(e.status).send(e.body)
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2002') {
      const target = String((e.meta as { target?: unknown } | undefined)?.target ?? '')
      if (target.includes('name')) return reply.status(409).send({ error: 'Name taken' })
      if (target.includes('tag')) return reply.status(409).send({ error: 'Tag taken' })
      if (target.includes('characterId')) return reply.status(409).send({ error: 'Already in a guild' })
      return reply.status(409).send({ error: 'State changed, retry' })
    }
    // P2034 — конфликт записи или взаимная блокировка: повторить можно.
    if (e.code === 'P2034' || e.code === 'P2028') return reply.status(409).send({ error: 'State changed, retry' })
  }
  request.log.error({ err: e }, 'guild route failed')
  return reply.status(500).send({ error: 'Internal error' })
}

/**
 * Обёртка пишущей ручки: токен, персонаж, ключ идемпотентности, транзакция,
 * ответ — полное состояние гильдии (и `extra` от действия, если есть).
 */
async function guildAction<E extends Record<string, unknown> | void>(
  request: FastifyRequest<{ Body: Record<string, unknown> | undefined }>,
  reply: FastifyReply,
  endpoint: string,
  action: (tx: Prisma.TransactionClient, characterId: number, now: number) => Promise<E>,
) {
  const userId = getUserId(request)
  if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })
  const body = request.body
  if (body !== undefined && (typeof body !== 'object' || body === null || Array.isArray(body))) {
    return reply.status(400).send({ error: 'Invalid body' })
  }
  const requestId = readOptionalRequestId(body?.requestId)
  if (requestId === 'invalid') return reply.status(400).send({ error: 'Invalid requestId' })
  const character = await prisma.character.findUnique({ where: { userId }, select: { id: true } })
  if (!character) return reply.status(404).send({ error: 'Character not found' })
  const now = Date.now()
  try {
    const done = await applyOnce(character.id, requestId, `guild:${endpoint}`, request.log, (tx) => action(tx, character.id, now))
    const view = await buildMeView(prisma, character.id, Date.now())
    const extra = !done.replayed && done.value ? done.value : {}
    return reply.send({ ...view, ...extra, ...(done.replayed ? { replayed: true } : {}) })
  } catch (e) {
    return sendFailure(request, reply, e)
  }
}

type GuildBody = { Body: Record<string, unknown> | undefined }

function intField(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : null
}

export async function guildRoutes(server: FastifyInstance) {
  // --- Списки ---

  // Список гильдий с поиском по названию и тегу. Сначала старшие по уровню.
  server.get<{ Querystring: { q?: string } }>('/guild/list', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })
    const q = typeof request.query.q === 'string' ? request.query.q.trim().slice(0, 30) : ''
    const guilds = await prisma.guild.findMany({
      where: q === '' ? {} : { OR: [{ nameKey: { contains: guildNameKey(q) } }, { tag: { contains: q.toUpperCase() } }] },
      orderBy: [{ level: 'desc' }, { createdAt: 'asc' }],
      take: 50,
      include: { _count: { select: { members: true } } },
    })
    return reply.send({ guilds: guilds.map(summaryOf) })
  })

  // Топ гильдий: по уровню, при равенстве — кто раньше создан.
  server.get('/guild/top', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })
    const guilds = await prisma.guild.findMany({
      orderBy: [{ level: 'desc' }, { createdAt: 'asc' }],
      take: 50,
      include: { _count: { select: { members: true } } },
    })
    return reply.send({ guilds: guilds.map(summaryOf) })
  })

  // Гильдия по коду приглашения — для окна «Вступить в …?» по ссылке.
  server.get<{ Params: { code: string } }>('/guild/invite/:code', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })
    const code = parseGuildInviteCode(request.params.code)
    if (code === null) return reply.status(400).send({ error: 'Invalid invite code' })
    const g = await prisma.guild.findUnique({ where: { inviteCode: code }, include: { _count: { select: { members: true } } } })
    if (!g) return reply.status(404).send({ error: 'Guild not found' })
    return reply.send({ guild: summaryOf(g) })
  })

  // Моя гильдия. Пишет только передачу главенства неактивного главы.
  server.get('/guild/me', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })
    const character = await prisma.character.findUnique({ where: { userId }, select: { id: true } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })
    const now = Date.now()
    try {
      const member = await prisma.guildMember.findUnique({ where: { characterId: character.id }, select: { guildId: true } })
      if (member) {
        await prisma.$transaction(async (tx) => {
          await lockGuild(tx, member.guildId)
          await ensureActiveLeader(tx, member.guildId, now)
        })
      }
      return reply.send(await buildMeView(prisma, character.id, now))
    } catch (e) {
      return sendFailure(request, reply, e)
    }
  })

  // --- Создание и вступление ---

  server.post<GuildBody>('/guild/create', (request, reply) =>
    guildAction(request, reply, 'create', async (tx, characterId, now) => {
      const body = request.body ?? {}
      const name = parseGuildName(body.name)
      if (name === null) throw new RouteRejection(400, { error: 'Invalid name' })
      const tag = parseGuildTag(body.tag)
      if (tag === null) throw new RouteRejection(400, { error: 'Invalid tag' })
      const joinMode = parseGuildJoinMode(body.joinMode)
      if (joinMode === null) throw new RouteRejection(400, { error: 'Invalid joinMode' })
      const emblem = parseGuildEmblem(body.emblem)
      if (emblem === null) throw new RouteRejection(400, { error: 'Invalid emblem' })
      const ch = await tx.character.findUnique({ where: { id: characterId }, select: { guildLeftAt: true, rp: true } })
      if (!ch) throw new RouteRejection(404, { error: 'Character not found' })
      if (await tx.guildMember.findUnique({ where: { characterId } })) throw new RouteRejection(400, { error: 'Already in a guild' })
      const wait = rejoinWaitMs(ch.guildLeftAt, now)
      if (wait > 0) throw new RouteRejection(400, { error: 'Rejoin cooldown', retryInMs: wait })
      // RP — условной записью: два параллельных создания не спишут ниже нуля.
      const paid = await tx.character.updateMany({ where: { id: characterId, rp: { gte: GUILD_CREATE_RP } }, data: { rp: { decrement: GUILD_CREATE_RP } } })
      if (paid.count === 0) throw new RouteRejection(400, { error: 'Not enough RP', need: GUILD_CREATE_RP, rp: ch.rp })
      // Регистр: «Стражи» и «стражи» — одно имя для игрока. Гарантию даёт
      // уникальный индекс nameKey (гонка — P2002 → 409 Name taken), здесь —
      // понятный отказ без лишней записи.
      const nameKey = guildNameKey(name)
      const clash = await tx.guild.findFirst({ where: { OR: [{ nameKey }, { tag }] }, select: { nameKey: true, tag: true } })
      if (clash) throw new RouteRejection(409, { error: clash.tag === tag ? 'Tag taken' : 'Name taken' })
      const guild = await tx.guild.create({
        data: {
          name, nameKey, tag, joinMode, inviteCode: newInviteCode(),
          emblemSymbol: emblem.symbol, emblemFrame: emblem.frame, emblemBg: emblem.bg, emblemColor: emblem.color,
        },
      })
      await tx.guildMember.create({ data: { guildId: guild.id, characterId, role: 'leader' } })
      await tx.guildRequest.deleteMany({ where: { characterId } })
      await systemMessage(tx, guild.id, `Гильдия ${name} [${tag}] основана.`)
    }),
  )

  // Вступить в ОТКРЫТУЮ гильдию.
  server.post<GuildBody>('/guild/join', (request, reply) =>
    guildAction(request, reply, 'join', async (tx, characterId, now) => {
      const guildId = intField(request.body?.guildId)
      if (guildId === null) throw new RouteRejection(400, { error: 'Invalid guildId' })
      await lockGuild(tx, guildId)
      const g = await tx.guild.findUnique({ where: { id: guildId }, select: { joinMode: true } })
      if (!g) throw new RouteRejection(404, { error: 'Guild not found' })
      if (g.joinMode !== 'open') throw new RouteRejection(400, { error: 'Guild is not open', joinMode: g.joinMode })
      await addMember(tx, guildId, characterId, now)
    }),
  )

  // Вступить по приглашению — обходит заявку и закрытость.
  server.post<GuildBody>('/guild/join-invite', (request, reply) =>
    guildAction(request, reply, 'join-invite', async (tx, characterId, now) => {
      const code = parseGuildInviteCode(request.body?.code)
      if (code === null) throw new RouteRejection(400, { error: 'Invalid invite code' })
      const g = await tx.guild.findUnique({ where: { inviteCode: code }, select: { id: true } })
      if (!g) throw new RouteRejection(404, { error: 'Guild not found' })
      await lockGuild(tx, g.id)
      await addMember(tx, g.id, characterId, now)
    }),
  )

  // Подать заявку в гильдию «по заявке».
  server.post<GuildBody>('/guild/request', (request, reply) =>
    guildAction(request, reply, 'request', async (tx, characterId, now) => {
      const guildId = intField(request.body?.guildId)
      if (guildId === null) throw new RouteRejection(400, { error: 'Invalid guildId' })
      const g = await tx.guild.findUnique({ where: { id: guildId }, select: { joinMode: true } })
      if (!g) throw new RouteRejection(404, { error: 'Guild not found' })
      if (g.joinMode !== 'request') throw new RouteRejection(400, { error: 'Guild does not take requests', joinMode: g.joinMode })
      if (await tx.guildMember.findUnique({ where: { characterId } })) throw new RouteRejection(400, { error: 'Already in a guild' })
      const ch = await tx.character.findUnique({ where: { id: characterId }, select: { guildLeftAt: true } })
      const wait = rejoinWaitMs(ch?.guildLeftAt ?? null, now)
      if (wait > 0) throw new RouteRejection(400, { error: 'Rejoin cooldown', retryInMs: wait })
      const exists = await tx.guildRequest.findUnique({ where: { guildId_characterId: { guildId, characterId } } })
      if (exists) throw new RouteRejection(400, { error: 'Request already sent' })
      await tx.guildRequest.create({ data: { guildId, characterId } })
    }),
  )

  // Отозвать свою заявку.
  server.post<GuildBody>('/guild/request/cancel', (request, reply) =>
    guildAction(request, reply, 'request-cancel', async (tx, characterId) => {
      const guildId = intField(request.body?.guildId)
      if (guildId === null) throw new RouteRejection(400, { error: 'Invalid guildId' })
      await tx.guildRequest.deleteMany({ where: { guildId, characterId } })
    }),
  )

  // Принять или отклонить заявку — глава и заместитель.
  server.post<GuildBody>('/guild/requests/decide', (request, reply) =>
    guildAction(request, reply, 'requests-decide', async (tx, characterId, now) => {
      const target = intField(request.body?.characterId)
      if (target === null) throw new RouteRejection(400, { error: 'Invalid characterId' })
      const accept = request.body?.accept
      if (typeof accept !== 'boolean') throw new RouteRejection(400, { error: 'Invalid accept' })
      await withMyGuild(tx, characterId, now, async (m) => {
        requireRole(m, ['leader', 'deputy'])
        const req = await tx.guildRequest.findUnique({ where: { guildId_characterId: { guildId: m.guildId, characterId: target } } })
        if (!req) throw new RouteRejection(400, { error: 'No such request' })
        await tx.guildRequest.delete({ where: { id: req.id } })
        if (accept) await addMember(tx, m.guildId, target, now)
      })
    }),
  )

  // --- Выход, исключение, роли ---

  server.post<GuildBody>('/guild/leave', (request, reply) =>
    guildAction(request, reply, 'leave', async (tx, characterId, now) => {
      await withMyGuild(tx, characterId, now, async (m) => {
        if (m.role === 'leader') {
          const count = await tx.guildMember.count({ where: { guildId: m.guildId } })
          throw new RouteRejection(400, { error: count > 1 ? 'Leader must transfer first' : 'Leader must disband' })
        }
        await tx.guildMember.delete({ where: { characterId } })
        await tx.character.update({ where: { id: characterId }, data: { guildLeftAt: new Date(now), ...CLEAR_BUFFS } })
        await systemMessage(tx, m.guildId, `${await characterName(tx, characterId)} покидает гильдию.`)
      })
    }),
  )

  // Распустить — только глава, оставшийся один. Казна и склад пропадают.
  server.post<GuildBody>('/guild/disband', (request, reply) =>
    guildAction(request, reply, 'disband', async (tx, characterId, now) => {
      await withMyGuild(tx, characterId, now, async (m) => {
        requireRole(m, ['leader'])
        const count = await tx.guildMember.count({ where: { guildId: m.guildId } })
        if (count > 1) throw new RouteRejection(400, { error: 'Guild is not empty' })
        await tx.guildMember.delete({ where: { characterId } })
        await tx.guildRequest.deleteMany({ where: { guildId: m.guildId } })
        await tx.guildStorage.deleteMany({ where: { guildId: m.guildId } })
        await tx.guildMessage.deleteMany({ where: { guildId: m.guildId } })
        await tx.guild.delete({ where: { id: m.guildId } })
        await tx.character.update({ where: { id: characterId }, data: { guildLeftAt: new Date(now), ...CLEAR_BUFFS } })
      })
    }),
  )

  // Исключить: глава — любого, заместитель — только участника.
  server.post<GuildBody>('/guild/kick', (request, reply) =>
    guildAction(request, reply, 'kick', async (tx, characterId, now) => {
      const target = intField(request.body?.characterId)
      if (target === null) throw new RouteRejection(400, { error: 'Invalid characterId' })
      if (target === characterId) throw new RouteRejection(400, { error: 'Cannot kick yourself' })
      await withMyGuild(tx, characterId, now, async (m) => {
        requireRole(m, ['leader', 'deputy'])
        const t = await membershipIn(tx, target, m.guildId)
        if (!t) throw new RouteRejection(400, { error: 'Not a member' })
        if (t.role === 'leader' || (m.role === 'deputy' && t.role !== 'member')) {
          throw new RouteRejection(403, { error: 'Not allowed for your role', role: m.role })
        }
        await tx.guildMember.delete({ where: { characterId: target } })
        await tx.character.update({ where: { id: target }, data: { guildLeftAt: new Date(now), ...CLEAR_BUFFS } })
        await systemMessage(tx, m.guildId, `${await characterName(tx, target)} исключён из гильдии.`)
      })
    }),
  )

  // Назначить / снять заместителя — глава.
  server.post<GuildBody>('/guild/deputy', (request, reply) =>
    guildAction(request, reply, 'deputy', async (tx, characterId, now) => {
      const target = intField(request.body?.characterId)
      if (target === null) throw new RouteRejection(400, { error: 'Invalid characterId' })
      const make = request.body?.deputy
      if (typeof make !== 'boolean') throw new RouteRejection(400, { error: 'Invalid deputy' })
      await withMyGuild(tx, characterId, now, async (m) => {
        requireRole(m, ['leader'])
        const t = await membershipIn(tx, target, m.guildId)
        if (!t || t.role === 'leader') throw new RouteRejection(400, { error: 'Not a member' })
        if (make) {
          if (t.role === 'deputy') return
          const deputies = await tx.guildMember.count({ where: { guildId: m.guildId, role: 'deputy' } })
          if (deputies >= GUILD_MAX_DEPUTIES) throw new RouteRejection(400, { error: 'Too many deputies', max: GUILD_MAX_DEPUTIES })
          await tx.guildMember.update({ where: { characterId: target }, data: { role: 'deputy' } })
          await systemMessage(tx, m.guildId, `${await characterName(tx, target)} теперь заместитель.`)
        } else {
          if (t.role !== 'deputy') return
          await tx.guildMember.update({ where: { characterId: target }, data: { role: 'member' } })
          await systemMessage(tx, m.guildId, `${await characterName(tx, target)} больше не заместитель.`)
        }
      })
    }),
  )

  // Передать главенство. Прежний глава становится заместителем, если есть
  // место, иначе участником.
  server.post<GuildBody>('/guild/transfer-leader', (request, reply) =>
    guildAction(request, reply, 'transfer-leader', async (tx, characterId, now) => {
      const target = intField(request.body?.characterId)
      if (target === null || target === characterId) throw new RouteRejection(400, { error: 'Invalid characterId' })
      await withMyGuild(tx, characterId, now, async (m) => {
        requireRole(m, ['leader'])
        const t = await membershipIn(tx, target, m.guildId)
        if (!t) throw new RouteRejection(400, { error: 'Not a member' })
        await tx.guildMember.update({ where: { characterId: target }, data: { role: 'leader' } })
        const deputies = await tx.guildMember.count({ where: { guildId: m.guildId, role: 'deputy' } })
        await tx.guildMember.update({ where: { characterId }, data: { role: deputies < GUILD_MAX_DEPUTIES ? 'deputy' : 'member' } })
        await systemMessage(tx, m.guildId, `Новый глава — ${await characterName(tx, target)}.`)
      })
    }),
  )

  // Тип вступления и герб — глава.
  server.post<GuildBody>('/guild/settings', (request, reply) =>
    guildAction(request, reply, 'settings', async (tx, characterId, now) => {
      const body = request.body ?? {}
      const joinMode = body.joinMode === undefined ? undefined : parseGuildJoinMode(body.joinMode)
      if (joinMode === null) throw new RouteRejection(400, { error: 'Invalid joinMode' })
      const emblem = body.emblem === undefined ? undefined : parseGuildEmblem(body.emblem)
      if (emblem === null) throw new RouteRejection(400, { error: 'Invalid emblem' })
      await withMyGuild(tx, characterId, now, async (m) => {
        requireRole(m, ['leader'])
        await tx.guild.update({
          where: { id: m.guildId },
          data: {
            ...(joinMode !== undefined ? { joinMode } : {}),
            ...(emblem !== undefined ? { emblemSymbol: emblem.symbol, emblemFrame: emblem.frame, emblemBg: emblem.bg, emblemColor: emblem.color } : {}),
          },
        })
        // Открыли или закрыли — висящие заявки больше не нужны.
        if (joinMode !== undefined && joinMode !== 'request') await tx.guildRequest.deleteMany({ where: { guildId: m.guildId } })
      })
    }),
  )

  // --- Казна ---

  // Взнос золотом и/или элитными трофеями. Забрать из казны нельзя никому.
  server.post<GuildBody>('/guild/donate', (request, reply) =>
    guildAction(request, reply, 'donate', async (tx, characterId, now) => {
      const body = request.body ?? {}
      const gold = body.gold === undefined || body.gold === 0 ? 0 : parseGuildAmount(body.gold)
      const elite = body.eliteTrophies === undefined || body.eliteTrophies === 0 ? 0 : parseGuildAmount(body.eliteTrophies)
      if (gold === null || elite === null) throw new RouteRejection(400, { error: 'Invalid amount' })
      if (gold === 0 && elite === 0) throw new RouteRejection(400, { error: 'Nothing to donate' })
      await withMyGuild(tx, characterId, now, async (m) => {
        const paid = await tx.character.updateMany({
          where: { id: characterId, gold: { gte: gold }, eliteTrophies: { gte: elite } },
          data: { gold: { decrement: gold }, eliteTrophies: { decrement: elite } },
        })
        if (paid.count === 0) throw new RouteRejection(400, { error: 'Not enough funds' })
        await tx.guild.update({ where: { id: m.guildId }, data: { gold: { increment: gold }, eliteTrophies: { increment: elite } } })
        const parts = [gold > 0 ? `${gold} золота` : '', elite > 0 ? `${elite} элитн. трофеев` : ''].filter(Boolean).join(' и ')
        await systemMessage(tx, m.guildId, `${await characterName(tx, characterId)} кладёт в казну ${parts}.`)
      })
    }),
  )

  // --- Улучшения (только глава, из казны) ---

  server.post<GuildBody>('/guild/upgrade', (request, reply) =>
    guildAction(request, reply, 'upgrade', async (tx, characterId, now) => {
      const building = parseGuildBuilding(request.body?.building)
      if (building === null) throw new RouteRejection(400, { error: 'Unknown building' })
      await withMyGuild(tx, characterId, now, async (m) => {
        requireRole(m, ['leader'])
        const g = await tx.guild.findUnique({ where: { id: m.guildId } })
        if (!g) throw new RouteRejection(404, { error: 'Guild not found' })
        const column = BUILDING_COLUMN[building]
        const current = g[column]
        const cost = guildUpgradeCost(building, current)
        if (cost === null) throw new RouteRejection(400, { error: 'Max level', max: GUILD_BUILDING_MAX[building] })
        const done = await tx.guild.updateMany({
          where: { id: m.guildId, [column]: current, gold: { gte: cost.gold }, eliteTrophies: { gte: cost.eliteTrophies } },
          data: { [column]: current + 1, gold: { decrement: cost.gold }, eliteTrophies: { decrement: cost.eliteTrophies } },
        })
        if (done.count === 0) throw new RouteRejection(400, { error: 'Not enough in treasury', cost })
        const what = current === 0 ? 'открывает' : `улучшает до ${current + 1} уровня`
        await systemMessage(tx, m.guildId, `Глава ${what}: ${GUILD_BUILDING_LABEL[building]}.`)
      })
    }),
  )

  // --- Склад ---

  // Положить на склад: любой участник, только то, что занимает клетку сумки.
  server.post<GuildBody>('/guild/storage/put', (request, reply) =>
    guildAction(request, reply, 'storage-put', async (tx, characterId, now) => {
      const body = request.body ?? {}
      const kind = parseGuildStorageKind(body.kind)
      if (kind === null) throw new RouteRejection(400, { error: 'Invalid kind' })
      await withMyGuild(tx, characterId, now, async (m) => {
        const g = await tx.guild.findUnique({ where: { id: m.guildId } })
        if (!g) throw new RouteRejection(404, { error: 'Guild not found' })
        let ref: string
        let count: number
        let label: string
        if (kind === 'item') {
          // Снаряжение — по одной строке инвентаря: надетое класть нельзя.
          const invId = typeof body.inventoryItemId === 'string' ? body.inventoryItemId : null
          if (invId === null) throw new RouteRejection(400, { error: 'Invalid inventoryItemId' })
          const inv = await tx.inventoryItem.findFirst({ where: { id: invId, characterId }, include: { item: true } })
          if (!inv) throw new RouteRejection(404, { error: 'Item not found' })
          if (inv.equipped) throw new RouteRejection(400, { error: 'Item is equipped' })
          ref = inv.itemId
          count = 1
          label = inv.item.nameRu
          await checkStorageRoom(tx, g, kind, ref, count)
          const gone = await tx.inventoryItem.deleteMany({ where: { id: invId, characterId, equipped: false } })
          if (gone.count === 0) throw new RouteRejection(409, { error: 'State changed, retry' })
        } else {
          count = parseStorageCount(body.count)
          ref = typeof body.ref === 'string' ? body.ref : ''
          const spec = storageSpec(kind, ref)
          label = spec.nameRu
          await checkStorageRoom(tx, g, kind, ref, count)
          const taken = await tx.character.updateMany({ where: { id: characterId, ...spec.filter(count) }, data: spec.decrement(count) })
          if (taken.count === 0) throw new RouteRejection(400, { error: 'Not enough in stock' })
        }
        await tx.guildStorage.upsert({
          where: { guildId_kind_ref: { guildId: m.guildId, kind, ref } },
          create: { guildId: m.guildId, kind, ref, count },
          update: { count: { increment: count } },
        })
        await systemMessage(tx, m.guildId, `${await characterName(tx, characterId)} кладёт на склад: ${label} ×${count}.`)
      })
    }),
  )

  // Взять со склада: глава и заместитель, в свою сумку по правилу вместимости.
  server.post<GuildBody>('/guild/storage/take', (request, reply) =>
    guildAction(request, reply, 'storage-take', async (tx, characterId, now) => {
      const body = request.body ?? {}
      const kind = parseGuildStorageKind(body.kind)
      if (kind === null) throw new RouteRejection(400, { error: 'Invalid kind' })
      const ref = typeof body.ref === 'string' ? body.ref : ''
      const count = parseStorageCount(body.count)
      await withMyGuild(tx, characterId, now, async (m) => {
        requireRole(m, ['leader', 'deputy'])
        const row = await tx.guildStorage.findUnique({ where: { guildId_kind_ref: { guildId: m.guildId, kind, ref } } })
        if (!row || row.count < count) throw new RouteRejection(400, { error: 'Not in storage' })
        // Сумка: под блокировкой своей строки (после гильдии — общий порядок).
        await lockCharacterRow(tx, (await tx.character.findUniqueOrThrow({ where: { id: characterId }, select: { userId: true } })).userId)
        const ch = await tx.character.findUniqueOrThrow({ where: { id: characterId } })
        let label: string
        if (kind === 'item') {
          const item = await tx.item.findUnique({ where: { id: ref } })
          if (!item) throw new RouteRejection(500, { error: 'Corrupt storage' })
          label = item.nameRu
        } else {
          label = storageSpec(kind, ref).nameRu
        }
        const used = await bagCellsUsed(tx, characterId, consumableStockOf(ch), classItemStockOf(ch))
        if (!bagFits(used, count)) throw new RouteRejection(400, { error: 'Bag is full', used, need: count })
        if (row.count === count) {
          await tx.guildStorage.delete({ where: { id: row.id } })
        } else {
          await tx.guildStorage.update({ where: { id: row.id }, data: { count: { decrement: count } } })
        }
        if (kind === 'item') {
          for (let i = 0; i < count; i++) await tx.inventoryItem.create({ data: { characterId, itemId: ref } })
        } else {
          await tx.character.update({ where: { id: characterId }, data: storageSpec(kind, ref).increment(count) })
        }
        await systemMessage(tx, m.guildId, `${await characterName(tx, characterId)} берёт со склада: ${label} ×${count}.`)
      })
    }),
  )

  // --- Котёл, библиотека, алтарь ---

  server.post<GuildBody>('/guild/cauldron', (request, reply) =>
    guildAction(request, reply, 'cauldron', async (tx, characterId, now) =>
      withMyGuild(tx, characterId, now, async (m) => {
        const g = await tx.guild.findUniqueOrThrow({ where: { id: m.guildId } })
        const yieldOf = guildCauldronYield(g.cauldronLevel)
        if (yieldOf === null) throw new RouteRejection(400, { error: 'Cauldron closed' })
        const ch = await tx.character.findUniqueOrThrow({ where: { id: characterId } })
        await lockCharacterRow(tx, ch.userId)
        const fresh = await tx.character.findUniqueOrThrow({ where: { id: characterId } })
        const wait = cooldownWaitMs(fresh.cauldronAt, GUILD_CAULDRON_COOLDOWN_MS, now)
        if (wait > 0) throw new RouteRejection(400, { error: 'Cooldown', retryInMs: wait })
        if (yieldOf.costsElite && g.eliteTrophies < 1) throw new RouteRejection(400, { error: 'Treasury empty' })
        // Зелье отражения занимает клетку: нет места — отказ целиком, кулдаун цел.
        if (yieldOf.reflect > 0) {
          const used = await bagCellsUsed(tx, characterId, consumableStockOf(fresh), classItemStockOf(fresh))
          if (!bagFits(used, yieldOf.reflect)) throw new RouteRejection(400, { error: 'Bag is full', used, need: yieldOf.reflect })
        }
        const level = calculateLevel(fresh.strength, fresh.agility, fresh.endurance, fresh.bonusLevels)
        const tier = [...POTION_TIERS].reverse().find((t) => t.levelRequired <= level) ?? POTION_TIERS[0]
        if (yieldOf.costsElite) {
          const paid = await tx.guild.updateMany({ where: { id: m.guildId, eliteTrophies: { gte: 1 } }, data: { eliteTrophies: { decrement: 1 } } })
          if (paid.count === 0) throw new RouteRejection(400, { error: 'Treasury empty' })
        }
        await tx.character.update({
          where: { id: characterId },
          data: {
            cauldronAt: new Date(now),
            [POTION_COLUMNS[tier.tier - 1]]: { increment: yieldOf.potions },
            ...(yieldOf.reflect > 0 ? { reflectPotions: { increment: yieldOf.reflect } } : {}),
          },
        })
        return { cauldron: { tier: tier.tier, potions: yieldOf.potions, reflect: yieldOf.reflect } }
      }),
    ),
  )

  server.post<GuildBody>('/guild/library', (request, reply) =>
    guildAction(request, reply, 'library', async (tx, characterId, now) =>
      withMyGuild(tx, characterId, now, async (m) => {
        const g = await tx.guild.findUniqueOrThrow({ where: { id: m.guildId } })
        if (g.libraryLevel < 1) throw new RouteRejection(400, { error: 'Library closed' })
        const costsElite = guildLibraryCostsElite(g.libraryLevel)
        const ch = await tx.character.findUniqueOrThrow({ where: { id: characterId } })
        await lockCharacterRow(tx, ch.userId)
        const fresh = await tx.character.findUniqueOrThrow({ where: { id: characterId } })
        const wait = cooldownWaitMs(fresh.libraryAt, GUILD_LIBRARY_COOLDOWN_MS, now)
        if (wait > 0) throw new RouteRejection(400, { error: 'Cooldown', retryInMs: wait })
        if (costsElite && g.eliteTrophies < 1) throw new RouteRejection(400, { error: 'Treasury empty' })
        const used = await bagCellsUsed(tx, characterId, consumableStockOf(fresh), classItemStockOf(fresh))
        if (!bagFits(used, 1)) throw new RouteRejection(400, { error: 'Bag is full', used, need: 1 })
        if (costsElite) {
          const paid = await tx.guild.updateMany({ where: { id: m.guildId, eliteTrophies: { gte: 1 } }, data: { eliteTrophies: { decrement: 1 } } })
          if (paid.count === 0) throw new RouteRejection(400, { error: 'Treasury empty' })
        }
        const bookId = SKILL_BOOK_IDS[Math.floor(Math.random() * SKILL_BOOK_IDS.length)]
        await tx.character.update({ where: { id: characterId }, data: { libraryAt: new Date(now), ...consumableStockIncrement(bookId, 1) } })
        await systemMessage(tx, m.guildId, `${await characterName(tx, characterId)} берёт в библиотеке: ${consumableById(bookId)?.nameRu ?? bookId}.`)
        return { libraryBook: bookId }
      }),
    ),
  )

  server.post<GuildBody>('/guild/pray', (request, reply) =>
    guildAction(request, reply, 'pray', async (tx, characterId, now) => {
      const prayer = parseGuildPrayer(request.body?.prayer)
      if (prayer === null) throw new RouteRejection(400, { error: 'Unknown prayer' })
      return withMyGuild(tx, characterId, now, async (m) => {
        const g = await tx.guild.findUniqueOrThrow({ where: { id: m.guildId } })
        if (g.altarLevel < 1) throw new RouteRejection(400, { error: 'Altar closed' })
        const ch = await tx.character.findUniqueOrThrow({ where: { id: characterId } })
        const until = prayer === 'attack' ? ch.buffAttackUntil : ch.buffArmorUntil
        if (until !== null && until.getTime() > now) {
          throw new RouteRejection(400, { error: 'Prayer active', retryInMs: until.getTime() - now })
        }
        // Крит молитвы бросает сервер.
        const crit = Math.random() < guildPrayerCritChance(g.altarLevel)
        const pct = crit ? GUILD_PRAYER_CRIT_PCT : GUILD_PRAYER_PCT
        const newUntil = new Date(now + GUILD_PRAYER_DURATION_MS)
        // Условно по прежнему концу баффа: двойной тап не перебросит крит.
        const done = await tx.character.updateMany({
          where: { id: characterId, ...(prayer === 'attack' ? { buffAttackUntil: until } : { buffArmorUntil: until }) },
          data: prayer === 'attack' ? { buffAttackPct: pct, buffAttackUntil: newUntil } : { buffArmorPct: pct, buffArmorUntil: newUntil },
        })
        if (done.count === 0) throw new RouteRejection(409, { error: 'State changed, retry' })
        return { prayer: { kind: prayer, label: GUILD_PRAYER_LABEL[prayer], pct, crit } }
      })
    }),
  )

  // --- Чат ---

  // Новые сообщения после id `after` (0 — последние 50). Опрос раз в 4–5 с.
  server.get<{ Querystring: { after?: string } }>('/guild/chat', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })
    const character = await prisma.character.findUnique({ where: { userId }, select: { id: true } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })
    const m = await prisma.guildMember.findUnique({ where: { characterId: character.id }, include: { guild: { select: { tag: true } } } })
    if (!m) return reply.status(400).send({ error: 'Not in a guild' })
    const afterRaw = Number(request.query.after ?? 0)
    const after = Number.isInteger(afterRaw) && afterRaw > 0 ? afterRaw : 0
    const rows = after === 0
      ? (await prisma.guildMessage.findMany({ where: { guildId: m.guildId }, orderBy: { id: 'desc' }, take: 50, include: { character: { select: { user: { select: { firstName: true } } } } } })).reverse()
      : await prisma.guildMessage.findMany({ where: { guildId: m.guildId, id: { gt: after } }, orderBy: { id: 'asc' }, take: 100, include: { character: { select: { user: { select: { firstName: true } } } } } })
    return reply.send({
      tag: m.guild.tag,
      messages: rows.map((r) => ({
        id: r.id,
        text: r.text,
        system: r.characterId === null,
        author: r.character?.user.firstName ?? null,
        mine: r.characterId === character.id,
        createdAt: r.createdAt.getTime(),
      })),
    })
  })

  server.post<{ Body: { text?: unknown } }>('/guild/chat', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })
    const raw = request.body?.text
    const text = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : ''
    if (text.length === 0 || text.length > GUILD_CHAT_MAX_LEN) return reply.status(400).send({ error: 'Invalid text', max: GUILD_CHAT_MAX_LEN })
    const character = await prisma.character.findUnique({ where: { userId }, select: { id: true } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })
    try {
      const id = await prisma.$transaction(async (tx) => {
        const m = await tx.guildMember.findUnique({ where: { characterId: character.id } })
        if (!m) throw new RouteRejection(400, { error: 'Not in a guild' })
        await lockGuild(tx, m.guildId)
        const last = await tx.guildMessage.findFirst({ where: { guildId: m.guildId, characterId: character.id }, orderBy: { id: 'desc' }, select: { createdAt: true } })
        if (last && Date.now() - last.createdAt.getTime() < GUILD_CHAT_COOLDOWN_MS) throw new RouteRejection(429, { error: 'Too fast' })
        const row = await tx.guildMessage.create({ data: { guildId: m.guildId, characterId: character.id, text } })
        await pruneChat(tx, m.guildId)
        return row.id
      })
      return reply.send({ id })
    } catch (e) {
      return sendFailure(request, reply, e)
    }
  })
}

// --- Склад: что из сумки куда ---

const BUILDING_COLUMN: Record<GuildBuilding, 'level' | 'storageLevel' | 'cauldronLevel' | 'libraryLevel' | 'altarLevel'> = {
  level: 'level',
  storage: 'storageLevel',
  cauldron: 'cauldronLevel',
  library: 'libraryLevel',
  altar: 'altarLevel',
}

function parseStorageCount(raw: unknown): number {
  const n = raw === undefined ? 1 : raw
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > GUILD_STORAGE_MAX_PER_ACTION) {
    throw new RouteRejection(400, { error: 'Invalid count', max: GUILD_STORAGE_MAX_PER_ACTION })
  }
  return n
}

type StorageSpec = {
  nameRu: string
  filter: (count: number) => Prisma.CharacterWhereInput
  decrement: (count: number) => Prisma.CharacterUpdateManyMutationInput
  increment: (count: number) => Prisma.CharacterUpdateManyMutationInput
}

/**
 * Расходник, предмет класса или страница по id — с проверкой «занимает клетку»:
 * то, что места в сумке не занимает (зелья, Осколки, страницы), на склад не идёт.
 */
function storageSpec(kind: Exclude<GuildStorageKind, 'item'>, ref: string): StorageSpec {
  if (kind === 'consumable') {
    const spec = CONSUMABLES.find((c) => c.id === ref)
    if (!spec) throw new RouteRejection(400, { error: 'Unknown ref' })
    if (!spec.takesCell) throw new RouteRejection(400, { error: 'Does not take a cell' })
    const column = CONSUMABLE_COLUMN[spec.id]
    return {
      nameRu: spec.nameRu,
      filter: (n) => ({ [column]: { gte: n } }),
      decrement: (n) => ({ [column]: { decrement: n } }),
      increment: (n) => consumableStockIncrement(spec.id, n),
    }
  }
  if (kind === 'classItem') {
    const id = parseClassItemId(ref)
    const spec = id === null ? null : classItemById(id)
    if (id === null || spec === null || !CLASS_ITEMS.includes(spec)) throw new RouteRejection(400, { error: 'Unknown ref' })
    if (!spec.takesCell) throw new RouteRejection(400, { error: 'Does not take a cell' })
    return {
      nameRu: spec.nameRu,
      filter: (n) => classItemStockFilter(id, n),
      decrement: (n) => classItemStockDecrement(id, n),
      increment: (n) => classItemStockIncrement(id, n),
    }
  }
  // Страницы: по каталогу ни одна клетку не занимает — на склад не идут. Ветка
  // оставлена, чтобы страница, которой однажды дадут takesCell, получила понятный
  // отказ, а не молчаливую потерю.
  const scroll = scrollById(ref)
  if (!scroll) throw new RouteRejection(400, { error: 'Unknown ref' })
  throw new RouteRejection(400, { error: 'Does not take a cell' })
}

/** Хватит ли места на складе гильдии под `count` штук `kind/ref`. */
async function checkStorageRoom(
  tx: Prisma.TransactionClient,
  g: { id: number; storageLevel: number; libraryLevel: number },
  kind: GuildStorageKind,
  ref: string,
  count: number,
): Promise<void> {
  const free = kind === 'consumable' && guildBooksFreeInStorage(g.libraryLevel) && (SKILL_BOOK_IDS as readonly string[]).includes(ref)
  if (free) return
  const used = await storageUsed(tx, g.id, g.libraryLevel)
  const cap = guildStorageCapacity(g.storageLevel)
  if (used + count > cap) throw new RouteRejection(400, { error: 'Storage is full', used, cap })
}
