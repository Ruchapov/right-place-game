import type { MutableRefObject } from 'react'
import type { Enemy } from '../types'
import * as N from '../ncConstants'
import { ncSheet } from '../ncConstants'
import { ncHitDamage } from '../scaling'
import { createNcEnemySystem } from './ncEnemy'
import type { NcAssets, NcBehavior, NcEnemyDeps } from './ncEnemy'

/**
 * БЕЗЛИКИЙ ФЕХТОВАЛЬЩИК (09.11.2026). Подходит и делает выпад (Fencer_Attack,
 * урон в окне hit, дальность reachPx).
 *
 * Блок от «спама»: два попадания по нему подряд с паузой не больше
 * FENCER_PARRY_GAP_MS — сразу встаёт в Fencer_Parry. Удар героя в кадрах block
 * урона не наносит (искра, героя отталкивает и держит 0.3 с — это решает
 * Explore.tsx по fencerSwordHit), в кадрах open он открыт: урон ×1.5. После
 * блока, если герой близко, — сразу выпад.
 */
const ATTACK = 'Fencer_Attack'
const PARRY = 'Fencer_Parry'

const behavior: NcBehavior = {
  kind: 'fencer',
  hpMult: N.NC_HP_MULT.fencer,
  stopGap: (ctx) => ctx.reach(ATTACK) * 0.7,
  windupFrame: (action) => (action === 'Attack' ? ncSheet(ATTACK).hit![0] : null),
  decide(ctx, e, v) {
    const nc = e.nc!
    if (v.sameTier && v.gap <= ctx.reach(ATTACK) * 0.85 && nc.cooldownMs <= 0) {
      e.facing = v.dx >= 0 ? 1 : -1
      ctx.start(e, 'Attack')
      return true
    }
    return false
  },
  onAction(ctx, e, action, frame) {
    const nc = e.nc!
    if (action !== 'Attack' || nc.hitDone) return
    const [h0, h1] = ncSheet(ATTACK).hit!
    if (frame >= h0 && frame <= h1) {
      const r = ctx.meleeStrike(e, ATTACK, ncHitDamage(N.FENCER_DMG_MULT, e.attackDamage))
      if (r !== 'miss') nc.hitDone = true
    }
  },
  onActionEnd(ctx, e, action) {
    // После блока — сразу выпад, если герой рядом.
    if (action !== 'Parry') return
    const pb = ctx.deps.getPlayerCombatBox()
    const cx = e.x + e.width / 2
    const dx = pb.x + pb.w / 2 - cx
    const gap = Math.max(0, Math.abs(dx) - pb.w / 2 - e.width / 2)
    if (gap <= ctx.reach(ATTACK) && pb.y < e.y + e.height && pb.y + pb.h > e.y) {
      e.facing = dx >= 0 ? 1 : -1
      e.nc!.cooldownMs = 0
      ctx.start(e, 'Attack')
    }
  },
}

export function createFencerSystem(deps: NcEnemyDeps, assets: MutableRefObject<NcAssets | null>) {
  const sys = createNcEnemySystem(behavior, deps, assets)
  const baseUpdate = sys.update
  // Серия попаданий набрана — встать в блок СРАЗУ (поверх хитстана).
  function update(dt: number, deltaMS: number) {
    for (const e of deps.enemies.current) {
      if (e.kind !== 'fencer' || !e.nc || e.dead) continue
      if (e.nc.parryRequest && e.stunTimer <= 0 && e.parryStunTimer <= 0) {
        e.nc.parryRequest = false
        e.hurtTimer = 0
        sys.ctx.start(e, 'Parry')
        // Блок — не замах: сбить его ударом нельзя, кадры block гасят меч.
        e.windingUp = false
      }
    }
    baseUpdate(dt, deltaMS)
  }
  return { ...sys, update }
}

/**
 * Удар МЕЧОМ героя по фехтовальщику — зовёт damageEnemy ДО списания HP.
 *   'block' — кадры block листа Parry: урона нет (искра, героя отталкивает);
 *   'open'  — кадры open: урон × FENCER_OPEN_DMG_MULT;
 *   'normal' — обычный удар; второй подряд за FENCER_PARRY_GAP_MS ставит
 *              запрос на блок.
 */
export function fencerSwordHit(e: Enemy, nowMs: number): 'block' | 'open' | 'normal' {
  const nc = e.nc!
  nc.blockedHit = false
  if (nc.action === 'Parry') {
    const frame = e.sprite.currentFrame
    const spec = ncSheet(PARRY)
    if (frame >= spec.block![0] && frame <= spec.block![1]) {
      nc.blockedHit = true
      return 'block'
    }
    if (frame >= spec.open![0] && frame <= spec.open![1]) return 'open'
    return 'normal'
  }
  nc.hitStreak = nowMs - nc.lastHitAt <= N.FENCER_PARRY_GAP_MS ? nc.hitStreak + 1 : 1
  nc.lastHitAt = nowMs
  if (nc.hitStreak >= 2) {
    nc.hitStreak = 0
    nc.parryRequest = true
  }
  return 'normal'
}
