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
// --- Stat growth: incremental accumulation ---

// Given the current stat value, current leftover progress, and new RAW damage
// (dealt/taken/skill+heal — no more per-level normalization, see below),
// returns the new stat (incremented for each threshold crossed) and new
// leftover progress. threshold(stat) = round(base * (stat/10)^EXPONENT) —
// same shape for all three stats, only `base` differs (see
// STRENGTH_THRESHOLD_BASE/ENDURANCE_THRESHOLD_BASE/AGILITY_THRESHOLD_BASE
// below).
const STAT_THRESHOLD_EXPONENT = 1.2

export function applyStatProgress(
  currentStat: number,
  currentProgress: number,
  newDamage: number,
  base: number,
): { stat: number; progress: number } {
  let stat = currentStat
  let progress = currentProgress + newDamage
  while (true) {
    const threshold = Math.round(base * Math.pow(stat / 10, STAT_THRESHOLD_EXPONENT))
    if (progress < threshold) break
    progress -= threshold
    stat++
  }
  return { stat, progress }
}

export const STRENGTH_THRESHOLD_BASE = 710
export const ENDURANCE_THRESHOLD_BASE = 290
export const AGILITY_THRESHOLD_BASE = 710

// --- Leveling: function of current stats PLUS bonusLevels, no stat history ---
// Replaces the old incremental +3 Endurance / +6 Strength bookkeeping
// (strengthAtLevelUp/enduranceAtLevelUp are gone). Two independent stat
// channels — offense (strength+agility) and survival (endurance) — whichever
// is further ahead sets the stat-derived level; bonusLevels is added on top.
// bonusLevels is NOT derived from stats — it's Character.bonusLevels, a
// persisted counter incremented by discrete events (currently: boss kills,
// see /run/finish-explore's bossClosed). Level overall is not stat-history-free — it's
// still a pure function of (strength, agility, endurance, bonusLevels), it
// just has a second, non-stat input now.
export function calculateLevel(strength: number, agility: number, endurance: number, bonusLevels: number): number {
  const damageChannel = Math.floor((strength + agility - 20) / 6)
  const survivalChannel = Math.floor((endurance - 10) / 3)
  return 1 + Math.max(damageChannel, survivalChannel) + bonusLevels
}

// --- Enemy HP scaling (mirrors src/explore/scaling.ts on the CLIENT —
// ENEMY_MAX_HP/ENEMY_HP_PER_LEVEL there, same formula) ---
// No shared package between frontend and server in this repo (same situation
// as runEvents.ts's TROPHY_* constants, see its own comment) — kept in sync
// BY HAND. If the client's ENEMY_MAX_HP/ENEMY_HP_PER_LEVEL ever change,
// update these two to match, or the anti-cheat cap in /run/finish-explore
// will silently drift from what the client actually spawned.
export const ENEMY_HP_BASE = 100
export const ENEMY_HP_PER_LEVEL = 9.0

export function scaledEnemyMaxHp(level: number): number {
  return Math.round(ENEMY_HP_BASE + ENEMY_HP_PER_LEVEL * (level - 1))
}

// Босс — не отдельная формула, а множитель поверх уже отмасштабированного
// HP обычного врага (mirrors BOSS_HP_MULT в src/explore/constants.ts на
// клиенте, тот же ручной синк, что у ENEMY_HP_BASE/ENEMY_HP_PER_LEVEL выше).
export const BOSS_HP_MULT = 2.5

export function scaledBossMaxHp(level: number): number {
  return Math.round(BOSS_HP_MULT * scaledEnemyMaxHp(level))
}

