import { FastifyInstance, FastifyRequest } from 'fastify'
import jwt from 'jsonwebtoken'
import { PrismaClient, Prisma } from '@prisma/client'
import { getCurrentEnergy, generateRooms, calculateStrength, calculateEnduranceBonus } from '../game.js'

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

const BASE_ENDURANCE = 10 // starting Endurance before any damage-driven growth
const LEVELUP_ENDURANCE_GAIN = 3
const LEVELUP_STRENGTH_GAIN = 6

// Recalculates Strength/Endurance from cumulative damage, grows currentRun.hp by the
// same amount maxHp increased (so an Endurance level-up mid-run feels like real
// healing, not just a higher ceiling), and applies any stat-based level-ups earned.
// Returns the new stat values, new level, new "at last level-up" markers, the new
// maxHp, and the (possibly increased) currentRun.hp to save.
function applyStatGrowth(
  totalDamageDealt: number,
  totalDamageReceived: number,
  previousMaxHp: number,
  currentHp: number,
  currentLevel: number,
  enduranceAtLevelUp: number,
  strengthAtLevelUp: number,
) {
  const strength = calculateStrength(totalDamageDealt)
  const endurance = BASE_ENDURANCE + calculateEnduranceBonus(totalDamageReceived)
  const maxHp = endurance * 8
  const hpGain = Math.max(0, maxHp - previousMaxHp)
  const hp = currentHp + hpGain

  const levelsFromEndurance = Math.floor((endurance - enduranceAtLevelUp) / LEVELUP_ENDURANCE_GAIN)
  const levelsFromStrength = Math.floor((strength - strengthAtLevelUp) / LEVELUP_STRENGTH_GAIN)
  const levelsGained = levelsFromEndurance + levelsFromStrength
  const level = currentLevel + levelsGained
  const newEnduranceAtLevelUp = enduranceAtLevelUp + levelsFromEndurance * LEVELUP_ENDURANCE_GAIN
  const newStrengthAtLevelUp = strengthAtLevelUp + levelsFromStrength * LEVELUP_STRENGTH_GAIN

  return {
    strength,
    endurance,
    maxHp,
    hp,
    level,
    levelsGained,
    enduranceAtLevelUp: newEnduranceAtLevelUp,
    strengthAtLevelUp: newStrengthAtLevelUp,
  }
}

// Shape of the active run stored in Character.currentRun (JSON).
type ActiveRun = { rooms: string[]; index: number; hp: number }
// Body shape for POST /run/battle-result.
type BattleResultBody = { won: boolean; damageTaken: number; damageDealt: number }
// Body shape for POST /run/smuggler-result.
type SmugglerResultBody = { exchange: boolean }

const SMUGGLER_MULTIPLIER = 1.5
const SMUGGLER_STEAL_CHANCE = 0.2
const SMUGGLER_STEAL_FRACTION = 0.5

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

    const newGold = character.gold + goldGained
    const newTotalDamageReceived = character.totalDamageReceived + damageTaken

    const growth = applyStatGrowth(
      character.totalDamageDealt,
      newTotalDamageReceived,
      maxHp,
      hp,
      character.level,
      character.enduranceAtLevelUp,
      character.strengthAtLevelUp,
    )

    const died = growth.hp <= 0
    const nextIndex = run.index + 1
    const done = !died && nextIndex >= run.rooms.length
    const runEnds = died || done

    await prisma.character.update({
      where: { userId },
      data: {
        gold: newGold,
        totalDamageReceived: newTotalDamageReceived,
        strength: growth.strength,
        endurance: growth.endurance,
        level: growth.level,
        enduranceAtLevelUp: growth.enduranceAtLevelUp,
        strengthAtLevelUp: growth.strengthAtLevelUp,
        currentRun: runEnds ? Prisma.DbNull : { rooms: run.rooms, index: nextIndex, hp: growth.hp },
      },
    })

    let message: string
    if (died) {
      message = `Trap! −${damageTaken} HP. You died.`
    } else if (roomType === 'chest') {
      message = `Chest! +${goldGained} gold`
    } else if (roomType === 'trap') {
      message = `Trap! −${damageTaken} HP (${Math.max(0, growth.hp)}/${growth.maxHp})`
    } else {
      message = `Entered a ${roomType} room (not implemented yet)`
    }

    return reply.send({
      roomType,
      goldGained,
      damageTaken,
      hp: Math.max(0, growth.hp),
      maxHp: growth.maxHp,
      died,
      message,
      gold: newGold,
      index: nextIndex,
      done,
      level: growth.level,
      levelsGained: growth.levelsGained,
      strength: growth.strength,
      endurance: growth.endurance,
    })
  })

  // Submit the result of a client-played battle (enemy or boss room). Advances the run.
  server.post<{ Body: BattleResultBody }>('/run/battle-result', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    const run = character.currentRun as unknown as ActiveRun | null
    if (!run) return reply.status(400).send({ error: 'No active run' })

    const roomType = run.rooms[run.index]
    if (roomType !== 'enemy' && roomType !== 'boss') {
      return reply.status(400).send({ error: `Current room is '${roomType}', not 'enemy' or 'boss'` })
    }
    const isBoss = roomType === 'boss'

    const { won, damageTaken: rawDamageTaken, damageDealt: rawDamageDealt } = request.body
    const maxHp = character.endurance * 8
    const ENEMY_MAX_HP = isBoss ? 150 : 100 // DEV: matches Battle.tsx's hardcoded enemy HP

    const damageTaken = Math.max(0, Math.min(rawDamageTaken, maxHp))
    const damageDealt = Math.max(0, Math.min(rawDamageDealt, ENEMY_MAX_HP))

    const hp = run.hp - damageTaken
    let trophyGained = 0

    if (won) {
      trophyGained = isBoss
        ? Math.floor(Math.random() * (22 - 15 + 1)) + 15
        : Math.floor(Math.random() * (15 - 10 + 1)) + 10
    }

    const newTotalDamageReceived = character.totalDamageReceived + damageTaken
    const newTotalDamageDealt = character.totalDamageDealt + damageDealt

    const bossLevelUp = isBoss && won
    const growth = applyStatGrowth(
      newTotalDamageDealt,
      newTotalDamageReceived,
      maxHp,
      hp,
      character.level + (bossLevelUp ? 1 : 0),
      character.enduranceAtLevelUp,
      character.strengthAtLevelUp,
    )

    const died = growth.hp <= 0
    const nextIndex = run.index + 1
    const done = !died && nextIndex >= run.rooms.length
    const runEnds = died || done

    const newTrophies = character.trophies + trophyGained

    await prisma.character.update({
      where: { userId },
      data: {
        trophies: died ? 0 : newTrophies,
        totalDamageReceived: newTotalDamageReceived,
        totalDamageDealt: newTotalDamageDealt,
        strength: growth.strength,
        endurance: growth.endurance,
        level: growth.level,
        enduranceAtLevelUp: growth.enduranceAtLevelUp,
        strengthAtLevelUp: growth.strengthAtLevelUp,
        currentRun: runEnds ? Prisma.DbNull : { rooms: run.rooms, index: nextIndex, hp: growth.hp },
      },
    })

    const message = died
      ? `Defeated! −${damageTaken} HP. You died.`
      : won
        ? (isBoss
            ? `Boss defeated! −${damageTaken} HP, +${trophyGained} trophy, Level Up! (${Math.max(0, growth.hp)}/${growth.maxHp})`
            : `Victory! −${damageTaken} HP, +${trophyGained} trophy (${Math.max(0, growth.hp)}/${growth.maxHp})`)
        : `Retreated. −${damageTaken} HP (${Math.max(0, growth.hp)}/${growth.maxHp})`

    return reply.send({
      roomType,
      trophyGained,
      damageTaken,
      hp: Math.max(0, growth.hp),
      maxHp: growth.maxHp,
      died,
      message,
      trophies: died ? 0 : newTrophies,
      index: nextIndex,
      done,
      level: growth.level,
      levelsGained: growth.levelsGained,
      strength: growth.strength,
      endurance: growth.endurance,
    })
  })

  // Submit the player's choice in a Smuggler room: exchange trophies or walk away.
  server.post<{ Body: SmugglerResultBody }>('/run/smuggler-result', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    const run = character.currentRun as unknown as ActiveRun | null
    if (!run) return reply.status(400).send({ error: 'No active run' })

    const roomType = run.rooms[run.index]
    if (roomType !== 'smuggler') {
      return reply.status(400).send({ error: `Current room is '${roomType}', not 'smuggler'` })
    }

    const { exchange } = request.body
    let trophies = character.trophies
    let stolen = false

    // Only attempt the exchange if the player chose to AND actually has trophies to trade.
    if (exchange && trophies > 0) {
      const isStolen = Math.random() < SMUGGLER_STEAL_CHANCE
      if (isStolen) {
        trophies = Math.floor(trophies * (1 - SMUGGLER_STEAL_FRACTION))
        stolen = true
      } else {
        trophies = Math.floor(trophies * SMUGGLER_MULTIPLIER)
      }
    }

    const nextIndex = run.index + 1
    const done = nextIndex >= run.rooms.length

    await prisma.character.update({
      where: { userId },
      data: {
        trophies,
        currentRun: done ? Prisma.DbNull : { rooms: run.rooms, index: nextIndex, hp: run.hp },
      },
    })

    let message: string
    if (!exchange) {
      message = 'You walked away from the smuggler.'
    } else if (trophies === character.trophies && character.trophies === 0) {
      message = 'Nothing to trade.'
    } else if (stolen) {
      message = `The smuggler stole half your trophies! (${trophies} left)`
    } else {
      message = `Trade successful! Trophies: ${trophies}`
    }

    return reply.send({
      roomType,
      exchanged: exchange && character.trophies > 0,
      stolen,
      trophies,
      message,
      hp: run.hp,
      maxHp: character.endurance * 8,
      died: false,
      index: nextIndex,
      done,
    })
  })
}