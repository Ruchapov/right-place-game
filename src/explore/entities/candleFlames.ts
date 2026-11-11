import { Container, Geometry, GlProgram, Graphics, Mesh, Shader, Sprite, Texture, UniformGroup } from 'pixi.js'
import * as C from '../constants'
import type { LiveFlamePoint } from '../liveDecorManifest'

// ЖИВЫЕ СВЕЧИ (12.11.2026, задание shaders_task/task-freeze-candles.md, эталон —
// candles_preview.mp4 и decor_preview.mp4, одобрены Андреем).
//
// Нарисованное пламя свечей и огонёк в нише колонны стёрты со слоя карты при сборке
// (tools/live_decor_flames.mjs); точки фитилей — src/explore/liveDecorManifest.ts.
// Здесь огонь рисуется кодом, на каждый фитиль:
//   • пламя — маленький Mesh со своим Shader (НЕ Filter: uv квада 0..1), одна
//     GlProgram и одна геометрия на все огни; у огня свой uSeed, uTime общий;
//   • свечение — мягкий круглый спрайт (радиальный градиент, текстура одна на
//     забег), blendMode 'add', тёплый #ffa040, «дышит» вместе с высотой пламени;
//   • 2 искорки, изредка поднимаются и гаснут за ~1.5 с;
//   • порыв от рывка героя (ближе GUST_RADIUS по x): пламя ниже на 75%, клонится от
//     героя, свечение тускнеет так же; спадает за 0.9 с. Обычный бег не гасит.
// Ни одного Filter. Огонь вне рамки камеры не обновляется и не рисуется. Без WebGL —
// капля Graphics вместо шейдера, как у fireShader.ts.

const VERTEX = `in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}
`

// Шейдер из задания один в один; добавлены uGust и uDir (порыв от рывка) и uLight
// (общая яркость: при порыве пламя тусклее). uv.y = 0 сверху, v = 1 − uv.y.
const FRAGMENT = `precision highp float;
in vec2 vUV;
out vec4 finalColor;
uniform float uTime;
uniform float uSeed;
uniform float uGust;
uniform float uDir;
float h(float n){return fract(sin(n)*43758.5453);}
float n1(float x){float i=floor(x),f=fract(x);f=f*f*(3.-2.*f);return mix(h(i),h(i+1.),f);}
void main(){
  float fl = (0.88 + 0.12*n1(uTime*9.+uSeed) + 0.06*sin(uTime*23.+uSeed)) * (1.0 - 0.75*uGust);
  float v  = (1.0 - vUV.y) / max(fl, 0.05);
  float sway = (n1(uTime*2.5+uSeed)-0.5)*1.6 + 0.25*sin(uTime*5.+uSeed) - 2.2*uGust*uDir;
  float cx = 0.5 + (sway*pow(max(v,0.),1.6) + 0.6*sin(uTime*17.+uSeed)*v*v)*0.22;
  float w  = 0.30*clamp(sqrt(max(v,0.)*5.),0.,1.)*pow(clamp(1.-v,0.,1.),1.1) + 1e-3;
  float I  = clamp(1. - abs(vUV.x-cx)/w, 0., 1.) * step(0.,v) * step(v,1.);
  vec3 col = vec3(0.88,0.31,0.08);
  col = mix(col, vec3(1.0,0.67,0.16), clamp((I-0.25)/0.3,0.,1.));
  float core = clamp((I-0.55)/0.25,0.,1.)*clamp(1.-(v-0.15)/0.5,0.,1.)*step(0.06,v);
  col = mix(col, vec3(1.0,0.96,0.78), core);
  col = mix(col, vec3(0.35,0.47,1.0), clamp(1.-v/0.1,0.,1.)*step(0.2,I)*0.35);
  float a = clamp(I*2.2,0.,1.);
  finalColor = vec4(col*a, a);
}
`

// Мерцание высоты — та же формула, что fl в шейдере (без порыва).
const hash1 = (n: number) => { const s = Math.sin(n) * 43758.5453; return s - Math.floor(s) }
function noise1(x: number): number {
  const i = Math.floor(x)
  let f = x - i
  f = f * f * (3 - 2 * f)
  return hash1(i) + (hash1(i + 1) - hash1(i)) * f
}
const flicker = (t: number, seed: number) => 0.88 + 0.12 * noise1(t * 9 + seed) + 0.06 * Math.sin(t * 23 + seed)

/** Текстура мягкого круга: радиальный градиент от белого к прозрачному (одна на забег). */
function makeGlowTexture(): Texture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size; canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return Texture.from(canvas)
}

type Spark = { dot: Sprite; t: number; wait: number; dx: number }

type FlameEntry = {
  point: LiveFlamePoint
  root: Container
  flame: Mesh<Geometry, Shader> | Graphics
  uniforms: { uTime: number; uGust: number; uDir: number } | null
  glow: Sprite
  glowSize: number
  glowAlpha: number
  sparks: Spark[]
  seed: number
  gust: number
  /** Высота квада пламени, мировые px. */
  qh: number
}

export type CandleFlameDeps = {
  parent: Container
  points: LiveFlamePoint[]
  webgl: boolean
}

export function createCandleFlameSystem(deps: CandleFlameDeps) {
  // Единичный квад: x −0.5..0.5, y −1..0 (низ — фитиль); uv.y = 0 сверху.
  const geometry = deps.webgl
    ? new Geometry({
      attributes: {
        aPosition: new Float32Array([-0.5, -1, 0.5, -1, 0.5, 0, -0.5, 0]),
        aUV: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      },
      indexBuffer: [0, 1, 2, 0, 2, 3],
    })
    : null
  const program = deps.webgl ? GlProgram.from({ vertex: VERTEX, fragment: FRAGMENT, name: 'candle-flame' }) : null
  const glowTexture = makeGlowTexture()
  const entries: FlameEntry[] = []
  let timeS = 0

  for (const point of deps.points) {
    const niche = point.kind === 'niche'
    // Размер квада: ~2× ширины и 1.2× высоты прежнего пламени (задание).
    const qw = Math.max(C.CANDLE_FLAME_MIN_W, point.w * 2)
    const qh = Math.max(C.CANDLE_FLAME_MIN_H, point.h * 1.2)
    const root = new Container()
    root.x = point.x
    root.y = point.y
    root.label = 'candle-flame'
    const glow = new Sprite(glowTexture)
    glow.anchor.set(0.5)
    glow.tint = C.CANDLE_GLOW_COLOR
    glow.blendMode = 'add'
    glow.y = -qh * 0.45
    const glowSize = qh * (niche ? C.CANDLE_NICHE_GLOW_SIZE : C.CANDLE_GLOW_SIZE)
    root.addChild(glow)

    const seed = Math.random() * 100
    let flame: FlameEntry['flame']
    let uniforms: FlameEntry['uniforms'] = null
    if (geometry && program) {
      const group = new UniformGroup({
        uTime: { value: 0, type: 'f32' },
        uSeed: { value: seed, type: 'f32' },
        uGust: { value: 0, type: 'f32' },
        uDir: { value: 1, type: 'f32' },
      })
      const mesh = new Mesh({ geometry, shader: new Shader({ glProgram: program, resources: { candleUniforms: group } }) })
      mesh.scale.set(qw, qh)
      flame = mesh
      uniforms = group.uniforms as FlameEntry['uniforms']
    } else {
      const g = new Graphics()
      g.ellipse(0, -qh * 0.32, qw * 0.16, qh * 0.32).fill({ color: 0xff9a30, alpha: 0.9 })
      g.ellipse(0, -qh * 0.3, qw * 0.08, qh * 0.2).fill({ color: 0xfff0c0, alpha: 0.9 })
      flame = g
    }
    root.addChild(flame)

    const sparks: Spark[] = []
    if (!niche) {
      for (let k = 0; k < C.CANDLE_SPARKS; k++) {
        const dot = new Sprite(glowTexture)
        dot.anchor.set(0.5)
        dot.width = dot.height = C.CANDLE_SPARK_SIZE
        dot.tint = C.CANDLE_SPARK_COLOR
        dot.blendMode = 'add'
        dot.visible = false
        root.addChild(dot)
        sparks.push({ dot, t: 0, wait: C.CANDLE_SPARK_WAIT_MIN_S + Math.random() * C.CANDLE_SPARK_WAIT_RAND_S, dx: 0 })
      }
    }
    deps.parent.addChild(root)
    entries.push({ point, root, flame, uniforms, glow, glowSize, glowAlpha: niche ? C.CANDLE_NICHE_GLOW_ALPHA : C.CANDLE_GLOW_ALPHA, sparks, seed, gust: 0, qh })
  }

  /**
   * Шаг: время, мерцание свечения, искорки, порыв. Рамка камеры — в мировых px.
   * dash — рывок героя в этом кадре: центр героя и сторона рывка, иначе null.
   */
  function update(deltaMS: number, left: number, top: number, right: number, bottom: number, dash: { x: number; y: number; dir: 1 | -1 } | null) {
    const dtS = deltaMS / 1000
    timeS = (timeS + dtS) % C.CANDLE_TIME_WRAP_S
    for (const e of entries) {
      const p = e.point
      if (dash !== null && Math.abs(p.x - dash.x) < C.CANDLE_GUST_RADIUS && Math.abs(p.y - dash.y) < C.CANDLE_GUST_RADIUS_Y) {
        e.gust = 1
        if (e.uniforms) e.uniforms.uDir = dash.dir
      } else if (e.gust > 0) {
        e.gust = Math.max(0, e.gust - dtS / C.CANDLE_GUST_FADE_S)
      }
      const pad = e.glowSize
      const on = p.x + pad >= left && p.x - pad <= right && p.y + pad >= top && p.y - pad <= bottom
      e.root.visible = on
      if (!on) continue
      const dim = 1 - 0.75 * e.gust
      const fl = flicker(timeS, e.seed)
      if (e.uniforms) {
        e.uniforms.uTime = timeS
        e.uniforms.uGust = e.gust
      } else {
        e.flame.scale.y = fl * dim
      }
      const s = e.glowSize * (0.85 + 0.25 * fl) * (0.6 + 0.4 * dim)
      e.glow.width = e.glow.height = s
      e.glow.alpha = e.glowAlpha * fl * dim
      for (const sp of e.sparks) {
        if (sp.wait > 0) {
          sp.wait -= dtS
          if (sp.wait <= 0) { sp.t = 0; sp.dx = (Math.random() - 0.5) * 6; sp.dot.visible = true }
          continue
        }
        sp.t += dtS / C.CANDLE_SPARK_LIFE_S
        if (sp.t >= 1) {
          sp.dot.visible = false
          sp.wait = C.CANDLE_SPARK_WAIT_MIN_S + Math.random() * C.CANDLE_SPARK_WAIT_RAND_S
          continue
        }
        sp.dot.x = sp.dx * sp.t + Math.sin(sp.t * 9 + e.seed) * 1.2
        sp.dot.y = -e.qh * 0.8 - sp.t * C.CANDLE_SPARK_RISE
        sp.dot.alpha = (1 - sp.t) * dim
      }
    }
  }

  function dispose() {
    for (const e of entries) if (!e.root.destroyed) e.root.destroy({ children: true })
    entries.length = 0
    geometry?.destroy()
    program?.destroy()
    glowTexture.destroy(true)
  }

  return { update, dispose, count: () => entries.length }
}
