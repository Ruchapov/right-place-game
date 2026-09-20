const SERVER_URL = 'https://right-place-game.onrender.com'

export type LoginResponse = {
  token: string
  user: { id: number; firstName: string; username: string | null }
  character: {
    level: number
    energy: number
    gold: number
    endurance: number
    strength: number
    agility: number
    luck: number
    trophies: number
    equippedSkills: string[]
    // Склад зелий по тирам, индекс = тир-1 (см. src/potions.ts). Заменил
    // прежний скалярный potionCharges.
    potions: number[]
  }
  // Present only if the server found a stale map-based Explore run (mode:
  // 'explore') still open from a previous session and closed it as a death
  // — see server/src/routes/auth.ts. character.trophies above already
  // reflects the wipe; this just carries the summary for the results screen.
  interruptedRun?: RunResultSummary
}

export async function loginWithTelegram(initDataRaw: string): Promise<LoginResponse> {
  const response = await fetch(`${SERVER_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData: initDataRaw }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(`Login failed: ${response.status} ${JSON.stringify(err)}`)
  }

  return await response.json() as LoginResponse
}
// Event kind returned by /run/start-explore — same 6 kinds as
// server/src/runEvents.ts's RunEventKind.
export type StartExploreEventKind = 'enemy' | 'chest' | 'smuggler' | 'puzzle' | 'boss' | 'obelisk'

export type StartExploreEvent = {
  kind: StartExploreEventKind
  x: number
  y: number
  clusterPoints?: [number, number][]
}

// Response shape of POST /run/start-explore (server/src/routes/run.ts) —
// rewards (trophyReward/isMimic) are intentionally NOT part of this: the
// server keeps them out of the response, see the endpoint's own comment.
export type StartExploreResult = {
  energy: number
  mapFile: string
  events: StartExploreEvent[]
  maxHp: number
  level: number
  // Снимок склада ПО ТИРАМ на старт забега (индекс = тир-1) и лимит глотков
  // за забег (MAX_SIPS_PER_RUN, но не больше суммы запаса).
  potions: number[]
  sips: number
  armor: number
}

// mapFile необязателен — не передан → сервер сам выбирает карту (см.
// server/src/runEvents.ts, pickRunMapFile) и называет её в ответе
// (StartExploreResult.mapFile); тело запроса в этом случае уходит БЕЗ поля
// mapFile вовсе, а не с mapFile: undefined.
export async function startRunExplore(token: string, mapFile?: string): Promise<StartExploreResult> {
  const response = await fetch(`${SERVER_URL}/run/start-explore`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(mapFile !== undefined ? { mapFile } : {}),
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(`Start explore failed: ${response.status} ${JSON.stringify(err)}`)
  }
  return await response.json() as StartExploreResult
}

// Shared "run result" shape — server/src/routes/run.ts's RunResultSummary,
// 1:1. Returned by POST /run/finish-explore, and also shows up as
// LoginResponse.interruptedRun (see below) when the server finds a stale
// explore run still open on the next login and closes it as a death.
// strengthGained/enduranceGained/agilityGained/leveledUp — always 0/false on
// an interrupted run (server never runs stat growth there); on a normal
// finish, real numbers from the server — the client-side fallback
// (Explore.tsx buildClientResult) can't estimate these itself (no access to
// the DB-side progress accumulators), so it also reports 0/false until the
// server's response replaces it.
// trophies/strength/endurance/agility/level — CURRENT absolute values (not
// deltas) — App.tsx merges those straight into `player`. Explore.tsx's
// buildClientResult fallback also fills these in,
// but with best-effort numbers that are never actually consumed — the
// player-state merge (App.tsx handleExploreRunComplete) only ever fires
// from the real server response, not the client-only estimate.
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
  // Склад зелий ПО ТИРАМ после списания выпитого за забег (индекс = тир-1) —
  // абсолютные значения из БД, как trophies/strength выше (App.tsx мержит их
  // в player, иначе в магазине висел бы запас до списания).
  potions: number[]
  // Уровни НЕ от статов (сейчас только убийство босса, +1) — level выше УЖЕ
  // включает этот бонус (calculateLevel на сервере складывает их), это поле
  // отдельно на будущее/аналитику, само по себе не источник истины.
  bonusLevels: number
}

// Response shape of POST /run/finish-explore (server/src/routes/run.ts).
export type FinishExploreResult = RunResultSummary

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Причина последней неудачной попытки финиша — те же три вида, что у глотка
// (см. SipFailureKind ниже): timeout — прервал наш таймер, network — fetch
// отказал сам, http — сервер ответил кодом ошибки.
export type FinishFailureKind = 'timeout' | 'network' | 'http'

// Отказ /run/finish-explore после всех повторов — по образцу SipError: экрану
// итогов мало факта ошибки, ему нужны код и текст сервера и число попыток,
// чтобы отличить "забег на сервере уже закрыт" (400 'No active explore run'
// после попытки, которая могла дойти, или 200 с нечитаемым телом) от
// настоящего провала.
export class FinishExploreError extends Error {
  /** HTTP-код последней попытки; null — ответа не было (таймаут или сеть). */
  status: number | null
  /** Поле error из тела ответа; null — тела нет или в нём не строка. */
  serverError: string | null
  /** Сколько попыток сделано всего, включая повторы. */
  attempts: number
  /** Причина последней неудачной попытки, см. FinishFailureKind. */
  kind: FinishFailureKind
  /** true — повторы оборвал общий бюджет времени (FINISH_TOTAL_BUDGET_MS), а не их лимит. */
  budgetExhausted: boolean
  /** Исход каждой попытки по порядку — для консоли. */
  attemptLog: string[]
  /** Исходная ошибка fetch при сетевом сбое или таймауте, иначе null. */
  networkError: unknown
  constructor(message: string, fields: {
    status: number | null
    serverError: string | null
    attempts: number
    kind: FinishFailureKind
    budgetExhausted: boolean
    attemptLog: string[]
    networkError: unknown
  }) {
    super(message)
    this.status = fields.status
    this.serverError = fields.serverError
    this.attempts = fields.attempts
    this.kind = fields.kind
    this.budgetExhausted = fields.budgetExhausted
    this.attemptLog = fields.attemptLog
    this.networkError = fields.networkError
  }
}

// Повторы — прежние: сетевая ошибка, таймаут попытки и 5xx повторяются до 2
// раз (пауза короткая-потом-длиннее), 4xx — отказ сразу.
//
// Время ограничено ЯВНО, по той же схеме, что у recordSip, но с бОльшими
// числами: без финиша итоги забега теряются, а сервер на Render Free засыпает
// после простоя и просыпается порядка минуты — первый запрос после сна ждёт
// весь подъём.
//   FINISH_ATTEMPT_TIMEOUT_MS = 20 с — одна попытка (запрос + чтение тела).
//     Короче подъёма сервера намеренно: попытка, прерванная на просыпающемся
//     сервере, уступает место следующей, которая застаёт его уже проснувшимся.
//   FINISH_TOTAL_BUDGET_MS = 60 с — весь вызов с повторами и паузами; столько
//     максимум висит "Сохраняем итоги..." с заблокированной кнопкой меню.
//     20 + 0,3 + 20 + 1,2 = 41,5 с до третьей попытки — ей остаётся 18,5 с.
// Прерванная таймаутом попытка могла всё же дойти до сервера и закрыть забег;
// тогда следующая получит 400 'No active explore run' — Explore разбирает это
// отдельно (FinishExploreError.attempts > 1).
const FINISH_EXPLORE_RETRY_DELAYS_MS = [300, 1200]
const FINISH_ATTEMPT_TIMEOUT_MS = 20000
const FINISH_TOTAL_BUDGET_MS = 60000

export async function finishRunExplore(
  token: string,
  closedEvents: number[],
  died: boolean,
  smugglerOutcome?: 'gain' | 'steal',
  // Сырые счётчики за забег (см. Explore.tsx — attackDamageDealtRef/
  // skillDamageDealtRef/healedAmountRef/damageTakenRef), НЕ готовые приросты
  // статов — сервер сам прогоняет их через applyStatGrowth, после клэмпа по
  // анти-читерским потолкам (см. server/src/routes/run.ts). Оружие и скиллы
  // — раздельно (оружие растит силу, скиллы+лечение — ловкость).
  attackDamageDealt?: number,
  skillDamageDealt?: number,
  healedAmount?: number,
  damageTaken?: number,
  // Сколько зелий КАЖДОГО ТИРА реально выпито за забег (Explore.tsx:
  // potionsDrunkByTierRef — считается по факту списания на кадре глотка),
  // индекс = тир-1. Сервер клэмпит по каждому тиру отдельно (по выданному на
  // забег) и по сумме глотков, затем вычитает из колонок potionT1..T5.
  potionsDrunkByTier?: number[],
): Promise<FinishExploreResult> {
  const body = JSON.stringify({ closedEvents, died, smugglerOutcome, attackDamageDealt, skillDamageDealt, healedAmount, damageTaken, potionsDrunkByTier })
  const deadline = Date.now() + FINISH_TOTAL_BUDGET_MS
  const attemptLog: string[] = []
  let retries = 0
  let attempts = 0
  let lastKind: FinishFailureKind = 'timeout'

  // Следующая пауза перед повтором, если повтор ещё разрешён И пауза
  // укладывается в бюджет. null — повторять нельзя; budgetExhausted различает
  // "кончился бюджет" и "кончились повторы".
  const nextRetryDelay = (): { delay: number | null; budgetExhausted: boolean } => {
    const delay = FINISH_EXPLORE_RETRY_DELAYS_MS[retries]
    if (delay === undefined) return { delay: null, budgetExhausted: false }
    if (Date.now() + delay >= deadline) return { delay: null, budgetExhausted: true }
    return { delay, budgetExhausted: false }
  }

  while (true) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      throw new FinishExploreError(`Finish explore failed (${lastKind}, time budget exhausted) after ${attempts} attempts: ${attemptLog.join('; ')}`, {
        status: null, serverError: null, attempts, kind: lastKind, budgetExhausted: true, attemptLog, networkError: null,
      })
    }
    attempts++
    const attemptTimeout = Math.min(FINISH_ATTEMPT_TIMEOUT_MS, remaining)
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, attemptTimeout)

    let response: Response
    try {
      response = await fetch(`${SERVER_URL}/run/finish-explore`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: controller.signal,
      })
    } catch (e) {
      // Сеть или наш таймаут — стоит повторить.
      clearTimeout(timer)
      lastKind = timedOut ? 'timeout' : 'network'
      attemptLog.push(timedOut ? `#${attempts} timeout ${attemptTimeout}ms` : `#${attempts} network: ${describeFetchError(e)}`)
      const retry = nextRetryDelay()
      if (retry.delay !== null) {
        await sleep(retry.delay)
        retries++
        continue
      }
      throw new FinishExploreError(`Finish explore failed (${lastKind}${retry.budgetExhausted ? ', time budget exhausted' : ''}) after ${attempts} attempts: ${attemptLog.join('; ')}`, {
        status: null, serverError: null, attempts, kind: lastKind, budgetExhausted: retry.budgetExhausted, attemptLog, networkError: e,
      })
    }

    if (response.ok) {
      // Тело — под тем же таймером, но БЕЗ повтора: сервер уже ответил 200,
      // забег у него закрыт, повтор получил бы 400 'No active explore run'.
      try {
        const data = await response.json() as FinishExploreResult
        clearTimeout(timer)
        return data
      } catch (e) {
        clearTimeout(timer)
        lastKind = timedOut ? 'timeout' : 'network'
        attemptLog.push(`#${attempts} ${response.status} but body unreadable: ${timedOut ? `timeout ${attemptTimeout}ms` : describeFetchError(e)}`)
        throw new FinishExploreError(`Finish explore failed (${lastKind}) after ${attempts} attempts: ${attemptLog.join('; ')}`, {
          status: response.status, serverError: null, attempts, kind: lastKind, budgetExhausted: false, attemptLog, networkError: e,
        })
      }
    }

    const err: unknown = await response.json().catch(() => ({}))
    clearTimeout(timer)
    const serverError =
      typeof err === 'object' && err !== null && typeof (err as { error?: unknown }).error === 'string'
        ? (err as { error: string }).error
        : null
    lastKind = 'http'
    attemptLog.push(`#${attempts} http ${response.status}${serverError !== null ? ` ${serverError}` : ''}`)
    // 5xx — временная проблема на сервере, стоит повторить.
    // 409 'Run state changed, retry' — гонка за currentRun: он изменился между
    // чтением и записью финиша (например, его успел закрыть /auth/login после
    // того, как игрок убил приложение на "Сохраняем итоги..."). Повторяется по
    // ТОЙ ЖЕ лестнице пауз и в том же бюджете, что 5xx, — и это безопасно:
    // 409 означает, что сервер не записал НИЧЕГО (условная запись не нашла
    // строки), так что повтор не может применить забег дважды. Тело запроса
    // одно на все попытки (сериализовано выше), пересборки данных нет.
    // Отличие от recordSip, где у 409 свой одноразовый повтор без паузы: там
    // конфликт штатный и частый (два быстрых глотка подряд), здесь — редкий и
    // означает, что забег уже трогает кто-то ещё, поэтому пауза уместна.
    // Остальные 4xx — отказ по существу (нет активного explore-забега,
    // невалидные данные и т.п.), повтор его не исправит.
    if (response.status >= 500 || response.status === 409) {
      const retry = nextRetryDelay()
      if (retry.delay !== null) {
        await sleep(retry.delay)
        retries++
        continue
      }
      throw new FinishExploreError(`Finish explore failed (http ${response.status}${retry.budgetExhausted ? ', time budget exhausted' : ''}) after ${attempts} attempts: ${attemptLog.join('; ')}`, {
        status: response.status, serverError, attempts, kind: 'http', budgetExhausted: retry.budgetExhausted, attemptLog, networkError: null,
      })
    }
    throw new FinishExploreError(`Finish explore failed: ${response.status} ${JSON.stringify(err)} after ${attempts} attempts: ${attemptLog.join('; ')}`, {
      status: response.status, serverError, attempts, kind: 'http', budgetExhausted: false, attemptLog, networkError: null,
    })
  }
}
// Response shape of POST /run/sip (server/src/routes/run.ts): выпитое за забег
// по тирам (индекс = тир-1) и сколько глотков ещё разрешено — по счёту СЕРВЕРА.
export type SipResult = { potionsDrunk: number[]; sipsLeft: number }

// Отказ /run/sip после всех повторов — по образцу EquipError: вызывающему мало
// факта ошибки, ему нужен код и текст сервера, чтобы отличить рассинхрон лимита
// ('Tier stock exhausted' / 'No sips left') от сбоя сети.
// Причина последней неудачной попытки:
//   timeout — попытку прервал наш таймер (SIP_ATTEMPT_TIMEOUT_MS или остаток
//             общего бюджета), fetch сам бы так и висел;
//   network — fetch отказал сам (нет сети, DNS, CORS и т.п.);
//   http    — сервер ответил кодом ошибки.
export type SipFailureKind = 'timeout' | 'network' | 'http'

export class SipError extends Error {
  /** HTTP-код последней попытки; null — ответа не было (таймаут или сеть). */
  status: number | null
  /** Поле error из тела ответа; null — тела нет или в нём не строка. */
  serverError: string | null
  /** Сколько попыток сделано всего, включая повторы. */
  attempts: number
  /** Причина последней неудачной попытки, см. SipFailureKind. */
  kind: SipFailureKind
  /** true — повторы оборвал общий бюджет времени (SIP_TOTAL_BUDGET_MS), а не их лимит. */
  budgetExhausted: boolean
  /** Исход каждой попытки по порядку — для консоли: "#1 timeout 4000ms", "#2 network: …". */
  attemptLog: string[]
  /** Исходная ошибка fetch при сетевом сбое или таймауте, иначе null. */
  networkError: unknown
  constructor(message: string, fields: {
    status: number | null
    serverError: string | null
    attempts: number
    kind: SipFailureKind
    budgetExhausted: boolean
    attemptLog: string[]
    networkError: unknown
  }) {
    super(message)
    this.status = fields.status
    this.serverError = fields.serverError
    this.attempts = fields.attempts
    this.kind = fields.kind
    this.budgetExhausted = fields.budgetExhausted
    this.attemptLog = fields.attemptLog
    this.networkError = fields.networkError
  }
}

// Повторы — тот же принцип, что у finishRunExplore: сетевая ошибка, таймаут
// попытки и 5xx повторяются (до 2 раз, пауза короткая-потом-длиннее), 4xx —
// отказ сразу. Исключение — 409 'Run state changed, retry': штатная гонка двух
// быстрых глотков на сервере, повторяется ОДИН раз, без паузы.
const SIP_RETRY_DELAYS_MS = [300, 1200]
// Время ограничено ЯВНО: fetch сам по себе не ограничен ничем, и без сети
// (авиарежим) отказ мог не наступить вовсе — тогда не срабатывал catch в
// sendSip, не загоралась плашка и вставала очередь глотков.
//   SIP_ATTEMPT_TIMEOUT_MS — потолок одной попытки (запрос + чтение тела);
//   SIP_TOTAL_BUDGET_MS    — потолок всего вызова вместе с повторами и паузами.
// Худший случай 4000 + 300 + 4000 + 1200 = 9500 мс до третьей попытки, поэтому
// она получает только остаток бюджета (2500 мс), а не полные 4000.
const SIP_ATTEMPT_TIMEOUT_MS = 4000
const SIP_TOTAL_BUDGET_MS = 12000

function describeFetchError(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e)
}

export async function recordSip(token: string, tier: number): Promise<SipResult> {
  const body = JSON.stringify({ tier })
  const deadline = Date.now() + SIP_TOTAL_BUDGET_MS
  const attemptLog: string[] = []
  let transientRetries = 0
  let conflictRetried = false
  let attempts = 0
  let lastKind: SipFailureKind = 'timeout'

  // Следующая пауза перед повтором, если повтор ещё разрешён И пауза вместе с
  // хоть каким-то временем на попытку укладывается в бюджет. null — повторять
  // нельзя; budgetExhausted различает "кончился бюджет" и "кончились повторы".
  const nextRetryDelay = (): { delay: number | null; budgetExhausted: boolean } => {
    const delay = SIP_RETRY_DELAYS_MS[transientRetries]
    if (delay === undefined) return { delay: null, budgetExhausted: false }
    if (Date.now() + delay >= deadline) return { delay: null, budgetExhausted: true }
    return { delay, budgetExhausted: false }
  }

  while (true) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      throw new SipError(`Sip failed (${lastKind}, time budget exhausted) after ${attempts} attempts: ${attemptLog.join('; ')}`, {
        status: null, serverError: null, attempts, kind: lastKind, budgetExhausted: true, attemptLog, networkError: null,
      })
    }
    attempts++
    const attemptTimeout = Math.min(SIP_ATTEMPT_TIMEOUT_MS, remaining)
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, attemptTimeout)

    let response: Response
    try {
      response = await fetch(`${SERVER_URL}/run/sip`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: controller.signal,
      })
    } catch (e) {
      clearTimeout(timer)
      lastKind = timedOut ? 'timeout' : 'network'
      attemptLog.push(timedOut ? `#${attempts} timeout ${attemptTimeout}ms` : `#${attempts} network: ${describeFetchError(e)}`)
      const retry = nextRetryDelay()
      if (retry.delay !== null) {
        await sleep(retry.delay)
        transientRetries++
        continue
      }
      throw new SipError(`Sip failed (${lastKind}${retry.budgetExhausted ? ', time budget exhausted' : ''}) after ${attempts} attempts: ${attemptLog.join('; ')}`, {
        status: null, serverError: null, attempts, kind: lastKind, budgetExhausted: retry.budgetExhausted, attemptLog, networkError: e,
      })
    }

    if (response.ok) {
      // Тело читается под тем же таймером: зависшее тело — тот же зависший
      // запрос. Но БЕЗ повтора: сервер уже ответил 200, глоток у него записан,
      // и повтор записал бы его второй раз.
      try {
        const data = await response.json() as SipResult
        clearTimeout(timer)
        return data
      } catch (e) {
        clearTimeout(timer)
        lastKind = timedOut ? 'timeout' : 'network'
        attemptLog.push(`#${attempts} ${response.status} but body unreadable: ${timedOut ? `timeout ${attemptTimeout}ms` : describeFetchError(e)}`)
        throw new SipError(`Sip failed (${lastKind}) after ${attempts} attempts: ${attemptLog.join('; ')}`, {
          status: response.status, serverError: null, attempts, kind: lastKind, budgetExhausted: false, attemptLog, networkError: e,
        })
      }
    }

    const err: unknown = await response.json().catch(() => ({}))
    clearTimeout(timer)
    const serverError =
      typeof err === 'object' && err !== null && typeof (err as { error?: unknown }).error === 'string'
        ? (err as { error: string }).error
        : null
    lastKind = 'http'
    attemptLog.push(`#${attempts} http ${response.status}${serverError !== null ? ` ${serverError}` : ''}`)
    if (response.status >= 500) {
      const retry = nextRetryDelay()
      if (retry.delay !== null) {
        await sleep(retry.delay)
        transientRetries++
        continue
      }
      throw new SipError(`Sip failed (http ${response.status}${retry.budgetExhausted ? ', time budget exhausted' : ''}) after ${attempts} attempts: ${attemptLog.join('; ')}`, {
        status: response.status, serverError, attempts, kind: 'http', budgetExhausted: retry.budgetExhausted, attemptLog, networkError: null,
      })
    }
    if (response.status === 409 && !conflictRetried) {
      conflictRetried = true
      continue // бюджет проверяется в начале цикла
    }
    throw new SipError(`Sip failed: ${response.status} ${JSON.stringify(err)} after ${attempts} attempts: ${attemptLog.join('; ')}`, {
      status: response.status, serverError, attempts, kind: 'http', budgetExhausted: false, attemptLog, networkError: null,
    })
  }
}

// --- POST /run/progress: срез сырых счётчиков забега ---
// Те же четыре числа, что уезжают в финише (Explore.tsx:
// attackDamageDealtRef/skillDamageDealtRef/healedAmountRef/damageTakenRef), —
// накопленное С НАЧАЛА ЗАБЕГА, не дельта. Сервер кладёт их в currentRun
// ЗАМЕНОЙ, и /auth/login применяет последний срез, если забег брошен закрытием
// приложения. Финиш это НЕ отменяет: он остаётся главным источником, срез —
// страховка на случай, когда финиша не будет вовсе.
export type RunProgressSnapshot = {
  attackDamageDealt: number
  skillDamageDealt: number
  healedAmount: number
  damageTaken: number
}

export class ProgressError extends Error {
  /** HTTP-код попытки; null — ответа не было (таймаут или сеть). */
  status: number | null
  /** Поле error из тела ответа; null — тела нет или в нём не строка. */
  serverError: string | null
  /** Причина, та же шкала, что у SipError. */
  kind: SipFailureKind
  /** Исходная ошибка fetch при сетевом сбое или таймауте, иначе null. */
  networkError: unknown
  constructor(message: string, fields: { status: number | null; serverError: string | null; kind: SipFailureKind; networkError: unknown }) {
    super(message)
    this.status = fields.status
    this.serverError = fields.serverError
    this.kind = fields.kind
    this.networkError = fields.networkError
  }
}

// Таймаут ОБЯЗАТЕЛЕН по той же причине, что у recordSip: в авиарежиме fetch
// может не завершиться вовсе — ни ответа, ни ошибки, — и очередь запросов
// забега встала бы навсегда (см. CLAUDE.md, "fetch без таймаута в WebView").
// Тот же потолок одной попытки, что у глотка.
const PROGRESS_TIMEOUT_MS = 4000

// Повторов НЕТ, в отличие от recordSip/finishRunExplore, и это осознанно:
// каждый следующий срез несёт НАКОПЛЕННОЕ с начала забега и перезаписывает
// потерянный целиком. Повтор здесь стоил бы времени очереди, ничего не
// добавляя, — а 409 'Run state changed, retry' у среза вообще штатный: он
// означает, что забег уже закрыли финишем, и повторять тем более нечего.
export async function recordProgress(token: string, snapshot: RunProgressSnapshot): Promise<{ progress: RunProgressSnapshot }> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, PROGRESS_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(`${SERVER_URL}/run/progress`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(snapshot),
      signal: controller.signal,
    })
  } catch (e) {
    clearTimeout(timer)
    const kind: SipFailureKind = timedOut ? 'timeout' : 'network'
    throw new ProgressError(
      `Progress failed (${kind}${timedOut ? ` ${PROGRESS_TIMEOUT_MS}ms` : `: ${describeFetchError(e)}`})`,
      { status: null, serverError: null, kind, networkError: e },
    )
  }

  if (response.ok) {
    // Тело — под тем же таймером: зависшее тело это тот же зависший запрос.
    try {
      const data = await response.json() as { progress: RunProgressSnapshot }
      clearTimeout(timer)
      return data
    } catch (e) {
      clearTimeout(timer)
      const kind: SipFailureKind = timedOut ? 'timeout' : 'network'
      throw new ProgressError(`Progress failed (${response.status} but body unreadable, ${kind})`, {
        status: response.status, serverError: null, kind, networkError: e,
      })
    }
  }

  const err: unknown = await response.json().catch(() => ({}))
  clearTimeout(timer)
  const serverError =
    typeof err === 'object' && err !== null && typeof (err as { error?: unknown }).error === 'string'
      ? (err as { error: string }).error
      : null
  throw new ProgressError(`Progress failed: ${response.status} ${JSON.stringify(err)}`, {
    status: response.status, serverError, kind: 'http', networkError: null,
  })
}

export async function saveEquippedSkills(token: string, skills: string[]): Promise<{ equippedSkills: string[] }> {
  const response = await fetch(`${SERVER_URL}/character/skills`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ skills }),
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(`Save skills failed: ${response.status} ${JSON.stringify(err)}`)
  }
  return await response.json()
}

export type BuyPotionResult = {
  gold: number
  // Склад по тирам ПОСЛЕ покупки (индекс = тир-1) — абсолютный, как gold.
  potions: number[]
}

// tier — номер тира 1..5 (см. src/potions.ts). Цену и уровень открытия сервер
// берёт из СВОЕЙ копии каталога, клиент называет только тир.
export async function buyPotion(token: string, tier: number): Promise<BuyPotionResult> {
  const response = await fetch(`${SERVER_URL}/character/buy-potion`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ tier }),
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(`Buy potion failed: ${response.status} ${JSON.stringify(err)}`)
  }
  return await response.json()
}

export type InventoryItem = {
  inventoryItemId: string
  equipped: boolean
  item: {
    id: string
    slot: string
    tier: number
    nameRu: string
    iconPath: string
    levelRequired: number
    damage: number | null
    armor: number | null
    moveSpeed: number | null
    luck: number | null
  }
}

export type InventoryResponse = { inventory: InventoryItem[] }

export async function fetchInventory(token: string): Promise<InventoryResponse> {
  const response = await fetch(`${SERVER_URL}/character/inventory`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(`Fetch inventory failed: ${response.status} ${JSON.stringify(err)}`)
  }
  return await response.json() as InventoryResponse
}

export type EquipResponse = { success: boolean; equippedItemId: string | null; unequippedItemId: string | null }

// Отказ /character/equip с разобранным ответом. Вызывающему мало факта ошибки:
// текст отказа по существу (400 "Недостаточный уровень") надо показать игроку
// на экране. message — тот же, что был у простого Error, консоль не меняется.
export class EquipError extends Error {
  status: number
  /** Поле error из тела ответа; null — тела нет или в нём не строка. */
  serverError: string | null
  constructor(status: number, serverError: string | null, body: unknown) {
    super(`Equip item failed: ${status} ${JSON.stringify(body)}`)
    this.status = status
    this.serverError = serverError
  }
}

export async function equipItem(token: string, inventoryItemId: string, equip: boolean): Promise<EquipResponse> {
  const response = await fetch(`${SERVER_URL}/character/equip`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ inventoryItemId, equip }),
  })
  if (!response.ok) {
    const err: unknown = await response.json().catch(() => ({}))
    const serverError =
      typeof err === 'object' && err !== null && typeof (err as { error?: unknown }).error === 'string'
        ? (err as { error: string }).error
        : null
    throw new EquipError(response.status, serverError, err)
  }
  return await response.json() as EquipResponse
}