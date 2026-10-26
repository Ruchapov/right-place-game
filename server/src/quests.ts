// Каталог ежедневных заданий (docs/daily-quests.md), 26.10.2026.
//
// ⚠️ ЭТОТ ФАЙЛ СУЩЕСТВУЕТ В ДВУХ КОПИЯХ: src/quests.ts (клиент) и
// server/src/quests.ts (сервер). Общего пакета в проекте нет и завести его
// дёшево нельзя: tsconfig.app.json включает только "src", у сервера
// rootDir "./src" — импорт наружу не компилируется ни с одной стороны.
// Копии обязаны совпадать БАЙТ В БАЙТ, сверка — `python tools/check_potion_sync.py`
// (read-only, сравнивает sha256 всех известных пар), гонять ПЕРЕД деплоем
// сервера. Тот же приём и та же плата, что у src/heroClasses.ts.
//
// ⚠️ ИМПОРТОВ ЗДЕСЬ НЕТ И БЫТЬ НЕ МОЖЕТ — та же причина, что у heroClasses.ts:
// серверный ESM требует расширение в импорте, клиентский Vite — нет, и первая же
// общая строка импорта развела бы копии. Поэтому навыки названы строками (id из
// equippedSkills), а не типом каталога расходников.
//
// Что здесь есть и почему одним файлом на обе стороны:
//   • пороги и размеры — с какого уровня открываются задания, сколько их в
//     наборе, сколько живёт набор; их показывает доска и их же держит сервер;
//   • награда — её доска пишет на каждом задании, и её же начисляет финиш забега;
//     одна формула на двоих, как цена у предметов классов;
//   • сами задания — названия и описания дословно из задачи Андрея, цель, доля
//     награды, что считается прогрессом (metric) и при каком надетом навыке
//     задание вообще может выпасть (requirement).
//
// Чего здесь НЕТ намеренно:
//   • состояния заданий героя и его правил (набор, замена, таймер) — это
//     server/src/questState.ts: клиенту оно приходит готовым видом;
//   • подсчёта прогресса по забегу — его делает только сервер на финише, из
//     своего currentRun и счётчиков тела (questDelta в questState.ts).

/** С какого уровня у героя есть набор заданий. До него набора нет вовсе. */
export const QUEST_UNLOCK_LEVEL = 5

/** Сколько разных заданий в наборе. */
export const QUEST_SET_SIZE = 3

/**
 * Сколько живёт набор: 8 часов от того, как взято ПЕРВОЕ задание набора. Пока ни
 * одно не взято, таймер не идёт. Истёк — при ближайшем обращении приходит новый
 * набор (без крона, лениво).
 */
export const QUEST_SET_MS = 8 * 60 * 60 * 1000

/** Награда = ceil(QUEST_REWARD_LEVEL_MULT × уровень × процент / 100) — золота и значков поровну. */
export const QUEST_REWARD_LEVEL_MULT = 2

/** Сколько RP даёт любое выполненное задание. */
export const QUEST_RP_REWARD = 1

/** «Быстрые ноги»: вылазка короче этого — от подтверждения до финиша, по часам сервера. */
export const QUEST_FAST_RUN_MS = 3 * 60 * 1000

/**
 * Навыки, которые НЕ считаются атакующими: их применения не идут в «Книжную
 * мудрость», и одного такого навыка мало, чтобы она выпала. Исцеление врагов не
 * поражает.
 */
export const QUEST_NON_ATTACK_SKILLS: readonly string[] = ['heal']

/**
 * id заданий. Рантайм-список рядом с типом — по нему работает parseQuestId.
 * Порядок — порядок таблицы задачи; на розыгрыш он не влияет.
 */
export const QUEST_IDS = [
  'sortie',
  'no_sip',
  'bell_silence',
  'torn_doors',
  'beast_slayer',
  'steel_ring',
  'book_wisdom',
  'others_goods',
  'four_fires',
  'full_cup',
  'steel_only',
  'swift_feet',
  'drain',
  'greed',
  'quiet_step',
] as const
export type QuestId = typeof QUEST_IDS[number]

/**
 * Что считается прогрессом. Считает только сервер, на финише живой вылазки
 * (died = false), по своему currentRun и по счётчикам тела финиша:
 *   runs             — +1 за вылазку;
 *   runNoPotion      — +1, если за вылазку не выпито ни одного зелья (по записи
 *                      /run/sip в currentRun.potionsDrunk, не со слов клиента);
 *   beastGroups / zvonarGroups / gatekeeperGroups — закрытые группы этого вида;
 *   parries          — успешные парирования (счётчик тела `parries`);
 *   skillHits        — результативные применения навыков, кроме
 *                      QUEST_NON_ATTACK_SKILLS (тот же skillUses, что растит уровни);
 *   chests           — закрытые сундуки, мимик тоже;
 *   mimics           — закрытые сундуки-мимики;
 *   obelisks         — закрытые события обелиска;
 *   manaCollected    — мана, долетевшая до героя, даже при полном запасе (`manaCollected`);
 *   manaSpent        — мана, снятая с запаса навыками (`manaSpent`);
 *   runNoSkills      — +1, если за вылазку ни одного применения навыка
 *                      (`skillCasts` — все применения, и исцеление, и бесплатные);
 *   runNoSpikes      — +1, если ни одного попадания на шипы карты (`spikeHits`);
 *   fastRun          — +1, если вылазка короче QUEST_FAST_RUN_MS.
 * Счётчика тела нет (старый клиент) — «неизвестно», а не ноль: задание на нём не
 * продвигается.
 */
export type QuestMetric =
  | 'runs'
  | 'runNoPotion'
  | 'beastGroups'
  | 'zvonarGroups'
  | 'gatekeeperGroups'
  | 'parries'
  | 'skillHits'
  | 'chests'
  | 'mimics'
  | 'obelisks'
  | 'manaCollected'
  | 'manaSpent'
  | 'runNoSkills'
  | 'runNoSpikes'
  | 'fastRun'

/**
 * При каком снаряжении задание может выпасть. Проверяется в момент броска
 * (новый набор, замена), а не потом: снять навык после того, как задание
 * выпало, его не убирает.
 *   none        — всегда;
 *   attackSkill — надет хотя бы один навык не из QUEST_NON_ATTACK_SKILLS;
 *   anySkill    — надет хотя бы один навык.
 */
export type QuestRequirement = 'none' | 'attackSkill' | 'anySkill'

export type Quest = {
  id: QuestId
  nameRu: string
  /** Текст для игрока — дословно из задачи. */
  descriptionRu: string
  /** Доля награды в процентах (см. questReward). */
  percent: number
  /** Сколько единиц metric нужно набрать. */
  goal: number
  metric: QuestMetric
  requirement: QuestRequirement
}

export const QUESTS: Quest[] = [
  { id: 'sortie', nameRu: 'Вылазка', descriptionRu: 'Заверши 3 вылазки.', percent: 140, goal: 3, metric: 'runs', requirement: 'none' },
  { id: 'no_sip', nameRu: 'Без глотка', descriptionRu: 'Заверши вылазку без зелья.', percent: 125, goal: 1, metric: 'runNoPotion', requirement: 'none' },
  { id: 'bell_silence', nameRu: 'Тишина на колокольне', descriptionRu: 'Перебей группу Звонарей.', percent: 130, goal: 1, metric: 'zvonarGroups', requirement: 'none' },
  { id: 'torn_doors', nameRu: 'Сорванные двери', descriptionRu: 'Перебей группу Привратников.', percent: 130, goal: 1, metric: 'gatekeeperGroups', requirement: 'none' },
  { id: 'beast_slayer', nameRu: 'Зверобой', descriptionRu: 'Перебей группу зверей.', percent: 80, goal: 1, metric: 'beastGroups', requirement: 'none' },
  { id: 'steel_ring', nameRu: 'Звон стали', descriptionRu: 'Отрази 5 ударов парированием.', percent: 90, goal: 5, metric: 'parries', requirement: 'none' },
  { id: 'book_wisdom', nameRu: 'Книжная мудрость', descriptionRu: 'Порази врагов навыками 15 раз.', percent: 110, goal: 15, metric: 'skillHits', requirement: 'attackSkill' },
  { id: 'others_goods', nameRu: 'Чужое добро', descriptionRu: 'Открой 3 сундука.', percent: 110, goal: 3, metric: 'chests', requirement: 'none' },
  { id: 'four_fires', nameRu: 'Четыре огня', descriptionRu: 'Пройди испытание обелисков.', percent: 160, goal: 1, metric: 'obelisks', requirement: 'none' },
  { id: 'full_cup', nameRu: 'Полная чаша', descriptionRu: 'Собери 15 маны с врагов.', percent: 135, goal: 15, metric: 'manaCollected', requirement: 'none' },
  { id: 'steel_only', nameRu: 'Только сталь', descriptionRu: 'Заверши вылазку без навыков.', percent: 150, goal: 1, metric: 'runNoSkills', requirement: 'anySkill' },
  { id: 'swift_feet', nameRu: 'Быстрые ноги', descriptionRu: 'Пройди вылазку быстрее чем за 3 минуты.', percent: 170, goal: 1, metric: 'fastRun', requirement: 'none' },
  // anySkill — решение сессии 26.10.2026, в задаче требования не было: без
  // надетого навыка ману тратить нечем, и задание было бы невыполнимым.
  { id: 'drain', nameRu: 'Иссушение', descriptionRu: 'Потрать 20 маны.', percent: 100, goal: 20, metric: 'manaSpent', requirement: 'anySkill' },
  { id: 'greed', nameRu: 'Жадность губит', descriptionRu: 'Открой сундук с ловушкой.', percent: 100, goal: 1, metric: 'mimics', requirement: 'none' },
  { id: 'quiet_step', nameRu: 'Тихий шаг', descriptionRu: 'Пройди вылазку, ни разу не наступив на шипы.', percent: 150, goal: 1, metric: 'runNoSpikes', requirement: 'none' },
]

export function questById(id: string): Quest | null {
  return QUESTS.find((q) => q.id === id) ?? null
}

/** id задания из присланного извне (тело запроса, questState) или null. */
export function parseQuestId(raw: unknown): QuestId | null {
  return typeof raw === 'string' && (QUEST_IDS as readonly string[]).includes(raw) ? raw as QuestId : null
}

export type QuestReward = { gold: number; hunterBadges: number; rp: number }

/**
 * Награда за задание на уровне героя `level`: золота и значков охотника поровну,
 * ceil(2 × уровень × процент / 100), плюс QUEST_RP_REWARD. Уровень — серверный,
 * calculateLevel; ceil — награда не теряет дробь.
 */
export function questReward(quest: Quest, level: number): QuestReward {
  const amount = Math.ceil((QUEST_REWARD_LEVEL_MULT * level * quest.percent) / 100)
  return { gold: amount, hunterBadges: amount, rp: QUEST_RP_REWARD }
}

/** Может ли задание выпасть герою с такими надетыми навыками (см. QuestRequirement). */
export function questAvailable(quest: Quest, equippedSkills: readonly string[]): boolean {
  switch (quest.requirement) {
    case 'none': return true
    case 'attackSkill': return equippedSkills.some((s) => !QUEST_NON_ATTACK_SKILLS.includes(s))
    case 'anySkill': return equippedSkills.length > 0
  }
}
