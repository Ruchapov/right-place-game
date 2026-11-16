import { Assets, Geometry, GlProgram, Mesh, RenderTexture, Rectangle, Shader, Texture, UniformGroup, type Renderer } from 'pixi.js'
import { loadTexture } from '../spriteLoader'
import type { CloakColor } from '../../skins'

// ПЕРЕКРАСКА ПЛАЩА (Портной, 14.11.2026, docs/shop.md, «ПОРТНОЙ»).
//
// Формула — задача (docs/skins-task.md, раздел 4), один в один, на пиксель:
//   v   = max(r, g, b)
//   ink = clamp((v − 0.05) / 0.10, 0, 1)          — тёмные контуры не трогаем
//   nv  = Vbase · clamp(v / 0.19, 0, 4)^0.6
//   nv  = mix(v, clamp(nv, 0, 1), ink)
//   new = hsv2rgb(H, S, nv)
//   out = mix(c, new, m), альфа без изменений     — m: маска плаща (255 = плащ)
//
// ⚠️ Как сделано и почему НЕ фильтром на спрайте героя. Задача предлагала
// Filter или Mesh+Shader с маской, подменяемой при смене анимации. Сделано
// иначе, с тем же результатом на экране: каждый лист героя перекрашивается
// ОДИН раз при загрузке забега — квадом размером с лист, где кадр листа и кадр
// маски совпадают по UV тривиально (лист и маска одного размера и раскладки), —
// в RenderTexture, и дальше кадры режутся уже из неё. Плюсы для телефона:
//   • в бою ни одного лишнего прохода рендера (фильтр — это отдельный буфер и
//     проход каждый кадр);
//   • «кадр маски = кадр спрайта» держится построением, а не кодом смены
//     анимации, — забыть подменить маску негде;
//   • у Пепельного плаща (color = null) не делается вообще ничего.
// Цена — видеопамять: перекрашенный лист — своя текстура. Исходный лист после
// перекраски выгружается из видеопамяти (source.unload), маска — из кэша.
//
// Только WebGL: без него (запасной Canvas2D) плащ остаётся исходным — так же,
// как без WebGL нет атмосферы тем. Об этом пишет console.warn вызывающий.

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

// Текстуры у Pixi лежат в видеопамяти с УЖЕ умноженной альфой: формула задачи —
// про обычный цвет, поэтому сначала делим на альфу, в конце умножаем обратно.
const FRAGMENT = `precision highp float;
in vec2 vUV;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform sampler2D uMask;
uniform vec3 uHsv;
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
void main() {
  vec4 c = texture(uTexture, vUV);
  if (c.a <= 0.0) { finalColor = vec4(0.0); return; }
  float m = texture(uMask, vUV).r;
  vec3 rgb = c.rgb / c.a;
  float v = max(rgb.r, max(rgb.g, rgb.b));
  float ink = clamp((v - 0.05) / 0.10, 0.0, 1.0);
  float nv = uHsv.z * pow(clamp(v / 0.19, 0.0, 4.0), 0.6);
  nv = mix(v, clamp(nv, 0.0, 1.0), ink);
  vec3 n = hsv2rgb(vec3(uHsv.x, uHsv.y, nv));
  vec3 o = mix(rgb, n, m);
  finalColor = vec4(o * c.a, c.a);
}
`

/**
 * Лист, перекрашенный в видеопамяти: новые кадры, текстура, которую надо
 * уничтожить, и rebake — перерисовать заново (13.11.2026): при потере WebGL
 * Pixi после восстановления заливает обратно картинки из файлов, но
 * нарисованное в RenderTexture пропадает — без rebake герой стал бы пустым.
 */
export type BakedSheet = { frames: Texture[]; target: RenderTexture; rebake: (renderer: Renderer) => Promise<void> }

/**
 * Перекрашивает один лист героя. `frames` — уже нарезанные кадры исходного листа
 * (все с одного source), `maskSrc` — серая маска плаща того же размера.
 * Кадры результата — те же прямоугольники, что у исходных, на новой текстуре.
 */
export async function bakeCloakSheet(renderer: Renderer, frames: Texture[], maskSrc: string, color: Exclude<CloakColor, null>): Promise<BakedSheet> {
  const source = frames[0].source
  // Тот же логический размер и тот же коэффициент, что у листа (16.11.2026,
  // «Видеопамять забега»): у листа по размеру экрана пикселей в res² меньше —
  // и у перекрашенной копии столько же. Упакованный лист — атлас кадров, и
  // копия — того же размера атласа, а не всей сетки клеток.
  const target = RenderTexture.create({ width: source.width, height: source.height, resolution: source.resolution })
  target.source.scaleMode = 'linear' // как у исходных листов (spriteLoader)
  const rebake = (r: Renderer) => renderInto(r, frames, maskSrc, color, target)
  await rebake(renderer)
  const out = frames.map((f) => new Texture({
    source: target.source,
    frame: new Rectangle(f.frame.x, f.frame.y, f.frame.width, f.frame.height),
    orig: new Rectangle(f.orig.x, f.orig.y, f.orig.width, f.orig.height),
    trim: f.trim ? new Rectangle(f.trim.x, f.trim.y, f.trim.width, f.trim.height) : undefined,
  }))
  return { frames: out, target, rebake }
}

async function renderInto(renderer: Renderer, frames: Texture[], maskSrc: string, color: Exclude<CloakColor, null>, target: RenderTexture): Promise<void> {
  const source = frames[0].source
  const w = source.width
  const h = source.height
  // Маска — того же размера и раскладки, что лист (tools/make_sprite_res.mjs
  // кладёт их в одну группу); через loadTexture — чтобы ей встали тот же
  // коэффициент и логический размер. Без учёта забега: выгружается ниже сразу.
  const mask = await loadTexture(maskSrc, { track: false })
  if (mask.source.width !== w || mask.source.height !== h) {
    throw new Error(`Маска плаща ${maskSrc}: ${mask.source.width}×${mask.source.height}, а лист ${w}×${h} — кадры маски не совпадут с кадрами героя`)
  }
  const geometry = new Geometry({
    attributes: {
      aPosition: new Float32Array([0, 0, w, 0, w, h, 0, h]),
      aUV: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    },
    indexBuffer: [0, 1, 2, 0, 2, 3],
  })
  const glProgram = GlProgram.from({ vertex: VERTEX, fragment: FRAGMENT, name: 'cloak-tint' })
  const uniforms = new UniformGroup({ uHsv: { value: new Float32Array([color.h / 360, color.s, color.v]), type: 'vec3<f32>' } })
  const shader = new Shader({ glProgram, resources: { uTexture: source, uMask: mask.source, cloakUniforms: uniforms } })
  const mesh = new Mesh({ geometry, shader })
  renderer.render({ container: mesh, target, clear: true })
  mesh.destroy()
  geometry.destroy()
  shader.destroy()
  glProgram.destroy()
  // Исходный лист больше не рисуется — освобождаем его видеопамять (картинка
  // остаётся в кэше Assets: следующий забег перекрасит её снова без скачивания).
  source.unload()
  await Assets.unload(maskSrc)
}
