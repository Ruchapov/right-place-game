import type { MutableRefObject } from 'react'
import * as N from '../ncConstants'
import { ncSheet } from '../ncConstants'
import { ncHitDamage } from '../scaling'
import { createNcEnemySystem } from './ncEnemy'
import type { NcAssets, NcBehavior, NcEnemyDeps } from './ncEnemy'

/**
 * КОЧЕГАР (09.11.2026). Удар кочергой (Stoker_Attack, урон в окне hit,
 * дальность reachPx; огненный след уже в листе). Попадание поджигает героя на
 * BURN_MS: горение — BURN_TOTAL_FRAC урона удара, тиками; повторное попадание
 * обновляет время, не складывается (решает Explore.tsx — igniteHero).
 */
const ATTACK = 'Stoker_Attack'

const behavior: NcBehavior = {
  kind: 'stoker',
  hpMult: N.NC_HP_MULT.stoker,
  stopGap: (ctx) => ctx.reach(ATTACK) * 0.7,
  windupFrame: (action) => (action === 'Attack' ? ncSheet(ATTACK).hit![0] : null),
  decide(ctx, e, v) {
    if (v.sameTier && v.gap <= ctx.reach(ATTACK) * 0.85 && e.nc!.cooldownMs <= 0) {
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
    if (frame < h0 || frame > h1) return
    const damage = ncHitDamage(N.STOKER_DMG_MULT, e.attackDamage)
    const r = ctx.meleeStrike(e, ATTACK, damage)
    if (r === 'miss') return
    nc.hitDone = true
    if (r === 'hit' && !ctx.deps.dashing.current) ctx.deps.igniteHero(damage)
  },
}

export function createStokerSystem(deps: NcEnemyDeps, assets: MutableRefObject<NcAssets | null>) {
  return createNcEnemySystem(behavior, deps, assets)
}
