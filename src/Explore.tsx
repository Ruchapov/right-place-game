import { useEffect, useRef, useState } from 'react'
import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js'
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

const HP_PER_ENDURANCE = 8 // как в бою: 1 Endurance = 8 HP
const FALLBACK_MAX_HP = 80 // если endurance ещё не прокинут/недоступен

// Арт-фрейм HP-бара (каменная оправа с портретом героя + тёмная ниша под
// полосу справа). Ширина отрисовки — доля экрана с потолком в px, чтобы не
// раздувался гигантским на широких экранах; высота — из пропорции картинки.
const HP_FRAME_SRC = `${import.meta.env.BASE_URL}assets/hp_frame.png`
const HP_FRAME_ASPECT = 403 / 1160 // height/width исходного PNG
const HP_FRAME_W = 'clamp(180px, 50vw, 260px)'
// Высота — тем же выражением, что и ширина, умноженным на аспект: НЕ через
// CSS aspect-ratio. aspect-ratio даёт контейнеру "auto"-высоту для целей
// разрешения %-высоты/позиции АБСОЛЮТНО спозиционированных детей в part
// WebView (Android system WebView в Telegram) — из-за этого fill-полоса
// внутри окна теряла привязку и вылезала за рамку. calc() даёт контейнеру
// РЕАЛЬНУЮ пиксельную высоту, поэтому left/top/width/height потомков в %
// считаются от неё однозначно во всех движках.
const HP_FRAME_H = `calc(${HP_FRAME_W} * ${HP_FRAME_ASPECT})`
// Окно под полосу HP внутри фрейма — доли (0..1) от размера ВСЕЙ картинки,
// не пиксели, чтобы не зависеть от масштаба отрисовки (см. HP_FRAME_W).
// Подобрано вживую временным тюнером (см. историю коммитов).
const HP_WINDOW_X = 0.345
const HP_WINDOW_Y = 0.35
const HP_WINDOW_W = 0.62
const HP_WINDOW_H = 0.265

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
  hpBarBg: Graphics
  hpBarFill: Graphics
}

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
  const dirRef = useRef(0) // -1 влево, 0 стоп, 1 вправо — читается каждый кадр в ticker
  const jumpPressedRef = useRef(false) // флаг нажатия, читается и сбрасывается в ticker

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

  // Пока никто не вызывает — понадобится шипам и другим источникам урона.
  // Смерть (hp <= 0) завершает забег тем же путём, что и кнопка выхода —
  // потеря трофеев на abandon обрабатывается там же, где обрабатывается onClose.
  function takeDamage(amount: number) {
    hpRef.current = Math.max(0, hpRef.current - amount)
    updateHpBar()
    if (hpRef.current <= 0) {
      onClose?.()
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
        worldContainer.addChild(rect)

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
        if (jumpPressedRef.current) {
          jumpPressedRef.current = false
          if (phys.onGround) {
            phys.vy = -JUMP_VELOCITY
            phys.onGround = false
          }
        }

        // Вертикальная физика (гравитация + приземление)
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
          if (attackCooldownRef.current <= 0) {
            attackCooldownRef.current = ATTACK_COOLDOWN
            attackActiveRef.current = true
            attackActiveTimerRef.current = ATTACK_ACTIVE_MS
            attackSwingIdRef.current += 1 // новый взмах — враги смогут получить урон от него ровно один раз
            // Хитбокс — прямоугольник шириной ATTACK_RANGE перед игроком, по
            // направлению взгляда (facingRef), высотой в его рост. Считается
            // один раз на старте удара (снимок, как мгновенная проверка
            // дистанции в Battle.tsx), а не каждый кадр активности.
            attackHitboxRef.current =
              facingRef.current === 1
                ? { x: phys.x + PLAYER_WIDTH, y: phys.y, width: ATTACK_RANGE, height: PLAYER_HEIGHT }
                : { x: phys.x - ATTACK_RANGE, y: phys.y, width: ATTACK_RANGE, height: PLAYER_HEIGHT }
          }
        }

        if (attackActiveRef.current) {
          attackActiveTimerRef.current -= ticker.deltaMS
          if (attackActiveTimerRef.current <= 0) {
            attackActiveRef.current = false
            attackHitboxRef.current = null
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
        // сперва — попал ли по нему только что взмах игрока ("один удар = один
        // засчёт" через attackSwingIdRef/lastHitSwingId, Шаг 2-1), затем, если
        // выжил, — AI (преследование/windup/удар по игроку, Шаг 2-2). Если
        // игрок стоит между двумя врагами — оба независимо проверяют дистанцию
        // и оба могут его ударить в один и тот же кадр; HP игрока один общий
        // (takeDamageRef), отдельно считать не нужно.
        for (let i = 0; i < enemiesRef.current.length; i++) {
          const enemy = enemiesRef.current[i]

          // "Один удар = один засчёт" — сверяем attackSwingIdRef с
          // lastHitSwingId, а не просто "хитбокс активен", иначе все ~9
          // кадров окна ATTACK_ACTIVE_MS нанесли бы урон отдельно.
          if (
            attackActiveRef.current &&
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
                worldContainer.removeChild(enemy.rect, enemy.hpBarBg, enemy.hpBarFill)
                enemy.rect.destroy()
                enemy.hpBarBg.destroy()
                enemy.hpBarFill.destroy()
                enemiesRef.current.splice(i, 1)
                i--
                // Кластер (enemy-событие) закрывается, когда убиты ВСЕ его
                // враги — не касанием, см. touch-цикл выше, который явно
                // пропускает kind==='enemy'.
                const ownerEvent = eventsRef.current[enemy.eventIndex]
                if (ownerEvent) {
                  ownerEvent.remainingEnemies = Math.max(0, (ownerEvent.remainingEnemies ?? 1) - 1)
                  if (ownerEvent.remainingEnemies <= 0) closeEvent(enemy.eventIndex)
                }
                continue // мёртвому AI ниже не нужен
              }
              redrawEnemyHpBar(enemy)
            }
          }

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

      {/* Верхняя панель HUD — СПЛОШНАЯ непрозрачная полоса на всю ширину:
          HP-фрейм слева (главный, крупнее всех), сразу за ним — иконки
          событий (мельче), шестерёнка настроек прижата в правый угол через
          marginLeft:auto. Раньше все три жили как самостоятельные fixed-
          блоки поверх прозрачного канваса — теперь один непрозрачный
          контейнер-панель (фон #221E2B), канвас рисуется под ней по
          z-index (канвас-обёртка — 1000, эта панель — 1001), не наоборот. */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          width: '100%',
          zIndex: 1001,
          background: '#221E2B',
          borderBottom: '2px solid #3A3344',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: 'calc(env(safe-area-inset-top) + 8px) 12px 8px',
          boxSizing: 'border-box',
        }}
      >
        {/* Тонкий янтарный акцент ПОД тёмной кромкой — отдельный слой, не
            борьба с border-bottom за один и тот же пиксель. */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: -1,
            height: 1,
            background: '#E8B23A',
            pointerEvents: 'none',
          }}
        />
        {/* HP-фрейм — левый блок, главный (крупнее иконок событий). Собственный
            fixed/top/left убраны, позицию теперь задаёт панель-контейнер. */}
        <div
          style={{
            position: 'relative',
            width: HP_FRAME_W,
            height: HP_FRAME_H,
            flexShrink: 0,
            pointerEvents: 'none',
          }}
        >
          <img
            src={HP_FRAME_SRC}
            alt=""
            draggable={false}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
          />
          {/* Полоса HP лежит в тёмной нише окна фрейма — рисуется ПОВЕРХ
              картинки фрейма (позже в DOM = выше в стэке), т.к. сама ниша в
              PNG непрозрачная (тёмная), не прозрачная дырка — "под" не был бы виден. */}
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
              left: `${(HP_WINDOW_X + HP_WINDOW_W / 2) * 100}%`,
              top: `${(HP_WINDOW_Y + HP_WINDOW_H / 2) * 100}%`,
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
        </div>

        {/* Иконки прогресса событий — сразу за HP-фреймом, мельче него. */}
        <div style={{ display: 'flex', gap: 6 }}>
          {eventClosed.map((closed, i) => (
            <div
              key={i}
              style={{
                position: 'relative',
                width: 30,
                height: 30,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: closed ? '0 0 6px 2px #E8B23A' : 'none',
                border: closed ? '2px solid #E8B23A' : 'none',
              }}
            >
              {eventKinds[i] && (
                <img
                  src={EVENT_ICON_SRC[eventKinds[i]]}
                  alt=""
                  draggable={false}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    opacity: closed ? 1 : 0.8,
                    filter: closed ? 'none' : 'grayscale(40%)',
                  }}
                />
              )}
              {closed && (
                <span
                  style={{
                    position: 'absolute',
                    bottom: -4,
                    right: -4,
                    fontSize: 10,
                    lineHeight: 1,
                    color: '#221E2B',
                    background: '#E8B23A',
                    borderRadius: '50%',
                    width: 12,
                    height: 12,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  ✓
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Шестерёнка настроек — marginLeft:auto прижимает её в правый угол,
            отдельно от иконок событий. Заменяет старую кнопку "Закрыть" (тот
            же обработчик onClose — выход из забега). Полноценная панель
            настроек — отдельная задача, тут только сам клик. */}
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Настройки"
            style={{
              width: 40,
              height: 40,
              flexShrink: 0,
              marginLeft: 'auto',
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
        )}
      </div>

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
