import * as C from './constants'
import {
  isSolid,
  isPlatformBandBlocking,
  isOverlappingPlatformBand,
  sweepHeadBlock,
  isOverlappingAtFrameStart,
  sweepFootBlock,
} from './collision'
import { clamp } from './utils'
import type { Grid } from './types'

// ДВИЖЕНИЕ ГЕРОЯ — СТОЛКНОВЕНИЯ И ПРЫЖОК (26.11.2026, «Правки 26.11 (мосты)»).
// Вынесено из тикера Explore.tsx ДОСЛОВНО, чтобы проходимость карт проверял
// НАСТОЯЩИЙ код игры, а не копия формул (tools/hero_engine_check.mjs грузит
// этот модуль через vite). Игра зовёт эти же функции в том же порядке:
//   phys.x += vx·dt → resolveHeroWalls → толчок прыжка (heroJumpStart) →
//   heroJumpCut → heroGravityAndCollide.
// Менять поведение героя — только здесь; копий в тикере больше нет.

export type HeroPhys = { x: number; y: number; vx: number; vy: number; onGround: boolean }
export type JumpCut = { pending: boolean; airMs: number }

/** Стены и полоса '=' по X после phys.x += vx·dt; startX — x на начало кадра. */
export function resolveHeroWalls(grid: Grid, phys: HeroPhys, startX: number, headOffset: number, worldWidthPx: number): void {
  if (phys.vx > 0) {
    const px = phys.x + C.PLAYER_WIDTH - 1
    let hit =
      isSolid(grid, C.TILE_SIZE, px, phys.y + headOffset + 1) ||
      isSolid(grid, C.TILE_SIZE, px, phys.y + C.PLAYER_HEIGHT / 2) ||
      isSolid(grid, C.TILE_SIZE, px, phys.y + C.PLAYER_HEIGHT - 1)
    if (!hit) {
      // Сначала: уже внутри полосы (по текущему положению, не по цели)?
      const stuckInBand = isOverlappingPlatformBand(grid, C.TILE_SIZE, startX, C.PLAYER_WIDTH, phys.y + headOffset, phys.y + C.PLAYER_HEIGHT)
      if (!stuckInBand) {
        const band = isPlatformBandBlocking(grid, C.TILE_SIZE, px, phys.y + headOffset, phys.y + C.PLAYER_HEIGHT)
        if (band) hit = true
      }
    }
    if (hit) {
      phys.x = Math.floor((phys.x + C.PLAYER_WIDTH) / C.TILE_SIZE) * C.TILE_SIZE - C.PLAYER_WIDTH
      phys.vx = 0
    }
  } else if (phys.vx < 0) {
    const px = phys.x
    let hit =
      isSolid(grid, C.TILE_SIZE, px, phys.y + headOffset + 1) ||
      isSolid(grid, C.TILE_SIZE, px, phys.y + C.PLAYER_HEIGHT / 2) ||
      isSolid(grid, C.TILE_SIZE, px, phys.y + C.PLAYER_HEIGHT - 1)
    if (!hit) {
      // Сначала: уже внутри полосы (по текущему положению, не по цели)?
      const stuckInBand = isOverlappingPlatformBand(grid, C.TILE_SIZE, startX, C.PLAYER_WIDTH, phys.y + headOffset, phys.y + C.PLAYER_HEIGHT)
      if (!stuckInBand) {
        const band = isPlatformBandBlocking(grid, C.TILE_SIZE, px, phys.y + headOffset, phys.y + C.PLAYER_HEIGHT)
        if (band) hit = true
      }
    }
    if (hit) {
      phys.x = (Math.floor(phys.x / C.TILE_SIZE) + 1) * C.TILE_SIZE
      phys.vx = 0
    }
  }

  phys.x = clamp(phys.x, 0, worldWidthPx - C.PLAYER_WIDTH)
}

/** Толчок прыжка: скорость вверх и начало окна среза (прыжок от длины нажатия). */
export function heroJumpStart(phys: HeroPhys, cut: JumpCut): void {
  phys.vy = -C.JUMP_VELOCITY
  phys.onGround = false
  // Прыжок от длины нажатия (30.10.2026): срез ещё возможен.
  cut.pending = true
  cut.airMs = 0
}

/**
 * Прыжок от длины нажатия (30.10.2026): отпустил кнопку прыжка, пока герой
 * летит вверх, — скорость подъёма один раз × JUMP_CUT_MULT, но не раньше
 * JUMP_MIN_HOLD_MS от толчка. held — держит ли игрок кнопку.
 */
export function heroJumpCut(phys: HeroPhys, cut: JumpCut, held: boolean, deltaMS: number, jumpedThisFrame: boolean): void {
  if (cut.pending) {
    if (phys.vy >= 0) {
      cut.pending = false
    } else if (!jumpedThisFrame) {
      cut.airMs += deltaMS
      if (!held && cut.airMs >= C.JUMP_MIN_HOLD_MS) {
        phys.vy *= C.JUMP_CUT_MULT
        cut.pending = false
      }
    }
  }
}

/** Гравитация, приземление (sweepFootBlock) и удар головой (sweepHeadBlock). */
export function heroGravityAndCollide(grid: Grid, phys: HeroPhys, startY: number, dt: number): void {
  phys.vy = Math.min(phys.vy + C.GRAVITY * dt, C.MAX_FALL)
  phys.y += phys.vy * dt

  phys.onGround = false
  if (phys.vy > 0) {
    // Приземление сверху: проверяем весь путь ног за кадр, не только
    // конечную точку — иначе на просевшем кадре можно провалиться
    // сквозь тонкую полосу '=', не попав в неё ни разу.
    const prevFootY = startY + C.PLAYER_HEIGHT
    const footY = phys.y + C.PLAYER_HEIGHT
    const blockTop = sweepFootBlock(grid, C.TILE_SIZE, phys.x, C.PLAYER_WIDTH, prevFootY, footY)
    if (blockTop !== null) {
      phys.y = blockTop - C.PLAYER_HEIGHT
      phys.vy = 0
      phys.onGround = true
    }
  } else if (phys.vy < 0) {
    // Удар головой снизу вверх: та же защита от туннелирования —
    // проверяем весь путь [headY, prevHeadY] за кадр. '#' — вся
    // клетка, '=' — только полоса.
    // В ПРЫЖКЕ (phys.onGround уже false в этой ветке — vy<0 бывает
    // только во время взлёта) верх проверки опущен на headOffset=
    // JUMP_HIT_OFFSET_Y, к макушке прыжковой позы — иначе полный бокс
    // (128 высотой) торчит головой выше спрайта и упирается в пустоту.
    // На земле headOffset=0, поведение не меняется (эта ветка на земле
    // и не выполняется, т.к. vy<0 там не бывает).
    const headOffset = phys.onGround ? 0 : C.JUMP_HIT_OFFSET_Y
    const prevHeadY = startY + headOffset // y ДО y += vy*dt (startY захвачен в начале тика)
    const headY = phys.y + headOffset
    const pushTo = sweepHeadBlock(grid, C.TILE_SIZE, phys.x, C.PLAYER_WIDTH, prevHeadY, headY)
    if (pushTo !== null) {
      phys.y = pushTo - headOffset
      phys.vy = 0
    } else if (
      // НИЖНЯЯ граница диапазона намеренно НЕ сдвинута (startY +
      // PLAYER_HEIGHT, как было) — только верхняя поднята на
      // headOffset. Если ужать и верх, и низ на headOffset, нижняя
      // граница проверки уезжает в клетку под ногами игрока и rollback
      // срабатывает каждый кадр прыжка (замораживал игрока на месте,
      // уже наступали на эти грабли раньше).
      isOverlappingAtFrameStart(grid, C.TILE_SIZE, phys.x, C.PLAYER_WIDTH, prevHeadY, startY + C.PLAYER_HEIGHT)
    ) {
      // Зашли сбоку под ступень: пересечения границы за кадр не было
      // (голова уже была внутри полосы на старте кадра), sweep выше
      // ничего не нашёл. Откатываем движение вверх за этот кадр —
      // без перепозиционирования по blockBottom, никакого телепорта.
      // Снап возвращает phys.y ровно туда, где он был ДО этого кадра
      // (startY) — headOffset тут ни при чём, phys.y всегда верх
      // ПОЛНОГО бокса, а не сдвинутой головы.
      phys.y = startY
      phys.vy = 0
    }
  }
}
