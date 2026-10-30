import { ColorMatrixFilter, Sprite, Ticker, UPDATE_PRIORITY } from 'pixi.js'
import type { AnimatedSprite, Container } from 'pixi.js'
import * as C from '../constants'

// Голубое свечение героя, пока действует зелье отражения (30.10.2026, гильдии;
// без нового арта). Тот же приём, что золотое свечение элиты (eliteGlow.ts):
// позади героя — копия его ТЕКУЩЕГО кадра, крупнее в REFLECT_GLOW_SCALE,
// залитая сплошным голубым, прозрачность мягко пульсирует. Сработало отражение
// — короткая вспышка (копия раздувается и гаснет за REFLECT_FLASH_MS), потом
// свечения нет.
//
// Без WebGL фильтр не работает — копия рисуется с tint голубым, как тёмный ореол.
// Без аллокаций в тикере: копия создаётся один раз, при первом update с героем.
export type ReflectGlowDeps = {
  worldContainer: Container
  getHero: () => AnimatedSprite | null
}

export function createReflectGlowSystem(deps: ReflectGlowDeps) {
  const r = ((C.REFLECT_GLOW_TINT >> 16) & 0xff) / 255
  const g = ((C.REFLECT_GLOW_TINT >> 8) & 0xff) / 255
  const b = (C.REFLECT_GLOW_TINT & 0xff) / 255
  const filter = new ColorMatrixFilter()
  filter.matrix = [
    0, 0, 0, 0, r,
    0, 0, 0, 0, g,
    0, 0, 0, 0, b,
    0, 0, 0, 1, 0,
  ]
  let sprite: Sprite | null = null
  let active = false
  let flashMs = 0
  let phaseMs = 0

  // Кадр героя меняет Ticker.shared (AnimatedSprite) — копия берёт его после.
  const syncFrame = () => {
    const hero = deps.getHero()
    if (sprite && hero && !hero.destroyed) sprite.texture = hero.texture
  }
  Ticker.shared.add(syncFrame, null, UPDATE_PRIORITY.LOW)

  function ensureSprite(hero: AnimatedSprite): Sprite {
    if (sprite && !sprite.destroyed) return sprite
    const s = new Sprite(hero.texture)
    s.filters = [filter]
    s.tint = C.REFLECT_GLOW_TINT
    const parent = hero.parent ?? deps.worldContainer
    parent.addChildAt(s, Math.max(0, parent.getChildIndex(hero)))
    sprite = s
    return s
  }

  /** Включить свечение (зелье взято в забег). */
  function setActive(on: boolean) {
    active = on
    if (!on) flashMs = 0
  }

  /** Отражение сработало: вспышка, свечение пропадает. */
  function flash() {
    active = false
    flashMs = C.REFLECT_FLASH_MS
  }

  // В тикере после систем героя — копия берёт его место и кадр.
  function update(deltaMS: number) {
    const hero = deps.getHero()
    if (!hero || hero.destroyed) return
    if (!active && flashMs <= 0) {
      if (sprite) sprite.visible = false
      return
    }
    const s = ensureSprite(hero)
    phaseMs = (phaseMs + deltaMS) % C.REFLECT_GLOW_PERIOD_MS
    let alpha: number
    let scale = C.REFLECT_GLOW_SCALE
    if (flashMs > 0) {
      flashMs = Math.max(0, flashMs - deltaMS)
      const t = 1 - flashMs / C.REFLECT_FLASH_MS
      alpha = 1 - t
      scale = C.REFLECT_GLOW_SCALE + 0.45 * t
    } else {
      const wave = 0.5 - 0.5 * Math.cos((phaseMs / C.REFLECT_GLOW_PERIOD_MS) * Math.PI * 2)
      alpha = C.REFLECT_GLOW_ALPHA_MIN + (C.REFLECT_GLOW_ALPHA_MAX - C.REFLECT_GLOW_ALPHA_MIN) * wave
    }
    s.texture = hero.texture
    s.anchor.copyFrom(hero.anchor)
    s.x = hero.x
    s.y = hero.y
    s.scale.set(hero.scale.x * scale, hero.scale.y * scale)
    s.visible = hero.visible
    s.alpha = alpha
  }

  function dispose() {
    Ticker.shared.remove(syncFrame, null)
    if (sprite && !sprite.destroyed) sprite.destroy()
    sprite = null
    filter.destroy()
  }

  return { setActive, flash, update, dispose }
}
