import { FastifyInstance, FastifyRequest } from 'fastify'
import jwt from 'jsonwebtoken'
import { PrismaClient, Prisma } from '@prisma/client'
import { getCurrentEnergy, applyStatGrowth, calculateLevel, TROPHY_GOLD_RATE } from '../game.js'
import { rollRunEvents, KNOWN_MAP_FILES, pickRunMapFile, SMUGGLER_MULT, SMUGGLER_STEAL_FRAC, SMUGGLER_STEAL_CHANCE } from '../runEvents.js'
import { POTION_TIER_COUNT, MAX_SIPS_PER_RUN, MAX_POTIONS_PER_PURCHASE, potionTierByNumber, parsePurchaseCount } from '../potions.js'
// Форма currentRun, её читатели и потолки на выпитое — в общем модуле: тот же
// JSON читает и /auth/login, закрывая брошенный забег (см. runState.ts, шапка).
import {
  type ActiveExploreRun,
  readRunPotionsDrunk,
  readRunConfirmed,
  parseRunProgress,
  coerceRunProgress,
  clampRunProgress,
  runPotionStock,
  runSipsAllowed,
  clampPotionsSpent,
  subtractPotionStock,
  potionStockOf,
  potionStockToColumns,
  readSmugglerDeal,
  type SmugglerDeal,
} from '../runState.js'

const prisma = new PrismaClient()
const RUN_COST = 3 // DEV: снижено с 10 для тестов (вернуть 10 перед релизом)

// --- Общее для финиша и обеих ручек Контрабандиста ---

// Индексы закрытых событий из тела запроса: только целые, в диапазоне, без
// повторов. Мусор (отрицательное, дробное, вне диапазона, дубли) отбрасывается
// молча — он не должен ни портить сумму, ни валить запрос. ОДНА функция на всех
// читателей намеренно: расхождение в валидации между ставкой и финишем дало бы
// разные суммы на одних и тех же данных.
function parseClosedEventIndices(raw: unknown, run: ActiveExploreRun): number[] {
  const list = Array.isArray(raw) ? raw : []
  return [...new Set(list.filter((i) => Number.isInteger(i) && i >= 0 && i < run.events.length))]
}

// Индекс события Контрабандиста в забеге, или -1 если его в этом забеге нет.
// Событие в розыгрыше одно (см. runEvents.ts), findIndex этого достаточно.
function smugglerEventIndex(run: ActiveExploreRun): number {
  return run.events.findIndex((e) => e.kind === 'smuggler')
}

// Сумма trophyReward перечисленных событий, КРОМЕ самого Контрабандиста. Его
// собственный trophyReward сейчас всегда 0 (runEvents.ts), но исключается явно:
// иначе появление у него награды молча удвоило бы ставку.
function trophySumOf(run: ActiveExploreRun, indices: number[]): number {
  const smuggler = smugglerEventIndex(run)
  return indices.reduce((sum, i) => (i === smuggler ? sum : sum + run.events[i].trophyReward), 0)
}

// Ставка сделки: банк персонажа ПЛЮС трофеи событий, закрытых к этому моменту.
// Банк входит целиком — в этом весь смысл механики (на кону всё накопленное, не
// выручка одного забега). Суммы берутся из СВОЕГО currentRun.events, клиент
// называет только индексы.
function stakeFromClosedEvents(bank: number, run: ActiveExploreRun, closed: number[]): number {
  return bank + trophySumOf(run, closed)
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

// Тело обеих ручек Контрабандиста (/run/smuggler-quote и /run/smuggler-deal):
// индексы событий, закрытых к моменту обращения. Валидируются так же, как
// closedEvents финиша (parseClosedEventIndices) — суммы наград клиент не
// присылает вовсе.
type SmugglerBody = { closedEvents?: number[] }

// Body shape for POST /run/start-explore. mapFile is optional — omitted →
// the server picks one itself (pickRunMapFile); the debug map switcher
// (App.tsx) still sends an explicit one, still validated below.
type StartExploreBody = { mapFile?: string }
// Body shape for POST /run/finish-explore. closedEvents — indices into the
// ActiveExploreRun.events array (see FinishExplore route below for how
// they're validated).
// ⚠️ smugglerOutcome БОЛЬШЕ НЕ ЧИТАЕТСЯ: исход сделки бросает сервер
// (/run/smuggler-deal) и хранит в currentRun.smugglerDeal. Поле оставлено в
// типе только потому, что старый клиент его ещё присылает — принять и
// проигнорировать дешевле, чем отказывать всему финишу. Новый клиент его
// слать не должен. attackDamageDealt/
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

    // confirmed: false — забег создан, но игрок его ещё не видел. Снимет флаг
    // POST /run/ready, когда клиент построит мир (а также первый глоток или
    // срез прогресса — любая реальная игра, см. /run/sip и /run/progress).
    // Пока флаг не снят, вход закроет забег БЕЗ штрафа и вернёт энергию:
    // упавшая текстура или оборванная сеть на экране "ПОДГОТОВКА" не должны
    // стоить игроку банка трофеев (см. judgeInterruptedRun в runState.ts).
    //
    // spentEnergy — СПИСАННОЕ ИМЕННО СЕЙЧАС, выражением от тех же двух чисел,
    // что уходят в запись ниже, а не копией RUN_COST. Сегодня это одно и то же
    // (currentEnergy >= RUN_COST проверено выше, клэмпа между ними нет), но
    // привязка к фактической разнице переживёт и смену константы, и появление
    // любых скидок: вернуть при закрытии обязаны ровно то, что сняли.
    const spentEnergy = currentEnergy - newEnergy
    const activeRun: ActiveExploreRun = { mode: 'explore', mapFile, events, hp: maxHp, maxHp, potions: potionStock, sips: potionSips, confirmed: false, spentEnergy }

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

  // Подтверждение старта: клиент дошёл до готовности ПОКАЗАТЬ забег (мир
  // построен, ассеты загружены). До этого момента забег для игрока не
  // существовал, и если приложение закрыли раньше — вход вернёт энергию и не
  // тронет банк трофеев (см. judgeInterruptedRun в runState.ts и /auth/login).
  //
  // Идемпотентен: повтор на уже подтверждённом забеге НИЧЕГО не пишет и
  // отвечает тем же 200. Так повтор после оборванного по таймауту запроса
  // безопасен — тот же приём, что у 409 на финише.
  server.post('/run/ready', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    const run = character.currentRun as unknown as ActiveExploreRun | null
    if (!run || run.mode !== 'explore') {
      return reply.status(400).send({ error: 'No active explore run' })
    }

    const confirmed = readRunConfirmed(run)
    if (confirmed === null) {
      request.log.error(
        { userId, confirmed: run.confirmed },
        'ready: currentRun.confirmed is malformed, treating the run as already confirmed',
      )
    }
    // Уже подтверждён (или забег старого формата, без поля) — писать нечего.
    if (confirmed !== false) {
      return reply.send({ confirmed: true })
    }

    const nextRun: ActiveExploreRun = { ...run, confirmed: true }

    // Условная запись — тот же приём и те же касты, что у /run/sip ниже.
    const written = await prisma.character.updateMany({
      where: { userId, currentRun: { equals: character.currentRun as unknown as Prisma.InputJsonValue } },
      data: { currentRun: nextRun as unknown as Prisma.InputJsonValue },
    })
    if (written.count === 0) {
      return reply.status(409).send({ error: 'Run state changed, retry' })
    }

    return reply.send({ confirmed: true })
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

    // Потолок по тиру — снимок склада на старте забега (потолок 1 clampPotionsSpent).
    const runStock = runPotionStock(run)
    const issued = runStock[tierIndex] ?? 0
    if (drunk[tierIndex] + 1 > issued) {
      return reply.status(400).send({ error: 'Tier stock exhausted', tier: tierSpec.tier, issued, drunk: drunk[tierIndex] })
    }
    // Потолок по сумме — run.sips (потолок 2 clampPotionsSpent), с тем же
    // откатом на MAX_SIPS_PER_RUN для нецелого значения.
    const sipsAllowed = runSipsAllowed(run)
    const drunkTotal = drunk.reduce((sum, n) => sum + n, 0)
    if (drunkTotal + 1 > sipsAllowed) {
      return reply.status(400).send({ error: 'No sips left', sips: sipsAllowed, drunk: drunkTotal })
    }

    const nextDrunk = [...drunk]
    nextDrunk[tierIndex] += 1
    // Глоток — доказательство реальной игры, поэтому он же подтверждает забег
    // (лишнего запроса не появляется: запись currentRun здесь и так идёт).
    // Условие СТРОГО `=== false`: у забега без поля и у подтверждённого объект
    // не меняется ни на байт, иначе условная запись ниже дралась бы сама с
    // собой на ровном месте.
    const nextRun: ActiveExploreRun = {
      ...run,
      potionsDrunk: nextDrunk,
      ...(run.confirmed === false ? { confirmed: true } : {}),
    }

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

  // Срез сырых счётчиков забега в currentRun.progress. Нужен ровно для одного:
  // у забега, брошенного закрытием приложения, /auth/login применяет последний
  // срез и рост статов больше не теряется (без него смерть растила статы, а
  // закрытие — нет, и правило "закрыть приложение не выгоднее смерти"
  // нарушалось в обе стороны).
  //
  // ЗАМЕНА, а не сложение: клиент присылает накопленное С НАЧАЛА ЗАБЕГА, и
  // потерянный по дороге срез ничего не ломает — следующий перезапишет всё
  // равно. Сложение потребовало бы дельт, а дельта, доставленная дважды
  // (повтор после таймаута), посчиталась бы дважды.
  //
  // Потолки здесь НЕ применяются намеренно: они зависят от уровня персонажа на
  // момент ПРИМЕНЕНИЯ и считаются один раз там, где срез превращается в статы
  // (clampRunProgress в /auth/login и в финише). Хранится сырьё.
  server.post<{ Body: unknown }>('/run/progress', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    const run = character.currentRun as unknown as ActiveExploreRun | null
    if (!run || run.mode !== 'explore') {
      return reply.status(400).send({ error: 'No active explore run' })
    }

    // СТРОГО, в отличие от финиша: срез целиком наш собственный формат, и
    // частично разобранному верить нельзя — испорченное поле здесь означает
    // сломанного клиента, о котором надо узнать сразу, а не рост статов,
    // тихо посчитанный от нуля.
    const progress = parseRunProgress(request.body)
    if (progress === null) {
      return reply.status(400).send({ error: 'Invalid progress' })
    }

    // Срез с ненулевыми счётчиками — такое же доказательство игры, что и
    // глоток выше, и подтверждает забег тем же способом и с тем же строгим
    // `=== false` (забег без поля остаётся байт в байт прежним).
    const nextRun: ActiveExploreRun = {
      ...run,
      progress,
      ...(run.confirmed === false ? { confirmed: true } : {}),
    }

    // Условная запись — ровно та же, что у /run/sip выше, и по той же причине:
    // read-modify-write иначе гоняется. Отдельно важно, что срез НЕ может
    // воскресить уже закрытый забег — финиш или вход, обнулившие currentRun
    // между чтением и записью, не совпадут с фильтром, и запись не применится.
    const written = await prisma.character.updateMany({
      where: { userId, currentRun: { equals: character.currentRun as unknown as Prisma.InputJsonValue } },
      data: { currentRun: nextRun as unknown as Prisma.InputJsonValue },
    })
    if (written.count === 0) {
      return reply.status(409).send({ error: 'Run state changed, retry' })
    }

    return reply.send({ progress })
  })

  // Finish a map-based Explore run: award trophies for the events the client
  // closed (amounts come ONLY from the server's own currentRun.events, never
  // from the request body), apply the Contrabandist deal already recorded in
  // currentRun.smugglerDeal (the multiplier itself was applied at deal time, in
  // /run/smuggler-deal — NOT here, and never from the request body),
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

    // Неподтверждённый забег на финише — не отказ: игрок дошёл до конца, и
    // отбирать награды за не долетевший /run/ready нельзя. Но знать об этом
    // надо: либо клиент не шлёт подтверждение, либо оно систематически теряется.
    if (readRunConfirmed(run) === false) {
      request.log.warn({ userId }, 'finish-explore: run was never confirmed by /run/ready')
    }

    const died = request.body.died === true
    // Индексы закрытых событий — общая валидация (parseClosedEventIndices):
    // та же, что у обеих ручек Контрабандиста, иначе ставка и финиш посчитали бы
    // разные суммы на одних и тех же данных.
    const closedEvents = parseClosedEventIndices(request.body.closedEvents, run)

    // --- Трофеи за забег ---
    //
    // Банк ДО забега. Он же банк на СТАРТЕ: за время открытого забега трофеи в
    // БД не меняет ничего (сверено по всем записям в server/src — обмен на
    // золото фильтром требует пустой currentRun, покупка зелий трофеи не
    // трогает, а /auth/login меняет их только ВМЕСТЕ с закрытием забега, после
    // которого этот обработчик получит 400/409).
    const bank = character.trophies
    const dealRead = readSmugglerDeal(run)
    if (dealRead.kind === 'malformed') {
      // Итог посчитать нечем: сделка была, но её числа испорчены. Молча
      // посчитать «как будто сделки не было» нельзя — это тихо отменило бы
      // кражу или отняло выигрыш.
      request.log.error({ userId, smugglerDeal: run.smugglerDeal }, 'finish-explore: currentRun.smugglerDeal is malformed')
      return reply.status(500).send({ error: 'Corrupt run state' })
    }

    // Итоговый банк ПОСЛЕ забега (при смерти обнуляется ниже).
    //   Сделка была: множитель уже применён к ставке в момент сделки
    //     (deal.after), и к результату прибавляется ТОЛЬКО добыча событий,
    //     закрытых ПОСЛЕ неё. Закрытое до сделки второй раз не считается — оно
    //     уже внутри deal.stake.
    //   Сделки не было: банк плюс вся добыча, без множителя — прежнее поведение.
    let total: number
    if (dealRead.kind === 'deal') {
      const deal = dealRead.deal
      const before = new Set(deal.closedBefore)
      const afterDealIndices = closedEvents.filter((i) => !before.has(i))
      total = deal.after + trophySumOf(run, afterDealIndices)
    } else {
      total = bank + trophySumOf(run, closedEvents)
    }

    // ⚠️ Поле smugglerOutcome из тела запроса НЕ ЧИТАЕТСЯ вообще — исход бросает
    // сервер в /run/smuggler-deal и хранит в currentRun.smugglerDeal. Старый
    // клиент поле ещё присылает; оно игнорируется намеренно, а не по забывчивости
    // (прежняя схема позволяла всегда присылать 'gain').
    // Убийство босса — bonusLevels += 1 (см. задачу). "Закрыт" здесь значит
    // ТО ЖЕ самое, что уже решает выплату трофеев выше (closedEvents,
    // провалидированные индексы в run.events ИЗ currentRun, не из тела
    // запроса) — тот же уровень доверия клиенту, что и у trophySum, отдельный
    // сырой флаг "bossKilled" от клиента не заводим и не читаем. run.events[i]
    // само по себе доказывает, что босс в ЭТОМ забеге был (currentRun —
    // серверные данные), а не то, что клиент придумал.
    const bossClosed = closedEvents.some((i) => run.events[i].kind === 'boss')

    const newTrophies = total
    // Насколько банк изменился за забег. ⚠️ МОЖЕТ БЫТЬ ОТРИЦАТЕЛЬНЫМ и нулём не
    // обрезается: при краже у Контрабандиста итог законно меньше банка на
    // старте, и это ровно то, что игрок должен увидеть. Math.max(0, …) здесь
    // превратил бы потерю в правдоподобный ноль (см. CLAUDE.md, запрет тихих
    // фолбэков).
    const earned = newTrophies - bank
    // trophiesLost — the balance actually wiped by death (the character's
    // PRE-update total, not just this run's earned amount): on a normal
    // (non-death) finish nothing was lost, so 0.
    // Не меняется этой правкой: смерть по-прежнему жжёт ВЕСЬ предрановый банк.
    const trophiesLost = died ? bank : 0

    // --- Stat growth (see game.ts applyStatGrowth) — applies regardless of
    // died: the player still dealt/took damage over the run either way. ---
    // level больше не колонка в БД — вычисляется на месте (тот же приём, что
    // в остальных эндпоинтах этого файла), нужен ДО роста статов — и для
    // потолка урона (масштаб врага на текущем уровне), и для сравнения
    // "levelUp?" после.
    const characterLevel = calculateLevel(character.strength, character.agility, character.endurance, character.bonusLevels)

    // Четыре сырых счётчика из тела — МЯГКИЙ разбор (кривое поле становится
    // нулём, остальные живут): у старого клиента их может не быть вовсе, а
    // отказывать всему финишу из-за одного числа нельзя, забег уже сыгран.
    const reportedProgress = coerceRunProgress(request.body)

    // Потолки — общий расчёт (clampRunProgress, runState.ts): ТОТ ЖЕ, которым
    // /auth/login обрабатывает срез брошенного забега. Здесь остаются только
    // логи: что именно срезано и в каком забеге.
    const capped = clampRunProgress(reportedProgress, run, characterLevel)
    if (capped.dealtScale < 1) {
      request.log.warn(
        {
          userId,
          combinedAttackSkill: reportedProgress.attackDamageDealt + reportedProgress.skillDamageDealt,
          maxDamageDealt: capped.maxDamageDealt,
          enemyCount: capped.enemyCount,
          bossCount: capped.bossCount,
          characterLevel,
        },
        'finish-explore: attackDamageDealt+skillDamageDealt exceeded cap, clamped',
      )
    }
    if (reportedProgress.damageTaken > capped.maxDamageTaken) {
      request.log.warn(
        { userId, damageTaken: reportedProgress.damageTaken, maxDamageTaken: capped.maxDamageTaken, runMaxHp: run.maxHp, sips: runSipsAllowed(run) },
        'finish-explore: damageTaken exceeded cap, clamped',
      )
    }
    if (reportedProgress.healedAmount > capped.maxHealed) {
      request.log.warn(
        { userId, healedAmount: reportedProgress.healedAmount, maxHealed: capped.maxHealed },
        'finish-explore: healedAmount exceeded cap, clamped',
      )
    }

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

    // Ступень 2: оба потолка — по каждому тиру (против снимка run.potions из
    // currentRun, а не из тела запроса) и по сумме глотков. Арифметика и
    // порядок среза живут в clampPotionsSpent (runState.ts): /auth/login
    // списывает зелья брошенного забега теми же потолками, и разойтись им
    // нельзя. Тот же уровень доверия клиенту, что у потолка урона выше.
    const runStock = runPotionStock(run)
    const sipsAllowed = runSipsAllowed(run)
    const potionsSpent = clampPotionsSpent(reportedDrunk, runStock, sipsAllowed)
    if (reportedDrunk.some((n, i) => n !== potionsSpent[i])) {
      request.log.warn(
        { userId, reportedDrunk, potionsSpent, runStock, sipsAllowed },
        'finish-explore: potionsDrunkByTier exceeded per-tier or sip cap, clamped',
      )
    }

    // Никогда не в минус, даже если склад сдвинулся между стартом и финишем
    // (например, покупка посреди забега) — см. subtractPotionStock.
    const newPotionStock = subtractPotionStock(potionStockOf(character), potionsSpent)

    const growth = applyStatGrowth(
      character.strength, character.strengthProgress, capped.progress.attackDamageDealt,
      character.endurance, character.enduranceProgress, capped.progress.damageTaken,
      character.agility, character.agilityProgress, capped.progress.skillDamageDealt + capped.progress.healedAmount,
      run.maxHp,
      run.hp,
      newBonusLevels,
    )

    // Условная запись — ТОТ ЖЕ приём, что у /run/sip и /run/progress выше:
    // применяется, только если currentRun в базе всё ещё РОВНО тот, что
    // прочитан в начале обработчика (jsonb-сравнение, порядок ключей не
    // важен). Между чтением и этой строкой забег мог закрыть /auth/login —
    // игрок убил приложение, не дождавшись "Сохраняем итоги...", и зашёл
    // заново. Без фильтра финиш писал бы поверх результата входа от своего,
    // уже устаревшего снимка статов и трофеев.
    // Одна запись на весь обработчик: до неё нет ни записей в БД, ни ответа
    // клиенту — только warn'ы, описывающие расчёт. Поэтому отказ здесь не
    // может оставить забег закрытым наполовину.
    const written = await prisma.character.updateMany({
      where: { userId, currentRun: { equals: character.currentRun as unknown as Prisma.InputJsonValue } },
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
    if (written.count === 0) {
      // Тот же код и текст, что у /run/sip и /run/progress: клиент уже умеет
      // повторять финиш на 409 теми же данными (api.ts, finishRunExplore).
      // Повтор безопасен именно потому, что здесь НИЧЕГО не записано.
      return reply.status(409).send({ error: 'Run state changed, retry' })
    }
    if (written.count !== 1) {
      // Недостижимо, пока Character.userId объявлен @unique (schema.prisma) —
      // фильтр по нему может дать только 0 или 1 строку. Если это всё же
      // случилось, откатить уже нечего: запись применена к нескольким
      // персонажам. Поэтому громко в лог и дальше обычный ответ — тихо
      // проглотить такое нельзя, но и врать клиенту, что забег не сохранён,
      // тоже: его собственная строка записана верно.
      request.log.error(
        { userId, count: written.count },
        'finish-explore: conditional write matched an unexpected number of characters',
      )
    }

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

  // --- Контрабандист: предложение и сделка ---
  //
  // Две ручки вместо одной, потому что у них РАЗНАЯ природа: quote только
  // считает и ничего не пишет (её можно звать сколько угодно, например пока
  // игрок стоит перед панелью), а deal делает неповторимый бросок и пишет его
  // результат. Смешать их в одну значило бы бросать кости на каждое открытие
  // панели.
  //
  // Тело у обеих одно: closedEvents — индексы событий, закрытых К ЭТОМУ
  // МОМЕНТУ. Суммы наград клиент не присылает и не может: они лежат в
  // currentRun.events на сервере (см. stakeFromClosedEvents).

  // Сколько стоит на кону и что будет при удаче. ТОЛЬКО чтение — ни одной записи.
  server.post<{ Body: SmugglerBody }>('/run/smuggler-quote', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    const run = character.currentRun as unknown as ActiveExploreRun | null
    if (!run || run.mode !== 'explore') {
      return reply.status(400).send({ error: 'No active explore run' })
    }
    if (smugglerEventIndex(run) < 0) {
      return reply.status(400).send({ error: 'No smuggler in this run' })
    }

    // Сделка уже была — предложение бессмысленно: второй раз ставку не делают,
    // и показать «на кону N» после броска значило бы соврать.
    const dealRead = readSmugglerDeal(run)
    if (dealRead.kind === 'malformed') {
      request.log.error({ userId, smugglerDeal: run.smugglerDeal }, 'smuggler-quote: currentRun.smugglerDeal is malformed')
      return reply.status(500).send({ error: 'Corrupt run state' })
    }
    if (dealRead.kind === 'deal') {
      return reply.status(409).send({ error: 'Deal already made' })
    }

    const closedEvents = parseClosedEventIndices(request.body?.closedEvents, run)
    const stake = stakeFromClosedEvents(character.trophies, run, closedEvents)

    return reply.send({ stake, ifGain: Math.round(stake * SMUGGLER_MULT) })
  })

  // Сама сделка: бросок и запись результата.
  //
  // ⚠️ ИСХОД БРОСАЕТ СЕРВЕР. Поле smugglerOutcome из тела финиша больше не
  // читается вовсе — прежняя схема («клиент присылает исход, сервер верит на
  // слово») позволяла всегда присылать 'gain'.
  //
  // ИДЕМПОТЕНТНОСТЬ обязательна и держится на самой сделке в currentRun: бросок
  // неповторим, поэтому повторный запрос (потерянный ответ, двойной тап, второе
  // устройство) возвращает УЖЕ СОХРАНЁННОЕ, а не бросает заново. Без этого
  // повтор был бы способом перебросить неудачу.
  server.post<{ Body: SmugglerBody }>('/run/smuggler-deal', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    const run = character.currentRun as unknown as ActiveExploreRun | null
    if (!run || run.mode !== 'explore') {
      return reply.status(400).send({ error: 'No active explore run' })
    }
    if (smugglerEventIndex(run) < 0) {
      return reply.status(400).send({ error: 'No smuggler in this run' })
    }

    const dealRead = readSmugglerDeal(run)
    if (dealRead.kind === 'malformed') {
      request.log.error({ userId, smugglerDeal: run.smugglerDeal }, 'smuggler-deal: currentRun.smugglerDeal is malformed')
      return reply.status(500).send({ error: 'Corrupt run state' })
    }
    // Уже сделана — отдаём то же самое, БЕЗ броска и без записи.
    if (dealRead.kind === 'deal') {
      const { outcome, stake, after } = dealRead.deal
      return reply.send({ outcome, stake, after })
    }

    const closedBefore = parseClosedEventIndices(request.body?.closedEvents, run)
    const stake = stakeFromClosedEvents(character.trophies, run, closedBefore)

    const outcome: SmugglerDeal['outcome'] = Math.random() < SMUGGLER_STEAL_CHANCE ? 'steal' : 'gain'
    const after = outcome === 'gain'
      ? Math.round(stake * SMUGGLER_MULT)
      : Math.round(stake * (1 - SMUGGLER_STEAL_FRAC))

    const deal: SmugglerDeal = { closedBefore, stake, outcome, after }
    const nextRun: ActiveExploreRun = { ...run, smugglerDeal: deal }

    // Условная запись — тот же приём и те же касты, что у /run/sip и финиша:
    // применяется, только если currentRun в базе всё ещё РОВНО тот, что прочитан
    // выше. Между чтением и записью забег мог закрыть финиш или /auth/login —
    // без фильтра сделка «воскресила» бы закрытый забег.
    const written = await prisma.character.updateMany({
      where: { userId, currentRun: { equals: character.currentRun as unknown as Prisma.InputJsonValue } },
      data: { currentRun: nextRun as unknown as Prisma.InputJsonValue },
    })
    if (written.count === 0) {
      // Бросок при этом НЕ сохранён и на следующей попытке будет сделан заново.
      // Это верно: раз забега уже нет, то и сделки в нём быть не может.
      return reply.status(409).send({ error: 'Run state changed, retry' })
    }

    return reply.send({ outcome, stake, after })
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
  server.post<{ Body: { tier?: number; count?: number } }>('/character/buy-potion', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    const rawTier = request.body?.tier
    const tierSpec = Number.isInteger(rawTier) ? potionTierByNumber(rawTier as number) : null
    if (tierSpec === null) {
      return reply.status(400).send({ error: 'Unknown potion tier' })
    }

    // Сколько штук. Поля нет — ровно одно, как шлёт клиент без счётчика: его
    // ответ обязан остаться прежним до байта. Разбор — чистой функцией из
    // каталога (parsePurchaseCount), там же потолок.
    const count = parsePurchaseCount(request.body?.count)
    if (count === null) {
      return reply.status(400).send({ error: 'Invalid count', max: MAX_POTIONS_PER_PURCHASE })
    }

    // Уровень открытия — та же чистая функция от статов, что и везде в файле
    // (колонка Character.level её НЕ источник, только снимок).
    const characterLevel = calculateLevel(character.strength, character.agility, character.endurance, character.bonusLevels)
    if (characterLevel < tierSpec.levelRequired) {
      return reply.status(400).send({ error: 'Tier not unlocked', levelRequired: tierSpec.levelRequired })
    }

    // Цена ВСЕЙ покупки. Прежний ответ 400 и то же поле price (цена за штуку —
    // клиент показывает её в строке отказа), добавился только total.
    const totalPrice = tierSpec.price * count
    if (character.gold < totalPrice) {
      return reply.status(400).send({ error: 'Not enough gold', price: tierSpec.price, total: totalPrice })
    }

    const stock = potionStockOf(character)
    stock[tierSpec.tier - 1] += count

    const updated = await prisma.character.update({
      where: { userId },
      data: {
        gold: character.gold - totalPrice,
        ...potionStockToColumns(stock),
      },
    })

    return reply.send({ gold: updated.gold, potions: potionStockOf(updated) })
  })

  // Обмен трофеев на золото — операция МЕЖДУ забегами (из меню), не путать с
  // Контрабандистом: тот меняет трофеи на трофеи ВНУТРИ забега (SMUGGLER_MULT
  // в finish-explore выше), здесь же рискованная валюта переводится в
  // стабильную по курсу TROPHY_GOLD_RATE (game.ts).
  //
  // Обмен только ПОЛНЫЙ: весь банк разом. Частичного нет намеренно — сумма
  // тогда приходила бы от клиента, и её пришлось бы проверять ещё и на
  // отрицательные/дробные/превышающие банк значения; полный обмен не берёт из
  // тела запроса ничего вообще, поэтому подделывать в нём нечего.
  //
  // Тело — пустой объект {}: ни одно поле не читается.
  server.post('/character/exchange-trophies', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    // Открытый забег — отказ. Банк трофеев в этот момент ещё не решён: финиш
    // его либо пополнит, либо сожжёт целиком (смерть), и /auth/login делает то
    // же самое с брошенным забегом. Обменять банк посреди забега значило бы
    // вынести трофеи из-под риска, ради которого они и существуют (см.
    // CLAUDE.md, Economy: трофеи — рискованная валюта).
    if (character.currentRun !== null) {
      return reply.status(400).send({ error: 'Run in progress' })
    }

    const trophies = character.trophies
    // Нечего менять — честный отказ, а не «успешный» обмен нуля на ноль:
    // клиент обязан отличать «обменял» от «обменивать было нечего».
    if (trophies <= 0) {
      return reply.status(400).send({ error: 'No trophies to exchange' })
    }

    // floor, а не round: округление в пользу игрока здесь дало бы золото из
    // воздуха. При TROPHY_GOLD_RATE >= 1 дробной части не возникает вовсе —
    // см. предупреждение у самой константы (game.ts) о курсе ниже 1.
    const goldGained = Math.floor(trophies * TROPHY_GOLD_RATE)

    // Условная запись — ТОТ ЖЕ приём, что у /run/sip и /run/finish-explore
    // выше: применяется, только если в базе всё ещё РОВНО то состояние, что
    // прочитано в начале обработчика.
    //   trophies в фильтре — против параллельного финиша забега и /auth/login:
    //     оба пишут трофеи (начисляют или обнуляют), и обмен по устаревшему
    //     снимку выдал бы золото за банк, которого уже нет.
    //   пустой currentRun в фильтре — против старта забега, успевшего
    //     открыться между чтением и записью: проверка выше к этому моменту уже
    //     устарела бы.
    // Совпало 0 строк — не записано НИЧЕГО (одна запись на весь обработчик,
    // до неё в БД не ушло ни байта), поэтому повтор клиентом безопасен.
    const written = await prisma.character.updateMany({
      where: { userId, trophies, currentRun: { equals: Prisma.DbNull } },
      data: {
        // increment, а не вычисленное `character.gold + goldGained`: золото
        // могло измениться между чтением и записью (/character/buy-potion его
        // списывает и в этот фильтр не попадает — currentRun он не читает и не
        // пишет, см. CLAUDE.md, «Покупка зелья в окне финиша»). Вычисленное
        // значение затёрло бы покупку старым снимком, increment ложится поверх
        // актуального числа.
        gold: { increment: goldGained },
        trophies: 0,
      },
    })
    if (written.count === 0) {
      return reply.status(409).send({ error: 'State changed, retry' })
    }
    if (written.count !== 1) {
      // Недостижимо, пока Character.userId объявлен @unique (schema.prisma).
      // Тот же громкий лог, что у finish-explore: откатить уже нечего, но
      // проглотить молча запись, задевшую чужих персонажей, нельзя.
      request.log.error(
        { userId, count: written.count },
        'exchange-trophies: conditional write matched an unexpected number of characters',
      )
    }

    // Перечитываем — не вычисляем из старого снимка: increment выше посчитала
    // БАЗА, и единственный честный способ назвать итоговое золото — спросить
    // её. goldGained остаётся тем числом, на которое написан increment: именно
    // его игрок увидит прибавкой.
    const updated = await prisma.character.findUnique({ where: { userId } })
    if (!updated) {
      // Персонаж существовал строкой выше (updateMany нашёл его) — исчезнуть
      // он мог только удалением в ту же секунду. Подставлять сюда
      // правдоподобные числа нельзя: обмен УЖЕ применён, и соврать о балансе
      // хуже, чем громко отказать.
      request.log.error({ userId }, 'exchange-trophies: character vanished between write and read-back')
      return reply.status(500).send({ error: 'Exchange applied but balance could not be read' })
    }

    return reply.send({ gold: updated.gold, trophies: updated.trophies, goldGained })
  })

  // Профиль для сверки баланса — ТОЛЬКО чтение. Нужен магазину, чтобы обновить
  // золото и склад, не устраивая ради этого полный логин: /auth/login закрывает
  // открытый currentRun (как смерть, если забег был подтверждён), и делать это
  // побочным эффектом кнопки «обновить» нельзя.
  // Поэтому здесь НЕТ ни одной записи, currentRun не читается и не трогается,
  // энергия не пересчитывается: getCurrentEnergy сдвигает lastEnergyUpdate у
  // вызывающих её эндпоинтов, а тихо терять остаток минуты на каждом обновлении
  // витрины — цена на пустом месте.
  server.get('/character/profile', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    // gold/potions — той же формы и тем же помощником, что у buy-potion выше:
    // клиент разбирает оба ответа одним кодом. Сверх них профиль несёт ещё два
    // поля, которых у покупки нет:
    //   trophies — банк трофеев. Нужен обмену (POST /character/exchange-trophies
    //     выше): без него единственным источником трофеев остаётся ответ логина,
    //     а тот закрывает открытый забег и кнопкой «обновить» вызываться не
    //     имеет права.
    //   trophyGoldRate — курс обмена. Отдаётся числом ИМЕННО ЗДЕСЬ, чтобы на
    //     клиенте не заводить копию константы (см. TROPHY_GOLD_RATE в game.ts).
    return reply.send({
      gold: character.gold,
      trophies: character.trophies,
      potions: potionStockOf(character),
      trophyGoldRate: TROPHY_GOLD_RATE,
    })
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