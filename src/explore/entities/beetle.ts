import type { MutableRefObject } from 'react'
import * as C from '../constants'
import * as N from '../ncConstants'
import { ncSheet } from '../ncConstants'
import { ncHitDamage } from '../scaling'
import { createNcEnemySystem } from './ncEnemy'
import type { NcAssets, NcBehavior, NcEnemyDeps } from './ncEnemy'

/**
 * НАВОЗНИК (жук, 09.11.2026). Дальше 3 и до 7 клеток — Beetle_Throw: на кадре
 * release дугой летит ком грязи; попадание — урон и замедление героя (Explore,
 * slowHero), падение — бурое пятно на секунду. Ближе 3 клеток — Beetle_Dash: в
 * кадрах telegraph стоит (предупреждение), в кадрах thrust код двигает его
 * вперёд на BEETLE_DASH_PX (ease-out), останавливаясь у края и стены; урон —
 * при касании во время thrust, один раз за рывок. Тело в листе
 * стабилизировано — всё движение делает код.
 */
const THROW = 'Beetle_Throw'
const DASH = 'Beetle_Dash'

const behavior: NcBehavior = {
  kind: 'beetle',
  hpMult: N.NC_HP_MULT.beetle,
  stopGap: () => C.TILE_SIZE * 1.2,
  windupFrame: (action) => (action === 'Dash' ? ncSheet(DASH).thrust![0] : action === 'Throw' ? ncSheet(THROW).release! : null),
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
    if (v.sameTier && v.gap <= N.RANGED_MIN_TILES * T) {
      e.facing = v.dx >= 0 ? 1 : -1
      ctx.start(e, 'Dash')
      return true
    }
    return false
  },
  onAction(ctx, e, action, frame) {
    const nc = e.nc!
    if (action === 'Throw') {
      if (nc.keyDone || frame < ncSheet(THROW).release!) return
      nc.keyDone = true
      const p = ctx.spawnPoint(e, THROW)
      const pb = ctx.deps.getPlayerCombatBox()
      ctx.deps.projectiles.fire({
        kind: 'mud',
        texture: ctx.assets.extra.mud,
        scale: ctx.scale,
        x: p.x,
        y: p.y,
        targetX: pb.x + pb.w / 2,
        targetY: pb.y + pb.h * 0.55,
        damage: ncHitDamage(N.BEETLE_MUD_DMG_MULT, e.attackDamage),
        owner: e,
      })
      return
    }
    if (action !== 'Dash') return
    const spec = ncSheet(DASH)
    const [t0, t1] = spec.thrust!
    if (frame < t0) return
    // Прогресс рывка — по времени действия от начала кадров thrust, ease-out.
    const tStart = (t0 / spec.fps!) * 1000
    const tEnd = ((t1 + 1) / spec.fps!) * 1000
    const p = Math.min(1, Math.max(0, (nc.actionMs - tStart) / (tEnd - tStart)))
    const eased = 1 - (1 - p) * (1 - p)
    const want = N.BEETLE_DASH_PX * eased - nc.dashMoved
    if (want > 0) {
      // Шагами не больше 8 px: стена и край проверяются по пути, не перепрыгиваются.
      let left = want
      while (left > 0) {
        const step = Math.min(8, left)
        if (!ctx.stepX(e, e.facing, step, 1, false)) { nc.dashMoved = N.BEETLE_DASH_PX; break }
        nc.dashMoved += step
        left -= step
      }
    }
    if (!nc.hitDone && frame <= t1) {
      const pb = ctx.deps.getPlayerCombatBox()
      const touch = pb.x < e.x + e.width && pb.x + pb.w > e.x && pb.y < e.y + e.height && pb.y + pb.h > e.y
      if (touch) {
        nc.hitDone = true
        if (ctx.deps.takeDamage(ncHitDamage(N.BEETLE_DASH_DMG_MULT, e.attackDamage), e)) {
          e.parryStunTimer = C.PARRY_STUN_MS
          e.attackAnimPlaying = false
          e.windingUp = false
          nc.action = null
          nc.cooldownMs = N.NC_ATTACK_COOLDOWN_MS
        }
      }
    }
  },
}

export function createBeetleSystem(deps: NcEnemyDeps, assets: MutableRefObject<NcAssets | null>) {
  return createNcEnemySystem(behavior, deps, assets)
}
