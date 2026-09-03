import { useEffect, useRef, useState } from 'react'
import { retrieveRawInitData, retrieveLaunchParams } from '@telegram-apps/sdk'
import { C, FONT_DISPLAY } from './ui/theme'
import { loginWithTelegram, saveEquippedSkills, buyPotion, fetchInventory, equipItem, type LoginResponse, type InventoryItem, type RunResultSummary } from './api'
import Explore from './Explore'
import './App.css'

type PlayerData = { id: number; firstName: string; level: number; gold: number; strength: number; endurance: number; agility: number; trophies: number; equippedSkills: string[]; potionCharges: number }

const SLOT_LABELS: Record<string, string> = {
  weapon: 'Оружие',
  armor: 'Броня',
  helmet: 'Шлем',
  boots: 'Сапоги',
  gloves: 'Перчатки',
  amulet: 'Амулет',
}

const HERO_SLOTS: { slot: string; label: string }[] = [
  { slot: 'weapon', label: 'Оружие' },
  { slot: 'helmet', label: 'Шлем' },
  { slot: 'armor', label: 'Броня' },
  { slot: 'gloves', label: 'Перчатки' },
  { slot: 'boots', label: 'Сапоги' },
  { slot: 'amulet', label: 'Амулет' },
]

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
  const [gearTab, setGearTab] = useState<'skills' | 'equipment' | 'consumables'>('skills')
  const [slotFilter, setSlotFilter] = useState<string | null>(null)
  const [shopTab, setShopTab] = useState<'Расходники' | 'Улучшения' | 'Снаряжение' | 'Книги'>('Расходники')
  const [shopSelectedPotion, setShopSelectedPotion] = useState<string | null>(null)
  const [shopQty, setShopQty] = useState(1)
  const [gearSelectedItem, setGearSelectedItem] = useState<
    { kind: 'item'; slot: string; tier: number } | { kind: 'potion'; potionId: string } | null
  >(null)
  const [friendsLinkCopied, setFriendsLinkCopied] = useState(false)
  const [showExploreDebug, setShowExploreDebug] = useState(false)
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [inventoryLoading, setInventoryLoading] = useState(false)
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null)
  const [equipping, setEquipping] = useState(false)
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
      setPlayer({ id: 0, firstName: 'DevTester', level: 5, gold: 500, strength: 20, endurance: 15, agility: 10, trophies: 50, equippedSkills: ['heal', 'dash'], potionCharges: 3 })
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
    setPlayer({ id: data.user.id, firstName: data.user.firstName, level: data.character.level, gold: data.character.gold, strength: data.character.strength, endurance: data.character.endurance, agility: data.character.agility ?? 0, trophies: data.character.trophies, equippedSkills: data.character.equippedSkills ?? [], potionCharges: data.character.potionCharges ?? 3 })
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

  useEffect(() => {
    async function init() {
      try {
        await refreshPlayerFromServer()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  useEffect(() => {
    if (gearTab === 'equipment') loadInventory()
  }, [gearTab])

  useEffect(() => {
    if (slotFilter !== null) loadInventory()
  }, [slotFilter])

  const energy = liveEnergy(energyBase, energyBaseAt, now)
  const notEnoughEnergy = energy < RUN_COST
  // Суммарная броня надетых предметов — та же формула, что уже показывает
  // статистика "Броня" на экране "Персонаж" (см. charStats ниже), вынесена
  // сюда же, чтобы прокинуть тем же числом в Explore (см. задача "броня в
  // бою"). inventory грузится СРАЗУ при логине (см. refreshPlayerFromServer
  // выше — там же, где player), не лениво при первом открытии вкладки
  // "Снаряжение": броня должна быть известна ДО первого удара в забеге, а
  // не подгружаться посреди боя. useEffect'ы выше (gearTab/slotFilter)
  // остаются как есть — это refetch при открытии/фильтрации UI инвентаря,
  // не единственный источник данных.
  const totalArmor = inventory.filter(i => i.equipped).reduce((sum, i) => sum + (i.item.armor ?? 0), 0)

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

  async function handleBuyPotion() {
    const token = localStorage.getItem('jwt')
    if (!token || !player) return
    if (player.gold < 20) return
    try {
      const result = await buyPotion(token)
      if (player) {
        setPlayer(prev => prev ? { ...prev, gold: result.gold, potionCharges: result.potionCharges } : prev)
      } else {
        requestPlayerRefresh()
      }
    } catch (e) {
      console.error('Buy potion failed', e)
    }
  }
  // Новая витрина "Магазин" пока не вызывает handleBuyPotion (визуальный каркас,
  // серверная логика подключается отдельно) — ссылка ниже только чтобы TS
  // (noUnusedLocals) не считал функцию мёртвым кодом.
  void handleBuyPotion

  async function loadInventory() {
    const token = localStorage.getItem('jwt')
    if (!token) return
    setInventoryLoading(true)
    try {
      const res = await fetchInventory(token)
      setInventory(res.inventory)
    } catch (e) {
      console.error('Load inventory failed', e)
    } finally {
      setInventoryLoading(false)
    }
  }

  async function handleEquipItem(inventoryItemId: string, equip: boolean) {
    const token = localStorage.getItem('jwt')
    if (!token) return
    setEquipping(true)
    try {
      await equipItem(token, inventoryItemId, equip)
      await loadInventory()
      setSelectedItem(null)
    } catch (e) {
      console.error('Equip item failed', e)
    } finally {
      setEquipping(false)
    }
  }
  // Новая вкладка "Снаряжение" (activeTab === 'gear') — теперь чистый инвентарь
  // на хардкоде, без старой экипировки/навыков/серверного equip-флоу. Ссылки
  // ниже только чтобы TS (noUnusedLocals) не считал этот код мёртвым — он
  // остаётся в файле на случай возврата серверной логики.
  void SLOT_LABELS
  void SlotIcon
  void savingSkills
  void inventoryLoading
  void selectedItem
  void equipping
  void handleSkillToggle
  void handleEquipItem

  if (loading) return <div style={{ padding: 20 }}>⏳ Загрузка...</div>
  if (error) return <div style={{ padding: 20, color: 'red' }}><b>Ошибка:</b> {error}</div>

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
            const charStats = [
              { iconSrc: `${import.meta.env.BASE_URL}assets/icons/icon_damage.png`, value: 15 + Math.floor(p.strength / 2), label:'Урон' },
              { iconSrc: `${import.meta.env.BASE_URL}assets/icons/icon_armor.png`, value: totalArmor, label:'Броня' },
              { iconSrc: `${import.meta.env.BASE_URL}assets/icons/icon_hp.png`, value: p.endurance, label:'Выносл.' },
              { iconSrc: `${import.meta.env.BASE_URL}assets/icons/icon_strength.png`, value: p.strength, label:'Сила' },
              { iconSrc: `${import.meta.env.BASE_URL}assets/icons/icon_agility.png`, value: p.agility, label:'Ловкость' },
              { iconSrc: `${import.meta.env.BASE_URL}assets/icons/icon_luck.png`, value: inventory.filter(i => i.equipped).reduce((sum, i) => sum + (i.item.luck ?? 0), 0), label:'Удача' },
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
                          <img
                            src={`${import.meta.env.BASE_URL}assets/equipment/processed/${equippedItem.item.iconPath}`}
                            style={{ width:22, height:22, objectFit:'contain' }}
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
            const POTIONS: { id: string; name: string; level: number; price: number; power: string; percent: number; desc: string; icon: string }[] = [
              { id:'muddy',   name:'Мутный отвар',    level:1,  price:20,  power:'немного',      percent:10, desc:'Горькая муть на дне склянки. Затянет царапины, не более.', icon:'potion_1_vial.png' },
              { id:'herbal',  name:'Травяной настой', level:5,  price:45,  power:'заметно',       percent:15, desc:'Пахнет сухими травами и сырым погребом. Хватит, чтобы отдышаться.', icon:'potion_2_flask.png' },
              { id:'crimson', name:'Багровое зелье',  level:10, price:90,  power:'средне',        percent:20, desc:'Тягучее и тёплое. Раны затягиваются, пока пьёшь.', icon:'potion_3_bulb.png' },
              { id:'thick',   name:'Густой эликсир',  level:20, price:160, power:'сильно',        percent:25, desc:'Тяжёлый, как ртуть. Поднимает и переломанного.', icon:'potion_4_jug.png' },
              { id:'pilgrim', name:'Кровь пилигрима', level:30, price:280, power:'очень сильно',  percent:30, desc:'Говорят, её собирали у тех, кто дошёл. Крепче в этих краях не сыскать.', icon:'potion_5_ampoule.png' },
            ]
            const playerLevel = player?.level ?? 1
            const selectedPotion = POTIONS.find(p => p.id === shopSelectedPotion) ?? null

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
                  {POTIONS.map(p => {
                    const unlocked = playerLevel >= p.level
                    return (
                      <div key={p.id}
                        onClick={() => { setShopSelectedPotion(p.id); setShopQty(1) }}
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
                          alt={p.name}
                          style={{ width:'100%', height:'100%', objectFit:'contain', display:'block' }}
                        />
                        <div style={{
                          position:'absolute', right:4, bottom:4,
                          background:'rgba(21,18,24,0.85)',
                          borderRadius:5, padding:'2px 6px',
                          fontSize:11, fontFamily:FONT_DISPLAY,
                          color: unlocked ? C.glowCore : C.textDim,
                        }}>
                          {unlocked ? p.price : `ур. ${p.level}`}
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
                          alt={selectedPotion.name}
                          style={{ width:54, height:54, objectFit:'contain', display:'block' }}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize:15, color:C.textMain }}>{selectedPotion.name}</div>
                        <div style={{ fontSize:11, color:C.textDim, marginTop:2 }}>у тебя: 0</div>
                      </div>
                    </div>

                    <div style={{ fontSize:12, lineHeight:1.55, fontStyle:'italic', color:C.textDim, marginBottom:12 }}>
                      {selectedPotion.desc}
                    </div>

                    <div style={{ background:C.nicheDeep, borderRadius:8, padding:'9px 11px', display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
                      <div style={{ fontSize:12, color:C.textDim }}>Восстанавливает</div>
                      <div style={{ fontSize:13, color:C.bone }}>{selectedPotion.power} ({selectedPotion.percent}%)</div>
                    </div>

                    {playerLevel >= selectedPotion.level && (
                      <div style={{ display:'flex', gap:8, marginBottom:12 }}>
                        <div onClick={() => setShopQty(q => Math.max(1, q - 1))}
                          style={{
                            width:38, height:38, flexShrink:0, borderRadius:8,
                            background:C.nicheDeep, border:`1px solid ${C.stoneDark}`,
                            display:'flex', alignItems:'center', justifyContent:'center',
                            fontSize:16, color:C.textMain, cursor:'pointer',
                          }}>−</div>
                        <div style={{
                          flex:1, borderRadius:8,
                          background:C.nicheDeep, boxShadow:'inset 0 2px 5px rgba(0,0,0,0.55)',
                          display:'flex', alignItems:'center', justifyContent:'center',
                          fontFamily:FONT_DISPLAY, fontSize:14, color:C.textMain,
                        }}>{shopQty}</div>
                        <div onClick={() => setShopQty(q => Math.min(99, q + 1))}
                          style={{
                            width:38, height:38, flexShrink:0, borderRadius:8,
                            background:C.nicheDeep, border:`1px solid ${C.stoneDark}`,
                            display:'flex', alignItems:'center', justifyContent:'center',
                            fontSize:16, color:C.textMain, cursor:'pointer',
                          }}>+</div>
                      </div>
                    )}

                    {playerLevel >= selectedPotion.level ? (
                      <div
                        onClick={() => {}}
                        style={{
                          background:C.nicheDeep, border:`1px solid ${C.glowEdge}`,
                          borderRadius:9, padding:11, textAlign:'center',
                          color:C.glowCore, fontSize:14, cursor:'pointer',
                          boxShadow:'inset 0 0 12px rgba(209,151,68,0.28)',
                        }}>
                        Купить за {selectedPotion.price * shopQty}
                      </div>
                    ) : (
                      <div
                        style={{
                          background:C.nicheDeep, border:`1px solid ${C.stoneDark}`,
                          borderRadius:9, padding:11, textAlign:'center',
                          color:C.textDim, fontSize:14,
                        }}>
                        Откроется на {selectedPotion.level} уровне
                      </div>
                    )}
                  </div>
                </div>
              )}

            </div>
            )
          })()}
          {activeTab === 'gear' && (() => {
            const SLOT_ORDER = ['weapon', 'helmet', 'armor', 'gloves', 'boots', 'amulet']
            const SLOT_CODE: Record<string, string> = {
              weapon:'wpn', helmet:'hlm', armor:'arm', gloves:'glv', boots:'bts', amulet:'amu',
            }
            type CatalogEntry = { name: string; desc: string; stat: string }
            const ITEM_CATALOG: Record<string, CatalogEntry[]> = {
              weapon: [
                { name:'Ржавый тесак', stat:'Урон +5 · Рост силы +5%', desc:'Им резали хлеб чаще, чем врагов. Держат такой от безысходности.' },
                { name:'Солдатский меч', stat:'Урон +10 · Рост силы +10%', desc:'Клеймо стёрлось, но балансировка честная. Такими вооружали тех, кого не жалко.' },
                { name:'Клинок дознавателя', stat:'Урон +15 · Рост силы +15%', desc:'Узкий, чтобы проходить между рёбер. Дознаватели редко спрашивали дважды.' },
                { name:'Гвардейский палаш', stat:'Урон +20 · Рост силы +20%', desc:'Тяжёлый и прямой, без хитростей. Гвардия не отступала, и оружие делали под это.' },
                { name:'Меч безымянного', stat:'Урон +25 · Рост силы +25%', desc:'На рукояти вырезано имя, но прочесть его уже нельзя. Владелец, похоже, не возражает.' },
                { name:'Клинок правого места', stat:'Урон +30 · Рост силы +30%', desc:'Оказался там, где нужно, и тогда, когда нужно. Больше о нём сказать нечего.' },
              ],
              helmet: [
                { name:'Ржавый колпак', stat:'Броня +2', desc:'Ведро с прорезью для глаз. Внутри до сих пор пахнет прежним хозяином.' },
                { name:'Солдатский шлем', stat:'Броня +5', desc:'Вмятина на лбу говорит, что он однажды уже сделал свою работу.' },
                { name:'Забрало дознавателя', stat:'Броня +8', desc:'Прорезь узкая — чтобы видеть допрашиваемого, но не встречаться с ним взглядом.' },
                { name:'Гвардейский армет', stat:'Броня +10', desc:'Плотно садится, глушит звук. В нём слышно только собственное дыхание.' },
                { name:'Шлем безымянного', stat:'Броня +13', desc:'Подогнан под чужую голову, но садится как влитой. Лучше об этом не думать.' },
                { name:'Венец правого места', stat:'Броня +15', desc:'Не корона и не шлем. Что-то, что носят, когда больше некому.' },
              ],
              armor: [
                { name:'Драная кожанка', stat:'Броня +5 · Рост выносливости +5%', desc:'Больше от холода, чем от клинка. Но всё-таки лучше, чем ничего.' },
                { name:'Солдатская кольчуга', stat:'Броня +10 · Рост выносливости +10%', desc:'Половина колец перебрана вручную, и не тобой. Кто-то за ней следил.' },
                { name:'Панцирь дознавателя', stat:'Броня +15 · Рост выносливости +15%', desc:'Чёрненая сталь, чтобы не бликовать в тёмных комнатах. Практично.' },
                { name:'Гвардейская кираса', stat:'Броня +20 · Рост выносливости +20%', desc:'Цельная, без стыков на груди. Такую не пробьёшь ударом в упор.' },
                { name:'Доспех безымянного', stat:'Броня +25 · Рост выносливости +25%', desc:'Ни герба, ни клейма — всё сточено начисто. Он не хотел, чтобы его узнали.' },
                { name:'Доспех правого места', stat:'Броня +30 · Рост выносливости +30%', desc:'Выдержал то, что не должно было выдержаться. Дальше зависит от тебя.' },
              ],
              gloves: [
                { name:'Обмотки', stat:'Броня +2 · Рост ловкости +5%', desc:'Полосы ткани, намотанные в несколько слоёв. Хотя бы не собьёшь костяшки.' },
                { name:'Солдатские рукавицы', stat:'Броня +5 · Рост ловкости +10%', desc:'Грубая кожа, задубевшая от пота. Зато рукоять не проскальзывает.' },
                { name:'Латницы дознавателя', stat:'Броня +8 · Рост ловкости +15%', desc:'Пластины на пальцах сидят плотно, движения не стесняют. Работа тонкая.' },
                { name:'Гвардейские латницы', stat:'Броня +10 · Рост ловкости +20%', desc:'Закрывают кисть целиком, до середины предплечья. Тяжело, но привыкаешь.' },
                { name:'Перчатки безымянного', stat:'Броня +13 · Рост ловкости +25%', desc:'Разношены под чужую руку, но твоей подходят. Совпадение, надо думать.' },
                { name:'Хватка правого места', stat:'Броня +15 · Рост ловкости +30%', desc:'Пальцы смыкаются раньше, чем ты решаешь сжать. Так и должно быть.' },
              ],
              boots: [
                { name:'Стоптанные башмаки', stat:'Скорость +2%', desc:'Подошва протёрта до дыр. Каждый камень чувствуется как свой.' },
                { name:'Солдатские сапоги', stat:'Скорость +4%', desc:'Прошагали не одну сотню миль и готовы ещё. Голенище держит лодыжку.' },
                { name:'Поступь дознавателя', stat:'Скорость +6%', desc:'Мягкая подошва, почти не слышно шагов. Он приходил без предупреждения.' },
                { name:'Гвардейские поножи', stat:'Скорость +8%', desc:'Окованный носок, укреплённая пятка. В таких стоят насмерть.' },
                { name:'Сапоги безымянного', stat:'Скорость +9%', desc:'Стёрты неровно, будто он всё время сворачивал куда-то влево.' },
                { name:'Поступь правого места', stat:'Скорость +10%', desc:'Ноги сами выбирают, куда ступить. Спорить с ними себе дороже.' },
              ],
              amulet: [
                { name:'Медный грошик', stat:'Удача +1', desc:'Монета с дыркой, на шнурке. Ничего не стоит, но с ней спокойнее.' },
                { name:'Солдатский образок', stat:'Удача +2', desc:'Затёртый до гладкости — его держали в кулаке слишком часто.' },
                { name:'Печать дознавателя', stat:'Удача +3', desc:'Оттиск сбит намеренно, чтобы никто не разобрал, чья она.' },
                { name:'Гвардейский знак', stat:'Удача +4', desc:'Выдавался за выслугу. Тем, кто дожил до выслуги.' },
                { name:'Оберег безымянного', stat:'Удача +5', desc:'Пустая оправа — камень выпал давно. Работать почему-то не перестал.' },
                { name:'Глаз правого места', stat:'Удача +7', desc:'Смотрит не наружу, а куда-то мимо. Иногда кажется, что он моргнул.' },
              ],
            }
            const TEST_INVENTORY: { slot: string; tier: number; qty: number }[] = [
              { slot:'weapon', tier:3, qty:1 },
              { slot:'weapon', tier:1, qty:3 },
              { slot:'helmet', tier:2, qty:1 },
              { slot:'armor', tier:2, qty:1 },
              { slot:'boots', tier:1, qty:2 },
              { slot:'amulet', tier:1, qty:1 },
            ]
            const POTION_CATALOG: { id: string; name: string; icon: string; stat: string; desc: string }[] = [
              { id:'pilgrim', name:'Кровь пилигрима', icon:'potion_5_ampoule.png', stat:'Восстанавливает — очень сильно (30%)', desc:'Говорят, её собирали у тех, кто дошёл. Крепче в этих краях не сыскать.' },
              { id:'thick',   name:'Густой эликсир',  icon:'potion_4_jug.png',     stat:'Восстанавливает — сильно (25%)',       desc:'Тяжёлый, как ртуть. Поднимает и переломанного.' },
              { id:'crimson', name:'Багровое зелье',  icon:'potion_3_bulb.png',    stat:'Восстанавливает — средне (20%)',       desc:'Тягучее и тёплое. Раны затягиваются, пока пьёшь.' },
              { id:'herbal',  name:'Травяной настой', icon:'potion_2_flask.png',   stat:'Восстанавливает — заметно (15%)',      desc:'Пахнет сухими травами и сырым погребом. Хватит, чтобы отдышаться.' },
              { id:'muddy',   name:'Мутный отвар',    icon:'potion_1_vial.png',    stat:'Восстанавливает — немного (10%)',      desc:'Горькая муть на дне склянки. Затянет царапины, не более.' },
            ]
            const TEST_POTIONS: { potionId: string; qty: number }[] = [
              { potionId:'muddy', qty:4 },
              { potionId:'crimson', qty:2 },
            ]

            type InvCell = {
              key: string
              iconSrc: string
              alt: string
              qty: number
              group: number
              rank: number
              open: { kind: 'item'; slot: string; tier: number } | { kind: 'potion'; potionId: string }
            }
            const itemCells: InvCell[] = TEST_INVENTORY.map(it => ({
              key: `item-${it.slot}-${it.tier}`,
              iconSrc: `${import.meta.env.BASE_URL}assets/icons/items/${SLOT_CODE[it.slot]}_t${it.tier}.png`,
              alt: ITEM_CATALOG[it.slot][it.tier - 1].name,
              qty: it.qty,
              group: SLOT_ORDER.indexOf(it.slot),
              rank: -it.tier,
              open: { kind:'item', slot: it.slot, tier: it.tier },
            }))
            const potionCells: InvCell[] = TEST_POTIONS.map(p => {
              const idx = POTION_CATALOG.findIndex(c => c.id === p.potionId)
              return {
                key: `potion-${p.potionId}`,
                iconSrc: `${import.meta.env.BASE_URL}assets/icons/${POTION_CATALOG[idx].icon}`,
                alt: POTION_CATALOG[idx].name,
                qty: p.qty,
                group: SLOT_ORDER.length,
                rank: idx,
                open: { kind:'potion', potionId: p.potionId },
              }
            })
            const sortedInventory = [...itemCells, ...potionCells].sort((a, b) => a.group - b.group || a.rank - b.rank)
            const TOTAL_CELLS = 30
            const selectedEntry = gearSelectedItem ? (() => {
              if (gearSelectedItem.kind === 'item') {
                const catalogItem = ITEM_CATALOG[gearSelectedItem.slot][gearSelectedItem.tier - 1]
                const invRow = TEST_INVENTORY.find(i => i.slot === gearSelectedItem.slot && i.tier === gearSelectedItem.tier)
                return {
                  kind:'item' as const,
                  name: catalogItem.name, desc: catalogItem.desc, stat: catalogItem.stat,
                  qty: invRow?.qty ?? 0,
                  iconSrc: `${import.meta.env.BASE_URL}assets/icons/items/${SLOT_CODE[gearSelectedItem.slot]}_t${gearSelectedItem.tier}.png`,
                }
              }
              const potion = POTION_CATALOG.find(p => p.id === gearSelectedItem.potionId)!
              const invRow = TEST_POTIONS.find(p => p.potionId === gearSelectedItem.potionId)
              return {
                kind:'potion' as const,
                name: potion.name, desc: potion.desc, stat: potion.stat,
                qty: invRow?.qty ?? 0,
                iconSrc: `${import.meta.env.BASE_URL}assets/icons/${potion.icon}`,
              }
            })() : null

            return (
            <div style={{ padding: '0 4px' }}>

              {/* Шапка */}
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'20px 16px 14px' }}>
                <div style={{ fontFamily:FONT_DISPLAY, fontSize:16, color:C.textMain }}>Снаряжение</div>
                <div style={{ fontSize:12, color:C.textDim }}>{sortedInventory.length} / {TOTAL_CELLS}</div>
              </div>

              {/* Сетка ячеек */}
              {sortedInventory.length === 0 ? (
                <div style={{ padding:'40px 0', textAlign:'center', fontSize:13, color:C.textDim }}>Пусто</div>
              ) : (
                <div style={{ display:'grid', gridTemplateColumns:'repeat(5, minmax(0, 1fr))', gap:5, padding:'0 8px' }}>
                  {sortedInventory.map((cell) => (
                    <div key={cell.key}
                      onClick={() => setGearSelectedItem(cell.open)}
                      style={{
                        boxSizing:'border-box', position:'relative', aspectRatio:'1',
                        background:C.nicheDeep, border:`1px solid ${C.stoneDark}`, borderRadius:8,
                        boxShadow:'inset 0 2px 5px rgba(0,0,0,0.5)', cursor:'pointer',
                      }}>
                      <img
                        src={cell.iconSrc}
                        alt={cell.alt}
                        style={{ width:'100%', height:'100%', objectFit:'contain' }}
                      />
                      {cell.qty > 1 && (
                        <div style={{ position:'absolute', right:2, bottom:1, fontSize:9, color:C.bone }}>×{cell.qty}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Карточка предмета */}
              {selectedEntry && (
                <div
                  onClick={() => setGearSelectedItem(null)}
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
                          src={selectedEntry.iconSrc}
                          alt={selectedEntry.name}
                          style={{ width:54, height:54, objectFit:'contain', display:'block' }}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize:15, color:C.textMain }}>{selectedEntry.name}</div>
                        <div style={{ fontSize:11, color:C.textDim, marginTop:2 }}>у тебя: {selectedEntry.qty}</div>
                      </div>
                    </div>

                    <div style={{ fontSize:12, lineHeight:1.55, fontStyle:'italic', color:C.textDim, marginBottom:12 }}>
                      {selectedEntry.desc}
                    </div>

                    <div style={{ background:C.nicheDeep, borderRadius:8, padding:'9px 11px', marginBottom:12 }}>
                      <div style={{ fontSize:12, color:C.bone }}>{selectedEntry.stat}</div>
                    </div>

                    <div style={{ display:'flex', gap:8 }}>
                      {selectedEntry.kind === 'item' && (
                        <div
                          onClick={() => {}}
                          style={{
                            flex:1, background:C.nicheDeep, border:`1px solid ${C.glowEdge}`,
                            borderRadius:9, padding:11, textAlign:'center',
                            color:C.glowCore, fontSize:14, cursor:'pointer',
                            boxShadow:'inset 0 0 12px rgba(209,151,68,0.28)',
                          }}>
                          Надеть
                        </div>
                      )}
                      <div
                        onClick={() => {}}
                        style={{
                          flex:1, background:C.nicheDeep, border:`1px solid ${C.stoneDark}`,
                          borderRadius:9, padding:11, textAlign:'center',
                          color:C.textDim, fontSize:14, cursor:'pointer',
                        }}>
                        Продать
                      </div>
                    </div>
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
              onClick={() => { if (!notEnoughEnergy) { setExploreMapFile(undefined); setShowExploreTest(true) } }}
              style={{
                boxSizing:'border-box',
                background:C.nicheDeep, border:`1px solid ${C.glowEdge}`,
                borderRadius:9, padding:13, textAlign:'center',
                boxShadow:'inset 0 0 14px rgba(209,151,68,0.3)',
                opacity: notEnoughEnergy ? 0.5 : 1,
                cursor: notEnoughEnergy ? 'default' : 'pointer',
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
          {id:'gear', label:'Снаряжение', icon:'nav_gear.png'},
          {id:'friends', label:'Друзья', icon:'nav_friends.png'},
        ] as const).map(tab => {
          const active = activeTab === tab.id
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
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

      {showExploreTest && <Explore mapFile={exploreMapFile} onClose={() => setShowExploreTest(false)} endurance={player?.endurance} strength={player?.strength} level={player?.level} trophies={player?.trophies} armor={totalArmor} onRunComplete={handleExploreRunComplete} token={isTelegramSession ? (localStorage.getItem('jwt') ?? undefined) : undefined} />}
    </div>
  )
}