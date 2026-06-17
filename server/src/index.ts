import Fastify from 'fastify'
import cors from '@fastify/cors'
import dotenv from 'dotenv'
import { authRoutes } from './routes/auth'

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

// Register routes
await server.register(authRoutes)

// Health check endpoint
server.get('/health', async () => {
  return {
    status: 'ok',
    game: 'Right Place',
    timestamp: new Date().toISOString()
  }
})

// Start server
const start = async () => {
  try {
    await server.listen({ port: 3000, host: '0.0.0.0' })
    console.log('🚀 Right Place server running on port 3000')
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

start()