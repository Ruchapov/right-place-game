import { FastifyInstance, FastifyRequest } from 'fastify'
import jwt from 'jsonwebtoken'
import { PrismaClient, Prisma } from '@prisma/client'
import { getCurrentEnergy, applyStatProgress, calculateLevel, scaledEnemyMaxHp, scaledBossMaxHp, STRENGTH_THRESHOLD_BASE, ENDURANCE_THRESHOLD_BASE, AGILITY_THRESHOLD_BASE } from '../game.js'
import { rollRunEvents, KNOWN_MAP_FILES, pickRunMapFile, SMUGGLER_MULT, SMUGGLER_STEAL_FRAC, type RunEvent } from '../runEvents.js'
import { POTION_TIERS, POTION_TIER_COUNT, MAX_SIPS_PER_RUN, potionTierByNumber } from '../potions.js'

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

// Склад зелий персонажа как массив по тирам (индекс = тир-1) и обратно в поля
// Prisma. Пять колонок вместо Json — цена за атомарные +1/-1 в общем update;
// эти две функции держат разложение в ОДНОМ месте, чтобы номера тиров не
// расползлись строковыми ключами по эндпоинтам.
type PotionColumns = { potionT1: number; potionT2: number; potionT3: number; potionT4: number; potionT5: number }

function potionStockOf(character: PotionColumns): number[] {
  return [character.potionT1, character.potionT2, character.potionT3, character.potionT4, character.potionT5]
}

function potionStockToColumns(stock: number[]): PotionColumns {
  return {
    potionT1: stock[0],
    potionT2: stock[1],
    potionT3: stock[2],
    potionT4: stock[3],
    potionT5: stock[4],
  }
}

// Shape of the active run stored in Character.currentRun for the
// map-based Explore flow (POST /run/start-explore). `mode: 'explore'` is
// the tag that identifies this shape in the JSON field.
// `events` carries the FULL roll (trophyReward/isMimic included) — that part
// never leaves the server; the client only ever gets the stripped-down
// version built in /run/start-explore's response.
// `potions` — снимок склада ПО ТИРАМ на момент старта (длина POTION_TIER_COUNT,
// индекс = тир-1), `sips` — сколько глотков вообще разрешено за забег
// (MAX_SIPS_PER_RUN, но не больше суммы запаса). Раньше здесь был один скаляр,
// который смешивал две разные вещи: сколько есть и сколько можно выпить.
// `potionsDrunk` — выпитое за забег ПО ТИРАМ, пишет /run/sip по одному глотку.
// Склад (potionT1..T5) оно не трогает — списание одним пакетом в
// /run/finish-explore. Необязательное: у забега без глотков и у забега, начатого
// до появления /run/sip, поля нет. Читать только через readRunPotionsDrunk.
type ActiveExploreRun = { mode: 'explore'; mapFile: string; events: RunEvent[]; hp: number; maxHp: number; potions: number[]; sips: number; potionsDrunk?: number[] }

// Выпитое по тирам из currentRun. Поля нет — глотков не было: это честные нули,
// а не догадка. Поле есть, но не массив из POTION_TIER_COUNT неотрицательных
// целых — null: состояние испорчено, и вызывающий обязан сказать об этом
// громко, а не считать с нуля.
function readRunPotionsDrunk(run: ActiveExploreRun): number[] | null {
  const raw: unknown = run.potionsDrunk
  if (raw === undefined) return new Array(POTION_TIER_COUNT).fill(0)
  if (!Array.isArray(raw) || raw.length !== POTION_TIER_COUNT) return null
  if (!raw.every((n) => Number.isInteger(n) && (n as number) >= 0)) return null
  return [...(raw as number[])]
}
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
  // How many potions of EACH tier the client drank this run (Explore.tsx counts
  // them at the gulp frame, not on button press) — index = tier-1. Never
  // trusted as-is: capped per tier against what THIS run was issued
  // (currentRun.potions), then capped again against the run's sip allowance.
  potionsDrunkByTier?: number[]
}
// Body shape for POST /run/sip — один глоток, тир 1..POTION_TIER_COUNT.
type SipBody = { tier?: number }
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
  // Potion stock per tier left AFTER this run's drinks were deducted (index =
  // tier-1) — absolute, like trophies/strength above. The client merges it into
  // `player` so the shop doesn't keep showing the pre-run counts.
  potions: number[]
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
    // Снимок склада ПО ТИРАМ + отдельный лимит глотков. Раньше здесь был один
    // Math.min(potionCharges, 3), смешивавший «сколько есть» и «сколько можно».
    const potionStock = potionStockOf(character)
    const potionSips = Math.min(MAX_SIPS_PER_RUN, potionStock.reduce((sum, n) => sum + n, 0))

    const equippedItems = await prisma.inventoryItem.findMany({
      where: { characterId: character.id, equipped: true },
      include: { item: true },
    })
    const totalArmor = equippedItems.reduce((sum, inv) => sum + (inv.item.armor ?? 0), 0)

    // level больше не колонка в БД — вычисляется на месте из статов+бонуса
    // (см. game.ts calculateLevel), никогда не читается напрямую.
    const characterLevel = calculateLevel(character.strength, character.agility, character.endurance, character.bonusLevels)
    const events = rollRunEvents(mapFile, characterLevel)

    const activeRun: ActiveExploreRun = { mode: 'explore', mapFile, events, hp: maxHp, maxHp, potions: potionStock, sips: potionSips }

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
      potions: potionStock,
      sips: potionSips,
      armor: totalArmor,
    })
  })

  // Зафиксировать ОДИН выпитый глоток по тиру — в currentRun, а не в складе.
  // Колонки potionT1..T5 здесь НЕ трогаются: списание со склада остаётся одним
  // пакетом в /run/finish-explore, иначе выпитое спишется дважды.
  //
  // Потолки — те же, что у finish-explore (ступени 2 и 3 там), но превышение
  // здесь ОТКАЗ 400, а не тихое срезание: о рассинхроне клиент должен узнать на
  // самом глотке.
  server.post<{ Body: SipBody }>('/run/sip', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    const run = character.currentRun as unknown as ActiveExploreRun | null
    if (!run || run.mode !== 'explore') {
      return reply.status(400).send({ error: 'No active explore run' })
    }

    const rawTier = request.body?.tier
    const tierSpec = Number.isInteger(rawTier) ? potionTierByNumber(rawTier as number) : null
    if (tierSpec === null) {
      return reply.status(400).send({ error: 'Unknown potion tier' })
    }
    const tierIndex = tierSpec.tier - 1

    const drunk = readRunPotionsDrunk(run)
    if (drunk === null) {
      request.log.error({ userId, potionsDrunk: run.potionsDrunk }, 'sip: currentRun.potionsDrunk is malformed')
      return reply.status(500).send({ error: 'Corrupt run state' })
    }

    // Потолок по тиру — снимок склада на старте забега (ступень 2 finish-explore).
    const runStock = Array.isArray(run.potions) ? run.potions : []
    const issued = runStock[tierIndex] ?? 0
    if (drunk[tierIndex] + 1 > issued) {
      return reply.status(400).send({ error: 'Tier stock exhausted', tier: tierSpec.tier, issued, drunk: drunk[tierIndex] })
    }
    // Потолок по сумме — run.sips (ступень 3 finish-explore), тот же откат на
    // MAX_SIPS_PER_RUN для нецелого значения.
    const sipsAllowed = Number.isInteger(run.sips) ? run.sips : MAX_SIPS_PER_RUN
    const drunkTotal = drunk.reduce((sum, n) => sum + n, 0)
    if (drunkTotal + 1 > sipsAllowed) {
      return reply.status(400).send({ error: 'No sips left', sips: sipsAllowed, drunk: drunkTotal })
    }

    const nextDrunk = [...drunk]
    nextDrunk[tierIndex] += 1
    const nextRun: ActiveExploreRun = { ...run, potionsDrunk: nextDrunk }

    // Условная запись: применяется, только если currentRun в базе всё ещё РОВНО
    // тот, что прочитан выше (jsonb-сравнение, порядок ключей не важен). Без
    // этого read-modify-write гонялся бы: два глотка подряд теряли бы
    // инкремент, а finish-explore или вход, закрывшие забег между чтением и
    // записью, получили бы currentRun обратно — забег "воскрес" бы, старт
    // следующего упёрся бы в 'A run is already in progress', а ближайший вход
    // закрыл бы его как смерть.
    const written = await prisma.character.updateMany({
      where: { userId, currentRun: { equals: character.currentRun as unknown as Prisma.InputJsonValue } },
      data: { currentRun: nextRun as unknown as Prisma.InputJsonValue },
    })
    if (written.count === 0) {
      return reply.status(409).send({ error: 'Run state changed, retry' })
    }

    return reply.send({ potionsDrunk: nextDrunk, sipsLeft: sipsAllowed - (drunkTotal + 1) })
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
    // Раньше здесь стояло `run.potions * 0.25`, где potions был скаляром, а
    // 0.25 — единственной силой лечения. Теперь глотков ровно run.sips, а
    // лечить они могут по-разному, поэтому берём МАКСИМУМ по каталогу: потолок
    // обязан быть не ниже того, что честный игрок реально мог восстановить,
    // иначе он молча срежет ему рост выносливости.
    const maxHealFrac = Math.max(...POTION_TIERS.map((t) => t.healFrac))
    const runSips = Number.isInteger(run.sips) ? run.sips : MAX_SIPS_PER_RUN
    const maxDamageTaken = run.maxHp * (1 + runSips * maxHealFrac) * 1.5
    if (safeDamageTaken > maxDamageTaken) {
      request.log.warn(
        { userId, damageTaken: safeDamageTaken, maxDamageTaken, runMaxHp: run.maxHp, sips: runSips },
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

    // --- Списание выпитых зелий, по тирам ---
    // Ступень 1: разбор поля. Мусор (нет поля, не массив, не целое, отрицательное,
    // NaN) обнуляется поэлементно — тем же приёмом, что кривые индексы
    // closedEvents выше: не 400, но и не молчаливая догадка. Ноль значит
    // «списывать нечего», он же достаётся старому клиенту, который поля не шлёт.
    const rawDrunk = request.body.potionsDrunkByTier
    const reportedDrunk: number[] = new Array(POTION_TIER_COUNT).fill(0)
    if (Array.isArray(rawDrunk)) {
      for (let i = 0; i < POTION_TIER_COUNT; i++) {
        const v = rawDrunk[i]
        if (Number.isInteger(v) && (v as number) >= 0) reportedDrunk[i] = v as number
      }
    }

    // Сверка с тем, что накопил /run/sip в currentRun. Только ПРЕДУПРЕЖДЕНИЕ:
    // списание по-прежнему идёт от числа клиента (ступени 2–3 ниже), расхождение
    // здесь — сигнал о рассинхроне клиента и сервера, а не повод отказать.
    const recordedDrunk = readRunPotionsDrunk(run)
    if (recordedDrunk === null || reportedDrunk.some((n, i) => n !== recordedDrunk[i])) {
      request.log.warn(
        { userId, reportedDrunk, rawReported: rawDrunk, recordedDrunk, rawRecorded: run.potionsDrunk },
        'finish-explore: potionsDrunkByTier differs from /run/sip record in currentRun',
      )
    }

    // Ступень 2: потолок ПО КАЖДОМУ ТИРУ отдельно — run.potions это снимок из
    // currentRun, а не из тела запроса. Именно эта ступень не даёт списать
    // выпитое дорогое как дешёвое: заявить T5 больше, чем на этот забег было
    // выдано T5, невозможно. Тот же уровень доверия клиенту, что у потолка
    // урона выше.
    const runStock = Array.isArray(run.potions) ? run.potions : []
    const potionsSpent = reportedDrunk.map((n, i) => Math.min(n, runStock[i] ?? 0))

    // Ступень 3: потолок по СУММЕ — за забег разрешено не больше run.sips
    // глотков независимо от тиров. Излишек срезаем с МЛАДШИХ тиров вверх
    // (строгая сторона: дорогие списания сохраняются). Сюда попадаем только
    // если клиент врёт или ошибся в счёте — обе ситуации не должны
    // оборачиваться подарком.
    const sipsAllowed = Number.isInteger(run.sips) ? run.sips : MAX_SIPS_PER_RUN
    let overflow = potionsSpent.reduce((sum, n) => sum + n, 0) - sipsAllowed
    for (let i = 0; i < POTION_TIER_COUNT && overflow > 0; i++) {
      const cut = Math.min(potionsSpent[i], overflow)
      potionsSpent[i] -= cut
      overflow -= cut
    }
    if (reportedDrunk.some((n, i) => n !== potionsSpent[i])) {
      request.log.warn(
        { userId, reportedDrunk, potionsSpent, runStock, sipsAllowed },
        'finish-explore: potionsDrunkByTier exceeded per-tier or sip cap, clamped',
      )
    }

    // Никогда не в минус, даже если склад сдвинулся между стартом и финишем
    // (например, покупка посреди забега).
    const characterStock = potionStockOf(character)
    const newPotionStock = characterStock.map((n, i) => Math.max(0, n - potionsSpent[i]))

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
        // Списывается НЕЗАВИСИМО от died: зелья выпиты по-настоящему, и смерть
        // не должна становиться способом сэкономить склад (та же логика, что у
        // роста статов выше). Обнуление трофеев рядом на эти поля не влияет —
        // разные колонки, один атомарный update.
        ...potionStockToColumns(newPotionStock),
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
      potions: newPotionStock,
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

  // Покупка ОДНОГО зелья указанного тира. Цена и уровень открытия берутся из
  // каталога (src/potions.ts, копия server/src/potions.ts), НЕ из тела запроса:
  // клиент называет только тир. Раньше эндпоинт параметров не принимал вовсе и
  // продавал одно абстрактное зелье за захардкоженные 20 золота.
  server.post<{ Body: { tier?: number } }>('/character/buy-potion', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    const rawTier = request.body?.tier
    const tierSpec = Number.isInteger(rawTier) ? potionTierByNumber(rawTier as number) : null
    if (tierSpec === null) {
      return reply.status(400).send({ error: 'Unknown potion tier' })
    }

    // Уровень открытия — та же чистая функция от статов, что и везде в файле
    // (колонка Character.level её НЕ источник, только снимок).
    const characterLevel = calculateLevel(character.strength, character.agility, character.endurance, character.bonusLevels)
    if (characterLevel < tierSpec.levelRequired) {
      return reply.status(400).send({ error: 'Tier not unlocked', levelRequired: tierSpec.levelRequired })
    }

    if (character.gold < tierSpec.price) {
      return reply.status(400).send({ error: 'Not enough gold', price: tierSpec.price })
    }

    const stock = potionStockOf(character)
    stock[tierSpec.tier - 1] += 1

    const updated = await prisma.character.update({
      where: { userId },
      data: {
        gold: character.gold - tierSpec.price,
        ...potionStockToColumns(stock),
      },
    })

    return reply.send({ gold: updated.gold, potions: potionStockOf(updated) })
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