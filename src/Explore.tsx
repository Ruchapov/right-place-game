import { useEffect, useRef } from 'react'
import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js'
import { renderMapToCanvas } from './mapRenderer'

type ExploreProps = {
  onClose?: () => void
}

const TILE_SIZE = 64
const PLAYER_COLOR = 0xe0353b

type Grid = string[][]

// Зажимает value в [min, max]. Если min > max (карта меньше экрана по этой
// оси), выворачивать диапазон нельзя — ставим 0.
function clamp(value: number, min: number, max: number): number {
  if (min > max) return 0
  return Math.min(max, Math.max(min, value))
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
      app.stage.addChild(worldContainer)

      const mapTexture = Texture.from(mapCanvas)
      const mapSprite = new Sprite(mapTexture)
      mapSprite.x = 0
      mapSprite.y = 0
      worldContainer.addChild(mapSprite)

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
      const worldWidth = grid[0].length * TILE_SIZE * worldContainer.scale.x
      const worldHeight = grid.length * TILE_SIZE * worldContainer.scale.y

      const targetX = app.screen.width / 2 - (player.x + player.width / 2)
      worldContainer.x = clamp(targetX, app.screen.width - worldWidth, 0)

      const targetY = app.screen.height / 2 - (player.y + player.height / 2)
      worldContainer.y = clamp(targetY, app.screen.height - worldHeight, 0)
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
