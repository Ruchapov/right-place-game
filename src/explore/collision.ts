import { PLATFORM_H_RATIO, SPIKE_H_RATIO } from '../mapRenderer'
import type { Grid } from './types'

// '#' — твердь. За боковыми и нижним краем сетки тоже твердь (чтобы не
// улететь за карту), выше верхнего края — воздух. '=' здесь не учитываем.
export function isSolid(grid: Grid, tileSize: number, px: number, py: number): boolean {
  const cx = Math.floor(px / tileSize)
  const cy = Math.floor(py / tileSize)
  const width = grid[0]?.length ?? 0
  const height = grid.length
  if (cy < 0) return false
  if (cy >= height) return true
  if (cx < 0 || cx >= width) return true
  return grid[cy][cx] === '#'
}

// Горизонтальная коллизия с полосой '=': блокирует ТОЛЬКО полоса сверху
// клетки (bandH = tileSize*PLATFORM_H_RATIO), нижние ~56% клетки остаются
// проходимы вбок. Проверяет реальное пересечение интервалов [top,bottom) и
// [cellTop,cellTop+bandH) по всем строкам, которые занимает габарит игрока
// — не точки выборки, иначе полоса может провалиться между сэмплами (как
// уже было с вертикалью). '#' здесь не трогаем — для неё уже есть isSolid.
export function isPlatformBandBlocking(
  grid: Grid,
  tileSize: number,
  px: number,
  top: number,
  bottom: number,
): { cx: number; cy: number } | null {
  const cx = Math.floor(px / tileSize)
  const width = grid[0]?.length ?? 0
  const height = grid.length
  if (cx < 0 || cx >= width) return null
  const cyTop = Math.floor(top / tileSize)
  const cyBottom = Math.floor((bottom - 1) / tileSize)
  for (let cy = cyTop; cy <= cyBottom; cy++) {
    if (cy < 0 || cy >= height) continue
    if (grid[cy][cx] !== '=') continue
    const cellTop = cy * tileSize
    const bandBottom = cellTop + tileSize * PLATFORM_H_RATIO
    if (top < bandBottom && bottom > cellTop) return { cx, cy }
  }
  return null
}

// ЗАЩИТА ОТ ЗАСТРЕВАНИЯ по горизонтали: проверяет ТЕКУЩЕЕ положение игрока
// (на начало кадра — left/top/bottom ещё не двигались в этом кадре), а не
// целевую клетку. Если габарит [left,left+width)×[top,bottom) пересекает
// полосу '=' хотя бы в ОДНОЙ из клеток, которые игрок сейчас занимает по
// горизонтали (не только та, куда он движется), — значит он уже внутри
// полосы (например, после прыжка). В этом состоянии блокировка по '=' не
// применяется ни в одну сторону, пока игрок не выйдет из полосы целиком.
export function isOverlappingPlatformBand(
  grid: Grid,
  tileSize: number,
  left: number,
  width: number,
  top: number,
  bottom: number,
): boolean {
  const gridWidth = grid[0]?.length ?? 0
  const gridHeight = grid.length
  const cxLeft = Math.floor(left / tileSize)
  const cxRight = Math.floor((left + width - 1) / tileSize)
  const cyTop = Math.floor(top / tileSize)
  const cyBottom = Math.floor((bottom - 1) / tileSize)
  for (let cy = cyTop; cy <= cyBottom; cy++) {
    if (cy < 0 || cy >= gridHeight) continue
    const cellTop = cy * tileSize
    const bandBottom = cellTop + tileSize * PLATFORM_H_RATIO
    if (!(top < bandBottom && bottom > cellTop)) continue
    for (let cx = cxLeft; cx <= cxRight; cx++) {
      if (cx < 0 || cx >= gridWidth) continue
      if (grid[cy][cx] === '=') return true
    }
  }
  return false
}

// Шипы '^' не твердь ни для одной из сторон (не проверяются в isSolid/
// cellHeadBlockBottom/cellFootBlockTop выше) — игрок проходит/проваливается
// сквозь них как через воздух. Здесь только определяем КАСАНИЕ — и только с
// зоной ЗУБЬЕВ (нижние SPIKE_H_RATIO клетки, прижаты к низу — см. drawSpikes/
// SPIKE_H_RATIO в mapRenderer.ts), а не со всей клеткой: иначе нельзя было бы
// перепрыгнуть шип — урон бил бы и по воздуху над видимыми зубьями.
export function isTouchingSpikes(
  grid: Grid,
  tileSize: number,
  left: number,
  width: number,
  top: number,
  bottom: number,
): boolean {
  const gridWidth = grid[0]?.length ?? 0
  const gridHeight = grid.length
  const cxLeft = Math.floor(left / tileSize)
  const cxRight = Math.floor((left + width - 1) / tileSize)
  const cyTop = Math.floor(top / tileSize)
  const cyBottom = Math.floor((bottom - 1) / tileSize)
  for (let cy = cyTop; cy <= cyBottom; cy++) {
    if (cy < 0 || cy >= gridHeight) continue
    const cellBottom = (cy + 1) * tileSize
    const bandTop = cellBottom - tileSize * SPIKE_H_RATIO
    // Хитбокс вообще пересекает полосу зубьев в этой строке клеток?
    if (!(top < cellBottom && bottom > bandTop)) continue
    for (let cx = cxLeft; cx <= cxRight; cx++) {
      if (cx < 0 || cx >= gridWidth) continue
      if (grid[cy][cx] === '^') return true
    }
  }
  return false
}

// Нижняя граница препятствия в клетке (cx,cy) для движения ВВЕРХ, или null,
// если клетка не блокирует. '#' — вся клетка, '=' — только полоса сверху
// (см. drawPlatform/PLATFORM_H_RATIO в mapRenderer.ts).
export function cellHeadBlockBottom(
  grid: Grid,
  tileSize: number,
  cx: number,
  cy: number,
): number | null {
  const width = grid[0]?.length ?? 0
  const height = grid.length
  const cellTop = cy * tileSize
  if (cy < 0) return null // выше карты — воздух
  if (cy >= height || cx < 0 || cx >= width) return cellTop + tileSize // край сетки — твердь
  const ch = grid[cy][cx]
  if (ch === '#') return cellTop + tileSize
  if (ch === '=') return cellTop + tileSize * PLATFORM_H_RATIO
  return null
}

// Верхняя граница поверхности в клетке (cx,cy) для приземления СВЕРХУ, или
// null, если клетка не твердь. '#' — верх клетки. '=' — тоже верх клетки
// (полоса начинается от верха, см. drawPlatform/PLATFORM_H_RATIO в mapRenderer.ts).
export function cellFootBlockTop(
  grid: Grid,
  tileSize: number,
  cx: number,
  cy: number,
): number | null {
  const width = grid[0]?.length ?? 0
  const height = grid.length
  const cellTop = cy * tileSize
  if (cy < 0) return null // выше карты — воздух
  if (cy >= height || cx < 0 || cx >= width) return cellTop // край сетки — твердь
  const ch = grid[cy][cx]
  if (ch === '#' || ch === '=') return cellTop
  return null
}

// Проверяет весь путь головы за кадр [headY, prevHeadY] (headY < prevHeadY,
// движение вверх), а не только конечную точку — иначе на просевшем кадре
// голова может перескочить всю полосу '=' (~28px), ни разу не попав внутрь
// (туннелирование). Три колонки на путь: края + центр. Если пересекли
// несколько границ — берём САМУЮ НИЖНЮЮ (max blockBottom): это первая, во
// что игрок упёрся бы, двигаясь снизу вверх.
export function sweepHeadBlock(
  grid: Grid,
  tileSize: number,
  playerX: number,
  playerWidth: number,
  prevHeadY: number,
  headY: number,
): number | null {
  const xPoints = [playerX + 1, playerX + playerWidth / 2, playerX + playerWidth - 1]
  const cyTop = Math.floor(headY / tileSize)
  const cyBottom = Math.floor(prevHeadY / tileSize)

  let pushTo: number | null = null
  for (let cy = cyTop; cy <= cyBottom; cy++) {
    for (const px of xPoints) {
      const cx = Math.floor(px / tileSize)
      const blockBottom = cellHeadBlockBottom(grid, tileSize, cx, cy)
      if (blockBottom === null) continue
      // Пересекли границу снизу вверх именно за этот кадр.
      if (prevHeadY >= blockBottom && headY < blockBottom) {
        pushTo = pushTo === null ? blockBottom : Math.max(pushTo, blockBottom)
      }
    }
  }
  return pushTo
}

// Случай "уже перекрываемся на начало кадра": игрок зашёл сбоку и на старте
// кадра голова уже внутри полосы '=' (или клетки '#') — пересечения границы
// не было, поэтому sweepHeadBlock ничего не находит и пропускает движение
// вверх насквозь. Проверяет те же три колонки на пересечение прямоугольника
// игрока (prevTop..prevBottom) с блокирующим прямоугольником клетки.
export function isOverlappingAtFrameStart(
  grid: Grid,
  tileSize: number,
  playerX: number,
  playerWidth: number,
  prevTop: number,
  prevBottom: number,
): boolean {
  const xPoints = [playerX + 1, playerX + playerWidth / 2, playerX + playerWidth - 1]
  const cyTop = Math.floor(prevTop / tileSize)
  const cyBottom = Math.floor((prevBottom - 1) / tileSize)

  for (let cy = cyTop; cy <= cyBottom; cy++) {
    for (const px of xPoints) {
      const cx = Math.floor(px / tileSize)
      const blockBottom = cellHeadBlockBottom(grid, tileSize, cx, cy)
      if (blockBottom === null) continue
      const cellTop = cy * tileSize
      if (prevTop < blockBottom && prevBottom > cellTop) return true
    }
  }
  return false
}

// Симметрично sweepHeadBlock, но для падения: путь [prevFootY, footY]
// (footY > prevFootY, движение вниз). Берём САМУЮ ВЕРХНЮЮ пересечённую
// границу (min blockTop) — первая поверхность, на которую падает игрок.
export function sweepFootBlock(
  grid: Grid,
  tileSize: number,
  playerX: number,
  playerWidth: number,
  prevFootY: number,
  footY: number,
): number | null {
  const xPoints = [playerX + 1, playerX + playerWidth / 2, playerX + playerWidth - 1]
  const cyTop = Math.floor(prevFootY / tileSize)
  const cyBottom = Math.floor(footY / tileSize)

  let pushTo: number | null = null
  for (let cy = cyTop; cy <= cyBottom; cy++) {
    for (const px of xPoints) {
      const cx = Math.floor(px / tileSize)
      const blockTop = cellFootBlockTop(grid, tileSize, cx, cy)
      if (blockTop === null) continue
      // Пересекли границу сверху вниз именно за этот кадр.
      if (prevFootY <= blockTop && footY > blockTop) {
        pushTo = pushTo === null ? blockTop : Math.min(pushTo, blockTop)
      }
    }
  }
  return pushTo
}
