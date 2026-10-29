import type { MutableRefObject } from 'react'
import { AnimatedSprite, Graphics, Sprite } from 'pixi.js'
import type { Container } from 'pixi.js'
import type { Grid, PlayerPhysics, Boss, AbbotAnimKind, AbbotState, BossAnimKind, Enemy } from '../types'
import type { AbbotAssets } from '../assets'
import type { ZvonarFrames } from './zvonar'
import * as C from '../constants'
import { isSolid, sweepFootBlock, cellFootBlockTop } from '../collision'
import { clamp, parryStunFrame } from '../utils'
import { scaledBossMaxHp, scaledBossMeleeDamage, scaledBossMelee2Damage, scaledBossSpikeDamage, scaledBossWaveDamage } from '../scaling'
import { redrawBossHpBar } from './boss'

/**
 * НАСТОЯТЕЛЬ — второй босс, две стадии (29.10.2026).
 *
 * ⚠️ Он лежит в ТОМ ЖЕ bossRef и в том же типе Boss, что Тварь, и это главное
 * решение модуля. Урон мечом и скиллами, переход стадии на половине HP, стан
 * льда, кровотечение, крит, полоса HP, значок стана и закрытие события написаны
 * по Boss и достались ему без единой новой строки там. Своё у него — в
 * boss.abbot (AbbotState): по этому полю Explore.tsx и отличает его от Твари в
 * трёх местах — playBossAnim, applyBossLayout и реакция на попадание.
 *
 * Стадия 1: ходит к герою, бьёт кулаком (парируется).
 * Превращение: на половине HP (boss.stage === 2, ставит damageBoss) срывает
 * колокол с ярма. Пока играет лист transform — урон не проходит (гейт в
 * damageBoss), решений нет, стан льда и оглушение сброшены.
 * Стадия 2: взмах колоколом (парируется), удар колоколом в пол — две волны по
 * полу в обе стороны (не парируются, от них прыгают), призыв двух Звонарей
 * (у них нет события и награды, см. Enemy.summoned).
 * Смерть: лист смерти своей стадии, труп остаётся до конца забега, награда — по
 * событию boss, как у Твари.
 */

type AbbotWave = {
  sprite: Sprite
  dir: 1 | -1
  travelled: number
  damage: number
  /** Верх пола под волной, px мира — по нему ищем край. */
  floorY: number
}

export type AbbotDeps = {
  phys: PlayerPhysics
  getPlayerCombatBox: () => { x: number; y: number; w: number; h: number }
  pushPlayerOutX: (
    body: { x: number; y: number; width: number; height: number },
    playerBox: { x: number; y: number; w: number; h: number },
  ) => void
  findGroundSurfaceY: (x: number, width: number, footY: number) => number | null
  closeEvent: (index: number, worldX?: number, worldY?: number) => void
  dropMana: (worldX: number, worldY: number) => void
  /** Парируемый урон; true — герой отбил (см. BossDeps.takeDamage). */
  takeDamage: (amount: number) => boolean
  /** Волна удара в пол не парируется — как волна топота Твари. */
  takeDamageUnblockable: (amount: number) => void
  /** Рывок проходит сквозь волну, и она катится дальше (как у Звонаря). */
  dashing: MutableRefObject<boolean>
  /** Вызвать Звонаря без события; вернёт его, чтобы босс считал живых. */
  spawnZvonar: (tileX: number, tileY: number) => Enemy | null
  boss: MutableRefObject<Boss | null>
  bossEventIndex: MutableRefObject<number | null>
  worldContainer: Container
  grid: Grid
  frames: AbbotAssets
  /** Лист волны и вспышки — Звонаря; грузятся вместе с ним (needs.zvonar). */
  zvonarFrames: MutableRefObject<ZvonarFrames | null>
  characterLevel: MutableRefObject<number>
}

/** Хитстан своей стадии — зовёт applyBossHitReaction в Explore.tsx. */
export function abbotHurtMs(boss: Boss): number {
  return boss.abbot?.transformed ? C.ABBOT_HURT2_MS : C.ABBOT_HURT_MS
}

export function createAbbotSystem(deps: AbbotDeps) {
  const worldWidthPx = deps.grid[0].length * C.TILE_SIZE
  let waves: AbbotWave[] = []

  // Смена листа: вместе с текстурами — якорь, петля и скорость. На уже стоящем
  // листе не делает ничего (зовётся каждый кадр). Новый лист — всегда с кадра 0:
  // так стойка второй стадии подхватывает кадры-переходы в конце атак.
  function play(boss: Boss, kind: AbbotAnimKind) {
    const a = boss.abbot!
    if (a.anim === kind) return
    const spec = C.ABBOT_SHEETS[kind]
    a.anim = kind
    boss.sprite.textures = deps.frames[kind]
    boss.sprite.anchor.set(spec.anchorX, spec.anchorY)
    boss.sprite.loop = spec.loop
    boss.sprite.animationSpeed = C.ABBOT_ANIM_SPEED[kind]
    boss.sprite.gotoAndPlay(0)
  }

  /**
   * Вход для playBossAnim из Explore.tsx: там зовут листы Твари по имени
   * ('death' на смертельном попадании). Переводим в лист своей стадии.
   */
  function playBossKind(boss: Boss, kind: BossAnimKind) {
    const a = boss.abbot!
    const second = a.transformed
    if (kind === 'death') {
      // Смерть обрывает любую атаку: труп не доигрывает удар.
      boss.attackAnimPlaying = false
      a.action = null
      play(boss, second ? 'death2' : 'death')
    }
    else if (kind === 'hurt') play(boss, second ? 'hurt2' : 'hurt')
    else if (kind === 'walk') play(boss, second ? 'walk2' : 'walk')
    else play(boss, second ? 'idle2' : 'idle')
  }

  /** Посадка спрайта и полосы HP от хитбокса, зеркало по facing (арт смотрит влево). */
  function layout(boss: Boss) {
    boss.sprite.scale.set(C.ABBOT_SCALE)
    const footBottom = boss.y + C.BOSS_HEIGHT
    const surfaceY = deps.findGroundSurfaceY(boss.x, C.BOSS_WIDTH, footBottom)
    boss.sprite.x = boss.x + C.BOSS_WIDTH / 2
    boss.sprite.y = (surfaceY ?? footBottom) + C.FOOT_TUNE + C.ABBOT_OFFSET_Y
    boss.sprite.scale.x = boss.facing === -1 ? C.ABBOT_SCALE : -C.ABBOT_SCALE
    boss.hpBarBg.x = boss.x + (C.BOSS_WIDTH - C.BOSS_HP_BAR_WIDTH) / 2
    boss.hpBarBg.y = boss.y - C.BOSS_HPBAR_OFFSET_Y - C.ENEMY_HP_BAR_MARGIN - C.ENEMY_HP_BAR_HEIGHT
    boss.hpBarFill.x = boss.hpBarBg.x
    boss.hpBarFill.y = boss.hpBarBg.y
  }

  function spawn(tileX: number, tileY: number): void {
    const centerX = tileX * C.TILE_SIZE + C.TILE_SIZE / 2
    const bossWorldX = centerX - C.BOSS_WIDTH / 2
    const bossWorldY = (tileY + 1) * C.TILE_SIZE - C.BOSS_HEIGHT

    const sprite = new AnimatedSprite(deps.frames.idle)
    sprite.anchor.set(C.ABBOT_SHEETS.idle.anchorX, C.ABBOT_SHEETS.idle.anchorY)
    sprite.loop = true
    sprite.animationSpeed = C.ABBOT_ANIM_SPEED.idle
    sprite.roundPixels = false
    sprite.play()
    deps.worldContainer.addChild(sprite)

    const hpBarBg = new Graphics().rect(0, 0, C.BOSS_HP_BAR_WIDTH, C.ENEMY_HP_BAR_HEIGHT).fill(0x221e2b)
    deps.worldContainer.addChild(hpBarBg)
    const hpBarFill = new Graphics()
    deps.worldContainer.addChild(hpBarFill)

    // Урон — те же формулы, что у Твари; HP — её HP × ABBOT_HP_MULT. Сервер
    // считает потолок урона по той же формуле для карт Настоятеля
    // (bossMaxHpForMap в server/src/game.ts).
    const level = deps.characterLevel.current
    const maxHp = Math.round(scaledBossMaxHp(level) * C.ABBOT_HP_MULT)
    const abbot: AbbotState = {
      anim: 'idle',
      transforming: false,
      transformed: false,
      action: null,
      actionKeyDone: false,
      slamCooldownTimer: 0,
      summonCooldownTimer: 0,
      summoned: [],
    }
    const boss: Boss = {
      x: bossWorldX,
      y: bossWorldY,
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
      // Поля атак Твари: attackAnimPlaying общий — по нему applyBossHitReaction
      // знает, что босс бьёт, и даёт вспышку вместо хитстана. Остальные у
      // Настоятеля не используются, но тип один.
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
      melee2Damage: scaledBossMelee2Damage(level),
      spikeDamage: scaledBossSpikeDamage(level),
      waveDamage: scaledBossWaveDamage(level),
      hpBarBg,
      hpBarFill,
      sprite,
      abbot,
    }
    layout(boss)
    redrawBossHpBar(boss)
    deps.boss.current = boss
  }

  function pushPlayerOut(boss: Boss) {
    deps.pushPlayerOutX(
      { x: boss.x, y: boss.y, width: C.BOSS_WIDTH, height: C.BOSS_HEIGHT },
      deps.getPlayerCombatBox(),
    )
  }

  function applyGravity(boss: Boss, dt: number) {
    boss.vy = Math.min(boss.vy + C.GRAVITY * dt, C.MAX_FALL)
    const prevFootY = boss.y + C.BOSS_HEIGHT
    boss.y += boss.vy * dt
    const blockTop = sweepFootBlock(deps.grid, C.TILE_SIZE, boss.x, C.BOSS_WIDTH, prevFootY, boss.y + C.BOSS_HEIGHT)
    if (blockTop !== null) {
      boss.y = blockTop - C.BOSS_HEIGHT
      boss.vy = 0
    }
  }

  // Шаг по X с теми же проверками стены и края, что у Твари: с площадки он не
  // сходит. Вернёт false, если шагнуть нельзя.
  function stepX(boss: Boss, dir: number, speed: number, dt: number): boolean {
    const nextX = boss.x + dir * speed * dt
    const leadingX = dir > 0 ? nextX + C.BOSS_WIDTH : nextX
    const hitWall =
      isSolid(deps.grid, C.TILE_SIZE, leadingX, boss.y + 1) ||
      isSolid(deps.grid, C.TILE_SIZE, leadingX, boss.y + C.BOSS_HEIGHT / 2) ||
      isSolid(deps.grid, C.TILE_SIZE, leadingX, boss.y + C.BOSS_HEIGHT - 1)
    const footCx = Math.floor(leadingX / C.TILE_SIZE)
    const footCy = Math.floor((boss.y + C.BOSS_HEIGHT) / C.TILE_SIZE)
    const noFloorAhead = cellFootBlockTop(deps.grid, C.TILE_SIZE, footCx, footCy) === null
    if (hitWall || noFloorAhead) return false
    boss.x = clamp(nextX, 0, worldWidthPx - C.BOSS_WIDTH)
    return true
  }

  // Кадр оглушения от парирования — как у Твари (см. boss.ts), лист hurt своей
  // стадии и свой кадр позы.
  function showParryStunFrame(boss: Boss) {
    const second = boss.abbot!.transformed
    play(boss, second ? 'hurt2' : 'hurt')
    const last = deps.frames[second ? 'hurt2' : 'hurt'].length - 1
    const frame = parryStunFrame(boss.parryStunTimer, second ? C.ABBOT_HURT2_STUN_FRAME : C.ABBOT_HURT_STUN_FRAME, last)
    if (boss.sprite.playing || boss.sprite.currentFrame !== frame) boss.sprite.gotoAndStop(frame)
  }

  function startAction(boss: Boss, action: NonNullable<AbbotState['action']>) {
    const a = boss.abbot!
    boss.moving = false
    boss.attackAnimPlaying = true
    a.action = action
    a.actionKeyDone = false
    play(boss, action)
  }

  function endAction(boss: Boss) {
    const a = boss.abbot!
    if (a.action === 'slam') a.slamCooldownTimer = C.ABBOT_SLAM_COOLDOWN_MS
    else if (a.action === 'summon') a.summonCooldownTimer = C.ABBOT_SUMMON_COOLDOWN_MS
    // Кулдаун ближнего удара — после ЛЮБОЙ атаки: иначе сразу за призывом или
    // ударом в пол шёл бы взмах без паузы.
    boss.attackCooldownTimer = C.ABBOT_ATTACK_COOLDOWN_MS
    boss.attackAnimPlaying = false
    a.action = null
  }

  // Удар перед собой (кулак или взмах): зона шириной range от переднего края
  // бокса, урон через takeDamage. Отбил — оглушение и обрыв атаки, как у Твари.
  function strikeMelee(boss: Boss, range: number, damage: number) {
    const zoneX = boss.facing === 1 ? boss.x + C.BOSS_WIDTH : boss.x - range
    const pb = deps.getPlayerCombatBox()
    const overlap =
      pb.x < zoneX + range &&
      pb.x + pb.w > zoneX &&
      pb.y < boss.y + C.BOSS_HEIGHT &&
      pb.y + pb.h > boss.y
    if (overlap && deps.takeDamage(damage)) {
      endAction(boss)
      boss.parryStunTimer = C.PARRY_STUN_MS
      showParryStunFrame(boss)
    }
  }

  function spawnWaves(boss: Boss) {
    const zf = deps.zvonarFrames.current
    if (!zf) return
    const bellX = boss.sprite.x + boss.facing * C.ABBOT_BELL_FORWARD * C.ABBOT_SCALE
    const floorY = boss.y + C.BOSS_HEIGHT
    for (const dir of [-1, 1] as const) {
      const sprite = new Sprite(zf.wave)
      sprite.anchor.set(0.5, C.ABBOT_WAVE_ANCHOR_Y)
      // Лист волны смотрит влево, как у Звонаря: вправо — зеркало.
      sprite.scale.set(dir === -1 ? C.ABBOT_WAVE_SCALE : -C.ABBOT_WAVE_SCALE, C.ABBOT_WAVE_SCALE)
      sprite.x = bellX
      sprite.y = floorY
      deps.worldContainer.addChild(sprite)
      waves.push({ sprite, dir, travelled: 0, damage: boss.waveDamage, floorY })
    }
  }

  function spawnImpact(worldX: number, worldY: number) {
    const zf = deps.zvonarFrames.current
    if (!zf) return
    const impact = new AnimatedSprite(zf.impact.slice(0, C.ZVONAR_WAVE_IMPACT_PLAY))
    impact.anchor.set(0.5, 0.5)
    impact.loop = false
    impact.animationSpeed = C.ZVONAR_WAVE_IMPACT_ANIM_SPEED
    impact.width = C.ABBOT_WAVE_IMPACT_DRAW
    impact.height = C.ABBOT_WAVE_IMPACT_DRAW
    impact.x = worldX
    impact.y = worldY
    impact.onComplete = () => {
      deps.worldContainer.removeChild(impact)
      impact.destroy()
    }
    deps.worldContainer.addChild(impact)
    impact.play()
  }

  // Призыв: по Звонарю слева и справа, в ABBOT_SUMMON_OFFSET_TILES (8) тайлах от
  // босса, на ТОМ ЖЕ полу (30.10.2026, Андрей). Идём от босса наружу тайл за
  // тайлом: стена или край пола — дальше хода нет, и Звонарь встаёт на последнем
  // годном тайле, то есть ближе. Совсем нет места с этой стороны — там никого.
  function summonZvonars(boss: Boss) {
    const a = boss.abbot!
    const floorRow = Math.floor((boss.y + C.BOSS_HEIGHT) / C.TILE_SIZE)
    const standRow = floorRow - 1
    const centerTile = Math.floor((boss.x + C.BOSS_WIDTH / 2) / C.TILE_SIZE)
    const cellCenter = (t: number) => t * C.TILE_SIZE + C.TILE_SIZE / 2
    for (const side of [-1, 1]) {
      if (a.summoned.length >= C.ABBOT_SUMMON_MAX) break
      let spot: number | null = null
      for (let off = 1; off <= C.ABBOT_SUMMON_OFFSET_TILES; off++) {
        const tx = centerTile + side * off
        if (tx < 0 || tx >= deps.grid[0].length) break
        const hasFloor = cellFootBlockTop(deps.grid, C.TILE_SIZE, tx, floorRow) !== null
        // Звонарь — два тайла ростом: обе клетки над полом свободны.
        const free =
          !isSolid(deps.grid, C.TILE_SIZE, cellCenter(tx), cellCenter(standRow)) &&
          !isSolid(deps.grid, C.TILE_SIZE, cellCenter(tx), cellCenter(standRow - 1))
        if (!hasFloor || !free) break
        spot = tx
      }
      if (spot === null) continue
      const z = deps.spawnZvonar(spot, standRow)
      if (z) {
        z.facing = (side === -1 ? 1 : -1) as 1 | -1
        a.summoned.push(z)
      }
    }
  }

  function updateBoss(boss: Boss, a: AbbotState, dt: number, deltaMS: number) {
    // --- Смерть: труп остаётся, награда один раз — как у Твари ---
    if (boss.dead) {
      const deathFrames = deps.frames[a.anim === 'death2' ? 'death2' : 'death']
      const deathDone = boss.sprite.currentFrame >= deathFrames.length - 1 || !boss.sprite.playing
      if (deathDone && !boss.rewardGiven) {
        boss.rewardGiven = true
        deps.dropMana(boss.x + C.BOSS_WIDTH / 2, boss.y + C.BOSS_HEIGHT / 2)
        if (deps.bossEventIndex.current !== null) {
          deps.closeEvent(deps.bossEventIndex.current, boss.sprite.x, boss.sprite.y - boss.sprite.height)
        }
      }
      return
    }

    // Вызванные: живые — те, что ещё не умерли (труп снимает zvonar.ts).
    if (a.summoned.length > 0) a.summoned = a.summoned.filter((z) => !z.dead && !z.sprite.destroyed)

    boss.poiseImmuneTimer = Math.max(0, boss.poiseImmuneTimer - deltaMS)

    // --- Превращение ---
    // Стадию ставит damageBoss (половина HP); сам переход — здесь, сразу, даже
    // посреди атаки: срывает колокол — главное событие боя.
    if (!a.transformed && !a.transforming && boss.stage === 2) {
      a.transforming = true
      boss.attackAnimPlaying = false
      a.action = null
      boss.moving = false
      play(boss, 'transform')
    }
    if (a.transforming) {
      boss.stunTimer = 0
      boss.parryStunTimer = 0
      boss.hurtTimer = 0
      boss.hitFlashTimer = 0
      applyGravity(boss, dt)
      if (!boss.sprite.playing || boss.sprite.currentFrame >= deps.frames.transform.length - 1) {
        a.transforming = false
        a.transformed = true
        a.summonCooldownTimer = C.ABBOT_SUMMON_FIRST_MS
        a.slamCooldownTimer = C.ABBOT_STAGE2_SLAM_DELAY_MS
        boss.attackCooldownTimer = C.ABBOT_STAGE2_ATTACK_DELAY_MS
        play(boss, 'idle2')
      }
      boss.sprite.tint = 0xffffff
      pushPlayerOut(boss)
      layout(boss)
      return
    }

    // --- Стан льда: ПАУЗА (как у Твари) ---
    const wasStunned = boss.stunTimer > 0
    boss.stunTimer = Math.max(0, boss.stunTimer - deltaMS)
    if (boss.stunTimer > 0) {
      if (boss.sprite.playing) boss.sprite.stop()
      pushPlayerOut(boss)
      return
    }
    if (wasStunned && !boss.sprite.playing) boss.sprite.play()

    // --- Оглушение от парирования: ОТМЕНА (как у Твари) ---
    boss.parryStunTimer = Math.max(0, boss.parryStunTimer - deltaMS)
    if (boss.parryStunTimer > 0) {
      showParryStunFrame(boss)
      pushPlayerOut(boss)
      layout(boss)
      return
    }

    applyGravity(boss, dt)

    const pb = deps.getPlayerCombatBox()
    const dx = (pb.x + pb.w / 2) - (boss.x + C.BOSS_WIDTH / 2)
    const dist = Math.abs(dx)
    const sameFloor =
      Math.abs(deps.phys.y + C.PLAYER_HEIGHT - (boss.y + C.BOSS_HEIGHT)) <= C.SAME_FLOOR_TOLERANCE_TILES * C.TILE_SIZE
    if (dist <= C.BOSS_AGGRO_RANGE_TILES * C.TILE_SIZE && sameFloor) {
      boss.aggroMemoryTimer = C.BOSS_AGGRO_MEMORY_MS
    } else {
      boss.aggroMemoryTimer = Math.max(0, boss.aggroMemoryTimer - deltaMS)
    }
    const aggroed = boss.aggroMemoryTimer > 0

    if (aggroed) {
      boss.investigateTimer = 0
      boss.investigateLookTimer = 0
      boss.investigateX = null
    } else if (boss.investigateTimer > 0) {
      boss.investigateTimer = Math.max(0, boss.investigateTimer - deltaMS)
      if (boss.investigateTimer === 0) boss.investigateLookTimer = C.INVESTIGATE_LOOK_MS
    } else if (boss.investigateLookTimer > 0) {
      boss.investigateLookTimer = Math.max(0, boss.investigateLookTimer - deltaMS)
      if (boss.investigateLookTimer === 0) boss.investigateX = null
    }

    // Кулдауны тикают всегда; взводятся в конце атаки (endAction).
    boss.attackCooldownTimer = Math.max(0, boss.attackCooldownTimer - deltaMS)
    a.slamCooldownTimer = Math.max(0, a.slamCooldownTimer - deltaMS)
    a.summonCooldownTimer = Math.max(0, a.summonCooldownTimer - deltaMS)

    const second = a.transformed
    const speed = second ? C.ABBOT_MOVE_SPEED_2 : C.ABBOT_MOVE_SPEED
    const stopDist = second ? C.ABBOT_STOP_DISTANCE_2 : C.ABBOT_STOP_DISTANCE

    // --- Решения: хитстан и идущая атака замораживают их ---
    if (boss.hurtTimer <= 0 && !boss.attackAnimPlaying) {
      if (aggroed) {
        const dir = Math.sign(dx)
        if (dir !== 0) boss.facing = dir as 1 | -1
        // Приоритет второй стадии: призыв (пока живых меньше двух) → взмах
        // вплотную → удар в пол издалека → шаг к герою.
        if (second && a.summonCooldownTimer <= 0 && a.summoned.length < C.ABBOT_SUMMON_MAX && deps.zvonarFrames.current) {
          startAction(boss, 'summon')
        } else if (second && dist <= C.ABBOT_SWING_REACH && boss.attackCooldownTimer <= 0) {
          startAction(boss, 'swing')
        } else if (second && dist > C.ABBOT_SLAM_MIN_TILES * C.TILE_SIZE && a.slamCooldownTimer <= 0 && deps.zvonarFrames.current) {
          startAction(boss, 'slam')
        } else if (!second && dist <= C.ABBOT_FIST_REACH && boss.attackCooldownTimer <= 0) {
          startAction(boss, 'attack')
        } else {
          boss.moving = boss.moving ? dist > stopDist : dist > stopDist + C.ABBOT_STOP_HYSTERESIS
          if (boss.moving && dir !== 0 && !stepX(boss, dir, speed, dt)) boss.moving = false
        }
      } else if (boss.investigateTimer > 0 && boss.investigateX !== null) {
        // Расследование — к точке, откуда прилетел урон (как у Твари).
        const toTarget = boss.investigateX - (boss.x + C.BOSS_WIDTH / 2)
        const dirInv = Math.sign(toTarget)
        if (dirInv !== 0) boss.facing = dirInv as 1 | -1
        if (dirInv === 0 || Math.abs(toTarget) <= speed * dt || !stepX(boss, dirInv, speed, dt)) {
          boss.moving = false
          boss.investigateTimer = 0
          boss.investigateLookTimer = C.INVESTIGATE_LOOK_MS
        } else {
          boss.moving = true
        }
      } else if (boss.investigateLookTimer > 0 && boss.investigateX !== null) {
        boss.moving = false
        const dirLook = Math.sign(boss.investigateX - (boss.x + C.BOSS_WIDTH / 2))
        if (dirLook !== 0) boss.facing = dirLook as 1 | -1
      } else {
        boss.moving = false
      }
    }

    // --- Визуал и ключевые кадры: атака > хитстан > ходьба/стойка ---
    if (boss.attackAnimPlaying && a.action) {
      const action = a.action
      play(boss, action)
      const frames = deps.frames[action]
      const keyFrame =
        action === 'attack' ? C.ABBOT_ATTACK_HIT_FRAME
          : action === 'swing' ? C.ABBOT_SWING_HIT_FRAME
            : action === 'slam' ? C.ABBOT_SLAM_CONTACT_FRAME
              : C.ABBOT_SUMMON_SPAWN_FRAME
      if (!a.actionKeyDone && boss.sprite.currentFrame >= keyFrame) {
        a.actionKeyDone = true
        // Атака дошла до удара — стан-резист сбрасывается, как у Твари.
        boss.stunCount = 0
        if (action === 'attack') strikeMelee(boss, C.ABBOT_FIST_RANGE, boss.meleeDamage)
        else if (action === 'swing') strikeMelee(boss, C.ABBOT_SWING_RANGE, boss.melee2Damage)
        else if (action === 'slam') spawnWaves(boss)
        else summonZvonars(boss)
      }
      // strikeMelee мог оборвать атаку отбивом — тогда уже стоит лист hurt.
      if (a.action && (boss.sprite.currentFrame >= frames.length - 1 || !boss.sprite.playing)) {
        endAction(boss)
        play(boss, second ? 'idle2' : 'idle')
      }
    } else if (boss.hurtTimer > 0) {
      boss.hurtTimer = Math.max(0, boss.hurtTimer - deltaMS)
      play(boss, second ? 'hurt2' : 'hurt')
    } else if (boss.moving) {
      play(boss, second ? 'walk2' : 'walk')
    } else {
      play(boss, second ? 'idle2' : 'idle')
    }

    boss.hitFlashTimer = Math.max(0, boss.hitFlashTimer - deltaMS)
    boss.sprite.tint = boss.hitFlashTimer > 0 ? 0xe0353b : 0xffffff

    pushPlayerOut(boss)
    layout(boss)
  }

  // Волны удара в пол — свой список: волна, выпущенная до смерти босса,
  // докатывается сама. Порядок причин: герой → стена → край пола → дальность.
  function updateWaves(deltaMS: number) {
    if (waves.length === 0) return
    const survivors: AbbotWave[] = []
    const maxTravel = C.ABBOT_WAVE_RANGE_TILES * C.TILE_SIZE
    for (const w of waves) {
      const step = C.ABBOT_WAVE_SPEED * (deltaMS / 1000)
      w.sprite.x += w.dir * step
      w.travelled += step
      const centerY = w.floorY - C.ABBOT_WAVE_HIT_H / 2

      let remove = false
      let impact = false
      if (!deps.dashing.current) {
        const box = deps.getPlayerCombatBox()
        const left = w.sprite.x - C.ABBOT_WAVE_HIT_W / 2
        const top = w.floorY - C.ABBOT_WAVE_HIT_H
        const overlap =
          box.x < left + C.ABBOT_WAVE_HIT_W &&
          box.x + box.w > left &&
          box.y < top + C.ABBOT_WAVE_HIT_H &&
          box.y + box.h > top
        if (overlap) {
          remove = true
          impact = true
          deps.takeDamageUnblockable(w.damage)
        }
      }
      if (!remove) {
        const frontX = w.sprite.x + w.dir * (C.ABBOT_WAVE_HIT_W / 2)
        if (isSolid(deps.grid, C.TILE_SIZE, frontX, centerY)) {
          remove = true
          impact = true
        }
      }
      if (!remove) {
        const floorRow = Math.floor(w.floorY / C.TILE_SIZE)
        const cx = Math.floor(w.sprite.x / C.TILE_SIZE)
        if (cellFootBlockTop(deps.grid, C.TILE_SIZE, cx, floorRow) === null) remove = true
      }
      if (!remove && w.travelled >= maxTravel) remove = true

      if (remove) {
        if (impact) spawnImpact(w.sprite.x, centerY)
        deps.worldContainer.removeChild(w.sprite)
        w.sprite.destroy()
      } else {
        survivors.push(w)
      }
    }
    waves = survivors
  }

  // Порядок: босс → волны (волна, рождённая в этом кадре, сразу делает шаг).
  function update(dt: number, deltaMS: number): void {
    const boss = deps.boss.current
    if (boss?.abbot) updateBoss(boss, boss.abbot, dt, deltaMS)
    updateWaves(deltaMS)
  }

  function dispose(): void {
    for (const w of waves) {
      deps.worldContainer.removeChild(w.sprite)
      w.sprite.destroy()
    }
    waves = []
  }

  return { spawn, update, dispose, playBossKind, layout }
}
