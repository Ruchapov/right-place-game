import { CONSUMABLES, consumableSkillBook, parseSkillBookSkillId, type ConsumableId, type SkillBookId, type SkillBookSkillId } from './consumables'
import { SCROLLS, type ScrollId } from './scrolls'
import { CLASS_ITEMS, type ClassItemId } from './classItems'
import { parseHeroClassWire, type HeroClassId, type HeroClassState } from './heroClasses'
import type { UpgradeCounts, UpgradeKind } from './upgrades'
import { ENERGY_REGEN_MS } from './energy'
import { parseQuestId, type QuestId } from './quests'
import type { HunterStat } from './hunter'

const SERVER_URL = 'https://right-place-game.onrender.com'

// --- Id запроса и id текущего забега (15.10.2026) ---
//
// Случайный id для ключей идемпотентности (покупки, глоток). Сервер принимает
// 8–64 символа из букв, цифр, '-' и '_' (parseRequestId, server/src/runState.ts);
// UUID туда укладывается. randomUUID есть не во всех WebView, поэтому запасной
// путь — те же 128 бит из getRandomValues в hex.
function newRequestId(): string {
  const c: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  if (c && typeof c.getRandomValues === 'function') {
    const bytes = c.getRandomValues(new Uint8Array(16))
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  }
  // Без криптографии вовсе: id нужен только для того, чтобы отличать повтор от
  // нового запроса одного игрока, тайны в нём нет.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

// Id ТЕКУЩЕГО забега — из ответа /run/start-explore. Его несут все запросы
// забега (ready, sip, progress, сделка, финиш, отмена), и сервер по нему
// отличает запрос этого забега от запоздавшего запроса прошлого.
//
// Живёт здесь, в модуле, а не передаётся вызывающим: так все запросы забега
// получают его без правок в Explore.tsx. Забег в вкладке один в каждый момент:
// старт сбрасывает id ДО запроса и ставит новый по ответу; финиш его не
// сбрасывает — повтор финиша («Повторить сохранение») обязан нести тот же id.
// null — сервер id не назвал (старый сервер) или забега ещё не было: запросы
// уходят без поля, как раньше.
let activeRunId: string | null = null

// Поле runId для тела запроса забега — пустой объект, если id нет: тогда тело
// байт в байт прежнее.
function runIdField(): { runId?: string } {
  return activeRunId !== null ? { runId: activeRunId } : {}
}

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
  /**
   * Всё тело отказа, как пришло (20.10.2026); null — ответа или тела не было.
   * Нужно отказам, у которых кроме кода есть подробности для игрока, — сейчас
   * ручкам класса: «чего не хватает» они присылают строками (lines). Читать
   * через разборщик, а не приведением типа.
   */
  body: unknown
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
    body?: unknown
  }) {
    super(message)
    this.status = fields.status
    this.serverError = fields.serverError
    this.body = fields.body ?? null
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
    status: response.status, serverError, kind: 'http', networkError: null, body: err,
  })
}

export type LoginResponse = {
  token: string
  user: { id: number; firstName: string; username: string | null }
  character: {
    level: number
    energy: number
    /**
     * Сколько СЕКУНД уже натикало в счёт следующей единицы энергии (0..59) на
     * момент ответа — 04.10.2026, вместе с правкой «энергия упирается в 99».
     *
     * Клиент считает минуты от момента входа (liveEnergy в App.tsx), и без
     * этого поля его отсчёт начинался заново: сервер уже 50 секунд как ждал
     * сотую единицу, а клиент начинал ждать свои 60 — и показывал 99/100 там,
     * где на сервере было 100. Разбирать через readEnergyAccruedSec.
     */
    energyAccruedSec?: number
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
    // Склад расходников — объектом по id каталога (`{whetstone: N}`), не
    // массивом: у расходников нет фиксированного порядка, и позиционный массив
    // молча съехал бы при добавлении второго вида.
    // ОПЦИОНАЛЬНОЕ намеренно, хотя нынешний сервер поле всегда присылает:
    // объявить его обязательным значило бы получить `undefined`,
    // типизированный как объект, на любом старом или подменённом ответе — тот
    // самый тихий фолбэк, который в проекте запрещён. Разбирать ТОЛЬКО через
    // readConsumables ниже.
    consumables?: Record<string, number>
    // Уровни навыков — объектом по id навыка (`{fireball: 1, …}`). Опциональное
    // по той же причине, что consumables выше: обязательное поле дало бы
    // `undefined`, типизированный как объект, на старом или подменённом ответе.
    // Разбирать ТОЛЬКО через readSkillLevels ниже.
    skillLevels?: Record<string, number>
    // Результативные применения каждого навыка, накопленные в счёт СЛЕДУЮЩЕГО
    // уровня (02.10.2026). Опциональное по той же причине, что skillLevels
    // выше. Разбирать ТОЛЬКО через readSkillUses: null значит «сервер не
    // назвал», а НЕ «применений нет» — полоса «X / Y» в карточке навыка при
    // null показывает прочерк, а не ноль из воздуха.
    skillUses?: Record<string, number>
    // Склад СТРАНИЦ книг — объектом по id каталога (`{scroll_fire: N}`).
    // Отдельным полем от consumables намеренно: страницы ячейку сумки НЕ
    // тратят, и свалить их в один объект значило бы различать это по id.
    // Опциональное по той же причине, что consumables выше. Разбирать ТОЛЬКО
    // через readScrolls.
    scrolls?: Record<string, number>
    // Склад предметов классов — Осколок души, Печать отречения (18.10.2026),
    // объектом по id каталога classItems.ts. Опциональное по той же причине, что
    // scrolls выше. Разбирать ТОЛЬКО через readClassItems.
    classItems?: Record<string, number>
    // Класс героя (20.10.2026): null — класса нет, {id, tier} — есть, поля нет
    // — сервер старше 20.10.2026 (или испорченная пара колонок). Разбирать
    // ТОЛЬКО через readHeroClass: отсутствие поля — «класс неизвестен», а не
    // «класса нет».
    heroClass?: unknown
    // Счётчики купленных улучшений. Опциональное по той же причине, что
    // consumables и skillLevels выше. Разбирать ТОЛЬКО через readUpgrades.
    upgrades?: { attack?: unknown; armor?: unknown }
    // Значки охотника и RP — валюты ежедневных заданий (26.10.2026). Нет поля —
    // сервер старше заданий: «неизвестно», а не ноль. Разбирать ТОЛЬКО через
    // readCurrencyCount.
    hunterBadges?: unknown
    rp?: unknown
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

//
// ⚠️ Подтверждение не прошло (15.10.2026) — перед тем как сообщить об ошибке,
// просим сервер ОТМЕНИТЬ забег как не показанный (cancelUnshownRun ниже).
// Иначе: подтверждение дошло, ответ потерялся, игрок видит экран ошибки, а
// забег на сервере подтверждён — и следующий вход закрыл бы его как смерть,
// со сгоранием всего банка трофеев. Отмена — лучшее усилие: не дошла и она —
// остаётся прежнее поведение.
export async function confirmRunReady(token: string): Promise<{ confirmed: boolean }> {
  try {
    return await confirmRunReadyAttempts(token)
  } catch (e) {
    const runId = activeRunId
    if (runId !== null) await cancelUnshownRun(token, runId)
    throw e
  }
}

async function confirmRunReadyAttempts(token: string): Promise<{ confirmed: boolean }> {
  const deadline = Date.now() + READY_TOTAL_BUDGET_MS
  const body = JSON.stringify(runIdField())
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
          // Тело — только id забега (или `{}`, если сервер id не назвал). Шлём
          // с обычным json-заголовком, как все остальные запросы файла: POST
          // вообще без Content-Type разбирается серверными парсерами
          // по-разному, и выяснять это на проде не за чем.
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body,
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

// Отмена забега, который клиент так и не показал (POST /run/cancel-unshown,
// 15.10.2026). Сервер соглашается, только если с начала забега прошло меньше
// окна подтверждения (2 минуты) и в нём не играли; иначе отвечает 400, и это
// не ошибка для игрока — просто прежнее поведение.
// Никогда не бросает: вызывается из пути ошибки, и её собственный сбой не
// должен подменить исходную причину. Бюджет короткий — игрок ждёт экран ошибки.
const CANCEL_ATTEMPT_TIMEOUT_MS = 5000
const CANCEL_TOTAL_BUDGET_MS = 12000
const CANCEL_RETRY_DELAYS_MS = [300, 1200]

async function cancelUnshownRun(token: string, runId: string): Promise<void> {
  const deadline = Date.now() + CANCEL_TOTAL_BUDGET_MS
  let retries = 0
  while (true) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      console.warn('cancelUnshownRun: time budget exhausted, the run stays as it is on the server')
      return
    }
    try {
      await requestJson<{ cancelled: boolean }>(
        `${SERVER_URL}/run/cancel-unshown`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId }),
        },
        Math.min(CANCEL_ATTEMPT_TIMEOUT_MS, remaining),
      )
      console.log('cancelUnshownRun: the run was cancelled on the server without penalty')
      return
    } catch (e) {
      // 409 — состояние сменилось между чтением и записью; повтор безопасен.
      const retryable = e instanceof RequestError && (e.retryable || e.status === 409)
      const delay = CANCEL_RETRY_DELAYS_MS[retries]
      if (!retryable || delay === undefined || Date.now() + delay >= deadline) {
        console.warn('cancelUnshownRun: the server did not cancel the run', e)
        return
      }
      await sleep(delay)
      retries++
    }
  }
}

// Event kind returned by /run/start-explore — same 6 kinds as
// server/src/runEvents.ts's RunEventKind.
export type StartExploreEventKind = 'enemy' | 'chest' | 'smuggler' | 'puzzle' | 'boss' | 'obelisk'

/**
 * Чья группа врагов — только у kind === 'enemy' (04.10.2026; Привратник —
 * 06.10.2026). Бросает СЕРВЕР (веса ENEMY_GROUP_WEIGHTS живут только там),
 * клиент получает готовый ответ.
 */
export type StartExploreEnemyKind = 'beast' | 'zvonar' | 'gatekeeper'

export type StartExploreEvent = {
  kind: StartExploreEventKind
  x: number
  y: number
  clusterPoints?: [number, number][]
  /**
   * Чья это группа. Разбирать ТОЛЬКО через readEnemyKind ниже: поля может не
   * быть вовсе (забег начат сервером, где Звонаря ещё не существовало).
   */
  enemyKind?: StartExploreEnemyKind
  /**
   * Ловушка или обычный сундук — только у kind === 'chest' (13.10.2026). Бросает
   * СЕРВЕР на старте забега; клиент по этому полю играет взрыв и бьёт героя, а
   * своего броска не делает. Разбирать ТОЛЬКО через readChestMimic ниже: у
   * сундука без решения забег не показывается вовсе.
   */
  isMimic?: boolean
  /**
   * Сколько трофеев даст это событие. Разыграно СЕРВЕРОМ на старте — именно это
   * число всплывает в момент закрытия события и именно оно начислится на финише.
   *
   * ОПЦИОНАЛЬНОЕ намеренно: старый сервер поля не присылает, и объявить его
   * `number` значило бы получить `undefined`, типизированный как число, и
   * напечатать «+undefined» над трупом врага. Разбирать ТОЛЬКО через
   * readStartEvents ниже.
   */
  trophyReward?: number
  /**
   * Что выпадет с этого события. null — бросок был, не выпало ничего (самый
   * частый исход). Поля нет — старый сервер. Разбирать ТОЛЬКО через
   * readStartEvents: вид у него тот же RunDrop, что на экране итогов, и
   * доверять ему как есть нельзя.
   */
  drop?: RunDrop | null
  /**
   * ВТОРАЯ добыча события, отдельным броском поверх drop (18.10.2026): сейчас
   * только Печать отречения с босса. null — не выпало; поля нет — сервер старше
   * 18.10.2026, второй добычи у него не было. Разбирать ТОЛЬКО через
   * readEventReward.
   */
  extraDrop?: RunDrop | null
}

// Response shape of POST /run/start-explore (server/src/routes/run.ts; форму
// события на сервере держит ClientRunEvent в server/src/runEvents.ts — менять
// только парой).
// ⚠️ С 30.09.2026 награды ОТДАЮТСЯ (trophyReward + drop у каждого события) —
// прежнее решение «сервер держит их у себя» отменено: всплывашка в бою должна
// показывать то же число, что потом начислится. С 13.10.2026 отдаётся и isMimic
// у сундука: мимик и так вычислялся по trophyReward (у него ровно 0) — эта
// утечка принята дизайнером, см. clientRunEvents на сервере.
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
  /**
   * Множитель урона обычной атаки на весь забег: 1 + сумма attackBonus взятых
   * расходников (считает СЕРВЕР по СПИСАННОМУ списку, не по телу запроса).
   *
   * ОПЦИОНАЛЬНОЕ намеренно, хотя нынешний сервер поле всегда присылает:
   * объявить его обязательным значило бы получить `undefined`, типизированный
   * как число, на старом ответе — и молча умножить урон на NaN. Вызывающий
   * обязан проверить явно и упасть громко (см. Explore.tsx, setup()).
   */
  attackMult?: number
  /** Склад расходников ПОСЛЕ списания взятых в забег. Разбирать через readConsumables. */
  consumables?: Record<string, number>
  /**
   * Какие расходники сервер РЕАЛЬНО принял в этот забег. Забег знает по ним, что
   * у игрока на руках (например оберег), а не полагается на свой список из
   * гнёзд: принять сервер мог не всё, и расходиться этим двум спискам нельзя.
   * Опциональное — старый сервер поля не присылает; вызывающий обязан считать
   * это «ничего не принято», а не догадываться.
   */
  consumablesTaken?: string[]
  /**
   * Id забега (15.10.2026). Его модуль запоминает сам (activeRunId) и шлёт во
   * всех запросах забега — вызывающему с ним делать ничего не нужно.
   * Опциональное: старый сервер поля не присылает.
   */
  runId?: string
  /**
   * Класс героя на этот забег (26.10.2026): null — класса нет, {id, tier} —
   * класс; его же сервер записал в currentRun и по нему считает потолок
   * полученного урона. Поля нет — сервер старше 26.10.2026. Разбирать ТОЛЬКО
   * через readHeroClass (см. setup() в Explore.tsx).
   */
  heroClass?: unknown
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
// consumables — id расходников из гнёзд подготовки (App.tsx). Пустой список НЕ
// отправляется вовсе: тело тогда уходит без поля, как его слал клиент до
// появления гнёзд, и сервер читает это как «забег без расходников».
// Проверяет состав сервер (каталог, флаг runSlot, повторы, потолок, запас) —
// здешние гнёзда не источник истины.
export async function startRunExplore(token: string, mapFile?: string, consumables?: ConsumableId[]): Promise<StartExploreResult> {
  const body: { mapFile?: string; consumables?: ConsumableId[] } = {}
  if (mapFile !== undefined) body.mapFile = mapFile
  if (consumables !== undefined && consumables.length > 0) body.consumables = consumables
  // Id прошлого забега сбрасывается ДО запроса: упади старт — запросы, которые
  // ещё успеют уйти, не понесут чужой id.
  activeRunId = null
  const result = await requestJson<StartExploreResult>(
    `${SERVER_URL}/run/start-explore`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    START_EXPLORE_TIMEOUT_MS,
  )
  // Негодный id — как его отсутствие: запросы уйдут без поля, и сервер их
  // примет по-старому. Отказываться от забега из-за него нельзя — он уже начат.
  const runId = typeof result.runId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(result.runId) ? result.runId : null
  if (result.runId !== undefined && runId === null) {
    console.error('startRunExplore: server sent a malformed runId, run requests will go without it', result.runId)
  }
  activeRunId = runId
  return result
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
/**
 * Одна единица добычи в ответе финиша.
 *
 * ⚠️ КОПИЯ серверного типа (`server/src/routes/run.ts`, RunDrop) — менять
 * парами, сверяющего скрипта у этой пары нет (см. CLAUDE.md, таблица копий).
 *
 * Размеченный union: имя и иконку клиент берёт из СВОИХ каталогов по id
 * (scrolls.ts, potions.ts, consumables.ts), а не из ответа. Снаряжение —
 * исключение: его названия лежат только в БД, клиентского каталога предметов
 * нет вовсе. Слот и тир едут рядом, потому что иконку предмета клиент собирает
 * из них (itemIconSrc), а не из Item.iconPath.
 */
export type RunDrop =
  | { category: 'equipment'; nameRu: string; slot: string; tier: number }
  | { category: 'scroll'; id: string }
  | { category: 'potion'; tier: number }
  | { category: 'book'; id: string }
  // Предметы классов (18.10.2026): у каждой категории один вид, имя и иконка —
  // из каталога classItems.ts.
  | { category: 'soul_shard' }
  | { category: 'renounce_seal' }

export type RunResultSummary = {
  interrupted: boolean
  died: boolean
  trophiesEarned: number
  trophiesLost: number
  eventsClosed: number
  eventsTotal: number
  /**
   * Добыча забега: что РЕАЛЬНО начислено сервером. Пустой список — законный и
   * частый исход (ни одно событие не прошло первый бросок).
   * ⚠️ Прежнее поле `items: never[]` УДАЛЕНО 30.09.2026: оно было заготовкой
   * под дроп и по типу не могло нести ничего.
   */
  drops: RunDrop[]
  /** Что выпало, но пропало из-за полной сумки — отдельным списком. */
  dropsLost: RunDrop[]
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
  /**
   * Склад расходников по id каталога ПОСЛЕ забега — чтобы сработавший оберег
   * сразу исчез из инвентаря и гнезда, а не ждал следующего логина.
   * ⚠️ КОПИЯ серверного типа (`server/src/routes/run.ts`) — менять парами,
   * сверяющего скрипта у этой пары нет (см. CLAUDE.md, таблица копий).
   * Опциональное: старый сервер поля не присылает, и подставлять вместо него
   * выдуманный склад нельзя — вызывающий обязан просто не обновлять его.
   */
  consumables?: Record<string, number>
  /**
   * Склад СТРАНИЦ после забега — чтобы выпавшая страница появилась в сумке
   * сразу, а не ждала следующего логина. Опциональное по той же причине, что
   * consumables выше.
   */
  scrolls?: Record<string, number>
  /**
   * Склад предметов классов после забега (18.10.2026) — по той же причине, что
   * scrolls выше. Разбирать через readClassItems.
   */
  classItems?: Record<string, number>
  /**
   * Навыки, у которых ЗА ЭТОТ ЗАБЕГ вырос уровень (02.10.2026). Пустой список —
   * самый частый исход (первый уровень стоит 30 применений), и экран итогов
   * тогда о навыках не пишет ничего.
   *
   * ⚠️ КОПИЯ серверного типа (`server/src/game.ts`, SkillLevelUp) — менять
   * парами, сверяющего скрипта у этой пары нет (см. CLAUDE.md, таблица копий).
   *
   * НЕ опциональное, в отличие от складов выше: finishRunExplore прогоняет поле
   * через readSkillLevelUps, поэтому здесь это всегда массив — пустой у старого
   * сервера, который поля не присылает.
   */
  skillLevelUps: SkillLevelUp[]
  /**
   * Уровни и остатки применений ПОСЛЕ забега — абсолютные, как trophies/strength
   * выше. Нужны, чтобы карточка навыка показала новый уровень и новую полосу
   * сразу, а не дорановые числа до следующего логина. Опциональные по той же
   * причине, что consumables/scrolls выше; разбирать через readSkillLevels/
   * readSkillUses.
   */
  skillLevels?: Record<string, number>
  skillUses?: Record<string, number>
  /**
   * Золото, значки охотника и RP ПОСЛЕ забега — абсолютные (26.10.2026): финиш
   * начисляет награду ежедневного задания. null или нет поля — сервер не назвал
   * (старый сервер): мержить нечего. finishRunExplore разбирает их через
   * readCurrencyCount.
   */
  gold?: number | null
  hunterBadges?: number | null
  rp?: number | null
  /**
   * Задание, выполненное этой вылазкой, и награда за него; null — не выполнено
   * ни одно. Опциональное: вход (interruptedRun) и старый сервер его не
   * присылают, а finishRunExplore приводит отсутствие к null.
   */
  questCompleted?: QuestCompleted | null
  /**
   * Состояние заданий после забега, тот же вид, что у GET /character/quests;
   * null — сервер не назвал (испорченный questState, вход, старый сервер). После
   * повтора финиша вид — на момент ПЕРВОГО финиша: App.tsx всё равно перечитывает
   * доску GET'ом (docs/daily-quests.md).
   */
  quests?: QuestView | null
}

/** Выполненное за вылазку задание и что за него дали (ответ финиша). */
export type QuestCompleted = { questId: QuestId; gold: number; hunterBadges: number; rp: number }

/**
 * Пять счётчиков вылазки для ежедневных заданий — тело финиша
 * (docs/daily-quests.md, «Пять новых счётчиков тела финиша — договор для
 * клиента»). Считает Explore.tsx (questCountersRef):
 *   parries       — удары, отбитые парированием (takeDamage/takeRamDamage
 *                   вернули «отбил»: и удар врага, и шип босса, и волна Звонаря);
 *   manaCollected — единицы маны, долетевшие до героя, даже при полном запасе;
 *   manaSpent     — единицы маны, СНЯТЫЕ С ЗАПАСА навыками: бесплатное
 *                   применение Повелителя — 0, недостача, оплаченная кровью
 *                   Владыки, — не мана;
 *   spikeHits     — касания шипов КАРТЫ, на которых шипы ударили (окно
 *                   неуязвимости шипов между ними не считается);
 *   skillCasts    — ВСЕ применения навыков: промахи, исцеление, бесплатные.
 * Сервер поле, которого нет, считает «неизвестным», а не нулём, — поэтому
 * клиент шлёт все пять всегда.
 */
export type QuestRunCounters = {
  parries: number
  manaCollected: number
  manaSpent: number
  spikeHits: number
  skillCasts: number
}

export function emptyQuestRunCounters(): QuestRunCounters {
  return { parries: 0, manaCollected: 0, manaSpent: 0, spikeHits: 0, skillCasts: 0 }
}

/**
 * Один выросший навык: его id и НОВЫЙ уровень.
 *
 * Считает сервер, а не клиент сравнением двух наборов: пороги и остатки
 * применений живут только в БД.
 */
export type SkillLevelUp = { skillId: SkillBookSkillId; level: number }

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
  // ⚠️ smugglerOutcome УБРАН (27.09.2026). Исход сделки с Контрабандистом теперь
  // бросает СЕРВЕР (POST /run/smuggler-deal) и хранит в currentRun.smugglerDeal;
  // финиш читает его оттуда, а тело запроса больше не участвует. Прежняя схема
  // («клиент присылает исход, сервер верит на слово») позволяла всегда присылать
  // 'gain'. Поле в теле не отправляется вовсе — сервер его игнорирует.
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
  // Сработал ли оберег от смерти. Сервер верит так же, как `died` (бой целиком
  // на клиенте), но проверяет, что оберег вообще был взят в забег — иначе 400.
  charmUsed?: boolean,
  // Результативные применения каждого навыка за забег (Explore.tsx:
  // skillUsesRef — считаются по ФАКТУ попадания/лечения, не по нажатию). Из них
  // сервер растит уровни навыков, своей формулой и своими порогами. Доверие то
  // же, что у четырёх счётчиков выше: попал ли удар, знает только клиент.
  skillUses?: Record<string, number>,
  // Пять счётчиков ежедневных заданий (26.10.2026) — см. QuestRunCounters. В
  // тело уходят ПЛОСКО (parries, manaCollected, …), как их читает сервер.
  questCounters?: QuestRunCounters,
): Promise<FinishExploreResult> {
  // runId (15.10.2026): повтор финиша с тем же id сервер узнаёт и отдаёт
  // сохранённый итог вместо 400 'No active explore run'. Снимается ОДИН раз,
  // вместе с телом: все попытки этого вызова несут один и тот же id.
  const body = JSON.stringify({ ...runIdField(), closedEvents, died, attackDamageDealt, skillDamageDealt, healedAmount, damageTaken, potionsDrunkByTier, charmUsed, skillUses, ...questCounters })
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
        // Ответ финиша разбирается кастом (единственный такой эндпоинт в файле,
        // см. комментарий к readRunDrops). Добыча — новое поле, и её проверяем
        // здесь, чтобы ниже по коду это всегда были массивы, а не «что пришло».
        return {
          ...data,
          drops: readRunDrops(data.drops),
          dropsLost: readRunDrops(data.dropsLost),
          // Выросшие навыки — тем же приёмом и по той же причине, что добыча:
          // ответ разбирается кастом, поэтому новое поле проверяется здесь,
          // чтобы ниже по коду это всегда был массив, а не «что пришло».
          skillLevelUps: readSkillLevelUps(data.skillLevelUps),
          // Ежедневные задания (26.10.2026) — тем же приёмом: ниже по коду это
          // всегда число или null, выполненное задание или null, вид или null.
          gold: readCurrencyCount(data.gold),
          hunterBadges: readCurrencyCount(data.hunterBadges),
          rp: readCurrencyCount(data.rp),
          questCompleted: readQuestCompleted(data.questCompleted),
          quests: readQuestView(data.quests),
        }
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
// replayed (15.10.2026) — глоток уже был записан раньше (первая попытка дошла,
// ответ потерялся), и сервер записывать его второй раз не стал; числа те же.
export type SipResult = { potionsDrunk: number[]; sipsLeft: number; replayed?: boolean }

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
  // sipId — один на ВСЕ попытки этого глотка (15.10.2026). Попытка, прерванная
  // нашим таймаутом, могла дойти до сервера; повтор с тем же id сервер узнаёт
  // и второй раз глоток не записывает.
  const body = JSON.stringify({ ...runIdField(), tier, sipId: newRequestId() })
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
  /**
   * Результативные применения КАЖДОГО навыка с начала забега (02.10.2026) —
   * пятое поле того же среза, а не отдельный запрос: применения растят уровень
   * навыка ровно тем же путём, что четыре счётчика выше растят статы, и у
   * брошенного забега их подхватывает тот же /auth/login.
   *
   * Все пять навыков всегда, даже нулями: сервер разбирает срез СТРОГО, и
   * половина объекта означала бы для него испорченный срез (400).
   */
  skillUses: Record<SkillBookSkillId, number>
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
      // runId (15.10.2026) — срез прошлого забега, доползший после старта
      // нового, сервер не положит в новый.
      body: JSON.stringify({ ...snapshot, ...runIdField() }),
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

// saveEquippedSkills УДАЛЁН 29.09.2026 вместе с серверным POST /character/skills:
// тот принимал любой набор навыков и записывал его без условий, то есть выдавал
// навык бесплатно. Теперь навык бывает только от книги — см. четыре ручки книг в
// конце файла (equipBook/forgetSkill/upgradeSkill/sellBook). Это была ЕДИНСТВЕННАЯ
// функция в файле без таймаута (на голом fetch), так что заодно закрылась и
// соответствующая открытая задача.

// --- Ключ идемпотентности покупок (15.10.2026) ---
//
// Беда, которую он закрывает: ответ на покупку потерялся (таймаут, сеть, 5xx),
// игрок сверяет баланс — сервер запроса ещё не видел, — и покупает снова. А
// потом доползает первый запрос, и золото списано дважды за одну покупку.
//
// Как: каждая покупка несёт requestId, и сервер применяет ключ ровно один раз
// (applyOnce, server/src/routes/run.ts). Покупка с НЕИЗВЕСТНЫМ исходом
// оставляет свой ключ здесь, и следующая покупка ТОГО ЖЕ товара в том же
// количестве несёт ТОТ ЖЕ ключ: дошёл первый запрос — сервер ответит «уже
// сделано» (replayed) текущим балансом; не дошёл — применит этот; доползёт
// первый после — получит «уже сделано» и ничего не спишет.
// Ответ пришёл (успех или отказ по существу) — ключ забывается, следующая
// покупка получит новый.
// Сверка баланса (fetchProfile) спрашивает сервер о каждом запомненном ключе
// (15.10.2026, вторая правка): покупка с этим ключом УЖЕ применена — ключ
// забывается, и следующее нажатие «Купить» — честная новая покупка. Без этого
// игрок, увидевший сверкой, что первая покупка прошла, и купивший то же самое
// ещё раз, получал «уже сделано» и строку «Сервер продал 0 из 1».
// Не применена — ключ остаётся: первый запрос может ещё доползти.
// ⚠️ Ключ живёт в памяти вкладки: перезагрузка его теряет (вход при этом
// перечитывает баланс заново).
const PURCHASE_KEY_REUSE_MS = 10 * 60 * 1000
const pendingPurchaseKeys = new Map<string, { key: string; at: number }>()

function purchaseKeyFor(signature: string): string {
  const pending = pendingPurchaseKeys.get(signature)
  if (pending && Date.now() - pending.at < PURCHASE_KEY_REUSE_MS) return pending.key
  return newRequestId()
}

// Одна покупка с ключом: запрос, а по его исходу — запомнить или забыть ключ.
// Исход неизвестен ровно тогда, когда RequestError.retryable: таймаут, сеть,
// 5xx, а также 200 с нечитаемым телом (у него kind 'timeout' / 'network').
async function keyedPurchase<T>(signature: string, send: (requestId: string) => Promise<T>): Promise<T> {
  const key = purchaseKeyFor(signature)
  try {
    const result = await send(key)
    pendingPurchaseKeys.delete(signature)
    return result
  } catch (e) {
    if (e instanceof RequestError && e.retryable) {
      pendingPurchaseKeys.set(signature, { key, at: Date.now() })
    } else {
      pendingPurchaseKeys.delete(signature)
    }
    throw e
  }
}

export type BuyPotionResult = {
  gold: number
  // Склад по тирам ПОСЛЕ покупки (индекс = тир-1) — абсолютный, как gold.
  potions: number[]
  /**
   * Покупка с этим ключом уже была применена раньше (ответ на неё потерялся),
   * второй раз сервер её не применил. gold/potions — текущие, как всегда.
   */
  replayed?: boolean
}

// Покупка и сверка баланса — короткий таймаут: игрок стоит в магазине и ждёт
// ответа, держать его дольше нечем. 5 с хватает проснувшемуся серверу; спящий
// не уложится, и это честнее показать строкой, чем морозить кнопку.
const SHOP_TIMEOUT_MS = 5000

// tier — номер тира 1..5 (см. src/potions.ts), count — сколько штук
// (1..MAX_POTIONS_PER_PURCHASE). Цену, уровень открытия и потолок count сервер
// проверяет по СВОЕЙ копии каталога, клиент называет только тир и количество.
//
// ПОВТОРОВ НЕТ: при сетевом сбое вызывающий обязан не «попробовать ещё», а
// СВЕРИТЬ баланс (fetchProfile ниже) — см. handleBuyPotion в App.tsx. С
// 15.10.2026 у покупки есть ключ идемпотентности (keyedPurchase выше), и
// следующая такая же покупка после сбоя несёт тот же ключ.
export async function buyPotion(token: string, tier: number, count: number): Promise<BuyPotionResult> {
  return keyedPurchase(`buy-potion:${tier}:${count}`, (requestId) => requestJson<BuyPotionResult>(
    `${SERVER_URL}/character/buy-potion`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tier, count, requestId }),
    },
    SHOP_TIMEOUT_MS,
  ))
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
  /** null — сервер не назвал склад расходников (см. readConsumables). */
  consumables: Record<ConsumableId, number> | null
  /** null — сервер не назвал склад страниц (см. readScrolls). */
  scrolls: Record<ScrollId, number> | null
  /** null — сервер не назвал склад предметов классов (см. readClassItems). */
  classItems: Record<ClassItemId, number> | null
  /** null — сервер курс не назвал (см. readTrophyGoldRate). */
  trophyGoldRate: number | null
  /** null — сервер не назвал надетые навыки (см. readEquippedSkills). */
  equippedSkills: string[] | null
  /** null — сервер не назвал уровни навыков (см. readSkillLevels). */
  skillLevels: Record<SkillBookSkillId, number> | null
  /** null — сервер не назвал применения навыков (см. readSkillUses). */
  skillUses: Record<SkillBookSkillId, number> | null
  /** null — сервер не назвал счётчики улучшений (см. readUpgrades). */
  upgrades: UpgradeCounts | null
  /** null — сервер не назвал класс героя (см. readHeroClass). */
  heroClass: HeroClassState | null
  /** null — сервер не назвал значки охотника (сервер старше заданий, см. readCurrencyCount). */
  hunterBadges: number | null
  /** null — сервер не назвал RP (см. readCurrencyCount). */
  rp: number | null
  /**
   * Сохранённые статы и уровень (27.10.2026, Ловчий: покупка стата меняет их вне
   * забега). null — сервер старше Ловчего и их не прислал.
   */
  strength: number | null
  agility: number | null
  endurance: number | null
  level: number | null
}

// Сверка баланса: золото, трофеи, склад зелий по тирам и курс обмена. ТОЛЬКО
// чтение — сервер на этом пути ничего не пишет (GET /character/profile).
// Нужна отдельно от loginWithTelegram именно поэтому: вход — полноценный
// логин, и он ЗАКРЫВАЕТ открытый на сервере забег (подтверждённый — как
// смерть, со сгоранием банка трофеев). Делать это побочным эффектом кнопки
// «Обновить баланс» нельзя.
export async function fetchProfile(token: string): Promise<ProfileResult> {
  // Ключи покупок с неизвестным исходом — сервер скажет, какие из них уже
  // применены (см. keyedPurchase). Снимок списка ДО запроса: ключ, появившийся
  // за время запроса, сервер ещё не проверял.
  const pending = [...pendingPurchaseKeys.entries()]
  const query = pending.length > 0
    ? `?requestIds=${encodeURIComponent(pending.map(([, p]) => p.key).join(','))}`
    : ''
  const raw = await requestJson<{
    gold: number
    trophies: number
    potions: number[]
    consumables?: unknown
    scrolls?: unknown
    classItems?: unknown
    trophyGoldRate?: unknown
    equippedSkills?: unknown
    skillLevels?: unknown
    skillUses?: unknown
    upgrades?: unknown
    heroClass?: unknown
    hunterBadges?: unknown
    rp?: unknown
    strength?: unknown
    agility?: unknown
    endurance?: unknown
    level?: unknown
    appliedRequestIds?: unknown
  }>(
    `${SERVER_URL}/character/profile${query}`,
    { method: 'GET', headers: { 'Authorization': `Bearer ${token}` } },
    SHOP_TIMEOUT_MS,
  )
  // Старый сервер поля не присылает — ключи остаются, как было до правки.
  if (Array.isArray(raw.appliedRequestIds)) {
    const applied = new Set(raw.appliedRequestIds.filter((id): id is string => typeof id === 'string'))
    for (const [signature, p] of pending) {
      if (applied.has(p.key) && pendingPurchaseKeys.get(signature)?.key === p.key) pendingPurchaseKeys.delete(signature)
    }
  }
  return {
    gold: raw.gold,
    trophies: raw.trophies,
    potions: raw.potions,
    consumables: readConsumables(raw.consumables),
    scrolls: readScrolls(raw.scrolls),
    classItems: readClassItems(raw.classItems),
    trophyGoldRate: readTrophyGoldRate(raw.trophyGoldRate),
    equippedSkills: readEquippedSkills(raw.equippedSkills),
    skillLevels: readSkillLevels(raw.skillLevels),
    skillUses: readSkillUses(raw.skillUses),
    upgrades: readUpgrades(raw.upgrades),
    heroClass: readHeroClass(raw.heroClass),
    hunterBadges: readCurrencyCount(raw.hunterBadges),
    rp: readCurrencyCount(raw.rp),
    strength: readCurrencyCount(raw.strength),
    agility: readCurrencyCount(raw.agility),
    endurance: readCurrencyCount(raw.endurance),
    level: readCurrencyCount(raw.level),
  }
}

// --- Ежедневные задания (26.10.2026, docs/daily-quests.md) ---
//
// Вид заданий приходит готовым от сервера (QuestView в server/src/questState.ts
// — КОПИЯ ниже, менять парами: сверяющего скрипта у неё нет, см. CLAUDE.md,
// таблица копий). Названия и описания клиент берёт из общего каталога
// src/quests.ts по id; сервер шлёт только id, статусы и числа.

/** Статус места в наборе: open — невзятое, active — взятое, done/lost — вынуто. */
export type QuestSlotStatus = 'open' | 'active' | 'done' | 'lost'
export type QuestReward = { gold: number; hunterBadges: number; rp: number }
export type QuestViewSlot = { id: QuestId; status: QuestSlotStatus; goal: number; progress: number | null; reward: QuestReward }

/**
 * Состояние заданий — копия серверного QuestView:
 *   unlocked / unlockLevel — открыты ли задания и с какого уровня;
 *   set                    — задания набора: статус, цель, прогресс (только у
 *                            активного), награда на текущем уровне;
 *   replaceAvailable       — есть ли замена на этом шаге;
 *   nextSetInMs            — через сколько мс ОТ ОТВЕТА придёт новый набор;
 *                            null — таймер не запущен. Отсчёт ведёт клиент от
 *                            момента получения ответа (часы телефона с сервером
 *                            не сверены, поэтому число относительное);
 *   carried                — переходящее задание из прошлого набора или null.
 */
export type QuestView = {
  unlocked: boolean
  unlockLevel: number
  set: QuestViewSlot[]
  replaceAvailable: boolean
  nextSetInMs: number | null
  carried: { id: QuestId; goal: number; progress: number; reward: QuestReward } | null
}

/** Ответ трёх ручек заданий: вид и валюты, которые задания приносят. */
export type QuestsResult = { quests: QuestView; hunterBadges: number | null; rp: number | null }

/** Целое неотрицательное число валюты или null — «сервер не назвал». */
export function readCurrencyCount(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : null
}

function readQuestReward(raw: unknown): QuestReward | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const gold = readCurrencyCount(r.gold)
  const hunterBadges = readCurrencyCount(r.hunterBadges)
  const rp = readCurrencyCount(r.rp)
  return gold === null || hunterBadges === null || rp === null ? null : { gold, hunterBadges, rp }
}

const QUEST_SLOT_STATUSES: readonly QuestSlotStatus[] = ['open', 'active', 'done', 'lost']

/**
 * СТРОГИЙ разбор вида заданий: любое отклонение — null, и вызывающий
 * показывает прежнюю доску, а не полуразобранную. id — только из общего
 * каталога: задание, которого клиент не знает (сервер новее каталога), назвать
 * нечем, и молча выкинуть его с доски значило бы спрятать задание игрока.
 */
export function readQuestView(raw: unknown): QuestView | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (typeof r.unlocked !== 'boolean' || readCurrencyCount(r.unlockLevel) === null) return null
  if (typeof r.replaceAvailable !== 'boolean' || !Array.isArray(r.set)) return null
  if (r.nextSetInMs !== null && !(typeof r.nextSetInMs === 'number' && Number.isFinite(r.nextSetInMs) && r.nextSetInMs >= 0)) return null
  const set: QuestViewSlot[] = []
  for (const item of r.set) {
    if (typeof item !== 'object' || item === null) return null
    const s = item as Record<string, unknown>
    const id = parseQuestId(s.id)
    const goal = readCurrencyCount(s.goal)
    const reward = readQuestReward(s.reward)
    const progress = s.progress === null ? null : readCurrencyCount(s.progress)
    if (id === null || goal === null || reward === null || !QUEST_SLOT_STATUSES.includes(s.status as QuestSlotStatus)) return null
    if (s.progress !== null && progress === null) return null
    set.push({ id, status: s.status as QuestSlotStatus, goal, progress, reward })
  }
  let carried: QuestView['carried'] = null
  if (r.carried !== null) {
    if (typeof r.carried !== 'object' || r.carried === undefined) return null
    const c = r.carried as Record<string, unknown>
    const id = parseQuestId(c.id)
    const goal = readCurrencyCount(c.goal)
    const progress = readCurrencyCount(c.progress)
    const reward = readQuestReward(c.reward)
    if (id === null || goal === null || progress === null || reward === null) return null
    carried = { id, goal, progress, reward }
  }
  return {
    unlocked: r.unlocked,
    unlockLevel: r.unlockLevel as number,
    set,
    replaceAvailable: r.replaceAvailable,
    nextSetInMs: r.nextSetInMs as number | null,
    carried,
  }
}

/** Выполненное задание из ответа финиша: null — не выполнено (или поле негодно). */
export function readQuestCompleted(raw: unknown): QuestCompleted | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'object') {
    console.error('api: questCompleted в ответе финиша — не объект', raw)
    return null
  }
  const r = raw as Record<string, unknown>
  const questId = parseQuestId(r.questId)
  const reward = readQuestReward(r)
  if (questId === null || reward === null) {
    console.error('api: questCompleted в ответе финиша не разобран', raw)
    return null
  }
  return { questId, ...reward }
}

// Таймауты ручек заданий. Повторов нет ни у одной: GET дёргается заново при
// каждом открытии вкладки и после финиша, а take/replace при любом отказе
// приводят к перечитыванию — повторять отправку незачем (у replace повтор,
// дошедший дважды, потратил бы замену на другое задание).
const QUESTS_TIMEOUT_MS = 8000

async function questsRequest(path: string, init: RequestInit): Promise<QuestsResult> {
  const raw = await requestJson<{ quests?: unknown; hunterBadges?: unknown; rp?: unknown }>(`${SERVER_URL}${path}`, init, QUESTS_TIMEOUT_MS)
  const quests = readQuestView(raw.quests)
  if (quests === null) {
    // Ответ пришёл, но вид не разобран — это не «заданий нет»: доска остаётся
    // прежней, и об этом громко в консоль.
    console.error(`api: ${path} — вид заданий не разобран`, raw.quests)
    throw new RequestError(`${path}: unreadable quests view`, { status: 200, serverError: null, kind: 'http', networkError: null, body: raw })
  }
  return { quests, hunterBadges: readCurrencyCount(raw.hunterBadges), rp: readCurrencyCount(raw.rp) }
}

/** Состояние заданий. Может бросить сервером новый набор (тогда сервер пишет). */
export function fetchQuests(token: string): Promise<QuestsResult> {
  return questsRequest('/character/quests', { method: 'GET', headers: { 'Authorization': `Bearer ${token}` } })
}

function questActionRequest(path: string, token: string, questId: QuestId): Promise<QuestsResult> {
  return questsRequest(path, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ questId }),
  })
}

/** Взять задание набора: активное (и переходящее) пропадает с прогрессом. */
export function takeQuest(token: string, questId: QuestId): Promise<QuestsResult> {
  return questActionRequest('/character/quests/take', token, questId)
}

/** Заменить невзятое задание набора случайным новым (одна замена на шаг). */
export function replaceQuest(token: string, questId: QuestId): Promise<QuestsResult> {
  return questActionRequest('/character/quests/replace', token, questId)
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

// --- Контрабандист: предложение и сделка ---
//
// Обе ручки берут ОДНО и то же тело — индексы событий, закрытых К ЭТОМУ МОМЕНТУ,
// ровно тот же список, что уезжает в финиш (Explore.tsx: collectClosedEventIndices).
// Суммы наград клиент не присылает и не может: они лежат в currentRun.events на
// сервере, и ставку считает он.
//
// Таймауты короткие: игрок стоит перед панелью и ждёт ответа, держать его дольше
// нечем. Повторы разрешены у ОБЕИХ — quote не пишет ничего вовсе, а deal
// идемпотентна (повтор возвращает тот же сохранённый исход, нового броска нет).
// Поэтому прерванная попытка не может ни списать, ни перебросить.
const SMUGGLER_ATTEMPT_TIMEOUT_MS = 5000
const SMUGGLER_TOTAL_BUDGET_MS = 15000
const SMUGGLER_RETRY_DELAYS_MS = [300, 1200]

export type SmugglerQuote = {
  /** Что стоит на кону: банк трофеев + трофеи событий, закрытых до сделки. */
  stake: number
  /** Сколько станет при удаче. Считает сервер — клиент множитель не знает. */
  ifGain: number
}

export type SmugglerDealResult = {
  outcome: 'gain' | 'steal'
  stake: number
  /** Сколько стало из stake после исхода. Прибавка/убыль = after − stake. */
  after: number
}

// Общий цикл повторов для обеих ручек. Повторяем ТОЛЬКО retryable
// (таймаут/сеть/5xx): 400 («нет забега», «нет Контрабандиста») и 409 («сделка уже
// сделана», «состояние изменилось») — это окончательные ответы по существу, и
// повтор их не исправит, а вызывающий обязан их различить.
async function smugglerRequest<T>(path: string, token: string, closedEvents: number[]): Promise<T> {
  const body = JSON.stringify({ ...runIdField(), closedEvents })
  const deadline = Date.now() + SMUGGLER_TOTAL_BUDGET_MS
  let retries = 0
  let lastError: RequestError | null = null

  while (true) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      throw lastError ?? new RequestError(`${path} failed (time budget exhausted)`, {
        status: null, serverError: null, kind: 'timeout', networkError: null,
      })
    }
    try {
      return await requestJson<T>(
        `${SERVER_URL}${path}`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body,
        },
        Math.min(SMUGGLER_ATTEMPT_TIMEOUT_MS, remaining),
      )
    } catch (e) {
      if (!(e instanceof RequestError)) throw e
      if (!e.retryable) throw e
      lastError = e
      const delay = SMUGGLER_RETRY_DELAYS_MS[retries]
      if (delay === undefined || Date.now() + delay >= deadline) throw e
      await sleep(delay)
      retries++
    }
  }
}

// Сколько на кону и что будет при удаче. Сервер на этом пути НИЧЕГО не пишет,
// поэтому звать можно свободно (например на каждое открытие панели).
// 409 `Deal already made` — сделка в этом забеге уже сделана.
export async function smugglerQuote(token: string, closedEvents: number[]): Promise<SmugglerQuote> {
  return smugglerRequest<SmugglerQuote>('/run/smuggler-quote', token, closedEvents)
}

// Сама сделка. Бросок делает сервер и запоминает его в currentRun.smugglerDeal,
// поэтому повтор безопасен и вернёт ТОТ ЖЕ исход — перебросить неудачу нельзя.
export async function smugglerDeal(token: string, closedEvents: number[]): Promise<SmugglerDealResult> {
  return smugglerRequest<SmugglerDealResult>('/run/smuggler-deal', token, closedEvents)
}

/**
 * Разбор склада расходников из ответа сервера (логин, профиль, покупка).
 *
 * Возвращает null на ВСЁ, что не является полным и годным складом: поля нет, это
 * не объект, хотя бы у одного id каталога значение не целое неотрицательное
 * число. Null — не «расходников нет», а «запас неизвестен»: экраны в этом
 * состоянии пишут прочерк, а не ноль. Ноль и «сервер не сказал» — РАЗНЫЕ
 * состояния, и второе не должно маскироваться первым.
 *
 * Требуются ВСЕ id каталога, а не те, что пришли: частично заполненный объект
 * означает, что сервер и клиент разошлись каталогами, и доверять остатку нельзя.
 */
export function readConsumables(raw: unknown): Record<ConsumableId, number> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const out = {} as Record<ConsumableId, number>
  for (const spec of CONSUMABLES) {
    const v = record[spec.id]
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return null
    out[spec.id] = v
  }
  return out
}

/**
 * Разбор списка добычи из ответа финиша.
 *
 * Нужен потому, что ответ финиша разбирается КАСТОМ (`as FinishExploreResult`,
 * см. finishRunExplore) — единственный эндпоинт в файле без разбора полей, и
 * переписывать его целиком ради дропа нельзя: он проверен живыми забегами.
 * Поэтому проверяется ровно новое поле, и ровно там, где оно возвращается.
 *
 * Негодная ЗАПИСЬ выбрасывается поштучно, а весь список — нет: одна кривая
 * строка не повод спрятать остальную добычу, которую сервер УЖЕ начислил. Это
 * не тихий фолбэк: начисление от показа не зависит, и потерять здесь можно
 * только строчку на экране, а не предмет. Поля нет вовсе (старый сервер) —
 * пустой список, и это честно: добычи у такого сервера и не было.
 */
export function readRunDrops(raw: unknown): RunDrop[] {
  if (!Array.isArray(raw)) return []
  const out: RunDrop[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    if (e.category === 'equipment') {
      if (typeof e.nameRu !== 'string' || typeof e.slot !== 'string' || typeof e.tier !== 'number') continue
      out.push({ category: 'equipment', nameRu: e.nameRu, slot: e.slot, tier: e.tier })
    } else if (e.category === 'potion') {
      if (typeof e.tier !== 'number') continue
      out.push({ category: 'potion', tier: e.tier })
    } else if (e.category === 'scroll' || e.category === 'book') {
      if (typeof e.id !== 'string') continue
      out.push({ category: e.category, id: e.id })
    } else if (e.category === 'soul_shard' || e.category === 'renounce_seal') {
      out.push({ category: e.category })
    }
  }
  return out
}

/**
 * Награда ОДНОГО события из ответа старта: сколько трофеев и что выпало.
 *
 * Отдельно от readRunDrops потому, что здесь другой контракт на «нет данных».
 * Старый сервер не присылает ни того, ни другого, и оба случая должны быть
 * различимы в забеге: `trophies: null` значит «сервер числа не назвал» — тогда
 * всплывашка трофеев не показывается ВОВСЕ, а не печатает ноль над трупом.
 * Ноль же — законное число (так выглядит мимик) и значит «трофеев нет».
 *
 * Мусор в `trophyReward` (строка, дробное, отрицательное) — тоже null: печатать
 * «+NaN» игроку нельзя, а догадываться, что имелось в виду, не из чего.
 */
/**
 * Разбор вида врагов в событии (04.10.2026).
 *
 * ⚠️ Три входа, и «тихим фолбэком» это не является:
 *   поля НЕТ         -> 'beast'. Это единственное, чем может быть группа у
 *                       сервера, который Звонаря не знал, — отсутствие поля
 *                       ЗНАЧИТ «звери», а не «неизвестно»;
 *   'beast'/'zvonar'/'gatekeeper' -> как сказано;
 *   что угодно иное  -> 'beast' И ГРОМКАЯ ошибка в консоль. Молчать нельзя:
 *                       это рассинхрон каталогов, и он обязан быть виден.
 *
 * Почему не null, как у readConsumables: у склада «неизвестно» — рабочее
 * состояние экрана, а здесь выбор между наборами спрайт-листов, и забег без
 * врагов хуже забега со зверями вместо Звонарей или Привратников.
 */
export function readEnemyKind(raw: unknown): StartExploreEnemyKind {
  if (raw === undefined || raw === null) return 'beast'
  if (raw === 'beast' || raw === 'zvonar' || raw === 'gatekeeper') return raw
  console.error('api: неизвестный вид врагов в событии', raw, '— считаем зверями')
  return 'beast'
}

/**
 * Решение сервера по сундуку из ответа старта: ловушка (true) или обычный
 * (false). Спрашивать только у события kind === 'chest'.
 *
 * null — сервер решения НЕ назвал: поля нет (сервер старше 13.10.2026) или в нём
 * не boolean. ⚠️ Это не «обычный сундук» и не повод бросить самому: свой бросок
 * клиента и был багом — сундук взрывался, а сервер считал его обычным и
 * начислял трофеи, и наоборот. Вызывающий обязан отказаться показывать забег
 * (см. setup() в Explore.tsx).
 */
export function readChestMimic(raw: unknown): boolean | null {
  if (typeof raw !== 'object' || raw === null) return null
  const m = (raw as Record<string, unknown>).isMimic
  return typeof m === 'boolean' ? m : null
}

// drops — вся добыча события, в порядке показа: сначала обычная (drop), потом
// вторая, отдельным броском (extraDrop: Печать отречения с босса, 18.10.2026).
// Пустой список — не выпало ничего (самый частый исход) или сервер старый.
export function readEventReward(raw: unknown): { trophies: number | null; drops: RunDrop[] } {
  if (typeof raw !== 'object' || raw === null) return { trophies: null, drops: [] }
  const e = raw as Record<string, unknown>
  const t = e.trophyReward
  const trophies = typeof t === 'number' && Number.isInteger(t) && t >= 0 ? t : null
  // Обе добычи разбираем тем же валидатором, что список на экране итогов —
  // завернув в массив: второй разбор той же формы разошёлся бы с первым.
  const listed = [e.drop, e.extraDrop].filter((d) => d !== undefined && d !== null)
  return { trophies, drops: readRunDrops(listed) }
}

/**
 * Разбор склада СТРАНИЦ из ответа сервера (логин, профиль, обе ручки страниц,
 * финиш забега).
 *
 * Тот же контракт и те же причины, что у readConsumables выше: null на всё, что
 * не является полным и годным складом, и это значит «запас неизвестен», а не
 * «страниц нет». Требуются ВСЕ id каталога — частично заполненный объект значит,
 * что сервер и клиент разошлись каталогами, и доверять остатку нельзя.
 *
 * Отдельная функция, а не вызов readConsumables с другим каталогом: у страниц
 * свой тип id, и общая функция вернула бы Record<ConsumableId | ScrollId, …>,
 * где вызывающий уже не различит, чего именно не хватает.
 */
export function readScrolls(raw: unknown): Record<ScrollId, number> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const out = {} as Record<ScrollId, number>
  for (const spec of SCROLLS) {
    const v = record[spec.id]
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return null
    out[spec.id] = v
  }
  return out
}

/**
 * Разбор склада ПРЕДМЕТОВ КЛАССОВ (Осколок души, Печать отречения; 18.10.2026)
 * из ответа сервера — логин, профиль, ручки сумки, финиш забега.
 *
 * Тот же контракт, что у readScrolls выше: null на всё, что не является полным и
 * годным складом, и это значит «запас неизвестен», а не «предметов нет». Поля
 * нет вовсе у сервера старше 18.10.2026.
 */
export function readClassItems(raw: unknown): Record<ClassItemId, number> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const out = {} as Record<ClassItemId, number>
  for (const spec of CLASS_ITEMS) {
    const v = record[spec.id]
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return null
    out[spec.id] = v
  }
  return out
}

/**
 * Разбор класса героя из ответа сервера — логин, профиль, три ручки класса
 * (20.10.2026). 'none' — класса нет (JSON-null), {id, tier} — класс; null —
 * сервер НЕ НАЗВАЛ: поля нет (сервер старше 20.10.2026 или испорченная пара
 * колонок, см. heroClassField на сервере) или в нём мусор.
 *
 * ⚠️ undefined и null на проводе — РАЗНЫЕ ответы: null — «класса нет», а
 * отсутствие поля — «неизвестно». Свернуть их значило бы показать «Можно выбрать
 * класс» герою, у которого класс есть (или наоборот).
 */
export function readHeroClass(raw: unknown): HeroClassState | null {
  if (raw === undefined) return null
  return parseHeroClassWire(raw)
}

/**
 * Разбор уровней навыков из ответа сервера (логин, профиль, четыре ручки книг).
 *
 * Требуются ВСЕ навыки каталога, как и у readConsumables: частично заполненный
 * объект значит, что сервер и клиент разошлись каталогами, и доверять остатку
 * нельзя. null — «уровни неизвестны», НЕ «уровень 1»: в карточке навыка при null
 * стоит прочерк, а не выдуманная единица.
 */
export function readSkillLevels(raw: unknown): Record<SkillBookSkillId, number> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const out = {} as Record<SkillBookSkillId, number>
  for (const spec of CONSUMABLES) {
    const skillId = consumableSkillBook(spec)
    if (skillId === null) continue
    const v = record[skillId]
    // Уровень начинается с 1, поэтому ноль и отрицательное — тоже негодные
    // данные, а не «просто мало».
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) return null
    out[skillId] = v
  }
  return out
}

/**
 * Разбор остатка регенерации энергии из ответа логина — сколько секунд уже
 * натикало в счёт следующей единицы (0 .. шаг−1 секунд, сейчас 0..119).
 *
 * Поля нет или в нём мусор — НОЛЬ, и это единственный случай тихого значения во
 * всём файле, объяснимый по существу: ноль означает «считаем шаг с нуля», то
 * есть РОВНО прежнее поведение клиента. Ошибиться в эту сторону можно максимум
 * на одну единицу И ТОЛЬКО ВНИЗ — игрок увидит прибавку позже, а не лишнюю
 * энергию, которой нет. Так что сервер без этого поля здесь не ломает ничего.
 * (Когда правка писалась, такой сервер и работал; серверная половина выложена
 * 05.10.2026, с тех пор поле приходит.)
 *
 * ⚠️ Потолок берётся ИЗ ШАГА (`ENERGY_REGEN_MS`), а не числом 59: при темпе «1
 * за 2 минуты» остаток доходит до 119 секунд, и прежний клэмп срезал бы его
 * вдвое. Сам клэмп нужен потому, что поле приходит извне: база отсчёта,
 * уехавшая назад больше чем на шаг, прибавила бы игроку единицу из воздуха.
 */
export function readEnergyAccruedSec(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0
  return Math.min(Math.floor(ENERGY_REGEN_MS / 1000) - 1, Math.max(0, Math.floor(raw)))
}

/**
 * Разбор применений навыков (логин, профиль, финиш забега).
 *
 * Тот же контракт, что у readSkillLevels выше, с одним отличием: ноль здесь
 * ЗАКОННЫЙ и самый частый (навык ещё не применяли с прошлого повышения),
 * поэтому годное значение — целое >= 0, а не >= 1.
 */
export function readSkillUses(raw: unknown): Record<SkillBookSkillId, number> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const out = {} as Record<SkillBookSkillId, number>
  for (const spec of CONSUMABLES) {
    const skillId = consumableSkillBook(spec)
    if (skillId === null) continue
    const v = record[skillId]
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return null
    out[skillId] = v
  }
  return out
}

/**
 * Разбор списка выросших навыков из ответа финиша (и из interruptedRun логина).
 *
 * Нужен по той же причине, что readRunDrops: ответ финиша разбирается кастом,
 * поэтому новое поле проверяется отдельно и ровно там, где возвращается.
 *
 * Негодная запись выбрасывается ПОШТУЧНО, а весь список — нет: уровень сервер
 * УЖЕ записал, и потерять здесь можно только строчку на экране. Поля нет вовсе
 * (старый сервер) — пустой список: у такого сервера уровни и не росли.
 *
 * id сверяется с каталогом (parseSkillBookSkillId), иначе на экране итогов
 * оказалась бы строка без печати и без имени — «вырос неизвестно кто».
 */
export function readSkillLevelUps(raw: unknown): SkillLevelUp[] {
  if (!Array.isArray(raw)) return []
  const out: SkillLevelUp[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    const skillId = parseSkillBookSkillId(e.skillId)
    if (skillId === null) continue
    if (typeof e.level !== 'number' || !Number.isInteger(e.level) || e.level < 1) continue
    out.push({ skillId, level: e.level })
  }
  return out
}

/**
 * Разбор счётчиков улучшений («закалок»).
 *
 * null — «сервер не назвал», и это НЕ нули: от счётчиков зависят урон и броня,
 * и посчитать их с нулём значило бы показать игроку заниженные числа и увести
 * его с ними в забег. Нужны ОБА поля: половина ответа означает, что сервер и
 * клиент разошлись, и доверять остатку нельзя.
 */
export function readUpgrades(raw: unknown): UpgradeCounts | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const out = {} as UpgradeCounts
  for (const kind of ['attack', 'armor'] as const) {
    const v = record[kind]
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return null
    out[kind] = v
  }
  return out
}

/**
 * Разбор надетых навыков. null — сервер их не назвал или назвал мусором, и это НЕ
 * «навыков нет»: пустой список — штатное состояние (герой без книг), а
 * неизвестность обязана выглядеть иначе, иначе забег молча ушёл бы без кнопок
 * навыков, которые игроку положены.
 */
export function readEquippedSkills(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  if (!raw.every((s) => typeof s === 'string')) return null
  return raw as string[]
}

export type BuyConsumableResult = {
  gold: number
  /** null — сервер не назвал склад (см. readConsumables). */
  consumables: Record<ConsumableId, number> | null
  /** См. BuyPotionResult.replayed. */
  replayed: boolean
}

/**
 * Покупка расходника (POST /character/buy-consumable).
 *
 * id и count — из каталога и степпера; цену, уровень открытия и потолок count
 * сервер проверяет по СВОЕЙ копии каталога, клиент называет только что и сколько.
 *
 * ПОВТОРОВ НЕТ и быть не должно — ровно по той же причине, что у buyPotion:
 * эндпоинт НЕ идемпотентен, прерванная попытка могла дойти и списать золото, а
 * повтор списал бы второй раз. При сетевом сбое вызывающий обязан не «попробовать
 * ещё», а СВЕРИТЬ баланс (fetchProfile).
 */
export async function buyConsumable(token: string, id: ConsumableId, count: number): Promise<BuyConsumableResult> {
  // Ключ идемпотентности — см. keyedPurchase (15.10.2026).
  const raw = await keyedPurchase(`buy-consumable:${id}:${count}`, (requestId) => requestJson<{ gold: number; consumables?: unknown; replayed?: unknown }>(
    `${SERVER_URL}/character/buy-consumable`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id, count, requestId }),
    },
    SHOP_TIMEOUT_MS,
  ))
  return { gold: raw.gold, consumables: readConsumables(raw.consumables), replayed: raw.replayed === true }
}

export type InventoryItem = {
  inventoryItemId: string
  equipped: boolean
  /**
   * Сколько золота даст продажа ЭТОЙ строки. Считает сервер (itemSellPrice,
   * game.ts) — копии формулы на клиенте нет намеренно, иначе кнопка обещала бы
   * не ту сумму, которую начислят.
   * Необязательное: старый сервер поля не присылает, и тогда цена НЕИЗВЕСТНА —
   * кнопка продажи гаснет, а не подставляет ноль.
   */
  sellPrice?: number
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

// --- КНИГИ НАВЫКОВ: надеть / забыть / улучшить / продать ---
//
// Все четыре меняют одно и то же состояние и потому отдают ОДИН ответ целиком
// (см. sendSkillState на сервере): золото, склад расходников, набор навыков и их
// уровни. Клиент мержит все четыре поля разом — иначе после продажи книги шапка с
// золотом или счётчик сумки остались бы с прежними числами.
//
// ⚠️ ПОВТОРОВ НЕТ НИ У ОДНОЙ, и это осознанно: ключа идемпотентности на сервере
// нет, а каждая из трёх списывает книгу — повтор потерянного запроса потратил бы
// ВТОРУЮ. При потерянном ответе клиент не гадает, а просит сверить профиль
// (handleSkillAction в App.tsx), ровно как equipItem выше.
const SKILL_BOOK_TIMEOUT_MS = 5000

/**
 * Состояние после любого действия с книгой. Все четыре поля АБСОЛЮТНЫЕ и
 * перечитаны сервером из БД — считать что-либо из них на клиенте не нужно.
 * `consumables`/`skillLevels` — null, если сервер их не назвал (см. их разборщики).
 */
export type SkillStateResult = {
  gold: number
  consumables: Record<ConsumableId, number> | null
  /** null — сервер не назвал склад страниц (см. readScrolls). */
  scrolls: Record<ScrollId, number> | null
  /** null — сервер не назвал склад предметов классов (см. readClassItems). */
  classItems: Record<ClassItemId, number> | null
  equippedSkills: string[] | null
  skillLevels: Record<SkillBookSkillId, number> | null
}

async function skillBookRequest(path: string, token: string, body: object): Promise<SkillStateResult> {
  const raw = await requestJson<{
    gold: number
    consumables?: unknown
    scrolls?: unknown
    classItems?: unknown
    equippedSkills?: unknown
    skillLevels?: unknown
  }>(
    `${SERVER_URL}${path}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    SKILL_BOOK_TIMEOUT_MS,
  )
  return {
    gold: raw.gold,
    consumables: readConsumables(raw.consumables),
    scrolls: readScrolls(raw.scrolls),
    classItems: readClassItems(raw.classItems),
    equippedSkills: readEquippedSkills(raw.equippedSkills),
    skillLevels: readSkillLevels(raw.skillLevels),
  }
}

/** Надеть навык из книги. Книга УХОДИТ со склада — «забыть» её не вернёт. */
export function equipBook(token: string, id: SkillBookId): Promise<SkillStateResult> {
  return skillBookRequest('/character/equip-book', token, { id })
}

/** Забыть навык: снимается из гнезда, книга не возвращается, уровень остаётся. */
export function forgetSkill(token: string, skillId: SkillBookSkillId): Promise<SkillStateResult> {
  return skillBookRequest('/character/forget-skill', token, { skillId })
}

/** Улучшить навык книгой: книга списывается, уровень +1. Надетость не нужна. */
export function upgradeSkill(token: string, id: SkillBookId): Promise<SkillStateResult> {
  return skillBookRequest('/character/upgrade-skill', token, { id })
}

/** Продать книгу: списывается, золото +цена/10 (consumableSellPrice, каталог). */
export function sellBook(token: string, id: SkillBookId): Promise<SkillStateResult> {
  return skillBookRequest('/character/sell-book', token, { id })
}

// --- СТРАНИЦЫ КНИГ ---
//
// Обе ходят тем же skillBookRequest и возвращают тот же SkillStateResult: они
// меняют ровно те же поля (склад страниц, склад книг, золото), и заводить им
// свой ответ значило бы развести по клиенту два мержа для одного экрана.
// Таймаут и отсутствие повторов — тоже общие: ключа идемпотентности на сервере
// нет, и повтор потерянного запроса потратил бы ВТОРЫЕ страницы.

/** Собрать книгу из SCROLLS_PER_BOOK страниц: страницы списываются, книга в сумку. */
export function assembleBook(token: string, id: ScrollId): Promise<SkillStateResult> {
  return skillBookRequest('/character/assemble-book', token, { id })
}

/** Продать ОДНУ страницу за SCROLL_SELL_PRICE золота. */
export function sellScroll(token: string, id: ScrollId): Promise<SkillStateResult> {
  return skillBookRequest('/character/sell-scroll', token, { id })
}

// --- ПРЕДМЕТЫ КЛАССОВ (18.10.2026) ---
//
// Тем же skillBookRequest и тем же SkillStateResult, что страницы: продажа
// меняет склад и золото, а мерж у клиента один на все ручки сумки. Повторов нет
// по той же причине — ключа идемпотентности на сервере нет, и повтор
// потерянного запроса продал бы вторую штуку.

/** Продать ОДИН Осколок души или ОДНУ Печать отречения; цена — sellPrice каталога. */
export function sellClassItem(token: string, id: ClassItemId): Promise<SkillStateResult> {
  return skillBookRequest('/character/sell-class-item', token, { id })
}

// --- КЛАСС ГЕРОЯ: выбрать / возвыситься / отречься (20.10.2026) ---
//
// Три ручки, один ответ (sendClassState на сервере): золото, склад предметов
// классов и класс — всё перечитано из БД. Таймаут как у книг, ПОВТОРОВ НЕТ:
// ключа идемпотентности у ручек нет, и он им не нужен (повтор упирается в
// условную запись сам — «Класс уже выбран»), но различить «первый прошёл» и «не
// дошёл» повтор не может. При потерянном ответе клиент требует сверку баланса
// (handleClassAction в App.tsx).
//
// Отказ «чего не хватает» — 400 'Requirements not met' с полем lines: причины
// словами игрока, общими строками каталога heroClasses.ts (readClassRefusalLines).

export type ClassStateResult = {
  gold: number
  /** null — сервер не назвал склад предметов классов (см. readClassItems). */
  classItems: Record<ClassItemId, number> | null
  /** null — сервер не назвал класс (см. readHeroClass). */
  heroClass: HeroClassState | null
}

async function heroClassRequest(path: string, token: string, id: HeroClassId): Promise<ClassStateResult> {
  const raw = await requestJson<{ gold: number; classItems?: unknown; heroClass?: unknown }>(
    `${SERVER_URL}${path}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id }),
    },
    SKILL_BOOK_TIMEOUT_MS,
  )
  return {
    gold: raw.gold,
    classItems: readClassItems(raw.classItems),
    heroClass: readHeroClass(raw.heroClass),
  }
}

/** Выбрать класс: уровень 10+, 5 Осколков души, 2000 золота, нужные книги надеты. */
export function chooseClass(token: string, id: HeroClassId): Promise<ClassStateResult> {
  return heroClassRequest('/character/choose-class', token, id)
}

/** Возвыситься до второй ступени своей ветки: уровень 30+, 50 Осколков, 15000 золота. */
export function ascendClass(token: string, id: HeroClassId): Promise<ClassStateResult> {
  return heroClassRequest('/character/ascend-class', token, id)
}

/** Отречься от класса: тратится Печать отречения, класс и ступень пропадают. */
export function renounceClass(token: string, id: HeroClassId): Promise<ClassStateResult> {
  return heroClassRequest('/character/renounce-class', token, id)
}

/**
 * Строки «чего не хватает» из отказа ручки класса (поле lines), либо null — их
 * нет или они не строки. null значит «показать общий текст отказа», а не
 * «ничего не мешает».
 */
export function readClassRefusalLines(body: unknown): string[] | null {
  if (typeof body !== 'object' || body === null) return null
  const lines = (body as { lines?: unknown }).lines
  if (!Array.isArray(lines) || lines.length === 0) return null
  return lines.every((l): l is string => typeof l === 'string') ? lines : null
}

// --- УЛУЧШЕНИЯ И ПРОДАЖА ПРЕДМЕТОВ ---
//
// Обе НЕ идемпотентны и обе БЕЗ ПОВТОРОВ, по той же причине, что покупка зелья:
// повтор потерянного запроса купит второе улучшение или продаст второй предмет.
// При потерянном ответе клиент не гадает, а требует сверки баланса.
const UPGRADE_TIMEOUT_MS = 5000

export type BuyUpgradeResult = {
  gold: number
  /** null — сервер не назвал счётчики (см. readUpgrades). */
  upgrades: UpgradeCounts | null
  /** См. BuyPotionResult.replayed. */
  replayed: boolean
}

/**
 * Купить улучшение. В теле ТОЛЬКО вид: цену считает сервер по своему счётчику,
 * и клиентское число на неё не влияет (иначе цену можно было бы назначить себе).
 */
export async function buyUpgrade(token: string, kind: UpgradeKind): Promise<BuyUpgradeResult> {
  // Ключ идемпотентности — см. keyedPurchase (15.10.2026). Подпись — только
  // вид: цену называет сервер по своему счётчику.
  const raw = await keyedPurchase(`buy-upgrade:${kind}`, (requestId) => requestJson<{ gold: number; upgrades?: unknown; replayed?: unknown }>(
    `${SERVER_URL}/character/buy-upgrade`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, requestId }),
    },
    UPGRADE_TIMEOUT_MS,
  ))
  return { gold: raw.gold, upgrades: readUpgrades(raw.upgrades), replayed: raw.replayed === true }
}

// --- ЛОВЧИЙ (27.10.2026, docs/shop.md, «ЛОВЧИЙ») ---

export type BuyHunterStatResult = {
  /**
   * Статы и уровень ПОСЛЕ покупки — абсолютные, из БД. null — ответ не того
   * вида: покупка прошла, но чисел нет, их надо сверить профилем.
   */
  stats: { strength: number; agility: number; endurance: number; level: number } | null
  hunterBadges: number | null
  /** См. BuyPotionResult.replayed. */
  replayed: boolean
}

/**
 * +1 к стату у Ловчего. В теле ТОЛЬКО стат: цену (10 × сохранённое значение,
 * src/hunter.ts) считает сервер. Ключ идемпотентности — как у закалки
 * (keyedPurchase): после неизвестного исхода следующее нажатие того же стата
 * несёт тот же ключ, и второй раз сервер не спишет. Повторов нет.
 */
export async function buyHunterStat(token: string, stat: HunterStat): Promise<BuyHunterStatResult> {
  const raw = await keyedPurchase(`hunter-stat:${stat}`, (requestId) => requestJson<Record<string, unknown>>(
    `${SERVER_URL}/character/hunter/buy-stat`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ stat, requestId }),
    },
    SHOP_TIMEOUT_MS,
  ))
  const strength = readCurrencyCount(raw.strength)
  const agility = readCurrencyCount(raw.agility)
  const endurance = readCurrencyCount(raw.endurance)
  const level = readCurrencyCount(raw.level)
  return {
    stats: strength !== null && agility !== null && endurance !== null && level !== null ? { strength, agility, endurance, level } : null,
    hunterBadges: readCurrencyCount(raw.hunterBadges),
    replayed: raw.replayed === true,
  }
}

export type SellItemResult = {
  gold: number
  /** Сколько начислено за проданный предмет — для тоста. */
  soldPrice: number
  inventoryItemId: string
}

/** Продать предмет. Надетый сервер не продаст (400 Item is equipped). */
export function sellItem(token: string, inventoryItemId: string): Promise<SellItemResult> {
  return requestJson<SellItemResult>(
    `${SERVER_URL}/character/sell-item`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inventoryItemId }),
    },
    UPGRADE_TIMEOUT_MS,
  )
}
