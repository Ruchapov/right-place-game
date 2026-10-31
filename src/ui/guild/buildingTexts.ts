// Тексты зданий гильдии (01.11.2026). Один текст на уровень — им пишутся и
// блок «Сейчас» (текущий уровень), и плашка улучшения (следующий). Числа — из
// общего каталога src/guild.ts; сам каталог не трогаем (парный файл сервера).
import {
  GUILD_PRAYER_CRIT_PCT, GUILD_PRAYER_PCT, guildBooksFreeInStorage, guildCauldronYield, guildLibraryCostsElite,
  guildMemberCap, guildPrayerCritChance, guildStorageCapacity, type GuildBuilding,
} from '../../guild'

/** Склонение по числу: 1 место / 2 места / 5 мест. */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a >= 11 && a <= 14) return many
  if (b === 1) return one
  if (b >= 2 && b <= 4) return few
  return many
}

/** Имя здания на экране гильдии (уровень гильдии — «Ратуша»). */
export const BUILDING_NAME: Record<GuildBuilding, string> = {
  level: 'Ратуша', storage: 'Склад', cauldron: 'Котёл', library: 'Библиотека', altar: 'Алтарь',
}

export const BUILDING_ICON: Record<GuildBuilding, string> = {
  level: 'building_hall.png', storage: 'building_storage.png', cauldron: 'building_cauldron.png',
  library: 'building_library.png', altar: 'building_altar.png',
}

/** Что здание даёт на уровне `level` — только итог этого уровня. */
export function buildingLevelText(building: GuildBuilding, level: number): string {
  switch (building) {
    case 'level': {
      const n = guildMemberCap(level)
      return `В гильдии ${n} ${plural(n, 'место', 'места', 'мест')}.`
    }
    case 'storage': {
      const n = guildStorageCapacity(level)
      return `На складе ${n} ${plural(n, 'место', 'места', 'мест')} для предметов.`
    }
    case 'cauldron': {
      const y = guildCauldronYield(level)
      if (y === null) {
        console.error(`buildingLevelText: у котла нет уровня ${level}`)
        return ''
      }
      const potions = `${y.potions} ${plural(y.potions, 'зелье', 'зелья', 'зелий')} своего тира`
      const reflect = y.reflect > 0 ? ` и ${y.reflect} ${plural(y.reflect, 'зелье', 'зелья', 'зелий')} отражения` : ''
      const price = y.costsElite ? ' За это из казны берётся 1 элитный трофей.' : ' Бесплатно, казна не тратится.'
      return `Каждый участник гильдии раз в 16 часов получает ${potions}${reflect}.${price}`
    }
    case 'library':
      return 'Каждый участник гильдии раз в 16 часов получает случайную книгу навыка.'
        + (guildLibraryCostsElite(level) ? ' За это из казны берётся 1 элитный трофей.' : ' Книга бесплатная, казна не тратится.')
        + (guildBooksFreeInStorage(level) ? ' Книги на складе не занимают места.' : '')
    case 'altar': {
      const p = Math.round(guildPrayerCritChance(level) * 100)
      return `Молитва силы: +${GUILD_PRAYER_PCT}% к урону без силы на 2 часа. Молитва брони: +${GUILD_PRAYER_PCT}% к броне на 2 часа. `
        + `С шансом ${p}% молитва выходит сильной и даёт +${GUILD_PRAYER_CRIT_PCT}%.`
    }
  }
}

/** «7 ч 12 м» / «12 м» / «40 с» — сколько ждать. */
export function fmtLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h} ч ${m} м`
  if (m > 0) return `${m} м`
  return `${s} с`
}

/** «в сети» / «был 2 ч назад» / «был вчера» / «был 3 дня назад». */
export function seenText(lastSeenAt: number | null, now: number): string {
  if (lastSeenAt === null) return 'давно не заходил'
  const diff = now - lastSeenAt
  if (diff <= ONLINE_MS) return 'в сети'
  const min = Math.floor(diff / 60_000)
  if (min < 60) return `был ${min} мин назад`
  const h = Math.floor(min / 60)
  if (h < 24) return `был ${h} ч назад`
  const d = Math.floor(h / 24)
  if (d === 1) return 'был вчера'
  return `был ${d} ${plural(d, 'день', 'дня', 'дней')} назад`
}

/** «В сети» — заходил не раньше пяти минут назад. */
export const ONLINE_MS = 5 * 60_000

export function isOnline(lastSeenAt: number | null, now: number): boolean {
  return lastSeenAt !== null && now - lastSeenAt <= ONLINE_MS
}
