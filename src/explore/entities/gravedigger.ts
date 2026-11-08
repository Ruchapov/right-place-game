import type { MutableRefObject } from 'react'
import * as C from '../constants'
import * as N from '../ncConstants'
import { ncSheet } from '../ncConstants'
import { ncHitDamage } from '../scaling'
import { createNcEnemySystem } from './ncEnemy'
import type { NcAssets, NcBehavior, NcEnemyDeps } from './ncEnemy'

/**
 * ГРОБОКОПАТЕЛЬ (09.11.2026). Дальше 3 и до 7 клеток — бросает ком земли
 * дугой в точку, где герой стоит в момент броска (Gravedigger_Throw, вылет на
 * кадре release из точки spawn). Ближе 3 клеток — лопатой (Gravedigger_Swing,
 * урон в окне hit, дальность reachPx).
 */
const THROW = 'Gravedigger_Throw'
const SWING = 'Gravedigger_Swing'

const behavior: NcBehavior = {
  kind: 'gravedigger',
  hpMult: N.NC_HP_MULT.gravedigger,
  stopGap: (ctx) => ctx.reach(SWING) * 0.7,
  windupFrame: (action) => (action === 'Swing' ? ncSheet(SWING).hit![0] : action === 'Throw' ? ncSheet(THROW).release! : null),
  decide(ctx, e, v) {
    const nc = e.nc!
    const T = C.TILE_SIZE
    // Дистанция — зазор от точки ног до героя: у жука тело во всю клетку и шире.
    if (v.gap > N.RANGED_MIN_TILES * T && v.gap <= N.RANGED_MAX_TILES * T) {
      e.facing = v.dx >= 0 ? 1 : -1
      // В полосе броска не подходит: ждёт паузу и бросает снова.
      if (nc.cooldownMs <= 0) ctx.start(e, 'Throw')
      return true
    }
    if (nc.cooldownMs > 0) return false
    if (v.sameTier && v.gap <= ctx.reach(SWING) * 0.85) {
      e.facing = v.dx >= 0 ? 1 : -1
      ctx.start(e, 'Swing')
      return true
    }
    return false
  },
  onAction(ctx, e, action, frame) {
    const nc = e.nc!
    if (action === 'Swing' && !nc.hitDone) {
      const [h0, h1] = ncSheet(SWING).hit!
      if (frame >= h0 && frame <= h1) {
        if (ctx.meleeStrike(e, SWING, ncHitDamage(N.GRAVEDIGGER_SHOVEL_DMG_MULT, e.attackDamage)) !== 'miss') nc.hitDone = true
      }
    } else if (action === 'Throw' && !nc.keyDone && frame >= ncSheet(THROW).release!) {
      nc.keyDone = true
      const p = ctx.spawnPoint(e, THROW)
      const pb = ctx.deps.getPlayerCombatBox()
      ctx.deps.projectiles.fire({
        kind: 'clod',
        texture: ctx.assets.extra.clod,
        scale: ctx.scale,
        x: p.x,
        y: p.y,
        targetX: pb.x + pb.w / 2,
        targetY: pb.y + pb.h * 0.55,
        damage: ncHitDamage(N.GRAVEDIGGER_CLOD_DMG_MULT, e.attackDamage),
        owner: e,
      })
    }
  },
}

export function createGravediggerSystem(deps: NcEnemyDeps, assets: MutableRefObject<NcAssets | null>) {
  return createNcEnemySystem(behavior, deps, assets)
}
