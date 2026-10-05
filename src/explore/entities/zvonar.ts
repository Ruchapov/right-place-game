import type { MutableRefObject } from 'react'
import { AnimatedSprite, Graphics, Sprite } from 'pixi.js'
import type { Container, Texture } from 'pixi.js'
import type { Grid, PlayerPhysics, Enemy, MapEvent, ZvonarAnimKind } from '../types'
import * as C from '../constants'
import { isSolid, sweepFootBlock, cellFootBlockTop } from '../collision'
import { clamp } from '../utils'
import { scaledZvonarMaxHp, scaledZvonarWaveDamage } from '../scaling'
import { redrawEnemyHpBar } from './enemy'

/**
 * ЗВОНАРЬ — второй враг, дальний бой (04.10.2026).
 *
 * Хрупкий стрелок: бьёт молотом по своему колоколу, тот вспыхивает и выпускает
 * звуковую волну строго по горизонтали. Ближнего удара и урона касанием НЕТ
 * вовсе — всё, что он может сделать игроку, прилетает волной.
 *
 * ⚠️ ОН ЛЕЖИТ В ТОМ ЖЕ СПИСКЕ `enemiesRef`, ЧТО И ЗВЕРИ, и это главное решение
 * всего модуля. Урон мечом, пять скиллов, стан льда, кровотечение, рывок и
 * парирование написаны по `Enemy[]` и достались Звонарю БЕЗ единой строки здесь
 * и без единой правки там. Цена решения — ровно два гейта: этот модуль
 * обслуживает только `kind === 'zvonar'`, а enemy.ts — только `'beast'`.
 *
 * Что перенесено от зверя ОДИН В ОДИН (см. enemy.ts, там же причины):
 * гравитация и посадка через sweepFootBlock, память агро (AGGRO_MEMORY_MS),
 * расследование по источнику урона, безусловный тик poiseImmuneTimer, заслон
 * стана льда (ПАУЗА), заслон стана парирования (ОТМЕНА), хитстан, патруль с
 * разворотом у стены и у края, смерть с DEATH_HOLD_MS и закрытием события,
 * тело как мягкая стена по X, посадка спрайта на поверхность тайла + FOOT_TUNE.
 *
 * Что СВОЁ: держание дистанции вместо погони, выстрел вместо удара, волна со
 * своим временем жизни, и якорь спрайта, который меняется при каждой смене листа
 * (у Звонаря у всех пяти листов РАЗНАЯ клетка — см. ZVONAR_SHEETS).
 */
export type ZvonarFrames = {
  idle: Texture[]
  walk: Texture[]
  attack: Texture[]
  hurt: Texture[]
  death: Texture[]
  wave: Texture
  impact: Texture[]
}

// Летящая волна. Живёт СВОИМ списком внутри модуля (как снаряды в skills.ts, а
// не как bossWaves в рефе Explore.tsx): наружу она не нужна никому, а выпустивший
// её Звонарь может умереть раньше, чем она долетит, — и обязан не забрать её с
// собой.
type ZvonarWave = {
  sprite: Sprite
  dir: 1 | -1
  // Сколько МИРОВЫХ пикселей волна уже пролетела. Дальность считается путём, а
  // не временем жизни: «до стены или 8 тайлов» — это про расстояние, и при
  // правке скорости дальность не должна поехать следом.
  travelled: number
  // Урон этой конкретной волны — снят с врага В МОМЕНТ ВЫСТРЕЛА, как у волны
  // босса: стрелок мог умереть, пока она летит.
  damage: number
  hitApplied: boolean
}

export type ZvonarDeps = {
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
   * ПАРИРУЕМЫЙ урон (та же общая точка, что у удара зверя). Возвращает true,
   * если герой ОТБИЛ, — тогда урона не было, и волна обязана погаснуть со
   * вспышкой.
   *
   * ⚠️ Отбив волны Звонаря НЕ СТАНИТ его самого, в отличие от отбитого удара
   * зверя. Это тот же случай, что отбитый шип босса (см. docs/explore-engine.md):
   * парировать летящий снаряд — не то же самое, что поймать на меч замах; стрелок
   * в этот момент уже закончил свой и стоит далеко.
   */
  takeDamage: (amount: number) => boolean
  /**
   * Идёт ли рывок героя — тот же dashingRef, что даёт неуязвимость в applyDamage.
   *
   * Нужен ЗДЕСЬ отдельно, хотя неуязвимость и так сработала бы: без этого гейта
   * волна «попала бы» в неуязвимого героя, погасла и выдала вспышку — то есть
   * рывок выглядел бы как «съел волну». По замыслу рывок проходит СКВОЗЬ неё, и
   * волна летит дальше. Отличить «урона не было из-за рывка» по возврату
   * takeDamage нельзя — он про парирование.
   */
  dashing: MutableRefObject<boolean>
  events: MutableRefObject<MapEvent[]>
  worldContainer: Container
  grid: Grid
  frames: MutableRefObject<ZvonarFrames | null>
  enemies: MutableRefObject<Enemy[]>
  characterLevel: MutableRefObject<number>
}

export function createZvonarSystem(deps: ZvonarDeps) {
  const worldWidthPx = deps.grid[0].length * C.TILE_SIZE
  let waves: ZvonarWave[] = []

  /**
   * Смена листа. ⚠️ Вместе с текстурами ОБЯЗАТЕЛЬНО меняется якорь: у пяти
   * листов Звонаря пять разных клеток, и один якорь на всех сдвинул бы фигуру
   * вбок и вниз при каждом переключении. Тот же приём, что playBossAnim.
   *
   * Сравнение по `zvonarAnim`, а не по массиву текстур (как playSpriteAnim у
   * зверя): лист может быть тем же, а якорь уже переписанным — и тогда
   * повторный вызов обязан ничего не делать, а не ставить якорь заново.
   */
  function playAnim(enemy: Enemy, kind: ZvonarAnimKind, frames: ZvonarFrames) {
    if (enemy.zvonarAnim === kind) return
    const spec = C.ZVONAR_SHEETS[kind]
    enemy.zvonarAnim = kind
    enemy.sprite.textures = frames[kind]
    enemy.sprite.anchor.set(spec.anchorX, spec.anchorY)
    enemy.sprite.animationSpeed = spec.speed
    enemy.sprite.loop = spec.loop
    enemy.sprite.gotoAndPlay(0)
  }

  function spawn(tileX: number, tileY: number, eventIndex: number): void {
    const worldX = tileX * C.TILE_SIZE + C.TILE_SIZE / 2 - C.ZVONAR_WIDTH / 2
    const worldY = (tileY + 1) * C.TILE_SIZE - C.ZVONAR_HEIGHT

    // Невидимый прямоугольник-хитбокс — ровно как у зверя: по нему считается вся
    // физика и попадания, спрайт поверх только рисует.
    const rect = new Graphics()
      .rect(0, 0, C.ZVONAR_WIDTH, C.ZVONAR_HEIGHT)
      .fill(C.ENEMY_COLOR)
      .stroke({ width: 2, color: 0xffffff })
    rect.pivot.set(C.ZVONAR_WIDTH / 2, 0)
    rect.x = worldX + C.ZVONAR_WIDTH / 2
    rect.y = worldY
    rect.visible = false
    deps.worldContainer.addChild(rect)

    const frames = deps.frames.current!
    const sprite = new AnimatedSprite(frames.idle)
    // ⚠️ ОДИН множитель на все листы — НЕ деление на высоту клетки. У Звонаря
    // пять разных клеток, и привычный приём дал бы скачок размера до 14.7% при
    // каждой смене анимации (см. ZVONAR_SCALE).
    sprite.scale.set(C.ZVONAR_SCALE)
    sprite.anchor.set(C.ZVONAR_SHEETS.idle.anchorX, C.ZVONAR_SHEETS.idle.anchorY)
    sprite.roundPixels = false
    sprite.animationSpeed = C.ZVONAR_SHEETS.idle.speed
    sprite.loop = true
    sprite.play()
    sprite.x = worldX + C.ZVONAR_WIDTH / 2
    sprite.y = worldY + C.ZVONAR_HEIGHT
    deps.worldContainer.addChild(sprite)

    const hpBarBg = new Graphics().rect(0, 0, C.ZVONAR_WIDTH, C.ENEMY_HP_BAR_HEIGHT).fill(0x221e2b)
    hpBarBg.x = worldX
    hpBarBg.y = worldY - C.ENEMY_HPBAR_OFFSET_Y - C.ENEMY_HP_BAR_MARGIN - C.ENEMY_HP_BAR_HEIGHT
    deps.worldContainer.addChild(hpBarBg)

    const hpBarFill = new Graphics()
    hpBarFill.x = worldX
    hpBarFill.y = hpBarBg.y
    deps.worldContainer.addChild(hpBarFill)

    // Уровень читается РОВНО ОДИН раз, при спавне — та же причина, что у зверя.
    const level = deps.characterLevel.current
    const maxHp = scaledZvonarMaxHp(level)

    const enemy: Enemy = {
      kind: 'zvonar',
      width: C.ZVONAR_WIDTH,
      height: C.ZVONAR_HEIGHT,
      x: worldX,
      y: worldY,
      vy: 0,
      hp: maxHp,
      maxHp,
      lastHitSwingId: 0,
      // Поля ближнего боя зверя. У Звонаря своя пара таймеров (waveCooldownMs +
      // windupTimer), но attackTimer/windingUp обязаны существовать: тип один на
      // обоих, и applyEnemyHitReaction читает windingUp у любого врага.
      attackTimer: 0,
      windingUp: false,
      windupTimer: 0,
      windupMs: C.ZVONAR_WAVE_SPAWN_MS,
      waveCooldownMs: 0,
      zvonarAnim: 'idle',
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
      // Урон у Звонаря не в руках, а в волне: поле обязано существовать (тип
      // общий), но ближнего удара у него нет, и в бой это число не попадает —
      // волна берёт своё из scaledZvonarWaveDamage в момент выстрела.
      attackDamage: 0,
      hpBarBg,
      hpBarFill,
    }
    redrawEnemyHpBar(enemy)
    deps.enemies.current.push(enemy)
  }

  // Выстрел — на кадре вспышки колокола. Точка вылета считается от ЯКОРЯ
  // спрайта (это и есть линия ступней), а не от центра клетки: смещения
  // замерены именно от него.
  function fireWave(enemy: Enemy, frames: ZvonarFrames) {
    const sprite = new Sprite(frames.wave)
    sprite.anchor.set(0.5, 0.5)
    sprite.width = C.ZVONAR_WAVE_DRAW_W
    sprite.height = C.ZVONAR_WAVE_DRAW_H
    // X — вперёд по взгляду, Y — вверх от ступней. Оба смещения в пикселях
    // ЛИСТА, поэтому умножаются на тот же ZVONAR_SCALE, что и сама фигура.
    sprite.x = enemy.sprite.x + enemy.facing * C.ZVONAR_WAVE_OFFSET_FORWARD * C.ZVONAR_SCALE
    sprite.y = enemy.sprite.y - C.ZVONAR_WAVE_OFFSET_UP * C.ZVONAR_SCALE
    // Лист нарисован смотрящим ВЛЕВО, как и сама фигура (facing === -1 — без
    // зеркала).
    if (enemy.facing === 1) sprite.scale.x = -Math.abs(sprite.scale.x)
    deps.worldContainer.addChild(sprite)
    waves.push({
      sprite,
      dir: enemy.facing,
      travelled: 0,
      damage: scaledZvonarWaveDamage(deps.characterLevel.current),
      hitApplied: false,
    })
  }

  /**
   * Вспышка на месте смерти волны — разовая анимация, снимает себя сама через
   * onComplete (тот же приём, что у импакта снаряда скиллов).
   *
   * ⚠️ Играем ZVONAR_WAVE_IMPACT_PLAY кадров из 25: последние три — хвост
   * затухания с альфой 25, 8 и 1 из 255, его всё равно не видно.
   */
  function spawnImpact(worldX: number, worldY: number, frames: ZvonarFrames) {
    const impact = new AnimatedSprite(frames.impact.slice(0, C.ZVONAR_WAVE_IMPACT_PLAY))
    impact.anchor.set(0.5, 0.5)
    impact.loop = false
    impact.animationSpeed = C.ZVONAR_WAVE_IMPACT_ANIM_SPEED
    // ⚠️ ВДВОЕ крупнее волны — пиксели в листе попадания вдвое мельче (так он
    // легче). Без этого множителя вспышка была бы вдвое меньше волны, которую
    // подменяет, и подмена читалась бы как «волна схлопнулась».
    impact.width = C.ZVONAR_WAVE_IMPACT_DRAW
    impact.height = C.ZVONAR_WAVE_IMPACT_DRAW
    impact.x = worldX
    impact.y = worldY
    impact.onComplete = () => {
      deps.worldContainer.removeChild(impact)
      impact.destroy()
    }
    deps.worldContainer.addChild(impact)
    impact.play()
  }

  function removeWave(w: ZvonarWave) {
    deps.worldContainer.removeChild(w.sprite)
    w.sprite.destroy()
  }

  /**
   * Полёт волн. Порядок причин смерти: ГЕРОЙ → ГЕОМЕТРИЯ → дальность, и он
   * важен на кадре, где совпали две: волна, догнавшая героя вплотную у стены,
   * обязана его ударить, а не погаснуть о кладку.
   *
   * ⚠️ Дальность — ЕДИНСТВЕННАЯ смерть без вспышки: вспышка означает «во что-то
   * попал», а выдохшаяся волна не попала ни во что (то же правило, что у снаряда
   * скиллов).
   */
  function updateWaves(deltaMS: number, frames: ZvonarFrames) {
    if (waves.length === 0) return
    const survivors: ZvonarWave[] = []
    const maxTravel = C.ZVONAR_WAVE_RANGE_TILES * C.TILE_SIZE
    for (const w of waves) {
      const step = C.ZVONAR_WAVE_SPEED * (deltaMS / 1000)
      w.sprite.x += w.dir * step
      w.travelled += step

      let remove = false
      let impact = false

      // Герой. Рывок пропускаем ЦЕЛИКОМ: по замыслу он проходит сквозь волну, и
      // волна летит дальше — она ни во что не попала.
      if (!w.hitApplied && !deps.dashing.current) {
        const box = deps.getPlayerCombatBox()
        const left = w.sprite.x - C.ZVONAR_WAVE_HIT_W / 2
        const top = w.sprite.y - C.ZVONAR_WAVE_HIT_H / 2
        const overlap =
          box.x < left + C.ZVONAR_WAVE_HIT_W &&
          box.x + box.w > left &&
          box.y < top + C.ZVONAR_WAVE_HIT_H &&
          box.y + box.h > top
        if (overlap) {
          w.hitApplied = true
          remove = true
          impact = true
          // Парирование разруливает сама takeDamage. Отбил — урона не было, но
          // волна всё равно гаснет со вспышкой: отбитая волна не летит дальше.
          deps.takeDamage(w.damage)
        }
      }

      // Геометрия — по ПЕРЕДНЕМУ краю хитбокса на высоте центра волны. Низ брать
      // нельзя: волна идёт над полом, и точка «низ−1» попадала бы в тайл земли.
      if (!remove) {
        const frontX = w.sprite.x + w.dir * (C.ZVONAR_WAVE_HIT_W / 2)
        if (isSolid(deps.grid, C.TILE_SIZE, frontX, w.sprite.y)) {
          remove = true
          impact = true
        }
      }

      // Дальность — последней и БЕЗ вспышки.
      if (!remove && w.travelled >= maxTravel) remove = true

      if (remove) {
        if (impact) spawnImpact(w.sprite.x, w.sprite.y, frames)
        removeWave(w)
      } else {
        survivors.push(w)
      }
    }
    waves = survivors
  }

  function pushPlayerOutOfZvonar(enemy: Enemy, playerBox: { x: number; y: number; w: number; h: number }) {
    deps.pushPlayerOutX(
      { x: enemy.x, y: enemy.y, width: enemy.width, height: enemy.height },
      playerBox,
    )
  }

  function update(dt: number, deltaMS: number): void {
    const frames = deps.frames.current
    for (let i = 0; i < deps.enemies.current.length; i++) {
      const enemy = deps.enemies.current[i]
      // ⚠️ Чужих пропускаем молча — зверями занимается enemy.ts. Это и есть вся
      // цена общего списка.
      if (enemy.kind !== 'zvonar') continue

      // --- Смерть (высший приоритет) ---
      if (enemy.dead) {
        const deathDone =
          frames && (enemy.sprite.currentFrame >= frames.death.length - 1 || !enemy.sprite.playing)
        if (deathDone) {
          enemy.deathHoldTimer += deltaMS
          if (enemy.deathHoldTimer >= C.DEATH_HOLD_MS) {
            const deathX = enemy.sprite.x
            const deathY = enemy.sprite.y - enemy.sprite.height
            // Мана — с каждого убитого, как у зверя (см. enemy.ts).
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

      // Стан-резист тикает БЕЗУСЛОВНО, до всех гейтов — как у зверя и по той же
      // причине: иначе стан дарил бы цели лишние секунды иммунитета.
      enemy.poiseImmuneTimer = Math.max(0, enemy.poiseImmuneTimer - deltaMS)

      // --- Стан льда: ПАУЗА ---
      const wasStunned = enemy.stunTimer > 0
      enemy.stunTimer = Math.max(0, enemy.stunTimer - deltaMS)
      if (enemy.stunTimer > 0) {
        if (enemy.sprite.playing) enemy.sprite.stop()
        pushPlayerOutOfZvonar(enemy, deps.getPlayerCombatBox())
        continue
      }

      // --- Стан парирования: ОТМЕНА ---
      // ⚠️ Накладывается он только за отбитый УДАР, а у Звонаря ударов нет — его
      // волна отбивается без стана (см. deps.takeDamage). Ветка всё равно здесь:
      // поле общее для всех врагов, и молча игнорировать его значило бы завести
      // вид врага, у которого стан не действует, не сказав об этом нигде.
      const wasParryStunned = enemy.parryStunTimer > 0
      enemy.parryStunTimer = Math.max(0, enemy.parryStunTimer - deltaMS)
      if (enemy.parryStunTimer > 0) {
        if (frames) {
          playAnim(enemy, 'hurt', frames)
          if (enemy.sprite.currentFrame >= frames.hurt.length - 1) {
            enemy.sprite.gotoAndStop(frames.hurt.length - 1)
          }
        }
        pushPlayerOutOfZvonar(enemy, deps.getPlayerCombatBox())
        continue
      }
      if (wasParryStunned && !enemy.sprite.playing) enemy.sprite.play()
      if (wasStunned && !enemy.sprite.playing) enemy.sprite.play()

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
      // «Герой на его ярусе» — ТА ЖЕ проверка перекрытия по вертикали, что у
      // зверя (verticalReach). Стрелять в героя этажом выше или ниже нельзя:
      // волна идёт строго горизонтально и всё равно пройдёт мимо.
      const sameTier = playerBox.y < enemy.y + enemy.height && playerBox.y + playerBox.h > enemy.y

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

      // Кулдаун выстрела тикает ВСЕГДА — в том числе в хитстане и во время самой
      // анимации: интервал считается «от начала замаха до начала замаха», и
      // ставить его на паузу значило бы растягивать его на длину собственной
      // анимации.
      enemy.waveCooldownMs = Math.max(0, enemy.waveCooldownMs - deltaMS)

      // --- Решения (хитстан замораживает их целиком, как у зверя) ---
      if (enemy.hurtTimer <= 0) {
        // Отошёл ли он В ЭТОМ КАДРЕ. От этого зависит, будет ли выстрел: по
        // дизайну отходящий НЕ стреляет, а загнанный в угол — стреляет с места.
        let retreating = false
        // Во время своей анимации удара Звонарь СТОИТ: замах уже начат, и
        // отходить посреди него он не будет (так же, как зверь не ходит в
        // windup).
        if (!enemy.attackAnimPlaying) {
          if (aggroed) {
            // Смотрит на героя всегда, даже когда не стреляет и не отходит.
            const toPlayer = Math.sign(dx)
            if (toPlayer !== 0) enemy.facing = toPlayer as 1 | -1

            // ДЕРЖИТ ДИСТАНЦИЮ: ближе порога — отходит назад. Упёрся в стену или
            // в край платформы — остаётся на месте и стреляет оттуда (решение
            // дизайнера: загнанный в угол не беспомощен).
            if (dist < C.ZVONAR_KEEP_DIST_TILES * C.TILE_SIZE) {
              const away = (-toPlayer || 1) as 1 | -1
              const nextX = enemy.x + away * C.ZVONAR_RETREAT_SPEED * dt
              const leadingX = away > 0 ? nextX + enemy.width : nextX
              // Стена и край — ТЕ ЖЕ проверки и в том же виде, что в патруле
              // зверя: своей геометрии не заводим.
              const hitWall =
                isSolid(deps.grid, C.TILE_SIZE, leadingX, enemy.y + 1) ||
                isSolid(deps.grid, C.TILE_SIZE, leadingX, enemy.y + enemy.height / 2) ||
                isSolid(deps.grid, C.TILE_SIZE, leadingX, enemy.y + enemy.height - 1)
              const footCx = Math.floor(leadingX / C.TILE_SIZE)
              const footCy = Math.floor((enemy.y + enemy.height) / C.TILE_SIZE)
              const noFloorAhead = cellFootBlockTop(deps.grid, C.TILE_SIZE, footCx, footCy) === null
              if (!hitWall && !noFloorAhead) {
                enemy.x = clamp(nextX, 0, worldWidthPx - enemy.width)
                retreating = true
              }
              // Упёрся (hitWall/noFloorAhead) — retreating остаётся false, и
              // выстрел ниже разрешён: «загнанный в угол не беспомощен».
            }
          } else if (enemy.investigateTimer > 0 && enemy.investigateX !== null) {
            // РАССЛЕДОВАНИЕ — перенос от зверя целиком, включая скорость: это
            // реакция на удар, а не прогулка. Отличие одно — идёт он скоростью
            // отхода, своей единственной «быстрой».
            const centerX = enemy.x + enemy.width / 2
            const toTarget = enemy.investigateX - centerX
            const dir = Math.sign(toTarget)
            const step = C.ZVONAR_RETREAT_SPEED * dt
            if (dir !== 0) enemy.facing = dir as 1 | -1
            if (dir === 0 || Math.abs(toTarget) <= step) {
              enemy.investigateTimer = 0
              enemy.investigateLookTimer = C.INVESTIGATE_LOOK_MS
            } else {
              const nextX = enemy.x + dir * step
              const leadingX = dir > 0 ? nextX + enemy.width : nextX
              const hitWall =
                isSolid(deps.grid, C.TILE_SIZE, leadingX, enemy.y + 1) ||
                isSolid(deps.grid, C.TILE_SIZE, leadingX, enemy.y + enemy.height / 2) ||
                isSolid(deps.grid, C.TILE_SIZE, leadingX, enemy.y + enemy.height - 1)
              const footCx = Math.floor(leadingX / C.TILE_SIZE)
              const footCy = Math.floor((enemy.y + enemy.height) / C.TILE_SIZE)
              const noFloorAhead = cellFootBlockTop(deps.grid, C.TILE_SIZE, footCx, footCy) === null
              if (hitWall || noFloorAhead) {
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
            const hitWall =
              isSolid(deps.grid, C.TILE_SIZE, leadingX, enemy.y + 1) ||
              isSolid(deps.grid, C.TILE_SIZE, leadingX, enemy.y + enemy.height / 2) ||
              isSolid(deps.grid, C.TILE_SIZE, leadingX, enemy.y + enemy.height - 1)
            const footCx = Math.floor(leadingX / C.TILE_SIZE)
            const footCy = Math.floor((enemy.y + enemy.height) / C.TILE_SIZE)
            const noFloorAhead = cellFootBlockTop(deps.grid, C.TILE_SIZE, footCx, footCy) === null
            const reachedBound = dir > 0 ? nextX > rightBound : nextX < leftBound
            if (reachedBound || hitWall || noFloorAhead) {
              enemy.patrolDir = dir > 0 ? -1 : 1
            } else {
              enemy.x = clamp(nextX, 0, worldWidthPx - enemy.width)
            }
            enemy.facing = enemy.patrolDir
          }

          // ВЫСТРЕЛ. Условия: помнит цель, герой на его ярусе, кулдаун истёк и
          // он НЕ отходит прямо сейчас.
          //
          // ⚠️ `!retreating` — это и есть «держит дистанцию» в боевом смысле:
          // пока он пятится, он не стреляет, поэтому подойти вплотную — рабочий
          // способ его заткнуть. Как только пятиться некуда (стена, край), флаг
          // остаётся false, и он разворачивается и бьёт в упор.
          if (aggroed && sameTier && !retreating && enemy.waveCooldownMs <= 0) {
            enemy.attackAnimPlaying = true
            enemy.attackHitApplied = false
            // Замах виден poise-системе: windingUp + windupTimer читает
            // applyEnemyHitReaction, и без них сбить замах Звонаря было бы
            // нельзя ВООБЩЕ (а стан-резист никогда бы не копился).
            enemy.windingUp = true
            enemy.windupTimer = 0
            // Кулдаун взводится СРАЗУ, на старте замаха: интервал считается от
            // начала до начала (2.5 с), и взвод его в момент вылета растянул бы
            // цикл на длину самого замаха.
            enemy.waveCooldownMs = C.ZVONAR_ATTACK_INTERVAL_MS
            if (frames) playAnim(enemy, 'attack', frames)
          }
        }
      }

      // Тело как мягкая стена по X — после всех перемещений, как у зверя.
      pushPlayerOutOfZvonar(enemy, playerBox)

      // --- Визуал ---
      enemy.rect.x = enemy.x + enemy.width / 2
      enemy.rect.y = enemy.y
      enemy.rect.scale.x = enemy.facing

      if (frames) {
        if (enemy.hurtTimer > 0) {
          enemy.hurtTimer = Math.max(0, enemy.hurtTimer - deltaMS)
          playAnim(enemy, 'hurt', frames)
        } else if (enemy.attackAnimPlaying) {
          enemy.windupTimer += deltaMS
          // Волна рождается на кадре вспышки, а не по таймеру: анимация и выстрел
          // не имеют права разъехаться (то же решение, что у strike-кадра зверя
          // и у кадра вылета снаряда героя).
          if (!enemy.attackHitApplied && enemy.sprite.currentFrame >= C.ZVONAR_WAVE_SPAWN_FRAME) {
            enemy.attackHitApplied = true
            // Замах дошёл до выстрела — та же роль, что у strike-кадра зверя:
            // счётчик сбитых замахов обнуляется, замах больше не идёт.
            enemy.stunCount = 0
            enemy.windingUp = false
            enemy.windupTimer = 0
            fireWave(enemy, frames)
          }
          if (enemy.sprite.currentFrame >= frames.attack.length - 1 || !enemy.sprite.playing) {
            enemy.attackAnimPlaying = false
            enemy.windingUp = false
          }
        } else if (enemy.x !== prevX) {
          // Темп ног — по ФАКТИЧЕСКОМУ шагу, как у зверя: режимов движения три
          // (отход, расследование, патруль), и два из них идут одной скоростью.
          const moved = Math.abs(enemy.x - prevX)
          const fast = moved > ((C.ENEMY_PATROL_SPEED + C.ZVONAR_RETREAT_SPEED) / 2) * dt
          playAnim(enemy, 'walk', frames)
          enemy.sprite.animationSpeed = fast ? C.ZVONAR_WALK_ANIM_RETREAT : C.ZVONAR_WALK_ANIM_PATROL
        } else {
          playAnim(enemy, 'idle', frames)
        }
        // Арт смотрит ВЛЕВО по умолчанию — как у зверя: facing === -1 без
        // зеркала. Масштаб тут ОДИН и тот же для всех листов, поэтому берём его
        // из константы, а не из текущего scale (тот у зверя приходится читать
        // через Math.abs именно потому, что у него он выведен из высоты клетки).
        enemy.sprite.scale.x = enemy.facing === -1 ? C.ZVONAR_SCALE : -C.ZVONAR_SCALE
      }

      const footBottom = enemy.y + enemy.height
      const surfaceY = deps.findGroundSurfaceY(enemy.x, enemy.width, footBottom)
      enemy.sprite.x = enemy.x + enemy.width / 2
      enemy.sprite.y = (surfaceY ?? footBottom) + C.FOOT_TUNE
      enemy.hpBarBg.x = enemy.x
      enemy.hpBarBg.y = enemy.y - C.ENEMY_HPBAR_OFFSET_Y - C.ENEMY_HP_BAR_MARGIN - C.ENEMY_HP_BAR_HEIGHT
      enemy.hpBarFill.x = enemy.x
      enemy.hpBarFill.y = enemy.hpBarBg.y
    }

    // Волны — ПОСЛЕ врагов, в том же кадре: выпущенная сейчас волна получает
    // свой первый шаг и hit-тест сразу, а не на следующем кадре (тот же порядок,
    // что у босса с его шипами).
    if (frames) updateWaves(deltaMS, frames)
  }

  function dispose(): void {
    // Волны — узлы, которые добавил в мир ЭТОТ модуль, поэтому чистит их он.
    // Вспышки не трогаем: они снимают себя сами по onComplete, а недоигравшие
    // умрут вместе с деревом (app.destroy в Explore.tsx) — то же решение, что у
    // импактов снарядов в skills.ts.
    for (const w of waves) removeWave(w)
    waves = []
  }

  return { spawn, update, dispose }
}
