// Каталог классов героя — три ветки по две ступени (docs/classes.md), 20.10.2026.
//
// ⚠️ ЭТОТ ФАЙЛ СУЩЕСТВУЕТ В ДВУХ КОПИЯХ: src/heroClasses.ts (клиент) и
// server/src/heroClasses.ts (сервер). Общего пакета в проекте нет и завести его
// дёшево нельзя: tsconfig.app.json включает только "src", у сервера
// rootDir "./src" — импорт наружу не компилируется ни с одной стороны.
// Копии обязаны совпадать БАЙТ В БАЙТ, сверка — `python tools/check_potion_sync.py`
// (read-only, сравнивает sha256 всех известных пар), гонять ПЕРЕД деплоем
// сервера. Тот же приём и та же плата, что у src/classItems.ts и src/scrolls.ts.
//
// ⚠️ ИМПОРТОВ ЗДЕСЬ НЕТ И БЫТЬ НЕ МОЖЕТ — та же причина, что у classItems.ts:
// серверный ESM требует расширение в импорте, клиентский Vite — нет, и первая же
// общая строка импорта развела бы копии. Поэтому нужные навыки названы строками
// (id из equippedSkills), а имя книги для текста отказа передаёт вызывающий
// (shortfallLine): названия книг живут в каталоге расходников, и третий их
// экземпляр здесь разошёлся бы с ним молча.
//
// Что здесь есть и почему одним файлом на обе стороны:
//   • цены и пороги уровня — их показывает карточка у Отшельника и их же
//     проверяет сервер; одно число на двоих, как sellPrice у предметов классов;
//   • правила «чего не хватает» (chooseShortfalls / ascendShortfalls /
//     renounceShortfalls) и их тексты (shortfallLine) — сервер отказывает ровно
//     теми же строками, которыми клиент заранее гасит кнопку. Две копии правила
//     разошлись бы так, что кнопка горит, а сервер отказывает, или наоборот;
//   • тексты карточек — дословно из docs/classes.md, «Тексты карточек»;
//   • боевые числа ветки «Кровь» (26.10.2026, bloodClassEffects внизу) — по ним
//     лечит бой на клиенте, и из них же сервер выводит потолок полученного
//     урона (clampRunProgress): лечение Упыря даёт честно пропустить больше;
//   • боевые числа веток «Магия» и «Клинок» (26.10.2026, magicClassEffects и
//     bladeClassEffects внизу) — их читает только бой на клиенте; здесь они
//     затем, чтобы всё, что класс делает в бою, лежало одним местом рядом с
//     текстом его карточки. Строки effects ниже — по-прежнему только текст
//     карточки, ни один модуль боя их не читает.
//
// Чего здесь НЕТ намеренно:
//   • имён колонок БД (Character.classId / classTier) — раскладка на сервере,
//     в runState.ts (heroClassOf), рядом с книгами и страницами.
//
// Имя файла иконки — БЕЗ префикса пути, как в classItems.ts: путь добавляется на
// месте использования (`${import.meta.env.BASE_URL}assets/icons/`).

/**
 * id классов — по ветке, а не по ступени: ступень хранится отдельно (classTier),
 * а возвышение не меняет ветку («Чужую ветку на 30 не взять»). Рантайм-список
 * рядом с типом — по нему работает parseHeroClassId ниже.
 */
export const HERO_CLASS_IDS = ['ghoul', 'sorcerer', 'duelist'] as const
export type HeroClassId = typeof HERO_CLASS_IDS[number]

/** Ступень класса: 1 — выбранный класс, 2 — после возвышения. */
export type HeroClassTier = 1 | 2

/**
 * Класс героя. 'none' — класса нет (не выбран или снят отречением).
 *
 * На проводе (логин, профиль, три ручки класса) — null или {id, tier}: JSON-null
 * естественнее строки-заглушки, а 'none' внутри кода не путается с null клиента,
 * который значит «сервер не назвал» (см. readHeroClass в src/api.ts).
 */
export type HeroClassState = 'none' | { id: HeroClassId; tier: HeroClassTier }

/** Выбор класса: с какого уровня и сколько стоит (docs/classes.md, «Цена выбора»). */
export const CLASS_CHOOSE_LEVEL = 10
export const CLASS_CHOOSE_SHARDS = 5
export const CLASS_CHOOSE_GOLD = 2000

/** Возвышение до второй ступени своей ветки. Книги не важны. */
export const CLASS_ASCEND_LEVEL = 30
export const CLASS_ASCEND_SHARDS = 50
export const CLASS_ASCEND_GOLD = 15000

/** Одна ступень ветки — то, что видит игрок. */
export type HeroClassStage = {
  /** Именительный: «Упырь». */
  nameRu: string
  /** Винительный: «Выбрать Упыря?». У этих имён совпадает с родительным, но поле своё: подтверждение и отречение — разные вопросы. */
  nameAcc: string
  /** Родительный: «Отречься от Упыря?». */
  nameGen: string
  /** Творительный: «Ты стал Упырём». */
  nameIns: string
  /** Имя файла в public/assets/icons (128×128, как у предметов). */
  icon: string
  /** Красивое описание — курсивом в карточке. */
  desc: string
  /** Блок «что даёт». Только текст: эффектов в бою пока нет. */
  effects: string[]
}

export type HeroClass = {
  id: HeroClassId
  /**
   * Навыки, которые должны быть НАДЕТЫ в момент выбора — id из equippedSkills
   * (книга, надетая на навык, уходит со склада, и «надетая книга» в игре — это
   * надетый навык). Строки, а не SkillBookSkillId: импортов здесь нет. Сервер
   * сверяет их с каталогом расходников на рантайме и на расхождение отвечает
   * громким 500, а не молча выбранным классом.
   * После выбора книга не нужна: снял — класс остаётся (docs/classes.md).
   */
  requiredSkills: string[]
  /** [первая ступень, вторая]. */
  stages: [HeroClassStage, HeroClassStage]
}

/** Три ветки. Тексты — дословно из docs/classes.md, «Тексты карточек». */
export const HERO_CLASSES: HeroClass[] = [
  {
    id: 'ghoul',
    requiredSkills: ['slash'],
    stages: [
      {
        nameRu: 'Упырь',
        nameAcc: 'Упыря',
        nameGen: 'Упыря',
        nameIns: 'Упырём',
        icon: 'class_ghoul.png',
        desc: 'Обитель прокляла тебя жаждой. Чужая кровь затягивает твои раны быстрее любой молитвы.',
        effects: [
          'Кровотечение возвращает 50% своего урона здоровьем',
          'Кровавый клинок: удар мечом по кровоточащему врагу лечит на 10% урона',
        ],
      },
      {
        nameRu: 'Владыка крови',
        nameAcc: 'Владыку крови',
        nameGen: 'Владыки крови',
        nameIns: 'Владыкой крови',
        icon: 'class_blood_lord.png',
        desc: 'Кубок не пустеет, пока рядом бьётся хоть одно сердце.',
        effects: [
          'Плата кровью: нехватку маны покрывает здоровье, 5% за единицу',
          'Пир: убийство кровоточащего врага лечит на 5% здоровья',
        ],
      },
    ],
  },
  {
    id: 'sorcerer',
    requiredSkills: ['fireball', 'iceball'],
    stages: [
      {
        nameRu: 'Чародей',
        nameAcc: 'Чародея',
        nameGen: 'Чародея',
        nameIns: 'Чародеем',
        icon: 'class_sorcerer.png',
        desc: 'Пламя и лёд — две молитвы, которые обитель забыла. Ты помнишь обе.',
        effects: [
          'Огненный и ледяной шар: +15% урона',
          'Таяние: огненный шар по замороженному врагу бьёт вдвое и снимает заморозку',
        ],
      },
      {
        nameRu: 'Повелитель стихий',
        nameAcc: 'Повелителя стихий',
        nameGen: 'Повелителя стихий',
        nameIns: 'Повелителем стихий',
        icon: 'class_elementalist.png',
        desc: 'Посох помнит и жар, и стужу. Иногда сила приходит сама, не прося платы.',
        effects: [
          'Прилив: мана с врагов падает чаще — 75% вместо 50%',
          'С шансом 10% навык не тратит ману',
        ],
      },
    ],
  },
  {
    id: 'duelist',
    requiredSkills: ['dash'],
    stages: [
      {
        nameRu: 'Дуэлянт',
        nameAcc: 'Дуэлянта',
        nameGen: 'Дуэлянта',
        nameIns: 'Дуэлянтом',
        icon: 'class_duelist.png',
        desc: 'Один шаг — и ты уже у горла. Враг не успевает понять, откуда пришёл удар.',
        effects: [
          'Удар мечом: +15% урона',
          'Выпад: первый удар мечом в течение 1 с после рывка — критический (×2)',
        ],
      },
      {
        nameRu: 'Мастер клинка',
        nameAcc: 'Мастера клинка',
        nameGen: 'Мастера клинка',
        nameIns: 'Мастером клинка',
        icon: 'class_blademaster.png',
        desc: 'Обитель видела многих мечников. Ни один не уходил, оставив врага недобитым.',
        effects: [
          'Казнь: удар мечом по врагу ниже 15% здоровья убивает сразу (кроме босса)',
          'Острый глаз: любой удар мечом с шансом 10% критический (×2)',
        ],
      },
    ],
  },
]

/** Запись каталога по id, или null если id не из каталога. */
export function heroClassById(id: string): HeroClass | null {
  return HERO_CLASSES.find((c) => c.id === id) ?? null
}

/**
 * id класса из тела запроса или из ответа сервера, либо null — такого класса нет.
 * Приводить unknown из JSON к строке догадкой нельзя.
 */
export function parseHeroClassId(raw: unknown): HeroClassId | null {
  if (typeof raw !== 'string') return null
  return (HERO_CLASS_IDS as readonly string[]).includes(raw) ? (raw as HeroClassId) : null
}

/** Ступень из числа, либо null — такой ступени нет (0 — «класса нет» — тоже null). */
export function parseHeroClassTier(raw: unknown): HeroClassTier | null {
  return raw === 1 || raw === 2 ? raw : null
}

/** Ступень ветки: что показывать игроку на этой ступени. */
export function heroClassStage(cls: HeroClass, tier: HeroClassTier): HeroClassStage {
  return cls.stages[tier - 1]
}

/** Форма для провода: null — класса нет. */
export function heroClassToWire(state: HeroClassState): { id: HeroClassId; tier: HeroClassTier } | null {
  return state === 'none' ? null : { id: state.id, tier: state.tier }
}

/**
 * Разбор с провода. JSON-null — 'none' (класса нет); годный {id, tier} — класс;
 * всё остальное, ВКЛЮЧАЯ отсутствие поля, — null: «сервер не назвал», и это не
 * «класса нет» (тот же контракт, что у readClassItems в src/api.ts).
 */
export function parseHeroClassWire(raw: unknown): HeroClassState | null {
  if (raw === null) return 'none'
  if (typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const id = parseHeroClassId(record.id)
  const tier = parseHeroClassTier(record.tier)
  return id === null || tier === null ? null : { id, tier }
}

// --- Чего не хватает: одно правило на клиент и сервер ---

/** Всё, от чего зависят три действия. Уровень — по серверной формуле (calculateLevel). */
export type HeroClassWallet = {
  level: number
  gold: number
  soulShards: number
  renounceSeals: number
  equippedSkills: readonly string[]
  heroClass: HeroClassState
}

/**
 * Одна причина отказа. Размеченный union, а не готовая строка: сервер отдаёт и
 * коды (их проверяет сценарий), и строки (их видит игрок, shortfallLine).
 */
export type ClassShortfall =
  | { kind: 'class-chosen' }
  | { kind: 'no-class' }
  | { kind: 'not-your-class' }
  | { kind: 'already-ascended' }
  | { kind: 'level'; need: number }
  | { kind: 'skill'; skillId: string }
  | { kind: 'shards'; need: number; have: number }
  | { kind: 'gold'; need: number; have: number }
  | { kind: 'seal' }

/**
 * Выбор класса: уровень 10+, класса нет, 5 Осколков души, 2000 золота, надеты
 * нужные навыки. Пустой список — можно. Порядок причин фиксированный: так их и
 * читает игрок под серой кнопкой.
 */
export function chooseShortfalls(w: HeroClassWallet, cls: HeroClass): ClassShortfall[] {
  const out: ClassShortfall[] = []
  if (w.heroClass !== 'none') out.push({ kind: 'class-chosen' })
  if (w.level < CLASS_CHOOSE_LEVEL) out.push({ kind: 'level', need: CLASS_CHOOSE_LEVEL })
  for (const skillId of cls.requiredSkills) {
    if (!w.equippedSkills.includes(skillId)) out.push({ kind: 'skill', skillId })
  }
  if (w.soulShards < CLASS_CHOOSE_SHARDS) out.push({ kind: 'shards', need: CLASS_CHOOSE_SHARDS, have: w.soulShards })
  if (w.gold < CLASS_CHOOSE_GOLD) out.push({ kind: 'gold', need: CLASS_CHOOSE_GOLD, have: w.gold })
  return out
}

/**
 * Возвышение: свой класс на первой ступени, уровень 30+, 50 Осколков души, 15000
 * золота. Книги не важны. Не тот класс — дальше не проверяем: остальное к нему
 * не относится.
 */
export function ascendShortfalls(w: HeroClassWallet, cls: HeroClass): ClassShortfall[] {
  if (w.heroClass === 'none') return [{ kind: 'no-class' }]
  if (w.heroClass.id !== cls.id) return [{ kind: 'not-your-class' }]
  if (w.heroClass.tier >= 2) return [{ kind: 'already-ascended' }]
  const out: ClassShortfall[] = []
  if (w.level < CLASS_ASCEND_LEVEL) out.push({ kind: 'level', need: CLASS_ASCEND_LEVEL })
  if (w.soulShards < CLASS_ASCEND_SHARDS) out.push({ kind: 'shards', need: CLASS_ASCEND_SHARDS, have: w.soulShards })
  if (w.gold < CLASS_ASCEND_GOLD) out.push({ kind: 'gold', need: CLASS_ASCEND_GOLD, have: w.gold })
  return out
}

/** Отречение: свой класс (любая ступень) и хотя бы одна Печать отречения. */
export function renounceShortfalls(w: HeroClassWallet, cls: HeroClass): ClassShortfall[] {
  if (w.heroClass === 'none') return [{ kind: 'no-class' }]
  if (w.heroClass.id !== cls.id) return [{ kind: 'not-your-class' }]
  return w.renounceSeals >= 1 ? [] : [{ kind: 'seal' }]
}

// «Не хватает 1 Осколка» / «Не хватает 3 Осколков»: после «не хватает» всё в
// родительном, единственное число — только у 1, 21, 31… (но не у 11).
function shardsWord(n: number): string {
  return n % 10 === 1 && n % 100 !== 11 ? 'Осколка души' : 'Осколков души'
}

/**
 * Причина отказа словами игрока — одна строка на причину.
 * `bookName` — имя книги по id навыка из каталога расходников вызывающего (здесь
 * импортов нет, см. шапку).
 */
export function shortfallLine(s: ClassShortfall, bookName: (skillId: string) => string): string {
  switch (s.kind) {
    case 'class-chosen': return 'Класс уже выбран'
    case 'no-class': return 'Класс не выбран'
    case 'not-your-class': return 'Это не твой класс'
    case 'already-ascended': return 'Возвышение уже получено'
    case 'level': return `Нужен ${s.need} уровень`
    case 'skill': return `Нужна надетая ${bookName(s.skillId)}`
    case 'shards': {
      const lack = s.need - s.have
      return `Не хватает ${lack} ${shardsWord(lack)}`
    }
    case 'gold': return `Не хватает ${s.need - s.have} золота`
    case 'seal': return 'Нет Печати отречения'
  }
}

// --- Боевые числа ветки «Кровь» (26.10.2026) ---
//
// Здесь, а не в constants.ts клиента: из этих же чисел сервер выводит потолок
// полученного урона за забег (clampRunProgress в server/src/runState.ts) —
// лечение Упыря позволяет честно пропустить больше урона. Две копии числа
// разошлись бы так, что клиент лечит больше, чем допускает сервер, и потолок
// молча срезал бы честному Упырю рост выносливости.

/** Упырь: тик кровотечения возвращает здоровьем эту долю нанесённого им урона. */
export const GHOUL_BLEED_HEAL_FRAC = 0.5
/** Упырь, Кровавый клинок: удар мечом по кровоточащему врагу лечит на эту долю нанесённого урона. */
export const GHOUL_BLADE_HEAL_FRAC = 0.1
/** Владыка крови, Плата кровью: единица НЕДОСТАЮЩЕЙ маны стоит эту долю МАКСИМАЛЬНОГО HP. */
export const BLOOD_LORD_MANA_HP_FRAC = 0.05
/** Владыка крови, Пир: убийство кровоточащего врага (и босса) лечит на эту долю МАКСИМАЛЬНОГО HP. */
export const BLOOD_LORD_FEAST_HEAL_FRAC = 0.05

/**
 * Что из ветки «Кровь» действует у героя с этим классом. Доли, 0 — механики
 * нет: без класса и у Чародея с Дуэлянтом все четыре нули, и бой идёт ровно
 * как без классов. Владыка крови — вторая ступень Упыря: у него всё от первой
 * плюс своё (docs/classes.md, «Вторая ступень сохраняет всё с первой»).
 */
export type BloodClassEffects = {
  bleedHealFrac: number
  bladeHealFrac: number
  manaHpFrac: number
  feastHealFrac: number
}

export function bloodClassEffects(state: HeroClassState): BloodClassEffects {
  const ghoul = state !== 'none' && state.id === 'ghoul'
  const lord = state !== 'none' && state.id === 'ghoul' && state.tier === 2
  return {
    bleedHealFrac: ghoul ? GHOUL_BLEED_HEAL_FRAC : 0,
    bladeHealFrac: ghoul ? GHOUL_BLADE_HEAL_FRAC : 0,
    manaHpFrac: lord ? BLOOD_LORD_MANA_HP_FRAC : 0,
    feastHealFrac: lord ? BLOOD_LORD_FEAST_HEAL_FRAC : 0,
  }
}

// --- Боевые числа ветки «Магия» (26.10.2026) ---
//
// Сервер их НЕ читает, и запаса в потолках под них нет — не нужен. Потолок
// нанесённого урона (clampRunProgress) — суммарное HP врагов забега, а клиент
// копит урон, обрезанный остатком HP цели: множитель урона даёт добить врага
// быстрее, но не нанести больше его HP. Мана на сервер не ходит вовсе.

/** Чародей: урон огненного и ледяного шара умножается на это число. */
export const SORCERER_PROJECTILE_DAMAGE_MULT = 1.15
/** Чародей, Таяние: огненный шар по ЗАМОРОЖЕННОЙ цели бьёт во столько раз сильнее и снимает заморозку. */
export const SORCERER_MELT_MULT = 2
/** Повелитель стихий, Прилив: шанс, что с убитого врага выпадет мана (вместо общего). */
export const ELEMENTALIST_MANA_DROP_CHANCE = 0.75
/** Повелитель стихий: шанс, что применение ЛЮБОГО навыка не потратит ману. */
export const ELEMENTALIST_FREE_SKILL_CHANCE = 0.1

/**
 * Что из ветки «Магия» действует у героя с этим классом. Без класса и у других
 * веток — нейтральные значения, и бой идёт ровно как без классов:
 * множитель 1, Таяния нет (0), шанс маны общий (null — его знает только
 * клиент, MANA_DROP_CHANCE в constants.ts), бесплатных навыков нет (0).
 * Повелитель стихий — вторая ступень Чародея: у него всё от первой плюс своё.
 */
export type MagicClassEffects = {
  projectileDamageMult: number
  meltMult: number
  manaDropChance: number | null
  freeSkillChance: number
}

export function magicClassEffects(state: HeroClassState): MagicClassEffects {
  const sorcerer = state !== 'none' && state.id === 'sorcerer'
  const elementalist = state !== 'none' && state.id === 'sorcerer' && state.tier === 2
  return {
    projectileDamageMult: sorcerer ? SORCERER_PROJECTILE_DAMAGE_MULT : 1,
    meltMult: sorcerer ? SORCERER_MELT_MULT : 0,
    manaDropChance: elementalist ? ELEMENTALIST_MANA_DROP_CHANCE : null,
    freeSkillChance: elementalist ? ELEMENTALIST_FREE_SKILL_CHANCE : 0,
  }
}

// --- Боевые числа ветки «Клинок» (26.10.2026) ---
//
// Сервер их тоже НЕ читает, и по той же причине, что у Магии: +15%, крит и
// Казнь меняют, как быстро снимается HP врага, но не сколько его можно снять —
// клиент копит урон, обрезанный остатком HP цели. Лечения у Клинка нет.

/** Дуэлянт: урон ОБЫЧНОЙ атаки мечом умножается на это число. Рывок и навыки — нет. */
export const DUELIST_SWORD_DAMAGE_MULT = 1.15
/** Дуэлянт, Выпад: окно после рывка, мс; первый взмах мечом в нём — критический. */
export const DUELIST_LUNGE_WINDOW_MS = 1000
/** Критический удар мечом (Выпад, Острый глаз) бьёт во столько раз сильнее. Не складывается: оба сразу — тот же ×2. */
export const BLADE_CRIT_MULT = 2
/** Мастер клинка, Казнь: удар мечом по врагу, у которого HP НИЖЕ этой доли максимума, убивает сразу. На боссе не работает. */
export const BLADEMASTER_EXECUTE_HP_FRAC = 0.15
/** Мастер клинка, Острый глаз: шанс, что удар мечом критический. */
export const BLADEMASTER_CRIT_CHANCE = 0.1

/**
 * Что из ветки «Клинок» действует у героя с этим классом. Без класса и у других
 * веток — нейтральные значения, и бой идёт ровно как без классов: множитель 1,
 * окна Выпада нет (0), крит ничего не множит (1), Казни нет (0), шанса крита
 * нет (0). Мастер клинка — вторая ступень Дуэлянта: у него всё от первой плюс
 * своё. Удар в поднятую дверь Привратника не получает ни крита, ни Казни —
 * это правило боя (docs/classes.md, «Общие правила»), чисел у него нет.
 */
export type BladeClassEffects = {
  swordDamageMult: number
  lungeWindowMs: number
  critMult: number
  executeHpFrac: number
  critChance: number
}

export function bladeClassEffects(state: HeroClassState): BladeClassEffects {
  const duelist = state !== 'none' && state.id === 'duelist'
  const master = state !== 'none' && state.id === 'duelist' && state.tier === 2
  return {
    swordDamageMult: duelist ? DUELIST_SWORD_DAMAGE_MULT : 1,
    lungeWindowMs: duelist ? DUELIST_LUNGE_WINDOW_MS : 0,
    critMult: duelist ? BLADE_CRIT_MULT : 1,
    executeHpFrac: master ? BLADEMASTER_EXECUTE_HP_FRAC : 0,
    critChance: master ? BLADEMASTER_CRIT_CHANCE : 0,
  }
}
