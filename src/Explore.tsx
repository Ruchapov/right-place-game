import { useEffect, useRef } from 'react'
import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js'
import { renderMapToCanvas } from './mapRenderer'

type ExploreProps = {
  onClose?: () => void
}

const TILE_SIZE = 64
const PLAYER_COLOR = 0xe0353b

type Grid = string[][]

const SOLID_CHARS = '#=^'

function isAirChar(ch: string | undefined): boolean {
  return ch !== undefined && !SOLID_CHARS.includes(ch)
}

function isStandChar(ch: string | undefined): boolean {
  return ch === '#' || ch === '='
}

// Сканирует колонки слева направо, в каждой — сверху вниз. Первая клетка
// стояния: сама клетка и клетка над ней — воздух, клетка под ней — твёрдая.
function findStart(grid: Grid): { x: number; y: number } {
  const height = grid.length
  const width = height > 0 ? grid[0].length : 0

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const here = grid[y]?.[x]
      const above = y > 0 ? grid[y - 1]?.[x] : undefined
      const below = grid[y + 1]?.[x]
      if (isAirChar(here) && (above === undefined || isAirChar(above)) && isStandChar(below)) {
        return { x, y }
      }
    }
  }
  return { x: 0, y: 0 }
}

// Камера центрирует игрока, но не показывает пустоту за краями карты.
function clampCamera(desired: number, worldSize: number, screenSize: number): number {
  if (worldSize <= screenSize) return (screenSize - worldSize) / 2
  return Math.min(0, Math.max(screenSize - worldSize, desired))
}

export default function Explore({ onClose }: ExploreProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)

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
      app.stage.addChild(worldContainer)

      const mapTexture = Texture.from(mapCanvas)
      const mapSprite = new Sprite(mapTexture)
      mapSprite.x = 0
      mapSprite.y = 0
      worldContainer.addChild(mapSprite)

      const start = findStart(grid)
      const player = new Graphics()
        .rect(0, 0, TILE_SIZE, TILE_SIZE * 2)
        .fill(PLAYER_COLOR)
        .stroke({ width: 2, color: 0xffffff })
      player.x = start.x * TILE_SIZE
      player.y = (start.y + 1) * TILE_SIZE - TILE_SIZE * 2
      worldContainer.addChild(player)

      // Камера: центрируем игрока на экране, зажимая по границам карты.
      // Игрок пока неподвижен, поэтому позиция камеры считается один раз
      // (когда появится движение — этот расчёт переедет в ticker).
      const worldWidth = mapCanvas.width
      const worldHeight = mapCanvas.height
      const playerCenterX = player.x + TILE_SIZE / 2
      const playerCenterY = player.y + TILE_SIZE
      worldContainer.x = clampCamera(app.screen.width / 2 - playerCenterX, worldWidth, app.screen.width)
      worldContainer.y = clampCamera(app.screen.height / 2 - playerCenterY, worldHeight, app.screen.height)
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
