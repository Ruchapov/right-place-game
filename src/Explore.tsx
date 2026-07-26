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

// Физика (калибруется под модель прыжка из SKILL-maps: вверх 1 и вверх 2
// берутся, вверх 3 — нет; по прямой до 4 тайлов)
const GRAVITY = 0.31 // было 0.8 — пересчитано под модель
const MAX_FALL = 20
const MOVE_SPEED = 4 // px/кадр, подберём на телефоне
const JUMP_VELOCITY = 10 // сила толчка вверх

const CAMERA_V_ANCHOR = 0.65 // 0.5 = центр экрана, больше = игрок ниже
const WORLD_SCALE = 0.75 // 1 = как сейчас, меньше = видно больше карты

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

// Единственный неподвижный враг (Шаг 2-1). x/y — верхний левый угол в мировых
// координатах (как у phys игрока). lastHitSwingId — id взмаха атаки, который
// этому врагу уже засчитан, чтобы один активный хитбокс не бил его каждый
// кадр, пока длится (см. attackSwingIdRef).
type Enemy = {
  x: number
  y: number
  hp: number
  maxHp: number
  lastHitSwingId: number
  rect: Graphics
  hpBarBg: Graphics
  hpBarFill: Graphics
}

// "3 события за забег" — ВРЕМЕННЫЙ каркас (Phase 2, часть 2). kind совпадает
// со строками ROOM_LABELS в App.tsx (enemy/chest/smuggler/puzzle/boss), чтобы
// результат забега можно было отдать старому results-экрану без маппинга.
export type EventKind = 'enemy' | 'chest' | 'smuggler' | 'puzzle' | 'boss'

type EventCandidate = { kind: EventKind; x: number; y: number }

type MapEvent = EventCandidate & { marker: Graphics; closed: boolean }

const EVENT_MARKER_COLOR: Record<EventKind, number> = {
  enemy: 0xe0353b,
  chest: 0xe8b23a,
  smuggler: 0x8fd9f0,
  puzzle: 0x46c4e8,
  boss: 0xf08a24,
}

const EVENTS_PER_RUN = 3

function isPointXY(value: unknown): value is [number, number] {
  return Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'number'
}

// Собирает ВСЕ доступные точки-кандидаты события из пулов слот-файла карты.
// enemyCluster (3 врага) считается ОДНИМ событием — метка ставится в первую
// точку кластера. npc.smuggler/npc.puzzle/boss могут отсутствовать (null) —
// на карте A их нет, но механизм общий для всех карт A-F.
function buildEventCandidates(slots: unknown): EventCandidate[] {
  const s = slots as {
    enemyClusters?: { points?: unknown }[]
    reward?: unknown[]
    npc?: { smuggler?: unknown; puzzle?: unknown }
    boss?: unknown
  } | null
  const candidates: EventCandidate[] = []

  for (const cluster of s?.enemyClusters ?? []) {
    const first = Array.isArray(cluster?.points) ? cluster.points[0] : null
    if (isPointXY(first)) candidates.push({ kind: 'enemy', x: first[0], y: first[1] })
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

  // Единственный враг этого шага (Шаг 2-1) — неподвижный, спавнится в setup()
  // из первой точки первого enemyCluster карты.
  const enemyRef = useRef<Enemy | null>(null)

  function updateHpBar() {
    const pct = Math.max(0, Math.min(100, (hpRef.current / maxHp) * 100))
    if (hpFillRef.current) {
      hpFillRef.current.style.width = `${pct}%`
      hpFillRef.current.style.background = pct <= 30 ? '#E0353B' : '#4FB477'
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

    async function setup() {
      app = new Application()
      appRef.current = app
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

      // "3 события за забег" — временный каркас: выбираем случайно, без повторов,
      // из общего пула (enemyCluster / сундук / смуглер / загадка / босс — что
      // есть у карты). На карте A есть только enemyClusters и reward.
      const chosenEvents = pickRandom(buildEventCandidates(slots), EVENTS_PER_RUN)
      setEventClosed(Array(chosenEvents.length).fill(false))

      // Шаг 2-1: один неподвижный враг — первая точка первого enemyCluster.
      // Полный кластер из 3 и засчёт события как "убить всех" — позже.
      const firstClusterPoint = Array.isArray(slots?.enemyClusters) ? slots.enemyClusters[0]?.points?.[0] : null
      const enemySpawn = isPointXY(firstClusterPoint) ? { x: firstClusterPoint[0], y: firstClusterPoint[1] } : null

      const startRaw = slots?.start
      if (
        !Array.isArray(startRaw) ||
        typeof startRaw[0] !== 'number' ||
        typeof startRaw[1] !== 'number'
      ) {
        console.error('Explore: слот-файл карты не содержит корректный start:[x,y]', slots)
        app.destroy(true, { children: true })
        return
      }
      const start = { x: startRaw[0], y: startRaw[1] }

      const mapCanvas = await renderMapToCanvas({ grid, decor, tileSize: TILE_SIZE })

      if (cancelled || !containerRef.current) {
        app.destroy(true, { children: true })
        return
      }

      await app.init({
        width: window.innerWidth,
        height: window.innerHeight,
        background: 0x15131a,
        backgroundAlpha: 1,
        resizeTo: window,
      })

      if (cancelled || !containerRef.current) {
        app.destroy(true, { children: true })
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

      // Враг (Шаг 2-1) — неподвижный прямоугольник-заглушка, спрайт зверя
      // подключим отдельным шагом. Ставим ногами на пол клетки, как игрока.
      if (enemySpawn) {
        const enemyWorldX = enemySpawn.x * TILE_SIZE + TILE_SIZE / 2 - ENEMY_WIDTH / 2
        const enemyWorldY = (enemySpawn.y + 1) * TILE_SIZE - ENEMY_HEIGHT

        const enemyRect = new Graphics()
          .rect(0, 0, ENEMY_WIDTH, ENEMY_HEIGHT)
          .fill(ENEMY_COLOR)
          .stroke({ width: 2, color: 0xffffff })
        enemyRect.x = enemyWorldX
        enemyRect.y = enemyWorldY
        worldContainer.addChild(enemyRect)

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
          hp: ENEMY_MAX_HP,
          maxHp: ENEMY_MAX_HP,
          lastHitSwingId: 0,
          rect: enemyRect,
          hpBarBg,
          hpBarFill,
        }
        enemyRef.current = enemy
        redrawEnemyHpBar(enemy)
      } else {
        console.error('Explore: у карты нет enemyClusters[0].points[0] — враг не заспавнен', slots)
      }

      // Временные метки-заглушки на местах выбранных событий (см. chosenEvents
      // выше). Настоящие спрайты подключим, когда появится реальная логика
      // "убить 3 врагов" / "открыть сундук атакой".
      eventsRef.current = chosenEvents.map((ev) => {
        const marker = new Graphics()
          .circle(0, 0, TILE_SIZE * 0.35)
          .fill({ color: EVENT_MARKER_COLOR[ev.kind], alpha: 0.85 })
          .stroke({ width: 3, color: 0xffffff })
        marker.x = ev.x * TILE_SIZE + TILE_SIZE / 2
        marker.y = ev.y * TILE_SIZE + TILE_SIZE / 2
        worldContainer.addChild(marker)
        return { ...ev, marker, closed: false }
      })

      // DEBUG ONLY — тонкая рамка зоны удара, пока она активна. Чисто
      // визуальный слой, на хитбокс/урон не влияет; убрать когда атака
      // перестанет быть единственной обратной связью игроку об ударе.
      const attackHitboxGraphics = new Graphics()
      worldContainer.addChild(attackHitboxGraphics)

      // Камера: центрируем игрока на экране, зажимая по границам карты.
      const worldWidth = grid[0].length * TILE_SIZE * worldContainer.scale.x
      const worldHeight = grid.length * TILE_SIZE * worldContainer.scale.y

      const updateCamera = () => {
        // player.x/y и player.width/height — координаты МИРА (локальные для
        // worldContainer), а worldContainer.x/y — координаты ЭКРАНА. При
        // scale != 1 их нельзя смешивать без множителя s.
        const s = WORLD_SCALE
        const targetX = app!.screen.width / 2 - (player.x + player.width / 2) * s
        worldContainer.x = clamp(targetX, app!.screen.width - worldWidth, 0)

        const targetY = app!.screen.height * CAMERA_V_ANCHOR - (player.y + player.height / 2) * s
        worldContainer.y = clamp(targetY, app!.screen.height - worldHeight, 0)
      }

      updateCamera()

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
        // Настоящую логику (убить 3 врагов / открыть сундук атакой) навесим
        // отдельно — здесь только счётчик и HUD-иконки.
        for (let i = 0; i < eventsRef.current.length; i++) {
          const ev = eventsRef.current[i]
          if (ev.closed) continue
          const evLeft = ev.x * TILE_SIZE
          const evTop = ev.y * TILE_SIZE
          const touching =
            phys.x < evLeft + TILE_SIZE &&
            phys.x + PLAYER_WIDTH > evLeft &&
            phys.y < evTop + TILE_SIZE &&
            phys.y + PLAYER_HEIGHT > evTop
          if (!touching) continue

          ev.closed = true
          ev.marker.visible = false
          setEventClosed((prev) => {
            const next = [...prev]
            next[i] = true
            return next
          })

          if (!runCompleteFiredRef.current && eventsRef.current.every((e) => e.closed)) {
            runCompleteFiredRef.current = true
            onRunCompleteRef.current(eventsRef.current.map((e) => ({ kind: e.kind })))
          }
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

        // Враг (Шаг 2-1): неподвижный, не атакует. "Один удар = один засчёт" —
        // сверяем attackSwingIdRef с lastHitSwingId, а не просто "хитбокс
        // активен", иначе все ~9 кадров окна ATTACK_ACTIVE_MS нанесли бы урон
        // отдельно.
        const enemy = enemyRef.current
        if (
          enemy &&
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
              enemyRef.current = null
            } else {
              redrawEnemyHpBar(enemy)
            }
          }
        }

        player.x = phys.x
        player.y = phys.y

        updateCamera()
      })
    }

    setup()

    return () => {
      cancelled = true
      if (app) {
        app.destroy(true, { children: true })
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

      <div
        style={{
          position: 'fixed',
          top: 'calc(16px + env(safe-area-inset-top))',
          left: 16,
          zIndex: 1001,
          width: 160,
          height: 20,
          borderRadius: 6,
          background: '#221E2B',
          border: '1px solid #3A3344',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          ref={hpFillRef}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: '100%',
            background: '#4FB477',
          }}
        />
        <span
          ref={hpTextRef}
          style={{
            position: 'relative',
            color: '#EDE7F2',
            fontSize: 11,
            fontFamily: 'monospace',
          }}
        >
          {maxHp}/{maxHp}
        </span>
      </div>

      <div
        style={{
          position: 'fixed',
          top: 'calc(16px + env(safe-area-inset-top))',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1001,
          display: 'flex',
          gap: 10,
        }}
      >
        {eventClosed.map((closed, i) => (
          <div
            key={i}
            style={{
              width: 18,
              height: 18,
              borderRadius: '50%',
              background: closed ? '#E8B23A' : '#9C93AD',
              border: '2px solid #221E2B',
            }}
          />
        ))}
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

      {onClose && (
        <button
          onClick={onClose}
          style={{
            position: 'fixed',
            top: 16,
            right: 16,
            zIndex: 1001,
            padding: '8px 16px',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.3)',
            background: 'rgba(0,0,0,0.6)',
            color: 'white',
            fontSize: 16,
            cursor: 'pointer',
          }}
        >
          Закрыть
        </button>
      )}
    </div>
  )
}
