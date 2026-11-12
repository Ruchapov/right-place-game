// Бочки и кувшины в забеге (12.11.2026, docs/explore-features.md, «Бочки и
// кувшины»). ОБЩИЙ каталог клиента и сервера: src/breakables.ts ↔
// server/src/breakables.ts — байт в байт, сверяет tools/check_potion_sync.py.
// Ничего не импортирует, чтобы файл был одинаковым с обеих сторон.
//
// Бросает СЕРВЕР на старте забега (runEvents.ts, rollRunBreakables): сколько
// предметов, где, бочка или кувшин и что внутри. Клиент рисует присланное и при
// разбивании показывает выпавшее; на финише называет разбитые индексами
// (brokenBreakables), сервер прибавляет их трофеи. Офлайн-заглушка бросает
// этими же функциями. Это не события: в HUD их нет, на конец забега не влияют.

export type BreakableKind = 'barrel' | 'jar'
export const BREAKABLE_KINDS: readonly BreakableKind[] = ['barrel', 'jar']

/** Что внутри. null у предмета — пусто. */
export type BreakableLoot =
  | { type: 'trophies'; amount: number }
  | { type: 'mana'; amount: number }
  | { type: 'hp'; amount: number }

export type RunBreakable = {
  x: number
  y: number
  kind: BreakableKind
  loot: BreakableLoot | null
}

/** Сколько предметов за забег — случайно в этих пределах (если хватает мест). */
export const BREAKABLES_MIN = 6
export const BREAKABLES_MAX = 8

/** Сколько ударов мечом: кувшин бьётся с одного, бочка — со второго. */
export const BREAKABLE_HITS: Record<BreakableKind, number> = { barrel: 2, jar: 1 }

/** Шанс, что предмет пуст. */
export const BREAKABLE_EMPTY_CHANCE = 0.5

/** Что выпадает из НЕпустого предмета — веса (делятся на сумму). */
export const BREAKABLE_LOOT_WEIGHTS: Record<BreakableKind, Record<BreakableLoot['type'], number>> = {
  barrel: { trophies: 60, mana: 20, hp: 20 },
  jar: { trophies: 20, mana: 40, hp: 40 },
}

/** Трофеи — множитель rollTrophies (как у событий). */
export const TROPHY_MULT_BARREL = 0.15
export const TROPHY_MULT_JAR = 0.1

/** Мана — 1 или 2 (поровну). */
export const BREAKABLE_MANA_MIN = 1
export const BREAKABLE_MANA_MAX = 2

/** Здоровье — доля maxHp забега. */
export const BREAKABLE_HP_FRAC = 0.05

/**
 * HP одного предмета со здоровьем: 5% maxHp забега, вниз, не меньше 1. Вниз —
 * как всё лечение (restoreHp на клиенте округляет вниз). Число считает сервер
 * на старте и отдаёт клиенту готовым; клиент лечит ровно им.
 */
export function breakableHpAmount(maxHp: number): number {
  return Math.max(1, Math.floor(maxHp * BREAKABLE_HP_FRAC))
}

type TilePoint = [number, number]

function shuffled<T>(items: T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const t = out[i]
    out[i] = out[j]
    out[j] = t
  }
  return out
}

/**
 * Места на этот забег: из кандидатов карты (поле breakables слот-файла) — те,
 * что не совпадают с занятыми клетками (события забега, Звёздоцвет,
 * патрульные), случайно BREAKABLES_MIN..BREAKABLES_MAX штук. Мест меньше —
 * сколько есть. Кандидатов нет — пусто, без ошибки.
 */
export function pickBreakableSpots(candidates: TilePoint[], taken: TilePoint[]): TilePoint[] {
  const busy = new Set(taken.map((p) => `${p[0]},${p[1]}`))
  const free = candidates.filter((p) => !busy.has(`${p[0]},${p[1]}`))
  const want = BREAKABLES_MIN + Math.floor(Math.random() * (BREAKABLES_MAX - BREAKABLES_MIN + 1))
  return shuffled(free).slice(0, want)
}

/** Виды на count мест: примерно поровну (нечётное — лишний случайно), вперемешку. */
export function rollBreakableKinds(count: number): BreakableKind[] {
  const barrels = Math.floor(count / 2) + (count % 2 === 1 && Math.random() < 0.5 ? 1 : 0)
  const kinds: BreakableKind[] = []
  for (let i = 0; i < count; i++) kinds.push(i < barrels ? 'barrel' : 'jar')
  return shuffled(kinds)
}

/**
 * Содержимое одного предмета. rollTrophies — та же функция, что у событий
 * (сервер: runEvents.ts, заглушка: explore/rewards.ts); передаётся параметром,
 * чтобы каталог ничего не импортировал.
 */
export function rollBreakableLoot(
  kind: BreakableKind,
  level: number,
  maxHp: number,
  rollTrophies: (multiplier: number, level: number) => number,
): BreakableLoot | null {
  if (Math.random() < BREAKABLE_EMPTY_CHANCE) return null
  const weights = BREAKABLE_LOOT_WEIGHTS[kind]
  const total = weights.trophies + weights.mana + weights.hp
  let roll = Math.random() * total
  roll -= weights.trophies
  if (roll < 0) {
    return { type: 'trophies', amount: rollTrophies(kind === 'barrel' ? TROPHY_MULT_BARREL : TROPHY_MULT_JAR, level) }
  }
  roll -= weights.mana
  if (roll < 0) {
    return { type: 'mana', amount: BREAKABLE_MANA_MIN + Math.floor(Math.random() * (BREAKABLE_MANA_MAX - BREAKABLE_MANA_MIN + 1)) }
  }
  return { type: 'hp', amount: breakableHpAmount(maxHp) }
}

/** Весь бросок: места, виды, содержимое. */
export function rollBreakables(
  candidates: TilePoint[],
  taken: TilePoint[],
  level: number,
  maxHp: number,
  rollTrophies: (multiplier: number, level: number) => number,
): RunBreakable[] {
  const spots = pickBreakableSpots(candidates, taken)
  const kinds = rollBreakableKinds(spots.length)
  return spots.map(([x, y], i) => ({ x, y, kind: kinds[i], loot: rollBreakableLoot(kinds[i], level, maxHp, rollTrophies) }))
}

/**
 * Разбор одного предмета (ответ старта на клиенте, currentRun на сервере).
 * Любое отклонение — null: предмет с непонятным содержимым не показывается и
 * не начисляется.
 */
export function parseBreakable(raw: unknown): RunBreakable | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const { x, y, kind, loot } = raw as Record<string, unknown>
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null
  if (kind !== 'barrel' && kind !== 'jar') return null
  if (loot === null) return { x: x as number, y: y as number, kind, loot: null }
  if (typeof loot !== 'object' || Array.isArray(loot)) return null
  const { type, amount } = loot as Record<string, unknown>
  if (type !== 'trophies' && type !== 'mana' && type !== 'hp') return null
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0) return null
  return { x: x as number, y: y as number, kind, loot: { type, amount } }
}

/** Сумма HP и маны всех предметов забега — запас в потолках роста статов и заданий. */
export function breakablesReserve(list: readonly RunBreakable[]): { hp: number; mana: number } {
  let hp = 0
  let mana = 0
  for (const b of list) {
    if (b.loot?.type === 'hp') hp += b.loot.amount
    if (b.loot?.type === 'mana') mana += b.loot.amount
  }
  return { hp, mana }
}
