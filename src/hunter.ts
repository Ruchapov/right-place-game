// Ловчий — житель Убежища (27.10.2026): за значки охотника продаёт +1 к силе,
// ловкости или выносливости. Решения Андрея — docs/shop.md, «ЛОВЧИЙ».
//
// ⚠️ ЭТОТ ФАЙЛ СУЩЕСТВУЕТ В ДВУХ КОПИЯХ: src/hunter.ts (клиент) и
// server/src/hunter.ts (сервер). Общего пакета в проекте нет (tsconfig.app.json
// включает только "src", у сервера rootDir "./src"). Копии обязаны совпадать
// БАЙТ В БАЙТ, сверка — `python tools/check_potion_sync.py`, гонять ПЕРЕД
// деплоем сервера. Импортов здесь нет и быть не может — та же причина, что у
// src/quests.ts.
//
// Что здесь есть и почему одним файлом на обе стороны: какие статы продаются и
// цена. Цену витрина пишет на кнопке, и её же списывает сервер — одна формула
// на двоих, как у предметов классов.
//
// Чего здесь НЕТ намеренно: удачи (её Ловчий не продаёт — решение Андрея) и
// того, как стат поднимает уровень, — это calculateLevel в server/src/game.ts,
// та же функция, что после роста статов в бою.

/** Стат, который продаёт Ловчий. Строки — имена колонок Character. */
export type HunterStat = 'strength' | 'agility' | 'endurance'

/** Порядок строк в витрине Ловчего и подписи — те же, что на «Персонаже». */
export const HUNTER_STATS: readonly { id: HunterStat; nameRu: string }[] = [
  { id: 'strength', nameRu: 'Сила' },
  { id: 'agility', nameRu: 'Ловкость' },
  { id: 'endurance', nameRu: 'Выносливость' },
]

/** Значков охотника за единицу текущего значения стата. */
export const HUNTER_STAT_PRICE_PER_POINT = 10

/**
 * Цена +1 к стату: 10 × текущее значение (10 → 100 значков, 11 → 110). Значение
 * — СОХРАНЁННОЕ в Character, без снаряжения: его и растит покупка.
 */
export function hunterStatPrice(current: number): number {
  return HUNTER_STAT_PRICE_PER_POINT * current
}

/** Разбор id стата из тела запроса / данных; не стат Ловчего — null. */
export function parseHunterStat(raw: unknown): HunterStat | null {
  return HUNTER_STATS.some((s) => s.id === raw) ? (raw as HunterStat) : null
}
