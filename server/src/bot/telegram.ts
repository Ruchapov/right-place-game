// Bot API @RightPlaceGame_bot (13.11.2026) — голый fetch, без пакетов.
//
// call() — один метод Bot API. 429 — ждём retry_after и повторяем ОДИН раз.
// 403 (бот заблокирован, чат удалён) — помечаем персонажа botBlocked=true:
// дальше очередь ему ничего не шлёт, пока он сам не напишет боту.
// Ошибки наружу — результатом { ok:false }, не исключением: бот — лучшее
// усилие, и ни одна ручка игры от него падать не должна.
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/** Адрес картинок бота (public/bot/ на сайте игры, rightplace-game.ru).
 *  С 25.11.2026 его можно подменить переменной BOT_ART_URL: Telegram качает фото
 *  по ссылке сам, а до московского сервера не достаёт — ходим через посредника
 *  на Cloudflare (tools/tg-proxy, путь /art). Читается при вызове, а не при
 *  загрузке модуля: dotenv в index.ts срабатывает позже импортов. */
export const BOT_ART_URL = 'https://rightplace-game.ru/bot'
const botArtBase = () => (process.env.BOT_ART_URL || BOT_ART_URL).replace(/\/+$/, '')
/** База Bot API: TELEGRAM_API_BASE (посредник …/tg) или сам Telegram. */
const telegramApiBase = () => (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '')
export const GAME_WEB_URL = 'https://rightplace-game.ru/'
export const GAME_LINK = 'https://t.me/RightPlaceGame_bot/game'
export const CHANNEL_USERNAME = '@rightplace_news'
export const CHANNEL_URL = 'https://t.me/rightplace_news'
// Общий чат игроков (22.11.2026): публичная группа, она же обсуждение канала.
export const CHAT_URL = 'https://t.me/rightplace_chat'
/** Эффект 🔥 у приветствия (message_effect_id). */
export const FIRE_EFFECT_ID = '5104841245755180586'

export function botArt(name: string): string {
  return `${botArtBase()}/${name}.jpg`
}

/** Кнопка инлайн-клавиатуры; style — Bot API 9.4 (success / primary / danger). */
export type InlineButton = {
  text: string
  style?: 'success' | 'primary' | 'danger'
  url?: string
  web_app?: { url: string }
  callback_data?: string
  /** Bot API 7.11: кнопка кладёт текст в буфер обмена. */
  copy_text?: { text: string }
}
export type Keyboard = InlineButton[][]

export type CallResult<T = unknown> =
  | { ok: true; result: T }
  | { ok: false; status: number; description: string }

const CALL_TIMEOUT_MS = 10_000

async function callOnce(method: string, body: Record<string, unknown>, form?: FormData): Promise<{ status: number; json: any }> {
  const token = process.env.BOT_TOKEN
  if (!token) return { status: 0, json: { ok: false, description: 'BOT_TOKEN is not set' } }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), CALL_TIMEOUT_MS)
  try {
    // с файлом — multipart (Content-Type с границей ставит сам fetch), иначе JSON
    const headers: Record<string, string> = form ? {} : { 'Content-Type': 'application/json' }
    // ключ посредника (tools/tg-proxy): без него воркер отвечает 403
    if (process.env.PROXY_KEY) headers['X-Proxy-Key'] = process.env.PROXY_KEY
    const res = await fetch(`${telegramApiBase()}/bot${token}/${method}`, {
      method: 'POST',
      headers,
      body: form ?? JSON.stringify(body),
      signal: ctrl.signal,
    })
    const json = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }))
    return { status: res.status, json }
  } catch (e) {
    return { status: 0, json: { ok: false, description: e instanceof Error ? e.message : String(e) } }
  } finally {
    clearTimeout(timer)
  }
}

/** Чат, который бот не может писать (403), — персонаж этого telegramId. */
async function markBlocked(chatId: unknown): Promise<void> {
  if (typeof chatId !== 'number' && typeof chatId !== 'string') return
  if (typeof chatId === 'string' && !/^\d+$/.test(chatId)) return // канал (@имя) — не игрок
  try {
    await prisma.character.updateMany({ where: { user: { telegramId: BigInt(chatId) } }, data: { botBlocked: true } })
  } catch {
    // лучшим усилием
  }
}

export async function call<T = unknown>(method: string, body: Record<string, unknown>, form?: () => FormData): Promise<CallResult<T>> {
  let { status, json } = await callOnce(method, body, form?.())
  if (status === 429) {
    const wait = Number(json?.parameters?.retry_after)
    await new Promise((r) => setTimeout(r, (Number.isFinite(wait) && wait > 0 ? Math.min(wait, 30) : 1) * 1000))
    ;({ status, json } = await callOnce(method, body, form?.()))
  }
  if (json?.ok === true) return { ok: true, result: json.result as T }
  if (status === 403) await markBlocked(body.chat_id)
  return { ok: false, status, description: String(json?.description ?? 'unknown error') }
}

// --- Картинки бота файлом, а не ссылкой (25.11.2026) ---
//
// Telegram качает фото по ссылке сам, а до московского сервера не достаёт (и с
// адресов workers.dev тоже не качает — проверено). Поэтому картинку сервер
// скачивает со своего же сайта и загружает в Telegram файлом; из ответа берётся
// file_id, и дальше эта картинка уходит одним номером, без загрузки. Кэш — в
// памяти: после перезапуска первая отправка каждой картинки снова загрузит её.
// Не вышло скачать — по-старому, ссылкой (а там sendCard откатится на текст).
const photoFileIds = new Map<string, string>()
const photoBytes = new Map<string, Blob>()

async function artBlob(photoUrl: string): Promise<Blob | null> {
  const cached = photoBytes.get(photoUrl)
  if (cached) return cached
  if (!/^https?:\/\//.test(photoUrl)) return null // уже file_id
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), CALL_TIMEOUT_MS)
    const res = await fetch(photoUrl, { signal: ctrl.signal }).finally(() => clearTimeout(timer))
    if (!res.ok) return null
    const blob = new Blob([await res.arrayBuffer()], { type: res.headers.get('Content-Type') || 'image/jpeg' })
    photoBytes.set(photoUrl, blob)
    return blob
  } catch {
    return null
  }
}

function rememberFileId(photoUrl: string, result: unknown): void {
  const sizes = (result as { photo?: { file_id?: unknown }[] } | null)?.photo
  const id = Array.isArray(sizes) ? sizes[sizes.length - 1]?.file_id : undefined
  if (typeof id === 'string' && id) photoFileIds.set(photoUrl, id)
}

/** JSON-поля вызова → поля multipart (объекты — строкой JSON, как требует Bot API). */
function formOf(fields: Record<string, unknown>, file: Blob, fileField: string): FormData {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue
    form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
  }
  form.append(fileField, file, `${fileField}.jpg`)
  return form
}

export async function sendPhoto(chatId: number | string, photoUrl: string, caption: string, keyboard?: Keyboard, effectId?: string) {
  const fields: Record<string, unknown> = {
    chat_id: chatId,
    caption,
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    ...(effectId ? { message_effect_id: effectId } : {}),
  }
  const known = photoFileIds.get(photoUrl)
  if (known) return call('sendPhoto', { ...fields, photo: known })
  const blob = await artBlob(photoUrl)
  if (!blob) return call('sendPhoto', { ...fields, photo: photoUrl })
  const r = await call('sendPhoto', fields, () => formOf(fields, blob, 'photo'))
  if (r.ok) rememberFileId(photoUrl, r.result)
  return r
}

/**
 * Карточка: фото с подписью, а если Telegram не смог взять картинку (её ещё нет
 * на Pages, адрес отдал не картинку) — тот же текст и кнопки сообщением.
 * Иначе пропавший файл молча глушил бы все звонки до истечения очереди.
 */
export async function sendCard(chatId: number | string, photoUrl: string, caption: string, keyboard?: Keyboard, effectId?: string): Promise<CallResult> {
  const r = await sendPhoto(chatId, photoUrl, caption, keyboard, effectId)
  if (r.ok || r.status !== 400 || !/wrong (file identifier|type of the web page content)|failed to get http url content|photo/i.test(r.description)) return r
  console.warn('bot: sendPhoto failed, falling back to text', photoUrl, r.description)
  return call('sendMessage', {
    chat_id: chatId,
    text: caption,
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    ...(effectId ? { message_effect_id: effectId } : {}),
  })
}

export function sendMessage(chatId: number | string, text: string, keyboard?: Keyboard) {
  return call('sendMessage', {
    chat_id: chatId,
    text,
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  })
}

export function editMessageReplyMarkup(chatId: number | string, messageId: number, keyboard: Keyboard) {
  return call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: keyboard } })
}

/** Заменить картинку, подпись и кнопки у той же карточки. */
export async function editMessageMedia(chatId: number | string, messageId: number, photoUrl: string, caption: string, keyboard: Keyboard) {
  const base = { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: keyboard } }
  const known = photoFileIds.get(photoUrl)
  const blob = known ? null : await artBlob(photoUrl)
  if (!blob) {
    return call('editMessageMedia', { ...base, media: { type: 'photo', media: known ?? photoUrl, caption } })
  }
  const fields = { ...base, media: { type: 'photo', media: 'attach://photo', caption } }
  const r = await call('editMessageMedia', fields, () => formOf(fields, blob, 'photo'))
  if (r.ok) rememberFileId(photoUrl, r.result)
  return r
}

/** «message is not modified» — то же состояние, не ошибка. */
export function isNotModified(r: CallResult): boolean {
  return !r.ok && /not modified/i.test(r.description)
}

export function answerCallbackQuery(callbackQueryId: string, text?: string) {
  return call('answerCallbackQuery', { callback_query_id: callbackQueryId, ...(text ? { text } : {}) })
}

export function getChatMember(chatId: number | string, userId: number | bigint) {
  return call<{ status: string }>('getChatMember', { chat_id: chatId, user_id: Number(userId) })
}

// --- Кнопки ---

/** «⚔️ Играть»: без параметра — сама Mini App, с параметром — ссылка startapp. */
export function playButton(startParam?: string | null): InlineButton {
  if (startParam) return { text: '⚔️ Играть', style: 'success', url: `${GAME_LINK}?startapp=${encodeURIComponent(startParam)}` }
  return { text: '⚔️ Играть', style: 'success', web_app: { url: GAME_WEB_URL } }
}
/** «‹ Назад» — на главный экран карточки. */
export function backButton(startParam?: string | null): InlineButton {
  return { text: '‹ Назад', callback_data: startParam ? `m:${startParam}` : 'm' }
}
