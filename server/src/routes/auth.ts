import { FastifyInstance } from 'fastify'
import jwt from 'jsonwebtoken'
import { PrismaClient } from '@prisma/client'
import { verifyTelegramInitData, parseTelegramUser } from '../auth.js'

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

    return reply.send({
      token,
      user: {
        id: user.id,
        firstName: user.firstName,
        username: user.username,
      },
      character: user.character
    })
  })
}