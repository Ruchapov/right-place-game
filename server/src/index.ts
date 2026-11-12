import Fastify from 'fastify'
import cors from '@fastify/cors'
import dotenv from 'dotenv'
import { authRoutes } from './routes/auth.js'
import { runRoutes } from './routes/run.js'
import { questRoutes } from './routes/quests.js'
import { friendRoutes } from './routes/friends.js'
import { guildRoutes } from './routes/guild.js'
import { botWebhookRoutes, registerBotWebhook } from './bot/webhook.js'
import { cronRoutes } from './bot/cron.js'
import { botPlayerRoutes, trackActivity } from './bot/routes.js'

// Load environment variables from .env file
dotenv.config()

const server = Fastify({
  logger: true
})

// Allow requests from our frontend
await server.register(cors, {
  origin: [
    'http://localhost:5173',
    'https://ruchapov.github.io',
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
})

// «Игрок в игре» для бота (lastActiveAt) — на корне, чтобы видеть все ручки.
server.addHook('onRequest', trackActivity)

// Register routes
await server.register(authRoutes)
await server.register(runRoutes)
await server.register(questRoutes)
await server.register(friendRoutes)
await server.register(guildRoutes)
await server.register(botWebhookRoutes)
await server.register(cronRoutes)
await server.register(botPlayerRoutes)

// Health check endpoint
server.get('/health', async () => {
  return {
    status: 'ok',
    game: 'Right Place',
    timestamp: new Date().toISOString()
  }
})

// Start server
const port = Number(process.env.PORT) || 3000
const start = async () => {
  try {
    await server.listen({ port, host: '0.0.0.0' })
    console.log(`Right Place server running on port ${port}`)
    void registerBotWebhook(server.log)
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}
start()