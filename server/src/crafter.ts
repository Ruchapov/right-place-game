// Каталог Мастера — вещи иного места, переплавка, ковка и кольца (29.10.2026).
// Дизайн целиком — docs/crafter.md.
//
// ⚠️ ЭТОТ ФАЙЛ СУЩЕСТВУЕТ В ДВУХ КОПИЯХ: src/crafter.ts (клиент) и
// server/src/crafter.ts (сервер). Копии обязаны совпадать БАЙТ В БАЙТ, сверка —
// `python tools/check_potion_sync.py`. Импортов здесь нет по той же причине, что
// у classItems.ts: серверный ESM требует расширение в импорте, клиентский Vite — нет.
//
// Что здесь:
//   • десять вещей иного места: id строк Item (их кладёт миграция
//     20261029120000_crafter_items_add), слот, тексты карточки;
//   • рецепт ковки и переплавки — одни числа на кнопку и на списание;
//   • кольца: id, редкость, числа эффектов;
//   • gearEffectsOf — ЧТО из надетого действует в забеге. Её зовут и клиент
//     (бой), и сервер (maxHp и глотки забега, потолки роста статов), поэтому
//     правило «кольца работают только в Дланях» живёт в одном месте.
//
// Чего здесь НЕТ: сами кольца и материалы как предметы сумки (имя, иконка,
// описание, место в сумке, цена продажи) — они в общем каталоге предметов
// classItems.ts, рядом с Осколком и Печатью: там уже есть и склад, и продажа, и
// подсчёт ячеек. Шансы выпадения — в server/src/runDrops.ts, как у всей добычи.

/** Тир вещей иного места. Выше шестого — в обычную добычу они не попадают. */
export const OTHER_TIER = 7
/** С какого уровня героя открыт раздел Мастера и надеваются вещи иного места. */
export const CRAFTER_LEVEL = 30

/** Рецепт ковки одной вещи (решение Андрея 26.10.2026). */
export const FORGE_RP = 150
export const FORGE_GOLD = 50000
export const FORGE_INGOTS = 1
/** Вещь какого тира того же слота уходит в ковку (лежит в сумке, не надета). */
export const FORGE_SOURCE_TIER = 6

/** Переплавка: 1 сырьё + 1 Кровь пилигрима (зелье этого тира) → 1 Слиток. */
export const SMELT_POTION_TIER = 5
/** Шанс «Удачной плавки» — вместо одного Слитка два. */
export const SMELT_CRIT_CHANCE = 0.1
export const SMELT_CRIT_INGOTS = 2

/** Сырьё, которое переплавляется в Слиток. id — из каталога classItems.ts. */
export const CRAFTER_RAW_IDS = ['dark_clot', 'star_pollen'] as const
export type CrafterRawId = typeof CRAFTER_RAW_IDS[number]

export function parseCrafterRawId(raw: unknown): CrafterRawId | null {
  if (typeof raw !== 'string') return null
  return (CRAFTER_RAW_IDS as readonly string[]).includes(raw) ? (raw as CrafterRawId) : null
}

// --- Вещи иного места ---

export const OTHER_ITEM_IDS = [
  'other_shpaga', 'other_palash', 'other_klinok',
  'other_kolet', 'other_brigantina', 'other_pancir',
  'other_klobuk', 'other_dlani', 'other_shag', 'other_chetki',
] as const
export type OtherItemId = typeof OTHER_ITEM_IDS[number]

export type OtherItem = {
  /** id строки Item в БД — тот же, что кладёт миграция. */
  id: OtherItemId
  slot: 'weapon' | 'armor' | 'helmet' | 'gloves' | 'boots' | 'amulet'
  nameRu: string
  /** Файл иконки в public/assets/icons/items/ (256×256). */
  icon: string
  /** Число слота строкой — то же, что лежит в строке Item (миграция). */
  baseStat: string
  /** Фраза с характером — курсивом в карточке, без чисел. */
  desc: string
  /** Что вещь делает, кроме чисел слота, — строка под описанием. */
  effectLine: string
}

export const OTHER_ITEMS: OtherItem[] = [
  { id: 'other_shpaga', slot: 'weapon', nameRu: 'Шпага иного места', icon: 'other_shpaga.png', baseStat: 'Урон +60',
    desc: 'Находит щель в любой защите.',
    effectLine: 'Удар по оглушённому или замороженному врагу ×1,5.' },
  { id: 'other_palash', slot: 'weapon', nameRu: 'Палаш иного места', icon: 'other_palash.png', baseStat: 'Урон +60',
    desc: 'Широкий клинок, который не знает пощады.',
    effectLine: '10% шанс критического удара ×2.' },
  { id: 'other_klinok', slot: 'weapon', nameRu: 'Клинок иного места', icon: 'other_klinok.png', baseStat: 'Урон +60',
    desc: 'Чужая кровь залечивает твои раны.',
    effectLine: 'Удар мечом лечит на 5% нанесённого урона.' },
  { id: 'other_kolet', slot: 'armor', nameRu: 'Колет иного места', icon: 'other_kolet.png', baseStat: 'Броня +30',
    desc: 'Его хозяин не боится встречного удара. Скорее ждёт его.',
    effectLine: 'Отбитый удар возвращает 3% здоровья.' },
  { id: 'other_brigantina', slot: 'armor', nameRu: 'Бригантина иного места', icon: 'other_brigantina.png', baseStat: 'Броня +30',
    desc: 'Пропущенный удар здесь не всегда пропал даром.',
    effectLine: 'Пропущенный удар с шансом 20% даёт 1 ману.' },
  { id: 'other_pancir', slot: 'armor', nameRu: 'Панцирь иного места', icon: 'other_pancir.png', baseStat: 'Броня +30',
    desc: 'Крепнет вместе с отчаянием хозяина.',
    effectLine: 'Когда здоровья меньше 30%, броня удваивается.' },
  { id: 'other_klobuk', slot: 'helmet', nameRu: 'Клобук иного места', icon: 'other_klobuk.png', baseStat: 'Броня +10',
    desc: 'Носивший его не падал там, где падали другие.',
    effectLine: '+5% к наибольшему здоровью.' },
  { id: 'other_dlani', slot: 'gloves', nameRu: 'Длани иного места', icon: 'other_dlani.png', baseStat: 'Броня +10',
    desc: 'Руки мастера ждут своих колец.',
    effectLine: 'Открывают два гнезда для колец.' },
  { id: 'other_shag', slot: 'boots', nameRu: 'Шаг иного места', icon: 'other_shag.png', baseStat: 'Скорость +10%',
    desc: 'Кто носит их, ступает по шипам почти без боли.',
    effectLine: 'Шипы на карте ранят вдвое слабее.' },
  { id: 'other_chetki', slot: 'amulet', nameRu: 'Чётки иного места', icon: 'other_chetki.png', baseStat: 'Удача +10',
    desc: 'Ещё одна молитва — ещё один глоток.',
    effectLine: '+1 глоток зелья за вылазку.' },
]

export function otherItemById(id: string): OtherItem | null {
  return OTHER_ITEMS.find((o) => o.id === id) ?? null
}

export function parseOtherItemId(raw: unknown): OtherItemId | null {
  if (typeof raw !== 'string') return null
  return (OTHER_ITEM_IDS as readonly string[]).includes(raw) ? (raw as OtherItemId) : null
}

// --- Кольца ---

export const RING_IDS = [
  'ring_saving', 'ring_skill_search', 'ring_ash', 'ring_overflow', 'ring_prospector', 'ring_return',
] as const
export type RingId = typeof RING_IDS[number]

export function parseRingId(raw: unknown): RingId | null {
  if (typeof raw !== 'string') return null
  return (RING_IDS as readonly string[]).includes(raw) ? (raw as RingId) : null
}

/** Гнёзд для колец в Дланях. */
export const RING_SLOT_COUNT = 2

/**
 * Редкость среди колец — веса, когда добыча уже решила «кольцо» (сумма 100).
 * Само «кольцо» в добыче — вес в server/src/runDrops.ts.
 */
export const RING_WEIGHTS: Record<RingId, number> = {
  ring_saving: 30,
  ring_skill_search: 25,
  ring_ash: 25,
  ring_overflow: 10,
  ring_prospector: 5,
  ring_return: 5,
}

/** Сбережения: шанс, что выпитое зелье не тратится и не идёт в лимит глотков. */
export const RING_SAVING_CHANCE = 0.2
/** Поиск навыков: шанс книг и страниц умножается на это число. */
export const RING_SKILL_SEARCH_MULT = 1.65
/** Пепел: сколько горит след рывка, сколько горит задевший его враг. */
export const RING_ASH_TRAIL_MS = 2000
export const RING_ASH_BURN_MS = 3000
/** Пепел: тик огня раз в столько мс; урон тика = тик кровотечения героя. */
export const RING_ASH_TICK_MS = 1000
/** Переполнение: шар маны при полном запасе лечит на эту долю наибольшего здоровья. */
export const RING_OVERFLOW_HEAL_FRAC = 0.1
/** Старатель: сколько штук сырья даёт одна находка. */
export const RING_PROSPECTOR_MULT = 2

// --- Числа свойств вещей ---

export const KLOBUK_MAX_HP_FRAC = 0.05
export const SHAG_SPIKE_MULT = 0.5
export const CHETKI_EXTRA_SIPS = 1
export const SHPAGA_DISABLED_MULT = 1.5
export const PALASH_CRIT_CHANCE = 0.1
export const PALASH_CRIT_MULT = 2
export const KLINOK_LIFESTEAL_FRAC = 0.05
export const KOLET_PARRY_HEAL_FRAC = 0.03
export const BRIGANTINA_MANA_CHANCE = 0.2
export const PANCIR_LOW_HP_FRAC = 0.3
export const PANCIR_ARMOR_MULT = 2

/**
 * Потолок скорости с сапог, в процентах (docs/items.md: 10% — чтобы не сломать
 * платформинг на уже размеченных картах).
 */
export const BOOTS_SPEED_CAP_PCT = 10

/**
 * Что из надетого действует в забеге. Без вещей иного места — нейтральные
 * значения: множители 1, шансы 0, и бой идёт ровно как раньше.
 *
 * `rings` — то, что лежит в гнёздах. Кольца действуют ТОЛЬКО пока надеты Длани:
 * сняли перчатки — кольца остаются в гнёздах, но молчат. Два одинаковых кольца
 * надеть можно, бонус не складывается (это просто множество).
 */
export type GearEffects = {
  /** Доля к наибольшему здоровью (Клобук). */
  maxHpFrac: number
  /** Множитель урона шипов карты (Шаг). */
  spikeMult: number
  /** Лишние глотки зелья за вылазку (Чётки). */
  extraSips: number
  /** Множитель удара мечом по оглушённому/замороженному (Шпага). */
  disabledHitMult: number
  /** Шанс и множитель крита мечом (Палаш). */
  critChance: number
  critMult: number
  /** Доля нанесённого мечом урона, которая лечит (Клинок). */
  lifestealFrac: number
  /** Доля наибольшего здоровья за отбитый удар (Колет). */
  parryHealFrac: number
  /** Шанс получить 1 ману от пропущенного удара (Бригантина). */
  hitManaChance: number
  /** Ниже какой доли здоровья броня умножается и на сколько (Панцирь). */
  lowHpFrac: number
  lowHpArmorMult: number
  /** Действующие кольца (без повторов). */
  rings: RingId[]
}

export function gearEffectsOf(equippedItemIds: readonly string[], ringSlots: readonly string[]): GearEffects {
  const has = (id: OtherItemId) => equippedItemIds.includes(id)
  const rings = has('other_dlani')
    ? RING_IDS.filter((id) => ringSlots.slice(0, RING_SLOT_COUNT).includes(id))
    : []
  return {
    maxHpFrac: has('other_klobuk') ? KLOBUK_MAX_HP_FRAC : 0,
    spikeMult: has('other_shag') ? SHAG_SPIKE_MULT : 1,
    extraSips: has('other_chetki') ? CHETKI_EXTRA_SIPS : 0,
    disabledHitMult: has('other_shpaga') ? SHPAGA_DISABLED_MULT : 1,
    critChance: has('other_palash') ? PALASH_CRIT_CHANCE : 0,
    critMult: has('other_palash') ? PALASH_CRIT_MULT : 1,
    lifestealFrac: has('other_klinok') ? KLINOK_LIFESTEAL_FRAC : 0,
    parryHealFrac: has('other_kolet') ? KOLET_PARRY_HEAL_FRAC : 0,
    hitManaChance: has('other_brigantina') ? BRIGANTINA_MANA_CHANCE : 0,
    lowHpFrac: has('other_pancir') ? PANCIR_LOW_HP_FRAC : 0,
    lowHpArmorMult: has('other_pancir') ? PANCIR_ARMOR_MULT : 1,
    rings,
  }
}

/**
 * Наибольшее здоровье героя в забеге: 8 за единицу выносливости и Клобук сверху.
 * Вниз — лишнего HP игроку не даём (то же правило, что у лечения). ОДНА формула на
 * клиент (бой) и сервер (run.maxHp и потолки).
 */
export const HP_PER_ENDURANCE = 8
export function runMaxHpOf(endurance: number, gear: GearEffects): number {
  return Math.floor(endurance * HP_PER_ENDURANCE * (1 + gear.maxHpFrac))
}
