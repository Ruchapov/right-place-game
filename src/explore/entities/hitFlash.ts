import { ColorMatrixFilter } from 'pixi.js'
import type { Container, Filter } from 'pixi.js'
import * as C from '../constants'

// БЕЛАЯ ВСПЫШКА врага от удара мечом (16.11.2026, docs/explore-engine.md,
// «Комбо из трёх ударов»): HIT_FLASH_MS спрайт почти белый. tint осветлить не
// может (он умножает), поэтому — один общий ColorMatrixFilter на всех: на
// время вспышки он ДОБАВЛЯЕТСЯ к фильтрам спрайта (лёд, Тень — свои фильтры
// остаются), по концу убирается именно он, по ссылке.
//
// Без WebGL (запасной рендерер) фильтров нет — вспышки нет вовсе: урон и
// реакция врага от неё не зависят, это только картинка.
//
// Без аллокаций в тикере: записи вспышек переиспользуются.

type Entry = { sprite: Container; msLeft: number }

export function createHitFlashSystem(deps: { enabled: boolean }) {
  const entries: Entry[] = []
  let filter: ColorMatrixFilter | null = null
  if (deps.enabled) {
    filter = new ColorMatrixFilter()
    // Цвет = 25% своего + 75% белого; альфа своя.
    filter.matrix = [
      0.25, 0, 0, 0, 0.75,
      0, 0.25, 0, 0, 0.75,
      0, 0, 0.25, 0, 0.75,
      0, 0, 0, 1, 0,
    ]
  }

  function remove(sprite: Container) {
    if (!filter || sprite.destroyed) return
    const list = sprite.filters as Filter[] | null | undefined
    if (!list || !list.includes(filter)) return
    const rest = list.filter((f) => f !== filter)
    sprite.filters = rest.length > 0 ? rest : null
  }

  function flash(sprite: Container) {
    if (!filter || sprite.destroyed) return
    const list = (sprite.filters as Filter[] | null | undefined) ?? []
    if (!list.includes(filter)) sprite.filters = [...list, filter]
    const entry = entries.find((e) => e.sprite === sprite) ?? entries.find((e) => e.msLeft <= 0)
    if (entry) {
      entry.sprite = sprite
      entry.msLeft = C.HIT_FLASH_MS
    } else {
      entries.push({ sprite, msLeft: C.HIT_FLASH_MS })
    }
  }

  function update(deltaMS: number) {
    for (const e of entries) {
      if (e.msLeft <= 0) continue
      e.msLeft -= deltaMS
      if (e.msLeft <= 0) remove(e.sprite)
    }
  }

  function dispose() {
    for (const e of entries) if (e.msLeft > 0) remove(e.sprite)
    entries.length = 0
    filter?.destroy()
    filter = null
  }

  return { flash, update, dispose }
}
