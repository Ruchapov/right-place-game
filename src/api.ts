const SERVER_URL = 'https://right-place-game.onrender.com'

// --- Общий запрос с таймаутом ---
// Почему вообще: `fetch` сам по себе не ограничен ничем, и в WebView он может
// не завершиться ВООБЩЕ — в авиарежиме нет ни ответа, ни ошибки, промис просто
// не резолвится (см. CLAUDE.md, Critical Gotchas). Любой экран, который ждёт
// такой запрос, зависает навсегда.
//
// Ядро повторяет проверенное вживую поведение recordProgress ниже: AbortController
// + таймер, флаг timedOut, чтение тела ПОД ТЕМ ЖЕ дедлайном (зависшее тело — тот
// же зависший запрос, поэтому clearTimeout только после разбора json).
//
// Чего здесь НЕТ намеренно: повторов и общего бюджета. Сколько раз повторять и
// сколько всего ждать — решает вызывающий, потому что у каждого запроса цена
// ожидания своя (глоток можно потерять, вход — нет). Здесь же одна попытка.
//
// ⚠️ recordSip/finishRunExplore/recordProgress на этот хелпер НЕ переведены:
// они проверены живыми забегами, и переписывать их ради красоты — риск без
// выигрыша. Новые вызовы писать через него.
export type RequestFailureKind = 'timeout' | 'network' | 'http'

export class RequestError extends Error {
  /** HTTP-код ответа; null — ответа не было (таймаут или сеть). */
  status: number | null
  /** Поле error из тела ответа; null — тела нет или в нём не строка. */
  serverError: string | null
  kind: RequestFailureKind
  /** Исходная ошибка fetch при сетевом сбое или таймауте, иначе null. */
  networkError: unknown
  /**
   * Осмысленно ли повторять: таймаут, сетевой отказ и 5xx — да; 4xx — нет,
   * это отказ по существу, и повтор его не исправит. Считается здесь, чтобы
   * каждый вызывающий не выводил это правило заново.
   */
  retryable: boolean
  constructor(message: string, fields: {
    status: number | null
    serverError: string | null
    kind: RequestFailureKind
    networkError: unknown
  }) {
    super(message)
    this.status = fields.status
    this.serverError = fields.serverError
    this.kind = fields.kind
    this.networkError = fields.networkError
    this.retryable =
      fields.kind === 'timeout' || fields.kind === 'network' || (fields.status !== null && fields.status >= 500)
  }
}

export async function requestJson<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  let response: Response
  try {
    response = await fetch(url, { ...init, signal: controller.signal })
  } catch (e) {
    clearTimeout(timer)
    const kind: RequestFailureKind = timedOut ? 'timeout' : 'network'
    throw new RequestError(
      `${url} failed (${kind}${timedOut ? ` ${timeoutMs}ms` : `: ${describeFetchError(e)}`})`,
      { status: null, serverError: null, kind, networkError: e },
    )
  }

  if (response.ok) {
    try {
      const data = await response.json() as T
      clearTimeout(timer)
      return data
    } catch (e) {
      clearTimeout(timer)
      // Ответ пришёл, а тело прочитать не вышло: либо оборвал наш таймер, либо
      // соединение. Это НЕ http-отказ — сервер своё дело сделал.
      const kind: RequestFailureKind = timedOut ? 'timeout' : 'network'
      throw new RequestError(`${url} answered ${response.status} but body unreadable (${kind})`, {
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
  throw new RequestError(`${url} failed: ${response.status} ${JSON.stringify(err)}`, {
    status: response.status, serverError, kind: 'http', networkError: null,
  })
}

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
  // Приходит вместо interruptedRun, когда забег закрыт БЕЗ штрафа (игрок его
  // не увидел). Взаимоисключающи: сервер ставит их во встречных ветках
  // if/else, оба сразу не приходят никогда. Нет открытого забега — нет ни
  // одного из двух.
  abandonedRun?: AbandonedRunSummary
  // Курс обмена трофеев на золото (server/src/game.ts, TROPHY_GOLD_RATE).
  // ОПЦИОНАЛЬНОЕ намеренно, хотя нынешний сервер его всегда присылает: объявить
  // его `number` значило бы получить `undefined`, типизированный как число, на
  // любом старом или подменённом ответе — ровно тот тихий фолбэк, который в
  // проекте запрещён. Разбирать ТОЛЬКО через readTrophyGoldRate ниже; своего
  // числа у клиента нет и быть не должно (копия константы разъехалась бы с
  // сервером молча).
  trophyGoldRate?: number
}

// КОПИЯ серверного типа `AbandonedRunSummary` — оригинал в
// server/src/routes/auth.ts:33. Общего пакета между клиентом и сервером в
// проекте нет (tsconfig.app.json включает только "src", у сервера rootDir
// "./src"), поэтому синхронизация РУЧНАЯ: меняется там — правится и здесь.
// Автоматической сверки на этот тип нет, в отличие от каталога зелий
// (tools/check_potion_sync.py).
export type AbandonedRunSummary = { reason: 'not-confirmed'; energyRefunded: number }

// Вход — единственный запрос, без которого игра не открывается вообще, поэтому
// ждёт он дольше всех и повторяется сам. Числа те же, что у finishRunExplore, и
// по той же причине: сервер на Render Free просыпается из сна порядка минуты, и
// первая попытка после простоя ждёт весь подъём.
//   LOGIN_ATTEMPT_TIMEOUT_MS — одна попытка (запрос + чтение тела); короче
//     подъёма намеренно, чтобы прерванная попытка уступила место следующей,
//     которая застанет сервер уже проснувшимся.
//   LOGIN_TOTAL_BUDGET_MS — весь вызов с повторами; столько максимум игрок
//     видит экран загрузки, после чего получает экран ошибки с "Повторить".
// Повторяется только то, что имеет шанс пройти со второго раза (RequestError.
// retryable): таймаут, сетевой отказ, 5xx. 401 (битый initData) и 400 —
// отказ по существу, показываются сразу, без 60 секунд ожидания впустую.
// Повтор входа безопасен: он либо даёт тот же результат, либо видит уже
// закрытый прерванный забег (см. server/src/routes/auth.ts).
const LOGIN_RETRY_DELAYS_MS = [300, 1200]
const LOGIN_ATTEMPT_TIMEOUT_MS = 20000
const LOGIN_TOTAL_BUDGET_MS = 60000

export async function loginWithTelegram(initDataRaw: string): Promise<LoginResponse> {
  const body = JSON.stringify({ initData: initDataRaw })
  const deadline = Date.now() + LOGIN_TOTAL_BUDGET_MS
  let retries = 0
  let lastError: RequestError | null = null

  while (true) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      // Бюджет кончился между попытками. Отдаём ПОСЛЕДНЮЮ настоящую причину,
      // а не абстрактный "таймаут": экран ошибки покажет её игроку.
      throw lastError ?? new RequestError('Login failed (time budget exhausted)', {
        status: null, serverError: null, kind: 'timeout', networkError: null,
      })
    }
    try {
      return await requestJson<LoginResponse>(
        `${SERVER_URL}/auth/login`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
        Math.min(LOGIN_ATTEMPT_TIMEOUT_MS, remaining),
      )
    } catch (e) {
      if (!(e instanceof RequestError) || !e.retryable) throw e
      lastError = e
      const delay = LOGIN_RETRY_DELAYS_MS[retries]
      // Повторы кончились ИЛИ пауза уже не влезает в бюджет — отдаём причину.
      if (delay === undefined || Date.now() + delay >= deadline) throw e
      await sleep(delay)
      retries++
    }
  }
}
// --- POST /run/ready: подтверждение, что забег реально показан игроку ---
// Шлётся, когда мир построен и игра в шаге от показа (Explore.tsx, перед
// setReady). До этого момента забег для игрока не существовал, и сервер,
// найдя его открытым при следующем входе, закроет БЕЗ штрафа: вернёт энергию
// и не тронет банк трофеев (см. server/src/runState.ts, judgeInterruptedRun).
//
// Числа меньше, чем у входа: игрок уже смотрит на экран загрузки готового
// забега, и держать его там минуту нельзя. 8 с на попытку, 24 с на всё.
// Повторяем таймаут, сеть, 5xx — и ДОПОЛНИТЕЛЬНО 409 'Run state changed,
// retry': при нём сервер не записал ничего, так что повтор безопасен (в
// отличие от 4xx по существу, которые показываются сразу).
// Сам запрос идемпотентен на сервере: повторный вызов и вызов на забеге без
// поля confirmed отвечают 200 без записи.
const READY_RETRY_DELAYS_MS = [300, 900]
const READY_ATTEMPT_TIMEOUT_MS = 8000
const READY_TOTAL_BUDGET_MS = 24000

export async function confirmRunReady(token: string): Promise<{ confirmed: boolean }> {
  const deadline = Date.now() + READY_TOTAL_BUDGET_MS
  let retries = 0
  let lastError: RequestError | null = null

  while (true) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      throw lastError ?? new RequestError('Run ready failed (time budget exhausted)', {
        status: null, serverError: null, kind: 'timeout', networkError: null,
      })
    }
    try {
      return await requestJson<{ confirmed: boolean }>(
        `${SERVER_URL}/run/ready`,
        {
          method: 'POST',
          // Тело пустое по смыслу — серверу нужен только токен. Шлём `{}` с
          // обычным json-заголовком, как все остальные запросы файла: POST
          // вообще без Content-Type разбирается серверными парсерами
          // по-разному, и выяснять это на проде не за чем.
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: '{}',
        },
        Math.min(READY_ATTEMPT_TIMEOUT_MS, remaining),
      )
    } catch (e) {
      if (!(e instanceof RequestError)) throw e
      // retryable — таймаут/сеть/5xx (см. RequestError выше); 409 добавляем
      // здесь, а не в общее правило: для других запросов конфликт означает
      // другое, и решать за них этот хелпер не должен.
      if (!e.retryable && e.status !== 409) throw e
      lastError = e
      const delay = READY_RETRY_DELAYS_MS[retries]
      if (delay === undefined || Date.now() + delay >= deadline) throw e
      await sleep(delay)
      retries++
    }
  }
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
// Старт забега. Таймаут БОЛЬШОЙ: сервер на Render Free засыпает после
// простоя, и хотя вход игрок прошёл раньше, меню он мог держать открытым
// достаточно долго, чтобы сервер снова уснул — первый запрос после сна ждёт
// весь подъём.
const START_EXPLORE_TIMEOUT_MS = 45000

// Повторов НЕТ, в отличие от входа и подтверждения, и это не экономия:
// повторять старт ОПАСНО. Прерванная попытка могла дойти и создать забег, и
// тогда второй запрос получит 400 'A run is already in progress' — игрок
// увидит отказ вместо забега, а энергия будет уже списана. Одна попытка,
// честный таймаут, дальше решает игрок.
// Цена ошибки упала: забег, начатый и не подтверждённый через /run/ready,
// закрывается при следующем входе БЕЗ штрафа и с возвратом энергии.
export async function startRunExplore(token: string, mapFile?: string): Promise<StartExploreResult> {
  return requestJson<StartExploreResult>(
    `${SERVER_URL}/run/start-explore`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(mapFile !== undefined ? { mapFile } : {}),
    },
    START_EXPLORE_TIMEOUT_MS,
  )
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

// Отказ /run/sip после всех повторов — той же формы, что RequestError выше
// (класс отдельный, потому что эта функция на общий хелпер не переводилась:
// она проверена живыми забегами). Вызывающему мало факта ошибки, ему нужен
// код и текст сервера, чтобы отличить рассинхрон лимита
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

// Покупка и сверка баланса — короткий таймаут: игрок стоит в магазине и ждёт
// ответа, держать его дольше нечем. 5 с хватает проснувшемуся серверу; спящий
// не уложится, и это честнее показать строкой, чем морозить кнопку.
const SHOP_TIMEOUT_MS = 5000

// tier — номер тира 1..5 (см. src/potions.ts), count — сколько штук
// (1..MAX_POTIONS_PER_PURCHASE). Цену, уровень открытия и потолок count сервер
// проверяет по СВОЕЙ копии каталога, клиент называет только тир и количество.
//
// ПОВТОРОВ НЕТ и быть не должно: эндпоинт НЕ идемпотентен — прерванная попытка
// могла дойти и списать золото, а повтор списал бы второй раз. Поэтому при
// сетевом сбое вызывающий обязан не «попробовать ещё», а СВЕРИТЬ баланс
// (fetchProfile ниже) — см. handleBuyPotion в App.tsx.
export async function buyPotion(token: string, tier: number, count: number): Promise<BuyPotionResult> {
  return requestJson<BuyPotionResult>(
    `${SERVER_URL}/character/buy-potion`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tier, count }),
    },
    SHOP_TIMEOUT_MS,
  )
}

/**
 * Разбор курса обмена трофеев на золото из ответа сервера (логин и профиль).
 *
 * Возвращает null на ВСЁ, что не является пригодным курсом: поля нет, это не
 * число, NaN/Infinity, ноль или отрицательное. Null — не «нуль курса», а «курс
 * неизвестен»: окно обмена в этом состоянии так и пишет и гасит кнопку.
 * Подставить сюда 1 нельзя ни при каких условиях — клиент начал бы обещать
 * курс, которого сервер не называл, и разошёлся бы с ним молча.
 *
 * Ноль и отрицательное отбрасываются вместе с мусором намеренно: обменять банк
 * по такому курсу значит сжечь его за ничто, и предлагать это игроку нельзя.
 */
export function readTrophyGoldRate(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return null
  return raw
}

// Ответ GET /character/profile. Форма РАЗОШЛАСЬ с BuyPotionResult (сервер добавил
// trophies и trophyGoldRate), поэтому у профиля теперь свой тип — прежний общий
// молча скрыл бы оба новых поля.
export type ProfileResult = {
  gold: number
  trophies: number
  potions: number[]
  /** null — сервер курс не назвал (см. readTrophyGoldRate). */
  trophyGoldRate: number | null
}

// Сверка баланса: золото, трофеи, склад зелий по тирам и курс обмена. ТОЛЬКО
// чтение — сервер на этом пути ничего не пишет (GET /character/profile).
// Нужна отдельно от loginWithTelegram именно поэтому: вход — полноценный
// логин, и он ЗАКРЫВАЕТ открытый на сервере забег (подтверждённый — как
// смерть, со сгоранием банка трофеев). Делать это побочным эффектом кнопки
// «Обновить баланс» нельзя.
export async function fetchProfile(token: string): Promise<ProfileResult> {
  const raw = await requestJson<{
    gold: number
    trophies: number
    potions: number[]
    trophyGoldRate?: unknown
  }>(
    `${SERVER_URL}/character/profile`,
    { method: 'GET', headers: { 'Authorization': `Bearer ${token}` } },
    SHOP_TIMEOUT_MS,
  )
  return {
    gold: raw.gold,
    trophies: raw.trophies,
    potions: raw.potions,
    trophyGoldRate: readTrophyGoldRate(raw.trophyGoldRate),
  }
}

// Итог обмена: gold и trophies — АБСОЛЮТНЫЕ значения из БД (сервер перечитывает
// их после записи), goldGained — прибавка, которую игрок увидит тостом. Считать
// что-либо из них на клиенте не нужно и нельзя: курс применяет сервер.
export type ExchangeTrophiesResult = {
  gold: number
  trophies: number
  goldGained: number
}

/**
 * Полный обмен трофеев на золото (POST /character/exchange-trophies).
 *
 * ПОВТОРОВ НЕТ. Формально второй запрос не удвоил бы обмен (после успеха трофеев
 * уже 0, и сервер ответит 400 `No trophies to exchange`), но различить «первый
 * запрос применился» и «не дошёл вовсе» повтор всё равно не может, а goldGained
 * — число, которое игрок должен увидеть, — во втором ответе уже не придёт.
 * Поэтому при сетевом сбое вызывающий обязан не «попробовать ещё», а СВЕРИТЬ
 * баланс (fetchProfile выше) — тот же порядок, что у buyPotion.
 */
export async function exchangeTrophies(token: string): Promise<ExchangeTrophiesResult> {
  return requestJson<ExchangeTrophiesResult>(
    `${SERVER_URL}/character/exchange-trophies`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      // '{}', а НЕ отсутствующее тело: с Content-Type: application/json Fastify
      // отвергает пустое тело своей ошибкой (FST_ERR_CTP_EMPTY_JSON_BODY, 400)
      // ещё до обработчика, и отказ выглядел бы как отказ обмена. Сервер полей
      // из тела не читает — ему нужен только валидный JSON.
      body: JSON.stringify({}),
    },
    SHOP_TIMEOUT_MS,
  )
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

// Инвентарь. Повторить его БЕЗОПАСНО — это GET, он ничего не меняет, поэтому
// здесь повтор есть (в отличие от покупки). Две попытки: зависший инвентарь
// стоит дорого — `inventoryStatus` застревает в 'loading', а вместе с ним
// блокируется кнопка "Начать забег" (броня и урон оружия считаются по нему).
const INVENTORY_ATTEMPT_TIMEOUT_MS = 8000
const INVENTORY_ATTEMPTS = 2
const INVENTORY_RETRY_DELAY_MS = 400

export async function fetchInventory(token: string): Promise<InventoryResponse> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await requestJson<InventoryResponse>(
        `${SERVER_URL}/character/inventory`,
        { method: 'GET', headers: { 'Authorization': `Bearer ${token}` } },
        INVENTORY_ATTEMPT_TIMEOUT_MS,
      )
    } catch (e) {
      // 4xx повторять незачем — отказ по существу (нет токена, нет персонажа).
      if (attempt >= INVENTORY_ATTEMPTS || !(e instanceof RequestError) || !e.retryable) throw e
      await sleep(INVENTORY_RETRY_DELAY_MS)
    }
  }
}

export type EquipResponse = { success: boolean; equippedItemId: string | null; unequippedItemId: string | null }

// Надеть/снять. Повторов НЕТ, хотя запись и идемпотентна по значению
// (сервер пишет equipped: true/false, а не переключает): при потерянном ответе
// честнее не гадать, а перечитать инвентарь — он и покажет, что на сервере на
// самом деле (см. handleEquipItem в App.tsx). Отдельный класс ошибки больше не
// нужен: RequestError несёт и status, и serverError — текст отказа по существу
// (400 "Недостаточный уровень") достаётся из него так же.
const EQUIP_TIMEOUT_MS = 5000

export async function equipItem(token: string, inventoryItemId: string, equip: boolean): Promise<EquipResponse> {
  return requestJson<EquipResponse>(
    `${SERVER_URL}/character/equip`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inventoryItemId, equip }),
    },
    EQUIP_TIMEOUT_MS,
  )
}