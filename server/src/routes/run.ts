import { FastifyInstance, FastifyRequest } from 'fastify'
import jwt from 'jsonwebtoken'
import { PrismaClient, Prisma } from '@prisma/client'
import { getCurrentEnergy, generateRooms, calculateStrength, calculateEnduranceBonus, checkStatLevelUp } from '../game.js'

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

  const levelsGained = checkStatLevelUp(endurance, strength, enduranceAtLevelUp, strengthAtLevelUp)
  const level = currentLevel + levelsGained
  // Advance the "at last level-up" markers by exactly the thresholds consumed, not to
  // the full current stat value — any extra progress beyond the threshold carries over
  // toward the next level-up instead of being discarded.
  const newEnduranceAtLevelUp = enduranceAtLevelUp + levelsGained * LEVELUP_ENDURANCE_GAIN
  const newStrengthAtLevelUp = strengthAtLevelUp + levelsGained * LEVELUP_STRENGTH_GAIN

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
    })
  })

  // Submit the result of a client-played battle (enemy room). Advances the run.
  server.post<{ Body: BattleResultBody }>('/run/battle-result', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    const run = character.currentRun as unknown as ActiveRun | null
    if (!run) return reply.status(400).send({ error: 'No active run' })

    const roomType = run.rooms[run.index]
    if (roomType !== 'enemy') {
      return reply.status(400).send({ error: `Current room is '${roomType}', not 'enemy'` })
    }

    const { won, damageTaken: rawDamageTaken, damageDealt: rawDamageDealt } = request.body
    const maxHp = character.endurance * 8
    const ENEMY_MAX_HP = 100 // DEV: matches Battle.tsx's hardcoded normal-enemy HP

    // Sanity check: damage taken in one enemy fight can't exceed the player's own max HP,
    // and damage dealt can't exceed the enemy's own max HP.
    const damageTaken = Math.max(0, Math.min(rawDamageTaken, maxHp))
    const damageDealt = Math.max(0, Math.min(rawDamageDealt, ENEMY_MAX_HP))

    const hp = run.hp - damageTaken
    let trophyGained = 0

    if (won) {
      trophyGained = 1 // DEV: 1 trophy per normal enemy, balance later
    }
    // If the player lost (won === false), we trust the client's "lost" claim for now —
    // the run already ends either way once hp <= 0, so there's nothing extra to fake here.

    const newTotalDamageReceived = character.totalDamageReceived + damageTaken
    const newTotalDamageDealt = character.totalDamageDealt + damageDealt

    const growth = applyStatGrowth(
      newTotalDamageDealt,
      newTotalDamageReceived,
      maxHp,
      hp,
    )

    const died = growth.hp <= 0
    const nextIndex = run.index + 1
    const done = !died && nextIndex >= run.rooms.length
    const runEnds = died || done

    const newTrophies = character.trophies + trophyGained

    await prisma.character.update({
      where: { userId },
      data: {
        trophies: died ? 0 : newTrophies, // trophies lost on death, per design
        totalDamageReceived: newTotalDamageReceived,
        totalDamageDealt: newTotalDamageDealt,
        strength: growth.strength,
        endurance: growth.endurance,
        currentRun: runEnds ? Prisma.DbNull : { rooms: run.rooms, index: nextIndex, hp: growth.hp },
      },
    })

    const message = died
      ? `Defeated! −${damageTaken} HP. You died.`
      : won
        ? `Victory! −${damageTaken} HP, +${trophyGained} trophy (${Math.max(0, growth.hp)}/${growth.maxHp})`
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
    })
  })
}