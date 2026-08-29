import * as C from './constants'

// Базовые трофеи за событие. Множитель применяется снаружи.
export function rollTrophies(multiplier: number): number {
  const level = C.PLAYER_LEVEL_FALLBACK
  const spread = (1 - C.TROPHY_SPREAD / 2) + Math.random() * C.TROPHY_SPREAD
  return Math.round(C.TROPHY_BASE * Math.pow(level, C.TROPHY_LEVEL_POWER) * spread * multiplier)
}
