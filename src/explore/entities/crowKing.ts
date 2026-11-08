import type { Boss } from '../types'
import * as C from '../constants'
import * as N from '../ncConstants'
import { ncSheet } from '../ncConstants'
import { isSolid, cellFootBlockTop } from '../collision'
import { perceive, lookAround, BOSS_PERCEPTION } from '../perception'
import { createNcBossCore } from './ncBoss'
import type { NcBossDeps } from './ncBoss'

/**
 * ВОРОНИЙ КОРОЛЬ (09.11.2026) — босс карт C и C2 (бросает сервер, bossKind).
 * Ходит к герою (BOSS_MOVE_SPEED).
 *   Крыло (CrowKing_Strike) — герой в reachPx: урон ×1.3 в окне hit.
 *   Стая — раз в ≈8 с, ИЛИ герой недосягаем (другой этаж) дольше 2 с, ИЛИ после
 *   3 полученных ударов подряд: CrowKing_Scatter (неуязвим), летит невидимым к
 *   точке на полу героя в 3 клетках ЗА его спиной (нельзя — перед ним), там тот
 *   же лист задом наперёд (сборка, неуязвим) и СРАЗУ крыло. Вороны в полёте
 *   урона не наносят.
 * Глаза — красные огни под клювом, уже в листах.
 */
export function createCrowKingSystem(deps: NcBossDeps) {
  const core = createNcBossCore('crowking', deps)
  const sheet = core.sheet
  const T = C.TILE_SIZE

  function spawn(tileX: number, tileY: number) {
    core.spawn(tileX, tileY)
  }

  /** Встанет ли бокс короля с центром x на полу floorY (сплошной пол, без стен). */
  function standsAt(boss: Boss, x: number, floorY: number): boolean {
    const nc = boss.nc!
    const left = x - nc.w / 2
    const right = x + nc.w / 2
    if (left < 0 || right > deps.grid[0].length * T) return false
    const row = Math.floor((floorY + 1) / T)
    for (let px = left + 2; px <= right - 2; px += T / 2) {
      if (cellFootBlockTop(deps.grid, T, Math.floor(px / T), row) === null) return false
      for (let py = floorY - nc.h + 4; py < floorY - 2; py += T / 2) {
        if (isSolid(deps.grid, T, px, py)) return false
      }
    }
    return true
  }

  /** Точка сборки: за спиной героя, на его полу; нельзя — перед ним. */
  function gatherPoint(boss: Boss): { x: number; floorY: number } | null {
    const pb = deps.getPlayerCombatBox()
    const heroCx = pb.x + pb.w / 2
    // Пол героя: под ногами; в прыжке — ближайший пол ниже.
    let floorY = deps.phys.y + C.PLAYER_HEIGHT
    let row = Math.floor((floorY + 1) / T)
    for (let k = 0; k < 12 && cellFootBlockTop(deps.grid, T, Math.floor(heroCx / T), row) === null; k++) row++
    floorY = row * T
    const behindDir = -deps.heroFacing() as 1 | -1
    for (const dir of [behindDir, -behindDir as 1 | -1]) {
      for (let d = N.CROWKING_BEHIND_TILES; d >= 1.5; d -= 0.5) {
        const x = heroCx + dir * d * T
        if (standsAt(boss, x, floorY)) return { x, floorY }
      }
    }
    return null
  }

  function updateBoss(boss: Boss, dt: number, deltaMS: number) {
    const nc = boss.nc!
    if (nc.invulnerable) boss.stunTimer = 0
    if (core.gates(boss, deltaMS)) return
    if (!nc.hidden) core.applyGravity(boss, dt)

    const pb = deps.getPlayerCombatBox()
    const cx = boss.x + nc.w / 2
    const dx = pb.x + pb.w / 2 - cx
    const { aggroed } = perceive(
      boss,
      { x: boss.x, y: boss.y, w: nc.w, h: nc.h },
      { x: pb.x, y: deps.phys.y, w: pb.w, h: C.PLAYER_HEIGHT },
      deps.grid,
      deltaMS,
      BOSS_PERCEPTION,
    )
    boss.attackCooldownTimer = Math.max(0, boss.attackCooldownTimer - deltaMS)
    nc.scatterCooldownMs = Math.max(0, nc.scatterCooldownMs - deltaMS)
    const sameTier = pb.y < boss.y + nc.h && pb.y + pb.h > boss.y
    nc.unreachableMs = aggroed && !sameTier ? nc.unreachableMs + deltaMS : 0

    if (!nc.action && boss.hurtTimer <= 0) {
      if (aggroed) {
        boss.facing = dx >= 0 ? 1 : -1
        const footX = boss.sprite.x
        const gap = Math.max(0, dx >= 0 ? pb.x - footX : footX - (pb.x + pb.w))
        const reach = (ncSheet(sheet('Strike')).reachPx ?? 0) * core.scale
        const wantScatter = nc.scatterCooldownMs <= 0
          || nc.unreachableMs > N.CROWKING_UNREACHABLE_MS
          || nc.hitsInRow >= N.CROWKING_HITS_TO_SCATTER
        const point = wantScatter ? gatherPoint(boss) : null
        if (point) {
          nc.targetX = point.x
          nc.targetFloorY = point.floorY
          nc.hitsInRow = 0
          nc.unreachableMs = 0
          nc.scatterCooldownMs = N.CROWKING_SCATTER_INTERVAL_MS
          core.startAction(boss, 'Scatter')
          nc.invulnerable = true
        } else if (sameTier && gap <= reach * 0.85 && boss.attackCooldownTimer <= 0) {
          core.startAction(boss, 'Strike')
        } else if (sameTier) {
          boss.moving = gap > reach * 0.6
          if (boss.moving && !core.stepX(boss, boss.facing, C.BOSS_MOVE_SPEED, dt)) boss.moving = false
        } else {
          boss.moving = false
        }
        if (wantScatter && !point) nc.scatterCooldownMs = 1500
      } else if (boss.investigateTimer > 0 && boss.investigateX !== null) {
        const dir = Math.sign(boss.investigateX - cx)
        if (dir !== 0) boss.facing = dir as 1 | -1
        boss.moving = Math.abs(boss.investigateX - cx) > C.BOSS_MOVE_SPEED * dt && core.stepX(boss, dir, C.BOSS_MOVE_SPEED, dt)
        if (!boss.moving) {
          boss.investigateTimer = 0
          boss.investigateLookTimer = C.INVESTIGATE_LOOK_MS
        }
      } else {
        boss.moving = false
        lookAround(boss, deltaMS, C.BOSS_IDLE_TURN_MS)
      }
    }

    if (nc.action) {
      const action = nc.action
      nc.actionMs += deltaMS
      const frame = boss.sprite.currentFrame
      if (action === 'Strike' && !nc.hitDone) {
        const [h0, h1] = ncSheet(sheet('Strike')).hit!
        if (frame >= h0 && frame <= h1 && core.strike(boss, sheet('Strike'), boss.meleeDamage) !== 'miss') nc.hitDone = true
      } else if (action === 'Fly') {
        if (nc.actionMs >= N.CROWKING_FLY_MS) {
          boss.x = nc.targetX - nc.w / 2
          boss.y = nc.targetFloorY - nc.h
          boss.vy = 0
          nc.hidden = false
          const pb2 = deps.getPlayerCombatBox()
          boss.facing = pb2.x + pb2.w / 2 >= nc.targetX ? 1 : -1
          core.startAction(boss, 'Scatter', { reversed: true })
          nc.action = 'Gather'
          nc.invulnerable = true
        }
      }
      const ended = action !== 'Fly' && nc.action === action && (boss.sprite.currentFrame >= boss.sprite.totalFrames - 1 || !boss.sprite.playing)
      if (ended) {
        if (action === 'Scatter') {
          nc.hidden = true
          nc.action = 'Fly'
          nc.actionMs = 0
          boss.sprite.stop()
        } else if (action === 'Gather') {
          // Собрался — сразу крыло.
          nc.invulnerable = false
          core.startAction(boss, 'Strike')
        } else {
          if (action === 'Strike') nc.hitsInRow = 0
          core.endAction(boss)
          core.play(boss, sheet('Idle'))
        }
      }
    } else if (boss.hurtTimer > 0) {
      boss.hurtTimer = Math.max(0, boss.hurtTimer - deltaMS)
      core.play(boss, core.hurtName)
    } else if (boss.moving) {
      core.play(boss, sheet('Walk'))
    } else {
      core.play(boss, sheet('Idle'))
    }

    core.tickFlash(boss, deltaMS)
    core.pushOut(boss)
    core.layout(boss)
  }

  function update(dt: number, deltaMS: number) {
    const boss = deps.boss.current
    if (boss?.nc?.kind === 'crowking') updateBoss(boss, dt, deltaMS)
  }

  /** Попадание по Королю (Explore, damageBoss): три подряд — стая. */
  function onHit(boss: Boss) {
    if (boss.nc) boss.nc.hitsInRow += 1
  }

  return { spawn, update, dispose: core.dispose, playBossKind: core.playBossKind, layout: core.layout, onHit }
}
