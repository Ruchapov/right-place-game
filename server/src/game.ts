// Pure game logic (no DB, no HTTP) - easy to reason about and test.

const MAX_ENERGY = 100
const ENERGY_PER_MINUTE = 1

/**
 * Current energy, accounting for regeneration since lastUpdate.
 * Regenerates 1 per minute, never above MAX_ENERGY.
 */
export function getCurrentEnergy(storedEnergy: number, lastUpdate: Date): number {
  const minutesPassed = Math.floor((Date.now() - lastUpdate.getTime()) / 60_000)
  const regenerated = storedEnergy + minutesPassed * ENERGY_PER_MINUTE
  return Math.min(MAX_ENERGY, regenerated)
}
// --- Room generation ---

export type RoomType = 'enemy' | 'boss' | 'chest' | 'trap' | 'smuggler' | 'puzzle'

// Weights sum to 100, matching the design's spawn rates.
const ROOM_WEIGHTS: { type: RoomType; weight: number }[] = [
  { type: 'enemy', weight: 60 },
  { type: 'chest', weight: 15 },
  { type: 'trap', weight: 10 },
  { type: 'puzzle', weight: 10 },
  { type: 'smuggler', weight: 3 },
  { type: 'boss', weight: 2 },
]

function pickRoom(): RoomType {
  const roll = Math.random() * 100
  let cumulative = 0
  for (const room of ROOM_WEIGHTS) {
    cumulative += room.weight
    if (roll < cumulative) return room.type
  }
  return 'enemy' // safety fallback (shouldn't happen)
}

export function generateRooms(count = 3): RoomType[] {
  return Array.from({ length: count }, () => pickRoom())
}
// --- Stat growth from cumulative damage ---

// Strength grows from damage dealt: +1 per 100 damage, then +1 per 200 after Strength 20.
const STRENGTH_THRESHOLD = 20
const STRENGTH_COST_EARLY = 100
const STRENGTH_COST_LATE = 200

export function calculateStrength(totalDamageDealt: number): number {
  const earlyDamage = Math.min(totalDamageDealt, STRENGTH_THRESHOLD * STRENGTH_COST_EARLY)
  const earlyStrength = Math.floor(earlyDamage / STRENGTH_COST_EARLY)

  if (totalDamageDealt <= STRENGTH_THRESHOLD * STRENGTH_COST_EARLY) {
    return earlyStrength
  }

  const remainingDamage = totalDamageDealt - STRENGTH_THRESHOLD * STRENGTH_COST_EARLY
  const lateStrength = Math.floor(remainingDamage / STRENGTH_COST_LATE)
  return STRENGTH_THRESHOLD + lateStrength
}

// Endurance grows from damage received: +1 per 30 damage, then +1 per 100 after Endurance 30.
// NOTE: this is total Endurance, not bonus — base starting Endurance (10) is added on top
// by the caller, since this function only knows about damage-driven growth.
const ENDURANCE_THRESHOLD = 30
const ENDURANCE_COST_EARLY = 30
const ENDURANCE_COST_LATE = 100

export function calculateEnduranceBonus(totalDamageReceived: number): number {
  const earlyDamage = Math.min(totalDamageReceived, ENDURANCE_THRESHOLD * ENDURANCE_COST_EARLY)
  const earlyBonus = Math.floor(earlyDamage / ENDURANCE_COST_EARLY)

  if (totalDamageReceived <= ENDURANCE_THRESHOLD * ENDURANCE_COST_EARLY) {
    return earlyBonus
  }

  const remainingDamage = totalDamageReceived - ENDURANCE_THRESHOLD * ENDURANCE_COST_EARLY
  const lateBonus = Math.floor(remainingDamage / ENDURANCE_COST_LATE)
  return ENDURANCE_THRESHOLD + lateBonus
}