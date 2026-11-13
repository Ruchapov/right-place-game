// Вебхук бота @RightPlaceGame_bot (13.11.2026): POST /bot/webhook.
//
// Telegram шлёт сюда message и callback_query (allowed_updates в setWebhook).
// Подлинность — заголовок X-Telegram-Bot-Api-Secret-Token == BOT_WEBHOOK_SECRET;
// без переменной вебхук отвечает 401 всем. Ответ всегда 200 после проверки
// секрета: иначе Telegram повторял бы одно и то же обновление.
//
// ОДНА КАРТОЧКА (13.11.2026, вечер). /start, /play, /notify, /friends и /help
// присылают одну карточку-фото; кнопки меню МЕНЯЮТ её же (editMessageMedia:
// картинка + подпись + кнопки), новых сообщений не шлют. В каждом разделе —
// «‹ Назад» на главный экран. Карточка старше 47 часов или правка не прошла —
// присылается новая. На каждый callback — answerCallbackQuery.
//
// callback_data (латиница, ≤ 64 байт):
//   m | n | f | c | h  [:<параметр>]  — экран: главный, уведомления, друзья, канал, как играть
//   t:<настройка>[:<параметр>]        — переключатель на экране уведомлений
//   off[:<параметр>]                  — «Выключить все»
//   no:<настройка> / yes:<настройка>  — «Не присылать такое» / «Вернуть» под уведомлением
//   notify / help                     — кнопки карточек до 13.11.2026 вечера
// <параметр> — параметр /start (r_<код>, g_<код>): «Играть» везёт его в игру
// на любом экране; длина не больше START_PARAM_MAX, чтобы влез в 64 байта.
//
// Любое сообщение игрока — botAllowed=true, botBlocked=false (он написал сам).
// На обычный текст и файлы — «Я понимаю только кнопки 🙂» и главный экран, не
// чаще раза в 10 минут на игрока. Игроку — понятные слова, детали — в лог.
import type { FastifyInstance, FastifyBaseLogger } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { REFERRAL_GOLD, REFERRAL_LEVEL, REFERRAL_RP, friendState, referralUrl } from '../referral.js'
import { ensureReferralCode } from '../routes/friends.js'
import { calculateLevel } from '../game.js'
import {
  answerCallbackQuery, backButton, botArt, call, CHANNEL_URL, editMessageMedia, editMessageReplyMarkup, FIRE_EFFECT_ID,
  isNotModified, playButton, sendCard, sendMessage, type InlineButton, type Keyboard,
} from './telegram.js'
import {
  NOTIFY_SETTING_KEYS, NOTIFY_SETTING_LABELS, notificationKeyboard, notifySettingsJson, parseNotifySettingKey,
  readBotStarted, readNotifySettings, type NotifySettings,
} from './notify.js'

const prisma = new PrismaClient()

const START_PARAM_MAX = 48
/** Карточку старше этого не правим — шлём новую (Telegram не даёт править старые). */
const CARD_EDIT_MAX_AGE_S = 47 * 3600
const PLAIN_TEXT_REPLY_GAP_MS = 10 * 60_000

type Screen = 'main' | 'notify' | 'friends' | 'channel' | 'help'
const SCREEN_OF_CODE: Record<string, Screen> = { m: 'main', n: 'notify', f: 'friends', c: 'channel', h: 'help' }
const CODE_OF_SCREEN: Record<Screen, string> = { main: 'm', notify: 'n', friends: 'f', channel: 'c', help: 'h' }

const START_CAPTION =
  '🔔 Колокол Убежища звонит для тебя, странник.\n' +
  'Подземелья, болота и боссы ждут. Собирай трофеи, расти героя, зови друзей.'

const NOTIFY_CAPTION = '🔔 О чём звонить Колоколу?\nНочью (23:00–9:00) молчу — всё приходит утром.'

const HELP_CAPTION =
  '📖 Как играть\n' +
  '⚔️ Вылазка — карта с тремя задачами: враги, сундуки, боссы.\n' +
  '💀 Трофеи копятся, но сгорают при смерти — вовремя меняй их на золото.\n' +
  '🏚 В Убежище — зелья, закалки и книги навыков.\n' +
  '📜 С 5 уровня — задания на доске Убежища.\n' +
  '🛡 Гильдии и друзья — вместе сильнее.'

const SHARE_TEXT = 'Пойдём в Right Place: за меня дадут 5000 золота и 100 RP'
const ONLY_BUTTONS_TEXT = 'Я понимаю только кнопки 🙂'
const BROKEN_TEXT = 'Колокол сбился. Попробуй ещё раз через минуту.'

type TgUser = { id: number }
type TgMessage = { message_id: number; date: number; chat: { id: number; type: string }; from?: TgUser; text?: string }
type TgCallback = { id: string; from: TgUser; data?: string; message?: { message_id: number; date: number; chat: { id: number } } }
type TgUpdate = { message?: TgMessage; callback_query?: TgCallback }

type Card = { photo: string; caption: string; keyboard: Keyboard }

/** Кому уже слали первое приветствие, хотя персонажа нет (живёт до перезапуска). */
const greetedWithoutCharacter = new Set<number>()
/** Когда последний раз отвечали на обычный текст. */
const lastPlainReplyAt = new Map<number, number>()

async function playerOf(telegramId: number) {
  return prisma.character.findFirst({
    where: { user: { telegramId: BigInt(telegramId) } },
    select: { id: true, notifySettings: true, channelRewardAt: true },
  })
}

/** Игрок написал боту сам — писать ему можно. */
async function markAllowed(telegramId: number): Promise<void> {
  await prisma.character.updateMany({ where: { user: { telegramId: BigInt(telegramId) } }, data: { botAllowed: true, botBlocked: false } })
}

/** Параметр /start: только безопасные знаки startapp (r_…, g_… и т.п.). */
function startParamOf(text: string): string | null {
  const arg = text.trim().split(/\s+/)[1]
  return cleanParam(arg)
}

function cleanParam(raw: string | undefined): string | null {
  return raw && new RegExp(`^[A-Za-z0-9_-]{1,${START_PARAM_MAX}}$`).test(raw) ? raw : null
}

function nav(screen: Screen, param: string | null): string {
  return param ? `${CODE_OF_SCREEN[screen]}:${param}` : CODE_OF_SCREEN[screen]
}

/** Нижний ряд каждого раздела: [⚔️ Играть] [‹ Назад]. */
function footer(param: string | null): InlineButton[] {
  return [playButton(param), backButton(param)]
}

function notifyKeyboard(s: NotifySettings, param: string | null): Keyboard {
  const suffix = param ? `:${param}` : ''
  const rows: Keyboard = NOTIFY_SETTING_KEYS.map((k) => [{ text: `${s[k] ? '✅' : '❌'} ${NOTIFY_SETTING_LABELS[k]}`, callback_data: `t:${k}${suffix}` }])
  rows.push([{ text: '🔕 Выключить все', style: 'danger', callback_data: `off${suffix}` }])
  rows.push(footer(param))
  return rows
}

async function renderScreen(screen: Screen, telegramId: number, param: string | null): Promise<Card> {
  switch (screen) {
    case 'main':
      return {
        photo: botArt('start'),
        caption: START_CAPTION,
        keyboard: [
          [playButton(param)],
          [{ text: '🔔 Уведомления', callback_data: nav('notify', param) }, { text: '👥 Друзья', callback_data: nav('friends', param) }],
          [{ text: '📣 Канал: +50 RP', style: 'primary', callback_data: nav('channel', param) }, { text: '📖 Как играть', callback_data: nav('help', param) }],
        ],
      }
    case 'notify': {
      const p = await playerOf(telegramId)
      if (!p) return { photo: botArt('energy'), caption: '🔔 Сначала зайди в игру — тогда Колокол узнает, о чём звонить.', keyboard: [footer(param)] }
      return { photo: botArt('energy'), caption: NOTIFY_CAPTION, keyboard: notifyKeyboard(readNotifySettings(p.notifySettings), param) }
    }
    case 'friends': {
      const p = await playerOf(telegramId)
      if (!p) return { photo: botArt('friend'), caption: '👥 Сначала зайди в игру — там появится твоя ссылка для друзей.', keyboard: [footer(param)] }
      const link = referralUrl(await ensureReferralCode(p.id))
      const rows = await prisma.character.findMany({
        where: { invitedById: p.id },
        select: { strength: true, agility: true, endurance: true, bonusLevels: true, inviterClaimedAt: true },
      })
      const waiting = rows.filter((r) => friendState(calculateLevel(r.strength, r.agility, r.endurance, r.bonusLevels), r.inviterClaimedAt !== null) === 'claim').length
      const caption = rows.length === 0
        ? `👥 Ты ещё никого не позвал.\nОтправь ссылку — на ${REFERRAL_LEVEL} уровне друга вам обоим ${REFERRAL_GOLD} золота и ${REFERRAL_RP} RP.`
        : `👥 Позвано странников: ${rows.length}.\n` + (waiting > 0
          ? `Наград ждёт: ${waiting} — забери в игре: Сообщество → Друзья.`
          : `Наград пока нет — они приходят, когда друг дойдёт до ${REFERRAL_LEVEL} уровня.`)
      const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(SHARE_TEXT)}`
      return {
        photo: botArt('friend'),
        caption,
        keyboard: [
          [{ text: '📋 Скопировать ссылку', copy_text: { text: link } }],
          [{ text: '📤 Отправить другу', url: share }],
          footer(param),
        ],
      }
    }
    case 'channel': {
      const p = await playerOf(telegramId)
      const caption = p?.channelRewardAt
        ? '📣 Канал Убежища: новости, новые карты и подарки.\nНаграда за канал получена ✅'
        : '📣 Новости, новые карты и подарки.\nПодпишись и забери 50 RP в игре: Сообщество → Канал.'
      return { photo: botArt('channel'), caption, keyboard: [[{ text: '📣 Открыть канал', url: CHANNEL_URL }], footer(param)] }
    }
    case 'help':
      return { photo: botArt('quests'), caption: HELP_CAPTION, keyboard: [footer(param)] }
  }
}

/**
 * Показать карточку: поправить ту же (если она есть и моложе 47 ч), иначе —
 * прислать новую. Правка «не изменилось» — успех.
 */
async function showCard(chatId: number, card: Card, log: FastifyBaseLogger, existing?: { messageId: number; date: number }, effectId?: string) {
  if (existing && Date.now() / 1000 - existing.date < CARD_EDIT_MAX_AGE_S) {
    const r = await editMessageMedia(chatId, existing.messageId, card.photo, card.caption, card.keyboard)
    if (r.ok || isNotModified(r)) return
    log.warn({ status: r.status, description: r.description }, 'bot: card edit failed, sending a new one')
  }
  const r = await sendCard(chatId, card.photo, card.caption, card.keyboard, effectId)
  if (!r.ok) log.warn({ status: r.status, description: r.description }, 'bot: card send failed')
}

/** /start: главный экран; эффект 🔥 — только при самом первом /start игрока. */
async function handleStart(chatId: number, telegramId: number, param: string | null, log: FastifyBaseLogger) {
  const p = await playerOf(telegramId)
  let first: boolean
  if (p) {
    first = !readBotStarted(p.notifySettings)
    if (first) {
      await prisma.character.update({
        where: { id: p.id },
        data: { notifySettings: notifySettingsJson(readNotifySettings(p.notifySettings), p.notifySettings, true) },
      })
    }
  } else {
    first = !greetedWithoutCharacter.has(telegramId)
    greetedWithoutCharacter.add(telegramId)
  }
  await showCard(chatId, await renderScreen('main', telegramId, param), log, undefined, first ? FIRE_EFFECT_ID : undefined)
}

async function handleMessage(m: TgMessage, log: FastifyBaseLogger) {
  if (m.chat.type !== 'private' || !m.from) return
  await markAllowed(m.from.id)
  const text = typeof m.text === 'string' ? m.text.trim() : ''
  const cmd = text.startsWith('/') ? text.split(/\s+/)[0].split('@')[0].toLowerCase() : null
  switch (cmd) {
    case '/start': return handleStart(m.chat.id, m.from.id, startParamOf(text), log)
    case '/play': return showCard(m.chat.id, await renderScreen('main', m.from.id, null), log)
    case '/notify': return showCard(m.chat.id, await renderScreen('notify', m.from.id, null), log)
    case '/friends': return showCard(m.chat.id, await renderScreen('friends', m.from.id, null), log)
    case '/help': return showCard(m.chat.id, await renderScreen('help', m.from.id, null), log)
  }
  // Обычный текст, файлы, незнакомые команды — короткий ответ и главный экран,
  // не чаще раза в 10 минут: на поток сообщений бот не отвечает потоком.
  const now = Date.now()
  if (now - (lastPlainReplyAt.get(m.from.id) ?? 0) < PLAIN_TEXT_REPLY_GAP_MS) return
  lastPlainReplyAt.set(m.from.id, now)
  const r = await sendMessage(m.chat.id, ONLY_BUTTONS_TEXT)
  if (!r.ok) log.warn({ status: r.status, description: r.description }, 'bot: plain reply failed')
  await showCard(m.chat.id, await renderScreen('main', m.from.id, null), log)
}

/** Поменять одну настройку игрока; null — персонажа нет. */
async function setSetting(telegramId: number, change: (s: NotifySettings) => void): Promise<NotifySettings | null> {
  const p = await playerOf(telegramId)
  if (!p) return null
  const s = readNotifySettings(p.notifySettings)
  change(s)
  await prisma.character.update({ where: { id: p.id }, data: { notifySettings: notifySettingsJson(s, p.notifySettings) } })
  return s
}

async function handleCallback(q: TgCallback, log: FastifyBaseLogger) {
  await markAllowed(q.from.id)
  const data = q.data ?? ''
  const [head, arg1, arg2] = data.split(':')
  const chatId = q.message?.chat.id ?? q.from.id
  const existing = q.message ? { messageId: q.message.message_id, date: q.message.date } : undefined

  // Навигация по экранам карточки (и кнопки старых карточек: notify, help).
  const legacy = head === 'notify' ? 'notify' : head === 'help' ? 'help' : null
  const screen = legacy ?? SCREEN_OF_CODE[head]
  if (screen && (legacy !== null || arg2 === undefined)) {
    await answerCallbackQuery(q.id)
    await showCard(chatId, await renderScreen(screen, q.from.id, legacy ? null : cleanParam(arg1)), log, existing)
    return
  }

  // Переключатели на экране уведомлений: меняются кнопки той же карточки.
  if (head === 't' || head === 'off') {
    const key = head === 't' ? parseNotifySettingKey(arg1) : null
    if (head === 't' && key === null) { await answerCallbackQuery(q.id); return }
    const param = cleanParam(head === 't' ? arg2 : arg1)
    let on = false
    const s = await setSetting(q.from.id, (st) => {
      if (key) { st[key] = !st[key]; on = st[key] } else for (const k of NOTIFY_SETTING_KEYS) st[k] = false
    })
    if (!s) { await answerCallbackQuery(q.id, 'Сначала зайди в игру'); return }
    await answerCallbackQuery(q.id, on ? 'Включено' : 'Выключено')
    if (q.message && Date.now() / 1000 - q.message.date < CARD_EDIT_MAX_AGE_S) {
      const r = await editMessageReplyMarkup(chatId, q.message.message_id, notifyKeyboard(s, param))
      if (r.ok || isNotModified(r)) return
      log.warn({ description: r.description }, 'bot: notify markup edit failed, sending a new card')
    }
    await showCard(chatId, await renderScreen('notify', q.from.id, param), log)
    return
  }

  // «Не присылать такое» / «Вернуть» под уведомлением.
  if (head === 'no' || head === 'yes') {
    const key = parseNotifySettingKey(arg1)
    if (key === null) { await answerCallbackQuery(q.id); return }
    const on = head === 'yes'
    const s = await setSetting(q.from.id, (st) => { st[key] = on })
    if (!s) { await answerCallbackQuery(q.id, 'Сначала зайди в игру'); return }
    await answerCallbackQuery(q.id, on ? 'Включено' : 'Выключено')
    if (q.message) {
      const r = await editMessageReplyMarkup(chatId, q.message.message_id, notificationKeyboard(key, !on))
      if (!r.ok && !isNotModified(r)) log.warn({ description: r.description }, 'bot: notification markup edit failed')
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
      // Детали — в лог; игроку — понятные слова.
      request.log.error({ err: e }, 'bot: webhook update failed')
      try {
        if (update?.callback_query) await answerCallbackQuery(update.callback_query.id, BROKEN_TEXT)
        else if (update?.message?.chat.type === 'private') await sendMessage(update.message.chat.id, BROKEN_TEXT)
      } catch {
        // лучшим усилием
      }
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
        { command: 'friends', description: 'Друзья' },
        { command: 'help', description: 'Как играть' },
      ],
    })
    if (!cmds.ok) log.error({ description: cmds.description }, 'bot: setMyCommands failed')
    if (hook.ok && cmds.ok) log.info('bot: webhook and commands registered')
  } catch (e) {
    log.error({ err: e }, 'bot: webhook registration failed')
  }
}

