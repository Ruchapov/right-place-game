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
