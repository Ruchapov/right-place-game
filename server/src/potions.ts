// Каталог зелий — ЕДИНСТВЕННЫЙ источник правды по тирам.
//
// ⚠️ ЭТОТ ФАЙЛ СУЩЕСТВУЕТ В ДВУХ КОПИЯХ: src/potions.ts (клиент) и
// server/src/potions.ts (сервер). Общего пакета в проекте нет и завести его
// дёшево нельзя: tsconfig.app.json включает только "src", у сервера
// rootDir "./src" — импорт наружу не компилируется ни с одной стороны.
// Копии обязаны совпадать БАЙТ В БАЙТ, сверка — `python tools/check_potion_sync.py`
// (read-only, сравнивает sha256), гонять ПЕРЕД деплоем сервера. Тот же приём
// и та же плата, что у server/src/maps/*_slots.json (см. tools/check_map_sync.py).
//
// Почему один каталог: до него проценты лечения жили в ТРЁХ местах —
// POTIONS.percent и текст внутри POTION_CATALOG.stat в App.tsx плюс
// POTION_HEAL_FRAC в explore/constants.ts — и уже противоречили друг другу
// (витрина обещала 10..30%, а лечило всегда 25%).
//
// Имя файла иконки — БЕЗ BASE_URL: префикс добавляется на месте использования
// (`${import.meta.env.BASE_URL}assets/icons/${icon}`), иначе копии разъехались
// бы по import.meta, которого на сервере нет.

export type PotionTier = {
  /** 1..5, он же индекс+1 в POTION_TIERS и номер колонки potionT<N> в Character. */
  tier: number
  /** Доля maxHp, которую лечит один глоток. Заменил заглушку POTION_HEAL_FRAC=0.25. */
  healFrac: number
  /** Минимальный уровень персонажа для ПОКУПКИ. Проверяется и на сервере. */
  levelRequired: number
  /** Цена одной покупки в золоте. Источник правды и для витрины, и для сервера. */
  price: number
  /** Имя файла в public/assets/icons (128×128). */
  icon: string
  nameRu: string
  desc: string
}

export const POTION_TIERS: PotionTier[] = [
  {
    tier: 1,
    healFrac: 0.10,
    levelRequired: 1,
    price: 20,
    icon: 'potion_1_vial.png',
    nameRu: 'Мутный отвар',
    desc: 'Горькая муть на дне склянки. Затянет царапины, не более.',
  },
  {
    tier: 2,
    healFrac: 0.15,
    levelRequired: 5,
    price: 45,
    icon: 'potion_2_flask.png',
    nameRu: 'Травяной настой',
    desc: 'Пахнет сухими травами и сырым погребом. Хватит, чтобы отдышаться.',
  },
  {
    tier: 3,
    healFrac: 0.20,
    levelRequired: 10,
    price: 90,
    icon: 'potion_3_bulb.png',
    nameRu: 'Багровое зелье',
    desc: 'Тягучее и тёплое. Раны затягиваются, пока пьёшь.',
  },
  {
    tier: 4,
    healFrac: 0.25,
    levelRequired: 20,
    price: 160,
    icon: 'potion_4_jug.png',
    nameRu: 'Густой эликсир',
    desc: 'Тяжёлый, как ртуть. Поднимает и переломанного.',
  },
  {
    tier: 5,
    healFrac: 0.30,
    levelRequired: 30,
    price: 280,
    icon: 'potion_5_ampoule.png',
    nameRu: 'Кровь пилигрима',
    desc: 'Говорят, её собирали у тех, кто дошёл. Крепче в этих краях не сыскать.',
  },
]

/** Сколько раз ВСЕГО можно выпить за один забег, независимо от тиров. */
export const MAX_SIPS_PER_RUN = 3

/**
 * Сколько зелий можно купить ОДНИМ запросом (степпер на карточке и потолок
 * на сервере — одно и то же число).
 *
 * Почему 10, а не «сколько влезет»: переполнение Int тут ни при чём (до
 * потолка int4 нужно 2,1 млрд зелий), реально ограничивает золото, а
 * 280 × 10 = 2800 — заведомо безопасное произведение. При MAX_SIPS_PER_RUN = 3
 * десять зелий это запас больше чем на три забега, то есть осмысленный предел
 * оптовой покупки, а не искусственный барьер. Плюс двузначное число помещается
 * в один ряд степпера на карточке шириной 290px.
 */
export const MAX_POTIONS_PER_PURCHASE = 10

/**
 * Сколько зелий просят купить: из тела запроса (сервер) или из степпера
 * (клиент). Поля нет — ровно одно: так шлёт клиент до появления счётчика, и
 * его поведение меняться не должно. Не целое число, меньше 1 или больше
 * MAX_POTIONS_PER_PURCHASE — null, то есть отказ: строку "3", null, 0, 11 и
 * 2.5 молча приводить к числу нельзя, иначе игрок купит не то, что просил.
 */
export function parsePurchaseCount(raw: unknown): number | null {
  if (raw === undefined) return 1
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return null
  if (raw < 1 || raw > MAX_POTIONS_PER_PURCHASE) return null
  return raw
}

/** Длина всех «по тирам» массивов (запас, выпитое). Совпадает с числом колонок potionT1..T5. */
export const POTION_TIER_COUNT = POTION_TIERS.length

/** Пустой запас — общая точка вместо россыпи литералов [0,0,0,0,0]. */
export function emptyPotionStock(): number[] {
  return new Array(POTION_TIER_COUNT).fill(0)
}

/**
 * Старший тир, которого реально хватает, или null если склад пуст.
 * Правило питья: всегда самое сильное из имеющегося, кончилось — следующее вниз.
 * Возвращает НОМЕР тира (1..5), не индекс.
 */
export function highestAvailableTier(stock: readonly number[]): number | null {
  for (let i = POTION_TIER_COUNT - 1; i >= 0; i--) {
    if ((stock[i] ?? 0) > 0) return i + 1
  }
  return null
}

/** Запись каталога по номеру тира (1..5), или null если номер не из каталога. */
export function potionTierByNumber(tier: number): PotionTier | null {
  return POTION_TIERS.find((p) => p.tier === tier) ?? null
}
