import type { MutableRefObject } from 'react'
import * as C from '../constants'
import * as N from '../ncConstants'
import { ncSheet } from '../ncConstants'
import { ncHitDamage } from '../scaling'
import { createNcEnemySystem } from './ncEnemy'
import type { NcAssets, NcBehavior, NcEnemyDeps } from './ncEnemy'

/**
 * АРБАЛЕТЧИК (09.11.2026). Держит дистанцию: ближе 2 клеток — пятится (не
 * прыгает и с края не сходит; упёрся — стреляет с места). 3–8 клеток и герой
 * на его ярусе — Crossbowman_Shoot: на кадре release болт летит строго по
 * горизонтали, 700 px/с, до стены или 10 клеток. Сразу после выстрела —
 * Crossbowman_Reload целиком; пока перезаряжает, не стреляет (окно добежать).
 * Ближнего удара нет.
 */
const SHOOT = 'Crossbowman_Shoot'

const behavior: NcBehavior = {
  kind: 'crossbowman',
  hpMult: N.NC_HP_MULT.crossbowman,
  // Общая погоня подводит его на дистанцию выстрела, не вплотную.
  stopGap: () => (N.CROSSBOW_SHOOT_MAX_TILES - 2) * C.TILE_SIZE,
  windupFrame: (action) => (action === 'Shoot' ? ncSheet(SHOOT).release! : null),
  decide(ctx, e, v, dt) {
    const nc = e.nc!
    const T = C.TILE_SIZE
    const toward: 1 | -1 = v.dx >= 0 ? 1 : -1
    if (nc.needReload) {
      e.facing = toward
      ctx.start(e, 'Reload')
      return true
    }
    let cornered = false
    if (v.dist < N.CROSSBOW_RETREAT_TILES * T) {
      // Пятится лицом к герою; упёрся — стреляет как есть.
      const away: 1 | -1 = toward > 0 ? -1 : 1
      if (ctx.stepX(e, away, C.ZVONAR_RETREAT_SPEED, dt, false)) {
        e.facing = toward
        return true
      }
      cornered = true
    }
    if (v.sameTier && v.dist <= N.CROSSBOW_SHOOT_MAX_TILES * T && nc.cooldownMs <= 0
      && (cornered || v.dist >= N.CROSSBOW_RETREAT_TILES * T)) {
      e.facing = toward
      ctx.start(e, 'Shoot')
      return true
    }
    if (v.dist < N.RANGED_MIN_TILES * T) {
      // Близко, но стрелять нельзя (кулдаун) — стоит лицом к герою.
      e.facing = toward
      return true
    }
    return false
  },
  onAction(ctx, e, action, frame) {
    const nc = e.nc!
    if (action !== 'Shoot' || nc.keyDone || frame < ncSheet(SHOOT).release!) return
    nc.keyDone = true
    nc.needReload = true
    const p = ctx.spawnPoint(e, SHOOT)
    ctx.deps.projectiles.fire({
      kind: 'bolt',
      texture: ctx.assets.extra.bolt,
      scale: ctx.scale,
      x: p.x,
      y: p.y,
      dirX: e.facing,
      dirY: 0,
      damage: ncHitDamage(N.CROSSBOW_BOLT_DMG_MULT, e.attackDamage),
      owner: e,
    })
  },
  onActionEnd(ctx, e, action) {
    const nc = e.nc!
    if (action === 'Shoot') {
      // Перезарядка — сразу, без паузы.
      nc.cooldownMs = 0
      ctx.start(e, 'Reload')
    } else if (action === 'Reload') {
      nc.needReload = false
      nc.cooldownMs = 0
    }
  },
}

export function createCrossbowmanSystem(deps: NcEnemyDeps, assets: MutableRefObject<NcAssets | null>) {
  return createNcEnemySystem(behavior, deps, assets)
}
