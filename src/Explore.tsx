import { useEffect, useRef, useState } from 'react'
import { Application, Assets, AnimatedSprite, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js'
import { renderMapToCanvas, PLATFORM_H_RATIO, SPIKE_H_RATIO } from './mapRenderer'

type ExploreProps = {
  onClose?: () => void
  endurance?: number
  strength?: number
  // Временный каркас "3 события за забег": вызывается ровно один раз, когда
  // все 3 выбранных события закрыты. kind — 'enemy'|'chest'|'smuggler'|'puzzle'|
  // 'boss', совпадает с ключами ROOM_LABELS в App.tsx.
  onRunComplete?: (closedEvents: { kind: EventKind }[]) => void
}

const MAP_FILE = 'map_A_serpentine.txt' // TODO: сделать выбираемым, когда появится выбор карты в UI

// Слот-файл называется по mapId, а не по полному имени карты: map_A_serpentine.txt
// и map_C_boss_descent.txt (два слова после id) оба -> map_<id>_slots.json.
// Берём именно первый токен после "map_", а не отбрасываем последний "_xxx.txt" —
// иначе на многословных именах (boss_descent) получим не тот файл.
function slotsFileForMap(mapFile: string): string {
  const mapId = mapFile.match(/^map_([^_]+)_/)?.[1] ?? mapFile
  return `map_${mapId}_slots.json`
}

const TILE_SIZE = 64
const PLAYER_COLOR = 0xe0353b
const PLAYER_WIDTH = TILE_SIZE
const PLAYER_HEIGHT = TILE_SIZE * 2

// Визуал героя (спрайт поверх хитбокса-прямоугольника — см. HERO_IDLE_SRC
// ниже). Хитбокс/физика игрока (PLAYER_WIDTH/PLAYER_HEIGHT выше) НЕ меняются
// заменой визуала — прямоугольник остаётся, просто visible=false.
const HERO_DRAW_H = 140 // высота отрисовки героя в пикселях мира (подбирается на глаз)
// Тот же способ формирования пути (BASE_URL), что у HP_FRAME_SRC — работает
// и на GitHub Pages с префиксом.
const HERO_IDLE_SRC = `${import.meta.env.BASE_URL}assets/sprites/hero/idle.png`
const HERO_RUN_SRC = `${import.meta.env.BASE_URL}assets/sprites/hero/run.png`
const HERO_JUMP_SRC = `${import.meta.env.BASE_URL}assets/sprites/hero/jump.png`
const HERO_ATTACK_SRC = `${import.meta.env.BASE_URL}assets/sprites/hero/attack.png`
const HERO_HURT_SRC = `${import.meta.env.BASE_URL}assets/sprites/hero/hurt.png`
const HERO_DEATH_SRC = `${import.meta.env.BASE_URL}assets/sprites/hero/death.png`

// Спрайты зверя (Шаг "спрайт зверя, без AI/флипа") — тот же способ пути
// (BASE_URL) и тот же loadSheetFrames (12 колонок в ряд), что у героя выше.
// Высота клетки везде 288 (как у героя), НО ширина клетки разная по анимациям
// (idle/attack/hurt — 481, walk — 418, death — 537) — не сводить к одной
// общей ширине, каждая грузится своим cellW (см. loadSheetFrames-вызовы ниже).
const BEAST_IDLE_SRC = `${import.meta.env.BASE_URL}assets/sprites/beast/idle.png`
const BEAST_WALK_SRC = `${import.meta.env.BASE_URL}assets/sprites/beast/walk.png`
const BEAST_ATTACK_SRC = `${import.meta.env.BASE_URL}assets/sprites/beast/attack.png`
const BEAST_HURT_SRC = `${import.meta.env.BASE_URL}assets/sprites/beast/hurt.png`
const BEAST_DEATH_SRC = `${import.meta.env.BASE_URL}assets/sprites/beast/death.png`
// Высота отрисовки зверя в пикселях мира (по образцу HERO_DRAW_H выше) —
// уменьшено на 30% (было 180) по правке размера. Масштаб спрайта = эта
// константа / 288 (высота клетки, одна и та же для всех анимаций зверя) —
// см. применение в spawnEnemy, размер нигде не хардкодится мимо неё.
const BEAST_CELL_RENDER_H = 126
// idle зверя — 24 кадра, полный цикл дыхания ~2.4с (медленно, спокойно):
// 24 кадра / 2.4с = 10 кадров/сек, AnimatedSprite.animationSpeed — доля от
// 60 кадров/сек тикера (тот же способ проигрывания, что у героя — play() +
// общий Ticker, без ручного продвижения кадров).
const BEAST_IDLE_ANIM_SPEED = 10 / 60

// Прыжок пока БЕЗ проигрывания — статичная поза по вертикальной скорости
// (взлёт/падение), см. использование в тикере. Индексы 0-based.
const RISE_FRAME = 9 // кадр 10 = взлёт
const FALL_FRAME = 14 // кадр 15 = падение
// У кадров взлёта/падения ноги подняты внутри клетки — якорь ниже, чем у
// idle/run (GROUND_ANCHOR_Y=1.0), иначе герой "проваливается" визуально.
const RISE_ANCHOR_Y = 0.729
const FALL_ANCHOR_Y = 0.816
const GROUND_ANCHOR_Y = 1

// Land — короткая анимация приземления, играется один раз при касании земли
// (см. landTimerRef), прерывается движением/прыжком. Подпоследовательность
// последних кадров jumpFrames (индексы 17..23), не отдельный спрайт-лист.
const LAND_MS = 260

// Атака — урон теперь привязан к КАДРУ анимации (см. applyAttackHit в setup),
// не к моменту нажатия. Индекс 0-based.
const ATTACK_STRIKE_FRAME = 6 // 7-й кадр из 14 — момент удара
const ATTACK_ANIM_SPEED = 0.5

// Hurt — хардкор-вариант: обрывает собственный замах атаки (хитстан) и на
// это время блокирует начало новой атаки (см. triggerHurt/attackPressedRef).
const HURT_MS = 350
const HURT_ANIM_SPEED = 0.45

// Смерть — играется один раз, последний кадр держится DEATH_HOLD_MS, потом
// тот же abandon, что раньше срабатывал сразу при hp<=0 (см. triggerDeath).
const DEATH_HOLD_MS = 500
const DEATH_ANIM_SPEED = 0.4

const HP_PER_ENDURANCE = 8 // как в бою: 1 Endurance = 8 HP
const FALLBACK_MAX_HP = 80 // если endurance ещё не прокинут/недоступен

// Арт-плита HP-бара (каменная оправа с портретом героя + тёмная ниша под
// полосу + 3 гнезда под иконки событий). Ширина отрисовки — доля экрана с
// потолком/полом в px, чтобы не раздувался гигантским на широких экранах;
// высота — из пропорции картинки. Все числа ниже подобраны вживую временным
// тюнером (снят после подгонки).
const HP_FRAME_SRC = `${import.meta.env.BASE_URL}assets/hp_frame_v2.png`
const HP_FRAME_ASPECT = 1 / 2.391 // height/width исходного PNG
const PLAQUE_VW = 40
const HP_FRAME_W = `clamp(160px, ${PLAQUE_VW}vw, 340px)`
// Высота — тем же выражением, что и ширина, умноженным на аспект: НЕ через
// CSS aspect-ratio. aspect-ratio даёт контейнеру "auto"-высоту для целей
// разрешения %-высоты/позиции АБСОЛЮТНО спозиционированных детей в part
// WebView (Android system WebView в Telegram) — из-за этого fill-полоса
// внутри окна теряла привязку и вылезала за рамку. calc() даёт контейнеру
// РЕАЛЬНУЮ пиксельную высоту, поэтому left/top/width/height потомков в %
// считаются от неё однозначно во всех движках.
const HP_FRAME_H = `calc(${HP_FRAME_W} * ${HP_FRAME_ASPECT})`
// Окно под полосу HP внутри плиты — доли (0..1) от размера ВСЕЙ картинки,
// не пиксели, чтобы не зависеть от масштаба отрисовки (см. HP_FRAME_W).
const HP_WINDOW_X = 0.395
const HP_WINDOW_Y = 0.24
const HP_WINDOW_W = 0.56
const HP_WINDOW_H = 0.215
// Число HP — центр ниши, отдельные доли (не строго X+W/2 — подобрано глазом).
const HPTXT_X = 0.685
const HPTXT_Y = 0.345
// 3 гнезда под иконки событий — общий Y и размер (доля ширины плиты), у
// каждого гнезда свой X.
const SOCK_Y = 0.79
const SOCK_SIZE = 0.185
const SOCK_X: [number, number, number] = [0.484, 0.672, 0.859]

// Кольцо "событие завершено" на иконке — доли размера иконки (не гнезда).
// Диаметр = SOCK_SIZE(иконки)*RING_SCALE, центр смещён на (RING_DX,RING_DY).
const RING_SCALE = 0.93
const RING_W = 4
const RING_DX = 0
const RING_DY = -0.09

const SPIKE_DAMAGE_RATIO = 0.5 // урон шипов — 50% от maxHp за касание
const SPIKE_IFRAME_MS = 1000 // неуязвимость после касания шипов, мс
const HAZARD_SPIKES_PER_RUN = 10 // сколько точек из hazard-пула ставим на карту за забег

// Атака игрока — те же ПРАВИЛА И ЧИСЛА, что в Battle.tsx (не переизобретаем):
// ATTACK_RANGE=70, ATTACK_DAMAGE=15+floor(strength/2), ATTACK_COOLDOWN=0.5с
// (там cooldownLeft тоже тикает в секундах через ticker.deltaMS/1000).
// ATTACK_ACTIVE_MS — НОВОЕ, в Battle.tsx нет: там урон применяется мгновенно
// в момент нажатия (нет врага, по которому проверять позже), а тут хитбоксу
// нужно продержаться хоть сколько-то кадров, чтобы следующий шаг (враг/сундук)
// успел его проверить.
const ATTACK_RANGE = 70
const ATTACK_COOLDOWN = 0.5
const ATTACK_ACTIVE_MS = 150

// Враг (Шаг 2-1) — пока НЕПОДВИЖНЫЙ прямоугольник-заглушка, спрайт зверя
// подключим отдельным шагом. Габариты — не из Battle.tsx (там это размер
// PixiJS-спрайта на весь экран боя, с тайлами Explore не сравнить напрямую),
// а по описанию "шире игрока, приземистый" (см. CLAUDE.md, Враг №1 "Зверь" —
// тяжёлый сгорбленный четвероногий монстр): шире игрока (1 тайл), ниже его
// (2 тайла).
const ENEMY_WIDTH = TILE_SIZE * 1.5
const ENEMY_HEIGHT = TILE_SIZE
const ENEMY_COLOR = 0x4a3728
// BASE_ENEMY_HP обычного (не boss) врага из Battle.tsx — берём как есть, БЕЗ
// level-scaling (там `Math.round(BASE_ENEMY_HP * (1 + 0.18*(level-1)))` — в
// Explore пока нет level, это база "как в бою"; см. CLAUDE.md "normal 120HP".
const ENEMY_MAX_HP = 120
const ENEMY_HP_BAR_HEIGHT = 8
const ENEMY_HP_BAR_MARGIN = 6 // зазор между полоской HP и головой врага

// AI зверя (Шаг 2-2) — числа из Battle.tsx (обычный враг, БЕЗ level-scaling —
// как и ENEMY_MAX_HP выше, в Explore пока нет level):
// - ENEMY_SPEED=1 px/кадр в Battle БЕЗ dt (там ticker вообще не масштабирует
//   движение врага по deltaTime) — здесь то же число, но умножаем на dt, как
//   уже сделано для игрока (MOVE_SPEED*dt).
// - ENEMY_ATTACK_INTERVAL=2с (обычный, не boss) — кулдаун МЕЖДУ атаками:
//   стартует ПОСЛЕ удара (см. ниже), не перед первым — см. настройку боя.
// - BASE_ENEMY_DAMAGE=14 (обычный, не boss) — урон удара, без dmgMultiplier
//   по той же причине (нет level).
// - ATTACK_RANGE переиспользуем как есть (см. выше) — в Battle.tsx ОДНА и та
//   же константа используется и для атаки игрока, и для дальности врага; это
//   по-прежнему радиус ПОПАДАНИЯ удара, отдельно от ATTACK_STOP_DIST ниже.
const ENEMY_CHASE_SPEED = 1.12 // было 1 — погоня чуть быстрее (~+12%), полировка
// Шаг C "умного врага" — скорость патруля (когда НЕ агрён), медленнее погони.
// Зафиксирована ЧИСЛОМ (не как доля от ENEMY_CHASE_SPEED) — при полировке
// погони её трогать не просили, а множитель от ENEMY_CHASE_SPEED утянул бы
// её за собой молча.
const ENEMY_PATROL_SPEED = 0.55

// Настройка боя (правки после первой версии AI):
// - ATTACK_STOP_DIST — НЕ из Battle: там 1D-дорожка со своим PLAYER_W-порогом,
//   здесь подобрано отдельно под ощущение боя в Explore — враг перестаёт
//   сближаться заметно РАНЬШЕ края ATTACK_RANGE (не долезает вплотную), но и
//   не останавливается на самом краю дальности (иначе от него легко отбежать
//   шагом) — ~64% от ATTACK_RANGE=70.
// - WINDUP_MS — заменяет прежний ENEMY_WINDUP_S (был 0.6с = 600мс), в мс (как
//   остальные *_MS-константы в файле), значение из разрешённого диапазона
//   задачи (600-700). Телеграф (см. tint ниже) остаётся видимым всё окно —
//   укоротили длительность, не тронув сам факт телеграфа.
//   ⚠️ Ощущение "замах ~2с" в исходной версии давала не длительность windup
//   (она и была 0.6с), а ENEMY_ATTACK_INTERVAL, накапливавшийся ДО первого
//   windup как пауза "подумать" — эта пауза убрана отдельно, см. ниже.
const ATTACK_STOP_DIST = 45
const WINDUP_MS = 650

const ENEMY_ATTACK_INTERVAL = 2
const ENEMY_ATTACK_DAMAGE = 14

// Шаг B "умного врага" — радиус агро. Враг преследует, только пока игрок И в
// пределах AGGRO_RANGE_TILES по X, И примерно на том же этаже по Y (разница
// не больше FLOOR_Y_TOLERANCE тайлов — допуск нужен для мелких перепадов в
// ±1 тайл, но прыжок на платформу выше/яма ниже уже считаются другим этажом).
// Сравниваем по ногам (y+height), а не по верхней точке — рост игрока и
// врага разный (128 vs 64), сравнение "потолка" тел давало бы системный сдвиг.
const AGGRO_RANGE_TILES = 7 // было 8 — полировка, замечает игрока чуть позже
const FLOOR_Y_TOLERANCE = 1.5

// Шаг C — патруль вокруг стартовой точки спавна (enemy.spawnX), когда враг НЕ
// агрён. Разворот на границе патруля, у стены '#' и у края платформы (в
// отличие от погони — в патруле с края НЕ падают, см. ниже в ticker'е).
const PATROL_RANGE_TILES = 3.5

// Кнопка dodge (Шаг 2-2) — окно неуязвимости и кулдаун кнопки. НЕ из Battle.tsx:
// там dodge — не таймер неуязвимости, а мгновенная отмена текущего замаха
// врага (`enemyWindingUp = false`) БЕЗ какого-либо окна и БЕЗ кулдауна кнопки.
// Здесь по прямому заданию задачи — именно окно i-frames; длительность и
// кулдаун — в разрешённом задачей диапазоне (0.4-0.5с / "небольшой"), не
// перенесены из Battle, потому что там такого механизма попросту нет.
const PLAYER_DODGE_IFRAME_MS = 450
const PLAYER_DODGE_COOLDOWN_MS = 1000

// Физика (калибруется под модель прыжка из SKILL-maps: вверх 1 и вверх 2
// берутся, вверх 3 — нет; по прямой до 4 тайлов)
const GRAVITY = 0.31 // было 0.8 — пересчитано под модель
const MAX_FALL = 20
const MOVE_SPEED = 4 // px/кадр, подберём на телефоне
const JUMP_VELOCITY = 10 // сила толчка вверх

const CAMERA_V_ANCHOR = 0.65 // 0.5 = центр экрана, больше = игрок ниже
const WORLD_SCALE = 0.55 // 1 = как сейчас, меньше = видно больше карты; зафиксировано после подбора тюнером

// Look-ahead камеры (только по X, см. updateCamera): целимся не в игрока,
// а в точку на LOOKAHEAD_TILES тайлов ВПЕРЕДИ по факту движения — видно
// больше пространства в ту сторону, куда бежит игрок.
const LOOKAHEAD_TILES = 1.75
// Коэффициент сглаживания камеры (lerp за кадр, масштабирован по dt) — меньше
// = медленнее/плавнее, камера не прыгает к цели скачком.
const SMOOTH = 0.055

type Grid = string[][]

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
  hpBarBg: Graphics
  hpBarFill: Graphics
}

// Кадры зверя (Шаг "спрайт зверя") — загружаются ОДИН раз в setup(), общие
// для всех врагов кластера (каждый враг заводит СВОЙ AnimatedSprite поверх
// одних и тех же Texture-массивов). AI/переключение по состоянию — позже,
// пока используется только idle.
type BeastFrames = { idle: Texture[]; walk: Texture[]; attack: Texture[]; hurt: Texture[]; death: Texture[] }

// "3 события за забег" — ВРЕМЕННЫЙ каркас (Phase 2, часть 2). kind совпадает
// со строками ROOM_LABELS в App.tsx (enemy/chest/smuggler/puzzle/boss), чтобы
// результат забега можно было отдать старому results-экрану без маппинга.
export type EventKind = 'enemy' | 'chest' | 'smuggler' | 'puzzle' | 'boss'

// clusterPoints — ТОЛЬКО для kind='enemy': все 3 точки кластера (не только
// points[0]) — нужны, чтобы заспавнить весь кластер, а не одного врага.
type EventCandidate = { kind: EventKind; x: number; y: number; clusterPoints?: [number, number][] }

// marker — для enemy-события НЕ создаётся (визуал — сами враги, реальные
// прямоугольники); для остальных типов (пока заглушки) — как раньше, кружок
// + закрытие касанием. remainingEnemies — только для kind='enemy': сколько
// врагов кластера ещё живы; событие закрывается, когда доходит до 0.
type MapEvent = EventCandidate & { marker?: Graphics; closed: boolean; remainingEnemies?: number }

const EVENT_MARKER_COLOR: Record<EventKind, number> = {
  enemy: 0xe0353b,
  chest: 0xe8b23a,
  smuggler: 0x8fd9f0,
  puzzle: 0x46c4e8,
  boss: 0xf08a24,
}

// Иконки HUD-прогресса событий — тот же способ формирования пути (BASE_URL),
// что у HP_FRAME_SRC, чтобы работало и на GitHub Pages с префиксом.
const EVENT_ICON_SRC: Record<EventKind, string> = {
  enemy: `${import.meta.env.BASE_URL}assets/icons/event_enemy.png`,
  chest: `${import.meta.env.BASE_URL}assets/icons/event_chest.png`,
  smuggler: `${import.meta.env.BASE_URL}assets/icons/event_smuggler.png`,
  puzzle: `${import.meta.env.BASE_URL}assets/icons/event_puzzle.png`,
  boss: `${import.meta.env.BASE_URL}assets/icons/event_boss.png`,
}

const SETTINGS_ICON_SRC = `${import.meta.env.BASE_URL}assets/icons/event_settings.png`

// Каменная рамка панели настроек — тот же способ пути (BASE_URL), что у
// HP_FRAME_SRC/EVENT_ICON_SRC. Вертикальная 3:4, реальный аспект картинки
// width/height = 0.767 (816×1064 px исходник).
const SETTINGS_FRAME_SRC = `${import.meta.env.BASE_URL}assets/settings_frame.png`
const SETTINGS_FRAME_ASPECT = 0.767 // width/height
const SETTINGS_FRAME_H = 'clamp(340px, 70vh, 520px)'
const SETTINGS_FRAME_W = `calc(${SETTINGS_FRAME_H} * ${SETTINGS_FRAME_ASPECT})`

const EVENTS_PER_RUN = 3

function isPointXY(value: unknown): value is [number, number] {
  return Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'number'
}

// Собирает ВСЕ доступные точки-кандидаты события из пулов слот-файла карты.
// enemyCluster (3 врага) считается ОДНИМ событием — x/y (для HUD/логов) берём
// из первой точки, но clusterPoints несёт ВСЕ валидные точки кластера, чтобы
// на споне поставить весь кластер, а не одного врага. npc.smuggler/npc.puzzle/
// boss могут отсутствовать (null) — на карте A их нет, но механизм общий для
// всех карт A-F.
function buildEventCandidates(slots: unknown): EventCandidate[] {
  const s = slots as {
    enemyClusters?: { points?: unknown }[]
    reward?: unknown[]
    npc?: { smuggler?: unknown; puzzle?: unknown }
    boss?: unknown
  } | null
  const candidates: EventCandidate[] = []

  for (const cluster of s?.enemyClusters ?? []) {
    const points = Array.isArray(cluster?.points) ? cluster.points.filter(isPointXY) : []
    const first = points[0]
    if (first) candidates.push({ kind: 'enemy', x: first[0], y: first[1], clusterPoints: points })
  }
  for (const point of s?.reward ?? []) {
    if (isPointXY(point)) candidates.push({ kind: 'chest', x: point[0], y: point[1] })
  }
  for (const point of Array.isArray(s?.npc?.smuggler) ? s.npc.smuggler : []) {
    if (isPointXY(point)) candidates.push({ kind: 'smuggler', x: point[0], y: point[1] })
  }
  for (const point of Array.isArray(s?.npc?.puzzle) ? s.npc.puzzle : []) {
    if (isPointXY(point)) candidates.push({ kind: 'puzzle', x: point[0], y: point[1] })
  }
  if (isPointXY(s?.boss)) candidates.push({ kind: 'boss', x: s.boss[0], y: s.boss[1] })

  return candidates
}

// Общий выбор "N случайных без повторов" — используется и для событий (3 из
// пула), и для шипов (10 из hazard). Если в пуле меньше count элементов —
// отдаёт весь пул как есть, без падения.
function pickRandom<T>(items: T[], count: number): T[] {
  const pool = [...items]
  const picked: T[] = []
  while (pool.length > 0 && picked.length < count) {
    const i = Math.floor(Math.random() * pool.length)
    picked.push(pool[i])
    pool.splice(i, 1)
  }
  return picked
}

// Режет спрайт-лист на кадры: cols колонок в ряд, дальше перенос вниз.
// Все кадры анимации хранятся в одном base.source (не отдельные Texture.from
// на кадр) — Pixi может переиспользовать GPU-текстуру между Texture-обрезками.
async function loadSheetFrames(url: string, frameW: number, frameH: number, count: number, cols = 12): Promise<Texture[]> {
  const base = await Assets.load(url)
  base.source.scaleMode = 'linear' // сглаженное масштабирование — герой сильно уменьшается с 512px, 'nearest' даёт дрожащие края
  const frames: Texture[] = []
  for (let i = 0; i < count; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    frames.push(new Texture({
      source: base.source,
      frame: new Rectangle(col * frameW, row * frameH, frameW, frameH),
    }))
  }
  return frames
}

// Зажимает value в [min, max]. Если min > max (карта меньше экрана по этой
// оси), выворачивать диапазон нельзя — ставим 0.
function clamp(value: number, min: number, max: number): number {
  if (min > max) return 0
  return Math.min(max, Math.max(min, value))
}

// '#' — твердь. За боковыми и нижним краем сетки тоже твердь (чтобы не
// улететь за карту), выше верхнего края — воздух. '=' здесь не учитываем.
function isSolid(grid: Grid, tileSize: number, px: number, py: number): boolean {
  const cx = Math.floor(px / tileSize)
  const cy = Math.floor(py / tileSize)
  const width = grid[0]?.length ?? 0
  const height = grid.length
  if (cy < 0) return false
  if (cy >= height) return true
  if (cx < 0 || cx >= width) return true
  return grid[cy][cx] === '#'
}

// Горизонтальная коллизия с полосой '=': блокирует ТОЛЬКО полоса сверху
// клетки (bandH = tileSize*PLATFORM_H_RATIO), нижние ~56% клетки остаются
// проходимы вбок. Проверяет реальное пересечение интервалов [top,bottom) и
// [cellTop,cellTop+bandH) по всем строкам, которые занимает габарит игрока
// — не точки выборки, иначе полоса может провалиться между сэмплами (как
// уже было с вертикалью). '#' здесь не трогаем — для неё уже есть isSolid.
function isPlatformBandBlocking(
  grid: Grid,
  tileSize: number,
  px: number,
  top: number,
  bottom: number,
): { cx: number; cy: number } | null {
  const cx = Math.floor(px / tileSize)
  const width = grid[0]?.length ?? 0
  const height = grid.length
  if (cx < 0 || cx >= width) return null
  const cyTop = Math.floor(top / tileSize)
  const cyBottom = Math.floor((bottom - 1) / tileSize)
  for (let cy = cyTop; cy <= cyBottom; cy++) {
    if (cy < 0 || cy >= height) continue
    if (grid[cy][cx] !== '=') continue
    const cellTop = cy * tileSize
    const bandBottom = cellTop + tileSize * PLATFORM_H_RATIO
    if (top < bandBottom && bottom > cellTop) return { cx, cy }
  }
  return null
}

// ЗАЩИТА ОТ ЗАСТРЕВАНИЯ по горизонтали: проверяет ТЕКУЩЕЕ положение игрока
// (на начало кадра — left/top/bottom ещё не двигались в этом кадре), а не
// целевую клетку. Если габарит [left,left+width)×[top,bottom) пересекает
// полосу '=' хотя бы в ОДНОЙ из клеток, которые игрок сейчас занимает по
// горизонтали (не только та, куда он движется), — значит он уже внутри
// полосы (например, после прыжка). В этом состоянии блокировка по '=' не
// применяется ни в одну сторону, пока игрок не выйдет из полосы целиком.
function isOverlappingPlatformBand(
  grid: Grid,
  tileSize: number,
  left: number,
  width: number,
  top: number,
  bottom: number,
): boolean {
  const gridWidth = grid[0]?.length ?? 0
  const gridHeight = grid.length
  const cxLeft = Math.floor(left / tileSize)
  const cxRight = Math.floor((left + width - 1) / tileSize)
  const cyTop = Math.floor(top / tileSize)
  const cyBottom = Math.floor((bottom - 1) / tileSize)
  for (let cy = cyTop; cy <= cyBottom; cy++) {
    if (cy < 0 || cy >= gridHeight) continue
    const cellTop = cy * tileSize
    const bandBottom = cellTop + tileSize * PLATFORM_H_RATIO
    if (!(top < bandBottom && bottom > cellTop)) continue
    for (let cx = cxLeft; cx <= cxRight; cx++) {
      if (cx < 0 || cx >= gridWidth) continue
      if (grid[cy][cx] === '=') return true
    }
  }
  return false
}

// Шипы '^' не твердь ни для одной из сторон (не проверяются в isSolid/
// cellHeadBlockBottom/cellFootBlockTop выше) — игрок проходит/проваливается
// сквозь них как через воздух. Здесь только определяем КАСАНИЕ — и только с
// зоной ЗУБЬЕВ (нижние SPIKE_H_RATIO клетки, прижаты к низу — см. drawSpikes/
// SPIKE_H_RATIO в mapRenderer.ts), а не со всей клеткой: иначе нельзя было бы
// перепрыгнуть шип — урон бил бы и по воздуху над видимыми зубьями.
function isTouchingSpikes(
  grid: Grid,
  tileSize: number,
  left: number,
  width: number,
  top: number,
  bottom: number,
): boolean {
  const gridWidth = grid[0]?.length ?? 0
  const gridHeight = grid.length
  const cxLeft = Math.floor(left / tileSize)
  const cxRight = Math.floor((left + width - 1) / tileSize)
  const cyTop = Math.floor(top / tileSize)
  const cyBottom = Math.floor((bottom - 1) / tileSize)
  for (let cy = cyTop; cy <= cyBottom; cy++) {
    if (cy < 0 || cy >= gridHeight) continue
    const cellBottom = (cy + 1) * tileSize
    const bandTop = cellBottom - tileSize * SPIKE_H_RATIO
    // Хитбокс вообще пересекает полосу зубьев в этой строке клеток?
    if (!(top < cellBottom && bottom > bandTop)) continue
    for (let cx = cxLeft; cx <= cxRight; cx++) {
      if (cx < 0 || cx >= gridWidth) continue
      if (grid[cy][cx] === '^') return true
    }
  }
  return false
}

// Нижняя граница препятствия в клетке (cx,cy) для движения ВВЕРХ, или null,
// если клетка не блокирует. '#' — вся клетка, '=' — только полоса сверху
// (см. drawPlatform/PLATFORM_H_RATIO в mapRenderer.ts).
function cellHeadBlockBottom(grid: Grid, tileSize: number, cx: number, cy: number): number | null {
  const width = grid[0]?.length ?? 0
  const height = grid.length
  const cellTop = cy * tileSize
  if (cy < 0) return null // выше карты — воздух
  if (cy >= height || cx < 0 || cx >= width) return cellTop + tileSize // край сетки — твердь
  const ch = grid[cy][cx]
  if (ch === '#') return cellTop + tileSize
  if (ch === '=') return cellTop + tileSize * PLATFORM_H_RATIO
  return null
}

// Верхняя граница поверхности в клетке (cx,cy) для приземления СВЕРХУ, или
// null, если клетка не твердь. '#' и '=' — обе твердь, верх полосы совпадает
// с верхом клетки, поэтому поверхность на одной высоте для обоих символов.
function cellFootBlockTop(grid: Grid, tileSize: number, cx: number, cy: number): number | null {
  const width = grid[0]?.length ?? 0
  const height = grid.length
  const cellTop = cy * tileSize
  if (cy < 0) return null // выше карты — воздух
  if (cy >= height || cx < 0 || cx >= width) return cellTop // край сетки — твердь
  const ch = grid[cy][cx]
  if (ch === '#' || ch === '=') return cellTop
  return null
}

// Проверяет весь путь головы за кадр [headY, prevHeadY] (headY < prevHeadY,
// движение вверх), а не только конечную точку — иначе на просевшем кадре
// голова может перескочить всю полосу '=' (~28px), ни разу не попав внутрь
// (туннелирование). Три колонки на путь: края + центр. Если пересекли
// несколько границ — берём САМУЮ НИЖНЮЮ (max blockBottom): это первая, во
// что игрок упёрся бы, двигаясь снизу вверх.
function sweepHeadBlock(
  grid: Grid,
  tileSize: number,
  playerX: number,
  playerWidth: number,
  prevHeadY: number,
  headY: number,
): number | null {
  const xPoints = [playerX + 1, playerX + playerWidth / 2, playerX + playerWidth - 1]
  const cyTop = Math.floor(headY / tileSize)
  const cyBottom = Math.floor(prevHeadY / tileSize)

  let pushTo: number | null = null
  for (let cy = cyTop; cy <= cyBottom; cy++) {
    for (const px of xPoints) {
      const cx = Math.floor(px / tileSize)
      const blockBottom = cellHeadBlockBottom(grid, tileSize, cx, cy)
      if (blockBottom === null) continue
      // Пересекли границу снизу вверх именно за этот кадр.
      if (prevHeadY >= blockBottom && headY < blockBottom) {
        pushTo = pushTo === null ? blockBottom : Math.max(pushTo, blockBottom)
      }
    }
  }
  return pushTo
}

// Случай "уже перекрываемся на начало кадра": игрок зашёл сбоку и на старте
// кадра голова уже внутри полосы '=' (или клетки '#') — пересечения границы
// не было, поэтому sweepHeadBlock ничего не находит и пропускает движение
// вверх насквозь. Проверяет те же три колонки на пересечение прямоугольника
// игрока (prevTop..prevBottom) с блокирующим прямоугольником клетки.
function isOverlappingAtFrameStart(
  grid: Grid,
  tileSize: number,
  playerX: number,
  playerWidth: number,
  prevTop: number,
  prevBottom: number,
): boolean {
  const xPoints = [playerX + 1, playerX + playerWidth / 2, playerX + playerWidth - 1]
  const cyTop = Math.floor(prevTop / tileSize)
  const cyBottom = Math.floor((prevBottom - 1) / tileSize)

  for (let cy = cyTop; cy <= cyBottom; cy++) {
    for (const px of xPoints) {
      const cx = Math.floor(px / tileSize)
      const blockBottom = cellHeadBlockBottom(grid, tileSize, cx, cy)
      if (blockBottom === null) continue
      const cellTop = cy * tileSize
      if (prevTop < blockBottom && prevBottom > cellTop) return true
    }
  }
  return false
}

// Симметрично sweepHeadBlock, но для падения: путь [prevFootY, footY]
// (footY > prevFootY, движение вниз). Берём САМУЮ ВЕРХНЮЮ пересечённую
// границу (min blockTop) — первая поверхность, на которую падает игрок.
function sweepFootBlock(
  grid: Grid,
  tileSize: number,
  playerX: number,
  playerWidth: number,
  prevFootY: number,
  footY: number,
): number | null {
  const xPoints = [playerX + 1, playerX + playerWidth / 2, playerX + playerWidth - 1]
  const cyTop = Math.floor(prevFootY / tileSize)
  const cyBottom = Math.floor(footY / tileSize)

  let pushTo: number | null = null
  for (let cy = cyTop; cy <= cyBottom; cy++) {
    for (const px of xPoints) {
      const cx = Math.floor(px / tileSize)
      const blockTop = cellFootBlockTop(grid, tileSize, cx, cy)
      if (blockTop === null) continue
      // Пересекли границу сверху вниз именно за этот кадр.
      if (prevFootY <= blockTop && footY > blockTop) {
        pushTo = pushTo === null ? blockTop : Math.min(pushTo, blockTop)
      }
    }
  }
  return pushTo
}

export default function Explore({ onClose, endurance, strength, onRunComplete }: ExploreProps) {
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

  // Панель настроек (шестерёнка) — оверлей поверх живой игры, паузы нет
  // (в проекте паузы вообще нет). exitConfirmOpen рендерится ПОВЕРХ панели
  // настроек (выше z-index), а не вместо неё.
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false)

  // "3 события за забег" — временный каркас. eventsRef хранит выбранные события
  // и их Pixi-маркеры (заполняется в setup(), после загрузки слот-файла).
  // eventClosed — состояние ТОЛЬКО для HUD-иконок сверху (закрытий мало, до 3
  // за забег, — в отличие от HP лишний ререндер тут не проблема).
  const eventsRef = useRef<MapEvent[]>([])
  const runCompleteFiredRef = useRef(false)
  const onRunCompleteRef = useRef<(closedEvents: { kind: EventKind }[]) => void>(() => {})
  const [eventClosed, setEventClosed] = useState<boolean[]>(Array(EVENTS_PER_RUN).fill(false))
  // eventKinds — параллельно eventClosed (тот же индекс = то же событие), только
  // для HUD-иконок (какой эмодзи/тип рисовать) — на closed-логику не влияет.
  const [eventKinds, setEventKinds] = useState<EventKind[]>([])

  // maxHp не меняется в течение забега — считаем один раз из endurance персонажа.
  const maxHp = endurance && endurance > 0 ? endurance * HP_PER_ENDURANCE : FALLBACK_MAX_HP
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

  // СПИСОК врагов (Шаг 2-3): по одному enemy-событию — до 3 врагов (весь
  // кластер), может быть несколько enemy-событий за забег — значит и больше
  // 3 суммарно. Каждый обрабатывается независимо в тикере (движение,
  // преследование, windup, удар по игроку, приём урона, смерть).
  const enemiesRef = useRef<Enemy[]>([])

  // Dodge игрока (Шаг 2-2) — окно неуязвимости от удара врага + кулдаун кнопки.
  const dodgePressedRef = useRef(false) // флаг тапа по 🔄, читается и сбрасывается в ticker
  const dodgeIframeRef = useRef(0) // мс — пока > 0, удар врага игрока не задевает
  const dodgeCooldownRef = useRef(0) // мс — остаток кулдауна самой кнопки

  function updateHpBar() {
    const fraction = Math.max(0, Math.min(1, hpRef.current / maxHp))
    if (hpFillRef.current) {
      // Ширина в % от контейнера фрейма (левый край окна тоже в % от него же —
      // см. JSX), а не от ширины самого окна — так left/width остаются в одной
      // системе координат и полоса не съезжает при resize.
      hpFillRef.current.style.width = `${HP_WINDOW_W * fraction * 100}%`
      hpFillRef.current.style.background = fraction <= 0.3 ? '#E0353B' : '#4FB477'
    }
    if (hpTextRef.current) {
      hpTextRef.current.textContent = `${hpRef.current}/${maxHp}`
    }
  }

  // HP-бар врага — в мире (Pixi Graphics над его головой), а не DOM-оверлей,
  // как у игрока: враг двигается вместе с камерой, а не фиксирован на экране.
  function redrawEnemyHpBar(enemy: Enemy) {
    const pct = Math.max(0, Math.min(1, enemy.hp / enemy.maxHp))
    enemy.hpBarFill.clear()
    if (pct > 0) {
      enemy.hpBarFill.rect(0, 0, ENEMY_WIDTH * pct, ENEMY_HP_BAR_HEIGHT).fill(0xe0353b)
    }
  }

  // Хитстан от урона: обрывает замах атаки и на HURT_MS блокирует новую атаку
  // (см. attackPressedRef-обработчик в setup). Определена на уровне компонента
  // (не внутри setup/applyAttackHit), т.к. вызывается из takeDamage ниже —
  // единой точки "игрок получил урон", которая сама объявлена здесь же, ДО
  // setup() и его замыканий, и трогает только refs (доступны отовсюду в компоненте).
  function triggerHurt() {
    hurtTimerRef.current = HURT_MS
    attackingRef.current = false // обрываем замах (хитстан)
    attackHitDoneRef.current = false
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
    hurtTimerRef.current = 0
    landTimerRef.current = 0
    const hero = heroSpriteRef.current
    const deathFrames = deathFramesRef.current
    if (hero && deathFrames) {
      hero.textures = deathFrames
      hero.loop = false
      hero.animationSpeed = DEATH_ANIM_SPEED
      hero.gotoAndPlay(0)
      hero.anchor.set(0.5, GROUND_ANCHOR_Y)
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
    applySpikeDamageRef.current = () => takeDamage(maxHp * SPIKE_DAMAGE_RATIO)
    onRunCompleteRef.current = onRunComplete ?? (() => {})
    attackDamageRef.current = attackDamage
  })

  useEffect(() => {
    let app: Application | null = null
    let cancelled = false
    // true ТОЛЬКО после успешного await app.init() — до этого момента у
    // Application нет renderer/ticker/resize-хуков, и destroy() на нём падает
    // ("this._cancelResize is not a function"). React 19 StrictMode монтирует
    // эффект дважды в dev, так что cleanup может сработать, пока setup() ещё
    // ждёт fetch/init — без этого флага он ловил недоинициализированный app.
    let initialized = false

    async function setup() {
      app = new Application()
      const base = import.meta.env.BASE_URL

      const [mapText, slots] = await Promise.all([
        fetch(`${base}assets/maps/${MAP_FILE}`).then((res) => res.text()),
        fetch(`${base}assets/maps/${slotsFileForMap(MAP_FILE)}`).then((res) => res.json()),
      ])

      const grid: Grid = mapText.split('\n').map((line) => line.split(''))
      const decor = slots.decor ?? []

      // Шипы из слотов карты — не весь пул, а HAZARD_SPIKES_PER_RUN случайных
      // точек за забег (меньше пула — берём сколько есть). Вставляем прямо в
      // рабочую сетку, ДО renderMapToCanvas и ДО первого кадра физики:
      // коллизия и рендер читают один и тот же grid, значит '^' должен
      // попасть именно сюда, а не в отдельную структуру.
      const hazardPool: [number, number][] = Array.isArray(slots.hazard) ? slots.hazard.filter(isPointXY) : []
      const chosenHazards = pickRandom(hazardPool, HAZARD_SPIKES_PER_RUN)
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
      const chosenEvents = pickRandom(buildEventCandidates(slots), EVENTS_PER_RUN)
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

      const mapCanvas = await renderMapToCanvas({ grid, decor, tileSize: TILE_SIZE })

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

      // Мир: фон-карта и игрок в одном контейнере, двигаются вместе камерой.
      const worldContainer = new Container()
      worldContainer.scale.set(WORLD_SCALE)
      app.stage.addChild(worldContainer)

      const mapTexture = Texture.from(mapCanvas)
      const mapSprite = new Sprite(mapTexture)
      mapSprite.x = 0
      mapSprite.y = 0
      worldContainer.addChild(mapSprite)

      const phys = physicsRef.current
      phys.x = start.x * TILE_SIZE
      phys.y = (start.y + 1) * TILE_SIZE - PLAYER_HEIGHT
      phys.vx = 0
      phys.vy = 0
      phys.onGround = false

      const player = new Graphics()
        .rect(0, 0, PLAYER_WIDTH, PLAYER_HEIGHT)
        .fill(PLAYER_COLOR)
        .stroke({ width: 2, color: 0xffffff })
      player.x = phys.x
      player.y = phys.y
      worldContainer.addChild(player)

      // Визуал героя — AnimatedSprite поверх хитбокса. Только idle в этом
      // шаге (run/attack/jump/hurt/death — отдельно). Кадры режутся из
      // idle.png: 12 колонок в ряд (см. loadSheetFrames), клетка 674×512 —
      // тот же размер, что задокументирован в CLAUDE.md для idle/run/attack/hurt.
      const idleFrames = await loadSheetFrames(HERO_IDLE_SRC, 379, 288, 12)
      if (cancelled) {
        // Компонент размонтировался, пока грузился спрайт-лист — не создаём
        // спрайт и не трогаем worldContainer (он в любом случае будет уничтожен
        // вместе с app при cancelled-выходе выше по функции... но сюда мы уже
        // прошли мимо тех проверок, поэтому просто не продолжаем настройку героя).
        return
      }
      const runFrames = await loadSheetFrames(HERO_RUN_SRC, 379, 288, 21)
      if (cancelled) {
        // Тот же случай, что и выше — ещё один await, ещё одна проверка.
        return
      }
      const jumpFrames = await loadSheetFrames(HERO_JUMP_SRC, 302, 288, 24)
      if (cancelled) {
        // Тот же случай, что и выше — ещё один await, ещё одна проверка.
        return
      }
      // Land — подпоследовательность кадров прыжка 18..24 (индексы 17..23),
      // один раз вырезанная при загрузке, а не при каждом приземлении.
      const landFrames = jumpFrames.slice(17, 24)
      const attackFrames = await loadSheetFrames(HERO_ATTACK_SRC, 379, 288, 14)
      if (cancelled) {
        // Тот же случай, что и выше — ещё один await, ещё одна проверка.
        return
      }
      const hurtFrames = await loadSheetFrames(HERO_HURT_SRC, 315, 288, 10)
      if (cancelled) {
        // Тот же случай, что и выше — ещё один await, ещё одна проверка.
        return
      }
      const deathFrames = await loadSheetFrames(HERO_DEATH_SRC, 313, 288, 18)
      if (cancelled) {
        // Тот же случай, что и выше — ещё один await, ещё одна проверка.
        return
      }

      // Кадры зверя — тот же loadSheetFrames, 12 колонок в ряд, грузятся ОДИН
      // раз (не на каждого врага кластера). Высота клетки везде 288, ширина —
      // своя у каждой анимации (walk и death отличаются от idle/attack/hurt).
      const beastIdleFrames = await loadSheetFrames(BEAST_IDLE_SRC, 481, 288, 24)
      if (cancelled) return
      const beastWalkFrames = await loadSheetFrames(BEAST_WALK_SRC, 418, 288, 16)
      if (cancelled) return
      const beastAttackFrames = await loadSheetFrames(BEAST_ATTACK_SRC, 481, 288, 24)
      if (cancelled) return
      const beastHurtFrames = await loadSheetFrames(BEAST_HURT_SRC, 481, 288, 10)
      if (cancelled) return
      const beastDeathFrames = await loadSheetFrames(BEAST_DEATH_SRC, 537, 288, 18)
      if (cancelled) return
      beastFramesRef.current = {
        idle: beastIdleFrames,
        walk: beastWalkFrames,
        attack: beastAttackFrames,
        hurt: beastHurtFrames,
        death: beastDeathFrames,
      }

      const hero = new AnimatedSprite(idleFrames)
      hero.anchor.set(0.5, 1.0) // якорь — низ по центру (ноги)
      hero.scale.set(HERO_DRAW_H / idleFrames[0].height) // равномерный масштаб по реальной высоте кадра
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
        if (sprite.textures === frames) return
        sprite.textures = frames
        sprite.loop = loop
        sprite.animationSpeed = speed
        sprite.gotoAndPlay(0)
      }

      // Спавнит ОДНОГО врага-прямоугольник (см. Шаг 2-1/2-2) в тайловых
      // координатах (tileX,tileY), привязанного к enemy-событию eventIndex
      // (для декремента remainingEnemies при смерти). Ставит ногами на пол
      // клетки, как игрока.
      function spawnEnemy(tileX: number, tileY: number, eventIndex: number): Enemy {
        const enemyWorldX = tileX * TILE_SIZE + TILE_SIZE / 2 - ENEMY_WIDTH / 2
        const enemyWorldY = (tileY + 1) * TILE_SIZE - ENEMY_HEIGHT

        const rect = new Graphics()
          .rect(0, 0, ENEMY_WIDTH, ENEMY_HEIGHT)
          .fill(ENEMY_COLOR)
          .stroke({ width: 2, color: 0xffffff })
        // Пивот по центру X — чтобы разворот (facing) флипал rect.scale.x
        // вокруг центра, а не сдвигал его в сторону (см. синк x ниже: rect.x
        // ставится в enemy.x + ENEMY_WIDTH/2, а не enemy.x напрямую).
        rect.pivot.set(ENEMY_WIDTH / 2, 0)
        rect.x = enemyWorldX + ENEMY_WIDTH / 2
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
        sprite.anchor.set(0.506, 0.971) // торс по центру, ноги — низ хитбокса
        sprite.scale.set(BEAST_CELL_RENDER_H / beastFrames.idle[0].height)
        sprite.roundPixels = false
        sprite.animationSpeed = BEAST_IDLE_ANIM_SPEED
        sprite.loop = true
        sprite.play()
        // Та же точка привязки, что раньше была у прямоугольника: центр по X,
        // НИЗ хитбокса по Y (не верх, как у rect — якорь спрайта другой).
        sprite.x = enemyWorldX + ENEMY_WIDTH / 2
        sprite.y = enemyWorldY + ENEMY_HEIGHT
        worldContainer.addChild(sprite)

        const hpBarBg = new Graphics().rect(0, 0, ENEMY_WIDTH, ENEMY_HP_BAR_HEIGHT).fill(0x221e2b)
        hpBarBg.x = enemyWorldX
        hpBarBg.y = enemyWorldY - ENEMY_HP_BAR_MARGIN - ENEMY_HP_BAR_HEIGHT
        worldContainer.addChild(hpBarBg)

        const hpBarFill = new Graphics()
        hpBarFill.x = enemyWorldX
        hpBarFill.y = hpBarBg.y
        worldContainer.addChild(hpBarFill)

        const enemy: Enemy = {
          x: enemyWorldX,
          y: enemyWorldY,
          vy: 0,
          hp: ENEMY_MAX_HP,
          maxHp: ENEMY_MAX_HP,
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
      eventsRef.current = chosenEvents.map((ev, eventIndex) => {
        if (ev.kind === 'enemy') {
          const points = ev.clusterPoints ?? []
          if (points.length === 0) {
            console.error('Explore: enemy-событие без валидных точек кластера — нечего убивать', ev)
            return { ...ev, closed: true, remainingEnemies: 0 }
          }
          for (const [ex, ey] of points) {
            spawnedEnemies.push(spawnEnemy(ex, ey, eventIndex))
          }
          return { ...ev, closed: false, remainingEnemies: points.length }
        }

        const marker = new Graphics()
          .circle(0, 0, TILE_SIZE * 0.35)
          .fill({ color: EVENT_MARKER_COLOR[ev.kind], alpha: 0.85 })
          .stroke({ width: 3, color: 0xffffff })
        marker.x = ev.x * TILE_SIZE + TILE_SIZE / 2
        marker.y = ev.y * TILE_SIZE + TILE_SIZE / 2
        worldContainer.addChild(marker)
        return { ...ev, marker, closed: false }
      })
      enemiesRef.current = spawnedEnemies

      // DEBUG ONLY — тонкая рамка зоны удара, пока она активна. Чисто
      // визуальный слой, на хитбокс/урон не влияет; убрать когда атака
      // перестанет быть единственной обратной связью игроку об ударе.
      const attackHitboxGraphics = new Graphics()
      worldContainer.addChild(attackHitboxGraphics)

      // Камера: центрируем игрока на экране, зажимая по границам карты.
      const worldWidth = grid[0].length * TILE_SIZE * worldContainer.scale.x
      const worldHeight = grid.length * TILE_SIZE * worldContainer.scale.y

      // dt — deltaTime тика (как везде в файле); при первом вызове (до старта
      // ticker'а) передаём Infinity, чтобы camera-lerp ниже сразу СНАПНУЛ в
      // стартовую позицию, а не полз туда от (0,0) первые несколько кадров.
      const updateCamera = (dt: number) => {
        // player.x/y и player.width/height — координаты МИРА (локальные для
        // worldContainer), а worldContainer.x/y — координаты ЭКРАНА. При
        // scale != 1 их нельзя смешивать без множителя s.
        const s = WORLD_SCALE

        // LOOK-AHEAD (только X): целимся не в игрока, а в точку на
        // LOOKAHEAD_TILES тайлов ВПЕРЕДИ по факту движения. facingRef — уже
        // существующий флаг направления (обновляется при движении, персистит
        // при остановке — см. его объявление выше), поэтому при остановке
        // упреждение остаётся прежним, а не прыгает к центру.
        const lookaheadPx = facingRef.current * LOOKAHEAD_TILES * TILE_SIZE
        const focusX = player.x + player.width / 2 + lookaheadPx
        const targetX = clamp(app!.screen.width / 2 - focusX * s, app!.screen.width - worldWidth, 0)
        // Плавно догоняем target (lerp), а не прыгаем скачком. Коэффициент
        // масштабирован по dt (не зависит от fps) и зажат в [0,1] — на первом
        // вызове (dt=Infinity) это даёт factor=1, то есть мгновенный снап.
        const smoothFactor = Math.min(1, SMOOTH * dt)
        worldContainer.x += (targetX - worldContainer.x) * smoothFactor

        // Вертикаль — БЕЗ look-ahead и без lerp, как было (не трогаем).
        const targetY = app!.screen.height * CAMERA_V_ANCHOR - (player.y + player.height / 2) * s
        worldContainer.y = clamp(targetY, app!.screen.height - worldHeight, 0)
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
          if (
            attackHitboxRef.current &&
            enemy.lastHitSwingId !== attackSwingIdRef.current
          ) {
            const hb = attackHitboxRef.current
            const overlap =
              hb.x < enemy.x + ENEMY_WIDTH &&
              hb.x + hb.width > enemy.x &&
              hb.y < enemy.y + ENEMY_HEIGHT &&
              hb.y + hb.height > enemy.y
            if (overlap) {
              enemy.lastHitSwingId = attackSwingIdRef.current
              enemy.hp = Math.max(0, enemy.hp - attackDamageRef.current)
              if (enemy.hp <= 0) {
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
                continue
              }
              redrawEnemyHpBar(enemy)
            }
          }
        }
      }

      // Ходьба влево/вправо + прыжок + коллизия со стенами, гравитация и
      // приземление на твердь. Платформы '=' — следующий шаг.
      const worldWidthPx = grid[0].length * TILE_SIZE

      app.ticker.add((ticker) => {
        const dt = ticker.deltaTime
        const startX = phys.x
        const startY = phys.y

        // Горизонтальное движение
        phys.vx = dirRef.current * MOVE_SPEED
        phys.x += phys.vx * dt
        if (dirRef.current !== 0) facingRef.current = dirRef.current > 0 ? 1 : -1

        if (phys.vx > 0) {
          const px = phys.x + PLAYER_WIDTH - 1
          let hit =
            isSolid(grid, TILE_SIZE, px, phys.y + 1) ||
            isSolid(grid, TILE_SIZE, px, phys.y + PLAYER_HEIGHT / 2) ||
            isSolid(grid, TILE_SIZE, px, phys.y + PLAYER_HEIGHT - 1)
          if (!hit) {
            // Сначала: уже внутри полосы (по текущему положению, не по цели)?
            const stuckInBand = isOverlappingPlatformBand(grid, TILE_SIZE, startX, PLAYER_WIDTH, phys.y, phys.y + PLAYER_HEIGHT)
            if (!stuckInBand) {
              const band = isPlatformBandBlocking(grid, TILE_SIZE, px, phys.y, phys.y + PLAYER_HEIGHT)
              if (band) hit = true
            }
          }
          if (hit) {
            phys.x = Math.floor((phys.x + PLAYER_WIDTH) / TILE_SIZE) * TILE_SIZE - PLAYER_WIDTH
            phys.vx = 0
          }
        } else if (phys.vx < 0) {
          const px = phys.x
          let hit =
            isSolid(grid, TILE_SIZE, px, phys.y + 1) ||
            isSolid(grid, TILE_SIZE, px, phys.y + PLAYER_HEIGHT / 2) ||
            isSolid(grid, TILE_SIZE, px, phys.y + PLAYER_HEIGHT - 1)
          if (!hit) {
            // Сначала: уже внутри полосы (по текущему положению, не по цели)?
            const stuckInBand = isOverlappingPlatformBand(grid, TILE_SIZE, startX, PLAYER_WIDTH, phys.y, phys.y + PLAYER_HEIGHT)
            if (!stuckInBand) {
              const band = isPlatformBandBlocking(grid, TILE_SIZE, px, phys.y, phys.y + PLAYER_HEIGHT)
              if (band) hit = true
            }
          }
          if (hit) {
            phys.x = (Math.floor(phys.x / TILE_SIZE) + 1) * TILE_SIZE
            phys.vx = 0
          }
        }

        phys.x = clamp(phys.x, 0, worldWidthPx - PLAYER_WIDTH)

        // Прыжок: только с тверди, двойного прыжка нет. Одно нажатие —
        // ровно один прыжок, флаг сразу сбрасывается.
        let jumpedThisFrame = false
        if (jumpPressedRef.current) {
          jumpPressedRef.current = false
          if (phys.onGround) {
            phys.vy = -JUMP_VELOCITY
            phys.onGround = false
            jumpedThisFrame = true
          }
        }

        // Вертикальная физика (гравитация + приземление)
        const wasOnGround = phys.onGround
        phys.vy = Math.min(phys.vy + GRAVITY * dt, MAX_FALL)
        phys.y += phys.vy * dt

        phys.onGround = false
        if (phys.vy > 0) {
          // Приземление сверху: проверяем весь путь ног за кадр, не только
          // конечную точку — иначе на просевшем кадре можно провалиться
          // сквозь тонкую полосу '=', не попав в неё ни разу.
          const prevFootY = startY + PLAYER_HEIGHT
          const footY = phys.y + PLAYER_HEIGHT
          const blockTop = sweepFootBlock(grid, TILE_SIZE, phys.x, PLAYER_WIDTH, prevFootY, footY)
          if (blockTop !== null) {
            phys.y = blockTop - PLAYER_HEIGHT
            phys.vy = 0
            phys.onGround = true
          }
        } else if (phys.vy < 0) {
          // Удар головой снизу вверх: та же защита от туннелирования —
          // проверяем весь путь [headY, prevHeadY] за кадр. '#' — вся
          // клетка, '=' — только полоса.
          const prevHeadY = startY // y ДО y += vy*dt (startY захвачен в начале тика)
          const headY = phys.y
          const pushTo = sweepHeadBlock(grid, TILE_SIZE, phys.x, PLAYER_WIDTH, prevHeadY, headY)
          if (pushTo !== null) {
            phys.y = pushTo
            phys.vy = 0
          } else if (
            isOverlappingAtFrameStart(grid, TILE_SIZE, phys.x, PLAYER_WIDTH, prevHeadY, prevHeadY + PLAYER_HEIGHT)
          ) {
            // Зашли сбоку под ступень: пересечения границы за кадр не было
            // (голова уже была внутри полосы на старте кадра), sweep выше
            // ничего не нашёл. Откатываем движение вверх за этот кадр —
            // без перепозиционирования по blockBottom, никакого телепорта.
            phys.y = prevHeadY
            phys.vy = 0
          }
        }

        // Приземление (край перехода "не на земле" -> "на земле" за этот
        // кадр) — запускает land, только если игрок не бежит и не прыгает
        // прямо сейчас (иначе движение/прыжок сразу перекрыли бы его же).
        const justLanded = !wasOnGround && phys.onGround
        if (justLanded && dirRef.current === 0 && !jumpedThisFrame) {
          landTimerRef.current = LAND_MS
        }

        // Шипы: неуязвимость тикает каждый кадр независимо от касания;
        // урон только когда истекла и хитбокс реально пересекает '^'.
        spikeIframeRef.current = Math.max(0, spikeIframeRef.current - ticker.deltaMS)
        if (
          spikeIframeRef.current <= 0 &&
          isTouchingSpikes(grid, TILE_SIZE, phys.x, PLAYER_WIDTH, phys.y, phys.y + PLAYER_HEIGHT)
        ) {
          spikeIframeRef.current = SPIKE_IFRAME_MS
          applySpikeDamageRef.current()
        }

        // "3 события за забег" — временное закрытие простым касанием хитбокса.
        // enemy-события сюда НЕ попадают — они закрываются убийством кластера
        // (см. enemy-цикл ниже), не касанием. Остальные типы (сундук и т.п.,
        // пока заглушки) — как раньше.
        for (let i = 0; i < eventsRef.current.length; i++) {
          const ev = eventsRef.current[i]
          if (ev.closed || ev.kind === 'enemy') continue
          const evLeft = ev.x * TILE_SIZE
          const evTop = ev.y * TILE_SIZE
          const touching =
            phys.x < evLeft + TILE_SIZE &&
            phys.x + PLAYER_WIDTH > evLeft &&
            phys.y < evTop + TILE_SIZE &&
            phys.y + PLAYER_HEIGHT > evTop
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
          // Хитстан: во время hurt атаковать нельзя (хардкор-вариант).
          if (hurtTimerRef.current > 0) {
            // no-op — нажатие проигнорировано
          } else if (attackCooldownRef.current <= 0 && !attackingRef.current) {
            attackCooldownRef.current = ATTACK_COOLDOWN
            attackActiveRef.current = true
            attackActiveTimerRef.current = ATTACK_ACTIVE_MS
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
                ? { x: phys.x + PLAYER_WIDTH, y: phys.y, width: ATTACK_RANGE, height: PLAYER_HEIGHT }
                : { x: phys.x - ATTACK_RANGE, y: phys.y, width: ATTACK_RANGE, height: PLAYER_HEIGHT }
            // Урон здесь больше НЕ применяется — applyAttackHit() вызывается
            // из блока анимации героя в тикере, на кадре удара ATTACK_STRIKE_FRAME.
            hero.textures = attackFrames
            hero.loop = false
            hero.animationSpeed = ATTACK_ANIM_SPEED
            hero.gotoAndPlay(0)
          }
        }

        if (attackActiveRef.current) {
          attackActiveTimerRef.current -= ticker.deltaMS
          if (attackActiveTimerRef.current <= 0) {
            attackActiveRef.current = false
            // attackHitboxRef НЕ обнуляем здесь: ATTACK_ACTIVE_MS (150мс) —
            // окно debug-визуализации ниже, оно короче, чем реальный момент
            // удара по анимации (~200мс на ATTACK_STRIKE_FRAME при
            // ATTACK_ANIM_SPEED=0.5) — applyAttackHit() должен ещё застать
            // валидный хитбокс. Хитбокс переживается следующим press'ом.
          }
        }

        // DEBUG ONLY — визуализация зоны удара, см. attackHitboxGraphics выше.
        attackHitboxGraphics.clear()
        if (attackActiveRef.current && attackHitboxRef.current) {
          const hb = attackHitboxRef.current
          attackHitboxGraphics.rect(hb.x, hb.y, hb.width, hb.height).stroke({ width: 2, color: 0xffd700 })
        }

        // Dodge игрока: окно неуязвимости от удара врага + кулдаун кнопки,
        // независимо от i-frames шипов (spikeIframeRef) — отдельный механизм.
        // Считается ОДИН раз за кадр (не за врага), поэтому вынесен перед
        // циклом по врагам ниже.
        dodgeIframeRef.current = Math.max(0, dodgeIframeRef.current - ticker.deltaMS)
        dodgeCooldownRef.current = Math.max(0, dodgeCooldownRef.current - ticker.deltaMS)
        if (dodgePressedRef.current) {
          dodgePressedRef.current = false
          if (dodgeCooldownRef.current <= 0) {
            dodgeIframeRef.current = PLAYER_DODGE_IFRAME_MS
            dodgeCooldownRef.current = PLAYER_DODGE_COOLDOWN_MS
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

          // Гравитация + приземление (Шаг A "умного врага") — та же физика,
          // что у игрока: GRAVITY/MAX_FALL переиспользуем как есть, посадку на
          // '#'/'=' считаем через тот же sweepFootBlock, что и для игрока (та
          // же защита от туннелирования сквозь тонкую полосу за один кадр).
          // Врагу не нужна версия с проверкой головы (sweepHeadBlock) — у него
          // нет прыжка, vy никогда не становится отрицательной. Если под ним
          // нет пола (сошёл с края, преследуя игрока) — просто падает дальше,
          // разворот у края намеренно не делаем (агрессивная физика).
          enemy.vy = Math.min(enemy.vy + GRAVITY * dt, MAX_FALL)
          const prevEnemyFootY = enemy.y + ENEMY_HEIGHT
          enemy.y += enemy.vy * dt
          const enemyFootY = enemy.y + ENEMY_HEIGHT
          const enemyBlockTop = sweepFootBlock(grid, TILE_SIZE, enemy.x, ENEMY_WIDTH, prevEnemyFootY, enemyFootY)
          if (enemyBlockTop !== null) {
            enemy.y = enemyBlockTop - ENEMY_HEIGHT
            enemy.vy = 0
          }

          const dx = (phys.x + PLAYER_WIDTH / 2) - (enemy.x + ENEMY_WIDTH / 2)
          const dist = Math.abs(dx)
          // Battle.tsx сравнивает только X (там бой на одной 1D-дорожке — по
          // вертикали фигуры всегда совпадают). В Explore игрок может
          // запрыгнуть НАД врагом — если ноги игрока выше головы врага, удар
          // по вертикали физически не должен доставать, иначе "отпрыгнул"
          // (способ уклонения из требования 3а) не работал бы вообще.
          const verticalReach = phys.y < enemy.y + ENEMY_HEIGHT && phys.y + PLAYER_HEIGHT > enemy.y
          const inMeleeReach = dist < ATTACK_RANGE && verticalReach

          // Достиг ли враг стоп-дистанции (~64% ATTACK_RANGE, см. константу
          // выше) — используется И для остановки сближения, И как порог для
          // немедленного windup ниже (пока чисто горизонтально, как и раньше
          // у преследования — вертикаль добавляется отдельно, только к
          // windup-гейту, см. verticalReach).
          const reachedStopDist = dist <= ATTACK_STOP_DIST

          // Шаг B: агро — проверяется КАЖДЫЙ кадр заново (динамически), только
          // для решения "преследовать по X или стоять на месте". Атаку (ниже)
          // не трогаем — она и так работает лишь в пределах ATTACK_STOP_DIST/
          // ATTACK_RANGE, которые намного меньше радиуса агро, так что этот
          // гейт логически не пересекается с уже существующей проверкой удара.
          const enemyFeetY = enemy.y + ENEMY_HEIGHT
          const playerFeetY = phys.y + PLAYER_HEIGHT
          const sameFloor = Math.abs(playerFeetY - enemyFeetY) <= FLOOR_Y_TOLERANCE * TILE_SIZE
          const aggroed = dist <= AGGRO_RANGE_TILES * TILE_SIZE && sameFloor

          if (!enemy.windingUp) {
            if (aggroed) {
              // ПОГОНЯ (Шаг B, скорость — Шаг C): быстрее патруля, падение с
              // края разрешено (см. физику выше — leadingX тут не проверяет
              // пол под ногами вообще, это делает общий gravity-блок).
              if (!reachedStopDist) {
                const dir = Math.sign(dx)
                const nextX = enemy.x + dir * ENEMY_CHASE_SPEED * dt
                const leadingX = dir > 0 ? nextX + ENEMY_WIDTH : nextX
                const hitWall =
                  isSolid(grid, TILE_SIZE, leadingX, enemy.y + 1) ||
                  isSolid(grid, TILE_SIZE, leadingX, enemy.y + ENEMY_HEIGHT / 2) ||
                  isSolid(grid, TILE_SIZE, leadingX, enemy.y + ENEMY_HEIGHT - 1)
                if (!hitWall) {
                  enemy.x = clamp(nextX, 0, worldWidthPx - ENEMY_WIDTH)
                }
                if (dir !== 0) enemy.facing = dir as 1 | -1
              }
            } else {
              // ПАТРУЛЬ (Шаг C): медленно туда-сюда вокруг spawnX, не дальше
              // PATROL_RANGE_TILES. Разворот на границе патруля, у стены '#'
              // ИЛИ у края платформы — в отличие от погони, с края патруля
              // падать нельзя, доходит до края и разворачивается.
              const patrolLeftBound = enemy.spawnX - PATROL_RANGE_TILES * TILE_SIZE
              const patrolRightBound = enemy.spawnX + PATROL_RANGE_TILES * TILE_SIZE
              const dir = enemy.patrolDir
              const nextX = enemy.x + dir * ENEMY_PATROL_SPEED * dt
              const leadingX = dir > 0 ? nextX + ENEMY_WIDTH : nextX

              const hitWall =
                isSolid(grid, TILE_SIZE, leadingX, enemy.y + 1) ||
                isSolid(grid, TILE_SIZE, leadingX, enemy.y + ENEMY_HEIGHT / 2) ||
                isSolid(grid, TILE_SIZE, leadingX, enemy.y + ENEMY_HEIGHT - 1)
              // Край платформы: под клеткой сразу впереди по ходу нет '#'/'='.
              const footCx = Math.floor(leadingX / TILE_SIZE)
              const footCy = Math.floor((enemy.y + ENEMY_HEIGHT) / TILE_SIZE)
              const noFloorAhead = cellFootBlockTop(grid, TILE_SIZE, footCx, footCy) === null
              const reachedBound = dir > 0 ? nextX > patrolRightBound : nextX < patrolLeftBound

              if (reachedBound || hitWall || noFloorAhead) {
                enemy.patrolDir = dir > 0 ? -1 : 1
              } else {
                enemy.x = clamp(nextX, 0, worldWidthPx - ENEMY_WIDTH)
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
            if (reachedStopDist && verticalReach && enemy.attackTimer <= 0) {
              enemy.windingUp = true
              enemy.windupTimer = 0
            }
          } else {
            enemy.windupTimer += ticker.deltaMS
            if (enemy.windupTimer >= WINDUP_MS) {
              enemy.windingUp = false
              enemy.windupTimer = 0
              enemy.attackTimer = ENEMY_ATTACK_INTERVAL // кулдаун — ПОСЛЕ удара
              // Момент удара: дистанция (и вертикальный охват) проверяются
              // ЗАНОВО, здесь и сейчас — не те, что были в начале замаха. Если
              // игрок отбежал/отпрыгнул за время windup, удар промахивается
              // (способ уклонения "отход", требование 3а). Радиус попадания —
              // по-прежнему ATTACK_RANGE (inMeleeReach), НЕ ATTACK_STOP_DIST —
              // это разный, более широкий радиус, его не трогали.
              if (inMeleeReach && dodgeIframeRef.current <= 0) {
                takeDamageRef.current(ENEMY_ATTACK_DAMAGE)
              }
            }
          }

          // Синк визуала с логической позицией — теперь и по Y тоже (раньше
          // враг не двигался по вертикали вообще, синкали только X; с
          // гравитацией enemy.y меняется каждый кадр, значит и полоска HP
          // должна пересчитывать своё место над головой, а не залипать).
          // rect.x — с поправкой на пивот по центру (см. spawnEnemy, Шаг C),
          // hpBarBg/hpBarFill пивот не меняли — остаются на левом крае.
          enemy.rect.x = enemy.x + ENEMY_WIDTH / 2
          enemy.rect.y = enemy.y
          enemy.rect.scale.x = enemy.facing // разворот патруля/погони — Шаг C
          // Спрайт зверя — та же позиция, что раньше была у rect (центр по X,
          // низ хитбокса по Y — см. anchor в spawnEnemy). По умолчанию всегда
          // idle на этом шаге; playSpriteAnim — no-op, если уже играет idle
          // (сравнение textures внутри), так что вызов каждый кадр не дёргает
          // анимацию заново. Флип/переключение по AI — следующий шаг.
          const beastFrames = beastFramesRef.current
          if (beastFrames) playSpriteAnim(enemy.sprite, beastFrames.idle, BEAST_IDLE_ANIM_SPEED, true)
          enemy.sprite.x = enemy.x + ENEMY_WIDTH / 2
          enemy.sprite.y = enemy.y + ENEMY_HEIGHT
          enemy.hpBarBg.x = enemy.x
          enemy.hpBarBg.y = enemy.y - ENEMY_HP_BAR_MARGIN - ENEMY_HP_BAR_HEIGHT
          enemy.hpBarFill.x = enemy.x
          enemy.hpBarFill.y = enemy.hpBarBg.y

          // Телеграф замаха: тонкий сигнал на плоском прямоугольнике без
          // спрайта — краснеет (danger), пока windingUp истинно.
          enemy.rect.tint = enemy.windingUp ? 0xe0353b : 0xffffff
        }

        player.x = phys.x
        player.y = phys.y

        // Ноги героя (anchor 0.5,1.0 — низ-центр) совпадают с низом-центром
        // прямоугольника-хитбокса.
        if (heroSpriteRef.current) {
          heroSpriteRef.current.x = player.x + PLAYER_WIDTH / 2
          heroSpriteRef.current.y = player.y + PLAYER_HEIGHT
        }

        // Приоритет анимаций героя (сверху вниз):
        // 0) смерть — АБСОЛЮТНЫЙ приоритет, пока deathRef.current истинен,
        //    ничего из веток ниже не выполняется (прыжок/hurt/атака/land/run
        //    больше не могут перебить падение);
        // а) в воздухе — позы прыжка, land/атака/hurt сбрасываются (прыжок
        //    прерывает замах и не тянет hurt на землю);
        // б) hurt в процессе — ГЛАВНЕЕ атаки/land/run, пока таймер > 0
        //    (хитстан обрывает замах — см. triggerHurt);
        // в) атака в процессе — урон ровно один раз на кадре удара
        //    (ATTACK_STRIKE_FRAME), НЕ на нажатии; land ниже по приоритету —
        //    атака его не даёт начать, пока идёт;
        // г) на земле, land ещё идёт И нет горизонтального ввода — доигрываем
        //    land (движение прерывает его — переход в ветку д);
        // д) обычный idle/run по движению.
        if (deathRef.current) {
          // Доиграла — замираем на последнем кадре и копим удержание;
          // abandon срабатывает РОВНО один раз (deathAbandonFiredRef).
          if (hero.currentFrame >= deathFrames.length - 1) {
            hero.gotoAndStop(deathFrames.length - 1)
            deathHoldRef.current += ticker.deltaMS
            if (deathHoldRef.current >= DEATH_HOLD_MS && !deathAbandonFiredRef.current) {
              deathAbandonFiredRef.current = true
              onClose?.()
            }
          }
          hero.anchor.set(0.5, GROUND_ANCHOR_Y)
        } else if (!phys.onGround) {
          const rising = phys.vy < 0
          hero.textures = jumpFrames
          hero.loop = false
          hero.gotoAndStop(rising ? RISE_FRAME : FALL_FRAME)
          hero.anchor.set(0.5, rising ? RISE_ANCHOR_Y : FALL_ANCHOR_Y)
          landTimerRef.current = 0
          attackingRef.current = false // прыжок отменяет замах
          hurtTimerRef.current = 0 // в воздухе — прыжок, hurt не тянем на землю
        } else if (hurtTimerRef.current > 0) {
          hurtTimerRef.current = Math.max(0, hurtTimerRef.current - ticker.deltaMS)
          hero.anchor.set(0.5, GROUND_ANCHOR_Y)
          if (hero.textures !== hurtFrames) {
            hero.textures = hurtFrames
            hero.loop = false
            hero.animationSpeed = HURT_ANIM_SPEED
            hero.gotoAndPlay(0)
          }
        } else if (attackingRef.current) {
          if (!attackHitDoneRef.current && hero.currentFrame >= ATTACK_STRIKE_FRAME) {
            applyAttackHit()
            attackHitDoneRef.current = true
          }
          if (hero.currentFrame >= attackFrames.length - 1 || !hero.playing) {
            attackingRef.current = false // доиграла — idle/run подхватит со следующего тика
          }
          hero.anchor.set(0.5, GROUND_ANCHOR_Y)
        } else if (landTimerRef.current > 0 && dirRef.current === 0) {
          landTimerRef.current = Math.max(0, landTimerRef.current - ticker.deltaMS)
          hero.anchor.set(0.5, GROUND_ANCHOR_Y)
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
          hero.anchor.set(0.5, GROUND_ANCHOR_Y)
          playAnim(dirRef.current !== 0 ? runFrames : idleFrames, dirRef.current !== 0 ? 0.4 : 0.15, true)
        }
        // Флип по facingRef (последнее ненулевое направление — не сбрасывается
        // в 0, в отличие от dirRef, так что герой не разворачивается лицом
        // вправо каждый раз, когда отпускаешь кнопку движения стоя на месте) —
        // работает во всех ветках, применяется всегда. Во время атаки — facing
        // ЗАФИКСИРОВАН на attackFacingRef (снят на старте замаха), не следует
        // за вводом до конца анимации.
        const heroFlipDir = attackingRef.current ? attackFacingRef.current : facingRef.current
        hero.scale.x = heroFlipDir === 1 ? Math.abs(hero.scale.x) : -Math.abs(hero.scale.x)

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
          app.destroy(true, { children: true })
        } catch {
          // Гонка с веткой "cancelled после init" в setup() — игнорируем.
        }
      }
      appRef.current = null
      heroSpriteRef.current = null
    }
  }, [])

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
      `}</style>

      {/* HP-плита (v2) — fixed сверху-слева, safe-area aware. Несёт HP-полосу/
          число и 3 гнезда с иконками событий (тип из eventKinds, состояние —
          закрыто/нет из eventClosed, тот же индекс). */}
      <div
        style={{
          position: 'fixed',
          top: 'calc(env(safe-area-inset-top) + 6px)',
          left: 8,
          zIndex: 1001,
          width: HP_FRAME_W,
          height: HP_FRAME_H,
          pointerEvents: 'none',
        }}
      >
        <img
          src={HP_FRAME_SRC}
          alt=""
          draggable={false}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
        />
        {/* Полоса HP лежит в нише плиты — рисуется ПОВЕРХ картинки (позже в
            DOM = выше в стэке), т.к. сама ниша в PNG непрозрачная (тёмная),
            не прозрачная дырка — "под" не был бы виден. */}
        <div
          ref={hpFillRef}
          style={{
            position: 'absolute',
            left: `${HP_WINDOW_X * 100}%`,
            top: `${HP_WINDOW_Y * 100}%`,
            height: `${HP_WINDOW_H * 100}%`,
            width: `${HP_WINDOW_W * 100}%`,
            background: '#4FB477',
          }}
        />
        <span
          ref={hpTextRef}
          style={{
            position: 'absolute',
            left: `${HPTXT_X * 100}%`,
            top: `${HPTXT_Y * 100}%`,
            transform: 'translate(-50%, -50%)',
            color: '#EDE7F2',
            fontSize: 13,
            fontWeight: 700,
            fontFamily: 'monospace',
            textShadow: '0 1px 2px rgba(0,0,0,0.9), 0 0 5px rgba(0,0,0,0.7)',
            whiteSpace: 'nowrap',
          }}
        >
          {maxHp}/{maxHp}
        </span>

        {/* 3 гнезда под иконки событий — центр в (SOCK_X[i], SOCK_Y) долях
            плиты, диаметр SOCK_SIZE*ширина_плиты. aspect-ratio:1 держит круг
            ровным (высота плиты считается по своей формуле, не 1:1). */}
        {SOCK_X.map((sockX, i) => {
          const closed = eventClosed[i]
          const kind = eventKinds[i]
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: `${sockX * 100}%`,
                top: `${SOCK_Y * 100}%`,
                width: `${SOCK_SIZE * 100}%`,
                aspectRatio: '1',
                transform: 'translate(-50%, -50%)',
                borderRadius: '50%',
              }}
            >
              {kind && (
                <img
                  src={EVENT_ICON_SRC[kind]}
                  alt=""
                  draggable={false}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    opacity: closed ? 1 : 0.8,
                  }}
                />
              )}
              {closed && (
                // Светящееся кольцо "завершено" — диаметр = иконка*RING_SCALE,
                // центр сдвинут на (RING_DX,RING_DY) долей размера иконки.
                // box-shadow (не filter/drop-shadow) на круглом элементе даёт
                // ровный ореол по всему кругу, без потёка вниз. Пульсация —
                // только opacity тени через @keyframes (см. EVENT_RING_PULSE_CSS
                // ниже в файле), layout не трогает.
                <div
                  style={{
                    position: 'absolute',
                    left: `calc(50% + ${RING_DX * 100}%)`,
                    top: `calc(50% + ${RING_DY * 100}%)`,
                    width: `${RING_SCALE * 100}%`,
                    aspectRatio: '1',
                    transform: 'translate(-50%, -50%)',
                    borderRadius: '50%',
                    border: `${RING_W}px solid #E8B23A`,
                    boxSizing: 'border-box',
                    animation: 'eventRingPulse 1.5s ease-in-out infinite',
                    pointerEvents: 'none',
                  }}
                />
              )}
            </div>
          )
        })}
      </div>

      {/* Шестерёнка настроек — отдельный fixed-элемент в правом верхнем углу
          (не часть плиты). Открывает панель настроек (settingsOpen), больше
          НЕ выходит из забега напрямую — выход теперь только через
          "Выйти" -> подтверждение внутри панели. */}
      <button
        onClick={() => setSettingsOpen(true)}
        aria-label="Настройки"
        style={{
          position: 'fixed',
          top: 'calc(env(safe-area-inset-top) + 6px)',
          right: 8,
          zIndex: 1001,
          width: 40,
          height: 40,
          padding: 0,
          border: 'none',
          background: 'none',
          cursor: 'pointer',
        }}
      >
        <img
          src={SETTINGS_ICON_SRC}
          alt=""
          draggable={false}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      </button>

      {/* Панель настроек — оверлей поверх живой игры (в проекте нет паузы,
          поэтому игра продолжает идти под затемнением). Клик по подложке
          закрывает панель. */}
      {settingsOpen && (
        <div
          onClick={() => setSettingsOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 5000,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative',
              width: SETTINGS_FRAME_W,
              height: SETTINGS_FRAME_H,
            }}
          >
            <img
              src={SETTINGS_FRAME_SRC}
              alt=""
              draggable={false}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
            />
            {/* Столбец кнопок — на тёмном центральном поле рамки, с отступом
                от каменной оправы по бокам (~18% ширины рамки), чтобы не
                залезать на камень. Порядок сверху вниз: Продолжить (главный
                способ закрыть панель, крестик убран — не работал) -> Звук/
                Музыка (заглушки) -> Выйти (опасное действие, внизу и отдельно
                по цвету). */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                padding: '30% 18%',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                gap: 14,
              }}
            >
              <button
                onClick={() => setSettingsOpen(false)}
                style={{
                  padding: '14px 8px',
                  borderRadius: 10,
                  border: '2px solid #E8B23A',
                  background: '#221E2B',
                  color: '#EDE7F2',
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Продолжить
              </button>
              {['Звук', 'Музыка'].map((label) => (
                <button
                  key={label}
                  disabled
                  style={{
                    padding: '14px 8px',
                    borderRadius: 10,
                    border: '1px solid #3A3344',
                    background: '#221E2B',
                    color: '#EDE7F2',
                    fontSize: 15,
                    fontWeight: 700,
                    opacity: 0.5,
                    cursor: 'default',
                  }}
                >
                  {label}
                </button>
              ))}
              <button
                onClick={() => setExitConfirmOpen(true)}
                style={{
                  padding: '14px 8px',
                  borderRadius: 10,
                  border: '1px solid #E0353B',
                  background: '#221E2B',
                  color: '#EDE7F2',
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Выйти
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Подтверждение выхода — поверх панели настроек (выше z-index). */}
      {exitConfirmOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 6000,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 300,
              background: '#221E2B',
              border: '1px solid #3A3344',
              borderRadius: 14,
              padding: 20,
              textAlign: 'center',
            }}
          >
            <div style={{ color: '#EDE7F2', fontSize: 15, marginBottom: 18, lineHeight: 1.4 }}>
              {/* TODO: взять реальные трофеи забега/игрока — Explore сейчас
                  не получает trophies пропом, старый выход тоже нигде не
                  показывал число. Заглушка 0, пока не подключат данные. */}
              Выйти из забега? Вы потеряете {0} трофеев
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setExitConfirmOpen(false)}
                style={{
                  flex: 1,
                  padding: '12px 8px',
                  borderRadius: 10,
                  border: '1px solid #3A3344',
                  background: '#15131A',
                  color: '#EDE7F2',
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Отмена
              </button>
              <button
                onClick={() => onClose?.()}
                style={{
                  flex: 1,
                  padding: '12px 8px',
                  borderRadius: 10,
                  border: 'none',
                  background: '#E0353B',
                  color: '#EDE7F2',
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Выйти
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        style={{
          position: 'fixed',
          left: 16,
          bottom: 'calc(16px + env(safe-area-inset-bottom))',
          zIndex: 1001,
          display: 'flex',
          gap: 12,
        }}
      >
        <button
          aria-label="Влево"
          onPointerDown={() => { dirRef.current = -1 }}
          onPointerUp={() => { dirRef.current = 0 }}
          onPointerLeave={() => { dirRef.current = 0 }}
          onPointerCancel={() => { dirRef.current = 0 }}
          style={{
            width: 72,
            height: 72,
            borderRadius: 12,
            background: '#221E2B',
            border: '1px solid #3A3344',
            color: '#EDE7F2',
            fontSize: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            touchAction: 'none',
            userSelect: 'none',
            WebkitUserSelect: 'none',
          }}
        >
          ◀
        </button>
        <button
          aria-label="Вправо"
          onPointerDown={() => { dirRef.current = 1 }}
          onPointerUp={() => { dirRef.current = 0 }}
          onPointerLeave={() => { dirRef.current = 0 }}
          onPointerCancel={() => { dirRef.current = 0 }}
          style={{
            width: 72,
            height: 72,
            borderRadius: 12,
            background: '#221E2B',
            border: '1px solid #3A3344',
            color: '#EDE7F2',
            fontSize: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            touchAction: 'none',
            userSelect: 'none',
            WebkitUserSelect: 'none',
          }}
        >
          ▶
        </button>
      </div>

      <button
        aria-label="Прыжок"
        onPointerDown={() => { jumpPressedRef.current = true }}
        style={{
          position: 'fixed',
          right: 16,
          bottom: 'calc(16px + env(safe-area-inset-bottom))',
          zIndex: 1001,
          width: 80,
          height: 80,
          borderRadius: 16,
          background: '#221E2B',
          border: '1px solid #3A3344',
          color: '#EDE7F2',
          fontSize: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
      >
        ▲
      </button>

      <button
        aria-label="Атака"
        onPointerDown={() => { attackPressedRef.current = true }}
        style={{
          position: 'fixed',
          right: 112,
          bottom: 'calc(16px + env(safe-area-inset-bottom))',
          zIndex: 1001,
          width: 80,
          height: 80,
          borderRadius: 16,
          background: '#221E2B',
          border: '1px solid #3A3344',
          color: '#EDE7F2',
          fontSize: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
      >
        ⚔
      </button>

      <button
        aria-label="Уклонение"
        onPointerDown={() => { dodgePressedRef.current = true }}
        style={{
          position: 'fixed',
          right: 112,
          bottom: 'calc(16px + 80px + 12px + env(safe-area-inset-bottom))',
          zIndex: 1001,
          width: 70,
          height: 70,
          borderRadius: 16,
          background: '#221E2B',
          border: '1px solid #3A3344',
          color: '#EDE7F2',
          fontSize: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
      >
        🔄
      </button>
    </div>
  )
}
