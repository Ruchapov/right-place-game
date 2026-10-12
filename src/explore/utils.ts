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

// Зажимает value в [min, max]. Если min > max (карта меньше экрана по этой
// оси), выворачивать диапазон нельзя — ставим 0.
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
