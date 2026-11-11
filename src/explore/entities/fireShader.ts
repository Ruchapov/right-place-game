import { Container, Geometry, GlProgram, Graphics, Mesh, Shader, UniformGroup } from 'pixi.js'
import * as C from '../constants'

// ОГОНЬ (11.11.2026, событие «Носитель огня», docs/explore-features.md).
//
// Одобренный образец — art-src/events/fire_shader_preview.gif, алгоритм —
// fire_mock.py рядом с ним, один в один:
//   • fbm value-noise из 4 октав, бежит вверх со временем;
//   • маска «язык пламени»: ширина wid·(1−v)^0.7, сужается кверху (у огонька
//     над героем — круглое основание, альфа гаснет к низу);
//   • heat = shape·(1.25 − 1.1v) + (noise − 0.5)·1.1 − 0.35v;
//   • R = heat·2.2, G = 0.35R + 0.65·(heat−0.3)·1.8, B = (heat−0.75)·2.5,
//     альфа = (heat−0.18)/0.25 — всё clamp 0..1; смешивание add.
// Позади — мягкое тёплое свечение (радиальный градиент), чуть «дышит».
//
// Один GlProgram и одна геометрия (единичный квад) на все огни забега; у огня —
// свой Shader (лёгкий объект с униформами) и свой Mesh. Всё создаётся при
// спавне, в тикере — только запись чисел. Только WebGL: на запасном Canvas2D
// своего шейдера нет — там рисуется простой капельный силуэт Graphics.
// Огонь вне экрана не рисуется (visible по рамке камеры, update).

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

// highp — время и сдвиг шума большие, в mediump hash на sin рассыпается.
const FRAGMENT = `precision highp float;
in vec2 vUV;
out vec4 finalColor;
uniform float uTime;
uniform float uWid;
uniform float uOrb;
uniform float uSeed;
uniform float uAlpha;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 s = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), s.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), s.x), s.y);
}
void main() {
  float u = vUV.x - 0.5;
  float v = vUV.y;
  float n = 0.0;
  float amp = 0.5;
  float fr = 1.0;
  for (int o = 0; o < 4; o++) {
    float fo = float(o);
    n += amp * vnoise(vec2(u * 6.0 * fr + 3.0 + uSeed + fo * 17.0, v * 5.0 * fr - uTime * ${C.FIRE_NOISE_SPEED.toFixed(3)} * (fo + 1.0)));
    amp *= 0.5;
    fr *= 2.0;
  }
  float width = uWid * pow(max(1.0 - v, 0.0), 0.7) + 0.02;
  if (uOrb > 0.5) width = uWid * sqrt(clamp(v * (1.0 - v) * 4.0, 0.0, 1.0)) * pow(max(1.0 - v, 0.0), 0.3) + 0.01;
  float shape = clamp(1.0 - abs(u) / width, 0.0, 1.0);
  float heat = clamp(shape * (1.25 - v * 1.1) + (n - 0.5) * 1.1 - v * 0.35, 0.0, 1.2);
  float a = clamp((heat - 0.18) / 0.25, 0.0, 1.0);
  if (uOrb > 0.5) a *= clamp(v / 0.12, 0.0, 1.0);
  float r = clamp(heat * 2.2, 0.0, 1.0);
  float g = clamp((heat - 0.3) * 1.8, 0.0, 1.0);
  float b = clamp((heat - 0.75) * 2.5, 0.0, 1.0);
  a *= uAlpha;
  finalColor = vec4(vec3(r, 0.35 * r + 0.65 * g, b) * a, a);
}
`

/** Огонь: язык пламени в чаше или огонёк над героем. */
export type Fire = {
  /** Корень огня: свечение + пламя. Низ пламени — в (x, y) корня. */
  root: Container
  /** Сила огня 0..1 (вспышка, перелёт, погасание пишут сюда). */
  alpha: number
  /** Мировые размеры пламени. */
  w: number
  h: number
}

export type FireSystemDeps = {
  parent: Container
  /** WebGL — шейдер; иначе — капля Graphics. */
  webgl: boolean
}

type FireEntry = {
  fire: Fire
  flame: Mesh<Geometry, Shader> | Graphics
  uniforms: { uTime: number; uAlpha: number } | null
  glow: Graphics
  phase: number
}

export function createFireSystem(deps: FireSystemDeps) {
  // Единичный квад: x −0.5..0.5, y −1..0 (низ пламени в нуле); v = 0 у низа.
  const geometry = deps.webgl
    ? new Geometry({
      attributes: {
        aPosition: new Float32Array([-0.5, -1, 0.5, -1, 0.5, 0, -0.5, 0]),
        aUV: new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]),
      },
      indexBuffer: [0, 1, 2, 0, 2, 3],
    })
    : null
  const program = deps.webgl ? GlProgram.from({ vertex: VERTEX, fragment: FRAGMENT, name: 'fire' }) : null

  const entries: FireEntry[] = []
  let timeS = 0

  /** Огонь шириной w и высотой h (мировые px); orb — огонёк над героем. */
  function create(w: number, h: number, orb: boolean): Fire {
    const root = new Container()
    const glow = new Graphics()
    const glowR = Math.max(w, h) * C.FIRE_GLOW_RADIUS_MULT
    // Радиальный градиент — вложенными кругами: при add они складываются, и в
    // центре выходит FIRE_GLOW_ALPHA, к краю — плавно к нулю.
    for (let k = C.FIRE_GLOW_RINGS; k >= 1; k--) {
      glow.circle(0, 0, glowR * (k / C.FIRE_GLOW_RINGS)).fill({ color: C.FIRE_GLOW_COLOR, alpha: C.FIRE_GLOW_ALPHA / C.FIRE_GLOW_RINGS })
    }
    glow.y = -h * 0.45
    glow.blendMode = 'add'
    root.addChild(glow)

    let flame: FireEntry['flame']
    let uniforms: FireEntry['uniforms'] = null
    if (geometry && program) {
      const group = new UniformGroup({
        uTime: { value: 0, type: 'f32' },
        uWid: { value: orb ? C.FIRE_ORB_WID : C.FIRE_BOWL_WID, type: 'f32' },
        uOrb: { value: orb ? 1 : 0, type: 'f32' },
        uSeed: { value: Math.random() * 50, type: 'f32' },
        uAlpha: { value: 1, type: 'f32' },
      })
      const shader = new Shader({ glProgram: program, resources: { fireUniforms: group } })
      const mesh = new Mesh({ geometry, shader })
      mesh.scale.set(w, h)
      mesh.blendMode = 'add'
      flame = mesh
      uniforms = group.uniforms as { uTime: number; uAlpha: number }
    } else {
      // Без WebGL — капля: эллипс с острым верхом, тёплым цветом.
      const g = new Graphics()
      g.ellipse(0, -h * 0.3, w * 0.32, h * 0.3).fill({ color: 0xff8c28, alpha: 0.85 })
      g.ellipse(0, -h * 0.55, w * 0.18, h * 0.35).fill({ color: 0xffc04a, alpha: 0.8 })
      g.blendMode = 'add'
      flame = g
    }
    root.addChild(flame)
    deps.parent.addChild(root)
    const fire: Fire = { root, alpha: 1, w, h }
    entries.push({ fire, flame, uniforms, glow, phase: Math.random() * Math.PI * 2 })
    return fire
  }

  /**
   * Шаг огней: время шума и «дыхание» свечения; огонь вне рамки камеры
   * (left..right, top..bottom в мировых px) не рисуется.
   */
  function update(deltaMS: number, left: number, top: number, right: number, bottom: number) {
    // Время шума закольцовано: сдвиг растёт без конца, а точность float — нет.
    timeS = (timeS + deltaMS / 1000) % C.FIRE_TIME_WRAP_S
    for (const e of entries) {
      const r = e.fire.root
      const pad = Math.max(e.fire.w, e.fire.h) * 2
      const on = e.fire.alpha > 0.001
        && r.x + pad >= left && r.x - pad <= right && r.y + pad >= top && r.y - e.fire.h - pad <= bottom
      r.visible = on
      if (!on) continue
      if (e.uniforms) {
        e.uniforms.uTime = timeS
        e.uniforms.uAlpha = e.fire.alpha
      } else {
        e.flame.alpha = e.fire.alpha
      }
      const breathe = 1 + C.FIRE_GLOW_BREATHE * Math.sin(timeS * C.FIRE_GLOW_BREATHE_FREQ + e.phase)
      e.glow.scale.set(breathe)
      e.glow.alpha = e.fire.alpha
    }
  }

  function dispose() {
    for (const e of entries) if (!e.fire.root.destroyed) e.fire.root.destroy({ children: true })
    entries.length = 0
    geometry?.destroy()
    program?.destroy()
  }

  return { create, update, dispose }
}
