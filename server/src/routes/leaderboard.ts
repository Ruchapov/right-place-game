// Рейтинг (17.11.2026): GET /leaderboard?board=level|newbies|guilds|hunters|bosses.
// Вкладка «Сообщество → Рейтинг» (src/ui/LeaderboardPanel.tsx).
//
// Ответ: { board, rows: [{ place, name, guildTag, emblem, value, isMe, members? }], me: { place, value } | null }
//   rows — топ-50; у доски guilds строка — гильдия (name — её название, guildTag —
//   тег, members — число участников).
//
// Порядок при равенстве — один для топа и для me.place:
//   level / newbies: level ↓, (strength + agility + endurance) ↓, id ↑;
//   hunters / bosses: значение ↓, id героя ↑; героев с нулём в доске нет;
//   guilds: level ↓, участников ↓, createdAt ↑ (и id ↑ — чтобы порядок был полным).
// me.place = записей строго выше по этому порядку + 1, одним COUNT.
//
// Уровень героя — колонка Character.level (снимок). Её пишут все три места, где
// меняются статы: финиш (settleExploreRun), вход (закрытие брошенного забега) и
// Ловчий — сверено по коду 17.11.2026, а снимок в базе совпал с calculateLevel
// у всех героев. Новое место, растящее статы без level, — разойдётся молча.
//
// Кэш — только топ-50, по 60 с на доску, в памяти процесса; isMe и me считаются
// на каждый запрос. Имя героя — User.firstName, не длиннее 16 знаков; username
// Telegram не отдаётся.
import type { FastifyInstance } from 'fastify'
import { Prisma, PrismaClient } from '@prisma/client'
import { getUserId } from './run.js'

const prisma = new PrismaClient()

export const LEADERBOARD_BOARDS = ['level', 'newbies', 'guilds', 'hunters', 'bosses'] as const
export type LeaderboardBoard = typeof LEADERBOARD_BOARDS[number]

const TOP_N = 50
const CACHE_MS = 60_000
const NEWBIE_DAYS = 14
const NAME_MAX = 16

type Emblem = { symbol: number; frame: number; bg: number; color: number }
type Row = { place: number; name: string; guildTag: string | null; emblem: Emblem | null; value: number; members?: number }
/** Строка кэша: строка ответа + чей это id (героя или гильдии) — для isMe. */
type CachedRow = { row: Row; ownerId: number }

const cache = new Map<LeaderboardBoard, { at: number; rows: CachedRow[] }>()

function parseBoard(raw: unknown): LeaderboardBoard | null {
  return typeof raw === 'string' && (LEADERBOARD_BOARDS as readonly string[]).includes(raw) ? raw as LeaderboardBoard : null
}

function shortName(name: string): string {
  return Array.from(name).slice(0, NAME_MAX).join('')
}

function newbieCutoff(): Date {
  return new Date(Date.now() - NEWBIE_DAYS * 24 * 3600_000)
}

type HeroSqlRow = {
  id: number
  value: number
  firstName: string
  tag: string | null
  emblemSymbol: number | null
  emblemFrame: number | null
  emblemBg: number | null
  emblemColor: number | null
}

function heroRow(r: HeroSqlRow, place: number): CachedRow {
  const inGuild = r.tag !== null && r.emblemSymbol !== null && r.emblemFrame !== null && r.emblemBg !== null && r.emblemColor !== null
  return {
    ownerId: r.id,
    row: {
      place,
      name: shortName(r.firstName),
      guildTag: inGuild ? r.tag : null,
      emblem: inGuild ? { symbol: r.emblemSymbol!, frame: r.emblemFrame!, bg: r.emblemBg!, color: r.emblemColor! } : null,
      value: Number(r.value),
    },
  }
}

const HERO_GUILD_JOIN = Prisma.sql`
  JOIN "User" u ON u.id = c."userId"
  LEFT JOIN "GuildMember" gm ON gm."characterId" = c.id
  LEFT JOIN "Guild" g ON g.id = gm."guildId"`

/** Колонка счётчика доски охотников/боссов — из белого списка, не из запроса. */
function statColumn(board: 'hunters' | 'bosses'): Prisma.Sql {
  return board === 'hunters' ? Prisma.raw('h."killsTotal"') : Prisma.raw('h."bossesKilled"')
}

async function loadTop(board: LeaderboardBoard): Promise<CachedRow[]> {
  if (board === 'level' || board === 'newbies') {
    const where = board === 'newbies' ? Prisma.sql`WHERE c."createdAt" >= ${newbieCutoff()}` : Prisma.empty
    const rows = await prisma.$queryRaw<HeroSqlRow[]>`
      SELECT c.id, c.level AS value, u."firstName", g.tag, g."emblemSymbol", g."emblemFrame", g."emblemBg", g."emblemColor"
      FROM "Character" c ${HERO_GUILD_JOIN}
      ${where}
      ORDER BY c.level DESC, (c.strength + c.agility + c.endurance) DESC, c.id ASC
      LIMIT ${TOP_N}`
    return rows.map((r, i) => heroRow(r, i + 1))
  }
  if (board === 'hunters' || board === 'bosses') {
    const col = statColumn(board)
    const rows = await prisma.$queryRaw<HeroSqlRow[]>`
      SELECT c.id, ${col} AS value, u."firstName", g.tag, g."emblemSymbol", g."emblemFrame", g."emblemBg", g."emblemColor"
      FROM "HeroStats" h JOIN "Character" c ON c.id = h."characterId" ${HERO_GUILD_JOIN}
      WHERE ${col} > 0
      ORDER BY ${col} DESC, c.id ASC
      LIMIT ${TOP_N}`
    return rows.map((r, i) => heroRow(r, i + 1))
  }
  const rows = await prisma.$queryRaw<{ id: number; name: string; tag: string; level: number; members: bigint; emblemSymbol: number; emblemFrame: number; emblemBg: number; emblemColor: number }[]>`
    SELECT g.id, g.name, g.tag, g.level, g."emblemSymbol", g."emblemFrame", g."emblemBg", g."emblemColor",
           (SELECT COUNT(*) FROM "GuildMember" m WHERE m."guildId" = g.id) AS members
    FROM "Guild" g
    ORDER BY g.level DESC, members DESC, g."createdAt" ASC, g.id ASC
    LIMIT ${TOP_N}`
  return rows.map((r, i) => ({
    ownerId: r.id,
    row: {
      place: i + 1,
      name: r.name,
      guildTag: r.tag,
      emblem: { symbol: r.emblemSymbol, frame: r.emblemFrame, bg: r.emblemBg, color: r.emblemColor },
      value: r.level,
      members: Number(r.members),
    },
  }))
}

async function topOf(board: LeaderboardBoard): Promise<CachedRow[]> {
  const hit = cache.get(board)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows
  const rows = await loadTop(board)
  cache.set(board, { at: Date.now(), rows })
  return rows
}

type Me = { characterId: number; level: number; statSum: number; createdAt: Date; guildId: number | null }

/** Моё место и значение; null — меня в этой доске нет. */
async function myPlace(board: LeaderboardBoard, me: Me): Promise<{ place: number; value: number } | null> {
  if (board === 'level' || board === 'newbies') {
    const cutoff = board === 'newbies' ? newbieCutoff() : null
    if (cutoff !== null && me.createdAt < cutoff) return null
    const where = cutoff !== null ? Prisma.sql`c."createdAt" >= ${cutoff} AND` : Prisma.empty
    const [r] = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM "Character" c
      WHERE ${where} (
        c.level > ${me.level}
        OR (c.level = ${me.level} AND (c.strength + c.agility + c.endurance) > ${me.statSum})
        OR (c.level = ${me.level} AND (c.strength + c.agility + c.endurance) = ${me.statSum} AND c.id < ${me.characterId})
      )`
    return { place: Number(r.n) + 1, value: me.level }
  }
  if (board === 'hunters' || board === 'bosses') {
    const stats = await prisma.heroStats.findUnique({ where: { characterId: me.characterId }, select: { killsTotal: true, bossesKilled: true } })
    const value = stats === null ? 0 : board === 'hunters' ? stats.killsTotal : stats.bossesKilled
    if (value <= 0) return null
    const col = statColumn(board)
    const [r] = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM "HeroStats" h
      WHERE ${col} > ${value} OR (${col} = ${value} AND h."characterId" < ${me.characterId})`
    return { place: Number(r.n) + 1, value }
  }
  if (me.guildId === null) return null
  const [mine] = await prisma.$queryRaw<{ level: number; createdAt: Date; members: bigint }[]>`
    SELECT g.level, g."createdAt", (SELECT COUNT(*) FROM "GuildMember" m WHERE m."guildId" = g.id) AS members
    FROM "Guild" g WHERE g.id = ${me.guildId}`
  if (mine === undefined) return null
  const members = Number(mine.members)
  const [r] = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n FROM (
      SELECT g.id, g.level, g."createdAt", (SELECT COUNT(*) FROM "GuildMember" m WHERE m."guildId" = g.id) AS members
      FROM "Guild" g
    ) t
    WHERE t.level > ${mine.level}
      OR (t.level = ${mine.level} AND t.members > ${members})
      OR (t.level = ${mine.level} AND t.members = ${members} AND t."createdAt" < ${mine.createdAt})
      OR (t.level = ${mine.level} AND t.members = ${members} AND t."createdAt" = ${mine.createdAt} AND t.id < ${me.guildId})`
  return { place: Number(r.n) + 1, value: mine.level }
}

export async function leaderboardRoutes(server: FastifyInstance) {
  server.get<{ Querystring: { board?: string } }>('/leaderboard', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })
    const board = parseBoard(request.query.board)
    if (board === null) return reply.status(400).send({ error: 'Unknown board', boards: LEADERBOARD_BOARDS })

    const c = await prisma.character.findUnique({
      where: { userId },
      select: { id: true, level: true, strength: true, agility: true, endurance: true, createdAt: true, guildMember: { select: { guildId: true } } },
    })
    if (!c) return reply.status(404).send({ error: 'Character not found' })
    const me: Me = {
      characterId: c.id,
      level: c.level,
      statSum: c.strength + c.agility + c.endurance,
      createdAt: c.createdAt,
      guildId: c.guildMember?.guildId ?? null,
    }

    const top = await topOf(board)
    const myId = board === 'guilds' ? me.guildId : me.characterId
    return reply.send({
      board,
      rows: top.map(({ row, ownerId }) => ({ ...row, isMe: ownerId === myId })),
      me: await myPlace(board, me),
    })
  })
}
