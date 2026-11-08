import { AnimatedSprite, Graphics, Sprite } from 'pixi.js'
import type { Texture } from 'pixi.js'
import type { Boss } from '../types'
import * as C from '../constants'
import * as N from '../ncConstants'
import { ncSheet } from '../ncConstants'
import { isSolid, cellFootBlockTop } from '../collision'
import { perceive, lookAround, BOSS_PERCEPTION } from '../perception'
import { createNcBossCore } from './ncBoss'
import type { NcBossDeps } from './ncBoss'
import { sheetPointToWorld } from './ncEnemy'
import type { NcProjectileSystem } from './ncProjectiles'

/**
 * КОСТЯНОЙ ЗМЕЙ (09.11.2026) — босс карт C и C2 (бросает сервер, bossKind).
 * Сидит в куче земли, сам не ходит. Хитбокс — вся видимая фигура до земли
 * (шея и куча), чтобы горизонтальный меч доставал.
 *
 *   Укус (Serpent_Bite)  — герой в reachPx: урон ×1.3 в окне hit.
 *   Плевок (Serpent_Spit) — дальше укуса: на release одной группой кости
 *                           прямо в центр героя, 900 px/с, урон ×1.0.
 *   Удар головой (Serpent_Slam) — раз в 5 с, если герой на том же полу: на
 *                           кадре impact в точке impactPoint волна по полу к
 *                           герою (как волна топота), перепрыгивается.
 *   Нырок — раз в ≈10 с: Submerge (с середины листа неуязвим) → под землёй;
 *           под героем 0.8 с трясётся пол и бегут трещины → Emerge там;
 *           урон ×1.5 тому, кто над кучей в первые 10 кадров. Куча (5.5
 *           клетки) целиком на сплошном полу арены; нет такого места — нет нырка.
 *   Ярость при ≤ 50% HP, один раз: Serpent_Roar (неуязвим), глаза загораются
 *           на кадрах eyesIgnite; дальше свечение глаз на всех листах (eyes),
 *           атаки на 15% быстрее, нырок — два подряд.
 */
export type SerpentExtraDeps = {
  projectiles: NcProjectileSystem
  waveLeftFrames: Texture[]
  waveRightFrames: Texture[]
}

type SerpentWave = { sprite: AnimatedSprite; dir: 1 | -1; floorY: number; travelled: number; damage: number }

const ATTACK_SHEETS = new Set(['Bite', 'Spit', 'Slam', 'Submerge', 'Emerge'])

export function createSerpentSystem(deps: NcBossDeps, extra: SerpentExtraDeps) {
  const core = createNcBossCore('serpent', deps)
  const sheet = core.sheet
  const T = C.TILE_SIZE
  let waves: SerpentWave[] = []
  let floorRuns: [number, number][] = [] // [левый край, правый край] пола, px мира
  let floorRow = 0
  const cracks = new Graphics()
  deps.worldContainer.addChild(cracks)
  let cracksFadeMs = 0
  const eye = new Sprite(deps.assets.extra.eye)
  eye.anchor.set(0.5)
  eye.blendMode = 'add'
  eye.tint = N.SERPENT_EYE_TINT
  eye.width = N.SERPENT_EYE_DRAW
  eye.height = N.SERPENT_EYE_DRAW
  eye.visible = false
  let eyeMs = 0

  /** Сплошной пол арены (#) с тремя свободными клетками над ним — где может встать куча. */
  function scanFloor(boss: Boss) {
    const nc = boss.nc!
    floorRow = Math.floor((boss.y + nc.h + 1) / T)
    const g = deps.grid
    floorRuns = []
    let start = -1
    for (let x = 0; x <= g[0].length; x++) {
      const ok = x < g[0].length && g[floorRow]?.[x] === '#'
        && !isSolid(g, T, x * T + T / 2, (floorRow - 1) * T + T / 2)
        && !isSolid(g, T, x * T + T / 2, (floorRow - 2) * T + T / 2)
        && !isSolid(g, T, x * T + T / 2, (floorRow - 3) * T + T / 2)
      if (ok && start < 0) start = x
      if (!ok && start >= 0) {
        if (x - start >= N.SERPENT_MIN_FLOOR_TILES) floorRuns.push([start * T, x * T])
        start = -1
      }
    }
  }

  function spawn(tileX: number, tileY: number) {
    const boss = core.spawn(tileX, tileY)
    deps.worldContainer.addChild(eye)
    // Встал на пол — пол арены известен.
    core.applyGravity(boss, 1)
    scanFloor(boss)
  }

  /** Куда вынырнуть: под героем, куча целиком на сплошном полу; ближе всего. */
  function emergeX(): number | null {
    if (floorRuns.length === 0) return null
    const pb = deps.getPlayerCombatBox()
    const want = pb.x + pb.w / 2
    const half = (N.SERPENT_HEAP_TILES * T) / 2
    let best: number | null = null
    for (const [l, r] of floorRuns) {
      const x = Math.min(r - half, Math.max(l + half, want))
      if (best === null || Math.abs(x - want) < Math.abs(best - want)) best = x
    }
    return best
  }

  function spitBones(boss: Boss) {
    const p = sheetPointToWorld(boss.sprite.x, boss.sprite.y, boss.facing, core.scale, sheet('Spit'), ...(ncSheet(sheet('Spit')).spawn as [number, number]))
    const pb = deps.getPlayerCombatBox()
    const dx = pb.x + pb.w / 2 - p.x
    const dy = pb.y + pb.h / 2 - p.y
    const len = Math.hypot(dx, dy) || 1
    extra.projectiles.fire({
      kind: 'bones',
      texture: deps.assets.extra.bones,
      scale: core.scale,
      x: p.x,
      y: p.y,
      dirX: dx / len,
      dirY: dy / len,
      damage: boss.spikeDamage,
      owner: 'boss',
    })
  }

  function slamWave(boss: Boss) {
    const spec = ncSheet(sheet('Slam'))
    const p = sheetPointToWorld(boss.sprite.x, boss.sprite.y, boss.facing, core.scale, sheet('Slam'), ...(spec.impactPoint as [number, number]))
    const pb = deps.getPlayerCombatBox()
    const dir: 1 | -1 = pb.x + pb.w / 2 >= p.x ? 1 : -1
    const frames = dir === -1 ? extra.waveLeftFrames : extra.waveRightFrames
    if (frames.length === 0) return
    const sprite = new AnimatedSprite(frames)
    sprite.anchor.set(dir === -1 ? 1 : 0, C.BOSS_WAVE_ANCHOR_Y)
    sprite.loop = true
    sprite.animationSpeed = C.BOSS_WAVE_ANIM_SPEED
    sprite.height = C.BOSS_WAVE_DRAW_H
    sprite.width = dir === -1
      ? C.BOSS_WAVE_DRAW_H * (C.BOSS_WAVE_SPLIT_X / C.BOSS_WAVE_CELL_H)
      : C.BOSS_WAVE_DRAW_H * ((C.BOSS_WAVE_CELL_W - C.BOSS_WAVE_SPLIT_X) / C.BOSS_WAVE_CELL_H)
    const floorY = boss.y + boss.nc!.h
    sprite.x = p.x
    sprite.y = floorY
    sprite.play()
    deps.worldContainer.addChild(sprite)
    waves.push({ sprite, dir, floorY, travelled: 0, damage: boss.waveDamage })
  }

  function updateWaves(deltaMS: number) {
    if (waves.length === 0) return
    const alive: SerpentWave[] = []
    for (const w of waves) {
      const step = C.BOSS_WAVE_SPEED * (deltaMS / 1000)
      w.sprite.x += w.dir * step
      w.travelled += step
      let remove = w.travelled > 20 * T
      const centerY = w.floorY - C.BOSS_WAVE_DRAW_H / 2
      if (!remove && isSolid(deps.grid, T, w.sprite.x + w.dir * (C.BOSS_WAVE_DRAW_W / 2), centerY)) remove = true
      if (!remove && cellFootBlockTop(deps.grid, T, Math.floor(w.sprite.x / T), Math.floor(w.floorY / T)) === null) remove = true
      if (!remove && !deps.dashing.current) {
        const b = deps.getPlayerCombatBox()
        const left = w.sprite.x - C.BOSS_WAVE_DRAW_W / 2
        const top = w.floorY - C.BOSS_WAVE_DRAW_H
        if (b.x < left + C.BOSS_WAVE_DRAW_W && b.x + b.w > left && b.y < top + C.BOSS_WAVE_DRAW_H && b.y + b.h > top) {
          remove = true
          deps.takeDamageUnblockable(w.damage)
        }
      }
      if (remove) {
        deps.worldContainer.removeChild(w.sprite)
        w.sprite.destroy()
      } else alive.push(w)
    }
    waves = alive
  }

  // Трещины и пыль под героем перед выныриванием — процедурно, 0.8 с.
  function drawQuake(nc: NonNullable<Boss['nc']>, deltaMS: number) {
    cracks.clear()
    if (nc.quakeMs <= 0 && cracksFadeMs <= 0) return
    const k = nc.quakeMs > 0 ? 1 - nc.quakeMs / N.SERPENT_QUAKE_MS : 1
    const alpha = nc.quakeMs > 0 ? 1 : cracksFadeMs / 400
    if (nc.quakeMs <= 0) cracksFadeMs = Math.max(0, cracksFadeMs - deltaMS)
    const half = (N.SERPENT_HEAP_TILES * T) / 2
    const shake = nc.quakeMs > 0 ? (Math.random() - 0.5) * 4 : 0
    cracks.x = nc.diveX + shake
    cracks.y = nc.diveFloorY
    // Ветвистые трещины из центра, растут к краям кучи: тёмный разлом с
    // бурой кромкой, чтобы читался и на тёмном полу.
    const len = half * Math.min(1, k * 1.3)
    for (const dir of [-1, 1]) {
      const pts: [number, number][] = [[0, 0]]
      for (let s = 1; s <= 6; s++) pts.push([dir * (len * s) / 6, ((s * 37) % 7) - 3])
      for (const [w, color] of [[7, 0x120a05], [3, 0x7a5232]] as const) {
        cracks.moveTo(0, 0)
        for (const [x, y] of pts.slice(1)) cracks.lineTo(x, y)
        cracks.stroke({ width: w, color, alpha })
      }
      for (const f of [0.35, 0.7]) {
        const bx = dir * len * f
        cracks.moveTo(bx, 0).lineTo(bx + dir * 14, -12).stroke({ width: 4, color: 0x120a05, alpha })
      }
    }
    // Пыль над трещинами.
    if (nc.quakeMs > 0) {
      for (let i = 0; i < 10; i++) {
        const px = (Math.random() - 0.5) * half * 2 * k
        cracks.circle(px, -6 - Math.random() * 26 * k, 5 + Math.random() * 8).fill({ color: 0xa08a6a, alpha: 0.45 })
      }
    }
  }

  function updateEyes(boss: Boss, deltaMS: number) {
    const nc = boss.nc!
    eyeMs += deltaMS
    const name = (nc.anim ?? '').split('#')[0]
    let spec
    try { spec = ncSheet(name) } catch { eye.visible = false; return }
    const raw = boss.sprite.currentFrame
    const frame = spec.playOrder ? spec.playOrder[Math.min(raw, spec.playOrder.length - 1)] : raw
    const pt = spec.eyes?.[Math.min(frame, (spec.eyes?.length ?? 1) - 1)]
    let glow = nc.enraged ? 1 : 0
    if (!nc.enraged && nc.action === 'Roar' && spec.eyesIgnite) {
      const [i0, i1] = spec.eyesIgnite
      glow = Math.min(1, Math.max(0, (frame - i0 + 1) / (i1 - i0 + 1)))
    }
    if (!pt || glow <= 0 || nc.hidden || pt[2] <= 0) { eye.visible = false; return }
    const w = sheetPointToWorld(boss.sprite.x, boss.sprite.y, boss.facing, core.scale, name, pt[0], pt[1])
    eye.visible = true
    eye.x = w.x
    eye.y = w.y
    eye.alpha = pt[2] * glow * (0.85 + 0.15 * Math.sin(eyeMs / 70) * Math.sin(eyeMs / 173))
  }

  function speedOf(action: string, nc: NonNullable<Boss['nc']>) {
    return nc.enraged && ATTACK_SHEETS.has(action) ? N.SERPENT_RAGE_SPEED : 1
  }

  function startDive(boss: Boss) {
    const nc = boss.nc!
    if (nc.divesLeft <= 0) nc.divesLeft = nc.enraged ? 2 : 1
    core.startAction(boss, 'Submerge', { speedMult: speedOf('Submerge', nc) })
  }

  function updateBoss(boss: Boss, dt: number, deltaMS: number) {
    const nc = boss.nc!
    // Лёд под землёй и на неуязвимых листах не действует (стоял бы таймер нырка).
    if (nc.invulnerable) boss.stunTimer = 0
    if (core.gates(boss, deltaMS)) return
    core.applyGravity(boss, dt)

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
    nc.slamCooldownMs = Math.max(0, nc.slamCooldownMs - deltaMS)
    nc.diveCooldownMs = Math.max(0, nc.diveCooldownMs - deltaMS)

    // Ярость — один раз, на половине HP; обрывает обычную атаку (не нырок).
    const diving = nc.action === 'Submerge' || nc.action === 'Quake' || nc.action === 'Emerge'
    if (!nc.enraged && nc.action !== 'Roar' && !diving && boss.hp <= boss.maxHp * N.SERPENT_RAGE_HP_FRAC) {
      boss.hurtTimer = 0
      core.startAction(boss, 'Roar')
      nc.invulnerable = true
    }

    if (!nc.action && boss.hurtTimer <= 0) {
      if (aggroed) {
        boss.facing = dx >= 0 ? 1 : -1
        const footX = boss.sprite.x
        const gap = Math.max(0, dx >= 0 ? pb.x - footX : footX - (pb.x + pb.w))
        const sameFloor = deps.phys.onGround && Math.abs(deps.phys.y + C.PLAYER_HEIGHT - (boss.y + nc.h)) < T * 0.6
        if (nc.diveCooldownMs <= 0 && floorRuns.length > 0) startDive(boss)
        else if (nc.slamCooldownMs <= 0 && sameFloor) core.startAction(boss, 'Slam', { speedMult: speedOf('Slam', nc) })
        else if (boss.attackCooldownTimer <= 0) {
          const biteReach = (ncSheet(sheet('Bite')).reachPx ?? 0) * core.scale
          if (gap <= biteReach * 0.9 && pb.y < boss.y + nc.h && pb.y + pb.h > boss.y) core.startAction(boss, 'Bite', { speedMult: speedOf('Bite', nc) })
          else core.startAction(boss, 'Spit', { speedMult: speedOf('Spit', nc) })
        }
      } else if (boss.investigateLookTimer > 0 || boss.investigateTimer > 0) {
        if (boss.investigateX !== null) boss.facing = boss.investigateX >= cx ? 1 : -1
      } else {
        lookAround(boss, deltaMS, C.BOSS_IDLE_TURN_MS)
      }
    }

    // --- Действие и его ключевые кадры ---
    if (nc.action) {
      const action = nc.action
      nc.actionMs += deltaMS
      const frame = boss.sprite.currentFrame
      if (action === 'Bite' && !nc.hitDone) {
        const [h0, h1] = ncSheet(sheet('Bite')).hit!
        if (frame >= h0 && frame <= h1 && core.strike(boss, sheet('Bite'), boss.meleeDamage) !== 'miss') nc.hitDone = true
      } else if (action === 'Spit' && !nc.keyDone && frame >= ncSheet(sheet('Spit')).release!) {
        nc.keyDone = true
        spitBones(boss)
      } else if (action === 'Slam' && !nc.keyDone && frame >= ncSheet(sheet('Slam')).impact!) {
        nc.keyDone = true
        nc.slamCooldownMs = N.SERPENT_SLAM_INTERVAL_MS
        slamWave(boss)
      } else if (action === 'Submerge' && frame >= ncSheet(sheet('Submerge')).count / 2) {
        nc.invulnerable = true
      } else if (action === 'Quake') {
        nc.quakeMs = Math.max(0, nc.quakeMs - deltaMS)
        if (nc.quakeMs <= 0) {
          boss.x = nc.diveX - nc.w / 2
          boss.y = nc.diveFloorY - nc.h
          boss.vy = 0
          nc.hidden = false
          cracksFadeMs = 400
          const pb2 = deps.getPlayerCombatBox()
          boss.facing = pb2.x + pb2.w / 2 >= nc.diveX ? 1 : -1
          core.startAction(boss, 'Emerge', { speedMult: speedOf('Emerge', nc) })
          nc.invulnerable = true
        }
      } else if (action === 'Emerge') {
        if (frame < N.SERPENT_EMERGE_HIT_FRAMES) {
          if (!nc.hitDone && !deps.dashing.current) {
            const half = (N.SERPENT_HEAP_TILES * T) / 2
            const b = deps.getPlayerCombatBox()
            const over = b.x < nc.diveX + half && b.x + b.w > nc.diveX - half && b.y + b.h > nc.diveFloorY - 3 * T && b.y < nc.diveFloorY
            if (over) {
              nc.hitDone = true
              deps.takeDamageUnblockable(boss.melee2Damage)
            }
          }
        } else nc.invulnerable = false
      }
      // Кадры листа кончились (у Quake листа нет — его ведёт таймер).
      const ended = action !== 'Quake' && nc.action === action && (boss.sprite.currentFrame >= boss.sprite.totalFrames - 1 || !boss.sprite.playing)
      if (ended) {
        if (action === 'Submerge') {
          const x = emergeX()
          nc.hidden = true
          nc.invulnerable = true
          if (x === null) {
            // Места нет — выныривает там же.
            nc.diveX = boss.x + nc.w / 2
          } else nc.diveX = x
          nc.diveFloorY = floorRow * T
          nc.quakeMs = N.SERPENT_QUAKE_MS
          nc.action = 'Quake'
          boss.sprite.stop()
        } else if (action === 'Emerge') {
          core.endAction(boss)
          nc.divesLeft -= 1
          if (nc.divesLeft > 0) startDive(boss)
          else nc.diveCooldownMs = N.SERPENT_DIVE_INTERVAL_MS
        } else if (action === 'Roar') {
          core.endAction(boss)
          nc.enraged = true
        } else {
          core.endAction(boss)
        }
        if (!nc.action) core.play(boss, sheet('Idle'))
      }
    } else if (boss.hurtTimer > 0) {
      boss.hurtTimer = Math.max(0, boss.hurtTimer - deltaMS)
      core.play(boss, core.hurtName)
    } else {
      core.play(boss, sheet('Idle'))
    }

    core.tickFlash(boss, deltaMS)
    core.pushOut(boss)
    core.layout(boss)
  }

  function update(dt: number, deltaMS: number) {
    const boss = deps.boss.current
    if (boss?.nc?.kind === 'serpent') {
      updateBoss(boss, dt, deltaMS)
      drawQuake(boss.nc, deltaMS)
      updateEyes(boss, deltaMS)
    }
    updateWaves(deltaMS)
  }

  function dispose() {
    for (const w of waves) {
      deps.worldContainer.removeChild(w.sprite)
      w.sprite.destroy()
    }
    waves = []
    core.dispose()
  }

  return { spawn, update, dispose, playBossKind: core.playBossKind, layout: core.layout }
}
