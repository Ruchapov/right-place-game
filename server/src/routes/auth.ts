import { FastifyInstance } from 'fastify'
import jwt from 'jsonwebtoken'
import { PrismaClient, Prisma } from '@prisma/client'
import { verifyTelegramInitData, parseTelegramUser } from '../auth.js'
import { getCurrentEnergy, calculateLevel } from '../game.js'
import type { RunResultSummary } from './run.js'

const prisma = new PrismaClient()

export async function authRoutes(server: FastifyInstance) {
  // POST /auth/login — verify Telegram initData and return JWT
  server.post<{
    Body: { initData: string }
  }>('/auth/login', async (request, reply) => {
    const { initData } = request.body

    if (!initData) {
      return reply.status(400).send({ error: 'initData is required' })
    }

    // Verify initData signature from Telegram
    const botToken = process.env.BOT_TOKEN
    if (!botToken) {
      return reply.status(500).send({ error: 'Server configuration error' })
    }

    const isValid = await verifyTelegramInitData(initData, botToken)
    if (!isValid) {
      return reply.status(401).send({ error: 'Invalid initData' })
    }

    // Parse user from initData
    const telegramUser = parseTelegramUser(initData)
    if (!telegramUser) {
      return reply.status(400).send({ error: 'Cannot parse user data' })
    }

    // Find or create user in database
    let user = await prisma.user.findUnique({
      where: { telegramId: BigInt(telegramUser.id) },
      include: { character: true }
    })

    if (!user) {
      // New player — create user + character
      user = await prisma.user.create({
        data: {
          telegramId: BigInt(telegramUser.id),
          firstName: telegramUser.first_name,
          username: telegramUser.username,
          character: {
            create: {} // All defaults from schema
          }
        },
        include: { character: true }
      })
    }

    // Generate JWT token (expires in 7 days)
    const jwtSecret = process.env.JWT_SECRET || 'fallback-secret'
    const token = jwt.sign(
      { userId: user.id, telegramId: telegramUser.id },
      jwtSecret,
      { expiresIn: '7d' }
    )

    const char = user.character
    if (!char) return reply.status(500).send({ error: 'No character' })

    // A map-based Explore run (mode: 'explore', see routes/run.ts) left open
    // when the player closed the app is abandoned on the next login — there
    // is no way to know what they were doing, so it's closed as a death,
    // same treatment POST /run/finish-explore gives an explicit died:true.
    // Trophies and currentRun are wiped in the SAME update (not two separate
    // calls) — split them and a crash between the two would leave the run
    // closed but the trophies intact, making closing the app strictly better
    // than dying, which is exactly the outcome the design forbids (see
    // CLAUDE.md: "закрыть приложение никогда не должно быть выгоднее, чем
    // умереть в забеге"). A run in the OLD (3-room Battle.tsx) shape has no
    // `mode` field at all — left completely untouched, it's a different flow.
    const rawRun = char.currentRun as unknown
    let interruptedRun: RunResultSummary | undefined

    if (rawRun && typeof rawRun === 'object' && (rawRun as { mode?: unknown }).mode === 'explore') {
      const run = rawRun as { events?: unknown[] }
      const trophiesLost = char.trophies
      const eventsTotal = Array.isArray(run.events) ? run.events.length : 0

      await prisma.character.update({
        where: { id: char.id },
        data: { trophies: 0, currentRun: Prisma.DbNull },
      })
      char.trophies = 0

      interruptedRun = {
        interrupted: true,
        died: true,
        trophiesEarned: 0,
        trophiesLost,
        eventsClosed: 0, // сервер не знает прогресс брошенного забега — осознанно всегда 0
        eventsTotal,
        items: [],
        bonuses: [],
        // Брошенный забег закрывается как смерть БЕЗ applyStatGrowth (сервер
        // не знает, что игрок успел сделать) — тот же принцип, что и у
        // eventsClosed/items/bonuses выше: нечего показать, значит нули.
        strengthGained: 0,
        enduranceGained: 0,
        agilityGained: 0,
        leveledUp: false,
        // Абсолютные значения — статы тут НЕ менялись (см. выше), просто
        // текущие char.*, тем же приёмом, что ответ /run/finish-explore.
        trophies: 0,
        strength: char.strength,
        endurance: char.endurance,
        agility: char.agility,
        level: calculateLevel(char.strength, char.agility, char.endurance, char.bonusLevels),
        bonusLevels: char.bonusLevels, // не менялся — брошенный забег бонус не даёт
      }
    }

    // level — денормализованный снимок в БД (см. комментарий к полю в
    // schema.prisma), но эндпоинт профиля им не пользуется — уровень для
    // ответа клиенту всегда пересчитывается явно, как и везде в проекте
    // (см. calculateLevel в game.ts, правило "логика level не читает").
    const level = calculateLevel(char.strength, char.agility, char.endurance, char.bonusLevels)

    return reply.send({
      token,
      user: {
        id: user.id,
        firstName: user.firstName,
        username: user.username,
      },
      character: { ...char, level, energy: getCurrentEnergy(char.energy, char.lastEnergyUpdate), equippedSkills: char.equippedSkills, potionCharges: char.potionCharges },
      ...(interruptedRun ? { interruptedRun } : {}),
    })
  })
}