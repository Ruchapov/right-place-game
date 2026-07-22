import { useEffect, useRef, useState } from 'react'
import { Application, Sprite, Texture } from 'pixi.js'
import { renderMapToCanvas } from './mapRenderer'

type ExploreProps = {
  onClose?: () => void
}

const TILE_SIZE = 64
const ZOOM_INITIAL = 0.3

export default function Explore({ onClose }: ExploreProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const [zoom, setZoom] = useState(ZOOM_INITIAL)

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

      const grid = mapText.split('\n').map((line) => line.split(''))
      const decor = slots.decor ?? []

      const mapCanvas = await renderMapToCanvas({ grid, decor, tileSize: TILE_SIZE })

      if (cancelled || !containerRef.current) {
        app.destroy(true, { children: true })
        return
      }

      await app.init({
        width: mapCanvas.width,
        height: mapCanvas.height,
        background: 0x15131a,
        backgroundAlpha: 1,
      })

      if (cancelled || !containerRef.current) {
        app.destroy(true, { children: true })
        return
      }

      containerRef.current.appendChild(app.canvas)
      app.canvas.style.touchAction = 'auto'
      app.stage.scale.set(ZOOM_INITIAL)

      const mapTexture = Texture.from(mapCanvas)
      const mapSprite = new Sprite(mapTexture)
      mapSprite.x = 0
      mapSprite.y = 0
      app.stage.addChild(mapSprite)
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
        overflow: 'auto',
      }}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      <div
        style={{
          position: 'fixed',
          bottom: 16,
          left: 16,
          right: 16,
          zIndex: 1002,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 16px',
          borderRadius: 8,
          background: 'rgba(0,0,0,0.75)',
          color: 'white',
          fontSize: 16,
        }}
      >
        <input
          type="range"
          min={0.1}
          max={1.0}
          step={0.05}
          value={zoom}
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            setZoom(v)
            appRef.current?.stage.scale.set(v)
          }}
          style={{ flex: 1 }}
        />
        <span>Zoom: {zoom.toFixed(2)}</span>
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
