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