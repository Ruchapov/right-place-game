import { useEffect, useRef, useState } from 'react'
import { Application, Assets, AnimatedSprite, Container, Graphics, Rectangle, Sprite, Text, Texture, TilingSprite } from 'pixi.js'
import { renderMapToCanvas, backdropPaths } from './mapRenderer'
import * as C from './explore/constants'
import SettingsPanel from './explore/ui/SettingsPanel'
import TouchControls from './explore/ui/TouchControls'
import HudPlate from './explore/ui/HudPlate'
import type { Grid, EventKind, EventCandidate, BossAnimKind, RewardKind } from './explore/types'
import {
  isSolid,
  isPlatformBandBlocking,
  isOverlappingPlatformBand,
  isTouchingSpikes,
  cellFootBlockTop,
  sweepHeadBlock,
  isOverlappingAtFrameStart,
  sweepFootBlock,
} from './explore/collision'
import { backdropForMap, slotsFileForMap, isPointXY, buildEventCandidates } from './explore/mapEvents'
import { clamp, pickRandom } from './explore/utils'
import { rollTrophies } from './explore/rewards'
import { loadSheetFrames } from './explore/spriteLoader'

type ExploreProps = {
  onClose?: () => void
  endurance?: number
  strength?: number
  // Временный каркас "3 события за забег": вызывается ровно один раз, когда
  // все 3 выбранных события закрыты. kind — 'enemy'|'chest'|'smuggler'|'puzzle'|
  // 'boss', совпадает с ключами ROOM_LABELS в App.tsx.
  onRunComplete?: (closedEvents: { kind: EventKind }[]) => void
  // Имя файла сетки карты (напр. 'map_B_razlom.txt'). Не задан — DEFAULT_MAP_FILE
  // (см. ниже), 1:1 прежнее поведение. App.tsx пока этот проп не передаёт.
  mapFile?: string
}




























                                 // не пробрасывается, считаем по 1






























type PlayerPhysics = {
  x: number
  y: number
  vx: number
  vy: number
  onGround: boolean
}

// Зона удара атаки, в мировых (тайловых) координатах — читается будущим
// hit-test'ом врага/сундука через attackHitboxRef.
type AttackHitbox = { x: number; y: number; width: number; height: number }

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
type Enemy = {
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
  hpBarBg: Graphics
  hpBarFill: Graphics
}

// Кадры зверя (Шаг "спрайт зверя") — загружаются ОДИН раз в setup(), общие
// для всех врагов кластера (каждый враг заводит СВОЙ AnimatedSprite поверх
// одних и тех же Texture-массивов). AI/переключение по состоянию — позже,
// пока используется только idle.
type BeastFrames = { idle: Texture[]; walk: Texture[]; attack: Texture[]; hurt: Texture[]; death: Texture[] }

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
type Chest = {
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
type Smuggler = {
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
type Obelisk = {
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
type Boss = {
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
}

// HUD события обелисков (таймер + счётчик над экраном, см. задачу) — ЭТО
// state (не ref), т.к. рисует UI; в тикере пишется только при реальном
// изменении целых секунд/счётчика, не каждый кадр (см. установка ниже).
type ObeliskHud = { active: boolean; secondsLeft: number; struck: number }

// Плавающий попап награды (см. REWARD_* константы выше и spawnRewardFloat в
// setup) — node живёт в worldContainer (двигается с камерой вместе со
// сценой), elapsed копится в мс по ticker.deltaMS, startY — Y на момент
// спавна (анимация всплытия считается от него, не от текущего node.y).
type RewardFloat = {
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
type BossSpike = {
  sprite: Sprite
  dir: 1 | -1
  vy: number
  lifeMs: number
  hitApplied: boolean
}

// AoE-волна топота (см. задачу) — независимая головка, катится по земле
// (Y не меняется, гравитации нет, в отличие от шипа). dir — направление
// (влево/вправо от босса), зафиксировано при спавне, не меняется.
// hitApplied — бьёт максимум один раз, дальше помечена на удаление.
type BossWave = {
  sprite: AnimatedSprite
  dir: 1 | -1
  lifeMs: number
  hitApplied: boolean
}

// EventKind объявлен в ./explore/types.ts — реэкспорт нужен, т.к. HudPlate.tsx
// импортирует его напрямую из Explore.tsx (см. import type выше).
export type { EventKind }

// marker — для enemy-события НЕ создаётся (визуал — сами враги, реальные
// прямоугольники); для остальных типов (пока заглушки) — как раньше, кружок
// + закрытие касанием. remainingEnemies — только для kind='enemy': сколько
// врагов кластера ещё живы; событие закрывается, когда доходит до 0.
type MapEvent = EventCandidate & { marker?: Graphics; closed: boolean; remainingEnemies?: number }











export default function Explore({ onClose, endurance, strength, onRunComplete, mapFile: mapFileProp }: ExploreProps) {
  // Проп не задан (текущий вход из App.tsx) → DEFAULT_MAP_FILE, 1:1 прежнее
  // поведение. State (не const) — TEMP: map switcher (см. ниже) меняет её,
  // чтобы перезапустить эффект инициализации PixiJS на другой карте (mapFile
  // в его массиве зависимостей). setup() читает актуальное значение через
  // обычное замыкание, как и раньше читал endurance/strength для maxHp.
  const [mapFile, setMapFile] = useState(mapFileProp ?? C.DEFAULT_MAP_FILE)
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const physicsRef = useRef<PlayerPhysics>({ x: 0, y: 0, vx: 0, vy: 0, onGround: false })
  // Визуал героя (AnimatedSprite поверх хитбокса-Graphics, который остаётся
  // невидимым, но живым — коллизия по-прежнему считается по нему). Ref, не
  // state — позиция обновляется каждый кадр в ticker'е.
  const heroSpriteRef = useRef<AnimatedSprite | null>(null)
  // Кадры зверя (см. BeastFrames выше) — загружены один раз в setup(),
  // доступны отовсюду (spawnEnemy, ticker) через этот ref, как deathFramesRef
  // у героя.
  const beastFramesRef = useRef<BeastFrames | null>(null)
  // >0 — проигрывается land (короткая анимация приземления), в мс. Тикает
  // вниз в ticker'е; движение/прыжок прерывают её досрочно (landTimerRef = 0).
  const landTimerRef = useRef(0)
  // >0 — проигрывается hurt (хитстан от урона), в мс. Главнее attack/land/run
  // по приоритету анимаций (см. ticker) — обрывает замах атаки, см. triggerHurt.
  const hurtTimerRef = useRef(0)
  // true — идёт смерть, блокирует ВСЁ остальное в блоке анимации героя
  // (высший приоритет, проверяется первым в тикере). Не сбрасывается назад в
  // false — забег в любом случае завершается через abandon.
  const deathRef = useRef(false)
  const deathHoldRef = useRef(0) // мс удержания последнего кадра death, копится ПОСЛЕ того, как анимация доиграла
  const deathAbandonFiredRef = useRef(false) // защита от повторного вызова abandon за кадры удержания
  // AnimatedSprite/кадры death недоступны из takeDamage (объявлены внутри
  // setup(), другая замкнутая область видимости) — зеркалим их в ref'ы, как
  // heroSpriteRef уже зеркалит hero, чтобы triggerDeath мог их прочитать.
  const deathFramesRef = useRef<Texture[] | null>(null)
  const dirRef = useRef(0) // -1 влево, 0 стоп, 1 вправо — читается каждый кадр в ticker
  const jumpPressedRef = useRef(false) // флаг нажатия, читается и сбрасывается в ticker

  // "3 события за забег" — временный каркас. eventsRef хранит выбранные события
  // и их Pixi-маркеры (заполняется в setup(), после загрузки слот-файла).
  // eventClosed — состояние ТОЛЬКО для HUD-иконок сверху (закрытий мало, до 3
  // за забег, — в отличие от HP лишний ререндер тут не проблема).
  const eventsRef = useRef<MapEvent[]>([])
  const runCompleteFiredRef = useRef(false)
  const onRunCompleteRef = useRef<(closedEvents: { kind: EventKind }[]) => void>(() => {})
  const [eventClosed, setEventClosed] = useState<boolean[]>(Array(C.EVENTS_PER_RUN).fill(false))
  // eventKinds — параллельно eventClosed (тот же индекс = то же событие), только
  // для HUD-иконок (какой эмодзи/тип рисовать) — на closed-логику не влияет.
  const [eventKinds, setEventKinds] = useState<EventKind[]>([])

  // maxHp не меняется в течение забега — считаем один раз из endurance персонажа.
  const maxHp = endurance && endurance > 0 ? endurance * C.HP_PER_ENDURANCE : C.FALLBACK_MAX_HP
  // Текущее hp — в ref, не в state: меняется в игровом цикле каждый кадр,
  // ререндер React на это не нужен. HP-бар обновляется вручную через DOM-refs.
  const hpRef = useRef(maxHp)
  const hpFillRef = useRef<HTMLDivElement>(null)
  const hpTextRef = useRef<HTMLSpanElement>(null)

  // Стабильная ссылка на takeDamage для будущих источников урона (шипы и т.п.),
  // которые будут жить внутри ticker'а (см. useEffect ниже): вызывают через
  // takeDamageRef.current(amount), не импортируя функцию напрямую.
  const takeDamageRef = useRef<(amount: number) => void>(() => {})
  // Готовый вызов "нанести урон шипов" с уже посчитанной дозой (maxHp * ratio).
  // Обновляется тем же эффектом, что и takeDamageRef — так основной ticker-эффект
  // (mount-once, deps []) не должен напрямую читать maxHp из тела компонента.
  const applySpikeDamageRef = useRef<() => void>(() => {})
  // Остаток неуязвимости после касания шипов, мс. Тикает в ticker'е по
  // ticker.deltaMS (реальное время), не по dt-кадрам — 1 секунда буквально.
  const spikeIframeRef = useRef(0)

  // dirRef (см. выше) — только МГНОВЕННЫЙ ввод, сбрасывается в 0 при отпускании
  // кнопки, а не "куда смотрит игрок" — такого флага в файле раньше не было.
  // facingRef запоминает последнее ненулевое направление (по умолчанию вправо),
  // обновляется в ticker'е при движении и используется для стороны удара.
  const facingRef = useRef<1 | -1>(1)

  // Атака игрока — числа из Battle.tsx (ATTACK_RANGE/ATTACK_COOLDOWN выше).
  const attackDamage = 15 + Math.floor((strength ?? 0) / 2)
  // Готовое значение урона — держим наготове для будущего врага/сундука,
  // сам урон пока никому не применяется (только механизм хитбокса).
  const attackDamageRef = useRef(attackDamage)
  const attackPressedRef = useRef(false) // флаг тапа по ⚔, читается и сбрасывается в ticker (как jumpPressedRef)
  const attackCooldownRef = useRef(0) // остаток кулдауна, секунды — как cooldownLeft в Battle.tsx
  const attackActiveRef = useRef(false) // true на короткое окно после удара — хитбокс активен
  const attackActiveTimerRef = useRef(0) // остаток окна активности хитбокса, мс (ATTACK_ACTIVE_MS)
  // Зона удара в мировых координатах на время активности — читает будущий
  // hit-test врага/сундука. null, когда удара сейчас нет.
  const attackHitboxRef = useRef<AttackHitbox | null>(null)
  // Увеличивается на 1 при каждом НОВОМ взмахе (см. attackPressedRef ниже) —
  // враг сверяет его со своим lastHitSwingId, чтобы засчитать один взмах
  // ровно один раз, даже если хитбокс активен несколько кадров подряд.
  const attackSwingIdRef = useRef(0)
  const attackingRef = useRef(false) // true пока проигрывается анимация атаки
  const attackHitDoneRef = useRef(false) // урон этого замаха уже применён (applyAttackHit вызывается ровно один раз)
  // Facing на МОМЕНТ старта замаха — во время атаки флип не меняется, даже
  // если игрок зажал движение в другую сторону (визуально странно иначе,
  // хитбокс всё равно снят по facing на старте).
  const attackFacingRef = useRef<1 | -1>(1)

  // Питьё зелья (ТОЛЬКО визуал — см. задачу: без хила/зарядов/кулдауна, это
  // отдельный будущий шаг). drinkPressedRef — флаг тапа по 🧪/KeyH, читается
  // и сбрасывается в ticker (как attackPressedRef). drinkingRef — true, пока
  // проигрывается анимация питья: герой закоренён (движение/прыжок/атака/
  // dodge игнорируются), ветка приоритета между hurt и attack.
  const drinkPressedRef = useRef(false)
  const drinkingRef = useRef(false)
  // Игровая логика зелья (Explore офлайн — локальные заряды, НЕ currentRun).
  const potionChargesRef = useRef(3) // локальные заряды, старт 3
  const potionCdRef = useRef(0) // остаток кулдауна, секунды — тикает как attackCooldownRef
  const potionHealedThisDrinkRef = useRef(false) // хил текущего питья уже применён?
  // DOM-узел кнопки 🧪 (создаётся императивно в fan-блоке ниже, не JSX) — нужен
  // здесь, чтобы обновлять подпись "🧪 ×N"/opacity из ticker'а тем же способом,
  // каким HP-бар обновляется через hpFillRef/hpTextRef (updateHpBar).
  const potionBtnRef = useRef<HTMLButtonElement | null>(null)

  // СПИСОК врагов (Шаг 2-3): по одному enemy-событию — до 3 врагов (весь
  // кластер), может быть несколько enemy-событий за забег — значит и больше
  // 3 суммарно. Каждый обрабатывается независимо в тикере (движение,
  // преследование, windup, удар по игроку, приём урона, смерть).
  const enemiesRef = useRef<Enemy[]>([])

  // Сундуки (reward-события) — по объекту Chest на событие. hitbox считается
  // ОДИН раз при создании (см. setup), читается каждый кадр в ticker'е для
  // мягкой стены по X (та же pushPlayerOutX, что и для живых врагов) —
  // хитбокс остаётся ВСЕГДА, и закрытый, и открытый сундук.
  const chestsRef = useRef<Chest[]>([])

  // Смуглеры (NPC-события) — по объекту Smuggler на событие. НЕ стена (в
  // отличие от сундука/врага) — никакого push-out по X, сквозь него можно
  // пройти (см. задачу). Пока чисто визуальный список: idle-анимация, без
  // взаимодействия/хитбокса.
  const smugglersRef = useRef<Smuggler[]>([])

  // Плавающие попапы наград (см. RewardFloat/spawnRewardFloat) — Explore
  // офлайн, ТОЛЬКО визуал, никакого начисления player.gold/trophies здесь.
  const rewardFloatsRef = useRef<RewardFloat[]>([])

  // Обелиски (карта F, см. type Obelisk выше) — событие рулетки "3 события",
  // как сундук/смуглер (см. eventsRef.current.map в setup()). Burning-кадры
  // загружены заранее, переключаются на них по удару (см. applyAttackHit).
  const obelisksRef = useRef<Obelisk[]>([])
  const obeliskBurningFramesRef = useRef<Texture[]>([])
  // Состояние события "сбить все обелиски" (см. задачу) — рефы, не state,
  // читаются/пишутся КАЖДЫЙ кадр в ticker'е. Кандидаты и точка стартового
  // обелиска нужны для доспавна: остальные точки берутся из кандидатов
  // минус уже занятая стартовая. eventIndex — индекс в eventsRef.current,
  // нужен, чтобы closeEvent() при успехе зажёг нужное гнездо HUD.
  const obeliskEventActiveRef = useRef(false)
  const obeliskTimerRef = useRef(0)
  const obeliskStruckCountRef = useRef(0)
  const obeliskCandidatesRef = useRef<[number, number][]>([])
  const obeliskStartPointRef = useRef<[number, number] | null>(null)
  const obeliskEventIndexRef = useRef<number | null>(null)
  // eventIndex босса в chosenEvents/eventsRef.current (ФАЗА 5, см. задачу) —
  // по тому же образцу, что obeliskEventIndexRef: закрывает HUD-гнездо при
  // успехе (см. ticker — момент завершения death-анимации).
  const bossEventIndexRef = useRef<number | null>(null)
  // Последний сбитый обелиск — над ним показывается награда при успехе (см.
  // applyAttackHit / ticker ниже).
  const obeliskLastStruckRef = useRef<Obelisk | null>(null)
  // HUD (см. type ObeliskHud выше) — рисует таймер/счётчик поверх канваса,
  // обновляется из ticker'а только на изменении целого числа (см. setObeliskHud
  // ниже), не каждый кадр — иначе ре-рендер 60 раз/сек просадит fps на телефоне.
  // Прев-значения — в refs (не сравниваем со state напрямую: замыкание ticker'а
  // держит state таким, каким он был на момент создания эффекта — протухшее
  // замыкание, тот же приём, что у остальных боевых refs в файле).
  const [obeliskHud, setObeliskHud] = useState<ObeliskHud | null>(null)
  const obeliskHudSecondsRef = useRef(-1)
  const obeliskHudStruckRef = useRef(-1)

  // Босс карты C (ФАЗА 1, см. type Boss выше и задачу) — максимум ОДИН за
  // забег (не список, как enemiesRef), null пока не заспавнен/не карта C.
  const bossRef = useRef<Boss | null>(null)
  // Летящие шипы дальней атаки босса (ФАЗА 3, шаг 2, см. type BossSpike выше)
  // — независимый от bossRef список: шип, брошенный до смерти/despawn босса,
  // должен долетать и попадать сам по себе.
  const bossSpikesRef = useRef<BossSpike[]>([])
  // AoE-волны топота босса (см. type BossWave выше) — независимый от bossRef
  // список, по тому же образцу, что bossSpikesRef.
  const bossWavesRef = useRef<BossWave[]>([])
  // Dodge игрока (Шаг 2-2) — окно неуязвимости от удара врага + кулдаун кнопки.
  const dodgePressedRef = useRef(false) // флаг тапа по 🔄, читается и сбрасывается в ticker
  const dodgeIframeRef = useRef(0) // мс — пока > 0, удар врага игрока не задевает
  const dodgeCooldownRef = useRef(0) // мс — остаток кулдауна самой кнопки

  // Панель Смуглера (под-шаг): dodge рядом с живым смуглером открывает панель
  // вместо обычного dodge — пока флаг + console.log, самого окна ещё нет.
  const smugglerPanelOpenRef = useRef(false)
  // Какой именно смуглер открыл панель — нужен для позиционирования окна над
  // его головой и для проверки "игрок отошёл" в ticker'е (см. setup).
  const smugglerActiveRef = useRef<Smuggler | null>(null)
  // Ссылки на кнопки панели — пока не интерактивны (только вид, см. задачу),
  // заведены заранее для подключения кликов следующим шагом.
  const smugglerExchangeBtnRef = useRef<Container | null>(null)
  const smugglerLeaveBtnRef = useRef<Container | null>(null)

  function updateHpBar() {
    const fraction = Math.max(0, Math.min(1, hpRef.current / maxHp))
    if (hpFillRef.current) {
      // Ширина в % от контейнера фрейма (левый край окна тоже в % от него же —
      // см. JSX), а не от ширины самого окна — так left/width остаются в одной
      // системе координат и полоса не съезжает при resize.
      hpFillRef.current.style.width = `${C.HP_WINDOW_W * fraction * 100}%`
      hpFillRef.current.style.background = fraction <= 0.3 ? '#E0353B' : '#4FB477'
    }
    if (hpTextRef.current) {
      hpTextRef.current.textContent = `${hpRef.current}/${maxHp}`
    }
  }

  // Подпись кнопки 🧪 — тот же приём, что updateHpBar (DOM-ref, обновляется
  // ТОЛЬКО при реальном изменении значения — на старте и когда заряд
  // списывается на кадре глотка, не каждый кадр из ticker'а).
  function updatePotionButton() {
    const btn = potionBtnRef.current
    if (!btn) return
    btn.textContent = `🧪 ×${potionChargesRef.current}`
    btn.style.opacity = potionChargesRef.current > 0 ? '1' : '0.5'
  }

  // HP-бар врага — в мире (Pixi Graphics над его головой), а не DOM-оверлей,
  // как у игрока: враг двигается вместе с камерой, а не фиксирован на экране.
  function redrawEnemyHpBar(enemy: Enemy) {
    const pct = Math.max(0, Math.min(1, enemy.hp / enemy.maxHp))
    enemy.hpBarFill.clear()
    if (pct > 0) {
      enemy.hpBarFill.rect(0, 0, C.ENEMY_WIDTH * pct, C.ENEMY_HP_BAR_HEIGHT).fill(0xe0353b)
    }
  }

  // HP-бар босса — тот же приём, что у зверя выше (redrawEnemyHpBar), но
  // своя ширина (BOSS_HP_BAR_WIDTH, заметно шире вражеской).
  function redrawBossHpBar(boss: Boss) {
    const pct = Math.max(0, Math.min(1, boss.hp / boss.maxHp))
    boss.hpBarFill.clear()
    if (pct > 0) {
      boss.hpBarFill.rect(0, 0, C.BOSS_HP_BAR_WIDTH * pct, C.ENEMY_HP_BAR_HEIGHT).fill(0xe0353b)
    }
  }

  // Хитстан от урона: обрывает замах атаки и на HURT_MS блокирует новую атаку
  // (см. attackPressedRef-обработчик в setup). Определена на уровне компонента
  // (не внутри setup/applyAttackHit), т.к. вызывается из takeDamage ниже —
  // единой точки "игрок получил урон", которая сама объявлена здесь же, ДО
  // setup() и его замыканий, и трогает только refs (доступны отовсюду в компоненте).
  function triggerHurt() {
    hurtTimerRef.current = C.HURT_MS
    attackingRef.current = false // обрываем замах (хитстан)
    attackHitDoneRef.current = false
    drinkingRef.current = false // обрываем питьё (хитстан главнее)
    landTimerRef.current = 0 // hurt важнее land
  }

  // Запускает анимацию смерти вместо мгновенного abandon — сам abandon
  // (onClose) срабатывает позже, из блока анимации в тикере, после того как
  // death доиграла и подержался последний кадр (DEATH_HOLD_MS), см. setup().
  // deathRef не сбрасывается назад — забег в любом случае завершится.
  function triggerDeath() {
    if (deathRef.current) return // уже идёт — не перезапускаем повторно
    deathRef.current = true
    deathHoldRef.current = 0
    attackingRef.current = false
    drinkingRef.current = false // обрываем питьё (смерть главнее)
    hurtTimerRef.current = 0
    landTimerRef.current = 0
    const hero = heroSpriteRef.current
    const deathFrames = deathFramesRef.current
    if (hero && deathFrames) {
      hero.textures = deathFrames
      hero.loop = false
      hero.animationSpeed = C.DEATH_ANIM_SPEED
      hero.gotoAndPlay(0)
      hero.anchor.set(0.5, C.GROUND_ANCHOR_Y)
    }
  }

  // Единая точка "игрок получает урон" — вызывается и шипами
  // (applySpikeDamageRef), и атакой зверя (takeDamageRef в ticker'е).
  // Смерть (hp <= 0) запускает death (triggerDeath) вместо мгновенного
  // abandon — сам abandon (onClose) переехал в тикер, см. triggerDeath.
  function takeDamage(amount: number) {
    hpRef.current = Math.max(0, hpRef.current - amount)
    updateHpBar()
    if (hpRef.current <= 0) {
      triggerDeath()
    } else {
      triggerHurt()
    }
  }

  // "Свежая" ссылка на takeDamage кладётся в ref эффектом (не во время рендера),
  // чтобы будущий hazard-код внутри ticker'а всегда вызывал актуальную версию.
  useEffect(() => {
    takeDamageRef.current = takeDamage
    applySpikeDamageRef.current = () => takeDamage(maxHp * C.SPIKE_DAMAGE_RATIO)
    onRunCompleteRef.current = onRunComplete ?? (() => {})
    attackDamageRef.current = attackDamage
  })

  // Клавиатура — второй способ ввода поверх экранных кнопок (Шаг: keyboard
  // controls). Дёргает РОВНО те же refs, что и onPointerDown/Up у кнопок выше
  // (dirRef/jumpPressedRef/attackPressedRef/dodgePressedRef/drinkPressedRef) —
  // никакой отдельной логики. Скилл1/скилл2 НЕ забинжены: в Explore.tsx для
  // них пока нет ни кнопок, ни обработчиков (см. "Skills" в Next Steps).
  useEffect(() => {
    // Сравнение по e.code (физическая клавиша), НЕ по e.key (символ, зависящий
    // от раскладки) — на русской раскладке e.key для буквенных клавиш отдаёт
    // русскую букву, и case по 'j'/'k' никогда не матчился.
    function handleKeyDown(e: KeyboardEvent) {
      switch (e.code) {
        case 'ArrowLeft':
        case 'KeyA':
          dirRef.current = -1
          if (e.code === 'ArrowLeft') e.preventDefault()
          break
        case 'ArrowRight':
        case 'KeyD':
          dirRef.current = 1
          if (e.code === 'ArrowRight') e.preventDefault()
          break
        case 'ArrowUp':
        case 'Space':
          e.preventDefault()
          if (e.repeat) return
          jumpPressedRef.current = true
          break
        case 'KeyJ':
          if (e.repeat) return
          attackPressedRef.current = true
          break
        case 'KeyK':
          if (e.repeat) return
          dodgePressedRef.current = true
          break
        case 'KeyH':
          if (e.repeat) return
          // Зелье — ПОКА ТОЛЬКО визуал (анимация питья), как и экранная
          // кнопка 🧪 — хила/зарядов/кулдауна нет, это отдельный будущий шаг.
          drinkPressedRef.current = true
          break
        case 'Digit1':
          if (e.repeat) return
          // скилл1 — заглушка, как и экранная кнопка ⚡ (onclick = () => {})
          break
        case 'Digit2':
          if (e.repeat) return
          // скилл2 — заглушка, как и экранная кнопка 🔥 (onclick = () => {})
          break
      }
    }

    function handleKeyUp(e: KeyboardEvent) {
      switch (e.code) {
        case 'ArrowLeft':
        case 'KeyA':
          if (dirRef.current === -1) dirRef.current = 0
          break
        case 'ArrowRight':
        case 'KeyD':
          if (dirRef.current === 1) dirRef.current = 0
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  useEffect(() => {
    let app: Application | null = null
    let cancelled = false
    // true ТОЛЬКО после успешного await app.init() — до этого момента у
    // Application нет renderer/ticker/resize-хуков, и destroy() на нём падает
    // ("this._cancelResize is not a function"). React 19 StrictMode монтирует
    // эффект дважды в dev, так что cleanup может сработать, пока setup() ещё
    // ждёт fetch/init — без этого флага он ловил недоинициализированный app.
    let initialized = false
    let onBgResize: (() => void) | null = null

    async function setup() {
      app = new Application()
      const base = import.meta.env.BASE_URL

      const [mapText, slots] = await Promise.all([
        fetch(`${base}assets/maps/${mapFile}`).then((res) => res.text()),
        fetch(`${base}assets/maps/${slotsFileForMap(mapFile)}`).then((res) => res.json()),
      ])

      const grid: Grid = mapText.split('\n').map((line) => line.split(''))
      const decor = slots.decor ?? []

      // Шипы из слотов карты — не весь пул, а HAZARD_SPIKES_PER_RUN случайных
      // точек за забег (меньше пула — берём сколько есть). Вставляем прямо в
      // рабочую сетку, ДО renderMapToCanvas и ДО первого кадра физики:
      // коллизия и рендер читают один и тот же grid, значит '^' должен
      // попасть именно сюда, а не в отдельную структуру.
      const hazardPool: [number, number][] = Array.isArray(slots.hazard) ? slots.hazard.filter(isPointXY) : []
      const chosenHazards = pickRandom(hazardPool, C.HAZARD_SPIKES_PER_RUN)
      for (const [hx, hy] of chosenHazards) {
        if (grid[hy] && hx >= 0 && hx < grid[hy].length) {
          grid[hy][hx] = '^'
        }
      }

      // "3 события за забег" — выбираем случайно, без повторов, из общего пула
      // (enemyCluster / сундук / смуглер / загадка / босс — что есть у карты).
      // На карте A есть только enemyClusters и reward. enemy-событие несёт
      // clusterPoints (все 3 точки кластера) — враги спавнятся ниже, после
      // создания worldContainer.
      //
      // Карта D в состоянии OPEN — ИСКЛЮЧЕНИЕ: Контрабандист там ГАРАНТИРОВАН
      // (см. CLAUDE.md), а не рядовой равновероятный кандидат среди ~11 —
      // иначе он часто не попадал в тройку. Вынимаем smuggler-кандидата из
      // пула и ставим ПЕРВЫМ, остальные EVENTS_PER_RUN-1 добираем pickRandom
      // из пула БЕЗ него (не задваивается). SEALED сюда не попадает — там
      // npc.smuggler=null, buildEventCandidates и так его не кладёт в пул.
      // Карта C — босс ВЕРОЯТНОСТНЫЙ (см. задачу): бросок BOSS_SPAWN_CHANCE
      // решается ОДИН раз здесь же, той же схемой пиннинга, что у
      // Контрабандиста на карте D OPEN выше — если выпало, единственный
      // kind:'boss' кандидат вынимается из пула и ставится ПЕРВЫМ (иначе
      // среди общего пула часто не попадал бы в тройку сам по себе). Не
      // выпало — кандидат просто исключается из пула (см. poolWithoutBoss
      // ниже), чтобы pickRandom не мог случайно вытащить его САМ; bossRef/
      // bossEventIndexRef остаются null (см. spawnBoss/сброс выше) — 3
      // события добираются обычным путём без него.
      const eventPool = buildEventCandidates(slots)
      let chosenEvents: EventCandidate[]
      const smugglerIndex = mapFile.startsWith('map_D_OPEN')
        ? eventPool.findIndex((ev) => ev.kind === 'smuggler')
        : -1
      const bossIndex = eventPool.findIndex((ev) => ev.kind === 'boss')
      // bossWillSpawn читается позже (spawnBoss ниже) — держит спавн самого
      // босса и его присутствие в chosenEvents синхронными: один и тот же
      // бросок решает и то, и другое.
      const bossWillSpawn = bossIndex !== -1 && Math.random() < C.BOSS_SPAWN_CHANCE
      if (smugglerIndex !== -1) {
        const smugglerCandidate = eventPool[smugglerIndex]
        const restPool = eventPool.filter((_, i) => i !== smugglerIndex)
        chosenEvents = [smugglerCandidate, ...pickRandom(restPool, C.EVENTS_PER_RUN - 1)]
      } else if (bossWillSpawn) {
        const bossCandidate = eventPool[bossIndex]
        const restPool = eventPool.filter((_, i) => i !== bossIndex)
        chosenEvents = [bossCandidate, ...pickRandom(restPool, C.EVENTS_PER_RUN - 1)]
      } else {
        const poolWithoutBoss = bossIndex !== -1 ? eventPool.filter((_, i) => i !== bossIndex) : eventPool
        chosenEvents = pickRandom(poolWithoutBoss, C.EVENTS_PER_RUN)
      }
      setEventClosed(Array(chosenEvents.length).fill(false))
      setEventKinds(chosenEvents.map((ev) => ev.kind))

      const startRaw = slots?.start
      if (
        !Array.isArray(startRaw) ||
        typeof startRaw[0] !== 'number' ||
        typeof startRaw[1] !== 'number'
      ) {
        console.error('Explore: слот-файл карты не содержит корректный start:[x,y]', slots)
        // app ещё не инициализирован (init() ниже) — destroy() тут упал бы,
        // нечего разрушать: возвращаемся без него.
        return
      }
      const start = { x: startRaw[0], y: startRaw[1] }

      const mapCanvas = await renderMapToCanvas({ grid, decor, tileSize: C.TILE_SIZE, theme: backdropForMap(mapFile) })

      if (cancelled || !containerRef.current) {
        // Всё ещё ДО init() — по той же причине ничего не разрушаем.
        return
      }

      await app.init({
        width: window.innerWidth,
        height: window.innerHeight,
        background: 0x15131a,
        backgroundAlpha: 1,
        resizeTo: window,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
      })
      initialized = true
      appRef.current = app

      if (cancelled || !containerRef.current) {
        // Компонент размонтировался, пока ждали init() — теперь app полностью
        // инициализирован, destroy() безопасен и обязателен (иначе утечка).
        try {
          app.destroy(true, { children: true })
        } catch {
          // Гонка с cleanup-эффектом (тоже вызывает destroy) — игнорируем.
        }
        app = null
        appRef.current = null
        initialized = false
        return
      }

      containerRef.current.appendChild(app.canvas)
      app.canvas.style.touchAction = 'none'

      // Параллакс-фон (2 слоя, far/mid) — рисуется ДО worldContainer (позади
      // карты) и НЕ внутри него, иначе двигался бы 1:1 с картой без эффекта
      // глубины. Пресет фиксирован по карте (см. BACKDROP_BY_MAP выше).
      const preset = backdropForMap(mapFile)
      const { far: farUrl, mid: midUrl } = backdropPaths(preset)
      const [farTexture, midTexture] = await Promise.all([
        Assets.load(farUrl) as Promise<Texture>,
        Assets.load(midUrl) as Promise<Texture>,
      ])
      const bgFar = new TilingSprite({ texture: farTexture, width: app.screen.width, height: app.screen.height })
      const bgMid = new TilingSprite({ texture: midTexture, width: app.screen.width, height: app.screen.height })
      const farScale = app.screen.height / farTexture.height
      const midScale = app.screen.height / midTexture.height
      bgFar.tileScale.set(farScale)
      bgMid.tileScale.set(midScale)
      app.stage.addChild(bgFar)
      app.stage.addChild(bgMid)
      const bgDim = new Graphics()
      bgDim.rect(0, 0, app.screen.width, app.screen.height).fill({ color: 0x0e0c13, alpha: 0.42 })
      app.stage.addChild(bgDim)

      onBgResize = () => {
        const w = app!.screen.width, h = app!.screen.height
        bgFar.width = w; bgFar.height = h
        bgMid.width = w; bgMid.height = h
        bgFar.tileScale.set(h / farTexture.height)
        bgMid.tileScale.set(h / midTexture.height)
        bgDim.clear().rect(0, 0, w, h).fill({ color: 0x0e0c13, alpha: 0.42 })
      }
      app.renderer.on('resize', onBgResize)

      // Мир: фон-карта и игрок в одном контейнере, двигаются вместе камерой.
      const worldContainer = new Container()
      worldContainer.scale.set(C.WORLD_SCALE)
      app.stage.addChild(worldContainer)

      const mapTexture = Texture.from(mapCanvas)
      const mapSprite = new Sprite(mapTexture)
      mapSprite.x = 0
      mapSprite.y = 0
      worldContainer.addChild(mapSprite)

      const phys = physicsRef.current
      phys.x = start.x * C.TILE_SIZE
      phys.y = (start.y + 1) * C.TILE_SIZE - C.PLAYER_HEIGHT
      phys.vx = 0
      phys.vy = 0
      phys.onGround = false

      const player = new Graphics()
        .rect(0, 0, C.PLAYER_WIDTH, C.PLAYER_HEIGHT)
        .fill(C.PLAYER_COLOR)
        .stroke({ width: 2, color: 0xffffff })
      player.x = phys.x
      player.y = phys.y
      worldContainer.addChild(player)

      // Боевая уязвимая зона игрока с учётом прыжка — на земле совпадает с
      // обычным хитбоксом (PLAYER_WIDTH×PLAYER_HEIGHT), в воздухе
      // (!phys.onGround) — уменьшенный бокс по корпусу (ноги поджаты в позе
      // прыжка), центрированный по X и смещённый по Y (числа подобраны вживую
      // отладочным тюнером, см. историю). Вызывать ЗАНОВО в каждом боевом
      // месте (не кэшировать один раз на кадр/итерацию врага) — phys.x может
      // измениться в течение кадра из-за бокового упора игрок↔враг, который
      // сам читает этот же бокс.
      function getPlayerCombatBox() {
        if (phys.onGround) {
          return { x: phys.x, y: phys.y, w: C.PLAYER_WIDTH, h: C.PLAYER_HEIGHT }
        }
        const w = C.JUMP_HIT_WIDTH
        const h = C.JUMP_HIT_HEIGHT
        const x = phys.x + (C.PLAYER_WIDTH - w) / 2
        const y = phys.y + C.JUMP_HIT_OFFSET_Y
        return { x, y, w, h }
      }

      // Визуал героя — AnimatedSprite поверх хитбокса. Только idle в этом
      // шаге (run/attack/jump/hurt/death — отдельно). Кадры режутся из
      // idle.png: 12 колонок в ряд (см. loadSheetFrames), клетка 674×512 —
      // тот же размер, что задокументирован в CLAUDE.md для idle/run/attack/hurt.
      const idleFrames = await loadSheetFrames(C.HERO_IDLE_SRC, C.HERO_CELL_W, C.HERO_CELL_H, 24)
      if (cancelled) {
        // Компонент размонтировался, пока грузился спрайт-лист — не создаём
        // спрайт и не трогаем worldContainer (он в любом случае будет уничтожен
        // вместе с app при cancelled-выходе выше по функции... но сюда мы уже
        // прошли мимо тех проверок, поэтому просто не продолжаем настройку героя).
        return
      }
      const runFrames = await loadSheetFrames(C.HERO_RUN_SRC, C.HERO_CELL_W, C.HERO_CELL_H, 21)
      if (cancelled) {
        // Тот же случай, что и выше — ещё один await, ещё одна проверка.
        return
      }
      const jumpFrames = await loadSheetFrames(C.HERO_JUMP_SRC, C.HERO_CELL_W, C.HERO_CELL_H, 24)
      if (cancelled) {
        // Тот же случай, что и выше — ещё один await, ещё одна проверка.
        return
      }
      // Land — подпоследовательность кадров прыжка 18..24 (индексы 17..23),
      // один раз вырезанная при загрузке, а не при каждом приземлении.
      const landFrames = jumpFrames.slice(17, 24)
      const attackFrames = await loadSheetFrames(C.HERO_ATTACK_SRC, C.HERO_CELL_W, C.HERO_CELL_H, 14)
      if (cancelled) {
        // Тот же случай, что и выше — ещё один await, ещё одна проверка.
        return
      }
      // Питьё зелья — та же клетка/раскладка, что у idle/run/attack (379×288,
      // 12 кадров в один ряд). ТОЛЬКО визуал (см. drinkingRef выше) — хила,
      // зарядов и кулдауна здесь нет, это отдельный будущий шаг.
      const drinkFrames = await loadSheetFrames(C.HERO_DRINK_SRC, C.HERO_CELL_W, C.HERO_CELL_H, 14)
      if (cancelled) {
        // Тот же случай, что и выше — ещё один await, ещё одна проверка.
        return
      }
      const hurtFrames = await loadSheetFrames(C.HERO_HURT_SRC, C.HERO_CELL_W, C.HERO_CELL_H, 10)
      if (cancelled) {
        // Тот же случай, что и выше — ещё один await, ещё одна проверка.
        return
      }
      const deathFrames = await loadSheetFrames(C.HERO_DEATH_SRC, C.HERO_CELL_W, C.HERO_CELL_H, 18)
      if (cancelled) {
        // Тот же случай, что и выше — ещё один await, ещё одна проверка.
        return
      }

      // Кадры зверя — тот же loadSheetFrames, 12 колонок в ряд, грузятся ОДИН
      // раз (не на каждого врага кластера). Все 5 листов пересобраны в единую
      // клетку 600×288 с одинаковой посадкой — cellW/cellH теперь одни и те
      // же для всех анимаций (раньше у attack/walk/death была своя ширина).
      const beastIdleFrames = await loadSheetFrames(C.BEAST_IDLE_SRC, 600, 288, 24)
      if (cancelled) return
      const beastWalkFrames = await loadSheetFrames(C.BEAST_WALK_SRC, 600, 288, 16)
      if (cancelled) return
      const beastAttackFrames = await loadSheetFrames(C.BEAST_ATTACK_SRC, 600, 288, 24)
      if (cancelled) return
      const beastHurtFrames = await loadSheetFrames(C.BEAST_HURT_SRC, 600, 288, 12)
      if (cancelled) return
      const beastDeathFrames = await loadSheetFrames(C.BEAST_DEATH_SRC, 600, 288, 18)
      if (cancelled) return
      beastFramesRef.current = {
        idle: beastIdleFrames,
        walk: beastWalkFrames,
        attack: beastAttackFrames,
        hurt: beastHurtFrames,
        death: beastDeathFrames,
      }

      // Сундук — тот же loadSheetFrames, что и герой/зверь. Лист ОДНОРЯДНЫЙ
      // (1820×178px = 13 колонок × 1 ряд, проверено по IHDR) — cols=13
      // ОБЯЗАТЕЛЕН, дефолтный cols=12 резал 13-й кадр (индекс 12, открытый
      // сундук) как "второй ряд", т.е. область за пределами картинки —
      // отсюда пустая текстура и "исчезающий" сундук после открытия.
      const chestFrames = await loadSheetFrames(C.CHEST_OPEN_SRC, 140, 178, 13, 13)
      if (cancelled) return

      // Мимик — тот же loadSheetFrames, 14 колонок в ряд (см. задачу).
      const chestTrapFrames = await loadSheetFrames(C.CHEST_TRAP_SRC, 190, 137, 14, 14)
      if (cancelled) return

      // Смуглер (idle) — лист 230×296, 14 кадров, 14 колонок в ряд. cols=14
      // ОБЯЗАТЕЛЕН (дефолт loadSheetFrames — 12) — та же грабля, что у
      // сундука: без явного cols последние кадры режутся как несуществующий
      // второй ряд, пустая текстура, "исчезающий" персонаж.
      const smugglerFrames = await loadSheetFrames(C.SMUGGLER_SRC, 230, 296, 14, 14)
      if (cancelled) return

      // Обелиск (карта F) — лист 190×512, 10 кадров, 10 колонок в ряд. cols=10
      // ОБЯЗАТЕЛЕН (дефолт loadSheetFrames — 12) — та же грабля, что у
      // сундука/смуглера: без явного cols последние кадры режутся как
      // несуществующий второй ряд. Burning загружен и сохранён в ref — в
      // этом шаге не используется (следующий шаг).
      const obeliskIdleFrames = await loadSheetFrames(C.OBELISK_IDLE_SRC, C.OBELISK_FRAME_W, C.OBELISK_FRAME_H, C.OBELISK_IDLE_COUNT, 10)
      if (cancelled) return
      obeliskBurningFramesRef.current = await loadSheetFrames(C.OBELISK_BURNING_SRC, C.OBELISK_FRAME_W, C.OBELISK_FRAME_H, C.OBELISK_BURNING_COUNT, 10)
      if (cancelled) return

      // Босс (карта C) — Idle, лист 188×287, 24 кадра, 12 колонок в ряд.
      const bossIdleRaw = await loadSheetFrames(C.BOSS_IDLE_SRC, C.BOSS_IDLE_CELL_W, C.BOSS_IDLE_CELL_H, C.BOSS_IDLE_COUNT, C.BOSS_IDLE_COLS)
      if (cancelled) return
      // Пинг-понг: встык (кадр 23 -> кадр 0) цикл дыхания не сходится, шов
      // виден — 0..23 достраивается кадрами 22..1 в обратном порядке.
      const bossIdleFrames = [...bossIdleRaw, ...bossIdleRaw.slice(1, -1).reverse()]

      // Босс (карта C, ФАЗА 2 шаг 1, см. задачу) — остальные листы, ТОЛЬКО
      // загрузка (см. playBossAnim ниже — переключатель, без AI/боя/урона).
      // Stomp не грузится (нужен только для AoE — фаза 4, см. закомментированные
      // константы выше). Высота клетки СВОЯ у каждого листа (общей BOSS_CELL_H
      // больше нет) — cols указан ЯВНО у всех, у Melee2 — 6, не дефолтные 12.
      const bossWalkFrames = await loadSheetFrames(C.BOSS_WALK_SRC, C.BOSS_WALK_CELL_W, C.BOSS_WALK_CELL_H, C.BOSS_WALK_COUNT, C.BOSS_WALK_COLS)
      if (cancelled) return
      const bossMeleeFrames = await loadSheetFrames(C.BOSS_MELEE_SRC, C.BOSS_MELEE_CELL_W, C.BOSS_MELEE_CELL_H, C.BOSS_MELEE_COUNT, C.BOSS_MELEE_COLS)
      if (cancelled) return
      const bossMelee2Frames = await loadSheetFrames(C.BOSS_MELEE2_SRC, C.BOSS_MELEE2_CELL_W, C.BOSS_MELEE2_CELL_H, C.BOSS_MELEE2_COUNT, C.BOSS_MELEE2_COLS)
      if (cancelled) return
      const bossHurtFrames = await loadSheetFrames(C.BOSS_HURT_SRC, C.BOSS_HURT_CELL_W, C.BOSS_HURT_CELL_H, C.BOSS_HURT_COUNT, C.BOSS_HURT_COLS)
      if (cancelled) return
      const bossDeathFrames = await loadSheetFrames(C.BOSS_DEATH_SRC, C.BOSS_DEATH_CELL_W, C.BOSS_DEATH_CELL_H, C.BOSS_DEATH_COUNT, C.BOSS_DEATH_COLS)
      if (cancelled) return
      // Ranged (ФАЗА 3, шаг 1, см. задачу) — cols=12 указан ЯВНО (лист НЕ
      // приведён к общему масштабу, см. константы выше — это отдельно
      // компенсируется в applyBossLayout, cols тут ни при чём).
      const bossRangedFrames = await loadSheetFrames(C.BOSS_RANGED_SRC, C.BOSS_RANGED_CELL_W, C.BOSS_RANGED_CELL_H, C.BOSS_RANGED_COUNT, C.BOSS_RANGED_COLS)
      if (cancelled) return
      // Stomp (ФАЗА 4, шаг 1, см. задачу) — cols=12 указан ЯВНО (лист 12×2,
      // НЕ дефолтные 12×N вподряд по одной строке).
      const bossStompFrames = await loadSheetFrames(C.BOSS_STOMP_SRC, C.BOSS_STOMP_CELL_W, C.BOSS_STOMP_CELL_H, C.BOSS_STOMP_COUNT, C.BOSS_STOMP_COLS)
      if (cancelled) return

      // Шип дальней атаки + импакт (ФАЗА 3, шаг 2, см. задачу) — в try/catch:
      // при ошибке загрузки не рушим setup(), снаряд/импакт просто не
      // создаются (см. spawnBossSpike/spawnBossSpikeImpact ниже), остальная
      // игра работает.
      let bossSpikeTexture: Texture | null = null
      try {
        bossSpikeTexture = await Assets.load(C.BOSS_SPIKE_SRC)
      } catch (err) {
        console.error('Explore: не удалось загрузить Boss_Spike.png', err)
      }
      if (cancelled) return
      let bossSpikeImpactFrames: Texture[] = []
      try {
        bossSpikeImpactFrames = await loadSheetFrames(C.BOSS_SPIKE_IMPACT_SRC, C.BOSS_SPIKE_IMPACT_CELL_W, C.BOSS_SPIKE_IMPACT_CELL_H, C.BOSS_SPIKE_IMPACT_COUNT, C.BOSS_SPIKE_IMPACT_COLS)
      } catch (err) {
        console.error('Explore: не удалось загрузить Boss_Spike_Impact.png', err)
      }
      if (cancelled) return

      // AoE-волна топота (см. задачу) — в try/catch, тем же приёмом, что шип/
      // импакт выше: при ошибке загрузки топот просто не создаёт волн, урона
      // не будет, остальная игра не ломается. НЕ через loadSheetFrames — в
      // клетке нарисованы ОБЕ дуги сразу (левая+правая), режем каждую клетку
      // вручную пополам по BOSS_WAVE_SPLIT_X (см. константы выше), тем же
      // приёмом (Texture + frame Rectangle внутри общего source), что и
      // loadSheetFrames — получаем ДВА набора по BOSS_WAVE_COUNT кадров.
      const bossWaveLeftFrames: Texture[] = []
      const bossWaveRightFrames: Texture[] = []
      try {
        const bossWaveBase = await Assets.load(C.BOSS_WAVE_SRC)
        bossWaveBase.source.scaleMode = 'linear'
        for (let i = 0; i < C.BOSS_WAVE_COUNT; i++) {
          const col = i % C.BOSS_WAVE_COLS
          const row = Math.floor(i / C.BOSS_WAVE_COLS)
          const cellX = col * C.BOSS_WAVE_CELL_W
          const cellY = row * C.BOSS_WAVE_CELL_H
          bossWaveLeftFrames.push(new Texture({
            source: bossWaveBase.source,
            frame: new Rectangle(cellX, cellY, C.BOSS_WAVE_SPLIT_X, C.BOSS_WAVE_CELL_H),
          }))
          bossWaveRightFrames.push(new Texture({
            source: bossWaveBase.source,
            frame: new Rectangle(cellX + C.BOSS_WAVE_SPLIT_X, cellY, C.BOSS_WAVE_CELL_W - C.BOSS_WAVE_SPLIT_X, C.BOSS_WAVE_CELL_H),
          }))
        }
      } catch (err) {
        console.error('Explore: не удалось загрузить Boss_Wave.png', err)
      }
      if (cancelled) return

      // Карта листов по BossAnimKind — используется ТОЛЬКО playBossAnim ниже.
      const bossFramesByKind: Record<BossAnimKind, Texture[]> = {
        idle: bossIdleFrames,
        walk: bossWalkFrames,
        melee: bossMeleeFrames,
        melee2: bossMelee2Frames,
        hurt: bossHurtFrames,
        death: bossDeathFrames,
        ranged: bossRangedFrames,
        stomp: bossStompFrames,
      }

      // Переключатель анимаций босса (см. задачу) — по образцу playSpriteAnim
      // выше, но ДОПОЛНИТЕЛЬНО ставит anchor.x И anchor.y из BOSS_ANCHOR_X/
      // BOSS_ANCHOR_Y (тело стоит в клетке по-разному на каждом листе, см.
      // константы выше). Оба якоря меняются ТОЛЬКО здесь, при смене листа —
      // внутри одной анимации не трогаются. x/y/scale НЕ трогаются (см.
      // applyBossLayout — отдельно). Действует на ЕДИНСТВЕННОГО текущего
      // босса (bossRef.current) — на этом шаге за забег может быть максимум
      // один (карта C).
      function playBossAnim(kind: BossAnimKind) {
        const boss = bossRef.current
        if (!boss) return
        // Уже эта анимация — не рестартить (см. задачу шаг 3: hurt/idle
        // читаются из ticker'а КАЖДЫЙ тик, без гейта это отматывало бы
        // анимацию на кадр 0 каждый тик, как playSpriteAnim у зверя выше).
        if (boss.sprite.textures === bossFramesByKind[kind]) return
        boss.sprite.textures = bossFramesByKind[kind]
        boss.sprite.anchor.set(C.BOSS_ANCHOR_X[kind], C.BOSS_ANCHOR_Y[kind])
        boss.sprite.loop = C.BOSS_ANIM_LOOP[kind]
        boss.sprite.animationSpeed = C.BOSS_ANIM_SPEED[kind]
        boss.sprite.gotoAndPlay(0)
      }

      // Иконки наград (см. spawnRewardFloat ниже) — обычные PNG, не спрайт-
      // лист, поэтому просто Assets.load без loadSheetFrames.
      const goldIconTexture = await Assets.load(C.REWARD_ICON_SRC.gold)
      if (cancelled) return
      const trophyIconTexture = await Assets.load(C.REWARD_ICON_SRC.trophy)
      if (cancelled) return
      const rpIconTexture = await Assets.load(C.REWARD_ICON_SRC.rp)
      if (cancelled) return
      const rewardIconTextures: Record<RewardKind, Texture> = {
        gold: goldIconTexture,
        trophy: trophyIconTexture,
        rp: rpIconTexture,
      }

      // Плавающий попап награды над объектом в МИРОВОМ контейнере (двигается
      // с камерой вместе с картой/спрайтами объектов) — Explore офлайн, эта
      // функция НИКОГДА не начисляет player.gold/trophies/crystals, только
      // визуал. Несколько наград — столбик вверх от (worldX, worldY), каждая
      // следующая на REWARD_ROW_GAP выше. Обновление/удаление — см. блок
      // "Плавающие попапы наград" в ticker'е ниже.
      function spawnRewardFloat(
        worldX: number,
        worldY: number,
        rewards: { kind: RewardKind; amount: number; negative?: boolean }[]
      ) {
        rewards.forEach((reward, i) => {
          const label = new Text({
            text: `${reward.negative ? '−' : '+'}${reward.amount}`,
            style: {
              fontSize: 20,
              fontWeight: 'bold',
              fill: reward.negative ? 0xe0353b : C.REWARD_TEXT_COLOR[reward.kind],
              stroke: { color: 0x000000, width: 4 },
            },
          })
          label.anchor.set(0, 0.5)
          label.x = 0

          const icon = new Sprite(rewardIconTextures[reward.kind])
          icon.anchor.set(0, 0.5)
          icon.scale.set(C.REWARD_ICON_H / icon.texture.height)
          icon.x = label.width + 4

          // Центрируем весь ряд (текст+иконка) относительно worldX — текст
          // и иконка строились от x=0 слева, теперь сдвигаем оба на -половину
          // итоговой ширины ряда.
          const rowWidth = icon.x + icon.width
          label.x -= rowWidth / 2
          icon.x -= rowWidth / 2

          const node = new Container()
          node.x = worldX
          node.y = worldY - i * C.REWARD_ROW_GAP
          node.alpha = 0
          node.addChild(label, icon)
          worldContainer.addChild(node)

          rewardFloatsRef.current.push({ node, elapsed: 0, startY: node.y })
        })
      }

      const hero = new AnimatedSprite(idleFrames)
      hero.anchor.set(0.5, 1.0) // якорь — низ по центру (ноги)
      hero.scale.set(C.HERO_DRAW_H / idleFrames[0].height) // равномерный масштаб по реальной высоте кадра
      hero.roundPixels = false // не защёлкивать позицию на целые пиксели — иначе дрожит при движении камеры
      hero.animationSpeed = 0.15
      hero.play()
      worldContainer.addChild(hero)
      heroSpriteRef.current = hero
      // deathFrames зеркалим в ref — triggerDeath() вызывается из takeDamage,
      // вне setup(), достать локальную deathFrames оттуда напрямую нельзя.
      deathFramesRef.current = deathFrames
      // Прямоугольник остаётся хитбоксом для коллизии — просто прячем визуал.
      player.visible = false

      // Переключает анимацию героя, НЕ пересоздавая спрайт. hero.textures ===
      // frames (тот же массив Texture, что вернул loadSheetFrames) — уже
      // сравнение "текущая анимация уже эта", отдельный ref не нужен.
      function playAnim(frames: Texture[], speed: number, loop: boolean) {
        if (hero.textures === frames) return
        hero.textures = frames
        hero.loop = loop
        hero.animationSpeed = speed
        hero.gotoAndPlay(0)
      }

      // Обобщённый вариант playAnim — принимает целевой AnimatedSprite первым
      // аргументом, чтобы враги (у каждого свой спрайт) могли переключать
      // анимацию тем же способом, что и герой выше. Герой playAnim() не
      // трогаем — оба существуют параллельно.
      function playSpriteAnim(sprite: AnimatedSprite, frames: Texture[], speed: number, loop: boolean) {
        if (sprite.textures === frames) {
          // Тот же набор кадров (напр. walk и в патруле, и в погоне) — не
          // рестартить анимацию, но скорость обязана следовать за aggroed
          // на лету, иначе застревает на значении последней СМЕНЫ кадров
          // (idle→walk/hurt→walk), а не текущего состояния (см. баг).
          if (sprite.animationSpeed !== speed) sprite.animationSpeed = speed
          return
        }
        sprite.textures = frames
        sprite.loop = loop
        sprite.animationSpeed = speed
        sprite.gotoAndPlay(0)
      }

      // Спавнит ОДНОГО врага-прямоугольник (см. Шаг 2-1/2-2) в тайловых
      // координатах (tileX,tileY), привязанного к enemy-событию eventIndex
      // (для декремента remainingEnemies при смерти). Ставит ногами на пол
      // клетки, как игрока.
      function spawnEnemy(tileX: number, tileY: number, eventIndex: number, trophyReward: number): Enemy {
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
        worldContainer.addChild(rect)

        // Визуал — AnimatedSprite поверх (невидимого) хитбокса, по образцу
        // героя: своя копия AnimatedSprite на каждого врага кластера, но все
        // используют ОДНИ И ТЕ ЖЕ Texture-массивы из beastFramesRef (загружены
        // один раз в setup()). Пока всегда idle — переключение по AI-состоянию
        // и флип по направлению будут отдельным шагом.
        const beastFrames = beastFramesRef.current!
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
        worldContainer.addChild(sprite)

        const hpBarBg = new Graphics().rect(0, 0, C.ENEMY_WIDTH, C.ENEMY_HP_BAR_HEIGHT).fill(0x221e2b)
        hpBarBg.x = enemyWorldX
        hpBarBg.y = enemyWorldY - C.ENEMY_HPBAR_OFFSET_Y - C.ENEMY_HP_BAR_MARGIN - C.ENEMY_HP_BAR_HEIGHT
        worldContainer.addChild(hpBarBg)

        const hpBarFill = new Graphics()
        hpBarFill.x = enemyWorldX
        hpBarFill.y = hpBarBg.y
        worldContainer.addChild(hpBarFill)

        const enemy: Enemy = {
          x: enemyWorldX,
          y: enemyWorldY,
          vy: 0,
          hp: C.ENEMY_MAX_HP,
          maxHp: C.ENEMY_MAX_HP,
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
          dead: false,
          deathHoldTimer: 0,
          trophyReward,
          hpBarBg,
          hpBarFill,
        }
        redrawEnemyHpBar(enemy)
        return enemy
      }

      // "3 события за забег": enemy-событие спавнит ВЕСЬ кластер (все точки
      // clusterPoints, не только points[0]) реальными врагами вместо метки —
      // засчитывается убийством всех, не касанием (см. touch-цикл в ticker'е,
      // который теперь явно пропускает kind==='enemy'). Остальные типы
      // (сундук и т.д.) — по-прежнему временная метка-заглушка + касание.
      const spawnedEnemies: Enemy[] = []
      chestsRef.current = [] // сброс на случай повторного запуска setup()
      smugglersRef.current = [] // сброс на случай повторного запуска setup()

      // Обелиски (карта F) — сброс состояния события ПЕРЕД спавном: стартовый
      // обелиск создаётся НИЖЕ, внутри map-цикла событий, только если kind
      // 'obelisk' попал в chosenEvents (см. buildEventCandidates — один
      // кандидат на всё событие). obeliskCandidatesRef хранит ВЕСЬ пул точек
      // карты (не только выбранную стартовую) — нужен для доспавна остальных
      // трёх после первого удара (см. applyAttackHit).
      obelisksRef.current = []
      obeliskEventActiveRef.current = false
      obeliskTimerRef.current = 0
      obeliskStruckCountRef.current = 0
      obeliskLastStruckRef.current = null
      obeliskStartPointRef.current = null
      obeliskEventIndexRef.current = null
      bossEventIndexRef.current = null
      obeliskHudSecondsRef.current = -1
      obeliskHudStruckRef.current = -1
      setObeliskHud(null)
      const obeliskSlotForCandidates = (slots as { obelisk?: { points?: unknown } } | null)?.obelisk
      obeliskCandidatesRef.current = Array.isArray(obeliskSlotForCandidates?.points)
        ? (obeliskSlotForCandidates.points as unknown[]).filter(isPointXY)
        : []

      // Спавнит один обелиск (Idle) в тайловых координатах — общая функция
      // для стартового обелиска (ниже, в map-цикле) и доспавна остальных трёх
      // (см. applyAttackHit), чтобы посадка (floorY/hitbox/anchor) не могла
      // разъехаться между вызовами.
      function spawnObelisk(tileX: number, tileY: number): Obelisk {
        const drawW = C.OBELISK_DRAW_H * (C.OBELISK_FRAME_W / C.OBELISK_FRAME_H)
        const centerX = tileX * C.TILE_SIZE + C.TILE_SIZE / 2
        const left = centerX - drawW / 2
        const footGuess = (tileY + 1) * C.TILE_SIZE
        const floorY = findGroundSurfaceY(left, drawW, footGuess) ?? footGuess
        const sprite = new AnimatedSprite(obeliskIdleFrames)
        sprite.anchor.set(0.5, 1.0)
        sprite.height = C.OBELISK_DRAW_H
        sprite.width = drawW
        sprite.x = centerX
        sprite.y = floorY + C.OBELISK_OFFSET_Y
        sprite.loop = true
        sprite.animationSpeed = C.OBELISK_ANIM_SPEED
        sprite.play()
        worldContainer.addChild(sprite)

        const obelisk: Obelisk = {
          sprite,
          hitbox: {
            x: centerX - C.OBELISK_HITBOX_W / 2,
            y: floorY - C.OBELISK_DRAW_H,
            width: C.OBELISK_HITBOX_W,
            height: C.OBELISK_DRAW_H,
          },
          floorY,
          tileX,
          tileY,
          burning: false,
          struck: false,
        }
        obelisksRef.current.push(obelisk)
        return obelisk
      }

      // Босс карты C (см. type Boss/задачу выше) — применяет BOSS_DRAW_H
      // (визуальный масштаб) поверх хитбокса (BOSS_WIDTH/BOSS_HEIGHT) КАЖДЫЙ
      // тик — вызывается сразу после спавна И из ticker'а, как
      // applyChestLayout у сундука. Заодно синкает HP-бар (та же причина,
      // что у enemy.hpBarBg/hpBarFill в основном цикле врагов — позиция
      // должна следовать за boss.y, который меняется гравитацией).
      function applyBossLayout(boss: Boss) {
        // Ranged — лист НЕ приведён к общему масштабу, в отличие от
        // остальных. Определяем "сейчас активен ranged" сравнением textures
        // (тот же приём, что playBossAnim использует для гейта "уже эта
        // анимация"), а не отдельным полем — и ТОЛЬКО в этом случае
        // домножаем scale на BOSS_SCALE_FIX_RANGED и подменяем якорь на
        // BOSS_ANCHOR_X_RANGED/BOSS_ANCHOR_Y_RANGED (числа подобраны живым
        // тюнером, тюнер убран — см. историю выше). Остальные анимации этот
        // блок не трогает.
        const isRanged = boss.sprite.textures === bossFramesByKind.ranged
        const scale = (C.BOSS_DRAW_H / bossIdleFrames[0].height) * (isRanged ? C.BOSS_SCALE_FIX_RANGED : 1)
        // Арт смотрит ВЛЕВО по умолчанию (facing===-1, без зеркала) — как
        // зверь. Флип по facing===1 — не в этой фазе (AI ещё нет, см. задачу).
        boss.sprite.scale.set(scale)
        if (isRanged) {
          boss.sprite.anchor.set(C.BOSS_ANCHOR_X_RANGED, C.BOSS_ANCHOR_Y_RANGED)
        }

        // Спрайт синкается от хитбокса (boss.x/y), НЕ наоборот — центр по X,
        // Y — реальная поверхность пола под ногами (findGroundSurfaceY), а не
        // низ хитбокса (тот же приём, что у enemy.sprite, см. Explore.tsx
        // enemy-цикл выше: "Y отрисовки — поверхность тайла под ногами").
        const bossFootBottom = boss.y + C.BOSS_HEIGHT
        const bossSurfaceY = findGroundSurfaceY(boss.x, C.BOSS_WIDTH, bossFootBottom)
        boss.sprite.x = boss.x + C.BOSS_WIDTH / 2
        boss.sprite.y = (bossSurfaceY ?? bossFootBottom) + C.FOOT_TUNE + C.BOSS_OFFSET_Y

        boss.hpBarBg.x = boss.x + (C.BOSS_WIDTH - C.BOSS_HP_BAR_WIDTH) / 2
        boss.hpBarBg.y = boss.y - C.BOSS_HPBAR_OFFSET_Y - C.ENEMY_HP_BAR_MARGIN - C.ENEMY_HP_BAR_HEIGHT
        boss.hpBarFill.x = boss.hpBarBg.x
        boss.hpBarFill.y = boss.hpBarBg.y
      }

      function spawnBoss(tileX: number, tileY: number): Boss {
        const centerX = tileX * C.TILE_SIZE + C.TILE_SIZE / 2
        const bossWorldX = centerX - C.BOSS_WIDTH / 2
        // Тем же путём, что у врага (spawnEnemy) — БЕЗ предварительного поиска
        // пола: гравитация/sweepFootBlock в ticker'е сами доведут босса до
        // ближайшей тверди за первые кадры (см. задачу, п.3).
        const bossWorldY = (tileY + 1) * C.TILE_SIZE - C.BOSS_HEIGHT

        const sprite = new AnimatedSprite(bossIdleFrames)
        // Начальная поза — idle, те же таблицы (BOSS_ANCHOR_X/BOSS_ANCHOR_Y/
        // BOSS_ANIM_LOOP/BOSS_ANIM_SPEED), что и playBossAnim ниже —
        // bossRef.current ещё не присвоен на этом шаге (boss создаётся ниже),
        // playBossAnim('idle') здесь был бы no-op, поэтому та же логика
        // продублирована вручную.
        sprite.anchor.set(C.BOSS_ANCHOR_X.idle, C.BOSS_ANCHOR_Y.idle)
        sprite.loop = C.BOSS_ANIM_LOOP.idle
        sprite.animationSpeed = C.BOSS_ANIM_SPEED.idle
        sprite.play()
        worldContainer.addChild(sprite)

        // HP-бар — по образцу spawnEnemy, но центрирован над хитбоксом (бар
        // заметно ШИРЕ хитбокса — BOSS_HP_BAR_WIDTH против узкого BOSS_WIDTH).
        const hpBarBg = new Graphics().rect(0, 0, C.BOSS_HP_BAR_WIDTH, C.ENEMY_HP_BAR_HEIGHT).fill(0x221e2b)
        hpBarBg.x = bossWorldX + (C.BOSS_WIDTH - C.BOSS_HP_BAR_WIDTH) / 2
        hpBarBg.y = bossWorldY - C.BOSS_HPBAR_OFFSET_Y - C.ENEMY_HP_BAR_MARGIN - C.ENEMY_HP_BAR_HEIGHT
        worldContainer.addChild(hpBarBg)

        const hpBarFill = new Graphics()
        hpBarFill.x = hpBarBg.x
        hpBarFill.y = hpBarBg.y
        worldContainer.addChild(hpBarFill)

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
        applyBossLayout(boss)
        redrawBossHpBar(boss)
        return boss
      }

      // Шип дальней атаки (ФАЗА 3, шаг 2, см. задачу) — создаётся на кадре
      // выпуска ranged-анимации (см. ticker). Если текстура не загрузилась
      // (bossSpikeTexture===null, см. try/catch выше) — просто не создаёт
      // спрайт, снаряда/урона не будет, остальная игра не ломается.
      function spawnBossSpike(boss: Boss) {
        if (!bossSpikeTexture) return
        const dir = boss.facing
        const sprite = new Sprite(bossSpikeTexture)
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
        const pb = getPlayerCombatBox()
        const targetX = pb.x + pb.w / 2
        const targetY = pb.y + pb.h / 2
        const dx = targetX - spawnX
        const dy = targetY - spawnY
        const t = Math.abs(dx) / C.BOSS_SPIKE_SPEED_X
        const vy = t > 0.01 ? (dy - 0.5 * C.BOSS_SPIKE_GRAVITY * t * t) / t : 0

        worldContainer.addChild(sprite)
        bossSpikesRef.current.push({ sprite, dir, vy, lifeMs: 0, hitApplied: false })
      }

      // Импакт шипа (ФАЗА 3, шаг 2, см. задачу) — разовая анимация на месте
      // попадания, сама себя удаляет по onComplete. Если лист не загрузился
      // (bossSpikeImpactFrames.length===0, см. try/catch выше) — просто не
      // создаёт спрайт, урон уже применён отдельно (см. ticker).
      function spawnBossSpikeImpact(worldX: number, worldY: number) {
        if (bossSpikeImpactFrames.length === 0) return
        const impact = new AnimatedSprite(bossSpikeImpactFrames)
        impact.anchor.set(0.5, 0.5)
        impact.loop = false
        impact.animationSpeed = C.BOSS_SPIKE_IMPACT_ANIM_SPEED
        impact.height = C.BOSS_SPIKE_IMPACT_DRAW_H
        impact.width = C.BOSS_SPIKE_IMPACT_DRAW_H * (C.BOSS_SPIKE_IMPACT_CELL_W / C.BOSS_SPIKE_IMPACT_CELL_H)
        impact.x = worldX
        impact.y = worldY
        impact.onComplete = () => {
          worldContainer.removeChild(impact)
          impact.destroy()
        }
        worldContainer.addChild(impact)
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
        const frames = dir === -1 ? bossWaveLeftFrames : bossWaveRightFrames
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
        worldContainer.addChild(sprite)
        bossWavesRef.current.push({ sprite, dir, lifeMs: 0, hitApplied: false })
      }

      eventsRef.current = chosenEvents.map((ev, eventIndex) => {
        if (ev.kind === 'enemy') {
          const points = ev.clusterPoints ?? []
          if (points.length === 0) {
            console.error('Explore: enemy-событие без валидных точек кластера — нечего убивать', ev)
            return { ...ev, closed: true, remainingEnemies: 0 }
          }
          // Трофеи кластера разыгрываются ОДИН РАЗ на весь кластер (не на
          // каждого врага отдельно — иначе random дал бы разные числа и
          // сумма по группе поплыла бы). Каждому, кроме последнего, — ровная
          // доля (Math.floor); последний добирает остаток, чтобы сумма долей
          // всегда точно равнялась total.
          const trophyTotal = rollTrophies(C.TROPHY_MULT_ENEMY)
          const trophyShare = Math.floor(trophyTotal / points.length)
          points.forEach(([ex, ey], i) => {
            const trophyReward = i === points.length - 1 ? trophyTotal - trophyShare * (points.length - 1) : trophyShare
            spawnedEnemies.push(spawnEnemy(ex, ey, eventIndex, trophyReward))
          })
          return { ...ev, closed: false, remainingEnemies: points.length }
        }

        const marker = new Graphics()
          .circle(0, 0, C.TILE_SIZE * 0.35)
          .fill({ color: C.EVENT_MARKER_COLOR[ev.kind], alpha: 0.85 })
          .stroke({ width: 3, color: 0xffffff })
        marker.x = ev.x * C.TILE_SIZE + C.TILE_SIZE / 2
        marker.y = ev.y * C.TILE_SIZE + C.TILE_SIZE / 2
        worldContainer.addChild(marker)

        // Реальный спрайт сундука ПОВЕРХ маркера (маркер остаётся зоной
        // толчка/хитбоксом визуально скрытым — сам touch-цикл ниже событие
        // 'chest' больше НЕ закрывает, см. там же). AnimatedSprite на
        // chestFrames, но НЕ играет — открытие запускается ударом игрока,
        // см. applyAttackHit ниже.
        if (ev.kind === 'chest') {
          marker.visible = false // визуал теперь несёт спрайт, не кружок
          const chestDrawW = C.CHEST_DRAW_H * (140 / 178)
          const chestCenterX = ev.x * C.TILE_SIZE + C.TILE_SIZE / 2
          const chestLeft = chestCenterX - chestDrawW / 2
          const chestFootGuess = (ev.y + 1) * C.TILE_SIZE
          const floorY = findGroundSurfaceY(chestLeft, chestDrawW, chestFootGuess) ?? chestFootGuess
          const chestSprite = new AnimatedSprite(chestFrames)
          chestSprite.x = chestCenterX
          chestSprite.loop = false
          worldContainer.addChild(chestSprite)

          const chest: Chest = {
            sprite: chestSprite,
            // Твёрдое тело — низ на той же линии, что и спрайт, центр по X
            // тот же, ширина — CHEST_WALL_W (НЕ зависит от ширины спрайта,
            // которая меняется между добрым/мимик набором). Остаётся ВСЕГДА,
            // и закрытый, и открытый сундук — не убирается при открытии.
            hitbox: {
              x: chestCenterX - C.CHEST_WALL_W / 2,
              y: floorY + C.CHEST_OFFSET_Y - C.CHEST_DRAW_H,
              width: C.CHEST_WALL_W,
              height: C.CHEST_DRAW_H,
            },
            opening: false,
            opened: false,
            trapDamaged: false,
            eventIndex,
            floorY,
          }
          applyChestLayout(chest)
          chestSprite.gotoAndStop(0) // закрыт, не играет — до удара
          chestsRef.current.push(chest)
        }

        // Смуглер — ТОЛЬКО визуал (idle, дышит), без взаимодействия, без
        // хитбокса-стены (в отличие от сундука сквозь него можно пройти —
        // см. задачу: никакого pushPlayerOutX для смуглера). Посадка —
        // по образцу сундука: floorY найден один раз здесь же и сразу
        // применён к sprite.y, дальше не пересчитывается.
        if (ev.kind === 'smuggler') {
          marker.visible = false // визуал теперь несёт спрайт, не кружок
          const smugglerDrawW = C.SMUGGLER_DRAW_H * (230 / 296)
          const smugglerCenterX = ev.x * C.TILE_SIZE + C.TILE_SIZE / 2
          const smugglerLeft = smugglerCenterX - smugglerDrawW / 2
          const smugglerFootGuess = (ev.y + 1) * C.TILE_SIZE
          const floorY = findGroundSurfaceY(smugglerLeft, smugglerDrawW, smugglerFootGuess) ?? smugglerFootGuess
          const smugglerSprite = new AnimatedSprite(smugglerFrames)
          smugglerSprite.anchor.set(0.5, 1.0)
          smugglerSprite.height = C.SMUGGLER_DRAW_H
          smugglerSprite.width = smugglerDrawW
          smugglerSprite.x = smugglerCenterX
          smugglerSprite.y = floorY + C.SMUGGLER_OFFSET_Y
          smugglerSprite.loop = true
          smugglerSprite.animationSpeed = C.SMUGGLER_ANIM_SPEED
          smugglerSprite.play()
          worldContainer.addChild(smugglerSprite)

          smugglersRef.current.push({ sprite: smugglerSprite, floorY, eventIndex, facing: 1 })
        }

        // Обелиск — стартовая точка уже выбрана в buildEventCandidates (ev.x/
        // ev.y), здесь только спавн через общую spawnObelisk (та же посадка,
        // что и у доспавненных после первого удара, см. applyAttackHit).
        // eventIndex запоминаем — им закрывается HUD-гнездо при успехе.
        if (ev.kind === 'obelisk') {
          marker.visible = false // визуал несёт спрайт обелиска, не кружок
          obeliskStartPointRef.current = [ev.x, ev.y]
          obeliskEventIndexRef.current = eventIndex
          spawnObelisk(ev.x, ev.y)
        }

        // Босс — визуал несёт отдельный спрайт (см. spawnBoss ниже, точка
        // та же slots.boss, что и здесь ev.x/ev.y), сам спавн НЕ трогаем —
        // здесь только запоминаем eventIndex, им закрывается HUD-гнездо и
        // выдаётся награда при завершении death-анимации (см. ticker, ФАЗА 5).
        if (ev.kind === 'boss') {
          marker.visible = false // визуал несёт спрайт босса, не кружок
          bossEventIndexRef.current = eventIndex
        }

        return { ...ev, marker, closed: false }
      })
      enemiesRef.current = spawnedEnemies

      // Босс карты C (см. type Boss/spawnBoss выше) — спавн НЕ читает
      // chosenEvents напрямую (не менялось, см. задачу ФАЗА 5): читаем
      // slots.boss НАПРЯМУЮ — это ПЛОСКАЯ пара [x,y] (в отличие от
      // enemyClusters/obelisk — там массив/объект точек). Спавн теперь
      // ГЕЙТИТСЯ тем же bossWillSpawn, что решал пиннинг в chosenEvents
      // (см. задачу, вероятностный босс) — иначе при невыпавшем броске
      // спрайт всё равно появился бы на карте без eventIndex, и закрыть
      // событие/выдать награду было бы нечем (bossEventIndexRef остался
      // бы null навсегда). bossPoint и ev.x/ev.y кандидата 'boss' — одна и
      // та же точка slots.boss, когда бросок выпал.
      const bossPoint = (slots as { boss?: unknown } | null)?.boss
      bossRef.current = bossWillSpawn && isPointXY(bossPoint) ? spawnBoss(bossPoint[0], bossPoint[1]) : null

      // Панель Смуглера (окно обмена) — ОДИН Container на весь забег (не по
      // смуглеру: в один момент активен максимум один, см. smugglerActiveRef
      // выше). Добавлен в worldContainer ПОСЛЕ всех спрайтов событий выше —
      // рисуется НАД картой/смуглером/врагами. Кнопки пока НЕ интерактивны
      // (никакого eventMode/pointertap) — только вид, клики следующим шагом.
      const smugglerPanel = new Container()
      smugglerPanel.visible = false

      const smugglerPanelBg = new Graphics()
        .roundRect(0, 0, C.SMUGGLER_PANEL_W, C.SMUGGLER_PANEL_H, 10)
        .fill({ color: 0x221e2b, alpha: 0.95 })
        .stroke({ color: 0x3a3344, width: 2 })
      smugglerPanel.addChild(smugglerPanelBg)

      const smugglerPanelText = new Text({
        text: 'Контрабандист предлагает обмен\nтрофеи ×1.5',
        style: {
          fontSize: 16,
          fontWeight: 'bold',
          fill: 0xede7f2,
          align: 'center',
          stroke: { color: 0x000000, width: 4 },
        },
      })
      smugglerPanelText.anchor.set(0.5, 0)
      smugglerPanelText.x = C.SMUGGLER_PANEL_W / 2
      smugglerPanelText.y = 12
      smugglerPanel.addChild(smugglerPanelText)

      // Кнопка панели — фон roundRect + центрированный текст, оба цвета
      // (рамка/текст) совпадают с акцентом кнопки. Возвращает Container с
      // сохранённой шириной/высотой для позиционирования снаружи.
      function buildSmugglerButton(label: string, accent: number): Container {
        const btn = new Container()
        const bg = new Graphics()
          .roundRect(0, 0, C.SMUGGLER_BTN_W, C.SMUGGLER_BTN_H, 6)
          .fill({ color: 0x221e2b })
          .stroke({ color: accent, width: 2 })
        btn.addChild(bg)
        const label_ = new Text({
          text: label,
          style: { fontSize: 15, fontWeight: 'bold', fill: accent, stroke: { color: 0x000000, width: 4 } },
        })
        label_.anchor.set(0.5)
        label_.x = C.SMUGGLER_BTN_W / 2
        label_.y = C.SMUGGLER_BTN_H / 2
        btn.addChild(label_)

        // Первая Pixi-интерактивность в проекте (см. задачу) — hitArea
        // задана явно прямоугольником кнопки, чтобы тап засчитывался по всей
        // площади, а не только по непрозрачным пикселям Graphics/Text.
        btn.eventMode = 'static'
        btn.cursor = 'pointer'
        btn.hitArea = new Rectangle(0, 0, C.SMUGGLER_BTN_W, C.SMUGGLER_BTN_H)
        return btn
      }

      // Обе кнопки симметрично вокруг центра панели, зазор SMUGGLER_BTN_GAP
      // между ними (не привязаны к краям — держат центр при любой ширине).
      const smugglerBtnPairW = C.SMUGGLER_BTN_W * 2 + C.SMUGGLER_BTN_GAP
      const smugglerBtnStartX = (C.SMUGGLER_PANEL_W - smugglerBtnPairW) / 2

      const smugglerExchangeBtn = buildSmugglerButton('Обменять', 0xe8b23a)
      smugglerExchangeBtn.x = smugglerBtnStartX
      smugglerExchangeBtn.y = C.SMUGGLER_PANEL_H - C.SMUGGLER_BTN_H - 14
      smugglerPanel.addChild(smugglerExchangeBtn)
      smugglerExchangeBtnRef.current = smugglerExchangeBtn
      // Обмен — Explore офлайн (см. SMUGGLER_* константы выше): трофеи нигде
      // реально не начисляются/списываются, только визуальный float. Оба
      // исхода (успех/кража) закрывают событие — панель повторно не откроется
      // (см. проверку !ev.closed в перехвате dodge).
      smugglerExchangeBtn.on('pointertap', () => {
        const activeSmuggler = smugglerActiveRef.current
        smugglerPanelOpenRef.current = false
        smugglerPanel.visible = false
        if (!activeSmuggler) return

        const floatX = activeSmuggler.sprite.x
        const floatY = activeSmuggler.sprite.y - C.SMUGGLER_DRAW_H
        const before = C.SMUGGLER_TEST_TROPHIES
        if (Math.random() < C.SMUGGLER_STEAL_CHANCE) {
          const after = Math.round(before * C.SMUGGLER_STEAL_FRAC)
          spawnRewardFloat(floatX, floatY, [{ kind: 'trophy', amount: before - after, negative: true }])
        } else {
          const after = Math.round(before * C.SMUGGLER_MULT)
          spawnRewardFloat(floatX, floatY, [{ kind: 'trophy', amount: after - before }])
        }
        closeEvent(activeSmuggler.eventIndex)
      })

      const smugglerLeaveBtn = buildSmugglerButton('Уйти', 0xe0353b)
      smugglerLeaveBtn.x = smugglerBtnStartX + C.SMUGGLER_BTN_W + C.SMUGGLER_BTN_GAP
      smugglerLeaveBtn.y = C.SMUGGLER_PANEL_H - C.SMUGGLER_BTN_H - 14
      smugglerPanel.addChild(smugglerLeaveBtn)
      smugglerLeaveBtnRef.current = smugglerLeaveBtn
      // Вариант A: уйти = упустить — событие закрывается насовсем, без обмена.
      smugglerLeaveBtn.on('pointertap', () => {
        const activeSmuggler = smugglerActiveRef.current
        smugglerPanelOpenRef.current = false
        smugglerPanel.visible = false
        if (activeSmuggler) closeEvent(activeSmuggler.eventIndex)
      })

      worldContainer.addChild(smugglerPanel)

      // Пересчитывает anchor/height/width/y сундука ОТ chest.floorY (найден
      // один раз при спавне, см. Chest.floorY) — а НЕ от bbox текущего
      // кадра/scale. Вызывается КАЖДЫЙ кадр для каждого сундука (см. ticker).
      // Chest_Open (140×178) и Chest_Trap_Explode (190×137) — разная
      // пропорция кадра, поэтому у ловушки СВОИ CHEST_TRAP_DRAW_H/
      // CHEST_TRAP_OFFSET_Y (подобраны вживую временным тюнером, убран — см.
      // историю), у доброго сундука — CHEST_DRAW_H/CHEST_OFFSET_Y, не трогаем.
      function applyChestLayout(chest: Chest) {
        chest.sprite.anchor.set(0.5, 1.0) // низ по центру — как у зверя/героя
        if (chest.isMimic) {
          chest.sprite.height = C.CHEST_TRAP_DRAW_H
          chest.sprite.width = C.CHEST_TRAP_DRAW_H * (190 / 137)
          chest.sprite.y = chest.floorY + C.CHEST_TRAP_OFFSET_Y
        } else {
          chest.sprite.height = C.CHEST_DRAW_H
          chest.sprite.width = C.CHEST_DRAW_H * (140 / 178)
          chest.sprite.y = chest.floorY + C.CHEST_OFFSET_Y
        }
      }

      // Y отрисовки спрайта должен ложиться на РЕАЛЬНУЮ поверхность тайла, а
      // не на низ хитбокса (низ хитбокса — грубый прямоугольник, который сам
      // физикой ставится по правилу sweepFootBlock, но эта функция считает
      // независимо ТЕМ ЖЕ способом — 3 точки по ширине, как sweepFootBlock/
      // isSolid выше — и берёт САМУЮ ВЕРХНЮЮ найденную твердь в ТЕКУЩЕЙ строке
      // клеток под ногами). Возвращает null, если под ногами прямо сейчас нет
      // тверди (персонаж в воздухе — прыжок/падение) — в этом случае вызывающий
      // код остаётся на прежнем поведении (низ хитбокса), проверка "стоим ли мы
      // именно на этой клетке", а НЕ поиск ближайшего пола ниже (годится для
      // приземлённого состояния, но не для позиционирования спрайта в прыжке).
      function findGroundSurfaceY(x: number, width: number, footY: number): number | null {
        const xPoints = [x + 1, x + width / 2, x + width - 1]
        const cy = Math.floor(footY / C.TILE_SIZE)
        let top: number | null = null
        for (const px of xPoints) {
          const cx = Math.floor(px / C.TILE_SIZE)
          const blockTop = cellFootBlockTop(grid, C.TILE_SIZE, cx, cy)
          if (blockTop === null) continue
          top = top === null ? blockTop : Math.min(top, blockTop)
        }
        return top
      }

      // Мягкая стена по X — ОБЩИЙ помощник для живого врага (enemy.rect) И
      // сундука (chestsRef, hitbox всегда твёрд — и закрытый, и открытый):
      // игрок не проходит сквозь тело сбоку, выталкивается к ближайшему
      // краю. ТОЛЬКО по X — вертикаль не
      // трогает (сверху можно запрыгнуть/перепрыгнуть, PUSH_TOP_MARGIN решает,
      // где проходит граница "тело" vs "перелёт"). Перенесено из инлайн-блока
      // push-out в enemy-цикле — та же логика, геометрия тела параметризована.
      function pushPlayerOutX(
        body: { x: number; y: number; width: number; height: number },
        playerCombatBox: { x: number; y: number; w: number; h: number },
      ) {
        const verticalReach = playerCombatBox.y < body.y + body.height && playerCombatBox.y + playerCombatBox.h > body.y
        if (!verticalReach) return
        const bodyTop = body.y + body.height * C.PUSH_TOP_MARGIN
        if (playerCombatBox.y + playerCombatBox.h <= bodyTop) return // перепрыгнул
        const pLeft = playerCombatBox.x
        const pRight = playerCombatBox.x + playerCombatBox.w
        const bLeft = body.x
        const bRight = body.x + body.width
        if (!(pRight > bLeft && pLeft < bRight)) return
        const pCenter = playerCombatBox.x + playerCombatBox.w / 2
        const bCenter = body.x + body.width / 2
        // Выталкиваем РЕАЛЬНУЮ phys.x, но так, чтобы вплотную к телу встал
        // КРАЙ БОКСА (playerCombatBox), а не phys.x напрямую — на земле
        // offsetX=0 (бокс совпадает с phys), в прыжке бокс центрирован/
        // смещён относительно phys.x (см. getPlayerCombatBox).
        const offsetX = playerCombatBox.x - phys.x
        if (pCenter < bCenter) {
          phys.x = (body.x - playerCombatBox.w) - offsetX
        } else {
          phys.x = (body.x + body.width) - offsetX
        }
        phys.x = clamp(phys.x, 0, worldWidthPx - C.PLAYER_WIDTH)
        phys.vx = 0
      }

      // Камера: центрируем игрока на экране, зажимая по границам карты.
      const worldWidth = grid[0].length * C.TILE_SIZE * worldContainer.scale.x
      const worldHeight = grid.length * C.TILE_SIZE * worldContainer.scale.y

      // dt — deltaTime тика (как везде в файле); при первом вызове (до старта
      // ticker'а) передаём Infinity, чтобы camera-lerp ниже сразу СНАПНУЛ в
      // стартовую позицию, а не полз туда от (0,0) первые несколько кадров.
      const updateCamera = (dt: number) => {
        // player.x/y и player.width/height — координаты МИРА (локальные для
        // worldContainer), а worldContainer.x/y — координаты ЭКРАНА. При
        // scale != 1 их нельзя смешивать без множителя s.
        const s = C.WORLD_SCALE

        // LOOK-AHEAD (только X): целимся не в игрока, а в точку на
        // LOOKAHEAD_TILES тайлов ВПЕРЕДИ по факту движения. facingRef — уже
        // существующий флаг направления (обновляется при движении, персистит
        // при остановке — см. его объявление выше), поэтому при остановке
        // упреждение остаётся прежним, а не прыгает к центру.
        const lookaheadPx = facingRef.current * C.LOOKAHEAD_TILES * C.TILE_SIZE
        const focusX = player.x + player.width / 2 + lookaheadPx
        const targetX = clamp(app!.screen.width / 2 - focusX * s, app!.screen.width - worldWidth, 0)
        // Плавно догоняем target (lerp), а не прыгаем скачком. Коэффициент
        // масштабирован по dt (не зависит от fps) и зажат в [0,1] — на первом
        // вызове (dt=Infinity) это даёт factor=1, то есть мгновенный снап.
        const smoothFactor = Math.min(1, C.SMOOTH * dt)
        worldContainer.x += (targetX - worldContainer.x) * smoothFactor

        // Вертикаль — БЕЗ look-ahead и без lerp, как было (не трогаем).
        const targetY = app!.screen.height * C.CAMERA_V_ANCHOR - (player.y + player.height / 2) * s
        worldContainer.y = clamp(targetY, app!.screen.height - worldHeight, 0)

        // Параллакс: far/mid ползут МЕДЛЕННЕЕ карты — доля от движения камеры,
        // не от движения игрока напрямую (иначе не совпадало бы с lerp/clamp
        // выше). far двигается меньше всего (дальше), mid — заметнее (ближе).
        const FAR_FACTOR = 0.15
        const MID_FACTOR = 0.4
        bgFar.tilePosition.x = worldContainer.x * FAR_FACTOR
        bgFar.tilePosition.y = worldContainer.y * FAR_FACTOR
        bgMid.tilePosition.x = worldContainer.x * MID_FACTOR
        bgMid.tilePosition.y = worldContainer.y * MID_FACTOR
      }

      updateCamera(Infinity)

      // Общие для обоих способов закрытия события (касание — chest/т.п.,
      // убийство кластера — enemy): красит HUD-иконку и проверяет "все 3
      // закрыты?" -> onRunComplete. Вызывается из touch-цикла ниже И из
      // enemy-цикла, когда remainingEnemies кластера доходит до 0.
      function closeEvent(index: number) {
        const ev = eventsRef.current[index]
        if (!ev || ev.closed) return
        ev.closed = true
        setEventClosed((prev) => {
          const next = [...prev]
          next[index] = true
          return next
        })
        if (!runCompleteFiredRef.current && eventsRef.current.every((e) => e.closed)) {
          runCompleteFiredRef.current = true
          onRunCompleteRef.current(eventsRef.current.map((e) => ({ kind: e.kind })))
        }
      }

      // Урон-чек атаки — раньше проверялся каждый кадр, пока attackActiveRef
      // было true (окно ATTACK_ACTIVE_MS от момента нажатия); теперь вызывается
      // ОДИН раз с кадра удара анимации героя (ATTACK_STRIKE_FRAME) — см. вызов
      // в блоке анимации в тикере. Сама проверка (дальность/направление через
      // attackHitboxRef, "один удар = один засчёт" через attackSwingIdRef/
      // lastHitSwingId, урон, добивание) — БЕЗ ИЗМЕНЕНИЙ, только вынесена из
      // общего цикла врагов в свою функцию с собственным for.
      function applyAttackHit() {
        for (let i = 0; i < enemiesRef.current.length; i++) {
          const enemy = enemiesRef.current[i]
          // Мёртвый враг (death уже играет/держит кадр) — хиты по нему больше
          // ничего не делают: не hurt, не поднимают stunCount, не бьют повторно.
          if (enemy.dead) continue
          if (
            attackHitboxRef.current &&
            enemy.lastHitSwingId !== attackSwingIdRef.current
          ) {
            const hb = attackHitboxRef.current
            const overlap =
              hb.x < enemy.x + C.ENEMY_WIDTH &&
              hb.x + hb.width > enemy.x &&
              hb.y < enemy.y + C.ENEMY_HEIGHT &&
              hb.y + hb.height > enemy.y
            if (overlap) {
              enemy.lastHitSwingId = attackSwingIdRef.current
              enemy.hp = Math.max(0, enemy.hp - attackDamageRef.current)
              if (enemy.hp <= 0) {
                // Смерть — высший приоритет, перебивает hurt/attack/windup
                // немедленно. Само удаление/закрытие события ПЕРЕНЕСЕНО в
                // основной цикл врагов (см. ticker ниже) — ждём, пока death
                // доиграет и подержится DEATH_HOLD_MS, а не убираем сразу.
                enemy.dead = true
                redrawEnemyHpBar(enemy) // пустая полоса
                const beastFrames = beastFramesRef.current
                if (beastFrames) {
                  playSpriteAnim(enemy.sprite, beastFrames.death, C.BEAST_DEATH_ANIM_SPEED, false)
                }
                enemy.deathHoldTimer = 0
                continue
              }
              redrawEnemyHpBar(enemy)
              // Хитстан — та же точка, где уменьшается hp. Не трогаем на
              // смертельном ударе (continue выше уже ушёл из итерации, см.
              // enemy.dead-ветку) — hurt никогда не запускается поверх death.
              //
              // "Точка невозврата" (POISE_POINT) — защита от stun-lock: если
              // враг СЕЙЧАС в замахе (windingUp) И уже прошёл его достаточно
              // далеко (windupProgress >= POISE_POINT), урон его больше НЕ
              // прерывает — windingUp/windupTimer/attackAnimPlaying НЕ трогаем
              // вообще, удар доигрывает до strike-кадра и наносит урон как
              // обычно (см. приоритет анимаций в ticker'е — раз hurtTimer не
              // выставлен, attack-ветка продолжает идти без изменений). Иначе
              // (не в замахе, ИЛИ рано в замахе) — прерываем как раньше.
              //
              // Накопительный стан-резист (STUN_LIMIT/POISE_IMMUNE_MS) —
              // гарантия прорыва, даже если игрок ритмично сбивает КАЖДЫЙ
              // замах в ранней фазе (poiseImmuneTimer>0 перекрывает проверку
              // POISE_POINT точно так же, как поздняя фаза — ветка COMMIT).
              const wasWindingUp = enemy.windingUp
              const windupProgress = wasWindingUp ? enemy.windupTimer / C.WINDUP_MS : 0
              const poiseImmune = enemy.poiseImmuneTimer > 0
              if (!wasWindingUp || (windupProgress < C.POISE_POINT && !poiseImmune)) {
                if (wasWindingUp) {
                  enemy.stunCount += 1
                  if (enemy.stunCount >= C.STUN_LIMIT) {
                    enemy.poiseImmuneTimer = C.POISE_IMMUNE_MS
                    enemy.stunCount = 0
                  }
                }
                enemy.hurtTimer = C.ENEMY_HURT_MS
                enemy.windingUp = false
                enemy.windupTimer = 0
                enemy.attackAnimPlaying = false
              }
              // else: поздняя фаза ИЛИ иммунитет — замах не прерываем, зверь
              // просто дожимает удар до strike-кадра как обычно, без подсветки.
            }
          }
        }

        // Босс карты C (ФАЗА 2, шаг 5 — починка стан-лока, см. задачу) — ТОТ
        // ЖЕ хит-тест, что у врага выше: lastHitSwingId дедупит один взмах,
        // dead исключает повторные удары по трупу. Приоритеты состояний
        // теперь dead > attack > hurt > walk > idle (attack ВЫШЕ hurt) —
        // см. два слоя защиты ниже, оба применяются ТОЛЬКО на не смертельном
        // попадании (лестница dead-веток та же, что была).
        if (bossRef.current) {
          const boss = bossRef.current
          if (
            !boss.dead &&
            attackHitboxRef.current &&
            boss.lastHitSwingId !== attackSwingIdRef.current
          ) {
            const hb = attackHitboxRef.current
            const overlap =
              hb.x < boss.x + C.BOSS_WIDTH &&
              hb.x + hb.width > boss.x &&
              hb.y < boss.y + C.BOSS_HEIGHT &&
              hb.y + hb.height > boss.y
            if (overlap) {
              boss.lastHitSwingId = attackSwingIdRef.current
              boss.hp = Math.max(0, boss.hp - attackDamageRef.current)
              if (boss.hp <= 0) {
                // Смерть (ФАЗА 2, шаг 6, см. задачу) — dead > attack > hurt >
                // walk > idle, ничем не прерывается: boss.dead гейтит ВЕСЬ
                // тикер (физика/AI/push-out/визуал, см. там) — мёртвый босс
                // дальше не двигается, не разворачивается, не атакует и не
                // получает урон повторно (гейт !boss.dead в самом начале
                // этого блока). HP-бар СКРЫВАЕТСЯ (не просто пустая полоса).
                // Death запускается ЗДЕСЬ один раз; applyBossLayout+флип
                // фиксируют финальные позу/facing НАВСЕГДА (дальше тикер их
                // не трогает, физика для мёртвого босса отключена) — само
                // "падение" зашито в кадры Boss_Death (46, разовая,
                // BOSS_ANIM_LOOP.death=false) — PixiJS AnimatedSprite сам
                // держит последний кадр без loop, ничего досчитывать не надо.
                // Труп ОСТАЁТСЯ до конца забега (в отличие от зверя —
                // никакого despawn/DEATH_HOLD_MS). Награда/закрытие события —
                // НЕ здесь, это фаза 5 (см. задачу, п.6).
                boss.dead = true
                boss.hpBarBg.visible = false
                boss.hpBarFill.visible = false
                playBossAnim('death')
                applyBossLayout(boss)
                boss.sprite.scale.x = boss.facing === -1 ? Math.abs(boss.sprite.scale.x) : -Math.abs(boss.sprite.scale.x)
              } else {
                redrawBossHpBar(boss)
                // Стадия 2 — переход СЧИТАЕТСЯ один раз, на первом пересечении
                // порога ВНИЗ (гейт stage===1), не каждый кадр, что дальше hp
                // будет падать. САМ переход не выставляет и не продлевает
                // никаких таймеров (hurtTimer/poiseImmuneTimer/hitFlashTimer)
                // — это только boss.stage/console.log, см. задачу ("Разведи
                // 'получил урон' и 'не может действовать'"). Пауза, которая
                // раньше была заметна сразу после перехода — не следствие
                // самого перехода, а совпадение: удар, снёсший HP за порог,
                // это ОБЫЧНЫЙ удар и проходит через слои 1/2 ниже наравне со
                // всеми остальными.
                if (boss.stage === 1 && boss.hp <= boss.maxHp * C.BOSS_STAGE2_HP_RATIO) {
                  boss.stage = 2
                }

                if (boss.attackAnimPlaying || boss.rangedAnimPlaying) {
                  // СЛОЙ 1 (главный, см. задачу) — во время атаки ИЛИ броска
                  // Hurt НЕ проигрывается ВООБЩЕ, ни на каком кадре, независимо
                  // от poise: attackAnimPlaying/attackKind/attackHitApplied и
                  // rangedAnimPlaying/rangedThrowApplied НЕ трогаем — действие
                  // доигрывает до конца как обычно. Урон уже применён выше
                  // (hp/HP-бар). Обратная связь без хитстана — короткая
                  // вспышка (см. ticker).
                  boss.hitFlashTimer = C.BOSS_HIT_FLASH_MS
                } else {
                  // СЛОЙ 2 (починка стан-лока, см. задачу) — СВОИМИ
                  // константами BOSS_STUN_LIMIT/BOSS_POISE_IMMUNE_MS, но
                  // структурой приведено к логике зверя (строки применения
                  // POISE_POINT/STUN_LIMIT у enemy выше): там stunCount растёт
                  // ТОЛЬКО когда попадание сбивает УЖЕ идущее состояние
                  // (wasWindingUp), а не от любого удара — у босса нет фазы
                  // замаха, поэтому эквивалент "уже идущего состояния,
                  // которое сбивают" — это Hurt, который прямо сейчас играет
                  // (boss.hurtTimer > 0).
                  const poiseImmune = boss.poiseImmuneTimer > 0
                  const alreadyHurt = boss.hurtTimer > 0
                  if (poiseImmune) {
                    // Иммунитет — Hurt не входит вообще, только вспышка (тот
                    // же принцип, что и раньше).
                    boss.hitFlashTimer = C.BOSS_HIT_FLASH_MS
                  } else if (alreadyHurt) {
                    // Попадание "в разгар" уже идущего Hurt (см. задачу, п.1) —
                    // урон уже применён выше, добавляем вспышку, но hurtTimer
                    // НЕ трогаем (не продлеваем и не перезапускаем анимацию).
                    // Именно это попадание "сбивает уже идущий Hurt-цикл" —
                    // аналог wasWindingUp у зверя, поэтому здесь (и только
                    // здесь) растёт stunCount (см. задачу, п.2).
                    boss.hitFlashTimer = C.BOSS_HIT_FLASH_MS
                    boss.stunCount += 1
                    if (boss.stunCount >= C.BOSS_STUN_LIMIT) {
                      boss.poiseImmuneTimer = C.BOSS_POISE_IMMUNE_MS
                      boss.stunCount = 0
                    }
                  } else {
                    // Свежий хит: босс НЕ атаковал, Hurt ещё НЕ шёл, иммунитета
                    // нет — обычный запуск хитстана. stunCount НЕ растёт (как
                    // у зверя в ветке !wasWindingUp) — это не "сбитое" состояние.
                    boss.hurtTimer = C.BOSS_HURT_MS
                  }
                }
              }
            }
          }
        }

        // Сундук — открывается ударом (без "один удар = один засчёт" по
        // attackSwingIdRef, как у врагов: opening=true уже само по себе
        // блокирует повторный запуск на следующих свингах, дедуп не нужен).
        // Сундук не бьёт и не имеет HP — только открытие анимации.
        if (attackHitboxRef.current) {
          const hb = attackHitboxRef.current
          for (const chest of chestsRef.current) {
            if (chest.opening || chest.opened) continue
            const box = chest.hitbox
            const overlap =
              hb.x < box.x + box.width &&
              hb.x + hb.width > box.x &&
              hb.y < box.y + box.height &&
              hb.y + hb.height > box.y
            if (!overlap) continue
            chest.opening = true
            // Бросок решается ОДИН раз, на первом ударе — не перебрасывается
            // на повторных кадрах, пока opening держит цикл закрытым выше.
            chest.isMimic = Math.random() < C.CHEST_MIMIC_CHANCE
            chest.trapDamaged = false
            if (chest.isMimic) {
              chest.sprite.textures = chestTrapFrames
              applyChestLayout(chest)
              chest.sprite.loop = false
              chest.sprite.animationSpeed = C.CHEST_TRAP_ANIM_SPEED
              chest.sprite.gotoAndPlay(0)
            } else {
              chest.sprite.textures = chestFrames
              applyChestLayout(chest)
              chest.sprite.loop = false
              chest.sprite.animationSpeed = C.CHEST_ANIM_SPEED
              chest.sprite.gotoAndPlay(0)
            }
          }
        }

        // Обелиск — переключается на burning ударом. Первый удар (по любому
        // обелиску) запускает событие (таймер + доспавн остальных), удары по
        // уже активному событию добавляют время и счётчик (см. ниже). Успех/
        // провал (награда/смерть, обелиски гаснут обратно в idle) — в
        // ticker'е, см. блок таймера события выше. anchor/x/y/height/width НЕ
        // трогаем при смене textures — оба листа нарезаны одним окном в
        // одном масштабе, посадка общая.
        if (attackHitboxRef.current) {
          const hb = attackHitboxRef.current
          for (const obelisk of obelisksRef.current) {
            if (obelisk.struck) continue
            const box = obelisk.hitbox
            const overlap =
              hb.x < box.x + box.width &&
              hb.x + hb.width > box.x &&
              hb.y < box.y + box.height &&
              hb.y + hb.height > box.y
            if (!overlap) continue
            obelisk.struck = true
            obelisk.burning = true
            obeliskLastStruckRef.current = obelisk
            playSpriteAnim(obelisk.sprite, obeliskBurningFramesRef.current, C.OBELISK_ANIM_SPEED, true)

            if (!obeliskEventActiveRef.current) {
              // Первый удар по любому обелиску запускает событие: таймер,
              // счётчик и доспавн оставшихся OBELISK_TOTAL-1 в Idle (см. задачу).
              obeliskEventActiveRef.current = true
              obeliskTimerRef.current = C.OBELISK_TIME_MS
              obeliskStruckCountRef.current = 1

              const startPoint = obeliskStartPointRef.current
              const remainingCandidates = obeliskCandidatesRef.current.filter(
                (p) => !startPoint || p[0] !== startPoint[0] || p[1] !== startPoint[1]
              )
              const spawnPoints = pickRandom(remainingCandidates, C.OBELISK_TOTAL - 1)
              for (const [tx, ty] of spawnPoints) spawnObelisk(tx, ty)
            } else {
              obeliskStruckCountRef.current += 1
              obeliskTimerRef.current += C.OBELISK_TIME_BONUS_MS
            }
          }
        }
      }

      // Ходьба влево/вправо + прыжок + коллизия со стенами, гравитация и
      // приземление на твердь. Платформы '=' — следующий шаг.
      const worldWidthPx = grid[0].length * C.TILE_SIZE

      app.ticker.add((ticker) => {
        const dt = ticker.deltaTime
        const startX = phys.x
        const startY = phys.y
        // Верх бокового хитбокса в прыжке — та же поправка, что у
        // sweepHeadBlock ниже (headOffset = phys.onGround ? 0 :
        // JUMP_HIT_OFFSET_Y): без неё полный PLAYER_HEIGHT цепляет нависающую
        // твердь над проёмами в воздухе, и диагональный прыжок стопорится.
        // Не переиспользуем headOffset из вертикального блока ниже — тот
        // объявлен в другой блочной области видимости и считается ПОСЛЕ
        // того, как phys.onGround уже сброшен в false на этот кадр (см. там
        // же); здесь нужен snapshot СРАЗУ на начало кадра, до этого сброса.
        const headOffset = phys.onGround ? 0 : C.JUMP_HIT_OFFSET_Y

        // Кулдаун зелья — секунды, как attackCooldownRef (ticker.deltaMS/1000).
        potionCdRef.current = Math.max(0, potionCdRef.current - ticker.deltaMS / 1000)

        // Таймер события обелисков — реальное время (ticker.deltaMS), тот же
        // приём, что у остальных ms-таймеров выше.
        if (obeliskEventActiveRef.current) {
          obeliskTimerRef.current -= ticker.deltaMS
          if (obeliskStruckCountRef.current >= C.OBELISK_TOTAL) {
            obeliskEventActiveRef.current = false
            setObeliskHud(null)
            // Все обелиски (включая стартовый) гаснут обратно в idle — они
            // остаются на карте декорацией и стеной по X, struck НЕ сбрасываем
            // (повторно бить нельзя). Тот же способ смены textures, что и при
            // поджоге — anchor/x/y/height/width не трогаем.
            for (const obelisk of obelisksRef.current) {
              obelisk.burning = false
              playSpriteAnim(obelisk.sprite, obeliskIdleFrames, C.OBELISK_ANIM_SPEED, true)
            }
            const last = obeliskLastStruckRef.current
            if (last) {
              spawnRewardFloat(last.sprite.x, last.sprite.y - last.sprite.height, [
                { kind: 'trophy', amount: rollTrophies(C.TROPHY_MULT_OBELISK) },
              ])
            }
            if (obeliskEventIndexRef.current !== null) closeEvent(obeliskEventIndexRef.current)
          } else if (obeliskTimerRef.current <= 0) {
            obeliskEventActiveRef.current = false
            setObeliskHud(null)
            // Провал = смерть героя — переиспользуем ЕДИНУЮ точку смерти
            // (takeDamage -> triggerDeath), не дублируем анимацию/hold/abandon.
            takeDamageRef.current(hpRef.current)
          } else {
            const secondsLeft = Math.ceil(obeliskTimerRef.current / 1000)
            // Стартовый обелиск в счёт не идёт — HUD считает только 3 доспавненных.
            const struckForHud = Math.max(0, obeliskStruckCountRef.current - 1)
            if (secondsLeft !== obeliskHudSecondsRef.current || struckForHud !== obeliskHudStruckRef.current) {
              obeliskHudSecondsRef.current = secondsLeft
              obeliskHudStruckRef.current = struckForHud
              setObeliskHud({ active: true, secondsLeft, struck: struckForHud })
            }
          }
        }

        // Горизонтальное движение — во время питья зелья (drinkingRef) ИЛИ
        // после смерти (deathRef) герой закоренён: ввод движения игнорируется
        // целиком, ноги на месте. deathRef никогда не сбрасывается — этот
        // гейт держит мёртвого героя неподвижным до конца забега.
        const heroLocked = drinkingRef.current || deathRef.current
        phys.vx = heroLocked ? 0 : dirRef.current * C.MOVE_SPEED
        phys.x += phys.vx * dt
        if (!heroLocked && dirRef.current !== 0) facingRef.current = dirRef.current > 0 ? 1 : -1

        if (phys.vx > 0) {
          const px = phys.x + C.PLAYER_WIDTH - 1
          let hit =
            isSolid(grid, C.TILE_SIZE, px, phys.y + headOffset + 1) ||
            isSolid(grid, C.TILE_SIZE, px, phys.y + C.PLAYER_HEIGHT / 2) ||
            isSolid(grid, C.TILE_SIZE, px, phys.y + C.PLAYER_HEIGHT - 1)
          if (!hit) {
            // Сначала: уже внутри полосы (по текущему положению, не по цели)?
            const stuckInBand = isOverlappingPlatformBand(grid, C.TILE_SIZE, startX, C.PLAYER_WIDTH, phys.y + headOffset, phys.y + C.PLAYER_HEIGHT)
            if (!stuckInBand) {
              const band = isPlatformBandBlocking(grid, C.TILE_SIZE, px, phys.y + headOffset, phys.y + C.PLAYER_HEIGHT)
              if (band) hit = true
            }
          }
          if (hit) {
            phys.x = Math.floor((phys.x + C.PLAYER_WIDTH) / C.TILE_SIZE) * C.TILE_SIZE - C.PLAYER_WIDTH
            phys.vx = 0
          }
        } else if (phys.vx < 0) {
          const px = phys.x
          let hit =
            isSolid(grid, C.TILE_SIZE, px, phys.y + headOffset + 1) ||
            isSolid(grid, C.TILE_SIZE, px, phys.y + C.PLAYER_HEIGHT / 2) ||
            isSolid(grid, C.TILE_SIZE, px, phys.y + C.PLAYER_HEIGHT - 1)
          if (!hit) {
            // Сначала: уже внутри полосы (по текущему положению, не по цели)?
            const stuckInBand = isOverlappingPlatformBand(grid, C.TILE_SIZE, startX, C.PLAYER_WIDTH, phys.y + headOffset, phys.y + C.PLAYER_HEIGHT)
            if (!stuckInBand) {
              const band = isPlatformBandBlocking(grid, C.TILE_SIZE, px, phys.y + headOffset, phys.y + C.PLAYER_HEIGHT)
              if (band) hit = true
            }
          }
          if (hit) {
            phys.x = (Math.floor(phys.x / C.TILE_SIZE) + 1) * C.TILE_SIZE
            phys.vx = 0
          }
        }

        phys.x = clamp(phys.x, 0, worldWidthPx - C.PLAYER_WIDTH)

        // Прыжок: только с тверди, двойного прыжка нет. Одно нажатие —
        // ровно один прыжок, флаг сразу сбрасывается.
        let jumpedThisFrame = false
        if (jumpPressedRef.current) {
          jumpPressedRef.current = false
          if (!deathRef.current && phys.onGround && !drinkingRef.current) {
            phys.vy = -C.JUMP_VELOCITY
            phys.onGround = false
            jumpedThisFrame = true
          }
        }

        // Вертикальная физика (гравитация + приземление)
        const wasOnGround = phys.onGround
        phys.vy = Math.min(phys.vy + C.GRAVITY * dt, C.MAX_FALL)
        phys.y += phys.vy * dt

        phys.onGround = false
        if (phys.vy > 0) {
          // Приземление сверху: проверяем весь путь ног за кадр, не только
          // конечную точку — иначе на просевшем кадре можно провалиться
          // сквозь тонкую полосу '=', не попав в неё ни разу.
          const prevFootY = startY + C.PLAYER_HEIGHT
          const footY = phys.y + C.PLAYER_HEIGHT
          const blockTop = sweepFootBlock(grid, C.TILE_SIZE, phys.x, C.PLAYER_WIDTH, prevFootY, footY)
          if (blockTop !== null) {
            phys.y = blockTop - C.PLAYER_HEIGHT
            phys.vy = 0
            phys.onGround = true
          }
        } else if (phys.vy < 0) {
          // Удар головой снизу вверх: та же защита от туннелирования —
          // проверяем весь путь [headY, prevHeadY] за кадр. '#' — вся
          // клетка, '=' — только полоса.
          // В ПРЫЖКЕ (phys.onGround уже false в этой ветке — vy<0 бывает
          // только во время взлёта) верх проверки опущен на headOffset=
          // JUMP_HIT_OFFSET_Y, к макушке прыжковой позы — иначе полный бокс
          // (128 высотой) торчит головой выше спрайта и упирается в пустоту.
          // На земле headOffset=0, поведение не меняется (эта ветка на земле
          // и не выполняется, т.к. vy<0 там не бывает).
          const headOffset = phys.onGround ? 0 : C.JUMP_HIT_OFFSET_Y
          const prevHeadY = startY + headOffset // y ДО y += vy*dt (startY захвачен в начале тика)
          const headY = phys.y + headOffset
          const pushTo = sweepHeadBlock(grid, C.TILE_SIZE, phys.x, C.PLAYER_WIDTH, prevHeadY, headY)
          if (pushTo !== null) {
            phys.y = pushTo - headOffset
            phys.vy = 0
          } else if (
            // НИЖНЯЯ граница диапазона намеренно НЕ сдвинута (startY +
            // PLAYER_HEIGHT, как было) — только верхняя поднята на
            // headOffset. Если ужать и верх, и низ на headOffset, нижняя
            // граница проверки уезжает в клетку под ногами игрока и rollback
            // срабатывает каждый кадр прыжка (замораживал игрока на месте,
            // уже наступали на эти грабли раньше).
            isOverlappingAtFrameStart(grid, C.TILE_SIZE, phys.x, C.PLAYER_WIDTH, prevHeadY, startY + C.PLAYER_HEIGHT)
          ) {
            // Зашли сбоку под ступень: пересечения границы за кадр не было
            // (голова уже была внутри полосы на старте кадра), sweep выше
            // ничего не нашёл. Откатываем движение вверх за этот кадр —
            // без перепозиционирования по blockBottom, никакого телепорта.
            // Снап возвращает phys.y ровно туда, где он был ДО этого кадра
            // (startY) — headOffset тут ни при чём, phys.y всегда верх
            // ПОЛНОГО бокса, а не сдвинутой головы.
            phys.y = startY
            phys.vy = 0
          }
        }

        // Приземление (край перехода "не на земле" -> "на земле" за этот
        // кадр) — запускает land, только если игрок не бежит и не прыгает
        // прямо сейчас (иначе движение/прыжок сразу перекрыли бы его же).
        const justLanded = !wasOnGround && phys.onGround
        if (justLanded && dirRef.current === 0 && !jumpedThisFrame) {
          landTimerRef.current = C.LAND_MS
        }

        // Шипы: неуязвимость тикает каждый кадр независимо от касания;
        // урон только когда истекла и хитбокс реально пересекает '^'.
        spikeIframeRef.current = Math.max(0, spikeIframeRef.current - ticker.deltaMS)
        if (
          spikeIframeRef.current <= 0 &&
          isTouchingSpikes(grid, C.TILE_SIZE, phys.x, C.PLAYER_WIDTH, phys.y, phys.y + C.PLAYER_HEIGHT)
        ) {
          spikeIframeRef.current = C.SPIKE_IFRAME_MS
          applySpikeDamageRef.current()
        }

        // "3 события за забег" — временное закрытие простым касанием хитбокса.
        // enemy-события сюда НЕ попадают — они закрываются убийством кластера
        // (см. enemy-цикл ниже), не касанием. chest — тоже НЕ попадают
        // (закрывается только по завершении анимации открытия, см. чуть
        // ниже в тикере). smuggler — тоже НЕ попадают: пока чистый визуал без
        // взаимодействия (обмен/диалог — отдельный будущий шаг), закрывать
        // касанием НЕ должен. obelisk — тоже НЕ попадает: закрывается только
        // по успеху таймера события (см. блок таймера обелисков в тикере),
        // иначе простое прохождение мимо стартовой точки закрыло бы событие
        // раньше времени. Остальные типы (пока заглушки) — как раньше.
        // Мёртвый герой (deathRef) событий не закрывает вообще — тело
        // неподвижно, но гейт на всякий случай (напр. если смерть настигла
        // ровно в момент касания хитбокса).
        for (let i = 0; i < eventsRef.current.length && !deathRef.current; i++) {
          const ev = eventsRef.current[i]
          if (
            ev.closed ||
            ev.kind === 'enemy' ||
            ev.kind === 'chest' ||
            ev.kind === 'smuggler' ||
            ev.kind === 'obelisk'
          ) continue
          const evLeft = ev.x * C.TILE_SIZE
          const evTop = ev.y * C.TILE_SIZE
          const touching =
            phys.x < evLeft + C.TILE_SIZE &&
            phys.x + C.PLAYER_WIDTH > evLeft &&
            phys.y < evTop + C.TILE_SIZE &&
            phys.y + C.PLAYER_HEIGHT > evTop
          if (!touching) continue

          if (ev.marker) ev.marker.visible = false
          closeEvent(i)
        }

        // Атака игрока. Кулдаун тикает в секундах, как cooldownLeft в Battle.tsx.
        if (attackCooldownRef.current > 0) {
          attackCooldownRef.current = Math.max(0, attackCooldownRef.current - ticker.deltaMS / 1000)
        }

        if (attackPressedRef.current) {
          attackPressedRef.current = false
          // Смерть ИЛИ хитстан ИЛИ питьё зелья: во время них атаковать нельзя.
          // Смерть проверяется первой и НИКОГДА не сбрасывается — мёртвый
          // герой не переигрывает атаку и не перебивает deathFrames текстурами.
          if (deathRef.current || hurtTimerRef.current > 0 || drinkingRef.current) {
            // no-op — нажатие проигнорировано
          } else if (attackCooldownRef.current <= 0 && !attackingRef.current) {
            attackCooldownRef.current = C.ATTACK_COOLDOWN
            attackActiveRef.current = true
            attackActiveTimerRef.current = C.ATTACK_ACTIVE_MS
            attackSwingIdRef.current += 1 // новый взмах — враги смогут получить урон от него ровно один раз
            attackingRef.current = true
            attackHitDoneRef.current = false
            attackFacingRef.current = facingRef.current // facing зафиксирован на старте замаха
            // Хитбокс — прямоугольник шириной ATTACK_RANGE перед игроком, по
            // направлению взгляда (facingRef), высотой в его рост. Считается
            // один раз на старте удара (снимок, как мгновенная проверка
            // дистанции в Battle.tsx), а не каждый кадр активности.
            attackHitboxRef.current =
              facingRef.current === 1
                ? { x: phys.x + C.PLAYER_WIDTH, y: phys.y, width: C.PLAYER_ATTACK_RANGE, height: C.PLAYER_HEIGHT }
                : { x: phys.x - C.PLAYER_ATTACK_RANGE, y: phys.y, width: C.PLAYER_ATTACK_RANGE, height: C.PLAYER_HEIGHT }
            // Урон здесь больше НЕ применяется — applyAttackHit() вызывается
            // из блока анимации героя в тикере, на кадре удара ATTACK_STRIKE_FRAME.
            hero.textures = attackFrames
            hero.loop = false
            hero.animationSpeed = C.ATTACK_ANIM_SPEED
            hero.gotoAndPlay(0)
          }
        }

        if (attackActiveRef.current) {
          attackActiveTimerRef.current -= ticker.deltaMS
          if (attackActiveTimerRef.current <= 0) {
            attackActiveRef.current = false
            // attackHitboxRef НЕ обнуляем здесь: ATTACK_ACTIVE_MS (150мс) —
            // окно короче, чем реальный момент удара по анимации (~200мс на
            // ATTACK_STRIKE_FRAME при ATTACK_ANIM_SPEED=0.5) — applyAttackHit()
            // должен ещё застать валидный хитбокс. Хитбокс переживается
            // следующим press'ом.
          }
        }

        // Питьё зелья. По образцу старта атаки: снимок текстур/скорости/loop
        // на pressed-флаге, проигрывание берёт на себя ветка приоритета
        // анимаций ниже. Заряды/кулдаун гейтят СТАРТ, но не списываются
        // здесь — хил+списание+кулдаун происходят на кадре глотка
        // (POTION_GULP_FRAME) в drinkingRef-ветке, см. ниже.
        if (drinkPressedRef.current) {
          drinkPressedRef.current = false
          if (
            !deathRef.current &&
            phys.onGround &&
            !drinkingRef.current &&
            potionChargesRef.current > 0 &&
            potionCdRef.current <= 0
          ) {
            drinkingRef.current = true
            potionHealedThisDrinkRef.current = false
            hero.textures = drinkFrames
            hero.loop = false
            hero.animationSpeed = 0.2
            hero.gotoAndPlay(0)
          }
        }

        // Dodge игрока: окно неуязвимости от удара врага + кулдаун кнопки,
        // независимо от i-frames шипов (spikeIframeRef) — отдельный механизм.
        // Считается ОДИН раз за кадр (не за врага), поэтому вынесен перед
        // циклом по врагам ниже.
        dodgeIframeRef.current = Math.max(0, dodgeIframeRef.current - ticker.deltaMS)
        dodgeCooldownRef.current = Math.max(0, dodgeCooldownRef.current - ticker.deltaMS)
        if (dodgePressedRef.current) {
          dodgePressedRef.current = false
          // Смерть — мёртвый герой не может ни увернуться, ни открыть
          // окно Контрабандиста. deathRef никогда не сбрасывается.
          if (deathRef.current) {
            // no-op
          } else {
            // Смуглер рядом — перехватывает dodge и открывает панель (пока
            // только флаг + console.log, см. задачу) вместо обычного dodge.
            const playerCenterXForSmuggler = phys.x + C.PLAYER_WIDTH / 2
            const playerFeetYForSmuggler = phys.y + C.PLAYER_HEIGHT
            const nearbySmuggler = smugglersRef.current.find((s) => {
              const ev = eventsRef.current[s.eventIndex]
              if (!ev || ev.closed) return false
              const dx = Math.abs(playerCenterXForSmuggler - s.sprite.x)
              const dy = Math.abs(playerFeetYForSmuggler - s.floorY)
              return dx <= C.SMUGGLER_INTERACT_RANGE && dy <= C.FLOOR_Y_TOLERANCE * C.TILE_SIZE
            })

            if (nearbySmuggler) {
              smugglerActiveRef.current = nearbySmuggler
              smugglerPanelOpenRef.current = true
            } else if (dodgeCooldownRef.current <= 0 && !drinkingRef.current) {
              dodgeIframeRef.current = C.PLAYER_DODGE_IFRAME_MS
              dodgeCooldownRef.current = C.PLAYER_DODGE_COOLDOWN_MS
            }
          }
        }

        // Враги (Шаг 2-3: СПИСОК — кластер из 3, может быть несколько
        // enemy-событий за забег). Каждый враг обрабатывается НЕЗАВИСИМО:
        // AI (преследование/windup/удар по игроку, Шаг 2-2). Урон от атаки
        // игрока сюда больше не входит — см. applyAttackHit(), вызывается
        // отдельно из блока анимации героя, на кадре удара. Если игрок стоит
        // между двумя врагами — оба независимо проверяют дистанцию и оба
        // могут его ударить в один и тот же кадр; HP игрока один общий
        // (takeDamageRef), отдельно считать не нужно.
        for (let i = 0; i < enemiesRef.current.length; i++) {
          const enemy = enemiesRef.current[i]

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
            const beastFrames = beastFramesRef.current
            const deathDone =
              beastFrames && (enemy.sprite.currentFrame >= beastFrames.death.length - 1 || !enemy.sprite.playing)
            if (deathDone) {
              enemy.deathHoldTimer += ticker.deltaMS
              if (enemy.deathHoldTimer >= C.DEATH_HOLD_MS) {
                // Трофеи за убийство (см. задачу) — доля этого врага уже
                // разыграна при спавне кластера (enemy.trophyReward). 0 —
                // не вызываем spawnRewardFloat, чтобы не всплывала пустая
                // надпись "+0" (см. задачу, п.4).
                if (enemy.trophyReward > 0) {
                  spawnRewardFloat(enemy.sprite.x, enemy.sprite.y - enemy.sprite.height, [
                    { kind: 'trophy', amount: enemy.trophyReward },
                  ])
                }
                worldContainer.removeChild(enemy.rect, enemy.sprite, enemy.hpBarBg, enemy.hpBarFill)
                enemy.rect.destroy()
                enemy.sprite.destroy()
                enemy.hpBarBg.destroy()
                enemy.hpBarFill.destroy()
                enemiesRef.current.splice(i, 1)
                i--
                const ownerEvent = eventsRef.current[enemy.eventIndex]
                if (ownerEvent) {
                  ownerEvent.remainingEnemies = Math.max(0, (ownerEvent.remainingEnemies ?? 1) - 1)
                  if (ownerEvent.remainingEnemies <= 0) closeEvent(enemy.eventIndex)
                }
              }
            }
            continue
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
          const enemyBlockTop = sweepFootBlock(grid, C.TILE_SIZE, enemy.x, C.ENEMY_WIDTH, prevEnemyFootY, enemyFootY)
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
          const playerCombatBox = getPlayerCombatBox()
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
          const playerFeetY = phys.y + C.PLAYER_HEIGHT
          const sameFloor = Math.abs(playerFeetY - enemyFeetY) <= C.SAME_FLOOR_TOLERANCE_TILES * C.TILE_SIZE
          const aggroed = dist <= C.AGGRO_RANGE_TILES * C.TILE_SIZE && sameFloor

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
                    isSolid(grid, C.TILE_SIZE, leadingX, enemy.y + 1) ||
                    isSolid(grid, C.TILE_SIZE, leadingX, enemy.y + C.ENEMY_HEIGHT / 2) ||
                    isSolid(grid, C.TILE_SIZE, leadingX, enemy.y + C.ENEMY_HEIGHT - 1)
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
                  isSolid(grid, C.TILE_SIZE, leadingX, enemy.y + 1) ||
                  isSolid(grid, C.TILE_SIZE, leadingX, enemy.y + C.ENEMY_HEIGHT / 2) ||
                  isSolid(grid, C.TILE_SIZE, leadingX, enemy.y + C.ENEMY_HEIGHT - 1)
                // Край платформы: под клеткой сразу впереди по ходу нет '#'/'='.
                const footCx = Math.floor(leadingX / C.TILE_SIZE)
                const footCy = Math.floor((enemy.y + C.ENEMY_HEIGHT) / C.TILE_SIZE)
                const noFloorAhead = cellFootBlockTop(grid, C.TILE_SIZE, footCx, footCy) === null
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
                enemy.attackTimer = Math.max(0, enemy.attackTimer - ticker.deltaMS / 1000)
              }
              if ((reachedStopDist || bodiesTouchingX) && verticalReach && enemy.attackTimer <= 0) {
                enemy.windingUp = true
                enemy.windupTimer = 0
              }
            } else {
              enemy.windupTimer += ticker.deltaMS
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
          pushPlayerOutX({ x: enemy.x, y: enemy.y, width: C.ENEMY_WIDTH, height: C.ENEMY_HEIGHT }, playerCombatBox)

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
          // windingUp перед ударом) — idle. Скорость walk — по aggroed (уже
          // вычислен AI-блоком выше, отдельно решение не дублируем): в погоне
          // быстрее, в патруле спокойнее.
          //
          // Флип — по enemy.facing (тот же источник, что и для rect.scale.x
          // выше, и для самого перемещения в AI-блоке), применяется ВСЕГДА,
          // независимо от того, какая ветка сработала выше (включая hurt) —
          // текущее facing не меняется, просто применяется повторно.
          // Арт зверя смотрит ВЛЕВО по умолчанию, поэтому facing===-1 (влево)
          // — БЕЗ зеркала, facing===1 (вправо) — зеркалим. Стоя на месте facing
          // не трогается AI-блоком (кроме патруля, где он всегда = patrolDir),
          // поэтому последнее направление само сохраняется без доп. логики.
          const beastFrames = beastFramesRef.current
          if (beastFrames) {
            if (enemy.hurtTimer > 0) {
              enemy.hurtTimer = Math.max(0, enemy.hurtTimer - ticker.deltaMS)
              playSpriteAnim(enemy.sprite, beastFrames.hurt, C.BEAST_HURT_ANIM_SPEED, false)
            } else {
              if (enemy.windingUp && !enemy.attackAnimPlaying) {
                enemy.attackAnimPlaying = true
                enemy.attackHitApplied = false
                playSpriteAnim(enemy.sprite, beastFrames.attack, C.BEAST_ATTACK_ANIM_SPEED, false)
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
                  const strikePlayerBox = getPlayerCombatBox()
                  const playerCenterX = strikePlayerBox.x + strikePlayerBox.w / 2
                  const enemyCenterX = enemy.x + C.ENEMY_WIDTH / 2
                  const playerOnRight = playerCenterX > enemyCenterX
                  const playerInFront =
                    (enemy.facing === 1 && playerOnRight) ||
                    (enemy.facing === -1 && !playerOnRight)
                  const canHit = (inMeleeReach || bodiesTouchingX) && verticalReach && playerInFront
                  if (canHit && dodgeIframeRef.current <= 0) {
                    takeDamageRef.current(C.ENEMY_ATTACK_DAMAGE)
                  }
                }
                if (enemy.sprite.currentFrame >= beastFrames.attack.length - 1 || !enemy.sprite.playing) {
                  enemy.attackAnimPlaying = false // доиграла — со следующего тика idle/walk
                }
              } else {
                const enemyMoving = enemy.x !== prevEnemyX
                if (enemyMoving) {
                  playSpriteAnim(enemy.sprite, beastFrames.walk, aggroed ? C.WALK_ANIM_CHASE : C.WALK_ANIM_PATROL, true)
                } else {
                  playSpriteAnim(enemy.sprite, beastFrames.idle, C.BEAST_IDLE_ANIM_SPEED, true)
                }
              }
            }
            enemy.sprite.scale.x = enemy.facing === -1 ? Math.abs(enemy.sprite.scale.x) : -Math.abs(enemy.sprite.scale.x)
            // Накопительный стан-резист (см. STUN_LIMIT/POISE_IMMUNE_MS) —
            // иммунитет тикает вниз каждый кадр независимо от анимации.
            enemy.poiseImmuneTimer = Math.max(0, enemy.poiseImmuneTimer - ticker.deltaMS)
          }
          // Y отрисовки — поверхность тайла под ногами (findGroundSurfaceY),
          // а НЕ низ хитбокса; низ хитбокса — только запасной вариант, когда
          // враг в воздухе (упал с края) и под ним прямо сейчас нет тверди.
          const enemyFootBottom = enemy.y + C.ENEMY_HEIGHT
          const enemySurfaceY = findGroundSurfaceY(enemy.x, C.ENEMY_WIDTH, enemyFootBottom)
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

        // Босс карты C (ФАЗА 2, шаги 4-5, см. задачу) — передвижение к
        // герою + ближний бой (2 атаки, см. visual-sync ниже): агро
        // (BOSS_AGGRO_RANGE_TILES, sameFloor — та же проверка, что у зверя)
        // + ходьба со стоп-дистанцией/гистерезисом + разворот facing.
        // Патруля НЕТ — вне агро босс просто стоит. Твёрдость для героя
        // ТОЛЬКО по горизонтали (pushPlayerOutX, как у врага/сундука/
        // обелиска — герой не проходит сквозь, но может перепрыгнуть сверху,
        // вставать на босса нельзя).
        if (bossRef.current) {
          const boss = bossRef.current

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
            const bossBlockTop = sweepFootBlock(grid, C.TILE_SIZE, boss.x, C.BOSS_WIDTH, prevBossFootY, bossFootY)
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
              const playerCombatBox = getPlayerCombatBox()
              const bossCenterX = boss.x + C.BOSS_WIDTH / 2
              const dx = (playerCombatBox.x + playerCombatBox.w / 2) - bossCenterX
              const dist = Math.abs(dx)

              // sameFloor — ТА ЖЕ проверка, что у зверя (по ногам, не по
              // верхней точке — рост игрока и босса разный), включая
              // SAME_FLOOR_TOLERANCE_TILES вместо узкой FLOOR_Y_TOLERANCE —
              // иначе прыжок героя формально снимал агро (см. задачу).
              const bossFeetYNow = boss.y + C.BOSS_HEIGHT
              const playerFeetYNow = phys.y + C.PLAYER_HEIGHT
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
                      isSolid(grid, C.TILE_SIZE, leadingX, boss.y + 1) ||
                      isSolid(grid, C.TILE_SIZE, leadingX, boss.y + C.BOSS_HEIGHT / 2) ||
                      isSolid(grid, C.TILE_SIZE, leadingX, boss.y + C.BOSS_HEIGHT - 1)
                    // Край площадки впереди — ТА ЖЕ проверка, что в патруле у
                    // зверя (noFloorAhead): в погоне зверь падать МОЖЕТ, но
                    // боссу это запрещено (см. задачу, п.6) — переиспользуем
                    // проверку из патруля, не пишем новую.
                    const footCx = Math.floor(leadingX / C.TILE_SIZE)
                    const footCy = Math.floor((boss.y + C.BOSS_HEIGHT) / C.TILE_SIZE)
                    const noFloorAhead = cellFootBlockTop(grid, C.TILE_SIZE, footCx, footCy) === null
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
                  boss.rangedCooldownTimer = Math.max(0, boss.rangedCooldownTimer - ticker.deltaMS)
                }

                // Кулдаун атаки (ФАЗА 2, шаг 5, см. задачу, п.4) — считается
                // ВНИЗ до 0 (тот же приём, что enemy.attackTimer у зверя),
                // выставляется на BOSS_ATTACK_COOLDOWN_MS ПОСЛЕ конца анимации
                // атаки (см. visual-sync ниже), не после урона.
                if (boss.attackCooldownTimer > 0) {
                  boss.attackCooldownTimer = Math.max(0, boss.attackCooldownTimer - ticker.deltaMS)
                }
                // Кулдаун топота (ФАЗА 4, шаг 1, см. задачу) — тот же приём,
                // что у ranged/attack выше.
                if (boss.stompCooldownTimer > 0) {
                  boss.stompCooldownTimer = Math.max(0, boss.stompCooldownTimer - ticker.deltaMS)
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
              playBossAnim(kind)
              const strikeFrame = kind === 'melee' ? C.BOSS_MELEE_STRIKE_FRAME : C.BOSS_MELEE2_STRIKE_FRAME
              const damage = kind === 'melee' ? C.BOSS_MELEE_DAMAGE : C.BOSS_MELEE2_DAMAGE
              const range = kind === 'melee' ? C.BOSS_MELEE_RANGE : C.BOSS_MELEE2_RANGE
              const kindFrames = bossFramesByKind[kind]
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
                const strikePlayerBox = getPlayerCombatBox()
                const overlap =
                  strikePlayerBox.x < zone.x + zone.width &&
                  strikePlayerBox.x + strikePlayerBox.w > zone.x &&
                  strikePlayerBox.y < zone.y + zone.height &&
                  strikePlayerBox.y + strikePlayerBox.h > zone.y
                if (overlap && dodgeIframeRef.current <= 0) {
                  takeDamageRef.current(damage)
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
              playBossAnim('stomp')
              const stompFrames = bossFramesByKind.stomp
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
              playBossAnim('ranged')
              const rangedFrames = bossFramesByKind.ranged
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
              boss.hurtTimer = Math.max(0, boss.hurtTimer - ticker.deltaMS)
              playBossAnim('hurt')
            } else {
              playBossAnim(boss.moving ? 'walk' : 'idle')
            }
            // Вспышка попадания (СЛОИ 1/2, см. задачу) — визуальная замена
            // Hurt в моменты, когда сам Hurt не проигрывается (во время
            // атаки — ВСЕГДА, вне атаки — под иммунитетом poiseImmuneTimer):
            // тикает вниз каждый кадр независимо от ветки выше, danger-tint
            // на спрайте, пока активна.
            boss.hitFlashTimer = Math.max(0, boss.hitFlashTimer - ticker.deltaMS)
            boss.sprite.tint = boss.hitFlashTimer > 0 ? 0xe0353b : 0xffffff
            // Накопительный стан-резист (СЛОЙ 2, см. задачу) — тикает вниз
            // каждый кадр, как у зверя (STUN_LIMIT/POISE_IMMUNE_MS там,
            // BOSS_STUN_LIMIT/BOSS_POISE_IMMUNE_MS здесь).
            boss.poiseImmuneTimer = Math.max(0, boss.poiseImmuneTimer - ticker.deltaMS)

            // Push-out — ПОСЛЕ движения (boss.x этого кадра уже финален), как
            // у зверя (см. его pushPlayerOutX ниже по коду выше в enemy-цикле).
            // ТОЛЬКО пока жив (см. задачу, п.3) — мёртвый босс не толкает
            // героя, тело проходимо.
            pushPlayerOutX({ x: boss.x, y: boss.y, width: C.BOSS_WIDTH, height: C.BOSS_HEIGHT }, getPlayerCombatBox())

            applyBossLayout(boss)
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
            const deathFrames = bossFramesByKind.death
            const deathDone = boss.sprite.currentFrame >= deathFrames.length - 1 || !boss.sprite.playing
            if (deathDone && !boss.rewardGiven) {
              boss.rewardGiven = true
              const amount = rollTrophies(C.TROPHY_MULT_BOSS)
              spawnRewardFloat(boss.sprite.x, boss.sprite.y - boss.sprite.height, [
                { kind: 'trophy', amount },
              ])
              if (bossEventIndexRef.current !== null) closeEvent(bossEventIndexRef.current)
            }
          }
        }

        // Летящие шипы дальней атаки босса (ФАЗА 3, шаг 3, см. задачу) —
        // независимый от bossRef список (по образцу rewardFloatsRef ниже):
        // шип, брошенный до смерти босса, должен долетать сам по себе.
        // Баллистическая дуга (BOSS_SPIKE_GRAVITY, vy подобрана при спавне на
        // попадание в героя — см. spawnBossSpike), НЕ прямая горизонтальная.
        // Попадание в героя — тем же getPlayerCombatBox()/dodgeIframeRef, что
        // и melee-удар босса выше (не пишем свою проверку). dtSec — своя
        // переменная (НЕ путать с внешним ticker-scale dt=ticker.deltaTime,
        // здесь нужны реальные секунды).
        if (bossSpikesRef.current.length > 0) {
          const stillFlying: BossSpike[] = []
          for (const spike of bossSpikesRef.current) {
            const dtSec = ticker.deltaMS / 1000
            spike.vy += C.BOSS_SPIKE_GRAVITY * dtSec
            const vx = spike.dir * C.BOSS_SPIKE_SPEED_X
            spike.sprite.x += vx * dtSec
            spike.sprite.y += spike.vy * dtSec
            // Остриё на исходном PNG смотрит ВЛЕВО (см. задачу) — поворот
            // спрайта по направлению полёта ВМЕСТО зеркалирования (scale.x
            // остаётся положительным, см. spawnBossSpike).
            spike.sprite.rotation = Math.atan2(-spike.vy, -vx)
            spike.lifeMs += ticker.deltaMS

            let remove = spike.lifeMs >= C.BOSS_SPIKE_LIFETIME_MS

            // Падение на пол (см. задачу, п.6) — с гравитацией шип может
            // промахнуться и уйти вниз. isSolid — твердь '#' (и края карты),
            // isPlatformBandBlocking — верхняя полоса '=' (обе уже
            // используются в файле для той же проверки, новой не пишем).
            if (!remove && !spike.hitApplied) {
              const groundHit =
                isSolid(grid, C.TILE_SIZE, spike.sprite.x, spike.sprite.y) ||
                isPlatformBandBlocking(grid, C.TILE_SIZE, spike.sprite.x, spike.sprite.y, spike.sprite.y + 1) !== null
              if (groundHit) {
                spike.hitApplied = true
                remove = true
                spawnBossSpikeImpact(spike.sprite.x, spike.sprite.y)
              }
            }

            if (!remove && !spike.hitApplied) {
              const box = getPlayerCombatBox()
              const spikeLeft = spike.sprite.x - C.BOSS_SPIKE_DRAW_W / 2
              const spikeTop = spike.sprite.y - C.BOSS_SPIKE_DRAW_H / 2
              const overlap =
                box.x < spikeLeft + C.BOSS_SPIKE_DRAW_W &&
                box.x + box.w > spikeLeft &&
                box.y < spikeTop + C.BOSS_SPIKE_DRAW_H &&
                box.y + box.h > spikeTop
              // dodgeIframeRef активен — шип пролетает насквозь, без урона и
              // без импакта (см. задачу, п.7 — не трогаем).
              if (overlap && dodgeIframeRef.current <= 0) {
                spike.hitApplied = true
                remove = true
                takeDamageRef.current(C.BOSS_RANGED_DAMAGE)
                spawnBossSpikeImpact(spike.sprite.x, spike.sprite.y)
              }
            }

            if (remove) {
              worldContainer.removeChild(spike.sprite)
              spike.sprite.destroy()
            } else {
              stillFlying.push(spike)
            }
          }
          bossSpikesRef.current = stillFlying
        }

        // AoE-волны топота босса (см. задачу) — независимый от bossRef список
        // (по образцу bossSpikesRef выше): волна, рождённая до смерти/despawn
        // босса, должна докатиться сама по себе. Y НЕ меняется — катится по
        // земле, гравитации нет (в отличие от шипа). Уклонение ТОЛЬКО
        // прыжком — dodgeIframeRef здесь НЕ учитывается (см. задачу, п.7):
        // герой в прыжке физически выше волны своим боевым боксом, пересечения
        // не будет само собой.
        if (bossWavesRef.current.length > 0) {
          const stillRolling: BossWave[] = []
          for (const w of bossWavesRef.current) {
            const dt = ticker.deltaMS / 1000
            w.sprite.x += w.dir * C.BOSS_WAVE_SPEED * dt
            w.lifeMs += ticker.deltaMS

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
              if (isSolid(grid, C.TILE_SIZE, frontX, centerY)) {
                remove = true
              }
            }

            // Попадание в героя (см. задачу, п.7) — тем же getPlayerCombatBox(),
            // что и у шипа, НО БЕЗ dodgeIframeRef (уклонение только прыжком).
            // Каждая волна бьёт максимум один раз.
            if (!remove && !w.hitApplied) {
              const box = getPlayerCombatBox()
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
                takeDamageRef.current(C.BOSS_WAVE_DAMAGE)
              }
            }

            if (remove) {
              worldContainer.removeChild(w.sprite)
              w.sprite.destroy()
            } else {
              stillRolling.push(w)
            }
          }
          bossWavesRef.current = stillRolling
        }

        // Сундуки: завершение анимации открытия (тем же способом, каким
        // определяется конец attack/hurt у героя — конец текстур ИЛИ спрайт
        // сам остановился) + мягкая стена по X (та же pushPlayerOutX, что и
        // у живого врага выше). Хитбокс остаётся ВСЕГДА, и закрытый, и
        // открытый — не убирается при opened. Свежий playerCombatBox
        // считаем здесь же — push-out врагов выше уже мог сдвинуть phys.x.
        for (const chest of chestsRef.current) {
          // Пересчитывается КАЖДЫЙ кадр (не только на смене состояния) — та
          // же защита от "сундук съезжает вниз" (см. историю), что и на
          // spawn/hit-start/complete ниже.
          applyChestLayout(chest)

          // Набор кадров зависит от исхода броска (см. isMimic на первом
          // ударе выше) — чтение currentFrame/length ниже должно сверяться
          // с ПРАВИЛЬНЫМ набором, иначе мимик (14 кадров) либо обрывается
          // раньше времени, либо никогда не считается "доигравшим" по длине
          // доброго набора (13 кадров).
          const activeFrames = chest.isMimic ? chestTrapFrames : chestFrames

          // Урон мимика — на strike-кадре взрыва, неизбежен (без уклонения,
          // без i-frames шипов — отдельный источник урона). Бьёт РОВНО один
          // раз за срабатывание (trapDamaged-гейт).
          if (
            chest.opening &&
            chest.isMimic &&
            !chest.trapDamaged &&
            chest.sprite.currentFrame >= C.CHEST_TRAP_STRIKE_FRAME
          ) {
            chest.trapDamaged = true
            takeDamageRef.current(maxHp * C.CHEST_TRAP_DAMAGE_FRAC)
          }

          if (chest.opening && (chest.sprite.currentFrame >= activeFrames.length - 1 || !chest.sprite.playing)) {
            chest.opening = false
            chest.opened = true
            // Явно держим последний кадр — AnimatedSprite без loop сам
            // должен так делать, но фиксируем на всякий случай (см. задачу):
            // stop() + gotoAndStop(последний) + visible=true, чтобы сундук
            // не пропадал после проигрывания.
            chest.sprite.stop()
            chest.sprite.gotoAndStop(activeFrames.length - 1) // держим последний кадр (открыт/гарь)
            applyChestLayout(chest)
            chest.sprite.visible = true
            closeEvent(chest.eventIndex)
            // Награда — ТОЛЬКО добрый исход, трофеями по общей формуле (см.
            // задачу): реальное начисление player.trophies живёт на сервере,
            // здесь только попап.
            if (!chest.isMimic) {
              spawnRewardFloat(chest.sprite.x, chest.sprite.y - chest.sprite.height, [
                { kind: 'trophy', amount: rollTrophies(C.TROPHY_MULT_CHEST) },
              ])
            }
          }
          pushPlayerOutX(chest.hitbox, getPlayerCombatBox())
        }

        // Обелиски: стена по X (та же pushPlayerOutX, что у сундука) — и
        // после удара по обелиску тоже (см. задачу). Спрайт/хитбокс не
        // пересчитываются здесь — заданы один раз при спавне из констант.
        for (const obelisk of obelisksRef.current) {
          pushPlayerOutX(obelisk.hitbox, getPlayerCombatBox())
        }

        // Смуглеры: посадка из констант (SMUGGLER_DRAW_H/SMUGGLER_OFFSET_Y,
        // подобраны вживую отладочным тюнером, убран — см. историю) + поворот
        // к игроку. НЕ стена — pushPlayerOutX для смуглера НЕ вызывается (см.
        // задачу), сквозь него можно пройти.
        for (const smuggler of smugglersRef.current) {
          smuggler.sprite.height = C.SMUGGLER_DRAW_H
          smuggler.sprite.width = C.SMUGGLER_DRAW_H * (230 / 296)
          smuggler.sprite.y = smuggler.floorY + C.SMUGGLER_OFFSET_Y

          // Спрайт смотрит ВПРАВО по умолчанию (facing=1 → scale.x
          // положительный, БЕЗ зеркала). Поворот — только пока игрок в
          // пределах SMUGGLER_TURN_RANGE; дальше facing держит последнее
          // значение (не дёргается на границе дальности).
          const playerCenterX = phys.x + C.PLAYER_WIDTH / 2
          const dx = playerCenterX - smuggler.sprite.x
          if (Math.abs(dx) <= C.SMUGGLER_TURN_RANGE) {
            smuggler.facing = dx < 0 ? -1 : 1
          }
          smuggler.sprite.scale.x =
            smuggler.facing === 1 ? Math.abs(smuggler.sprite.scale.x) : -Math.abs(smuggler.sprite.scale.x)
        }

        // Панель Смуглера: позиция над головой активного смуглера (см.
        // smugglerActiveRef, выставляется в блоке dodge выше), автозакрытие
        // (флаг + visible=false, событие НЕ закрывается), если игрок отошёл
        // дальше SMUGGLER_INTERACT_RANGE/этаж или событие уже закрыто иначе.
        const activeSmuggler = smugglerActiveRef.current
        if (smugglerPanelOpenRef.current && activeSmuggler) {
          const ownerEvent = eventsRef.current[activeSmuggler.eventIndex]
          const playerCenterXForPanel = phys.x + C.PLAYER_WIDTH / 2
          const playerFeetYForPanel = phys.y + C.PLAYER_HEIGHT
          const stillNear =
            Math.abs(playerCenterXForPanel - activeSmuggler.sprite.x) <= C.SMUGGLER_INTERACT_RANGE &&
            Math.abs(playerFeetYForPanel - activeSmuggler.floorY) <= C.FLOOR_Y_TOLERANCE * C.TILE_SIZE
          if (!ownerEvent || ownerEvent.closed || !stillNear) {
            smugglerPanelOpenRef.current = false
            smugglerPanel.visible = false
          } else {
            const desiredWorldX = activeSmuggler.sprite.x - C.SMUGGLER_PANEL_W / 2
            const desiredWorldY = activeSmuggler.sprite.y - C.SMUGGLER_DRAW_H - C.SMUGGLER_PANEL_H - 10

            // Панель — ребёнок worldContainer (мировые координаты, двигается
            // и зумится камерой) — рядом с краем карты желаемая позиция может
            // уехать за пределы экрана. Переводим в экранные координаты
            // (toGlobal), зажимаем в границах app.screen с полем MARGIN,
            // переводим обратно в мировые (toLocal) — так окно у края карты
            // сдвигается внутрь вьюпорта, а в остальных случаях (запас есть)
            // ведёт себя как раньше, без видимой разницы.
            const topLeftScreen = worldContainer.toGlobal({ x: desiredWorldX, y: desiredWorldY })
            const clampedScreenX = clamp(
              topLeftScreen.x,
              C.SMUGGLER_PANEL_MARGIN,
              app!.screen.width - C.SMUGGLER_PANEL_W * C.WORLD_SCALE - C.SMUGGLER_PANEL_MARGIN
            )
            const clampedScreenY = clamp(
              topLeftScreen.y,
              C.SMUGGLER_PANEL_MARGIN,
              app!.screen.height - C.SMUGGLER_PANEL_H * C.WORLD_SCALE - C.SMUGGLER_PANEL_MARGIN
            )
            const clampedWorld = worldContainer.toLocal({ x: clampedScreenX, y: clampedScreenY })
            smugglerPanel.x = clampedWorld.x
            smugglerPanel.y = clampedWorld.y
            smugglerPanel.visible = true
          }
        } else {
          smugglerPanel.visible = false
        }

        player.x = phys.x
        player.y = phys.y

        // Ноги героя (anchor 0.5,1.0 — низ-центр) — Y берём с поверхности
        // тайла (findGroundSurfaceY), а не с низа хитбокса напрямую; низ
        // хитбокса остаётся запасным вариантом на случай, если герой сейчас
        // в воздухе (под ногами прямо сейчас нет тверди — прыжок/падение).
        if (heroSpriteRef.current) {
          const heroFootBottom = player.y + C.PLAYER_HEIGHT
          const heroSurfaceY = findGroundSurfaceY(player.x, C.PLAYER_WIDTH, heroFootBottom)
          heroSpriteRef.current.x = player.x + C.PLAYER_WIDTH / 2
          heroSpriteRef.current.y = (heroSurfaceY ?? heroFootBottom) + C.FOOT_TUNE
        }

        // Приоритет анимаций героя (сверху вниз):
        // 0) смерть — АБСОЛЮТНЫЙ приоритет, пока deathRef.current истинен,
        //    ничего из веток ниже не выполняется (прыжок/hurt/питьё/атака/
        //    land/run больше не могут перебить падение);
        // а) в воздухе — позы прыжка, land/атака/hurt сбрасываются (прыжок
        //    прерывает замах и не тянет hurt на землю); питьё можно начать
        //    только на земле (см. drinkPressedRef-обработчик), поэтому сюда
        //    не заходит — jump-ветка его не трогает;
        // б) hurt в процессе — ГЛАВНЕЕ питья/атаки/land/run, пока таймер > 0
        //    (хитстан обрывает и замах, и питьё — см. triggerHurt);
        // в) питьё зелья в процессе — ТОЛЬКО визуал (см. drinkingRef), герой
        //    закоренён (ввод движения/прыжка/атаки/dodge игнорируется выше
        //    по тикеру); прервать может только hurt/death (приоритет выше);
        // г) атака в процессе — урон ровно один раз на кадре удара
        //    (ATTACK_STRIKE_FRAME), НЕ на нажатии; land ниже по приоритету —
        //    атака его не даёт начать, пока идёт;
        // д) на земле, land ещё идёт И нет горизонтального ввода — доигрываем
        //    land (движение прерывает его — переход в ветку е);
        // е) обычный idle/run по движению.
        if (deathRef.current) {
          // Доиграла — замираем на последнем кадре и копим удержание;
          // abandon срабатывает РОВНО один раз (deathAbandonFiredRef).
          if (hero.currentFrame >= deathFrames.length - 1) {
            hero.gotoAndStop(deathFrames.length - 1)
            deathHoldRef.current += ticker.deltaMS
            if (deathHoldRef.current >= C.DEATH_HOLD_MS && !deathAbandonFiredRef.current) {
              deathAbandonFiredRef.current = true
              onClose?.()
            }
          }
          hero.anchor.set(0.5, C.GROUND_ANCHOR_Y)
        } else if (!phys.onGround) {
          const rising = phys.vy < 0
          hero.textures = jumpFrames
          hero.loop = false
          hero.gotoAndStop(rising ? C.RISE_FRAME : C.FALL_FRAME)
          hero.anchor.set(0.5, rising ? C.RISE_ANCHOR_Y : C.FALL_ANCHOR_Y)
          landTimerRef.current = 0
          attackingRef.current = false // прыжок отменяет замах
          hurtTimerRef.current = 0 // в воздухе — прыжок, hurt не тянем на землю
        } else if (hurtTimerRef.current > 0) {
          hurtTimerRef.current = Math.max(0, hurtTimerRef.current - ticker.deltaMS)
          hero.anchor.set(0.5, C.GROUND_ANCHOR_Y)
          if (hero.textures !== hurtFrames) {
            hero.textures = hurtFrames
            hero.loop = false
            hero.animationSpeed = C.HURT_ANIM_SPEED
            hero.gotoAndPlay(0)
          }
        } else if (drinkingRef.current) {
          // Хил — РОВНО один раз за питьё, на кадре глотка (не на нажатии
          // кнопки). Если hurt/death оборвали питьё РАНЬШЕ этого кадра
          // (drinkingRef уже сброшен triggerHurt/triggerDeath — эта ветка
          // просто не выполнится), potionHealedThisDrinkRef останется false,
          // и заряд/хил/кулдаун не применятся — как и требовалось.
          if (!potionHealedThisDrinkRef.current && hero.currentFrame >= C.POTION_GULP_FRAME) {
            potionHealedThisDrinkRef.current = true
            hpRef.current = Math.min(maxHp, hpRef.current + maxHp * C.POTION_HEAL_FRAC)
            updateHpBar()
            potionChargesRef.current -= 1
            potionCdRef.current = C.POTION_COOLDOWN
            updatePotionButton()
          }
          // Доиграла (тот же способ определения конца, что у атаки: конец
          // текстур ИЛИ спрайт сам остановился) — сбрасываем и со следующего
          // тика подхватывает idle/run.
          if (hero.currentFrame >= drinkFrames.length - 1 || !hero.playing) {
            drinkingRef.current = false
          }
          hero.anchor.set(0.5, C.GROUND_ANCHOR_Y)
        } else if (attackingRef.current) {
          if (!attackHitDoneRef.current && hero.currentFrame >= C.ATTACK_STRIKE_FRAME) {
            applyAttackHit()
            attackHitDoneRef.current = true
          }
          if (hero.currentFrame >= attackFrames.length - 1 || !hero.playing) {
            attackingRef.current = false // доиграла — idle/run подхватит со следующего тика
          }
          hero.anchor.set(0.5, C.GROUND_ANCHOR_Y)
        } else if (landTimerRef.current > 0 && dirRef.current === 0) {
          landTimerRef.current = Math.max(0, landTimerRef.current - ticker.deltaMS)
          hero.anchor.set(0.5, C.GROUND_ANCHOR_Y)
          if (hero.textures !== landFrames) {
            hero.textures = landFrames
            hero.loop = false
            hero.animationSpeed = 0.5
            hero.gotoAndPlay(0)
          }
        } else {
          // Сюда же попадает прерывание land движением (dirRef.current !== 0
          // при landTimerRef.current > 0) — таймер обнуляется и играется
          // обычная idle/run логика с этого же кадра.
          landTimerRef.current = 0
          hero.anchor.set(0.5, C.GROUND_ANCHOR_Y)
          playAnim(dirRef.current !== 0 ? runFrames : idleFrames, dirRef.current !== 0 ? 0.37 : 0.15, true)
        }
        // Флип по facingRef (последнее ненулевое направление — не сбрасывается
        // в 0, в отличие от dirRef, так что герой не разворачивается лицом
        // вправо каждый раз, когда отпускаешь кнопку движения стоя на месте) —
        // работает во всех ветках, применяется всегда. Во время атаки — facing
        // ЗАФИКСИРОВАН на attackFacingRef (снят на старте замаха), не следует
        // за вводом до конца анимации.
        const heroFlipDir = attackingRef.current ? attackFacingRef.current : facingRef.current
        hero.scale.x = heroFlipDir === 1 ? Math.abs(hero.scale.x) : -Math.abs(hero.scale.x)

        // Плавающие попапы наград (см. RewardFloat/spawnRewardFloat выше) —
        // независимая от игровой логики анимация, реальное время
        // (ticker.deltaMS), не масштабированное по dt-кадрам как движение.
        if (rewardFloatsRef.current.length > 0) {
          const stillActive: RewardFloat[] = []
          for (const rf of rewardFloatsRef.current) {
            rf.elapsed += ticker.deltaMS
            const progress = Math.min(1, rf.elapsed / C.REWARD_FLOAT_MS)
            const eased = 1 - (1 - progress) * (1 - progress) // ease-out
            rf.node.y = rf.startY - C.REWARD_FLOAT_RISE * eased
            if (progress < 0.15) {
              rf.node.alpha = progress / 0.15
            } else if (progress > 0.65) {
              rf.node.alpha = Math.max(0, (1 - progress) / 0.35)
            } else {
              rf.node.alpha = 1
            }
            if (rf.elapsed >= C.REWARD_FLOAT_MS) {
              worldContainer.removeChild(rf.node)
              rf.node.destroy({ children: true })
            } else {
              stillActive.push(rf)
            }
          }
          rewardFloatsRef.current = stillActive
        }

        updateCamera(dt)
      })
    }

    setup()

    return () => {
      cancelled = true
      // destroy() только если init() реально завершился — до этого у app нет
      // внутренностей, на которые destroy() рассчитывает (см. комментарий
      // у объявления initialized выше).
      if (app && initialized) {
        try {
          if (onBgResize) app.renderer.off('resize', onBgResize)
          app.destroy(true, { children: true })
        } catch {
          // Гонка с веткой "cancelled после init" в setup() — игнорируем.
        }
      }
      appRef.current = null
      heroSpriteRef.current = null
      // Узлы сами уничтожаются деревом app.destroy(true, {children:true})
      // выше — здесь только сбрасываем список, чтобы не держать ссылки на
      // уже уничтоженные Container при повторном mount (StrictMode).
      rewardFloatsRef.current = []
      bossSpikesRef.current = []
      bossWavesRef.current = []
    }
    // TEMP: map switcher — mapFile в зависимостях, чтобы смена карты через
    // временный переключатель (см. панель настроек ниже) перезапускала этот
    // эффект целиком; существующий cleanup выше уже корректно уничтожает
    // app, отдельный механизм не нужен.
  }, [mapFile])

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 1000,
        background: '#0d0820',
        overflow: 'hidden',
      }}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Keyframes для пульсации кольца "событие завершено" (см. гнёзда
          иконок ниже) — только opacity тени, layout не трогает. Инлайн-стили
          React не поддерживают @keyframes, поэтому один глобальный <style>. */}
      <style>{`
        @keyframes eventRingPulse {
          0%, 100% { box-shadow: 0 0 8px 2px rgba(232,178,58,0.6), 0 0 16px 4px rgba(232,178,58,0.3); }
          50% { box-shadow: 0 0 8px 2px rgba(232,178,58,0.9), 0 0 16px 4px rgba(232,178,58,0.5); }
        }
        @keyframes obeliskTimerPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.55; }
        }
      `}</style>

      {/* HUD события обелисков (карта F, см. задачу) — таймер + счётчик
          сбитых, fixed сверху по центру, safe-area aware, только пока
          событие активно. pointerEvents: none — не перехватывает тапы. */}
      {obeliskHud?.active && (
        <div
          style={{
            position: 'fixed',
            top: 'calc(env(safe-area-inset-top) + 6px)',
            // Центр по ПРОСВЕТУ между HP-плитой (left:8 + HP_FRAME_W) и
            // шестерёнкой (SETTINGS_BTN_RIGHT + SETTINGS_BTN_SIZE от правого
            // края) — left+right без width, браузер сам считает ширину блока
            // как промежуток между границами (не left:50%+transform).
            left: `calc(8px + ${C.HP_FRAME_W} + 8px)`,
            right: C.SETTINGS_BTN_RIGHT + C.SETTINGS_BTN_SIZE + 8,
            zIndex: 1001,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              fontFamily: C.FONT_DISPLAY,
              fontSize: 'clamp(20px, 6vw, 34px)',
              fontWeight: 900,
              letterSpacing: '0.02em',
              lineHeight: 1,
              whiteSpace: 'nowrap',
              color: obeliskHud.secondsLeft < 10 ? '#E0353B' : '#EDE7F2',
              textShadow: '0 2px 4px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.9)',
              animation: obeliskHud.secondsLeft < 10 ? 'obeliskTimerPulse 0.8s ease-in-out infinite' : 'none',
            }}
          >
            {Math.floor(obeliskHud.secondsLeft / 60)}:{String(obeliskHud.secondsLeft % 60).padStart(2, '0')}
          </div>
          <div
            style={{
              fontFamily: C.FONT_DISPLAY,
              fontSize: 'clamp(10px, 3vw, 17px)',
              fontWeight: 700,
              lineHeight: 1,
              marginTop: 4,
              whiteSpace: 'nowrap',
              color: obeliskHud.struck >= C.OBELISK_TOTAL - 1 ? '#E8B23A' : '#9C93AD',
              textShadow: '0 1px 3px rgba(0,0,0,0.85)',
            }}
          >
            {obeliskHud.struck}/{C.OBELISK_TOTAL - 1}
          </div>
        </div>
      )}

      <HudPlate
        hpFillRef={hpFillRef}
        hpTextRef={hpTextRef}
        maxHp={maxHp}
        eventClosed={eventClosed}
        eventKinds={eventKinds}
      />

      <SettingsPanel mapFile={mapFile} onSelectMap={setMapFile} onClose={onClose} />

      <TouchControls
        dirRef={dirRef}
        jumpPressedRef={jumpPressedRef}
        attackPressedRef={attackPressedRef}
        dodgePressedRef={dodgePressedRef}
        drinkPressedRef={drinkPressedRef}
        potionBtnRef={potionBtnRef}
        updatePotionButton={updatePotionButton}
      />
    </div>
  )
}
