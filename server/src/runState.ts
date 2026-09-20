// Форма активного забега (Character.currentRun), ЧИСТЫЕ читатели к ней и
// потолки на выпитое за забег — плюс раскладка склада зелий по колонкам
// potionT1..T5. Ни DB, ни HTTP, как и в game.ts.
//
// Почему отдельным файлом, а не внутри routes/run.ts, где всё это выросло:
// читателей у одного и того же JSON стало ДВА. Первый — /run/sip и
// /run/finish-explore (routes/run.ts), второй — /auth/login (routes/auth.ts),
// который закрывает брошенный забег как смерть и с этого момента тоже
// списывает выпитые зелья. Колонка объявлена `Json?`, схема её содержимое не
// проверяет ничем, так что второй валидатор и второй набор потолков,
// написанные рядом с первыми, разъехались бы с ними МОЛЧА — ровно тот отказ,
// который в этом проекте уже случался с анти-чит-потолком по зельям (см.
// CLAUDE.md, "Анти-чит-потолки ломаются молча при смене формы данных").
//
// Здесь же живут potionStockOf/potionStockToColumns: склад зелий существует в
// двух видах — снимок ПО ТИРАМ внутри currentRun и пять колонок Character, —
// и обоим эндпоинтам нужны оба. Держать их порознь значило бы развести
// соответствие "индекс массива ↔ номер колонки" по трём файлам.
import { MAX_SIPS_PER_RUN, POTION_TIER_COUNT, emptyPotionStock } from './potions.js'
import type { RunEvent } from './runEvents.js'

// Shape of the active run stored in Character.currentRun for the
// map-based Explore flow (POST /run/start-explore). `mode: 'explore'` is
// the tag that identifies this shape in the JSON field.
// `events` carries the FULL roll (trophyReward/isMimic included) — that part
// never leaves the server; the client only ever gets the stripped-down
// version built in /run/start-explore's response.
// `potions` — снимок склада ПО ТИРАМ на момент старта (длина POTION_TIER_COUNT,
// индекс = тир-1), `sips` — сколько глотков вообще разрешено за забег
// (MAX_SIPS_PER_RUN, но не больше суммы запаса). Раньше здесь был один скаляр,
// который смешивал две разные вещи: сколько есть и сколько можно выпить.
// `potionsDrunk` — выпитое за забег ПО ТИРАМ, пишет /run/sip по одному глотку.
// Склад (potionT1..T5) оно не трогает — списание одним пакетом в
// /run/finish-explore либо, у брошенного забега, в /auth/login. Необязательное:
// у забега без глотков и у забега, начатого до появления /run/sip, поля нет.
// Читать только через readRunPotionsDrunk.
export type ActiveExploreRun = { mode: 'explore'; mapFile: string; events: RunEvent[]; hp: number; maxHp: number; potions: number[]; sips: number; potionsDrunk?: number[] }

// Выпитое по тирам из currentRun. Поля нет — глотков не было: это честные нули,
// а не догадка. Поле есть, но не массив из POTION_TIER_COUNT неотрицательных
// целых — null: состояние испорчено, и вызывающий обязан сказать об этом
// громко, а не считать с нуля.
export function readRunPotionsDrunk(run: ActiveExploreRun): number[] | null {
  const raw: unknown = run.potionsDrunk
  if (raw === undefined) return emptyPotionStock()
  if (!Array.isArray(raw) || raw.length !== POTION_TIER_COUNT) return null
  if (!raw.every((n) => Number.isInteger(n) && (n as number) >= 0)) return null
  return [...(raw as number[])]
}

// Снимок склада ПО ТИРАМ, выданный на ЭТОТ забег. Пустой массив у забега с
// испорченным полем — потолок по каждому тиру тогда 0, то есть списать нельзя
// ничего: строгая сторона, как и везде в подсчёте выпитого.
export function runPotionStock(run: ActiveExploreRun): number[] {
  return Array.isArray(run.potions) ? run.potions : []
}

// Лимит глотков за ЭТОТ забег. Нецелое/отсутствующее — откат на общий
// MAX_SIPS_PER_RUN, тот же, что кладёт в забег /run/start-explore.
export function runSipsAllowed(run: ActiveExploreRun): number {
  return Number.isInteger(run.sips) ? run.sips : MAX_SIPS_PER_RUN
}

// Сколько зелий КАЖДОГО ТИРА разрешено списать за забег — два потолка подряд,
// поверх уже разобранного числа выпитого (мусор вызывающий обнуляет до входа
// сюда, см. readRunPotionsDrunk и разбор тела в /run/finish-explore).
//
// Потолок 1, ПО КАЖДОМУ ТИРУ: не больше, чем этот забег выдал (runStock —
// снимок из currentRun, не из тела запроса). Именно он не даёт списать выпитое
// дорогое как дешёвое: заявить T5 больше, чем на забег было выдано T5, нельзя.
//
// Потолок 2, ПО СУММЕ: не больше sipsAllowed глотков независимо от тиров.
// Излишек срезается с МЛАДШИХ тиров вверх (строгая сторона: дорогие списания
// сохраняются). Сюда попадают только враньё и ошибка счёта — ни то, ни другое
// не должно оборачиваться подарком.
//
// Чистая функция: ничего не логирует. Расхождение с тем, что просили списать,
// вызывающий замечает сравнением со своим входом и пишет в лог сам — контекст
// (кто, какой забег, откуда пришло число) у каждого свой.
export function clampPotionsSpent(drunk: number[], runStock: number[], sipsAllowed: number): number[] {
  const spent = drunk.map((n, i) => Math.min(n, runStock[i] ?? 0))

  let overflow = spent.reduce((sum, n) => sum + n, 0) - sipsAllowed
  for (let i = 0; i < POTION_TIER_COUNT && overflow > 0; i++) {
    const cut = Math.min(spent[i], overflow)
    spent[i] -= cut
    overflow -= cut
  }
  return spent
}

// Склад после списания. Никогда не в минус, даже если склад сдвинулся между
// стартом забега и списанием (например, покупка посреди забега).
export function subtractPotionStock(stock: number[], spent: number[]): number[] {
  return stock.map((n, i) => Math.max(0, n - (spent[i] ?? 0)))
}

// Склад зелий персонажа как массив по тирам (индекс = тир-1) и обратно в поля
// Prisma. Пять колонок вместо Json — цена за атомарные +1/-1 в общем update;
// эти две функции держат разложение в ОДНОМ месте, чтобы номера тиров не
// расползлись строковыми ключами по эндпоинтам.
export type PotionColumns = { potionT1: number; potionT2: number; potionT3: number; potionT4: number; potionT5: number }

export function potionStockOf(character: PotionColumns): number[] {
  return [character.potionT1, character.potionT2, character.potionT3, character.potionT4, character.potionT5]
}

export function potionStockToColumns(stock: number[]): PotionColumns {
  return {
    potionT1: stock[0],
    potionT2: stock[1],
    potionT3: stock[2],
    potionT4: stock[3],
    potionT5: stock[4],
  }
}
