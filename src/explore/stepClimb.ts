import * as C from './constants'
import { cellFootBlockTop, isSolid, sweepFootBlock } from './collision'
import type { Grid } from './types'

// СТУПЕНЬ В ОДНУ КЛЕТКУ (13.11.2026, проверка на телефоне): враги упирались в
// ступень высотой в клетку как в стену, а сойти со ступени на клетку вниз не
// могли (у новых врагов allowDrop запрещал sameTier). Враги НИКОГДА не прыгают
// (решение Андрея) — они идут по ступени, как по лестнице:
//   • подъём: впереди твердь ТОЛЬКО в нижней клетке, над ней свободно на весь
//     рост — тело сразу встаёт на ступень (физика), а картинка догоняет его за
//     STEP_LIFT_MS (stepLiftPx — смещение спрайта вниз, гаснет к нулю), ноги
//     продолжают шагать. Выше клетки — стена, как раньше.
//   • спуск: пола впереди нет, но он ровно на клетку ниже — шаг разрешён всегда
//     (и в патруле: обратно он тоже поднимется), дальше гравитация. Глубже
//     клетки — край по прежним правилам модуля.
// Одни функции на все модули врагов: зверь, Звонарь, Привратник, новые враги.

/** За сколько картинка догоняет тело на ступени, мс. */
export const STEP_LIFT_MS = 135

type Body = { x: number; y: number; width: number; height: number; vy: number; stepLiftPx?: number }

/** Твердь впереди по трём точкам (верх, середина, ноги) — прежняя проверка стены. */
function solidAhead(grid: Grid, e: Body, leadingX: number): boolean {
  return isSolid(grid, C.TILE_SIZE, leadingX, e.y + 1)
    || isSolid(grid, C.TILE_SIZE, leadingX, e.y + e.height / 2)
    || isSolid(grid, C.TILE_SIZE, leadingX, e.y + e.height - 1)
}

/**
 * Новый верх тела, если впереди ступень в одну клетку, на которую можно встать;
 * иначе null. Только с земли (vy === 0).
 */
export function stepUpY(grid: Grid, e: Body, leadingX: number): number | null {
  if (e.vy !== 0) return null
  const T = C.TILE_SIZE
  const feet = e.y + e.height
  if (!isSolid(grid, T, leadingX, feet - 1)) return null
  const stepTop = Math.floor((feet - 1) / T) * T
  if (feet - stepTop > T) return null
  const newY = stepTop - e.height
  // Над ступенью свободно на весь рост — и впереди, и над самим телом.
  for (const y of [stepTop - 1, stepTop - e.height / 2, newY + 1]) {
    if (isSolid(grid, T, leadingX, y)) return null
  }
  for (const x of [e.x + 1, e.x + e.width / 2, e.x + e.width - 1]) {
    if (isSolid(grid, T, x, newY + 1)) return null
  }
  return newY
}

/** Стена впереди — с учётом ступени: на неё можно подняться, значит не стена. */
export function wallAhead(grid: Grid, e: Body, leadingX: number): boolean {
  return solidAhead(grid, e, leadingX) && stepUpY(grid, e, leadingX) === null
}

/** Пола впереди нет, но он ровно на клетку ниже — сойти можно всегда. */
export function stepDownOk(grid: Grid, leadingX: number, feetY: number): boolean {
  const T = C.TILE_SIZE
  const cx = Math.floor(leadingX / T)
  const cy = Math.floor(feetY / T)
  return cellFootBlockTop(grid, T, cx, cy) === null && cellFootBlockTop(grid, T, cx, cy + 1) !== null
}

/**
 * Шаг сделан — если впереди ступень, тело встаёт на неё, а картинка остаётся
 * внизу и догоняет (stepLiftPx). Зовётся там, где модуль двигает x.
 */
export function climbStep(grid: Grid, e: Body, leadingX: number): void {
  if (!solidAhead(grid, e, leadingX)) return
  const newY = stepUpY(grid, e, leadingX)
  if (newY === null) return
  e.stepLiftPx = (e.stepLiftPx ?? 0) + (e.y - newY)
  e.y = newY
  e.vy = 0
}

/**
 * Смещение картинки гаснет к нулю за STEP_LIFT_MS (зовётся каждый тик).
 * Положительное — после подъёма (картинка ниже тела), отрицательное — после
 * спуска (картинка выше тела, 17.11.2026).
 */
export function decayStepLift(e: Body, deltaMS: number): void {
  if (!e.stepLiftPx) return
  const d = (C.TILE_SIZE * deltaMS) / STEP_LIFT_MS
  e.stepLiftPx = e.stepLiftPx > 0 ? Math.max(0, e.stepLiftPx - d) : Math.min(0, e.stepLiftPx + d)
}

/**
 * Гравитация врага со СПУСКОМ НА КЛЕТКУ ШАГОМ (17.11.2026, правки по телефону).
 * Замер s60: сходя со ступени, враг ПАДАЛ с нулевой скорости — 17 тиков
 * (≈280 мс) с ускорением, и это читалось как «заторможенно». Теперь: стоял на
 * земле (vy 0), опоры под всем телом нет, а пол ровно на клетку ниже — тело
 * сразу встаёт на него, картинка остаётся вверху (stepLiftPx = −клетка) и
 * опускается за STEP_LIFT_MS, как на подъёме. Глубже клетки или уже в полёте —
 * обычное падение. Одна функция на все модули врагов.
 */
export function enemyGravity(grid: Grid, e: Body, dt: number): void {
  const T = C.TILE_SIZE
  const feet = e.y + e.height
  if (e.vy === 0 && sweepFootBlock(grid, T, e.x, e.width, feet, feet + 1) === null) {
    const below = sweepFootBlock(grid, T, e.x, e.width, feet, feet + T + 1)
    if (below !== null && Math.abs(below - (feet + T)) < 0.5) {
      e.y += T
      e.stepLiftPx = (e.stepLiftPx ?? 0) - T
      return
    }
  }
  e.vy = Math.min(e.vy + C.GRAVITY * dt, C.MAX_FALL)
  const prevFootY = feet
  e.y += e.vy * dt
  const blockTop = sweepFootBlock(grid, T, e.x, e.width, prevFootY, e.y + e.height)
  if (blockTop !== null) {
    e.y = blockTop - e.height
    e.vy = 0
  }
}

/**
 * Есть ли впереди по полу (в сторону dir, не дальше maxTiles клеток) ступень в
 * клетку, на которую можно подняться (17.11.2026). Идёт по клеткам пола: стена
 * выше клетки, яма или спуск — «нет». Нужна зверю: герой выше — раньше он шёл
 * по ступени, только если она ПРЯМО перед ним, а иначе стоял и ждал (замер
 * s60: 0 px/с за 4.5 с в 7 клетках от лестницы).
 */
export function stepUpAhead(grid: Grid, e: Body, dir: 1 | -1, maxTiles: number): boolean {
  const T = C.TILE_SIZE
  const feet = e.y + e.height
  const lead = dir > 0 ? e.x + e.width : e.x
  const startCx = Math.floor((dir > 0 ? lead + 1 : lead - 1) / T)
  for (let k = 0; k <= maxTiles; k++) {
    const cx = startCx + dir * k
    const px = cx * T + T / 2
    if (isSolid(grid, T, px, feet - 1)) {
      // Твердь на уровне ног — ступень, если тело, вставшее вплотную, может на неё подняться.
      const at: Body = { x: dir > 0 ? cx * T - e.width - 0.5 : (cx + 1) * T + 0.5, y: e.y, width: e.width, height: e.height, vy: 0 }
      return stepUpY(grid, at, dir > 0 ? cx * T + 0.5 : (cx + 1) * T - 0.5) !== null
    }
    // Пола под клеткой нет — яма или спуск: к герою выше этот путь не ведёт.
    if (cellFootBlockTop(grid, T, cx, Math.floor(feet / T)) === null) return false
  }
  return false
}
