import { FastifyInstance } from 'fastify'
import jwt from 'jsonwebtoken'
import { PrismaClient } from '@prisma/client'
import { getCurrentEnergy, generateRooms } from '../game.js'

const prisma = new PrismaClient()
const RUN_COST = 10

export async function runRoutes(server: FastifyInstance) {
  server.post('/run/start', async (request, reply) => {
    // 1. Read JWT from the Authorization header
    const auth = request.headers.authorization
    if (!auth || !auth.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Missing token' })
    }
    const token = auth.slice('Bearer '.length)

    // 2. Verify token and get userId
    let userId: number
    try {
      const jwtSecret = process.env.JWT_SECRET || 'fallback-secret'
      const payload = jwt.verify(token, jwtSecret)
      if (typeof payload === 'string') throw new Error('bad payload')
      userId = payload.userId as number
    } catch {
      return reply.status(401).send({ error: 'Invalid token' })
    }

    // 3. Load the character
    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) {
      return reply.status(404).send({ error: 'Character not found' })
    }

    // 4. Compute current energy (with regeneration)
    const currentEnergy = getCurrentEnergy(character.energy, character.lastEnergyUpdate)

    // 5. Enough energy for a run?
    if (currentEnergy < RUN_COST) {
      return reply.status(400).send({ error: 'Not enough energy', energy: currentEnergy })
    }

    // 6. Spend energy and generate rooms
    const newEnergy = currentEnergy - RUN_COST
    const rooms = generateRooms(3)

    // 7. Save to DB (new energy + reset the regen timer)
    await prisma.character.update({
      where: { userId },
      data: { energy: newEnergy, lastEnergyUpdate: new Date() },
    })

    // 8. Return result to the client
    return reply.send({ energy: newEnergy, rooms })
  })
}