import type { MutableRefObject } from 'react'
import { AnimatedSprite, Graphics } from 'pixi.js'
import type { Container, Texture } from 'pixi.js'
import type { Grid, PlayerPhysics, Enemy, MapEvent, RewardKind } from '../types'
import * as C from '../constants'
import { isSolid, sweepFootBlock, cellFootBlockTop } from '../collision'
import { clamp } from '../utils'
import { scaledEnemyMaxHp, scaledEnemyAttackDamage } from '../scaling'

// Кадры зверя (Шаг "спрайт зверя") — загружаются ОДИН раз в setup(), общие
// для всех врагов кластера (каждый враг заводит СВОЙ AnimatedSprite поверх
// одних и тех же Texture-массивов). AI/переключение по состоянию — позже,
// пока используется только idle.
export type BeastFrames = { idle: Texture[]; walk: Texture[]; attack: Texture[]; hurt: Texture[]; death: Texture[] }

// HP-бар врага — в мире (Pixi Graphics над его головой), а не DOM-оверлей,
// как у игрока: враг двигается вместе с камерой, а не фиксирован на экране.
// Экспортируется отдельно (не только через createEnemySystem) — вызывается
// и из applyAttackHit() в Explore.tsx (на попадании/смерти), которая с этим
// переносом не трогалась.
export function redrawEnemyHpBar(enemy: Enemy) {
  const pct = Math.max(0, Math.min(1, enemy.hp / enemy.maxHp))
  enemy.hpBarFill.clear()
  if (pct > 0) {
    enemy.hpBarFill.rect(0, 0, C.ENEMY_WIDTH * pct, C.ENEMY_HP_BAR_HEIGHT).fill(0xe0353b)
  }
}

// Зависимости — те же closure-значения/рефы setup() в Explore.tsx, что уже
// передаются в explore/entities/skills.ts (тот же приём: врагу нужны почти
// те же самые точки входа в мир игрока). enemies/beastFrames — ОБЩИЕ рефы
// с Explore.tsx (владение НЕ переезжает — см. задачу): applyAttackHit() в
// Explore.tsx мутирует те же объекты Enemy через тот же enemiesRef, эта
// система его не подменяет, просто ещё один держатель того же рефа.
export type EnemyDeps = {
  phys: PlayerPhysics
  getPlayerCombatBox: () => { x: number; y: number; w: number; h: number }
  pushPlayerOutX: (
    body: { x: number; y: number; width: number; height: number },
    playerBox: { x: number; y: number; w: number; h: number },
  ) => void
  playSpriteAnim: (sprite: AnimatedSprite, frames: Texture[], speed: number, loop: boolean) => void
  findGroundSurfaceY: (x: number, width: number, footY: number) => number | null
  spawnRewardFloat: (
    worldX: number,
    worldY: number,
    rewards: { kind: RewardKind; amount: number; negative?: boolean }[],
  ) => void
  closeEvent: (index: number) => void
  // ОБЁРТКА над takeDamageRef, а не takeDamage напрямую: deps собираются
  // ОДИН раз при создании системы в setup(), а takeDamageRef синхронизируется
  // отдельным useEffect'ом на каждый рендер именно затем, чтобы тикер всегда
  // звал АКТУАЛЬНУЮ версию функции — прямая передача took бы снимок с
  // момента создания и сломала бы эту синхронизацию.
  takeDamage: (amount: number) => void
  dodgeIframe: MutableRefObject<number>
  events: MutableRefObject<MapEvent[]>
  worldContainer: Container
  grid: Grid
  beastFrames: MutableRefObject<BeastFrames | null>
  enemies: MutableRefObject<Enemy[]>
  // Уровень персонажа (см. задачу "масштабирование по уровню") — читается
  // РОВНО ОДИН РАЗ, в момент спавна (см. spawn ниже), не в update(): уже
  // заспавненный враг не должен менять HP/урон, если уровень посреди забега
  // почему-то изменится (сейчас не меняется, см. characterLevelRef в
  // Explore.tsx, но spawn — единственное место, где этот реф читается).
  characterLevel: MutableRefObject<number>
}

// Создаётся ОДИН раз в setup() (тот же момент, что и createSkillsSystem —
// после того, как определены worldContainer/grid/getPlayerCombatBox).
// enemies/beastFrames — общие рефы с Explore.tsx, состояние списка врагов
// НЕ приватно модулю (в отличие от skills.ts, где снаряды/кулдауны будут
// жить внутри) — так applyAttackHit() в Explore.tsx продолжает читать/
// писать те же объекты Enemy без каких-либо изменений в своём коде.
export function createEnemySystem(deps: EnemyDeps) {
  // Та же формула, что worldWidthPx в setup() Explore.tsx (grid[0].length *
  // TILE_SIZE) — врагу для клэмпа движения по X нужно то же число, но как
  // отдельный deps-параметр его тащить незачем: пересчитывается один раз
  // здесь же из deps.grid, значение идентично.
  const worldWidthPx = deps.grid[0].length * C.TILE_SIZE

  // Спавнит ОДНОГО врага-прямоугольник (см. Шаг 2-1/2-2) в тайловых
  // координатах (tileX,tileY), привязанного к enemy-событию eventIndex
  // (для декремента remainingEnemies при смерти). Ставит ногами на пол
  // клетки, как игрока.
  function spawn(tileX: number, tileY: number, eventIndex: number, trophyReward: number): void {
    const enemyWorldX = tileX * C.TILE_SIZE + C.TILE_SIZE / 2 - C.ENEMY_WIDTH / 2
    const enemyWorldY = (tileY + 1) * C.TILE_SIZE - C.ENEMY_HEIGHT

    const rect = new Graphics()
      .rect(0, 0, C.ENEMY_WIDTH, C.ENEMY_HEIGHT)
      .fill(C.ENEMY_COLOR)
      .stroke({ width: 2, color: 0xffffff })
    // Пивот по центру X — чтобы разворот (facing) флипал rect.scale.x
    // вокруг центра, а не сдвигал его в сторону (см. синк x ниже: rect.x
    // ставится в enemy.x + ENEMY_WIDTH/2, а не enemy.x напрямую).
    rect.pivot.set(C.ENEMY_WIDTH / 2, 0)
    rect.x = enemyWorldX + C.ENEMY_WIDTH / 2
    rect.y = enemyWorldY
    // Заменён спрайтом зверя ниже — остаётся невидимым хитбоксом: AI
    // (windup-tint/facing-flip) по-прежнему пишет в rect.tint/scale.x,
    // трогать эту логику не просили на этом шаге.
    rect.visible = false
    deps.worldContainer.addChild(rect)

    // Визуал — AnimatedSprite поверх (невидимого) хитбокса, по образцу
    // героя: своя копия AnimatedSprite на каждого врага кластера, но все
    // используют ОДНИ И ТЕ ЖЕ Texture-массивы из beastFramesRef (загружены
    // один раз в setup()). Пока всегда idle — переключение по AI-состоянию
    // и флип по направлению будут отдельным шагом.
    const beastFrames = deps.beastFrames.current!
    const sprite = new AnimatedSprite(beastFrames.idle)
    sprite.anchor.set(0.494, 0.972) // торс по центру, ноги — низ хитбокса
    sprite.scale.set(C.BEAST_CELL_RENDER_H / beastFrames.idle[0].height)
    sprite.roundPixels = false
    sprite.animationSpeed = C.BEAST_IDLE_ANIM_SPEED
    sprite.loop = true
    sprite.play()
    // Та же точка привязки, что раньше была у прямоугольника: центр по X,
    // НИЗ хитбокса по Y (не верх, как у rect — якорь спрайта другой).
    sprite.x = enemyWorldX + C.ENEMY_WIDTH / 2
    sprite.y = enemyWorldY + C.ENEMY_HEIGHT
    deps.worldContainer.addChild(sprite)

    const hpBarBg = new Graphics().rect(0, 0, C.ENEMY_WIDTH, C.ENEMY_HP_BAR_HEIGHT).fill(0x221e2b)
    hpBarBg.x = enemyWorldX
    hpBarBg.y = enemyWorldY - C.ENEMY_HPBAR_OFFSET_Y - C.ENEMY_HP_BAR_MARGIN - C.ENEMY_HP_BAR_HEIGHT
    deps.worldContainer.addChild(hpBarBg)

    const hpBarFill = new Graphics()
    hpBarFill.x = enemyWorldX
    hpBarFill.y = hpBarBg.y
    deps.worldContainer.addChild(hpBarFill)

    // Масштабирование по уровню (см. задачу) — считается ОДИН раз здесь, при
    // спавне; дальше живёт как обычное поле enemy.hp/maxHp/attackDamage, update()
    // формулу больше не трогает.
    const level = deps.characterLevel.current
    const scaledMaxHp = scaledEnemyMaxHp(level)
    const scaledAttackDamage = scaledEnemyAttackDamage(level)

    const enemy: Enemy = {
      x: enemyWorldX,
      y: enemyWorldY,
      vy: 0,
      hp: scaledMaxHp,
      maxHp: scaledMaxHp,
      lastHitSwingId: 0,
      attackTimer: 0,
      windingUp: false,
      windupTimer: 0,
      eventIndex,
      spawnX: enemyWorldX,
      patrolDir: 1,
      facing: 1,
      rect,
      sprite,
      attackAnimPlaying: false,
      attackHitApplied: false,
      hurtTimer: 0,
      stunCount: 0,
      poiseImmuneTimer: 0,
      // Память о цели пуста: заспавненный враг никого не преследует, пока
      // условие агро не выполнится в первый раз (см. AGGRO_MEMORY_MS).
      aggroMemoryTimer: 0,
      // Расследовать нечего: врагу ещё не наносили урон (см. INVESTIGATE_MS).
      investigateX: null,
      investigateTimer: 0,
      investigateLookTimer: 0,
      // Не заморожен (см. ICEBALL_STUN_MS).
      stunTimer: 0,
      dead: false,
      deathHoldTimer: 0,
      trophyReward,
      attackDamage: scaledAttackDamage,
      hpBarBg,
      hpBarFill,
    }
    redrawEnemyHpBar(enemy)
    deps.enemies.current.push(enemy)
  }

  // dt — кадро-масштабированный (ticker.deltaTime, как у phys игрока) — для
  // движения; deltaMS — реальные миллисекунды (ticker.deltaMS) — для ВСЕХ
  // таймеров (attackTimer/windupTimer/hurtTimer/poiseImmuneTimer/
  // deathHoldTimer). В отличие от skills.ts (там один dt в мс) — врагу
  // нужны оба масштаба одновременно, как и в исходном коде тикера.
  // Тело врага как мягкая стена по X — ОДНА точка на ДВА вызова: обычный
  // кадр (после того как AI применил движение, см. ниже по циклу) и кадр под
  // СТАНОМ (заслон делает continue раньше, а тело обязано остаться
  // физическим — иначе сквозь замороженного врага игрок проходит насквозь).
  // Идёт через deps.pushPlayerOutX, а это pushPlayerOutXUnlessDashing из
  // Explore.tsx: рывок по-прежнему проходит сквозь тела, и стан этого не
  // меняет ни в одну сторону — под станом рывок проходит, ходьба упирается.
  // playerCombatBox параметром, а не через deps.getPlayerCombatBox() внутри:
  // в обычном кадре бокс уже посчитан выше по итерации, и пересчёт был бы
  // лишним (значение то же — phys.x до этой точки в итерации не менялся).
  function pushPlayerOutOfEnemy(
    enemy: Enemy,
    playerCombatBox: { x: number; y: number; w: number; h: number },
  ) {
    deps.pushPlayerOutX(
      { x: enemy.x, y: enemy.y, width: C.ENEMY_WIDTH, height: C.ENEMY_HEIGHT },
      playerCombatBox,
    )
  }

  function update(dt: number, deltaMS: number): void {
    // Враги (Шаг 2-3: СПИСОК — кластер из 3, может быть несколько
    // enemy-событий за забег). Каждый враг обрабатывается НЕЗАВИСИМО:
    // AI (преследование/windup/удар по игроку, Шаг 2-2). Урон от атаки
    // игрока сюда больше не входит — см. applyAttackHit(), вызывается
    // отдельно из блока анимации героя, на кадре удара. Если игрок стоит
    // между двумя врагами — оба независимо проверяют дистанцию и оба
    // могут его ударить в один и тот же кадр; HP игрока один общий
    // (takeDamageRef), отдельно считать не нужно.
    for (let i = 0; i < deps.enemies.current.length; i++) {
      const enemy = deps.enemies.current[i]

      // Death — высший приоритет (death > hurt > attack > walk/idle):
      // мёртвый враг ПОЛНОСТЬЮ пропускает физику/AI/hurt/attack/idle-walk
      // ниже (не двигается, не бьёт, не сталкивается с игроком — только
      // визуал). Позиция спрайта не трогается — падение уже "зашито" в
      // кадры, персонаж остаётся там, где умер (см. spawnEnemy/anchor).
      // Сама death-анимация запущена в applyAttackHit (playSpriteAnim),
      // здесь только ждём её конца + DEATH_HOLD_MS удержания, потом —
      // та же очистка/декремент remainingEnemies/closeEvent, что раньше
      // срабатывала СРАЗУ на смертельном ударе.
      if (enemy.dead) {
        const beastFrames = deps.beastFrames.current
        const deathDone =
          beastFrames && (enemy.sprite.currentFrame >= beastFrames.death.length - 1 || !enemy.sprite.playing)
        if (deathDone) {
          enemy.deathHoldTimer += deltaMS
          if (enemy.deathHoldTimer >= C.DEATH_HOLD_MS) {
            // Трофеи за убийство (см. задачу) — доля этого врага уже
            // разыграна при спавне кластера (enemy.trophyReward). 0 —
            // не вызываем spawnRewardFloat, чтобы не всплывала пустая
            // надпись "+0" (см. задачу, п.4).
            if (enemy.trophyReward > 0) {
              deps.spawnRewardFloat(enemy.sprite.x, enemy.sprite.y - enemy.sprite.height, [
                { kind: 'trophy', amount: enemy.trophyReward },
              ])
            }
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
              if (ownerEvent.remainingEnemies <= 0) deps.closeEvent(enemy.eventIndex)
            }
          }
        }
        continue
      }

      // СТАН от iceball (см. ICEBALL_STUN_MS) — ЗАСЛОН в начале обновления
      // сущности: пока таймер >0, ниже не выполняется НИЧЕГО — ни AI, ни
      // движение, ни физика, ни продвижение кадров анимации. Это ПАУЗА, а не
      // отмена: спрайт замирает на текущем кадре, состояние (замах, windup,
      // память агро, расследование, хитстан) остаётся ровно таким, каким его
      // застало, и после стана продолжается с того же места. Замах,
      // прерванный станом, доигрывается и бьёт — даже если игрок успел
      // отойти. Это осознанное решение, а не недоделка.
      //
      // Таймер тикает БЕЗУСЛОВНО, до всех гейтов (как aggroMemoryTimer и
      // таймеры расследования) — иначе стан не истекал бы, например, в
      // хитстане. Мёртвый враг сюда не доходит (continue выше): смерть
      // главнее стана, замораживать death-анимацию нельзя.
      //
      // sprite.stop() обязателен: AnimatedSprite крутит кадры сам, от общего
      // тикера Pixi (autoUpdate), и без остановки картинка продолжала бы
      // играть на замершем теле. play() на выходе — там же, ниже.
      // Накопительный стан-резист (см. STUN_LIMIT/POISE_IMMUNE_MS) — тикает
      // вниз КАЖДЫЙ кадр, в том числе под станом и независимо от того,
      // загрузились ли кадры зверя. Стоит ЗДЕСЬ, до заслона, ровно по той же
      // причине, что и выталкивание ниже: раньше декремент лежал в блоке
      // визуала, заслон его пропускал, и 2 секунды стана дарили цели 2 лишние
      // секунды иммунитета к прерыванию — то есть iceball косвенно защищал
      // цель от хитстана.
      // ⚠️ hurtTimer и hitFlashTimer намеренно НЕ вынесены: их доигрывание
      // после разморозки — осознанное поведение (пауза, а не отмена).
      enemy.poiseImmuneTimer = Math.max(0, enemy.poiseImmuneTimer - deltaMS)

      const wasStunned = enemy.stunTimer > 0
      enemy.stunTimer = Math.max(0, enemy.stunTimer - deltaMS)
      if (enemy.stunTimer > 0) {
        if (enemy.sprite.playing) enemy.sprite.stop()
        // Тело остаётся ФИЗИЧЕСКИМ: замороженный враг не перестаёт быть
        // мягкой стеной по X. Заслон пропускает решения и движение, а не
        // столкновение с телом. Порядок "после движения", важный в обычном
        // кадре, здесь безразличен — под станом враг не двигается.
        pushPlayerOutOfEnemy(enemy, deps.getPlayerCombatBox())
        continue
      }
      if (wasStunned && !enemy.sprite.playing) {
        // Стан только что кончился — возвращаем проигрывание с того кадра,
        // на котором заморозили (gotoAndPlay здесь был бы отменой: он
        // отматывает анимацию в начало).
        enemy.sprite.play()
      }

      // Снимок X ДО AI-блока ниже — используется только для определения
      // "враг фактически сдвинулся по X в этом кадре" (анимация idle/walk,
      // см. синк визуала ниже), саму AI-логику не дублирует и не меняет.
      const prevEnemyX = enemy.x

      // Гравитация + приземление (Шаг A "умного врага") — та же физика,
      // что у игрока: GRAVITY/MAX_FALL переиспользуем как есть, посадку на
      // '#'/'=' считаем через тот же sweepFootBlock, что и для игрока (та
      // же защита от туннелирования сквозь тонкую полосу за один кадр).
      // Врагу не нужна версия с проверкой головы (sweepHeadBlock) — у него
      // нет прыжка, vy никогда не становится отрицательной. Если под ним
      // нет пола (сошёл с края, преследуя игрока) — просто падает дальше,
      // разворот у края намеренно не делаем (агрессивная физика).
      enemy.vy = Math.min(enemy.vy + C.GRAVITY * dt, C.MAX_FALL)
      const prevEnemyFootY = enemy.y + C.ENEMY_HEIGHT
      enemy.y += enemy.vy * dt
      const enemyFootY = enemy.y + C.ENEMY_HEIGHT
      const enemyBlockTop = sweepFootBlock(deps.grid, C.TILE_SIZE, enemy.x, C.ENEMY_WIDTH, prevEnemyFootY, enemyFootY)
      if (enemyBlockTop !== null) {
        enemy.y = enemyBlockTop - C.ENEMY_HEIGHT
        enemy.vy = 0
      }

      // Боевая уязвимая зона игрока (см. getPlayerCombatBox) — на земле
      // обычный хитбокс, в прыжке уменьшенный бокс по корпусу.
      // Вычисляется здесь ОДИН раз и переиспользуется ниже (dx/dist,
      // verticalReach, bodiesTouchingX, push-out) — phys.x до push-out
      // блока ещё не меняется в этой итерации, так что бокс валиден для
      // всех них. Для playerInFront на strike-кадре (после push-out)
      // считается ЗАНОВО отдельно, см. там же.
      const playerCombatBox = deps.getPlayerCombatBox()
      const dx = (playerCombatBox.x + playerCombatBox.w / 2) - (enemy.x + C.ENEMY_WIDTH / 2)
      const dist = Math.abs(dx)
      // Battle.tsx сравнивает только X (там бой на одной 1D-дорожке — по
      // вертикали фигуры всегда совпадают). В Explore игрок может
      // запрыгнуть НАД врагом — если ноги игрока выше головы врага, удар
      // по вертикали физически не должен доставать, иначе "отпрыгнул"
      // (способ уклонения из требования 3а) не работал бы вообще.
      const verticalReach = playerCombatBox.y < enemy.y + C.ENEMY_HEIGHT && playerCombatBox.y + playerCombatBox.h > enemy.y
      const inMeleeReach = dist < C.ENEMY_ATTACK_RANGE && verticalReach

      // Достиг ли враг стоп-дистанции (~64% ATTACK_RANGE, см. константу
      // выше) — используется И для остановки сближения, И как порог для
      // немедленного windup ниже (пока чисто горизонтально, как и раньше
      // у преследования — вертикаль добавляется отдельно, только к
      // windup-гейту, см. verticalReach).
      const reachedStopDist = dist <= C.ATTACK_STOP_DIST
      // Альтернатива reachedStopDist: тела в контакте по X (то же
      // перекрытие, что в блоке выталкивания игрок↔враг). Нужна, т.к.
      // боковой упор не пускает центры ближе (PLAYER_WIDTH+ENEMY_WIDTH)/2
      // = 80, а ATTACK_STOP_DIST = 45 — без этой альтернативы windup
      // никогда не стартовал бы вплотную (см. диагностику: враг просто
      // пихается, замах не докручивается).
      const bodiesTouchingX =
        (playerCombatBox.x + playerCombatBox.w) >= enemy.x - C.TOUCH_EPS &&
        playerCombatBox.x <= (enemy.x + C.ENEMY_WIDTH) + C.TOUCH_EPS

      // Шаг B: агро — проверяется КАЖДЫЙ кадр заново (динамически), только
      // для решения "преследовать по X или стоять на месте". Атаку (ниже)
      // не трогаем — она и так работает лишь в пределах ATTACK_STOP_DIST/
      // ATTACK_RANGE, которые намного меньше радиуса агро, так что этот
      // гейт логически не пересекается с уже существующей проверкой удара.
      const enemyFeetY = enemy.y + C.ENEMY_HEIGHT
      const playerFeetY = deps.phys.y + C.PLAYER_HEIGHT
      const sameFloor = Math.abs(playerFeetY - enemyFeetY) <= C.SAME_FLOOR_TOLERANCE_TILES * C.TILE_SIZE
      // Условие агро ПРЯМО СЕЙЧАС — по-прежнему пересчитывается каждый кадр и
      // остаётся строгим (SAME_FLOOR_TOLERANCE_TILES не трогали: он держит
      // "другой этаж", см. константу).
      const aggroConditionNow = dist <= C.AGGRO_RANGE_TILES * C.TILE_SIZE && sameFloor
      // Память о цели (см. AGGRO_MEMORY_MS): условие выполняется — таймер
      // взводится в полное значение, перестало — тикает вниз.
      //
      // ⚠️ Декремент стоит ЗДЕСЬ, ДО гейтов hurtTimer/windingUp ниже, и это
      // не стилистика: остальные таймеры зверя (attackTimer/windupTimer)
      // тикают ВНУТРИ этих гейтов, и память, поставленная туда же, замирала
      // бы в хитстане и в замахе — то есть ровно тогда, когда игрок
      // отрывается, она бы не истекала. Единственное, что выше по коду
      // прерывает путь сюда, — мёртвый враг (continue), у него памяти о цели
      // нет по смыслу.
      if (aggroConditionNow) {
        enemy.aggroMemoryTimer = C.AGGRO_MEMORY_MS
      } else {
        enemy.aggroMemoryTimer = Math.max(0, enemy.aggroMemoryTimer - deltaMS)
      }
      // Дальше по AI слово "агрён" означает ИМЕННО память: сюда попадает и
      // кадр, где условие уже не выполняется (герой в прыжке над врагом), но
      // цель ещё не забыта. Ветка потери цели (патруль) не менялась — она
      // просто наступает на AGGRO_MEMORY_MS позже.
      const aggroed = enemy.aggroMemoryTimer > 0

      // Таймеры расследования (см. INVESTIGATE_MS/INVESTIGATE_LOOK_MS) — тут
      // же, ДО гейтов hurtTimer/windingUp, по той же причине, что и память
      // агро: в хитстане и в замахе они обязаны продолжать течь, иначе враг
      // застревал бы в расследовании ровно тогда, когда его бьют.
      // Сама ходьба к точке — ниже, в AI-ветке (её хитстан замораживает, как
      // и любое другое движение), здесь только время.
      if (aggroed) {
        // Приоритет обычного агро: цель видно (или помним) — расследовать
        // нечего, состояние сбрасывается целиком.
        enemy.investigateTimer = 0
        enemy.investigateLookTimer = 0
        enemy.investigateX = null
      } else if (enemy.investigateTimer > 0) {
        enemy.investigateTimer = Math.max(0, enemy.investigateTimer - deltaMS)
        // Время вышло — не дошёл, но дальше не идёт: пауза "осмотреться".
        // Тот же переход делает и ветка ходьбы ниже, когда враг дошёл до
        // точки/упёрся в стену/встал у края.
        if (enemy.investigateTimer === 0) enemy.investigateLookTimer = C.INVESTIGATE_LOOK_MS
      } else if (enemy.investigateLookTimer > 0) {
        enemy.investigateLookTimer = Math.max(0, enemy.investigateLookTimer - deltaMS)
        // Осмотрелся — точка больше не нужна, дальше обычный патруль.
        if (enemy.investigateLookTimer === 0) enemy.investigateX = null
      }

      // Хитстан (hurt) полностью замораживает эту AI-ветку — не двигается,
      // не начинает новый windup/атаку, пока не истечёт enemy.hurtTimer
      // (тикает в блоке визуала ниже). Гравитация/приземление выше этим
      // не затрагиваются — застывает только решение "двигаться/бить".
      if (enemy.hurtTimer <= 0) {
        if (!enemy.windingUp) {
          if (aggroed) {
            // ПОГОНЯ (Шаг B, скорость — Шаг C): быстрее патруля, падение с
            // края разрешено (см. физику выше — leadingX тут не проверяет
            // пол под ногами вообще, это делает общий gravity-блок).
            // !bodiesTouchingX — не долезать в игрока в паузах между
            // ударами (attackTimer>0, windup ещё не начался): без этого
            // враг продолжал лезть вплотную, а боковой упор постоянно
            // выталкивал игрока обратно ("толкание").
            if (!reachedStopDist && !bodiesTouchingX) {
              const dir = Math.sign(dx)
              const nextX = enemy.x + dir * C.ENEMY_CHASE_SPEED * dt
              const leadingX = dir > 0 ? nextX + C.ENEMY_WIDTH : nextX
              const hitWall =
                isSolid(deps.grid, C.TILE_SIZE, leadingX, enemy.y + 1) ||
                isSolid(deps.grid, C.TILE_SIZE, leadingX, enemy.y + C.ENEMY_HEIGHT / 2) ||
                isSolid(deps.grid, C.TILE_SIZE, leadingX, enemy.y + C.ENEMY_HEIGHT - 1)
              if (!hitWall) {
                enemy.x = clamp(nextX, 0, worldWidthPx - C.ENEMY_WIDTH)
              }
              if (dir !== 0) enemy.facing = dir as 1 | -1
            } else if (bodiesTouchingX) {
              // стоит вплотную, не лезет вперёд, но поворачивается лицом к
              // игроку, чтобы следующий замах шёл в правильную сторону
              // (в т.ч. если игрок забежал за спину) — enemy.x не трогаем.
              const dir = Math.sign(dx)
              if (dir !== 0) enemy.facing = dir as 1 | -1
            }
          } else if (enemy.investigateTimer > 0 && enemy.investigateX !== null) {
            // РАССЛЕДОВАНИЕ, фаза ходьбы (см. INVESTIGATE_MS): идём к точке,
            // откуда прилетело, СКОРОСТЬЮ ПОГОНИ (ENEMY_CHASE_SPEED) — это
            // реакция на удар, а не прогулка. Точка — X источника урона,
            // записан в damageEnemy (Explore.tsx).
            //
            // Стена и край платформы проверяются ТЕМИ ЖЕ функциями и в том же
            // виде, что в патруле ниже (isSolid ×3 + cellFootBlockTop) —
            // своей геометрии не заводим. Отличие от патруля одно: упёршись,
            // враг не разворачивается, а заканчивает расследование.
            const targetX = enemy.investigateX
            const centerX = enemy.x + C.ENEMY_WIDTH / 2
            const toTarget = targetX - centerX
            const dir = Math.sign(toTarget)
            const step = C.ENEMY_CHASE_SPEED * dt
            if (dir !== 0) enemy.facing = dir as 1 | -1
            if (dir === 0 || Math.abs(toTarget) <= step) {
              // Дошёл: шаг НЕ делаем (иначе проскочили бы точку и поехали
              // обратно) — сразу в паузу "осмотреться".
              enemy.investigateTimer = 0
              enemy.investigateLookTimer = C.INVESTIGATE_LOOK_MS
            } else {
              const nextX = enemy.x + dir * step
              const leadingX = dir > 0 ? nextX + C.ENEMY_WIDTH : nextX
              const hitWall =
                isSolid(deps.grid, C.TILE_SIZE, leadingX, enemy.y + 1) ||
                isSolid(deps.grid, C.TILE_SIZE, leadingX, enemy.y + C.ENEMY_HEIGHT / 2) ||
                isSolid(deps.grid, C.TILE_SIZE, leadingX, enemy.y + C.ENEMY_HEIGHT - 1)
              const footCx = Math.floor(leadingX / C.TILE_SIZE)
              const footCy = Math.floor((enemy.y + C.ENEMY_HEIGHT) / C.TILE_SIZE)
              const noFloorAhead = cellFootBlockTop(deps.grid, C.TILE_SIZE, footCx, footCy) === null
              if (hitWall || noFloorAhead) {
                // Дальше хода нет — точка недостижима (стреляли с другого
                // этажа/через пропасть). Не топчемся у препятствия: тот же
                // переход в паузу, что и по приходу.
                enemy.investigateTimer = 0
                enemy.investigateLookTimer = C.INVESTIGATE_LOOK_MS
              } else {
                enemy.x = clamp(nextX, 0, worldWidthPx - C.ENEMY_WIDTH)
              }
            }
          } else if (enemy.investigateLookTimer > 0 && enemy.investigateX !== null) {
            // РАССЛЕДОВАНИЕ, фаза паузы (см. INVESTIGATE_LOOK_MS): стоит на
            // месте лицом к точке. enemy.x не трогаем вообще — время тикает
            // в безусловном блоке выше, отсюда только разворот.
            const dir = Math.sign(enemy.investigateX - (enemy.x + C.ENEMY_WIDTH / 2))
            if (dir !== 0) enemy.facing = dir as 1 | -1
          } else {
            // ПАТРУЛЬ (Шаг C): медленно туда-сюда вокруг spawnX, не дальше
            // PATROL_RANGE_TILES. Разворот на границе патруля, у стены '#'
            // ИЛИ у края платформы — в отличие от погони, с края патруля
            // падать нельзя, доходит до края и разворачивается.
            const patrolLeftBound = enemy.spawnX - C.PATROL_RANGE_TILES * C.TILE_SIZE
            const patrolRightBound = enemy.spawnX + C.PATROL_RANGE_TILES * C.TILE_SIZE
            const dir = enemy.patrolDir
            const nextX = enemy.x + dir * C.ENEMY_PATROL_SPEED * dt
            const leadingX = dir > 0 ? nextX + C.ENEMY_WIDTH : nextX

            const hitWall =
              isSolid(deps.grid, C.TILE_SIZE, leadingX, enemy.y + 1) ||
              isSolid(deps.grid, C.TILE_SIZE, leadingX, enemy.y + C.ENEMY_HEIGHT / 2) ||
              isSolid(deps.grid, C.TILE_SIZE, leadingX, enemy.y + C.ENEMY_HEIGHT - 1)
            // Край платформы: под клеткой сразу впереди по ходу нет '#'/'='.
            const footCx = Math.floor(leadingX / C.TILE_SIZE)
            const footCy = Math.floor((enemy.y + C.ENEMY_HEIGHT) / C.TILE_SIZE)
            const noFloorAhead = cellFootBlockTop(deps.grid, C.TILE_SIZE, footCx, footCy) === null
            const reachedBound = dir > 0 ? nextX > patrolRightBound : nextX < patrolLeftBound

            if (reachedBound || hitWall || noFloorAhead) {
              enemy.patrolDir = dir > 0 ? -1 : 1
            } else {
              enemy.x = clamp(nextX, 0, worldWidthPx - C.ENEMY_WIDTH)
            }
            enemy.facing = enemy.patrolDir
          }

          // Кулдаун считаем ВНИЗ до 0 (не вверх до интервала) — 0 по
          // умолчанию, поэтому по достижении стоп-дистанции В ПЕРВЫЙ РАЗ
          // windup стартует НЕМЕДЛЕННО, без паузы "подумать". Кулдаун
          // появляется только ПОСЛЕ удара (см. ветку windingUp ниже).
          if (enemy.attackTimer > 0) {
            enemy.attackTimer = Math.max(0, enemy.attackTimer - deltaMS / 1000)
          }
          if ((reachedStopDist || bodiesTouchingX) && verticalReach && enemy.attackTimer <= 0) {
            enemy.windingUp = true
            enemy.windupTimer = 0
          }
        } else {
          enemy.windupTimer += deltaMS
          if (enemy.windupTimer >= C.WINDUP_MS) {
            enemy.windingUp = false
            enemy.windupTimer = 0
            enemy.attackTimer = C.ENEMY_ATTACK_INTERVAL // кулдаун — ПОСЛЕ удара
            // Момент удара БОЛЬШЕ НЕ здесь — перенесён на strike-кадр
            // attack-анимации (см. синк визуала ниже, BEAST_ATTACK_STRIKE_FRAME).
            // inMeleeReach/dodgeIframeRef проверяются там же, заново, на
            // момент strike-кадра — здесь ничего не наносим.
          }
        }
      }

      // Шаг 1 "живой враг = мягкая стена" — боковой упор игрок↔враг,
      // ТОЛЬКО по X (соскальзывание с макушки — отдельный будущий шаг, не
      // делаем здесь). Вставлено ПОСЛЕ того, как враг применил движение по
      // X выше (patrol/chase-ветка) — enemy.x на этот кадр уже финален,
      // как и phys.x игрока (см. :1558) — упор безопасно накладывать тут.
      // Мёртвые враги сюда физически не доходят — enemy.dead делает
      // continue в самом начале итерации цикла, выше по коду. Сама
      // геометрия/гейты (verticalReach, PUSH_TOP_MARGIN) вынесены в
      // pushPlayerOutX — общий помощник, им же толкается сундук ниже.
      pushPlayerOutOfEnemy(enemy, playerCombatBox)

      // Синк визуала с логической позицией — теперь и по Y тоже (раньше
      // враг не двигался по вертикали вообще, синкали только X; с
      // гравитацией enemy.y меняется каждый кадр, значит и полоска HP
      // должна пересчитывать своё место над головой, а не залипать).
      // rect.x — с поправкой на пивот по центру (см. spawnEnemy, Шаг C),
      // hpBarBg/hpBarFill пивот не меняли — остаются на левом крае.
      enemy.rect.x = enemy.x + C.ENEMY_WIDTH / 2
      enemy.rect.y = enemy.y
      enemy.rect.scale.x = enemy.facing // разворот патруля/погони — Шаг C
      // Спрайт зверя — та же позиция, что раньше была у rect (центр по X,
      // низ хитбокса по Y — см. anchor в spawnEnemy). playSpriteAnim —
      // no-op, если уже играет те же textures (сравнение внутри), так что
      // вызов каждый кадр не дёргает анимацию заново.
      //
      // Приоритет анимаций (сверху вниз, как у героя): death > hurt >
      // attack > idle/walk. death обрабатывается ВЫШЕ, отдельной веткой
      // enemy.dead с ранним continue (см. начало цикла) — сюда мёртвый
      // враг вообще не доходит, поэтому hurt никогда не запускается
      // поверх death. hurt — следующая по приоритету (перебивает/
      // блокирует attack, см. enemy.hurtTimer сброс windingUp/
      // attackAnimPlaying в applyAttackHit выше), тикает вниз здесь же;
      // пока идёт — attack/idle/walk-ветки ниже не выполняются вообще.
      //
      // attack — играется ОДИН раз с входа в windingUp (enemy.windingUp
      // true, attackAnimPlaying ещё false — единоразовый переход), конец
      // НЕ обязан совпадать с концом windingUp (см. BEAST_ATTACK_* выше —
      // анимация длиннее WINDUP_MS на follow-through). Пока
      // attackAnimPlaying — idle/walk-ветка не выполняется.
      //
      // idle/walk — по факту движения по X в этом кадре (prevEnemyX,
      // снятый ДО AI-блока выше): двигался — walk, стоял (включая паузу
      // windingUp перед ударом И паузу "осмотреться" в расследовании) — idle.
      // Скорость walk — тоже ПО ФАКТУ, из длины шага за кадр (см. ниже), а не
      // по aggroed: режимов движения три, а признак агро знает два.
      //
      // Флип — по enemy.facing (тот же источник, что и для rect.scale.x
      // выше, и для самого перемещения в AI-блоке), применяется ВСЕГДА,
      // независимо от того, какая ветка сработала выше (включая hurt) —
      // текущее facing не меняется, просто применяется повторно.
      // Арт зверя смотрит ВЛЕВО по умолчанию, поэтому facing===-1 (влево)
      // — БЕЗ зеркала, facing===1 (вправо) — зеркалим. Стоя на месте facing
      // не трогается AI-блоком (кроме патруля, где он всегда = patrolDir),
      // поэтому последнее направление само сохраняется без доп. логики.
      const beastFrames = deps.beastFrames.current
      if (beastFrames) {
        if (enemy.hurtTimer > 0) {
          enemy.hurtTimer = Math.max(0, enemy.hurtTimer - deltaMS)
          deps.playSpriteAnim(enemy.sprite, beastFrames.hurt, C.BEAST_HURT_ANIM_SPEED, false)
        } else {
          if (enemy.windingUp && !enemy.attackAnimPlaying) {
            enemy.attackAnimPlaying = true
            enemy.attackHitApplied = false
            deps.playSpriteAnim(enemy.sprite, beastFrames.attack, C.BEAST_ATTACK_ANIM_SPEED, false)
          }

          if (enemy.attackAnimPlaying) {
            // Момент удара — ровно на strike-кадре анимации (перенесено из
            // конца WINDUP_MS выше). inMeleeReach/dodgeIframeRef — ТЕ ЖЕ
            // проверки и числа, что и раньше, просто читаются здесь и
            // сейчас (свежие значения этого тика), а не в конце windup.
            if (!enemy.attackHitApplied && enemy.sprite.currentFrame >= C.BEAST_ATTACK_STRIKE_FRAME) {
              enemy.attackHitApplied = true
              enemy.stunCount = 0 // замах дошёл до удара — сброс счётчика стан-резиста
              // inMeleeReach (dist<ATTACK_RANGE) ложно вплотную (dist=80 >
              // ATTACK_RANGE=70) — та же рассинхронизация порога, что чинили
              // для старта windup через bodiesTouchingX (см. выше). verticalReach
              // обязателен отдельно — сохраняет уклонение перепрыгиванием.
              // playerInFront — игрок должен быть с той стороны, куда враг
              // СМОТРИТ (facing зафиксирован на старте windup, не доворачивается
              // в замахе — читаем как есть): обежал за спину — промах.
              // Бокс здесь — ЗАНОВО (не playerCombatBox выше по AI-блоку):
              // push-out мог сдвинуть phys.x после того, как playerCombatBox
              // был посчитан, так что переиспользовать его тут нельзя.
              const strikePlayerBox = deps.getPlayerCombatBox()
              const playerCenterX = strikePlayerBox.x + strikePlayerBox.w / 2
              const enemyCenterX = enemy.x + C.ENEMY_WIDTH / 2
              const playerOnRight = playerCenterX > enemyCenterX
              const playerInFront =
                (enemy.facing === 1 && playerOnRight) ||
                (enemy.facing === -1 && !playerOnRight)
              const canHit = (inMeleeReach || bodiesTouchingX) && verticalReach && playerInFront
              if (canHit && deps.dodgeIframe.current <= 0) {
                deps.takeDamage(enemy.attackDamage)
              }
            }
            if (enemy.sprite.currentFrame >= beastFrames.attack.length - 1 || !enemy.sprite.playing) {
              enemy.attackAnimPlaying = false // доиграла — со следующего тика idle/walk
            }
          } else {
            const enemyMoving = enemy.x !== prevEnemyX
            if (enemyMoving) {
              // Скорость анимации — по ФАКТИЧЕСКОМУ шагу за этот кадр, а не по
              // aggroed. Режимов движения стало три (погоня, ходьба
              // расследования, патруль), а признак агро различает два: в
              // расследовании враг едет скоростью погони (ENEMY_CHASE_SPEED),
              // но aggroed там ложно — ноги играли патрульный темп и не
              // поспевали за телом.
              // Шаг за кадр — это ровно скорость ветки, умноженная на dt
              // (enemy.x = x + dir * СКОРОСТЬ * dt в каждой из трёх), поэтому
              // сравнение с серединой между двумя скоростями восстанавливает,
              // какая из них была использована, без третьей константы и без
              // нового поля. Любой будущий режим движения получит верный темп
              // сам, если поедет одной из этих двух скоростей.
              const movedPx = Math.abs(enemy.x - prevEnemyX)
              const chasePace = movedPx > ((C.ENEMY_PATROL_SPEED + C.ENEMY_CHASE_SPEED) / 2) * dt
              deps.playSpriteAnim(enemy.sprite, beastFrames.walk, chasePace ? C.WALK_ANIM_CHASE : C.WALK_ANIM_PATROL, true)
            } else {
              deps.playSpriteAnim(enemy.sprite, beastFrames.idle, C.BEAST_IDLE_ANIM_SPEED, true)
            }
          }
        }
        enemy.sprite.scale.x = enemy.facing === -1 ? Math.abs(enemy.sprite.scale.x) : -Math.abs(enemy.sprite.scale.x)
      }
      // Y отрисовки — поверхность тайла под ногами (findGroundSurfaceY),
      // а НЕ низ хитбокса; низ хитбокса — только запасной вариант, когда
      // враг в воздухе (упал с края) и под ним прямо сейчас нет тверди.
      const enemyFootBottom = enemy.y + C.ENEMY_HEIGHT
      const enemySurfaceY = deps.findGroundSurfaceY(enemy.x, C.ENEMY_WIDTH, enemyFootBottom)
      enemy.sprite.x = enemy.x + C.ENEMY_WIDTH / 2
      enemy.sprite.y = (enemySurfaceY ?? enemyFootBottom) + C.FOOT_TUNE
      enemy.hpBarBg.x = enemy.x
      enemy.hpBarBg.y = enemy.y - C.ENEMY_HPBAR_OFFSET_Y - C.ENEMY_HP_BAR_MARGIN - C.ENEMY_HP_BAR_HEIGHT
      enemy.hpBarFill.x = enemy.x
      enemy.hpBarFill.y = enemy.hpBarBg.y

      // Телеграф замаха: тонкий сигнал на плоском прямоугольнике без
      // спрайта — краснеет (danger), пока windingUp истинно.
      enemy.rect.tint = enemy.windingUp ? 0xe0353b : 0xffffff
    }
  }

  function dispose(): void {
    // Сегодня enemiesRef НИГДЕ не чистится: ни на повторном запуске setup()
    // (сброс перед фазой спавна — на стороне Explore.tsx, см. задачу, п.5),
    // ни здесь, на unmount (в отличие от rewardFloatsRef/bossSpikesRef/
    // bossWavesRef, которые обнуляются в cleanup эффекта). Оставлено пустым
    // намеренно — не переносим новое поведение, только код как он есть.
  }

  return { spawn, update, dispose }
}
