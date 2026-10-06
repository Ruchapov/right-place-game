import type { MutableRefObject } from 'react'
import { AnimatedSprite, Graphics } from 'pixi.js'
import type { Container, Texture } from 'pixi.js'
import type { Grid, PlayerPhysics, Enemy, MapEvent, GatekeeperAnimKind, GatekeeperPhase } from '../types'
import * as C from '../constants'
import { isSolid, sweepFootBlock, cellFootBlockTop } from '../collision'
import { clamp } from '../utils'
import { scaledGatekeeperMaxHp, scaledGatekeeperDamage } from '../scaling'
import { redrawEnemyHpBar } from './enemy'

/**
 * ПРИВРАТНИК — третий враг, ближний бой с дверью-щитом (06.10.2026).
 *
 * Спереди его почти не взять: меч дверь гасит целиком, разовое попадание
 * навыка режет вдвое. Дверь поднята ВСЕГДА — окна после удара нет (решение
 * дизайнера 05.10.2026, отменило прежнее). Полный урон проходит в трёх случаях:
 * он оглушён отбитым ударом, он заморожен льдом, удар пришёл в спину. Всё, что
 * про дверь и урон, решает ОДНА точка, общая для всех источников: damageEnemy в
 * Explore.tsx, а отсюда она берёт только ответ «дверь сейчас закрывает его от
 * этой стороны?» (gatekeeperDoorBlocks ниже).
 *
 * Лежит в том же списке `enemiesRef`, что зверь и Звонарь, — по той же причине
 * и с той же ценой (см. шапку zvonar.ts): модуль обслуживает только
 * `kind === 'gatekeeper'`.
 *
 * Что перенесено от зверя ОДИН В ОДИН (причины — в enemy.ts): гравитация и
 * посадка через sweepFootBlock, условие и память агро, расследование по
 * источнику урона (ходьба скоростью погони, пауза «осмотреться»), патруль с
 * разворотом у стены, у края и на границе, погоня без проверки пола под ногами,
 * скорости патруля и погони, разворот к герою без задержки, старт замаха на
 * стоп-дистанции или при касании тел, взгляд, зафиксированный на весь замах,
 * проверка удара (дальность или касание, перекрытие по вертикали, герой
 * спереди), безусловный тик poiseImmuneTimer, заслон стана льда (ПАУЗА),
 * хитстан с прерыванием раннего замаха и стан-резистом (общая
 * applyEnemyHitReaction), смерть с DEATH_HOLD_MS, маной и закрытием события,
 * тело как мягкая стена по X, посадка спрайта на поверхность тайла + FOOT_TUNE.
 *
 * Что СВОЁ: дверь; атака, заданная временем (замах, потом выпад и возврат тем
 * же темпом); оглушение от парирования на 2.5 с стойкой на 25-м кадре вместо
 * hurt; кадры листа атаки, которые ставит код, а не AnimatedSprite; якорь,
 * меняющийся с листом.
 */
export type GatekeeperFrames = Record<GatekeeperAnimKind, Texture[]>

export type GatekeeperDeps = {
  phys: PlayerPhysics
  getPlayerCombatBox: () => { x: number; y: number; w: number; h: number }
  pushPlayerOutX: (
    body: { x: number; y: number; width: number; height: number },
    playerBox: { x: number; y: number; w: number; h: number },
  ) => void
  findGroundSurfaceY: (x: number, width: number, footY: number) => number | null
  closeEvent: (index: number, worldX?: number, worldY?: number) => void
  // Мана с убитого — то же, что у зверя (см. EnemyDeps в enemy.ts).
  dropMana: (worldX: number, worldY: number) => void
  /**
   * ПАРИРУЕМЫЙ урон — та же общая точка, что у удара зверя. Возвращает true,
   * если герой ОТБИЛ: урона не было, и последствия отбива накладывает этот
   * модуль — оглушение на GATEKEEPER_PARRY_STUN_MS, всё это время он открыт.
   */
  takeDamage: (amount: number) => boolean
  events: MutableRefObject<MapEvent[]>
  worldContainer: Container
  grid: Grid
  frames: MutableRefObject<GatekeeperFrames | null>
  enemies: MutableRefObject<Enemy[]>
  characterLevel: MutableRefObject<number>
}

/**
 * Открыт ли Привратник: дверь не защищает его НИ С КАКОЙ стороны.
 *
 * Ровно два случая, оба — станы, и оба читаются из таймеров общего Enemy:
 *   parryStunTimer — оглушён отбитым ударом (GATEKEEPER_PARRY_STUN_MS);
 *   stunTimer      — заморожен ледяным шаром, всё время заморозки.
 * Своего поля «дверь опущена» у него нет намеренно: два источника правды
 * однажды разошлись бы, и он стоял бы оглушённый за глухой дверью.
 *
 * ⚠️ Сам ледяной шар, который его заморозил, приходит ещё в поднятую дверь и
 * спереди режется вдвое: damageEnemy зовётся ДО того, как skills.ts выставит
 * stunTimer. Полный урон — у всего, что прилетит следом.
 */
export function gatekeeperIsOpen(enemy: Enemy): boolean {
  return enemy.gatekeeper !== undefined && (enemy.parryStunTimer > 0 || enemy.stunTimer > 0)
}

/**
 * Закрывает ли дверь Привратника от удара, пришедшего из точки sourceX.
 *
 * Два условия: он не открыт (см. gatekeeperIsOpen) и источник СПЕРЕДИ — с той
 * стороны, куда Привратник смотрит. Удар в спину дверь не закрывает никогда.
 * Ровно над ним (sourceX в центре) считается «спереди»: спорный случай отдан
 * двери, иначе стоящий вплотную герой бил бы сквозь неё.
 *
 * ⚠️ sourceX у снаряда — позиция СТРЕЛКА на момент выстрела, а не точка взрыва
 * (см. applyBlast в skills.ts). Для двери это верно по смыслу: шар, пущенный
 * в лицо, принят дверью, даже если его взрыв краем зоны достал и спину.
 *
 * Не Привратник — false: двери у него нет. Экспортируется, а не живёт в
 * системе: зовёт её damageEnemy из Explore.tsx, общая точка урона всех врагов.
 */
export function gatekeeperDoorBlocks(enemy: Enemy, sourceX: number): boolean {
  if (!enemy.gatekeeper || gatekeeperIsOpen(enemy)) return false
  const centerX = enemy.x + enemy.width / 2
  return enemy.facing === 1 ? sourceX >= centerX : sourceX <= centerX
}

export function createGatekeeperSystem(deps: GatekeeperDeps) {
  const worldWidthPx = deps.grid[0].length * C.TILE_SIZE

  // ЕДИНСТВЕННОЕ место, где меняется фаза.
  //
  // startMs — с какого времени фаза начинается. Обычно это остаток, перелетевший
  // за конец прошлой: без него каждая смена теряла бы до кадра, и выпад начинался
  // бы позже, чем кончился замах. После оглушения сюда приходит время, на котором
  // выпад был остановлен (см. заслон оглушения в update).
  function setPhase(enemy: Enemy, phase: GatekeeperPhase, startMs = 0) {
    const g = enemy.gatekeeper!
    g.phase = phase
    g.phaseMs = startMs
  }

  /**
   * Смена листа вместе с якорем — тот же приём и та же причина, что playAnim у
   * Звонаря: клетки у пяти листов разные.
   */
  function playAnim(enemy: Enemy, kind: GatekeeperAnimKind, frames: GatekeeperFrames) {
    const g = enemy.gatekeeper!
    if (g.anim === kind) return
    const spec = C.GATEKEEPER_SHEETS[kind]
    g.anim = kind
    enemy.sprite.textures = frames[kind]
    enemy.sprite.anchor.set(spec.anchorX, spec.anchorY)
    enemy.sprite.animationSpeed = spec.speed
    enemy.sprite.loop = spec.loop
    enemy.sprite.gotoAndPlay(0)
  }

  /**
   * Кадр листа атаки. Ставится КОДОМ по времени фазы, а не проигрывается:
   * оглушение держит 25-й кадр, и отдать это AnimatedSprite нельзя. Спрайт
   * трогает только на смену кадра.
   */
  function showAttackFrame(enemy: Enemy, frame: number, frames: GatekeeperFrames) {
    const g = enemy.gatekeeper!
    if (g.anim !== 'attack') {
      const spec = C.GATEKEEPER_SHEETS.attack
      g.anim = 'attack'
      enemy.sprite.textures = frames.attack
      enemy.sprite.anchor.set(spec.anchorX, spec.anchorY)
      enemy.sprite.loop = false
      enemy.sprite.gotoAndStop(frame)
      return
    }
    if (enemy.sprite.currentFrame !== frame) enemy.sprite.gotoAndStop(frame)
  }

  // Один темп на весь лист: сколько кадров прошло за phaseMs.
  function attackFrameOf(phase: GatekeeperPhase, phaseMs: number): number {
    const passed = Math.floor(phaseMs / C.GATEKEEPER_ATTACK_FRAME_MS)
    // Замах: до кадра удара включительно НЕ доходит — 21-й ставит сам удар.
    if (phase === 'windup') return Math.min(C.GATEKEEPER_STRIKE_FRAME - 1, passed)
    // Оглушён: выпад доходит до 25-го кадра тем же темпом и там стоит.
    if (phase === 'stunned') return Math.min(C.GATEKEEPER_STUN_HOLD_FRAME, C.GATEKEEPER_STRIKE_FRAME + passed)
    // Выпад и возврат двери: с кадра удара до конца листа.
    return Math.min(C.GATEKEEPER_ATTACK_COUNT - 1, C.GATEKEEPER_STRIKE_FRAME + passed)
  }

  function spawn(tileX: number, tileY: number, eventIndex: number): void {
    const worldX = tileX * C.TILE_SIZE + C.TILE_SIZE / 2 - C.GATEKEEPER_WIDTH / 2
    const worldY = (tileY + 1) * C.TILE_SIZE - C.GATEKEEPER_HEIGHT

    // Невидимый прямоугольник-хитбокс — ровно как у зверя и Звонаря.
    const rect = new Graphics()
      .rect(0, 0, C.GATEKEEPER_WIDTH, C.GATEKEEPER_HEIGHT)
      .fill(C.ENEMY_COLOR)
      .stroke({ width: 2, color: 0xffffff })
    rect.pivot.set(C.GATEKEEPER_WIDTH / 2, 0)
    rect.x = worldX + C.GATEKEEPER_WIDTH / 2
    rect.y = worldY
    rect.visible = false
    deps.worldContainer.addChild(rect)

    const frames = deps.frames.current!
    const sprite = new AnimatedSprite(frames.idle)
    // ⚠️ ОДИН множитель на все листы — НЕ деление на высоту клетки (см.
    // GATEKEEPER_SCALE).
    sprite.scale.set(C.GATEKEEPER_SCALE)
    sprite.anchor.set(C.GATEKEEPER_SHEETS.idle.anchorX, C.GATEKEEPER_SHEETS.idle.anchorY)
    sprite.roundPixels = false
    sprite.animationSpeed = C.GATEKEEPER_SHEETS.idle.speed
    sprite.loop = true
    sprite.play()
    sprite.x = worldX + C.GATEKEEPER_WIDTH / 2
    sprite.y = worldY + C.GATEKEEPER_HEIGHT
    deps.worldContainer.addChild(sprite)

    const hpBarBg = new Graphics().rect(0, 0, C.GATEKEEPER_WIDTH, C.ENEMY_HP_BAR_HEIGHT).fill(0x221e2b)
    hpBarBg.x = worldX
    hpBarBg.y = worldY - C.ENEMY_HPBAR_OFFSET_Y - C.ENEMY_HP_BAR_MARGIN - C.ENEMY_HP_BAR_HEIGHT
    deps.worldContainer.addChild(hpBarBg)

    const hpBarFill = new Graphics()
    hpBarFill.x = worldX
    hpBarFill.y = hpBarBg.y
    deps.worldContainer.addChild(hpBarFill)

    // Уровень читается РОВНО ОДИН раз, при спавне — та же причина, что у зверя.
    const level = deps.characterLevel.current
    const maxHp = scaledGatekeeperMaxHp(level)

    const enemy: Enemy = {
      kind: 'gatekeeper',
      width: C.GATEKEEPER_WIDTH,
      height: C.GATEKEEPER_HEIGHT,
      x: worldX,
      y: worldY,
      vy: 0,
      hp: maxHp,
      maxHp,
      lastHitSwingId: 0,
      // Кулдаун у Привратника свой (gatekeeper.cooldownMs, в мс); attackTimer —
      // поле зверя, оно обязано существовать (тип общий), но здесь не читается.
      attackTimer: 0,
      // windingUp/windupTimer/windupMs — НЕ мёртвые: их читает общая
      // applyEnemyHitReaction, и без них сбить его замах ударом в спину было бы
      // нельзя вообще, а стан-резист не копился бы.
      windingUp: false,
      windupTimer: 0,
      windupMs: C.GATEKEEPER_WINDUP_MS,
      waveCooldownMs: 0,
      zvonarAnim: null,
      gatekeeper: {
        anim: 'idle',
        phase: 'ready',
        phaseMs: 0,
        cooldownMs: 0,
        shakeMs: 0,
        guarded: false,
      },
      eventIndex,
      spawnX: worldX,
      patrolDir: 1,
      facing: 1,
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
      attackDamage: scaledGatekeeperDamage(level),
      hpBarBg,
      hpBarFill,
    }
    redrawEnemyHpBar(enemy)
    deps.enemies.current.push(enemy)
  }

  function pushPlayerOut(enemy: Enemy, playerBox: { x: number; y: number; w: number; h: number }) {
    deps.pushPlayerOutX({ x: enemy.x, y: enemy.y, width: enemy.width, height: enemy.height }, playerBox)
  }

  // Стена перед ведущим краем — ТЕ ЖЕ три точки, что в патруле и погоне зверя.
  function wallAhead(enemy: Enemy, leadingX: number) {
    return (
      isSolid(deps.grid, C.TILE_SIZE, leadingX, enemy.y + 1) ||
      isSolid(deps.grid, C.TILE_SIZE, leadingX, enemy.y + enemy.height / 2) ||
      isSolid(deps.grid, C.TILE_SIZE, leadingX, enemy.y + enemy.height - 1)
    )
  }
  function noFloorAhead(enemy: Enemy, leadingX: number) {
    const footCx = Math.floor(leadingX / C.TILE_SIZE)
    const footCy = Math.floor((enemy.y + enemy.height) / C.TILE_SIZE)
    return cellFootBlockTop(deps.grid, C.TILE_SIZE, footCx, footCy) === null
  }

  // Позиция спрайта, полосы HP и хитбокса. Отдельной функцией, потому что
  // зовётся и из обычного кадра, и из обоих заслонов (стан льда, оглушение):
  // встряска от шара, который его заморозил, доигрывает уже под станом.
  //
  // ⚠️ facing здесь только ПРИМЕНЯЕТСЯ, а не решается: в обоих заслонах он тот
  // же, что был до стана. В стане враг к герою не разворачивается — правило
  // общее для всех врагов.
  function syncVisual(enemy: Enemy) {
    const g = enemy.gatekeeper!
    enemy.rect.x = enemy.x + enemy.width / 2
    enemy.rect.y = enemy.y
    enemy.rect.scale.x = enemy.facing
    // Арт смотрит ВЛЕВО по умолчанию, как зверь и Звонарь: facing === -1 без
    // зеркала. Масштаб один на все листы — берём константу.
    enemy.sprite.scale.x = enemy.facing === -1 ? C.GATEKEEPER_SCALE : -C.GATEKEEPER_SCALE
    const footBottom = enemy.y + enemy.height
    const surfaceY = deps.findGroundSurfaceY(enemy.x, enemy.width, footBottom)
    // Встряска — знакопеременный сдвиг по X, только у спрайта: хитбокс и полоса
    // HP стоят на месте.
    const shake = g.shakeMs > 0 ? (Math.floor(g.shakeMs / 30) % 2 === 0 ? 1 : -1) * C.GATEKEEPER_DOOR_SHAKE_PX : 0
    enemy.sprite.x = enemy.x + enemy.width / 2 + shake
    enemy.sprite.y = (surfaceY ?? footBottom) + C.FOOT_TUNE
    enemy.hpBarBg.x = enemy.x
    enemy.hpBarBg.y = enemy.y - C.ENEMY_HPBAR_OFFSET_Y - C.ENEMY_HP_BAR_MARGIN - C.ENEMY_HP_BAR_HEIGHT
    enemy.hpBarFill.x = enemy.x
    enemy.hpBarFill.y = enemy.hpBarBg.y
  }

  function update(dt: number, deltaMS: number): void {
    const frames = deps.frames.current
    for (let i = 0; i < deps.enemies.current.length; i++) {
      const enemy = deps.enemies.current[i]
      // Чужих пропускаем молча — ими занимаются enemy.ts и zvonar.ts.
      if (enemy.kind !== 'gatekeeper') continue
      const g = enemy.gatekeeper!

      // --- Смерть (высший приоритет) — как у зверя и Звонаря ---
      if (enemy.dead) {
        const deathDone =
          frames && (enemy.sprite.currentFrame >= frames.death.length - 1 || !enemy.sprite.playing)
        if (deathDone) {
          enemy.deathHoldTimer += deltaMS
          if (enemy.deathHoldTimer >= C.DEATH_HOLD_MS) {
            const deathX = enemy.sprite.x
            const deathY = enemy.sprite.y - enemy.sprite.height
            deps.dropMana(enemy.x + enemy.width / 2, enemy.y + enemy.height / 2)
            deps.worldContainer.removeChild(enemy.rect, enemy.sprite, enemy.hpBarBg, enemy.hpBarFill)
            enemy.rect.destroy()
            enemy.sprite.destroy()
            enemy.hpBarBg.destroy()
            enemy.hpBarFill.destroy()
            deps.enemies.current.splice(i, 1)
            i--
            const ownerEvent = deps.events.current[enemy.eventIndex]
            if (ownerEvent) {
              ownerEvent.remainingEnemies = Math.max(0, (ownerEvent.remainingEnemies ?? 1) - 1)
              if (ownerEvent.remainingEnemies <= 0) deps.closeEvent(enemy.eventIndex, deathX, deathY)
            }
          }
        }
        continue
      }

      // Стан-резист и встряска тикают БЕЗУСЛОВНО, до всех заслонов.
      enemy.poiseImmuneTimer = Math.max(0, enemy.poiseImmuneTimer - deltaMS)
      g.shakeMs = Math.max(0, g.shakeMs - deltaMS)

      // --- Стан льда: ПАУЗА (как у всех) ---
      // Всё время заморозки он ОТКРЫТ: дверь не защищает ни с какой стороны
      // (gatekeeperIsOpen читает этот же stunTimer). Фаза и её время стоят
      // вместе со всем остальным — замах, застигнутый льдом, после него
      // доигрывает и бьёт, как у зверя. Не разворачивается: до решений ниже
      // этот кадр не доходит.
      const wasStunned = enemy.stunTimer > 0
      enemy.stunTimer = Math.max(0, enemy.stunTimer - deltaMS)
      if (enemy.stunTimer > 0) {
        if (enemy.sprite.playing) enemy.sprite.stop()
        pushPlayerOut(enemy, deps.getPlayerCombatBox())
        syncVisual(enemy)
        continue
      }

      // --- Оглушение от парирования ---
      // У зверя это «hurt один раз и держим кадр»; здесь выпад доходит до 25-го
      // кадра (дверь вынесена дальше всего, корпус за ней открыт) и стоит на нём
      // всё оглушение — это единственная в листах поза, по которой видно, что
      // дверь его не закрывает. Последний кадр hurt совпадает со стойкой, и по
      // нему оглушённого было бы не отличить от готового к бою.
      // Открыт он по таймеру (gatekeeperIsOpen), а не по этой позе.
      const wasParryStunned = enemy.parryStunTimer > 0
      enemy.parryStunTimer = Math.max(0, enemy.parryStunTimer - deltaMS)
      if (enemy.parryStunTimer > 0) {
        if (g.phase !== 'stunned') setPhase(enemy, 'stunned')
        g.phaseMs += deltaMS
        if (frames) showAttackFrame(enemy, attackFrameOf('stunned', g.phaseMs), frames)
        pushPlayerOut(enemy, deps.getPlayerCombatBox())
        syncVisual(enemy)
        continue
      }
      // Оглушение кончилось — выпад продолжается с того кадра, на котором стоял,
      // и доигрывает возврат двери обычным темпом. Дверь с этого кадра снова
      // защищает.
      if (wasParryStunned) {
        setPhase(enemy, 'follow', (C.GATEKEEPER_STUN_HOLD_FRAME - C.GATEKEEPER_STRIKE_FRAME) * C.GATEKEEPER_ATTACK_FRAME_MS)
      }
      // Выход из стана льда: вернуть проигрывание тому, что проигрывается.
      // ⚠️ Лист атаки НЕ проигрывается никогда (кадры ставит код), и play() на
      // нём запустил бы его от текущего кадра до конца сам по себе.
      if (wasStunned && !enemy.sprite.playing && g.anim !== 'attack') enemy.sprite.play()

      const prevX = enemy.x

      // --- Гравитация и посадка (перенос от зверя) ---
      enemy.vy = Math.min(enemy.vy + C.GRAVITY * dt, C.MAX_FALL)
      const prevFootY = enemy.y + enemy.height
      enemy.y += enemy.vy * dt
      const footY = enemy.y + enemy.height
      const blockTop = sweepFootBlock(deps.grid, C.TILE_SIZE, enemy.x, enemy.width, prevFootY, footY)
      if (blockTop !== null) {
        enemy.y = blockTop - enemy.height
        enemy.vy = 0
      }

      const playerBox = deps.getPlayerCombatBox()
      const dx = (playerBox.x + playerBox.w / 2) - (enemy.x + enemy.width / 2)
      const dist = Math.abs(dx)
      // Перекрытие по вертикали — то же условие, что verticalReach у зверя:
      // перепрыгнул — удар не достаёт.
      const verticalReach = playerBox.y < enemy.y + enemy.height && playerBox.y + playerBox.h > enemy.y
      const reachedStopDist = dist <= C.GATEKEEPER_STOP_DIST
      // Тела в контакте по X — та же альтернатива стоп-дистанции, что у зверя.
      const bodiesTouchingX =
        playerBox.x + playerBox.w >= enemy.x - C.TOUCH_EPS &&
        playerBox.x <= enemy.x + enemy.width + C.TOUCH_EPS

      // --- Память агро и расследование (перенос от зверя) ---
      const enemyFeetY = enemy.y + enemy.height
      const playerFeetY = deps.phys.y + C.PLAYER_HEIGHT
      const sameFloor = Math.abs(playerFeetY - enemyFeetY) <= C.SAME_FLOOR_TOLERANCE_TILES * C.TILE_SIZE
      if (dist <= C.AGGRO_RANGE_TILES * C.TILE_SIZE && sameFloor) {
        enemy.aggroMemoryTimer = C.AGGRO_MEMORY_MS
      } else {
        enemy.aggroMemoryTimer = Math.max(0, enemy.aggroMemoryTimer - deltaMS)
      }
      const aggroed = enemy.aggroMemoryTimer > 0

      if (aggroed) {
        enemy.investigateTimer = 0
        enemy.investigateLookTimer = 0
        enemy.investigateX = null
      } else if (enemy.investigateTimer > 0) {
        enemy.investigateTimer = Math.max(0, enemy.investigateTimer - deltaMS)
        if (enemy.investigateTimer === 0) enemy.investigateLookTimer = C.INVESTIGATE_LOOK_MS
      } else if (enemy.investigateLookTimer > 0) {
        enemy.investigateLookTimer = Math.max(0, enemy.investigateLookTimer - deltaMS)
        if (enemy.investigateLookTimer === 0) enemy.investigateX = null
      }

      // Кулдаун тикает и в хитстане, и во время самой атаки: интервал считается
      // от начала замаха до начала замаха.
      // ⚠️ Под обоими заслонами выше (стан льда, оглушение) он СТОИТ — туда этот
      // код не доходит. Поэтому после отбитого удара Привратник не бьёт сразу:
      // от замаха прошло 800 мс, остаток 1700 мс дотикивает за возврат двери
      // (≈876 мс) и ещё ≈824 мс стойки. У зверя и босса так же — кулдаун после
      // стана парирования остаётся взведённым.
      g.cooldownMs = Math.max(0, g.cooldownMs - deltaMS)

      // Хитстан сбил замах или возврат двери (applyEnemyHitReaction уже снял
      // windingUp и attackAnimPlaying) — фаза обязана уйти следом, иначе по
      // выходе из хитстана он продолжил бы удар с прерванного места. Хитстан у
      // него бывает только от удара в спину: дверь его не даёт, а пока он
      // открыт станом, реакции на попадание нет вовсе (см. applyEnemyHitReaction).
      if (enemy.hurtTimer > 0 && g.phase !== 'ready') setPhase(enemy, 'ready')

      // --- Решения (хитстан замораживает их целиком, как у зверя) ---
      if (enemy.hurtTimer <= 0) {
        // Сначала идущая атака, потом 'ready' — ОТДЕЛЬНЫМ if, а не веткой той же
        // цепочки: возврат двери, закончившийся в этом кадре, в этом же кадре и
        // отдаёт ход решениям, без пустого кадра между ними.
        if (g.phase === 'windup') {
          g.phaseMs += deltaMS
          // Прогресс замаха для общей poise-системы (applyEnemyHitReaction).
          enemy.windupTimer = g.phaseMs
          if (g.phaseMs >= C.GATEKEEPER_WINDUP_MS) {
            // УДАР — ровно в конце замаха, это и есть кадр 21. Проверка та же,
            // что у зверя, и бокс героя берётся ЗАНОВО: push-out мог сдвинуть
            // его после расчёта playerBox выше.
            enemy.attackHitApplied = true
            enemy.stunCount = 0
            enemy.windingUp = false
            enemy.windupTimer = 0
            const strikeBox = deps.getPlayerCombatBox()
            const playerCenterX = strikeBox.x + strikeBox.w / 2
            const playerOnRight = playerCenterX > enemy.x + enemy.width / 2
            const playerInFront = (enemy.facing === 1 && playerOnRight) || (enemy.facing === -1 && !playerOnRight)
            const inReach = Math.abs(playerCenterX - (enemy.x + enemy.width / 2)) < C.GATEKEEPER_ATTACK_RANGE
            const strikeVertical = strikeBox.y < enemy.y + enemy.height && strikeBox.y + strikeBox.h > enemy.y
            // Попал, промахнулся или герой ушёл — дальше выпад и возврат двери,
            // и дверь всё это время ПОДНЯТА: окна после удара нет. Открывает его
            // только отбитый удар — оглушением.
            if ((inReach || bodiesTouchingX) && strikeVertical && playerInFront && deps.takeDamage(enemy.attackDamage)) {
              enemy.parryStunTimer = C.GATEKEEPER_PARRY_STUN_MS
              setPhase(enemy, 'stunned')
            } else {
              setPhase(enemy, 'follow', g.phaseMs - C.GATEKEEPER_WINDUP_MS)
            }
          }
        } else if (g.phase === 'follow') {
          g.phaseMs += deltaMS
          if (g.phaseMs >= C.GATEKEEPER_FOLLOW_MS) {
            setPhase(enemy, 'ready')
            enemy.attackAnimPlaying = false
          }
        }

        if (g.phase === 'ready') {
          if (aggroed) {
            // Разворот к герою — сразу, без задержки, как у остальных врагов.
            const toPlayer = Math.sign(dx)
            if (toPlayer !== 0) enemy.facing = toPlayer as 1 | -1
            // ПОГОНЯ — как у зверя: пол под ногами не проверяется (с края
            // падает), в героя вплотную не лезет.
            if (!reachedStopDist && !bodiesTouchingX) {
              const dir = (toPlayer || 1) as 1 | -1
              const nextX = enemy.x + dir * C.ENEMY_CHASE_SPEED * dt
              const leadingX = dir > 0 ? nextX + enemy.width : nextX
              if (!wallAhead(enemy, leadingX)) enemy.x = clamp(nextX, 0, worldWidthPx - enemy.width)
            }
          } else if (enemy.investigateTimer > 0 && enemy.investigateX !== null) {
            // РАССЛЕДОВАНИЕ — перенос от зверя: идёт к точке скоростью погони.
            const toTarget = enemy.investigateX - (enemy.x + enemy.width / 2)
            const dir = Math.sign(toTarget)
            const step = C.ENEMY_CHASE_SPEED * dt
            if (dir !== 0) enemy.facing = dir as 1 | -1
            if (dir === 0 || Math.abs(toTarget) <= step) {
              enemy.investigateTimer = 0
              enemy.investigateLookTimer = C.INVESTIGATE_LOOK_MS
            } else {
              const nextX = enemy.x + dir * step
              const leadingX = dir > 0 ? nextX + enemy.width : nextX
              if (wallAhead(enemy, leadingX) || noFloorAhead(enemy, leadingX)) {
                enemy.investigateTimer = 0
                enemy.investigateLookTimer = C.INVESTIGATE_LOOK_MS
              } else {
                enemy.x = clamp(nextX, 0, worldWidthPx - enemy.width)
              }
            }
          } else if (enemy.investigateLookTimer > 0 && enemy.investigateX !== null) {
            const dir = Math.sign(enemy.investigateX - (enemy.x + enemy.width / 2))
            if (dir !== 0) enemy.facing = dir as 1 | -1
          } else {
            // ПАТРУЛЬ — перенос от зверя один в один.
            const leftBound = enemy.spawnX - C.PATROL_RANGE_TILES * C.TILE_SIZE
            const rightBound = enemy.spawnX + C.PATROL_RANGE_TILES * C.TILE_SIZE
            const dir = enemy.patrolDir
            const nextX = enemy.x + dir * C.ENEMY_PATROL_SPEED * dt
            const leadingX = dir > 0 ? nextX + enemy.width : nextX
            const reachedBound = dir > 0 ? nextX > rightBound : nextX < leftBound
            if (reachedBound || wallAhead(enemy, leadingX) || noFloorAhead(enemy, leadingX)) {
              enemy.patrolDir = dir > 0 ? -1 : 1
            } else {
              enemy.x = clamp(nextX, 0, worldWidthPx - enemy.width)
            }
            enemy.facing = enemy.patrolDir
          }

          // СТАРТ ЗАМАХА — условие зверя: стоп-дистанция или касание тел, плюс
          // перекрытие по вертикали. Взгляд с этого момента зафиксирован до
          // конца анимации (замах, выпад, возврат — ≈1.83 с): обежать его за это
          // время — законный способ и уклониться, и зайти в спину.
          if ((reachedStopDist || bodiesTouchingX) && verticalReach && g.cooldownMs <= 0) {
            setPhase(enemy, 'windup')
            // Кулдаун — СРАЗУ, на старте: «от начала до начала».
            g.cooldownMs = C.GATEKEEPER_ATTACK_INTERVAL_MS
            enemy.windingUp = true
            enemy.windupTimer = 0
            enemy.attackAnimPlaying = true
            enemy.attackHitApplied = false
          }
        }
      }

      // Тело как мягкая стена по X — после всех перемещений, как у зверя.
      pushPlayerOut(enemy, playerBox)

      // --- Визуал: hurt > атака (замах, выпад, возврат) > ходьба/стойка ---
      if (frames) {
        if (enemy.hurtTimer > 0) {
          enemy.hurtTimer = Math.max(0, enemy.hurtTimer - deltaMS)
          playAnim(enemy, 'hurt', frames)
        } else if (g.phase !== 'ready') {
          showAttackFrame(enemy, attackFrameOf(g.phase, g.phaseMs), frames)
        } else if (enemy.x !== prevX) {
          // Темп ног — по ФАКТИЧЕСКОМУ шагу, как у зверя: погоня и расследование
          // идут одной скоростью, патруль — другой.
          const moved = Math.abs(enemy.x - prevX)
          const fast = moved > ((C.ENEMY_PATROL_SPEED + C.ENEMY_CHASE_SPEED) / 2) * dt
          playAnim(enemy, 'walk', frames)
          enemy.sprite.animationSpeed = fast ? C.GATEKEEPER_WALK_ANIM_CHASE : C.GATEKEEPER_WALK_ANIM_PATROL
        } else {
          // После атаки и после hurt стойка идёт с кадра 0 — playAnim так и
          // делает при смене листа.
          playAnim(enemy, 'idle', frames)
        }
      }
      syncVisual(enemy)
    }
  }

  function dispose(): void {
    // Своих узлов сверх тех, что лежат в самих врагах, у модуля нет: снарядов
    // Привратник не выпускает. Враги уничтожаются деревом сцены (app.destroy),
    // как и у enemy.ts.
  }

  return { spawn, update, dispose }
}
