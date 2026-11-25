// Уведомления бота (13.11.2026): настройки игрока, тихие часы, очередь.
//
// queueNotification только СТАВИТ запись в BotNotification; отправляет её
// GET /cron/tick (bot/cron.ts). Так ручки игры не ждут Telegram, а лимиты
// (25 в секунду, 2 фоновых звона игроку за сутки, «игрок сейчас в игре») решаются в одном месте.
// Ошибка постановки наружу не летит — лог и всё: уведомление никогда не ломает
// ручку, которая его ставит.
import { PrismaClient, Prisma } from '@prisma/client'
import type { FastifyBaseLogger } from 'fastify'
import { botArt, playButton, type Keyboard } from './telegram.js'

const prisma = new PrismaClient()

export const NOTIFY_KINDS = ['energy', 'quests', 'friend_joined', 'friend_reward', 'guild_request', 'guild_accepted', 'guild_declined', 'comeback', 'premium_3d', 'premium_1d', 'premium_end'] as const
export type NotifyKind = typeof NOTIFY_KINDS[number]

/** Шесть переключателей игрока (premium — с 25.11.2026); NULL в базе — все включены. */
export const NOTIFY_SETTING_KEYS = ['energy', 'quests', 'friends', 'guild', 'comeback', 'premium'] as const
export type NotifySettingKey = typeof NOTIFY_SETTING_KEYS[number]
export type NotifySettings = Record<NotifySettingKey, boolean>

export const NOTIFY_SETTING_LABELS: Record<NotifySettingKey, string> = {
  energy: 'Энергия полна',
  quests: 'Новые задания',
  friends: 'Друзья',
  guild: 'Гильдия',
  comeback: 'Убежище ждёт',
  premium: 'Печать Колокола',
}

export const SETTING_OF_KIND: Record<NotifyKind, NotifySettingKey> = {
  energy: 'energy',
  quests: 'quests',
  friend_joined: 'friends',
  friend_reward: 'friends',
  guild_request: 'guild',
  guild_accepted: 'guild',
  guild_declined: 'guild',
  comeback: 'comeback',
  premium_3d: 'premium',
  premium_1d: 'premium',
  premium_end: 'premium',
}

export function parseNotifyKind(raw: unknown): NotifyKind | null {
  return typeof raw === 'string' && (NOTIFY_KINDS as readonly string[]).includes(raw) ? (raw as NotifyKind) : null
}

/** Настройки из колонки: чего нет или не boolean — true (по умолчанию звоним). */
export function readNotifySettings(raw: unknown): NotifySettings {
  const rec = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const out = {} as NotifySettings
  for (const k of NOTIFY_SETTING_KEYS) out[k] = rec[k] === false ? false : true
  return out
}

export function parseNotifySettingKey(raw: unknown): NotifySettingKey | null {
  return typeof raw === 'string' && (NOTIFY_SETTING_KEYS as readonly string[]).includes(raw) ? (raw as NotifySettingKey) : null
}

/**
 * В той же колонке лежит флаг `botStarted` — игрок уже получал приветствие
 * /start (эффект 🔥 — только в первый раз). Запись настроек его сохраняет:
 * `prevRaw` — прежнее значение колонки.
 */
export function notifySettingsJson(s: NotifySettings, prevRaw?: unknown, started?: boolean): Prisma.InputJsonObject {
  const wasStarted = readBotStarted(prevRaw)
  return { ...s, ...(started || wasStarted ? { botStarted: true } : {}) }
}

export function readBotStarted(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as Record<string, unknown>).botStarted === true
}

// --- Тихие часы: 23:00–09:00 МСК (UTC+3, без перехода на летнее время) ---

const MSK_OFFSET_MS = 3 * 3600_000
const QUIET_FROM_H = 23
const QUIET_TO_H = 9

/** Сейчас или, в тихие часы, ближайшие 09:00 МСК. */
export function nextSendTime(now: Date): Date {
  const msk = new Date(now.getTime() + MSK_OFFSET_MS)
  const h = msk.getUTCHours()
  if (h >= QUIET_TO_H && h < QUIET_FROM_H) return now
  const target = new Date(Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate(), QUIET_TO_H, 0, 0))
  if (h >= QUIET_FROM_H) target.setUTCDate(target.getUTCDate() + 1)
  return new Date(target.getTime() - MSK_OFFSET_MS)
}

/**
 * Поставить уведомление. Не ставит, если тип выключен, боту писать нельзя
 * (botAllowed=false) или бот заблокирован. true — поставлено.
 */
export async function queueNotification(
  characterId: number,
  kind: NotifyKind,
  payload?: Prisma.InputJsonObject,
  log?: FastifyBaseLogger,
): Promise<boolean> {
  try {
    const c = await prisma.character.findUnique({
      where: { id: characterId },
      select: { botAllowed: true, botBlocked: true, notifySettings: true },
    })
    if (!c || !c.botAllowed || c.botBlocked) return false
    if (!readNotifySettings(c.notifySettings)[SETTING_OF_KIND[kind]]) return false
    await prisma.botNotification.create({
      data: { characterId, kind, sendAfter: nextSendTime(new Date()), ...(payload ? { payload } : {}) },
    })
    return true
  } catch (e) {
    log?.error({ characterId, kind, err: e }, 'bot: queueNotification failed')
    if (!log) console.error('bot: queueNotification failed', characterId, kind, e)
    return false
  }
}

/** queueNotification для нескольких персонажей разом — без ожидания и без исключений. */
export function queueNotificationMany(ids: number[], kind: NotifyKind, payload?: Prisma.InputJsonObject, log?: FastifyBaseLogger): void {
  for (const id of ids) void queueNotification(id, kind, payload, log)
}

// --- Вид уведомления ---

function guildName(payload: unknown): string {
  const name = payload && typeof payload === 'object' ? (payload as { guildName?: unknown }).guildName : undefined
  return typeof name === 'string' && name.length > 0 ? name : 'гильдия'
}

/**
 * Кнопки уведомления: [⚔️ Играть] [🔕 Не присылать такое]. Нажатие выключает
 * этот тип (callback `no:<настройка>`) и меняет кнопку на «↩️ Вернуть» (`yes:<…>`).
 */
export function notificationKeyboard(setting: NotifySettingKey, muted: boolean): Keyboard {
  // «🏠 В меню» — callback 'm', как «‹ Назад»: карточка уведомления сама
  // становится главной карточкой бота (editMessageMedia, без нового сообщения).
  return [
    [playButton()],
    [
      { text: '🏠 В меню', callback_data: 'm' },
      muted
        ? { text: '↩️ Вернуть', callback_data: `yes:${setting}` }
        : { text: '🔕 Не присылать такое', callback_data: `no:${setting}` },
    ],
  ]
}

/** Картинка и подпись уведомления; null — тип или payload не узнан. */
export function renderNotification(kind: string, payload: unknown): { photo: string; caption: string; keyboard: Keyboard } | null {
  const k = parseNotifyKind(kind)
  if (k === null) return null
  const keyboard = notificationKeyboard(SETTING_OF_KIND[k], false)
  switch (k) {
    case 'energy':
      return { photo: botArt('energy'), caption: '🔥 Силы вернулись. Костёр горит, клинок скучает — руины ждут.', keyboard }
    case 'quests':
      return { photo: botArt('quests'), caption: '📜 На доске Убежища новые заказы. Кто-то хорошо заплатит.', keyboard }
    case 'friend_joined':
      return { photo: botArt('friend'), caption: '👥 Твой зов услышали. В Убежище пришёл новый странник.', keyboard }
    case 'friend_reward':
      return { photo: botArt('friend'), caption: '🎁 Твой странник окреп. Награда ждёт тебя у костра.', keyboard }
    case 'guild_request':
      return { photo: botArt('guild'), caption: `🛡 В ворота «${guildName(payload)}» стучат. Впустить — решать тебе.`, keyboard }
    case 'guild_accepted':
      return { photo: botArt('guild'), caption: `🛡 Ворота «${guildName(payload)}» открылись. Теперь ты свой.`, keyboard }
    case 'guild_declined':
      return { photo: botArt('guild'), caption: `🛡 Ворота «${guildName(payload)}» остались закрыты. Найдутся и другие.`, keyboard }
    case 'comeback': {
      const stage = payload && typeof payload === 'object' ? (payload as { stage?: unknown }).stage : undefined
      const caption = stage === 2 ? '🔔 Последний звон. Дальше — тишина.' : '🔔 Костёр в Убежище почти погас. Твари в руинах уже решили, что ты сдался.'
      return { photo: botArt('comeback'), caption, keyboard }
    }
    // «Печать Колокола» (25.11.2026, docs/premium.md): за 3 дня, за день, угасла.
    case 'premium_3d':
      return { photo: botArt('comeback'), caption: '🔔 Печать Колокола угаснет через 3 дня. Успей забрать своё — трофеи, задания, удачу.', keyboard }
    case 'premium_1d':
      return { photo: botArt('comeback'), caption: '🔔 Последние сутки Печати Колокола. Завтра Убежище снова станет обычным.', keyboard }
    case 'premium_end':
      return { photo: botArt('comeback'), caption: '🔕 Печать Колокола угасла. Вернуть её можно в Убежище.', keyboard }
  }
}
