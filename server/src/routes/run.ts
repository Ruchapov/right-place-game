import { FastifyInstance, FastifyRequest } from 'fastify'
import jwt from 'jsonwebtoken'
import { PrismaClient, Prisma } from '@prisma/client'
import { getCurrentEnergy, applyStatProgress, calculateLevel, scaledEnemyMaxHp, scaledBossMaxHp, STRENGTH_THRESHOLD_BASE, ENDURANCE_THRESHOLD_BASE, AGILITY_THRESHOLD_BASE } from '../game.js'
import { rollRunEvents, KNOWN_MAP_FILES, pickRunMapFile, SMUGGLER_MULT, SMUGGLER_STEAL_FRAC, type RunEvent } from '../runEvents.js'

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

// Applies one fight's worth of RAW damage (no more per-level normalization —
// see game.ts) to all three stats via applyStatProgress, then recomputes
// level via calculateLevel (stat-derived channels + bonusLevels) and adjusts
// HP for any maxHp increase. bonusLevels here is Character.bonusLevels AS OF
// THIS WRITE — the caller decides whether it changed (currently only
// /run/finish-explore increments it on a boss kill, see bossClosed there)
// and passes the already-updated value in; this function only reads it,
// never mutates it.
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

// Shape of the active run stored in Character.currentRun for the
// map-based Explore flow (POST /run/start-explore). `mode: 'explore'` is
// the tag that identifies this shape in the JSON field.
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
// trophies/strength/endurance/agility/level — the character's CURRENT
// (post-update) absolute values, not deltas — the client merges those
// straight into `player` via setPlayer(prev => ({...prev, ...})). Explore never had that
// wiring at all (onRunComplete was dead code) — this is what finally closes
// that gap (see App.tsx handleExploreRunComplete). Returning absolute
// values, not deltas, means the client can never compute a wrong number by
// adding a gain to a stale base — it just overwrites with what the server
// already wrote to the DB.
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
  trophies: number
  strength: number
  endurance: number
  agility: number
  level: number
  // Уровни, полученные НЕ от статов (сейчас только убийство босса в Explore,
  // +1, см. bossClosed в /run/finish-explore) — level выше УЖЕ включает этот
  // бонус (calculateLevel складывает их), это поле для клиента/аналитики
  // отдельно, не источник истины само по себе.
  bonusLevels: number
}

export async function runRoutes(server: FastifyInstance) {
  // Start a map-based Explore run: spend energy, roll 3 events for the given
  // map (server/src/runEvents.ts), save them as the active run.
  server.post<{ Body: StartExploreBody }>('/run/start-explore', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    // Refuse to start over an existing run — starting fresh here would
    // silently discard whatever is in progress.
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

    // This endpoint only ever makes sense for a currentRun that
    // /run/start-explore itself created (mode: 'explore').
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
    // Убийство босса — bonusLevels += 1 (см. задачу). "Закрыт" здесь значит
    // ТО ЖЕ самое, что уже решает выплату трофеев выше (closedEvents,
    // провалидированные индексы в run.events ИЗ currentRun, не из тела
    // запроса) — тот же уровень доверия клиенту, что и у trophySum, отдельный
    // сырой флаг "bossKilled" от клиента не заводим и не читаем. run.events[i]
    // само по себе доказывает, что босс в ЭТОМ забеге был (currentRun —
    // серверные данные), а не то, что клиент придумал.
    const bossClosed = closedEvents.some((i) => run.events[i].kind === 'boss')
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

    // healedAmount — clamp к maxHp забега (тот же базовый принцип, что и у
    // damageTaken выше), складывается со skillDamageDealt внутри applyStatGrowth —
    // скиллы + лечение растят ловкость.
    const clampedHealedAmount = Math.min(safeHealedAmount, run.maxHp)

    // bonusLevels инкрементируется здесь, ДО applyStatGrowth — level (снимок)
    // обязан пересчитаться уже с новым bonusLevels в той же формуле
    // (calculateLevel внутри applyStatGrowth), а не отдельно поверх.
    const newBonusLevels = character.bonusLevels + (bossClosed ? 1 : 0)

    const growth = applyStatGrowth(
      character.strength, character.strengthProgress, clampedAttackDamageDealt,
      character.endurance, character.enduranceProgress, clampedDamageTaken,
      character.agility, character.agilityProgress, clampedSkillDamageDealt + clampedHealedAmount,
      run.maxHp,
      run.hp,
      newBonusLevels,
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
        bonusLevels: newBonusLevels,
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
      trophies: died ? 0 : newTrophies,
      strength: growth.strength,
      endurance: growth.endurance,
      agility: growth.agility,
      level: growth.level,
      bonusLevels: newBonusLevels,
    }
    return reply.send(result)
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