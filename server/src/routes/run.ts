import { FastifyInstance, FastifyRequest } from 'fastify'
import jwt from 'jsonwebtoken'
import { PrismaClient, Prisma } from '@prisma/client'
import { getCurrentEnergy, generateRooms } from '../game.js'

const prisma = new PrismaClient()
const RUN_COST = 3 // DEV: снижено с 10 для тестов (вернуть 10 перед релизом)

// Read & verify the JWT from the Authorization header. Returns userId or null.
function getUserId(request: FastifyRequest): number | null {
  const auth = request.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) return null
  const token = auth.slice('Bearer '.length)
  try {
    const jwtSecret = process.env.JWT_SECRET || 'fallback-secret'
    const payload = jwt.verify(token, jwtSecret)
    if (typeof payload === 'string') return null
    return payload.userId as number
  } catch {
    return null
  }
}

// Shape of the active run stored in Character.currentRun (JSON).
type ActiveRun = { rooms: string[]; index: number; hp: number }

export async function runRoutes(server: FastifyInstance) {
  // Start a run: spend energy, generate 3 rooms, save them as the active run.
  server.post('/run/start', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    const currentEnergy = getCurrentEnergy(character.energy, character.lastEnergyUpdate)
    if (currentEnergy < RUN_COST) {
      return reply.status(400).send({ error: 'Not enough energy', energy: currentEnergy })
    }

    const newEnergy = currentEnergy - RUN_COST
    const rooms = generateRooms(3)
    const maxHp = character.endurance * 8

    await prisma.character.update({
      where: { userId },
      data: {
        energy: newEnergy,
        lastEnergyUpdate: new Date(),
        currentRun: { rooms, index: 0, hp: maxHp },
      },
    })

    return reply.send({ energy: newEnergy, rooms, index: 0, hp: maxHp, maxHp })
  })

  // Enter the current room: process it, then advance the run.
  server.post('/run/room', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    const run = character.currentRun as unknown as ActiveRun | null
    if (!run) return reply.status(400).send({ error: 'No active run' })

    const roomType = run.rooms[run.index]
    const maxHp = character.endurance * 8

    let goldGained = 0
    let damageTaken = 0
    let hp = run.hp

    if (roomType === 'chest') {
      goldGained = 10 + Math.floor(Math.random() * 41) // 10..50
    } else if (roomType === 'trap') {
      damageTaken = Math.ceil(maxHp * 0.2) // DEV: 20% макс. HP, балансим позже
      hp = hp - damageTaken
    }

    const died = hp <= 0
    const nextIndex = run.index + 1
    const done = !died && nextIndex >= run.rooms.length
    const runEnds = died || done

    const newGold = character.gold + goldGained
    const newTotalDamageReceived = character.totalDamageReceived + damageTaken

    await prisma.character.update({
      where: { userId },
      data: {
        gold: newGold,
        totalDamageReceived: newTotalDamageReceived,
        currentRun: runEnds ? Prisma.DbNull : { rooms: run.rooms, index: nextIndex, hp },
      },
    })

    let message: string
    if (died) {
      message = `Trap! −${damageTaken} HP. You died.`
    } else if (roomType === 'chest') {
      message = `Chest! +${goldGained} gold`
    } else if (roomType === 'trap') {
      message = `Trap! −${damageTaken} HP (${Math.max(0, hp)}/${maxHp})`
    } else {
      message = `Entered a ${roomType} room (not implemented yet)`
    }

    return reply.send({
      roomType,
      goldGained,
      damageTaken,
      hp: Math.max(0, hp),
      maxHp,
      died,
      message,
      gold: newGold,
      index: nextIndex,
      done,
    })
  })
}