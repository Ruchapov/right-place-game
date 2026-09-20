import { useEffect, useRef, useState } from 'react'
import { retrieveRawInitData, retrieveLaunchParams } from '@telegram-apps/sdk'
import { C, FONT_DISPLAY } from './ui/theme'
import { loginWithTelegram, saveEquippedSkills, buyPotion, fetchInventory, equipItem, EquipError, RequestError, type LoginResponse, type InventoryItem, type RunResultSummary } from './api'
import { POTION_TIERS } from './potions'
import { playerAttackDamage } from './playerDamage'
import Explore from './Explore'
import './App.css'

type PlayerData = { id: number; firstName: string; level: number; gold: number; strength: number; endurance: number; agility: number; trophies: number; equippedSkills: string[]; /** Склад зелий по тирам, индекс = тир-1 (см. src/potions.ts). */ potions: number[] }

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

// Вместимость сумки — ПРОЕКТНОЕ число из docs/items.md ("Правило
// вместимости"): 30 ячеек стартово, расширение за золото в будущем. Сервер его
// НЕ знает и не проверяет — ни в схеме, ни в одном эндпоинте вместимости нет.
// Поэтому переполнение (например, после debug-give-all-items: 36 предметов)
// показывается как есть, красным, а не обрезается до 30. Появится вместимость
// на сервере — брать оттуда, эту константу удалить.
const BAG_CAPACITY = 30

// Код слота в именах файлов иконок предметов — assets/icons/items/, 36 файлов
// wpn_t1…amu_t6.
const SLOT_CODE: Record<string, string> = {
  weapon: 'wpn', helmet: 'hlm', armor: 'arm', gloves: 'glv', boots: 'bts', amulet: 'amu',
}

// Иконка предмета ВЫВОДИТСЯ из слота и тира, а НЕ берётся из item.iconPath,
// который сервер честно присылает в ответе инвентаря. Это сделано НАМЕРЕННО,
// не забыто — НЕ "починить" обратно на iconPath:
//
//   item.iconPath указывает в assets/equipment/processed/<папка слота>/, где
//   лежит арт СТАРОГО каталога (10 тиров оружие/броня, 5 тиров у остальных
//   слотов). Под нынешние 6 тиров он НЕПОЛОН — четырёх файлов физически нет
//   на диске: amulets/amulet_06.png, boots/boots_06.png, gloves/gloves_06.png,
//   helmets/helmet_06.png. Предмет 6 тира этих слотов дал бы битую картинку.
//   Набор assets/icons/items/ полный (все 36) и нарисован как раз под
//   инвентарь.
//
// Развязка — перегенерировать арт под iconPath ЛИБО переписать iconPath в
// сиде на существующий набор — отдельная задача, она требует правки сида и
// миграции, то есть серверной стороны. Пока она не сделана, iconPath читать
// нельзя.
//
// ОТСЮДА берут иконку ОБА экрана с предметами: вкладка "Инвентарь" (ячейки и
// карточка) и экран "Персонаж" (гнёзда надетого) — и рисуют её через ItemIcon
// ниже. "Персонаж" читал iconPath
// дольше всех и ровно на этом ломался: надетые шлем/перчатки/сапоги/амулет
// 6 тира отдавали 404 на GitHub Pages (проверено запросами), WebView рисовал
// "?". Не возвращать ни один из экранов на iconPath; новому экрану с иконкой
// предмета — тоже сюда.
//
// null — неизвестный слот (в схеме Item.slot это свободная строка, не enum):
// ItemIcon рисует название текстом вместо картинки, а не тянет
// ".../undefined_t3.png".
function itemIconSrc(slot: string, tier: number): string | null {
  const code = SLOT_CODE[slot]
  if (!code) return null
  return `${import.meta.env.BASE_URL}assets/icons/items/${code}_t${tier}.png`
}

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

const MAX_ENERGY = 100
const RUN_COST = 3 // DEV: держать в синхроне с сервером (вернуть 10 перед релизом)

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
  const [savingSkills, setSavingSkills] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // Подвкладка "Инвентаря". ДВЕ ветки, обе с настоящим рендером:
  //   'equipment'   — предметы шести слотов (источник: inventory с сервера)
  //   'consumables' — всё применяемое (источник: player.potions; позже обереги,
  //                   карты, книги скиллов — см. consumableSources в разметке)
  // Это НЕ прежнее трёхзначное состояние с 'skills': скиллы живут на экране
  // "Персонаж", на этой вкладке их нет.
  const [gearTab, setGearTab] = useState<'equipment' | 'consumables'>('equipment')
  // Выбранный пункт фильтра по слоту внутри "Экипировки": null — "Всё".
  // Ставится тапом по гнезду на экране "Персонаж" (см. ниже), сбрасывается
  // пунктом "Всё" в выпадающем списке и тапом по "Инвентарь" в навбаре — иначе
  // фильтр залипал бы до перезапуска приложения.
  const [slotFilter, setSlotFilter] = useState<string | null>(null)
  // Раскрыт ли выпадающий список фильтра. Чисто вёрсточный флаг: что выбрано,
  // хранит ТОЛЬКО slotFilter, второго источника правды здесь нет.
  const [slotFilterOpen, setSlotFilterOpen] = useState(false)
  const [shopTab, setShopTab] = useState<'Расходники' | 'Улучшения' | 'Снаряжение' | 'Книги'>('Расходники')
  const [shopSelectedPotion, setShopSelectedPotion] = useState<string | null>(null)
  // Ошибка последней попытки покупки (видимая строка под кнопкой — тем же
  // приёмом, что "Недостаточно энергии" под кнопкой забега ниже).
  const [shopBuyError, setShopBuyError] = useState<string | null>(null)
  // Запрос покупки в полёте — гасит кнопку от двойного тапа: эндпоинт не
  // идемпотентный, второй тап купил бы второе зелье.
  const [shopBuyPending, setShopBuyPending] = useState(false)
  // Выбранная ячейка инвентаря. Предмет адресуется inventoryItemId — именно им
  // оперирует POST /character/equip, и именно он различает два одинаковых
  // предмета (в БД это две строки InventoryItem, стакинга нет). Прежняя пара
  // slot+tier на это не годилась и досталась от фейкового TEST_INVENTORY.
  const [gearSelectedItem, setGearSelectedItem] = useState<
    { kind: 'item'; inventoryItemId: string } | { kind: 'potion'; potionId: string } | null
  >(null)
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
      setPlayer({ id: 0, firstName: 'DevTester', level: 5, gold: 500, strength: 20, endurance: 15, agility: 10, trophies: 50, equippedSkills: ['iceball', 'fireball'], potions: [3, 1, 0, 0, 0] })
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
    setPlayer({ id: data.user.id, firstName: data.user.firstName, level: data.character.level, gold: data.character.gold, strength: data.character.strength, endurance: data.character.endurance, agility: data.character.agility ?? 0, trophies: data.character.trophies, equippedSkills: data.character.equippedSkills ?? [], potions: data.character.potions })
    setEnergyBase(data.character.energy)
    setEnergyBaseAt(Date.now())
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

  const energy = liveEnergy(energyBase, energyBaseAt, now)
  const notEnoughEnergy = energy < RUN_COST
  // Снаряжение не готово — в НАСТОЯЩЕЙ сессии забег из меню не стартует: броня
  // (totalArmor) и урон оружия (weaponDamage) считаются по inventory, и без
  // него забег пошёл бы молча с бронёй 0. Вне Telegram (DevTester, статус
  // 'idle') не блокируем: сервера нет вовсе, забег там — заглушка с оранжевой
  // плашкой. Отладочные кнопки карт этот гейт намеренно обходят — их страхует
  // проверка в начале setup() в Explore.tsx (экран ошибки, энергия не списана).
  const gearNotReady = isTelegramSession && inventoryStatus !== 'ready'
  const runBlocked = notEnoughEnergy || gearNotReady
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
  const totalArmor = inventory.filter(i => i.equipped).reduce((sum, i) => sum + (i.item.armor ?? 0), 0)

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

  // Вызывается Explore РОВНО ОДИН раз, когда пришёл настоящий ответ
  // /run/finish-explore (не клиентский fallback, см. ExploreProps.onRunComplete) —
  // result.trophies/strength/endurance/agility/level — АБСОЛЮТНЫЕ значения из
  // БД, не приросты, поэтому просто перезаписываем, не складываем. Экран
  // Explore закрывается отдельно, по кнопке "В меню" на его собственном
  // ResultsScreen (см. onClose проп ниже).
  function handleExploreRunComplete(result: RunResultSummary) {
    if (player) {
      setPlayer(prev => prev ? {
        ...prev,
        trophies: result.trophies,
        strength: result.strength,
        endurance: result.endurance,
        agility: result.agility,
        level: result.level,
        potions: result.potions,
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

  async function handleSkillToggle(skillId: string) {
    if (!player) return
    const current = player.equippedSkills ?? []
    let next: string[]
    if (current.includes(skillId)) {
      next = current.filter(s => s !== skillId)
    } else {
      if (current.length >= 2) return
      next = [...current, skillId]
    }
    const token = localStorage.getItem('jwt')
    if (!token) return
    setSavingSkills(true)
    try {
      const result = await saveEquippedSkills(token, next)
      if (player) {
        setPlayer(prev => prev ? { ...prev, equippedSkills: result.equippedSkills } : prev)
      } else {
        requestPlayerRefresh()
      }
    } catch (e) {
      console.error('Save skills failed', e)
    } finally {
      setSavingSkills(false)
    }
  }

  // tier — номер 1..5. Цену и уровень открытия проверяет ещё и сервер по СВОЕЙ
  // копии каталога: здешние проверки только для UI, доверенного источника из
  // них не делаем.
  async function handleBuyPotion(tier: number) {
    const token = localStorage.getItem('jwt')
    if (!token || !player) {
      setShopBuyError('Профиль не загружен — покупка недоступна.')
      return
    }
    if (shopBuyPending) return
    const spec = POTION_TIERS[tier - 1]
    if (!spec) {
      setShopBuyError('Неизвестный тир зелья.')
      return
    }
    if (player.gold < spec.price) {
      setShopBuyError(`Недостаточно золота (нужно ${spec.price}).`)
      return
    }
    setShopBuyPending(true)
    setShopBuyError(null)
    try {
      const result = await buyPotion(token, tier)
      // gold/potions — абсолютные значения из БД, поэтому меню обновляется
      // сразу, без перезахода.
      setPlayer(prev => prev ? { ...prev, gold: result.gold, potions: result.potions } : prev)
    } catch (e) {
      // Молчание здесь уже стоило бы игроку догадок: раньше ошибка уходила
      // ТОЛЬКО в консоль. Console.error оставлен, плюс видимая строка.
      console.error('Buy potion failed', e)
      setShopBuyError('Не удалось купить — сервер отказал. Попробуй ещё раз.')
    } finally {
      setShopBuyPending(false)
    }
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
      // 400 — отказ по существу, у сервера он по-русски ("Недостаточный
      // уровень"), показываем как есть. Остальное — 401/404 с английским
      // служебным текстом, 5xx, обрыв сети — игроку общей строкой.
      setGearEquipError(
        e instanceof EquipError && e.status === 400 && e.serverError !== null
          ? e.serverError
          : `Не удалось ${equip ? 'надеть' : 'снять'} — сервер не ответил или отказал. Попробуй ещё раз.`,
      )
    } finally {
      setEquipping(false)
    }
  }
  // Вкладка "Инвентарь" (activeTab === 'gear' — id исторический, см. навбар)
  // работает на РЕАЛЬНОМ inventory с сервера; хардкод TEST_INVENTORY/
  // ITEM_CATALOG удалён. Ссылки ниже — остатки, которые вкладка пока не
  // использует: нужны только чтобы TS (noUnusedLocals) не считал этот код
  // мёртвым.
  void SlotIcon
  void savingSkills
  void handleSkillToggle

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
            const heroSkillSlots = [0, 1].map(i => p.equippedSkills[i] ?? null)
            // Броня, Удача и Урон (слагаемое надетого оружия) считаются по
            // НАДЕТЫМ предметам, то есть по inventory — и врали бы нулём, пока
            // он не загружен (см. inventoryStatus). Ноль здесь неотличим от
            // честного "ничего не надето", поэтому вне 'ready' ставим прочерк
            // (у Урона — через weaponDamage === null). Остальные три стата
            // приходят из player и этой оговорки не требуют — player
            // уже закрыт guard'ом "Данные персонажа недоступны" выше.
            const equipStatsKnown = inventoryStatus === 'ready'
            const charStats: { iconSrc: string; value: number | string; label: string }[] = [
              { iconSrc: `${import.meta.env.BASE_URL}assets/icons/icon_damage.png`, value: weaponDamage === null ? '—' : playerAttackDamage(p.strength, weaponDamage), label:'Урон' },
              { iconSrc: `${import.meta.env.BASE_URL}assets/icons/icon_armor.png`, value: equipStatsKnown ? totalArmor : '—', label:'Броня' },
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
                        // Открываем "Инвентарь" на подвкладке "Экипировка" с уже
                        // выбранной кнопкой этого слота.
                        onClick={() => { setActiveTab('gear'); setGearTab('equipment'); setSlotFilter(slot) }}
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
                <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:7 }}>
                  {heroSkillSlots.map((skillId, i) => {
                    const name = skillId ? HERO_SKILL_NAMES[skillId] : null
                    return (
                      <div key={i} style={{
                        boxSizing:'border-box',
                        background:C.nicheDeep, borderRadius:8, padding:9,
                        display:'flex', alignItems:'center', gap:9,
                        border: `1px solid ${skillId ? C.glowEdge : C.stoneDark}`,
                        boxShadow: skillId ? 'inset 0 0 12px rgba(209,151,68,0.30)' : 'none',
                      }}>
                        <div style={{ width:30, height:30, flexShrink:0, background:C.outline, borderRadius:6 }} />
                        <div style={{ fontSize:12, color: name ? C.textMain : C.stoneDark }}>{name ?? 'пусто'}</div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Характеристики */}
              <div style={{ margin:'0 8px 16px' }}>
                <div style={sectionHeaderStyle}>ХАРАКТЕРИСТИКИ</div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:6 }}>
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

            </div>
            )
          })()}
          {activeTab === 'shop' && (() => {
            const SHOP_TABS = ['Расходники', 'Улучшения', 'Снаряжение', 'Книги'] as const
            const playerLevel = player?.level ?? 1
            // Витрина = каталог (src/potions.ts). Прежний локальный массив
            // POTIONS удалён: проценты/цены/уровни жили в трёх местах и уже
            // противоречили друг другу. shopSelectedPotion теперь хранит НОМЕР
            // ТИРА строкой, id-шников зелий больше нет.
            const selectedTier = shopSelectedPotion === null ? null : Number(shopSelectedPotion)
            const selectedPotion = selectedTier === null ? null : (POTION_TIERS[selectedTier - 1] ?? null)

            return (
            <div style={{ padding: '0 4px' }}>

              {/* Шапка */}
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'20px 16px 14px' }}>
                <div style={{ fontFamily:FONT_DISPLAY, fontSize:16, color:C.textMain }}>Магазин</div>
                <div style={{ display:'flex', gap:14 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                    <img src={`${import.meta.env.BASE_URL}assets/icons/icon_gold.png`} alt="Золото" width={16} height={16} style={{ display:'block', objectFit:'contain' }} />
                    <span style={{ fontSize:12, color:C.bone }}>{player?.gold ?? 0}</span>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                    <img src={`${import.meta.env.BASE_URL}assets/icons/icon_trophy.png`} alt="Трофеи" width={16} height={16} style={{ display:'block', objectFit:'contain' }} />
                    <span style={{ fontSize:12, color:C.bone }}>{player?.trophies ?? 0}</span>
                  </div>
                </div>
              </div>

              {/* Вкладки разделов */}
              <div style={{ display:'flex', gap:6, overflowX:'auto', marginBottom:14, padding:'0 8px' }}>
                {SHOP_TABS.map(tab => {
                  const active = shopTab === tab
                  return (
                    <div key={tab} onClick={() => setShopTab(tab)}
                      style={{
                        boxSizing:'border-box',
                        background:C.nicheDeep, borderRadius:6, padding:'6px 11px',
                        fontSize:11, whiteSpace:'nowrap', cursor:'pointer',
                        border: `1px solid ${active ? C.glowEdge : C.stoneDark}`,
                        color: active ? C.glowCore : C.textDim,
                      }}>
                      {tab}
                    </div>
                  )
                })}
              </div>

              {/* Витрина */}
              {shopTab === 'Расходники' ? (
                <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:8, padding:'0 8px' }}>
                  {POTION_TIERS.map(p => {
                    const unlocked = playerLevel >= p.levelRequired
                    return (
                      <div key={p.tier}
                        onClick={() => { setShopSelectedPotion(String(p.tier)); setShopBuyError(null) }}
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
                          src={`${import.meta.env.BASE_URL}assets/icons/${p.icon}`}
                          alt={p.nameRu}
                          style={{ width:'100%', height:'100%', objectFit:'contain', display:'block' }}
                        />
                        <div style={{
                          position:'absolute', right:4, bottom:4,
                          background:'rgba(21,18,24,0.85)',
                          borderRadius:5, padding:'2px 6px',
                          fontSize:11, fontFamily:FONT_DISPLAY,
                          color: unlocked ? C.glowCore : C.textDim,
                        }}>
                          {unlocked ? p.price : `ур. ${p.levelRequired}`}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div style={{ padding:'40px 0', textAlign:'center', fontSize:13, color:C.textDim }}>скоро</div>
              )}

              {/* Карточка предмета */}
              {selectedPotion && (
                <div
                  onClick={() => setShopSelectedPotion(null)}
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
                          src={`${import.meta.env.BASE_URL}assets/icons/${selectedPotion.icon}`}
                          alt={selectedPotion.nameRu}
                          style={{ width:54, height:54, objectFit:'contain', display:'block' }}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize:15, color:C.textMain }}>{selectedPotion.nameRu}</div>
                        {/* ТОТ ЖЕ источник, что у золота в шапке — player,
                            обновляется мержем в handleBuyPotion. Здесь раньше
                            стоял литеральный 0 из визуального каркаса, и он
                            неотличим от честного "зелий нет" — на этом уже
                            потеряли время. Профиль не загружен — так и пишем,
                            нулём не подменяем (см. правило про тихие фолбэки). */}
                        <div style={{ fontSize:11, color:C.textDim, marginTop:2 }}>
                          {player === null
                            ? 'у тебя: — (профиль не загружен)'
                            : `у тебя: ${player.potions[selectedPotion.tier - 1] ?? 0}`}
                        </div>
                      </div>
                    </div>

                    <div style={{ fontSize:12, lineHeight:1.55, fontStyle:'italic', color:C.textDim, marginBottom:12 }}>
                      {selectedPotion.desc}
                    </div>

                    <div style={{ background:C.nicheDeep, borderRadius:8, padding:'9px 11px', display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
                      <div style={{ fontSize:12, color:C.textDim }}>Восстанавливает</div>
                      <div style={{ fontSize:13, color:C.bone }}>{Math.round(selectedPotion.healFrac * 100)}% от здоровья</div>
                    </div>

                    {playerLevel >= selectedPotion.levelRequired ? (() => {
                      // Явные проверки вместо `player?.gold ?? 0`: нулём
                      // подменять неизвестное золото нельзя — не загруженный
                      // профиль и пустой кошелёк это РАЗНЫЕ состояния, и второе
                      // не должно маскировать первое (см. правило про тихие
                      // фолбэки). Строка нехватки золота выводится СРАЗУ, не
                      // после тапа — тем же приёмом, что notEnoughEnergy ниже.
                      const canAfford = player !== null && player.gold >= selectedPotion.price
                      const affordMsg =
                        player !== null && player.gold < selectedPotion.price
                          ? `Недостаточно золота (нужно ${selectedPotion.price}).`
                          : null
                      const msg = shopBuyError ?? affordMsg
                      return (
                      <>
                      {/* Цена — из каталога, она же применяется сервером: с
                          появлением тиров витринная и реальная цена наконец
                          одно и то же число, оранжевая плашка про расхождение
                          снята. Счётчик количества по-прежнему не нужен —
                          эндпоинт покупает ровно одно зелье за вызов. */}
                      <div
                        onClick={() => handleBuyPotion(selectedPotion.tier)}
                        style={{
                          background:C.nicheDeep, border:`1px solid ${C.glowEdge}`,
                          borderRadius:9, padding:11, textAlign:'center',
                          color:C.glowCore, fontSize:14,
                          cursor: shopBuyPending ? 'default' : 'pointer',
                          opacity: shopBuyPending || !canAfford ? 0.5 : 1,
                          boxShadow:'inset 0 0 12px rgba(209,151,68,0.28)',
                        }}>
                        {shopBuyPending ? 'Покупка...' : `Купить за ${selectedPotion.price}`}
                      </div>
                      {msg && (
                        <div style={{ marginTop:8, fontSize:11, color:C.danger, textAlign:'center' }}>
                          {msg}
                        </div>
                      )}
                      </>
                      )
                    })() : (
                      <div
                        style={{
                          background:C.nicheDeep, border:`1px solid ${C.stoneDark}`,
                          borderRadius:9, padding:11, textAlign:'center',
                          color:C.textDim, fontSize:14,
                        }}>
                        Откроется на {selectedPotion.levelRequired} уровне
                      </div>
                    )}
                  </div>
                </div>
              )}

            </div>
            )
          })()}
          {activeTab === 'gear' && (() => {
            // Зелья берутся из ОБЩЕГО каталога (src/potions.ts) и из РЕАЛЬНОГО
            // склада player.potions. Предметы — из РЕАЛЬНОГО inventory
            // (GET /character/inventory, грузится при логине): фейковый
            // TEST_INVENTORY и клиентская копия каталога предметов
            // (ITEM_CATALOG с именами и строками статов) удалены. Имя, числа
            // статов и требуемый уровень теперь приходят с сервера, на клиенте
            // остался только флейвор — см. ITEM_FLAVOR и itemStatLine.
            const potionStock = player?.potions ?? null

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
              open: { kind: 'item'; inventoryItemId: string } | { kind: 'potion'; potionId: string }
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
            const buildEquipmentCells = (rows: InventoryItem[]): InvCell[] => rows
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
            // "Правило вместимости"): зелья и дроп улучшений скиллов — нет,
            // карты — да. Решается ОДИН раз на источник, счётчик в шапке
            // подхватывает сам.
            const consumableSources: { key: string; cells: InvCell[]; note: string | null; takesCell: boolean }[] = [
              {
                key: 'potions',
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
            ]
            const consumableCells: InvCell[] = consumableSources.flatMap((src) => src.cells)
            const consumableNotes: string[] = consumableSources
              .map((src) => src.note)
              .filter((n): n is string => n !== null)

            // Заполненность сумки для счётчика в шапке — свойство СУМКИ, а не
            // того, что сейчас на экране: не зависит ни от подвкладки, ни от
            // фильтра. Экипировка: одна строка InventoryItem = одна ячейка
            // (стакинга нет, см. buildEquipmentCells), но НАДЕТЫЕ НЕ считаются:
            // по docs/items.md надетое ячейку сумки не тратит. В сетке они при
            // этом остаются (с рамкой) — иначе снять предмет было бы неоткуда,
            // поэтому ячеек в сетке может быть больше, чем N, и это не ошибка.
            // Расходники — только источники с takesCell. Неизвестно хоть что-то
            // из учитываемого — счётчик не врёт числом, а ставит прочерк.
            const bagUsed = inventory.filter((i) => !i.equipped).length + consumableSources
              .filter((src) => src.takesCell)
              .reduce((sum, src) => sum + src.cells.length, 0)
            const bagKnown = inventoryStatus === 'ready'
              && consumableSources.every((src) => !src.takesCell || src.note === null)

            // Что показывает сетка прямо сейчас — зависит от подвкладки.
            const shownCells = gearTab === 'equipment' ? equipmentCells : consumableCells
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
                  (SHOP_TABS): чипы в строку, активный обведён C.glowEdge.
                  Высота 44px — минимум тап-зоны из дизайн-системы. */}
              <div style={{ display:'flex', gap:6, marginBottom:10, padding:'0 8px' }}>
                {([
                  { id: 'equipment' as const, label: 'Экипировка' },
                  { id: 'consumables' as const, label: 'Расходники' },
                ]).map((t) => {
                  const active = gearTab === t.id
                  return (
                    <div key={t.id} onClick={() => setGearTab(t.id)}
                      style={{
                        boxSizing:'border-box', height:44,
                        display:'flex', alignItems:'center', justifyContent:'center',
                        background:C.nicheDeep, borderRadius:6, padding:'0 14px',
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
              {gearTab === 'consumables' && consumableNotes.map((note) => (
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
                (gearTab === 'equipment' ? inventoryStatus === 'ready' : potionStock !== null) ? (
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
                        // Надетый предмет — та же рамка со свечением, что у
                        // занятого гнезда на экране "Персонаж".
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
              {selectedEntry && (
                <div
                  onClick={() => { setGearSelectedItem(null); setGearEquipError(null) }}
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
                      {/* Продажа не реализована: ни эндпоинта, ни цены продажи у
                          предметов и зелий нет. Явная заглушка — без onClick и
                          без cursor:pointer, пунктирная рамка и "скоро", чтобы
                          тап ничего не обещал. */}
                      <div style={{
                        flex:1, boxSizing:'border-box', minHeight:44,
                        display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                        border:`1px dashed ${C.stoneDark}`, borderRadius:9, padding:'6px 11px',
                        textAlign:'center', color:C.textDim, opacity:0.7,
                      }}>
                        <div style={{ fontSize:14 }}>Продать</div>
                        <div style={{ fontSize:10 }}>скоро</div>
                      </div>
                    </div>
                    {/* Отказ — видимой строкой под кнопками, не только в консоль. */}
                    {selectedEntry.kind === 'item' && gearEquipError !== null && (
                      <div style={{ marginTop:8, fontSize:11, color:C.danger, textAlign:'center' }}>
                        {gearEquipError}
                      </div>
                    )}
                  </div>
                </div>
              )}

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
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
              {[0, 1, 2].map(i => (
                <div key={`potion-${i}`} onClick={() => {}} style={{
                  boxSizing:'border-box', width:52, height:52,
                  background:C.nicheDeep, border:`1px solid ${C.stoneDark}`, borderRadius:10,
                  boxShadow:'inset 0 2px 5px rgba(0,0,0,0.5)', cursor:'pointer',
                }} />
              ))}
              <div style={{ width:1, height:52, background:C.stoneDark }} />
              {[0, 1].map(i => (
                <div key={`misc-${i}`} onClick={() => {}} style={{
                  boxSizing:'border-box', width:52, height:52,
                  background:C.nicheDeep, border:`1px solid ${C.stoneDark}`, borderRadius:10,
                  boxShadow:'inset 0 2px 5px rgba(0,0,0,0.5)', cursor:'pointer',
                }} />
              ))}
            </div>
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

      {showExploreTest && <Explore mapFile={exploreMapFile} onClose={() => setShowExploreTest(false)} endurance={player?.endurance} strength={player?.strength} level={player?.level} trophies={player?.trophies} armor={totalArmor} weaponDamage={weaponDamage} equippedSkills={player?.equippedSkills} onRunComplete={handleExploreRunComplete} token={isTelegramSession ? (localStorage.getItem('jwt') ?? undefined) : undefined} />}
    </div>
  )
}