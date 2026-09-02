import type { Graphics, AnimatedSprite, Container, Sprite } from 'pixi.js'

export type Grid = string[][]

// "3 события за забег" — ВРЕМЕННЫЙ каркас (Phase 2, часть 2). kind совпадает
// со строками ROOM_LABELS в App.tsx (enemy/chest/smuggler/puzzle/boss), чтобы
// результат забега можно было отдать старому results-экрану без маппинга.
export type EventKind = 'enemy' | 'chest' | 'smuggler' | 'puzzle' | 'boss' | 'obelisk'

// clusterPoints — ТОЛЬКО для kind='enemy': все 3 точки кластера (не только
// points[0]) — нужны, чтобы заспавнить весь кластер, а не одного врага.
export type EventCandidate = { kind: EventKind; x: number; y: number; clusterPoints?: [number, number][] }

// Тело босса стоит в клетке НЕ по центру и по-разному в каждом листе (см.
// задачу) — anchor.x И anchor.y меняются ТОЛЬКО при смене листа (playBossAnim),
// внутри одной анимации запрещено трогать оба.
export type BossAnimKind = 'idle' | 'walk' | 'melee' | 'melee2' | 'hurt' | 'death' | 'ranged' | 'stomp'

// Плавающий попап награды над объектом (Explore офлайн — НИКАКОГО начисления
// player.gold/trophies/crystals, только визуал поверх мира, см. spawnRewardFloat
// в setup). Иконки — тот же способ пути (BASE_URL), что у героя/зверя/сундука.
export type RewardKind = 'gold' | 'trophy' | 'rp'

export type PlayerPhysics = {
  x: number
  y: number
  vx: number
  vy: number
  onGround: boolean
}

// Один враг из СПИСКА (Шаг 2-3: кластер = 3 врага, каждый — свой Enemy). x/y —
// верхний левый угол в мировых координатах (как у phys игрока). lastHitSwingId
// — id взмаха атаки игрока, который этому врагу уже засчитан, чтобы один
// активный хитбокс не бил его каждый кадр, пока длится (см. attackSwingIdRef).
// attackTimer/windingUp/windupTimer — AI атаки врага: attackTimer — КУЛДАУН
// (считает ВНИЗ до 0, а не вверх), 0 = готов бить немедленно по достижении
// ATTACK_STOP_DIST; windingUp держится WINDUP_MS, удар — ровно в момент
// истечения замаха (см. ENEMY_*/ATTACK_STOP_DIST/WINDUP_MS константы выше).
// eventIndex — индекс "родительского" enemy-события в eventsRef.current: при
// смерти врага декрементируем remainingEnemies именно этого события.
// vy — вертикальная скорость (Шаг A "умного врага"): та же физика, что у
// игрока (GRAVITY/MAX_FALL, приземление через sweepFootBlock) — враг падает
// под гравитацией и стоит на '#'/'=' вместо "полёта"; В ПОГОНЕ падение с края
// разрешено (агрессивная физика), В ПАТРУЛЕ — нет (см. Шаг C ниже).
// spawnX — точка спавна (мировые px), центр патрульной зоны ±PATROL_RANGE_TILES.
// patrolDir — текущее направление патруля (меняется на разворотах). facing —
// куда сейчас "смотрит" враг (обновляется и в патруле, и в погоне; читается
// для флипа rect.scale.x — задел под будущий спрайт).
export type Enemy = {
  x: number
  y: number
  vy: number
  hp: number
  maxHp: number
  lastHitSwingId: number
  attackTimer: number
  windingUp: boolean
  windupTimer: number
  eventIndex: number
  spawnX: number
  patrolDir: 1 | -1
  facing: 1 | -1
  rect: Graphics
  sprite: AnimatedSprite
  // attackAnimPlaying — идёт attack-анимация спрайта (запущена на входе в
  // windingUp, но НЕ обязана закончиться вместе с ним — см. BEAST_ATTACK_*
  // выше: анимация длиннее WINDUP_MS на follow-through). Пока true — визуал
  // не переключается на idle/walk, независимо от enemy.windingUp/движения.
  // attackHitApplied — урон этого замаха уже применён на strike-кадре, чтобы
  // не бить каждый тик, пока currentFrame удерживается на/после strike-кадра.
  attackAnimPlaying: boolean
  attackHitApplied: boolean
  // >0 — идёт hurt (хитстан от урона игрока), в мс, тикает вниз в ticker'е.
  // Главнее attack (перебивает/отменяет замах, см. applyAttackHit) и
  // блокирует новый windup/движение, пока не истечёт — см. приоритет в
  // ticker'е (hurt > attack > idle/walk), тот же принцип, что у героя.
  hurtTimer: number
  // Накопительный стан-резист (см. STUN_LIMIT/POISE_IMMUNE_MS выше):
  // stunCount — сколько замахов подряд сбито (CANCEL) без единого успешного
  // удара; poiseImmuneTimer — >0, пока действует иммунитет к прерыванию
  // (тикает вниз в ticker'е, перекрывает проверку POISE_POINT в applyAttackHit).
  stunCount: number
  poiseImmuneTimer: number
  // dead — высший приоритет (перебивает hurt/attack/windup немедленно, см.
  // applyAttackHit), больше НЕ сбрасывается назад. deathHoldTimer — копится
  // ПОСЛЕ того, как death-анимация доиграла (мс, см. DEATH_HOLD_MS выше) —
  // пока не истечёт, враг остаётся в enemiesRef.current (только визуал),
  // затем удаляется/декрементирует remainingEnemies события, как раньше.
  dead: boolean
  deathHoldTimer: number
  // Доля трофеев этого врага из суммы кластера (см. задачу) — разыграна
  // ОДИН раз при спавне всего кластера (rollTrophies), не при смерти
  // каждого врага отдельно, иначе сумма по группе не сходилась бы с total.
  trophyReward: number
  // Урон удара этого врага — посчитан ОДИН раз при спавне по формуле
  // масштабирования (см. scaling.ts/ENEMY_DAMAGE_PER_LEVEL), не константа
  // C.ENEMY_ATTACK_DAMAGE напрямую и не пересчитывается на лету (см. задачу
  // "масштабирование по уровню" — уровень персонажа не должен влиять на уже
  // заспавненного врага посреди забега).
  attackDamage: number
  hpBarBg: Graphics
  hpBarFill: Graphics
}

// Сундук (reward-событие) — открывается ударом игрока (см. applyAttackHit),
// НЕ касанием. opening — идёт анимация Chest_Open ИЛИ Chest_Trap_Explode
// (загорожена от повторного запуска, пока true); opened — анимация доиграла,
// сундук зафиксирован на последнем кадре, событие закрыто. eventIndex — тот
// же индекс в eventsRef.current, что и у enemy.eventIndex, для closeEvent().
// isMimic — бросок решается ОДИН раз на первом ударе (см. applyAttackHit):
// true = мимик (Chest_Trap_Explode, урон, без награды), false = добрый
// (Chest_Open, награда, без изменений). undefined — бросок ещё не сделан.
// trapDamaged — урон мимика уже применён на strike-кадре (не бить повторно
// на следующих кадрах, пока держится последний кадр анимации).
// floorY — поверхность пола под сундуком, найдена ОДИН раз при спавне
// (findGroundSurfaceY) и больше не пересчитывается от bbox текущего кадра —
// applyChestLayout (см. setup) всегда ставит низ спрайта на floorY+
// CHEST_OFFSET_Y, какой бы набор кадров/размер сейчас ни был активен.
export type Chest = {
  sprite: AnimatedSprite
  hitbox: { x: number; y: number; width: number; height: number }
  opening: boolean
  opened: boolean
  eventIndex: number
  isMimic?: boolean
  trapDamaged: boolean
  floorY: number
}

// Смуглер (NPC-событие) — ТОЛЬКО визуал на этом шаге (idle, без
// взаимодействия — см. задачу). floorY найден ОДИН раз при спавне
// (findGroundSurfaceY, как у Chest.floorY) и сразу использован для
// sprite.y — в отличие от сундука, нет applyChestLayout-подобной функции
// на каждый кадр, т.к. пока нет смены состояния/размера кадра.
// facing — поворот к игроку (см. ticker): 1=вправо (дефолт, спрайт смотрит
// вправо без флипа), -1=влево. Держится, пока игрок вне SMUGGLER_TURN_RANGE
// (не дёргается туда-сюда на границе дальности).
export type Smuggler = {
  sprite: AnimatedSprite
  floorY: number
  eventIndex: number
  facing: 1 | -1
}

// Обелиск карты F (ВРЕМЕННО вне рулетки 3 событий, см. задачу) — спавнится
// как отдельный объект, по образцу Chest: hitbox — мягкая стена по X (см.
// pushPlayerOutX в ticker'е), floorY найден один раз при спавне
// (findGroundSurfaceY). tileX/tileY — координаты в тайлах (для будущей
// логики burning/struck, см. задачу — на этом шаге не используются).
export type Obelisk = {
  sprite: AnimatedSprite
  hitbox: { x: number; y: number; width: number; height: number }
  floorY: number
  tileX: number
  tileY: number
  burning: boolean
  struck: boolean
}

// Босс карты C — ФАЗА 2, шаг 3 (см. задачу): урон/HP/hurt, ещё БЕЗ AI/атак/
// движения. x/y/vy/facing — по образцу Enemy (гравитация + посадка на пол
// тем же sweepFootBlock, что у врага); x/y — координаты ХИТБОКСА (BOSS_WIDTH/
// BOSS_HEIGHT), не спрайта — спрайт синкается от него в applyBossLayout, как
// enemy.sprite от enemy.rect. Хитбокс НЕ отрисовывается (отладочная рамка
// использовалась только для подбора BOSS_WIDTH/BOSS_HEIGHT и убрана вместе с
// тюнером — см. историю).
// hp/maxHp/lastHitSwingId/hurtTimer/stunCount/poiseImmuneTimer/dead — ТЕ ЖЕ
// поля и смысл, что у Enemy (см. applyAttackHit/ticker ниже — тот же
// хит-тест/poise/анти-стан-лок механизм, не второй). deathHoldTimer заведён
// по той же схеме, но НЕ используется (см. задачу, п.2) — труп босса, в
// отличие от зверя, не despawn'ится, держать таймер до удаления незачем.
// stage — 1|2, переход на 2 при первом пересечении BOSS_STAGE2_HP_RATIO
// ВНИЗ (не каждый кадр, см. гейт `stage === 1` в applyAttackHit).
// moving — ФАЗА 2, шаг 4 (см. задачу): персистентное состояние "идёт/стоит"
// между тиками, нужно ИМЕННО для гистерезиса (п.5 задачи) — без него нельзя
// было бы отличить "уже иду, торможу на STOP_DISTANCE" от "уже стою, трогаюсь
// только на STOP_DISTANCE+запас" одним и тем же числом dist.
// attackKind/attackAnimPlaying/attackHitApplied/attackCooldownTimer — ФАЗА 2,
// шаг 5 (см. задачу): у босса НЕТ windingUp, как у зверя — атака стартует
// сразу (сама анимация — телеграф), attackKind фиксирует, КАКАЯ атака сейчас
// играет (для strike-кадра/урона/зоны — числа разные у melee/melee2).
// attackHitApplied — урон этого замаха уже применён (как enemy.attackHitApplied
// у зверя) — не бить каждый тик, пока currentFrame держится на/после strike-
// кадра. attackCooldownTimer — тикает ВНИЗ до 0, выставляется ПОСЛЕ конца
// анимации атаки — ЛЮБОГО конца (естественного; прерванного у босса теперь
// не бывает — см. слой 1 ниже), не после урона.
// stunCount/poiseImmuneTimer — СЛОЙ 2 починки стан-лока (см. задачу): ТОТ ЖЕ
// механизм, что у Enemy.stunCount/poiseImmuneTimer выше, своими константами
// (BOSS_STUN_LIMIT/BOSS_POISE_IMMUNE_MS), участвует ТОЛЬКО пока босс НЕ
// атакует (см. applyAttackHit) — во время атаки хитстана нет вообще (слой 1).
// hitFlashTimer — СЛОЙ 1/2 (см. задачу): >0 мс, тикает вниз, пока активен —
// спрайт подкрашен в danger-tint (BOSS_HIT_FLASH_MS) вместо хитстана —
// визуальная замена Hurt, когда сам Hurt не проигрывается (в атаке ВСЕГДА,
// вне атаки — только под иммунитетом poiseImmuneTimer).
// rangedAnimPlaying/rangedThrowApplied/rangedCooldownTimer — ФАЗА 3, шаг 1
// (см. задачу) — состояние броска, ПО ОБРАЗЦУ attackAnimPlaying/
// attackHitApplied/attackCooldownTimer выше: rangedAnimPlaying — идёт
// анимация Ranged (высший приоритет, ВЫШЕ hurt, тот же слой 1, что у melee —
// см. applyAttackHit); rangedThrowApplied — кадр выпуска (BOSS_RANGED_
// RELEASE_FRAME) уже отмечен для этого броска (снаряда/урона на этом шаге
// нет, только console.log); rangedCooldownTimer — тикает ВНИЗ до 0,
// выставляется ПОСЛЕ конца анимации броска, не при попадании урона.
export type Boss = {
  x: number
  y: number
  vy: number
  facing: 1 | -1
  moving: boolean
  hp: number
  maxHp: number
  lastHitSwingId: number
  hurtTimer: number
  stunCount: number
  poiseImmuneTimer: number
  hitFlashTimer: number
  dead: boolean
  deathHoldTimer: number
  stage: 1 | 2
  attackKind: 'melee' | 'melee2' | null
  attackAnimPlaying: boolean
  attackHitApplied: boolean
  attackCooldownTimer: number
  rangedAnimPlaying: boolean
  rangedThrowApplied: boolean
  rangedCooldownTimer: number
  rangedShotsLeft: number
  stompAnimPlaying: boolean
  stompStrikeApplied: boolean
  stompCooldownTimer: number
  // rewardGiven — награда/closeEvent выдаются РОВНО ОДИН раз, когда
  // death-анимация доигрывает (см. ФАЗА 5, задача); без флага туша,
  // висящая на последнем кадре после конца анимации, слала бы награду
  // каждый тик.
  rewardGiven: boolean
  hpBarBg: Graphics
  hpBarFill: Graphics
  sprite: AnimatedSprite
  // Урон атак босса — посчитаны ОДИН раз при спавне по формуле
  // масштабирования (см. scaling.ts), тем же приёмом, что Enemy.attackDamage
  // выше: множитель (BOSS_*_DMG_MULT) поверх уже отмасштабированного урона
  // обычного врага на этом же уровне персонажа, не константы C.BOSS_*_DAMAGE
  // напрямую.
  meleeDamage: number
  melee2Damage: number
  spikeDamage: number
  waveDamage: number
}

// HUD события обелисков (таймер + счётчик над экраном, см. задачу) — ЭТО
// state (не ref), т.к. рисует UI; в тикере пишется только при реальном
// изменении целых секунд/счётчика, не каждый кадр (см. установка ниже).
export type ObeliskHud = { active: boolean; secondsLeft: number; struck: number }

// Плавающий попап награды (см. REWARD_* константы выше и spawnRewardFloat в
// setup) — node живёт в worldContainer (двигается с камерой вместе со
// сценой), elapsed копится в мс по ticker.deltaMS, startY — Y на момент
// спавна (анимация всплытия считается от него, не от текущего node.y).
export type RewardFloat = {
  node: Container
  elapsed: number
  startY: number
}

// Летящий шип дальней атаки босса (ФАЗА 3, шаг 3, см. задачу) — по образцу
// RewardFloat: список активных снарядов, обновляется в ticker'е, спрайт живёт
// в worldContainer (двигается с камерой вместе со сценой). dir — направление
// полёта (1/-1), зафиксировано при спавне (boss.facing на тот момент), дальше
// не меняется. vy — вертикальная скорость баллистической дуги (px/сек),
// посчитана при спавне на попадание в героя, дальше растёт под BOSS_SPIKE_
// GRAVITY каждый кадр. hitApplied — урон уже применён этим шипом, помечен на
// удаление в этом же кадре (не бить дважды, не пролетать сквозь после удара).
export type BossSpike = {
  sprite: Sprite
  dir: 1 | -1
  vy: number
  lifeMs: number
  hitApplied: boolean
  // Урон этого конкретного шипа — снят с boss.spikeDamage в момент спавна
  // (см. spawnBossSpike), не константа C.BOSS_RANGED_DAMAGE напрямую.
  damage: number
}

// AoE-волна топота (см. задачу) — независимая головка, катится по земле
// (Y не меняется, гравитации нет, в отличие от шипа). dir — направление
// (влево/вправо от босса), зафиксировано при спавне, не меняется.
// hitApplied — бьёт максимум один раз, дальше помечена на удаление.
export type BossWave = {
  sprite: AnimatedSprite
  dir: 1 | -1
  lifeMs: number
  hitApplied: boolean
  // Урон этой конкретной волны — снят с boss.waveDamage в момент спавна
  // (см. spawnBossWave), не константа C.BOSS_WAVE_DAMAGE напрямую.
  damage: number
}

// marker — для enemy-события НЕ создаётся (визуал — сами враги, реальные
// прямоугольники); для остальных типов (пока заглушки) — как раньше, кружок
// + закрытие касанием. remainingEnemies — только для kind='enemy': сколько
// врагов кластера ещё живы; событие закрывается, когда доходит до 0.
export type MapEvent = EventCandidate & { marker?: Graphics; closed: boolean; remainingEnemies?: number }
