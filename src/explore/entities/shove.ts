// ТОЛКАНИЕ ВРАГОВ (13.11.2026) — общее для Тарана (dash) и Телекинеза.
//
// Враг, которого толкнули, летит по горизонтали с заданной скоростью на заданное
// расстояние. Пока летит:
//   • его ИИ стоит — модуль держит hurtTimer (хитстан и так замораживает решение
//     «идти/бить» у всех модулей врагов, гравитацию — нет: с края он падает);
//   • он «открыт» ловушкам — trapExposedMs: любая ловушка, куда он влетел, ранит
//     его, в каком бы он ни был состоянии (entities/traps.ts);
//   • врезался в стену — стоп; у Тарана — ещё +25% урона Тарана;
//   • врезался в другого врага — тот получает половину урона толкнувшего и летит
//     дальше остаток пути (цепочка); толкнувший останавливается.
// Не толкаются: Беглец (его не двигает ничто), невосприимчивые к ловушкам
// Звонарь и Привратник сдвигаются не дальше bossLimitPx (Телекинез) или не
// сдвигаются вовсе (Таран).
import * as C from '../constants'
import { isSolid } from '../collision'
import type { Enemy, Grid } from '../types'

export type ShoveKind = 'ram' | 'tk'

type Shove = {
  enemy: Enemy
  dir: 1 | -1
  leftPx: number
  speed: number
  // Урон, который получит следующий в цепочке (половина этого) и бонус о стену.
  damage: number
  kind: ShoveKind
  wallDone: boolean
  chain: Set<Enemy>
}

export type ShoveDeps = {
  grid: Grid
  worldWidthPx: number
  enemies: { current: Enemy[] }
  /** Урон навыком (тот же damageEnemy, что у навыков; via 'skill'). true — умер. */
  damageEnemy: (enemy: Enemy, amount: number, sourceX: number) => boolean
  /** Реакция на попадание (вспышка, хитстан) — как от меча. */
  hitReaction: (enemy: Enemy) => void
}

/** Боссоподобные враги списка: толкаются не дальше полклетки (или не толкаются). */
export function isHeavy(e: Enemy): boolean {
  return e.kind === 'zvonar' || e.kind === 'gatekeeper' || e.summoned === true
}

export function createShoveSystem(deps: ShoveDeps) {
  const T = C.TILE_SIZE
  const active: Shove[] = []

  function find(e: Enemy): Shove | undefined {
    return active.find((s) => s.enemy === e)
  }

  /**
   * Толкнуть врага. distPx — полный путь; heavyLimitPx — сколько можно Звонарю и
   * Привратнику (0 — не двигать). Возвращает, сдвинется ли он вообще.
   */
  function shove(e: Enemy, dir: 1 | -1, distPx: number, speed: number, damage: number, kind: ShoveKind, heavyLimitPx: number, chain?: Set<Enemy>): boolean {
    if (e.dead || e.runner) return false
    let dist = distPx
    if (isHeavy(e)) {
      if (heavyLimitPx <= 0) return false
      dist = Math.min(dist, heavyLimitPx)
    }
    if (dist <= 0) return false
    const prev = find(e)
    if (prev) active.splice(active.indexOf(prev), 1)
    const set = chain ?? new Set<Enemy>()
    set.add(e)
    active.push({ enemy: e, dir, leftPx: dist, speed, damage, kind, wallDone: false, chain: set })
    e.trapExposedMs = Math.max(e.trapExposedMs ?? 0, C.SHOVE_EXPOSED_MS)
    e.hurtTimer = Math.max(e.hurtTimer, 120)
    // Он летит — отдача меча его больше не ведёт.
    e.knockMs = 0
    return true
  }

  function wallAhead(e: Enemy, lead: number): boolean {
    return isSolid(deps.grid, T, lead, e.y + 1)
      || isSolid(deps.grid, T, lead, e.y + e.height / 2)
      || isSolid(deps.grid, T, lead, e.y + e.height - 1)
      || lead < 0 || lead >= deps.worldWidthPx
  }

  function update(deltaMS: number): void {
    for (const e of deps.enemies.current) {
      if (e.trapExposedMs && e.trapExposedMs > 0 && !find(e)) e.trapExposedMs = Math.max(0, e.trapExposedMs - deltaMS)
    }
    // По снимку: цепочка добавляет новые толчки посреди обхода.
    const drop = (s: Shove) => { const k = active.indexOf(s); if (k >= 0) active.splice(k, 1) }
    for (const s of active.slice()) {
      if (!active.includes(s)) continue
      const e = s.enemy
      if (e.dead) { drop(s); continue }
      const step = Math.min(s.leftPx, s.speed * deltaMS / 1000)
      const nextX = e.x + s.dir * step
      const lead = s.dir > 0 ? nextX + e.width - 1e-3 : nextX
      if (wallAhead(e, lead)) {
        // Стена. Таран бьёт о неё сильнее — один раз за толчок.
        if (s.kind === 'ram' && !s.wallDone && s.damage > 0) {
          s.wallDone = true
          const bonus = Math.ceil(s.damage * C.RAM_WALL_BONUS_FRAC)
          if (!deps.damageEnemy(e, bonus, e.x + e.width / 2 - s.dir * T)) deps.hitReaction(e)
        }
        drop(s)
        continue
      }
      e.x = nextX
      s.leftPx -= step
      e.hurtTimer = Math.max(e.hurtTimer, 60)
      e.trapExposedMs = Math.max(e.trapExposedMs ?? 0, C.SHOVE_EXPOSED_MS)
      // Цепочка: врезался в живого врага, ещё не задетого этим толчком.
      let hitOther = false
      for (const o of deps.enemies.current) {
        if (o === e || o.dead || s.chain.has(o) || o.runner) continue
        const overlap = e.x < o.x + o.width && e.x + e.width > o.x && e.y < o.y + o.height && e.y + e.height > o.y
        if (!overlap) continue
        const half = Math.max(1, Math.floor(s.damage * C.RAM_CHAIN_FRAC))
        const died = deps.damageEnemy(o, half, e.x + e.width / 2)
        if (!died) {
          deps.hitReaction(o)
          shove(o, s.dir, Math.max(s.leftPx, T), s.speed, half, s.kind, s.kind === 'tk' ? C.TELEKINESIS_BOSS_PUSH_PX : 0, s.chain)
        }
        s.chain.add(o)
        hitOther = true
      }
      if (hitOther || s.leftPx <= 0) drop(s)
    }
  }

  /** Летит ли сейчас этот враг (Таран держит «несомого» впереди себя). */
  function isShoved(e: Enemy): boolean {
    return find(e) !== undefined
  }

  function dispose(): void {
    active.length = 0
  }

  return { shove, update, isShoved, dispose }
}

export type ShoveSystem = ReturnType<typeof createShoveSystem>
