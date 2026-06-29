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

// Each next stat point costs Math.round(base * Math.pow(growth, stat - 10)) accumulated units.
// All three stats start at 10 so threshold exponent is 0 (cost = base) at the starting value.
function calcStatPoints(accumulated: number, base: number, growth: number, startStat = 10): number {
  let stat = startStat
  let used = 0
  while (true) {
    const threshold = Math.round(base * Math.pow(growth, stat - 10))
    if (used + threshold > accumulated) break
    used += threshold
    stat++
  }
  return stat
}

export function calculateStrength(totalDamageDealt: number): number {
  return calcStatPoints(totalDamageDealt, 300, 1.15)
}

export function calculateEndurance(totalDamageReceived: number): number {
  return calcStatPoints(totalDamageReceived, 120, 1.20)
}
// --- Leveling (Method 1: stat progression) ---

// Checks whether the player has progressed enough since their last level-up to
// gain a new level. Per design: Endurance +3 AND (Strength+Agility) +6 since last
// level-up. TEMPORARY (until Agility exists): Strength +6 alone stands in for
// Strength+Agility +6.
const LEVELUP_ENDURANCE_GAIN = 3
const LEVELUP_STRENGTH_GAIN = 6

// Returns how many levels the player should gain right now. Each is independent:
// every full +3 Endurance gives a level, AND separately every full +6 Strength
// gives a level (design decision: "OR", not "AND" — either stat progressing is
// enough, they don't have to advance together). Levels from both tracks add up.
export function checkStatLevelUp(
  currentEndurance: number,
  currentStrength: number,
  enduranceAtLevelUp: number,
  strengthAtLevelUp: number,
): number {
  const enduranceGain = currentEndurance - enduranceAtLevelUp
  const strengthGain = currentStrength - strengthAtLevelUp

  const levelsFromEndurance = Math.floor(enduranceGain / LEVELUP_ENDURANCE_GAIN)
  const levelsFromStrength = Math.floor(strengthGain / LEVELUP_STRENGTH_GAIN)

  return levelsFromEndurance + levelsFromStrength
}

export function normalizeDealtDamage(rawDamage: number, level: number): number {
  return rawDamage / (1 + 0.18 * (level - 1))
}

export function normalizeReceivedDamage(rawDamage: number, level: number): number {
  return rawDamage / (1 + 0.12 * (level - 1))
}

export function calculateAgility(totalSkillDamage: number): number {
  return calcStatPoints(totalSkillDamage, 300, 1.15)
}