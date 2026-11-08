import type { MutableRefObject } from 'react'
import { AnimatedSprite, Graphics, Text } from 'pixi.js'
import type { Container } from 'pixi.js'
import type { Boss, BossAnimKind, DamageSource, Grid, NcBossState, PlayerPhysics, SheetBossKind } from '../types'
import * as C from '../constants'
import * as N from '../ncConstants'
import { isSolid, sweepFootBlock, cellFootBlockTop } from '../collision'
import { clamp, parryStunFrame } from '../utils'
import { syncMark } from '../perception'
import { scaledBossMaxHp, scaledBossMeleeDamage, scaledBossSpikeDamage, scaledBossWaveDamage, scaledEnemyAttackDamage } from '../scaling'
import { redrawBossHpBar } from './boss'
import { ncPlay, ncStunPoseIndex } from './ncEnemy'
import type { NcAssets } from './ncEnemy'

/**
 * ОБЩЕЕ ДВУХ НОВЫХ БОССОВ (09.11.2026): Костяной Змей (serpent.ts) и Вороний
 * Король (crowKing.ts). Лежат в том же bossRef и типе Boss, что Тварь и
 * Настоятель: меч, навыки, лёд, кровотечение, крит, полоса HP, значок стана и
 * закрытие события — по Boss. Своё — в boss.nc (NcBossState): хитбокс свой
 * (не BOSS_WIDTH/BOSS_HEIGHT — читать через bossBox), неуязвимость на нырке,
 * рёве и стае, скрытие.
 *
 * Здесь: спавн, листы, посадка, гравитация, шаг, хитстан (лист Hurt по
 * playOrder ровно за NC_BOSS_HURT_MS), оглушение от парирования, смерть с
 * наградой, удар по зоне reachPx.
 */
export type NcBossDeps = {
  phys: PlayerPhysics
  getPlayerCombatBox: () => { x: number; y: number; w: number; h: number }
  pushPlayerOutX: (
    body: { x: number; y: number; width: number; height: number },
    playerBox: { x: number; y: number; w: number; h: number },
  ) => void
  findGroundSurfaceY: (x: number, width: number, footY: number) => number | null
  closeEvent: (index: number, worldX?: number, worldY?: number) => void
  dropMana: (worldX: number, worldY: number) => void
  takeDamage: (amount: number, source?: DamageSource) => boolean
  takeDamageUnblockable: (amount: number) => void
  dashing: MutableRefObject<boolean>
  /** Куда смотрит герой (стая Короля собирается у него за спиной). */
  heroFacing: () => 1 | -1
  boss: MutableRefObject<Boss | null>
  bossEventIndex: MutableRefObject<number | null>
  worldContainer: Container
  grid: Grid
  assets: NcAssets
  characterLevel: MutableRefObject<number>
}

export function createNcBossCore(kind: SheetBossKind, deps: NcBossDeps) {
  const prefix = N.NC_PREFIX[kind]
  const scale = N.NC_SCALE[kind]
  const w = N.ncBoxW(kind)
  const h = N.NC_DRAW_H[kind]
  const [fx0, fx1] = N.NC_FIG_X[kind]
  const figMid = (fx0 + fx1) / 2
  const worldWidthPx = deps.grid[0].length * C.TILE_SIZE
  const sheet = (s: string) => `${prefix}_${s}`
  const hurtName = sheet('Hurt')
  const stunPose = ncStunPoseIndex(hurtName)
  let nameText: Text | null = null

  function spawn(tileX: number, tileY: number): Boss {
    const centerX = tileX * C.TILE_SIZE + C.TILE_SIZE / 2
    const sprite = new AnimatedSprite(deps.assets.play[sheet('Idle')])
    sprite.roundPixels = false
    deps.worldContainer.addChild(sprite)
    const hpBarBg = new Graphics().rect(0, 0, C.BOSS_HP_BAR_WIDTH, C.ENEMY_HP_BAR_HEIGHT).fill(0x221e2b)
    deps.worldContainer.addChild(hpBarBg)
    const hpBarFill = new Graphics()
    deps.worldContainer.addChild(hpBarFill)
    nameText = new Text({
      text: N.NC_BOSS_NAME[kind],
      style: { fontSize: 15, fontWeight: 'bold', fill: 0xede7f2, stroke: { color: 0x000000, width: 4 } },
    })
    nameText.anchor.set(0.5, 1)
    deps.worldContainer.addChild(nameText)

    // HP — как у Настоятеля: HP Твари × ABBOT_HP_MULT (сервер: bossMaxHpFor).
    const level = deps.characterLevel.current
    const maxHp = Math.round(scaledBossMaxHp(level) * C.ABBOT_HP_MULT)
    const nc: NcBossState = {
      kind,
      w,
      h,
      anim: null,
      action: null,
      keyDone: false,
      hitDone: false,
      actionMs: 0,
      invulnerable: false,
      hidden: false,
      slamCooldownMs: N.SERPENT_SLAM_INTERVAL_MS,
      diveCooldownMs: N.SERPENT_DIVE_INTERVAL_MS,
      scatterCooldownMs: N.CROWKING_SCATTER_INTERVAL_MS,
      enraged: false,
      divesLeft: 0,
      diveX: 0,
      diveFloorY: 0,
      quakeMs: 0,
      unreachableMs: 0,
      hitsInRow: 0,
      targetX: 0,
      targetFloorY: 0,
    }
    const boss: Boss = {
      x: centerX - w / 2,
      y: (tileY + 1) * C.TILE_SIZE - h,
      vy: 0,
      facing: -1,
      moving: false,
      hp: maxHp,
      maxHp,
      lastHitSwingId: 0,
      hurtTimer: 0,
      parryStunTimer: 0,
      stunCount: 0,
      poiseImmuneTimer: 0,
      aggroMemoryTimer: 0,
      investigateX: null,
      investigateTimer: 0,
      investigateLookTimer: 0,
      stunTimer: 0,
      dead: false,
      deathHoldTimer: 0,
      stage: 1,
      attackKind: null,
      attackAnimPlaying: false,
      attackHitApplied: false,
      attackCooldownTimer: 0,
      rangedAnimPlaying: false,
      rangedThrowApplied: false,
      rangedCooldownTimer: 0,
      rangedShotsLeft: 0,
      stompAnimPlaying: false,
      stompStrikeApplied: false,
      stompCooldownTimer: 0,
      hitFlashTimer: 0,
      rewardGiven: false,
      meleeDamage: scaledBossMeleeDamage(level),
      melee2Damage: Math.ceil(N.SERPENT_EMERGE_DMG_MULT * scaledEnemyAttackDamage(level)),
      spikeDamage: scaledBossSpikeDamage(level),
      waveDamage: scaledBossWaveDamage(level),
      hpBarBg,
      hpBarFill,
      sprite,
      nc,
    }
    play(boss, sheet('Idle'))
    layout(boss)
    redrawBossHpBar(boss)
    deps.boss.current = boss
    return boss
  }

  function play(boss: Boss, name: string, opts: { speedMult?: number; restart?: boolean } = {}) {
    ncPlay(boss.sprite, boss.nc!, name, deps.assets, { hurtMs: N.NC_BOSS_HURT_MS, ...opts })
  }

  /** Вход для playBossAnim из Explore.tsx (смерть, хитстан по имени Твари). */
  function playBossKind(boss: Boss, kind2: BossAnimKind) {
    const nc = boss.nc!
    if (kind2 === 'death') {
      nc.action = null
      nc.invulnerable = false
      nc.hidden = false
      boss.sprite.visible = true
      boss.attackAnimPlaying = false
      play(boss, sheet('Death'), { restart: true })
    } else if (kind2 === 'hurt') play(boss, hurtName)
    else if (kind2 === 'walk' && deps.assets.play[sheet('Walk')]) play(boss, sheet('Walk'))
    else play(boss, sheet('Idle'))
  }

  function layout(boss: Boss) {
    const nc = boss.nc!
    const footBottom = boss.y + nc.h
    const surfaceY = deps.findGroundSurfaceY(boss.x, nc.w, footBottom)
    boss.sprite.x = boss.x + nc.w / 2 + boss.facing * figMid * scale
    boss.sprite.y = (surfaceY ?? footBottom) + C.FOOT_TUNE
    boss.sprite.scale.set(boss.facing === -1 ? scale : -scale, scale)
    boss.sprite.visible = !nc.hidden
    boss.hpBarBg.x = boss.x + (nc.w - C.BOSS_HP_BAR_WIDTH) / 2
    boss.hpBarBg.y = boss.y - C.BOSS_HPBAR_OFFSET_Y - C.ENEMY_HP_BAR_MARGIN - C.ENEMY_HP_BAR_HEIGHT
    boss.hpBarFill.x = boss.hpBarBg.x
    boss.hpBarFill.y = boss.hpBarBg.y
    const barVisible = !boss.dead && !nc.hidden
    boss.hpBarBg.visible = barVisible
    boss.hpBarFill.visible = barVisible
    if (nameText) {
      nameText.x = boss.x + nc.w / 2
      nameText.y = boss.hpBarBg.y - 3
      nameText.visible = barVisible
    }
    syncMark(boss, deps.worldContainer, boss.x + nc.w / 2, boss.hpBarBg.y - 18, boss.dead || nc.hidden)
  }

  function applyGravity(boss: Boss, dt: number) {
    const nc = boss.nc!
    boss.vy = Math.min(boss.vy + C.GRAVITY * dt, C.MAX_FALL)
    const prevFootY = boss.y + nc.h
    boss.y += boss.vy * dt
    const top = sweepFootBlock(deps.grid, C.TILE_SIZE, boss.x, nc.w, prevFootY, boss.y + nc.h)
    if (top !== null) {
      boss.y = top - nc.h
      boss.vy = 0
    }
  }

  function stepX(boss: Boss, dir: number, speed: number, dt: number): boolean {
    const nc = boss.nc!
    const nextX = boss.x + dir * speed * dt
    const lead = dir > 0 ? nextX + nc.w : nextX
    const wall =
      isSolid(deps.grid, C.TILE_SIZE, lead, boss.y + 1) ||
      isSolid(deps.grid, C.TILE_SIZE, lead, boss.y + nc.h / 2) ||
      isSolid(deps.grid, C.TILE_SIZE, lead, boss.y + nc.h - 1)
    const noFloor = cellFootBlockTop(deps.grid, C.TILE_SIZE, Math.floor(lead / C.TILE_SIZE), Math.floor((boss.y + nc.h) / C.TILE_SIZE)) === null
    if (wall || noFloor) return false
    boss.x = clamp(nextX, 0, worldWidthPx - nc.w)
    return true
  }

  function pushOut(boss: Boss) {
    const nc = boss.nc!
    if (nc.hidden) return
    deps.pushPlayerOutX({ x: boss.x, y: boss.y, width: nc.w, height: nc.h }, deps.getPlayerCombatBox())
  }

  function showParryStun(boss: Boss) {
    const nc = boss.nc!
    if (nc.anim !== hurtName) play(boss, hurtName)
    const last = deps.assets.play[hurtName].length - 1
    const frame = parryStunFrame(boss.parryStunTimer, stunPose, last)
    if (boss.sprite.playing || boss.sprite.currentFrame !== frame) boss.sprite.gotoAndStop(frame)
  }

  function startAction(boss: Boss, action: string, opts: { speedMult?: number; reversed?: boolean } = {}) {
    const nc = boss.nc!
    nc.action = action
    nc.keyDone = false
    nc.hitDone = false
    nc.actionMs = 0
    boss.moving = false
    boss.attackAnimPlaying = true
    play(boss, opts.reversed ? sheet(action) + '#rev' : sheet(action), { restart: true, speedMult: opts.speedMult })
  }

  function endAction(boss: Boss) {
    const nc = boss.nc!
    nc.action = null
    nc.invulnerable = false
    boss.attackAnimPlaying = false
    boss.attackCooldownTimer = N.NC_BOSS_ATTACK_COOLDOWN_MS
  }

  /** Удар по зоне reachPx перед точкой ног. Отбил — оглушение, атака сгорела. */
  function strike(boss: Boss, sheetName: string, damage: number): 'hit' | 'parried' | 'miss' {
    const nc = boss.nc!
    const r = (N.ncSheet(sheetName).reachPx ?? 0) * scale
    const footX = boss.sprite.x
    const zoneL = boss.facing === 1 ? footX - nc.w * 0.25 : footX - r
    const zoneR = boss.facing === 1 ? footX + r : footX + nc.w * 0.25
    const pb = deps.getPlayerCombatBox()
    const overlap = pb.x < zoneR && pb.x + pb.w > zoneL && pb.y < boss.y + nc.h && pb.y + pb.h > boss.y
    if (!overlap) return 'miss'
    if (deps.takeDamage(damage, 'boss')) {
      endAction(boss)
      boss.parryStunTimer = C.PARRY_STUN_MS
      showParryStun(boss)
      return 'parried'
    }
    return 'hit'
  }

  /**
   * Общий заслон кадра: смерть (награда один раз), лёд (пауза), оглушение
   * (отмена). true — кадр дальше не идёт.
   */
  function gates(boss: Boss, deltaMS: number): boolean {
    const nc = boss.nc!
    if (boss.dead) {
      const done = boss.sprite.currentFrame >= boss.sprite.totalFrames - 1 || !boss.sprite.playing
      if (done && !boss.rewardGiven) {
        boss.rewardGiven = true
        deps.dropMana(boss.x + nc.w / 2, boss.y + nc.h / 2)
        if (deps.bossEventIndex.current !== null) deps.closeEvent(deps.bossEventIndex.current, boss.sprite.x, boss.y)
      }
      layout(boss)
      return true
    }
    boss.poiseImmuneTimer = Math.max(0, boss.poiseImmuneTimer - deltaMS)
    const wasStunned = boss.stunTimer > 0
    boss.stunTimer = Math.max(0, boss.stunTimer - deltaMS)
    if (boss.stunTimer > 0) {
      if (boss.sprite.playing) boss.sprite.stop()
      pushOut(boss)
      return true
    }
    if (wasStunned && !boss.sprite.playing) boss.sprite.play()
    boss.parryStunTimer = Math.max(0, boss.parryStunTimer - deltaMS)
    if (boss.parryStunTimer > 0) {
      showParryStun(boss)
      pushOut(boss)
      layout(boss)
      return true
    }
    return false
  }

  function tickFlash(boss: Boss, deltaMS: number) {
    boss.hitFlashTimer = Math.max(0, boss.hitFlashTimer - deltaMS)
    boss.sprite.tint = boss.hitFlashTimer > 0 ? 0xe0353b : 0xffffff
  }

  function dispose() {
    if (nameText) {
      deps.worldContainer.removeChild(nameText)
      nameText.destroy()
      nameText = null
    }
  }

  return { spawn, play, playBossKind, layout, applyGravity, stepX, pushOut, startAction, endAction, strike, gates, tickFlash, dispose, sheet, scale, hurtName }
}

export type NcBossCore = ReturnType<typeof createNcBossCore>
