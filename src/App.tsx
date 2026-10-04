import { useEffect, useRef, useState } from 'react'
import { retrieveRawInitData, retrieveLaunchParams } from '@telegram-apps/sdk'
import { C, FONT_DISPLAY } from './ui/theme'
import { loginWithTelegram, buyPotion, buyConsumable, buyUpgrade, sellItem, fetchProfile, exchangeTrophies, readTrophyGoldRate, readConsumables, readScrolls, readSkillLevels, readSkillUses, readEquippedSkills, readUpgrades, fetchInventory, equipItem, equipBook, forgetSkill, upgradeSkill, sellBook, assembleBook, sellScroll, RequestError, type LoginResponse, type InventoryItem, type RunResultSummary, type SkillStateResult } from './api'
import { POTION_TIERS, MAX_SIPS_PER_RUN, MAX_POTIONS_PER_PURCHASE, parsePurchaseCount } from './potions'
// Потолок покупки расходников берётся ИЗ ОБЩЕЙ ПАРЫ (src/consumables.ts ↔
// server/src/consumables.ts, байт-в-байт, сверка check_potion_sync.py) — своей
// копии числа на клиенте нет и заводить её нельзя.
import { BAG_CAPACITY, CONSUMABLES, MAX_CONSUMABLES_PER_PURCHASE, RUN_CONSUMABLE_SLOTS, MAX_EQUIPPED_SKILLS, consumableById, consumableSkillBook, consumableSellPrice, bookBySkillId, parseConsumableCount, parseSkillBookId, parseSkillBookSkillId, type ConsumableId, type ConsumableShopTab, type SkillBookId, type SkillBookSkillId } from './consumables'
// Каталог СТРАНИЦ книг — тоже общая пара (src/scrolls.ts ↔ server/src/scrolls.ts).
// Страницы не продаются в магазине: они только выпадают в забегах.
import { SCROLLS, SCROLLS_PER_BOOK, SCROLL_SELL_PRICE, scrollById, type ScrollId } from './scrolls'
// Иконка предмета по слоту и тиру — общий модуль с экраном итогов забега
// (Explore.tsx, блок «ДОБЫЧА»): импортировать App.tsx оттуда нельзя — цикл.
import { itemIconSrc } from './itemIcons'
// Строку механики берём ТОЛЬКО отсюда: у камня и оберега числа в общем каталоге,
// у книг — в боевых константах скиллов, и развилка обязана быть одна (см.
// consumableMechanicLine).
import { consumableMechanicLine, skillBookLine } from './skillBooks'
import type { SkillStats } from './skillDamage'
// Каталог улучшений — общая пара с сервером (src/upgrades.ts ↔
// server/src/upgrades.ts, байт-в-байт). Цена, шаг и тексты берутся ТОЛЬКО
// оттуда: цену применяет сервер, и своя копия формулы разошлась бы с ней.
import { UPGRADES, UPGRADE_ORDER, upgradePrice, upgradeBonus, type UpgradeCounts, type UpgradeKind } from './upgrades'
import { playerAttackDamage } from './playerDamage'
import Explore from './Explore'
import PastRunNotice, { type PastRunNoticeData } from './ui/PastRunNotice'
import SkillLevelNote from './ui/SkillLevelNote'
import './App.css'

type PlayerData = { id: number; firstName: string; level: number; gold: number; strength: number; endurance: number; agility: number; trophies: number
  /**
   * Надетые навыки, максимум MAX_EQUIPPED_SKILLS.
   * null — сервер их НЕ НАЗВАЛ (см. readEquippedSkills в api.ts). Это НЕ «навыков
   * нет»: пустой список — штатное состояние героя без книг, и путать его с
   * неизвестностью нельзя (в забег ушли бы кнопки, которых игрок не заслужил, или
   * наоборот).
   */
  equippedSkills: string[] | null
  /**
   * Уровень каждого навыка, старт 1 (колонки Character.skillLevel*).
   * null — сервер не назвал (см. readSkillLevels). Прочерк, не единица: уровень
   * растёт за книги, и соврать в нём значит соврать про потраченное.
   * ⚠️ Ни на что в бою пока не влияет — что даёт уровень, не решено.
   */
  skillLevels: Record<SkillBookSkillId, number> | null
  /**
   * Результативные применения каждого навыка, накопленные в счёт СЛЕДУЮЩЕГО
   * уровня (колонки Character.skillUses*). Растут в забегах — их считает
   * Explore и отдаёт серверу, сервер превращает в уровни (02.10.2026).
   * null — сервер не назвал (см. readSkillUses), и это НЕ ноль.
   *
   * ⚠️ НИГДЕ НЕ ПОКАЗЫВАЕТСЯ с 04.10.2026 — решение дизайнера: прогресса
   * применений в интерфейсе нет ни в карточке навыка, ни где-либо ещё.
   * Поле живёт дальше, потому что сервер его присылает и счётчики не трогали:
   * форма профиля обязана совпадать с ответом логина.
   */
  skillUses: Record<SkillBookSkillId, number> | null
  /**
   * Сколько улучшений каждого вида куплено (колонки Character.attackUpgrades /
   * armorUpgrades). От них зависят УРОН и БРОНЯ.
   * null — сервер их НЕ НАЗВАЛ (см. readUpgrades в api.ts). Это не нули: с
   * нулями экран показал бы заниженные числа, а забег ушёл бы со слабым героем.
   */
  upgrades: UpgradeCounts | null
  /** Склад зелий по тирам, индекс = тир-1 (см. src/potions.ts). */ potions: number[]
  /**
   * Склад расходников по id каталога (src/consumables.ts).
   * null — сервер его НЕ НАЗВАЛ (старая версия или битое поле, см.
   * readConsumables в api.ts). Это не «расходников нет»: экраны в этом
   * состоянии пишут прочерк, а не ноль.
   */
  consumables: Record<ConsumableId, number> | null
  /**
   * Склад СТРАНИЦ книг по id каталога (src/scrolls.ts).
   * null — сервер его НЕ НАЗВАЛ (см. readScrolls в api.ts), то же трёхзначное
   * состояние, что у consumables выше: прочерк, а не ноль.
   * Отдельным полем от consumables намеренно: страницы ячейку сумки НЕ тратят,
   * и один объект заставил бы различать это по id.
   */
  scrolls: Record<ScrollId, number> | null }

// Шесть слотов с русскими подписями — ОДИН список на весь файл. Прежний
// SLOT_LABELS (та же карта слот→подпись, только объектом) удалён как дубль:
// он остался без читателей, когда ряд фильтров в "Инвентаре" стал брать
// подписи отсюда. Порядок здесь — порядок показа и в гнёздах "Персонажа", и в
// кнопках фильтра, и в сортировке инвентаря (см. SLOT_ORDER ниже).
const HERO_SLOTS: { slot: string; label: string }[] = [
  { slot: 'weapon', label: 'Оружие' },
  { slot: 'helmet', label: 'Шлем' },
  { slot: 'armor', label: 'Броня' },
  { slot: 'gloves', label: 'Перчатки' },
  { slot: 'boots', label: 'Сапоги' },
  { slot: 'amulet', label: 'Амулет' },
]

// Порядок слотов для сортировки инвентаря — выводится из HERO_SLOTS, а не
// перечисляется заново: это был четвёртый по счёту список тех же шести слотов
// в файле.
const SLOT_ORDER: string[] = HERO_SLOTS.map((s) => s.slot)

// Вместимость сумки переехала в ОБЩУЮ пару каталогов (src/consumables.ts ↔
// server/src/consumables.ts) 30.09.2026 — ровно по плану, который стоял в
// прежнем комментарии здесь: «появится вместимость на сервере — брать оттуда».
// Она появилась: сервер решает судьбу добычи на финише («не влезло, значит
// пропало»), и применять он обязан ТО ЖЕ число, которое показывает счётчик
// «N / 30». Переполнение по-прежнему показывается как есть, красным, а не
// обрезается до 30 (например, после debug-give-all-items: 36 предметов).

// Иконка предмета (слот+тир → путь) переехала в src/itemIcons.ts 30.09.2026:
// её читает ещё и экран итогов забега (Explore.tsx, блок «ДОБЫЧА»), а импорт
// App.tsx оттуда дал бы цикл. Там же разбор, почему путь НЕ берётся из
// Item.iconPath, — если возникнет соблазн «починить», читать надо тот файл.

// Иконка в ячейке — ОДНА точка на все места, где она рисуется: гнездо
// "Персонажа", ячейка и карточка "Инвентаря". Разбирает оба нештатных случая:
//   src === null — неизвестный слот (контракт itemIconSrc): название текстом;
//   картинка не загрузилась (404, битый файл) — красная рамка с "!" и
//   console.error с URL. Раньше WebView молча рисовал на этом месте "?", и
//   404 четырёх иконок 6 тира нашли только глазами на телефоне.
// Принимает готовый src, а не slot/tier: ячейка и карточка "Инвентаря" общие
// с зельями, у которых путь из каталога зелий, — отдельной ветки под них быть
// не должно. Предметам src по-прежнему даёт ТОЛЬКО itemIconSrc.
function ItemIcon({ src, name, size }: { src: string | null; name: string; size: number | 'fill' }) {
  // Запоминаем, КАКОЙ src упал, а не булев флаг: гнездо "Персонажа" остаётся
  // тем же экземпляром при смене надетого предмета, и флаг от прошлой картинки
  // пометил бы битой новую.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const box = size === 'fill' ? '100%' : size
  if (src === null) {
    return (
      <div style={{
        width:box, height:box, boxSizing:'border-box', padding:2,
        display:'flex', alignItems:'center', justifyContent:'center', textAlign:'center',
        fontSize: size === 'fill' || size > 30 ? 8 : 7, color:C.textDim,
      }}>
        {name}
      </div>
    )
  }
  if (failedSrc === src) {
    return (
      <div style={{
        width:box, height:box, boxSizing:'border-box',
        display:'flex', alignItems:'center', justifyContent:'center',
        border:`1px solid ${C.danger}`, borderRadius:4,
        color:C.danger, fontWeight:700,
        fontSize: size === 'fill' ? 20 : Math.max(11, Math.round(size * 0.55)),
      }}>
        !
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={name}
      onError={() => {
        console.error(`Item icon failed to load: ${src} (${name})`)
        setFailedSrc(src)
      }}
      style={{ width:box, height:box, objectFit:'contain', display:'block' }}
    />
  )
}

// Флейвор-тексты предметов — ЕДИНСТВЕННОЕ, что осталось от клиентской копии
// каталога (прежний ITEM_CATALOG держал ещё имена и строки статов). Имя
// теперь приходит с сервера (item.nameRu), числа статов — тоже с сервера (см.
// itemStatLine ниже), а флейвор держать здесь приходится: колонка
// Item.description в БД есть, но GET /character/inventory её НЕ отдаёт.
// Индекс в массиве = тир-1.
//
// ⚠️ Тексты обязаны совпадать с Item.description в сиде
// (server/prisma/seed-items.ts и миграция 20260903120000_reseed_item_catalog)
// — это копия, и она может разойтись ровно так, как разошлись числа статов
// (см. itemStatLine). Когда эндпоинт начнёт отдавать description — удалить
// этот объект целиком, а не пополнять его.
const ITEM_FLAVOR: Record<string, string[]> = {
  weapon: [
    'Им резали хлеб чаще, чем врагов. Держат такой от безысходности.',
    'Клеймо стёрлось, но балансировка честная. Такими вооружали тех, кого не жалко.',
    'Узкий, чтобы проходить между рёбер. Дознаватели редко спрашивали дважды.',
    'Тяжёлый и прямой, без хитростей. Гвардия не отступала, и оружие делали под это.',
    'На рукояти вырезано имя, но прочесть его уже нельзя. Владелец, похоже, не возражает.',
    'Оказался там, где нужно, и тогда, когда нужно. Больше о нём сказать нечего.',
  ],
  helmet: [
    'Ведро с прорезью для глаз. Внутри до сих пор пахнет прежним хозяином.',
    'Вмятина на лбу говорит, что он однажды уже сделал свою работу.',
    'Прорезь узкая — чтобы видеть допрашиваемого, но не встречаться с ним взглядом.',
    'Плотно садится, глушит звук. В нём слышно только собственное дыхание.',
    'Подогнан под чужую голову, но садится как влитой. Лучше об этом не думать.',
    'Не корона и не шлем. Что-то, что носят, когда больше некому.',
  ],
  armor: [
    'Больше от холода, чем от клинка. Но всё-таки лучше, чем ничего.',
    'Половина колец перебрана вручную, и не тобой. Кто-то за ней следил.',
    'Чёрненая сталь, чтобы не бликовать в тёмных комнатах. Практично.',
    'Цельная, без стыков на груди. Такую не пробьёшь ударом в упор.',
    'Ни герба, ни клейма — всё сточено начисто. Он не хотел, чтобы его узнали.',
    'Выдержал то, что не должно было выдержаться. Дальше зависит от тебя.',
  ],
  gloves: [
    'Полосы ткани, намотанные в несколько слоёв. Хотя бы не собьёшь костяшки.',
    'Грубая кожа, задубевшая от пота. Зато рукоять не проскальзывает.',
    'Пластины на пальцах сидят плотно, движения не стесняют. Работа тонкая.',
    'Закрывают кисть целиком, до середины предплечья. Тяжело, но привыкаешь.',
    'Разношены под чужую руку, но твоей подходят. Совпадение, надо думать.',
    'Пальцы смыкаются раньше, чем ты решаешь сжать. Так и должно быть.',
  ],
  boots: [
    'Подошва протёрта до дыр. Каждый камень чувствуется как свой.',
    'Прошагали не одну сотню миль и готовы ещё. Голенище держит лодыжку.',
    'Мягкая подошва, почти не слышно шагов. Он приходил без предупреждения.',
    'Окованный носок, укреплённая пятка. В таких стоят насмерть.',
    'Стёрты неровно, будто он всё время сворачивал куда-то влево.',
    'Ноги сами выбирают, куда ступить. Спорить с ними себе дороже.',
  ],
  amulet: [
    'Монета с дыркой, на шнурке. Ничего не стоит, но с ней спокойнее.',
    'Затёртый до гладкости — его держали в кулаке слишком часто.',
    'Оттиск сбит намеренно, чтобы никто не разобрал, чья она.',
    'Выдавался за выслугу. Тем, кто дожил до выслуги.',
    'Пустая оправа — камень выпал давно. Работать почему-то не перестал.',
    'Смотрит не наружу, а куда-то мимо. Иногда кажется, что он моргнул.',
  ],
}

// Строка статов предмета — считается из ЧИСЕЛ СЕРВЕРА, а не берётся готовой
// строкой из клиентского каталога. Прежний ITEM_CATALOG держал её текстом, и
// текст УЖЕ разошёлся с базой:
//   шлем     обещал броню 2/5/8/10/13/15,   в БД 2/3/5/6/7/8
//   броня            броню 5/10/15/20/25/30, в БД 5/8/12/15/18/21
//   перчатки         броню 2/5/8/10/13/15,   в БД 2/3/4/6/8/9
// (оружие, сапоги и амулет совпадали). Броню в бою считает сервер по СВОИМ
// числам, так что карточка врала игроку на всю разницу.
//
// Процент роста стата (сила/выносливость/ловкость) отдельным полем в БД НЕ
// хранится — по дизайну это tier*5%, выводится из тира на лету (так и
// записано в комментарии к миграции 20260903120000_reseed_item_catalog).
function itemStatLine(item: InventoryItem['item']): string {
  const growth = item.tier * 5
  // Поля nullable по схеме (damage только у оружия, armor у шлема/брони/
  // перчаток, и так далее). null там, где для этого слота число обязательно —
  // испорченная строка каталога, а НЕ ноль: показываем "?", нулём не
  // подменяем (см. CLAUDE.md, Design Decisions — тихие фолбэки).
  const n = (v: number | null) => (v === null ? '?' : `+${v}`)
  switch (item.slot) {
    case 'weapon': return `Урон ${n(item.damage)} · Рост силы +${growth}%`
    case 'helmet': return `Броня ${n(item.armor)}`
    case 'armor': return `Броня ${n(item.armor)} · Рост выносливости +${growth}%`
    case 'gloves': return `Броня ${n(item.armor)} · Рост ловкости +${growth}%`
    case 'boots': return `Скорость ${n(item.moveSpeed)}%`
    case 'amulet': return `Удача ${n(item.luck)}`
    // Слот не из известных шести — называем его вслух, а не показываем пустую
    // строку: Item.slot в схеме свободный текст, опечатка в сиде попала бы
    // сюда молча.
    default: return `Неизвестный слот "${item.slot}"`
  }
}

// ВРЕМЕННО: тестовая панель выбора карты Explore (см. кнопки ниже в JSX).
const EXPLORE_MAPS: { label: string; file: string }[] = [
  { label: 'A Серпантин', file: 'map_A_serpentine.txt' },
  { label: 'B Разлом', file: 'map_B_razlom.txt' },
  { label: 'C Спуск к боссу', file: 'map_C_boss_descent.txt' },
  { label: 'E Башни', file: 'map_E_towers.txt' },
  { label: 'F Святилище', file: 'map_F_sanctuary.txt' },
]

const SLOT_SVG_PATHS: Record<string, string> = {
  weapon: 'M20.7 3.3a1 1 0 0 0-1.4 0L14 8.6l-1.3-1.3-1.4 1.4 1.3 1.3-7 7A2 2 0 1 0 8.4 19.8l7-7 1.3 1.3 1.4-1.4-1.3-1.3 5.3-5.3a1 1 0 0 0 0-1.8z',
  helmet: 'M12 2C8.1 2 5 5.1 5 9v2h2v1a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-1h2V9c0-3.9-3.1-7-7-7zm3 10H9v-1h6v1z',
  armor: 'M12 1L3 5v6c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V5l-9-4zm0 10.9L6.8 9 12 6.1 17.2 9 12 11.9z',
  gloves: 'M9 5v5H7V5a1 1 0 0 0-2 0v6H4V8a1 1 0 0 0-2 0v5c0 2.8 2.2 5 5 5h.5A4.5 4.5 0 0 0 12 13.5V5a1 1 0 0 0-2 0zm9 0a1 1 0 0 0-1 1v4h-1V5a1 1 0 0 0-2 0v5h-1V7a1 1 0 0 0-2 0v6.5A4.5 4.5 0 0 0 16.5 18H17c2.8 0 5-2.2 5-5V8a1 1 0 0 0-1-1z',
  boots: 'M18 14c0-2-1.3-3.7-3-4.5V4a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v5.5C5.3 10.3 4 12 4 14v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4zM9 5h4v4H9V5z',
  amulet: 'M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z',
}

function SlotIcon({ slot, size = 24, color = '#3A3344' }: { slot: string; size?: number; color?: string }) {
  const d = SLOT_SVG_PATHS[slot]
  if (!d) return null
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" style={{ color }}>
      <path d={d} />
    </svg>
  )
}

/**
 * Склонение слова «трофей» при числе: 1 трофей, 2 трофея, 5 трофеев.
 *
 * Правило русского счёта по последним разрядам, а не по остатку от 10: числа
 * 11–14 идут во множественное («11 трофеев»), несмотря на последнюю цифру,
 * поэтому сначала отсекается сотенный остаток 11..14. Проверено на 1, 2, 5, 11,
 * 21, 22, 111, 112.
 *
 * Math.abs — от отрицательного числа: банк отрицательным быть не может, но
 * формула не должна молча давать неверное слово, если когда-нибудь сможет.
 */
function trophyWord(n: number): string {
  const abs = Math.abs(n) % 100
  if (abs >= 11 && abs <= 14) return 'трофеев'
  const last = abs % 10
  if (last === 1) return 'трофей'
  if (last >= 2 && last <= 4) return 'трофея'
  return 'трофеев'
}

const MAX_ENERGY = 100
const RUN_COST = 3 // DEV: держать в синхроне с сервером (вернуть 10 перед релизом)
/**
 * TEMP_DEV_TROPHY_GOLD_RATE — ТЕСТОВЫЙ курс обмена трофеев на золото для
 * офлайн-заглушки DevTester (вне Telegram, см. её в эффекте входа ниже).
 *
 * Это НЕ боевой курс и НЕ копия серверной константы: настоящий курс живёт
 * только на сервере (TROPHY_GOLD_RATE в server/src/game.ts) и приходит клиенту
 * полем trophyGoldRate в ответе логина и GET /character/profile. Здесь число
 * нужно ровно затем, чтобы вкладку "Обмен" можно было верстать в браузере, где
 * запросов к серверу нет вообще.
 *
 * Равен серверному (там тоже 1) НАМЕРЕННО: курс по дизайну 1 к 1, и тестовое
 * число, отличающееся от боевого, показывало бы в браузере не ту вкладку,
 * которую увидит игрок. Совпадение с сервером здесь — совпадение значений, а не
 * копия константы: сервер эту строку не читает, а клиент в Telegram — не
 * исполняет.
 *
 * УБРАТЬ ПЕРЕД РЕЛИЗОМ вместе с остальными TEMP_DEV_* (см. чеклист в CLAUDE.md).
 */
const TEMP_DEV_TROPHY_GOLD_RATE = 1
/**
 * TEMP_DEV_CONSUMABLE_STOCK — ТЕСТОВЫЙ запас КАЖДОГО расходника из каталога для
 * офлайн-заглушки DevTester (вне Telegram, см. её в эффекте входа ниже).
 *
 * Это НЕ настоящий склад: реальный лежит в колонках Character (`whetstones`,
 * `charms`) и приходит клиенту полем character.consumables в ответе логина.
 * Здесь число нужно ровно затем, чтобы витрину, карточку, ячейку инвентаря и
 * гнёзда можно было верстать в браузере, где запросов к серверу нет вообще.
 *
 * 2, а не 0 и не 1: ноль спрятал бы ячейку в инвентаре (она рисуется только при
 * запасе > 0), а с единицей не видно, что бейдж «×N» показывает число, а не
 * просто факт наличия.
 *
 * Склад собирается ИЗ КАТАЛОГА (devConsumableStock ниже), а не перечислением
 * id: новый расходник должен появляться в офлайн-отладке сам, иначе о нём
 * забудут ровно до первого запуска в браузере.
 *
 * УБРАТЬ ПЕРЕД РЕЛИЗОМ вместе с остальными TEMP_DEV_* (см. чеклист в CLAUDE.md).
 */
const TEMP_DEV_CONSUMABLE_STOCK = 2
function devConsumableStock(): Record<ConsumableId, number> {
  const out = {} as Record<ConsumableId, number>
  for (const c of CONSUMABLES) out[c.id] = TEMP_DEV_CONSUMABLE_STOCK
  return out
}
/**
 * TEMP_DEV_SCROLL_STOCK — ТЕСТОВЫЙ запас КАЖДОЙ страницы для офлайн-заглушки
 * DevTester (вне Telegram). Настоящий лежит в колонках Character.scroll* и
 * приходит полем character.scrolls в ответе логина.
 *
 * Ровно SCROLLS_PER_BOOK (3), а не 1 и не 10: при трёх кнопка «Собрать книгу
 * (3/3)» в браузере АКТИВНА — то есть видно и её рабочее состояние, и то, что
 * счётчик берётся из данных. С единицей была бы видна только погашенная кнопка,
 * и проверить сборку в браузере было бы нечем.
 *
 * Собирается ИЗ КАТАЛОГА, как склад расходников выше: шестая страница появится
 * в офлайн-отладке сама. УБРАТЬ ПЕРЕД РЕЛИЗОМ вместе с остальными TEMP_DEV_*
 * (см. чеклист в CLAUDE.md).
 */
const TEMP_DEV_SCROLL_STOCK = SCROLLS_PER_BOOK
function devScrollStock(): Record<ScrollId, number> {
  const out = {} as Record<ScrollId, number>
  for (const s of SCROLLS) out[s.id] = TEMP_DEV_SCROLL_STOCK
  return out
}
/**
 * TEMP_DEV_SKILL_LEVEL — ТЕСТОВЫЙ уровень каждого навыка для офлайн-заглушки
 * DevTester. Настоящий лежит в колонках Character.skillLevel* и приходит полем
 * character.skillLevels в ответе логина.
 *
 * 3, а не 1: с единицей не видно, что «Уровень N» в карточке показывает число из
 * данных, а не нарисованную константу.
 *
 * Собирается ИЗ КАТАЛОГА, как и склад выше: шестой навык появится в офлайн-отладке
 * сам. УБРАТЬ ПЕРЕД РЕЛИЗОМ вместе с остальными TEMP_DEV_*.
 */
const TEMP_DEV_UPGRADES: UpgradeCounts = { attack: 2, armor: 3 }
const TEMP_DEV_SKILL_LEVEL = 3
function devSkillLevels(): Record<SkillBookSkillId, number> {
  const out = {} as Record<SkillBookSkillId, number>
  for (const c of CONSUMABLES) {
    const skillId = consumableSkillBook(c)
    if (skillId !== null) out[skillId] = TEMP_DEV_SKILL_LEVEL
  }
  return out
}
/**
 * TEMP_DEV_SKILL_USES — ТЕСТОВЫЕ применения каждого навыка для той же
 * офлайн-заглушки. Настоящие лежат в колонках Character.skillUses* и приходят
 * полем character.skillUses в ответе логина.
 *
 * ⚠️ С 04.10.2026 это число НИГДЕ НЕ ВИДНО: прогресс применений из интерфейса
 * убран целиком (решение дизайнера), полоса «X / Y» в карточке навыка удалена.
 * Заглушка оставлена, потому что поле по-прежнему приходит с сервера и живёт в
 * player — убери её, и офлайн-сборка разошлась бы с настоящей формой профиля.
 * УБРАТЬ ПЕРЕД РЕЛИЗОМ вместе с остальными TEMP_DEV_*.
 */
const TEMP_DEV_SKILL_USES = 17
function devSkillUses(): Record<SkillBookSkillId, number> {
  const out = {} as Record<SkillBookSkillId, number>
  for (const c of CONSUMABLES) {
    const skillId = consumableSkillBook(c)
    if (skillId !== null) out[skillId] = TEMP_DEV_SKILL_USES
  }
  return out
}

// Затемнение фона вкладки "Исследовать" (подобрано вживую, см. историю)
const EXPLORE_BG_TOP_DARKNESS = 0.77
const EXPLORE_BG_BOTTOM_DARKNESS = 0.00
const EXPLORE_BG_BOTTOM_START_PCT = 41

// Сцена "убежище" (герой у костра) — спрайт-листы, чистый CSS-анимация
// Герой — СЕТКА 6×4 (не один ряд): background-position анимируется явными
// keyframe-шагами (X И Y на каждый кадр), а не steps() по одной оси — иначе
// alternate развернул бы X и Y независимо и кадры разъехались бы.
const REFUGE_HERO_FRAME_W = 317
const REFUGE_HERO_FRAME_H = 355
const REFUGE_HERO_COLS = 6
const REFUGE_HERO_ROWS = 4
const REFUGE_HERO_FRAMES = 24
const REFUGE_FIRE_FRAME_W = 175
const REFUGE_FIRE_FRAME_H = 187
const REFUGE_FIRE_FRAMES = 14
const REFUGE_FIRE_OFFSET_X = 327 // сдвиг костра от левого края героя, та же пропорция, что и раньше

// Положение сцены на экране — подобрано вживую временными ползунками, зашито
const REFUGE_SCENE_SCALE = 0.42
const REFUGE_SCENE_V_ANCHOR_PCT = 64
const REFUGE_SCENE_H_OFFSET_PCT = -4
const REFUGE_FIRE_TUNE_X = -13
const REFUGE_FIRE_TUNE_Y = 12

// 24 keyframe-шага для героя: на каждом — своя пара X/Y ячейки сетки.
// Сам per-segment timing-function НЕ задаётся на keyframe — берётся с
// анимации целиком (animation-timing-function на элементе), поэтому один
// и тот же трек кадров даёт и резкую смену (steps(1)), и плавную перетекание
// (linear) — переключение делается снаружи, без пересборки keyframes.
const REFUGE_HERO_KEYFRAMES = Array.from({ length: REFUGE_HERO_FRAMES }, (_, i) => {
  const col = i % REFUGE_HERO_COLS
  const row = Math.floor(i / REFUGE_HERO_COLS)
  const pct = (i / (REFUGE_HERO_FRAMES - 1)) * 100
  return `${pct.toFixed(4)}% { background-position: -${col * REFUGE_HERO_FRAME_W}px -${row * REFUGE_HERO_FRAME_H}px; }`
}).join('\n            ')

const REFUGE_HERO_DURATION = 2.0 // s — подобрано вживую временным ползунком, зашито

function liveEnergy(base: number, baseAt: number, now: number): number {
  const minutes = Math.floor((now - baseAt) / 60000)
  return Math.min(MAX_ENERGY, base + minutes)
}

// Причина провала входа словами игрока, а не текстом исключения. Три случая
// различает сам запрос (RequestError.kind, см. api.ts), и для каждого нужен
// свой совет: уснувший сервер лечится повторной попыткой, оборванная сеть —
// нет. Отказ сервера показываем вместе с кодом: 401 при битом initData значит
// "перезайди в Mini App", и скрывать код тут вредно.
function describeLoginFailure(e: unknown): string {
  if (e instanceof RequestError) {
    if (e.kind === 'timeout') return 'Сервер не ответил вовремя — возможно, он просыпался из сна. Попробуй ещё раз, второй заход обычно быстрее.'
    if (e.kind === 'network') return 'Нет связи с сервером. Проверь интернет и попробуй снова.'
    return `Сервер отказал: ${e.status}${e.serverError !== null ? ` — ${e.serverError}` : ''}`
  }
  return e instanceof Error ? e.message : String(e)
}

function hexToRgb(hex: string): string {
  const v = hex.replace('#', '')
  const r = parseInt(v.slice(0, 2), 16)
  const g = parseInt(v.slice(2, 4), 16)
  const b = parseInt(v.slice(4, 6), 16)
  return `${r},${g},${b}`
}

export default function App() {
  const [player, setPlayer] = useState<PlayerData | null>(null)
  // Итог прошлого забега, который сервер закрыл сам на этом входе — окно
  // PastRunNotice. null — показывать нечего. Ставится ТОЛЬКО в
  // refreshPlayerFromServer из ответа /auth/login (см. ниже), снимается
  // только кнопкой в самом окне: пока игрок его не закрыл, оно переживает
  // любой фоновый рефреш.
  const [pastRunNotice, setPastRunNotice] = useState<PastRunNoticeData | null>(null)
  // Дедуп параллельных фоновых рефрешей (см. requestPlayerRefresh ниже) —
  // если несколько merge-хендлеров подряд (или почти одновременно) обнаружат
  // player===null, должен уйти ОДИН логин-запрос, а не N параллельных.
  // in-flight промис — синхронно проставляется в ref ДО первого await внутри
  // refreshPlayerFromServer, поэтому дедуп срабатывает даже если два вызова
  // requestPlayerRefresh происходят в один и тот же синхронный тик.
  const playerRefreshInFlightRef = useRef<Promise<void> | null>(null)
  // Фоновый фолбэк для ВСЕХ setPlayer(prev => prev ? {...} : prev) по файлу
  // (см. вызовы ниже) — раньше при prev===null результат сервера молча
  // терялся; теперь вызывающая сторона проверяет player напрямую (не через
  // updater — побочные эффекты внутри апдейтера React не гарантирует
  // однократными) и, если null, зовёт это вместо merge. НЕ ждём результат и
  // не пробрасываем ошибку — вызывающая сторона всё равно ничего не может с
  // этим сделать, кроме как залогировать (что и делаем здесь же).
  function requestPlayerRefresh() {
    if (!playerRefreshInFlightRef.current) {
      playerRefreshInFlightRef.current = refreshPlayerFromServer()
        .catch((e) => {
          console.error('App: не удалось восстановить player после потерянного merge', e)
        })
        .finally(() => {
          playerRefreshInFlightRef.current = null
        })
    }
  }
  // Фото профиля из Telegram initData (фронт-only, сервер не трогаем) — вне
  // Telegram (обычный браузер) остаётся null, экран "Персонаж" сам рисует
  // запасной вариант (первая буква имени).
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  // Настоящая Telegram-сессия (initData реально был, loginWithTelegram
  // отработал) — НЕ то же самое, что "в localStorage лежит jwt": в
  // DevTester-режиме (вне Telegram) там может остаться токен от прошлого
  // реального логина в этом же браузере. Explore получает токен ТОЛЬКО
  // когда это true — иначе сервер списал бы энергию и открыл currentRun
  // из-под DevTester, и реальный забег в Telegram стало бы нечем начать.
  const [isTelegramSession, setIsTelegramSession] = useState(false)
  const [activeTab, setActiveTab] = useState<'hero' | 'shop' | 'explore' | 'gear' | 'friends'>('explore')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // Подвкладка "Инвентаря". ТРИ ветки, у каждой настоящий рендер:
  //   'equipment'   — предметы шести слотов (источник: inventory с сервера)
  //   'consumables' — применяемое в забеге: зелья, камень, оберег; позже карты
  //   'books'       — книги навыков (29.09.2026): свой раздел, потому что они
  //                   НЕ применяются в забеге вовсе, а надеваются/улучшаются
  //                   между забегами, и их действия («Надеть», «Улучшить»,
  //                   «Продать») не имеют смысла ни для зелья, ни для камня
  // Это НЕ прежнее трёхзначное состояние с 'skills': надетые навыки живут на
  // экране "Персонаж", здесь только книги как предметы.
  const [gearTab, setGearTab] = useState<'equipment' | 'consumables' | 'books' | 'scrolls'>('equipment')
  // Выбранный пункт фильтра по слоту внутри "Экипировки": null — "Всё".
  // Ставится тапом по гнезду на экране "Персонаж" (см. ниже), сбрасывается
  // пунктом "Всё" в выпадающем списке и тапом по "Инвентарь" в навбаре — иначе
  // фильтр залипал бы до перезапуска приложения.
  const [slotFilter, setSlotFilter] = useState<string | null>(null)
  // Раскрыт ли выпадающий список фильтра. Чисто вёрсточный флаг: что выбрано,
  // хранит ТОЛЬКО slotFilter, второго источника правды здесь нет.
  const [slotFilterOpen, setSlotFilterOpen] = useState(false)
  // «Снаряжение» убрано из магазина (решение дизайнера, 29.09.2026): предметы
  // там не продавались и продаваться не будут — они падают в забегах, а обратно
  // уходят продажей из инвентаря.
  const [shopTab, setShopTab] = useState<'Расходники' | 'Улучшения' | 'Книги' | 'Обмен'>('Расходники')
  // Выбранный товар витрины. Размеченный union, а не номер тира строкой: в
  // «Расходниках» теперь два каталога, и `Number(id)` на 'whetstone' дал бы NaN.
  const [shopSelected, setShopSelected] = useState<
    { kind: 'potion'; tier: number } | { kind: 'consumable'; id: ConsumableId } | { kind: 'upgrade'; upgradeKind: UpgradeKind } | null
  >(null)
  // Ошибка последней попытки покупки (видимая строка под кнопкой — тем же
  // приёмом, что "Недостаточно энергии" под кнопкой забега ниже).
  const [shopBuyError, setShopBuyError] = useState<string | null>(null)
  // Запрос покупки в полёте — гасит кнопку от двойного тапа: эндпоинт не
  // идемпотентный, второй тап купил бы второе зелье.
  const [shopBuyPending, setShopBuyPending] = useState(false)
  // Сколько зелий покупаем за раз (степпер на карточке). Сбрасывается в 1 при
  // открытии карточки: переносить число между тирами нельзя, цены разные.
  const [shopQty, setShopQty] = useState(1)
  // Баланс под вопросом: ответа на покупку не было (таймаут/сеть/5xx), а
  // значит сервер МОГ её применить — золото и склад на экране больше ничего
  // не доказывают. Пока не сверились через fetchProfile, покупать нельзя:
  // вторая покупка поверх неизвестного состояния спишет золото второй раз
  // (эндпоинт не идемпотентен).
  const [shopBalanceUnknown, setShopBalanceUnknown] = useState(false)
  const [shopBalancePending, setShopBalancePending] = useState(false)
  // --- Обмен трофеев на золото (POST /character/exchange-trophies) ---
  // Курс. ЕДИНСТВЕННЫЙ источник — ответы сервера (логин и GET /character/profile),
  // своего числа у клиента нет: копия константы разошлась бы с серверной молча
  // (см. readTrophyGoldRate в api.ts). null — курс неизвестен, окно так и пишет
  // и гасит кнопку; подставлять 1 нельзя.
  const [trophyGoldRate, setTrophyGoldRate] = useState<number | null>(null)
  // Запрос в полёте — гасит кнопку от повторного тапа.
  const [exchangePending, setExchangePending] = useState(false)
  const [exchangeError, setExchangeError] = useState<string | null>(null)
  // Показанный баланс устарел, но обмен ТОЧНО не применился: сервер отказал
  // 400 "No trophies to exchange" или 409 "State changed, retry" — оба означают,
  // что не записано ничего. Отдельно от shopBalanceUnknown намеренно: тот значит
  // "запрос МОГ примениться" и потому блокирует ещё и покупки, а здесь блокировать
  // нечего — достаточно предложить сверку.
  const [exchangeBalanceStale, setExchangeBalanceStale] = useState(false)
  // Тост "+N золота" после удачного обмена (N — goldGained из ответа сервера).
  // null — тоста нет.
  const [goldToast, setGoldToast] = useState<number | null>(null)
  // Таймер автоскрытия тоста. В ref, а не в состоянии: второй обмен подряд должен
  // сбросить прежний таймер, иначе он погасит новый тост раньше времени.
  const goldToastTimerRef = useRef<number | null>(null)
  // Выбранная ячейка инвентаря. Предмет адресуется inventoryItemId — именно им
  // оперирует POST /character/equip, и именно он различает два одинаковых
  // предмета (в БД это две строки InventoryItem, стакинга нет). Прежняя пара
  // slot+tier на это не годилась и досталась от фейкового TEST_INVENTORY.
  const [gearSelectedItem, setGearSelectedItem] = useState<
    | { kind: 'item'; inventoryItemId: string }
    | { kind: 'potion'; potionId: string }
    | { kind: 'consumable'; consumableId: ConsumableId }
    | { kind: 'scroll'; scrollId: ScrollId }
    | null
  >(null)
  // --- Книги навыков ---
  // Какой НАДЕТЫЙ навык открыт карточкой на экране "Персонаж" (тап по гнезду).
  // Хранится id навыка, а не индекс гнезда: гнёзда — это просто позиции в
  // equippedSkills, и после «забыть» второй навык съезжает на первое место.
  const [heroSkillSelected, setHeroSkillSelected] = useState<SkillBookSkillId | null>(null)
  // Подтверждение «Забыть»: навык снимается безвозвратно и книгу не возвращает,
  // поэтому один тап этого сделать не должен.
  const [forgetConfirm, setForgetConfirm] = useState(false)
  // Подтверждение продажи предмета: id строки инвентаря, которую вот-вот
  // продадут. Предмет исчезает безвозвратно, поэтому одним тапом это делать
  // нельзя — тот же приём, что у «Забыть» в карточке навыка.
  const [sellConfirm, setSellConfirm] = useState<string | null>(null)
  const [sellPending, setSellPending] = useState(false)
  // Одна пара состояний на все четыре действия с книгами — они никогда не идут
  // параллельно (каждое закрывает своё окно), а два счётчика «в полёте»
  // разъехались бы.
  const [skillActionPending, setSkillActionPending] = useState(false)
  const [skillActionError, setSkillActionError] = useState<string | null>(null)
  // --- Гнёзда подготовки на вкладке «Исследовать» ---
  // Длина фиксирована каталогом (RUN_CONSUMABLE_SLOTS), null — гнездо пусто.
  // Один и тот же id в двух гнёздах запрещён: сервер отвергает повторы
  // (400 Duplicate consumable), и разрешать это в UI значило бы готовить отказ.
  const [prepSlots, setPrepSlots] = useState<(ConsumableId | null)[]>(
    () => Array(RUN_CONSUMABLE_SLOTS).fill(null),
  )
  // Номер гнезда, для которого открыт список выбора. null — список закрыт.
  const [prepPickerSlot, setPrepPickerSlot] = useState<number | null>(null)
  const [friendsLinkCopied, setFriendsLinkCopied] = useState(false)
  const [showExploreDebug, setShowExploreDebug] = useState(false)
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  // Состояние загрузки инвентаря — ЧЕТЫРЕ явных значения вместо булева
  // inventoryLoading: пустой массив сам по себе не отличает "предметов нет"
  // от "запрос упал" и "ответ ещё не пришёл", а оба последних рисовали
  // правдоподобный ноль брони (см. CLAUDE.md, Design Decisions — тихие
  // фолбэки запрещены, их надо делать громкими).
  //   'idle'    — запроса не было вовсе: нет jwt, т.е. офлайн-заглушка
  //               DevTester вне Telegram (loadInventory выходит на !token).
  //               Это НЕ ошибка, но и НЕ "инвентарь пуст".
  //   'loading' — запрос в полёте.
  //   'ready'   — inventory отражает ответ сервера, числа считать можно.
  //   'error'   — запрос не удался, inventory НЕ показателен.
  const [inventoryStatus, setInventoryStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [equipping, setEquipping] = useState(false)
  // Видимая строка отказа в карточке предмета (тем же приёмом, что
  // shopBuyError в магазине). Сбрасывается новой попыткой и закрытием карточки.
  const [gearEquipError, setGearEquipError] = useState<string | null>(null)
  const [showExploreTest, setShowExploreTest] = useState(false)
  // undefined — обычный запуск ("Начать забег"): Explore получает mapFile
  // не заданным и просит карту у сервера сам. Debug-панель карт A-F (и
  // кнопка "D Тайник (50/50)") ставят сюда конкретный файл явно.
  const [exploreMapFile, setExploreMapFile] = useState<string | undefined>(undefined)
  // ВРЕМЕННО: отладочная подпись выпавшего состояния D (50/50 OPEN/SEALED,
  // см. кнопку ниже) — убрать вместе с самой тестовой панелью.
  const [dRolledState, setDRolledState] = useState<string | null>(null)

  // Live energy
  const [energyBase, setEnergyBase] = useState(MAX_ENERGY)
  const [energyBaseAt, setEnergyBaseAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    // Предзагрузка каменной рамки экрана ошибки (Explore, позже — экран
    // итогов забега) в кеш браузера. Грузим её сейчас, пока сеть ещё есть —
    // сам экран ошибки как раз показывается, когда сети уже может не быть,
    // и рамка не успела бы прийти вовремя. Fire-and-forget: не ждём, не
    // блокируем рендер приложения; неудача молча игнорируется — ничего не
    // роняем и не показываем пользователю, картинка просто запросится
    // обычным путём позже, когда реально понадобится.
    const img = new Image()
    img.onerror = () => {}
    img.src = `${import.meta.env.BASE_URL}assets/error_frame.png`
  }, [])

  // Логин-флоу — переиспользуемый: и при первом запуске (useEffect ниже),
  // и как фолбэк, когда merge в player не удался, потому что player был
  // null (см. requestPlayerRefresh выше — ВСЕ
  // setPlayer(prev => prev ? {...} : prev) по файлу теперь на null дёргают
  // именно эту функцию вместо того, чтобы молча терять результат сервера).
  // НЕ трогает loading/error — это забота вызывающей стороны: при первом
  // запуске это критично для полноэкранного индикатора/экрана ошибки,
  // при фоновом восстановлении посреди сессии полноэкранный "⏳ Загрузка..."
  // поверх уже открытого приложения был бы неуместен.
  async function refreshPlayerFromServer() {
    let initDataRaw: string | undefined
    try {
      initDataRaw = retrieveRawInitData()
    } catch {
      initDataRaw = undefined
    }
    if (!initDataRaw) {
      // Вне Telegram (обычный браузер) — заглушка для локальной разработки,
      // на сервер не ходим.
      // TEMP_DEV_SKILLS: временный набор скиллов под локальную проверку
      // iceball (в слоте 1) и fireball (в слоте 2) — два снарядных скилла
      // рядом, чтобы сравнивать их вживую. Слотов ровно два, поэтому heal,
      // slash и dash временно сняты. Влияет ТОЛЬКО на офлайн-заглушку
      // DevTester — в Telegram скиллы приходят с сервера и этой строкой не
      // задеваются. ПЕРЕД РЕЛИЗОМ вернуть ['heal', 'dash'].
      setPlayer({ id: 0, firstName: 'DevTester', level: 5, gold: 500, strength: 20, endurance: 15, agility: 10, trophies: 50, equippedSkills: ['iceball', 'fireball'], skillLevels: devSkillLevels(), skillUses: devSkillUses(), upgrades: TEMP_DEV_UPGRADES, potions: [3, 1, 0, 0, 0], consumables: devConsumableStock(), scrolls: devScrollStock() })
      // TEMP_DEV_TROPHY_GOLD_RATE: ТЕСТОВОЕ значение курса обмена, только для
      // офлайн-заглушки. Взято НЕ с сервера — оно существует ровно для того,
      // чтобы вкладку "Обмен" можно было верстать и проверять в браузере (вне
      // Telegram запросов к серверу нет вовсе). Совпадает с боевым курсом (1 к 1)
      // намеренно — см. объяснение у самой константы.
      // В Telegram эта строка не исполняется — курс приходит с логином ниже.
      setTrophyGoldRate(TEMP_DEV_TROPHY_GOLD_RATE)
      setEnergyBase(MAX_ENERGY)
      setEnergyBaseAt(Date.now())
      return
    }
    // Фото профиля — фронт-only чтение launch params, СЕРВЕР НЕ ТРОГАЕМ.
    // Отдельный try/catch: если SDK не отдаёт photoUrl (старый клиент,
    // пользователь без фото), функция должна отработать запасным
    // вариантом (буква), а не упасть целиком.
    try {
      const launchParams = retrieveLaunchParams(true)
      setPhotoUrl(launchParams.tgWebAppData?.user?.photoUrl ?? null)
    } catch {
      setPhotoUrl(null)
    }
    const data: LoginResponse = await loginWithTelegram(initDataRaw)
    localStorage.setItem('jwt', data.token)
    setIsTelegramSession(true)
    // consumables — через readConsumables, а не присваиванием: нет поля или мусор
    // дают null, то есть «запас неизвестен», и экраны скажут это прочерком.
    // equippedSkills — через readEquippedSkills, а НЕ `?? []`: пустой список это
    // штатное «книг нет», а прежний фолбэк делал его же из «сервер не ответил».
    // skillLevels — через readSkillLevels по той же причине (null ≠ уровень 1).
    setPlayer({ id: data.user.id, firstName: data.user.firstName, level: data.character.level, gold: data.character.gold, strength: data.character.strength, endurance: data.character.endurance, agility: data.character.agility ?? 0, trophies: data.character.trophies, equippedSkills: readEquippedSkills(data.character.equippedSkills), skillLevels: readSkillLevels(data.character.skillLevels), skillUses: readSkillUses(data.character.skillUses), upgrades: readUpgrades(data.character.upgrades), potions: data.character.potions, consumables: readConsumables(data.character.consumables), scrolls: readScrolls(data.character.scrolls) })
    setEnergyBase(data.character.energy)
    setEnergyBaseAt(Date.now())
    // Курс обмена — из ТОГО ЖЕ ответа. Поле верхнего уровня, не внутри character:
    // это правило экономики, а не свойство персонажа (server/src/routes/auth.ts).
    // Через readTrophyGoldRate, а не присваиванием: нет поля или мусор — null,
    // то есть "курс неизвестен", и окно обмена скажет это словами.
    setTrophyGoldRate(readTrophyGoldRate(data.trophyGoldRate))
    // Итог прошлого забега — из ТОГО ЖЕ ответа и рядом с setPlayer выше:
    // character там уже несёт последствия закрытия (сгоревший банк трофеев
    // или возвращённую энергию), и без этого окна игрок видит только
    // изменившиеся числа, без объяснения, откуда они.
    // Сервер ставит два поля во встречных ветках if/else (routes/auth.ts),
    // то есть вместе они не приходят никогда. Если всё же пришли — это
    // расхождение с сервером, и оно должно быть громким, а не молча
    // разрешённым в пользу одного из них (показываем 'interrupted': он
    // единственный из двух говорит о штрафе).
    if (data.interruptedRun && data.abandonedRun) {
      console.error('App: /auth/login прислал оба итога прошлого забега сразу', data.interruptedRun, data.abandonedRun)
    }
    if (data.interruptedRun) {
      setPastRunNotice({ kind: 'interrupted', result: data.interruptedRun })
    } else if (data.abandonedRun) {
      setPastRunNotice({ kind: 'abandoned', summary: data.abandonedRun })
    }
    // Ни одного из двух — состояние НЕ трогаем (нет else!): сюда приходит и
    // фоновый повторный вход (requestPlayerRefresh), а он не должен стирать
    // окно, которое игрок ещё не прочитал.
    // Инвентарь — ЗДЕСЬ ЖЕ, вместе с профилем, а не лениво при первом открытии
    // вкладки "Снаряжение" (см. задачу "броня не работает" — totalArmor
    // читает inventory, и Explore должен получить его ДО первого удара, не
    // подгружать во время боя). loadInventory() читает токен из localStorage
    // (уже записан строкой выше) и сама не бросает — неудача уходит в
    // console.error, login всё равно завершается, totalArmor просто
    // останется 0 до следующего успешного рефреша (тот же деградационный
    // путь, что был у ленивой загрузки, просто теперь это исключение, а не
    // норма).
    await loadInventory()
  }

  // Первый вход. Отдельной функцией (а не инлайном в эффекте), потому что её
  // же дёргает кнопка "Повторить" на экране ошибки — чистая новая попытка с
  // теми же шагами, а не какое-то отдельное частичное восстановление.
  // Повторы внутри loginWithTelegram (20 с попытка / 60 с бюджет) — то есть
  // сюда мы попадаем, только когда сервер не ответил за минуту или отказал по
  // существу. До этого момента на экране остаётся обычная загрузка.
  async function runInitialLogin() {
    setError(null)
    setLoading(true)
    try {
      await refreshPlayerFromServer()
    } catch (e) {
      console.error('App: вход не удался', e)
      setError(describeLoginFailure(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    runInitialLogin()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- Заполненность сумки ---
  // Свойство САМОЙ СУМКИ, а не открытого экрана: не зависит ни от вкладки, ни от
  // фильтра, и нужно в двух местах сразу — счётчику «N / 30» в «Инвентаре» и
  // кнопке «Снять» в карточке предмета (снимать некуда, если сумка полна).
  // Поэтому считается ЗДЕСЬ, один раз: две копии этого числа разошлись бы.
  //
  // Что тратит ячейку (docs/items.md, «ПРАВИЛО ВМЕСТИМОСТИ»): НЕнадетые предметы
  // и расходники с книгами. Зелья — нет, поэтому их здесь и не видно: они
  // копятся десятками, и терять их при переполнении было бы несоразмерно.
  // Надетое ячейку не тратит и в сумке больше не показывается вовсе — оно живёт
  // в гнёздах на экране «Персонаж».
  const bagConsumableCells: number | null = player === null || player.consumables === null
    ? null
    : CONSUMABLES.filter((c) => (player.consumables?.[c.id] ?? 0) > 0).length
  const bagUsed = inventory.filter((i) => !i.equipped).length + (bagConsumableCells ?? 0)
  // Неизвестно хоть одно слагаемое — счётчик не врёт числом, а ставит прочерк, и
  // «Сумка полна» в карточке не утверждается.
  const bagKnown = inventoryStatus === 'ready' && bagConsumableCells !== null
  const bagFull = bagKnown && bagUsed >= BAG_CAPACITY

  // Карточка предмета/зелья/расходника/книги. Живёт ЗДЕСЬ, а не внутри вкладки
  // «Инвентарь»: ту же карточку открывает тап по гнезду снаряжения на экране
  // «Персонаж». Разметка одна на оба экрана — копия разъехалась бы с оригиналом
  // при первой правке.
  const potionStock = player?.potions ?? null
  // --- Числа героя, от которых зависят экраны И забег ---
  // Объявлены ЗДЕСЬ, выше карточки предмета (selectedEntry ниже), а не рядом
  // с гейтом старта забега, где выросли: с 02.10.2026 строка «что делает» у
  // книги навыка считает урон от статов, брони и урона меча (skillStats в
  // конце блока), а карточка строится раньше гейта. Сам гейт
  // (gearNotReady/runBlocked) остался на месте — он зависит от энергии,
  // которая считается ниже.
  // Счётчики улучшений. null — сервер их не назвал, и тогда НИ броня, НИ урон
  // не известны: считать их с нулём значило бы показать игроку заниженные числа
  // и увести его с ними в забег.
  const upgradeCounts = player?.upgrades ?? null
  // Суммарная броня надетых предметов — та же формула, что уже показывает
  // статистика "Броня" на экране "Персонаж" (см. charStats ниже), вынесена
  // сюда же, чтобы прокинуть тем же числом в Explore (см. задача "броня в
  // бою"). inventory грузится СРАЗУ при логине (см. refreshPlayerFromServer
  // выше — там же, где player), не лениво при первом открытии вкладки
  // "Инвентарь": броня должна быть известна ДО первого удара в забеге, а не
  // подгружаться посреди боя.
  // Два прежних useEffect'а, дёргавших loadInventory() на открытие вкладки
  // (gearTab === 'equipment') и на установку slotFilter, УДАЛЕНЫ: данные уже
  // здесь с логина, а после надевания/снятия их перезапрашивает сама
  // handleEquipItem. Фильтр по слоту — операция над уже полученным массивом,
  // сеть для неё не нужна вовсе.
  // Броня надетых предметов — только их сумма. Купленная закалка брони
  // прибавляется ОТДЕЛЬНО, ниже: считает её общий каталог (upgradeBonus), тот
  // же, что применяет сервер на старте забега.
  const equippedArmor = inventory.filter(i => i.equipped).reduce((sum, i) => sum + (i.item.armor ?? 0), 0)
  // Итоговая броня. null — «неизвестна» (инвентарь не загружен ИЛИ улучшения
  // не названы), и это НЕ ноль: экран ставит прочерк, забег не стартует.
  const totalArmor: number | null =
    inventoryStatus !== 'ready' || upgradeCounts === null
      ? null
      : equippedArmor + upgradeBonus('armor', upgradeCounts)
  // Прибавка к урону от закалки клинка — тем же каталогом. null по той же
  // причине, что у брони.
  const attackUpgradeBonus: number | null =
    upgradeCounts === null ? null : upgradeBonus('attack', upgradeCounts)

  // Урон надетого оружия — слагаемое формулы урона (src/playerDamage.ts), одно
  // и то же число для строки "Урон" на экране "Персонаж" и для пропа Explore.
  // null — НЕИЗВЕСТЕН, а не ноль: инвентарь не 'ready' (грузится, ошибка,
  // офлайн), либо у надетого оружия damage null (битая строка каталога). Ноль —
  // только когда оружия честно не надето.
  const equippedWeapon = inventory.find(i => i.equipped && i.item.slot === 'weapon')
  const weaponDamage: number | null =
    inventoryStatus !== 'ready' ? null
      : equippedWeapon === undefined ? 0
        : equippedWeapon.item.damage

  // Всё, от чего зависят урон и лечение НАВЫКОВ (02.10.2026, src/skillDamage.ts):
  // статы героя, итоговая броня и урон меча. Нужно строке «что делает» в трёх
  // местах — витрина магазина, карточка книги в сумке, карточка навыка.
  //
  // null — «посчитать нечем»: нет профиля, либо не загружены инвентарь и
  // улучшения (а значит неизвестны броня и урон меча). Тогда в строке на месте
  // урона прочерк — ровно как в строках «Урон» и «Броня» на «Персонаже», и по
  // той же причине: выдуманные нули показали бы игроку не его силу.
  const skillStats: SkillStats | null =
    player === null || weaponDamage === null || attackUpgradeBonus === null || totalArmor === null
      ? null
      : {
        strength: player.strength,
        endurance: player.endurance,
        agility: player.agility,
        armor: totalArmor,
        // Без множителя точильного камня — он живёт только внутри забега; см.
        // SkillStats.attack в src/skillDamage.ts.
        attack: playerAttackDamage(player.strength, weaponDamage, attackUpgradeBonus),
      }

  const selectedEntry = gearSelectedItem ? (() => {
    if (gearSelectedItem.kind === 'item') {
      const inv = inventory.find((i) => i.inventoryItemId === gearSelectedItem.inventoryItemId)
      // Предмета уже нет в inventory (рефетч после надевания вернул
      // другой набор) — карточки нет вовсе, вместо пустой с нулями.
      if (!inv) return null
      return {
        kind: 'item' as const,
        name: inv.item.nameRu,
        // Флейвора на этот слот/тир в ITEM_FLAVOR нет — блок текста
        // просто не рисуется (см. разметку), выдуманной строки здесь
        // не появляется.
        desc: ITEM_FLAVOR[inv.item.slot]?.[inv.item.tier - 1] ?? null,
        stat: itemStatLine(inv.item),
        // "у тебя: N" — реальный подсчёт строк того же предмета в
        // ответе сервера, а не выдуманный qty.
        qty: inventory.filter((i) => i.item.id === inv.item.id).length,
        iconSrc: itemIconSrc(inv.item.slot, inv.item.tier),
        equipped: inv.equipped,
        // Без расширяющих приведений к "| null": в ветке kind === 'item'
        // оба поля обязаны сузиться до числа и строки — карточка
        // передаёт их в handleEquipItem и в порог уровня.
        levelRequired: inv.item.levelRequired,
        inventoryItemId: inv.inventoryItemId,
        // Цена продажи ПРИХОДИТ С СЕРВЕРА строкой инвентаря. undefined
        // — старый сервер её не прислал: кнопка тогда гаснет, а не
        // показывает выдуманное число (формулы на клиенте нет).
        sellPrice: inv.sellPrice,
      }
    }
    // Страница — СВОЯ ветка: у неё два действия («Собрать книгу» и
    // «Продать»), и оба адресуются id страницы, а не книги.
    if (gearSelectedItem.kind === 'scroll') {
      const spec = scrollById(gearSelectedItem.scrollId)
      // Страницы нет в каталоге — карточки нет вовсе (тот же приём, что
      // у пропавшего предмета): рисовать её значило бы обещать действия,
      // которых сервер не примет.
      if (spec === null) return null
      // Книга, в которую складываются страницы. null — каталоги
      // разошлись (книги у страницы нет); тогда строка «что делает»
      // говорит это прямо, а не выдумывает название.
      const book = consumableById(spec.bookId)
      const have = player?.scrolls?.[spec.id] ?? 0
      return {
        kind: 'scroll' as const,
        name: spec.nameRu,
        desc: spec.desc as string | null,
        stat: book === null
          ? `${SCROLLS_PER_BOOK} страницы складываются в книгу навыка`
          : `${SCROLLS_PER_BOOK} страницы складываются в «${book.nameRu}»`,
        qty: have,
        iconSrc: `${import.meta.env.BASE_URL}assets/icons/${spec.icon}` as string | null,
        equipped: false,
        levelRequired: null as number | null,
        inventoryItemId: null as string | null,
        scrollId: spec.id,
        have,
        // Нужна ли СВОБОДНАЯ ячейка под собранную книгу. То же правило, что
        // применяет сервер (resolveRunDrops и assemble-book): книга тратит
        // ячейку, только если её вида ещё нет в сумке — вторая ложится
        // бейджем «×2» в ту же. Без этой проверки кнопка говорила бы «Сумка
        // полна» там, где сервер собрал бы книгу без возражений.
        // Книги нет в каталоге или склад неизвестен — считаем, что ячейка
        // НУЖНА: это осторожная сторона, и она совпадает с поведением сервера
        // на пустом складе.
        needsBagCell: book === null || (player?.consumables?.[book.id] ?? 0) === 0,
        // Склад страниц неизвестен (сервер не назвал) — собирать НЕЛЬЗЯ:
        // have тогда 0, и кнопка гаснет сама. Отдельного состояния здесь
        // не нужно, заметку про неизвестный склад показывает сама вкладка.
        sellPrice: SCROLL_SELL_PRICE,
      }
    }
    // Книга — СВОЯ ветка: у неё три действия («Надеть», «Улучшить
    // навык», «Продать»), которых нет ни у зелья, ни у камня. Поля
    // общей формы заполнены так же, плюс своё: id книги (им адресуются
    // все три ручки), навык и цена продажи из каталога.
    if (gearSelectedItem.kind === 'consumable') {
      const bookId = parseSkillBookId(gearSelectedItem.consumableId)
      if (bookId !== null) {
        const spec = consumableById(bookId)
        const skillId = spec === null ? null : consumableSkillBook(spec)
        // Книги нет в каталоге или у неё нет навыка — карточки нет вовсе
        // (тот же приём, что у пропавшего предмета): рисовать книгу без
        // навыка значило бы обещать действия, которых сервер не примет.
        if (spec === null || skillId === null) return null
        return {
          kind: 'book' as const,
          name: spec.nameRu,
          desc: spec.desc as string | null,
          // «Что делает» — из боевых констант, та же строка, что в
          // магазине и в карточке навыка на «Персонаже». Числа урона и лечения
          // в ней считаются от УРОВНЯ ГЕРОЯ по этому навыку (02.10.2026),
          // поэтому уровни передаются внутрь.
          stat: consumableMechanicLine(spec, player?.skillLevels ?? null, skillStats),
          qty: player?.consumables?.[spec.id] ?? 0,
          iconSrc: `${import.meta.env.BASE_URL}assets/icons/${spec.icon}` as string | null,
          equipped: false,
          levelRequired: null as number | null,
          inventoryItemId: null as string | null,
          bookId,
          skillId,
          // Цена продажи — из каталога (цена/10), одной функцией с
          // сервером: на кнопке то же число, которое начислят.
          sellPrice: consumableSellPrice(spec),
        }
      }
      const spec = consumableById(gearSelectedItem.consumableId)
      // Расходника нет в каталоге — карточки нет вовсе, вместо пустой
      // с выдуманными полями (тот же приём, что у пропавшего предмета).
      if (spec === null) return null
      return {
        kind: 'potion' as const,
        name: spec.nameRu,
        desc: spec.desc as string | null,
        // Строка механики — ровно та же, что в витрине магазина, и из
        // той же функции: у камня и оберега из эффекта каталога, у книги
        // из боевых констант скилла (с поправкой на уровень героя).
        stat: consumableMechanicLine(spec, player?.skillLevels ?? null, skillStats),
        qty: player?.consumables?.[spec.id] ?? 0,
        iconSrc: `${import.meta.env.BASE_URL}assets/icons/${spec.icon}` as string | null,
        equipped: false,
        levelRequired: null as number | null,
        inventoryItemId: null as string | null,
      }
    }
    const potionTier = Number(gearSelectedItem.potionId)
    const potion = POTION_TIERS[potionTier - 1]
    return {
      kind: 'potion' as const,
      name: potion.nameRu,
      desc: potion.desc as string | null,
      stat: `Восстанавливает ${Math.round(potion.healFrac * 100)}% от здоровья`,
      qty: potionStock?.[potionTier - 1] ?? 0,
      iconSrc: `${import.meta.env.BASE_URL}assets/icons/${potion.icon}` as string | null,
      // Поля ниже осмысленны только у предметов — у зелья заполнены
      // нейтрально, чтобы у обеих ветвей была одна форма (кнопка
      // "Надеть" в разметке всё равно стоит за kind === 'item').
      equipped: false,
      levelRequired: null as number | null,
      inventoryItemId: null as string | null,
    }
  })() : null

  const energy = liveEnergy(energyBase, energyBaseAt, now)
  const notEnoughEnergy = energy < RUN_COST
  // Снаряжение не готово — в НАСТОЯЩЕЙ сессии забег из меню не стартует: броня
  // (totalArmor) и урон оружия (weaponDamage) считаются по inventory, и без
  // него забег пошёл бы молча с бронёй 0. Вне Telegram (DevTester, статус
  // 'idle') не блокируем: сервера нет вовсе, забег там — заглушка с оранжевой
  // плашкой. Отладочные кнопки карт этот гейт намеренно обходят — их страхует
  // проверка в начале setup() в Explore.tsx (экран ошибки, энергия не списана).
  // Улучшения входят в тот же гейт, что и снаряжение: без них неизвестны урон и
  // броня, и забег пошёл бы с заниженными числами — ровно та беда, ради которой
  // гейт и заводился.
  const gearNotReady = isTelegramSession && (inventoryStatus !== 'ready' || upgradeCounts === null)
  const runBlocked = notEnoughEnergy || gearNotReady

  // Вызывается Explore РОВНО ОДИН раз, когда пришёл настоящий ответ
  // /run/finish-explore (не клиентский fallback, см. ExploreProps.onRunComplete) —
  // result.trophies/strength/endurance/agility/level — АБСОЛЮТНЫЕ значения из
  // БД, не приросты, поэтому просто перезаписываем, не складываем. Экран
  // Explore закрывается отдельно, по кнопке "В меню" на его собственном
  // ResultsScreen (см. onClose проп ниже).
  function handleExploreRunComplete(result: RunResultSummary) {
    if (player) {
      // consumables приходит с финиша только у нового сервера; нет поля —
      // прежний склад остаётся как есть (readConsumables вернёт null, и мержить
      // нечего). Подставлять выдуманный нельзя.
      const spentStock = readConsumables(result.consumables)
      if (spentStock !== null) {
        setPrepSlots(prev => prev.map((id) => (id !== null && (spentStock[id] ?? 0) >= 1 ? id : null)))
      }
      // Склад страниц после забега — тем же приёмом, что расходники: поля нет
      // (старый сервер) — прежний остаётся как есть, выдуманный не подставляем.
      // Без этого выпавшая страница не появилась бы в сумке до логина.
      const scrollStockAfter = readScrolls(result.scrolls)
      // Уровни и применения навыков после забега — тем же приёмом и по той же
      // причине (null = сервер не назвал, мержить нечего).
      const skillLevelsAfter = readSkillLevels(result.skillLevels)
      const skillUsesAfter = readSkillUses(result.skillUses)
      setPlayer(prev => prev ? {
        ...prev,
        ...(spentStock !== null ? { consumables: spentStock } : {}),
        ...(scrollStockAfter !== null ? { scrolls: scrollStockAfter } : {}),
        trophies: result.trophies,
        strength: result.strength,
        endurance: result.endurance,
        agility: result.agility,
        level: result.level,
        potions: result.potions,
        // Уровни навыков и остатки применений ПОСЛЕ забега — тем же приёмом,
        // что склад расходников выше: поля нет (старый сервер) — прежние
        // остаются как есть. Без этого карточка навыка показывала бы дорановый
        // уровень рядом с сообщением «Уровень N» на экране итогов.
        ...(skillLevelsAfter !== null ? { skillLevels: skillLevelsAfter } : {}),
        ...(skillUsesAfter !== null ? { skillUses: skillUsesAfter } : {}),
      } : prev)
    } else {
      // player===null — merge выше нечем применить (см. requestPlayerRefresh).
      // Само значение result при этом не теряется: сервер уже записал его в
      // БД (finish-explore отработал ДО того, как этот колбэк вызвался), так
      // что полный рефетч профиля вернёт те же цифры — реприменять result
      // поверх отдельно не нужно.
      requestPlayerRefresh()
    }
  }

  // Покупка улучшения. Цену НЕ передаём: её считает сервер по своему счётчику,
  // клиент называет только вид. Карточка после покупки остаётся открытой —
  // цена и строка «Урон 93 → 95» пересчитаются сами из новых счётчиков.
  async function handleBuyUpgrade(kind: UpgradeKind) {
    const token = localStorage.getItem('jwt')
    if (!token || !player) {
      setShopBuyError('Профиль не загружен — покупка недоступна.')
      return
    }
    if (shopBuyPending || shopBalanceUnknown) return
    setShopBuyPending(true)
    setShopBuyError(null)
    try {
      const result = await buyUpgrade(token, kind)
      // gold и upgrades — АБСОЛЮТНЫЕ значения из БД. upgrades === null значит
      // «сервер не назвал»: покупка прошла, но урон и броня теперь неизвестны —
      // молчать нельзя, иначе экран покажет старые числа как новые.
      setPlayer(prev => prev ? { ...prev, gold: result.gold, upgrades: result.upgrades } : prev)
      if (result.upgrades === null) {
        console.error('Buy upgrade: сервер не назвал счётчики улучшений')
        setShopBalanceUnknown(true)
        setShopBuyError('Улучшение куплено, но сервер не назвал итог. Обнови баланс.')
      }
    } catch (e) {
      console.error('Buy upgrade failed', e)
      if (e instanceof RequestError && e.serverError === 'State changed, retry') {
        // Либо не хватило золота, либо счётчик уже изменился (цена другая).
        // Сервер их не различает намеренно — для игрока это одно и то же.
        setShopBuyError('Цена или баланс изменились — обнови баланс и попробуй снова.')
        setShopBalanceUnknown(true)
        return
      }
      if (e instanceof RequestError && e.serverError !== null && !e.retryable) {
        setShopBuyError(describeBuyRefusal(e))
        return
      }
      if (e instanceof RequestError && e.retryable) {
        // Ответа нет, но запрос МОГ дойти: повторять нельзя (купит второе
        // улучшение), поэтому требуем сверки — как у покупки зелья.
        setShopBalanceUnknown(true)
        setShopBuyError('Ответ не пришёл — покупка могла пройти. Обнови баланс.')
        return
      }
      setShopBuyError('Не удалось купить — сервер не ответил. Попробуй ещё раз.')
    } finally {
      setShopBuyPending(false)
    }
  }

  // Продажа предмета из инвентаря. Цену считает сервер; клиент показывает ту,
  // что пришла с инвентарём (sellPrice каждой строки), и своей копии формулы не
  // держит. После успеха инвентарь перечитывается — проданной строки в нём уже
  // нет, и карточка закрывается сама (selectedEntry не найдёт предмет).
  async function handleSellItem(inventoryItemId: string) {
    const token = localStorage.getItem('jwt')
    if (!token) {
      setGearEquipError('Нет токена сессии — продажа недоступна.')
      return
    }
    if (sellPending) return
    setSellPending(true)
    setGearEquipError(null)
    try {
      const result = await sellItem(token, inventoryItemId)
      setPlayer(prev => prev ? { ...prev, gold: result.gold } : prev)
      showGoldToast(result.soldPrice)
      setSellConfirm(null)
      setGearSelectedItem(null)
      await loadInventory()
    } catch (e) {
      console.error('Sell item failed', e)
      const refusal = e instanceof RequestError && e.serverError !== null
        ? (e.serverError === 'Item is equipped' ? 'Сначала сними предмет.'
          : e.serverError === 'Item not found' ? 'Предмета уже нет — обнови инвентарь.'
            : e.serverError === 'State changed, retry' ? 'Предмет успели изменить — обнови инвентарь.'
              : `Сервер отказал: ${e.serverError}`)
        : 'Не удалось продать — сервер не ответил. Проверь инвентарь.'
      setGearEquipError(refusal)
      // Ответа не было — предмет МОГ продаться. Перечитываем инвентарь: он и
      // есть единственный честный источник того, что осталось.
      if (e instanceof RequestError && e.retryable) await loadInventory()
    } finally {
      setSellPending(false)
    }
  }

  // --- Книги навыков: надеть / забыть / улучшить / продать ---
  //
  // ОДИН обработчик на четыре действия, а не четыре почти одинаковых: у них
  // совпадает всё, кроме запроса — блокировка на время полёта, мерж ответа,
  // разбор отказа и развилка «ответа не было». Прежний handleSkillToggle
  // (свободная смена навыков через удалённый POST /character/skills) удалён:
  // навык теперь бывает только от книги.
  type SkillAction =
    | { kind: 'equip'; bookId: SkillBookId }
    | { kind: 'forget'; skillId: SkillBookSkillId }
    | { kind: 'upgrade'; bookId: SkillBookId }
    | { kind: 'sell'; bookId: SkillBookId }
    // Страницы ходят тем же обработчиком: у них тот же ответ сервера
    // (SkillStateResult), та же блокировка на время полёта и тот же разбор
    // отказа. Свой обработчик был бы копией на две трети.
    | { kind: 'assemble'; scrollId: ScrollId }
    | { kind: 'sellScroll'; scrollId: ScrollId }

  // Отказы сервера — словами игрока. Коды из server/src/routes/run.ts, четыре
  // ручки книг.
  function describeSkillRefusal(e: RequestError): string {
    switch (e.serverError) {
      case 'Skill already equipped': return 'Навык уже надет.'
      case 'No free skill slot': return 'Обе ячейки навыков заняты — сначала забудь один.'
      case 'Skill not equipped': return 'Этот навык не надет.'
      case 'No book in stock': return 'Книги нет на складе — обнови баланс.'
      case 'Unknown book': return 'Сервер не знает такой книги.'
      case 'Unknown scroll': return 'Сервер не знает такой страницы.'
      // Сборка книги упирается в вместимость: сервер проверяет её тем же
      // правилом, что клиент гасит кнопку, — эта строка видна, только если
      // сумка заполнилась в другой вкладке уже после отрисовки карточки.
      case 'Bag is full': return 'Сумка полна — освободи ячейку.'
      case 'Unknown skill': return 'Сервер не знает такого навыка.'
      // Книга кончилась ИЛИ набор навыков изменился — сервер эти два случая не
      // различает (см. equip-book), и для игрока они значат одно и то же.
      case 'State changed, retry': return 'Данные успели измениться — обнови баланс и попробуй снова.'
      default: return `Сервер отказал: ${e.status}${e.serverError !== null ? ` — ${e.serverError}` : ''}`
    }
  }

  async function handleSkillAction(action: SkillAction) {
    const token = localStorage.getItem('jwt')
    if (!token || !player) {
      setSkillActionError('Профиль не загружен — действие недоступно.')
      return
    }
    if (skillActionPending) return
    setSkillActionPending(true)
    setSkillActionError(null)
    try {
      const result: SkillStateResult =
        action.kind === 'equip' ? await equipBook(token, action.bookId)
          : action.kind === 'forget' ? await forgetSkill(token, action.skillId)
            : action.kind === 'upgrade' ? await upgradeSkill(token, action.bookId)
              : action.kind === 'assemble' ? await assembleBook(token, action.scrollId)
                : action.kind === 'sellScroll' ? await sellScroll(token, action.scrollId)
                  : await sellBook(token, action.bookId)
      // Все пять полей АБСОЛЮТНЫЕ и перечитаны сервером из БД — мержим как
      // есть, включая null. null здесь значит «сервер не назвал», и подставлять
      // вместо него прежнее значение нельзя: книга или страницы уже списаны, и
      // старые числа на экране были бы враньём (см. правило про тихие фолбэки).
      setPlayer(prev => prev ? {
        ...prev,
        gold: result.gold,
        consumables: result.consumables,
        scrolls: result.scrolls,
        equippedSkills: result.equippedSkills,
        skillLevels: result.skillLevels,
        // skillUses здесь НЕ мержится намеренно: книга растит уровень и счётчик
        // применений не трогает (решение дизайнера), поэтому ручки книг его и
        // не присылают. Показать его тоже негде: прогресса применений в
        // интерфейсе нет с 04.10.2026, а уровень и эффект в блоке под «что
        // делает» пересчитаются сами от нового skillLevels.
      } : prev)
      if (result.consumables === null || result.scrolls === null || result.equippedSkills === null || result.skillLevels === null) {
        console.error('Skill action: сервер ответил не полностью', action.kind, result)
        setShopBalanceUnknown(true)
        setSkillActionError('Действие прошло, но сервер назвал не всё. Обнови баланс.')
        return
      }
      // Успех — закрываем то окно, из которого действие пришло. «Забыть» живёт
      // в карточке навыка на «Персонаже», остальные три — в карточке книги.
      if (action.kind === 'forget') {
        setHeroSkillSelected(null)
        setForgetConfirm(false)
      } else {
        setGearSelectedItem(null)
      }
    } catch (e) {
      console.error('Skill action failed', action.kind, e)
      if (e instanceof RequestError && e.serverError !== null && !e.retryable) {
        setSkillActionError(describeSkillRefusal(e))
        return
      }
      if (e instanceof RequestError && e.retryable) {
        // Таймаут, обрыв сети или 5xx: ответа нет, но запрос МОГ дойти и
        // примениться — книга списана, навык надет. Повторять НЕЛЬЗЯ (потратит
        // вторую книгу), поэтому требуем сверку, как у покупки.
        setShopBalanceUnknown(true)
        setSkillActionError('Ответ не пришёл — действие могло пройти. Обнови баланс.')
        return
      }
      setSkillActionError('Не удалось — сервер не ответил или отказал. Попробуй ещё раз.')
    } finally {
      setSkillActionPending(false)
    }
  }

  // Отказ сервера по существу (4xx) — словами игрока. Коды приходят из
  // server/src/routes/run.ts, строки там английские и служебные.
  function describeBuyRefusal(e: RequestError): string {
    switch (e.serverError) {
      case 'Not enough gold': return 'Недостаточно золота — проверь баланс, он мог измениться.'
      case 'Tier not unlocked': return 'Это зелье ещё не открыто по уровню.'
      case 'Invalid count': return `Количество должно быть от 1 до ${MAX_POTIONS_PER_PURCHASE}.`
      case 'Unknown potion tier': return 'Неизвестный тир зелья.'
      case 'Unknown consumable': return 'Неизвестный расходник.'
      case 'Not unlocked': return 'Этот предмет ещё не открыт по уровню.'
      default: return `Сервер отказал: ${e.status}${e.serverError !== null ? ` — ${e.serverError}` : ''}`
    }
  }

  // tier — номер 1..5, count — сколько штук. Цену, уровень открытия и потолок
  // count проверяет ещё и сервер по СВОЕЙ копии каталога: здешние проверки
  // только для UI, доверенного источника из них не делаем.
  async function handleBuyPotion(tier: number, count: number) {
    const token = localStorage.getItem('jwt')
    if (!token || !player) {
      setShopBuyError('Профиль не загружен — покупка недоступна.')
      return
    }
    if (shopBuyPending) return
    // Баланс не сверен после потерянного ответа — покупать нельзя (см.
    // shopBalanceUnknown). Кнопка в этом состоянии и так погашена, это
    // страховка от второго пути вызова.
    if (shopBalanceUnknown) return
    const spec = POTION_TIERS[tier - 1]
    if (!spec) {
      setShopBuyError('Неизвестный тир зелья.')
      return
    }
    // Тем же разбором, что у сервера (общий каталог) — чтобы отказ выглядел
    // одинаково с обеих сторон.
    const safeCount = parsePurchaseCount(count)
    if (safeCount === null) {
      setShopBuyError(`Количество должно быть от 1 до ${MAX_POTIONS_PER_PURCHASE}.`)
      return
    }
    const total = spec.price * safeCount
    if (player.gold < total) {
      setShopBuyError(`Недостаточно золота (нужно ${total}).`)
      return
    }
    // Склад ДО покупки — с ним сверяем ответ: сервер мог продать меньше, чем
    // просили (например, старая версия, которая про count не знает).
    const before = player.potions[tier - 1] ?? 0
    setShopBuyPending(true)
    setShopBuyError(null)
    try {
      const result = await buyPotion(token, tier, safeCount)
      // gold/potions — абсолютные значения из БД, поэтому меню обновляется
      // сразу, без перезахода.
      setPlayer(prev => prev ? { ...prev, gold: result.gold, potions: result.potions } : prev)
      const added = (result.potions[tier - 1] ?? 0) - before
      if (added !== safeCount) {
        // Молчаливый успех здесь соврал бы: игрок просил N, а получил другое.
        setShopBuyError(`Сервер продал ${Math.max(0, added)} из ${safeCount}.`)
      }
    } catch (e) {
      console.error('Buy potion failed', e)
      if (e instanceof RequestError && e.retryable) {
        // Таймаут, обрыв сети или 5xx: ответа нет, но запрос МОГ дойти и
        // примениться. Повторять нельзя (спишет второй раз), продолжать
        // покупки тоже — сначала сверка.
        setShopBalanceUnknown(true)
        setShopBuyError('Ответ не пришёл — покупка могла пройти. Обнови баланс.')
      } else if (e instanceof RequestError) {
        setShopBuyError(describeBuyRefusal(e))
      } else {
        setShopBuyError('Не удалось купить — сервер отказал. Попробуй ещё раз.')
      }
    } finally {
      setShopBuyPending(false)
    }
  }

  // Покупка расходника. Устроена ТЕМ ЖЕ образом, что handleBuyPotion выше, и
  // делит с ней всё состояние: shopBuyPending, shopBuyError, shopBalanceUnknown.
  // Отдельная функция, а не ветка внутри одной: у зелий свой каталог, свой
  // потолок и своя форма ответа сервера.
  async function handleBuyConsumable(id: ConsumableId, count: number) {
    const token = localStorage.getItem('jwt')
    if (!token || !player) {
      setShopBuyError('Профиль не загружен — покупка недоступна.')
      return
    }
    if (shopBuyPending) return
    // Баланс не сверен после потерянного ответа — покупать нельзя (см.
    // shopBalanceUnknown). Кнопка в этом состоянии и так погашена, это
    // страховка от второго пути вызова.
    if (shopBalanceUnknown) return
    const spec = consumableById(id)
    if (spec === null) {
      setShopBuyError('Неизвестный расходник.')
      return
    }
    // Тем же разбором, что у сервера (общий каталог) — чтобы отказ выглядел
    // одинаково с обеих сторон.
    const safeCount = parseConsumableCount(count)
    if (safeCount === null) {
      setShopBuyError(`Количество должно быть от 1 до ${MAX_CONSUMABLES_PER_PURCHASE}.`)
      return
    }
    const total = spec.price * safeCount
    if (player.gold < total) {
      setShopBuyError(`Недостаточно золота (нужно ${total}).`)
      return
    }
    // Запас ДО покупки — с ним сверяем ответ. null значит «запас неизвестен», и
    // тогда сверять нечем: проверку ниже пропускаем, а не считаем от нуля.
    const before = player.consumables === null ? null : (player.consumables[id] ?? 0)
    setShopBuyPending(true)
    setShopBuyError(null)
    try {
      const result = await buyConsumable(token, id, safeCount)
      if (result.consumables === null) {
        // Золото сервер назвал, склад — нет. Покупка ПРОШЛА, но показывать
        // нечего: молча оставить прежнее число значило бы соврать. Сообщаем и
        // требуем сверку, как при потерянном ответе.
        console.error('Buy consumable: сервер не назвал склад расходников')
        setPlayer(prev => prev ? { ...prev, gold: result.gold, consumables: null } : prev)
        setShopBalanceUnknown(true)
        setShopBuyError('Покупка прошла, но сервер не назвал запас. Обнови баланс.')
        return
      }
      // gold/consumables — абсолютные значения из БД, поэтому экран обновляется
      // сразу, без перезахода.
      const stock = result.consumables
      setPlayer(prev => prev ? { ...prev, gold: result.gold, consumables: stock } : prev)
      if (before !== null) {
        const added = (stock[id] ?? 0) - before
        if (added !== safeCount) {
          // Молчаливый успех здесь соврал бы: игрок просил N, а получил другое.
          setShopBuyError(`Сервер продал ${Math.max(0, added)} из ${safeCount}.`)
        }
      }
    } catch (e) {
      console.error('Buy consumable failed', e)
      if (e instanceof RequestError && e.retryable) {
        // Таймаут, обрыв сети или 5xx: ответа нет, но запрос МОГ дойти и
        // примениться. Повторять нельзя (спишет второй раз), продолжать покупки
        // тоже — сначала сверка. Ровно та же развилка, что у зелий.
        setShopBalanceUnknown(true)
        setShopBuyError('Ответ не пришёл — покупка могла пройти. Обнови баланс.')
      } else if (e instanceof RequestError) {
        setShopBuyError(describeBuyRefusal(e))
      } else {
        setShopBuyError('Не удалось купить — сервер отказал. Попробуй ещё раз.')
      }
    } finally {
      setShopBuyPending(false)
    }
  }

  // Склад расходников ПОСЛЕ старта забега — из ответа сервера (Explore зовёт это
  // ровно один раз, сразу после удачного /run/start-explore, и только если
  // расходники реально брали).
  //
  // Гнездо остаётся заполненным, если запас ещё ≥ 1 — чтобы не переклад́ывать
  // камень руками перед каждым забегом. Кончился — гнездо чистится: иначе
  // следующий старт отправил бы предмет, которого нет, и получил бы 400.
  function handleConsumablesSpent(stock: Record<ConsumableId, number>) {
    setPlayer(prev => prev ? { ...prev, consumables: stock } : prev)
    setPrepSlots(prev => prev.map((id) => (id !== null && (stock[id] ?? 0) >= 1 ? id : null)))
  }

  // Сверка баланса после потерянного ответа. ТОЛЬКО чтение
  // (GET /character/profile) — не полный вход: loginWithTelegram закрыл бы
  // открытый на сервере забег, а кнопка «обновить» такого права не имеет.
  // Зовётся из двух мест: карточки зелья и окна обмена — сверяет и то, и другое
  // одним запросом, поэтому гасит ошибки обоих.
  async function handleRefreshBalance() {
    const token = localStorage.getItem('jwt')
    if (!token) {
      setShopBuyError('Профиль не загружен — сверка недоступна.')
      setExchangeError('Профиль не загружен — сверка недоступна.')
      return
    }
    if (shopBalancePending) return
    setShopBalancePending(true)
    try {
      const profile = await fetchProfile(token)
      // trophies мержится наравне с золотом: обмен меняет ОБА числа, и сверять
      // после него только золото значило бы оставить в шапке банк, которого
      // уже нет.
      // consumables мержится наравне со складом зелий: покупка камня меняет и
      // золото, и его запас, и сверять после неё только зелья значило бы оставить
      // на экране неверное число камней. null из профиля перезаписывает намеренно
      // — сервер, перестав присылать поле, означает именно «запас неизвестен».
      setPlayer(prev => prev ? { ...prev, gold: profile.gold, trophies: profile.trophies, potions: profile.potions, consumables: profile.consumables, scrolls: profile.scrolls } : prev)
      // Курс — из этого же ответа, ПЕРЕЗАПИСЬЮ, в том числе в null. Сервер,
      // перестав его присылать, означает именно "курс неизвестен": сохранить
      // прежнее число было бы тихим фолбэком на устаревшее значение.
      setTrophyGoldRate(profile.trophyGoldRate)
      // Состояние снова известно — покупки и обмен разблокированы.
      setShopBalanceUnknown(false)
      setExchangeBalanceStale(false)
      setShopBuyError(null)
      setExchangeError(null)
    } catch (e) {
      // Сбой сверки тоже виден: молча оставить игрока с погашенной кнопкой и
      // без объяснения нельзя. Блокировка сохраняется, кнопка остаётся.
      console.error('Fetch profile failed', e)
      setShopBuyError('Баланс не сверен — сервер не ответил. Попробуй ещё раз.')
      setExchangeError('Баланс не сверен — сервер не ответил. Попробуй ещё раз.')
    } finally {
      setShopBalancePending(false)
    }
  }

  // Полный обмен банка трофеев на золото. Курс применяет СЕРВЕР — клиент его
  // только показывает (см. trophyGoldRate), а gold/trophies после обмена берёт
  // из ответа, а не считает сам.
  async function handleExchangeTrophies() {
    const token = localStorage.getItem('jwt')
    if (!token) {
      // Вне Telegram (заглушка DevTester) токена нет и сервера нет — это не сбой,
      // и говорить про "попробуй ещё раз" здесь было бы ложью.
      setExchangeError('Обмен работает только в Telegram — здесь сервера нет.')
      return
    }
    if (player === null) {
      setExchangeError('Профиль не загружен — обмен недоступен.')
      return
    }
    if (exchangePending) return
    // Все три — страховка от второго пути вызова: кнопка в этих состояниях уже
    // погашена (см. разметку окна).
    if (shopBalanceUnknown) return
    if (trophyGoldRate === null) return
    if (player.trophies <= 0) return
    setExchangePending(true)
    setExchangeError(null)
    try {
      const result = await exchangeTrophies(token)
      // Абсолютные значения из БД — не расчёт по курсу на клиенте.
      setPlayer(prev => prev ? { ...prev, gold: result.gold, trophies: result.trophies } : prev)
      // Вкладка остаётся открытой — числа на ней просто пересчитаются от нового
      // player (трофеи 0, золото выросло), а прибавку назовёт тост ниже.
      setExchangeBalanceStale(false)
      showGoldToast(result.goldGained)
    } catch (e) {
      console.error('Exchange trophies failed', e)
      if (e instanceof RequestError && e.retryable) {
        // Таймаут, обрыв сети или 5xx: ответа нет, но обмен МОГ примениться.
        // Дальше нельзя ни обменивать, ни покупать — ровно то же состояние, что
        // у потерянного ответа покупки, поэтому и флаг тот же.
        setShopBalanceUnknown(true)
        setExchangeError('Ответ не пришёл — обмен мог пройти. Обнови баланс.')
      } else if (e instanceof RequestError && e.serverError === 'Run in progress') {
        setExchangeError('Идёт забег — обмен после его окончания.')
      } else if (
        e instanceof RequestError &&
        (e.serverError === 'No trophies to exchange' || e.serverError === 'State changed, retry')
      ) {
        // Оба кода означают, что сервер не записал НИЧЕГО, а показанный банк
        // разошёлся с базой. Покупки не блокируем — блокировать нечего.
        setExchangeBalanceStale(true)
        setExchangeError('Баланс изменился.')
      } else if (e instanceof RequestError) {
        // Текст сервера как есть — придумывать за него объяснение нельзя.
        setExchangeError(`Не удалось обменять: ${e.serverError ?? `сервер отказал (${e.status})`}`)
      } else {
        setExchangeError('Не удалось обменять — неизвестная ошибка.')
      }
    } finally {
      setExchangePending(false)
    }
  }

  // Тост "+N золота". Прежний таймер снимается, иначе второй обмен подряд
  // получил бы тост, погашенный таймером первого.
  function showGoldToast(amount: number) {
    if (goldToastTimerRef.current !== null) clearTimeout(goldToastTimerRef.current)
    setGoldToast(amount)
    goldToastTimerRef.current = window.setTimeout(() => {
      setGoldToast(null)
      goldToastTimerRef.current = null
    }, 2600)
  }

  async function loadInventory() {
    const token = localStorage.getItem('jwt')
    // Токена нет — это офлайн-заглушка DevTester (вне Telegram), а не сбой и
    // не пустой инвентарь. Помечаем отдельным состоянием, чтобы UI сказал
    // это словами, а не нулём брони.
    if (!token) {
      setInventoryStatus('idle')
      return
    }
    setInventoryStatus('loading')
    try {
      const res = await fetchInventory(token)
      setInventory(res.inventory)
      setInventoryStatus('ready')
    } catch (e) {
      // console.error остаётся для консоли, но ОДНОГО его мало: отказ обязан
      // быть виден на экране (см. ветки inventoryStatus в разметке ниже) —
      // иначе он неотличим от честного "ничего не надето".
      console.error('Load inventory failed', e)
      setInventoryStatus('error')
    }
    // finally нет намеренно: статус выставляют обе ветки сами, и сбрасывать
    // его в конце нечем — 'ready' и 'error' должны дожить до следующего
    // запроса, а не до конца этой функции.
  }

  async function handleEquipItem(inventoryItemId: string, equip: boolean) {
    const token = localStorage.getItem('jwt')
    // Без токена — не молчим: тап по кнопке обязан что-то сказать.
    if (!token) {
      setGearEquipError('Снаряжение недоступно — ты вне мира.')
      return
    }
    // Второй тап, пока летит первый запрос, — игнорируем (кнопка и так
    // погашена, см. разметку карточки).
    if (equipping) return
    setEquipping(true)
    setGearEquipError(null)
    try {
      await equipItem(token, inventoryItemId, equip)
      await loadInventory()
      // Закрываем карточку выбранной ячейки (прежнее состояние selectedItem
      // удалено — им никто не пользовался, см. gearSelectedItem).
      setGearSelectedItem(null)
    } catch (e) {
      // console.error остаётся для консоли, но одного его мало — отказ
      // обязан быть виден в карточке.
      console.error('Equip item failed', e)
      if (e instanceof RequestError && e.retryable) {
        // Таймаут, обрыв сети или 5xx: ответа нет, но запрос МОГ дойти и
        // примениться. Гадать нельзя — перечитываем инвентарь, и экран
        // покажет то, что на сервере на самом деле. Повторять сам equip не
        // нужно: сервер пишет булево по значению, но второй запрос всё равно
        // ничего не добавит к неизвестности, а перечитывание отвечает точно.
        setGearEquipError('Ответ не пришёл — обновляю инвентарь.')
        await loadInventory()
      } else {
        // 400 — отказ по существу, у сервера он по-русски ("Недостаточный
        // уровень"), показываем как есть. Остальное — 401/404 с английским
        // служебным текстом — игроку общей строкой.
        setGearEquipError(
          e instanceof RequestError && e.status === 400 && e.serverError !== null
            ? e.serverError
            : `Не удалось ${equip ? 'надеть' : 'снять'} — сервер не ответил или отказал. Попробуй ещё раз.`,
        )
      }
    } finally {
      // Разблокируется в ЛЮБОМ исходе, включая перезагрузку инвентаря выше.
      setEquipping(false)
    }
  }
  // Вкладка "Инвентарь" (activeTab === 'gear' — id исторический, см. навбар)
  // работает на РЕАЛЬНОМ inventory с сервера; хардкод TEST_INVENTORY/
  // ITEM_CATALOG удалён. Ссылки ниже — остатки, которые вкладка пока не
  // использует: нужны только чтобы TS (noUnusedLocals) не считал этот код
  // мёртвым.
  void SlotIcon

  if (loading) return <div style={{ padding: 20 }}>⏳ Загрузка...</div>
  // Вход не удался после всех повторов (см. runInitialLogin). Раньше здесь
  // была строка с текстом исключения и без выхода: игроку оставалось только
  // закрыть Mini App. Теперь — причина словами и кнопка, повторяющая вход с
  // нуля. В игру с пустым/подставленным профилем не пускаем ни при каком
  // исходе: player остался null, и рисовать по нему нечего.
  if (error) return (
    <div style={{
      position:'fixed', inset:0, display:'flex', flexDirection:'column',
      alignItems:'center', justifyContent:'center', gap:16, padding:24,
      background:C.appBg, textAlign:'center',
    }}>
      <div style={{ fontFamily:FONT_DISPLAY, fontSize:16, color:C.danger, letterSpacing:0.5 }}>
        НЕ УДАЛОСЬ ВОЙТИ
      </div>
      <div style={{ fontSize:13, lineHeight:1.5, color:C.textDim, maxWidth:320 }}>
        {error}
      </div>
      <button
        onClick={() => { void runInitialLogin() }}
        style={{
          fontFamily:FONT_DISPLAY, fontSize:14, letterSpacing:0.5,
          color:C.glowCore, background:C.nicheDeep,
          border:`1px solid ${C.stoneDark}`, borderRadius:8,
          padding:'10px 26px', cursor:'pointer',
        }}>
        Повторить
      </button>
    </div>
  )

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'sans-serif', color: 'white',
      backgroundColor: C.appBg,
      // Каменный фон меты — везде, КРОМЕ explore (у неё будет свой фон позже).
      // backgroundColor остаётся подложкой на случай, если картинка не загрузилась.
      ...(activeTab !== 'explore' ? {
        backgroundImage: `url(${import.meta.env.BASE_URL}assets/meta_bg.jpg)`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      } : {}),
    }}>
      <div style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        padding: 20,
        paddingBottom: 'calc(96px + env(safe-area-inset-bottom))',
        WebkitMaskImage: 'linear-gradient(to bottom, black calc(100% - 96px), transparent calc(100% - 56px))',
        maskImage: 'linear-gradient(to bottom, black calc(100% - 96px), transparent calc(100% - 56px))',
      }}>
      {activeTab !== 'explore' && (
        <div>
          {activeTab === 'hero' && (() => {
            // player === null здесь означает, что данные реально отсутствуют
            // (после initial-loading guard выше по файлу это уже не должно
            // случаться в норме — если случилось, значит player где-то
            // молча обнулился, см. диагностику ниже по компоненту). Раньше
            // тут были фолбэки вида `?? 10`/`?? 0` на каждое поле — они
            // рисовали правдоподобные, но ложные цифры вместо того, чтобы
            // показать, что данных нет. Явный guard + локальная `p` без `?.`
            // не даёт этому случиться снова незаметно.
            if (!player) {
              return <div style={{ padding: 20, color: C.textDim, fontSize: 12 }}>Данные персонажа недоступны.</div>
            }
            const p = player
            const sectionHeaderStyle = {
              fontSize:10, letterSpacing:1, color:C.textDim, marginBottom:7, fontFamily:FONT_DISPLAY,
            }
            const HERO_SKILL_NAMES: Record<string, string> = {
              heal:'Лечение', dash:'Рывок-удар', fireball:'Огненный шар', slash:'Разрез', iceball:'Ледяной шар',
            }
            // Гнёзда навыков: MAX_EQUIPPED_SKILLS позиций из общего каталога, а
            // не литеральные [0, 1] — число слотов проверяет ещё и сервер, и двум
            // копиям расходиться нельзя.
            // equippedSkills === null значит «сервер не назвал» (см. PlayerData) —
            // это НЕ пустые гнёзда, и подпись в слоте будет другая.
            const heroSkillsKnown = p.equippedSkills !== null
            const heroSkillSlots: (string | null)[] = Array.from(
              { length: MAX_EQUIPPED_SKILLS },
              (_, i) => p.equippedSkills?.[i] ?? null,
            )
            // Броня, Удача и Урон (слагаемое надетого оружия) считаются по
            // НАДЕТЫМ предметам, то есть по inventory — и врали бы нулём, пока
            // он не загружен (см. inventoryStatus). Ноль здесь неотличим от
            // честного "ничего не надето", поэтому вне 'ready' ставим прочерк
            // (у Урона — через weaponDamage === null). Остальные три стата
            // приходят из player и этой оговорки не требуют — player
            // уже закрыт guard'ом "Данные персонажа недоступны" выше.
            const equipStatsKnown = inventoryStatus === 'ready'
            const charStats: { iconSrc: string; value: number | string; label: string }[] = [
              { iconSrc: `${import.meta.env.BASE_URL}assets/icons/icon_damage.png`, value: weaponDamage === null || attackUpgradeBonus === null ? '—' : playerAttackDamage(p.strength, weaponDamage, attackUpgradeBonus), label:'Урон' },
              { iconSrc: `${import.meta.env.BASE_URL}assets/icons/icon_armor.png`, value: totalArmor ?? '—', label:'Броня' },
              { iconSrc: `${import.meta.env.BASE_URL}assets/icons/icon_hp.png`, value: p.endurance, label:'Выносл.' },
              { iconSrc: `${import.meta.env.BASE_URL}assets/icons/icon_strength.png`, value: p.strength, label:'Сила' },
              { iconSrc: `${import.meta.env.BASE_URL}assets/icons/icon_agility.png`, value: p.agility, label:'Ловкость' },
              { iconSrc: `${import.meta.env.BASE_URL}assets/icons/icon_luck.png`, value: equipStatsKnown ? inventory.filter(i => i.equipped).reduce((sum, i) => sum + (i.item.luck ?? 0), 0) : '—', label:'Удача' },
            ]
            const filledEnergySegments = Math.round(energy / MAX_ENERGY * 10)

            return (
            <div style={{ padding: '0 4px', paddingBottom: 20 }}>

              {/* Шапка */}
              <div style={{ display:'flex', alignItems:'center', gap:10, padding:'20px 16px 16px' }}>
                <div style={{
                  width:46, height:46, borderRadius:'50%',
                  background:`radial-gradient(circle at 35% 30%, ${C.stoneLight}, ${C.stoneDark})`,
                  border:`2px solid ${C.outline}`,
                  boxShadow:'inset 0 2px 6px rgba(0,0,0,0.5)',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  flexShrink:0,
                }}>
                  <div style={{
                    width:37, height:37, borderRadius:'50%',
                    background: photoUrl ? 'transparent' : C.nicheDeep,
                    display:'flex', alignItems:'center', justifyContent:'center',
                    overflow:'hidden',
                  }}>
                    {photoUrl ? (
                      <img
                        src={photoUrl}
                        style={{ width:'100%', height:'100%', borderRadius:'50%', objectFit:'cover' }}
                      />
                    ) : (
                      <div style={{ fontFamily:FONT_DISPLAY, fontSize:16, color:C.bone }}>
                        {p.firstName[0]?.toUpperCase() ?? '?'}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontFamily:FONT_DISPLAY, fontSize:16, color:C.textMain }}>
                    {p.firstName}
                  </div>
                  <div style={{ fontSize:11, color:C.textDim, marginTop:2 }}>
                    — класс не выбран —
                  </div>
                </div>
                <div style={{ background:C.nicheDeep, borderRadius:6, padding:'5px 10px' }}>
                  <div style={{ fontFamily:FONT_DISPLAY, fontSize:13, color:C.glowCore }}>ур. {p.level}</div>
                </div>
              </div>

              {/* Строка валют */}
              <div style={{ margin:'0 8px 16px', background:C.nicheDeep, borderRadius:8, padding:'7px 10px', display:'flex', gap:14 }}>
                <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                  <img src={`${import.meta.env.BASE_URL}assets/icons/icon_gold.png`} alt="Золото" width={16} height={16} style={{ display:'block', objectFit:'contain' }} />
                  <span style={{ fontSize:12, color:C.bone }}>{p.gold}</span>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                  <img src={`${import.meta.env.BASE_URL}assets/icons/icon_trophy.png`} alt="Трофеи" width={16} height={16} style={{ display:'block', objectFit:'contain' }} />
                  <span style={{ fontSize:12, color:C.bone }}>{p.trophies}</span>
                </div>
              </div>

              {/* Снаряжение */}
              <div style={{ margin:'0 8px 16px' }}>
                <div style={sectionHeaderStyle}>СНАРЯЖЕНИЕ</div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(6, minmax(0, 1fr))', gap:5 }}>
                  {HERO_SLOTS.map(({ slot, label }) => {
                    const equippedItem = inventory.find(i => i.equipped && i.item.slot === slot)
                    return (
                      <div key={slot}
                        // Занятое гнездо — ТА ЖЕ карточка предмета, что в
                        // «Инвентаре» (она вынесена на уровень компонента именно
                        // ради этого), с кнопкой «Снять». Пустое — прежний путь:
                        // «Инвентарь» с фильтром по этому слоту, потому что
                        // надеть предмет можно только оттуда.
                        onClick={() => {
                          if (equippedItem) {
                            setGearSelectedItem({ kind: 'item', inventoryItemId: equippedItem.inventoryItemId })
                            setGearEquipError(null)
                            setSellConfirm(null)
                            return
                          }
                          setActiveTab('gear'); setGearTab('equipment'); setSlotFilter(slot)
                        }}
                        style={{
                          width:'100%', aspectRatio:'1', boxSizing:'border-box',
                          background: C.nicheDeep,
                          border: `1px solid ${equippedItem ? C.glowEdge : C.stoneDark}`,
                          borderRadius:10,
                          boxShadow: equippedItem
                            ? 'inset 0 0 12px rgba(209,151,68,0.35), inset 0 2px 5px rgba(0,0,0,0.5)'
                            : 'inset 0 2px 5px rgba(0,0,0,0.55)',
                          display:'flex', alignItems:'center', justifyContent:'center',
                          cursor:'pointer',
                        }}>
                        {equippedItem ? (
                          // Тот же источник, что у "Инвентаря" — itemIconSrc, НЕ
                          // item.iconPath (почему — см. комментарий у itemIconSrc).
                          // null и провал загрузки разбирает ItemIcon.
                          <ItemIcon
                            src={itemIconSrc(equippedItem.item.slot, equippedItem.item.tier)}
                            name={equippedItem.item.nameRu}
                            size={22}
                          />
                        ) : (
                          <img
                            src={`${import.meta.env.BASE_URL}assets/icons/slot_${slot}.png`}
                            alt={label}
                            width={22}
                            height={22}
                            style={{ display:'block' }}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
                {/* Сетка гнёзд читает то же inventory, что и статы выше: не
                    загрузился — шесть пустых гнёзд молча утверждают "ничего
                    не надето". Разводим это одной подписью; сами гнёзда не
                    трогаем. */}
                {!equipStatsKnown && (
                  <div style={{ marginTop:6, fontSize:10, color: inventoryStatus === 'error' ? C.danger : C.textDim }}>
                    {inventoryStatus === 'loading'
                      ? 'Снаряжение загружается…'
                      : inventoryStatus === 'error'
                        ? 'Снаряжение не загрузилось — что надето, неизвестно.'
                        : 'Снаряжение недоступно — ты вне мира.'}
                  </div>
                )}
              </div>

              {/* Скиллы */}
              <div style={{ margin:'0 8px 16px' }}>
                <div style={sectionHeaderStyle}>СКИЛЛЫ</div>
                {/* minmax(0, 1fr) — то же правило, что у витрины магазина: у
                    сетки с фиксированным числом колонок трек не должен получать
                    авто-минимум по содержимому. Здесь картинок пока нет (гнёзда
                    скиллов — заглушки), и вылета нет, но исключений из правила
                    держать в голове не нужно. */}
                <div style={{ display:'grid', gridTemplateColumns:'repeat(2, minmax(0, 1fr))', gap:7 }}>
                  {heroSkillSlots.map((raw, i) => {
                    // raw — строка из equippedSkills. Сужаем её каталогом: обложку
                    // и карточку можно рисовать только для известного навыка.
                    const skillId = parseSkillBookSkillId(raw)
                    const book = skillId === null ? null : bookBySkillId(skillId)
                    // Подпись слота, четыре разных случая — и ни один не
                    // притворяется другим:
                    //   известный навык        -> его имя;
                    //   строка есть, каталог её не знает -> сама строка (это
                    //     расхождение каталогов клиента и сервера, прятать нельзя);
                    //   навыки известны, слот пуст -> «пусто»;
                    //   навыки НЕ известны     -> «неизвестно».
                    const label = skillId !== null ? (HERO_SKILL_NAMES[skillId] ?? skillId)
                      : raw !== null ? raw
                        : heroSkillsKnown ? 'пусто' : 'неизвестно'
                    const filled = skillId !== null
                    return (
                      <div key={i}
                        // Тап открывает карточку навыка (обложка, «что делает»,
                        // уровень, «Забыть»). Пустое гнездо не нажимается: надеть
                        // навык можно только из книги в сумке, и отправлять отсюда
                        // в «Инвентарь» значило бы обещать действие, которого на
                        // этом экране нет.
                        onClick={() => {
                          if (skillId === null) return
                          setHeroSkillSelected(skillId)
                          setForgetConfirm(false)
                          setSkillActionError(null)
                        }}
                        style={{
                          boxSizing:'border-box', minHeight:44,
                          background:C.nicheDeep, borderRadius:8, padding:9,
                          display:'flex', alignItems:'center', gap:9,
                          border: `1px solid ${filled ? C.glowEdge : C.stoneDark}`,
                          boxShadow: filled ? 'inset 0 0 12px rgba(209,151,68,0.30)' : 'none',
                          cursor: filled ? 'pointer' : 'default',
                        }}>
                        {/* Обложка книги, которая дала навык (каталог, bookBySkillId).
                            Книги для навыка нет — остаётся прежний тёмный квадрат:
                            выдумывать картинку не из чего. */}
                        {book !== null ? (
                          <img
                            src={`${import.meta.env.BASE_URL}assets/icons/${book.icon}`}
                            alt={book.nameRu}
                            width={30}
                            height={30}
                            style={{ display:'block', objectFit:'contain', flexShrink:0 }}
                          />
                        ) : (
                          <div style={{ width:30, height:30, flexShrink:0, background:C.outline, borderRadius:6 }} />
                        )}
                        <div style={{ fontSize:12, minWidth:0, color: filled ? C.textMain : C.stoneDark }}>{label}</div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Характеристики */}
              <div style={{ margin:'0 8px 16px' }}>
                <div style={sectionHeaderStyle}>ХАРАКТЕРИСТИКИ</div>
                {/* minmax(0, 1fr) — то же правило. Иконки статов здесь мелкие
                    (16×16 явными width/height), поэтому вылета не было; правило
                    всё равно одно на все сетки. */}
                <div style={{ display:'grid', gridTemplateColumns:'repeat(2, minmax(0, 1fr))', gap:6 }}>
                  {charStats.map((stat, i) => (
                    <div key={i} style={{
                      background:C.nicheDeep,
                      border:`1px solid ${C.stoneDark}`,
                      borderRadius:8,
                      boxShadow:'inset 0 2px 5px rgba(0,0,0,0.55)',
                      padding:'7px 10px', display:'flex', alignItems:'center', gap:7,
                    }}>
                      <img src={stat.iconSrc} alt={stat.label} width={16} height={16} style={{ display:'block', objectFit:'contain', flex:'none' }} />
                      <div style={{ fontSize:11, color:C.textDim, flex:1 }}>{stat.label}</div>
                      <div style={{ fontFamily:FONT_DISPLAY, fontSize:14, fontWeight:900, color:C.textMain, flex:'none' }}>{stat.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Энергия */}
              <div style={{ margin:'0 8px' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                  <div style={{ fontSize:10, color:C.textDim, letterSpacing:1 }}>ЭНЕРГИЯ</div>
                  <div style={{ fontFamily:FONT_DISPLAY, fontSize:12, color:C.glowCore }}>{energy} / {MAX_ENERGY}</div>
                </div>
                <div style={{ display:'flex', gap:2, height:12 }}>
                  {Array.from({ length:10 }).map((_, i) => (
                    <div key={i} style={{
                      flex:1, borderRadius:2,
                      background: i < filledEnergySegments ? C.glowMid : C.nicheDeep,
                    }} />
                  ))}
                </div>
              </div>

              {/* Карточка НАДЕТОГО навыка (тап по гнезду выше). Оверлей той же
                  вёрстки, что карточка предмета в «Инвентаре»: тёмная подложка,
                  тап мимо закрывает, maxWidth 290.
                  Показывает обложку книги, имя навыка, «что делает» (та же строка
                  из боевых констант, что в магазине, — src/skillBooks.ts) и
                  уровень. Действие одно: «Забыть». */}
              {heroSkillSelected !== null && (() => {
                const skillId = heroSkillSelected
                const book = bookBySkillId(skillId)
                // Уровень: null значит «сервер не назвал» — прочерк, а не 1.
                const level = p.skillLevels?.[skillId] ?? null
                return (
                <div
                  onClick={() => { setHeroSkillSelected(null); setForgetConfirm(false); setSkillActionError(null) }}
                  style={{
                    position:'fixed', top:0, left:0, right:0, bottom:0,
                    background:'rgba(0,0,0,0.55)',
                    display:'flex', alignItems:'center', justifyContent:'center',
                    zIndex:1000,
                  }}>
                  <div
                    onClick={e => e.stopPropagation()}
                    style={{
                      maxWidth:290, width:'100%',
                      background:C.appBg, border:`1px solid ${C.stoneDark}`,
                      borderRadius:14, padding:16,
                    }}>
                    <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:12 }}>
                      <div style={{
                        width:64, height:64, flexShrink:0, background:C.nicheDeep, borderRadius:8,
                        boxShadow:'inset 0 2px 5px rgba(0,0,0,0.55)',
                        display:'flex', alignItems:'center', justifyContent:'center',
                      }}>
                        {book !== null && (
                          <img
                            src={`${import.meta.env.BASE_URL}assets/icons/${book.icon}`}
                            alt={book.nameRu}
                            style={{ width:54, height:54, objectFit:'contain', display:'block' }}
                          />
                        )}
                      </div>
                      <div style={{ minWidth:0 }}>
                        {/* В шапке — только имя навыка. Уровень и прогресс
                            применений отсюда УБРАНЫ 04.10.2026: уровень теперь
                            называет блок под строкой «что делает» (один на три
                            карточки, см. SkillLevelNote), а прогресса
                            применений в интерфейсе нет нигде. */}
                        <div style={{ fontSize:15, color:C.textMain }}>{HERO_SKILL_NAMES[skillId] ?? skillId}</div>
                      </div>
                    </div>

                    {/* «Что делает» — из боевых констант, не текстом. Та же
                        функция, что в карточке книги в магазине и в сумке. */}
                    <div style={{ background:C.nicheDeep, borderRadius:8, padding:'9px 11px', marginBottom:12 }}>
                      <div style={{ fontSize:12, lineHeight:1.5, color:C.bone }}>{skillBookLine(skillId, level, skillStats)}</div>
                    </div>

                    {/* Уровень навыка — тем же блоком, что в сумке и в магазине. */}
                    <SkillLevelNote level={level} />

                    {forgetConfirm ? (
                      <>
                        {/* Цена действия названа ДО подтверждения, оба её пункта:
                            книга не вернётся, уровень останется. */}
                        <div style={{ fontSize:12, lineHeight:1.5, color:C.danger, marginBottom:10, textAlign:'center' }}>
                          Книга пропадёт. Уровень навыка сохранится.
                        </div>
                        <div style={{ display:'flex', gap:8 }}>
                          <div
                            onClick={() => { if (!skillActionPending) void handleSkillAction({ kind: 'forget', skillId }) }}
                            style={{
                              flex:1, boxSizing:'border-box', minHeight:44,
                              display:'flex', alignItems:'center', justifyContent:'center',
                              background:C.nicheDeep, border:`1px solid ${C.danger}`,
                              borderRadius:9, padding:'8px 11px', textAlign:'center',
                              color:C.danger, fontSize:14,
                              cursor: skillActionPending ? 'default' : 'pointer',
                              opacity: skillActionPending ? 0.5 : 1,
                            }}>
                            {skillActionPending ? 'Забываю...' : 'Забыть'}
                          </div>
                          <div
                            onClick={() => setForgetConfirm(false)}
                            style={{
                              flex:1, boxSizing:'border-box', minHeight:44,
                              display:'flex', alignItems:'center', justifyContent:'center',
                              background:C.nicheDeep, border:`1px solid ${C.stoneDark}`,
                              borderRadius:9, padding:'8px 11px', textAlign:'center',
                              color:C.textMain, fontSize:14, cursor:'pointer',
                            }}>
                            Отмена
                          </div>
                        </div>
                      </>
                    ) : (
                      <div
                        onClick={() => setForgetConfirm(true)}
                        style={{
                          boxSizing:'border-box', minHeight:44,
                          display:'flex', alignItems:'center', justifyContent:'center',
                          background:C.nicheDeep, border:`1px solid ${C.stoneDark}`,
                          borderRadius:9, padding:'8px 11px', textAlign:'center',
                          color:C.textMain, fontSize:14, cursor:'pointer',
                        }}>
                        Забыть
                      </div>
                    )}

                    {skillActionError !== null && (
                      <div style={{ marginTop:8, fontSize:11, color:C.danger, textAlign:'center' }}>
                        {skillActionError}
                      </div>
                    )}
                  </div>
                </div>
                )
              })()}

            </div>
            )
          })()}
          {activeTab === 'shop' && (() => {
            const SHOP_TABS = ['Расходники', 'Улучшения', 'Книги', 'Обмен'] as const
            const playerLevel = player?.level ?? 1
            // Вкладки, товары которых лежат в каталоге расходников, — их рисует
            // ОДНА И ТА ЖЕ сетка ниже. Значение сужено до ConsumableShopTab
            // (каталог), поэтому фильтр по c.shopTab типизирован, а не сравнение
            // строк наугад: появится третья такая вкладка — её придётся добавить
            // и в каталог, и здесь, молча забыть не выйдет.
            const gridTab: ConsumableShopTab | null =
              shopTab === 'Расходники' || shopTab === 'Книги' ? shopTab : null
            // Витрина «Расходники» = ДВА каталога, сведённые в один список
            // ячеек: сначала зелья (src/potions.ts), затем расходники
            // (src/consumables.ts). Локальных массивов товаров в компоненте нет
            // и не должно быть — цены/уровни жили в трёх местах и уже
            // противоречили друг другу.
            // Ячейка одинаковая для обоих видов: иконка, ценник, замок по
            // уровню. Различается только `select` — что положить в shopSelected.
            type ShopCell = {
              key: string
              icon: string
              alt: string
              price: number
              levelRequired: number
              select: () => void
            }
            // Зелья — только в «Расходниках»: в каталоге расходников их нет, и
            // вкладку им назначить негде. Камень с оберегом и книги разводит поле
            // shopTab самого каталога.
            const shopCells: ShopCell[] = [
              ...(gridTab === 'Расходники' ? POTION_TIERS : []).map((p) => ({
                key: `potion-${p.tier}`,
                icon: p.icon,
                alt: p.nameRu,
                price: p.price,
                levelRequired: p.levelRequired,
                select: () => setShopSelected({ kind: 'potion' as const, tier: p.tier }),
              })),
              ...CONSUMABLES.filter((c) => c.shopTab === gridTab && gridTab !== null).map((c) => ({
                key: `consumable-${c.id}`,
                icon: c.icon,
                alt: c.nameRu,
                price: c.price,
                levelRequired: c.levelRequired,
                select: () => setShopSelected({ kind: 'consumable' as const, id: c.id }),
              })),
            ]

            // Улучшения — свой список ячеек: их «товар» это не запись каталога
            // расходников, а вид закалки, и цена у каждой СВОЯ, считанная от
            // счётчика покупок (цену показывает ячейка, поэтому считается здесь).
            // Счётчики неизвестны — ячеек нет вовсе, причину скажет строка ниже:
            // нарисовать цену первого улучшения для игрока, у которого их уже
            // пять, значило бы соврать в главном числе витрины.
            const upgradeCells: ShopCell[] = upgradeCounts === null ? [] : UPGRADE_ORDER.map((kind) => {
              const spec = UPGRADES[kind]
              return {
                key: `upgrade-${kind}`,
                icon: spec.icon,
                alt: spec.nameRu,
                price: upgradePrice(upgradeCounts[kind]),
                levelRequired: 1,
                select: () => setShopSelected({ kind: 'upgrade' as const, upgradeKind: kind }),
              }
            })
            // Что рисует сетка на открытой вкладке. Улучшения и товары каталога
            // расходников используют ОДНУ И ТУ ЖЕ ячейку (иконка, ценник, замок
            // по уровню) — различаются только источником списка.
            const gridCells: ShopCell[] = shopTab === 'Улучшения' ? upgradeCells : shopCells
            const showGrid = gridTab !== null || shopTab === 'Улучшения'

            // Модель карточки — ОДНА на оба вида товара. Иначе пришлось бы
            // дублировать ~150 строк разметки вместе со степпером, строкой
            // ошибки, блокировкой после потерянного ответа и кнопкой сверки, и
            // две копии разъехались бы при первой же правке.
            //   owned: null — запас НЕИЗВЕСТЕН (профиль не загружен или сервер не
            //     назвал склад). Не ноль: это разные состояния.
            //   mechanic: у зелья пара «подпись — значение» (как было), у
            //     расходника одна готовая строка из consumableEffectLine().
            //   stepperNote: подпись под числом; у расходника её нет.
            type ShopCardView = {
              icon: string
              nameRu: string
              desc: string
              price: number
              levelRequired: number
              mechanic: { label: string; value: string } | { line: string }
              /**
               * Навык, который улучшает эта книга, или null у всего остального
               * (зелья, камень, оберег, улучшения). От него зависит блок об
               * уровне навыка под строкой механики — у товара без навыка его нет.
               * Поле обязательное у ВСЕХ трёх ветвей намеренно: иначе доступ к
               * нему не собрался бы, а «забыли ветку» выяснилось бы на экране.
               */
              skillId: SkillBookSkillId | null
              /**
               * Сколько такого уже есть. null — запас НЕИЗВЕСТЕН (профиль не
               * загружен), undefined — у товара запаса нет ВООБЩЕ: у улучшений
               * счётчика по решению дизайнера нет, и «у тебя: 0» врало бы.
               */
              owned: number | null | undefined
              /**
               * Покупка. У зелий и расходников — степпер количества, у улучшения
               * одна кнопка: купить два улучшения разом нельзя, у второго уже
               * другая цена.
               */
              purchase:
                | { kind: 'stepper'; maxPerPurchase: number; stepperNote: string | null; buy: (qty: number) => void }
                | { kind: 'single'; label: string; buy: () => void }
            }
            const shopCard: ShopCardView | null = shopSelected === null ? null : (() => {
              if (shopSelected.kind === 'upgrade') {
                const spec = UPGRADES[shopSelected.upgradeKind]
                // Цена следующего — от СВОЕГО счётчика. Счётчиков нет (сервер не
                // назвал) — карточку не строим вовсе: цена была бы выдумана, а
                // цену применяет сервер.
                if (upgradeCounts === null) return null
                const price = upgradePrice(upgradeCounts[spec.kind])
                // Строка механики — ТЕКУЩЕЕ значение стата и то, что станет
                // после покупки. Оба числа из тех же источников, что «Персонаж»:
                // урон — playerAttackDamage, броня — totalArmor. Неизвестен хоть
                // один — пишем прочерк, а не считаем от нуля.
                const current: number | null = spec.kind === 'attack'
                  ? (player === null || weaponDamage === null || attackUpgradeBonus === null
                      ? null
                      : playerAttackDamage(player.strength, weaponDamage, attackUpgradeBonus))
                  : totalArmor
                const line = current === null
                  ? `${spec.statLabel}: данные не загружены`
                  : `${spec.statLabel} ${current} → ${current + spec.step}`
                return {
                  icon: spec.icon,
                  nameRu: spec.nameRu,
                  desc: spec.desc,
                  price,
                  // Улучшения открыты с первого уровня: ограничение здесь —
                  // только цена, и она растёт сама.
                  levelRequired: 1,
                  mechanic: { line },
                  // Улучшение — не книга, навыка у него нет.
                  skillId: null,
                  owned: undefined,
                  purchase: { kind: 'single' as const, label: 'Улучшить', buy: () => handleBuyUpgrade(spec.kind) },
                }
              }
              if (shopSelected.kind === 'potion') {
                const p = POTION_TIERS[shopSelected.tier - 1]
                if (!p) return null
                return {
                  icon: p.icon,
                  nameRu: p.nameRu,
                  desc: p.desc,
                  price: p.price,
                  levelRequired: p.levelRequired,
                  mechanic: { label: 'Восстанавливает', value: `${Math.round(p.healFrac * 100)}% от здоровья` },
                  // Зелье — не книга, уровня навыка у него нет.
                  skillId: null,
                  owned: player === null ? null : (player.potions[p.tier - 1] ?? 0),
                  purchase: {
                    kind: 'stepper',
                    maxPerPurchase: MAX_POTIONS_PER_PURCHASE,
                    // Склад зелий не ограничен, но в один забег больше трёх
                    // глотков не поедет — игрок должен узнать это ДО покупки.
                    stepperNote: `В забег берётся до ${MAX_SIPS_PER_RUN} глотков`,
                    buy: (qty: number) => handleBuyPotion(p.tier, qty),
                  },
                }
              }
              const c = consumableById(shopSelected.id)
              if (c === null) return null
              return {
                icon: c.icon,
                nameRu: c.nameRu,
                desc: c.desc,
                price: c.price,
                levelRequired: c.levelRequired,
                // Строка механики собирается ИЗ ДАННЫХ: у камня и оберега из
                // эффекта каталога, у книги — из боевых констант скилла. Числа
                // текстом здесь не дублируются (см. consumableMechanicLine).
                mechanic: { line: consumableMechanicLine(c, player?.skillLevels ?? null, skillStats) },
                // Навык, который улучшает эта книга, или null у камня и оберега:
                // от него зависит, показывать ли блок об уровне ниже.
                skillId: consumableSkillBook(c),
                // player.consumables === null означает «сервер не назвал склад»,
                // и это НЕ ноль (см. readConsumables в api.ts).
                owned: player === null || player.consumables === null ? null : (player.consumables[c.id] ?? 0),
                purchase: {
                  kind: 'stepper',
                  maxPerPurchase: MAX_CONSUMABLES_PER_PURCHASE,
                  stepperNote: null,
                  buy: (qty: number) => handleBuyConsumable(c.id, qty),
                },
              }
            })()

            return (
            <div style={{ padding: '0 4px' }}>

              {/* Шапка — только показ валют, ничего нажимаемого: обмен живёт
                  отдельной вкладкой ниже. player === null здесь недостижим (до
                  меню не дойти), но нуль вместо неизвестного числа читался бы
                  как "всё потратили" — самый дорогой симптом из возможных, см.
                  правило про тихие фолбэки в CLAUDE.md. Поэтому прочерк, а не
                  прежний `?? 0`. */}
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'20px 16px 14px' }}>
                <div style={{ fontFamily:FONT_DISPLAY, fontSize:16, color:C.textMain }}>Магазин</div>
                <div style={{ display:'flex', gap:14 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                    <img src={`${import.meta.env.BASE_URL}assets/icons/icon_gold.png`} alt="Золото" width={16} height={16} style={{ display:'block', objectFit:'contain' }} />
                    <span style={{ fontSize:12, color:C.bone }}>{player === null ? '—' : player.gold}</span>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                    <img src={`${import.meta.env.BASE_URL}assets/icons/icon_trophy.png`} alt="Трофеи" width={16} height={16} style={{ display:'block', objectFit:'contain' }} />
                    <span style={{ fontSize:12, color:C.bone }}>{player === null ? '—' : player.trophies}</span>
                  </div>
                </div>
              </div>

              {/* Вкладки разделов — пять в один ряд без переполнения на обычном
                  телефоне.
                  Места меньше, чем кажется: ширину режут ДВА родителя — контейнер
                  прокрутки (padding 20, см. корень render'а) и обёртка вкладки
                  (padding '0 4px'), то есть 48px из ширины экрана. На 360px ряду
                  остаётся 312px, и при прежних padding '6px 6px'/gap 4 он требовал
                  336–342px (замерено метриками Segoe UI и Arial на 11px) — отсюда
                  и бралась серая полоса прокрутки под вкладками.
                  Решение: базовый padding по X ужат до 2px (ряду нужно 288–294px),
                  а свободное место раздаётся вкладкам через flex:'1 1 auto' — они
                  растягиваются на всю ширину, и на 390/412px отступы внутри выходят
                  заметно больше базовых 2px. Шрифт ОСТАВЛЕН 11px.
                  min-width у flex-элементов НЕ обнулён намеренно: авто-минимум по
                  содержимому не даёт сжать вкладку до обрезки текста, поэтому на
                  очень узких экранах (320px — iPhone SE, там дефицит ~22px) ряд
                  честно прокручивается, а не калечит подписи.
                  className='no-scrollbar' (src/App.css) убирает саму полосу на всех
                  ширинах, прокрутку сохраняя: webkit-псевдоэлемент инлайн-стилем не
                  задать. */}
              <div className="no-scrollbar" style={{ display:'flex', gap:4, overflowX:'auto', marginBottom:14, padding:'0 2px' }}>
                {SHOP_TABS.map(tab => {
                  const active = shopTab === tab
                  return (
                    <div key={tab} onClick={() => setShopTab(tab)}
                      style={{
                        boxSizing:'border-box',
                        flex:'1 1 auto', textAlign:'center',
                        background:C.nicheDeep, borderRadius:6, padding:'6px 2px',
                        fontSize:11, whiteSpace:'nowrap', cursor:'pointer',
                        border: `1px solid ${active ? C.glowEdge : C.stoneDark}`,
                        color: active ? C.glowCore : C.textDim,
                      }}>
                      {tab}
                    </div>
                  )
                })}
              </div>

              {/* Витрина. Одна сетка на «Расходники» и «Книги» — различаются
                  только товары (gridTab выше), а ячейка, ценник и замок по
                  уровню у них общие.
                  Колонки — minmax(0, 1fr), а НЕ 1fr: иначе сетка вылезает за
                  экран на узком телефоне. `1fr` это `minmax(auto, 1fr)`, а у
                  трека с авто-минимумом грид-элемент получает min-width по
                  СОДЕРЖИМОМУ: иконка внутри 128×128, и её `width:100%` при
                  расчёте min-content считается за `auto`, то есть за 128px —
                  плюс padding 6 и рамка 1, ячейка требует 142px, три колонки с
                  зазорами 442px. На 375px колонкам достаётся 311px (вьюпорт
                  минус padding 20 контейнера прокрутки, 4 обёртки вкладки и 8
                  самой сетки) — третья колонка уезжала за правый край на 131px.
                  С minmax(0, ...) минимум трека равен нулю, авто-минимум
                  элемента не применяется вовсе, и иконка сжимается вместе с
                  ячейкой (на 375px — 84px). */}
              {/* Ветки покрывают ВСЕ четыре вкладки магазина: сетка товаров
                  (Расходники, Книги, Улучшения) и Обмен. Прежней заглушки
                  «скоро» больше нет — она осталась от вкладки «Снаряжение»,
                  которую убрали. */}
              {showGrid ? (
                <>
                {/* Цены улучшений считаются от счётчиков покупок. Нет счётчиков —
                    нет и цен: говорим об этом, а не рисуем пустую витрину. */}
                {shopTab === 'Улучшения' && upgradeCounts === null && (
                  <div style={{ margin:'0 8px 10px', padding:'8px 10px', borderRadius:8, background:C.nicheDeep, border:`1px solid ${C.stoneDark}`, fontSize:11, color:C.textDim }}>
                    Профиль не загружен — цены улучшений неизвестны.
                  </div>
                )}
                <div style={{ display:'grid', gridTemplateColumns:'repeat(3, minmax(0, 1fr))', gap:8, padding:'0 8px' }}>
                  {gridCells.map(cell => {
                    const unlocked = playerLevel >= cell.levelRequired
                    return (
                      <div key={cell.key}
                        onClick={() => { cell.select(); setShopBuyError(null); setShopQty(1) }}
                        style={{
                          boxSizing:'border-box',
                          position:'relative',
                          aspectRatio:'1',
                          background:C.nicheDeep,
                          border:`1px solid ${C.stoneDark}`,
                          borderRadius:10, padding:6, textAlign:'center',
                          boxShadow:'inset 0 2px 6px rgba(0,0,0,0.5)',
                          opacity: unlocked ? 1 : 0.45,
                          cursor: 'pointer',
                        }}>
                        <img
                          src={`${import.meta.env.BASE_URL}assets/icons/${cell.icon}`}
                          alt={cell.alt}
                          style={{ width:'100%', height:'100%', objectFit:'contain', display:'block' }}
                        />
                        <div style={{
                          position:'absolute', right:4, bottom:4,
                          background:'rgba(21,18,24,0.85)',
                          borderRadius:5, padding:'2px 6px',
                          fontSize:11, fontFamily:FONT_DISPLAY,
                          color: unlocked ? C.glowCore : C.textDim,
                        }}>
                          {unlocked ? cell.price : `ур. ${cell.levelRequired}`}
                        </div>
                      </div>
                    )
                  })}
                </div>
                </>
              ) : shopTab === 'Обмен' ? (() => {
                // Банк. player === null недостижим, но нулём его подменять
                // нельзя: "банк неизвестен" и "банк пуст" выглядели бы одинаково
                // (см. правило про тихие фолбэки в CLAUDE.md).
                const bank = player === null ? null : player.trophies
                const rateKnown = trophyGoldRate !== null
                const nothingToExchange = bank !== null && bank <= 0
                // Баланс под вопросом (обмен мог пройти) или сервер сказал, что
                // показанный банк устарел — в обоих случаях нужна сверка.
                const blocked = shopBalanceUnknown || exchangeBalanceStale
                const exchangeDisabled =
                  exchangePending || bank === null || !rateKnown || nothingToExchange || blocked
                // У каждой причины свой текст: игрок должен видеть ИМЕННО свою.
                const mainLabel =
                  exchangePending ? 'Обмен…'
                    : bank === null ? 'Профиль не загружен'
                      : !rateKnown ? 'Курс обмена неизвестен'
                        : nothingToExchange ? 'Нечего обменивать'
                          : `Обменять ${bank} ${trophyWord(bank)}`

                return (
                <div style={{ padding:'0 8px' }}>
                  {/* Строка обмена: трофеи → золото, ТОЛЬКО две иконки одного
                      размера. Чисел здесь нет вовсе: банк называет текст кнопки
                      ниже, а итоговое золото — сервер после обмена.
                      Высота блока = высоте иконок: строка сетки ровно 56px (оба
                      столбца — по одной картинке), alignItems:'center' ставит их на
                      один уровень и центрует стрелку, паддинг симметричный, а
                      display:'block' у img убирает зазор под картинкой от базовой
                      линии строки — иначе внизу оставалась бы лишняя полоска.
                      Колонки 1fr/auto/1fr держат стрелку точно по центру блока. */}
                  <div style={{
                    background:C.nicheDeep, border:`1px solid ${C.stoneDark}`,
                    borderRadius:10, padding:'16px 12px',
                    boxShadow:'inset 0 2px 6px rgba(0,0,0,0.55)',
                    // minmax(0, 1fr) по краям — то же правило, что у витрины:
                    // иконки здесь 56×56 явными width/height, поэтому вылета не
                    // было, но трек с авто-минимумом в сетке не нужен нигде.
                    display:'grid', gridTemplateColumns:'minmax(0, 1fr) auto minmax(0, 1fr)', alignItems:'center', gap:8,
                    marginBottom:14,
                  }}>
                    <div style={{ display:'flex', justifyContent:'center' }}>
                      <img src={`${import.meta.env.BASE_URL}assets/icons/icon_trophy.png`} alt="Трофеи" width={56} height={56} style={{ display:'block', objectFit:'contain' }} />
                    </div>
                    <span style={{ fontSize:20, color:C.stoneMid }}>→</span>
                    <div style={{ display:'flex', justifyContent:'center' }}>
                      <img src={`${import.meta.env.BASE_URL}assets/icons/icon_gold.png`} alt="Золото" width={56} height={56} style={{ display:'block', objectFit:'contain' }} />
                    </div>
                  </div>

                  {/* Курсивом и приглушённо — тем же приёмом, что описание зелья
                      в его карточке (там же fontStyle italic + C.textDim).
                      &nbsp; перед тире — чтобы оно не начинало строку при переносе
                      (сущность, а не символ: в исходнике неразрывный пробел
                      невидим и его легко потерять при правке). */}
                  <div style={{ fontSize:12, lineHeight:1.55, fontStyle:'italic', color:C.textDim, marginBottom:12 }}>
                    Трофеи тянут к земле и манят смерть. Золото легче&nbsp;— и его у тебя уже не отнимут.
                  </div>

                  {/* Курс здесь НЕ печатается: его называет сервер, и единственное
                      место, где его отсутствие видно игроку, — текст кнопки ниже
                      ("Курс обмена неизвестен"). Само состояние trophyGoldRate
                      осталось и по-прежнему решает, доступна ли кнопка. */}
                  <div style={{ fontSize:11, color:C.textDim, marginBottom:14 }}>
                    Меняются все трофеи разом.
                  </div>

                  {/* Основная кнопка во всю ширину. minHeight 44 — палец (правило
                      скилла), заливка и свечение как у "Купить" в карточке зелья:
                      одно основное действие на экран. */}
                  <div
                    onClick={() => { if (!exchangeDisabled) handleExchangeTrophies() }}
                    style={{
                      boxSizing:'border-box',
                      minHeight:44,
                      display:'flex', alignItems:'center', justifyContent:'center',
                      background:C.nicheDeep, border:`1px solid ${C.glowEdge}`,
                      borderRadius:9, padding:'11px 12px', textAlign:'center',
                      color:C.glowCore, fontSize:15,
                      cursor: exchangeDisabled ? 'default' : 'pointer',
                      opacity: exchangeDisabled ? 0.5 : 1,
                      boxShadow:'inset 0 0 12px rgba(209,151,68,0.28)',
                    }}>
                    {mainLabel}
                  </div>

                  {exchangeError !== null && (
                    <div style={{ marginTop:10, fontSize:11, color:C.danger, textAlign:'center' }}>
                      {exchangeError}
                    </div>
                  )}

                  {/* Та же кнопка и тот же обработчик, что в карточке зелья: один
                      GET /character/profile сверяет и золото со складом, и банк
                      трофеев с курсом. */}
                  {blocked && (
                    <div
                      onClick={() => { if (!shopBalancePending) handleRefreshBalance() }}
                      style={{
                        marginTop:8, background:C.nicheDeep,
                        border:`1px solid ${C.stoneDark}`, borderRadius:9,
                        padding:'9px 11px', textAlign:'center',
                        color:C.textMain, fontSize:13,
                        cursor: shopBalancePending ? 'default' : 'pointer',
                        opacity: shopBalancePending ? 0.5 : 1,
                      }}>
                      {shopBalancePending ? 'Сверяем...' : 'Обновить баланс'}
                    </div>
                  )}
                </div>
                )
              })() : null}

              {/* Карточка предмета */}
              {shopCard && (
                <div
                  onClick={() => setShopSelected(null)}
                  style={{
                    position:'fixed', top:0, left:0, right:0, bottom:0,
                    background:'rgba(0,0,0,0.55)',
                    display:'flex', alignItems:'center', justifyContent:'center',
                    zIndex:1000,
                  }}>
                  <div
                    onClick={e => e.stopPropagation()}
                    style={{
                      maxWidth:290, width:'100%',
                      background:C.appBg, border:`1px solid ${C.stoneDark}`,
                      borderRadius:14, padding:16,
                    }}>
                    <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:12 }}>
                      <div style={{
                        width:64, height:64, flexShrink:0, background:C.nicheDeep, borderRadius:8,
                        boxShadow:'inset 0 2px 5px rgba(0,0,0,0.55)',
                        display:'flex', alignItems:'center', justifyContent:'center',
                      }}>
                        <img
                          src={`${import.meta.env.BASE_URL}assets/icons/${shopCard.icon}`}
                          alt={shopCard.nameRu}
                          style={{ width:54, height:54, objectFit:'contain', display:'block' }}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize:15, color:C.textMain }}>{shopCard.nameRu}</div>
                        {/* ТОТ ЖЕ источник, что у золота в шапке — player,
                            обновляется мержем в handleBuyPotion/
                            handleBuyConsumable. Здесь раньше стоял литеральный 0
                            из визуального каркаса, и он неотличим от честного
                            "нет ни одного" — на этом уже потеряли время. Запас
                            неизвестен (профиль не загружен ИЛИ сервер не назвал
                            склад расходников) — так и пишем, нулём не подменяем
                            (см. правило про тихие фолбэки). */}
                        {/* undefined — у товара запаса нет как понятия (улучшение
                            покупается навсегда, счётчика по решению дизайнера
                            нет), и строка не рисуется совсем. null — запас есть,
                            но НЕИЗВЕСТЕН, и это надо сказать словами. */}
                        {shopCard.owned !== undefined && (
                          <div style={{ fontSize:11, color:C.textDim, marginTop:2 }}>
                            {shopCard.owned === null
                              ? 'у тебя: — (запас неизвестен)'
                              : `у тебя: ${shopCard.owned}`}
                          </div>
                        )}
                      </div>
                    </div>

                    <div style={{ fontSize:12, lineHeight:1.55, fontStyle:'italic', color:C.textDim, marginBottom:12 }}>
                      {shopCard.desc}
                    </div>

                    {/* Строка механики. У зелья это пара «подпись — значение»
                        (как было), у расходника — одна готовая строка из
                        каталога: разбивать её на две половины пришлось бы по
                        тире, а это сломалось бы на первой же правке текста. */}
                    <div style={{ background:C.nicheDeep, borderRadius:8, padding:'9px 11px', display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, marginBottom:12 }}>
                      {'line' in shopCard.mechanic ? (
                        <div style={{ flex:1, fontSize:12, color:C.bone, textAlign:'center' }}>{shopCard.mechanic.line}</div>
                      ) : (
                        <>
                          <div style={{ fontSize:12, color:C.textDim }}>{shopCard.mechanic.label}</div>
                          <div style={{ fontSize:13, color:C.bone }}>{shopCard.mechanic.value}</div>
                        </>
                      )}
                    </div>

                    {/* Уровень навыка — ТОЛЬКО у книги (у зелья, камня и оберега
                        skillId === null). Уровень берётся ГЕРОЯ по этому навыку:
                        книга в витрине одна и та же для всех, а усиление — его. */}
                    {shopCard.skillId !== null && (
                      <SkillLevelNote level={player?.skillLevels?.[shopCard.skillId] ?? null} />
                    )}

                    {playerLevel >= shopCard.levelRequired ? (() => {
                      // Явные проверки вместо `player?.gold ?? 0`: нулём
                      // подменять неизвестное золото нельзя — не загруженный
                      // профиль и пустой кошелёк это РАЗНЫЕ состояния, и второе
                      // не должно маскировать первое (см. правило про тихие
                      // фолбэки). Строка нехватки золота выводится СРАЗУ, не
                      // после тапа — тем же приёмом, что notEnoughEnergy ниже.
                      const canAfford = player !== null && player.gold >= shopCard.price
                      const affordMsg =
                        player !== null && player.gold < shopCard.price
                          ? `Недостаточно золота (нужно ${shopCard.price}).`
                          : null
                      const msg = shopBuyError ?? affordMsg
                      const buyBlocked = shopBuyPending || !canAfford || shopBalanceUnknown
                      // Строка ошибки и кнопка сверки — общие для обоих видов
                      // покупки, поэтому вынесены сюда, а не продублированы.
                      const tail = (
                        <>
                          {msg && (
                            <div style={{ marginTop:8, fontSize:11, color:C.danger, textAlign:'center' }}>
                              {msg}
                            </div>
                          )}
                          {shopBalanceUnknown && (
                            <div
                              onClick={() => { if (!shopBalancePending) handleRefreshBalance() }}
                              style={{
                                marginTop:8, background:C.nicheDeep,
                                border:`1px solid ${C.stoneDark}`, borderRadius:9,
                                padding:'9px 11px', textAlign:'center',
                                color:C.textMain, fontSize:13,
                                cursor: shopBalancePending ? 'default' : 'pointer',
                                opacity: shopBalancePending ? 0.5 : 1,
                              }}>
                              {shopBalancePending ? 'Сверяем...' : 'Обновить баланс'}
                            </div>
                          )}
                        </>
                      )
                      // Улучшение — ОДНА кнопка без степпера: два улучшения разом
                      // купить нельзя, у второго уже другая цена (она считается
                      // от счётчика). Цена в подписи — из модели карточки, то же
                      // число применит сервер.
                      if (shopCard.purchase.kind === 'single') {
                        const single = shopCard.purchase
                        return (
                          <>
                            <div
                              onClick={() => { if (!buyBlocked) single.buy() }}
                              style={{
                                boxSizing:'border-box', minHeight:44,
                                display:'flex', alignItems:'center', justifyContent:'center',
                                background:C.nicheDeep, border:`1px solid ${C.glowEdge}`,
                                borderRadius:9, padding:11, textAlign:'center',
                                color:C.glowCore, fontSize:14,
                                cursor: buyBlocked ? 'default' : 'pointer',
                                opacity: buyBlocked ? 0.5 : 1,
                                boxShadow:'inset 0 0 12px rgba(209,151,68,0.28)',
                              }}>
                              {shopBuyPending ? 'Покупка...' : `${single.label} — ${shopCard.price}`}
                            </div>
                            {tail}
                          </>
                        )
                      }
                      const stepper = shopCard.purchase
                      // Потолок степпера — меньшее из двух: сколько разрешает
                      // сервер (потолок ИЗ ОБЩЕГО КАТАЛОГА товара — свой у зелий,
                      // свой у расходников) и на сколько хватает золота. Не
                      // хватает даже на одно — maxQty 0, степпер погашен, строка
                      // прежняя.
                      const affordableMax = player === null ? 0 : Math.floor(player.gold / shopCard.price)
                      const maxQty = Math.min(stepper.maxPerPurchase, affordableMax)
                      // Зажим на случай, если золото убыло после выбора N
                      // (покупка соседнего тира, сверка баланса).
                      const qty = Math.min(Math.max(1, shopQty), Math.max(1, maxQty))
                      const totalPrice = shopCard.price * qty
                      return (
                      <>
                      {/* Цена — из каталога, она же применяется сервером: с
                          появлением тиров витринная и реальная цена наконец
                          одно и то же число, оранжевая плашка про расхождение
                          снята. */}
                      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
                        <button
                          onClick={() => setShopQty(q => Math.max(1, Math.min(q, maxQty) - 1))}
                          disabled={qty <= 1 || maxQty < 1}
                          style={{
                            width:40, height:40, flexShrink:0, borderRadius:9,
                            border:`1px solid ${C.stoneDark}`, background:C.nicheDeep,
                            color:C.textMain, fontSize:20, lineHeight:1,
                            cursor: qty <= 1 || maxQty < 1 ? 'default' : 'pointer',
                            opacity: qty <= 1 || maxQty < 1 ? 0.4 : 1,
                          }}>−</button>
                        <div style={{ flex:1, textAlign:'center' }}>
                          <div style={{ fontSize:18, color:C.textMain, fontFamily:FONT_DISPLAY }}>{maxQty < 1 ? 1 : qty}</div>
                          {/* Подпись под числом — из модели товара, не литерал: у
                              зелий это лимит глотков за забег (игрок иначе не
                              узнает, что запас сверх него в забег не поедет), у
                              расходника её нет вовсе. */}
                          {stepper.stepperNote !== null && (
                            <div style={{ fontSize:10, color:C.textDim, marginTop:2 }}>
                              {stepper.stepperNote}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => setShopQty(q => Math.min(maxQty, Math.max(1, q) + 1))}
                          disabled={qty >= maxQty || maxQty < 1}
                          style={{
                            width:40, height:40, flexShrink:0, borderRadius:9,
                            border:`1px solid ${C.stoneDark}`, background:C.nicheDeep,
                            color:C.textMain, fontSize:20, lineHeight:1,
                            cursor: qty >= maxQty || maxQty < 1 ? 'default' : 'pointer',
                            opacity: qty >= maxQty || maxQty < 1 ? 0.4 : 1,
                          }}>+</button>
                      </div>
                      <div
                        onClick={() => { if (!buyBlocked) stepper.buy(qty) }}
                        style={{
                          background:C.nicheDeep, border:`1px solid ${C.glowEdge}`,
                          borderRadius:9, padding:11, textAlign:'center',
                          color:C.glowCore, fontSize:14,
                          cursor: buyBlocked ? 'default' : 'pointer',
                          opacity: buyBlocked ? 0.5 : 1,
                          boxShadow:'inset 0 0 12px rgba(209,151,68,0.28)',
                        }}>
                        {shopBuyPending ? 'Покупка...' : `Купить ×${qty} — ${totalPrice}`}
                      </div>
                      {tail}
                      </>
                      )
                    })() : (
                      <div
                        style={{
                          background:C.nicheDeep, border:`1px solid ${C.stoneDark}`,
                          borderRadius:9, padding:11, textAlign:'center',
                          color:C.textDim, fontSize:14,
                        }}>
                        Откроется на {shopCard.levelRequired} уровне
                      </div>
                    )}
                  </div>
                </div>
              )}


            </div>
            )
          })()}
          {activeTab === 'gear' && (() => {
            // potionStock объявлен на уровне компонента (его же читает карточка
            // предмета, вынесенная туда же) — здесь повторно не считается.
            // Зелья берутся из ОБЩЕГО каталога (src/potions.ts) и из РЕАЛЬНОГО
            // склада player.potions. Предметы — из РЕАЛЬНОГО inventory
            // (GET /character/inventory, грузится при логине): фейковый
            // TEST_INVENTORY и клиентская копия каталога предметов
            // (ITEM_CATALOG с именами и строками статов) удалены. Имя, числа
            // статов и требуемый уровень теперь приходят с сервера, на клиенте
            // остался только флейвор — см. ITEM_FLAVOR и itemStatLine.
            type InvCell = {
              key: string
              /** null — неизвестный слот, картинки нет (см. itemIconSrc). */
              iconSrc: string | null
              alt: string
              /** Число — у зелий, они реально складываются в один счётчик.
               *  null — у предметов: стакинга в БД нет, каждый предмет это
               *  отдельная строка InventoryItem. */
              qty: number | null
              equipped: boolean
              group: number
              rank: number
              open: { kind: 'item'; inventoryItemId: string } | { kind: 'potion'; potionId: string } | { kind: 'consumable'; consumableId: ConsumableId } | { kind: 'scroll'; scrollId: ScrollId }
            }
            // ОДНА ячейка на ОДНУ строку InventoryItem, без бейджа "xN":
            // стакинга в БД нет (каждый предмет — своя строка), а
            // POST /character/equip адресует именно inventoryItemId. Прежний
            // qty был выдуман вместе с TEST_INVENTORY. Два одинаковых предмета
            // честно покажутся двумя ячейками.
            //
            // Sort стабильный, поэтому одинаковые предметы внутри группы
            // сохраняют порядок ответа сервера (он отдаёт инвентарь по
            // acquiredAt).
            // ⚠️ НАДЕТОЕ В СУМКЕ НЕ ПОКАЗЫВАЕТСЯ (29.09.2026, решение дизайнера):
            // надетый предмет живёт в гнезде на экране «Персонаж», и оттуда же
            // снимается. Раньше он оставался и в сетке (с рамкой), потому что
            // снять его было больше неоткуда; теперь тап по гнезду открывает ту
            // же карточку с кнопкой «Снять», и дублировать предмет в двух местах
            // незачем. Счётчик «N / 30» надетое не считал и раньше — расхождение
            // сетки и счётчика этой правкой как раз и ушло.
            const buildEquipmentCells = (rows: InventoryItem[]): InvCell[] => rows
              .filter((inv) => !inv.equipped)
              .map((inv) => ({
                key: inv.inventoryItemId,
                iconSrc: itemIconSrc(inv.item.slot, inv.item.tier),
                alt: inv.item.nameRu,
                qty: null,
                equipped: inv.equipped,
                group: SLOT_ORDER.indexOf(inv.item.slot),
                rank: -inv.item.tier,
                open: { kind: 'item' as const, inventoryItemId: inv.inventoryItemId },
              }))
              .sort((a, b) => a.group - b.group || a.rank - b.rank)
            // Фильтр по слоту (кнопки над сеткой, либо тап по гнезду на
            // "Персонаже") — операция над уже полученным массивом, запрос к
            // серверу для неё не нужен. Фильтруем ИСХОДНЫЕ строки, а не
            // готовые ячейки: у ячейки слота нет, и добавлять его туда значит
            // тащить специфику экипировки в общий тип.
            const equipmentCells = buildEquipmentCells(
              slotFilter === null ? inventory : inventory.filter((i) => i.item.slot === slotFilter),
            )

            // Расходники — СПИСОК ИСТОЧНИКОВ, а не один захардкоженный массив
            // зелий. Новый вид (обереги, карты, книги скиллов) добавляется
            // НОВЫМ элементом этого массива со своим билдером ячеек — сетка,
            // подвкладки и раскладка не трогаются.
            // Предел честно: источник с ДРУГОЙ формой данных всё равно
            // потребует ветку в union'е InvCell['open'] и в selectedEntry —
            // карточка обязана знать, что показывает. Без переделки обходится
            // раскладка, не вся цепочка.
            // note — почему источник пуст, если пуст не по-настоящему: профиль
            // не загружен (potionStock === null) это НЕ "зелий нет", и молча
            // показывать пустоту нельзя (см. правило про тихие фолбэки).
            // Инвариант: note !== null ⇔ данные источника неизвестны — на него
            // опирается и счётчик сумки ниже (bagKnown).
            // takesCell — тратит ли источник ячейки сумки (docs/items.md,
            // "Правило вместимости"): НЕ тратят только зелья; всё остальное —
            // расходники, книги, будущие карты — тратит. Решается ОДИН раз на
            // источник, счётчик в шапке подхватывает сам.
            // ⚠️ Исключение из "дропа улучшения скиллов" в том правиле — это
            // СТРАНИЦЫ (scroll_*), а не книги: страницы копятся по три на книгу
            // и выпадают в забегах, поэтому ячейку тратить не будут. Их в
            // каталоге ещё нет; появятся — своим источником с takesCell: false.
            // section — в КАКОМ разделе сумки показывать источник. Появилось
            // вместе с книгами: раньше «всё, что не экипировка» рисовалось одной
            // подвкладкой, а у книг свои действия («Надеть», «Улучшить»,
            // «Продать»), бессмысленные для зелья и камня.
            // Заполненность сумки при этом считается по ВСЕМ разделам (см. bagUsed):
            // вместимость — свойство сумки, а не открытой подвкладки.
            const consumableSources: { key: string; section: 'consumables' | 'books' | 'scrolls'; cells: InvCell[]; note: string | null; takesCell: boolean }[] = [
              {
                key: 'potions',
                section: 'consumables',
                // Зелий копятся десятки — забивать ими сумку и терять их при
                // переполнении было бы несоразмерным наказанием.
                takesCell: false,
                // Показываем только тиры, которых реально не ноль. Порядок —
                // от старшего тира к младшему (rank), как и было.
                cells: (potionStock === null ? [] : POTION_TIERS)
                  .filter((t) => (potionStock?.[t.tier - 1] ?? 0) > 0)
                  .map((t) => ({
                    key: `potion-${t.tier}`,
                    iconSrc: `${import.meta.env.BASE_URL}assets/icons/${t.icon}`,
                    alt: t.nameRu,
                    qty: potionStock?.[t.tier - 1] ?? 0,
                    equipped: false,
                    group: 0,
                    rank: -t.tier,
                    open: { kind: 'potion' as const, potionId: String(t.tier) },
                  })),
                note: potionStock === null ? 'Профиль не загружен — склад зелий неизвестен.' : null,
              },
              {
                key: 'consumables',
                section: 'consumables',
                // Расходники ячейку сумки ТРАТЯТ — в отличие от зелий: их берут
                // единицами, а не десятками (docs/items.md, "Правило
                // вместимости").
                takesCell: true,
                // Показываем только то, чего реально не ноль — тем же приёмом,
                // что тиры зелий выше. Запас неизвестен (consumables === null) —
                // ячеек нет вовсе, причину скажет note: пустая сетка и
                // "расходников нет" не должны выглядеть одинаково.
                // Только НЕ книги: книги — свой раздел ниже. Признак берётся из
                // эффекта каталога, а не из вкладки магазина.
                cells: (player?.consumables == null ? [] : CONSUMABLES)
                  .filter((c) => consumableSkillBook(c) === null)
                  .filter((c) => (player?.consumables?.[c.id] ?? 0) > 0)
                  .map((c) => ({
                    key: `consumable-${c.id}`,
                    iconSrc: `${import.meta.env.BASE_URL}assets/icons/${c.icon}`,
                    alt: c.nameRu,
                    qty: player?.consumables?.[c.id] ?? 0,
                    equipped: false,
                    // Группа 1 — ниже зелий (у тех 0): расходников мало, и они
                    // должны стоять после расходуемых в забеге зелий, а не
                    // вперемешку.
                    group: 1,
                    rank: 0,
                    open: { kind: 'consumable' as const, consumableId: c.id },
                  })),
                note: player === null
                  ? 'Профиль не загружен — запас расходников неизвестен.'
                  : player.consumables === null
                    ? 'Сервер не назвал запас расходников.'
                    : null,
              },
              {
                key: 'books',
                section: 'books',
                // Книга ячейку сумки ТРАТИТ — как камень и оберег (docs/items.md,
                // «ПРАВИЛО ВМЕСТИМОСТИ»: не тратят её только зелья и будущие
                // страницы scroll_*). Отдельный раздел — не про вместимость, а
                // про действия: книгу надевают, улучшают ею навык или продают.
                takesCell: true,
                cells: (player?.consumables == null ? [] : CONSUMABLES)
                  .filter((c) => consumableSkillBook(c) !== null)
                  .filter((c) => (player?.consumables?.[c.id] ?? 0) > 0)
                  .map((c) => ({
                    key: `consumable-${c.id}`,
                    iconSrc: `${import.meta.env.BASE_URL}assets/icons/${c.icon}`,
                    alt: c.nameRu,
                    qty: player?.consumables?.[c.id] ?? 0,
                    equipped: false,
                    group: 2,
                    rank: 0,
                    open: { kind: 'consumable' as const, consumableId: c.id },
                  })),
                // Тот же текст и та же причина, что у расходников выше: оба
                // источника читают одно поле player.consumables. Повтора на
                // экране нет — заметки показываются только своего раздела.
                note: player === null
                  ? 'Профиль не загружен — запас книг неизвестен.'
                  : player.consumables === null
                    ? 'Сервер не назвал запас книг.'
                    : null,
              },
              {
                key: 'scrolls',
                section: 'scrolls',
                // Страница ячейку сумки НЕ ТРАТИТ — единственный источник
                // наравне с зельями (docs/items.md, «ПРАВИЛО ВМЕСТИМОСТИ»):
                // страницы копятся десятками, по три на книгу, и терять их при
                // переполнении было бы несоразмерно. Это же правило применяет
                // сервер, начисляя добычу (см. resolveRunDrops).
                takesCell: false,
                // Читает СВОЁ поле player.scrolls, а не consumables: склад
                // страниц приходит отдельным полем именно потому, что вместимость
                // у них другая.
                cells: (player?.scrolls == null ? [] : SCROLLS)
                  .filter((s) => (player?.scrolls?.[s.id] ?? 0) > 0)
                  .map((s) => ({
                    key: `scroll-${s.id}`,
                    iconSrc: `${import.meta.env.BASE_URL}assets/icons/${s.icon}`,
                    alt: s.nameRu,
                    qty: player?.scrolls?.[s.id] ?? 0,
                    equipped: false,
                    group: 3,
                    rank: 0,
                    open: { kind: 'scroll' as const, scrollId: s.id },
                  })),
                note: player === null
                  ? 'Профиль не загружен — запас страниц неизвестен.'
                  : player.scrolls === null
                    ? 'Сервер не назвал запас страниц.'
                    : null,
              },
            ]
            // Что показывает сетка и какие заметки видны — ТОЛЬКО открытый
            // раздел. Заметку чужого раздела показывать нельзя не из экономии:
            // «склад зелий неизвестен» на вкладке «Книги» читалось бы как
            // поломка книг.
            const sectionSources = consumableSources.filter((src) => src.section === gearTab)
            const consumableCells: InvCell[] = sectionSources.flatMap((src) => src.cells)
            const consumableNotes: string[] = sectionSources
              .map((src) => src.note)
              .filter((n): n is string => n !== null)

            // Что показывает сетка прямо сейчас — зависит от подвкладки.
            const shownCells = gearTab === 'equipment' ? equipmentCells : consumableCells

            return (
            <div style={{ padding: '0 4px' }}>

              {/* Шапка */}
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'20px 16px 14px' }}>
                <div style={{ fontFamily:FONT_DISPLAY, fontSize:16, color:C.textMain }}>Инвентарь</div>
                {/* "N / 30" — заполненность сумки (bagUsed/bagKnown выше),
                    одинаковая на обеих подвкладках и при любом фильтре: сколько
                    показано, видно по самой сетке. Переполнение — красным и
                    как есть (см. BAG_CAPACITY). Неизвестные данные — прочерк,
                    не ноль. */}
                <div style={{ fontSize:12, color: bagKnown && bagUsed > BAG_CAPACITY ? C.danger : C.textDim }}>
                  {bagKnown ? `${bagUsed} / ${BAG_CAPACITY}` : '—'}
                </div>
              </div>

              {/* Подвкладки. Тот же приём, что у разделов магазина выше
                  (SHOP_TABS), и с 30.09.2026 — ТА ЖЕ раскладка, не только тот же
                  вид: чипов стало ЧЕТЫРЕ («Страницы»), и прежний ряд с
                  padding:'0 14px' у каждого перестал влезать на узкий экран.
                  Прикидка по метрикам: подписи 11px требуют ~60/60/30/48px
                  текста, со старыми отступами ряд просил ~352px — на 375 и 390
                  ещё влезал, на 360 впритык, на 320 (iPhone SE) вылезал за край.
                  Сжимать себя такие чипы не умеют: whiteSpace:'nowrap' даёт им
                  авто-минимум по содержимому, и лишнее просто уехало бы вправо —
                  ровно тот отказ, из-за которого в магазине терялся третий
                  столбец (см. CLAUDE.md, Critical Gotchas).
                  Решение взято готовым у ряда магазина: горизонтальная прокрутка
                  (className='no-scrollbar' прячет саму полосу, src/App.css) плюс
                  flex:'1 1 auto' на чипах — на широких экранах они растягиваются
                  на всю ширину, на узких ряд честно прокручивается, а не калечит
                  подписи и не делает документ шире экрана.
                  Высота 44px — минимум тап-зоны из дизайн-системы — СОХРАНЕНА
                  явным minHeight: padding по вертикали её больше не задаёт. */}
              <div className="no-scrollbar" style={{ display:'flex', gap:6, overflowX:'auto', marginBottom:10, padding:'0 8px' }}>
                {([
                  { id: 'equipment' as const, label: 'Экипировка' },
                  { id: 'consumables' as const, label: 'Расходники' },
                  { id: 'books' as const, label: 'Книги' },
                  // Четвёртая подвкладка. Страницы выделены НЕ по вместимости
                  // (ячейку они не тратят вовсе), а по действиям: «Собрать
                  // книгу» и «Продать» бессмысленны и для зелья, и для книги.
                  // Ряд из четырёх чипов на 360px влезает: подписи короткие,
                  // а контейнер прокручивается горизонтально не хуже трёх.
                  { id: 'scrolls' as const, label: 'Страницы' },
                ]).map((t) => {
                  const active = gearTab === t.id
                  return (
                    <div key={t.id} onClick={() => setGearTab(t.id)}
                      style={{
                        boxSizing:'border-box', minHeight:44, flex:'1 1 auto',
                        display:'flex', alignItems:'center', justifyContent:'center',
                        background:C.nicheDeep, borderRadius:6, padding:'0 6px',
                        fontSize:11, whiteSpace:'nowrap', cursor:'pointer',
                        border:`1px solid ${active ? C.glowEdge : C.stoneDark}`,
                        color: active ? C.glowCore : C.textDim,
                      }}>
                      {t.label}
                    </div>
                  )
                })}
              </div>

              {/* Фильтр по слоту — только в "Экипировке": расходники ни в один
                  слот не надеваются, фильтровать их нечем.
                  Выпадающий список, а не ряд кнопок: семь кнопок на 360px
                  вставали только сеткой 4+3 (~94px), и вместе с подвкладками
                  это три ряда управления до первой ячейки — около трети экрана.
                  Здесь одна строка 44px (минимум тап-зоны). Цена — выбор слота
                  в два тапа вместо одного, и варианты не видны без раскрытия.
                  Раскрытый список лежит ПОВЕРХ сетки (absolute), не раздвигает
                  её. Под ним прозрачная подложка на весь экран: тап мимо списка
                  попадает в неё и закрывает. Навбар подложкой не накрыть — он
                  вне прокручиваемого контейнера, а у того из-за mask свой
                  stacking context, — поэтому список закрывает и onClick
                  навбара, иначе при возврате на вкладку он был бы раскрыт.
                  Рамка кнопки подсвечена, пока выбран конкретный слот: сетка
                  урезана, и это видно без раскрытия (роль прежней плашки
                  "Только: ...").
                  Пункт "Всё" — он же сброс фильтра. */}
              {gearTab === 'equipment' && (() => {
                const options: { slot: string | null; label: string }[] = [{ slot: null, label: 'Всё' }, ...HERO_SLOTS]
                // slotFilter ставится только из HERO_SLOTS, так что промах здесь —
                // баг. Называем его вслух, а не рисуем "Всё" над урезанной сеткой.
                const currentLabel = options.find((o) => o.slot === slotFilter)?.label ?? `Неизвестный слот "${slotFilter}"`
                return (
                  <>
                    {slotFilterOpen && (
                      <div onClick={() => setSlotFilterOpen(false)}
                        style={{ position:'fixed', top:0, left:0, right:0, bottom:0, zIndex:1 }} />
                    )}
                    {/* zIndex:2 — выше подложки: тап по самой кнопке сворачивает
                        список, а не проваливается в подложку. */}
                    <div style={{ position:'relative', zIndex:2, marginBottom:10, padding:'0 8px' }}>
                      <div onClick={() => setSlotFilterOpen((open) => !open)}
                        style={{
                          boxSizing:'border-box', height:44,
                          display:'flex', alignItems:'center', justifyContent:'space-between', gap:8,
                          background:C.nicheDeep, borderRadius:6, padding:'0 12px',
                          fontSize:11, whiteSpace:'nowrap', cursor:'pointer',
                          border:`1px solid ${slotFilter !== null || slotFilterOpen ? C.glowEdge : C.stoneDark}`,
                          color: slotFilter !== null ? C.glowCore : C.textDim,
                        }}>
                        <span>{currentLabel}</span>
                        <span style={{ fontSize:9 }}>{slotFilterOpen ? '▲' : '▼'}</span>
                      </div>
                      {slotFilterOpen && (
                        <div style={{
                          position:'absolute', top:'calc(100% + 4px)', left:8, right:8,
                          boxSizing:'border-box', overflow:'hidden',
                          background:C.appBg, border:`1px solid ${C.stoneDark}`, borderRadius:8,
                          boxShadow:'0 6px 18px rgba(0,0,0,0.6)',
                        }}>
                          {options.map((o) => {
                            const active = slotFilter === o.slot
                            return (
                              <div key={o.slot ?? 'all'}
                                onClick={() => { setSlotFilter(o.slot); setSlotFilterOpen(false) }}
                                style={{
                                  boxSizing:'border-box', height:44,
                                  display:'flex', alignItems:'center', justifyContent:'space-between',
                                  padding:'0 12px', fontSize:12, cursor:'pointer',
                                  // Активный пункт — не только цветом: фон, полоса
                                  // слева и галочка (дизайн-система: не полагаться
                                  // на один цвет).
                                  background: active ? C.nicheDeep : 'transparent',
                                  borderLeft:`3px solid ${active ? C.glowEdge : 'transparent'}`,
                                  color: active ? C.glowCore : C.textMain,
                                }}>
                                <span>{o.label}</span>
                                {active && <span>✓</span>}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </>
                )
              })()}

              {/* Состояние загрузки предметов — ПЛАШКОЙ над сеткой и ТОЛЬКО в
                  "Экипировке": это неизвестность про inventory, а расходники
                  живут на своих данных (player.potions) и к ней отношения не
                  имеют. */}
              {gearTab === 'equipment' && inventoryStatus !== 'ready' && (
                <div style={{
                  margin:'0 8px 10px', padding:'8px 10px', borderRadius:8,
                  background:C.nicheDeep,
                  border:`1px solid ${inventoryStatus === 'error' ? C.danger : C.stoneDark}`,
                  fontSize:11, color: inventoryStatus === 'error' ? C.danger : C.textDim,
                  display:'flex', alignItems:'center', justifyContent:'space-between', gap:8,
                }}>
                  <span>
                    {inventoryStatus === 'loading'
                      ? 'Предметы загружаются…'
                      : inventoryStatus === 'error'
                        ? 'Предметы не загрузились — что лежит в сумке, неизвестно.'
                        : 'Предметы недоступны — ты вне мира.'}
                  </span>
                  {inventoryStatus === 'error' && (
                    <span
                      onClick={() => { void loadInventory() }}
                      style={{ flexShrink:0, color:C.glowCore, cursor:'pointer', textDecoration:'underline' }}>
                      Повторить
                    </span>
                  )}
                </div>
              )}

              {/* То же для расходников: источник, который пуст НЕ по-настоящему,
                  объясняет себя строкой (сейчас такой один — зелья при
                  незагруженном профиле). */}
              {gearTab !== 'equipment' && consumableNotes.map((note) => (
                <div key={note} style={{
                  margin:'0 8px 10px', padding:'8px 10px', borderRadius:8,
                  background:C.nicheDeep, border:`1px solid ${C.stoneDark}`,
                  fontSize:11, color:C.textDim,
                }}>
                  {note}
                </div>
              ))}

              {/* Сетка ячеек */}
              {shownCells.length === 0 ? (
                // "Пусто" утверждаем ТОЛЬКО когда данные действительно есть и
                // они пусты. В остальных состояниях пустоту уже объяснила
                // плашка выше, и повторять здесь "пусто" было бы тем же тихим
                // фолбэком. При активном фильтре сумка не пуста — пуст только
                // выбранный слот, так и пишем.
                // «Пусто» утверждаем только там, где данные реально есть:
                // экипировка — загруженный inventory, расходники — известный
                // склад зелий (у камня с оберегом свой note), книги — известный
                // склад расходников.
                (gearTab === 'equipment' ? inventoryStatus === 'ready'
                  : gearTab === 'books' ? player?.consumables != null
                    : gearTab === 'scrolls' ? player?.scrolls != null
                      : potionStock !== null) ? (
                  <div style={{ padding:'40px 0', textAlign:'center', fontSize:13, color:C.textDim }}>
                    {gearTab === 'equipment' && slotFilter !== null ? 'Для этого слота ничего нет' : 'Пусто'}
                  </div>
                ) : null
              ) : (
                <div style={{ display:'grid', gridTemplateColumns:'repeat(5, minmax(0, 1fr))', gap:5, padding:'0 8px' }}>
                  {shownCells.map((cell) => (
                    <div key={cell.key}
                      onClick={() => setGearSelectedItem(cell.open)}
                      style={{
                        boxSizing:'border-box', position:'relative', aspectRatio:'1',
                        background:C.nicheDeep,
                        // Рамка со свечением у занятой ячейки. С 29.09.2026 в
                        // сетке экипировки её не видно никогда: надетое в сумку
                        // больше не попадает (см. buildEquipmentCells), а у
                        // расходников и книг equipped всегда false. Правило
                        // оставлено как есть — оно верно по построению, а не
                        // случайно: уберут фильтр — подсветка снова заработает.
                        border:`1px solid ${cell.equipped ? C.glowEdge : C.stoneDark}`,
                        borderRadius:8,
                        boxShadow: cell.equipped
                          ? 'inset 0 0 12px rgba(209,151,68,0.35), inset 0 2px 5px rgba(0,0,0,0.5)'
                          : 'inset 0 2px 5px rgba(0,0,0,0.5)',
                        cursor:'pointer',
                      }}>
                      {/* null (неизвестный слот) и провал загрузки — в ItemIcon. */}
                      <ItemIcon src={cell.iconSrc} name={cell.alt} size="fill" />
                      {cell.qty !== null && cell.qty > 1 && (
                        <div style={{ position:'absolute', right:2, bottom:1, fontSize:9, color:C.bone }}>×{cell.qty}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Карточка предмета */}

            </div>
            )
          })()}
          {activeTab === 'friends' && (() => {
            const INVITED_FRIENDS: { name: string; level: number; rewarded: boolean }[] = []
            const REFERRAL_URL = 'https://t.me/RightPlaceGame_bot/game'

            const handleInvite = () => {
              const text = 'Играю в Right Place — roguelike в Telegram. Присоединяйся!'
              window.open(`https://t.me/share/url?url=${encodeURIComponent(REFERRAL_URL)}&text=${encodeURIComponent(text)}`, '_blank')
            }

            const handleCopyLink = () => {
              navigator.clipboard.writeText(REFERRAL_URL)
              setFriendsLinkCopied(true)
              setTimeout(() => setFriendsLinkCopied(false), 2000)
            }

            return (
            <div style={{ padding: '0 4px' }}>

              {/* Шапка */}
              <div style={{ textAlign:'center', marginBottom:16, padding:'20px 16px 0' }}>
                <div style={{ fontFamily:FONT_DISPLAY, fontSize:17, color:C.textMain }}>Друзья</div>
                <div style={{ fontSize:11, color:C.textDim, marginTop:2 }}>Один пришёл — награду получают оба</div>
              </div>

              <div style={{ padding:'0 8px' }}>

                {/* Блок награды */}
                <div style={{
                  background:C.nicheDeep, border:`1px solid ${C.stoneDark}`,
                  borderRadius:12, padding:'18px 14px',
                  boxShadow:'inset 0 2px 8px rgba(0,0,0,0.55)',
                  marginBottom:10,
                }}>
                  <div style={{ textAlign:'center', fontSize:10, letterSpacing:1.5, color:C.textDim, marginBottom:14 }}>
                    ЗА КАЖДОГО ДРУГА
                  </div>
                  <div style={{ display:'flex', justifyContent:'center', alignItems:'center', gap:22, marginBottom:14 }}>
                    <div style={{ display:'flex', flexDirection:'column', alignItems:'center' }}>
                      <img src={`${import.meta.env.BASE_URL}assets/icons/icon_gold.png`} alt="Золото" width={38} height={38} style={{ display:'block', objectFit:'contain' }} />
                      <div style={{ fontFamily:FONT_DISPLAY, fontSize:22, color:C.glowCore, lineHeight:1, marginTop:6 }}>5 000</div>
                      <div style={{ fontSize:10, color:C.textDim, marginTop:4 }}>золота</div>
                    </div>
                    <div style={{ width:1, height:56, background:C.stoneDark }} />
                    <div style={{ display:'flex', flexDirection:'column', alignItems:'center' }}>
                      <img src={`${import.meta.env.BASE_URL}assets/icons/icon_rp.png`} alt="RP" width={38} height={38} style={{ display:'block', objectFit:'contain' }} />
                      <div style={{ fontFamily:FONT_DISPLAY, fontSize:22, color:C.glowCore, lineHeight:1, marginTop:6 }}>5</div>
                      <div style={{ fontSize:10, color:C.textDim, marginTop:4 }}>RP</div>
                    </div>
                  </div>
                  <div style={{ textAlign:'center', fontSize:11, color:C.textDim, lineHeight:1.5 }}>
                    Начисляется обоим, когда друг дойдёт до 3 уровня
                  </div>
                </div>

                {/* Кнопка приглашения */}
                <div
                  onClick={handleInvite}
                  style={{
                    background:C.nicheDeep, border:`1px solid ${C.glowEdge}`,
                    borderRadius:10, padding:13, textAlign:'center',
                    boxShadow:'inset 0 0 14px rgba(209,151,68,0.3)',
                    marginBottom:10, cursor:'pointer',
                  }}>
                  <span style={{ fontFamily:FONT_DISPLAY, fontSize:14, color:C.glowCore }}>Пригласить друга</span>
                </div>

                {/* Плашка со ссылкой */}
                <div style={{
                  background:C.nicheDeep, border:`1px solid ${C.stoneDark}`,
                  borderRadius:9, padding:'9px 11px',
                  display:'flex', alignItems:'center', gap:9,
                  boxShadow:'inset 0 2px 5px rgba(0,0,0,0.5)',
                  marginBottom:18,
                }}>
                  <div style={{ fontSize:11, color:C.textDim, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {REFERRAL_URL}
                  </div>
                  <div onClick={handleCopyLink} style={{ fontSize:11, color:C.bone, whiteSpace:'nowrap', cursor:'pointer' }}>
                    {friendsLinkCopied ? 'скопировано' : 'копировать'}
                  </div>
                </div>

                {/* Список приглашённых */}
                <div>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:8 }}>
                    <div style={{ fontSize:10, letterSpacing:1.5, color:C.textDim }}>ПРИГЛАШЕНО</div>
                    <div style={{ fontFamily:FONT_DISPLAY, fontSize:13, color:C.textMain }}>{INVITED_FRIENDS.length}</div>
                  </div>

                  {INVITED_FRIENDS.length === 0 ? (
                    <div style={{
                      border:`1px dashed ${C.stoneDark}`, borderRadius:10,
                      padding:'26px 14px', textAlign:'center',
                    }}>
                      <img
                        src={`${import.meta.env.BASE_URL}assets/icons/nav_friends.png`}
                        alt=""
                        width={40} height={40}
                        style={{ display:'block', margin:'0 auto', opacity:0.5 }}
                      />
                      <div style={{ fontSize:12, color:C.stoneDark, lineHeight:1.5, marginTop:10 }}>
                        Здесь появятся те, кого ты привёл
                      </div>
                    </div>
                  ) : (
                    <div>
                      {INVITED_FRIENDS.map((friend, i) => (
                        <div key={i} style={{
                          background:C.nicheDeep, borderRadius:8, padding:'9px 11px',
                          display:'flex', alignItems:'center', gap:10,
                          marginBottom:6,
                        }}>
                          <div style={{ width:28, height:28, flexShrink:0, background:C.outline, borderRadius:'50%' }} />
                          <div style={{ fontSize:12, color:C.textMain, flex:1 }}>{friend.name}</div>
                          {friend.rewarded ? (
                            <div style={{ fontSize:11, color:C.bone }}>награда получена</div>
                          ) : (
                            <div style={{ fontSize:11, color:C.textDim }}>ур. {friend.level}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>
            </div>
            )
          })()}
        </div>
      )}
      {activeTab === 'explore' && (
        <div style={{
          position:'fixed', top:0, left:0, right:0, bottom:0,
          display:'flex', flexDirection:'column',
          backgroundColor:C.appBg,
          padding:'20px 8px 0',
          zIndex:1,
        }}>

          {/* Слой 1 — фон */}
          <div style={{
            position:'absolute', top:0, left:0, right:0, bottom:0,
            zIndex:0, pointerEvents:'none',
            backgroundImage:`url(${import.meta.env.BASE_URL}assets/refuge_bg.jpg)`,
            backgroundSize:'cover',
            backgroundPosition:'center',
            backgroundRepeat:'no-repeat',
          }} />

          {/* Слой 2 — затемнение поверх фона — сглаживает разную обрезку cover
              на разных экранах: верх/низ гарантированно тёмные, середина
              (там сядет герой) остаётся светлой. */}
          <div style={{
            position:'absolute', top:0, left:0, right:0, bottom:0,
            zIndex:1, pointerEvents:'none',
            background: `linear-gradient(to bottom,
              rgba(${hexToRgb(C.appBg)}, ${EXPLORE_BG_TOP_DARKNESS}) 0%,
              rgba(${hexToRgb(C.appBg)}, 0) 25%,
              rgba(${hexToRgb(C.appBg)}, 0) ${EXPLORE_BG_BOTTOM_START_PCT}%,
              rgba(${hexToRgb(C.appBg)}, ${EXPLORE_BG_BOTTOM_DARKNESS}) 100%)`,
          }} />

          {/* Слой сцены — герой у костра, между затемнением и контентом.
              ЧИСТЫЙ CSS: спрайт-лист как background элемента. Костёр — один
              ряд, steps() по X. Герой — сетка 6×4, поэтому явные keyframe-шаги
              с парой X/Y на каждый кадр (см. REFUGE_HERO_KEYFRAMES выше) —
              steps() по одной оси тут не годится. Никаких JS-таймеров/rAF. */}
          <style>{`
            @keyframes refugeHeroIdle {
            ${REFUGE_HERO_KEYFRAMES}
            }
            @keyframes refugeFireIdle {
              from { background-position: 0 0; }
              to { background-position: -${REFUGE_FIRE_FRAME_W * REFUGE_FIRE_FRAMES}px 0; }
            }
          `}</style>
          <div style={{
            position:'absolute', zIndex:2, pointerEvents:'none',
            left:`calc(50% + ${REFUGE_SCENE_H_OFFSET_PCT}%)`,
            top:`${REFUGE_SCENE_V_ANCHOR_PCT}%`,
            // ⚠️ width/height 0 ОБЯЗАТЕЛЬНЫ. Это ТОЧКА-ЯКОРЬ: сцена под ней
            // сама себя позиционирует через translate(-50%,-100%) и ужимается
            // scale(0.42). Без явного нуля этот div брал ширину по содержимому —
            // 502px (REFUGE_FIRE_OFFSET_X + REFUGE_FIRE_FRAME_W), потому что
            // scale() уменьшает КАРТИНКУ, но не размер бокса в раскладке.
            // На экране 375px такой бокс начинался на 172.5px и кончался на
            // 674.5px, то есть торчал за правый край на 299.5px (замерено
            // headless-браузером на 320/375/390 — везде одинаково, вылет
            // 329/299/291px). Видно его не было (внутри всё смещено
            // трансформом), но документ становился шире экрана, и страницу
            // можно было таскать вбок; вернувшись на другую вкладку со
            // сдвинутым скроллом, игрок видел обрезанный правый столбец сетки.
            // Ноль убирает бокс из раскладки, не трогая картинку: положение
            // ребёнка задаёт левый верхний угол родителя, а он не зависит от
            // его ширины.
            width: 0, height: 0,
          }}>
            <div style={{
              position:'relative',
              width: REFUGE_FIRE_OFFSET_X + REFUGE_FIRE_FRAME_W,
              height: REFUGE_HERO_FRAME_H,
              transform:`translate(-50%, -100%) scale(${REFUGE_SCENE_SCALE})`,
              transformOrigin:'bottom center',
            }}>
              {/* Герой — вдох/выдох, alternate (вперёд/назад по кадрам) */}
              <div style={{
                position:'absolute', left:0, bottom:0,
                width:REFUGE_HERO_FRAME_W, height:REFUGE_HERO_FRAME_H,
                backgroundImage:`url(${import.meta.env.BASE_URL}assets/refuge_hero_idle.png)`,
                backgroundSize:`${REFUGE_HERO_FRAME_W * REFUGE_HERO_COLS}px ${REFUGE_HERO_FRAME_H * REFUGE_HERO_ROWS}px`,
                backgroundPosition:'0 0',
                backgroundRepeat:'no-repeat',
                animation:`refugeHeroIdle ${REFUGE_HERO_DURATION}s steps(1) infinite alternate`,
              }} />
              {/* Костёр — цикл горения, обычное направление */}
              <div style={{
                position:'absolute',
                left:REFUGE_FIRE_OFFSET_X, bottom:0,
                width:REFUGE_FIRE_FRAME_W, height:REFUGE_FIRE_FRAME_H,
                transform:`translate(${REFUGE_FIRE_TUNE_X}px, ${REFUGE_FIRE_TUNE_Y}px)`,
                backgroundImage:`url(${import.meta.env.BASE_URL}assets/refuge_fire_idle.png)`,
                backgroundSize:`${REFUGE_FIRE_FRAME_W * REFUGE_FIRE_FRAMES}px ${REFUGE_FIRE_FRAME_H}px`,
                backgroundPosition:'0 0',
                backgroundRepeat:'no-repeat',
                animation:'refugeFireIdle 1.5s steps(14) infinite',
              }} />
            </div>
          </div>

          {/* Слой 3 — контент. 1. Логотип */}
          <div style={{
            position:'relative', zIndex:3,
            padding:'8px 0 12px', textAlign:'center',
            fontFamily:FONT_DISPLAY, fontSize:20, color:C.textDim, letterSpacing:1,
          }}>
            ⚔️ Right Place
          </div>

          {/* 2. Энергия */}
          <div style={{ position:'relative', zIndex:3 }}>
            <div style={{ display:'flex', gap:2, height:12 }}>
              {Array.from({ length:10 }).map((_, i) => (
                <div key={i} style={{
                  flex:1, borderRadius:2,
                  background: i < Math.round(energy / MAX_ENERGY * 10) ? C.glowMid : C.nicheDeep,
                }} />
              ))}
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:8 }}>
              <div style={{ fontFamily:FONT_DISPLAY, fontSize:13, color:C.glowCore }}>{energy} / {MAX_ENERGY}</div>
              <div style={{ fontSize:11, color:C.textDim }}>+1 через 2:41</div>
            </div>
          </div>

          {/* 3. Зона арта — держит высоту между энергией и подготовкой */}
          <div style={{
            flex:1, minHeight:0, margin:'16px 0',
            position:'relative', zIndex:3,
          }} />

          {/* 4. Подготовка */}
          <div style={{ position:'relative', zIndex:3, marginBottom:12 }}>
            <div style={{ fontSize:10, letterSpacing:1, color:C.textDim, marginBottom:7, fontFamily:FONT_DISPLAY }}>ПОДГОТОВКА</div>
            {/* Пять ОДИНАКОВЫХ гнёзд, без разделителя: прежние 3+2 обещали
                деление на «зелья» и «прочее», которого нет — зелья в гнёзда не
                кладут вовсе, они набираются автоматически (docs/items.md).
                52×52 — больше минимальных 44×44 из дизайн-скилла. */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
              {prepSlots.map((slotId, i) => {
                const spec = slotId === null ? null : consumableById(slotId)
                return (
                  <div key={`slot-${i}`}
                    onClick={() => {
                      // Занятое гнездо — освободить. Пустое — открыть список.
                      if (slotId !== null) {
                        setPrepSlots(prev => prev.map((v, j) => (j === i ? null : v)))
                        setPrepPickerSlot(null)
                      } else {
                        setPrepPickerSlot(prev => (prev === i ? null : i))
                      }
                    }}
                    style={{
                      boxSizing:'border-box', width:52, height:52,
                      display:'flex', alignItems:'center', justifyContent:'center',
                      background:C.nicheDeep,
                      // Занятое гнездо обведено тёплым краем — видно, что в нём
                      // что-то есть, даже если иконка тёмная.
                      border:`1px solid ${slotId !== null ? C.glowEdge : C.stoneDark}`,
                      borderRadius:10,
                      boxShadow:'inset 0 2px 5px rgba(0,0,0,0.5)', cursor:'pointer',
                    }}>
                    {spec !== null && (
                      <img
                        src={`${import.meta.env.BASE_URL}assets/icons/${spec.icon}`}
                        alt={spec.nameRu}
                        style={{ width:40, height:40, objectFit:'contain', display:'block' }}
                      />
                    )}
                  </div>
                )
              })}
            </div>

            {/* Список выбора для пустого гнезда. Показываются расходники с
                флагом runSlot, которых есть на складе и которые не лежат уже в
                другом гнезде (повторы сервер отвергает).
                Запас неизвестен (player.consumables === null) — так и пишем, а
                не показываем пустой список: «нечего положить» и «неизвестно,
                что есть» это разные состояния. */}
            {prepPickerSlot !== null && (() => {
              const stock = player?.consumables ?? null
              const taken = prepSlots.filter((v): v is ConsumableId => v !== null)
              const available = stock === null ? [] : CONSUMABLES.filter(
                (c) => c.runSlot && (stock[c.id] ?? 0) >= 1 && !taken.includes(c.id),
              )
              const slotIndex = prepPickerSlot
              return (
                <div style={{ marginTop:8, display:'flex', flexDirection:'column', gap:6 }}>
                  {stock === null ? (
                    <div style={{ fontSize:11, color:C.textDim, textAlign:'center' }}>
                      Запас расходников неизвестен — профиль не загружен.
                    </div>
                  ) : available.length === 0 ? (
                    <div style={{ fontSize:11, color:C.textDim, textAlign:'center' }}>
                      Нечего положить
                    </div>
                  ) : available.map((c) => (
                    <div key={c.id}
                      onClick={() => {
                        setPrepSlots(prev => prev.map((v, j) => (j === slotIndex ? c.id : v)))
                        setPrepPickerSlot(null)
                      }}
                      style={{
                        boxSizing:'border-box', minHeight:44,
                        display:'flex', alignItems:'center', gap:10,
                        padding:'0 10px',
                        background:C.nicheDeep, border:`1px solid ${C.stoneDark}`,
                        borderRadius:9, cursor:'pointer',
                      }}>
                      <img
                        src={`${import.meta.env.BASE_URL}assets/icons/${c.icon}`}
                        alt={c.nameRu}
                        style={{ width:28, height:28, objectFit:'contain', display:'block', flexShrink:0 }}
                      />
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:12, color:C.textMain }}>{c.nameRu}</div>
                        {/* Эффект — из данных, не написан здесь повторно. Та же
                            функция, что в магазине и в сумке; книг в этом списке
                            не бывает (он фильтрован по runSlot), но развилка
                            всё равно одна на весь клиент. */}
                        <div style={{ fontSize:10, color:C.textDim }}>{consumableMechanicLine(c, player?.skillLevels ?? null, skillStats)}</div>
                      </div>
                      <div style={{ fontSize:12, color:C.bone, flexShrink:0 }}>×{stock[c.id] ?? 0}</div>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>

          {/* 5. Главная кнопка */}
          <div style={{ position:'relative', zIndex:3, marginBottom:'calc(96px + env(safe-area-inset-bottom))' }}>
            <div
              onClick={() => { if (!runBlocked) { setExploreMapFile(undefined); setShowExploreTest(true) } }}
              style={{
                boxSizing:'border-box',
                background:C.nicheDeep, border:`1px solid ${C.glowEdge}`,
                borderRadius:9, padding:13, textAlign:'center',
                boxShadow:'inset 0 0 14px rgba(209,151,68,0.3)',
                opacity: runBlocked ? 0.5 : 1,
                cursor: runBlocked ? 'default' : 'pointer',
              }}>
              <span style={{ fontFamily:FONT_DISPLAY, fontSize:14, color:C.glowCore }}>
                {`Начать забег (−${RUN_COST} ⚡)`}
              </span>
            </div>
            {notEnoughEnergy && (
              <div style={{ marginTop:8, fontSize:11, color:C.danger, textAlign:'center' }}>
                Недостаточно энергии (нужно {RUN_COST}).
              </div>
            )}
            {/* Причина блокировки по снаряжению — тем же приёмом, что строка
                энергии выше. "Повторить" — тот же loadInventory, что на вкладке
                "Инвентарь"; после тапа статус станет 'loading', и строка сама
                сменится на "загружается…", второй запрос не уйдёт. */}
            {gearNotReady && (
              <div style={{ marginTop:8, fontSize:11, textAlign:'center', color: inventoryStatus === 'loading' ? C.textDim : C.danger }}>
                {inventoryStatus === 'loading' ? (
                  'Снаряжение загружается…'
                ) : inventoryStatus === 'error' ? (
                  <>
                    Снаряжение не загрузилось — броня и урон неизвестны.{' '}
                    <span
                      onClick={() => { void loadInventory() }}
                      style={{ color:C.glowCore, cursor:'pointer', textDecoration:'underline' }}>
                      Повторить
                    </span>
                  </>
                ) : (
                  // 'idle' в Telegram-сессии — токена в localStorage нет (loadInventory
                  // вышел на !token). Повтор это не исправит, нужен новый логин.
                  'Снаряжение недоступно — нет токена сессии. Перезайди в игру.'
                )}
              </div>
            )}
          </div>

          {/* Debug: тестовая панель карт — свёрнута по умолчанию.
              Прижата к верху, ширина всегда в пределах экрана (left+right:8),
              maxHeight ограничивает панель верхней частью экрана — нижняя
              половина должна оставаться свободной для оценки затемнения. */}
          <div style={{ position:'fixed', top:8, left:8, right:8, zIndex:1001, display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4 }}>
            <div
              onClick={() => setShowExploreDebug(v => !v)}
              style={{
                fontSize:10, color:C.textDim, background:C.nicheDeep,
                border:`1px solid ${C.stoneDark}`, borderRadius:6,
                padding:'3px 7px', cursor:'pointer',
              }}>
              debug
            </div>
            {showExploreDebug && (
              <div style={{
                boxSizing:'border-box', width:'100%', maxHeight:'42vh', overflowY:'auto',
                display:'flex', flexDirection:'column', gap:4,
                padding:6, background:'rgba(0,0,0,0.85)', borderRadius:8,
              }}>
                <div style={{ color:'#EDE7F2', fontSize:9, opacity:0.7 }}>TEST: карты Explore</div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(2, minmax(0, 1fr))', gap:4 }}>
                  {EXPLORE_MAPS.map(m => (
                    <button key={m.file}
                      onClick={() => { setExploreMapFile(m.file); setShowExploreTest(true) }}
                      style={{
                        boxSizing:'border-box', width:'100%',
                        padding:'5px 6px', borderRadius:6, border:'1px solid #3A3344',
                        background:'#221E2B', color:'#EDE7F2', fontSize:10, fontWeight:'bold',
                        whiteSpace:'normal', lineHeight:1.2, cursor:'pointer',
                      }}>
                      {m.label}
                    </button>
                  ))}
                  <button key="D-5050"
                    onClick={() => {
                      const open = Math.random() < 0.5
                      const file = open ? 'map_D_OPEN.txt' : 'map_D_SEALED.txt'
                      setDRolledState(open ? 'OPEN' : 'SEALED')
                      setExploreMapFile(file)
                      setShowExploreTest(true)
                    }}
                    style={{
                      boxSizing:'border-box', width:'100%',
                      padding:'5px 6px', borderRadius:6, border:'1px solid #3A3344',
                      background:'#221E2B', color:'#EDE7F2', fontSize:10, fontWeight:'bold',
                      whiteSpace:'normal', lineHeight:1.2, cursor:'pointer',
                    }}>
                    D Тайник (50/50)
                  </button>
                </div>
                {dRolledState && (
                  <div style={{
                    fontSize:10,
                    color: dRolledState === 'OPEN' ? '#4FB477' : '#E0353B'
                  }}>
                    D выпало: {dRolledState}
                  </div>
                )}
              </div>
            )}
          </div>

        </div>
      )}
      </div>

      <div style={{
        position:'fixed', bottom:0, left:0, right:0,
        display:'flex',
        paddingTop:14,
        zIndex:999
      }}>
        {([
          {id:'hero', label:'Персонаж', icon:'nav_hero.png'},
          {id:'shop', label:'Магазин', icon:'nav_shop.png'},
          {id:'explore', label:'Исследовать', icon:'nav_explore.png'},
          // id 'gear' остался историческим: игроку видна только подпись, а
          // переименование идентификатора задело бы тип activeTab,
          // gearSelectedItem и все setActiveTab('gear') — шум без пользы.
          {id:'gear', label:'Инвентарь', icon:'nav_gear.png'},
          {id:'friends', label:'Друзья', icon:'nav_friends.png'},
        ] as const).map(tab => {
          const active = activeTab === tab.id
          return (
            <button key={tab.id}
              // Заход в "Инвентарь" через навбар — всегда в одно и то же
              // состояние: подвкладка "Экипировка", фильтр снят. Иначе слот,
              // выбранный когда-то тапом по гнезду на "Персонаже", залипал бы,
              // и игрок видел бы часть сумки, не понимая почему. Второй способ
              // снять фильтр — пункт "Всё" в выпадающем списке.
              // setSlotFilterOpen(false) — на ЛЮБОЙ вкладке: навбар подложка
              // списка не накрывает (см. комментарий у фильтра), и уход с
              // раскрытым списком оставил бы его раскрытым до возврата.
              onClick={() => {
                setActiveTab(tab.id)
                setSlotFilterOpen(false)
                if (tab.id === 'gear') { setGearTab('equipment'); setSlotFilter(null) }
              }}
              style={{
                flex:1, padding:'8px 0', border:'none', background:'none',
                fontSize:10, display:'flex', flexDirection:'column',
                alignItems:'center', gap:2, cursor:'pointer'
              }}>
              <img
                src={`${import.meta.env.BASE_URL}assets/icons/${tab.icon}`}
                alt={tab.label}
                width={26}
                height={26}
                style={{
                  display:'block',
                  opacity: active ? 1 : 0.45,
                  filter: active
                    ? 'drop-shadow(0 0 6px rgba(245,188,91,0.55)) drop-shadow(0 1px 3px rgba(0,0,0,0.9))'
                    : 'drop-shadow(0 1px 3px rgba(0,0,0,0.9))',
                  transition: 'opacity .18s, filter .18s'
                }}
              />
              <span style={{
                color: active ? C.glowCore : C.textDim,
                textShadow: '0 1px 3px rgba(0,0,0,0.9)',
                fontSize:10, letterSpacing:0.3,
                fontFamily: FONT_DISPLAY, marginTop:3
              }}>{tab.label}</span>
            </button>
          )
        })}
      </div>

      {showExploreTest && <Explore mapFile={exploreMapFile} onClose={() => setShowExploreTest(false)} endurance={player?.endurance} strength={player?.strength} agility={player?.agility} level={player?.level} trophies={player?.trophies} armor={totalArmor ?? undefined} weaponDamage={weaponDamage} attackUpgradeBonus={attackUpgradeBonus ?? undefined} equippedSkills={player?.equippedSkills ?? undefined} skillLevels={player?.skillLevels ?? undefined} consumables={prepSlots.filter((v): v is ConsumableId => v !== null)} onConsumablesSpent={handleConsumablesSpent} onRunComplete={handleExploreRunComplete} token={isTelegramSession ? (localStorage.getItem('jwt') ?? undefined) : undefined} />}

      {/* Карточка предмета — ПОСЛЕДНИМ в дереве, а не внутри вкладки: её
          открывают и «Инвентарь», и гнёзда снаряжения на «Персонаже».
          Во время забега не показывается: Explore перекрывает меню целиком, и
          карточка под ним была бы недостижимой ловушкой для тапа. */}
      {!showExploreTest && selectedEntry && (
        <div
          onClick={() => { setGearSelectedItem(null); setGearEquipError(null); setSellConfirm(null) }}
          style={{
            position:'fixed', top:0, left:0, right:0, bottom:0,
            background:'rgba(0,0,0,0.55)',
            display:'flex', alignItems:'center', justifyContent:'center',
            zIndex:1000,
          }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              maxWidth:290, width:'100%',
              background:C.appBg, border:`1px solid ${C.stoneDark}`,
              borderRadius:14, padding:16,
            }}>
            <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:12 }}>
              <div style={{
                width:64, height:64, flexShrink:0, background:C.nicheDeep, borderRadius:8,
                boxShadow:'inset 0 2px 5px rgba(0,0,0,0.55)',
                display:'flex', alignItems:'center', justifyContent:'center',
              }}>
                {/* null (неизвестный слот) и провал загрузки — в ItemIcon. */}
                <ItemIcon src={selectedEntry.iconSrc} name={selectedEntry.name} size={54} />
              </div>
              <div>
                <div style={{ fontSize:15, color:C.textMain }}>{selectedEntry.name}</div>
                <div style={{ fontSize:11, color:C.textDim, marginTop:2 }}>у тебя: {selectedEntry.qty}</div>
              </div>
            </div>

            {/* Флейвора на этот слот/тир в ITEM_FLAVOR нет — блок просто
                не рисуется, заглушкой вроде "—" не заполняем. */}
            {selectedEntry.desc !== null && (
              <div style={{ fontSize:12, lineHeight:1.55, fontStyle:'italic', color:C.textDim, marginBottom:12 }}>
                {selectedEntry.desc}
              </div>
            )}

            <div style={{ background:C.nicheDeep, borderRadius:8, padding:'9px 11px', marginBottom:12 }}>
              <div style={{ fontSize:12, color:C.bone }}>{selectedEntry.stat}</div>
            </div>

            {/* Уровень навыка — ТОЛЬКО у книги: у предмета, зелья, страницы и
                прочих расходников уровня нет вовсе. Тот же блок, что в карточке
                навыка на «Персонаже» и в витрине магазина. */}
            {selectedEntry.kind === 'book' && (
              <SkillLevelNote level={player?.skillLevels?.[selectedEntry.skillId] ?? null} />
            )}

            {/* Действия. У страницы их две, у книги три и своя раскладка;
                у предмета — «Надеть»/«Снять» (+ «Продать за N», если он не
                надет), у зелья и расходника — только заглушка продажи. */}
            {selectedEntry.kind === 'scroll' ? (() => {
              const { scrollId, have, needsBagCell, sellPrice } = selectedEntry
              // Почему «Собрать книгу» недоступна — ДВЕ причины, и показаны они
              // по-разному. Нехватка страниц уже написана на самой кнопке
              // счётчиком «(N/3)», поэтому отдельного текста ей не нужно —
              // кнопка просто приглушена. Полная сумка на кнопке не видна ничем,
              // поэтому у неё свой текст ВМЕСТО кнопки, как у книги ниже.
              // Полная сумка мешает, только если книге нужна НОВАЯ ячейка (см.
              // needsBagCell) — то же правило применяет сервер.
              // bagFull утверждается только при известном размере сумки (см.
              // bagKnown): неизвестность не повод запрещать — ответит сервер.
              const assembleBlocked: string | null =
                have < SCROLLS_PER_BOOK ? null
                  : needsBagCell && bagFull ? 'Сумка полна'
                    : null
              const enoughScrolls = have >= SCROLLS_PER_BOOK
              const actionStyle = (primary: boolean, disabled: boolean) => ({
                flex:1, boxSizing:'border-box' as const, minHeight:44,
                display:'flex', alignItems:'center', justifyContent:'center',
                background:C.nicheDeep,
                border:`1px solid ${primary ? C.glowEdge : C.stoneDark}`,
                borderRadius:9, padding:'8px 11px', textAlign:'center' as const,
                color: primary ? C.glowCore : C.textMain, fontSize:14,
                cursor: disabled ? 'default' as const : 'pointer' as const,
                opacity: disabled ? 0.5 : 1,
                ...(primary ? { boxShadow:'inset 0 0 12px rgba(209,151,68,0.28)' } : {}),
              })
              return (
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {/* «Собрать книгу (N/3)» — основное действие, своей строкой
                    во всю ширину: счётчик делает подпись длинной, и в паре с
                    «Продать за 30» на 375px обеим осталось бы ~100px. */}
                {assembleBlocked !== null ? (
                  <div style={{ ...actionStyle(false, true), cursor:'default' }}>
                    {assembleBlocked}
                  </div>
                ) : (
                  <div
                    onClick={() => {
                      if (!enoughScrolls || skillActionPending) return
                      void handleSkillAction({ kind: 'assemble', scrollId })
                    }}
                    style={actionStyle(true, !enoughScrolls || skillActionPending)}>
                    {skillActionPending ? 'Собираю...' : `Собрать книгу (${have}/${SCROLLS_PER_BOOK})`}
                  </div>
                )}
                {/* Продажа БЕЗ подтверждения — как у книги: страница не
                    уникальна, их копятся десятки, и окно на каждую было бы
                    помехой, а не защитой. Уходит ОДНА за нажатие. */}
                <div
                  onClick={() => { if (!skillActionPending) void handleSkillAction({ kind: 'sellScroll', scrollId }) }}
                  style={actionStyle(false, skillActionPending)}>
                  Продать за {sellPrice}
                </div>
                {skillActionError !== null && (
                  <div style={{ fontSize:11, color:C.danger, textAlign:'center' }}>
                    {skillActionError}
                  </div>
                )}
              </div>
              )
            })() : selectedEntry.kind === 'book' ? (() => {
              const { bookId, skillId, sellPrice } = selectedEntry
              // Почему «Надеть» недоступна — ТРИ разных причины, и у
              // каждой свой текст на самой кнопке (решение дизайнера).
              // null в equippedSkills значит «сервер не назвал»: гадать
              // нельзя, иначе кнопка обещала бы то, что сервер отвергнет.
              const equippedNow = player?.equippedSkills ?? null
              const equipBlocked: string | null =
                equippedNow === null ? 'Навыки неизвестны'
                  : equippedNow.includes(skillId) ? 'Навык уже надет'
                    : equippedNow.length >= MAX_EQUIPPED_SKILLS ? 'Обе ячейки заняты'
                      : null
              // Общий вид кнопки действия: рамка тёплая у основного,
              // серая у второстепенных. minHeight 44 — палец.
              const actionStyle = (primary: boolean, disabled: boolean) => ({
                flex:1, boxSizing:'border-box' as const, minHeight:44,
                display:'flex', alignItems:'center', justifyContent:'center',
                background:C.nicheDeep,
                border:`1px solid ${primary ? C.glowEdge : C.stoneDark}`,
                borderRadius:9, padding:'8px 11px', textAlign:'center' as const,
                color: primary ? C.glowCore : C.textMain, fontSize:14,
                cursor: disabled ? 'default' as const : 'pointer' as const,
                opacity: disabled ? 0.5 : 1,
                ...(primary ? { boxShadow:'inset 0 0 12px rgba(209,151,68,0.28)' } : {}),
              })
              return (
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {/* «Надеть» — основное действие, своей строкой во всю
                    ширину: три кнопки в один ряд на 375px дали бы по ~100px
                    на кнопку с русской подписью. */}
                {equipBlocked !== null ? (
                  <div style={{ ...actionStyle(false, true), cursor:'default' }}>
                    {equipBlocked}
                  </div>
                ) : (
                  <div
                    onClick={() => { if (!skillActionPending) void handleSkillAction({ kind: 'equip', bookId }) }}
                    style={actionStyle(true, skillActionPending)}>
                    {skillActionPending ? 'Надеваю...' : 'Надеть'}
                  </div>
                )}
                <div style={{ display:'flex', gap:8 }}>
                  {/* «Улучшить навык» работает и для НЕнадетого навыка:
                      уровень принадлежит герою, а не гнезду. */}
                  <div
                    onClick={() => { if (!skillActionPending) void handleSkillAction({ kind: 'upgrade', bookId }) }}
                    style={actionStyle(false, skillActionPending)}>
                    Улучшить навык
                  </div>
                  <div
                    onClick={() => { if (!skillActionPending) void handleSkillAction({ kind: 'sell', bookId }) }}
                    style={actionStyle(false, skillActionPending)}>
                    Продать за {sellPrice}
                  </div>
                </div>
                {skillActionError !== null && (
                  <div style={{ fontSize:11, color:C.danger, textAlign:'center' }}>
                    {skillActionError}
                  </div>
                )}
              </div>
              )
            })() : (
            <div style={{ display:'flex', gap:8 }}>
              {selectedEntry.kind === 'item' && (() => {
                const { inventoryItemId, equipped, levelRequired } = selectedEntry
                // Снять можно ВСЕГДА: сервер при снятии уровень не
                // проверяет, и запирать надетое на теле нельзя. Порог —
                // только для "Надеть", и это подсказка, а не защита:
                // решает сервер по своим статам, устаревший player.level
                // кончится красной строкой ниже. Профиль не загружен
                // (player === null) — уровень неизвестен, порог не
                // выдумываем и кнопку не прячем: пусть ответит сервер.
                // Снять некуда: сумка полна. Сервер вместимость не
                // проверяет вовсе (правило клиентское, см. BAG_CAPACITY), поэтому
                // эту дверь держит клиент. Размер сумки НЕИЗВЕСТЕН (bagKnown
                // false) — не утверждаем «полна» и не блокируем: неизвестность не
                // повод запрещать.
                if (equipped && bagFull) {
                  return (
                    <div style={{
                      flex:1, boxSizing:'border-box', minHeight:44,
                      display:'flex', alignItems:'center', justifyContent:'center',
                      background:C.nicheDeep, border:`1px solid ${C.stoneDark}`,
                      borderRadius:9, padding:'8px 11px', textAlign:'center',
                      color:C.textDim, fontSize:13, opacity:0.5,
                    }}>
                      Сумка полна
                    </div>
                  )
                }
                if (!equipped && player !== null && player.level < levelRequired) {
                  return (
                    <div style={{
                      flex:1, boxSizing:'border-box', minHeight:44,
                      display:'flex', alignItems:'center', justifyContent:'center',
                      background:C.nicheDeep, border:`1px solid ${C.stoneDark}`,
                      borderRadius:9, padding:'8px 11px', textAlign:'center',
                      color:C.textDim, fontSize:13,
                    }}>
                      Откроется на {levelRequired} уровне
                    </div>
                  )
                }
                return (
                  <div
                    onClick={() => { void handleEquipItem(inventoryItemId, !equipped) }}
                    style={{
                      flex:1, boxSizing:'border-box', minHeight:44,
                      display:'flex', alignItems:'center', justifyContent:'center',
                      background:C.nicheDeep, border:`1px solid ${C.glowEdge}`,
                      borderRadius:9, padding:'8px 11px', textAlign:'center',
                      color:C.glowCore, fontSize:14,
                      cursor: equipping ? 'default' : 'pointer',
                      opacity: equipping ? 0.5 : 1,
                      boxShadow:'inset 0 0 12px rgba(209,151,68,0.28)',
                    }}>
                    {equipping
                      ? (equipped ? 'Снимаю...' : 'Надеваю...')
                      : (equipped ? 'Снять' : 'Надеть')}
                  </div>
                )
              })()}
              {selectedEntry.kind === 'item' ? (() => {
                const { inventoryItemId, equipped, sellPrice } = selectedEntry
                // Надетый предмет из карточки не продаётся ВООБЩЕ:
                // кнопки НЕТ, а не «есть, но погашена». Пустого места
                // после неё не остаётся: ряд — flex с gap, единственная
                // оставшаяся «Снять» растягивается своим flex:1 на всю
                // ширину, а gap при одном ребёнке не считается вовсе.
                // Серверная проверка (400 `Item is equipped`) ОСТАЁТСЯ — она
                // страхует гонку с надеванием в другой вкладке.
                if (equipped) return null
                // Причина, по которой кнопка гаснет, осталась одна —
                // неизвестная цена (старый сервер не прислал sellPrice); уже
                // идущую продажу гасит не она, а кнопка в окне подтверждения.
                const blocked: string | null =
                  sellPrice === undefined ? 'Цена неизвестна' : null
                if (blocked !== null) {
                  return (
                    <div style={{
                      flex:1, boxSizing:'border-box', minHeight:44,
                      display:'flex', alignItems:'center', justifyContent:'center',
                      background:C.nicheDeep, border:`1px solid ${C.stoneDark}`,
                      borderRadius:9, padding:'8px 11px', textAlign:'center',
                      color:C.textDim, fontSize:13, opacity:0.5,
                    }}>
                      {blocked}
                    </div>
                  )
                }
                return (
                  <div
                    onClick={() => { setSellConfirm(inventoryItemId); setGearEquipError(null) }}
                    style={{
                      flex:1, boxSizing:'border-box', minHeight:44,
                      display:'flex', alignItems:'center', justifyContent:'center',
                      background:C.nicheDeep, border:`1px solid ${C.stoneDark}`,
                      borderRadius:9, padding:'8px 11px', textAlign:'center',
                      color:C.textMain, fontSize:14, cursor:'pointer',
                    }}>
                    Продать за {sellPrice}
                  </div>
                )
              })() : (
                /* У зелий, расходников и книг продажи из этой карточки
                   нет: книги продаются своей кнопкой выше, а зелья и
                   расходники не продаются вовсе. Явная заглушка — без
                   onClick и без cursor:pointer, чтобы тап ничего не
                   обещал. */
                <div style={{
                  flex:1, boxSizing:'border-box', minHeight:44,
                  display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                  border:`1px dashed ${C.stoneDark}`, borderRadius:9, padding:'6px 11px',
                  textAlign:'center', color:C.textDim, opacity:0.7,
                }}>
                  <div style={{ fontSize:14 }}>Продать</div>
                  <div style={{ fontSize:10 }}>скоро</div>
                </div>
              )}
            </div>
            )}

            {/* Подтверждение продажи. Предмет исчезает безвозвратно,
                поэтому спрашиваем — тем же приёмом, что «Забыть» у
                навыка: цена действия названа словами до, а не после. */}
            {selectedEntry.kind === 'item' && sellConfirm === selectedEntry.inventoryItemId && (() => {
              const { inventoryItemId } = selectedEntry
              return (
              <div style={{ marginTop:10 }}>
                {/* Только необратимость. Сумму называть здесь не нужно:
                    она уже написана на кнопке «Продать за N», с которой
                    игрок сюда и пришёл, а повтор делает из предупреждения
                    рекламу выгоды. */}
                <div style={{ fontSize:12, lineHeight:1.5, color:C.danger, marginBottom:10, textAlign:'center' }}>
                  Предмет пропадёт навсегда.
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  <div
                    onClick={() => { if (!sellPending) void handleSellItem(inventoryItemId) }}
                    style={{
                      flex:1, boxSizing:'border-box', minHeight:44,
                      display:'flex', alignItems:'center', justifyContent:'center',
                      background:C.nicheDeep, border:`1px solid ${C.danger}`,
                      borderRadius:9, padding:'8px 11px', textAlign:'center',
                      color:C.danger, fontSize:14,
                      cursor: sellPending ? 'default' : 'pointer',
                      opacity: sellPending ? 0.5 : 1,
                    }}>
                    {sellPending ? 'Продаю...' : 'Продать'}
                  </div>
                  <div
                    onClick={() => setSellConfirm(null)}
                    style={{
                      flex:1, boxSizing:'border-box', minHeight:44,
                      display:'flex', alignItems:'center', justifyContent:'center',
                      background:C.nicheDeep, border:`1px solid ${C.stoneDark}`,
                      borderRadius:9, padding:'8px 11px', textAlign:'center',
                      color:C.textMain, fontSize:14, cursor:'pointer',
                    }}>
                    Отмена
                  </div>
                </div>
              </div>
              )
            })()}
            {/* Отказ — видимой строкой под кнопками, не только в консоль. */}
            {selectedEntry.kind === 'item' && gearEquipError !== null && (
              <div style={{ marginTop:8, fontSize:11, color:C.danger, textAlign:'center' }}>
                {gearEquipError}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Окно о прошлом забеге, закрытом сервером на входе. ПОСЛЕДНИМ в
          дереве и с zIndex 2000 (см. PastRunNotice) — чтобы лечь поверх
          любого экрана, включая уже открытый Explore (1000) и его экран
          итогов. */}
      {pastRunNotice && <PastRunNotice notice={pastRunNotice} onClose={() => setPastRunNotice(null)} />}

      {/* Тост об удачном обмене. Показывает goldGained ИЗ ОТВЕТА СЕРВЕРА — окно
          обмена к этому моменту уже закрыто (см. handleExchangeTrophies), и без
          тоста игрок увидел бы только изменившиеся числа в шапке, без объяснения.
          Над навигацией (999) и над оверлеем карточек (1000), но НИЖЕ окна о
          прошлом забеге (2000): то говорит о штрафе и перекрывать его нечем.
          pointerEvents:'none' — тост ничего не перехватывает, он не нажимается и
          гаснет сам (таймер в showGoldToast). */}
      {goldToast !== null && (
        <div style={{
          position:'fixed', left:0, right:0, bottom:96,
          display:'flex', justifyContent:'center',
          zIndex:1100, pointerEvents:'none',
        }}>
          <div style={{
            display:'flex', alignItems:'center', gap:7,
            background:C.nicheDeep, border:`1px solid ${C.glowEdge}`,
            borderRadius:10, padding:'9px 14px',
            boxShadow:'0 4px 14px rgba(0,0,0,0.6), inset 0 0 12px rgba(209,151,68,0.22)',
          }}>
            <img src={`${import.meta.env.BASE_URL}assets/icons/icon_gold.png`} alt="Золото" width={18} height={18} style={{ display:'block', objectFit:'contain' }} />
            <span style={{ fontFamily:FONT_DISPLAY, fontSize:15, color:C.glowCore }}>+{goldToast} золота</span>
          </div>
        </div>
      )}
    </div>
  )
}