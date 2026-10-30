// Гильдии — общий каталог правил и цен (30.10.2026, docs/guilds.md).
//
// ⚠️ Файл обязан совпадать БАЙТ В БАЙТ с server/src/guild.ts — сверяет
// tools/check_potion_sync.py. Здесь только числа и чистые функции: сервер по
// ним списывает и проверяет, клиент по ним же рисует витрину зданий и цены.
// Импортов нет намеренно (копии в двух проектах с разными путями).

// --- Создание, вступление, роли ---

/** Сколько RP стоит создать гильдию. Списывается у создателя атомарно. */
export const GUILD_CREATE_RP = 1500

export const GUILD_NAME_MIN = 3
export const GUILD_NAME_MAX = 20
export const GUILD_TAG_MIN = 2
export const GUILD_TAG_MAX = 5

/**
 * Название гильдии: буквы (кириллица и латиница), цифры, пробел, дефис,
 * апостроф; пробелы по краям срезаются, внутри — не больше одного подряд.
 * null — не годится.
 */
export function parseGuildName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.trim().replace(/\s+/g, ' ')
  if (name.length < GUILD_NAME_MIN || name.length > GUILD_NAME_MAX) return null
  if (!/^[A-Za-zА-Яа-яЁё0-9 '-]+$/.test(name)) return null
  return name
}

/** Тег: 2–5 букв или цифр, приводится к верхнему регистру. null — не годится. */
export function parseGuildTag(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const tag = raw.trim().toUpperCase()
  if (tag.length < GUILD_TAG_MIN || tag.length > GUILD_TAG_MAX) return null
  if (!/^[A-ZА-ЯЁ0-9]+$/.test(tag)) return null
  return tag
}

/**
 * Ключ уникальности и поиска названия — нижний регистр в JS (кириллица
 * складывается верно, в отличие от ILIKE Postgres с локалью C). Колонка
 * Guild.nameKey с уникальным индексом.
 */
export function guildNameKey(name: string): string {
  return name.toLowerCase()
}

export const GUILD_JOIN_MODES = ['open', 'request', 'closed'] as const
export type GuildJoinMode = typeof GUILD_JOIN_MODES[number]

export function parseGuildJoinMode(raw: unknown): GuildJoinMode | null {
  return (GUILD_JOIN_MODES as readonly unknown[]).includes(raw) ? raw as GuildJoinMode : null
}

export const GUILD_JOIN_MODE_LABEL: Record<GuildJoinMode, string> = {
  open: 'Открытая',
  request: 'По заявке',
  closed: 'Закрытая',
}

export const GUILD_ROLES = ['leader', 'deputy', 'member'] as const
export type GuildRole = typeof GUILD_ROLES[number]

export function parseGuildRole(raw: unknown): GuildRole | null {
  return (GUILD_ROLES as readonly unknown[]).includes(raw) ? raw as GuildRole : null
}

export const GUILD_ROLE_LABEL: Record<GuildRole, string> = {
  leader: 'Глава',
  deputy: 'Заместитель',
  member: 'Участник',
}

/** Заместителей у гильдии не больше трёх. */
export const GUILD_MAX_DEPUTIES = 3

/** После выхода или исключения вступить куда-либо можно только через 24 ч. */
export const GUILD_REJOIN_COOLDOWN_MS = 24 * 60 * 60 * 1000

/**
 * Глава, не входивший в игру 14 дней, теряет главенство при любом запросе к
 * гильдии: оно переходит заместителю с самым свежим входом, нет заместителей —
 * участнику с самым свежим входом.
 */
export const GUILD_LEADER_INACTIVE_MS = 14 * 24 * 60 * 60 * 1000

/** Мест в гильдии: 10 на первом уровне, +1 за каждый следующий (на 25-м — 34). */
export function guildMemberCap(level: number): number {
  return 9 + level
}

// --- Здания и их цены ---

export const GUILD_BUILDINGS = ['level', 'storage', 'cauldron', 'library', 'altar'] as const
export type GuildBuilding = typeof GUILD_BUILDINGS[number]

export function parseGuildBuilding(raw: unknown): GuildBuilding | null {
  return (GUILD_BUILDINGS as readonly unknown[]).includes(raw) ? raw as GuildBuilding : null
}

export const GUILD_BUILDING_LABEL: Record<GuildBuilding, string> = {
  level: 'Уровень гильдии',
  storage: 'Склад',
  cauldron: 'Котёл',
  library: 'Библиотека',
  altar: 'Молитвенный алтарь',
}

/** Наибольший уровень каждого здания. У котла, библиотеки и алтаря 0 — закрыто. */
export const GUILD_BUILDING_MAX: Record<GuildBuilding, number> = {
  level: 25,
  storage: 15,
  cauldron: 5,
  library: 3,
  altar: 5,
}

/** С какого уровня здание стоит у новой гильдии. */
export const GUILD_BUILDING_START: Record<GuildBuilding, number> = {
  level: 1,
  storage: 1,
  cauldron: 0,
  library: 0,
  altar: 0,
}

export type GuildCost = { gold: number; eliteTrophies: number }

/**
 * Цена перехода здания с уровня `current` на следующий, или null — уже
 * максимум (или уровень вне диапазона). Все числа — здесь; подкручивать здесь.
 *   уровень гильдии k→k+1: k×100 000 + k×300;
 *   склад k→k+1: 20 000 + 10 000×(k−1) и 100 + 50×(k−1);
 *   котёл →n: n×100 000 + n×300 (открыть — как →1);
 *   библиотека →n: так же, до 3;
 *   алтарь: открыть 250 000 + 1000, дальше →n: (n−1)×100 000 + (n−1)×300.
 */
export function guildUpgradeCost(building: GuildBuilding, current: number): GuildCost | null {
  if (!Number.isInteger(current) || current < GUILD_BUILDING_START[building] || current >= GUILD_BUILDING_MAX[building]) {
    return null
  }
  const next = current + 1
  switch (building) {
    case 'level':
      return { gold: current * 100_000, eliteTrophies: current * 300 }
    case 'storage':
      return { gold: 20_000 + 10_000 * (current - 1), eliteTrophies: 100 + 50 * (current - 1) }
    case 'cauldron':
    case 'library':
      return { gold: next * 100_000, eliteTrophies: next * 300 }
    case 'altar':
      return next === 1
        ? { gold: 250_000, eliteTrophies: 1000 }
        : { gold: (next - 1) * 100_000, eliteTrophies: (next - 1) * 300 }
  }
}

/** Мест на складе: 100 на первом уровне, +20 за каждый следующий (на 15-м — 380). */
export function guildStorageCapacity(storageLevel: number): number {
  return 100 + 20 * (storageLevel - 1)
}

// --- Склад ---

export const GUILD_STORAGE_KINDS = ['item', 'consumable', 'classItem', 'scroll'] as const
export type GuildStorageKind = typeof GUILD_STORAGE_KINDS[number]

export function parseGuildStorageKind(raw: unknown): GuildStorageKind | null {
  return (GUILD_STORAGE_KINDS as readonly unknown[]).includes(raw) ? raw as GuildStorageKind : null
}

/** Сколько штук за раз можно положить или взять (защита от мусора в теле). */
export const GUILD_STORAGE_MAX_PER_ACTION = 999

/**
 * Библиотека со 2 уровня: книги навыков на складе гильдии мест НЕ занимают.
 * Книга — kind 'consumable' с id book_*.
 */
export function guildBooksFreeInStorage(libraryLevel: number): boolean {
  return libraryLevel >= 2
}

// --- Котёл и библиотека ---

/** Кулдаун котла и библиотеки на игрока — 16 часов. */
export const GUILD_CAULDRON_COOLDOWN_MS = 16 * 60 * 60 * 1000
export const GUILD_LIBRARY_COOLDOWN_MS = 16 * 60 * 60 * 1000

/**
 * Что даёт один черпак котла уровня `level` (1..5): зелий своего тира, зелий
 * отражения и списывается ли из казны элитный трофей.
 */
export function guildCauldronYield(level: number): { potions: number; reflect: number; costsElite: boolean } | null {
  switch (level) {
    case 1: return { potions: 1, reflect: 0, costsElite: true }
    case 2: return { potions: 2, reflect: 0, costsElite: true }
    case 3: return { potions: 3, reflect: 0, costsElite: true }
    case 4: return { potions: 3, reflect: 1, costsElite: true }
    case 5: return { potions: 3, reflect: 1, costsElite: false }
    default: return null
  }
}

/** Библиотека уровня 1–2 берёт из казны элитный трофей за книгу, 3 — бесплатно. */
export function guildLibraryCostsElite(level: number): boolean {
  return level < 3
}

// --- Молитвенный алтарь ---

export const GUILD_PRAYERS = ['attack', 'armor'] as const
export type GuildPrayer = typeof GUILD_PRAYERS[number]

export function parseGuildPrayer(raw: unknown): GuildPrayer | null {
  return (GUILD_PRAYERS as readonly unknown[]).includes(raw) ? raw as GuildPrayer : null
}

export const GUILD_PRAYER_LABEL: Record<GuildPrayer, string> = {
  attack: 'Молитва силы',
  armor: 'Молитва брони',
}

/** Бафф молитвы действует 2 часа реального времени. */
export const GUILD_PRAYER_DURATION_MS = 2 * 60 * 60 * 1000
/** Обычная молитва — +15%, критическая — +25%. */
export const GUILD_PRAYER_PCT = 15
export const GUILD_PRAYER_CRIT_PCT = 25

/** Шанс критической молитвы по уровню алтаря (1..5): 15/20/25/30/35%. */
export function guildPrayerCritChance(altarLevel: number): number {
  if (!Number.isInteger(altarLevel) || altarLevel < 1 || altarLevel > GUILD_BUILDING_MAX.altar) return 0
  return 0.10 + 0.05 * altarLevel
}

/**
 * Процент баффа, если он ещё действует в момент `now` (мс), иначе 0. Читает обе
 * стороны: сервер — на старте забега, клиент — для иконок с таймером.
 * Мусорный процент (не целое, вне 0..25) — 0.
 */
export function guildBuffPctAt(pct: number, untilMs: number | null, now: number): number {
  if (untilMs === null || !(untilMs > now)) return 0
  if (!Number.isInteger(pct) || pct < 0 || pct > GUILD_PRAYER_CRIT_PCT) return 0
  return pct
}

// --- Чат ---

export const GUILD_CHAT_MAX_LEN = 200
/** Не чаще одного сообщения в 2 секунды на игрока. */
export const GUILD_CHAT_COOLDOWN_MS = 2000
/** Сколько последних сообщений хранится на гильдию. */
export const GUILD_CHAT_KEEP = 200
/** Как часто клиент опрашивает чат, пока открыт экран гильдии. */
export const GUILD_CHAT_POLL_MS = 4500

// --- Герб ---

export const GUILD_EMBLEM_BG_COUNT = 2
export const GUILD_EMBLEM_FRAME_COUNT = 4
export const GUILD_EMBLEM_SYMBOL_COUNT = 6
/** Палитра цвета фона герба — 8 цветов, номер цвета хранится в emblemColor. */
export const GUILD_EMBLEM_COLORS = ['#7a1f1f', '#8a5a1a', '#5f6b1e', '#1f5b3a', '#1d4f6e', '#2e2f6b', '#5a2366', '#3a3a3a'] as const

export type GuildEmblem = { symbol: number; frame: number; bg: number; color: number }

/** Герб из тела запроса: четыре целых в своих диапазонах, иначе null. */
export function parseGuildEmblem(raw: unknown): GuildEmblem | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const inRange = (v: unknown, n: number): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < n
  if (!inRange(r.symbol, GUILD_EMBLEM_SYMBOL_COUNT)) return null
  if (!inRange(r.frame, GUILD_EMBLEM_FRAME_COUNT)) return null
  if (!inRange(r.bg, GUILD_EMBLEM_BG_COUNT)) return null
  if (!inRange(r.color, GUILD_EMBLEM_COLORS.length)) return null
  return { symbol: r.symbol, frame: r.frame, bg: r.bg, color: r.color }
}

// --- Приглашение ---

/** Префикс start_param ссылки-приглашения: startapp=g_<inviteCode>. */
export const GUILD_INVITE_PREFIX = 'g_'

export function guildInviteUrl(inviteCode: string): string {
  return `https://t.me/RightPlaceGame_bot/game?startapp=${GUILD_INVITE_PREFIX}${inviteCode}`
}

/** Код приглашения: 8–32 знака [A-Za-z0-9]. null — не код. */
export function parseGuildInviteCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  return /^[A-Za-z0-9]{8,32}$/.test(raw) ? raw : null
}

// --- Взнос в казну ---

/** Потолок одного взноса — защита от переполнения Int в казне. */
export const GUILD_DONATE_MAX = 100_000_000

/** Сумма взноса: целое 1..GUILD_DONATE_MAX, иначе null (0, минус, дробь — отказ). */
export function parseGuildAmount(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > GUILD_DONATE_MAX) return null
  return raw
}

// --- Элитный трофей ---

/** Сколько элитных трофеев даёт одно закрытое событие с элитным врагом. */
export const ELITE_TROPHIES_PER_ELITE_EVENT = 1
