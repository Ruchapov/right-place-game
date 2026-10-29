import { CanvasSource, Container, Rectangle, Sprite, Texture } from 'pixi.js'
import type { BackdropPreset } from '../../mapRenderer'
import type { Grid } from '../types'
import * as C from '../constants'

// АТМОСФЕРА ТЕМ КАРТ (20.10.2026; болото — 29.10.2026): ветер, пыль, листья,
// зола, соринки, туман и капли.
//
// Перенос одобренного образца four-theme-atmosphere-v2 (архив арта, вне
// репозитория). Формулы движения — образца дословно, числа — в constants.ts
// (ATMOSPHERE и ATMO_*). Что изменено против образца, и почему:
// - Образец заворачивал частицы в свой фрагмент 800×400. Здесь рамка — видимая
//   область камеры плюс поле (ATMO_*_MARGIN), а плотность та же: число частиц
//   пересчитывается от площади рамки. Частица при этом живёт в координатах
//   МИРА и едет с картой, когда идёт камера; на другой край она перескакивает
//   за кадром.
// - Образец маскировал частицы картинкой «воздуха». Здесь маски нет: узел
//   атмосферы лежит в контейнере мира ПОД готовым слоем карты, и платформы
//   закрывают частицы сами. Отличие одно: мелкий декор слоя (свечи, кости)
//   тоже закрывает их, а у образца пыль ложилась поверх декора.
// - Капли падают не с верха фрагмента, а с настоящих потолков (клетка '#' с
//   воздухом под ней) и до пола под ними, а не 363 px (решение Андрея
//   20.10.2026). Туман — полоса над полом нижнего зала, а не на высоте 280 px
//   фрагмента.
//
// Шаг времени — из тикера Explore.tsx (deltaMS), своего requestAnimationFrame
// нет: тикер стоит — стоит и атмосфера (экран итогов, свёрнутое приложение).
// Паузы в игре нет вовсе — панель настроек лежит поверх идущей игры, и под ней
// атмосфера движется вместе с врагами.
//
// Создаёт систему Explore.tsx, и только при WebGL и без «уменьшения движения»
// в системе: запасной рендерер Canvas2D и так платит за кадр в десятки раз
// больше, а «уменьшение движения» — прямая просьба игрока.
//
// Всё рисуется спрайтами одной маленькой текстуры (три кадра: круг, мягкое
// пятно, белый квадрат), которую модуль сам рисует на старте и сам уничтожает
// в dispose. Спрайты создаются, только когда пулу их не хватает (старт забега,
// поворот экрана), в тике — ни одного нового объекта.

/** Видимая область камеры, px мира. Explore.tsx заполняет один и тот же объект на каждом тике. */
export type AtmosphereView = { left: number; top: number; width: number; height: number }

export type AtmosphereDeps = {
  /** Контейнер мира. Узел атмосферы кладётся в него СРАЗУ, при создании, — поэтому создавать систему надо ДО слоя карты. */
  parent: Container
  theme: BackdropPreset
  /** Сетка карты: по ней — потолки капель и пол тумана. '#' — твердь, '=' — полка, остальное — воздух. */
  grid: Grid
  mapWidth: number
  mapHeight: number
}

/**
 * Ветер образца: порывы от ≈−0.03 до ≈0.89. Один на всё — его накопление
 * сносит частицы, им же качаются камыш и осока болота (entities/swayDecor.ts).
 */
export function windAt(t: number): number {
  return 0.12 + 0.62 * Math.pow(0.5 + 0.5 * Math.sin(t * 0.51 + Math.sin(t * 0.19)), 3) + 0.15 * Math.sin(t * 1.7)
}

// Хеш образца: тот же номер частицы — те же «случайные» числа, без Math.random.
function rnd(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

function wrap(v: number, max: number): number {
  return ((v % max) + max) % max
}

// Текстура атмосферы: 128×64, три кадра. Круг нарисован радиусом 15 в клетке
// 32, поэтому спрайт круга растягивается на DISC_K, чтобы эллипс вышел ровно
// тех полуосей, что у образца. Квадрат залит шире своего кадра — при
// растягивании соседние прозрачные пиксели в край не подмешиваются.
const TEX_W = 128
const TEX_H = 64
const DISC_FRAME = new Rectangle(0, 0, 32, 32)
const DISC_R = 15
const DISC_K = DISC_FRAME.width / (2 * DISC_R)
const SOFT_FRAME = new Rectangle(32, 0, 64, 64)
const BLOCK_FRAME = new Rectangle(106, 6, 8, 8)

function drawAtmosphereCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = TEX_W
  canvas.height = TEX_H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(16, 16, DISC_R, 0, Math.PI * 2)
  ctx.fill()
  // Мягкое пятно тумана: плотность от центра к краю линейно до нуля — так
  // рисовал образец (радиальный градиент с двумя точками).
  const cx = SOFT_FRAME.x + SOFT_FRAME.width / 2, cy = SOFT_FRAME.y + SOFT_FRAME.height / 2
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, SOFT_FRAME.width / 2)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  ctx.fillRect(SOFT_FRAME.x, SOFT_FRAME.y, SOFT_FRAME.width, SOFT_FRAME.height)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(BLOCK_FRAME.x - 4, BLOCK_FRAME.y - 4, BLOCK_FRAME.width + 8, BLOCK_FRAME.height + 8)
  return canvas
}

type Mote = { s: Sprite; bx: number; kx: number; by: number }
type Flake = Mote & { spin: number }
type Emitter = { s: Sprite; x: number; y0: number; phaseEnd: number }
type FogBand = { start: number; end: number; floorTop: number; blobs: Sprite[] }

export function createAtmosphereSystem(deps: AtmosphereDeps) {
  const themeLook = C.ATMOSPHERE[deps.theme]
  if (themeLook === null) throw new Error(`Atmosphere: у темы ${deps.theme} атмосферы нет — систему не создавать (Explore.tsx)`)
  const look: C.AtmosphereThemeLook = themeLook
  const { grid, mapWidth, mapHeight } = deps
  const T = C.TILE_SIZE
  const cols = Math.round(mapWidth / T)
  const rows = Math.round(mapHeight / T)
  const at = (x: number, y: number) => grid[y]?.[x] ?? '.'
  const solid = (x: number, y: number) => at(x, y) === '#'
  const blocks = (x: number, y: number) => { const c = at(x, y); return c === '#' || c === '=' }

  const source = new CanvasSource({ resource: drawAtmosphereCanvas() })
  const discTex = new Texture({ source, frame: DISC_FRAME })
  const softTex = new Texture({ source, frame: SOFT_FRAME })
  const blockTex = new Texture({ source, frame: BLOCK_FRAME })

  // Порядок внутри — как у образца: пыль, листья или зола, капли, туман.
  const root = new Container()
  root.label = 'atmosphere'
  const dustLayer = new Container()
  const flakeLayer = new Container()
  const dripLayer = new Container()
  const fogLayer = new Container()
  root.addChild(dustLayer, flakeLayer, dripLayer, fogLayer)
  deps.parent.addChild(root)

  const sprite = (tex: Texture, layer: Container) => {
    const s = new Sprite(tex)
    s.anchor.set(0.5)
    s.visible = false
    layer.addChild(s)
    return s
  }

  // Пыль: номер i — те же хеши, что у образца (rnd(i+4), rnd(i+23), …).
  const dust: Mote[] = []
  function growDust(n: number) {
    for (let i = dust.length; i < n; i++) {
      const s = sprite(discTex, dustLayer)
      s.tint = look.color
      s.alpha = 0.24 + rnd(i + 9) * 0.32
      s.width = 2 * (1.1 + rnd(i + 6) * 1.5) * DISC_K
      s.height = 2 * (0.8 + rnd(i + 12) * 0.7) * DISC_K
      dust.push({ s, bx: rnd(i + 4), kx: 0.5 + rnd(i + 23), by: rnd(i + 41) })
    }
  }

  const flakes: Flake[] = []
  function growFlakes(n: number) {
    for (let i = flakes.length; i < n; i++) {
      const s = sprite(discTex, flakeLayer)
      s.tint = look.color
      s.alpha = 0.42 + rnd(i + 3) * 0.28
      s.width = 2 * look.flakeRx * DISC_K
      s.height = 2 * look.flakeRy * DISC_K
      flakes.push({ s, bx: rnd(i + 121), kx: (1 + rnd(i + 51)) * 2, by: rnd(i + 61), spin: 0.7 + rnd(i) })
    }
  }

  // Капли: по источнику на клетку потолка. Штрих стартует на свою длину выше
  // линии клетки — выходит из-за камня — и гаснет, когда его верх дошёл до
  // верха пола (или полки '='): к этому мгновению он целиком за камнем пола.
  const emitters: Emitter[] = []
  if (look.drips) {
    for (let y = 0; y < rows - 1; y++) for (let x = 0; x < cols; x++) {
      if (!solid(x, y) || blocks(x, y + 1)) continue
      let yy = y + 1
      while (yy < rows && !blocks(x, yy)) yy++
      const i = emitters.length
      const y0 = (y + 1) * T - C.ATMO_DRIP_LEN
      const floorTop = Math.min(yy * T, mapHeight)
      const s = sprite(blockTex, dripLayer)
      s.anchor.set(0.5, 0)
      s.tint = C.ATMO_DRIP_COLOR
      s.alpha = C.ATMO_DRIP_ALPHA
      s.width = C.ATMO_DRIP_WIDTH
      emitters.push({ s, x: x * T + rnd(i + 70) * T, y0, phaseEnd: Math.sqrt((floorTop - y0) / C.ATMO_DRIP_ACCEL) })
    }
    if (emitters.length === 0) console.warn(`Atmosphere: тема ${deps.theme} капает с потолков, а потолков ('#' с воздухом под ней) на карте нет — капель не будет`)
  }

  // Туман: самый нижний ряд пола, где пол тянется хотя бы ATMO_FOG_MIN_CELLS
  // клеток; полос столько, сколько таких отрезков в этом ряду.
  const fogBands: FogBand[] = []
  const isFloor = (x: number, y: number) => solid(x, y) && !blocks(x, y - 1)
  if (look.fog > 0) {
    for (let y = rows - 1; y > 0 && fogBands.length === 0; y--) {
      let x = 0
      while (x < cols) {
        if (!isFloor(x, y)) { x++; continue }
        let e = x + 1
        while (e < cols && isFloor(e, y)) e++
        if (e - x >= C.ATMO_FOG_MIN_CELLS) {
          const start = x * T, end = e * T
          const n = Math.round((end - start + 2 * C.ATMO_FOG_R) * C.ATMO_FOG_PER_PX)
          const blobs: Sprite[] = []
          for (let i = 0; i < n; i++) {
            const s = sprite(softTex, fogLayer)
            s.tint = look.color
            s.width = 2 * C.ATMO_FOG_R
            s.height = 2 * C.ATMO_FOG_R * C.ATMO_FOG_SQUASH
            blobs.push(s)
          }
          fogBands.push({ start, end, floorTop: y * T, blobs })
        }
        x = e
      }
    }
    if (fogBands.length === 0) console.warn(`Atmosphere: у темы ${deps.theme} есть туман, а пола нижнего зала (ряд пола от ${C.ATMO_FOG_MIN_CELLS} клеток) на карте нет — тумана не будет`)
  }

  let time = C.ATMO_START_TIME_S
  let windDistance = 0
  let wind = windAt(time)

  const inMap = (x: number, y: number) => x >= 0 && x <= mapWidth && y >= 0 && y <= mapHeight

  function update(deltaMS: number, view: AtmosphereView) {
    const dt = Math.min(C.ATMO_MAX_DT_S, Math.max(0, deltaMS) / 1000)
    time += dt
    windDistance += dt * (0.18 + windAt(time))
    wind = windAt(time)
    const t = time
    const travel = look.speed * windDistance
    const viewRight = view.left + view.width
    const viewBottom = view.top + view.height

    // Пыль.
    const dW = view.width + 2 * C.ATMO_DUST_MARGIN, dH = view.height + 2 * C.ATMO_DUST_MARGIN
    const dL = view.left - C.ATMO_DUST_MARGIN, dT = view.top - C.ATMO_DUST_MARGIN
    const dustN = Math.round((look.dust * dW * dH) / (C.ATMO_DUST_BOX_W * C.ATMO_DUST_BOX_H))
    if (dustN > dust.length) growDust(dustN)
    const dustFall = t * look.dustFall
    for (let i = 0; i < dust.length; i++) {
      const p = dust[i]
      if (i >= dustN) { p.s.visible = false; continue }
      const x = dL + wrap(p.bx * dW + travel * p.kx - dL, dW)
      const y = dT + wrap(p.by * dH + dustFall + 5 * Math.sin(t * 0.7 + i) - dT, dH)
      p.s.visible = inMap(x, y)
      p.s.position.set(x, y)
    }

    // Листья (кладбище), зола (литейная) или соринки (болото).
    if (look.flakes > 0) {
      const fW = view.width + 2 * C.ATMO_FLAKE_MARGIN_X, fH = view.height + 2 * C.ATMO_FLAKE_MARGIN_Y
      const fL = view.left - C.ATMO_FLAKE_MARGIN_X, fT = view.top - C.ATMO_FLAKE_MARGIN_Y
      const flakeN = Math.round((look.flakes * fW * fH) / (C.ATMO_FLAKE_BOX_W * C.ATMO_FLAKE_BOX_H))
      if (flakeN > flakes.length) growFlakes(flakeN)
      const flakeFall = t * look.flakeFall
      for (let i = 0; i < flakes.length; i++) {
        const p = flakes[i]
        if (i >= flakeN) { p.s.visible = false; continue }
        const x = fL + wrap(p.bx * fW + travel * p.kx - fL, fW)
        const y = fT + wrap(p.by * fH + flakeFall + 13 * Math.sin(t + i * 3) - fT, fH)
        p.s.visible = inMap(x, y)
        p.s.position.set(x, y)
        p.s.rotation = t * p.spin + i
      }
    }

    // Капли. Длина и наклон штриха — от ветра, один на все капли кадра.
    if (emitters.length > 0) {
      const slant = wind * C.ATMO_DRIP_SLANT
      const len = Math.hypot(slant, C.ATMO_DRIP_LEN)
      const rot = -Math.atan2(slant, C.ATMO_DRIP_LEN)
      for (let i = 0; i < emitters.length; i++) {
        const e = emitters[i]
        const phase = wrap(t + i * 1.71, C.ATMO_DRIP_CYCLE_MIN_S + rnd(i + 1) * C.ATMO_DRIP_CYCLE_SPREAD_S)
        if (phase >= e.phaseEnd) { e.s.visible = false; continue }
        const x = e.x + wind * phase * C.ATMO_DRIP_DRIFT
        const y = e.y0 + phase * phase * C.ATMO_DRIP_ACCEL
        if (x < view.left - 4 || x > viewRight + 4 || y > viewBottom || y + len < view.top) { e.s.visible = false; continue }
        e.s.visible = true
        e.s.position.set(x, y)
        e.s.height = len
        e.s.rotation = rot
      }
    }

    // Туман: пятна дрейфуют вдоль полосы и гаснут у её концов.
    for (const band of fogBands) {
      const period = band.end - band.start + 2 * C.ATMO_FOG_R
      for (let i = 0; i < band.blobs.length; i++) {
        const s = band.blobs[i]
        const x = band.start - C.ATMO_FOG_R + wrap(i * C.ATMO_FOG_STEP + travel * C.ATMO_FOG_DRIFT, period)
        const fade = Math.min(1, Math.max(0, Math.min(x - band.start, band.end - x) / C.ATMO_FOG_R))
        if (fade <= 0 || x + C.ATMO_FOG_R < view.left || x - C.ATMO_FOG_R > viewRight) { s.visible = false; continue }
        s.visible = true
        s.position.set(x, band.floorTop - look.fogLift + C.ATMO_FOG_BOB * Math.sin(t * 0.27 + i))
        s.alpha = look.fog * fade
      }
    }
  }

  function dispose() {
    root.destroy({ children: true })
    discTex.destroy()
    softTex.destroy()
    blockTex.destroy()
    source.destroy()
  }

  return { update, dispose }
}
