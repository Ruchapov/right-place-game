import { ColorMatrixFilter, Sprite, Ticker, UPDATE_PRIORITY } from 'pixi.js'
import type { Container } from 'pixi.js'
import type { Enemy } from '../types'
import * as C from '../constants'

// Золотое свечение элитного врага (30.10.2026, «забег насыщеннее»; без нового
// арта). Позади спрайта врага — копия его ТЕКУЩЕГО кадра, крупнее в
// ELITE_GLOW_SCALE, залитая сплошным золотом (ColorMatrixFilter: цвет кадра
// выброшен, остаётся его альфа), прозрачность мягко пульсирует. Копия
// повторяет кадр, зеркало и место каждый тик, поэтому стан, ранение и смерть
// играются как есть — свечение ничего у врага не трогает (ни tint, который
// пишут вспышки удара и крита, ни кадры).
//
// Смерть: с первого кадра смерти свечение гаснет за ELITE_GLOW_FADE_MS; когда
// модуль врага убирает труп (спрайт уничтожен), копия уничтожается тоже.
//
// Без WebGL (запасной Canvas2D) фильтр не работает — копия рисуется с tint
// золотом, как тёмный золотой ореол; хуже, но читается.
//
// Без аллокаций в тикере: копия создаётся один раз, при attach.
export type EliteGlowDeps = {
  worldContainer: Container
}

type Glow = { enemy: Enemy; sprite: Sprite; fadeMs: number }

export function createEliteGlowSystem(deps: EliteGlowDeps) {
  const glows: Glow[] = []
  const r = ((C.ELITE_GLOW_TINT >> 16) & 0xff) / 255
  const g = ((C.ELITE_GLOW_TINT >> 8) & 0xff) / 255
  const b = (C.ELITE_GLOW_TINT & 0xff) / 255
  const filter = new ColorMatrixFilter()
  // Сплошной цвет: RGB = смещение (0..1), альфа — альфа кадра.
  filter.matrix = [
    0, 0, 0, 0, r,
    0, 0, 0, 0, g,
    0, 0, 0, 0, b,
    0, 0, 0, 1, 0,
  ]
  let phaseMs = 0
  // Кадр анимации врагу меняет НЕ тикер логики, а общий Ticker.shared (так
  // устроен AnimatedSprite). Свой слушатель там же, с низким приоритетом — после
  // смены кадра: без него копия отставала бы на кадр и на быстрой атаке давала
  // золотой «шлейф». Хитстоп (speed 0) этот слушатель не трогает — кадр стоит.
  const syncFrames = () => {
    for (const glow of glows) if (!glow.enemy.sprite.destroyed) glow.sprite.texture = glow.enemy.sprite.texture
  }
  Ticker.shared.add(syncFrames, null, UPDATE_PRIORITY.LOW)

  // Свечение врагу — сразу после его спавна (спрайт уже в мире).
  function attach(enemy: Enemy) {
    const sprite = new Sprite(enemy.sprite.texture)
    sprite.filters = [filter]
    sprite.tint = C.ELITE_GLOW_TINT
    const parent = enemy.sprite.parent ?? deps.worldContainer
    parent.addChildAt(sprite, parent.getChildIndex(enemy.sprite))
    glows.push({ enemy, sprite, fadeMs: C.ELITE_GLOW_FADE_MS })
    sync(glows[glows.length - 1], 1)
  }

  function sync(glow: Glow, alpha: number) {
    const src = glow.enemy.sprite
    const s = glow.sprite
    s.texture = src.texture
    s.anchor.copyFrom(src.anchor)
    s.x = src.x
    s.y = src.y
    s.scale.set(src.scale.x * C.ELITE_GLOW_SCALE, src.scale.y * C.ELITE_GLOW_SCALE)
    s.visible = src.visible
    s.alpha = alpha
  }

  // В тикере ПОСЛЕ систем врагов — копия берёт кадр, который будет нарисован.
  function update(deltaMS: number) {
    phaseMs = (phaseMs + deltaMS) % C.ELITE_GLOW_PERIOD_MS
    const wave = 0.5 - 0.5 * Math.cos((phaseMs / C.ELITE_GLOW_PERIOD_MS) * Math.PI * 2)
    const pulse = C.ELITE_GLOW_ALPHA_MIN + (C.ELITE_GLOW_ALPHA_MAX - C.ELITE_GLOW_ALPHA_MIN) * wave
    for (let i = glows.length - 1; i >= 0; i--) {
      const glow = glows[i]
      if (glow.enemy.sprite.destroyed) {
        glow.sprite.destroy()
        glows.splice(i, 1)
        continue
      }
      if (glow.enemy.dead) glow.fadeMs = Math.max(0, glow.fadeMs - deltaMS)
      sync(glow, pulse * (glow.fadeMs / C.ELITE_GLOW_FADE_MS))
    }
  }

  function dispose() {
    Ticker.shared.remove(syncFrames, null)
    for (const glow of glows) if (!glow.sprite.destroyed) glow.sprite.destroy()
    glows.length = 0
    filter.destroy()
  }

  return { attach, update, dispose }
}
