import type { MutableRefObject } from 'react'
import { AnimatedSprite, Graphics, Sprite } from 'pixi.js'
import type { Container, Texture } from 'pixi.js'
import type { Grid, PlayerPhysics, Boss, BossSpike, BossWave, BossAnimKind, RewardKind } from '../types'
import * as C from '../constants'
import { isSolid, sweepFootBlock, cellFootBlockTop, isPlatformBandBlocking } from '../collision'
import { clamp } from '../utils'
import { rollTrophies } from '../rewards'

// HP-бар босса — тот же приём, что у зверя (redrawEnemyHpBar, см.
// explore/entities/enemy.ts). Экспортируется отдельно (не только через
// createBossSystem) — вызывается и из applyAttackHit() в Explore.tsx (на
// попадании/смерти), которая с этим переносом не трогалась.
export function redrawBossHpBar(boss: Boss) {
  const pct = Math.max(0, Math.min(1, boss.hp / boss.maxHp))
  boss.hpBarFill.clear()
  if (pct > 0) {
    boss.hpBarFill.rect(0, 0, C.BOSS_HP_BAR_WIDTH * pct, C.ENEMY_HP_BAR_HEIGHT).fill(0xe0353b)
  }
}

// Зависимости — тот же приём, что explore/entities/enemy.ts. boss/bossSpikes/
// bossWaves — ОБЩИЕ рефы с Explore.tsx (владение НЕ переезжает): applyAttackHit()
// в Explore.tsx мутирует boss.hp/hurtTimer/dead/stage через тот же bossRef, эта
// система его не подменяет, просто ещё один держатель того же рефа. Очистка
// bossSpikes/bossWaves на unmount остаётся в cleanup эффекта Explore.tsx (там
// же, где и раньше) — не дублируем её в dispose() ниже.
//
// playBossAnim/applyBossLayout — closure-функции setup() в Explore.tsx, НЕ
// переезжают: applyAttackHit() держит прямые вызовы к ним по имени
// (playBossAnim('death'), applyBossLayout(boss)), и единственный способ
// перенести их "по-честному" — сменить сигнатуру (playBossAnim сама читает
// bossRef.current, ей неоткуда взять bossFramesByKind без closure), что
// означало бы править applyAttackHit. Передаются депами — та же функция,
// тот же побочный эффект, applyAttackHit не тронута ни на строку.
export type BossDeps = {
  phys: PlayerPhysics
  getPlayerCombatBox: () => { x: number; y: number; w: number; h: number }
  pushPlayerOutX: (
    body: { x: number; y: number; width: number; height: number },
    playerBox: { x: number; y: number; w: number; h: number },
  ) => void
  playBossAnim: (kind: BossAnimKind) => void
  applyBossLayout: (boss: Boss) => void
  spawnRewardFloat: (
    worldX: number,
    worldY: number,
    rewards: { kind: RewardKind; amount: number; negative?: boolean }[],
  ) => void
  closeEvent: (index: number) => void
  // ОБЁРТКА над takeDamageRef, а не takeDamage напрямую — см. EnemyDeps в
  // enemy.ts, та же причина (deps собираются один раз при создании системы,
  // takeDamageRef синхронизируется отдельным useEffect'ом на каждый рендер).
  takeDamage: (amount: number) => void
  dodgeIframe: MutableRefObject<number>
  boss: MutableRefObject<Boss | null>
  bossSpikes: MutableRefObject<BossSpike[]>
  bossWaves: MutableRefObject<BossWave[]>
  bossEventIndex: MutableRefObject<number | null>
  worldContainer: Container
  grid: Grid
  bossFrames: Record<BossAnimKind, Texture[]>
  bossSpikeTexture: Texture | null
  bossSpikeImpactFrames: Texture[]
  bossWaveLeftFrames: Texture[]
  bossWaveRightFrames: Texture[]
}

// Создаётся ОДИН раз в setup(), ПОЗЖЕ, чем createSkillsSystem/
// createEnemySystem — bossFrames и остальные кадровые deps здесь ПЛОСКИЕ
// значения (не рефы, в отличие от beastFrames у enemy.ts), потому что
// bossFramesByKind в Explore.tsx — обычная const, известная только ПОСЛЕ
// того, как loadExploreAssets() резолвится, а не сразу после
// getPlayerCombatBox, как у skills/enemySystem.
export function createBossSystem(deps: BossDeps) {
  const worldWidthPx = deps.grid[0].length * C.TILE_SIZE

  // Шип дальней атаки (ФАЗА 3, шаг 2, см. задачу) — создаётся на кадре
  // выпуска ranged-анимации (см. ticker). Если текстура не загрузилась
  // (bossSpikeTexture===null, см. try/catch выше) — просто не создаёт
  // спрайт, снаряда/урона не будет, остальная игра не ломается.
  function spawnBossSpike(boss: Boss) {
    if (!deps.bossSpikeTexture) return
    const dir = boss.facing
    const sprite = new Sprite(deps.bossSpikeTexture)
    sprite.width = C.BOSS_SPIKE_DRAW_W
    sprite.height = C.BOSS_SPIKE_DRAW_H
    sprite.anchor.set(0.5, 0.5)
    // Точка вылета — кисть, посчитана от трансформа СПРАЙТА (не боссовского
    // физического хитбокса boss.x/boss.y/BOSS_HEIGHT — рука нарисована в
    // клетке спрайта, системы координат разные). Едет за рукой сама, если
    // якорь листа/scale изменится при нормализации.
    const s = boss.sprite
    const spawnX = s.x + (C.BOSS_SPIKE_HAND_X - s.anchor.x) * C.BOSS_RANGED_CELL_W * s.scale.x
    const spawnY = s.y + (C.BOSS_SPIKE_HAND_Y - s.anchor.y) * C.BOSS_RANGED_CELL_H * s.scale.y
    sprite.x = spawnX
    sprite.y = spawnY

    // Прицеливание (ФАЗА 3, шаг 3, см. задачу) — начальная vy подбирается
    // так, чтобы баллистическая дуга (BOSS_SPIKE_GRAVITY) прошла через
    // центр героя НА МОМЕНТ спавна; дальше герой может уйти — это осознанно,
    // не самонаводка.
    const pb = deps.getPlayerCombatBox()
    const targetX = pb.x + pb.w / 2
    const targetY = pb.y + pb.h / 2
    const dx = targetX - spawnX
    const dy = targetY - spawnY
    const t = Math.abs(dx) / C.BOSS_SPIKE_SPEED_X
    const vy = t > 0.01 ? (dy - 0.5 * C.BOSS_SPIKE_GRAVITY * t * t) / t : 0

    deps.worldContainer.addChild(sprite)
    deps.bossSpikes.current.push({ sprite, dir, vy, lifeMs: 0, hitApplied: false })
  }

  // Импакт шипа (ФАЗА 3, шаг 2, см. задачу) — разовая анимация на месте
  // попадания, сама себя удаляет по onComplete. Если лист не загрузился
  // (bossSpikeImpactFrames.length===0, см. try/catch выше) — просто не
  // создаёт спрайт, урон уже применён отдельно (см. ticker).
  function spawnBossSpikeImpact(worldX: number, worldY: number) {
    if (deps.bossSpikeImpactFrames.length === 0) return
    const impact = new AnimatedSprite(deps.bossSpikeImpactFrames)
    impact.anchor.set(0.5, 0.5)
    impact.loop = false
    impact.animationSpeed = C.BOSS_SPIKE_IMPACT_ANIM_SPEED
    impact.height = C.BOSS_SPIKE_IMPACT_DRAW_H
    impact.width = C.BOSS_SPIKE_IMPACT_DRAW_H * (C.BOSS_SPIKE_IMPACT_CELL_W / C.BOSS_SPIKE_IMPACT_CELL_H)
    impact.x = worldX
    impact.y = worldY
    impact.onComplete = () => {
      deps.worldContainer.removeChild(impact)
      impact.destroy()
    }
    deps.worldContainer.addChild(impact)
    impact.play()
  }

  // AoE-волна топота (см. задачу, п.4) — создаётся ДВАЖДЫ на strike-кадре
  // (dir=-1 и dir=+1, см. ticker), катится по земле. Если лист не
  // загрузился (bossWaveLeftFrames/bossWaveRightFrames пустые, см.
  // try/catch выше) — просто не создаёт спрайт, волны/урона не будет,
  // остальная игра работает.
  function spawnBossWave(boss: Boss, dir: 1 | -1) {
    // Каждая половина листа уже смотрит в свою сторону (см. загрузку
    // выше) — левая половина = волна влево, правая = волна вправо. Без
    // зеркалирования (scale.x остаётся положительным у обеих).
    const frames = dir === -1 ? deps.bossWaveLeftFrames : deps.bossWaveRightFrames
    if (frames.length === 0) return
    const sprite = new AnimatedSprite(frames)
    // Якорь — на ВНУТРЕННЕЙ стороне куска, у точки удара: левая волна
    // растёт влево от центра босса, её якорь на ПРАВОМ (внутреннем) крае
    // куска (1.0); правая растёт вправо, якорь на ЛЕВОМ (внутреннем)
    // крае (0.0). anchor.y=BOSS_WAVE_ANCHOR_Y, не 1.0 — низ дуги
    // нарисован на y=137 из 153, не у самого края кадра.
    sprite.anchor.set(dir === -1 ? 1.0 : 0.0, C.BOSS_WAVE_ANCHOR_Y)
    sprite.loop = true
    sprite.animationSpeed = C.BOSS_WAVE_ANIM_SPEED
    sprite.height = C.BOSS_WAVE_DRAW_H
    // Ширина — от высоты по пропорции СВОЕГО куска (куски разной ширины
    // — левый уже, правый шире, лишнее место в клетке прозрачное).
    sprite.width =
      dir === -1
        ? C.BOSS_WAVE_DRAW_H * (C.BOSS_WAVE_SPLIT_X / C.BOSS_WAVE_CELL_H)
        : C.BOSS_WAVE_DRAW_H * ((C.BOSS_WAVE_CELL_W - C.BOSS_WAVE_SPLIT_X) / C.BOSS_WAVE_CELL_H)
    // X — центр босса, Y — уровень пола под боссом (низ ФИЗИЧЕСКОГО
    // бокса, boss.y+BOSS_HEIGHT — нам нужна земля, не точка на спрайте).
    sprite.x = boss.x + C.BOSS_WIDTH / 2
    sprite.y = boss.y + C.BOSS_HEIGHT
    sprite.play()
    deps.worldContainer.addChild(sprite)
    deps.bossWaves.current.push({ sprite, dir, lifeMs: 0, hitApplied: false })
  }

  function spawn(tileX: number, tileY: number): void {
    const centerX = tileX * C.TILE_SIZE + C.TILE_SIZE / 2
    const bossWorldX = centerX - C.BOSS_WIDTH / 2
    // Тем же путём, что у врага (enemySystem.spawn) — БЕЗ предварительного
    // поиска пола: гравитация/sweepFootBlock в update() сами доведут босса
    // до ближайшей тверди за первые кадры (см. задачу, п.3).
    const bossWorldY = (tileY + 1) * C.TILE_SIZE - C.BOSS_HEIGHT

    const sprite = new AnimatedSprite(deps.bossFrames.idle)
    // Начальная поза — idle, те же таблицы (BOSS_ANCHOR_X/BOSS_ANCHOR_Y/
    // BOSS_ANIM_LOOP/BOSS_ANIM_SPEED), что и playBossAnim (deps) — deps.boss.current
    // ещё не присвоен на этом шаге (boss создаётся ниже), playBossAnim('idle')
    // здесь был бы no-op, поэтому та же логика продублирована вручную.
    sprite.anchor.set(C.BOSS_ANCHOR_X.idle, C.BOSS_ANCHOR_Y.idle)
    sprite.loop = C.BOSS_ANIM_LOOP.idle
    sprite.animationSpeed = C.BOSS_ANIM_SPEED.idle
    sprite.play()
    deps.worldContainer.addChild(sprite)

    // HP-бар — по образцу enemySystem.spawn, но центрирован над хитбоксом (бар
    // заметно ШИРЕ хитбокса — BOSS_HP_BAR_WIDTH против узкого BOSS_WIDTH).
    const hpBarBg = new Graphics().rect(0, 0, C.BOSS_HP_BAR_WIDTH, C.ENEMY_HP_BAR_HEIGHT).fill(0x221e2b)
    hpBarBg.x = bossWorldX + (C.BOSS_WIDTH - C.BOSS_HP_BAR_WIDTH) / 2
    hpBarBg.y = bossWorldY - C.BOSS_HPBAR_OFFSET_Y - C.ENEMY_HP_BAR_MARGIN - C.ENEMY_HP_BAR_HEIGHT
    deps.worldContainer.addChild(hpBarBg)

    const hpBarFill = new Graphics()
    hpBarFill.x = hpBarBg.x
    hpBarFill.y = hpBarBg.y
    deps.worldContainer.addChild(hpBarFill)

    const boss: Boss = {
      x: bossWorldX,
      y: bossWorldY,
      vy: 0,
      facing: -1,
      moving: false,
      hp: C.BOSS_MAX_HP,
      maxHp: C.BOSS_MAX_HP,
      lastHitSwingId: 0,
      hurtTimer: 0,
      stunCount: 0,
      poiseImmuneTimer: 0,
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
      hpBarBg,
      hpBarFill,
      sprite,
    }
    deps.applyBossLayout(boss)
    redrawBossHpBar(boss)
    deps.boss.current = boss
  }

  // dt — кадро-масштабированный (ticker.deltaTime, как у phys игрока) — для
  // движения; deltaMS — реальные миллисекунды (ticker.deltaMS) — для ВСЕХ
  // таймеров. Тот же контракт, что у enemy.ts.
  function updateAI(dt: number, deltaMS: number): void {
    // Босс карты C (ФАЗА 2, шаги 4-5, см. задачу) — передвижение к
    // герою + ближний бой (2 атаки, см. visual-sync ниже): агро
    // (BOSS_AGGRO_RANGE_TILES, sameFloor — та же проверка, что у зверя)
    // + ходьба со стоп-дистанцией/гистерезисом + разворот facing.
    // Патруля НЕТ — вне агро босс просто стоит. Твёрдость для героя
    // ТОЛЬКО по горизонтали (pushPlayerOutX, как у врага/сундука/
    // обелиска — герой не проходит сквозь, но может перепрыгнуть сверху,
    // вставать на босса нельзя).
    if (deps.boss.current) {
      const boss = deps.boss.current

      // Мёртвый босс (ФАЗА 2, шаг 6, см. задачу) ПОЛНОСТЬЮ инертен: сюда
      // вообще не заходит физика/AI/push-out/пересчёт позиции — труп
      // остаётся ровно там, где умер (поза/facing зафиксированы в
      // applyAttackHit в момент смерти через applyBossLayout+флип, сама
      // "анимация падения" — в кадрах Boss_Death, playBossAnim('death')
      // запущен там же один раз и больше не трогается). Хитбокс для
      // push-out тоже пропадает вместе с этим блоком — герой проходит
      // сквозь труп, тело не перегораживает арену. В отличие от зверя
      // (despawn через DEATH_HOLD_MS) — труп ОСТАЁТСЯ до конца забега.
      if (!boss.dead) {
        boss.vy = Math.min(boss.vy + C.GRAVITY * dt, C.MAX_FALL)
        const prevBossFootY = boss.y + C.BOSS_HEIGHT
        boss.y += boss.vy * dt
        const bossFootY = boss.y + C.BOSS_HEIGHT
        const bossBlockTop = sweepFootBlock(deps.grid, C.TILE_SIZE, boss.x, C.BOSS_WIDTH, prevBossFootY, bossFootY)
        if (bossBlockTop !== null) {
          boss.y = bossBlockTop - C.BOSS_HEIGHT
          boss.vy = 0
        }

        // Хитстан (hurt) полностью замораживает AI-ветку — та же логика,
        // что у enemy.hurtTimer<=0 гейт выше (не двигается, не
        // разворачивается, пока не истечёт boss.hurtTimer).
        // !attackAnimPlaying/!rangedAnimPlaying — во время атаки ИЛИ
        // броска босс не двигается и не пересчитывает агро/движение
        // (см. задачу, п.4: "во время анимации броска босс неподвижен");
        // сами они обрабатываются ниже, отдельной веткой visual-sync.
        if (boss.hurtTimer <= 0 && !boss.attackAnimPlaying && !boss.rangedAnimPlaying && !boss.stompAnimPlaying) {
          const playerCombatBox = deps.getPlayerCombatBox()
          const bossCenterX = boss.x + C.BOSS_WIDTH / 2
          const dx = (playerCombatBox.x + playerCombatBox.w / 2) - bossCenterX
          const dist = Math.abs(dx)

          // sameFloor — ТА ЖЕ проверка, что у зверя (по ногам, не по
          // верхней точке — рост игрока и босса разный), включая
          // SAME_FLOOR_TOLERANCE_TILES вместо узкой FLOOR_Y_TOLERANCE —
          // иначе прыжок героя формально снимал агро (см. задачу).
          const bossFeetYNow = boss.y + C.BOSS_HEIGHT
          const playerFeetYNow = deps.phys.y + C.PLAYER_HEIGHT
          const sameFloor = Math.abs(playerFeetYNow - bossFeetYNow) <= C.SAME_FLOOR_TOLERANCE_TILES * C.TILE_SIZE
          const aggroed = dist <= C.BOSS_AGGRO_RANGE_TILES * C.TILE_SIZE && sameFloor

          // Ranged (ФАЗА 3, см. задачу, п.3/4) — "наступает волнами":
          // проверяется ПЕРЕД обычным сближением/melee ниже. Пока герой
          // дальше BOSS_RANGED_MIN_TILES И кулдаун броска истёк — босс
          // ОСТАНАВЛИВАЕТСЯ и кидает вместо того, чтобы продолжать идти
          // к дистанции ближнего боя (перебивает уже начатое сближение
          // на любом шаге, не только когда уже стоит). Доступно с ПЕРВОЙ
          // стадии (в отличие от Melee2) — условия на stage нет. Ближе
          // BOSS_RANGED_MIN_TILES бросок недоступен — идёт в ближний бой
          // (см. else ниже, код там БЕЗ изменений).
          const rangedTrigger =
            aggroed && dist > C.BOSS_RANGED_MIN_TILES * C.TILE_SIZE && boss.rangedCooldownTimer <= 0
          if (rangedTrigger) {
            boss.moving = false
            boss.rangedAnimPlaying = true
            boss.rangedThrowApplied = false
            // 1-2 шипа за бросок (ФАЗА 3, шаг 4, см. задачу) — второй
            // розыгрыш решается ЗДЕСЬ один раз, на старте броска, не на
            // каждый повтор анимации.
            boss.rangedShotsLeft = Math.random() < C.BOSS_RANGED_DOUBLE_CHANCE ? 2 : 1
          } else {
            if (aggroed) {
              // Разворот к герою — применяется, пока агрён, движется он
              // или уже остановился вплотную (та же логика, что у зверя
              // bodiesTouchingX-ветка — доворачивается лицом, не трогая x).
              const dir = Math.sign(dx)
              if (dir !== 0) boss.facing = dir as 1 | -1

              // Гистерезис старт/стоп (см. задачу, п.5): уже идущий босс
              // тормозит РОВНО на STOP_DISTANCE, стоящий — трогается с
              // места только когда игрок отошёл на STOP_DISTANCE+запас.
              const stopDist = C.BOSS_STOP_DISTANCE
              boss.moving = boss.moving ? dist > stopDist : dist > stopDist + C.BOSS_STOP_HYSTERESIS

              if (boss.moving && dir !== 0) {
                const nextX = boss.x + dir * C.BOSS_MOVE_SPEED * dt
                const leadingX = dir > 0 ? nextX + C.BOSS_WIDTH : nextX
                // Стена впереди — та же 3-точечная проверка, что у зверя.
                const hitWall =
                  isSolid(deps.grid, C.TILE_SIZE, leadingX, boss.y + 1) ||
                  isSolid(deps.grid, C.TILE_SIZE, leadingX, boss.y + C.BOSS_HEIGHT / 2) ||
                  isSolid(deps.grid, C.TILE_SIZE, leadingX, boss.y + C.BOSS_HEIGHT - 1)
                // Край площадки впереди — ТА ЖЕ проверка, что в патруле у
                // зверя (noFloorAhead): в погоне зверь падать МОЖЕТ, но
                // боссу это запрещено (см. задачу, п.6) — переиспользуем
                // проверку из патруля, не пишем новую.
                const footCx = Math.floor(leadingX / C.TILE_SIZE)
                const footCy = Math.floor((boss.y + C.BOSS_HEIGHT) / C.TILE_SIZE)
                const noFloorAhead = cellFootBlockTop(deps.grid, C.TILE_SIZE, footCx, footCy) === null
                if (!hitWall && !noFloorAhead) {
                  boss.x = clamp(nextX, 0, worldWidthPx - C.BOSS_WIDTH)
                }
              }
            } else {
              boss.moving = false
            }

            // Кулдаун броска (ФАЗА 3, см. задачу) — считается ВНИЗ до 0,
            // тем же приёмом, что и кулдаун атаки ниже: тикает, пока
            // боссу сейчас не до броска (игрок близко ИЛИ кулдаун ещё не
            // истёк), выставляется на BOSS_RANGED_COOLDOWN_MS ПОСЛЕ конца
            // анимации броска (см. visual-sync ниже), не при попадании.
            if (boss.rangedCooldownTimer > 0) {
              boss.rangedCooldownTimer = Math.max(0, boss.rangedCooldownTimer - deltaMS)
            }

            // Кулдаун атаки (ФАЗА 2, шаг 5, см. задачу, п.4) — считается
            // ВНИЗ до 0 (тот же приём, что enemy.attackTimer у зверя),
            // выставляется на BOSS_ATTACK_COOLDOWN_MS ПОСЛЕ конца анимации
            // атаки (см. visual-sync ниже), не после урона.
            if (boss.attackCooldownTimer > 0) {
              boss.attackCooldownTimer = Math.max(0, boss.attackCooldownTimer - deltaMS)
            }
            // Кулдаун топота (ФАЗА 4, шаг 1, см. задачу) — тот же приём,
            // что у ranged/attack выше.
            if (boss.stompCooldownTimer > 0) {
              boss.stompCooldownTimer = Math.max(0, boss.stompCooldownTimer - deltaMS)
            }
            // Атака стартует, когда босс СТОИТ (boss.moving===false, дошёл
            // до BOSS_STOP_DISTANCE) И кулдаун истёк — ТОЛЬКО пока агрён,
            // иначе босс атаковал бы воздух вне боя (см. задачу, п.3).
            // Выбор атаки: стадия 1 — всегда Melee; стадия 2 — 50/50
            // Melee/Melee2 (Melee2 НИКОГДА не выбирается на стадии 1).
            if (aggroed && !boss.moving && boss.attackCooldownTimer <= 0) {
              boss.attackKind = boss.stage === 2 && Math.random() < 0.5 ? 'melee2' : 'melee'
              boss.attackAnimPlaying = true
              boss.attackHitApplied = false
            } else if (
              // Топот (ФАЗА 4, см. задачу) — ТОЛЬКО стадия 2, ДАЛЬШЕ
              // BOSS_STOMP_MIN_TILES, кулдаун истёк. Дальше, не ближе —
              // волне нужно время докатиться до игрока (телеграф из ТЗ),
              // вплотную она рождается под ногами и уклониться нельзя.
              // Приоритет: ниже melee (проверяется в if выше), выше ranged
              // (rangedTrigger проверен раньше по коду) — у топота кулдаун
              // 5с, шип заполняет паузы между топотами. Волна/урон —
              // следующий шаг, здесь только анимация + console.log на
              // strike-кадре.
              boss.stage === 2 &&
              aggroed &&
              dist > C.BOSS_STOMP_MIN_TILES * C.TILE_SIZE &&
              boss.stompCooldownTimer <= 0
            ) {
              boss.moving = false
              boss.stompAnimPlaying = true
              boss.stompStrikeApplied = false
            }
          }
        }

        // Приоритет визуала/действия, строго (ФАЗА 4, см. задачу): attack >
        // stomp > ranged > hurt > walk/idle (attack/stomp/ranged ВЫШЕ hurt —
        // тот же слой 1, что и у melee, см. applyAttackHit). dead
        // обрабатывается снаружи (см. общий if (!boss.dead) выше — мёртвый
        // босс сюда вообще не доходит). Проверять attack/stomp/ranged
        // первыми безопасно: пока attackAnimPlaying/stompAnimPlaying/
        // rangedAnimPlaying, hurtTimer в принципе не может стать > 0 (см.
        // applyAttackHit, слой 1 — попадание во время атаки/топота/броска
        // идёт во вспышку, не в hurtTimer).
        if (boss.attackAnimPlaying && boss.attackKind) {
          const kind = boss.attackKind
          deps.playBossAnim(kind)
          const strikeFrame = kind === 'melee' ? C.BOSS_MELEE_STRIKE_FRAME : C.BOSS_MELEE2_STRIKE_FRAME
          const damage = kind === 'melee' ? C.BOSS_MELEE_DAMAGE : C.BOSS_MELEE2_DAMAGE
          const range = kind === 'melee' ? C.BOSS_MELEE_RANGE : C.BOSS_MELEE2_RANGE
          const kindFrames = deps.bossFrames[kind]
          // Момент удара — РОВНО на strike-кадре (см. задачу, п.1/2), НЕ
          // по началу анимации и НЕ по нажатию. attackHitApplied дедупит
          // урон, пока currentFrame держится на/после strike-кадра —
          // тот же приём, что enemy.attackHitApplied у зверя. Атака
          // (слой 1, см. задачу) теперь ВСЕГДА доигрывает до этой точки —
          // Hurt её больше не обрывает.
          if (!boss.attackHitApplied && boss.sprite.currentFrame >= strikeFrame) {
            boss.attackHitApplied = true
            // Атака дошла до удара — сброс стан-резиста (СЛОЙ 2, см.
            // задачу), тот же приём, что enemy.stunCount=0 у зверя.
            boss.stunCount = 0
            // Зона удара — перед боссом по направлению facing, шириной
            // range (см. задачу, п.1/2). Урон — существующим путём
            // (takeDamageRef), с учётом i-frames dodge героя
            // (dodgeIframeRef) — переиспользуем проверку, не пишем свою.
            const zoneX = boss.facing === 1 ? boss.x + C.BOSS_WIDTH : boss.x - range
            const zone = { x: zoneX, y: boss.y, width: range, height: C.BOSS_HEIGHT }
            const strikePlayerBox = deps.getPlayerCombatBox()
            const overlap =
              strikePlayerBox.x < zone.x + zone.width &&
              strikePlayerBox.x + strikePlayerBox.w > zone.x &&
              strikePlayerBox.y < zone.y + zone.height &&
              strikePlayerBox.y + strikePlayerBox.h > zone.y
            if (overlap && deps.dodgeIframe.current <= 0) {
              deps.takeDamage(damage)
            }
          }
          if (boss.sprite.currentFrame >= kindFrames.length - 1 || !boss.sprite.playing) {
            // Анимация доиграла — кулдаун стартует ЗДЕСЬ, от конца
            // анимации (см. задачу, "Отдельно — кулдаун"). После слоя 1
            // это ЕДИНСТВЕННЫЙ способ закончить атаку (прерываний Hurt'ом
            // больше не бывает), так что кулдаун гарантированно стартует
            // при любом завершении атаки.
            boss.attackAnimPlaying = false
            boss.attackKind = null
            boss.attackCooldownTimer = C.BOSS_ATTACK_COOLDOWN_MS
          }
        } else if (boss.stompAnimPlaying) {
          // Топот (ФАЗА 4, см. задачу) — ПО ОБРАЗЦУ ranged ниже: доигрывает
          // до конца (слой 1, тот же приём — размещена ВЫШЕ ranged в
          // каскаде, см. приоритет "после melee, перед ranged"). На
          // strike-кадре — ДВЕ независимые волны (влево/вправо), см.
          // spawnBossWave/движение волн ниже.
          deps.playBossAnim('stomp')
          const stompFrames = deps.bossFrames.stomp
          if (!boss.stompStrikeApplied && boss.sprite.currentFrame >= C.BOSS_STOMP_STRIKE_FRAME) {
            boss.stompStrikeApplied = true
            spawnBossWave(boss, -1)
            spawnBossWave(boss, 1)
          }
          if (boss.sprite.currentFrame >= stompFrames.length - 1 || !boss.sprite.playing) {
            boss.stompAnimPlaying = false
            boss.stompCooldownTimer = C.BOSS_STOMP_COOLDOWN_MS
          }
        } else if (boss.rangedAnimPlaying) {
          // Ranged — ТОТ ЖЕ приём, что у melee/melee2 выше: доигрывает до
          // конца (слой 1 не даёт Hurt его оборвать). 1-2 шипа за бросок
          // (ФАЗА 3, шаг 4, см. задачу) — rangedShotsLeft разыгран на
          // старте (см. rangedTrigger выше); создаётся на кадре выпуска,
          // rangedThrowApplied дедупит спавн на кадрах после выпуска.
          deps.playBossAnim('ranged')
          const rangedFrames = deps.bossFrames.ranged
          if (!boss.rangedThrowApplied && boss.sprite.currentFrame >= C.BOSS_RANGED_RELEASE_FRAME) {
            boss.rangedThrowApplied = true
            spawnBossSpike(boss)
          }
          if (boss.sprite.currentFrame >= rangedFrames.length - 1 || !boss.sprite.playing) {
            boss.rangedShotsLeft -= 1
            if (boss.rangedShotsLeft > 0) {
              // Второй шип — повтор ТОЙ ЖЕ анимации с нулевого кадра, БЕЗ
              // возврата в стойку (см. задачу): playBossAnim('ranged') сам
              // не рестартит, т.к. это уже текущие textures (гейт
              // "тот же kind — return" в playBossAnim), поэтому рестарт —
              // прямой gotoAndPlay(0), тем же приёмом, каким playBossAnim
              // перезапускает разовые анимации. rangedAnimPlaying/
              // кулдаун НЕ трогаем — бросок продолжается.
              boss.rangedThrowApplied = false
              boss.sprite.gotoAndPlay(0)
            } else {
              boss.rangedAnimPlaying = false
              boss.rangedCooldownTimer = C.BOSS_RANGED_COOLDOWN_MS
            }
          }
        } else if (boss.hurtTimer > 0) {
          boss.hurtTimer = Math.max(0, boss.hurtTimer - deltaMS)
          deps.playBossAnim('hurt')
        } else {
          deps.playBossAnim(boss.moving ? 'walk' : 'idle')
        }
        // Вспышка попадания (СЛОИ 1/2, см. задачу) — визуальная замена
        // Hurt в моменты, когда сам Hurt не проигрывается (во время
        // атаки — ВСЕГДА, вне атаки — под иммунитетом poiseImmuneTimer):
        // тикает вниз каждый кадр независимо от ветки выше, danger-tint
        // на спрайте, пока активна.
        boss.hitFlashTimer = Math.max(0, boss.hitFlashTimer - deltaMS)
        boss.sprite.tint = boss.hitFlashTimer > 0 ? 0xe0353b : 0xffffff
        // Накопительный стан-резист (СЛОЙ 2, см. задачу) — тикает вниз
        // каждый кадр, как у зверя (STUN_LIMIT/POISE_IMMUNE_MS там,
        // BOSS_STUN_LIMIT/BOSS_POISE_IMMUNE_MS здесь).
        boss.poiseImmuneTimer = Math.max(0, boss.poiseImmuneTimer - deltaMS)

        // Push-out — ПОСЛЕ движения (boss.x этого кадра уже финален), как
        // у зверя (см. его pushPlayerOutX ниже по коду выше в enemy-цикле).
        // ТОЛЬКО пока жив (см. задачу, п.3) — мёртвый босс не толкает
        // героя, тело проходимо.
        deps.pushPlayerOutX({ x: boss.x, y: boss.y, width: C.BOSS_WIDTH, height: C.BOSS_HEIGHT }, deps.getPlayerCombatBox())

        deps.applyBossLayout(boss)
        // Флип — ПОСЛЕ applyBossLayout: тот каждый тик ставит scale.set(...)
        // (равномерный, положительный масштаб), так что флип обязан идти
        // последним, иначе applyBossLayout стирал бы знак scale.x обратно.
        boss.sprite.scale.x = boss.facing === -1 ? Math.abs(boss.sprite.scale.x) : -Math.abs(boss.sprite.scale.x)
      } else {
        // ФАЗА 5 (см. задачу) — труп НЕ despawn'ится (в отличие от
        // зверя), здесь только момент завершения death-анимации: ТЕМ ЖЕ
        // способом, что у зверя (currentFrame на последнем кадре ИЛИ
        // спрайт сам остановился). rewardGiven дедупит награду/
        // closeEvent — без флага туша, висящая на последнем кадре,
        // слала бы награду каждый тик.
        const deathFrames = deps.bossFrames.death
        const deathDone = boss.sprite.currentFrame >= deathFrames.length - 1 || !boss.sprite.playing
        if (deathDone && !boss.rewardGiven) {
          boss.rewardGiven = true
          const amount = rollTrophies(C.TROPHY_MULT_BOSS)
          deps.spawnRewardFloat(boss.sprite.x, boss.sprite.y - boss.sprite.height, [
            { kind: 'trophy', amount },
          ])
          if (deps.bossEventIndex.current !== null) deps.closeEvent(deps.bossEventIndex.current)
        }
      }
    }
  }

  // Летящие шипы дальней атаки босса (ФАЗА 3, шаг 3, см. задачу) —
  // независимый от bossRef список (по образцу rewardFloatsRef в Explore.tsx):
  // шип, брошенный до смерти босса, должен долетать сам по себе.
  // Баллистическая дуга (BOSS_SPIKE_GRAVITY, vy подобрана при спавне на
  // попадание в героя — см. spawnBossSpike), НЕ прямая горизонтальная.
  // Попадание в героя — тем же getPlayerCombatBox()/dodgeIframeRef, что
  // и melee-удар босса выше (не пишем свою проверку). dtSec — своя
  // переменная (НЕ путать с внешним ticker-scale dt=ticker.deltaTime,
  // здесь нужны реальные секунды).
  function updateSpikes(deltaMS: number): void {
    if (deps.bossSpikes.current.length > 0) {
      const stillFlying: BossSpike[] = []
      for (const spike of deps.bossSpikes.current) {
        const dtSec = deltaMS / 1000
        spike.vy += C.BOSS_SPIKE_GRAVITY * dtSec
        const vx = spike.dir * C.BOSS_SPIKE_SPEED_X
        spike.sprite.x += vx * dtSec
        spike.sprite.y += spike.vy * dtSec
        // Остриё на исходном PNG смотрит ВЛЕВО (см. задачу) — поворот
        // спрайта по направлению полёта ВМЕСТО зеркалирования (scale.x
        // остаётся положительным, см. spawnBossSpike).
        spike.sprite.rotation = Math.atan2(-spike.vy, -vx)
        spike.lifeMs += deltaMS

        let remove = spike.lifeMs >= C.BOSS_SPIKE_LIFETIME_MS

        // Падение на пол (см. задачу, п.6) — с гравитацией шип может
        // промахнуться и уйти вниз. isSolid — твердь '#' (и края карты),
        // isPlatformBandBlocking — верхняя полоса '=' (обе уже
        // используются в файле для той же проверки, новой не пишем).
        if (!remove && !spike.hitApplied) {
          const groundHit =
            isSolid(deps.grid, C.TILE_SIZE, spike.sprite.x, spike.sprite.y) ||
            isPlatformBandBlocking(deps.grid, C.TILE_SIZE, spike.sprite.x, spike.sprite.y, spike.sprite.y + 1) !== null
          if (groundHit) {
            spike.hitApplied = true
            remove = true
            spawnBossSpikeImpact(spike.sprite.x, spike.sprite.y)
          }
        }

        if (!remove && !spike.hitApplied) {
          const box = deps.getPlayerCombatBox()
          const spikeLeft = spike.sprite.x - C.BOSS_SPIKE_DRAW_W / 2
          const spikeTop = spike.sprite.y - C.BOSS_SPIKE_DRAW_H / 2
          const overlap =
            box.x < spikeLeft + C.BOSS_SPIKE_DRAW_W &&
            box.x + box.w > spikeLeft &&
            box.y < spikeTop + C.BOSS_SPIKE_DRAW_H &&
            box.y + box.h > spikeTop
          // dodgeIframeRef активен — шип пролетает насквозь, без урона и
          // без импакта (см. задачу, п.7 — не трогаем).
          if (overlap && deps.dodgeIframe.current <= 0) {
            spike.hitApplied = true
            remove = true
            deps.takeDamage(C.BOSS_RANGED_DAMAGE)
            spawnBossSpikeImpact(spike.sprite.x, spike.sprite.y)
          }
        }

        if (remove) {
          deps.worldContainer.removeChild(spike.sprite)
          spike.sprite.destroy()
        } else {
          stillFlying.push(spike)
        }
      }
      deps.bossSpikes.current = stillFlying
    }
  }

  // AoE-волны топота босса (см. задачу) — независимый от bossRef список
  // (по образцу bossSpikesRef выше): волна, рождённая до смерти/despawn
  // босса, должна докатиться сама по себе. Y НЕ меняется — катится по
  // земле, гравитации нет (в отличие от шипа). Уклонение ТОЛЬКО
  // прыжком — dodgeIframeRef здесь НЕ учитывается (см. задачу, п.7):
  // герой в прыжке физически выше волны своим боевым боксом, пересечения
  // не будет само собой.
  function updateWaves(deltaMS: number): void {
    if (deps.bossWaves.current.length > 0) {
      const stillRolling: BossWave[] = []
      for (const w of deps.bossWaves.current) {
        const dt = deltaMS / 1000
        w.sprite.x += w.dir * C.BOSS_WAVE_SPEED * dt
        w.lifeMs += deltaMS

        let remove = w.lifeMs >= C.BOSS_WAVE_LIFETIME_MS

        // Остановка о препятствие — тайл впереди волны, на уровне её
        // ЦЕНТРА (не низа: низ лежит ровно на полу, точка "низ-1px"
        // попадает в тайл земли, под которой волна и так едет — волна
        // гасла об этот тайл сразу же). isSolid — ТА ЖЕ функция, что у
        // шипа (проверка твёрдости '#'/края карты, см. блок шипов выше).
        // Просто исчезает, без импакта.
        if (!remove) {
          const frontX = w.sprite.x + w.dir * (C.BOSS_WAVE_DRAW_W / 2)
          const centerY = w.sprite.y - C.BOSS_WAVE_DRAW_H / 2
          if (isSolid(deps.grid, C.TILE_SIZE, frontX, centerY)) {
            remove = true
          }
        }

        // Попадание в героя (см. задачу, п.7) — тем же getPlayerCombatBox(),
        // что и у шипа, НО БЕЗ dodgeIframeRef (уклонение только прыжком).
        // Каждая волна бьёт максимум один раз.
        if (!remove && !w.hitApplied) {
          const box = deps.getPlayerCombatBox()
          const waveLeft = w.sprite.x - C.BOSS_WAVE_DRAW_W / 2
          const waveTop = w.sprite.y - C.BOSS_WAVE_DRAW_H
          const overlap =
            box.x < waveLeft + C.BOSS_WAVE_DRAW_W &&
            box.x + box.w > waveLeft &&
            box.y < waveTop + C.BOSS_WAVE_DRAW_H &&
            box.y + box.h > waveTop
          if (overlap) {
            w.hitApplied = true
            remove = true
            deps.takeDamage(C.BOSS_WAVE_DAMAGE)
          }
        }

        if (remove) {
          deps.worldContainer.removeChild(w.sprite)
          w.sprite.destroy()
        } else {
          stillRolling.push(w)
        }
      }
      deps.bossWaves.current = stillRolling
    }
  }

  // КРИТИЧНО: порядок вызовов внутри update() — AI → шипы → волны, не
  // менять. Ranged/stomp-ветки updateAI порождают шип/волну В ЭТОМ ЖЕ
  // кадре (spawnBossSpike/spawnBossWave выше) — updateSpikes/updateWaves
  // должны идти СРАЗУ ПОСЛЕ updateAI, чтобы новорождённый снаряд получил
  // первый шаг физики/hit-теста в том же кадре, а не на следующем.
  function update(dt: number, deltaMS: number): void {
    updateAI(dt, deltaMS)
    updateSpikes(deltaMS)
    updateWaves(deltaMS)
  }

  function dispose(): void {
    // bossSpikesRef/bossWavesRef обнуляются в cleanup эффекта Explore.tsx
    // (там же, где и раньше, до этого переноса) — не дублируем очистку
    // здесь. Пусто намеренно, не переносим новое поведение.
  }

  return { spawn, update, dispose }
}
