import { Geometry, GlProgram, Mesh, RenderTexture, Rectangle, Shader, Texture, UniformGroup, type Renderer } from 'pixi.js'

// КАМЕНЬ ЛОВУШЕК ПОД КАРТУ (17.11.2026, правки по телефону: горгулья и
// сталактит выглядели чужими — светло-серыми на тёмной кладке литейной и
// склепа). Цвет кладки ЭТОЙ карты замерен по слою у самих ловушек
// (tools/measure_trap_tint.py → trapTints.ts); здесь — одна перекраска текстуры
// при загрузке забега, как у плаща (entities/cloakTint.ts): квад размером с
// источник в RenderTexture, в бою — ни одного лишнего прохода.
//
// Формула (на пиксель, цвет без умноженной альфы):
//   l     = яркость пикселя (0.299 r + 0.587 g + 0.114 b)
//   stone = 1 − smoothstep(0.22, 0.42, насыщенность)  — серый камень; огонь в
//           пасти, светящиеся глаза и искры насыщенные — их не трогаем
//   new   = цвет кладки × (l / средняя яркость камня ассета) — тон, насыщенность
//           и яркость кладки, светотень ассета остаётся
//   out   = mix(исходный, new, stone), альфа без изменений
// Это не tint-умножение: тот темнит, но не меняет тон и не поднимает тёмное.
//
// Только WebGL; без него — исходный цвет (как плащ).

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

const FRAGMENT = `precision highp float;
in vec2 vUV;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec3 uTarget;
uniform float uSrcLum;
uniform vec2 uGrad;
void main() {
  vec4 c = texture(uTexture, vUV);
  if (c.a <= 0.0) { finalColor = vec4(0.0); return; }
  vec3 rgb = c.rgb / c.a;
  float l = dot(rgb, vec3(0.299, 0.587, 0.114));
  float mx = max(rgb.r, max(rgb.g, rgb.b));
  float mn = min(rgb.r, min(rgb.g, rgb.b));
  float sat = (mx - mn) / max(mx, 0.0001);
  float stone = 1.0 - smoothstep(0.22, 0.42, sat);
  float g = mix(uGrad.x, uGrad.y, vUV.y);
  vec3 n = clamp(uTarget * (l / max(uSrcLum, 0.01)) * g, 0.0, 1.0);
  finalColor = vec4(mix(rgb, n, stone) * c.a, c.a);
}
`

export type StoneTint = {
  /** Средний цвет кладки карты у ловушки, 0..255. */
  target: readonly [number, number, number]
  /** Средняя яркость серого камня самого ассета, 0..1 (замер в trapTints.ts). */
  srcLum: number
  /** Яркость сверху и снизу текстуры (множитель; 26.11.2026 — сталактит у
   *  потолка темнее, к острию светлее). Нет — [1, 1]. */
  grad?: readonly [number, number]
}

export type BakedStone = { textures: Texture[]; target: RenderTexture; rebake: (r: Renderer) => Promise<void> }

/**
 * Перекрашивает весь источник `frames[0].source` и возвращает те же кадры на
 * новой текстуре. Источник после перекраски выгружается из видеопамяти (в
 * кэше Assets он остаётся — следующий забег перекрасит его снова).
 */
export async function bakeStoneTint(renderer: Renderer, frames: Texture[], tint: StoneTint): Promise<BakedStone> {
  const source = frames[0].source
  const target = RenderTexture.create({ width: source.width, height: source.height, resolution: source.resolution })
  target.source.scaleMode = 'linear'
  const rebake = async (r: Renderer) => {
    const w = source.width
    const h = source.height
    const geometry = new Geometry({
      attributes: {
        aPosition: new Float32Array([0, 0, w, 0, w, h, 0, h]),
        aUV: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      },
      indexBuffer: [0, 1, 2, 0, 2, 3],
    })
    const glProgram = GlProgram.from({ vertex: VERTEX, fragment: FRAGMENT, name: 'stone-tint' })
    const uniforms = new UniformGroup({
      uTarget: { value: new Float32Array([tint.target[0] / 255, tint.target[1] / 255, tint.target[2] / 255]), type: 'vec3<f32>' },
      uSrcLum: { value: tint.srcLum, type: 'f32' },
      uGrad: { value: new Float32Array(tint.grad ?? [1, 1]), type: 'vec2<f32>' },
    })
    const shader = new Shader({ glProgram, resources: { uTexture: source, stoneUniforms: uniforms } })
    const mesh = new Mesh({ geometry, shader })
    r.render({ container: mesh, target, clear: true })
    mesh.destroy()
    geometry.destroy()
    shader.destroy()
    glProgram.destroy()
  }
  await rebake(renderer)
  source.unload()
  const textures = frames.map((f) => new Texture({
    source: target.source,
    frame: new Rectangle(f.frame.x, f.frame.y, f.frame.width, f.frame.height),
    orig: new Rectangle(f.orig.x, f.orig.y, f.orig.width, f.orig.height),
    trim: f.trim ? new Rectangle(f.trim.x, f.trim.y, f.trim.width, f.trim.height) : undefined,
  }))
  return { textures, target, rebake }
}
