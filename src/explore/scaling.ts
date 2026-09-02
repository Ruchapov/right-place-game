import * as C from './constants'

// Масштабирование характеристик обычного врага и босса по уровню персонажа
// (см. задачу "масштабирование по уровню"). Линейная формула для врага,
// множители поверх неё для босса — коэффициенты см. в constants.ts
// (ENEMY_HP_PER_LEVEL/ENEMY_DAMAGE_PER_LEVEL/BOSS_*_MULT). Вызывать ТОЛЬКО
// один раз в момент спавна (enemy.ts/boss.ts) — НЕ на каждый кадр и НЕ при
// изменении уровня посреди забега, см. Enemy.attackDamage/Boss.meleeDamage
// и т.п. в types.ts, куда результат кладётся один раз и дальше читается как
// обычное поле.

export function scaledEnemyMaxHp(level: number): number {
  return Math.round(C.ENEMY_MAX_HP + C.ENEMY_HP_PER_LEVEL * (level - 1))
}

export function scaledEnemyAttackDamage(level: number): number {
  return Math.round(C.ENEMY_ATTACK_DAMAGE + C.ENEMY_DAMAGE_PER_LEVEL * (level - 1))
}

// Босс не растёт по level САМ ПО СЕБЕ — его характеристики являются
// множителем поверх уже отмасштабированных характеристик обычного врага НА
// ТОМ ЖЕ уровне (см. задачу: "HP босса = round(2.5 * HP обычного врага)").
export function scaledBossMaxHp(level: number): number {
  return Math.round(C.BOSS_HP_MULT * scaledEnemyMaxHp(level))
}

export function scaledBossMeleeDamage(level: number): number {
  return Math.round(C.BOSS_MELEE_DMG_MULT * scaledEnemyAttackDamage(level))
}

export function scaledBossMelee2Damage(level: number): number {
  return Math.round(C.BOSS_MELEE2_DMG_MULT * scaledEnemyAttackDamage(level))
}

export function scaledBossSpikeDamage(level: number): number {
  return Math.round(C.BOSS_SPIKE_DMG_MULT * scaledEnemyAttackDamage(level))
}

export function scaledBossWaveDamage(level: number): number {
  return Math.round(C.BOSS_WAVE_DMG_MULT * scaledEnemyAttackDamage(level))
}
