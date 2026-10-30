// Патрули и элитный враг (30.10.2026, «забег насыщеннее»). ОБЩИЙ каталог
// клиента и сервера: src/runExtras.ts ↔ server/src/runExtras.ts — байт в байт,
// сверяет tools/check_potion_sync.py. Ничего не импортирует, чтобы файл был
// одинаковым с обеих сторон.
//
// Бросает СЕРВЕР (runEvents.ts, на старте забега); клиент читает отсюда силу
// элиты (HP и урон) и правило её трофеев, а офлайн-заглушка — ещё и шансы, чтобы
// бросать вне Telegram теми же числами.

/** Сколько самое большее патрульных за забег (по одному на свободную группу). */
export const PATROLS_PER_RUN = 3

/**
 * Трофеи патрульного — множитель rollTrophies. Доля одного врага из группы:
 * группа даёт ×1.5 на пятерых, 1.5 / 5 = 0.3.
 */
export const TROPHY_MULT_PATROL = 0.3

/**
 * Ближе скольких клеток (по горизонтали, на том же ряду) патрульный не встаёт
 * к точкам события, выпавшего в этот забег: иначе он попадал бы в агро вместе с
 * группой и всегда шёл бы с ней. Не нашлось такой точки — патруля нет.
 */
export const PATROL_EVENT_CLEARANCE = 6

/** Шанс, что в группе события один враг — элитный. Только группы событий. */
export const ELITE_CHANCE = 0.1
/** Элита: HP ×2. */
export const ELITE_HP_MULT = 2
/** Элита: урон ×1.3. */
export const ELITE_DMG_MULT = 1.3
/** Элита стоит столько долей трофеев группы (обычный враг — одну). */
export const ELITE_TROPHY_SHARES = 3

/**
 * Трофеи группы с элитой: обычная сумма плюс (ELITE_TROPHY_SHARES − 1) обычных
 * долей. Доля — floor(суммы / числа врагов), как раскладка по врагам. Всплывашка
 * группы одна, на всю сумму, поэтому клиент показывает ровно это число, а финиш
 * начисляет его же (оно лежит в trophyReward события).
 */
export function eliteGroupTrophies(groupTrophies: number, groupSize: number): number {
  if (groupSize <= 0) return groupTrophies
  return groupTrophies + (ELITE_TROPHY_SHARES - 1) * Math.floor(groupTrophies / groupSize)
}

// --- Рассеянная группа (30.10.2026, исправление «забега насыщеннее») ---
//
// Точки ВСЕХ enemyClusters карты — один общий пул, а не зоны. Группа-событие
// берёт из него GROUP_SIZE точек вразброс по карте; вторая группа и патрульные —
// из того, что осталось. Слот-файлы не менялись: кластеры теперь только
// источник точек и «билеты» в розыгрыше событий (их число — шанс группы).

/** Сколько врагов в группе-событии. */
export const GROUP_SIZE = 5
/** Не больше скольких врагов группы на одном этаже (ряду y), если этажей хватает. */
export const GROUP_FLOOR_CAP = 2
/** Не ближе скольких клеток друг к другу (по прямой) враги группы и патрульные. */
export const GROUP_MIN_GAP = 3
/** Сколько случайных попыток на каждый потолок этажа. */
const SCATTER_TRIES = 200

type TilePoint = [number, number]

function tileGapOk(p: TilePoint, chosen: TilePoint[]): boolean {
  return chosen.every((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) >= GROUP_MIN_GAP)
}

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
 * count точек из пула: случайно, не ближе GROUP_MIN_GAP друг к другу, не больше
 * GROUP_FLOOR_CAP на этаж. Не набирается — потолок этажа растёт на 1 (этажей
 * мало: разными этажами, насколько возможно). Совсем не набирается — лучшее, что
 * нашлось (меньше count). Первая точка ответа — место события (x, y).
 */
export function scatterGroupPoints(pool: TilePoint[], count: number): TilePoint[] {
  let best: TilePoint[] = []
  for (let cap = GROUP_FLOOR_CAP; cap <= Math.max(GROUP_FLOOR_CAP, count); cap++) {
    for (let t = 0; t < SCATTER_TRIES; t++) {
      const chosen: TilePoint[] = []
      const onFloor = new Map<number, number>()
      for (const p of shuffled(pool)) {
        if ((onFloor.get(p[1]) ?? 0) >= cap || !tileGapOk(p, chosen)) continue
        chosen.push(p)
        onFloor.set(p[1], (onFloor.get(p[1]) ?? 0) + 1)
        if (chosen.length === count) return chosen
      }
      if (chosen.length > best.length) best = chosen
    }
  }
  return best
}

/** Точки пула, которых нет в used (сравнение по клетке). */
export function remainingPoints(pool: TilePoint[], used: TilePoint[]): TilePoint[] {
  const taken = new Set(used.map((p) => `${p[0]},${p[1]}`))
  return pool.filter((p) => !taken.has(`${p[0]},${p[1]}`))
}

/**
 * Места патрульных: до PATROLS_PER_RUN точек из оставшихся после групп, каждая
 * не ближе PATROL_EVENT_CLEARANCE клеток (на том же ряду) к точке любого
 * выпавшего события и не ближе GROUP_MIN_GAP к другим патрульным.
 */
export function pickPatrolSpots(remaining: TilePoint[], eventPoints: TilePoint[]): TilePoint[] {
  const clear = (p: TilePoint) =>
    eventPoints.every((q) => q[1] !== p[1] || Math.abs(q[0] - p[0]) >= PATROL_EVENT_CLEARANCE)
  const spots: TilePoint[] = []
  for (const p of shuffled(remaining.filter(clear))) {
    if (!tileGapOk(p, spots)) continue
    spots.push(p)
    if (spots.length === PATROLS_PER_RUN) break
  }
  return spots
}
