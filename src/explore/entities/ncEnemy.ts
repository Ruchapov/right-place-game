import type { MutableRefObject } from 'react'
import { AnimatedSprite, Graphics } from 'pixi.js'
import type { Container, Texture } from 'pixi.js'
import type { DamageSource, Grid, PlayerPhysics, Enemy, MapEvent, NcEnemyState, SheetEnemyKind } from '../types'
import * as C from '../constants'
import * as N from '../ncConstants'
import { ncSheet } from '../ncConstants'
import { isSolid, sweepFootBlock, cellFootBlockTop } from '../collision'
import { clamp, parryStunFrame } from '../utils'
import { perceive, callPack, lookAround, searchTargetBelow, syncMark, destroyMark, ENEMY_PERCEPTION } from '../perception'
import { scaledEnemyAttackDamage, scaledNcEnemyMaxHp } from '../scaling'
import { redrawEnemyHpBar } from './enemy'
import type { NcProjectileSystem } from './ncProjectiles'

/**
 * ОБЩИЙ ХОД ВРАГОВ ИЗ ЛИСТОВ sheets.json (09.11.2026): фехтовальщик,
 * гробокопатель, арбалетчик, кочегар, навозник.
 *
 * Свой модуль у каждого вида (fencer.ts, gravedigger.ts …) — там только ЕГО
 * решения и ключевые кадры (NcBehavior). Всё остальное — здесь, одно на пятерых:
 * листы и якорь, гравитация, зрение и погоня (perception.ts — та же цепочка,
 * что у всех врагов), расследование и патруль, стан льда (пауза), оглушение
 * от парирования (отмена), хитстан, смерть с закрытием события, мягкая стена.
 *
 * ⚠️ Враги НИКОГДА не прыгают: только ходят и падают с края (в погоне — к
 * герою, стоящему ниже).
 *
 * Как и Звонарь, лежат в ОБЩЕМ списке enemiesRef: меч, навыки, лёд,
 * кровотечение, рывок, элита и парирование работают по ним без единой строки
 * здесь. Система обслуживает ТОЛЬКО свой kind, чужих пропускает.
 */

/** Кадры вида: raw — как в листе, play — в порядке показа (playOrder у pingpong/hurt). */
export type NcAssets = {
  raw: Record<string, Texture[]>
  play: Record<string, Texture[]>
  /** Снаряды и прочие одиночные картинки вида (clod, bolt, mud …). */
  extra: Record<string, Texture>
}

export type NcEnemyDeps = {
  /** Ловушки как стена (13.11.2026) — см. EnemyDeps.trapBlocks в enemy.ts. */
  trapBlocks?: (enemy: Enemy, leadX: number, feetY: number) => boolean
  phys: PlayerPhysics
  getPlayerCombatBox: () => { x: number; y: number; w: number; h: number }
  pushPlayerOutX: (
    body: { x: number; y: number; width: number; height: number },
    playerBox: { x: number; y: number; w: number; h: number },
  ) => void
  findGroundSurfaceY: (x: number, width: number, footY: number) => number | null
  closeEvent: (index: number, worldX?: number, worldY?: number) => void
  onPatrolKilled: (patrolIndex: number, worldX: number, worldY: number) => void
  dropMana: (worldX: number, worldY: number) => void
  /** Парируемый урон; true — герой отбил. */
  takeDamage: (amount: number, source?: DamageSource) => boolean
  dashing: MutableRefObject<boolean>
  /** Кочегар попал (не отбито) — поджечь героя: урон удара, от него горение. */
  igniteHero: (hitDamage: number) => void
  events: MutableRefObject<MapEvent[]>
  worldContainer: Container
  grid: Grid
  enemies: MutableRefObject<Enemy[]>
  characterLevel: MutableRefObject<number>
  projectiles: NcProjectileSystem
}

/** Что видит враг в этом кадре — для решений вида. */
export type NcView = {
  dx: number // центр героя минус центр врага, px
  dist: number
  /** Расстояние от точки ног врага до ближнего края героя, px (для дальности удара). */
  gap: number
  sameTier: boolean
  playerBox: { x: number; y: number; w: number; h: number }
}

export type NcCtx = {
  deps: NcEnemyDeps
  assets: NcAssets
  kind: SheetEnemyKind
  scale: number
  /** Начать действие листом `${Prefix}_${name}` (Attack, Throw, Parry …). */
  start: (e: Enemy, name: string) => void
  /** Точка вылета spawn листа в мире (от ног, с зеркалом). */
  spawnPoint: (e: Enemy, sheetName: string) => { x: number; y: number }
  /**
   * Удар в окне hit листа: зона reachPx перед ногами. 'parried' — герой отбил
   * (враг уже оглушён, действие сожжено).
   */
  meleeStrike: (e: Enemy, sheetName: string, damage: number) => 'hit' | 'parried' | 'miss'
  /** Шаг по X со стеной и краем; allowDrop — можно сойти с края. */
  stepX: (e: Enemy, dir: 1 | -1, speed: number, dt: number, allowDrop: boolean) => boolean
  /** Дальность удара листа в мире, px (reachPx × масштаб). */
  reach: (sheetName: string) => number
}

export type NcBehavior = {
  kind: SheetEnemyKind
  /**
   * Решение в погоне, когда враг свободен (не ранен, не в действии).
   * true — решил сам (начал действие или сделал свой шаг); false — общий шаг
   * погони к герою до stopGap.
   */
  decide: (ctx: NcCtx, e: Enemy, v: NcView, dt: number) => boolean
  /** До какого зазора (px от ног до героя) подходит общая погоня. */
  stopGap: (ctx: NcCtx) => number
  /** Каждый кадр, пока играет действие; frame — кадр листа. */
  onAction: (ctx: NcCtx, e: Enemy, action: string, frame: number, dt: number, deltaMS: number) => void
  /** Действие доиграло до конца (не оборвано). */
  onActionEnd?: (ctx: NcCtx, e: Enemy, action: string) => void
  /** Кадр, до которого идёт замах действия (для POISE_POINT); null — замаха нет. */
  windupFrame: (action: string) => number | null
  hpMult: number
}

export function newNcState(): NcEnemyState {
  return {
    anim: null,
    action: null,
    keyDone: false,
    hitDone: false,
    cooldownMs: 0,
    actionMs: 0,
    lastHitAt: -Infinity,
    hitStreak: 0,
    parryRequest: false,
    blockedHit: false,
    needReload: false,
    dashMoved: 0,
    eyesMs: 0,
    reveal: 1,
  }
}

/** Скорость AnimatedSprite: кадров за тик при 60 к/с. */
function speedOf(fps: number): number {
  return fps / 60
}

/**
 * Смена листа: текстуры (в порядке показа), якорь, петля, скорость. Тот же
 * приём, что playAnim Звонаря: на уже стоящем листе — ничего.
 * hurtMs — для листов mode 'hurt': весь playOrder за столько мс.
 */
export function ncPlay(
  sprite: AnimatedSprite,
  st: { anim: string | null },
  name: string,
  assets: NcAssets,
  opts: { hurtMs?: number; speedMult?: number; restart?: boolean } = {},
): boolean {
  if (st.anim === name && !opts.restart) return false
  // 'Имя#rev' — тот же лист задом наперёд (сборка Короля из стаи).
  const spec = ncSheet(name.split('#')[0])
  const textures = assets.play[name]
  st.anim = name
  sprite.textures = textures
  sprite.anchor.set(spec.anchorX, spec.anchorY)
  sprite.loop = spec.mode === 'loop' || spec.mode === 'pingpong'
  const mult = opts.speedMult ?? 1
  if (spec.fps !== null) sprite.animationSpeed = speedOf(spec.fps) * mult
  else sprite.animationSpeed = textures.length / (((opts.hurtMs ?? C.ENEMY_HURT_MS) / 1000) * 60)
  sprite.gotoAndPlay(0)
  return true
}

/** Кадр позы оглушения в playOrder листа Hurt — самый «глубокий» кадр. */
export function ncStunPoseIndex(name: string): number {
  const spec = ncSheet(name)
  const order = spec.playOrder ?? []
  let best = 0
  for (let i = 0; i < order.length; i++) if (order[i] > order[best]) best = i
  return best
}

/**
 * Точка ног в мире → точка листа: X — по взгляду (лист смотрит влево, вправо
 * — зеркало), Y — вниз от ног. px клетки → px мира через масштаб вида.
 */
export function sheetPointToWorld(
  footX: number,
  footY: number,
  facing: 1 | -1,
  scale: number,
  sheetName: string,
  px: number,
  py: number,
): { x: number; y: number } {
  const spec = ncSheet(sheetName)
  const ax = spec.anchorX * spec.cellW
  const ay = spec.anchorY * spec.cellH
  const sx = (px - ax) * scale
  return { x: footX + (facing === -1 ? sx : -sx), y: footY + (py - ay) * scale }
}

export function createNcEnemySystem(behavior: NcBehavior, deps: NcEnemyDeps, assetsRef: MutableRefObject<NcAssets | null>) {
  const kind = behavior.kind
  const prefix = N.NC_PREFIX[kind]
  const scale = N.NC_SCALE[kind]
  const boxW = N.ncBoxW(kind)
  const boxH = N.NC_DRAW_H[kind]
  const [figX0, figX1] = N.NC_FIG_X[kind]
  const figMid = (figX0 + figX1) / 2
  const worldWidthPx = deps.grid[0].length * C.TILE_SIZE
  const sheet = (suffix: string) => `${prefix}_${suffix}`
  const hurtName = sheet('Hurt')
  const stunPose = ncStunPoseIndex(hurtName)

  function assets(): NcAssets {
    const a = assetsRef.current
    if (!a) throw new Error(`ncEnemy: листы «${kind}» не загружены`)
    return a
  }

  function stepX(e: Enemy, dir: 1 | -1, speed: number, dt: number, allowDrop: boolean): boolean {
    const nextX = e.x + dir * speed * dt
    const leadingX = dir > 0 ? nextX + e.width : nextX
    const hitWall =
      isSolid(deps.grid, C.TILE_SIZE, leadingX, e.y + 1) ||
      isSolid(deps.grid, C.TILE_SIZE, leadingX, e.y + e.height / 2) ||
      isSolid(deps.grid, C.TILE_SIZE, leadingX, e.y + e.height - 1)
    if (hitWall) return false
    if (e.vy === 0 && deps.trapBlocks?.(e, leadingX, e.y + e.height)) return false
    if (!allowDrop && e.vy === 0) {
      const footCx = Math.floor(leadingX / C.TILE_SIZE)
      const footCy = Math.floor((e.y + e.height) / C.TILE_SIZE)
      if (cellFootBlockTop(deps.grid, C.TILE_SIZE, footCx, footCy) === null) return false
    }
    e.x = clamp(nextX, 0, worldWidthPx - e.width)
    return true
  }

  function reach(sheetName: string): number {
    return (ncSheet(sheetName).reachPx ?? 0) * scale
  }

  function start(e: Enemy, name: string) {
    const nc = e.nc!
    nc.action = name
    nc.keyDone = false
    nc.hitDone = false
    nc.actionMs = 0
    nc.dashMoved = 0
    e.attackAnimPlaying = true
    e.attackHitApplied = false
    const wf = behavior.windupFrame(name)
    const spec = ncSheet(sheet(name))
    if (wf !== null && spec.fps) {
      // Замах виден poise-системе (applyEnemyHitReaction): ранний удар его сбивает.
      e.windingUp = true
      e.windupTimer = 0
      e.windupMs = (wf / spec.fps) * 1000
    } else {
      e.windingUp = false
    }
    ncPlay(e.sprite, nc, sheet(name), assets(), { restart: true })
  }

  function endAction(e: Enemy) {
    const nc = e.nc!
    nc.action = null
    nc.cooldownMs = N.NC_ATTACK_COOLDOWN_MS
    e.attackAnimPlaying = false
    e.windingUp = false
    e.windupTimer = 0
  }

  function showParryStunFrame(e: Enemy) {
    const nc = e.nc!
    const a = assets()
    if (nc.anim !== hurtName) {
      ncPlay(e.sprite, nc, hurtName, a)
    }
    const last = a.play[hurtName].length - 1
    const frame = parryStunFrame(e.parryStunTimer, stunPose, last)
    if (e.sprite.playing || e.sprite.currentFrame !== frame) e.sprite.gotoAndStop(frame)
  }

  function meleeStrike(e: Enemy, sheetName: string, damage: number): 'hit' | 'parried' | 'miss' {
    const pb = deps.getPlayerCombatBox()
    const footX = e.sprite.x
    const r = reach(sheetName)
    const zoneL = e.facing === 1 ? footX - e.width * 0.25 : footX - r
    const zoneR = e.facing === 1 ? footX + r : footX + e.width * 0.25
    const overlap = pb.x < zoneR && pb.x + pb.w > zoneL && pb.y < e.y + e.height && pb.y + pb.h > e.y
    if (!overlap) return 'miss'
    if (deps.takeDamage(damage, e)) {
      // Отбил — замах сгорел, враг оглушён (как зверь).
      e.parryStunTimer = C.PARRY_STUN_MS
      endAction(e)
      showParryStunFrame(e)
      return 'parried'
    }
    return 'hit'
  }

  function spawnPoint(e: Enemy, sheetName: string) {
    const spec = ncSheet(sheetName)
    const sp = spec.spawn ?? [spec.anchorX * spec.cellW, spec.anchorY * spec.cellH * 0.5]
    return sheetPointToWorld(e.sprite.x, e.sprite.y, e.facing, scale, sheetName, sp[0], sp[1])
  }

  const ctx: NcCtx = {
    deps,
    get assets() { return assets() },
    kind,
    scale,
    start,
    spawnPoint,
    meleeStrike,
    stepX,
    reach,
  }

  function spawn(tileX: number, tileY: number, eventIndex: number): Enemy {
    const a = assets()
    const worldX = tileX * C.TILE_SIZE + C.TILE_SIZE / 2 - boxW / 2
    const worldY = (tileY + 1) * C.TILE_SIZE - boxH
    const rect = new Graphics().rect(0, 0, boxW, boxH).fill(C.ENEMY_COLOR)
    rect.visible = false
    deps.worldContainer.addChild(rect)

    const idleName = sheet('Idle')
    const sprite = new AnimatedSprite(a.play[idleName])
    sprite.scale.set(scale)
    sprite.roundPixels = false
    deps.worldContainer.addChild(sprite)

    const hpBarBg = new Graphics().rect(0, 0, boxW, C.ENEMY_HP_BAR_HEIGHT).fill(0x221e2b)
    deps.worldContainer.addChild(hpBarBg)
    const hpBarFill = new Graphics()
    deps.worldContainer.addChild(hpBarFill)

    const level = deps.characterLevel.current
    const maxHp = scaledNcEnemyMaxHp(behavior.hpMult, level)
    const nc = newNcState()
    const enemy: Enemy = {
      kind,
      width: boxW,
      height: boxH,
      x: worldX,
      y: worldY,
      vy: 0,
      hp: maxHp,
      maxHp,
      lastHitSwingId: 0,
      attackTimer: 0,
      windingUp: false,
      windupTimer: 0,
      windupMs: C.WINDUP_MS,
      waveCooldownMs: 0,
      zvonarAnim: null,
      eventIndex,
      spawnX: worldX,
      patrolDir: 1,
      facing: -1,
      rect,
      sprite,
      attackAnimPlaying: false,
      attackHitApplied: false,
      hurtTimer: 0,
      stunCount: 0,
      poiseImmuneTimer: 0,
      aggroMemoryTimer: 0,
      investigateX: null,
      investigateTimer: 0,
      investigateLookTimer: 0,
      stunTimer: 0,
      parryStunTimer: 0,
      dead: false,
      deathHoldTimer: 0,
      // Урон зверя этого уровня — база для множителей вида (ncHitDamage);
      // элита умножает именно его (makeElite в Explore.tsx).
      attackDamage: scaledEnemyAttackDamage(level),
      hpBarBg,
      hpBarFill,
      nc,
    }
    ncPlay(sprite, nc, idleName, a)
    layout(enemy)
    redrawEnemyHpBar(enemy)
    deps.enemies.current.push(enemy)
    return enemy
  }

  /** Смерть — лист Death «hold»: доиграть и замереть. Зовёт damageEnemy. */
  function playDeath(e: Enemy) {
    const nc = e.nc!
    nc.action = null
    e.attackAnimPlaying = false
    e.windingUp = false
    ncPlay(e.sprite, nc, sheet('Death'), assets(), { restart: true })
  }

  function layout(e: Enemy) {
    const footBottom = e.y + e.height
    const surfaceY = deps.findGroundSurfaceY(e.x, e.width, footBottom)
    // Фигура стоит в боксе серединой: точка ног сдвинута на середину фигуры.
    e.sprite.x = e.x + e.width / 2 + e.facing * figMid * scale
    e.sprite.y = (surfaceY ?? footBottom) + C.FOOT_TUNE
    e.sprite.scale.set(e.facing === -1 ? scale : -scale, scale)
    e.rect.x = e.x
    e.rect.y = e.y
    e.hpBarBg.x = e.x
    e.hpBarBg.y = e.y - C.ENEMY_HPBAR_OFFSET_Y - C.ENEMY_HP_BAR_MARGIN - C.ENEMY_HP_BAR_HEIGHT
    e.hpBarFill.x = e.x
    e.hpBarFill.y = e.hpBarBg.y
  }

  function pushOut(e: Enemy) {
    deps.pushPlayerOutX({ x: e.x, y: e.y, width: e.width, height: e.height }, deps.getPlayerCombatBox())
  }

  function update(dt: number, deltaMS: number): void {
    const a = assetsRef.current
    if (!a) return
    for (let i = 0; i < deps.enemies.current.length; i++) {
      const e = deps.enemies.current[i]
      if (e.kind !== kind || !e.nc) continue
      const nc = e.nc

      // --- Смерть: лист hold доиграл → DEATH_HOLD_MS → убрать (как у Звонаря) ---
      if (e.dead) {
        if (e.mark) e.mark.visible = false
        const deathDone = e.sprite.currentFrame >= e.sprite.totalFrames - 1 || !e.sprite.playing
        if (deathDone) {
          e.deathHoldTimer += deltaMS
          if (e.deathHoldTimer >= C.DEATH_HOLD_MS) {
            const deathX = e.sprite.x
            const deathY = e.y
            deps.dropMana(e.x + e.width / 2, e.y + e.height / 2)
            deps.worldContainer.removeChild(e.rect, e.sprite, e.hpBarBg, e.hpBarFill)
            e.rect.destroy()
            e.sprite.destroy()
            e.hpBarBg.destroy()
            e.hpBarFill.destroy()
            destroyMark(e, deps.worldContainer)
            deps.enemies.current.splice(i, 1)
            i--
            const ownerEvent = deps.events.current[e.eventIndex]
            if (ownerEvent) {
              ownerEvent.remainingEnemies = Math.max(0, (ownerEvent.remainingEnemies ?? 1) - 1)
              if (ownerEvent.remainingEnemies <= 0) deps.closeEvent(e.eventIndex, deathX, deathY)
            }
            if (e.patrolIndex !== undefined) deps.onPatrolKilled(e.patrolIndex, deathX, deathY)
          }
        }
        continue
      }

      e.poiseImmuneTimer = Math.max(0, e.poiseImmuneTimer - deltaMS)

      // --- Стан льда: ПАУЗА ---
      const wasStunned = e.stunTimer > 0
      e.stunTimer = Math.max(0, e.stunTimer - deltaMS)
      if (e.stunTimer > 0) {
        if (e.sprite.playing) e.sprite.stop()
        pushOut(e)
        continue
      }
      // --- Оглушение от парирования: ОТМЕНА ---
      e.parryStunTimer = Math.max(0, e.parryStunTimer - deltaMS)
      if (e.parryStunTimer > 0) {
        if (nc.action) endAction(e)
        showParryStunFrame(e)
        pushOut(e)
        layout(e)
        continue
      }
      if (wasStunned && !e.sprite.playing) e.sprite.play()

      // Удар героя оборвал действие (applyEnemyHitReaction снял attackAnimPlaying).
      if (nc.action && !e.attackAnimPlaying) {
        nc.action = null
        nc.cooldownMs = Math.max(nc.cooldownMs, N.NC_ATTACK_COOLDOWN_MS * 0.5)
      }

      const prevX = e.x
      // --- Гравитация ---
      e.vy = Math.min(e.vy + C.GRAVITY * dt, C.MAX_FALL)
      const prevFootY = e.y + e.height
      e.y += e.vy * dt
      const blockTop = sweepFootBlock(deps.grid, C.TILE_SIZE, e.x, e.width, prevFootY, e.y + e.height)
      if (blockTop !== null) {
        e.y = blockTop - e.height
        e.vy = 0
      }

      const pb = deps.getPlayerCombatBox()
      const dx = (pb.x + pb.w / 2) - (e.x + e.width / 2)
      const dist = Math.abs(dx)
      const sameTier = pb.y < e.y + e.height && pb.y + pb.h > e.y
      // Зазор от точки ног (лицом к герою) до ближнего края героя — с ним
      // сравнивается reachPx удара.
      const towardSign = dx >= 0 ? 1 : -1
      const footX = e.x + e.width / 2 + towardSign * figMid * scale
      const gap = Math.max(0, towardSign > 0 ? pb.x - footX : footX - (pb.x + pb.w))
      const view: NcView = { dx, dist, gap, sameTier, playerBox: pb }
      const feetY = e.y + e.height
      const playerFeetY = deps.phys.y + C.PLAYER_HEIGHT
      const { aggroed, startedChase } = perceive(
        e,
        { x: e.x, y: e.y, w: e.width, h: e.height },
        { x: pb.x, y: deps.phys.y, w: pb.w, h: C.PLAYER_HEIGHT },
        deps.grid,
        deltaMS,
        ENEMY_PERCEPTION,
      )
      if (startedChase) callPack(e, deps.enemies.current, pb.x + pb.w / 2, playerFeetY, ENEMY_PERCEPTION)

      nc.cooldownMs = Math.max(0, nc.cooldownMs - deltaMS)

      // --- Решения (хитстан и идущее действие их замораживают) ---
      if (e.hurtTimer <= 0 && !nc.action) {
        if (e.noticePending) {
          const d = Math.sign(dx)
          if (d !== 0) e.facing = d as 1 | -1
        } else if (aggroed) {
          const toward: 1 | -1 = dx > 0 ? 1 : dx < 0 ? -1 : e.facing
          if (!behavior.decide(ctx, e, view, dt)) {
            e.facing = toward
            const below = playerFeetY - feetY
            const playerBelow = deps.phys.onGround && below >= C.ENEMY_DROP_MIN_PX && !sameTier
            if (e.vy !== 0) stepX(e, toward, C.ENEMY_CHASE_SPEED, dt, true)
            else if (playerBelow) stepX(e, toward, C.ENEMY_CHASE_SPEED, dt, true)
            else if (view.gap > behavior.stopGap(ctx)) stepX(e, toward, C.ENEMY_CHASE_SPEED, dt, false)
          }
        } else if (e.investigateTimer > 0 && e.investigateX !== null) {
          const toTarget = e.investigateX - (e.x + e.width / 2)
          const dir = Math.sign(toTarget) as 1 | -1 | 0
          const step = C.ENEMY_CHASE_SPEED * dt
          if (dir !== 0) e.facing = dir
          if (dir === 0 || Math.abs(toTarget) <= step) {
            e.investigateTimer = 0
            e.investigateLookTimer = C.INVESTIGATE_LOOK_MS
          } else {
            const canDrop = searchTargetBelow(e, feetY) || e.vy !== 0
            if (!stepX(e, dir, C.ENEMY_CHASE_SPEED, dt, canDrop)) {
              e.investigateTimer = 0
              e.investigateLookTimer = C.INVESTIGATE_LOOK_MS
            }
          }
        } else if (e.investigateLookTimer > 0 && e.investigateX !== null) {
          lookAround(e, deltaMS)
        } else {
          // Патруль — как у зверя: в пределах PATROL_RANGE_TILES от спавна.
          const left = e.spawnX - C.PATROL_RANGE_TILES * C.TILE_SIZE
          const right = e.spawnX + C.PATROL_RANGE_TILES * C.TILE_SIZE
          const dir = e.patrolDir
          const nextX = e.x + dir * C.ENEMY_PATROL_SPEED * dt
          const reachedBound = dir > 0 ? nextX > right : nextX < left
          const blocked = !reachedBound && !stepX(e, dir, C.ENEMY_PATROL_SPEED, dt, false)
          if (reachedBound || blocked) {
            // Как у зверя (enemy.ts): погоня увела его со своего участка, а путь
            // к дому закрыт стеной, краем или ловушкой (13.11.2026) — дом
            // переезжает сюда. Иначе он дёргался бы между границей и препятствием.
            const headingHome = (dir < 0 && e.x > right) || (dir > 0 && e.x < left)
            if (blocked && headingHome) e.spawnX = e.x
            e.patrolDir = dir > 0 ? -1 : 1
          }
          e.facing = e.patrolDir
        }
      }

      // --- Визуал и ключевые кадры: хитстан > действие > ходьба/стойка ---
      if (e.hurtTimer > 0) {
        e.hurtTimer = Math.max(0, e.hurtTimer - deltaMS)
        ncPlay(e.sprite, nc, hurtName, a, { hurtMs: C.ENEMY_HURT_MS })
      } else if (nc.action) {
        const action = nc.action
        nc.actionMs += deltaMS
        if (e.windingUp) {
          e.windupTimer += deltaMS
          const wf = behavior.windupFrame(action)
          if (wf === null || e.sprite.currentFrame >= wf) {
            // Замах дошёл до удара — счётчик сбитых замахов обнуляется.
            e.windingUp = false
            e.stunCount = 0
          }
        }
        behavior.onAction(ctx, e, action, e.sprite.currentFrame, dt, deltaMS)
        // onAction мог оборвать действие (отбит удар — уже оглушён).
        if (nc.action === action && (e.sprite.currentFrame >= e.sprite.totalFrames - 1 || !e.sprite.playing)) {
          endAction(e)
          behavior.onActionEnd?.(ctx, e, action)
        }
      } else if (e.x !== prevX) {
        ncPlay(e.sprite, nc, sheet('Walk'), a)
      } else {
        ncPlay(e.sprite, nc, sheet('Idle'), a)
      }

      pushOut(e)
      layout(e)
      syncMark(e, deps.worldContainer, e.x + e.width / 2, e.hpBarBg.y)
    }
  }

  function dispose(): void {}

  return { spawn, update, dispose, playDeath, ctx }
}

export type NcEnemySystem = ReturnType<typeof createNcEnemySystem>
