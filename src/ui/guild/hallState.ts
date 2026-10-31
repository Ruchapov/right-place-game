// Состояние зданий для Зала и карточки здания (01.11.2026): что можно сделать
// сейчас и сколько ждать. Правила — те же, что были у вкладки «Здания».
import { guildBuffPctAt, guildCauldronYield, guildLibraryCostsElite, type GuildPrayer } from '../../guild'
import type { GuildMemberState } from '../../api'

export type BuildingAction = {
  /** Можно нажать прямо сейчас (без учёта идущего запроса). */
  ready: boolean
  /** Сколько ждать, мс; 0 — не ждать. */
  leftMs: number
  /** Казна пуста, а действие берёт из неё элитный трофей. */
  treasuryBlocked: boolean
}

function elapsed(me: GuildMemberState, now: number): number {
  return now - me.at
}

export function cauldronAction(me: GuildMemberState, now: number): BuildingAction {
  const lvl = me.guild.buildings.cauldron
  const leftMs = Math.max(0, me.me.cauldronInMs - elapsed(me, now))
  const needsElite = guildCauldronYield(lvl)?.costsElite ?? true
  const treasuryBlocked = needsElite && me.guild.eliteTrophies < 1
  return { ready: lvl > 0 && leftMs <= 0 && !treasuryBlocked, leftMs, treasuryBlocked }
}

export function libraryAction(me: GuildMemberState, now: number): BuildingAction {
  const lvl = me.guild.buildings.library
  const leftMs = Math.max(0, me.me.libraryInMs - elapsed(me, now))
  const treasuryBlocked = guildLibraryCostsElite(lvl) && me.guild.eliteTrophies < 1
  return { ready: lvl > 0 && leftMs <= 0 && !treasuryBlocked, leftMs, treasuryBlocked }
}

export type PrayerState = { prayer: GuildPrayer; active: boolean; pct: number; leftMs: number }

export function prayerState(me: GuildMemberState, prayer: GuildPrayer, now: number): PrayerState {
  const b = me.me.buffs[prayer]
  const pct = guildBuffPctAt(b.pct, b.untilMs, now)
  return { prayer, active: pct > 0, pct, leftMs: b.untilMs === null ? 0 : Math.max(0, b.untilMs - now) }
}

export const PRAYERS: GuildPrayer[] = ['attack', 'armor']
export const PRAYER_ICON: Record<GuildPrayer, string> = { attack: 'buff_attack.png', armor: 'buff_armor.png' }
export const PRAYER_LABEL: Record<GuildPrayer, string> = { attack: 'Молитва силы', armor: 'Молитва брони' }
