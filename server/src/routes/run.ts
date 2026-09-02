import { FastifyInstance, FastifyRequest } from 'fastify'
import jwt from 'jsonwebtoken'
import { PrismaClient, Prisma } from '@prisma/client'
import { getCurrentEnergy, generateRooms, applyStatProgress, calculateLevel, scaledEnemyMaxHp, scaledBossMaxHp, STRENGTH_THRESHOLD_BASE, ENDURANCE_THRESHOLD_BASE, AGILITY_THRESHOLD_BASE } from '../game.js'
import { PUZZLES, pickRandomPuzzle } from '../puzzles.js'
import { rollRunEvents, KNOWN_MAP_FILES, pickRunMapFile, SMUGGLER_MULT, SMUGGLER_STEAL_FRAC, type RunEvent } from '../runEvents.js'

const prisma = new PrismaClient()
const RUN_COST = 3 // DEV: снижено с 10 для тестов (вернуть 10 перед релизом)

async function rollRandomItem(characterLevel: number) {
  const eligible = await prisma.item.findMany({
    where: { levelRequired: { lte: characterLevel } },
  })
  if (eligible.length === 0) return null
  return eligible[Math.floor(Math.random() * eligible.length)]
}

async function grantItem(characterId: number, item: { id: string }) {
  const existing = await prisma.inventoryItem.findFirst({
    where: { characterId, itemId: item.id },
  })
  if (existing) return null // already owned, skip silently
  return prisma.inventoryItem.create({
    data: { characterId, itemId: item.id, equipped: false },
  })
}

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

// Applies one fight's worth of RAW damage (no more per-level normalization —
// see game.ts) to all three stats via applyStatProgress, then recomputes
// level via calculateLevel (stat-derived channels + bonusLevels) and adjusts
// HP for any maxHp increase. bonusLevels here is Character.bonusLevels AS OF
// THIS WRITE — the caller decides whether it changed (currently only
// /run/battle-result increments it on a boss kill, see there) and passes the
// already-updated value in; this function only reads it, never mutates it.
function applyStatGrowth(
  currentStrength: number, currentStrengthProgress: number, attackDamage: number,
  currentEndurance: number, currentEnduranceProgress: number, damageTaken: number,
  currentAgility: number, currentAgilityProgress: number, skillDamage: number,
  previousMaxHp: number,
  currentHp: number,
  bonusLevels: number,
) {
  const strResult = applyStatProgress(currentStrength, currentStrengthProgress, attackDamage, STRENGTH_THRESHOLD_BASE)
  const endResult = applyStatProgress(currentEndurance, currentEnduranceProgress, damageTaken, ENDURANCE_THRESHOLD_BASE)
  const agiResult = applyStatProgress(currentAgility, currentAgilityProgress, skillDamage, AGILITY_THRESHOLD_BASE)

  const maxHp = endResult.stat * 8
  const hpGain = Math.max(0, maxHp - previousMaxHp)
  const hp = currentHp + hpGain

  const level = calculateLevel(strResult.stat, agiResult.stat, endResult.stat, bonusLevels)

  return {
    strength: strResult.stat,
    strengthProgress: strResult.progress,
    endurance: endResult.stat,
    enduranceProgress: endResult.progress,
    agility: agiResult.stat,
    agilityProgress: agiResult.progress,
    maxHp,
    hp,
    level,
  }
}

// Shape of the active run stored in Character.currentRun (JSON).
// puzzleId is set when the current room is 'puzzle' and a question has been
// generated for it — remembers WHICH puzzle was shown, so the answer can be
// checked against the same question later (puzzles are picked randomly).
type ActiveRun = { rooms: string[]; index: number; hp: number; potions: number; puzzleId?: string }
// Shape of the active run stored in Character.currentRun for the new
// map-based Explore flow (POST /run/start-explore) — separate from ActiveRun
// (old 3-room Battle.tsx flow) so the two never get confused reading the
// same Json field. `mode: 'explore'` is the tag that tells them apart.
// `events` carries the FULL roll (trophyReward/isMimic included) — that part
// never leaves the server; the client only ever gets the stripped-down
// version built in /run/start-explore's response.
type ActiveExploreRun = { mode: 'explore'; mapFile: string; events: RunEvent[]; hp: number; maxHp: number; potions: number }
// Body shape for POST /run/start-explore. mapFile is optional — omitted →
// the server picks one itself (pickRunMapFile); the debug map switcher
// (App.tsx) still sends an explicit one, still validated below.
type StartExploreBody = { mapFile?: string }
// Body shape for POST /run/finish-explore. closedEvents — indices into the
// ActiveExploreRun.events array (see FinishExplore route below for how
// they're validated). smugglerOutcome is only meaningful if a 'smuggler'
// event is among closedEvents; ignored otherwise. attackDamageDealt/
// skillDamageDealt/healedAmount/damageTaken — RAW counters accumulated by
// the client over the whole run (Explore.tsx: attackDamageDealtRef/
// skillDamageDealtRef/healedAmountRef/damageTakenRef), NOT pre-computed stat
// gains — the server runs them through applyStatGrowth itself, after
// clamping to the anti-cheat caps below (see the route).
type FinishExploreBody = {
  closedEvents: number[]
  died: boolean
  smugglerOutcome?: 'gain' | 'steal'
  attackDamageDealt?: number
  skillDamageDealt?: number
  healedAmount?: number
  damageTaken?: number
}
// Shared "run result" shape — one results screen for both ways an Explore
// run can end: the client explicitly finishing it (POST /run/finish-explore)
// or the server finding a stale one still open on the NEXT login (POST
// /auth/login, see auth.ts) and closing it as a death. `interrupted`
// distinguishes the two (false = client-reported finish, true = server
// found it abandoned). `items`/`bonuses` are always empty for now — the
// item-drop and boss "choose a stat" systems don't exist yet; the shape is
// here so those can slot in later without another response-shape change.
// strengthGained/enduranceGained/agilityGained/leveledUp — added for the
// results-screen stat growth display (see /run/finish-explore); an
// interrupted run (auth.ts) never calls applyStatGrowth, so it always
// reports zeros/false there, same convention as items/bonuses above.
export type RunResultSummary = {
  interrupted: boolean
  died: boolean
  trophiesEarned: number
  trophiesLost: number
  eventsClosed: number
  eventsTotal: number
  items: never[]
  bonuses: never[]
  strengthGained: number
  enduranceGained: number
  agilityGained: number
  leveledUp: boolean
}
// Body shape for POST /run/battle-result.
type BattleResultBody = { won: boolean; damageTaken: number; damageDealt: number; skillUses?: number; actualHpLost?: number; potionsUsed?: number; attackDamageDealt?: number; skillDamageDealt?: number; healedAmount?: number }
// Body shape for POST /run/smuggler-result.
type SmugglerResultBody = { exchange: boolean }
// Body shape for POST /run/puzzle-result.
type PuzzleResultBody = { selectedIndex: number }

const SMUGGLER_MULTIPLIER = 1.5
const SMUGGLER_STEAL_CHANCE = 0.2
const SMUGGLER_STEAL_FRACTION = 0.5

const PUZZLE_DAMAGE_FRACTION = 0.2 // same as Trap: 20% of maxHP on a wrong answer
const PUZZLE_GOLD_MIN = 15
const PUZZLE_GOLD_MAX = 60

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
    const existingRun = character.currentRun as ActiveRun | null
    const potions = existingRun ? existingRun.potions : Math.min(character.potionCharges, 3)

    const equippedItems = await prisma.inventoryItem.findMany({
      where: { characterId: character.id, equipped: true },
      include: { item: true },
    })
    const totalArmor = equippedItems.reduce((sum, inv) => sum + (inv.item.armor ?? 0), 0)

    await prisma.character.update({
      where: { userId },
      data: {
        energy: newEnergy,
        lastEnergyUpdate: new Date(),
        currentRun: { rooms, index: 0, hp: maxHp, potions },
      },
    })

    return reply.send({ energy: newEnergy, rooms, index: 0, hp: maxHp, maxHp, potions, armor: totalArmor })
  })

  // Start a map-based Explore run: spend energy, roll 3 events for the given
  // map (server/src/runEvents.ts), save them as the active run. Separate
  // endpoint from /run/start (old 3-room flow) — that one is untouched, this
  // is a parallel path for the new Explore map flow.
  server.post<{ Body: StartExploreBody }>('/run/start-explore', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    // Unlike /run/start, refuse to start over an existing run of EITHER
    // shape (old ActiveRun or ActiveExploreRun) — starting fresh here would
    // silently discard whatever is in progress, old flow has no such guard.
    if (character.currentRun !== null) {
      return reply.status(400).send({ error: 'A run is already in progress' })
    }

    // Not sent — server rolls a map itself (pickRunMapFile). Sent — exact
    // match against the whitelist, not a prefix/regex check, so the client
    // can't hand us an arbitrary filename to read off disk (this path is
    // still used by the debug map switcher in App.tsx).
    const { mapFile: requestedMapFile } = request.body
    let mapFile: string
    if (requestedMapFile === undefined) {
      mapFile = pickRunMapFile()
    } else {
      if (!(KNOWN_MAP_FILES as readonly string[]).includes(requestedMapFile)) {
        return reply.status(400).send({ error: 'Unknown mapFile' })
      }
      mapFile = requestedMapFile
    }

    const currentEnergy = getCurrentEnergy(character.energy, character.lastEnergyUpdate)
    if (currentEnergy < RUN_COST) {
      return reply.status(400).send({ error: 'Not enough energy', energy: currentEnergy })
    }

    const newEnergy = currentEnergy - RUN_COST
    const maxHp = character.endurance * 8
    const potions = Math.min(character.potionCharges, 3)

    const equippedItems = await prisma.inventoryItem.findMany({
      where: { characterId: character.id, equipped: true },
      include: { item: true },
    })
    const totalArmor = equippedItems.reduce((sum, inv) => sum + (inv.item.armor ?? 0), 0)

    // level больше не колонка в БД — вычисляется на месте из статов+бонуса
    // (см. game.ts calculateLevel), никогда не читается напрямую.
    const characterLevel = calculateLevel(character.strength, character.agility, character.endurance, character.bonusLevels)
    const events = rollRunEvents(mapFile, characterLevel)

    const activeRun: ActiveExploreRun = { mode: 'explore', mapFile, events, hp: maxHp, maxHp, potions }

    await prisma.character.update({
      where: { userId },
      data: {
        energy: newEnergy,
        lastEnergyUpdate: new Date(),
        currentRun: activeRun,
      },
    })

    // Rewards (trophyReward/isMimic) stay server-side — the client learns
    // them per-event, later, through a separate mechanism. Only kind/x/y
    // (and clusterPoints, needed to spawn the whole enemy group) go out.
    const clientEvents = events.map((ev) => ({
      kind: ev.kind,
      x: ev.x,
      y: ev.y,
      ...(ev.clusterPoints ? { clusterPoints: ev.clusterPoints } : {}),
    }))

    return reply.send({
      energy: newEnergy,
      mapFile,
      events: clientEvents,
      maxHp,
      level: characterLevel,
      potions,
      armor: totalArmor,
    })
  })

  // Finish a map-based Explore run: award trophies for the events the client
  // closed (amounts come ONLY from the server's own currentRun.events, never
  // from the request body), apply the Contrabandist multiplier if rolled,
  // zero trophies on death, close currentRun.
  server.post<{ Body: FinishExploreBody }>('/run/finish-explore', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    // Distinguish from the old 3-room ActiveRun shape (no `mode` field) —
    // this endpoint only ever makes sense for a currentRun that /run/start-explore
    // itself created. A run in the old shape is a different flow entirely,
    // not something to coerce/repair here.
    const run = character.currentRun as unknown as ActiveExploreRun | null
    if (!run || run.mode !== 'explore') {
      return reply.status(400).send({ error: 'No active explore run' })
    }

    const died = request.body.died === true
    // Indices only, deduped, in range — garbage from the client (out-of-range,
    // negative, repeated, non-integer) is silently dropped rather than
    // corrupting the sum or throwing.
    const rawClosedEvents = Array.isArray(request.body.closedEvents) ? request.body.closedEvents : []
    const closedEvents = [...new Set(
      rawClosedEvents.filter((i) => Number.isInteger(i) && i >= 0 && i < run.events.length)
    )]

    const trophySum = closedEvents.reduce((sum, i) => sum + run.events[i].trophyReward, 0)

    // Multiplier applies to the TOTAL for the run, after summing every closed
    // event — not to the smuggler event's own (always-0) trophyReward. Order
    // in which events were closed isn't tracked server-side, so this is a
    // deliberate simplification (confirmed — not a bug): if the smuggler was
    // the ONLY closed event, trophySum is 0 and the multiplier correctly
    // yields 0 either way.
    const smugglerClosed = closedEvents.some((i) => run.events[i].kind === 'smuggler')
    const smugglerOutcome = request.body.smugglerOutcome
    let trophyTotal = trophySum
    if (smugglerClosed && smugglerOutcome === 'gain') {
      trophyTotal = trophySum * SMUGGLER_MULT
    } else if (smugglerClosed && smugglerOutcome === 'steal') {
      trophyTotal = trophySum * (1 - SMUGGLER_STEAL_FRAC)
    }
    const earned = Math.round(trophyTotal)

    const newTrophies = character.trophies + earned
    // trophiesLost — the balance actually wiped by death (the character's
    // PRE-update total, not just this run's earned amount): on a normal
    // (non-death) finish nothing was lost, so 0.
    const trophiesLost = died ? character.trophies : 0

    // --- Stat growth (see game.ts applyStatGrowth) — applies regardless of
    // died: the player still dealt/took damage over the run either way. ---
    // level больше не колонка в БД — вычисляется на месте (тот же приём, что
    // в остальных эндпоинтах этого файла), нужен ДО роста статов — и для
    // потолка урона (масштаб врага на текущем уровне), и для сравнения
    // "levelUp?" после.
    const characterLevel = calculateLevel(character.strength, character.agility, character.endurance, character.bonusLevels)

    // TODO: временная диагностика (см. задачу) — убрать после выяснения,
    // почему strengthProgress/enduranceProgress не растут. Сырые значения
    // ДО клэмпа/дефолта, как пришли в теле запроса.
    request.log.info(
      {
        userId,
        rawAttackDamageDealt: request.body.attackDamageDealt,
        rawSkillDamageDealt: request.body.skillDamageDealt,
        rawHealedAmount: request.body.healedAmount,
        rawDamageTaken: request.body.damageTaken,
      },
      'finish-explore: raw counters received',
    )

    const safeAttackDamageDealt = Math.max(0, request.body.attackDamageDealt ?? 0)
    const safeSkillDamageDealt = Math.max(0, request.body.skillDamageDealt ?? 0)
    const safeHealedAmount = Math.max(0, request.body.healedAmount ?? 0)
    const safeDamageTaken = Math.max(0, request.body.damageTaken ?? 0)

    // Потолок нанесённого урона (анти-чит) — число врагов ЭТОГО забега
    // (сумма clusterPoints у kind:'enemy' событий run.events — из
    // currentRun, клиенту не доверяем) × HP врага на уровне персонажа, ПЛЮС
    // число боссов × HP босса на том же уровне (scaledBossMaxHp — множитель
    // BOSS_HP_MULT поверх scaledEnemyMaxHp, см. game.ts) — иначе забег с
    // одним боссом и без обычных врагов давал потолок 0 и обрезал весь урон.
    // Всё вместе × запас 1.5 (промахи/оверкилл).
    const enemyCount = run.events
      .filter((ev) => ev.kind === 'enemy')
      .reduce((sum, ev) => sum + (ev.clusterPoints?.length ?? 0), 0)
    const bossCount = run.events.filter((ev) => ev.kind === 'boss').length
    const maxDamageDealt = (enemyCount * scaledEnemyMaxHp(characterLevel) + bossCount * scaledBossMaxHp(characterLevel)) * 1.5

    const combinedAttackSkill = safeAttackDamageDealt + safeSkillDamageDealt
    const attackSkillScale =
      combinedAttackSkill > maxDamageDealt && combinedAttackSkill > 0 ? maxDamageDealt / combinedAttackSkill : 1
    if (attackSkillScale < 1) {
      request.log.warn(
        { userId, combinedAttackSkill, maxDamageDealt, enemyCount, bossCount, characterLevel },
        'finish-explore: attackDamageDealt+skillDamageDealt exceeded cap, clamped',
      )
    }
    const clampedAttackDamageDealt = Math.round(safeAttackDamageDealt * attackSkillScale)
    const clampedSkillDamageDealt = Math.round(safeSkillDamageDealt * attackSkillScale)

    // Потолок полученного урона (анти-чит) — maxHp ЭТОГО забега (снимок
    // run.maxHp из currentRun, посчитан при /run/start-explore — не
    // character.endurance*8 заново: доверяем тому же снимку, что и ниже у
    // "зарядов зелья") × (1 + заряды зелий забега × 0.25 — полное лечение
    // каждым зарядом) × запас 1.5.
    const maxDamageTaken = run.maxHp * (1 + run.potions * 0.25) * 1.5
    if (safeDamageTaken > maxDamageTaken) {
      request.log.warn(
        { userId, damageTaken: safeDamageTaken, maxDamageTaken, runMaxHp: run.maxHp, potions: run.potions },
        'finish-explore: damageTaken exceeded cap, clamped',
      )
    }
    const clampedDamageTaken = Math.min(safeDamageTaken, maxDamageTaken)

    // healedAmount — та же схема, что /run/battle-result: clamp к maxHp
    // забега (не отдельный "потолок" из задачи, а то же базовое ограничение,
    // что там), складывается со skillDamageDealt внутри applyStatGrowth —
    // скиллы + лечение растят ловкость.
    const clampedHealedAmount = Math.min(safeHealedAmount, run.maxHp)

    const growth = applyStatGrowth(
      character.strength, character.strengthProgress, clampedAttackDamageDealt,
      character.endurance, character.enduranceProgress, clampedDamageTaken,
      character.agility, character.agilityProgress, clampedSkillDamageDealt + clampedHealedAmount,
      run.maxHp,
      run.hp,
      character.bonusLevels, // не трогаем — босс отдельным шагом
    )

    await prisma.character.update({
      where: { userId },
      data: {
        trophies: died ? 0 : newTrophies,
        strength: growth.strength,
        strengthProgress: growth.strengthProgress,
        endurance: growth.endurance,
        enduranceProgress: growth.enduranceProgress,
        agility: growth.agility,
        agilityProgress: growth.agilityProgress,
        level: growth.level, // денормализованный снимок — см. комментарий к полю в schema.prisma
        currentRun: Prisma.DbNull,
      },
    })

    const result: RunResultSummary = {
      interrupted: false,
      died,
      trophiesEarned: earned,
      trophiesLost,
      eventsClosed: closedEvents.length,
      eventsTotal: run.events.length,
      items: [],
      bonuses: [],
      strengthGained: growth.strength - character.strength,
      enduranceGained: growth.endurance - character.endurance,
      agilityGained: growth.agility - character.agility,
      leveledUp: growth.level > characterLevel,
    }
    return reply.send(result)
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
    // level больше не колонка в БД — вычисляется на месте из статов+бонуса
    // (см. game.ts calculateLevel), никогда не читается напрямую.
    const characterLevel = calculateLevel(character.strength, character.agility, character.endurance, character.bonusLevels)

    let goldGained = 0
    let damageTaken = 0
    let hp = run.hp
    let droppedItem: { name: string; slot: string; iconPath: string } | null = null

    if (roomType === 'chest') {
      goldGained = 10 + Math.floor(Math.random() * 41) // 10..50
      const item = await rollRandomItem(characterLevel)
      if (item) {
        await grantItem(character.id, item)
        droppedItem = { name: item.nameRu, slot: item.slot, iconPath: item.iconPath }
      }
    } else if (roomType === 'trap') {
      damageTaken = Math.ceil(maxHp * 0.2) // DEV: 20% макс. HP, балансим позже
      hp = hp - damageTaken
    }

    const newGold = character.gold + goldGained

    // bonusLevels не меняется в этой комнате — передаём как есть, не пишем
    // обратно в БД (в data ниже поля bonusLevels нет).
    const growth = applyStatGrowth(
      character.strength, character.strengthProgress, 0,
      character.endurance, character.enduranceProgress, damageTaken,
      character.agility, character.agilityProgress, 0,
      maxHp,
      hp,
      character.bonusLevels,
    )
    const levelsGained = growth.level - characterLevel

    const died = growth.hp <= 0
    const nextIndex = run.index + 1
    const done = !died && nextIndex >= run.rooms.length
    const runEnds = died || done

    await prisma.character.update({
      where: { userId },
      data: {
        gold: newGold,
        strength: growth.strength,
        strengthProgress: growth.strengthProgress,
        endurance: growth.endurance,
        enduranceProgress: growth.enduranceProgress,
        agility: growth.agility,
        agilityProgress: growth.agilityProgress,
        level: growth.level, // денормализованный снимок — см. комментарий к полю в schema.prisma
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
      levelsGained,
      strength: growth.strength,
      endurance: growth.endurance,
      droppedItem,
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
    const actualHpLost = request.body.actualHpLost ?? rawDamageTaken
    const potionsUsed = request.body.potionsUsed ?? 0
    const attackDamageDealt = request.body.attackDamageDealt ?? 0
    const skillDamageDealt = request.body.skillDamageDealt ?? 0
    const healedAmount = request.body.healedAmount ?? 0
    const potionsInRun = (run.potions ?? Math.min(character.potionCharges, 3)) - potionsUsed
    const newPotionCharges = Math.max(0, character.potionCharges - potionsUsed)
    const maxHp = character.endurance * 8
    // level больше не колонка в БД — вычисляется на месте из статов+бонуса
    // (см. game.ts calculateLevel), никогда не читается напрямую. Это
    // уровень ДО этого боя — SCALED_ENEMY_HP/дроп считаются по нему же, а не
    // по уровню ПОСЛЕ (даже если этот бой — победа над боссом и bonusLevels
    // сейчас вырастет, врага в ЭТОМ бою масштабируем по тому, каким игрок
    // был, когда в него зашёл).
    const characterLevel = calculateLevel(character.strength, character.agility, character.endurance, character.bonusLevels)
    const SCALED_ENEMY_HP = Math.round((isBoss ? 200 : 120) * (1 + 0.18 * (characterLevel - 1)))
    const damageTaken = Math.max(0, Math.min(rawDamageTaken, maxHp))
    const damageDealt = Math.max(0, Math.min(rawDamageDealt, SCALED_ENEMY_HP))
    const safeAttackDamageDealt = Math.max(0, attackDamageDealt)
    const safeSkillDamageDealt = Math.max(0, skillDamageDealt)
    const combinedAttackSkill = safeAttackDamageDealt + safeSkillDamageDealt
    const attackSkillScale = combinedAttackSkill > SCALED_ENEMY_HP ? SCALED_ENEMY_HP / combinedAttackSkill : 1
    const clampedAttackDamageDealt = Math.round(safeAttackDamageDealt * attackSkillScale)
    const clampedSkillDamageDealt = Math.round(safeSkillDamageDealt * attackSkillScale)
    const clampedHealedAmount = Math.max(0, Math.min(healedAmount, maxHp))

    const hp = run.hp - Math.max(0, Math.min(actualHpLost, maxHp))
    let trophyGained = 0
    let droppedItem: { name: string; slot: string; iconPath: string } | null = null

    if (won) {
      trophyGained = isBoss
        ? Math.floor(Math.random() * (22 - 15 + 1)) + 15
        : Math.floor(Math.random() * (15 - 10 + 1)) + 10
    }

    if (won && !isBoss) {
      const dropChance = 1.0 // TODO: lower to 0.15 after testing
      if (Math.random() < dropChance) {
        const item = await rollRandomItem(characterLevel)
        if (item) {
          await grantItem(character.id, item)
          droppedItem = { name: item.nameRu, slot: item.slot, iconPath: item.iconPath }
        }
      }
    }

    // Убийство босса — bonusLevels += 1, НАВСЕГДА (не пересчитывается из
    // статов, только инкремент по событию — см. calculateLevel в game.ts).
    // Ничего больше отсюда не следует: сам бой прокачивает силу/выносл./
    // ловкость обычным путём (нормальный applyStatGrowth ниже), bonusLevels
    // — отдельная, независимая надбавка поверх стат-уровня.
    const bossLevelUp = isBoss && won
    const newBonusLevels = character.bonusLevels + (bossLevelUp ? 1 : 0)
    const growth = applyStatGrowth(
      character.strength, character.strengthProgress, clampedAttackDamageDealt,
      character.endurance, character.enduranceProgress, damageTaken,
      character.agility, character.agilityProgress, clampedSkillDamageDealt + clampedHealedAmount,
      maxHp,
      hp,
      newBonusLevels,
    )
    const levelsGained = growth.level - characterLevel

    const died = growth.hp <= 0
    const nextIndex = run.index + 1
    const done = !died && nextIndex >= run.rooms.length
    const runEnds = died || done

    const newTrophies = character.trophies + trophyGained

    await prisma.character.update({
      where: { userId },
      data: {
        trophies: died ? 0 : newTrophies,
        strength: growth.strength,
        strengthProgress: growth.strengthProgress,
        endurance: growth.endurance,
        enduranceProgress: growth.enduranceProgress,
        agility: growth.agility,
        agilityProgress: growth.agilityProgress,
        bonusLevels: newBonusLevels,
        level: growth.level, // денормализованный снимок — см. комментарий к полю в schema.prisma
        potionCharges: newPotionCharges,
        currentRun: runEnds ? Prisma.DbNull : { rooms: run.rooms, index: nextIndex, hp: growth.hp, potions: Math.max(0, potionsInRun) },
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
      levelsGained,
      strength: growth.strength,
      endurance: growth.endurance,
      potions: Math.max(0, potionsInRun),
      droppedItem,
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

  // Get the puzzle question for the current room (generates and remembers one if
  // not already picked for this room visit, so a refresh doesn't get a new question).
  server.post('/run/puzzle', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    const run = character.currentRun as unknown as ActiveRun | null
    if (!run) return reply.status(400).send({ error: 'No active run' })

    const roomType = run.rooms[run.index]
    if (roomType !== 'puzzle') {
      return reply.status(400).send({ error: `Current room is '${roomType}', not 'puzzle'` })
    }

    // Reuse the puzzle if one was already picked for this room visit; otherwise
    // pick a new one and remember it in currentRun.
    let puzzle = PUZZLES.find((p) => p.id === run.puzzleId)
    if (!puzzle) {
      puzzle = pickRandomPuzzle()
      await prisma.character.update({
        where: { userId },
        data: { currentRun: { ...run, puzzleId: puzzle.id } },
      })
    }

    return reply.send({ question: puzzle.question, options: puzzle.options })
  })

  // Submit the player's answer to the current puzzle. Advances the run.
  server.post<{ Body: PuzzleResultBody }>('/run/puzzle-result', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    const run = character.currentRun as unknown as ActiveRun | null
    if (!run) return reply.status(400).send({ error: 'No active run' })

    const roomType = run.rooms[run.index]
    if (roomType !== 'puzzle') {
      return reply.status(400).send({ error: `Current room is '${roomType}', not 'puzzle'` })
    }

    const puzzle = PUZZLES.find((p) => p.id === run.puzzleId)
    if (!puzzle) {
      return reply.status(400).send({ error: 'No puzzle was generated for this room — call /run/puzzle first' })
    }

    const { selectedIndex } = request.body
    const correct = selectedIndex === puzzle.correctIndex
    const maxHp = character.endurance * 8
    // level больше не колонка в БД — вычисляется на месте из статов+бонуса
    // (см. game.ts calculateLevel), никогда не читается напрямую.
    const characterLevel = calculateLevel(character.strength, character.agility, character.endurance, character.bonusLevels)

    let goldGained = 0
    let damageTaken = 0
    let hp = run.hp

    if (correct) {
      goldGained = Math.floor(Math.random() * (PUZZLE_GOLD_MAX - PUZZLE_GOLD_MIN + 1)) + PUZZLE_GOLD_MIN
    } else {
      damageTaken = Math.ceil(maxHp * PUZZLE_DAMAGE_FRACTION)
      hp = hp - damageTaken
    }

    const newGold = character.gold + goldGained

    // bonusLevels не меняется в загадке — передаём как есть, не пишем
    // обратно в БД (в data ниже поля bonusLevels нет).
    const growth = applyStatGrowth(
      character.strength, character.strengthProgress, 0,
      character.endurance, character.enduranceProgress, damageTaken,
      character.agility, character.agilityProgress, 0,
      maxHp,
      hp,
      character.bonusLevels,
    )
    const levelsGained = growth.level - characterLevel

    const died = growth.hp <= 0
    const nextIndex = run.index + 1
    const done = !died && nextIndex >= run.rooms.length
    const runEnds = died || done

    await prisma.character.update({
      where: { userId },
      data: {
        gold: newGold,
        strength: growth.strength,
        strengthProgress: growth.strengthProgress,
        endurance: growth.endurance,
        enduranceProgress: growth.enduranceProgress,
        agility: growth.agility,
        agilityProgress: growth.agilityProgress,
        level: growth.level, // денормализованный снимок — см. комментарий к полю в schema.prisma
        currentRun: runEnds ? Prisma.DbNull : { rooms: run.rooms, index: nextIndex, hp: growth.hp },
      },
    })

    const message = died
      ? `Wrong answer! −${damageTaken} HP. You died.`
      : correct
        ? `Correct! +${goldGained} gold`
        : `Wrong answer! −${damageTaken} HP (${Math.max(0, growth.hp)}/${growth.maxHp})`

    return reply.send({
      roomType,
      correct,
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
      levelsGained,
      strength: growth.strength,
      endurance: growth.endurance,
    })
  })

  server.post<{ Body: { skills: string[] } }>('/character/skills', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const { skills } = request.body
    const VALID_SKILLS = ['heal', 'dash', 'fireball', 'slash', 'iceball']
    const MAX_SKILLS = 2

    if (!Array.isArray(skills)) return reply.status(400).send({ error: 'skills must be an array' })
    if (skills.length > MAX_SKILLS) return reply.status(400).send({ error: `Max ${MAX_SKILLS} skills allowed` })
    if (skills.some(s => !VALID_SKILLS.includes(s))) return reply.status(400).send({ error: 'Invalid skill name' })

    await prisma.character.update({
      where: { userId },
      data: { equippedSkills: skills },
    })

    return reply.send({ equippedSkills: skills })
  })

  server.post('/character/buy-potion', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    const POTION_COST = 20
    if (character.gold < POTION_COST) {
      return reply.status(400).send({ error: 'Not enough gold' })
    }

    const updated = await prisma.character.update({
      where: { userId },
      data: {
        gold: character.gold - POTION_COST,
        potionCharges: character.potionCharges + 1,
      },
    })

    return reply.send({ gold: updated.gold, potionCharges: updated.potionCharges })
  })

  server.get('/character/inventory', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    const inventoryItems = await prisma.inventoryItem.findMany({
      where: { characterId: character.id },
      include: { item: true },
      orderBy: { acquiredAt: 'asc' },
    })

    return reply.send({
      inventory: inventoryItems.map((inv) => ({
        inventoryItemId: inv.id,
        equipped: inv.equipped,
        item: {
          id: inv.item.id,
          slot: inv.item.slot,
          tier: inv.item.tier,
          nameRu: inv.item.nameRu,
          iconPath: inv.item.iconPath,
          levelRequired: inv.item.levelRequired,
          damage: inv.item.damage,
          armor: inv.item.armor,
          moveSpeed: inv.item.moveSpeed,
          luck: inv.item.luck,
        },
      })),
    })
  })

  server.post<{ Body: { inventoryItemId: string; equip: boolean } }>('/character/equip', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    const { inventoryItemId, equip } = request.body

    const inventoryItem = await prisma.inventoryItem.findUnique({
      where: { id: inventoryItemId },
      include: { item: true },
    })
    if (!inventoryItem || inventoryItem.characterId !== character.id) {
      return reply.status(404).send({ error: 'Inventory item not found' })
    }

    if (equip === true) {
      // level больше не колонка в БД — вычисляется на месте из статов+бонуса
      // (см. game.ts calculateLevel), никогда не читается напрямую.
      const characterLevel = calculateLevel(character.strength, character.agility, character.endurance, character.bonusLevels)
      if (characterLevel < inventoryItem.item.levelRequired) {
        return reply.status(400).send({ error: 'Недостаточный уровень' })
      }

      const currentlyEquipped = await prisma.inventoryItem.findFirst({
        where: { characterId: character.id, equipped: true, item: { slot: inventoryItem.item.slot } },
        include: { item: true },
      })

      if (currentlyEquipped) {
        await prisma.inventoryItem.update({
          where: { id: currentlyEquipped.id },
          data: { equipped: false },
        })
      }

      await prisma.inventoryItem.update({
        where: { id: inventoryItem.id },
        data: { equipped: true },
      })

      return reply.send({
        success: true,
        equippedItemId: inventoryItem.id,
        unequippedItemId: currentlyEquipped ? currentlyEquipped.id : null,
      })
    } else {
      await prisma.inventoryItem.update({
        where: { id: inventoryItem.id },
        data: { equipped: false },
      })

      return reply.send({ success: true, equippedItemId: null, unequippedItemId: inventoryItem.id })
    }
  })
}