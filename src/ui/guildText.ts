// Тексты и мелкие вычисления экрана гильдии (30.10.2026, docs/guilds.md) —
// отдельным модулем: GuildPanel.tsx отдаёт только компоненты (fast refresh).
import { GUILD_CREATE_RP, guildBuffPctAt } from '../guild'
import { RequestError, type GuildMe } from '../api'

/** Мм:сс или Чч мм из миллисекунд — для таймеров кулдауна. */
export function fmtWait(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}ч ${String(m).padStart(2, '0')}м`
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

/** Число красиво: 250 000. */
export function fmt(n: number): string {
  return n.toLocaleString('ru-RU')
}

/** Понятный текст отказа сервера. */
export function guildErrorText(e: unknown): string {
  if (e instanceof RequestError) {
    if (e.retryable) return 'Ответ не пришёл. Нажми ещё раз — повтор не спишет дважды.'
    const body = (e.body ?? {}) as { retryInMs?: unknown; cap?: unknown; need?: unknown }
    const wait = typeof body.retryInMs === 'number' ? ` (${fmtWait(body.retryInMs)})` : ''
    switch (e.serverError) {
      case 'Not enough RP': return `Не хватает RP — нужно ${GUILD_CREATE_RP}.`
      case 'Invalid name': return 'Название — 3–20 букв или цифр.'
      case 'Invalid tag': return 'Тег — 2–5 букв или цифр.'
      case 'Name taken': return 'Такое название уже занято.'
      case 'Tag taken': return 'Такой тег уже занят.'
      case 'Already in a guild': return 'Ты уже в гильдии.'
      case 'Rejoin cooldown': return `Вступить можно позже${wait}.`
      case 'Guild is full': return 'В гильдии нет мест.'
      case 'Guild is not open': return 'Гильдия не открытая.'
      case 'Guild does not take requests': return 'Гильдия не принимает заявки.'
      case 'Request already sent': return 'Заявка уже подана.'
      case 'Not in a guild': return 'Ты не в гильдии.'
      case 'Not allowed for your role': return 'Это может только глава или заместитель.'
      case 'Leader must transfer first': return 'Сначала передай главенство.'
      case 'Leader must disband': return 'Ты один — гильдию можно только распустить.'
      case 'Guild is not empty': return 'Распустить можно, только когда в гильдии никого, кроме тебя.'
      case 'Too many deputies': return 'Заместителей уже трое.'
      case 'Not enough funds': return 'Столько у тебя нет.'
      case 'Invalid amount': return 'Введи целое число больше нуля.'
      case 'Nothing to donate': return 'Введи, сколько сдать.'
      case 'Not enough in treasury': return 'В казне не хватает.'
      case 'Max level': return 'Уже наивысший уровень.'
      case 'Storage is full': return 'Склад гильдии полон.'
      case 'Not in storage': return 'На складе этого уже нет.'
      case 'Not enough in stock': return 'У тебя этого нет.'
      case 'Does not take a cell': return 'Класть можно только то, что занимает место в сумке.'
      case 'Item is equipped': return 'Сначала сними предмет.'
      case 'Bag is full': return 'Сумка полна — освободи место.'
      case 'Treasury empty': return 'Казна пуста — сдайте элитный трофей.'
      case 'Cooldown': return `Ещё рано${wait}.`
      case 'Cauldron closed': return 'Котёл ещё не открыт.'
      case 'Library closed': return 'Библиотека ещё не открыта.'
      case 'Altar closed': return 'Алтарь ещё не открыт.'
      case 'Prayer active': return `Молитва ещё действует${wait}.`
      case 'Too fast': return 'Не так быстро.'
      case 'Guild not found': return 'Гильдия не найдена.'
      case 'State changed, retry': return 'Что-то изменилось — попробуй ещё раз.'
    }
    return e.serverError ?? `Ошибка ${e.status ?? ''}`
  }
  return 'Что-то пошло не так.'
}

/** Есть ли сейчас хоть одна действующая молитва (для обёртки вокруг иконок). */
export function hasActiveGuildBuff(me: GuildMe | null, now: number): boolean {
  if (me === null || me.kind !== 'member') return false
  return guildBuffPctAt(me.me.buffs.attack.pct, me.me.buffs.attack.untilMs, now) > 0
    || guildBuffPctAt(me.me.buffs.armor.pct, me.me.buffs.armor.untilMs, now) > 0
}

