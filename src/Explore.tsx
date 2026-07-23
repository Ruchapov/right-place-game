import { useEffect, useRef, useState } from 'react'
import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js'
import { renderMapToCanvas, PLATFORM_H_RATIO } from './mapRenderer'

type ExploreProps = {
  onClose?: () => void
}

const TILE_SIZE = 64
const PLAYER_COLOR = 0xe0353b
const PLAYER_WIDTH = TILE_SIZE
const PLAYER_HEIGHT = TILE_SIZE * 2

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

type Rect = { x: number; y: number; w: number; h: number }

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

// Блокирующий прямоугольник клетки (cx,cy), или null если клетка не твердь.
// '#' — вся клетка. '=' — только полоса сверху (PLATFORM_H_RATIO), см.
// drawPlatform в mapRenderer.ts. Край сетки (снизу/по бокам) — твердь на всю
// клетку, чтобы не улететь за карту; выше верхнего края — воздух (null).
function cellBlockRect(grid: Grid, tileSize: number, cx: number, cy: number): Rect | null {
  const width = grid[0]?.length ?? 0
  const height = grid.length
  if (cy < 0) return null
  if (cy >= height || cx < 0 || cx >= width) {
    return { x: cx * tileSize, y: cy * tileSize, w: tileSize, h: tileSize }
  }
  const ch = grid[cy][cx]
  if (ch === '#') return { x: cx * tileSize, y: cy * tileSize, w: tileSize, h: tileSize }
  if (ch === '=') return { x: cx * tileSize, y: cy * tileSize, w: tileSize, h: tileSize * PLATFORM_H_RATIO }
  return null
}

// Все блокирующие прямоугольники клеток, перекрывающих габарит игрока —
// AABB против AABB, весь диапазон клеток по X и Y, без выборочных точек.
// Срабатывает и на случай "уже внутри на старте кадра": проверяется факт
// пересечения ТЕКУЩИХ габаритов, а не движение/пересечение границы во времени.
function overlappingBlockRects(grid: Grid, tileSize: number, player: Rect): Rect[] {
  const cx0 = Math.floor(player.x / tileSize)
  const cx1 = Math.floor((player.x + player.w - 1) / tileSize)
  const cy0 = Math.floor(player.y / tileSize)
  const cy1 = Math.floor((player.y + player.h - 1) / tileSize)

  const rects: Rect[] = []
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const rect = cellBlockRect(grid, tileSize, cx, cy)
      if (rect && rectsOverlap(player, rect)) rects.push(rect)
    }
  }
  return rects
}

export default function Explore({ onClose }: ExploreProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const physicsRef = useRef<PlayerPhysics>({ x: 0, y: 0, vx: 0, vy: 0, onGround: false })
  const dirRef = useRef(0) // -1 влево, 0 стоп, 1 вправо — читается каждый кадр в ticker
  const jumpPressedRef = useRef(false) // флаг нажатия, читается и сбрасывается в ticker

  // DEBUG ONLY — убрать после калибровки прыжка
  const [debugInfo, setDebugInfo] = useState({ onGround: false, jumpTiles: 0 })

  useEffect(() => {
    let app: Application | null = null
    let cancelled = false

    async function setup() {
      app = new Application()
      appRef.current = app
      const base = import.meta.env.BASE_URL

      const [mapText, slots] = await Promise.all([
        fetch(`${base}assets/maps/map_A_serpentine.txt`).then((res) => res.text()),
        fetch(`${base}assets/maps/map_A_slots.json`).then((res) => res.json()),
      ])

      const grid: Grid = mapText.split('\n').map((line) => line.split(''))
      const decor = slots.decor ?? []

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

      // DEBUG ONLY — визуализация коллизии, убрать после калибровки.
      // Один объект на всё время жизни, каждый кадр только clear()+redraw —
      // никаких new Graphics() в ticker (просадка на телефоне).
      const DEBUG_CELL_RADIUS = 8
      const debugGraphics = new Graphics()
      worldContainer.addChild(debugGraphics)

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

      // DEBUG ONLY — убрать после калибровки прыжка
      let debugFrameCounter = 0
      let airborneStartY: number | null = null
      let minYDuringFlight = 0
      let lastJumpTiles = 0

      app.ticker.add((ticker) => {
        const dt = ticker.deltaTime
        const startY = phys.y
        const wasOnGround = phys.onGround

        // Горизонтальное движение
        phys.vx = dirRef.current * MOVE_SPEED
        phys.x += phys.vx * dt

        if (phys.vx > 0) {
          const px = phys.x + PLAYER_WIDTH - 1
          const hit =
            isSolid(grid, TILE_SIZE, px, phys.y + 1) ||
            isSolid(grid, TILE_SIZE, px, phys.y + PLAYER_HEIGHT / 2) ||
            isSolid(grid, TILE_SIZE, px, phys.y + PLAYER_HEIGHT - 1)
          if (hit) {
            phys.x = Math.floor((phys.x + PLAYER_WIDTH) / TILE_SIZE) * TILE_SIZE - PLAYER_WIDTH
            phys.vx = 0
          }
        } else if (phys.vx < 0) {
          const px = phys.x
          const hit =
            isSolid(grid, TILE_SIZE, px, phys.y + 1) ||
            isSolid(grid, TILE_SIZE, px, phys.y + PLAYER_HEIGHT / 2) ||
            isSolid(grid, TILE_SIZE, px, phys.y + PLAYER_HEIGHT - 1)
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
        // prevTop/prevBottom — габарит игрока ДО движения по Y в этом кадре
        // (startY захвачен в начале тика, до горизонтали/прыжка/гравитации).
        const prevTop = startY
        const prevBottom = startY + PLAYER_HEIGHT
        if (phys.vy > 0) {
          // Падение — разрешена ТОЛЬКО постановка СВЕРХУ. Кандидат блокирует,
          // только если ноги пересекли его верхнюю границу именно в этом
          // кадре (были выше — стали ниже). Просто пересечение AABB без
          // этого условия не считается: 2-тайловый игрок может перекрывать
          // клетку '=' головой, находясь ещё высоко над ней при падении —
          // это не приземление, и раньше именно так телепортировало наверх.
          const newBottom = phys.y + PLAYER_HEIGHT
          const playerBox: Rect = { x: phys.x, y: phys.y, w: PLAYER_WIDTH, h: PLAYER_HEIGHT }
          const candidates = overlappingBlockRects(grid, TILE_SIZE, playerBox)
            .filter((r) => prevBottom <= r.y && newBottom > r.y)
          if (candidates.length > 0) {
            const blockTop = Math.min(...candidates.map((r) => r.y))
            phys.y = blockTop - PLAYER_HEIGHT
            phys.vy = 0
            phys.onGround = true
          }
        } else if (phys.vy < 0) {
          // Подъём — разрешён ТОЛЬКО удар ГОЛОВОЙ. Кандидат блокирует, только
          // если голова пересекла его нижнюю границу именно в этом кадре
          // (были ниже — стали выше). Если игрок оказался внутри полосы без
          // пересечения границы (застрял) — кандидат не пройдёт фильтр,
          // клетка просто игнорируется, никакого телепорта.
          const newTop = phys.y
          const playerBox: Rect = { x: phys.x, y: phys.y, w: PLAYER_WIDTH, h: PLAYER_HEIGHT }
          const candidates = overlappingBlockRects(grid, TILE_SIZE, playerBox)
            .filter((r) => prevTop >= r.y + r.h && newTop < r.y + r.h)
          if (candidates.length > 0) {
            const blockBottom = Math.max(...candidates.map((r) => r.y + r.h))
            phys.y = blockBottom
            phys.vy = 0
          }
        }

        // DEBUG ONLY — убрать после калибровки прыжка
        if (wasOnGround && !phys.onGround) {
          airborneStartY = startY
          minYDuringFlight = phys.y
        } else if (!phys.onGround && airborneStartY !== null) {
          minYDuringFlight = Math.min(minYDuringFlight, phys.y)
        } else if (!wasOnGround && phys.onGround && airborneStartY !== null) {
          lastJumpTiles = (airborneStartY - minYDuringFlight) / TILE_SIZE
          airborneStartY = null
        }

        player.x = phys.x
        player.y = phys.y

        // DEBUG ONLY — перерисовка коллизионных прямоугольников вокруг игрока.
        debugGraphics.clear()
        const dbgCx = Math.floor((phys.x + PLAYER_WIDTH / 2) / TILE_SIZE)
        const dbgCy = Math.floor((phys.y + PLAYER_HEIGHT / 2) / TILE_SIZE)
        for (let cy = dbgCy - DEBUG_CELL_RADIUS; cy <= dbgCy + DEBUG_CELL_RADIUS; cy++) {
          if (cy < 0 || cy >= grid.length) continue
          for (let cx = dbgCx - DEBUG_CELL_RADIUS; cx <= dbgCx + DEBUG_CELL_RADIUS; cx++) {
            if (cx < 0 || cx >= grid[0].length) continue
            const ch = grid[cy][cx]
            if (ch === '#') {
              debugGraphics
                .rect(cx * TILE_SIZE, cy * TILE_SIZE, TILE_SIZE, TILE_SIZE)
                .fill({ color: 0xff0000, alpha: 0.15 })
                .stroke({ width: 1, color: 0xff0000, alpha: 0.7 })
            } else if (ch === '=') {
              debugGraphics
                .rect(cx * TILE_SIZE, cy * TILE_SIZE, TILE_SIZE, TILE_SIZE * PLATFORM_H_RATIO)
                .fill({ color: 0xffff00, alpha: 0.25 })
                .stroke({ width: 1, color: 0xffff00, alpha: 0.8 })
            }
          }
        }
        debugGraphics
          .rect(phys.x, phys.y, PLAYER_WIDTH, PLAYER_HEIGHT)
          .stroke({ width: 2, color: 0x4488ff })

        updateCamera()

        // DEBUG ONLY — троттлим React-обновление, не дёргаем setState каждый кадр
        debugFrameCounter++
        if (debugFrameCounter % 15 === 0) {
          const currentJumpTiles =
            airborneStartY !== null ? (airborneStartY - minYDuringFlight) / TILE_SIZE : lastJumpTiles
          setDebugInfo({
            onGround: phys.onGround,
            jumpTiles: Math.round(currentJumpTiles * 10) / 10,
          })
        }
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

      {/* DEBUG ONLY — убрать после калибровки прыжка */}
      <div
        style={{
          position: 'fixed',
          top: 16,
          left: 16,
          zIndex: 1001,
          padding: '4px 8px',
          borderRadius: 6,
          background: 'rgba(0,0,0,0.6)',
          color: '#EDE7F2',
          fontSize: 11,
          fontFamily: 'monospace',
          pointerEvents: 'none',
        }}
      >
        jump: {debugInfo.jumpTiles.toFixed(1)} | onGround: {String(debugInfo.onGround)}
      </div>

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
