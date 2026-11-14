// Портной — житель Убежища (14.11.2026, docs/shop.md, «ПОРТНОЙ»): облик тела,
// цвет удара, плащи с уровнями улучшения, нашивка и Кузнечное клеймо. Задача —
// docs/skins-task.md (раздел 7 главнее разделов 1–6).
//
// ⚠️ ЭТОТ ФАЙЛ СУЩЕСТВУЕТ В ДВУХ КОПИЯХ: src/skins.ts (клиент) и
// server/src/skins.ts (сервер). Общего пакета в проекте нет (tsconfig.app.json
// включает только "src", у сервера rootDir "./src"). Копии обязаны совпадать
// БАЙТ В БАЙТ, сверка — `python tools/check_potion_sync.py`, гонять ПЕРЕД
// деплоем сервера. Импортов здесь нет и быть не может — та же причина, что у
// src/hunter.ts.
//
// Что здесь и почему одним файлом на обе стороны:
//   • цены — витрина пишет их на кнопке, сервер списывает ровно их;
//   • уровни открытия плащей — витрина вешает замок, сервер не даёт надеть;
//   • бонусы плащей и клейма — ими бьётся клиент, и из них же сервер держит
//     запас в потолках роста статов (лечение зельями, максимум HP). Разные
//     числа на двух сторонах молча срезали бы честному игроку выносливость.
//
// Чего здесь НЕТ: шансов выпадения нашивки и клейма — добычу бросает только
// сервер (server/src/runDrops.ts), как всю остальную.

/** Облик тела. 'none' — обычная броня, есть у всех. */
export type ArmorSkinId = 'none' | 'gold' | 'crimson' | 'violet'
/** Цвет удара. 'none' — обычный голубой, есть у всех. */
export type SlashSkinId = 'none' | 'red' | 'violet' | 'gold'
/** Плащ. Носить можно один. */
export type CloakId = 'ash' | 'midnight' | 'wine'
/** Что улучшают нашивка (плащ) и клеймо (броня, оружие). */
export type UpgradeTarget = 'cloak' | 'armor' | 'weapon'
/** Предметы Портного, лежащие счётчиками (не в сумке). */
export type TailorItemId = 'patch' | 'brand'

/** Покупаемые облики тела — порядок карточек в витрине (после «Обычной»). */
export const ARMOR_SKINS: readonly { id: Exclude<ArmorSkinId, 'none'>; nameRu: string; price: number }[] = [
  { id: 'gold', nameRu: 'Золотая', price: 500 },
  { id: 'crimson', nameRu: 'Багровая', price: 500 },
  { id: 'violet', nameRu: 'Фиолетовая', price: 500 },
]

/** Покупаемые цвета удара — порядок карточек в витрине (после «Обычного»). */
export const SLASH_SKINS: readonly { id: Exclude<SlashSkinId, 'none'>; nameRu: string; price: number }[] = [
  { id: 'red', nameRu: 'Красный удар', price: 400 },
  { id: 'violet', nameRu: 'Фиолетовый удар', price: 400 },
  { id: 'gold', nameRu: 'Золотой удар', price: 400 },
]

/** Названия «обычных» карточек — у них цены нет, они есть у всех. */
export const ARMOR_NONE_NAME = 'Обычная'
export const SLASH_NONE_NAME = 'Обычный'

/**
 * Цвет перекраски плаща (шейдер, docs/shop.md, «ПОРТНОЙ»): тон в градусах,
 * насыщенность и базовая яркость. null — без перекраски (оригинальный плащ).
 */
export type CloakColor = { h: number; s: number; v: number } | null

/** Плащи: бесплатные, открываются по уровню героя. Порядок — витрина. */
export const CLOAKS: readonly { id: CloakId; nameRu: string; unlockLevel: number; color: CloakColor }[] = [
  { id: 'ash', nameRu: 'Пепельный «Латник»', unlockLevel: 1, color: null },
  { id: 'midnight', nameRu: 'Полночный «Клинок»', unlockLevel: 5, color: { h: 222, s: 0.55, v: 0.30 } },
  { id: 'wine', nameRu: 'Винный «Дуэль»', unlockLevel: 10, color: { h: 348, s: 0.55, v: 0.32 } },
]

/** Предел улучшения плаща, брони и оружия. На нём «Улучшить» неактивна. */
export const SKIN_UPGRADE_MAX_LEVEL = 20
/** Шанс успеха нашивки и клейма — всегда, от уровня не зависит. Бросает сервер. */
export const SKIN_UPGRADE_SUCCESS_CHANCE = 0.5
/** Цена нашивки и клейма в RP, если своих в запасе нет. */
export const PATCH_PRICE_RP = 100
export const BRAND_PRICE_RP = 100

/** Сколько длится бонус «первый удар после парирования» (плащ «Дуэль»). */
export const PARRY_STRIKE_WINDOW_MS = 2000
/** Множитель крита Кузнечного клейма оружия — «крит ×2». */
export const BRAND_CRIT_MULT = 2

/**
 * Предметы Портного: имя, иконка, место в сумке. Лежат СЧЁТЧИКАМИ
 * (Character.patchCount / brandCount), ячейку не занимают — правила сумки не
 * трогаются (раздел 7 задачи). Иконки клейма пока нет — путь заложен, файл
 * временный (docs/shop.md).
 */
export const TAILOR_ITEMS: readonly { id: TailorItemId; nameRu: string; icon: string; takesCell: false; descRu: string }[] = [
  { id: 'patch', nameRu: 'Нашивка', icon: 'item_patch.png', takesCell: false, descRu: 'Одна попытка улучшить плащ у Портного.' },
  { id: 'brand', nameRu: 'Кузнечное клеймо', icon: 'item_brand.png', takesCell: false, descRu: 'Одна попытка улучшить броню или оружие у Портного.' },
]

/** Бонусы плаща. Все поля есть всегда; у «чужих» бонусов — ноль. */
export type CloakBonus = {
  /** Доля входящего урона, которую плащ поглощает (Латник). */
  damageAbsorbFrac: number
  /** Прибавка к лечению зельями, доля (Латник). */
  potionHealBonusFrac: number
  /** Удар мечом быстрее на долю: анимация и перезарядка короче (Клинок). */
  attackSpeedFrac: number
  /** Перезарядка рывка короче на долю (Клинок). */
  dashCooldownCutFrac: number
  /** Оглушение врага после удачного парирования длиннее, мс (Дуэль). */
  parryStunExtraMs: number
  /** Первый удар мечом после парирования сильнее на долю (Дуэль). */
  parryStrikeBonusFrac: number
}

/** Уровень, приведённый в 0..SKIN_UPGRADE_MAX_LEVEL; мусор — 0. */
export function clampSkinLevel(level: number): number {
  if (!Number.isFinite(level)) return 0
  return Math.max(0, Math.min(SKIN_UPGRADE_MAX_LEVEL, Math.floor(level)))
}

/**
 * Бонусы плаща на уровне L (0..20). ОДНА функция на все числа плащей — чтобы
 * подкручивать баланс в одном месте (решение задачи).
 */
export function cloakBonus(id: CloakId, level: number): CloakBonus {
  const L = clampSkinLevel(level)
  const out: CloakBonus = {
    damageAbsorbFrac: 0, potionHealBonusFrac: 0, attackSpeedFrac: 0,
    dashCooldownCutFrac: 0, parryStunExtraMs: 0, parryStrikeBonusFrac: 0,
  }
  if (id === 'ash') {
    out.damageAbsorbFrac = 0.03 + 0.005 * L
    out.potionHealBonusFrac = 0.10 + 0.02 * L
  } else if (id === 'midnight') {
    out.attackSpeedFrac = 0.05 + 0.005 * L
    out.dashCooldownCutFrac = 0.075 + 0.01 * L
  } else if (id === 'wine') {
    out.parryStunExtraMs = 100 + 50 * L
    out.parryStrikeBonusFrac = 0.10 + 0.02 * L
  }
  return out
}

/** Бонусы Кузнечного клейма. Все поля есть всегда; у «чужой» цели — ноль. */
export type BrandBonus = {
  /** Прибавка к максимуму HP, доля (броня). */
  maxHpFrac: number
  /** Снижение входящего урона, доля (броня). */
  damageReduceFrac: number
  /** Прибавка к урону мечом, доля (оружие). */
  swordDamageFrac: number
  /** Шанс крита ×BRAND_CRIT_MULT (оружие). Не складывается с критом класса. */
  critChance: number
}

/**
 * Бонусы клейма на уровне L (0..20). Числа предварительные (раздел 7 задачи) —
 * поэтому, как и у плащей, одной функцией.
 */
export function brandBonus(target: 'armor' | 'weapon', level: number): BrandBonus {
  const L = clampSkinLevel(level)
  const out: BrandBonus = { maxHpFrac: 0, damageReduceFrac: 0, swordDamageFrac: 0, critChance: 0 }
  if (target === 'armor') {
    out.maxHpFrac = 0.005 * L
    out.damageReduceFrac = 0.003 * L
  } else {
    out.swordDamageFrac = 0.005 * L
    out.critChance = 0.003 * L
  }
  return out
}

/**
 * Во сколько раз облик (плащ + клеймо брони) уменьшает входящий урон: поглощение
 * Латника и снижение от клейма множатся, а не складываются, — порядок не важен,
 * и вместе они никогда не дадут 100%.
 */
export function skinDamageTakenMult(cloak: CloakId, cloakLevel: number, brandArmorLevel: number): number {
  return (1 - cloakBonus(cloak, cloakLevel).damageAbsorbFrac) * (1 - brandBonus('armor', brandArmorLevel).damageReduceFrac)
}

export function parseArmorSkinId(raw: unknown): ArmorSkinId | null {
  return raw === 'none' || ARMOR_SKINS.some((s) => s.id === raw) ? (raw as ArmorSkinId) : null
}

export function parseSlashSkinId(raw: unknown): SlashSkinId | null {
  return raw === 'none' || SLASH_SKINS.some((s) => s.id === raw) ? (raw as SlashSkinId) : null
}

export function parseCloakId(raw: unknown): CloakId | null {
  return CLOAKS.some((c) => c.id === raw) ? (raw as CloakId) : null
}

export function parseUpgradeTarget(raw: unknown): UpgradeTarget | null {
  return raw === 'cloak' || raw === 'armor' || raw === 'weapon' ? raw : null
}

export function cloakById(id: CloakId): (typeof CLOAKS)[number] {
  return CLOAKS.find((c) => c.id === id) ?? CLOAKS[0]
}

export function tailorItemById(id: TailorItemId): (typeof TAILOR_ITEMS)[number] {
  return TAILOR_ITEMS.find((t) => t.id === id) ?? TAILOR_ITEMS[0]
}

/** Цена облика в RP; 'none' и неизвестное — null (не продаётся). */
export function armorSkinPrice(id: ArmorSkinId): number | null {
  return ARMOR_SKINS.find((s) => s.id === id)?.price ?? null
}

export function slashSkinPrice(id: SlashSkinId): number | null {
  return SLASH_SKINS.find((s) => s.id === id)?.price ?? null
}

/** Чем улучшается цель: плащ — нашивкой, броня и оружие — клеймом. */
export function upgradeItemFor(target: UpgradeTarget): TailorItemId {
  return target === 'cloak' ? 'patch' : 'brand'
}

/** Цена попытки в RP, когда своего предмета нет. */
export function upgradePriceRp(target: UpgradeTarget): number {
  return target === 'cloak' ? PATCH_PRICE_RP : BRAND_PRICE_RP
}

/** Состояние Портного у героя — та же форма в ответах сервера и в клиенте. */
export type SkinState = {
  armor: ArmorSkinId
  slash: SlashSkinId
  cloak: CloakId
  ownedArmor: Exclude<ArmorSkinId, 'none'>[]
  ownedSlash: Exclude<SlashSkinId, 'none'>[]
  cloakLevels: Record<CloakId, number>
  brandLevels: { armor: number; weapon: number }
  patchCount: number
  brandCount: number
}

/** Что из облика нужно забегу: бонусы и перекраска (снимок на старте). */
export type RunSkins = {
  armor: ArmorSkinId
  slash: SlashSkinId
  cloak: CloakId
  cloakLevel: number
  brandArmor: number
  brandWeapon: number
}

export function runSkinsOf(s: SkinState): RunSkins {
  return {
    armor: s.armor,
    slash: s.slash,
    cloak: s.cloak,
    cloakLevel: s.cloakLevels[s.cloak],
    brandArmor: s.brandLevels.armor,
    brandWeapon: s.brandLevels.weapon,
  }
}

/** Облик по умолчанию: всё обычное, Пепельный плащ, уровни 0. */
export const DEFAULT_RUN_SKINS: RunSkins = { armor: 'none', slash: 'none', cloak: 'ash', cloakLevel: 0, brandArmor: 0, brandWeapon: 0 }

/**
 * Строгий разбор снимка облика (ответ сервера, currentRun.skins). Любое
 * отклонение — null: вызывающий решает, что значит «не назван».
 */
export function parseRunSkins(raw: unknown): RunSkins | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const armor = parseArmorSkinId(r.armor)
  const slash = parseSlashSkinId(r.slash)
  const cloak = parseCloakId(r.cloak)
  const levels = [r.cloakLevel, r.brandArmor, r.brandWeapon]
  if (armor === null || slash === null || cloak === null) return null
  if (!levels.every((l) => Number.isInteger(l) && (l as number) >= 0 && (l as number) <= SKIN_UPGRADE_MAX_LEVEL)) return null
  return { armor, slash, cloak, cloakLevel: r.cloakLevel as number, brandArmor: r.brandArmor as number, brandWeapon: r.brandWeapon as number }
}

/** Строгий разбор состояния Портного из ответа сервера; отклонение — null. */
export function parseSkinState(raw: unknown): SkinState | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const armor = parseArmorSkinId(r.armor)
  const slash = parseSlashSkinId(r.slash)
  const cloak = parseCloakId(r.cloak)
  if (armor === null || slash === null || cloak === null) return null
  const count = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : null)
  const level = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= SKIN_UPGRADE_MAX_LEVEL ? (v as number) : null)
  if (!Array.isArray(r.ownedArmor) || !Array.isArray(r.ownedSlash)) return null
  const ownedArmor = r.ownedArmor.map(parseArmorSkinId)
  const ownedSlash = r.ownedSlash.map(parseSlashSkinId)
  if (ownedArmor.some((x) => x === null || x === 'none') || ownedSlash.some((x) => x === null || x === 'none')) return null
  const cl = r.cloakLevels as Record<string, unknown> | null
  const bl = r.brandLevels as Record<string, unknown> | null
  if (typeof cl !== 'object' || cl === null || typeof bl !== 'object' || bl === null) return null
  const cloakLevels = {} as Record<CloakId, number>
  for (const c of CLOAKS) {
    const v = level(cl[c.id])
    if (v === null) return null
    cloakLevels[c.id] = v
  }
  const brandArmor = level(bl.armor)
  const brandWeapon = level(bl.weapon)
  const patchCount = count(r.patchCount)
  const brandCount = count(r.brandCount)
  if (brandArmor === null || brandWeapon === null || patchCount === null || brandCount === null) return null
  return {
    armor, slash, cloak,
    ownedArmor: ownedArmor as Exclude<ArmorSkinId, 'none'>[],
    ownedSlash: ownedSlash as Exclude<SlashSkinId, 'none'>[],
    cloakLevels,
    brandLevels: { armor: brandArmor, weapon: brandWeapon },
    patchCount, brandCount,
  }
}
