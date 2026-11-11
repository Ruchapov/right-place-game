import { Filter, GlProgram, UniformGroup } from 'pixi.js'
import type { Sprite } from 'pixi.js'

/**
 * ФИЛЬТРЫ НОВОГО КОНТЕНТА (09.11.2026) — горение героя (одобрено:
 * reference/hero_burn_shader.mp4, алгоритм — burn_shader_proto.py), Тень
 * (shadow_mock.mp4 / shadow_mock.py) и фиолетовый сундук Тени.
 *
 * Только WebGL (glProgram): на запасном Canvas2D фильтров нет вовсе —
 * вызывающий проверяет renderer.type и рисует tint (как eliteGlow).
 *
 * Расстояния прототипов — в пикселях ЛИСТА героя; в шейдер они переходят через
 * uS — сколько CSS-пикселей экрана в одном пикселе листа (масштаб спрайта ×
 * масштаб мира, пишется каждый кадр из worldTransform). uInputSize.zw —
 * долей текстуры фильтра в одном CSS-пикселе (Pixi v8 FilterSystem).
 * Глобальная Y фрагмента — uOutputFrame.y + vTextureCoord.y × uInputSize.y:
 * по ней «ноги не горят» и появление Тени снизу вверх (uBody — верх и низ тела).
 */

const VERTEX = `in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
vec4 filterVertexPosition(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}
vec2 filterTextureCoord(void) { return aPosition * (uOutputFrame.zw * uInputSize.zw); }
void main(void) { gl_Position = filterVertexPosition(); vTextureCoord = filterTextureCoord(); }
`

const NOISE = `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`

const COMMON = `in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
// highp — как в вершинном шейдере: при разной точности программа не линкуется.
uniform highp vec4 uInputSize;
uniform highp vec4 uOutputFrame;
uniform highp vec4 uInputClamp;
float alphaAt(vec2 uv) {
  if (uv.x < uInputClamp.x || uv.y < uInputClamp.y || uv.x > uInputClamp.z || uv.y > uInputClamp.w) return 0.0;
  return texture(uTexture, uv).a;
}
`

// Горение. Излучатели — верхние грани силуэта (альфа есть, а выше на 8 px
// листа — нет), тонкие части (меч, шарф) не горят — эрозия альфы ≈7 px; ниже
// 68% высоты тела не горит; горят пятна по медленному шуму. Пламя — протяжка
// излучателей вверх ≈70 px с затуханием, колышется шумом. Мультяшные пороги:
// тёмно-красный край → оранжевый → жёлтая сердцевина, тонкая тёмная обводка;
// поверх тела — 0.55; лёгкий тёплый оттенок героя.
const BURN_FRAG = COMMON + NOISE + `
uniform float uTime;
uniform float uS;
uniform vec2 uBody;
uniform float uWarm;
vec2 px(vec2 p) { return p * uS * uInputSize.zw; }
float solid(vec2 uv) {
  if (alphaAt(uv) < 0.5) return 0.0;
  // Эрозия ≈7 px листа: тонкое не горит.
  if (alphaAt(uv + px(vec2(7.0, 0.0))) < 0.5) return 0.0;
  if (alphaAt(uv + px(vec2(-7.0, 0.0))) < 0.5) return 0.0;
  if (alphaAt(uv + px(vec2(0.0, 7.0))) < 0.5) return 0.0;
  if (alphaAt(uv + px(vec2(0.0, -7.0))) < 0.5) return 0.0;
  return 1.0;
}
float emitAt(vec2 uv) {
  float body = solid(uv);
  if (body == 0.0) return 0.0;
  // Верхняя грань: пусто на 8 px выше (или на 14 — грань «расширена», как
  // dilate 5×5 прототипа).
  float top = (alphaAt(uv + px(vec2(0.0, -8.0))) < 0.5 || alphaAt(uv + px(vec2(0.0, -14.0))) < 0.5) ? 1.0 : 0.25;
  float gy = uOutputFrame.y + uv.y * uInputSize.y;
  float h = max(1.0, uBody.y - uBody.x);
  float low = clamp((gy - (uBody.x + 0.68 * h)) / (0.12 * h), 0.0, 1.0);
  vec2 g = (uOutputFrame.xy + uv * uInputSize.xy) / uS;
  float spot = clamp((vnoise(vec2(g.x * 0.5 + 137.0, g.y * 0.5 + uTime * 20.0) / 40.0) - 0.34) / 0.14, 0.0, 1.0);
  return top * (1.0 - low) * spot;
}
void main() {
  vec4 src = texture(uTexture, vTextureCoord);
  vec2 g = (uOutputFrame.xy + vTextureCoord * uInputSize.xy) / uS;
  // Колыхание: выборка сдвинута шумом, растущим со временем.
  float n1 = vnoise(vec2(g.x / 22.0, (g.y + uTime * 90.0) / 22.0));
  float n2 = vnoise(vec2((g.x + 300.0) / 22.0, (g.y + uTime * 117.0) / 22.0));
  vec2 base = vTextureCoord + px(vec2((n1 - 0.5) * 13.0, (n2 - 0.5) * 5.0 + 3.0));
  // Протяжка вверх ≈70 px с затуханием (0.978 на пиксель): выборка излучателей
  // НИЖЕ этой точки, шагом 3 px; соседние столбцы ±2 px — вместо размытия
  // прототипа, чтобы язык пламени был сплошным, а не точками.
  float F = 0.0;
  for (int k = 0; k < 24; k++) {
    float d = float(k) * 3.0;
    float decay = pow(0.978, d);
    float e = emitAt(base + px(vec2(0.0, d)));
    e = max(e, 0.8 * emitAt(base + px(vec2(2.5, d + 1.5))));
    e = max(e, 0.8 * emitAt(base + px(vec2(-2.5, d + 1.5))));
    F = max(F, e * decay);
  }
  float tong = vnoise(vec2(g.x * 1.4 / 13.0, (g.y * 0.8 + uTime * 240.0) / 13.0));
  float fb = 0.55 * vnoise(vec2(g.x / 22.0, (g.y + uTime * 90.0) / 22.0)) + 0.3 * vnoise(vec2(g.x / 10.0, (g.y + uTime * 150.0) / 10.0)) + 0.15 * vnoise(vec2(g.x / 5.0, (g.y + uTime * 220.0) / 5.0));
  float I = F * (0.35 + 0.75 * fb + 0.45 * tong);
  float a = clamp((I - 0.38) / 0.08, 0.0, 1.0);
  float mid = clamp((I - 0.58) / 0.08, 0.0, 1.0);
  float core = clamp((I - 0.78) / 0.08, 0.0, 1.0);
  vec3 col = vec3(150.0, 30.0, 20.0) / 255.0;
  col = mix(col, vec3(235.0, 110.0, 30.0) / 255.0, mid);
  col = mix(col, vec3(255.0, 225.0, 120.0) / 255.0, core);
  float edge = clamp(1.0 - abs(I - 0.44) / 0.025, 0.0, 1.0);
  col = mix(col, vec3(40.0, 12.0, 8.0) / 255.0, 0.7 * edge);
  float aOver = a * (src.a > 0.5 ? 0.55 : 1.0);
  vec3 hero = src.a > 0.0 ? src.rgb / src.a : vec3(0.0);
  hero = mix(hero, vec3(1.0, 0.47, 0.16), uWarm);
  // Лёгкое свечение вокруг пламени.
  float glow = clamp((I - 0.25) / 0.2, 0.0, 1.0) * (1.0 - a) * 0.25;
  vec3 rgb = col * aOver + hero * src.a * (1.0 - aOver) + vec3(1.0, 0.43, 0.12) * glow;
  float outA = aOver + src.a * (1.0 - aOver) + glow * 0.6;
  finalColor = vec4(rgb, min(1.0, outA));
}
`

// Тень: тело почти чёрно-фиолетовое по яркости, фиолетовая кромка по краю
// силуэта (альфа минус эрозия 5 px), жёлтые глаза → фиолетовые, рваный край и
// дымок по шуму; появление снизу вверх со светящейся линией (uReveal 0..1),
// uEyes — вспышка глаз перед ударом (ярче и крупнее).
const SHADOW_FRAG = COMMON + NOISE + `
uniform float uTime;
uniform float uS;
uniform vec2 uBody;
uniform float uReveal;
uniform float uEyes;
vec2 px(vec2 p) { return p * uS * uInputSize.zw; }
void main() {
  vec4 src = texture(uTexture, vTextureCoord);
  float A = src.a;
  vec3 rgb = A > 0.0 ? src.rgb / A : vec3(0.0);
  float L = dot(rgb, vec3(0.3, 0.59, 0.11));
  vec2 g = (uOutputFrame.xy + vTextureCoord * uInputSize.xy) / uS;
  bool eye = rgb.r > 0.85 && rgb.g > 0.8 && rgb.b > 0.55 && rgb.b < 0.9 && A > 0.5;
  vec3 base = vec3(0.07 + L * 0.10, 0.04 + L * 0.07, 0.12 + L * 0.16);
  // Кромка: альфа минус эрозия 5 px.
  float er = 1.0;
  er = min(er, step(0.5, alphaAt(vTextureCoord + px(vec2(5.0, 0.0)))));
  er = min(er, step(0.5, alphaAt(vTextureCoord + px(vec2(-5.0, 0.0)))));
  er = min(er, step(0.5, alphaAt(vTextureCoord + px(vec2(0.0, 5.0)))));
  er = min(er, step(0.5, alphaAt(vTextureCoord + px(vec2(0.0, -5.0)))));
  float rim = clamp(A - er, 0.0, 1.0);
  vec3 col = mix(base, vec3(0.55, 0.30, 0.95), rim * 0.8);
  if (eye) col = vec3(0.85, 0.25, 1.0) * (1.0 + uEyes * 0.6);
  // Вспышка глаз — ореол вокруг жёлтых точек героя (крупнее и ярче).
  float eyeGlow = 0.0;
  if (uEyes > 0.0) {
    for (int i = 0; i < 8; i++) {
      float ang = float(i) * 0.785398;
      vec2 o = vec2(cos(ang), sin(ang)) * 6.0;
      vec4 s2 = texture(uTexture, vTextureCoord + px(o));
      vec3 c2 = s2.a > 0.0 ? s2.rgb / s2.a : vec3(0.0);
      if (c2.r > 0.85 && c2.g > 0.8 && c2.b > 0.55 && c2.b < 0.9 && s2.a > 0.5) eyeGlow += 0.18;
    }
    eyeGlow *= uEyes;
  }
  // Рваный край: по шуму съедает кромку.
  float edge = clamp(A - min(er, A), 0.0, 1.0);
  float n = vnoise(vec2(g.x / 10.0, (g.y + uTime * 40.0) / 10.0));
  float A2 = A * (1.0 - edge * clamp((n - 0.35) * 2.0, 0.0, 1.0) * 0.8);
  // Дымок: размытая альфа, сдвинутая вверх на 14 px, по шуму.
  float sm = 0.0;
  sm += alphaAt(vTextureCoord + px(vec2(0.0, 14.0)));
  sm += alphaAt(vTextureCoord + px(vec2(6.0, 18.0)));
  sm += alphaAt(vTextureCoord + px(vec2(-6.0, 18.0)));
  sm += alphaAt(vTextureCoord + px(vec2(0.0, 22.0)));
  sm *= 0.25 * clamp(vnoise(vec2(g.x / 24.0, (g.y + uTime * 60.0) / 24.0)) * 1.6 - 0.4, 0.0, 1.0) * 0.45;
  // Появление снизу вверх по шуму, со светящейся линией.
  float h = max(1.0, uBody.y - uBody.x);
  float yy = clamp(((uOutputFrame.y + vTextureCoord.y * uInputSize.y) - uBody.x) / h, 0.0, 1.0);
  float lvl = (1.0 - yy) + vnoise(g / 14.0) * 0.25;
  float m = clamp((uReveal * 1.3 - lvl) / 0.06, 0.0, 1.0);
  float line = clamp(1.0 - abs(uReveal * 1.3 - lvl) / 0.04, 0.0, 1.0) * step(0.1, A) * (uReveal < 1.0 ? 1.0 : 0.0);
  A2 *= m;
  sm *= m;
  col = mix(col, vec3(0.8, 0.55, 1.0), line);
  A2 = max(A2, line * A);
  vec3 smokeCol = vec3(0.10, 0.06, 0.16);
  float outA = max(A2, sm * (1.0 - A2));
  vec3 outRgb = col * A2 + smokeCol * sm * (1.0 - A2) + vec3(0.8, 0.3, 1.0) * eyeGlow;
  finalColor = vec4(outRgb, min(1.0, outA + eyeGlow * 0.8));
}
`

// Сундук Тени: где цвет «золотой» (R ≫ B и ярко) — фиолетовый по яркости.
const CHEST_FRAG = COMMON + `
uniform float uDark;
void main() {
  vec4 src = texture(uTexture, vTextureCoord);
  vec3 rgb = src.a > 0.0 ? src.rgb / src.a : vec3(0.0);
  float mx = max(rgb.r, max(rgb.g, rgb.b));
  float gold = clamp((rgb.r - rgb.b) * 3.0 - 0.25, 0.0, 1.0) * clamp(mx * 2.2 - 1.0, 0.0, 1.0);
  float Y = (rgb.r + rgb.g + rgb.b) / 3.0;
  vec3 v = clamp(vec3(0.55, 0.25, 0.95) * Y * 1.5, 0.0, 1.0);
  rgb = mix(rgb, v, gold * uDark);
  finalColor = vec4(rgb * src.a, src.a);
}
`

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeFilter(name: string, fragment: string, uniforms: Record<string, { value: any; type: any }>, padding: number) {
  return new Filter({
    glProgram: GlProgram.from({ vertex: VERTEX, fragment, name }),
    resources: { ncUniforms: new UniformGroup(uniforms) },
    padding,
    resolution: 'inherit',
  })
}

export function createBurnFilter(): Filter {
  return makeFilter('nc-burn', BURN_FRAG, {
    uTime: { value: 0, type: 'f32' },
    uS: { value: 1, type: 'f32' },
    uBody: { value: new Float32Array([0, 1]), type: 'vec2<f32>' },
    uWarm: { value: 0.1, type: 'f32' },
  }, 60)
}

export function createShadowFilter(): Filter {
  return makeFilter('nc-shadow', SHADOW_FRAG, {
    uTime: { value: 0, type: 'f32' },
    uS: { value: 1, type: 'f32' },
    uBody: { value: new Float32Array([0, 1]), type: 'vec2<f32>' },
    uReveal: { value: 1, type: 'f32' },
    uEyes: { value: 0, type: 'f32' },
  }, 24)
}

export function createChestPurpleFilter(): Filter {
  return makeFilter('nc-chest', CHEST_FRAG, { uDark: { value: 1, type: 'f32' } }, 0)
}

/** Униформы фильтра (группа ncUniforms). */
export function filterUniforms(f: Filter): Record<string, unknown> {
  return (f.resources.ncUniforms as { uniforms: Record<string, unknown> }).uniforms
}

/**
 * Пишет uS и uBody по спрайту фигуры: масштаб листа на экране и верх / низ
 * тела в глобальных CSS-пикселях. bodyTopFrac — где верх тела в клетке
 * (доля высоты клетки от низа точки ног вверх: bodySheetPx).
 */
export function syncFigureUniforms(f: Filter, sprite: Sprite, bodySheetPx: number) {
  const u = filterUniforms(f)
  const wt = sprite.worldTransform
  const s = Math.hypot(wt.a, wt.b)
  u.uS = s
  // Точка ног спрайта в глобальных координатах — его позиция (якорь = ноги).
  const footY = wt.ty
  const body = u.uBody as Float32Array
  body[0] = footY - bodySheetPx * Math.abs(wt.d)
  body[1] = footY
}

/** Вершинный шейдер фильтров (общий для собственных Filter, entities/enemyFreeze.ts). */
export const FILTER_VERTEX = VERTEX
