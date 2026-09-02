import * as C from './constants'

// Базовые трофеи за событие. Множитель применяется снаружи. level —
// уровень персонажа, теперь параметр (не читается из константы внутри) —
// вызывающая сторона решает, что передать (см. вызовы: пока везде передают
// 1 явно, TODO там же).
export function rollTrophies(multiplier: number, level: number): number {
  const spread = (1 - C.TROPHY_SPREAD / 2) + Math.random() * C.TROPHY_SPREAD
  return Math.round(C.TROPHY_BASE * Math.pow(level, C.TROPHY_LEVEL_POWER) * spread * multiplier)
}
