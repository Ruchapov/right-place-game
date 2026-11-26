import * as C from './constants'

// Общий выбор "N случайных без повторов" — используется и для событий (3 из
// пула), и для шипов (10 из hazard). Если в пуле меньше count элементов —
// отдаёт весь пул как есть, без падения.
export function pickRandom<T>(items: T[], count: number): T[] {
  const pool = [...items]
  const picked: T[] = []
  while (pool.length > 0 && picked.length < count) {
    const i = Math.floor(Math.random() * pool.length)
    picked.push(pool[i])
    pool.splice(i, 1)
  }
  return picked
}

// Кадр листа hurt, на котором стоит враг, оглушённый парированием, — по ОСТАТКУ
// таймера оглушения. Пока остатка больше PARRY_STUN_RECOVER_MS — кадр позы;
// дальше лист доигрывается до последнего кадра, каждому кадру равная доля, и
// оглушение кончается на последнем (см. PARRY_STUN_RECOVER_MS в constants.ts).
// Общая для всех четырёх врагов: у каждого свой кадр позы и своя длина листа.
export function parryStunFrame(timerMs: number, poseFrame: number, lastFrame: number): number {
  if (timerMs >= C.PARRY_STUN_RECOVER_MS) return poseFrame
  const done = 1 - timerMs / C.PARRY_STUN_RECOVER_MS
  return Math.min(lastFrame, poseFrame + Math.floor(done * (lastFrame - poseFrame + 1)))
}

// Зажимает value в [min, max]. Если min > max (карта меньше экрана по этой
// оси), выворачивать диапазон нельзя — ставим 0.
/**
 * Линия ступней на полу (18.11.2026): поверхность клетки (findGroundSurfaceY,
 * или низ бокса в воздухе) + FOOT_TUNE. ОДНА функция посадки на всех: герой,
 * враги, боссы — и лужа навозника (она лежит там, где стоят ступни, а не на
 * линии клетки, иначе висит на 11 px выше пола).
 */
export function standLineY(surfaceY: number): number {
  return surfaceY + C.FOOT_TUNE
}

export function clamp(value: number, min: number, max: number): number {
  if (min > max) return 0
  return Math.min(max, Math.max(min, value))
}

// Низкий горизонтальный экран — телефон набок (см. C.LOW_LANDSCAPE_MAX_H). То
// же условие, что в медиа-запросе раскладки кнопок (TouchControls): «шире, чем
// выше» у CSS (orientation: landscape) — это строго width > height.
export function isLowLandscape(width: number, height: number): boolean {
  return width > height && height <= C.LOW_LANDSCAPE_MAX_H
}

// Масштаб мира под экран. В вертикали (и на квадрате) — прежняя константа; в
// горизонтали — от высоты, см. C.LANDSCAPE_VIEW_TILES.
export function worldScaleFor(width: number, height: number): number {
  if (!(width > height)) return C.WORLD_SCALE
  return Math.min(C.WORLD_SCALE, Math.max(C.WORLD_SCALE_MIN, height / (C.LANDSCAPE_VIEW_TILES * C.TILE_SIZE)))
}

/**
 * Герой прижат к стене (pushPlayerOutX вернул true, 26.11.2026): толкающий
 * враг встаёт вплотную к его боксу со своей стороны — в стену тянет не героя,
 * а останавливается сам враг. Назад он уходит туда, откуда пришёл, — там
 * свободно.
 */
export function backOffPinnedHero(e: { x: number; width: number }, pb: { x: number; w: number }): void {
  const heroCenter = pb.x + pb.w / 2
  e.x = heroCenter < e.x + e.width / 2 ? pb.x + pb.w : pb.x - e.width
}
