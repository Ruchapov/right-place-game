import { useEffect, useRef, useState } from 'react'
import { Application, Assets, AnimatedSprite, Container, Graphics, Rectangle, Sprite, Text, Texture, TilingSprite } from 'pixi.js'
import { renderMapToCanvas, backdropPaths } from './mapRenderer'
import * as C from './explore/constants'
import SettingsPanel from './explore/ui/SettingsPanel'
import TouchControls from './explore/ui/TouchControls'
import HudPlate from './explore/ui/HudPlate'
import type {
  Grid,
  EventKind,
  EventCandidate,
  BossAnimKind,
  RewardKind,
  PlayerPhysics,
  Enemy,
  Chest,
  Smuggler,
  Obelisk,
  Boss,
  ObeliskHud,
  RewardFloat,
  BossSpike,
  BossWave,
  MapEvent,
} from './explore/types'
import {
  isSolid,
  isPlatformBandBlocking,
  isOverlappingPlatformBand,
  isTouchingSpikes,
  cellFootBlockTop,
  sweepHeadBlock,
  isOverlappingAtFrameStart,
  sweepFootBlock,
} from './explore/collision'
import { backdropForMap, slotsFileForMap, isPointXY, buildEventCandidates } from './explore/mapEvents'
import { clamp, pickRandom } from './explore/utils'
import { rollTrophies } from './explore/rewards'
import { loadExploreAssets } from './explore/assets'
import { createSkillsSystem } from './explore/entities/skills'
import { createEnemySystem, redrawEnemyHpBar } from './explore/entities/enemy'
import type { BeastFrames } from './explore/entities/enemy'
import { createBossSystem, redrawBossHpBar } from './explore/entities/boss'

type ExploreProps = {
  onClose?: () => void
  endurance?: number
  strength?: number
  // Временный каркас "3 события за забег": вызывается ровно один раз, когда
  // все 3 выбранных события закрыты. kind — 'enemy'|'chest'|'smuggler'|'puzzle'|
  // 'boss', совпадает с ключами ROOM_LABELS в App.tsx.
  onRunComplete?: (closedEvents: { kind: EventKind }[]) => void
  // Имя файла сетки карты (напр. 'map_B_razlom.txt'). Не задан — DEFAULT_MAP_FILE
  // (см. ниже), 1:1 прежнее поведение. App.tsx пока этот проп не передаёт.
  mapFile?: string
}

// Зона удара атаки, в мировых (тайловых) координатах — читается будущим
// hit-test'ом врага/сундука через attackHitboxRef.
type AttackHitbox = { x: number; y: number; width: number; height: number }

export default function Explore({ onClose, endurance, strength, onRunComplete, mapFile: mapFileProp }: ExploreProps) {
  // Проп не задан (текущий вход из App.tsx) → DEFAULT_MAP_FILE, 1:1 прежнее
  // поведение. State (не const) — TEMP: map switcher (см. ниже) меняет её,
  // чтобы перезапустить эффект инициализации PixiJS на другой карте (mapFile
  // в его массиве зависимостей). setup() читает актуальное значение через
  // обычное замыкание, как и раньше читал endurance/strength для maxHp.
  const [mapFile, setMapFile] = useState(mapFileProp ?? C.DEFAULT_MAP_FILE)
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const physicsRef = useRef<PlayerPhysics>({ x: 0, y: 0, vx: 0, vy: 0, onGround: false })
  // Визуал героя (AnimatedSprite поверх хитбокса-Graphics, который остаётся
  // невидимым, но живым — коллизия по-прежнему считается по нему). Ref, не
  // state — позиция обновляется каждый кадр в ticker'е.
  const heroSpriteRef = useRef<AnimatedSprite | null>(null)
  // Кадры зверя (см. BeastFrames выше) — загружены один раз в setup(),
  // доступны отовсюду (enemySystem.spawn, applyAttackHit) через этот ref,
  // как deathFramesRef у героя.
  const beastFramesRef = useRef<BeastFrames | null>(null)
  // >0 — проигрывается land (короткая анимация приземления), в мс. Тикает
  // вниз в ticker'е; движение/прыжок прерывают её досрочно (landTimerRef = 0).
  const landTimerRef = useRef(0)
  // >0 — проигрывается hurt (хитстан от урона), в мс. Главнее attack/land/run
  // по приоритету анимаций (см. ticker) — обрывает замах атаки, см. triggerHurt.
  const hurtTimerRef = useRef(0)
  // true — идёт смерть, блокирует ВСЁ остальное в блоке анимации героя
  // (высший приоритет, проверяется первым в тикере). Не сбрасывается назад в
  // false — забег в любом случае завершается через abandon.
  const deathRef = useRef(false)
  const deathHoldRef = useRef(0) // мс удержания последнего кадра death, копится ПОСЛЕ того, как анимация доиграла
  const deathAbandonFiredRef = useRef(false) // защита от повторного вызова abandon за кадры удержания
  // AnimatedSprite/кадры death недоступны из takeDamage (объявлены внутри
  // setup(), другая замкнутая область видимости) — зеркалим их в ref'ы, как
  // heroSpriteRef уже зеркалит hero, чтобы triggerDeath мог их прочитать.
  const deathFramesRef = useRef<Texture[] | null>(null)
  const dirRef = useRef(0) // -1 влево, 0 стоп, 1 вправо — читается каждый кадр в ticker
  const jumpPressedRef = useRef(false) // флаг нажатия, читается и сбрасывается в ticker

  // "3 события за забег" — временный каркас. eventsRef хранит выбранные события
  // и их Pixi-маркеры (заполняется в setup(), после загрузки слот-файла).
  // eventClosed — состояние ТОЛЬКО для HUD-иконок сверху (закрытий мало, до 3
  // за забег, — в отличие от HP лишний ререндер тут не проблема).
  const eventsRef = useRef<MapEvent[]>([])
  const runCompleteFiredRef = useRef(false)
  const onRunCompleteRef = useRef<(closedEvents: { kind: EventKind }[]) => void>(() => {})
  const [eventClosed, setEventClosed] = useState<boolean[]>(Array(C.EVENTS_PER_RUN).fill(false))
  // eventKinds — параллельно eventClosed (тот же индекс = то же событие), только
  // для HUD-иконок (какой эмодзи/тип рисовать) — на closed-логику не влияет.
  const [eventKinds, setEventKinds] = useState<EventKind[]>([])

  // maxHp не меняется в течение забега — считаем один раз из endurance персонажа.
  const maxHp = endurance && endurance > 0 ? endurance * C.HP_PER_ENDURANCE : C.FALLBACK_MAX_HP
  // Текущее hp — в ref, не в state: меняется в игровом цикле каждый кадр,
  // ререндер React на это не нужен. HP-бар обновляется вручную через DOM-refs.
  const hpRef = useRef(maxHp)
  const hpFillRef = useRef<HTMLDivElement>(null)
  const hpTextRef = useRef<HTMLSpanElement>(null)

  // Стабильная ссылка на takeDamage для будущих источников урона (шипы и т.п.),
  // которые будут жить внутри ticker'а (см. useEffect ниже): вызывают через
  // takeDamageRef.current(amount), не импортируя функцию напрямую.
  const takeDamageRef = useRef<(amount: number) => void>(() => {})
  // Готовый вызов "нанести урон шипов" с уже посчитанной дозой (maxHp * ratio).
  // Обновляется тем же эффектом, что и takeDamageRef — так основной ticker-эффект
  // (mount-once, deps []) не должен напрямую читать maxHp из тела компонента.
  const applySpikeDamageRef = useRef<() => void>(() => {})
  // Остаток неуязвимости после касания шипов, мс. Тикает в ticker'е по
  // ticker.deltaMS (реальное время), не по dt-кадрам — 1 секунда буквально.
  const spikeIframeRef = useRef(0)

  // dirRef (см. выше) — только МГНОВЕННЫЙ ввод, сбрасывается в 0 при отпускании
  // кнопки, а не "куда смотрит игрок" — такого флага в файле раньше не было.
  // facingRef запоминает последнее ненулевое направление (по умолчанию вправо),
  // обновляется в ticker'е при движении и используется для стороны удара.
  const facingRef = useRef<1 | -1>(1)

  // Атака игрока — числа из Battle.tsx (ATTACK_RANGE/ATTACK_COOLDOWN выше).
  const attackDamage = 15 + Math.floor((strength ?? 0) / 2)
  // Готовое значение урона — держим наготове для будущего врага/сундука,
  // сам урон пока никому не применяется (только механизм хитбокса).
  const attackDamageRef = useRef(attackDamage)
  const attackPressedRef = useRef(false) // флаг тапа по ⚔, читается и сбрасывается в ticker (как jumpPressedRef)
  const attackCooldownRef = useRef(0) // остаток кулдауна, секунды — как cooldownLeft в Battle.tsx
  const attackActiveRef = useRef(false) // true на короткое окно после удара — хитбокс активен
  const attackActiveTimerRef = useRef(0) // остаток окна активности хитбокса, мс (ATTACK_ACTIVE_MS)
  // Зона удара в мировых координатах на время активности — читает будущий
  // hit-test врага/сундука. null, когда удара сейчас нет.
  const attackHitboxRef = useRef<AttackHitbox | null>(null)
  // Увеличивается на 1 при каждом НОВОМ взмахе (см. attackPressedRef ниже) —
  // враг сверяет его со своим lastHitSwingId, чтобы засчитать один взмах
  // ровно один раз, даже если хитбокс активен несколько кадров подряд.
  const attackSwingIdRef = useRef(0)
  const attackingRef = useRef(false) // true пока проигрывается анимация атаки
  const attackHitDoneRef = useRef(false) // урон этого замаха уже применён (applyAttackHit вызывается ровно один раз)
  // Facing на МОМЕНТ старта замаха — во время атаки флип не меняется, даже
  // если игрок зажал движение в другую сторону (визуально странно иначе,
  // хитбокс всё равно снят по facing на старте).
  const attackFacingRef = useRef<1 | -1>(1)

  // Питьё зелья (ТОЛЬКО визуал — см. задачу: без хила/зарядов/кулдауна, это
  // отдельный будущий шаг). drinkPressedRef — флаг тапа по 🧪/KeyH, читается
  // и сбрасывается в ticker (как attackPressedRef). drinkingRef — true, пока
  // проигрывается анимация питья: герой закоренён (движение/прыжок/атака/
  // dodge игнорируются), ветка приоритета между hurt и attack.
  const drinkPressedRef = useRef(false)
  const drinkingRef = useRef(false)
  // Игровая логика зелья (Explore офлайн — локальные заряды, НЕ currentRun).
  const potionChargesRef = useRef(3) // локальные заряды, старт 3
  const potionCdRef = useRef(0) // остаток кулдауна, секунды — тикает как attackCooldownRef
  const potionHealedThisDrinkRef = useRef(false) // хил текущего питья уже применён?
  // DOM-узел кнопки 🧪 (создаётся императивно в fan-блоке ниже, не JSX) — нужен
  // здесь, чтобы обновлять подпись "🧪 ×N"/opacity из ticker'а тем же способом,
  // каким HP-бар обновляется через hpFillRef/hpTextRef (updateHpBar).
  const potionBtnRef = useRef<HTMLButtonElement | null>(null)

  // СПИСОК врагов (Шаг 2-3): по одному enemy-событию — до 3 врагов (весь
  // кластер), может быть несколько enemy-событий за забег — значит и больше
  // 3 суммарно. Каждый обрабатывается независимо в тикере (движение,
  // преследование, windup, удар по игроку, приём урона, смерть).
  const enemiesRef = useRef<Enemy[]>([])

  // Сундуки (reward-события) — по объекту Chest на событие. hitbox считается
  // ОДИН раз при создании (см. setup), читается каждый кадр в ticker'е для
  // мягкой стены по X (та же pushPlayerOutX, что и для живых врагов) —
  // хитбокс остаётся ВСЕГДА, и закрытый, и открытый сундук.
  const chestsRef = useRef<Chest[]>([])

  // Смуглеры (NPC-события) — по объекту Smuggler на событие. НЕ стена (в
  // отличие от сундука/врага) — никакого push-out по X, сквозь него можно
  // пройти (см. задачу). Пока чисто визуальный список: idle-анимация, без
  // взаимодействия/хитбокса.
  const smugglersRef = useRef<Smuggler[]>([])

  // Плавающие попапы наград (см. RewardFloat/spawnRewardFloat) — Explore
  // офлайн, ТОЛЬКО визуал, никакого начисления player.gold/trophies здесь.
  const rewardFloatsRef = useRef<RewardFloat[]>([])

  // Обелиски (карта F, см. type Obelisk выше) — событие рулетки "3 события",
  // как сундук/смуглер (см. eventsRef.current.map в setup()). Burning-кадры
  // загружены заранее, переключаются на них по удару (см. applyAttackHit).
  const obelisksRef = useRef<Obelisk[]>([])
  const obeliskBurningFramesRef = useRef<Texture[]>([])
  // Состояние события "сбить все обелиски" (см. задачу) — рефы, не state,
  // читаются/пишутся КАЖДЫЙ кадр в ticker'е. Кандидаты и точка стартового
  // обелиска нужны для доспавна: остальные точки берутся из кандидатов
  // минус уже занятая стартовая. eventIndex — индекс в eventsRef.current,
  // нужен, чтобы closeEvent() при успехе зажёг нужное гнездо HUD.
  const obeliskEventActiveRef = useRef(false)
  const obeliskTimerRef = useRef(0)
  const obeliskStruckCountRef = useRef(0)
  const obeliskCandidatesRef = useRef<[number, number][]>([])
  const obeliskStartPointRef = useRef<[number, number] | null>(null)
  const obeliskEventIndexRef = useRef<number | null>(null)
  // eventIndex босса в chosenEvents/eventsRef.current (ФАЗА 5, см. задачу) —
  // по тому же образцу, что obeliskEventIndexRef: закрывает HUD-гнездо при
  // успехе (см. ticker — момент завершения death-анимации).
  const bossEventIndexRef = useRef<number | null>(null)
  // Последний сбитый обелиск — над ним показывается награда при успехе (см.
  // applyAttackHit / ticker ниже).
  const obeliskLastStruckRef = useRef<Obelisk | null>(null)
  // HUD (см. type ObeliskHud выше) — рисует таймер/счётчик поверх канваса,
  // обновляется из ticker'а только на изменении целого числа (см. setObeliskHud
  // ниже), не каждый кадр — иначе ре-рендер 60 раз/сек просадит fps на телефоне.
  // Прев-значения — в refs (не сравниваем со state напрямую: замыкание ticker'а
  // держит state таким, каким он был на момент создания эффекта — протухшее
  // замыкание, тот же приём, что у остальных боевых refs в файле).
  const [obeliskHud, setObeliskHud] = useState<ObeliskHud | null>(null)
  const obeliskHudSecondsRef = useRef(-1)
  const obeliskHudStruckRef = useRef(-1)

  // Босс карты C (ФАЗА 1, см. type Boss выше и задачу) — максимум ОДИН за
  // забег (не список, как enemiesRef), null пока не заспавнен/не карта C.
  const bossRef = useRef<Boss | null>(null)
  // Летящие шипы дальней атаки босса (ФАЗА 3, шаг 2, см. type BossSpike выше)
  // — независимый от bossRef список: шип, брошенный до смерти/despawn босса,
  // должен долетать и попадать сам по себе.
  const bossSpikesRef = useRef<BossSpike[]>([])
  // AoE-волны топота босса (см. type BossWave выше) — независимый от bossRef
  // список, по тому же образцу, что bossSpikesRef.
  const bossWavesRef = useRef<BossWave[]>([])
  // Dodge игрока (Шаг 2-2) — окно неуязвимости от удара врага + кулдаун кнопки.
  const dodgePressedRef = useRef(false) // флаг тапа по 🔄, читается и сбрасывается в ticker
  const dodgeIframeRef = useRef(0) // мс — пока > 0, удар врага игрока не задевает
  const dodgeCooldownRef = useRef(0) // мс — остаток кулдауна самой кнопки

  // Скиллы (см. explore/entities/skills.ts) — флаги тапа по ⚡/🔥, читаются и
  // сбрасываются ВНУТРИ createSkillsSystem().update(), тем же приёмом, что
  // attackPressedRef/dodgePressedRef выше. Сама логика скиллов пока пуста —
  // см. skills.ts.
  const skill1PressedRef = useRef(false)
  const skill2PressedRef = useRef(false)

  // Панель Смуглера (под-шаг): dodge рядом с живым смуглером открывает панель
  // вместо обычного dodge — пока флаг + console.log, самого окна ещё нет.
  const smugglerPanelOpenRef = useRef(false)
  // Какой именно смуглер открыл панель — нужен для позиционирования окна над
  // его головой и для проверки "игрок отошёл" в ticker'е (см. setup).
  const smugglerActiveRef = useRef<Smuggler | null>(null)
  // Ссылки на кнопки панели — пока не интерактивны (только вид, см. задачу),
  // заведены заранее для подключения кликов следующим шагом.
  const smugglerExchangeBtnRef = useRef<Container | null>(null)
  const smugglerLeaveBtnRef = useRef<Container | null>(null)

  function updateHpBar() {
    const fraction = Math.max(0, Math.min(1, hpRef.current / maxHp))
    if (hpFillRef.current) {
      // Ширина в % от контейнера фрейма (левый край окна тоже в % от него же —
      // см. JSX), а не от ширины самого окна — так left/width остаются в одной
      // системе координат и полоса не съезжает при resize.
      hpFillRef.current.style.width = `${C.HP_WINDOW_W * fraction * 100}%`
      hpFillRef.current.style.background = fraction <= 0.3 ? '#E0353B' : '#4FB477'
    }
    if (hpTextRef.current) {
      hpTextRef.current.textContent = `${hpRef.current}/${maxHp}`
    }
  }

  // Подпись кнопки 🧪 — тот же приём, что updateHpBar (DOM-ref, обновляется
  // ТОЛЬКО при реальном изменении значения — на старте и когда заряд
  // списывается на кадре глотка, не каждый кадр из ticker'а).
  function updatePotionButton() {
    const btn = potionBtnRef.current
    if (!btn) return
    btn.textContent = `🧪 ×${potionChargesRef.current}`
    btn.style.opacity = potionChargesRef.current > 0 ? '1' : '0.5'
  }

  // Хитстан от урона: обрывает замах атаки и на HURT_MS блокирует новую атаку
  // (см. attackPressedRef-обработчик в setup). Определена на уровне компонента
  // (не внутри setup/applyAttackHit), т.к. вызывается из takeDamage ниже —
  // единой точки "игрок получил урон", которая сама объявлена здесь же, ДО
  // setup() и его замыканий, и трогает только refs (доступны отовсюду в компоненте).
  function triggerHurt() {
    hurtTimerRef.current = C.HURT_MS
    attackingRef.current = false // обрываем замах (хитстан)
    attackHitDoneRef.current = false
    drinkingRef.current = false // обрываем питьё (хитстан главнее)
    landTimerRef.current = 0 // hurt важнее land
  }

  // Запускает анимацию смерти вместо мгновенного abandon — сам abandon
  // (onClose) срабатывает позже, из блока анимации в тикере, после того как
  // death доиграла и подержался последний кадр (DEATH_HOLD_MS), см. setup().
  // deathRef не сбрасывается назад — забег в любом случае завершится.
  function triggerDeath() {
    if (deathRef.current) return // уже идёт — не перезапускаем повторно
    deathRef.current = true
    deathHoldRef.current = 0
    attackingRef.current = false
    drinkingRef.current = false // обрываем питьё (смерть главнее)
    hurtTimerRef.current = 0
    landTimerRef.current = 0
    const hero = heroSpriteRef.current
    const deathFrames = deathFramesRef.current
    if (hero && deathFrames) {
      hero.textures = deathFrames
      hero.loop = false
      hero.animationSpeed = C.DEATH_ANIM_SPEED
      hero.gotoAndPlay(0)
      hero.anchor.set(0.5, C.GROUND_ANCHOR_Y)
    }
  }

  // Единая точка "игрок получает урон" — вызывается и шипами
  // (applySpikeDamageRef), и атакой зверя (takeDamageRef в ticker'е).
  // Смерть (hp <= 0) запускает death (triggerDeath) вместо мгновенного
  // abandon — сам abandon (onClose) переехал в тикер, см. triggerDeath.
  function takeDamage(amount: number) {
    hpRef.current = Math.max(0, hpRef.current - amount)
    updateHpBar()
    if (hpRef.current <= 0) {
      triggerDeath()
    } else {
      triggerHurt()
    }
  }

  // "Свежая" ссылка на takeDamage кладётся в ref эффектом (не во время рендера),
  // чтобы будущий hazard-код внутри ticker'а всегда вызывал актуальную версию.
  useEffect(() => {
    takeDamageRef.current = takeDamage
    applySpikeDamageRef.current = () => takeDamage(maxHp * C.SPIKE_DAMAGE_RATIO)
    onRunCompleteRef.current = onRunComplete ?? (() => {})
    attackDamageRef.current = attackDamage
  })

  // Клавиатура — второй способ ввода поверх экранных кнопок (Шаг: keyboard
  // controls). Дёргает РОВНО те же refs, что и onPointerDown/Up у кнопок выше
  // (dirRef/jumpPressedRef/attackPressedRef/dodgePressedRef/drinkPressedRef/
  // skill1PressedRef/skill2PressedRef) — никакой отдельной логики. Сами
  // скиллы за флагами пока пусты, см. explore/entities/skills.ts.
  useEffect(() => {
    // Сравнение по e.code (физическая клавиша), НЕ по e.key (символ, зависящий
    // от раскладки) — на русской раскладке e.key для буквенных клавиш отдаёт
    // русскую букву, и case по 'j'/'k' никогда не матчился.
    function handleKeyDown(e: KeyboardEvent) {
      switch (e.code) {
        case 'ArrowLeft':
        case 'KeyA':
          dirRef.current = -1
          if (e.code === 'ArrowLeft') e.preventDefault()
          break
        case 'ArrowRight':
        case 'KeyD':
          dirRef.current = 1
          if (e.code === 'ArrowRight') e.preventDefault()
          break
        case 'ArrowUp':
        case 'Space':
          e.preventDefault()
          if (e.repeat) return
          jumpPressedRef.current = true
          break
        case 'KeyJ':
          if (e.repeat) return
          attackPressedRef.current = true
          break
        case 'KeyK':
          if (e.repeat) return
          dodgePressedRef.current = true
          break
        case 'KeyH':
          if (e.repeat) return
          // Зелье — ПОКА ТОЛЬКО визуал (анимация питья), как и экранная
          // кнопка 🧪 — хила/зарядов/кулдауна нет, это отдельный будущий шаг.
          drinkPressedRef.current = true
          break
        case 'Digit1':
          if (e.repeat) return
          skill1PressedRef.current = true
          break
        case 'Digit2':
          if (e.repeat) return
          skill2PressedRef.current = true
          break
      }
    }

    function handleKeyUp(e: KeyboardEvent) {
      switch (e.code) {
        case 'ArrowLeft':
        case 'KeyA':
          if (dirRef.current === -1) dirRef.current = 0
          break
        case 'ArrowRight':
        case 'KeyD':
          if (dirRef.current === 1) dirRef.current = 0
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  useEffect(() => {
    let app: Application | null = null
    let cancelled = false
    // true ТОЛЬКО после успешного await app.init() — до этого момента у
    // Application нет renderer/ticker/resize-хуков, и destroy() на нём падает
    // ("this._cancelResize is not a function"). React 19 StrictMode монтирует
    // эффект дважды в dev, так что cleanup может сработать, пока setup() ещё
    // ждёт fetch/init — без этого флага он ловил недоинициализированный app.
    let initialized = false
    let onBgResize: (() => void) | null = null
    // Собирается внутри setup(), после worldContainer/grid/getPlayerCombatBox
    // — сюда же, во внешнюю область видимости эффекта, чтобы cleanup ниже
    // мог вызвать dispose() (тот же приём, что у onBgResize выше).
    let skills: ReturnType<typeof createSkillsSystem> | null = null
    let enemySystem: ReturnType<typeof createEnemySystem> | null = null
    let bossSystem: ReturnType<typeof createBossSystem> | null = null

    async function setup() {
      app = new Application()
      const base = import.meta.env.BASE_URL

      const [mapText, slots] = await Promise.all([
        fetch(`${base}assets/maps/${mapFile}`).then((res) => res.text()),
        fetch(`${base}assets/maps/${slotsFileForMap(mapFile)}`).then((res) => res.json()),
      ])

      const grid: Grid = mapText.split('\n').map((line) => line.split(''))
      const decor = slots.decor ?? []

      // Шипы из слотов карты — не весь пул, а HAZARD_SPIKES_PER_RUN случайных
      // точек за забег (меньше пула — берём сколько есть). Вставляем прямо в
      // рабочую сетку, ДО renderMapToCanvas и ДО первого кадра физики:
      // коллизия и рендер читают один и тот же grid, значит '^' должен
      // попасть именно сюда, а не в отдельную структуру.
      const hazardPool: [number, number][] = Array.isArray(slots.hazard) ? slots.hazard.filter(isPointXY) : []
      const chosenHazards = pickRandom(hazardPool, C.HAZARD_SPIKES_PER_RUN)
      for (const [hx, hy] of chosenHazards) {
        if (grid[hy] && hx >= 0 && hx < grid[hy].length) {
          grid[hy][hx] = '^'
        }
      }

      // "3 события за забег" — выбираем случайно, без повторов, из общего пула
      // (enemyCluster / сундук / смуглер / загадка / босс — что есть у карты).
      // На карте A есть только enemyClusters и reward. enemy-событие несёт
      // clusterPoints (все 3 точки кластера) — враги спавнятся ниже, после
      // создания worldContainer.
      //
      // Карта D в состоянии OPEN — ИСКЛЮЧЕНИЕ: Контрабандист там ГАРАНТИРОВАН
      // (см. CLAUDE.md), а не рядовой равновероятный кандидат среди ~11 —
      // иначе он часто не попадал в тройку. Вынимаем smuggler-кандидата из
      // пула и ставим ПЕРВЫМ, остальные EVENTS_PER_RUN-1 добираем pickRandom
      // из пула БЕЗ него (не задваивается). SEALED сюда не попадает — там
      // npc.smuggler=null, buildEventCandidates и так его не кладёт в пул.
      // Карта C — босс ВЕРОЯТНОСТНЫЙ (см. задачу): бросок BOSS_SPAWN_CHANCE
      // решается ОДИН раз здесь же, той же схемой пиннинга, что у
      // Контрабандиста на карте D OPEN выше — если выпало, единственный
      // kind:'boss' кандидат вынимается из пула и ставится ПЕРВЫМ (иначе
      // среди общего пула часто не попадал бы в тройку сам по себе). Не
      // выпало — кандидат просто исключается из пула (см. poolWithoutBoss
      // ниже), чтобы pickRandom не мог случайно вытащить его САМ; bossRef/
      // bossEventIndexRef остаются null (см. spawnBoss/сброс выше) — 3
      // события добираются обычным путём без него.
      const eventPool = buildEventCandidates(slots)
      let chosenEvents: EventCandidate[]
      const smugglerIndex = mapFile.startsWith('map_D_OPEN')
        ? eventPool.findIndex((ev) => ev.kind === 'smuggler')
        : -1
      const bossIndex = eventPool.findIndex((ev) => ev.kind === 'boss')
      // bossWillSpawn читается позже (spawnBoss ниже) — держит спавн самого
      // босса и его присутствие в chosenEvents синхронными: один и тот же
      // бросок решает и то, и другое.
      const bossWillSpawn = bossIndex !== -1 && Math.random() < C.BOSS_SPAWN_CHANCE
      if (smugglerIndex !== -1) {
        const smugglerCandidate = eventPool[smugglerIndex]
        const restPool = eventPool.filter((_, i) => i !== smugglerIndex)
        chosenEvents = [smugglerCandidate, ...pickRandom(restPool, C.EVENTS_PER_RUN - 1)]
      } else if (bossWillSpawn) {
        const bossCandidate = eventPool[bossIndex]
        const restPool = eventPool.filter((_, i) => i !== bossIndex)
        chosenEvents = [bossCandidate, ...pickRandom(restPool, C.EVENTS_PER_RUN - 1)]
      } else {
        const poolWithoutBoss = bossIndex !== -1 ? eventPool.filter((_, i) => i !== bossIndex) : eventPool
        chosenEvents = pickRandom(poolWithoutBoss, C.EVENTS_PER_RUN)
      }
      setEventClosed(Array(chosenEvents.length).fill(false))
      setEventKinds(chosenEvents.map((ev) => ev.kind))

      const startRaw = slots?.start
      if (
        !Array.isArray(startRaw) ||
        typeof startRaw[0] !== 'number' ||
        typeof startRaw[1] !== 'number'
      ) {
        console.error('Explore: слот-файл карты не содержит корректный start:[x,y]', slots)
        // app ещё не инициализирован (init() ниже) — destroy() тут упал бы,
        // нечего разрушать: возвращаемся без него.
        return
      }
      const start = { x: startRaw[0], y: startRaw[1] }

      const mapCanvas = await renderMapToCanvas({ grid, decor, tileSize: C.TILE_SIZE, theme: backdropForMap(mapFile) })

      if (cancelled || !containerRef.current) {
        // Всё ещё ДО init() — по той же причине ничего не разрушаем.
        return
      }

      await app.init({
        width: window.innerWidth,
        height: window.innerHeight,
        background: 0x15131a,
        backgroundAlpha: 1,
        resizeTo: window,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
      })
      initialized = true
      appRef.current = app

      if (cancelled || !containerRef.current) {
        // Компонент размонтировался, пока ждали init() — теперь app полностью
        // инициализирован, destroy() безопасен и обязателен (иначе утечка).
        try {
          app.destroy(true, { children: true })
        } catch {
          // Гонка с cleanup-эффектом (тоже вызывает destroy) — игнорируем.
        }
        app = null
        appRef.current = null
        initialized = false
        return
      }

      containerRef.current.appendChild(app.canvas)
      app.canvas.style.touchAction = 'none'

      // Параллакс-фон (2 слоя, far/mid) — рисуется ДО worldContainer (позади
      // карты) и НЕ внутри него, иначе двигался бы 1:1 с картой без эффекта
      // глубины. Пресет фиксирован по карте (см. BACKDROP_BY_MAP выше).
      const preset = backdropForMap(mapFile)
      const { far: farUrl, mid: midUrl } = backdropPaths(preset)
      const [farTexture, midTexture] = await Promise.all([
        Assets.load(farUrl) as Promise<Texture>,
        Assets.load(midUrl) as Promise<Texture>,
      ])
      const bgFar = new TilingSprite({ texture: farTexture, width: app.screen.width, height: app.screen.height })
      const bgMid = new TilingSprite({ texture: midTexture, width: app.screen.width, height: app.screen.height })
      const farScale = app.screen.height / farTexture.height
      const midScale = app.screen.height / midTexture.height
      bgFar.tileScale.set(farScale)
      bgMid.tileScale.set(midScale)
      app.stage.addChild(bgFar)
      app.stage.addChild(bgMid)
      const bgDim = new Graphics()
      bgDim.rect(0, 0, app.screen.width, app.screen.height).fill({ color: 0x0e0c13, alpha: 0.42 })
      app.stage.addChild(bgDim)

      onBgResize = () => {
        const w = app!.screen.width, h = app!.screen.height
        bgFar.width = w; bgFar.height = h
        bgMid.width = w; bgMid.height = h
        bgFar.tileScale.set(h / farTexture.height)
        bgMid.tileScale.set(h / midTexture.height)
        bgDim.clear().rect(0, 0, w, h).fill({ color: 0x0e0c13, alpha: 0.42 })
      }
      app.renderer.on('resize', onBgResize)

      // Мир: фон-карта и игрок в одном контейнере, двигаются вместе камерой.
      const worldContainer = new Container()
      worldContainer.scale.set(C.WORLD_SCALE)
      app.stage.addChild(worldContainer)

      const mapTexture = Texture.from(mapCanvas)
      const mapSprite = new Sprite(mapTexture)
      mapSprite.x = 0
      mapSprite.y = 0
      worldContainer.addChild(mapSprite)

      const phys = physicsRef.current
      phys.x = start.x * C.TILE_SIZE
      phys.y = (start.y + 1) * C.TILE_SIZE - C.PLAYER_HEIGHT
      phys.vx = 0
      phys.vy = 0
      phys.onGround = false

      const player = new Graphics()
        .rect(0, 0, C.PLAYER_WIDTH, C.PLAYER_HEIGHT)
        .fill(C.PLAYER_COLOR)
        .stroke({ width: 2, color: 0xffffff })
      player.x = phys.x
      player.y = phys.y
      worldContainer.addChild(player)

      // Боевая уязвимая зона игрока с учётом прыжка — на земле совпадает с
      // обычным хитбоксом (PLAYER_WIDTH×PLAYER_HEIGHT), в воздухе
      // (!phys.onGround) — уменьшенный бокс по корпусу (ноги поджаты в позе
      // прыжка), центрированный по X и смещённый по Y (числа подобраны вживую
      // отладочным тюнером, см. историю). Вызывать ЗАНОВО в каждом боевом
      // месте (не кэшировать один раз на кадр/итерацию врага) — phys.x может
      // измениться в течение кадра из-за бокового упора игрок↔враг, который
      // сам читает этот же бокс.
      function getPlayerCombatBox() {
        if (phys.onGround) {
          return { x: phys.x, y: phys.y, w: C.PLAYER_WIDTH, h: C.PLAYER_HEIGHT }
        }
        const w = C.JUMP_HIT_WIDTH
        const h = C.JUMP_HIT_HEIGHT
        const x = phys.x + (C.PLAYER_WIDTH - w) / 2
        const y = phys.y + C.JUMP_HIT_OFFSET_Y
        return { x, y, w, h }
      }

      // Скиллы (см. explore/entities/skills.ts) — создаётся ОДИН раз здесь,
      // сразу как только есть worldContainer/grid/getPlayerCombatBox. Сама
      // логика скиллов ещё не реализована (update() только гасит нажатия) —
      // подключение сделано заранее, чтобы точку интеграции не пришлось
      // переделывать позже.
      skills = createSkillsSystem({
        phys,
        facing: facingRef,
        getPlayerCombatBox,
        worldContainer,
        grid,
        tileSize: C.TILE_SIZE,
        isSolid,
        isPlatformBandBlocking,
        enemies: enemiesRef,
        boss: bossRef,
        attackDamage: attackDamageRef,
        takeDamage,
        dodgeIframe: dodgeIframeRef,
        skill1Pressed: skill1PressedRef,
        skill2Pressed: skill2PressedRef,
        // Заглушка: Explore не получает equippedSkills пропом (источника
        // данных пока нет, см. skills.ts) — оба слота пустые.
        equipped: [null, null],
      })

      // AI обычного врага (см. explore/entities/enemy.ts) — создаётся тем же
      // приёмом и в том же месте, что и skills выше. enemies/beastFrames —
      // ОБЩИЕ рефы с applyAttackHit() ниже (владение НЕ переезжает в модуль,
      // см. задачу) — applyAttackHit продолжает читать/писать те же объекты
      // Enemy через тот же enemiesRef без единого изменения в своём коде.
      // pushPlayerOutX/findGroundSurfaceY/closeEvent/spawnRewardFloat —
      // объявлены НИЖЕ по файлу через `function` (hoisted), поэтому
      // доступны здесь так же, как уже доступен takeDamage выше.
      enemySystem = createEnemySystem({
        phys,
        getPlayerCombatBox,
        pushPlayerOutX,
        playSpriteAnim,
        findGroundSurfaceY,
        spawnRewardFloat,
        closeEvent,
        // Обёртка над takeDamageRef, НЕ takeDamage напрямую — deps
        // собираются один раз здесь, а takeDamageRef синхронизируется
        // отдельным useEffect'ом на каждый рендер именно затем, чтобы
        // тикер всегда звал актуальную версию функции (см. EnemyDeps).
        takeDamage: (amount: number) => takeDamageRef.current(amount),
        dodgeIframe: dodgeIframeRef,
        events: eventsRef,
        worldContainer,
        grid,
        beastFrames: beastFramesRef,
        enemies: enemiesRef,
      })

      // Вся последовательная загрузка спрайт-листов (герой/зверь/сундук/
      // смуглер/обелиск/босс/шип/волна/иконки наград) вынесена в
      // loadExploreAssets — числа/пути/порядок/try-catch там те же, что
      // были здесь. Фон карты (bgFar/bgMid) НЕ входит туда, грузится отдельно
      // чуть выше — иначе карта/фон появлялись бы на экране позже, дожидаясь
      // всех остальных, более тяжёлых листов (см. задачу).
      const assets = await loadExploreAssets(() => cancelled)
      if (!assets) {
        // Компонент размонтировался, пока грузились ассеты — не создаём
        // спрайты и не трогаем worldContainer (см. cancelled-проверки внутри
        // loadExploreAssets, они сохранили прежнее поведение 1:1).
        return
      }
      const idleFrames = assets.hero.idle
      const runFrames = assets.hero.run
      const jumpFrames = assets.hero.jump
      const landFrames = assets.hero.land
      const attackFrames = assets.hero.attack
      const drinkFrames = assets.hero.drink
      const hurtFrames = assets.hero.hurt
      const deathFrames = assets.hero.death

      beastFramesRef.current = assets.beast

      const chestFrames = assets.chest
      const chestTrapFrames = assets.chestTrap
      const smugglerFrames = assets.smuggler
      const obeliskIdleFrames = assets.obeliskIdle
      obeliskBurningFramesRef.current = assets.obeliskBurning

      const bossFramesByKind = assets.boss
      const bossIdleFrames = bossFramesByKind.idle

      const bossSpikeTexture = assets.bossSpikeTexture
      const bossSpikeImpactFrames = assets.bossSpikeImpactFrames
      const bossWaveLeftFrames = assets.bossWaveLeftFrames
      const bossWaveRightFrames = assets.bossWaveRightFrames

      // Переключатель анимаций босса (см. задачу) — по образцу playSpriteAnim
      // выше, но ДОПОЛНИТЕЛЬНО ставит anchor.x И anchor.y из BOSS_ANCHOR_X/
      // BOSS_ANCHOR_Y (тело стоит в клетке по-разному на каждом листе, см.
      // константы выше). Оба якоря меняются ТОЛЬКО здесь, при смене листа —
      // внутри одной анимации не трогаются. x/y/scale НЕ трогаются (см.
      // applyBossLayout — отдельно). Действует на ЕДИНСТВЕННОГО текущего
      // босса (bossRef.current) — на этом шаге за забег может быть максимум
      // один (карта C).
      function playBossAnim(kind: BossAnimKind) {
        const boss = bossRef.current
        if (!boss) return
        // Уже эта анимация — не рестартить (см. задачу шаг 3: hurt/idle
        // читаются из ticker'а КАЖДЫЙ тик, без гейта это отматывало бы
        // анимацию на кадр 0 каждый тик, как playSpriteAnim у зверя выше).
        if (boss.sprite.textures === bossFramesByKind[kind]) return
        boss.sprite.textures = bossFramesByKind[kind]
        boss.sprite.anchor.set(C.BOSS_ANCHOR_X[kind], C.BOSS_ANCHOR_Y[kind])
        boss.sprite.loop = C.BOSS_ANIM_LOOP[kind]
        boss.sprite.animationSpeed = C.BOSS_ANIM_SPEED[kind]
        boss.sprite.gotoAndPlay(0)
      }

      const rewardIconTextures = assets.rewardIcons

      // Плавающий попап награды над объектом в МИРОВОМ контейнере (двигается
      // с камерой вместе с картой/спрайтами объектов) — Explore офлайн, эта
      // функция НИКОГДА не начисляет player.gold/trophies/crystals, только
      // визуал. Несколько наград — столбик вверх от (worldX, worldY), каждая
      // следующая на REWARD_ROW_GAP выше. Обновление/удаление — см. блок
      // "Плавающие попапы наград" в ticker'е ниже.
      function spawnRewardFloat(
        worldX: number,
        worldY: number,
        rewards: { kind: RewardKind; amount: number; negative?: boolean }[]
      ) {
        rewards.forEach((reward, i) => {
          const label = new Text({
            text: `${reward.negative ? '−' : '+'}${reward.amount}`,
            style: {
              fontSize: 20,
              fontWeight: 'bold',
              fill: reward.negative ? 0xe0353b : C.REWARD_TEXT_COLOR[reward.kind],
              stroke: { color: 0x000000, width: 4 },
            },
          })
          label.anchor.set(0, 0.5)
          label.x = 0

          const icon = new Sprite(rewardIconTextures[reward.kind])
          icon.anchor.set(0, 0.5)
          icon.scale.set(C.REWARD_ICON_H / icon.texture.height)
          icon.x = label.width + 4

          // Центрируем весь ряд (текст+иконка) относительно worldX — текст
          // и иконка строились от x=0 слева, теперь сдвигаем оба на -половину
          // итоговой ширины ряда.
          const rowWidth = icon.x + icon.width
          label.x -= rowWidth / 2
          icon.x -= rowWidth / 2

          const node = new Container()
          node.x = worldX
          node.y = worldY - i * C.REWARD_ROW_GAP
          node.alpha = 0
          node.addChild(label, icon)
          worldContainer.addChild(node)

          rewardFloatsRef.current.push({ node, elapsed: 0, startY: node.y })
        })
      }

      const hero = new AnimatedSprite(idleFrames)
      hero.anchor.set(0.5, 1.0) // якорь — низ по центру (ноги)
      hero.scale.set(C.HERO_DRAW_H / idleFrames[0].height) // равномерный масштаб по реальной высоте кадра
      hero.roundPixels = false // не защёлкивать позицию на целые пиксели — иначе дрожит при движении камеры
      hero.animationSpeed = 0.15
      hero.play()
      worldContainer.addChild(hero)
      heroSpriteRef.current = hero
      // deathFrames зеркалим в ref — triggerDeath() вызывается из takeDamage,
      // вне setup(), достать локальную deathFrames оттуда напрямую нельзя.
      deathFramesRef.current = deathFrames
      // Прямоугольник остаётся хитбоксом для коллизии — просто прячем визуал.
      player.visible = false

      // Переключает анимацию героя, НЕ пересоздавая спрайт. hero.textures ===
      // frames (тот же массив Texture, что вернул loadSheetFrames) — уже
      // сравнение "текущая анимация уже эта", отдельный ref не нужен.
      function playAnim(frames: Texture[], speed: number, loop: boolean) {
        if (hero.textures === frames) return
        hero.textures = frames
        hero.loop = loop
        hero.animationSpeed = speed
        hero.gotoAndPlay(0)
      }

      // Обобщённый вариант playAnim — принимает целевой AnimatedSprite первым
      // аргументом, чтобы враги (у каждого свой спрайт) могли переключать
      // анимацию тем же способом, что и герой выше. Герой playAnim() не
      // трогаем — оба существуют параллельно.
      function playSpriteAnim(sprite: AnimatedSprite, frames: Texture[], speed: number, loop: boolean) {
        if (sprite.textures === frames) {
          // Тот же набор кадров (напр. walk и в патруле, и в погоне) — не
          // рестартить анимацию, но скорость обязана следовать за aggroed
          // на лету, иначе застревает на значении последней СМЕНЫ кадров
          // (idle→walk/hurt→walk), а не текущего состояния (см. баг).
          if (sprite.animationSpeed !== speed) sprite.animationSpeed = speed
          return
        }
        sprite.textures = frames
        sprite.loop = loop
        sprite.animationSpeed = speed
        sprite.gotoAndPlay(0)
      }

      // "3 события за забег": enemy-событие спавнит ВЕСЬ кластер (все точки
      // clusterPoints, не только points[0]) реальными врагами вместо метки —
      // засчитывается убийством всех, не касанием (см. touch-цикл в ticker'е,
      // который теперь явно пропускает kind==='enemy'). Остальные типы
      // (сундук и т.д.) — по-прежнему временная метка-заглушка + касание.
      // Полная замена (не push в существующий массив) — та же семантика,
      // что раньше была у enemiesRef.current = spawnedEnemies в конце этого
      // блока: список обнуляется ЗАРАНЕЕ, а не собирается во временный
      // массив и не присваивается одним куском в конце (см. задачу, п.5) —
      // createEnemySystem().spawn() пушит новых врагов сразу в этот же ref.
      enemiesRef.current = [] // сброс на случай повторного запуска setup()
      chestsRef.current = [] // сброс на случай повторного запуска setup()
      smugglersRef.current = [] // сброс на случай повторного запуска setup()

      // Обелиски (карта F) — сброс состояния события ПЕРЕД спавном: стартовый
      // обелиск создаётся НИЖЕ, внутри map-цикла событий, только если kind
      // 'obelisk' попал в chosenEvents (см. buildEventCandidates — один
      // кандидат на всё событие). obeliskCandidatesRef хранит ВЕСЬ пул точек
      // карты (не только выбранную стартовую) — нужен для доспавна остальных
      // трёх после первого удара (см. applyAttackHit).
      obelisksRef.current = []
      obeliskEventActiveRef.current = false
      obeliskTimerRef.current = 0
      obeliskStruckCountRef.current = 0
      obeliskLastStruckRef.current = null
      obeliskStartPointRef.current = null
      obeliskEventIndexRef.current = null
      bossEventIndexRef.current = null
      obeliskHudSecondsRef.current = -1
      obeliskHudStruckRef.current = -1
      setObeliskHud(null)
      const obeliskSlotForCandidates = (slots as { obelisk?: { points?: unknown } } | null)?.obelisk
      obeliskCandidatesRef.current = Array.isArray(obeliskSlotForCandidates?.points)
        ? (obeliskSlotForCandidates.points as unknown[]).filter(isPointXY)
        : []

      // Спавнит один обелиск (Idle) в тайловых координатах — общая функция
      // для стартового обелиска (ниже, в map-цикле) и доспавна остальных трёх
      // (см. applyAttackHit), чтобы посадка (floorY/hitbox/anchor) не могла
      // разъехаться между вызовами.
      function spawnObelisk(tileX: number, tileY: number): Obelisk {
        const drawW = C.OBELISK_DRAW_H * (C.OBELISK_FRAME_W / C.OBELISK_FRAME_H)
        const centerX = tileX * C.TILE_SIZE + C.TILE_SIZE / 2
        const left = centerX - drawW / 2
        const footGuess = (tileY + 1) * C.TILE_SIZE
        const floorY = findGroundSurfaceY(left, drawW, footGuess) ?? footGuess
        const sprite = new AnimatedSprite(obeliskIdleFrames)
        sprite.anchor.set(0.5, 1.0)
        sprite.height = C.OBELISK_DRAW_H
        sprite.width = drawW
        sprite.x = centerX
        sprite.y = floorY + C.OBELISK_OFFSET_Y
        sprite.loop = true
        sprite.animationSpeed = C.OBELISK_ANIM_SPEED
        sprite.play()
        worldContainer.addChild(sprite)

        const obelisk: Obelisk = {
          sprite,
          hitbox: {
            x: centerX - C.OBELISK_HITBOX_W / 2,
            y: floorY - C.OBELISK_DRAW_H,
            width: C.OBELISK_HITBOX_W,
            height: C.OBELISK_DRAW_H,
          },
          floorY,
          tileX,
          tileY,
          burning: false,
          struck: false,
        }
        obelisksRef.current.push(obelisk)
        return obelisk
      }

      // Босс карты C (см. type Boss/задачу выше) — применяет BOSS_DRAW_H
      // (визуальный масштаб) поверх хитбокса (BOSS_WIDTH/BOSS_HEIGHT) КАЖДЫЙ
      // тик — вызывается сразу после спавна И из ticker'а, как
      // applyChestLayout у сундука. Заодно синкает HP-бар (та же причина,
      // что у enemy.hpBarBg/hpBarFill в основном цикле врагов — позиция
      // должна следовать за boss.y, который меняется гравитацией).
      function applyBossLayout(boss: Boss) {
        // Ranged — лист НЕ приведён к общему масштабу, в отличие от
        // остальных. Определяем "сейчас активен ranged" сравнением textures
        // (тот же приём, что playBossAnim использует для гейта "уже эта
        // анимация"), а не отдельным полем — и ТОЛЬКО в этом случае
        // домножаем scale на BOSS_SCALE_FIX_RANGED и подменяем якорь на
        // BOSS_ANCHOR_X_RANGED/BOSS_ANCHOR_Y_RANGED (числа подобраны живым
        // тюнером, тюнер убран — см. историю выше). Остальные анимации этот
        // блок не трогает.
        const isRanged = boss.sprite.textures === bossFramesByKind.ranged
        const scale = (C.BOSS_DRAW_H / bossIdleFrames[0].height) * (isRanged ? C.BOSS_SCALE_FIX_RANGED : 1)
        // Арт смотрит ВЛЕВО по умолчанию (facing===-1, без зеркала) — как
        // зверь. Флип по facing===1 — не в этой фазе (AI ещё нет, см. задачу).
        boss.sprite.scale.set(scale)
        if (isRanged) {
          boss.sprite.anchor.set(C.BOSS_ANCHOR_X_RANGED, C.BOSS_ANCHOR_Y_RANGED)
        }

        // Спрайт синкается от хитбокса (boss.x/y), НЕ наоборот — центр по X,
        // Y — реальная поверхность пола под ногами (findGroundSurfaceY), а не
        // низ хитбокса (тот же приём, что у enemy.sprite, см. Explore.tsx
        // enemy-цикл выше: "Y отрисовки — поверхность тайла под ногами").
        const bossFootBottom = boss.y + C.BOSS_HEIGHT
        const bossSurfaceY = findGroundSurfaceY(boss.x, C.BOSS_WIDTH, bossFootBottom)
        boss.sprite.x = boss.x + C.BOSS_WIDTH / 2
        boss.sprite.y = (bossSurfaceY ?? bossFootBottom) + C.FOOT_TUNE + C.BOSS_OFFSET_Y

        boss.hpBarBg.x = boss.x + (C.BOSS_WIDTH - C.BOSS_HP_BAR_WIDTH) / 2
        boss.hpBarBg.y = boss.y - C.BOSS_HPBAR_OFFSET_Y - C.ENEMY_HP_BAR_MARGIN - C.ENEMY_HP_BAR_HEIGHT
        boss.hpBarFill.x = boss.hpBarBg.x
        boss.hpBarFill.y = boss.hpBarBg.y
      }

      // Босс (см. explore/entities/boss.ts) — создаётся здесь, ПОСЛЕ того,
      // как известны bossFramesByKind/bossSpikeTexture/bossSpikeImpactFrames/
      // bossWaveLeftFrames/bossWaveRightFrames (обычные const, не рефы —
      // потому и позже, чем skills/enemySystem, см. задачу). playBossAnim/
      // applyBossLayout передаются депами — они НЕ переезжают в модуль
      // (applyAttackHit держит прямые вызовы к ним по имени, см. задачу).
      bossSystem = createBossSystem({
        phys,
        getPlayerCombatBox,
        pushPlayerOutX,
        playBossAnim,
        applyBossLayout,
        spawnRewardFloat,
        closeEvent,
        takeDamage: (amount: number) => takeDamageRef.current(amount),
        dodgeIframe: dodgeIframeRef,
        boss: bossRef,
        bossSpikes: bossSpikesRef,
        bossWaves: bossWavesRef,
        bossEventIndex: bossEventIndexRef,
        worldContainer,
        grid,
        bossFrames: bossFramesByKind,
        bossSpikeTexture,
        bossSpikeImpactFrames,
        bossWaveLeftFrames,
        bossWaveRightFrames,
      })

      eventsRef.current = chosenEvents.map((ev, eventIndex) => {
        if (ev.kind === 'enemy') {
          const points = ev.clusterPoints ?? []
          if (points.length === 0) {
            console.error('Explore: enemy-событие без валидных точек кластера — нечего убивать', ev)
            return { ...ev, closed: true, remainingEnemies: 0 }
          }
          // Трофеи кластера разыгрываются ОДИН РАЗ на весь кластер (не на
          // каждого врага отдельно — иначе random дал бы разные числа и
          // сумма по группе поплыла бы). Каждому, кроме последнего, — ровная
          // доля (Math.floor); последний добирает остаток, чтобы сумма долей
          // всегда точно равнялась total.
          const trophyTotal = rollTrophies(C.TROPHY_MULT_ENEMY)
          const trophyShare = Math.floor(trophyTotal / points.length)
          points.forEach(([ex, ey], i) => {
            const trophyReward = i === points.length - 1 ? trophyTotal - trophyShare * (points.length - 1) : trophyShare
            enemySystem!.spawn(ex, ey, eventIndex, trophyReward)
          })
          return { ...ev, closed: false, remainingEnemies: points.length }
        }

        const marker = new Graphics()
          .circle(0, 0, C.TILE_SIZE * 0.35)
          .fill({ color: C.EVENT_MARKER_COLOR[ev.kind], alpha: 0.85 })
          .stroke({ width: 3, color: 0xffffff })
        marker.x = ev.x * C.TILE_SIZE + C.TILE_SIZE / 2
        marker.y = ev.y * C.TILE_SIZE + C.TILE_SIZE / 2
        worldContainer.addChild(marker)

        // Реальный спрайт сундука ПОВЕРХ маркера (маркер остаётся зоной
        // толчка/хитбоксом визуально скрытым — сам touch-цикл ниже событие
        // 'chest' больше НЕ закрывает, см. там же). AnimatedSprite на
        // chestFrames, но НЕ играет — открытие запускается ударом игрока,
        // см. applyAttackHit ниже.
        if (ev.kind === 'chest') {
          marker.visible = false // визуал теперь несёт спрайт, не кружок
          const chestDrawW = C.CHEST_DRAW_H * (140 / 178)
          const chestCenterX = ev.x * C.TILE_SIZE + C.TILE_SIZE / 2
          const chestLeft = chestCenterX - chestDrawW / 2
          const chestFootGuess = (ev.y + 1) * C.TILE_SIZE
          const floorY = findGroundSurfaceY(chestLeft, chestDrawW, chestFootGuess) ?? chestFootGuess
          const chestSprite = new AnimatedSprite(chestFrames)
          chestSprite.x = chestCenterX
          chestSprite.loop = false
          worldContainer.addChild(chestSprite)

          const chest: Chest = {
            sprite: chestSprite,
            // Твёрдое тело — низ на той же линии, что и спрайт, центр по X
            // тот же, ширина — CHEST_WALL_W (НЕ зависит от ширины спрайта,
            // которая меняется между добрым/мимик набором). Остаётся ВСЕГДА,
            // и закрытый, и открытый сундук — не убирается при открытии.
            hitbox: {
              x: chestCenterX - C.CHEST_WALL_W / 2,
              y: floorY + C.CHEST_OFFSET_Y - C.CHEST_DRAW_H,
              width: C.CHEST_WALL_W,
              height: C.CHEST_DRAW_H,
            },
            opening: false,
            opened: false,
            trapDamaged: false,
            eventIndex,
            floorY,
          }
          applyChestLayout(chest)
          chestSprite.gotoAndStop(0) // закрыт, не играет — до удара
          chestsRef.current.push(chest)
        }

        // Смуглер — ТОЛЬКО визуал (idle, дышит), без взаимодействия, без
        // хитбокса-стены (в отличие от сундука сквозь него можно пройти —
        // см. задачу: никакого pushPlayerOutX для смуглера). Посадка —
        // по образцу сундука: floorY найден один раз здесь же и сразу
        // применён к sprite.y, дальше не пересчитывается.
        if (ev.kind === 'smuggler') {
          marker.visible = false // визуал теперь несёт спрайт, не кружок
          const smugglerDrawW = C.SMUGGLER_DRAW_H * (230 / 296)
          const smugglerCenterX = ev.x * C.TILE_SIZE + C.TILE_SIZE / 2
          const smugglerLeft = smugglerCenterX - smugglerDrawW / 2
          const smugglerFootGuess = (ev.y + 1) * C.TILE_SIZE
          const floorY = findGroundSurfaceY(smugglerLeft, smugglerDrawW, smugglerFootGuess) ?? smugglerFootGuess
          const smugglerSprite = new AnimatedSprite(smugglerFrames)
          smugglerSprite.anchor.set(0.5, 1.0)
          smugglerSprite.height = C.SMUGGLER_DRAW_H
          smugglerSprite.width = smugglerDrawW
          smugglerSprite.x = smugglerCenterX
          smugglerSprite.y = floorY + C.SMUGGLER_OFFSET_Y
          smugglerSprite.loop = true
          smugglerSprite.animationSpeed = C.SMUGGLER_ANIM_SPEED
          smugglerSprite.play()
          worldContainer.addChild(smugglerSprite)

          smugglersRef.current.push({ sprite: smugglerSprite, floorY, eventIndex, facing: 1 })
        }

        // Обелиск — стартовая точка уже выбрана в buildEventCandidates (ev.x/
        // ev.y), здесь только спавн через общую spawnObelisk (та же посадка,
        // что и у доспавненных после первого удара, см. applyAttackHit).
        // eventIndex запоминаем — им закрывается HUD-гнездо при успехе.
        if (ev.kind === 'obelisk') {
          marker.visible = false // визуал несёт спрайт обелиска, не кружок
          obeliskStartPointRef.current = [ev.x, ev.y]
          obeliskEventIndexRef.current = eventIndex
          spawnObelisk(ev.x, ev.y)
        }

        // Босс — визуал несёт отдельный спрайт (см. spawnBoss ниже, точка
        // та же slots.boss, что и здесь ev.x/ev.y), сам спавн НЕ трогаем —
        // здесь только запоминаем eventIndex, им закрывается HUD-гнездо и
        // выдаётся награда при завершении death-анимации (см. ticker, ФАЗА 5).
        if (ev.kind === 'boss') {
          marker.visible = false // визуал несёт спрайт босса, не кружок
          bossEventIndexRef.current = eventIndex
        }

        return { ...ev, marker, closed: false }
      })

      // Босс карты C (см. type Boss/explore/entities/boss.ts) — спавн НЕ
      // читает chosenEvents напрямую (не менялось, см. задачу ФАЗА 5): читаем
      // slots.boss НАПРЯМУЮ — это ПЛОСКАЯ пара [x,y] (в отличие от
      // enemyClusters/obelisk — там массив/объект точек). Спавн теперь
      // ГЕЙТИТСЯ тем же bossWillSpawn, что решал пиннинг в chosenEvents
      // (см. задачу, вероятностный босс) — иначе при невыпавшем броске
      // спрайт всё равно появился бы на карте без eventIndex, и закрыть
      // событие/выдать награду было бы нечем (bossEventIndexRef остался
      // бы null навсегда). bossPoint и ev.x/ev.y кандидата 'boss' — одна и
      // та же точка slots.boss, когда бросок выпал.
      const bossPoint = (slots as { boss?: unknown } | null)?.boss
      if (bossWillSpawn && isPointXY(bossPoint)) {
        bossSystem!.spawn(bossPoint[0], bossPoint[1])
      } else {
        bossRef.current = null
      }

      // Панель Смуглера (окно обмена) — ОДИН Container на весь забег (не по
      // смуглеру: в один момент активен максимум один, см. smugglerActiveRef
      // выше). Добавлен в worldContainer ПОСЛЕ всех спрайтов событий выше —
      // рисуется НАД картой/смуглером/врагами. Кнопки пока НЕ интерактивны
      // (никакого eventMode/pointertap) — только вид, клики следующим шагом.
      const smugglerPanel = new Container()
      smugglerPanel.visible = false

      const smugglerPanelBg = new Graphics()
        .roundRect(0, 0, C.SMUGGLER_PANEL_W, C.SMUGGLER_PANEL_H, 10)
        .fill({ color: 0x221e2b, alpha: 0.95 })
        .stroke({ color: 0x3a3344, width: 2 })
      smugglerPanel.addChild(smugglerPanelBg)

      const smugglerPanelText = new Text({
        text: 'Контрабандист предлагает обмен\nтрофеи ×1.5',
        style: {
          fontSize: 16,
          fontWeight: 'bold',
          fill: 0xede7f2,
          align: 'center',
          stroke: { color: 0x000000, width: 4 },
        },
      })
      smugglerPanelText.anchor.set(0.5, 0)
      smugglerPanelText.x = C.SMUGGLER_PANEL_W / 2
      smugglerPanelText.y = 12
      smugglerPanel.addChild(smugglerPanelText)

      // Кнопка панели — фон roundRect + центрированный текст, оба цвета
      // (рамка/текст) совпадают с акцентом кнопки. Возвращает Container с
      // сохранённой шириной/высотой для позиционирования снаружи.
      function buildSmugglerButton(label: string, accent: number): Container {
        const btn = new Container()
        const bg = new Graphics()
          .roundRect(0, 0, C.SMUGGLER_BTN_W, C.SMUGGLER_BTN_H, 6)
          .fill({ color: 0x221e2b })
          .stroke({ color: accent, width: 2 })
        btn.addChild(bg)
        const label_ = new Text({
          text: label,
          style: { fontSize: 15, fontWeight: 'bold', fill: accent, stroke: { color: 0x000000, width: 4 } },
        })
        label_.anchor.set(0.5)
        label_.x = C.SMUGGLER_BTN_W / 2
        label_.y = C.SMUGGLER_BTN_H / 2
        btn.addChild(label_)

        // Первая Pixi-интерактивность в проекте (см. задачу) — hitArea
        // задана явно прямоугольником кнопки, чтобы тап засчитывался по всей
        // площади, а не только по непрозрачным пикселям Graphics/Text.
        btn.eventMode = 'static'
        btn.cursor = 'pointer'
        btn.hitArea = new Rectangle(0, 0, C.SMUGGLER_BTN_W, C.SMUGGLER_BTN_H)
        return btn
      }

      // Обе кнопки симметрично вокруг центра панели, зазор SMUGGLER_BTN_GAP
      // между ними (не привязаны к краям — держат центр при любой ширине).
      const smugglerBtnPairW = C.SMUGGLER_BTN_W * 2 + C.SMUGGLER_BTN_GAP
      const smugglerBtnStartX = (C.SMUGGLER_PANEL_W - smugglerBtnPairW) / 2

      const smugglerExchangeBtn = buildSmugglerButton('Обменять', 0xe8b23a)
      smugglerExchangeBtn.x = smugglerBtnStartX
      smugglerExchangeBtn.y = C.SMUGGLER_PANEL_H - C.SMUGGLER_BTN_H - 14
      smugglerPanel.addChild(smugglerExchangeBtn)
      smugglerExchangeBtnRef.current = smugglerExchangeBtn
      // Обмен — Explore офлайн (см. SMUGGLER_* константы выше): трофеи нигде
      // реально не начисляются/списываются, только визуальный float. Оба
      // исхода (успех/кража) закрывают событие — панель повторно не откроется
      // (см. проверку !ev.closed в перехвате dodge).
      smugglerExchangeBtn.on('pointertap', () => {
        const activeSmuggler = smugglerActiveRef.current
        smugglerPanelOpenRef.current = false
        smugglerPanel.visible = false
        if (!activeSmuggler) return

        const floatX = activeSmuggler.sprite.x
        const floatY = activeSmuggler.sprite.y - C.SMUGGLER_DRAW_H
        const before = C.SMUGGLER_TEST_TROPHIES
        if (Math.random() < C.SMUGGLER_STEAL_CHANCE) {
          const after = Math.round(before * C.SMUGGLER_STEAL_FRAC)
          spawnRewardFloat(floatX, floatY, [{ kind: 'trophy', amount: before - after, negative: true }])
        } else {
          const after = Math.round(before * C.SMUGGLER_MULT)
          spawnRewardFloat(floatX, floatY, [{ kind: 'trophy', amount: after - before }])
        }
        closeEvent(activeSmuggler.eventIndex)
      })

      const smugglerLeaveBtn = buildSmugglerButton('Уйти', 0xe0353b)
      smugglerLeaveBtn.x = smugglerBtnStartX + C.SMUGGLER_BTN_W + C.SMUGGLER_BTN_GAP
      smugglerLeaveBtn.y = C.SMUGGLER_PANEL_H - C.SMUGGLER_BTN_H - 14
      smugglerPanel.addChild(smugglerLeaveBtn)
      smugglerLeaveBtnRef.current = smugglerLeaveBtn
      // Вариант A: уйти = упустить — событие закрывается насовсем, без обмена.
      smugglerLeaveBtn.on('pointertap', () => {
        const activeSmuggler = smugglerActiveRef.current
        smugglerPanelOpenRef.current = false
        smugglerPanel.visible = false
        if (activeSmuggler) closeEvent(activeSmuggler.eventIndex)
      })

      worldContainer.addChild(smugglerPanel)

      // Пересчитывает anchor/height/width/y сундука ОТ chest.floorY (найден
      // один раз при спавне, см. Chest.floorY) — а НЕ от bbox текущего
      // кадра/scale. Вызывается КАЖДЫЙ кадр для каждого сундука (см. ticker).
      // Chest_Open (140×178) и Chest_Trap_Explode (190×137) — разная
      // пропорция кадра, поэтому у ловушки СВОИ CHEST_TRAP_DRAW_H/
      // CHEST_TRAP_OFFSET_Y (подобраны вживую временным тюнером, убран — см.
      // историю), у доброго сундука — CHEST_DRAW_H/CHEST_OFFSET_Y, не трогаем.
      function applyChestLayout(chest: Chest) {
        chest.sprite.anchor.set(0.5, 1.0) // низ по центру — как у зверя/героя
        if (chest.isMimic) {
          chest.sprite.height = C.CHEST_TRAP_DRAW_H
          chest.sprite.width = C.CHEST_TRAP_DRAW_H * (190 / 137)
          chest.sprite.y = chest.floorY + C.CHEST_TRAP_OFFSET_Y
        } else {
          chest.sprite.height = C.CHEST_DRAW_H
          chest.sprite.width = C.CHEST_DRAW_H * (140 / 178)
          chest.sprite.y = chest.floorY + C.CHEST_OFFSET_Y
        }
      }

      // Y отрисовки спрайта должен ложиться на РЕАЛЬНУЮ поверхность тайла, а
      // не на низ хитбокса (низ хитбокса — грубый прямоугольник, который сам
      // физикой ставится по правилу sweepFootBlock, но эта функция считает
      // независимо ТЕМ ЖЕ способом — 3 точки по ширине, как sweepFootBlock/
      // isSolid выше — и берёт САМУЮ ВЕРХНЮЮ найденную твердь в ТЕКУЩЕЙ строке
      // клеток под ногами). Возвращает null, если под ногами прямо сейчас нет
      // тверди (персонаж в воздухе — прыжок/падение) — в этом случае вызывающий
      // код остаётся на прежнем поведении (низ хитбокса), проверка "стоим ли мы
      // именно на этой клетке", а НЕ поиск ближайшего пола ниже (годится для
      // приземлённого состояния, но не для позиционирования спрайта в прыжке).
      function findGroundSurfaceY(x: number, width: number, footY: number): number | null {
        const xPoints = [x + 1, x + width / 2, x + width - 1]
        const cy = Math.floor(footY / C.TILE_SIZE)
        let top: number | null = null
        for (const px of xPoints) {
          const cx = Math.floor(px / C.TILE_SIZE)
          const blockTop = cellFootBlockTop(grid, C.TILE_SIZE, cx, cy)
          if (blockTop === null) continue
          top = top === null ? blockTop : Math.min(top, blockTop)
        }
        return top
      }

      // Мягкая стена по X — ОБЩИЙ помощник для живого врага (enemy.rect) И
      // сундука (chestsRef, hitbox всегда твёрд — и закрытый, и открытый):
      // игрок не проходит сквозь тело сбоку, выталкивается к ближайшему
      // краю. ТОЛЬКО по X — вертикаль не
      // трогает (сверху можно запрыгнуть/перепрыгнуть, PUSH_TOP_MARGIN решает,
      // где проходит граница "тело" vs "перелёт"). Перенесено из инлайн-блока
      // push-out в enemy-цикле — та же логика, геометрия тела параметризована.
      function pushPlayerOutX(
        body: { x: number; y: number; width: number; height: number },
        playerCombatBox: { x: number; y: number; w: number; h: number },
      ) {
        const verticalReach = playerCombatBox.y < body.y + body.height && playerCombatBox.y + playerCombatBox.h > body.y
        if (!verticalReach) return
        const bodyTop = body.y + body.height * C.PUSH_TOP_MARGIN
        if (playerCombatBox.y + playerCombatBox.h <= bodyTop) return // перепрыгнул
        const pLeft = playerCombatBox.x
        const pRight = playerCombatBox.x + playerCombatBox.w
        const bLeft = body.x
        const bRight = body.x + body.width
        if (!(pRight > bLeft && pLeft < bRight)) return
        const pCenter = playerCombatBox.x + playerCombatBox.w / 2
        const bCenter = body.x + body.width / 2
        // Выталкиваем РЕАЛЬНУЮ phys.x, но так, чтобы вплотную к телу встал
        // КРАЙ БОКСА (playerCombatBox), а не phys.x напрямую — на земле
        // offsetX=0 (бокс совпадает с phys), в прыжке бокс центрирован/
        // смещён относительно phys.x (см. getPlayerCombatBox).
        const offsetX = playerCombatBox.x - phys.x
        if (pCenter < bCenter) {
          phys.x = (body.x - playerCombatBox.w) - offsetX
        } else {
          phys.x = (body.x + body.width) - offsetX
        }
        phys.x = clamp(phys.x, 0, worldWidthPx - C.PLAYER_WIDTH)
        phys.vx = 0
      }

      // Камера: центрируем игрока на экране, зажимая по границам карты.
      const worldWidth = grid[0].length * C.TILE_SIZE * worldContainer.scale.x
      const worldHeight = grid.length * C.TILE_SIZE * worldContainer.scale.y

      // dt — deltaTime тика (как везде в файле); при первом вызове (до старта
      // ticker'а) передаём Infinity, чтобы camera-lerp ниже сразу СНАПНУЛ в
      // стартовую позицию, а не полз туда от (0,0) первые несколько кадров.
      const updateCamera = (dt: number) => {
        // player.x/y и player.width/height — координаты МИРА (локальные для
        // worldContainer), а worldContainer.x/y — координаты ЭКРАНА. При
        // scale != 1 их нельзя смешивать без множителя s.
        const s = C.WORLD_SCALE

        // LOOK-AHEAD (только X): целимся не в игрока, а в точку на
        // LOOKAHEAD_TILES тайлов ВПЕРЕДИ по факту движения. facingRef — уже
        // существующий флаг направления (обновляется при движении, персистит
        // при остановке — см. его объявление выше), поэтому при остановке
        // упреждение остаётся прежним, а не прыгает к центру.
        const lookaheadPx = facingRef.current * C.LOOKAHEAD_TILES * C.TILE_SIZE
        const focusX = player.x + player.width / 2 + lookaheadPx
        const targetX = clamp(app!.screen.width / 2 - focusX * s, app!.screen.width - worldWidth, 0)
        // Плавно догоняем target (lerp), а не прыгаем скачком. Коэффициент
        // масштабирован по dt (не зависит от fps) и зажат в [0,1] — на первом
        // вызове (dt=Infinity) это даёт factor=1, то есть мгновенный снап.
        const smoothFactor = Math.min(1, C.SMOOTH * dt)
        worldContainer.x += (targetX - worldContainer.x) * smoothFactor

        // Вертикаль — БЕЗ look-ahead и без lerp, как было (не трогаем).
        const targetY = app!.screen.height * C.CAMERA_V_ANCHOR - (player.y + player.height / 2) * s
        worldContainer.y = clamp(targetY, app!.screen.height - worldHeight, 0)

        // Параллакс: far/mid ползут МЕДЛЕННЕЕ карты — доля от движения камеры,
        // не от движения игрока напрямую (иначе не совпадало бы с lerp/clamp
        // выше). far двигается меньше всего (дальше), mid — заметнее (ближе).
        const FAR_FACTOR = 0.15
        const MID_FACTOR = 0.4
        bgFar.tilePosition.x = worldContainer.x * FAR_FACTOR
        bgFar.tilePosition.y = worldContainer.y * FAR_FACTOR
        bgMid.tilePosition.x = worldContainer.x * MID_FACTOR
        bgMid.tilePosition.y = worldContainer.y * MID_FACTOR
      }

      updateCamera(Infinity)

      // Общие для обоих способов закрытия события (касание — chest/т.п.,
      // убийство кластера — enemy): красит HUD-иконку и проверяет "все 3
      // закрыты?" -> onRunComplete. Вызывается из touch-цикла ниже И из
      // enemy-цикла, когда remainingEnemies кластера доходит до 0.
      function closeEvent(index: number) {
        const ev = eventsRef.current[index]
        if (!ev || ev.closed) return
        ev.closed = true
        setEventClosed((prev) => {
          const next = [...prev]
          next[index] = true
          return next
        })
        if (!runCompleteFiredRef.current && eventsRef.current.every((e) => e.closed)) {
          runCompleteFiredRef.current = true
          onRunCompleteRef.current(eventsRef.current.map((e) => ({ kind: e.kind })))
        }
      }

      // Урон-чек атаки — раньше проверялся каждый кадр, пока attackActiveRef
      // было true (окно ATTACK_ACTIVE_MS от момента нажатия); теперь вызывается
      // ОДИН раз с кадра удара анимации героя (ATTACK_STRIKE_FRAME) — см. вызов
      // в блоке анимации в тикере. Сама проверка (дальность/направление через
      // attackHitboxRef, "один удар = один засчёт" через attackSwingIdRef/
      // lastHitSwingId, урон, добивание) — БЕЗ ИЗМЕНЕНИЙ, только вынесена из
      // общего цикла врагов в свою функцию с собственным for.
      function applyAttackHit() {
        for (let i = 0; i < enemiesRef.current.length; i++) {
          const enemy = enemiesRef.current[i]
          // Мёртвый враг (death уже играет/держит кадр) — хиты по нему больше
          // ничего не делают: не hurt, не поднимают stunCount, не бьют повторно.
          if (enemy.dead) continue
          if (
            attackHitboxRef.current &&
            enemy.lastHitSwingId !== attackSwingIdRef.current
          ) {
            const hb = attackHitboxRef.current
            const overlap =
              hb.x < enemy.x + C.ENEMY_WIDTH &&
              hb.x + hb.width > enemy.x &&
              hb.y < enemy.y + C.ENEMY_HEIGHT &&
              hb.y + hb.height > enemy.y
            if (overlap) {
              enemy.lastHitSwingId = attackSwingIdRef.current
              enemy.hp = Math.max(0, enemy.hp - attackDamageRef.current)
              if (enemy.hp <= 0) {
                // Смерть — высший приоритет, перебивает hurt/attack/windup
                // немедленно. Само удаление/закрытие события ПЕРЕНЕСЕНО в
                // основной цикл врагов (см. ticker ниже) — ждём, пока death
                // доиграет и подержится DEATH_HOLD_MS, а не убираем сразу.
                enemy.dead = true
                redrawEnemyHpBar(enemy) // пустая полоса
                const beastFrames = beastFramesRef.current
                if (beastFrames) {
                  playSpriteAnim(enemy.sprite, beastFrames.death, C.BEAST_DEATH_ANIM_SPEED, false)
                }
                enemy.deathHoldTimer = 0
                continue
              }
              redrawEnemyHpBar(enemy)
              // Хитстан — та же точка, где уменьшается hp. Не трогаем на
              // смертельном ударе (continue выше уже ушёл из итерации, см.
              // enemy.dead-ветку) — hurt никогда не запускается поверх death.
              //
              // "Точка невозврата" (POISE_POINT) — защита от stun-lock: если
              // враг СЕЙЧАС в замахе (windingUp) И уже прошёл его достаточно
              // далеко (windupProgress >= POISE_POINT), урон его больше НЕ
              // прерывает — windingUp/windupTimer/attackAnimPlaying НЕ трогаем
              // вообще, удар доигрывает до strike-кадра и наносит урон как
              // обычно (см. приоритет анимаций в ticker'е — раз hurtTimer не
              // выставлен, attack-ветка продолжает идти без изменений). Иначе
              // (не в замахе, ИЛИ рано в замахе) — прерываем как раньше.
              //
              // Накопительный стан-резист (STUN_LIMIT/POISE_IMMUNE_MS) —
              // гарантия прорыва, даже если игрок ритмично сбивает КАЖДЫЙ
              // замах в ранней фазе (poiseImmuneTimer>0 перекрывает проверку
              // POISE_POINT точно так же, как поздняя фаза — ветка COMMIT).
              const wasWindingUp = enemy.windingUp
              const windupProgress = wasWindingUp ? enemy.windupTimer / C.WINDUP_MS : 0
              const poiseImmune = enemy.poiseImmuneTimer > 0
              if (!wasWindingUp || (windupProgress < C.POISE_POINT && !poiseImmune)) {
                if (wasWindingUp) {
                  enemy.stunCount += 1
                  if (enemy.stunCount >= C.STUN_LIMIT) {
                    enemy.poiseImmuneTimer = C.POISE_IMMUNE_MS
                    enemy.stunCount = 0
                  }
                }
                enemy.hurtTimer = C.ENEMY_HURT_MS
                enemy.windingUp = false
                enemy.windupTimer = 0
                enemy.attackAnimPlaying = false
              }
              // else: поздняя фаза ИЛИ иммунитет — замах не прерываем, зверь
              // просто дожимает удар до strike-кадра как обычно, без подсветки.
            }
          }
        }

        // Босс карты C (ФАЗА 2, шаг 5 — починка стан-лока, см. задачу) — ТОТ
        // ЖЕ хит-тест, что у врага выше: lastHitSwingId дедупит один взмах,
        // dead исключает повторные удары по трупу. Приоритеты состояний
        // теперь dead > attack > hurt > walk > idle (attack ВЫШЕ hurt) —
        // см. два слоя защиты ниже, оба применяются ТОЛЬКО на не смертельном
        // попадании (лестница dead-веток та же, что была).
        if (bossRef.current) {
          const boss = bossRef.current
          if (
            !boss.dead &&
            attackHitboxRef.current &&
            boss.lastHitSwingId !== attackSwingIdRef.current
          ) {
            const hb = attackHitboxRef.current
            const overlap =
              hb.x < boss.x + C.BOSS_WIDTH &&
              hb.x + hb.width > boss.x &&
              hb.y < boss.y + C.BOSS_HEIGHT &&
              hb.y + hb.height > boss.y
            if (overlap) {
              boss.lastHitSwingId = attackSwingIdRef.current
              boss.hp = Math.max(0, boss.hp - attackDamageRef.current)
              if (boss.hp <= 0) {
                // Смерть (ФАЗА 2, шаг 6, см. задачу) — dead > attack > hurt >
                // walk > idle, ничем не прерывается: boss.dead гейтит ВЕСЬ
                // тикер (физика/AI/push-out/визуал, см. там) — мёртвый босс
                // дальше не двигается, не разворачивается, не атакует и не
                // получает урон повторно (гейт !boss.dead в самом начале
                // этого блока). HP-бар СКРЫВАЕТСЯ (не просто пустая полоса).
                // Death запускается ЗДЕСЬ один раз; applyBossLayout+флип
                // фиксируют финальные позу/facing НАВСЕГДА (дальше тикер их
                // не трогает, физика для мёртвого босса отключена) — само
                // "падение" зашито в кадры Boss_Death (46, разовая,
                // BOSS_ANIM_LOOP.death=false) — PixiJS AnimatedSprite сам
                // держит последний кадр без loop, ничего досчитывать не надо.
                // Труп ОСТАЁТСЯ до конца забега (в отличие от зверя —
                // никакого despawn/DEATH_HOLD_MS). Награда/закрытие события —
                // НЕ здесь, это фаза 5 (см. задачу, п.6).
                boss.dead = true
                boss.hpBarBg.visible = false
                boss.hpBarFill.visible = false
                playBossAnim('death')
                applyBossLayout(boss)
                boss.sprite.scale.x = boss.facing === -1 ? Math.abs(boss.sprite.scale.x) : -Math.abs(boss.sprite.scale.x)
              } else {
                redrawBossHpBar(boss)
                // Стадия 2 — переход СЧИТАЕТСЯ один раз, на первом пересечении
                // порога ВНИЗ (гейт stage===1), не каждый кадр, что дальше hp
                // будет падать. САМ переход не выставляет и не продлевает
                // никаких таймеров (hurtTimer/poiseImmuneTimer/hitFlashTimer)
                // — это только boss.stage/console.log, см. задачу ("Разведи
                // 'получил урон' и 'не может действовать'"). Пауза, которая
                // раньше была заметна сразу после перехода — не следствие
                // самого перехода, а совпадение: удар, снёсший HP за порог,
                // это ОБЫЧНЫЙ удар и проходит через слои 1/2 ниже наравне со
                // всеми остальными.
                if (boss.stage === 1 && boss.hp <= boss.maxHp * C.BOSS_STAGE2_HP_RATIO) {
                  boss.stage = 2
                }

                if (boss.attackAnimPlaying || boss.rangedAnimPlaying) {
                  // СЛОЙ 1 (главный, см. задачу) — во время атаки ИЛИ броска
                  // Hurt НЕ проигрывается ВООБЩЕ, ни на каком кадре, независимо
                  // от poise: attackAnimPlaying/attackKind/attackHitApplied и
                  // rangedAnimPlaying/rangedThrowApplied НЕ трогаем — действие
                  // доигрывает до конца как обычно. Урон уже применён выше
                  // (hp/HP-бар). Обратная связь без хитстана — короткая
                  // вспышка (см. ticker).
                  boss.hitFlashTimer = C.BOSS_HIT_FLASH_MS
                } else {
                  // СЛОЙ 2 (починка стан-лока, см. задачу) — СВОИМИ
                  // константами BOSS_STUN_LIMIT/BOSS_POISE_IMMUNE_MS, но
                  // структурой приведено к логике зверя (строки применения
                  // POISE_POINT/STUN_LIMIT у enemy выше): там stunCount растёт
                  // ТОЛЬКО когда попадание сбивает УЖЕ идущее состояние
                  // (wasWindingUp), а не от любого удара — у босса нет фазы
                  // замаха, поэтому эквивалент "уже идущего состояния,
                  // которое сбивают" — это Hurt, который прямо сейчас играет
                  // (boss.hurtTimer > 0).
                  const poiseImmune = boss.poiseImmuneTimer > 0
                  const alreadyHurt = boss.hurtTimer > 0
                  if (poiseImmune) {
                    // Иммунитет — Hurt не входит вообще, только вспышка (тот
                    // же принцип, что и раньше).
                    boss.hitFlashTimer = C.BOSS_HIT_FLASH_MS
                  } else if (alreadyHurt) {
                    // Попадание "в разгар" уже идущего Hurt (см. задачу, п.1) —
                    // урон уже применён выше, добавляем вспышку, но hurtTimer
                    // НЕ трогаем (не продлеваем и не перезапускаем анимацию).
                    // Именно это попадание "сбивает уже идущий Hurt-цикл" —
                    // аналог wasWindingUp у зверя, поэтому здесь (и только
                    // здесь) растёт stunCount (см. задачу, п.2).
                    boss.hitFlashTimer = C.BOSS_HIT_FLASH_MS
                    boss.stunCount += 1
                    if (boss.stunCount >= C.BOSS_STUN_LIMIT) {
                      boss.poiseImmuneTimer = C.BOSS_POISE_IMMUNE_MS
                      boss.stunCount = 0
                    }
                  } else {
                    // Свежий хит: босс НЕ атаковал, Hurt ещё НЕ шёл, иммунитета
                    // нет — обычный запуск хитстана. stunCount НЕ растёт (как
                    // у зверя в ветке !wasWindingUp) — это не "сбитое" состояние.
                    boss.hurtTimer = C.BOSS_HURT_MS
                  }
                }
              }
            }
          }
        }

        // Сундук — открывается ударом (без "один удар = один засчёт" по
        // attackSwingIdRef, как у врагов: opening=true уже само по себе
        // блокирует повторный запуск на следующих свингах, дедуп не нужен).
        // Сундук не бьёт и не имеет HP — только открытие анимации.
        if (attackHitboxRef.current) {
          const hb = attackHitboxRef.current
          for (const chest of chestsRef.current) {
            if (chest.opening || chest.opened) continue
            const box = chest.hitbox
            const overlap =
              hb.x < box.x + box.width &&
              hb.x + hb.width > box.x &&
              hb.y < box.y + box.height &&
              hb.y + hb.height > box.y
            if (!overlap) continue
            chest.opening = true
            // Бросок решается ОДИН раз, на первом ударе — не перебрасывается
            // на повторных кадрах, пока opening держит цикл закрытым выше.
            chest.isMimic = Math.random() < C.CHEST_MIMIC_CHANCE
            chest.trapDamaged = false
            if (chest.isMimic) {
              chest.sprite.textures = chestTrapFrames
              applyChestLayout(chest)
              chest.sprite.loop = false
              chest.sprite.animationSpeed = C.CHEST_TRAP_ANIM_SPEED
              chest.sprite.gotoAndPlay(0)
            } else {
              chest.sprite.textures = chestFrames
              applyChestLayout(chest)
              chest.sprite.loop = false
              chest.sprite.animationSpeed = C.CHEST_ANIM_SPEED
              chest.sprite.gotoAndPlay(0)
            }
          }
        }

        // Обелиск — переключается на burning ударом. Первый удар (по любому
        // обелиску) запускает событие (таймер + доспавн остальных), удары по
        // уже активному событию добавляют время и счётчик (см. ниже). Успех/
        // провал (награда/смерть, обелиски гаснут обратно в idle) — в
        // ticker'е, см. блок таймера события выше. anchor/x/y/height/width НЕ
        // трогаем при смене textures — оба листа нарезаны одним окном в
        // одном масштабе, посадка общая.
        if (attackHitboxRef.current) {
          const hb = attackHitboxRef.current
          for (const obelisk of obelisksRef.current) {
            if (obelisk.struck) continue
            const box = obelisk.hitbox
            const overlap =
              hb.x < box.x + box.width &&
              hb.x + hb.width > box.x &&
              hb.y < box.y + box.height &&
              hb.y + hb.height > box.y
            if (!overlap) continue
            obelisk.struck = true
            obelisk.burning = true
            obeliskLastStruckRef.current = obelisk
            playSpriteAnim(obelisk.sprite, obeliskBurningFramesRef.current, C.OBELISK_ANIM_SPEED, true)

            if (!obeliskEventActiveRef.current) {
              // Первый удар по любому обелиску запускает событие: таймер,
              // счётчик и доспавн оставшихся OBELISK_TOTAL-1 в Idle (см. задачу).
              obeliskEventActiveRef.current = true
              obeliskTimerRef.current = C.OBELISK_TIME_MS
              obeliskStruckCountRef.current = 1

              const startPoint = obeliskStartPointRef.current
              const remainingCandidates = obeliskCandidatesRef.current.filter(
                (p) => !startPoint || p[0] !== startPoint[0] || p[1] !== startPoint[1]
              )
              const spawnPoints = pickRandom(remainingCandidates, C.OBELISK_TOTAL - 1)
              for (const [tx, ty] of spawnPoints) spawnObelisk(tx, ty)
            } else {
              obeliskStruckCountRef.current += 1
              obeliskTimerRef.current += C.OBELISK_TIME_BONUS_MS
            }
          }
        }
      }

      // Ходьба влево/вправо + прыжок + коллизия со стенами, гравитация и
      // приземление на твердь. Платформы '=' — следующий шаг.
      const worldWidthPx = grid[0].length * C.TILE_SIZE

      app.ticker.add((ticker) => {
        const dt = ticker.deltaTime
        const startX = phys.x
        const startY = phys.y
        // Верх бокового хитбокса в прыжке — та же поправка, что у
        // sweepHeadBlock ниже (headOffset = phys.onGround ? 0 :
        // JUMP_HIT_OFFSET_Y): без неё полный PLAYER_HEIGHT цепляет нависающую
        // твердь над проёмами в воздухе, и диагональный прыжок стопорится.
        // Не переиспользуем headOffset из вертикального блока ниже — тот
        // объявлен в другой блочной области видимости и считается ПОСЛЕ
        // того, как phys.onGround уже сброшен в false на этот кадр (см. там
        // же); здесь нужен snapshot СРАЗУ на начало кадра, до этого сброса.
        const headOffset = phys.onGround ? 0 : C.JUMP_HIT_OFFSET_Y

        // Кулдаун зелья — секунды, как attackCooldownRef (ticker.deltaMS/1000).
        potionCdRef.current = Math.max(0, potionCdRef.current - ticker.deltaMS / 1000)

        // Таймер события обелисков — реальное время (ticker.deltaMS), тот же
        // приём, что у остальных ms-таймеров выше.
        if (obeliskEventActiveRef.current) {
          obeliskTimerRef.current -= ticker.deltaMS
          if (obeliskStruckCountRef.current >= C.OBELISK_TOTAL) {
            obeliskEventActiveRef.current = false
            setObeliskHud(null)
            // Все обелиски (включая стартовый) гаснут обратно в idle — они
            // остаются на карте декорацией и стеной по X, struck НЕ сбрасываем
            // (повторно бить нельзя). Тот же способ смены textures, что и при
            // поджоге — anchor/x/y/height/width не трогаем.
            for (const obelisk of obelisksRef.current) {
              obelisk.burning = false
              playSpriteAnim(obelisk.sprite, obeliskIdleFrames, C.OBELISK_ANIM_SPEED, true)
            }
            const last = obeliskLastStruckRef.current
            if (last) {
              spawnRewardFloat(last.sprite.x, last.sprite.y - last.sprite.height, [
                { kind: 'trophy', amount: rollTrophies(C.TROPHY_MULT_OBELISK) },
              ])
            }
            if (obeliskEventIndexRef.current !== null) closeEvent(obeliskEventIndexRef.current)
          } else if (obeliskTimerRef.current <= 0) {
            obeliskEventActiveRef.current = false
            setObeliskHud(null)
            // Провал = смерть героя — переиспользуем ЕДИНУЮ точку смерти
            // (takeDamage -> triggerDeath), не дублируем анимацию/hold/abandon.
            takeDamageRef.current(hpRef.current)
          } else {
            const secondsLeft = Math.ceil(obeliskTimerRef.current / 1000)
            // Стартовый обелиск в счёт не идёт — HUD считает только 3 доспавненных.
            const struckForHud = Math.max(0, obeliskStruckCountRef.current - 1)
            if (secondsLeft !== obeliskHudSecondsRef.current || struckForHud !== obeliskHudStruckRef.current) {
              obeliskHudSecondsRef.current = secondsLeft
              obeliskHudStruckRef.current = struckForHud
              setObeliskHud({ active: true, secondsLeft, struck: struckForHud })
            }
          }
        }

        // Горизонтальное движение — во время питья зелья (drinkingRef) ИЛИ
        // после смерти (deathRef) герой закоренён: ввод движения игнорируется
        // целиком, ноги на месте. deathRef никогда не сбрасывается — этот
        // гейт держит мёртвого героя неподвижным до конца забега.
        const heroLocked = drinkingRef.current || deathRef.current
        phys.vx = heroLocked ? 0 : dirRef.current * C.MOVE_SPEED
        phys.x += phys.vx * dt
        if (!heroLocked && dirRef.current !== 0) facingRef.current = dirRef.current > 0 ? 1 : -1

        if (phys.vx > 0) {
          const px = phys.x + C.PLAYER_WIDTH - 1
          let hit =
            isSolid(grid, C.TILE_SIZE, px, phys.y + headOffset + 1) ||
            isSolid(grid, C.TILE_SIZE, px, phys.y + C.PLAYER_HEIGHT / 2) ||
            isSolid(grid, C.TILE_SIZE, px, phys.y + C.PLAYER_HEIGHT - 1)
          if (!hit) {
            // Сначала: уже внутри полосы (по текущему положению, не по цели)?
            const stuckInBand = isOverlappingPlatformBand(grid, C.TILE_SIZE, startX, C.PLAYER_WIDTH, phys.y + headOffset, phys.y + C.PLAYER_HEIGHT)
            if (!stuckInBand) {
              const band = isPlatformBandBlocking(grid, C.TILE_SIZE, px, phys.y + headOffset, phys.y + C.PLAYER_HEIGHT)
              if (band) hit = true
            }
          }
          if (hit) {
            phys.x = Math.floor((phys.x + C.PLAYER_WIDTH) / C.TILE_SIZE) * C.TILE_SIZE - C.PLAYER_WIDTH
            phys.vx = 0
          }
        } else if (phys.vx < 0) {
          const px = phys.x
          let hit =
            isSolid(grid, C.TILE_SIZE, px, phys.y + headOffset + 1) ||
            isSolid(grid, C.TILE_SIZE, px, phys.y + C.PLAYER_HEIGHT / 2) ||
            isSolid(grid, C.TILE_SIZE, px, phys.y + C.PLAYER_HEIGHT - 1)
          if (!hit) {
            // Сначала: уже внутри полосы (по текущему положению, не по цели)?
            const stuckInBand = isOverlappingPlatformBand(grid, C.TILE_SIZE, startX, C.PLAYER_WIDTH, phys.y + headOffset, phys.y + C.PLAYER_HEIGHT)
            if (!stuckInBand) {
              const band = isPlatformBandBlocking(grid, C.TILE_SIZE, px, phys.y + headOffset, phys.y + C.PLAYER_HEIGHT)
              if (band) hit = true
            }
          }
          if (hit) {
            phys.x = (Math.floor(phys.x / C.TILE_SIZE) + 1) * C.TILE_SIZE
            phys.vx = 0
          }
        }

        phys.x = clamp(phys.x, 0, worldWidthPx - C.PLAYER_WIDTH)

        // Прыжок: только с тверди, двойного прыжка нет. Одно нажатие —
        // ровно один прыжок, флаг сразу сбрасывается.
        let jumpedThisFrame = false
        if (jumpPressedRef.current) {
          jumpPressedRef.current = false
          if (!deathRef.current && phys.onGround && !drinkingRef.current) {
            phys.vy = -C.JUMP_VELOCITY
            phys.onGround = false
            jumpedThisFrame = true
          }
        }

        // Вертикальная физика (гравитация + приземление)
        const wasOnGround = phys.onGround
        phys.vy = Math.min(phys.vy + C.GRAVITY * dt, C.MAX_FALL)
        phys.y += phys.vy * dt

        phys.onGround = false
        if (phys.vy > 0) {
          // Приземление сверху: проверяем весь путь ног за кадр, не только
          // конечную точку — иначе на просевшем кадре можно провалиться
          // сквозь тонкую полосу '=', не попав в неё ни разу.
          const prevFootY = startY + C.PLAYER_HEIGHT
          const footY = phys.y + C.PLAYER_HEIGHT
          const blockTop = sweepFootBlock(grid, C.TILE_SIZE, phys.x, C.PLAYER_WIDTH, prevFootY, footY)
          if (blockTop !== null) {
            phys.y = blockTop - C.PLAYER_HEIGHT
            phys.vy = 0
            phys.onGround = true
          }
        } else if (phys.vy < 0) {
          // Удар головой снизу вверх: та же защита от туннелирования —
          // проверяем весь путь [headY, prevHeadY] за кадр. '#' — вся
          // клетка, '=' — только полоса.
          // В ПРЫЖКЕ (phys.onGround уже false в этой ветке — vy<0 бывает
          // только во время взлёта) верх проверки опущен на headOffset=
          // JUMP_HIT_OFFSET_Y, к макушке прыжковой позы — иначе полный бокс
          // (128 высотой) торчит головой выше спрайта и упирается в пустоту.
          // На земле headOffset=0, поведение не меняется (эта ветка на земле
          // и не выполняется, т.к. vy<0 там не бывает).
          const headOffset = phys.onGround ? 0 : C.JUMP_HIT_OFFSET_Y
          const prevHeadY = startY + headOffset // y ДО y += vy*dt (startY захвачен в начале тика)
          const headY = phys.y + headOffset
          const pushTo = sweepHeadBlock(grid, C.TILE_SIZE, phys.x, C.PLAYER_WIDTH, prevHeadY, headY)
          if (pushTo !== null) {
            phys.y = pushTo - headOffset
            phys.vy = 0
          } else if (
            // НИЖНЯЯ граница диапазона намеренно НЕ сдвинута (startY +
            // PLAYER_HEIGHT, как было) — только верхняя поднята на
            // headOffset. Если ужать и верх, и низ на headOffset, нижняя
            // граница проверки уезжает в клетку под ногами игрока и rollback
            // срабатывает каждый кадр прыжка (замораживал игрока на месте,
            // уже наступали на эти грабли раньше).
            isOverlappingAtFrameStart(grid, C.TILE_SIZE, phys.x, C.PLAYER_WIDTH, prevHeadY, startY + C.PLAYER_HEIGHT)
          ) {
            // Зашли сбоку под ступень: пересечения границы за кадр не было
            // (голова уже была внутри полосы на старте кадра), sweep выше
            // ничего не нашёл. Откатываем движение вверх за этот кадр —
            // без перепозиционирования по blockBottom, никакого телепорта.
            // Снап возвращает phys.y ровно туда, где он был ДО этого кадра
            // (startY) — headOffset тут ни при чём, phys.y всегда верх
            // ПОЛНОГО бокса, а не сдвинутой головы.
            phys.y = startY
            phys.vy = 0
          }
        }

        // Приземление (край перехода "не на земле" -> "на земле" за этот
        // кадр) — запускает land, только если игрок не бежит и не прыгает
        // прямо сейчас (иначе движение/прыжок сразу перекрыли бы его же).
        const justLanded = !wasOnGround && phys.onGround
        if (justLanded && dirRef.current === 0 && !jumpedThisFrame) {
          landTimerRef.current = C.LAND_MS
        }

        // Шипы: неуязвимость тикает каждый кадр независимо от касания;
        // урон только когда истекла и хитбокс реально пересекает '^'.
        spikeIframeRef.current = Math.max(0, spikeIframeRef.current - ticker.deltaMS)
        if (
          spikeIframeRef.current <= 0 &&
          isTouchingSpikes(grid, C.TILE_SIZE, phys.x, C.PLAYER_WIDTH, phys.y, phys.y + C.PLAYER_HEIGHT)
        ) {
          spikeIframeRef.current = C.SPIKE_IFRAME_MS
          applySpikeDamageRef.current()
        }

        // "3 события за забег" — временное закрытие простым касанием хитбокса.
        // enemy-события сюда НЕ попадают — они закрываются убийством кластера
        // (см. enemy-цикл ниже), не касанием. chest — тоже НЕ попадают
        // (закрывается только по завершении анимации открытия, см. чуть
        // ниже в тикере). smuggler — тоже НЕ попадают: пока чистый визуал без
        // взаимодействия (обмен/диалог — отдельный будущий шаг), закрывать
        // касанием НЕ должен. obelisk — тоже НЕ попадает: закрывается только
        // по успеху таймера события (см. блок таймера обелисков в тикере),
        // иначе простое прохождение мимо стартовой точки закрыло бы событие
        // раньше времени. boss — тоже НЕ попадает: закрывается только по
        // концу death-анимации (см. boss.ts, deathDone/rewardGiven), иначе
        // касание точки спавна закрывало бы событие раньше самого боя, не
        // убив босса. puzzle (пока заглушка) — как раньше.
        // Мёртвый герой (deathRef) событий не закрывает вообще — тело
        // неподвижно, но гейт на всякий случай (напр. если смерть настигла
        // ровно в момент касания хитбокса).
        for (let i = 0; i < eventsRef.current.length && !deathRef.current; i++) {
          const ev = eventsRef.current[i]
          if (
            ev.closed ||
            ev.kind === 'enemy' ||
            ev.kind === 'chest' ||
            ev.kind === 'smuggler' ||
            ev.kind === 'obelisk' ||
            ev.kind === 'boss'
          ) continue
          const evLeft = ev.x * C.TILE_SIZE
          const evTop = ev.y * C.TILE_SIZE
          const touching =
            phys.x < evLeft + C.TILE_SIZE &&
            phys.x + C.PLAYER_WIDTH > evLeft &&
            phys.y < evTop + C.TILE_SIZE &&
            phys.y + C.PLAYER_HEIGHT > evTop
          if (!touching) continue

          if (ev.marker) ev.marker.visible = false
          closeEvent(i)
        }

        // Атака игрока. Кулдаун тикает в секундах, как cooldownLeft в Battle.tsx.
        if (attackCooldownRef.current > 0) {
          attackCooldownRef.current = Math.max(0, attackCooldownRef.current - ticker.deltaMS / 1000)
        }

        if (attackPressedRef.current) {
          attackPressedRef.current = false
          // Смерть ИЛИ хитстан ИЛИ питьё зелья: во время них атаковать нельзя.
          // Смерть проверяется первой и НИКОГДА не сбрасывается — мёртвый
          // герой не переигрывает атаку и не перебивает deathFrames текстурами.
          if (deathRef.current || hurtTimerRef.current > 0 || drinkingRef.current) {
            // no-op — нажатие проигнорировано
          } else if (attackCooldownRef.current <= 0 && !attackingRef.current) {
            attackCooldownRef.current = C.ATTACK_COOLDOWN
            attackActiveRef.current = true
            attackActiveTimerRef.current = C.ATTACK_ACTIVE_MS
            attackSwingIdRef.current += 1 // новый взмах — враги смогут получить урон от него ровно один раз
            attackingRef.current = true
            attackHitDoneRef.current = false
            attackFacingRef.current = facingRef.current // facing зафиксирован на старте замаха
            // Хитбокс — прямоугольник шириной ATTACK_RANGE перед игроком, по
            // направлению взгляда (facingRef), высотой в его рост. Считается
            // один раз на старте удара (снимок, как мгновенная проверка
            // дистанции в Battle.tsx), а не каждый кадр активности.
            attackHitboxRef.current =
              facingRef.current === 1
                ? { x: phys.x + C.PLAYER_WIDTH, y: phys.y, width: C.PLAYER_ATTACK_RANGE, height: C.PLAYER_HEIGHT }
                : { x: phys.x - C.PLAYER_ATTACK_RANGE, y: phys.y, width: C.PLAYER_ATTACK_RANGE, height: C.PLAYER_HEIGHT }
            // Урон здесь больше НЕ применяется — applyAttackHit() вызывается
            // из блока анимации героя в тикере, на кадре удара ATTACK_STRIKE_FRAME.
            hero.textures = attackFrames
            hero.loop = false
            hero.animationSpeed = C.ATTACK_ANIM_SPEED
            hero.gotoAndPlay(0)
          }
        }

        if (attackActiveRef.current) {
          attackActiveTimerRef.current -= ticker.deltaMS
          if (attackActiveTimerRef.current <= 0) {
            attackActiveRef.current = false
            // attackHitboxRef НЕ обнуляем здесь: ATTACK_ACTIVE_MS (150мс) —
            // окно короче, чем реальный момент удара по анимации (~200мс на
            // ATTACK_STRIKE_FRAME при ATTACK_ANIM_SPEED=0.5) — applyAttackHit()
            // должен ещё застать валидный хитбокс. Хитбокс переживается
            // следующим press'ом.
          }
        }

        // Питьё зелья. По образцу старта атаки: снимок текстур/скорости/loop
        // на pressed-флаге, проигрывание берёт на себя ветка приоритета
        // анимаций ниже. Заряды/кулдаун гейтят СТАРТ, но не списываются
        // здесь — хил+списание+кулдаун происходят на кадре глотка
        // (POTION_GULP_FRAME) в drinkingRef-ветке, см. ниже.
        if (drinkPressedRef.current) {
          drinkPressedRef.current = false
          if (
            !deathRef.current &&
            phys.onGround &&
            !drinkingRef.current &&
            potionChargesRef.current > 0 &&
            potionCdRef.current <= 0
          ) {
            drinkingRef.current = true
            potionHealedThisDrinkRef.current = false
            hero.textures = drinkFrames
            hero.loop = false
            hero.animationSpeed = 0.2
            hero.gotoAndPlay(0)
          }
        }

        // Dodge игрока: окно неуязвимости от удара врага + кулдаун кнопки,
        // независимо от i-frames шипов (spikeIframeRef) — отдельный механизм.
        // Считается ОДИН раз за кадр (не за врага), поэтому вынесен перед
        // циклом по врагам ниже.
        dodgeIframeRef.current = Math.max(0, dodgeIframeRef.current - ticker.deltaMS)
        dodgeCooldownRef.current = Math.max(0, dodgeCooldownRef.current - ticker.deltaMS)
        if (dodgePressedRef.current) {
          dodgePressedRef.current = false
          // Смерть — мёртвый герой не может ни увернуться, ни открыть
          // окно Контрабандиста. deathRef никогда не сбрасывается.
          if (deathRef.current) {
            // no-op
          } else {
            // Смуглер рядом — перехватывает dodge и открывает панель (пока
            // только флаг + console.log, см. задачу) вместо обычного dodge.
            const playerCenterXForSmuggler = phys.x + C.PLAYER_WIDTH / 2
            const playerFeetYForSmuggler = phys.y + C.PLAYER_HEIGHT
            const nearbySmuggler = smugglersRef.current.find((s) => {
              const ev = eventsRef.current[s.eventIndex]
              if (!ev || ev.closed) return false
              const dx = Math.abs(playerCenterXForSmuggler - s.sprite.x)
              const dy = Math.abs(playerFeetYForSmuggler - s.floorY)
              return dx <= C.SMUGGLER_INTERACT_RANGE && dy <= C.FLOOR_Y_TOLERANCE * C.TILE_SIZE
            })

            if (nearbySmuggler) {
              smugglerActiveRef.current = nearbySmuggler
              smugglerPanelOpenRef.current = true
            } else if (dodgeCooldownRef.current <= 0 && !drinkingRef.current) {
              dodgeIframeRef.current = C.PLAYER_DODGE_IFRAME_MS
              dodgeCooldownRef.current = C.PLAYER_DODGE_COOLDOWN_MS
            }
          }
        }

        // Скиллы (см. explore/entities/skills.ts) — пока только гасит
        // skill1Pressed/skill2Pressed, самой логики ещё нет.
        skills!.update(ticker.deltaMS)

        // AI обычного врага (см. explore/entities/enemy.ts) — вызов на ТОМ
        // ЖЕ месте кадра, где раньше стоял сам AI-цикл: сразу после
        // skills.update() и до AI босса (порядок кадра не менялся, см.
        // задачу). dt — кадро-масштабированный (как у phys игрока),
        // ticker.deltaMS — реальные мс для таймеров внутри enemy.ts.
        enemySystem!.update(dt, ticker.deltaMS)

        // Босс карты C (см. explore/entities/boss.ts) — вызов на ТОМ ЖЕ
        // месте кадра, где раньше стоял AI-блок + шипы + волны: сразу после
        // enemySystem.update() и до сундуков/обелисков/смуглера (порядок
        // кадра не менялся, см. задачу). Внутри update() модуль сам вызывает
        // AI → шипы → волны в этом порядке — КРИТИЧНО не менять (ranged/
        // stomp-ветки AI рождают снаряд в этом же кадре, шипы/волны должны
        // получить его физический шаг сразу, не на следующем кадре).
        bossSystem!.update(dt, ticker.deltaMS)

        // Сундуки: завершение анимации открытия (тем же способом, каким
        // определяется конец attack/hurt у героя — конец текстур ИЛИ спрайт
        // сам остановился) + мягкая стена по X (та же pushPlayerOutX, что и
        // у живого врага выше). Хитбокс остаётся ВСЕГДА, и закрытый, и
        // открытый — не убирается при opened. Свежий playerCombatBox
        // считаем здесь же — push-out врагов выше уже мог сдвинуть phys.x.
        for (const chest of chestsRef.current) {
          // Пересчитывается КАЖДЫЙ кадр (не только на смене состояния) — та
          // же защита от "сундук съезжает вниз" (см. историю), что и на
          // spawn/hit-start/complete ниже.
          applyChestLayout(chest)

          // Набор кадров зависит от исхода броска (см. isMimic на первом
          // ударе выше) — чтение currentFrame/length ниже должно сверяться
          // с ПРАВИЛЬНЫМ набором, иначе мимик (14 кадров) либо обрывается
          // раньше времени, либо никогда не считается "доигравшим" по длине
          // доброго набора (13 кадров).
          const activeFrames = chest.isMimic ? chestTrapFrames : chestFrames

          // Урон мимика — на strike-кадре взрыва, неизбежен (без уклонения,
          // без i-frames шипов — отдельный источник урона). Бьёт РОВНО один
          // раз за срабатывание (trapDamaged-гейт).
          if (
            chest.opening &&
            chest.isMimic &&
            !chest.trapDamaged &&
            chest.sprite.currentFrame >= C.CHEST_TRAP_STRIKE_FRAME
          ) {
            chest.trapDamaged = true
            takeDamageRef.current(maxHp * C.CHEST_TRAP_DAMAGE_FRAC)
          }

          if (chest.opening && (chest.sprite.currentFrame >= activeFrames.length - 1 || !chest.sprite.playing)) {
            chest.opening = false
            chest.opened = true
            // Явно держим последний кадр — AnimatedSprite без loop сам
            // должен так делать, но фиксируем на всякий случай (см. задачу):
            // stop() + gotoAndStop(последний) + visible=true, чтобы сундук
            // не пропадал после проигрывания.
            chest.sprite.stop()
            chest.sprite.gotoAndStop(activeFrames.length - 1) // держим последний кадр (открыт/гарь)
            applyChestLayout(chest)
            chest.sprite.visible = true
            closeEvent(chest.eventIndex)
            // Награда — ТОЛЬКО добрый исход, трофеями по общей формуле (см.
            // задачу): реальное начисление player.trophies живёт на сервере,
            // здесь только попап.
            if (!chest.isMimic) {
              spawnRewardFloat(chest.sprite.x, chest.sprite.y - chest.sprite.height, [
                { kind: 'trophy', amount: rollTrophies(C.TROPHY_MULT_CHEST) },
              ])
            }
          }
          pushPlayerOutX(chest.hitbox, getPlayerCombatBox())
        }

        // Обелиски: стена по X (та же pushPlayerOutX, что у сундука) — и
        // после удара по обелиску тоже (см. задачу). Спрайт/хитбокс не
        // пересчитываются здесь — заданы один раз при спавне из констант.
        for (const obelisk of obelisksRef.current) {
          pushPlayerOutX(obelisk.hitbox, getPlayerCombatBox())
        }

        // Смуглеры: посадка из констант (SMUGGLER_DRAW_H/SMUGGLER_OFFSET_Y,
        // подобраны вживую отладочным тюнером, убран — см. историю) + поворот
        // к игроку. НЕ стена — pushPlayerOutX для смуглера НЕ вызывается (см.
        // задачу), сквозь него можно пройти.
        for (const smuggler of smugglersRef.current) {
          smuggler.sprite.height = C.SMUGGLER_DRAW_H
          smuggler.sprite.width = C.SMUGGLER_DRAW_H * (230 / 296)
          smuggler.sprite.y = smuggler.floorY + C.SMUGGLER_OFFSET_Y

          // Спрайт смотрит ВПРАВО по умолчанию (facing=1 → scale.x
          // положительный, БЕЗ зеркала). Поворот — только пока игрок в
          // пределах SMUGGLER_TURN_RANGE; дальше facing держит последнее
          // значение (не дёргается на границе дальности).
          const playerCenterX = phys.x + C.PLAYER_WIDTH / 2
          const dx = playerCenterX - smuggler.sprite.x
          if (Math.abs(dx) <= C.SMUGGLER_TURN_RANGE) {
            smuggler.facing = dx < 0 ? -1 : 1
          }
          smuggler.sprite.scale.x =
            smuggler.facing === 1 ? Math.abs(smuggler.sprite.scale.x) : -Math.abs(smuggler.sprite.scale.x)
        }

        // Панель Смуглера: позиция над головой активного смуглера (см.
        // smugglerActiveRef, выставляется в блоке dodge выше), автозакрытие
        // (флаг + visible=false, событие НЕ закрывается), если игрок отошёл
        // дальше SMUGGLER_INTERACT_RANGE/этаж или событие уже закрыто иначе.
        const activeSmuggler = smugglerActiveRef.current
        if (smugglerPanelOpenRef.current && activeSmuggler) {
          const ownerEvent = eventsRef.current[activeSmuggler.eventIndex]
          const playerCenterXForPanel = phys.x + C.PLAYER_WIDTH / 2
          const playerFeetYForPanel = phys.y + C.PLAYER_HEIGHT
          const stillNear =
            Math.abs(playerCenterXForPanel - activeSmuggler.sprite.x) <= C.SMUGGLER_INTERACT_RANGE &&
            Math.abs(playerFeetYForPanel - activeSmuggler.floorY) <= C.FLOOR_Y_TOLERANCE * C.TILE_SIZE
          if (!ownerEvent || ownerEvent.closed || !stillNear) {
            smugglerPanelOpenRef.current = false
            smugglerPanel.visible = false
          } else {
            const desiredWorldX = activeSmuggler.sprite.x - C.SMUGGLER_PANEL_W / 2
            const desiredWorldY = activeSmuggler.sprite.y - C.SMUGGLER_DRAW_H - C.SMUGGLER_PANEL_H - 10

            // Панель — ребёнок worldContainer (мировые координаты, двигается
            // и зумится камерой) — рядом с краем карты желаемая позиция может
            // уехать за пределы экрана. Переводим в экранные координаты
            // (toGlobal), зажимаем в границах app.screen с полем MARGIN,
            // переводим обратно в мировые (toLocal) — так окно у края карты
            // сдвигается внутрь вьюпорта, а в остальных случаях (запас есть)
            // ведёт себя как раньше, без видимой разницы.
            const topLeftScreen = worldContainer.toGlobal({ x: desiredWorldX, y: desiredWorldY })
            const clampedScreenX = clamp(
              topLeftScreen.x,
              C.SMUGGLER_PANEL_MARGIN,
              app!.screen.width - C.SMUGGLER_PANEL_W * C.WORLD_SCALE - C.SMUGGLER_PANEL_MARGIN
            )
            const clampedScreenY = clamp(
              topLeftScreen.y,
              C.SMUGGLER_PANEL_MARGIN,
              app!.screen.height - C.SMUGGLER_PANEL_H * C.WORLD_SCALE - C.SMUGGLER_PANEL_MARGIN
            )
            const clampedWorld = worldContainer.toLocal({ x: clampedScreenX, y: clampedScreenY })
            smugglerPanel.x = clampedWorld.x
            smugglerPanel.y = clampedWorld.y
            smugglerPanel.visible = true
          }
        } else {
          smugglerPanel.visible = false
        }

        player.x = phys.x
        player.y = phys.y

        // Ноги героя (anchor 0.5,1.0 — низ-центр) — Y берём с поверхности
        // тайла (findGroundSurfaceY), а не с низа хитбокса напрямую; низ
        // хитбокса остаётся запасным вариантом на случай, если герой сейчас
        // в воздухе (под ногами прямо сейчас нет тверди — прыжок/падение).
        if (heroSpriteRef.current) {
          const heroFootBottom = player.y + C.PLAYER_HEIGHT
          const heroSurfaceY = findGroundSurfaceY(player.x, C.PLAYER_WIDTH, heroFootBottom)
          heroSpriteRef.current.x = player.x + C.PLAYER_WIDTH / 2
          heroSpriteRef.current.y = (heroSurfaceY ?? heroFootBottom) + C.FOOT_TUNE
        }

        // Приоритет анимаций героя (сверху вниз):
        // 0) смерть — АБСОЛЮТНЫЙ приоритет, пока deathRef.current истинен,
        //    ничего из веток ниже не выполняется (прыжок/hurt/питьё/атака/
        //    land/run больше не могут перебить падение);
        // а) в воздухе — позы прыжка, land/атака/hurt сбрасываются (прыжок
        //    прерывает замах и не тянет hurt на землю); питьё можно начать
        //    только на земле (см. drinkPressedRef-обработчик), поэтому сюда
        //    не заходит — jump-ветка его не трогает;
        // б) hurt в процессе — ГЛАВНЕЕ питья/атаки/land/run, пока таймер > 0
        //    (хитстан обрывает и замах, и питьё — см. triggerHurt);
        // в) питьё зелья в процессе — ТОЛЬКО визуал (см. drinkingRef), герой
        //    закоренён (ввод движения/прыжка/атаки/dodge игнорируется выше
        //    по тикеру); прервать может только hurt/death (приоритет выше);
        // г) атака в процессе — урон ровно один раз на кадре удара
        //    (ATTACK_STRIKE_FRAME), НЕ на нажатии; land ниже по приоритету —
        //    атака его не даёт начать, пока идёт;
        // д) на земле, land ещё идёт И нет горизонтального ввода — доигрываем
        //    land (движение прерывает его — переход в ветку е);
        // е) обычный idle/run по движению.
        if (deathRef.current) {
          // Доиграла — замираем на последнем кадре и копим удержание;
          // abandon срабатывает РОВНО один раз (deathAbandonFiredRef).
          if (hero.currentFrame >= deathFrames.length - 1) {
            hero.gotoAndStop(deathFrames.length - 1)
            deathHoldRef.current += ticker.deltaMS
            if (deathHoldRef.current >= C.DEATH_HOLD_MS && !deathAbandonFiredRef.current) {
              deathAbandonFiredRef.current = true
              onClose?.()
            }
          }
          hero.anchor.set(0.5, C.GROUND_ANCHOR_Y)
        } else if (!phys.onGround) {
          const rising = phys.vy < 0
          hero.textures = jumpFrames
          hero.loop = false
          hero.gotoAndStop(rising ? C.RISE_FRAME : C.FALL_FRAME)
          hero.anchor.set(0.5, rising ? C.RISE_ANCHOR_Y : C.FALL_ANCHOR_Y)
          landTimerRef.current = 0
          attackingRef.current = false // прыжок отменяет замах
          hurtTimerRef.current = 0 // в воздухе — прыжок, hurt не тянем на землю
        } else if (hurtTimerRef.current > 0) {
          hurtTimerRef.current = Math.max(0, hurtTimerRef.current - ticker.deltaMS)
          hero.anchor.set(0.5, C.GROUND_ANCHOR_Y)
          if (hero.textures !== hurtFrames) {
            hero.textures = hurtFrames
            hero.loop = false
            hero.animationSpeed = C.HURT_ANIM_SPEED
            hero.gotoAndPlay(0)
          }
        } else if (drinkingRef.current) {
          // Хил — РОВНО один раз за питьё, на кадре глотка (не на нажатии
          // кнопки). Если hurt/death оборвали питьё РАНЬШЕ этого кадра
          // (drinkingRef уже сброшен triggerHurt/triggerDeath — эта ветка
          // просто не выполнится), potionHealedThisDrinkRef останется false,
          // и заряд/хил/кулдаун не применятся — как и требовалось.
          if (!potionHealedThisDrinkRef.current && hero.currentFrame >= C.POTION_GULP_FRAME) {
            potionHealedThisDrinkRef.current = true
            hpRef.current = Math.min(maxHp, hpRef.current + maxHp * C.POTION_HEAL_FRAC)
            updateHpBar()
            potionChargesRef.current -= 1
            potionCdRef.current = C.POTION_COOLDOWN
            updatePotionButton()
          }
          // Доиграла (тот же способ определения конца, что у атаки: конец
          // текстур ИЛИ спрайт сам остановился) — сбрасываем и со следующего
          // тика подхватывает idle/run.
          if (hero.currentFrame >= drinkFrames.length - 1 || !hero.playing) {
            drinkingRef.current = false
          }
          hero.anchor.set(0.5, C.GROUND_ANCHOR_Y)
        } else if (attackingRef.current) {
          if (!attackHitDoneRef.current && hero.currentFrame >= C.ATTACK_STRIKE_FRAME) {
            applyAttackHit()
            attackHitDoneRef.current = true
          }
          if (hero.currentFrame >= attackFrames.length - 1 || !hero.playing) {
            attackingRef.current = false // доиграла — idle/run подхватит со следующего тика
          }
          hero.anchor.set(0.5, C.GROUND_ANCHOR_Y)
        } else if (landTimerRef.current > 0 && dirRef.current === 0) {
          landTimerRef.current = Math.max(0, landTimerRef.current - ticker.deltaMS)
          hero.anchor.set(0.5, C.GROUND_ANCHOR_Y)
          if (hero.textures !== landFrames) {
            hero.textures = landFrames
            hero.loop = false
            hero.animationSpeed = 0.5
            hero.gotoAndPlay(0)
          }
        } else {
          // Сюда же попадает прерывание land движением (dirRef.current !== 0
          // при landTimerRef.current > 0) — таймер обнуляется и играется
          // обычная idle/run логика с этого же кадра.
          landTimerRef.current = 0
          hero.anchor.set(0.5, C.GROUND_ANCHOR_Y)
          playAnim(dirRef.current !== 0 ? runFrames : idleFrames, dirRef.current !== 0 ? 0.37 : 0.15, true)
        }
        // Флип по facingRef (последнее ненулевое направление — не сбрасывается
        // в 0, в отличие от dirRef, так что герой не разворачивается лицом
        // вправо каждый раз, когда отпускаешь кнопку движения стоя на месте) —
        // работает во всех ветках, применяется всегда. Во время атаки — facing
        // ЗАФИКСИРОВАН на attackFacingRef (снят на старте замаха), не следует
        // за вводом до конца анимации.
        const heroFlipDir = attackingRef.current ? attackFacingRef.current : facingRef.current
        hero.scale.x = heroFlipDir === 1 ? Math.abs(hero.scale.x) : -Math.abs(hero.scale.x)

        // Плавающие попапы наград (см. RewardFloat/spawnRewardFloat выше) —
        // независимая от игровой логики анимация, реальное время
        // (ticker.deltaMS), не масштабированное по dt-кадрам как движение.
        if (rewardFloatsRef.current.length > 0) {
          const stillActive: RewardFloat[] = []
          for (const rf of rewardFloatsRef.current) {
            rf.elapsed += ticker.deltaMS
            const progress = Math.min(1, rf.elapsed / C.REWARD_FLOAT_MS)
            const eased = 1 - (1 - progress) * (1 - progress) // ease-out
            rf.node.y = rf.startY - C.REWARD_FLOAT_RISE * eased
            if (progress < 0.15) {
              rf.node.alpha = progress / 0.15
            } else if (progress > 0.65) {
              rf.node.alpha = Math.max(0, (1 - progress) / 0.35)
            } else {
              rf.node.alpha = 1
            }
            if (rf.elapsed >= C.REWARD_FLOAT_MS) {
              worldContainer.removeChild(rf.node)
              rf.node.destroy({ children: true })
            } else {
              stillActive.push(rf)
            }
          }
          rewardFloatsRef.current = stillActive
        }

        updateCamera(dt)
      })
    }

    setup()

    return () => {
      cancelled = true
      skills?.dispose()
      enemySystem?.dispose()
      bossSystem?.dispose()
      // destroy() только если init() реально завершился — до этого у app нет
      // внутренностей, на которые destroy() рассчитывает (см. комментарий
      // у объявления initialized выше).
      if (app && initialized) {
        try {
          if (onBgResize) app.renderer.off('resize', onBgResize)
          app.destroy(true, { children: true })
        } catch {
          // Гонка с веткой "cancelled после init" в setup() — игнорируем.
        }
      }
      appRef.current = null
      heroSpriteRef.current = null
      // Узлы сами уничтожаются деревом app.destroy(true, {children:true})
      // выше — здесь только сбрасываем список, чтобы не держать ссылки на
      // уже уничтоженные Container при повторном mount (StrictMode).
      rewardFloatsRef.current = []
      bossSpikesRef.current = []
      bossWavesRef.current = []
    }
    // TEMP: map switcher — mapFile в зависимостях, чтобы смена карты через
    // временный переключатель (см. панель настроек ниже) перезапускала этот
    // эффект целиком; существующий cleanup выше уже корректно уничтожает
    // app, отдельный механизм не нужен.
  }, [mapFile])

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 1000,
        background: '#0d0820',
        overflow: 'hidden',
      }}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Keyframes для пульсации кольца "событие завершено" (см. гнёзда
          иконок ниже) — только opacity тени, layout не трогает. Инлайн-стили
          React не поддерживают @keyframes, поэтому один глобальный <style>. */}
      <style>{`
        @keyframes eventRingPulse {
          0%, 100% { box-shadow: 0 0 8px 2px rgba(232,178,58,0.6), 0 0 16px 4px rgba(232,178,58,0.3); }
          50% { box-shadow: 0 0 8px 2px rgba(232,178,58,0.9), 0 0 16px 4px rgba(232,178,58,0.5); }
        }
        @keyframes obeliskTimerPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.55; }
        }
      `}</style>

      {/* HUD события обелисков (карта F, см. задачу) — таймер + счётчик
          сбитых, fixed сверху по центру, safe-area aware, только пока
          событие активно. pointerEvents: none — не перехватывает тапы. */}
      {obeliskHud?.active && (
        <div
          style={{
            position: 'fixed',
            top: 'calc(env(safe-area-inset-top) + 6px)',
            // Центр по ПРОСВЕТУ между HP-плитой (left:8 + HP_FRAME_W) и
            // шестерёнкой (SETTINGS_BTN_RIGHT + SETTINGS_BTN_SIZE от правого
            // края) — left+right без width, браузер сам считает ширину блока
            // как промежуток между границами (не left:50%+transform).
            left: `calc(8px + ${C.HP_FRAME_W} + 8px)`,
            right: C.SETTINGS_BTN_RIGHT + C.SETTINGS_BTN_SIZE + 8,
            zIndex: 1001,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              fontFamily: C.FONT_DISPLAY,
              fontSize: 'clamp(20px, 6vw, 34px)',
              fontWeight: 900,
              letterSpacing: '0.02em',
              lineHeight: 1,
              whiteSpace: 'nowrap',
              color: obeliskHud.secondsLeft < 10 ? '#E0353B' : '#EDE7F2',
              textShadow: '0 2px 4px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.9)',
              animation: obeliskHud.secondsLeft < 10 ? 'obeliskTimerPulse 0.8s ease-in-out infinite' : 'none',
            }}
          >
            {Math.floor(obeliskHud.secondsLeft / 60)}:{String(obeliskHud.secondsLeft % 60).padStart(2, '0')}
          </div>
          <div
            style={{
              fontFamily: C.FONT_DISPLAY,
              fontSize: 'clamp(10px, 3vw, 17px)',
              fontWeight: 700,
              lineHeight: 1,
              marginTop: 4,
              whiteSpace: 'nowrap',
              color: obeliskHud.struck >= C.OBELISK_TOTAL - 1 ? '#E8B23A' : '#9C93AD',
              textShadow: '0 1px 3px rgba(0,0,0,0.85)',
            }}
          >
            {obeliskHud.struck}/{C.OBELISK_TOTAL - 1}
          </div>
        </div>
      )}

      <HudPlate
        hpFillRef={hpFillRef}
        hpTextRef={hpTextRef}
        maxHp={maxHp}
        eventClosed={eventClosed}
        eventKinds={eventKinds}
      />

      <SettingsPanel mapFile={mapFile} onSelectMap={setMapFile} onClose={onClose} />

      <TouchControls
        dirRef={dirRef}
        jumpPressedRef={jumpPressedRef}
        attackPressedRef={attackPressedRef}
        dodgePressedRef={dodgePressedRef}
        drinkPressedRef={drinkPressedRef}
        skill1PressedRef={skill1PressedRef}
        skill2PressedRef={skill2PressedRef}
        potionBtnRef={potionBtnRef}
        updatePotionButton={updatePotionButton}
      />
    </div>
  )
}
