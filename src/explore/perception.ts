import { Text } from 'pixi.js'
import type { Container } from 'pixi.js'
import type { Enemy, Grid } from './types'
import * as C from './constants'
import { canSeePlayer } from './vision'

// ВОСПРИЯТИЕ ВРАГА — общее для ВСЕХ противников (05–08.11.2026): зверь,
// Звонарь, Привратник, босс-оборотень, Настоятель. Раньше у каждого был свой
// копипаст «агро в радиусе и на том же этаже» — он видел сквозь платформы и
// затылком. Теперь у всех одна цепочка, отличаются только числа (Tuning):
//
//   патруль/стоит → ВИДИТ (vision.ts: вперёд, луч не режут стены/платформы;
//   сзади — только вплотную) → «!» реакция noticeMs, стоит лицом к герою →
//   ПОГОНЯ (пока видит; потерял — ещё graceMs по памяти) → ПОИСК: идёт туда,
//   где видел в последний раз (lastSeen), «?» → ОГЛЯДЫВАЕТСЯ (разворот каждые
//   ENEMY_LOOK_TURN_MS) → обратно к своему обычному поведению.
//   Увидел снова во время поиска или его ударили — в погоню сразу, без «!».
//
// aggroMemoryTimer по-прежнему значит «в погоне», investigate* — «поиск»:
// эти поля уже читает остальной код каждого врага, их смысл не меняется.

export type Perceiver = {
  facing: 1 | -1
  hurtTimer: number
  aggroMemoryTimer: number
  investigateX: number | null
  investigateTimer: number
  investigateLookTimer: number
  investigateFeetY?: number | null
  noticeMs?: number
  noticePending?: boolean
  lastSeenX?: number
  lastSeenFeetY?: number
  lookTurnMs?: number
  markMs?: number
  mark?: Text
}

export type PerceptionTuning = {
  viewTiles: number // дальность взгляда, не в погоне
  chaseViewTiles: number // дальность взгляда в погоне
  senseBehindPx: number // «чует» сзади вплотную
  noticeMs: number // реакция «!»
  graceMs: number // бежит «по памяти» после потери из виду
  searchMs: number // потолок ходьбы к месту, где видел
}

// Рядовые враги — одни числа (зверь, Звонарь, Привратник).
export const ENEMY_PERCEPTION: PerceptionTuning = {
  viewTiles: C.ENEMY_VIEW_RANGE_TILES,
  chaseViewTiles: C.ENEMY_CHASE_VIEW_RANGE_TILES,
  senseBehindPx: C.ENEMY_SENSE_RANGE_PX,
  noticeMs: C.ENEMY_NOTICE_MS,
  graceMs: C.ENEMY_CHASE_GRACE_MS,
  searchMs: C.ENEMY_SEARCH_MS,
}
// Боссы: стоят на своей арене, видят далеко, сзади чуют шире, а потеряв
// героя, дольше «держат» его (бой с боссом не должен рваться от прыжка).
export const BOSS_PERCEPTION: PerceptionTuning = {
  viewTiles: C.BOSS_AGGRO_RANGE_TILES,
  chaseViewTiles: C.BOSS_AGGRO_RANGE_TILES + 4,
  senseBehindPx: C.BOSS_SENSE_RANGE_PX,
  noticeMs: C.BOSS_NOTICE_MS,
  graceMs: C.BOSS_CHASE_GRACE_MS,
  searchMs: C.ENEMY_SEARCH_MS,
}

type Box = { x: number; y: number; w: number; h: number }

// Один кадр восприятия. Зовётся там, где раньше стоял блок «память агро +
// таймеры расследования» — ДО гейтов хитстана/замаха (таймеры обязаны течь
// и там). Возвращает «в погоне ли он сейчас» и «начал ли погоню в этом кадре»
// (по второму вызывающий зовёт стаю — callPack).
export function perceive(
  e: Perceiver,
  body: Box,
  player: Box,
  grid: Grid,
  deltaMS: number,
  tune: PerceptionTuning,
): { aggroed: boolean; startedChase: boolean } {
  const playerFeetY = player.y + player.h
  const sees = canSeePlayer({
    grid,
    ex: body.x,
    ey: body.y,
    ew: body.w,
    eh: body.h,
    facing: e.facing,
    px: player.x,
    py: player.y,
    pw: player.w,
    ph: player.h,
    viewTiles: e.aggroMemoryTimer > 0 ? tune.chaseViewTiles : tune.viewTiles,
    senseBehindPx: tune.senseBehindPx,
  })
  const wasChasing = e.aggroMemoryTimer > 0
  const searching = e.investigateTimer > 0 || e.investigateLookTimer > 0
  if (sees) {
    e.lastSeenX = player.x + player.w / 2
    e.lastSeenFeetY = playerFeetY
  }
  e.noticeMs = Math.max(0, (e.noticeMs ?? 0) - deltaMS)
  let startedChase = false
  if (sees && !wasChasing) {
    if (searching || e.hurtTimer > 0) {
      // Уже настороже (ищет или его только что ударили) — без паузы.
      e.noticePending = false
      e.aggroMemoryTimer = tune.graceMs
      startedChase = true
    } else if (!e.noticePending) {
      e.noticeMs = tune.noticeMs
      e.noticePending = true
    }
  }
  if (e.noticePending && e.noticeMs === 0) {
    // Реакция кончилась — в погоню, даже если герой успел спрятаться: он его
    // УЖЕ заметил (тогда погоня быстро сменится поиском по lastSeen).
    e.noticePending = false
    e.aggroMemoryTimer = tune.graceMs
    startedChase = true
  }
  if (wasChasing) {
    if (sees) {
      e.aggroMemoryTimer = tune.graceMs
    } else {
      e.aggroMemoryTimer = Math.max(0, e.aggroMemoryTimer - deltaMS)
      if (e.aggroMemoryTimer === 0 && e.lastSeenX !== undefined) {
        // Потерял — ПОИСК там, где видел в последний раз.
        e.investigateX = e.lastSeenX
        e.investigateFeetY = e.lastSeenFeetY ?? null
        e.investigateTimer = tune.searchMs
        e.investigateLookTimer = 0
      }
    }
  }
  if (startedChase) e.markMs = tune.noticeMs
  e.markMs = Math.max(0, (e.markMs ?? 0) - deltaMS)

  const aggroed = e.aggroMemoryTimer > 0
  // Таймеры поиска/расследования (раньше — копия в каждом враге).
  if (aggroed) {
    e.investigateTimer = 0
    e.investigateLookTimer = 0
    e.investigateX = null
  } else if (e.investigateTimer > 0) {
    e.investigateTimer = Math.max(0, e.investigateTimer - deltaMS)
    if (e.investigateTimer === 0) e.investigateLookTimer = C.INVESTIGATE_LOOK_MS
  } else if (e.investigateLookTimer > 0) {
    e.investigateLookTimer = Math.max(0, e.investigateLookTimer - deltaMS)
    if (e.investigateLookTimer === 0) {
      e.investigateX = null
      e.investigateFeetY = null
    }
  }
  return { aggroed, startedChase }
}

// Фаза «оглядывается»: не стоит столбом лицом к точке, а разворачивается
// каждые ENEMY_LOOK_TURN_MS — зрение направленное, так он может заметить
// героя за спиной.
// intervalMs — у боссов в покое реже (BOSS_IDLE_TURN_MS): стоит на арене и
// изредка оборачивается, чтобы зайти ему за спину не было «бесплатно».
export function lookAround(e: Perceiver, deltaMS: number, intervalMs: number = C.ENEMY_LOOK_TURN_MS): void {
  e.lookTurnMs = (e.lookTurnMs ?? intervalMs) - deltaMS
  if (e.lookTurnMs <= 0) {
    e.lookTurnMs = intervalMs
    e.facing = e.facing === 1 ? -1 : 1
  }
}

// Точка поиска НИЖЕ врага — с края к ней можно спрыгнуть.
export function searchTargetBelow(e: Perceiver, feetY: number): boolean {
  return e.investigateFeetY != null && e.investigateFeetY - feetY >= C.ENEMY_DROP_MIN_PX
}

// СТАЯ: заметивший зовёт соседей по своей группе (то же событие) туда, где
// герой. Любого вида — зверь позовёт и Звонаря, и Привратника. Прибежав, они
// смотрят своими глазами. Призванных и патрульных (событие -1) не зовёт.
export function callPack(
  caller: Enemy,
  enemies: Enemy[],
  playerX: number,
  playerFeetY: number,
  tune: PerceptionTuning,
): void {
  if (caller.eventIndex < 0) return
  const myCx = caller.x + caller.width / 2
  for (const mate of enemies) {
    if (mate === caller || mate.dead) continue
    if (mate.eventIndex !== caller.eventIndex || mate.aggroMemoryTimer > 0) continue
    if (Math.abs(mate.x + mate.width / 2 - myCx) > C.PACK_ALERT_RANGE_TILES * C.TILE_SIZE) continue
    mate.investigateX = playerX
    mate.investigateFeetY = playerFeetY
    mate.investigateTimer = tune.searchMs
    mate.investigateLookTimer = 0
  }
}

// Значок над головой: «!» — заметил (реакция и начало погони), «?» — ищет.
// Создаётся при первом показе; centerX/topY — точка над полоской HP.
export function syncMark(e: Perceiver, container: Container, centerX: number, topY: number, hidden = false): void {
  const aggroed = e.aggroMemoryTimer > 0
  const text = hidden ? '' : e.noticePending || (e.markMs ?? 0) > 0 ? '!' : !aggroed && e.investigateX !== null ? '?' : ''
  if (text && !e.mark) {
    e.mark = new Text({
      text,
      style: { fontSize: 30, fontWeight: 'bold', fill: 0xffd23f, stroke: { color: 0x000000, width: 5 } },
    })
    e.mark.anchor.set(0.5, 1)
    container.addChild(e.mark)
  }
  if (e.mark) {
    e.mark.visible = text !== ''
    if (text && e.mark.text !== text) e.mark.text = text
    e.mark.x = centerX
    e.mark.y = topY - C.ENEMY_MARK_OFFSET_Y + 14
  }
}

export function destroyMark(e: Perceiver, container: Container): void {
  if (!e.mark) return
  container.removeChild(e.mark)
  e.mark.destroy()
  e.mark = undefined
}
