// РУНЫ (09.11.2026, docs/items.md, «РУНЫ»). ОБЩИЙ каталог клиента и сервера:
// src/runes.ts ↔ server/src/runes.ts — байт в байт, сверяет
// tools/check_potion_sync.py. Ничего не импортирует, чтобы файл был одинаковым
// с обеих сторон.
//
// Три вида: атака, броня, удача. Падают только с RUNE_DROP_MIN_LEVEL уровня
// героя, отдельным броском за каждое событие «группа врагов» и «босс» (не
// трогает остальную добычу). Бросает СЕРВЕР на старте забега (routes/run.ts,
// attachEventDrops), клиент рисует присланное.
//
// «Получено» (runeXFound) — счётчик всех полученных рун вида; против лимита
// уровня он решает, как часто падает следующая. Использование руны его НЕ
// уменьшает. Руны в инвентаре (runeX) ячейку сумки не занимают.
// «Использовано» (runeXUsed) — сколько рун атаки и брони применено: от него, как
// у закалок (upgrades.ts), считается постоянная прибавка (runeBonus). Удача
// прибавляется прямо к Character.luck, своего счётчика у неё нет.

export const RUNE_KINDS = ['attack', 'armor', 'luck'] as const
export type RuneKind = typeof RUNE_KINDS[number]
export type RuneCounts = Record<RuneKind, number>

/** С какого уровня героя руны падают. Ниже лимит 0 у всех трёх видов. */
export const RUNE_DROP_MIN_LEVEL = 10

/** Шанс за событие при ПУСТОМ прогрессе (ничего не получено от лимита). */
export const RUNE_DROP_CHANCE = 0.03

export type RuneSpec = {
  kind: RuneKind
  nameRu: string
  /** Имя файла в public/assets/icons (128×128). */
  icon: string
  /** Цена использования в значках охотника. */
  price: number
  /** Что даёт одна руна навсегда. */
  step: number
  /** Подпись стата: «+2 к урону». */
  effectLine: string
  /** Цвет полоски прогресса на «Статистике». */
  color: string
}

export const RUNES: Record<RuneKind, RuneSpec> = {
  attack: { kind: 'attack', nameRu: 'Руна атаки', icon: 'rune_attack.png', price: 1000, step: 2, effectLine: '+2 к урону навсегда', color: '#C9433C' },
  armor: { kind: 'armor', nameRu: 'Руна брони', icon: 'rune_armor.png', price: 2000, step: 1, effectLine: '+1 к броне навсегда', color: '#3FB5A8' },
  luck: { kind: 'luck', nameRu: 'Руна удачи', icon: 'rune_luck.png', price: 10000, step: 1, effectLine: '+1 к удаче навсегда', color: '#4FAE4A' },
}

/**
 * Лимит «получено» вида на уровне героя L. При L < RUNE_DROP_MIN_LEVEL — 0.
 * Атака 20 + 2 × (L − 10), броня 10 + (L − 10), удача 5 + floor((L − 10) / 5).
 */
export function runeLimit(kind: RuneKind, level: number): number {
  if (!(level >= RUNE_DROP_MIN_LEVEL)) return 0
  const over = Math.floor(level) - RUNE_DROP_MIN_LEVEL
  switch (kind) {
    case 'attack': return 20 + 2 * over
    case 'armor': return 10 + over
    case 'luck': return 5 + Math.floor(over / 5)
  }
}

/** Свободное место вида: лимит − получено, не меньше 0. */
export function runeFree(kind: RuneKind, level: number, found: RuneCounts): number {
  return Math.max(0, runeLimit(kind, level) - Math.max(0, found[kind]))
}

/**
 * Шанс руны за одно событие: RUNE_DROP_CHANCE × (свободное по трём видам /
 * сумма лимитов). Чем больше получено от лимита, тем реже. Удача героя НЕ влияет.
 */
export function runeDropChance(level: number, found: RuneCounts): number {
  const limitSum = RUNE_KINDS.reduce((s, k) => s + runeLimit(k, level), 0)
  if (limitSum <= 0) return 0
  const freeSum = RUNE_KINDS.reduce((s, k) => s + runeFree(k, level, found), 0)
  return RUNE_DROP_CHANCE * (freeSum / limitSum)
}

/**
 * Бросок руны за одно событие. found — получено ВСЕГО плюс уже выпавшее в этом
 * забеге (вызывающий копит его сам, чтобы не перейти лимит). Сработало — вид с
 * весом свободного места; null — не выпало. random — для проверок.
 */
export function rollRune(level: number, found: RuneCounts, random: () => number = Math.random): RuneKind | null {
  if (!(random() < runeDropChance(level, found))) return null
  const total = RUNE_KINDS.reduce((s, k) => s + runeFree(k, level, found), 0)
  if (total <= 0) return null
  let roll = random() * total
  for (const kind of RUNE_KINDS) {
    const free = runeFree(kind, level, found)
    if (free <= 0) continue
    roll -= free
    if (roll < 0) return kind
  }
  for (let i = RUNE_KINDS.length - 1; i >= 0; i--) {
    if (runeFree(RUNE_KINDS[i], level, found) > 0) return RUNE_KINDS[i]
  }
  return null
}

/** Постоянная прибавка от использованных рун атаки (к урону) или брони (к броне). */
export function runeBonus(kind: 'attack' | 'armor', used: number): number {
  return Math.max(0, used) * RUNES[kind].step
}

/** Вид руны из тела запроса или из сохранённой добычи; не из каталога — null. */
export function parseRuneKind(raw: unknown): RuneKind | null {
  return raw === 'attack' || raw === 'armor' || raw === 'luck' ? raw : null
}

/** Пустые счётчики — общая точка вместо литералов. */
export function emptyRuneCounts(): RuneCounts {
  return { attack: 0, armor: 0, luck: 0 }
}
