import * as C from './constants'
import { cellFootBlockTop, isSolid } from './collision'
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

/** Смещение картинки гаснет к нулю за STEP_LIFT_MS (зовётся каждый тик). */
export function decayStepLift(e: Body, deltaMS: number): void {
  if (!e.stepLiftPx) return
  e.stepLiftPx = Math.max(0, e.stepLiftPx - (C.TILE_SIZE * deltaMS) / STEP_LIFT_MS)
}
