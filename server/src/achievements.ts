// Достижения (20.11.2026, docs/achievements.md) — каталог условий и наград.
//
// ⚠️ ТОЛЬКО НА СЕРВЕРЕ, копии на клиенте НЕТ и быть не должно: все достижения
// тайные — игрок не видит ни списка, ни условий, ни прогресса. Клиент получает
// название, фразу, строку награды и иконку только у ПОЛУЧЕННЫХ (achievementView).
//
// Условия читают ТОЛЬКО летопись героя (HeroStats, уже с прибавкой этой
// вылазки) и факты одной вылазки — новых общих счётчиков здесь не заводится.
// Проверка и выдача — achievementState.ts, внутри settleExploreRun.
import type { ConsumableId } from './consumables.js'
import type { RuneKind } from './runes.js'

/** Летопись после прибавки этой вылазки — то, по чему меряются общие условия. */
export type AchievementStats = {
  runsTotal: number
  runsDied: number
  killsTotal: number
  killsElite: number
  bossesKilled: number
  chestsOpened: number
  breakablesBroken: number
  parries: number
  trapDeaths: number
}

/** Факты одной вылазки (settleExploreRun). */
export type AchievementRunFacts = {
  died: boolean
  /** Полученный урон по телу финиша (до потолков) — «ни царапины». */
  damageTaken: number
  /** Убито за вылазку — тем же счётом, что killsTotal летописи. */
  kills: number
  bossClosed: boolean
  /** Выпито за вылазку по записи /run/sip; null — запись испорчена (не засчитываем). */
  potionsDrunk: number | null
  /** Мимики среди закрытых сундуков (collectQuestRunFacts). */
  mimics: number
}

export type StatKey = 'strength' | 'agility' | 'endurance' | 'luck'

export type AchievementReward = {
  /** Предметы, занимающие ячейку сумки: подчиняются вместимости. */
  items?: { id: ConsumableId; count: number }[]
  bagCells?: number
  stats?: Partial<Record<StatKey, number>>
  patches?: number
  runes?: Partial<Record<RuneKind, number>>
}

export type AchievementSpec = {
  key: string
  title: string
  phrase: string
  /** Строка награды на карточке. */
  rewardLine: string
  /** Иконка печати (public/assets/icons). */
  icon: string
  reward: AchievementReward
  check: (s: AchievementStats, r: AchievementRunFacts) => boolean
}

export const ACHIEVEMENTS: readonly AchievementSpec[] = [
  {
    key: 'first_steps_1', title: 'Первый шаг за порог',
    phrase: 'Тьма выпустила тебя обратно. Возьми — пригодится в следующий раз.',
    rewardLine: 'Книга огня, Книга исцеления', icon: 'book_fire.png',
    reward: { items: [{ id: 'book_fire', count: 1 }, { id: 'book_heal', count: 1 }] },
    check: (s) => s.runsTotal >= 1,
  },
  {
    key: 'first_steps_2', title: 'Тропа знакома',
    phrase: 'Камни под ногами уже узнают твой шаг.',
    rewardLine: 'Книга льда, Книга крови', icon: 'book_ice.png',
    reward: { items: [{ id: 'book_ice', count: 1 }, { id: 'book_bleed', count: 1 }] },
    check: (s) => s.runsTotal >= 2,
  },
  {
    key: 'first_steps_3', title: 'Свой среди теней',
    phrase: 'Тени больше не шарахаются. Теперь шарахаются от тебя.',
    rewardLine: 'Книга Тарана, Книга Телекинеза', icon: 'book_dash.png',
    reward: { items: [{ id: 'book_dash', count: 1 }, { id: 'book_telekinesis', count: 1 }] },
    check: (s) => s.runsTotal >= 3,
  },
  {
    key: 'runs_10', title: 'Порог пройден',
    phrase: 'Десять раз во тьму — десять раз назад. Сумке стало тесно.',
    rewardLine: '+1 ячейка сумки', icon: 'nav_shop.png',
    reward: { bagCells: 1 },
    check: (s) => s.runsTotal >= 10,
  },
  {
    key: 'runs_100', title: 'Старожил тьмы',
    phrase: 'Сотня вылазок. Здесь уже не помнят, как было без тебя.',
    rewardLine: '+1 выносливость', icon: 'icon_hp.png',
    reward: { stats: { endurance: 1 } },
    check: (s) => s.runsTotal >= 100,
  },
  {
    key: 'deaths_25', title: 'Пепел не держит',
    phrase: 'Двадцать пять раз пеплом. Двадцать пять раз — снова на ногах.',
    rewardLine: '+1 удача', icon: 'icon_luck.png',
    reward: { stats: { luck: 1 } },
    check: (s) => s.runsDied >= 25,
  },
  {
    key: 'boss_1', title: 'Колокол умолк',
    phrase: 'Первый владыка пал. Его звон ещё долго будет стоять в ушах.',
    rewardLine: '2 нашивки', icon: 'event_boss.png',
    reward: { patches: 2 },
    check: (s) => s.bossesKilled >= 1,
  },
  {
    key: 'elite_50', title: 'Гроза отборных',
    phrase: 'Самые злые шли первыми. Теперь они обходят тебя стороной.',
    rewardLine: '+1 ловкость', icon: 'icon_elite_trophy.png',
    reward: { stats: { agility: 1 } },
    check: (s) => s.killsElite >= 50,
  },
  {
    key: 'kills_1000', title: 'Жнец',
    phrase: 'Тысяча. Ты сбился со счёта — тьма считает за тебя.',
    rewardLine: '+1 сила', icon: 'icon_strength.png',
    reward: { stats: { strength: 1 } },
    check: (s) => s.killsTotal >= 1000,
  },
  {
    key: 'parries_100', title: 'Звон стали',
    phrase: 'Сто раз сталь встретила сталь. Клинку нужен камень.',
    rewardLine: '3 Точильных камня', icon: 'whetstone.png',
    reward: { items: [{ id: 'whetstone', count: 3 }] },
    check: (s) => s.parries >= 100,
  },
  {
    key: 'bosses_25', title: 'Палач владык',
    phrase: 'Двадцать пять владык. Их руны теперь твои.',
    rewardLine: 'Руна атаки, Руна брони, Руна удачи', icon: 'rune_attack.png',
    // Склад runeAttack/runeArmor/runeLuck; *Found НЕ трогается — это лимит дропа.
    reward: { runes: { attack: 1, armor: 1, luck: 1 } },
    check: (s) => s.bossesKilled >= 25,
  },
  {
    key: 'chests_100', title: 'Расхититель',
    phrase: 'Сотый сундук. Замки здесь вешают уже от тебя.',
    rewardLine: '+1 ячейка сумки', icon: 'event_chest.png',
    reward: { bagCells: 1 },
    check: (s) => s.chestsOpened >= 100,
  },
  {
    key: 'breakables_300', title: 'Щепки и черепки',
    phrase: 'Ни одна бочка не ушла целой.',
    rewardLine: '3 Зелья отражения', icon: 'potion_reflect.png',
    reward: { items: [{ id: 'reflect_potion', count: 3 }] },
    check: (s) => s.breakablesBroken >= 300,
  },
  {
    key: 'no_hit', title: 'Ни царапины',
    phrase: 'Тьма не коснулась тебя ни разу. Она это запомнит.',
    rewardLine: 'Оберег от смерти', icon: 'charm_death.png',
    reward: { items: [{ id: 'charm_death', count: 1 }] },
    check: (_s, r) => !r.died && r.damageTaken === 0 && r.kills >= 10,
  },
  {
    key: 'dry_throat', title: 'Сухое горло',
    phrase: 'Владыка пал, а фляги полны.',
    rewardLine: '+1 удача', icon: 'potion_1_vial.png',
    reward: { stats: { luck: 1 } },
    check: (_s, r) => r.bossClosed && r.potionsDrunk === 0,
  },
  {
    key: 'greedy', title: 'Жадина',
    phrase: 'Три мимика за вылазку. Сундуки шепчутся о тебе.',
    rewardLine: '−1 удача', icon: 'event_chest.png',
    reward: { stats: { luck: -1 } },
    check: (_s, r) => r.mimics >= 3,
  },
  {
    key: 'trap_10', title: 'Сам себе враг',
    phrase: 'Шипы уже знают тебя по имени.',
    rewardLine: '+1 выносливость', icon: 'trap_saw.png',
    reward: { stats: { endurance: 1 } },
    check: (s) => s.trapDeaths >= 10,
  },
]

const BY_KEY = new Map(ACHIEVEMENTS.map((a) => [a.key, a]))

export function achievementByKey(key: string): AchievementSpec | null {
  return BY_KEY.get(key) ?? null
}

/** Название титула по ключу; неизвестный или null — без титула. */
export function achievementTitle(key: string | null | undefined): string | null {
  if (typeof key !== 'string') return null
  return BY_KEY.get(key)?.title ?? null
}

/** Сколько ячеек сумки займёт награда (предметы с takesCell — все такие). */
export function rewardCells(reward: AchievementReward): number {
  return (reward.items ?? []).reduce((sum, it) => sum + it.count, 0)
}

/** Новые достижения: условие выполнено, а у героя такого ещё нет. По порядку каталога. */
export function newAchievements(
  earned: ReadonlySet<string>,
  stats: AchievementStats,
  run: AchievementRunFacts,
): AchievementSpec[] {
  return ACHIEVEMENTS.filter((a) => !earned.has(a.key) && a.check(stats, run))
}

/** Вид полученного достижения для клиента (GET /achievements, финиш). */
export type AchievementView = {
  key: string
  title: string
  phrase: string
  reward: string
  icon: string
  earnedAt: string
  rewardPending: boolean
}

export function achievementView(row: { key: string; earnedAt: Date; rewardPending: boolean }): AchievementView | null {
  const spec = BY_KEY.get(row.key)
  if (!spec) return null
  return {
    key: spec.key,
    title: spec.title,
    phrase: spec.phrase,
    reward: spec.rewardLine,
    icon: spec.icon,
    earnedAt: row.earnedAt.toISOString(),
    rewardPending: row.rewardPending,
  }
}
