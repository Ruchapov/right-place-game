// ОБУЧЕНИЕ (08.11.2026) — каталог подсказок и флаги «показано».
//
// Четыре вида подсказок, все — одна карточка (src/ui/TutorialCard.tsx):
//   • INTRO_CARDS — пять листаемых карточек первого захода (игрок 1–2 уровня);
//     заново — кнопка «Как играть» на «Персонаже»;
//   • RUN_TIPS — при первом появлении в забеге (Explore.tsx, игра на паузе);
//   • LEVEL_TIPS — в меню, когда уровень дорос (после загрузки игрока);
//   • ITEM_TIPS — первый предмет такого вида в сумке.
// Уровни — из констант каталогов, а не числами: поменяют порог — подсказка
// придёт на новом уровне сама.
//
// ХРАНЕНИЕ. Ключи tut_seen (JSON — список id показанного) и tut_level
// (lastSeenLevel — до какого уровня подсказки по уровню уже прошли). Облако
// Telegram: Telegram.WebApp.CloudStorage, если скрипт Telegram есть на странице
// (проект его не грузит), иначе то же хранилище через @telegram-apps/sdk.
// Запасной вариант и кэш — localStorage с userId в ключе. Всё в try/catch: не
// загрузилось ни облако, ни localStorage — подсказок нет вовсе (hasSeen
// отвечает «показано»), а не показ их на каждом заходе.
//
// lastSeenLevel НЕТ (первый запуск фичи у этого игрока) — пишется текущий
// уровень, и старые подсказки по уровню старым игрокам не показываются; то же
// с подсказками о предметах, которые у игрока уже есть (App.tsx).

import { cloudStorage } from '@telegram-apps/sdk'
import { QUEST_UNLOCK_LEVEL } from './quests'
import { CLASS_CHOOSE_LEVEL, CLASS_ASCEND_LEVEL } from './heroClasses'
import { CRAFTER_LEVEL } from './crafter'
import { POTION_TIERS, MAX_SIPS_PER_RUN } from './potions'
import { GATEKEEPER_MIN_LEVEL } from './runExtras'
import { RUNE_DROP_MIN_LEVEL } from './runes'

export type TutorialTip = {
  id: string
  title: string
  text: string
  /** Имя файла в public/assets/icons, без BASE_URL; нет — карточка без картинки. */
  icon?: string
}

/** Интро — карточки по очереди, «Дальше» и «Пропустить». */
export const INTRO_ID = 'intro'
export const INTRO_CARDS: TutorialTip[] = [
  {
    id: 'intro_controls',
    title: 'Управление',
    text: 'Слева — бег, справа — удар и прыжок.\nДержи прыжок дольше — взлетишь выше.',
    icon: 'btn_jump.png',
  },
  {
    id: 'intro_goal',
    title: 'Вылазка',
    text: 'Каждый раз — новое место и новые твари.\nСделал дело — уходи сам, пока цел.',
    icon: 'event_enemy.png',
  },
  {
    id: 'intro_potions',
    title: 'Фляга',
    text: `Во фляге хватит на ${MAX_SIPS_PER_RUN} глотка.\nБереги их: погибнешь — вся добыча останется там.`,
    icon: 'potion_1_vial.png',
  },
  {
    id: 'intro_growth',
    title: 'Ты растёшь',
    text: 'Бьёшь — крепнет рука. Терпишь удары — крепнет тело.\nМир заметит это и откроет новое.',
    icon: 'icon_level.png',
  },
  {
    id: 'intro_menu',
    title: 'Убежище',
    text: 'Здесь тихо. Пока.\nВсё, что принесёшь из вылазок, сделает тебя сильнее.',
    icon: 'nav_shop.png',
  },
]

/**
 * Подсказки при первом появлении в забеге. Ключ — то, что заметил тикер.
 * Босс — по виду (bossKind, 11.11.2026). Прежняя общая run_boss больше не
 * показывается; кто её видел, тому подсказка Твари считается показанной
 * (runTipSeen).
 */
export type RunTipId =
  | 'run_zvonar' | 'run_gatekeeper' | 'run_elite' | 'run_patrol' | 'run_chest'
  | 'run_obelisk' | 'run_smuggler' | 'run_starbloom' | 'run_flame' | 'run_runner'
  | 'run_fencer' | 'run_gravedigger' | 'run_crossbowman' | 'run_stoker' | 'run_beetle'
  | 'run_shadow' | 'run_noticed'
  | 'run_gargoyle' | 'run_stalactite' | 'run_saw'
  | 'run_boss_werewolf' | 'run_boss_abbot' | 'run_boss_serpent' | 'run_boss_crowking'
export const RUN_TIPS: Record<RunTipId, TutorialTip> = {
  run_zvonar: { id: 'run_zvonar', title: 'Звонарь', text: 'Его звон слышно раньше, чем видно.\nВолна летит далеко — перепрыгни её.', icon: 'event_enemy.png' },
  run_gatekeeper: { id: 'run_gatekeeper', title: 'Привратник', text: 'Дверь вместо щита, и он умеет ею пользоваться.\nЗайди со спины — там он открыт.', icon: 'event_enemy.png' },
  run_elite: { id: 'run_elite', title: 'Отмеченный', text: 'Светится не зря: вдвое крепче и бьёт больнее.\nЗато и добыча с него богаче.', icon: 'icon_elite_trophy.png' },
  run_patrol: { id: 'run_patrol', title: 'Бродяга', text: 'Ходит сам по себе. Можно обойти.\nМожно и не обходить.', icon: 'event_enemy.png' },
  run_chest: { id: 'run_chest', title: 'Сундук', text: 'Не всё, что заперто, хочет, чтобы его открыли.\nИногда сундук кусается.', icon: 'event_chest.png' },
  run_obelisk: { id: 'run_obelisk', title: 'Обелиски', text: 'Разбуди один камень — и успей зажечь остальные,\nпока они не уснули снова.', icon: 'map_obelisk.png' },
  run_smuggler: { id: 'run_smuggler', title: 'Контрабандист', text: 'Любит сделки и не любит проигрывать.\nРискни трофеями — или пройди мимо.', icon: 'event_smuggler.png' },
  run_flame: { id: 'run_flame', title: 'Носитель огня', text: 'Возьми огонь из жаровни и донеси до пустой чаши.\nПропустишь удар — огонь погаснет.', icon: 'event_flame.png' },
  run_runner: { id: 'run_runner', title: 'Беглец', text: 'Заметит — побежит, и не сражается.\nТри удара, пока он не скрылся.', icon: 'event_runner.png' },
  run_starbloom: { id: 'run_starbloom', title: 'Звёздоцвет', text: 'Цветок, которому здесь не место.\nСрежь его — Мастер знает, что делать с пыльцой.', icon: 'item_star_pollen.png' },
  run_fencer: { id: 'run_fencer', title: 'Безликий фехтовальщик', text: 'Он ждёт, когда ты начнёшь махать мечом без остановки.\nБей реже — и точнее.', icon: 'event_enemy.png' },
  run_gravedigger: { id: 'run_gravedigger', title: 'Гробокопатель', text: 'Издалека швыряет землёй, вблизи бьёт лопатой.\nНе стой там, куда летит ком.', icon: 'event_enemy.png' },
  run_crossbowman: { id: 'run_crossbowman', title: 'Арбалетчик', text: 'Один точный выстрел — и долгая перезарядка.\nБеги к нему, пока он возится с болтом.', icon: 'event_enemy.png' },
  run_stoker: { id: 'run_stoker', title: 'Кочегар', text: 'Кочерга раскалена докрасна.\nЗацепит — будешь гореть, и броня не спасёт.', icon: 'event_enemy.png' },
  run_beetle: { id: 'run_beetle', title: 'Навозник', text: 'Кидается грязью. Попадёт — ноги станут тяжёлыми.\nДержись подальше от его комьев.', icon: 'event_enemy.png' },
  run_shadow: { id: 'run_shadow', title: 'Тень', text: 'Из сундука поднялся ты сам — только темнее.\nОна бьёт как ты. Победишь — сундук отдаст больше.', icon: 'event_chest.png' },
  // Ловушки (13.11.2026, entities/traps.ts).
  run_gargoyle: { id: 'run_gargoyle', title: 'Горгулья', text: 'Наступишь на плиту — из пасти полетит огонь.\nОтбей его или перепрыгни. Враги тоже горят.', icon: 'trap_gargoyle.png' },
  run_stalactite: { id: 'run_stalactite', title: 'Сталактит', text: 'Задрожал — значит, сейчас упадёт.\nУбеги из-под него или подведи туда врага.', icon: 'trap_stalactite.png' },
  run_saw: { id: 'run_saw', title: 'Пила', text: 'Диск ездит по рельсу туда-сюда.\nПерепрыгни его — или затолкай туда врага.', icon: 'trap_saw.png' },
  run_noticed: { id: 'run_noticed', title: 'Тебя заметили', text: 'Твари смотрят только вперёд и сквозь стены не видят.\nЗайди со спины — ударишь первым.', icon: 'event_enemy.png' },
  run_boss_werewolf: { id: 'run_boss_werewolf', title: 'Тварь', text: 'Следи за замахом.\nОтбитый удар собьёт его с ног.', icon: 'event_boss.png' },
  run_boss_abbot: { id: 'run_boss_abbot', title: 'Настоятель', text: 'Он не дерётся один.\nНе дай его свите окружить тебя.', icon: 'event_boss.png' },
  run_boss_serpent: { id: 'run_boss_serpent', title: 'Костяной Змей', text: 'Уходит под землю и всплывает там, где не ждёшь.\nТрещины в полу — беги. Раненый, он звереет.', icon: 'event_boss.png' },
  run_boss_crowking: { id: 'run_boss_crowking', title: 'Вороний Король', text: 'Рассыпается стаей и собирается у тебя за спиной.\nНе стой на месте.', icon: 'event_boss.png' },
}

/** Показана ли подсказка забега. Тварь — ещё и по прежней общей run_boss (до 11.11.2026). */
export function runTipSeen(id: RunTipId): boolean {
  return hasSeen(id) || (id === 'run_boss_werewolf' && hasSeen('run_boss'))
}

/** Подсказки по уровню — в порядке уровня; несколько на один уровень идут подряд. */
export type LevelTip = TutorialTip & { level: number }
export const LEVEL_TIPS: LevelTip[] = [
  { level: GATEKEEPER_MIN_LEVEL, id: 'lvl_gatekeeper', title: 'Новый враг', text: 'Теперь тебе встретятся Привратники с дверью вместо щита.\nСо спины они открыты.', icon: 'event_enemy.png' },
  { level: QUEST_UNLOCK_LEVEL, id: 'lvl_quests', title: 'Ежедневные задания', text: 'На стене убежища висит доска с заданиями.\nВозьми одно — получишь награду за дело.', icon: 'icon_hunter_badge.png' },
  { level: POTION_TIERS[1].levelRequired, id: 'lvl_potion_2', title: 'Новое зелье', text: `У Торговца появилось «${POTION_TIERS[1].nameRu}».\nОно лечит сильнее.`, icon: POTION_TIERS[1].icon },
  { level: CLASS_CHOOSE_LEVEL, id: 'lvl_class', title: 'Выбор класса', text: 'Отшельник готов указать тебе путь.\nЗаплатишь Осколками души и золотом.', icon: 'class_ghoul.png' },
  { level: RUNE_DROP_MIN_LEVEL, id: 'lvl_runes', title: 'Руны', text: 'Теперь с врагов и боссов падают руны.\nСколько ещё можно найти — смотри в Персонаж → Статистика.', icon: 'rune_attack.png' },
  { level: POTION_TIERS[2].levelRequired, id: 'lvl_potion_3', title: 'Новое зелье', text: `У Торговца — «${POTION_TIERS[2].nameRu}».`, icon: POTION_TIERS[2].icon },
  { level: POTION_TIERS[3].levelRequired, id: 'lvl_potion_4', title: 'Новое зелье', text: `У Торговца — «${POTION_TIERS[3].nameRu}».`, icon: POTION_TIERS[3].icon },
  { level: CRAFTER_LEVEL, id: 'lvl_crafter', title: 'Мастер', text: 'У Кузнеца поселился Мастер.\nОн куёт вещи иного места и кольца.', icon: 'ring_saving.png' },
  { level: CLASS_ASCEND_LEVEL, id: 'lvl_ascend', title: 'Возвышение', text: 'Отшельник поднимет твой класс\nна вторую ступень.', icon: 'class_blood_lord.png' },
  { level: POTION_TIERS[4].levelRequired, id: 'lvl_potion_5', title: 'Новое зелье', text: `У Торговца — «${POTION_TIERS[4].nameRu}».`, icon: POTION_TIERS[4].icon },
].sort((a, b) => a.level - b.level)

/** Первые предметы в сумке. */
export type ItemTipId = 'item_book' | 'item_ring' | 'item_equipment' | 'item_rune'
export const ITEM_TIPS: Record<ItemTipId, TutorialTip> = {
  item_book: { id: 'item_book', title: 'Книга навыка', text: 'Открой её в Инвентарь → «Книги» и надень.\nВ бою появится новая кнопка.', icon: 'book_fire.png' },
  item_ring: { id: 'item_ring', title: 'Кольцо', text: 'Кольцо садится на палец, только когда надеты\nДлани иного места.', icon: 'ring_saving.png' },
  item_equipment: { id: 'item_equipment', title: 'Снаряжение', text: 'Примерь находку: Инвентарь → «Экипировка».', icon: 'nav_gear.png' },
  item_rune: { id: 'item_rune', title: 'Руна', text: 'Древний знак силы. Сам по себе молчит —\nразбуди его знаками охотника в Инвентарь → Руны.', icon: 'rune_attack.png' },
}

// --- Хранение ---

const KEY_SEEN = 'tut_seen'
const KEY_LEVEL = 'tut_level'
const CLOUD_TIMEOUT_MS = 3000

type State = { userId: number; seen: Set<string>; lastSeenLevel: number | null }
let state: State | null = null

type WebAppCloud = {
  getItem: (key: string, cb: (err: unknown, value?: string) => void) => void
  setItem: (key: string, value: string, cb?: (err: unknown, ok?: boolean) => void) => void
}
function webAppCloud(): WebAppCloud | null {
  try {
    const cs = (window as unknown as { Telegram?: { WebApp?: { CloudStorage?: WebAppCloud } } }).Telegram?.WebApp?.CloudStorage
    return cs && typeof cs.getItem === 'function' ? cs : null
  } catch {
    return null
  }
}
function sdkCloudAvailable(): boolean {
  try {
    return cloudStorage.getItem.isAvailable() && cloudStorage.setItem.isAvailable()
  } catch {
    return false
  }
}
function withTimeout<T>(p: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error('cloud timeout')), CLOUD_TIMEOUT_MS)
    p.then((v) => { window.clearTimeout(t); resolve(v) }, (e) => { window.clearTimeout(t); reject(e) })
  })
}
/** null — облака нет или оно не ответило; '' — ключ не записан. */
async function cloudGet(key: string): Promise<string | null> {
  try {
    const wa = webAppCloud()
    if (wa) {
      return await withTimeout(new Promise<string>((resolve, reject) => {
        wa.getItem(key, (err, value) => (err ? reject(err) : resolve(value ?? '')))
      }))
    }
    if (sdkCloudAvailable()) return await withTimeout(Promise.resolve(cloudStorage.getItem(key)))
  } catch (e) {
    console.warn('tutorial: облако Telegram не ответило', e)
  }
  return null
}
function cloudSet(key: string, value: string): void {
  try {
    const wa = webAppCloud()
    if (wa) { wa.setItem(key, value); return }
    if (sdkCloudAvailable()) void Promise.resolve(cloudStorage.setItem(key, value)).catch(() => {})
  } catch {
    // запись не удалась — останется в localStorage
  }
}
function localKey(key: string, userId: number): string {
  return `${key}_${userId}`
}
/** null — localStorage недоступен; '' — ключа нет. */
function localGet(key: string, userId: number): string | null {
  try {
    return window.localStorage.getItem(localKey(key, userId)) ?? ''
  } catch {
    return null
  }
}
function localSet(key: string, userId: number, value: string): void {
  try {
    window.localStorage.setItem(localKey(key, userId), value)
  } catch {
    // нет — значит нет
  }
}
function parseSeen(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
function parseLevel(raw: string): number | null {
  const n = Number(raw)
  return raw !== '' && Number.isInteger(n) && n >= 0 ? n : null
}

let loading: Promise<boolean> | null = null
let loadingFor: number | null = null

/**
 * Загрузить флаги игрока. true — хранилище есть, подсказки можно показывать.
 * Повторный вызов для того же игрока отдаёт ту же загрузку.
 */
export function loadTutorial(userId: number): Promise<boolean> {
  if (loading && loadingFor === userId) return loading
  loadingFor = userId
  loading = (async () => {
    try {
      const [cloudSeen, cloudLevel] = await Promise.all([cloudGet(KEY_SEEN), cloudGet(KEY_LEVEL)])
      const localSeen = localGet(KEY_SEEN, userId)
      const localLevel = localGet(KEY_LEVEL, userId)
      if (cloudSeen === null && localSeen === null) {
        state = null
        return false
      }
      // Облако — главное; пусто в облаке — берём то, что запомнил localStorage.
      const seen = new Set([...parseSeen(cloudSeen ?? ''), ...parseSeen(localSeen ?? '')])
      const levelRaw = cloudLevel !== null && cloudLevel !== '' ? cloudLevel : (localLevel ?? '')
      state = { userId, seen, lastSeenLevel: parseLevel(levelRaw) }
      return true
    } catch (e) {
      console.warn('tutorial: флаги не загрузились — подсказок не будет', e)
      state = null
      return false
    }
  })()
  return loading
}

export function tutorialReady(): boolean {
  return state !== null
}

/** Не загружено — «показано»: при сбое хранилища подсказки молчат. */
export function hasSeen(id: string): boolean {
  return state === null || state.seen.has(id)
}

function saveSeen(): void {
  if (!state) return
  const raw = JSON.stringify([...state.seen])
  localSet(KEY_SEEN, state.userId, raw)
  cloudSet(KEY_SEEN, raw)
}

export function markSeen(...ids: string[]): void {
  if (!state) return
  let changed = false
  for (const id of ids) if (!state.seen.has(id)) { state.seen.add(id); changed = true }
  if (changed) saveSeen()
}

/** null — фича у игрока ещё не запускалась (или хранилища нет). */
export function lastSeenLevel(): number | null {
  return state?.lastSeenLevel ?? null
}

export function setLastSeenLevel(level: number): void {
  if (!state || state.lastSeenLevel === level) return
  state.lastSeenLevel = level
  localSet(KEY_LEVEL, state.userId, String(level))
  cloudSet(KEY_LEVEL, String(level))
}

/**
 * «Сбросить подсказки»: список показанного очищается целиком — ВСЕ подсказки
 * забега (и добавленные 11.11.2026: враги по виду, Тень, «Тебя заметили», боссы
 * по виду) и о предметах снова покажутся; прежняя run_boss тоже стирается, так
 * что и Тварь покажется заново. Уровень
 * не трогается — подсказки прошедших уровней это объявления «стало доступно»,
 * повторять их незачем.
 */
export function resetTutorial(): void {
  if (!state) return
  state.seen = new Set()
  saveSeen()
}

/** Подсказки по уровню, которые пора показать, — по порядку. */
export function pendingLevelTips(level: number): LevelTip[] {
  const since = lastSeenLevel()
  if (state === null || since === null) return []
  return LEVEL_TIPS.filter((t) => t.level > since && t.level <= level && !hasSeen(t.id))
}

export function tipIconSrc(icon: string | undefined): string | null {
  return icon ? `${import.meta.env.BASE_URL}assets/icons/${icon}` : null
}
