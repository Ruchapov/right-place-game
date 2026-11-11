import { Container, Filter, GlProgram, Graphics, UniformGroup } from 'pixi.js'
import * as C from '../constants'
import type { Enemy } from '../types'
import { FILTER_VERTEX } from './ncFilters'

// ЗАМОРОЗКА — статус врага (12.11.2026, задание shaders_task/task-freeze-candles.md,
// эталон — shaders_preview.mp4, клетка «Заморозка»). Источника в игре пока нет: статус
// готов под ловушку или кольцо. Проверка на телефоне — ?debugFreeze=1 (Explore.tsx):
// удар мечом замораживает врага на 2 с.
//
// Поведение — стан льда врага (`stunTimer`, ПАУЗА): враг стоит, не ходит и не бьёт,
// анимация стоит на текущем кадре, после — продолжает с того же места (это уже
// умеют все модули врагов). Урон проходит как обычно. Повторная заморозка
// продлевает до max(остаток, ms), не складывает. Смерть — эффект снимается сразу,
// без треска. Таяние огненным шаром (stunTimer срезан) — конец заморозки с треском.
//
// Вид: один Filter на спрайт врага только на время заморозки — ледяной тон по
// яркости и пульсирующий иней по контуру (8 выборок альфы); 2–3 искорки-блика
// Graphics поверх тела; в конце 6–8 голубых осколков разлетаются и падают.
// Без WebGL фильтра нет — синий tint.

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform highp vec4 uInputClamp;
uniform float uTime;
uniform float uRim;
float aAt(vec2 uv) {
  if (uv.x < uInputClamp.x || uv.y < uInputClamp.y || uv.x > uInputClamp.z || uv.y > uInputClamp.w) return 0.0;
  return texture(uTexture, uv).a;
}
void main() {
  vec4 c = texture(uTexture, vTextureCoord);
  vec3 rgb = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
  float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
  vec3 ice = lum * vec3(0.75, 0.95, 1.25) + vec3(0.08, 0.16, 0.27);
  vec2 o = uRim * uInputSize.zw;
  float m = 0.0;
  m = max(m, aAt(vTextureCoord + vec2(o.x, 0.0)));
  m = max(m, aAt(vTextureCoord - vec2(o.x, 0.0)));
  m = max(m, aAt(vTextureCoord + vec2(0.0, o.y)));
  m = max(m, aAt(vTextureCoord - vec2(0.0, o.y)));
  m = max(m, aAt(vTextureCoord + o * 0.7071));
  m = max(m, aAt(vTextureCoord - o * 0.7071));
  m = max(m, aAt(vTextureCoord + vec2(o.x, -o.y) * 0.7071));
  m = max(m, aAt(vTextureCoord + vec2(-o.x, o.y) * 0.7071));
  o *= 0.5;
  m = max(m, aAt(vTextureCoord + vec2(o.x, 0.0)));
  m = max(m, aAt(vTextureCoord - vec2(o.x, 0.0)));
  m = max(m, aAt(vTextureCoord + vec2(0.0, o.y)));
  m = max(m, aAt(vTextureCoord - vec2(0.0, o.y)));
  float pulse = 0.6 + 0.4 * sin(uTime * 3.0);
  float rim = clamp(m - c.a, 0.0, 1.0) * pulse;
  // иней #e1f5ff (FREEZE_RIM_COLOR)
  vec3 col = clamp(ice, 0.0, 1.0) * c.a + vec3(0.882, 0.961, 1.0) * rim;
  finalColor = vec4(col, c.a + rim * (1.0 - c.a));
}
`

type Shard = { g: Graphics; vx: number; vy: number; spin: number }
type FreezeEntry = {
  enemy: Enemy
  ms: number
  prevFilters: Filter[] | null
  prevTint: number
  glints: Graphics[]
}
type Burst = { shards: Shard[]; age: number }

export type EnemyFreezeDeps = { parent: Container; webgl: boolean }

export function createEnemyFreezeSystem(deps: EnemyFreezeDeps) {
  const program = deps.webgl ? GlProgram.from({ vertex: FILTER_VERTEX, fragment: FRAGMENT, name: 'enemy-freeze' }) : null
  const entries: FreezeEntry[] = []
  const bursts: Burst[] = []
  let timeS = 0
  // Фильтр один на заморозку (у каждого врага своё время пульса не нужно — общий uTime).
  const filters: Filter[] = []

  function takeFilter(): Filter | null {
    if (!program) return null
    return filters.pop() ?? new Filter({
      glProgram: program,
      resources: {
        freezeUniforms: new UniformGroup({
          uTime: { value: 0, type: 'f32' },
          uRim: { value: C.FREEZE_RIM_PX, type: 'f32' },
        }),
      },
      padding: C.FREEZE_FILTER_PADDING,
      resolution: 'inherit',
    })
  }

  function star(size: number): Graphics {
    const g = new Graphics()
    g.poly([0, -size, size * 0.22, -size * 0.22, size, 0, size * 0.22, size * 0.22, 0, size, -size * 0.22, size * 0.22, -size, 0, -size * 0.22, -size * 0.22])
      .fill({ color: 0xffffff })
    g.blendMode = 'add'
    return g
  }

  /** Заморозить врага на ms (повтор — продлить до max, не сложить). */
  function freeze(enemy: Enemy, ms: number = C.FREEZE_DEFAULT_MS) {
    if (enemy.dead) return
    enemy.stunTimer = Math.max(enemy.stunTimer, ms)
    const have = entries.find((e) => e.enemy === enemy)
    if (have) { have.ms = Math.max(have.ms, ms); return }
    const sprite = enemy.sprite
    const prev = sprite.filters
    const entry: FreezeEntry = { enemy, ms, prevFilters: prev && prev.length ? [...prev] : null, prevTint: sprite.tint as number, glints: [] }
    const f = takeFilter()
    // свои фильтры врага (Тень, горение) остаются — лёд поверх них
    if (f) sprite.filters = entry.prevFilters ? [...entry.prevFilters, f] : [f]
    else sprite.tint = 0x9fd8ff
    for (let k = 0; k < C.FREEZE_GLINTS; k++) {
      const g = star(2.5 + Math.random() * 2)
      g.alpha = 0
      deps.parent.addChild(g)
      entry.glints.push(g)
    }
    entries.push(entry)
  }

  function release(entry: FreezeEntry, shatter: boolean) {
    const sprite = entry.enemy.sprite
    if (!sprite.destroyed) {
      const mine = (sprite.filters ?? []).find((x) => program !== null && x.glProgram === program)
      if (mine) filters.push(mine)
      sprite.filters = entry.prevFilters
      if (!program) sprite.tint = entry.prevTint
    }
    for (const g of entry.glints) g.destroy()
    if (!shatter) return
    const e = entry.enemy
    const cx = e.x + e.width / 2, cy = e.y + e.height * 0.45
    const shards: Shard[] = []
    const n = C.FREEZE_SHARDS
    for (let k = 0; k < n; k++) {
      const g = new Graphics()
      const s = 2.5 + Math.random() * 3
      g.poly([0, -s, s * 0.6, 0, 0, s * 0.8, -s * 0.5, 0.2 * s]).fill({ color: C.FREEZE_SHARD_COLOR }).stroke({ color: 0xffffff, width: 0.6, alpha: 0.8 })
      g.x = cx + (Math.random() - 0.5) * e.width * 0.6
      g.y = cy + (Math.random() - 0.5) * e.height * 0.5
      deps.parent.addChild(g)
      const a = (k / n) * Math.PI * 2 + Math.random() * 0.5
      shards.push({ g, vx: Math.cos(a) * (70 + Math.random() * 70), vy: -120 - Math.random() * 90 + Math.sin(a) * 40, spin: (Math.random() - 0.5) * 14 })
    }
    bursts.push({ shards, age: 0 })
  }

  function update(deltaMS: number) {
    const dtS = deltaMS / 1000
    timeS = (timeS + dtS) % 600
    for (let i = entries.length - 1; i >= 0; i--) {
      const en = entries[i]
      const e = en.enemy
      if (e.dead || e.sprite.destroyed) { release(en, false); entries.splice(i, 1); continue }
      en.ms -= deltaMS
      if (en.ms <= 0 || e.stunTimer <= 0) { release(en, true); entries.splice(i, 1); continue }
      for (const f of e.sprite.filters ?? []) {
        const u = f.resources.freezeUniforms as UniformGroup | undefined
        if (u) (u.uniforms as { uTime: number }).uTime = timeS
      }
      en.glints.forEach((g, k) => {
        // мигает: короткая вспышка раз в ~1.1 с, у каждого своя фаза; место — новое на каждой вспышке
        const ph = (timeS * 0.9 + k * 0.37) % 1
        if (ph < dtS * 0.9 + 0.001 || g.alpha === 0 && ph < 0.05) {
          g.x = e.x + e.width * (0.2 + Math.random() * 0.6)
          g.y = e.y + e.height * (0.15 + Math.random() * 0.6)
        }
        g.alpha = ph < 0.25 ? Math.sin(ph / 0.25 * Math.PI) : 0
      })
    }
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i]
      b.age += deltaMS
      const t = b.age / C.FREEZE_SHARD_LIFE_MS
      if (t >= 1) { for (const s of b.shards) s.g.destroy(); bursts.splice(i, 1); continue }
      for (const s of b.shards) {
        s.vy += C.FREEZE_SHARD_GRAVITY * dtS
        s.g.x += s.vx * dtS
        s.g.y += s.vy * dtS
        s.g.rotation += s.spin * dtS
        s.g.alpha = 1 - t * t
      }
    }
  }

  function isFrozen(enemy: Enemy): boolean {
    return entries.some((e) => e.enemy === enemy)
  }

  function dispose() {
    for (const en of entries) release(en, false)
    entries.length = 0
    for (const b of bursts) for (const s of b.shards) if (!s.g.destroyed) s.g.destroy()
    bursts.length = 0
    for (const f of filters) f.destroy()
    filters.length = 0
    program?.destroy()
  }

  return { freeze, update, isFrozen, dispose }
}
