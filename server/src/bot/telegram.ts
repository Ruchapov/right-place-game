// Bot API @RightPlaceGame_bot (13.11.2026) — голый fetch, без пакетов.
//
// call() — один метод Bot API. 429 — ждём retry_after и повторяем ОДИН раз.
// 403 (бот заблокирован, чат удалён) — помечаем персонажа botBlocked=true:
// дальше очередь ему ничего не шлёт, пока он сам не напишет боту.
// Ошибки наружу — результатом { ok:false }, не исключением: бот — лучшее
// усилие, и ни одна ручка игры от него падать не должна.
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/** Адрес картинок бота (public/bot/ на GitHub Pages). */
export const BOT_ART_URL = 'https://ruchapov.github.io/right-place-game/bot'
export const GAME_WEB_URL = 'https://ruchapov.github.io/right-place-game/'
export const GAME_LINK = 'https://t.me/RightPlaceGame_bot/game'
export const CHANNEL_USERNAME = '@rightplace_news'
export const CHANNEL_URL = 'https://t.me/rightplace_news'
/** Эффект 🔥 у приветствия (message_effect_id). */
export const FIRE_EFFECT_ID = '5104841245755180586'

export function botArt(name: string): string {
  return `${BOT_ART_URL}/${name}.jpg`
}

/** Кнопка инлайн-клавиатуры; style — Bot API 9.4 (success / primary / danger). */
export type InlineButton = {
  text: string
  style?: 'success' | 'primary' | 'danger'
  url?: string
  web_app?: { url: string }
  callback_data?: string
}
export type Keyboard = InlineButton[][]

export type CallResult<T = unknown> =
  | { ok: true; result: T }
  | { ok: false; status: number; description: string }

const CALL_TIMEOUT_MS = 10_000

async function callOnce(method: string, body: Record<string, unknown>): Promise<{ status: number; json: any }> {
  const token = process.env.BOT_TOKEN
  if (!token) return { status: 0, json: { ok: false, description: 'BOT_TOKEN is not set' } }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), CALL_TIMEOUT_MS)
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

export async function call<T = unknown>(method: string, body: Record<string, unknown>): Promise<CallResult<T>> {
  let { status, json } = await callOnce(method, body)
  if (status === 429) {
    const wait = Number(json?.parameters?.retry_after)
    await new Promise((r) => setTimeout(r, (Number.isFinite(wait) && wait > 0 ? Math.min(wait, 30) : 1) * 1000))
    ;({ status, json } = await callOnce(method, body))
  }
  if (json?.ok === true) return { ok: true, result: json.result as T }
  if (status === 403) await markBlocked(body.chat_id)
  return { ok: false, status, description: String(json?.description ?? 'unknown error') }
}

export function sendPhoto(chatId: number | string, photoUrl: string, caption: string, keyboard?: Keyboard, effectId?: string) {
  return call('sendPhoto', {
    chat_id: chatId,
    photo: photoUrl,
    caption,
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    ...(effectId ? { message_effect_id: effectId } : {}),
  })
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
export const newsButton: InlineButton = { text: '📣 Новости: +50 RP', style: 'primary', url: CHANNEL_URL }
export const settingsButton: InlineButton = { text: '⚙️ Уведомления', callback_data: 'notify' }
