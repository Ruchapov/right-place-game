import { useEffect, useRef, useState } from 'react'
import { Application, Graphics } from 'pixi.js'
// import { Assets, Sprite, Texture } from 'pixi.js' // временно отключено — проверка геометрии через Graphics

type ExploreProps = {
  onClose?: () => void
}

type DebugInfo = {
  mapWidthPx: number
  mapHeightPx: number
  gridLength: number
  tileCount: number
  fetchStatus: string
  canvasStyleWidth?: string
  canvasStyleHeight?: string
  canvasOffsetWidth?: number
  canvasOffsetHeight?: number
  canvasAttrWidth?: number
  canvasAttrHeight?: number
  gridRow0?: string
  gridRow1?: string
  gridRow2?: string
}

const TILE_SIZE = 64

export default function Explore({ onClose }: ExploreProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null)

  useEffect(() => {
    let app: Application | null = null
    let cancelled = false

    async function setup() {
      app = new Application()
      const base = import.meta.env.BASE_URL

      let mapText: string
      try {
        // Assets.load(`${base}assets/maps/tileset/stone_tile_seamless.png`) — временно отключено, проверяем геометрию через Graphics
        mapText = await fetch(`${base}assets/maps/map_A_serpentine.txt`).then((res) => res.text())
      } catch (e) {
        if (!cancelled) {
          setDebugInfo({
            mapWidthPx: 0,
            mapHeightPx: 0,
            gridLength: 0,
            tileCount: 0,
            fetchStatus: `ошибка загрузки: ${e instanceof Error ? e.message : String(e)}`,
          })
        }
        return
      }

      if (!mapText) {
        if (!cancelled) {
          setDebugInfo({
            mapWidthPx: 0,
            mapHeightPx: 0,
            gridLength: 0,
            tileCount: 0,
            fetchStatus: 'ошибка: mapText пустой',
          })
        }
        return
      }

      const grid = mapText.split('\n').map((line) => line.split(''))
      const mapWidthPx = Math.max(0, ...grid.map((row) => row.length)) * TILE_SIZE
      const mapHeightPx = grid.length * TILE_SIZE

      await app.init({ width: mapWidthPx, height: mapHeightPx, background: 0x0d0820, backgroundAlpha: 1 })

      if (cancelled || !containerRef.current) {
        app.destroy(true, { children: true })
        return
      }

      containerRef.current.appendChild(app.canvas)
      app.canvas.style.touchAction = 'auto'

      // const tileTexture: Texture = Assets.get(`${base}assets/maps/tileset/stone_tile_seamless.png`) — временно отключено

      let tileCount = 0
      for (let y = 0; y < grid.length; y++) {
        const row = grid[y]
        for (let x = 0; x < row.length; x++) {
          const cell = row[x]
          if (cell === '#') {
            const tile = new Graphics()
            tile
              .rect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE)
              .fill(0x555566)
              .stroke({ width: 2, color: 0x1a1a2a })
            app.stage.addChild(tile)
            tileCount += 1
          }
          // '.' = воздух, ничего не рисуем; остальные символы пока игнорируем
        }
      }

      setDebugInfo({
        mapWidthPx,
        mapHeightPx,
        gridLength: grid.length,
        tileCount,
        fetchStatus: 'ok',
        canvasStyleWidth: app.canvas.style.width,
        canvasStyleHeight: app.canvas.style.height,
        canvasOffsetWidth: app.canvas.offsetWidth,
        canvasOffsetHeight: app.canvas.offsetHeight,
        canvasAttrWidth: app.canvas.width,
        canvasAttrHeight: app.canvas.height,
        gridRow0: grid[0]?.join('') ?? '',
        gridRow1: grid[1]?.join('') ?? '',
        gridRow2: grid[2]?.join('') ?? '',
      })
    }

    setup()

    return () => {
      cancelled = true
      if (app) {
        app.destroy(true, { children: true })
      }
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
        overflow: 'auto',
      }}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {debugInfo && (
        <div
          style={{
            position: 'fixed',
            top: 16,
            left: 16,
            zIndex: 1002,
            padding: '12px 16px',
            borderRadius: 8,
            background: 'rgba(0,0,0,0.75)',
            color: 'white',
            fontSize: 16,
            lineHeight: 1.5,
            whiteSpace: 'pre-line',
            pointerEvents: 'none',
          }}
        >
          {`DEBUG
mapWidthPx: ${debugInfo.mapWidthPx}
mapHeightPx: ${debugInfo.mapHeightPx}
grid.length: ${debugInfo.gridLength}
tileCount: ${debugInfo.tileCount}
fetchStatus: ${debugInfo.fetchStatus}
canvasStyleWidth: ${debugInfo.canvasStyleWidth ?? '-'}
canvasStyleHeight: ${debugInfo.canvasStyleHeight ?? '-'}
canvasOffsetWidth: ${debugInfo.canvasOffsetWidth ?? '-'}
canvasOffsetHeight: ${debugInfo.canvasOffsetHeight ?? '-'}
canvasAttrWidth: ${debugInfo.canvasAttrWidth ?? '-'}
canvasAttrHeight: ${debugInfo.canvasAttrHeight ?? '-'}
grid[0]: ${debugInfo.gridRow0 ?? '-'}
grid[1]: ${debugInfo.gridRow1 ?? '-'}
grid[2]: ${debugInfo.gridRow2 ?? '-'}`}
        </div>
      )}

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
