// Портной (14.11.2026, docs/shop.md, «ПОРТНОЙ»): чтение облика героя из колонок
// персонажа и снимка в currentRun. Каталог и бонусы — общий skins.ts.
//
// Отдельным файлом, а не в runState.ts: тот и так 1500 строк, а облик читают
// три места — вход, профиль и ручки Портного (routes/skins.ts) — плюс старт
// забега и потолки (снимок currentRun.skins).
import {
  CLOAKS, parseArmorSkinId, parseCloakId, parseRunSkins, parseSlashSkinId, clampSkinLevel,
  type ArmorSkinId, type CloakId, type RunSkins, type SkinState, type SlashSkinId,
} from './skins.js'

/** Колонки облика в Character — ровно те, что читает skinStateOf. */
export type SkinColumns = {
  skinArmor: string
  skinSlash: string
  cloakId: string
  ownedArmorSkins: string[]
  ownedSlashSkins: string[]
  cloakLevelAsh: number
  cloakLevelMidnight: number
  cloakLevelWine: number
  brandLevelArmor: number
  brandLevelWeapon: number
  patchCount: number
  brandCount: number
}

/** Колонка уровня плаща — switch, чтобы четвёртый плащ без ветки не собрался. */
export function cloakLevelColumn(id: CloakId): 'cloakLevelAsh' | 'cloakLevelMidnight' | 'cloakLevelWine' {
  switch (id) {
    case 'ash': return 'cloakLevelAsh'
    case 'midnight': return 'cloakLevelMidnight'
    case 'wine': return 'cloakLevelWine'
  }
}

/**
 * Облик из колонок. Колонки пишут только ручки Портного, но схема строки не
 * проверяет: чужой id (руками в базе) читается как обычный облик и не роняет
 * вход, уровни приводятся в 0..20. Это не тихий фолбэк в пользу игрока: хуже,
 * чем «обычный облик и нулевые бонусы», испорченная колонка не сделает.
 */
export function skinStateOf(c: SkinColumns): SkinState {
  const armor: ArmorSkinId = parseArmorSkinId(c.skinArmor) ?? 'none'
  const slash: SlashSkinId = parseSlashSkinId(c.skinSlash) ?? 'none'
  const cloak: CloakId = parseCloakId(c.cloakId) ?? 'ash'
  const ownedArmor = [...new Set(c.ownedArmorSkins.map(parseArmorSkinId).filter((x): x is Exclude<ArmorSkinId, 'none'> => x !== null && x !== 'none'))]
  const ownedSlash = [...new Set(c.ownedSlashSkins.map(parseSlashSkinId).filter((x): x is Exclude<SlashSkinId, 'none'> => x !== null && x !== 'none'))]
  const cloakLevels = {} as Record<CloakId, number>
  for (const cl of CLOAKS) cloakLevels[cl.id] = clampSkinLevel(c[cloakLevelColumn(cl.id)])
  return {
    armor, slash, cloak, ownedArmor, ownedSlash, cloakLevels,
    brandLevels: { armor: clampSkinLevel(c.brandLevelArmor), weapon: clampSkinLevel(c.brandLevelWeapon) },
    patchCount: Math.max(0, c.patchCount),
    brandCount: Math.max(0, c.brandCount),
  }
}

/**
 * Снимок облика забега (currentRun.skins, пишет старт). Три состояния, как у
 * readRunHealSkill: нет поля — забег начат сервером старше Портного (облик
 * обычный, бонусов нет); испорчено — 'malformed' (потолки считают без бонусов,
 * то есть против игрока, и финиш пишет громкий лог).
 */
export function readRunSkins(run: { skins?: unknown }): RunSkins | null | 'malformed' {
  if (run.skins === undefined) return null
  const parsed = parseRunSkins(run.skins)
  return parsed === null ? 'malformed' : parsed
}
