import type { Grid } from './types'
import * as C from './constants'
import { cellHeadBlockBottom } from './collision'

// ЗРЕНИЕ ВРАГА (05.11.2026). Чистая геометрия: видна ли точка из глаз врага
// сквозь тайлы. Решения (заметил / потерял / ищет) принимает enemy.ts.
//
// Луч режут '#' целиком и полоса '=' (её верхняя часть клетки, как у
// коллизий) — то есть сквозь пол, стену и платформу враг НЕ видит. Луч
// проверяется точками с шагом VISION_RAY_STEP_PX: это дешевле точного обхода
// клеток и с запасом мельче самой тонкой преграды (полоса '=' ≈ 19px).
const VISION_RAY_STEP_PX = 8

function pointBlocked(grid: Grid, px: number, py: number): boolean {
  const T = C.TILE_SIZE
  const cx = Math.floor(px / T)
  const cy = Math.floor(py / T)
  const bottom = cellHeadBlockBottom(grid, T, cx, cy)
  if (bottom === null) return false
  return py < bottom // '#' — вся клетка, '=' — только полоса сверху
}

export function lineOfSight(grid: Grid, x0: number, y0: number, x1: number, y1: number): boolean {
  const len = Math.hypot(x1 - x0, y1 - y0)
  const steps = Math.max(1, Math.ceil(len / VISION_RAY_STEP_PX))
  // Первую и последнюю точку не проверяем: глаза и цель сами по себе могут
  // касаться края клетки (стоят на полу), это не преграда.
  for (let i = 1; i < steps; i++) {
    const t = i / steps
    if (pointBlocked(grid, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false
  }
  return true
}

export type VisionInput = {
  grid: Grid
  // Враг: бокс и куда смотрит.
  ex: number
  ey: number
  ew: number
  eh: number
  facing: 1 | -1
  // Герой: бокс.
  px: number
  py: number
  pw: number
  ph: number
  // Дальность взгляда вперёд (в погоне — больше) и «чутьё» сзади, px.
  viewTiles: number
  senseBehindPx: number
}

// Видит ли враг героя прямо сейчас.
// • Вперёд — в пределах дальности по X и окна по высоте, при чистом луче.
// • Спиной — НЕ видит. Исключение — вплотную (senseBehindPx, почти
//   один уровень): чует того, кто трётся о него сзади, тоже при чистом луче.
// Луч — из глаз к голове И к поясу героя: достаточно одного (герой
// наполовину высунулся из-за уступа — его видно).
export function canSeePlayer(v: VisionInput): boolean {
  const T = C.TILE_SIZE
  const ecx = v.ex + v.ew / 2
  const pcx = v.px + v.pw / 2
  const dx = pcx - ecx
  const dist = Math.abs(dx)
  const feetDiff = v.py + v.ph - (v.ey + v.eh) // >0 — герой ниже
  const close = dist <= v.senseBehindPx && Math.abs(feetDiff) <= T
  const inFront = dx * v.facing > 0 || dist < v.ew / 2
  const range = v.viewTiles * T
  const inWindow =
    dist <= range && feetDiff <= C.ENEMY_VIEW_DOWN_TILES * T && -feetDiff <= C.ENEMY_VIEW_UP_TILES * T
  if (!close && !(inFront && inWindow)) return false
  const eyeX = ecx + v.facing * v.ew * 0.3
  const eyeY = v.ey + v.eh * 0.3
  return (
    lineOfSight(v.grid, eyeX, eyeY, pcx, v.py + 12) ||
    lineOfSight(v.grid, eyeX, eyeY, pcx, v.py + v.ph / 2)
  )
}
