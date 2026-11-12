// Уведомления бота (13.11.2026): настройки игрока, тихие часы, очередь.
//
// queueNotification только СТАВИТ запись в BotNotification; отправляет её
// GET /cron/tick (bot/cron.ts). Так ручки игры не ждут Telegram, а лимиты
// (25 в секунду, 3 игроку за сутки, «игрок сейчас в игре») решаются в одном месте.
// Ошибка постановки наружу не летит — лог и всё: уведомление никогда не ломает
// ручку, которая его ставит.
import { PrismaClient, Prisma } from '@prisma/client'
import type { FastifyBaseLogger } from 'fastify'
import { botArt, playButton, settingsButton, type Keyboard } from './telegram.js'

const prisma = new PrismaClient()

export const NOTIFY_KINDS = ['energy', 'quests', 'friend_joined', 'friend_reward', 'guild_request', 'guild_accepted', 'guild_declined', 'comeback'] as const
export type NotifyKind = typeof NOTIFY_KINDS[number]

/** Пять переключателей игрока; NULL в базе — все включены. */
export const NOTIFY_SETTING_KEYS = ['energy', 'quests', 'friends', 'guild', 'comeback'] as const
export type NotifySettingKey = typeof NOTIFY_SETTING_KEYS[number]
export type NotifySettings = Record<NotifySettingKey, boolean>

export const NOTIFY_SETTING_LABELS: Record<NotifySettingKey, string> = {
  energy: 'Энергия полна',
  quests: 'Новые задания',
  friends: 'Друзья',
  guild: 'Гильдия',
  comeback: 'Убежище ждёт',
}

const SETTING_OF_KIND: Record<NotifyKind, NotifySettingKey> = {
  energy: 'energy',
  quests: 'quests',
  friend_joined: 'friends',
  friend_reward: 'friends',
  guild_request: 'guild',
  guild_accepted: 'guild',
  guild_declined: 'guild',
  comeback: 'comeback',
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

export function notifySettingsJson(s: NotifySettings): Prisma.InputJsonObject {
  return { ...s }
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

/** Картинка и подпись уведомления; null — тип или payload не узнан. */
export function renderNotification(kind: string, payload: unknown): { photo: string; caption: string; keyboard: Keyboard } | null {
  const keyboard: Keyboard = [[playButton(), settingsButton]]
  const k = parseNotifyKind(kind)
  if (k === null) return null
  switch (k) {
    case 'energy':
      return { photo: botArt('energy'), caption: '🔔 Энергия полна: 100/100. Костёр горит, вылазка ждёт.', keyboard }
    case 'quests':
      return { photo: botArt('quests'), caption: '🔔 На доске Убежища новые задания.', keyboard }
    case 'friend_joined':
      return { photo: botArt('friend'), caption: '🔔 По твоему зову в Убежище пришёл новый странник. Когда он дойдёт до 3 уровня, вас обоих ждёт награда.', keyboard }
    case 'friend_reward':
      return { photo: botArt('friend'), caption: '🔔 Твой друг окреп — забери 5000 золота и 100 RP в «Сообщество → Друзья».', keyboard }
    case 'guild_request':
      return { photo: botArt('guild'), caption: `🔔 В гильдию «${guildName(payload)}» постучался странник. Заявка ждёт решения.`, keyboard }
    case 'guild_accepted':
      return { photo: botArt('guild'), caption: `🔔 Гильдия «${guildName(payload)}» приняла тебя.`, keyboard }
    case 'guild_declined':
      return { photo: botArt('guild'), caption: `🔔 Гильдия «${guildName(payload)}» отклонила заявку.`, keyboard }
    case 'comeback': {
      const stage = payload && typeof payload === 'object' ? (payload as { stage?: unknown }).stage : undefined
      const caption = stage === 2 ? '🔔 Последний звон: Убежище всё ещё ждёт.' : '🔔 Колокол звонит в пустом Убежище. Без тебя здесь тихо.'
      return { photo: botArt('comeback'), caption, keyboard }
    }
  }
}
