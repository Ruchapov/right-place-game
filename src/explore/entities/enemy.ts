import type { MutableRefObject } from 'react'
import { AnimatedSprite, Graphics, Text } from 'pixi.js'
import type { Container, Texture } from 'pixi.js'
import type { DamageSource, Grid, PlayerPhysics, Enemy, MapEvent } from '../types'
import * as C from '../constants'
import { isSolid, sweepFootBlock, cellFootBlockTop } from '../collision'
import { clamp, parryStunFrame } from '../utils'
import { canSeePlayer } from '../vision'
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
    // Ширина — ПОЛЕ врага, а не C.ENEMY_WIDTH: полосу рисуют оба вида, и у
    // Звонаря бокс у́же (56 против 116). Функция общая, её зовёт и zvonar.ts.
    enemy.hpBarFill.rect(0, 0, enemy.width * pct, C.ENEMY_HP_BAR_HEIGHT).fill(0xe0353b)
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
  // Награду всплывает сам closeEvent — по серверному числу события и один раз
  // на всё событие, а не по врагу (см. MapEvent.trophyReward). Поэтому
  // spawnRewardFloat системе врагов больше НЕ нужен, зато closeEvent берёт
  // координаты: попап должен появиться там, где упал последний враг группы.
  closeEvent: (index: number, worldX?: number, worldY?: number) => void
  // Убит патрульный (30.10.2026, Enemy.patrolIndex) — зовётся там же, где
  // закрытие события, когда убран труп: индекс в killedPatrols и всплывашка.
  onPatrolKilled: (patrolIndex: number, worldX: number, worldY: number) => void
  // Мана с убитого (см. entities/mana.ts): бросок выпадения и шары — там, сюда
  // приходит только «вот тело, оно здесь». Зовётся на КАЖДОГО врага, в отличие
  // от closeEvent, который срабатывает на последнем в группе.
  dropMana: (worldX: number, worldY: number) => void
  /**
   * ОБЁРТКА над takeDamageRef, а не takeDamage напрямую: deps собираются
   * ОДИН раз при создании системы в setup(), а takeDamageRef синхронизируется
   * отдельным useEffect'ом на каждый рендер именно затем, чтобы тикер всегда
   * звал АКТУАЛЬНУЮ версию функции — прямая передача взяла бы снимок с
   * момента создания и сломала бы эту синхронизацию.
   *
   * ⚠️ ВОЗВРАЩАЕТ true, ЕСЛИ ГЕРОЙ ОТБИЛ УДАР (парирование). Тогда урона не
   * было, и вызывающий обязан наложить свои последствия отбива — стан и
   * сгоревший замах. Проверку делает сама takeDamage, одной точкой на все
   * источники урона, поэтому будущий враг получит парирование автоматически:
   * достаточно нанести урон этой функцией.
   *
   * ⚠️ Прежнего `dodgeIframe` в deps БОЛЬШЕ НЕТ — уклонение с окном
   * неуязвимости удалено целиком. Непарируемые источники (волна босса, шипы
   * карты) ходят через ОТДЕЛЬНУЮ takeDamageUnblockable, см. Explore.tsx.
   */
  takeDamage: (amount: number, source?: DamageSource) => boolean
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

  // Кадр оглушения от парирования: лист hurt, спрайт стоит, кадр — по остатку
  // таймера (parryStunFrame): поза (BEAST_PARRY_STUN_FRAME), а в последние
  // PARRY_STUN_RECOVER_MS — доигрывание листа до последнего кадра. Зовётся из
  // двух мест — в момент отбива и каждый кадр заслона — и на спрайте, уже
  // стоящем на нужном кадре, не делает ничего.
  // Не playSpriteAnim: тот запускает лист с нуля и сам ведёт кадры, а здесь их
  // ведёт таймер оглушения (под льдом он стоит — стоит и кадр). Скорость и loop
  // ставятся как у него: playSpriteAnim на тех же текстурах loop не трогает.
  function showParryStunFrame(enemy: Enemy, frames: BeastFrames) {
    const sprite = enemy.sprite
    if (sprite.textures !== frames.hurt) {
      sprite.textures = frames.hurt
      sprite.loop = false
      sprite.animationSpeed = C.BEAST_HURT_ANIM_SPEED
    }
    const frame = parryStunFrame(enemy.parryStunTimer, C.BEAST_PARRY_STUN_FRAME, frames.hurt.length - 1)
    if (sprite.playing || sprite.currentFrame !== frame) sprite.gotoAndStop(frame)
  }

  // Спавнит ОДНОГО врага-прямоугольник (см. Шаг 2-1/2-2) в тайловых
  // координатах (tileX,tileY), привязанного к enemy-событию eventIndex
  // (для декремента remainingEnemies при смерти). Ставит ногами на пол
  // клетки, как игрока.
  function spawn(tileX: number, tileY: number, eventIndex: number): Enemy {
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
      // Вид и габариты — поля с 04.10.2026, когда в том же списке появился
      // Звонарь (см. entities/zvonar.ts). Этот модуль спавнит ТОЛЬКО зверей, так
      // что здесь они константны; общий код читает поля, а не константы.
      kind: 'beast',
      width: C.ENEMY_WIDTH,
      height: C.ENEMY_HEIGHT,
      x: enemyWorldX,
      y: enemyWorldY,
      vy: 0,
      hp: scaledMaxHp,
      maxHp: scaledMaxHp,
      lastHitSwingId: 0,
      attackTimer: 0,
      windingUp: false,
      windupTimer: 0,
      // Длительность замаха ПОЛЕМ — её читает applyEnemyHitReaction, считая
      // прогресс для POISE_POINT. У зверя это по-прежнему C.WINDUP_MS, у
      // Звонаря своя, втрое длиннее (см. Enemy.windupMs в types.ts).
      windupMs: C.WINDUP_MS,
      // Поля Звонаря. У зверя не используются вовсе, но тип один на обоих:
      // заводить второй ради двух полей значило бы разнести по двум типам всё,
      // что общего (а общего — весь урон, скиллы, станы и парирование).
      waveCooldownMs: 0,
      zvonarAnim: null,
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
      parryStunTimer: 0,
      dead: false,
      deathHoldTimer: 0,
      attackDamage: scaledAttackDamage,
      hpBarBg,
      hpBarFill,
    }
    redrawEnemyHpBar(enemy)
    deps.enemies.current.push(enemy)
    return enemy
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

  // Куда ближе край платформы, на которой стоит зверь (для «спрыгнуть к
  // герою, стоящему прямо под ним»). Идём шагами по полклетки в обе стороны
  // до ENEMY_EDGE_SCAN_TILES; стена обрывает поиск в эту сторону. Края не
  // нашлось — prefer (сторона героя).
  function nearestEdgeDir(enemy: Enemy, prefer: 1 | -1): 1 | -1 {
    const T = C.TILE_SIZE
    const feetY = enemy.y + C.ENEMY_HEIGHT
    const footCy = Math.floor(feetY / T)
    const maxSteps = C.ENEMY_EDGE_SCAN_TILES * 2
    let bestDir: 1 | -1 = prefer
    let bestK = Infinity
    for (const d of [prefer, prefer > 0 ? -1 : 1] as const) {
      for (let k = 1; k <= maxSteps; k++) {
        const lead = d > 0 ? enemy.x + C.ENEMY_WIDTH + (k * T) / 2 : enemy.x - (k * T) / 2
        if (lead < 0 || lead >= worldWidthPx) break
        if (isSolid(deps.grid, T, lead, enemy.y + C.ENEMY_HEIGHT / 2)) break
        if (cellFootBlockTop(deps.grid, T, Math.floor(lead / T), footCy) === null) {
          if (k < bestK) {
            bestK = k
            bestDir = d
          }
          break
        }
      }
    }
    return bestDir
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
      // ⚠️ Список один на все виды врагов (04.10.2026) — чужих пропускаем молча.
      // Звонарём занимается entities/zvonar.ts: у него другое поведение целиком
      // (держит дистанцию, стреляет), и ветвить здесь значило бы сращивать два
      // несовместимых набора состояний в одной функции. Общее — тип Enemy и
      // список, поэтому урон, скиллы, станы и парирование у обоих одни и те же.
      if (enemy.kind !== 'beast') continue

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
        if (enemy.mark) enemy.mark.visible = false
        const beastFrames = deps.beastFrames.current
        const deathDone =
          beastFrames && (enemy.sprite.currentFrame >= beastFrames.death.length - 1 || !enemy.sprite.playing)
        if (deathDone) {
          enemy.deathHoldTimer += deltaMS
          if (enemy.deathHoldTimer >= C.DEATH_HOLD_MS) {
            // Награда НЕ здесь: она всплывает один раз на всё событие, когда
            // падает ПОСЛЕДНИЙ враг группы, — этим занимается closeEvent ниже,
            // и координаты ему даёт этот же труп. Прежняя всплывашка на каждом
            // враге показывала клиентскую долю клиентского же броска и с
            // начисленным сервером не сходилась.
            const deathX = enemy.sprite.x
            const deathY = enemy.sprite.y - enemy.sprite.height
            // Мана — с КАЖДОГО убитого, а не с последнего в группе (этим она и
            // отличается от награды события ниже). Вылетает из центра тела.
            deps.dropMana(enemy.x + enemy.width / 2, enemy.y + enemy.height / 2)
            deps.worldContainer.removeChild(enemy.rect, enemy.sprite, enemy.hpBarBg, enemy.hpBarFill)
            enemy.rect.destroy()
            enemy.sprite.destroy()
            enemy.hpBarBg.destroy()
            enemy.hpBarFill.destroy()
            if (enemy.mark) {
              deps.worldContainer.removeChild(enemy.mark)
              enemy.mark.destroy()
              enemy.mark = undefined
            }
            deps.enemies.current.splice(i, 1)
            i--
            const ownerEvent = deps.events.current[enemy.eventIndex]
            if (ownerEvent) {
              ownerEvent.remainingEnemies = Math.max(0, (ownerEvent.remainingEnemies ?? 1) - 1)
              if (ownerEvent.remainingEnemies <= 0) deps.closeEvent(enemy.eventIndex, deathX, deathY)
            }
            if (enemy.patrolIndex !== undefined) deps.onPatrolKilled(enemy.patrolIndex, deathX, deathY)
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
      // --- Стан от ПАРИРОВАНИЯ ---
      //
      // Отдельный заслон НИЖЕ заслона iceball и выше всего остального, потому
      // что это ДРУГАЯ механика (см. parryStunTimer в types.ts): iceball ставит
      // паузу и доигрывает замах, парирование замах сжигает.
      //
      // Таймер тикает БЕЗУСЛОВНО, до гейтов, как stunTimer выше — иначе стан не
      // истекал бы в хитстане.
      //
      // Вид: кадр позы листа hurt, а в конце оглушения — доигрывание листа до
      // последнего кадра (см. showParryStunFrame). На позу он встаёт ещё в
      // момент отбива, ниже по файлу. Значок стана над головой — не здесь, а в
      // entities/stunStars.ts: он читает этот же таймер.
      enemy.parryStunTimer = Math.max(0, enemy.parryStunTimer - deltaMS)
      if (enemy.parryStunTimer > 0) {
        const parryFrames = deps.beastFrames.current
        if (parryFrames) showParryStunFrame(enemy, parryFrames)
        // Тело остаётся ФИЗИЧЕСКИМ — та же причина и тот же вызов, что под
        // станом iceball выше.
        pushPlayerOutOfEnemy(enemy, deps.getPlayerCombatBox())
        continue
      }
      // Стан кончился на ПОСЛЕДНЕМ кадре листа hurt, спрайт стоит — как после
      // обычного, доигравшего хитстана. Возобновлять нечего: каскад анимаций
      // ниже либо ставит другой лист с нуля, либо (удар, полученный в оглушении,
      // взвёл hurtTimer) держит этот же последний кадр, пока хитстан не истечёт.
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
      // разворот у края в погоне решает AI ниже (к герою вниз — спрыгивает,
      // в яму на той же высоте — не шагает).
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
      // --- ЗРЕНИЕ (05.11.2026, см. explore/vision.ts) ---
      // Прежнее агро «в радиусе и на том же этаже» видело сквозь платформы и
      // затылком. Теперь зверь замечает героя, только если ВИДИТ: перед собой,
      // при чистом луче (стены и платформы его режут); спиной — только вплотную.
      //
      // Цепочка состояний:
      //   патруль → видит → «!» (ENEMY_NOTICE_MS, стоит лицом к герою) →
      //   погоня (пока видит; потерял — ещё ENEMY_CHASE_GRACE_MS по памяти) →
      //   поиск: идёт туда, где видел в последний раз (lastSeen), «?» →
      //   оглядывается в обе стороны → патруль.
      // Увидел снова на любом этапе поиска — сразу в погоню, без «!».
      //
      // aggroMemoryTimer по-прежнему значит «в погоне» — его читает остальной
      // код (сброс расследования, ветка погони ниже).
      const sees = canSeePlayer({
        grid: deps.grid,
        ex: enemy.x,
        ey: enemy.y,
        ew: C.ENEMY_WIDTH,
        eh: C.ENEMY_HEIGHT,
        facing: enemy.facing,
        px: playerCombatBox.x,
        py: deps.phys.y,
        pw: playerCombatBox.w,
        ph: C.PLAYER_HEIGHT,
        chasing: enemy.aggroMemoryTimer > 0,
      })
      const wasChasing = enemy.aggroMemoryTimer > 0
      const searching = enemy.investigateTimer > 0 || enemy.investigateLookTimer > 0
      if (sees) {
        enemy.lastSeenX = playerCombatBox.x + playerCombatBox.w / 2
        enemy.lastSeenFeetY = playerFeetY
      }
      enemy.noticeMs = Math.max(0, (enemy.noticeMs ?? 0) - deltaMS)
      let startedChase = false
      if (sees && !wasChasing) {
        if (searching || enemy.hurtTimer > 0) {
          // Уже настороже (ищет или его только что ударили) — без паузы.
          enemy.aggroMemoryTimer = C.ENEMY_CHASE_GRACE_MS
          startedChase = true
        } else if ((enemy.noticeMs ?? 0) === 0 && !enemy.noticePending) {
          enemy.noticeMs = C.ENEMY_NOTICE_MS
          enemy.noticePending = true
        }
      }
      if (enemy.noticePending && (enemy.noticeMs ?? 0) === 0) {
        // Реакция кончилась — в погоню, даже если герой за это время
        // спрятался: он же его УЖЕ заметил (тогда погоня быстро сменится
        // поиском по lastSeen).
        enemy.noticePending = false
        enemy.aggroMemoryTimer = C.ENEMY_CHASE_GRACE_MS
        startedChase = true
      }
      if (wasChasing) {
        if (sees) {
          enemy.aggroMemoryTimer = C.ENEMY_CHASE_GRACE_MS
        } else {
          enemy.aggroMemoryTimer = Math.max(0, enemy.aggroMemoryTimer - deltaMS)
          if (enemy.aggroMemoryTimer === 0 && enemy.lastSeenX !== undefined) {
            // Потерял — ПОИСК там, где видел в последний раз.
            enemy.investigateX = enemy.lastSeenX
            enemy.investigateFeetY = enemy.lastSeenFeetY ?? null
            enemy.investigateTimer = C.ENEMY_SEARCH_MS
            enemy.investigateLookTimer = 0
          }
        }
      }
      if (startedChase) {
        enemy.markMs = C.ENEMY_NOTICE_MS
        // СТАЯ (PACK_ALERT_RANGE_TILES): зовёт соседей по группе туда, где
        // герой. Прибежав, они смотрят своими глазами.
        if (enemy.eventIndex >= 0) {
          const myCx = enemy.x + C.ENEMY_WIDTH / 2
          for (const mate of deps.enemies.current) {
            if (mate === enemy || mate.kind !== 'beast' || mate.dead) continue
            if (mate.eventIndex !== enemy.eventIndex || mate.aggroMemoryTimer > 0) continue
            if (Math.abs(mate.x + mate.width / 2 - myCx) > C.PACK_ALERT_RANGE_TILES * C.TILE_SIZE) continue
            mate.investigateX = playerCombatBox.x + playerCombatBox.w / 2
            mate.investigateFeetY = playerFeetY
            mate.investigateTimer = C.ENEMY_SEARCH_MS
            mate.investigateLookTimer = 0
          }
        }
      }
      enemy.markMs = Math.max(0, (enemy.markMs ?? 0) - deltaMS)
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
        if (enemy.investigateLookTimer === 0) {
          enemy.investigateX = null
          enemy.investigateFeetY = null
        }
      }

      // Хитстан (hurt) полностью замораживает эту AI-ветку — не двигается,
      // не начинает новый windup/атаку, пока не истечёт enemy.hurtTimer
      // (тикает в блоке визуала ниже). Гравитация/приземление выше этим
      // не затрагиваются — застывает только решение "двигаться/бить".
      if (enemy.hurtTimer <= 0) {
        if (!enemy.windingUp) {
          if (enemy.noticePending) {
            // «!» — заметил: стоит и смотрит на героя, пока идёт реакция.
            const d = Math.sign(dx)
            if (d !== 0) enemy.facing = d as 1 | -1
          } else if (aggroed) {
            // ПОГОНЯ (Шаг B, скорость — Шаг C): быстрее патруля.
            // !bodiesTouchingX — не долезать в игрока в паузах между
            // ударами (attackTimer>0, windup ещё не начался): без этого
            // враг продолжал лезть вплотную, а боковой упор постоянно
            // выталкивал игрока обратно ("толкание").
            //
            // 04.11.2026 — погоня по высоте (прыжков у врагов НЕТ и не будет):
            // • герой НИЖЕ — зверь не встаёт на краю «я дошёл», а идёт к краю
            //   своей платформы и спрыгивает к нему (ENEMY_DROP_*);
            // • герой ВЫШЕ и достать нельзя — зверь отходит из-под него на
            //   ENEMY_GUARD_DIST_PX, чтобы его не били сверху бесплатно, и ждёт;
            // • герой на той же высоте — в яму зверь не шагает (край = стоп).
            const towardDir: 1 | -1 = dx > 0 ? 1 : dx < 0 ? -1 : enemy.facing
            const below = playerFeetY - enemyFeetY // >0 — герой ниже
            const playerBelow = deps.phys.onGround && below >= C.ENEMY_DROP_MIN_PX && !verticalReach
            const playerAbove = deps.phys.onGround && -below >= C.ENEMY_DROP_MIN_PX && !verticalReach

            // Один шаг по X в сторону d. allowDrop — можно ли сойти с края.
            // Возвращает false, если шаг не сделан (стена или край).
            const stepX = (d: 1 | -1, allowDrop: boolean): boolean => {
              const nextX = enemy.x + d * C.ENEMY_CHASE_SPEED * dt
              const leadingX = d > 0 ? nextX + C.ENEMY_WIDTH : nextX
              const hitWall =
                isSolid(deps.grid, C.TILE_SIZE, leadingX, enemy.y + 1) ||
                isSolid(deps.grid, C.TILE_SIZE, leadingX, enemy.y + C.ENEMY_HEIGHT / 2) ||
                isSolid(deps.grid, C.TILE_SIZE, leadingX, enemy.y + C.ENEMY_HEIGHT - 1) ||
                // В полёте — ещё и точка чуть ниже ног (куда они попадут за этот
                // кадр): иначе, сходя с края и тут же разворачиваясь к герою,
                // зверь задевал угол платформы и «садился» в её бок.
                (enemy.vy !== 0 &&
                  isSolid(deps.grid, C.TILE_SIZE, leadingX, enemy.y + C.ENEMY_HEIGHT + Math.max(0, enemy.vy) * dt + 1))
              if (hitWall) return false
              if (!allowDrop && enemy.vy === 0) {
                const footCx = Math.floor(leadingX / C.TILE_SIZE)
                const footCy = Math.floor(enemyFeetY / C.TILE_SIZE)
                if (cellFootBlockTop(deps.grid, C.TILE_SIZE, footCx, footCy) === null) return false
              }
              enemy.x = clamp(nextX, 0, worldWidthPx - C.ENEMY_WIDTH)
              return true
            }

            if (enemy.vy !== 0) {
              // В падении (спрыгнул к герою) — продолжает идти к нему.
              enemy.dropDir = null
              stepX(towardDir, true)
              enemy.facing = towardDir
            } else if (playerBelow) {
              // СПРЫГНУТЬ К ГЕРОЮ. Если герой не прямо под ним — просто идёт к
              // нему, край не останавливает. Если прямо под ним (идти «к нему»
              // некуда) — выбирает ближайший край своей платформы и идёт туда.
              // Выбранный край держится до самого прыжка вниз (сброс — в полёте
              // или когда герой уже не ниже): иначе на границе «прямо под ним»
              // зверь дёргался бы туда-обратно между краем и героем.
              const underneath = Math.abs(dx) < C.ENEMY_WIDTH / 2 + C.TILE_SIZE / 2
              if (underneath && enemy.dropDir == null) enemy.dropDir = nearestEdgeDir(enemy, towardDir)
              const d = enemy.dropDir ?? towardDir
              if (!stepX(d, true)) enemy.dropDir = d > 0 ? -1 : 1 // стена — к другому краю
              enemy.facing = d
            } else if (playerAbove) {
              // ГЕРОЙ ВЫШЕ — отойти из-под удара и ждать лицом к нему.
              enemy.dropDir = null
              if (dist < C.ENEMY_GUARD_DIST_PX) {
                const away: 1 | -1 = towardDir > 0 ? -1 : 1
                stepX(away, false)
              }
              enemy.facing = towardDir
            } else {
              enemy.dropDir = null
              if (!reachedStopDist && !bodiesTouchingX) {
                // Обычная погоня; в яму на той же высоте не шагает.
                stepX(towardDir, false)
                if (dx !== 0) enemy.facing = towardDir
              } else if (bodiesTouchingX) {
                // стоит вплотную, не лезет вперёд, но поворачивается лицом к
                // игроку, чтобы следующий замах шёл в правильную сторону
                // (в т.ч. если игрок забежал за спину) — enemy.x не трогаем.
                if (dx !== 0) enemy.facing = towardDir
              }
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
              // Поиск героя (05.11.2026): точка НИЖЕ — с края спрыгивает, а в
              // полёте просто продолжает идти к ней.
              const targetBelow =
                enemy.investigateFeetY != null &&
                enemy.investigateFeetY - (enemy.y + C.ENEMY_HEIGHT) >= C.ENEMY_DROP_MIN_PX
              const canDrop = targetBelow || enemy.vy !== 0
              if (hitWall || (noFloorAhead && !canDrop)) {
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
            // 05.11.2026: не стоит столбом лицом к точке, а ОГЛЯДЫВАЕТСЯ —
            // разворачивается каждые ENEMY_LOOK_TURN_MS. Зрение направленное,
            // так что героя за спиной он может так и заметить.
            enemy.lookTurnMs = (enemy.lookTurnMs ?? C.ENEMY_LOOK_TURN_MS) - deltaMS
            if (enemy.lookTurnMs <= 0) {
              enemy.lookTurnMs = C.ENEMY_LOOK_TURN_MS
              enemy.facing = enemy.facing === 1 ? -1 : 1
            }
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
              // Погоня увела зверя со своего участка (спрыгнул вниз — обратно
              // ему не подняться), и путь к дому закрыт стеной или краем:
              // дом переезжает сюда. Иначе он дёргался бы на месте между
              // границей патруля и препятствием.
              const headingHome = (dir < 0 && enemy.x > patrolRightBound) || (dir > 0 && enemy.x < patrolLeftBound)
              if (headingHome && (hitWall || noFloorAhead)) enemy.spawnX = enemy.x
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
            // Дальность и парирование проверяются там же, заново, на момент
            // strike-кадра — здесь ничего не наносим.
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
            // конца WINDUP_MS выше). inMeleeReach — ТА ЖЕ проверка и те же
            // числа, что и раньше, просто читаются здесь и сейчас (свежие
            // значения этого тика), а не в конце windup. Здесь же решается
            // парирование — см. takeDamageParryable ниже.
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
              if (canHit) {
                // Урон идёт через общую точку, и она же решает, отбил ли герой.
                // Отбил — урона нет, а замах СГОРАЕТ: attackAnimPlaying снимаем
                // здесь же, поэтому остаток анимации не доигрывается (в отличие
                // от стана iceball, который только ставит её на паузу).
                // Кулдаун атаки СПЕЦИАЛЬНО не трогаем: он уже взведён в конце
                // windup (enemy.attackTimer = ENEMY_ATTACK_INTERVAL, см. выше),
                // то есть «как после обычного удара» выполнено само.
                if (deps.takeDamage(enemy.attackDamage, enemy)) {
                  enemy.parryStunTimer = C.PARRY_STUN_MS
                  enemy.attackAnimPlaying = false
                  enemy.windingUp = false
                  enemy.windupTimer = 0
                  // Поза оглушения — с ЭТОГО же кадра, а не со следующего, когда
                  // её подхватит заслон: кадр удара после отбива не показывается.
                  showParryStunFrame(enemy, beastFrames)
                }
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

      // Значок над головой: «!» — заметил (реакция и начало погони), «?» —
      // ищет. Создаётся при первом показе, убирается вместе с врагом.
      const markText = enemy.noticePending || (enemy.markMs ?? 0) > 0 ? '!' : !aggroed && enemy.investigateX !== null ? '?' : ''
      if (markText && !enemy.mark) {
        enemy.mark = new Text({
          text: markText,
          style: { fontSize: 30, fontWeight: 'bold', fill: 0xffd23f, stroke: { color: 0x000000, width: 5 } },
        })
        enemy.mark.anchor.set(0.5, 1)
        deps.worldContainer.addChild(enemy.mark)
      }
      if (enemy.mark) {
        enemy.mark.visible = markText !== ''
        if (markText && enemy.mark.text !== markText) enemy.mark.text = markText
        enemy.mark.x = enemy.x + C.ENEMY_WIDTH / 2
        enemy.mark.y = enemy.hpBarBg.y - C.ENEMY_MARK_OFFSET_Y + 14
      }

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
