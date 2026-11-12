// Вебхук бота @RightPlaceGame_bot (13.11.2026): POST /bot/webhook.
//
// Telegram шлёт сюда message и callback_query (allowed_updates в setWebhook).
// Подлинность — заголовок X-Telegram-Bot-Api-Secret-Token == BOT_WEBHOOK_SECRET;
// без переменной вебхук отвечает 401 всем. Ответ всегда 200 после проверки
// секрета: иначе Telegram повторял бы одно и то же обновление.
//
// Любое сообщение игрока — botAllowed=true, botBlocked=false (он написал сам —
// значит, писать ему можно). На обычный текст и файлы бот НЕ отвечает: только
// команды /start /play /notify /help и кнопки.
import type { FastifyInstance, FastifyBaseLogger } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { referralUrl } from '../referral.js'
import { ensureReferralCode } from '../routes/friends.js'
import {
  answerCallbackQuery, botArt, call, editMessageReplyMarkup, FIRE_EFFECT_ID, GAME_LINK, newsButton, playButton,
  sendCard, sendMessage, type InlineButton, type Keyboard,
} from './telegram.js'
import { NOTIFY_SETTING_KEYS, NOTIFY_SETTING_LABELS, notifySettingsJson, readNotifySettings, type NotifySettingKey, type NotifySettings } from './notify.js'

const prisma = new PrismaClient()

const START_CAPTION =
  '🔔 Колокол Убежища звонит для тебя, странник.\n\n' +
  'Впереди подземелья, болота и боссы. Собирай трофеи, расти героя, вступай в гильдию.\n\n' +
  'Я позову, когда энергия полна и на доске новые задания.'

const NOTIFY_TEXT = '🔔 О чём звонить Колоколу? Ночью (23:00–9:00) молчу, всё приходит утром.'

const HELP_TEXT =
  '📖 Как играть в Right Place\n\n' +
  '⚔️ Вылазки — карта с тремя событиями: враги, сундуки, боссы. Энергия тратится на старт.\n' +
  '💀 Трофеи копятся между вылазками, но сгорают при смерти — меняй их на золото вовремя.\n' +
  '🏚 Убежище — Торговец, Кузнец, Отшельник и Ловчий: зелья, закалки, книги навыков, статы.\n' +
  '📜 Задания — доска в Убежище с 5 уровня: награда золотом, значками и RP.\n' +
  '🛡 Гильдии — казна, здания, молитвы алтаря и общий склад.\n' +
  '👥 Друзья — позови друга: на 3 уровне вам обоим 5000 золота и 100 RP.'

const SHARE_TEXT = 'Пойдём в Right Place: за меня дадут 5000 золота и 100 RP'

type TgUser = { id: number }
type TgMessage = { message_id: number; chat: { id: number; type: string }; from?: TgUser; text?: string }
type TgCallback = { id: string; from: TgUser; data?: string; message?: { message_id: number; chat: { id: number } } }
type TgUpdate = { message?: TgMessage; callback_query?: TgCallback }

async function characterOf(telegramId: number) {
  return prisma.character.findFirst({ where: { user: { telegramId: BigInt(telegramId) } }, select: { id: true, notifySettings: true } })
}

/** Игрок написал боту сам — писать ему можно. */
async function markAllowed(telegramId: number): Promise<void> {
  await prisma.character.updateMany({ where: { user: { telegramId: BigInt(telegramId) } }, data: { botAllowed: true, botBlocked: false } })
}

async function inviteButton(telegramId: number): Promise<InlineButton> {
  let link = GAME_LINK
  const c = await characterOf(telegramId)
  if (c) link = referralUrl(await ensureReferralCode(c.id))
  const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(SHARE_TEXT)}`
  return { text: '👥 Позвать друга', url }
}

function notifyKeyboard(s: NotifySettings): Keyboard {
  const rows: Keyboard = NOTIFY_SETTING_KEYS.map((k) => [{ text: `${s[k] ? '✅' : '❌'} ${NOTIFY_SETTING_LABELS[k]}`, callback_data: `t:${k}` }])
  rows.push([{ text: '🔕 Выключить все', style: 'danger', callback_data: 'off' }])
  return rows
}

/** Параметр /start: только безопасные знаки startapp (r_…, g_… и т.п.). */
function startParamOf(text: string): string | null {
  const arg = text.trim().split(/\s+/)[1]
  return arg && /^[A-Za-z0-9_-]{1,64}$/.test(arg) ? arg : null
}

async function sendStart(chatId: number, telegramId: number, param: string | null) {
  const keyboard: Keyboard = [
    [playButton(param)],
    [newsButton, await inviteButton(telegramId)],
    [{ text: '🔔 Уведомления', callback_data: 'notify' }, { text: '📖 Как играть', callback_data: 'help' }],
  ]
  return sendCard(chatId, botArt('start'), START_CAPTION, keyboard, FIRE_EFFECT_ID)
}

async function sendNotifyMenu(chatId: number, telegramId: number) {
  const c = await characterOf(telegramId)
  if (!c) return sendMessage(chatId, 'Сначала зайди в игру — тогда Колокол узнает, о чём звонить.', [[playButton()]])
  return sendMessage(chatId, NOTIFY_TEXT, notifyKeyboard(readNotifySettings(c.notifySettings)))
}

async function handleMessage(m: TgMessage, log: FastifyBaseLogger) {
  if (m.chat.type !== 'private' || !m.from) return
  await markAllowed(m.from.id)
  const text = m.text
  if (typeof text !== 'string' || !text.startsWith('/')) return // обычный текст и файлы — молчим
  const cmd = text.trim().split(/\s+/)[0].split('@')[0].toLowerCase()
  let r
  switch (cmd) {
    case '/start': r = await sendStart(m.chat.id, m.from.id, startParamOf(text)); break
    case '/play': r = await sendMessage(m.chat.id, '⚔️ Вылазка ждёт.', [[playButton()]]); break
    case '/notify': r = await sendNotifyMenu(m.chat.id, m.from.id); break
    case '/help': r = await sendMessage(m.chat.id, HELP_TEXT, [[playButton()]]); break
    default: return
  }
  if (!r.ok) log.warn({ cmd, status: r.status, description: r.description }, 'bot: reply failed')
}

async function handleCallback(q: TgCallback, log: FastifyBaseLogger) {
  await markAllowed(q.from.id)
  const data = q.data ?? ''
  const chatId = q.message?.chat.id
  if (data === 'notify') {
    await answerCallbackQuery(q.id)
    if (chatId !== undefined) await sendNotifyMenu(chatId, q.from.id)
    return
  }
  if (data === 'help') {
    await answerCallbackQuery(q.id)
    if (chatId !== undefined) await sendMessage(chatId, HELP_TEXT, [[playButton()]])
    return
  }
  if (data === 'off' || data.startsWith('t:')) {
    const c = await characterOf(q.from.id)
    if (!c) { await answerCallbackQuery(q.id, 'Сначала зайди в игру'); return }
    const s = readNotifySettings(c.notifySettings)
    let toast: string
    if (data === 'off') {
      for (const k of NOTIFY_SETTING_KEYS) s[k] = false
      toast = '🔕 Колокол молчит'
    } else {
      const key = data.slice(2) as NotifySettingKey
      if (!(NOTIFY_SETTING_KEYS as readonly string[]).includes(key)) { await answerCallbackQuery(q.id); return }
      s[key] = !s[key]
      toast = `${NOTIFY_SETTING_LABELS[key]}: ${s[key] ? 'включено' : 'выключено'}`
    }
    await prisma.character.update({ where: { id: c.id }, data: { notifySettings: notifySettingsJson(s) } })
    await answerCallbackQuery(q.id, toast)
    if (q.message) {
      const r = await editMessageReplyMarkup(q.message.chat.id, q.message.message_id, notifyKeyboard(s))
      // «message is not modified» — то же состояние, не ошибка
      if (!r.ok && !r.description.includes('not modified')) log.warn({ description: r.description }, 'bot: edit markup failed')
    }
    return
  }
  await answerCallbackQuery(q.id)
}

export async function botWebhookRoutes(server: FastifyInstance) {
  server.post<{ Body: TgUpdate }>('/bot/webhook', async (request, reply) => {
    const secret = process.env.BOT_WEBHOOK_SECRET
    if (!secret || request.headers['x-telegram-bot-api-secret-token'] !== secret) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }
    const update = request.body
    try {
      if (update?.message) await handleMessage(update.message, request.log)
      else if (update?.callback_query) await handleCallback(update.callback_query, request.log)
    } catch (e) {
      request.log.error({ err: e }, 'bot: webhook update failed')
    }
    return reply.send({ ok: true })
  })
}

/** При старте сервера: вебхук и меню команд. Ошибки — только в лог. */
export async function registerBotWebhook(log: FastifyBaseLogger): Promise<void> {
  const publicUrl = process.env.PUBLIC_URL
  if (!publicUrl) { log.info('bot: PUBLIC_URL is not set, webhook not registered'); return }
  const secret = process.env.BOT_WEBHOOK_SECRET
  if (!secret) { log.error('bot: BOT_WEBHOOK_SECRET is not set, webhook not registered'); return }
  try {
    const hook = await call('setWebhook', {
      url: `${publicUrl.replace(/\/+$/, '')}/bot/webhook`,
      secret_token: secret,
      allowed_updates: ['message', 'callback_query'],
    })
    if (!hook.ok) log.error({ description: hook.description }, 'bot: setWebhook failed')
    const cmds = await call('setMyCommands', {
      commands: [
        { command: 'start', description: 'Колокол Убежища' },
        { command: 'play', description: 'Играть' },
        { command: 'notify', description: 'Уведомления' },
        { command: 'help', description: 'Как играть' },
      ],
    })
    if (!cmds.ok) log.error({ description: cmds.description }, 'bot: setMyCommands failed')
    if (hook.ok && cmds.ok) log.info('bot: webhook and commands registered')
  } catch (e) {
    log.error({ err: e }, 'bot: webhook registration failed')
  }
}
