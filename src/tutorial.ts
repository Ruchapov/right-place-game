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
    text: 'Слева — бег. Справа — удар и прыжок.\nДержи прыжок дольше — прыгнешь выше.',
    icon: 'btn_jump.png',
  },
  {
    id: 'intro_goal',
    title: 'Цель вылазки',
    text: 'На карте три события: враги, сундук, обелиск или босс.\nЗакрой их все и нажми «Завершить вылазку».',
    icon: 'event_enemy.png',
  },
  {
    id: 'intro_potions',
    title: 'Здоровье и зелья',
    text: `За забег — до ${MAX_SIPS_PER_RUN} глотков. Пьётся самое сильное зелье.\nУмрёшь — трофеи сгорят.`,
    icon: 'potion_1_vial.png',
  },
  {
    id: 'intro_growth',
    title: 'Прокачка',
    text: 'Сила и ловкость растут от урона, выносливость — от полученного урона.\nУровень растёт вместе со статами.',
    icon: 'icon_level.png',
  },
  {
    id: 'intro_menu',
    title: 'Меню',
    text: 'Убежище — покупки. Инвентарь — снаряжение.\nПерсонаж — статы и навыки. Сообщество — гильдия и друзья.',
    icon: 'nav_shop.png',
  },
]

/** Подсказки при первом появлении в забеге. Ключ — то, что заметил тикер. */
export type RunTipId =
  | 'run_zvonar' | 'run_gatekeeper' | 'run_elite' | 'run_patrol' | 'run_chest'
  | 'run_obelisk' | 'run_boss' | 'run_smuggler' | 'run_starbloom'
export const RUN_TIPS: Record<RunTipId, TutorialTip> = {
  run_zvonar: { id: 'run_zvonar', title: 'Звонарь', text: 'Держится подальше и бьёт волной издалека.\nПерепрыгни волну или отбей её.', icon: 'event_enemy.png' },
  run_gatekeeper: { id: 'run_gatekeeper', title: 'Привратник', text: 'Закрывается дверью-щитом спереди.\nБей в спину или после оглушения и заморозки.', icon: 'event_enemy.png' },
  run_elite: { id: 'run_elite', title: 'Элитный враг', text: 'Светится золотом: вдвое живучее и бьёт сильнее.\nЗа него — больше трофеев и элитный трофей.', icon: 'icon_elite_trophy.png' },
  run_patrol: { id: 'run_patrol', title: 'Патрульный', text: 'Одинокий враг вне событий.\nУбивать не обязательно, но за него дают трофеи.', icon: 'event_enemy.png' },
  run_chest: { id: 'run_chest', title: 'Сундук', text: 'Открой ударом. Иногда это мимик —\nон взорвётся и ранит.', icon: 'event_chest.png' },
  run_obelisk: { id: 'run_obelisk', title: 'Обелиски', text: 'Ударь обелиск — и успей зажечь остальные,\nпока не кончилось время.', icon: 'map_obelisk.png' },
  run_boss: { id: 'run_boss', title: 'Босс', text: 'Сильный враг: следи за замахом и отбивай удары.\nПобеда даёт уровень.', icon: 'event_boss.png' },
  run_smuggler: { id: 'run_smuggler', title: 'Контрабандист', text: 'Подойди и нажми 🔄. Можно рискнуть трофеями:\nудача — больше, неудача — половину отнимут.', icon: 'event_smuggler.png' },
  run_starbloom: { id: 'run_starbloom', title: 'Звёздоцвет', text: 'Срежь цветок ударом —\nего пыльца нужна Мастеру.', icon: 'item_star_pollen.png' },
}

/** Подсказки по уровню — в порядке уровня; несколько на один уровень идут подряд. */
export type LevelTip = TutorialTip & { level: number }
export const LEVEL_TIPS: LevelTip[] = [
  { level: GATEKEEPER_MIN_LEVEL, id: 'lvl_gatekeeper', title: 'Новый враг', text: 'Теперь встречаются Привратники с дверью-щитом.\nБей их в спину.', icon: 'event_enemy.png' },
  { level: QUEST_UNLOCK_LEVEL, id: 'lvl_quests', title: 'Ежедневные задания', text: 'На стене убежища (вкладка «Исследовать») висит доска.\nБери задание — получай награду.', icon: 'icon_hunter_badge.png' },
  { level: POTION_TIERS[1].levelRequired, id: 'lvl_potion_2', title: 'Новое зелье', text: `В Убежище у Торговца — «${POTION_TIERS[1].nameRu}».\nЛечит сильнее.`, icon: POTION_TIERS[1].icon },
  { level: CLASS_CHOOSE_LEVEL, id: 'lvl_class', title: 'Выбор класса', text: 'В Убежище у Отшельника можно выбрать класс.\nНужны Осколки души и золото.', icon: 'class_ghoul.png' },
  { level: POTION_TIERS[2].levelRequired, id: 'lvl_potion_3', title: 'Новое зелье', text: `У Торговца — «${POTION_TIERS[2].nameRu}».`, icon: POTION_TIERS[2].icon },
  { level: POTION_TIERS[3].levelRequired, id: 'lvl_potion_4', title: 'Новое зелье', text: `У Торговца — «${POTION_TIERS[3].nameRu}».`, icon: POTION_TIERS[3].icon },
  { level: CRAFTER_LEVEL, id: 'lvl_crafter', title: 'Мастер', text: 'У Кузнеца появился Мастер:\nвещи иного места и кольца.', icon: 'ring_saving.png' },
  { level: CLASS_ASCEND_LEVEL, id: 'lvl_ascend', title: 'Возвышение', text: 'У Отшельника можно возвысить класс\nдо второй ступени.', icon: 'class_blood_lord.png' },
  { level: POTION_TIERS[4].levelRequired, id: 'lvl_potion_5', title: 'Новое зелье', text: `У Торговца — «${POTION_TIERS[4].nameRu}».`, icon: POTION_TIERS[4].icon },
].sort((a, b) => a.level - b.level)

/** Первые предметы в сумке. */
export type ItemTipId = 'item_book' | 'item_ring' | 'item_equipment'
export const ITEM_TIPS: Record<ItemTipId, TutorialTip> = {
  item_book: { id: 'item_book', title: 'Книга навыка', text: 'Инвентарь → «Книги»: нажми на книгу и «Надеть».\nНавык появится кнопкой в бою.', icon: 'book_fire.png' },
  item_ring: { id: 'item_ring', title: 'Кольцо', text: 'Кольца надеваются на «Персонаже»,\nкогда надеты Длани иного места.', icon: 'ring_saving.png' },
  item_equipment: { id: 'item_equipment', title: 'Снаряжение', text: 'Инвентарь → «Экипировка»: нажми на вещь и «Надеть».', icon: 'nav_gear.png' },
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
 * «Сбросить подсказки»: подсказки забега и предметов снова покажутся. Уровень
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
