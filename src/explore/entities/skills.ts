import type { MutableRefObject } from 'react'
import { AnimatedSprite } from 'pixi.js'
import type { Container, Texture } from 'pixi.js'
import type { Grid } from '../types'
import type { PlayerPhysics, Enemy, Boss } from '../types'
import * as C from '../constants'

// Скиллы игрока (heal/fireball/iceball/slash/dash) — модуль подключён к
// игровому циклу ПУСТЫМ, до реализации самих скиллов (см. задачу).
// Интерфейс (SkillsDeps/createSkillsSystem) спроектирован под будущую
// реализацию заранее, чтобы точку подключения в Explore.tsx не пришлось
// переделывать, когда скиллы появятся.
//
// Арт всех пяти скиллов лежит в public/assets/skills — 8 листов (снаряд +
// импакт у fireball и iceball, аура heal, взмах slash, капли Bleeding_Loop,
// Dash_Strike), размеры сверены по заголовкам PNG. Грузятся ПЯТЬ листов:
// Heal_Aura, Slash_Streak, Dash_Strike и пара Fireball_Projectile/
// Fireball_Impact (см. loadExploreAssets в ../assets.ts). Не грузятся два
// листа iceball (механики нет) и Bleeding_Loop (визуал снят намеренно, см.
// updateBleeds).
export type SkillId = 'heal' | 'fireball' | 'iceball' | 'slash' | 'dash'

export type SkillsDeps = {
  // Герой — phys/getPlayerCombatBox читаются, не пересоздаются: phys это
  // тот же объект, что мутирует физика игрока в тикере (см. physicsRef.current
  // в Explore.tsx), getPlayerCombatBox — closure-функция оттуда же.
  phys: PlayerPhysics
  facing: MutableRefObject<1 | -1>
  getPlayerCombatBox: () => { x: number; y: number; w: number; h: number }

  // Мир — worldContainer/grid тоже closure-значения setup() в Explore.tsx,
  // снаружи не видны, поэтому передаются явно. isSolid/isPlatformBandBlocking
  // — те же функции из collision.ts, что использует шип босса.
  worldContainer: Container
  grid: Grid
  tileSize: number
  isSolid: (grid: Grid, tileSize: number, px: number, py: number) => boolean
  isPlatformBandBlocking: (
    grid: Grid,
    tileSize: number,
    px: number,
    top: number,
    bottom: number,
  ) => { cx: number; cy: number } | null

  // Цели и урон
  enemies: MutableRefObject<Enemy[]>
  boss: MutableRefObject<Boss | null>
  attackDamage: MutableRefObject<number>
  takeDamage: (amount: number) => void
  dodgeIframe: MutableRefObject<number>
  // Мёртв ли герой — тот же deathRef, что гейтит анимации в Explore.tsx.
  // Нужен, чтобы оборвать оставшиеся импульсы хила и снять ауру: healPlayer
  // сам вернёт 0, но по нулю НЕЛЬЗЯ отличить смерть от "HP уже полное" —
  // второе нормальный исход и ауру гасить не должно.
  dead: MutableRefObject<boolean>
  // Урон по врагу/боссу — ОБЩАЯ точка с обычной атакой: те же closure-функции
  // из setup() в Explore.tsx, которые зовёт applyAttackHit (не копия логики).
  // Возвращают "цель умерла" — смерть/HP-бар/анимация трупа уже сделаны
  // внутри. Переход босса во вторую стадию — тоже там (damageBoss), поэтому
  // его двигает любой урон, включая скилловый.
  // Хитстан и прерывание замаха в САМИ эти функции по-прежнему НЕ входят —
  // но они больше не привилегия меча: реакция вынесена отдельным вызовом,
  // applyEnemyHitReaction/applyBossHitReaction ниже, и скилл решает сам,
  // трясти цель или нет.
  // sourceX — X ИСТОЧНИКА урона в мировых координатах: от него враг решает,
  // куда идти расследовать (см. INVESTIGATE_MS и поля investigate* у
  // Enemy/Boss). Для скиллов это НЕ всегда игрок: у взрыва fireball источник
  // — точка взрыва, а не тот, кто его запустил. Параметр обязательный, без
  // умолчания: молчаливая заглушка увела бы врага не туда.
  damageEnemy: (enemy: Enemy, amount: number, accumulator: MutableRefObject<number>, sourceX: number) => boolean
  damageBoss: (amount: number, accumulator: MutableRefObject<number>, sourceX: number) => boolean
  // Реакция цели на РАЗОВОЕ попадание (вспышка/хитстан/стан-резист, у зверя
  // ещё и прерывание замаха) — те же closure-функции из setup(), что зовёт
  // applyAttackHit после урона мечом, с теми же порогами.
  // Зовутся ТОЛЬКО на НЕ смертельном попадании (проверяется по возврату
  // damageEnemy/damageBoss) и ровно один раз на цель за событие: у взрыва
  // fireball — раз за взрыв, у рывка dash — раз за рывок (дедуп там же, где
  // дедуп урона: dashHitTargets).
  // ⚠️ Тик кровотечения slash их НЕ зовёт НАМЕРЕННО: он идёт раз в секунду
  // пять секунд подряд, и хитстан держал бы цель в локе весь этот срок.
  // Разовые попадания скиллов таким свойством не обладают — отсюда разница.
  applyEnemyHitReaction: (enemy: Enemy) => void
  applyBossHitReaction: (boss: Boss) => void
  // Аккумулятор урона СКИЛЛОВ (Explore.tsx: skillDamageDealtRef) — растит
  // ловкость на сервере, отдельно от attackDamageDealtRef, который растит
  // силу. Передаётся третьим аргументом в damageEnemy/damageBoss выше.
  skillDamageDealt: MutableRefObject<number>
  // Старт замаха игрока — ТА ЖЕ closure-функция, что зовёт обработчик кнопки
  // ⚔ в тикере Explore.tsx, не копия: slash использует анимацию обычной
  // атаки. Возвращает, начался ли замах (false — атака на кулдауне, уже идёт,
  // либо герой мёртв/в хитстане/пьёт). Взводит ATTACK_COOLDOWN внутри себя.
  startPlayerAttack: () => boolean
  // Старт анимации dash — ТА ЖЕ closure-функция из setup() в Explore.tsx, по
  // образцу startPlayerAttack выше. dash проигрывается ПОДМЕНОЙ ТЕКСТУР на
  // спрайте героя (это его анимация, а не VFX-оверлей), поэтому кадры сюда,
  // в отличие от slashStreakFrames ниже, НЕ передаются: ими владеет
  // Explore.tsx, который и рисует героя.
  // Возвращает, началась ли анимация (false — герой мёртв/в хитстане/пьёт,
  // dash уже идёт либо идёт замах). ЭТАП 1: кулдауна, движения, урона и
  // неуязвимости у dash нет, гейтить тут больше нечем.
  startPlayerDash: () => boolean
  // Старт анимации каста — ТА ЖЕ closure-функция из setup() в Explore.tsx,
  // по образцу startPlayerAttack. Каст — анимация ГЕРОЯ (подмена текстур на
  // его спрайте), поэтому кадры сюда не передаются: ими владеет Explore.tsx.
  // Возвращает, началась ли анимация (false — герой мёртв/в хитстане/пьёт,
  // либо уже идёт каст, замах или рывок).
  startPlayerCast: () => boolean
  // Идёт ли сейчас каст — тот же castingRef, что гейтит ветку анимации в
  // Explore.tsx (по образцу attacking ниже). Нужен, чтобы снять пометку
  // "этот каст должен выпустить снаряд", если анимацию оборвали ДО кадра
  // вылета: иначе она перетекла бы на следующий каст.
  casting: MutableRefObject<boolean>
  // Идёт ли сейчас рывок — тот же dashingRef, что гейтит ветку анимации,
  // неуязвимость и проход сквозь тела в Explore.tsx (по образцу attacking
  // ниже). Нужен, чтобы урон рывка проверялся каждый кадр, пока рывок идёт:
  // владеет состоянием рывка Explore.tsx, а не этот модуль.
  dashing: MutableRefObject<boolean>
  // Идёт ли сейчас замах игрока — тот же attackingRef, что гейтит ветку
  // анимации атаки в Explore.tsx. Нужен, чтобы снять пометку "этот взмах —
  // slash", если замах закончился или был прерван, так и не дойдя до кадра
  // удара: иначе она перетекла бы на следующую ОБЫЧНУЮ атаку.
  attacking: MutableRefObject<boolean>
  // Кадры VFX slash — рефы по той же причине, что healAuraFrames выше.
  slashStreakFrames: MutableRefObject<Texture[] | null>
  // Кадры fireball — снаряд (лупится в полёте) и разовая вспышка на месте
  // его смерти. Рефы по той же причине, что healAuraFrames выше.
  fireballProjectileFrames: MutableRefObject<Texture[] | null>
  fireballImpactFrames: MutableRefObject<Texture[] | null>
  // Кадры iceball — та же пара листов своей стихии. Снаряд у обоих скиллов
  // ОДИН И ТОТ ЖЕ код (см. ProjectileSpec ниже), различаются только текстуры,
  // урон, кулдаун и эффект попадания.
  iceballProjectileFrames: MutableRefObject<Texture[] | null>
  iceballImpactFrames: MutableRefObject<Texture[] | null>

  // Лечение — ОБЁРТКА над healPlayerRef в Explore.tsx, не сама функция (та же
  // причина, что у takeDamage выше). Единая точка хила на зелье и на скилл
  // heal: клэмп по maxHp, округление вниз и учёт реально долитого в
  // healedAmount живут ТАМ, здесь не дублируются. Возвращает фактически
  // долитое HP (0, если игрок уже полон или мёртв).
  healPlayer: (amount: number) => number
  // maxHp игрока — от него считается доза одного импульса хила
  // (C.HEAL_PULSE_FRAC). Плоское
  // значение, а не реф: за забег не меняется (считается из endurance один раз,
  // см. maxHp в Explore.tsx).
  maxHp: number
  // Кадры ауры лечения (Heal_Aura, 14 кадров). РЕФ, а не плоский массив (в
  // отличие от bossFrames в boss.ts): createSkillsSystem вызывается в setup()
  // РАНЬШЕ, чем резолвится loadExploreAssets() — на момент сборки deps кадров
  // ещё нет. Тот же приём, что beastFrames в enemy.ts.
  healAuraFrames: MutableRefObject<Texture[] | null>

  // Нажатия — потребляются ВНУТРИ update() (сброс в false), тем же приёмом,
  // что attackPressedRef/dodgePressedRef в тикере Explore.tsx. Пишутся
  // TouchControls (кнопки skill1/skill2) и клавиатурой (Digit1/Digit2).
  skill1Pressed: MutableRefObject<boolean>
  skill2Pressed: MutableRefObject<boolean>

  // Что висит на кнопке 1/2 — реальные id из App.tsx (player.equippedSkills,
  // приходят с сервера: /auth/login -> character.equippedSkills, максимум 2,
  // см. handleSkillToggle). null в слоте — ЛЕГИТИМНОЕ состояние: игрок волен
  // экипировать 0, 1 или 2 скилла.
  //
  // Тип элемента — string, а НЕ SkillId, хотя SkillId выше теперь покрывает
  // все пять реальных id. Сужение отложено НАМЕРЕННО: сверять входящую строку
  // с SkillId осмысленно только когда реализованы все пять. Сделай это
  // сейчас — и четыре ещё не реализованных скилла пришлось бы сводить к null,
  // то есть показывать "слот пуст" там, где игрок что-то экипировал; это
  // тихий фолбэк, в проекте запрещён (см. CLAUDE.md, Design Decisions).
  // Сузим вместе с реализацией последнего из пяти.
  equipped: [string | null, string | null]
}

// Рантайм-двойник типа SkillId выше (тип в рантайме не существует). Нужен
// ТОЛЬКО для диагностики: строка в слоте, которой здесь нет — рассинхрон
// клиента и сервера, и об этом надо сказать вслух. Это НЕ сужение
// deps.equipped до SkillId (см. комментарий у поля) — id отсюда никуда не
// подставляется, только сверяется.
const KNOWN_SKILL_IDS: readonly string[] = ['heal', 'fireball', 'iceball', 'slash', 'dash']

// Одно активное кровотечение. enemy === null означает, что цель — босс (он в
// забеге один, берётся из deps.boss). maxHp снимается в момент наложения:
// урон тика считается от МАКСИМАЛЬНОГО hp цели, а не от текущего.
// Один летящий снаряд fireball. Форма повторена с шипа босса (BossSpike в
// ../types.ts, движение — updateSpikes в boss.ts), но это ОТДЕЛЬНЫЙ код:
// общего модуля снарядов в проекте нет, и boss.ts этой задачей не трогался.
//
// Чем ОТЛИЧАЮТСЯ два снарядных скилла (fireball/iceball) — и ничем больше.
// Полёт, геометрия, глубина захода (FIREBALL_HIT_OVERLAP), взрыв по площади,
// вспышка, порядок причин смерти — общий код ниже, написанный один раз.
// Числа полёта/отрисовки тоже общие (FIREBALL_* в constants.ts): это
// «снарядные» константы, а не «числа огня» — оба снаряда летят, гаснут и
// рвут по одним и тем же подобранным числам. Разойтись им ничто не мешает:
// достаточно добавить в спеку своё поле.
type ProjectileSpec = {
  id: 'fireball' | 'iceball'
  frames: MutableRefObject<Texture[] | null>
  impactFrames: MutableRefObject<Texture[] | null>
  // Имена файлов — ТОЛЬКО для громких сообщений в консоль, чтобы по тексту
  // было видно, какой лист не загрузился.
  framesName: string
  impactFramesName: string
  damageFrac: number
  cooldownMs: number
  // Эффект попадания сверх урона: стан цели на столько мс. 0 — эффекта нет
  // (fireball); значение читается только когда оно > 0, поэтому ноль здесь
  // означает ИМЕННО "нечего применять", а не "применить ноль".
  stunMs: number
}

type Projectile = {
  // Чей это снаряд — от спеки зависят текстуры, урон, кулдаун и эффект.
  // Живёт В САМОМ снаряде: сменить скилл в полёте нельзя, а взрыв должен
  // считаться по тому, чем стреляли.
  spec: ProjectileSpec
  sprite: AnimatedSprite
  // Направление полёта, снято на выстреле и дальше не меняется: снаряд летит
  // прямо по горизонтали, без гравитации и без самонаведения.
  dir: 1 | -1
  // X ИГРОКА в момент выстрела (центр хитбокса, мировые координаты). Едет
  // вместе со снарядом, потому что нужен он только в момент взрыва — а к
  // тому времени игрок уже мог уйти.
  // Это источник урона для расследования (см. INVESTIGATE_MS и поля
  // investigate* у Enemy/Boss): цель должна идти ТУДА, ОТКУДА СТРЕЛЯЛИ, а не
  // туда, где рвануло. Взрыв случается при касании цели, то есть в ~85px от
  // неё самой — сходив туда, зверь возвращался в патруль, так и не двинувшись
  // в сторону игрока.
  // ⚠️ НЕ путать с координатами взрыва: вспышка и зона поражения по-прежнему
  // считаются от точки столкновения (см. detonateProjectile).
  originX: number
  lifeMs: number
  // Снаряд уже взорвался — тот же флаг и та же роль, что у шипа и волны
  // босса (BossSpike/BossWave в ../types.ts), но смысл шире: один снаряд =
  // РОВНО ОДИН взрыв, то есть одна вспышка и одна раздача урона по площади
  // (см. detonateProjectile). Две причины детонации в одном кадре (цель и
  // стена) взаимоисключающи по построению, флаг закрывает это жёстко, а не
  // порядком проверок.
  hitApplied: boolean
}

type BleedState = {
  enemy: Enemy | null
  maxHp: number
  msLeft: number
  tickMsLeft: number
}

// Создаётся ОДИН раз в setup() (после того как определены worldContainer/
// grid/getPlayerCombatBox), возвращает { update, dispose }. Состояние
// кулдаунов/активных VFX живёт ВНУТРИ этого модуля (закрытыми переменными),
// наружу в Explore.tsx не течёт.
export function createSkillsSystem(deps: SkillsDeps) {
  // Кулдаун — в МИЛЛИСЕКУНДАХ, по образцу dodgeCooldownRef в Explore.tsx
  // (а НЕ potionCdRef, который в секундах): update() получает ticker.deltaMS.
  let healCdMs = 0
  // Активная аура. Одна за раз: кулдаун 5с заметно длиннее самой анимации
  // (~0.6с), так что наложения не бывает — destroyHealAura ниже страхует на
  // случай, если числа поменяют.
  let healAura: AnimatedSprite | null = null
  // Сколько импульсов хила осталось ВЫДАТЬ. Он же счётчик оставшихся проходов
  // анимации ауры — это одно и то же число (см. C.HEAL_PULSE_COUNT), а не два
  // независимых счётчика: каждый проход начинается с импульса.
  let healPulsesLeft = 0
  // Кулдаун slash — тоже в МИЛЛИСЕКУНДАХ (см. healCdMs выше).
  let slashCdMs = 0
  // Кулдаун dash — там же и так же (см. healCdMs выше).
  let dashCdMs = 0
  // Спеки снарядных скиллов. Объявлены ЗДЕСЬ, а не в модульной области, —
  // держат рефы кадров из deps, которые появляются только с системой.
  const FIREBALL_SPEC: ProjectileSpec = {
    id: 'fireball',
    frames: deps.fireballProjectileFrames,
    impactFrames: deps.fireballImpactFrames,
    framesName: 'Fireball_Projectile',
    impactFramesName: 'Fireball_Impact',
    damageFrac: C.FIREBALL_DAMAGE_FRAC,
    cooldownMs: C.FIREBALL_COOLDOWN_MS,
    stunMs: 0, // fireball не станит — весь его вклад это урон
  }
  const ICEBALL_SPEC: ProjectileSpec = {
    id: 'iceball',
    frames: deps.iceballProjectileFrames,
    impactFrames: deps.iceballImpactFrames,
    framesName: 'IceBall_Projectile',
    impactFramesName: 'IceBall_Impact',
    damageFrac: C.ICEBALL_DAMAGE_FRAC,
    cooldownMs: C.ICEBALL_COOLDOWN_MS,
    stunMs: C.ICEBALL_STUN_MS,
  }
  // Кулдауны снарядных скиллов — в МИЛЛИСЕКУНДАХ, как остальные выше, но по
  // ключу скилла: снаряд общий, а кулдаун у каждого свой.
  // ⚠️ Взводятся НЕ на нажатии, как у heal/slash/dash, а на кадре вылета
  // снаряда (см. onCastSpawnFrame): каст, оборванный раньше, кулдаун не
  // тратит.
  const projectileCdMs: Record<ProjectileSpec['id'], number> = { fireball: 0, iceball: 0 }
  // Цели, уже получившие урон от ТЕКУЩЕГО рывка. Живёт ровно один рывок:
  // чистится на старте каждого нового (см. pressSlot). Хранит сами объекты
  // Enemy/Boss, а не индексы — список врагов по ходу забега меняется, и
  // индекс с него съехал бы. Босс попадает сюда тем же объектом, отдельного
  // флага под него не заводим.
  const dashHitTargets = new Set<Enemy | Boss>()
  // Дуга взмаха: разовая, живёт до последнего кадра. facing снимается на
  // старте и дальше не меняется — иначе дуга перевернулась бы посреди взмаха,
  // если игрок нажал другое направление.
  let slashStreak: AnimatedSprite | null = null
  let slashStreakFacing: 1 | -1 = 1
  // Пометка "текущий взмах запущен скиллом slash". Ставится НА НАЖАТИИ,
  // снимается на кадре удара (там же, где засчитывается урон обычной атаки)
  // либо при обрыве замаха. Ровно один взмах = одно срабатывание, по образцу
  // attackHitDoneRef у обычной атаки.
  let slashSwingPending = false
  // Facing, снятый НА НАЖАТИИ. На кадре удара используется ИМЕННО он, а не
  // текущий: иначе и дуга, и прямоугольник поиска цели перевернулись бы,
  // успей игрок нажать другое направление за время замаха.
  let slashSwingFacing: 1 | -1 = 1
  // Кровотечения. Живут НА ЦЕЛИ — по записи на каждую кровоточащую цель, а не
  // один глобальный таймер, как было в Battle.tsx (там враг в бою был один).
  // Список приватен модулю, а НЕ полями в Enemy/Boss: типы сущностей общие с
  // enemy.ts/boss.ts, и поля ради одного скилла пришлось бы инициализировать
  // в каждом spawn.
  const bleeds: BleedState[] = []
  // Активные снаряды ОБОИХ скиллов в одном списке: летят и умирают они
  // одинаково, а чей снаряд — знает его spec. let, а не const: обновляется
  // присваиванием нового массива выживших — тем же приёмом, что bossSpikes
  // в boss.ts.
  let projectiles: Projectile[] = []
  // Гейты "сказать один раз": без них ошибки сыпались бы каждое нажатие.
  let missingFramesLogged = false
  let missingSlashFramesLogged = false
  // Пометка "этот прогон анимации каста должен выпустить снаряд" — И ЧЕЙ
  // ИМЕННО. null = каста снаряда сейчас нет. Ставится НА НАЖАТИИ, снимается
  // на кадре вылета либо при обрыве каста — ровно один каст = ровно один
  // снаряд. Тот же приём, что slashSwingPending выше; одной переменной
  // хватает на оба скилла, потому что второй каст во время первого невозможен
  // (startPlayerCast откажет).
  let pendingCastSpec: ProjectileSpec | null = null
  // Facing, снятый НА НАЖАТИИ: на кадре вылета используется ИМЕННО он, а не
  // текущий — иначе снаряд улетел бы не туда, куда смотрел герой, успей игрок
  // нажать другое направление за время анимации (та же причина, что у
  // slashSwingFacing).
  let pendingCastFacing: 1 | -1 = 1
  // Про какие листы уже кричали в консоль — по имени файла, чтобы сообщение
  // об одном и том же не сыпалось каждый выстрел (тот же смысл, что у
  // булевых пометок heal/slash, только на несколько листов сразу).
  const missingSheetLogged = new Set<string>()
  const unknownIdLogged = new Set<string>()

  // Только визуал: счётчик импульсов НЕ трогает (его ставит castHeal и
  // обнуляет ветка смерти) — иначе destroy() в начале spawnHealAura стирал бы
  // только что выставленное число.
  function destroyHealAura() {
    if (!healAura) return
    deps.worldContainer.removeChild(healAura)
    healAura.destroy()
    healAura = null
  }

  // Один импульс хила. Клэмп по maxHp — внутри healPlayer, и он НА КАЖДЫЙ
  // импульс отдельный: на 95/100 первый импульс долечит до сотни, второй
  // дольёт ноль. Это нормальный исход, не ошибка, сообщать не о чем.
  function applyHealPulse() {
    deps.healPlayer(deps.maxHp * C.HEAL_PULSE_FRAC)
    healPulsesLeft -= 1
  }

  // Аура СЛЕДУЕТ за героем, а не остаётся в точке применения — позиция
  // берётся из phys, того же объекта, что двигает физика игрока в тикере.
  // anchor (0.5, 1.0) + низ хитбокса + HEAL_AURA_OFFSET_* (подобраны вживую):
  // частицы Heal_Aura идут снизу вверх, поэтому низ ауры садится у ног героя,
  // на 25px ниже линии ступней. Зовётся каждый кадр из update() — размер сюда
  // НЕ входит, он постоянный и ставится один раз при спавне.
  function positionHealAura(sprite: AnimatedSprite) {
    sprite.x = deps.phys.x + C.PLAYER_WIDTH / 2 + C.HEAL_AURA_OFFSET_X
    sprite.y = deps.phys.y + C.PLAYER_HEIGHT + C.HEAL_AURA_OFFSET_Y
  }

  function spawnHealAura() {
    const frames = deps.healAuraFrames.current
    if (!frames || frames.length === 0) {
      // Громко (и один раз): хил при этом ВСЁ РАВНО уже применён — аура это
      // косметика, а не механика. Промолчать нельзя: "скилл не показал
      // ничего" выглядит снаружи ровно как "скилл не сработал", и искать
      // причину пришлось бы вслепую.
      if (!missingFramesLogged) {
        missingFramesLogged = true
        console.error('skills: кадры Heal_Aura не загружены — хил сработал, но ауры не будет')
      }
      return
    }
    destroyHealAura()
    const sprite = new AnimatedSprite(frames)
    sprite.anchor.set(0.5, 1)
    // Размер постоянный — ставится здесь один раз, а не каждый кадр в
    // positionHealAura (та отвечает только за то, чтобы аура ехала за героем).
    sprite.width = C.HEAL_AURA_DRAW_W
    sprite.height = C.HEAL_AURA_DRAW_H
    sprite.animationSpeed = C.HEAL_AURA_ANIM_SPEED
    sprite.loop = false // разовая: доиграла — уничтожается (см. update)
    positionHealAura(sprite)
    deps.worldContainer.addChild(sprite)
    sprite.gotoAndPlay(0)
    healAura = sprite
  }

  function destroySlashStreak() {
    if (!slashStreak) return
    deps.worldContainer.removeChild(slashStreak)
    slashStreak.destroy()
    slashStreak = null
  }

  // Дуга едет за героем (позиция пересчитывается каждый кадр) — за ~0.4с
  // анимации игрок успевает уйти на сотню пикселей, и приколотая к месту дуга
  // отвалилась бы от меча.
  function positionSlashStreak(sprite: AnimatedSprite) {
    sprite.x = deps.phys.x + C.PLAYER_WIDTH / 2 + slashStreakFacing * C.SLASH_STREAK_OFFSET_X
    sprite.y = deps.phys.y + C.PLAYER_HEIGHT / 2 + C.SLASH_STREAK_OFFSET_Y
  }

  function spawnSlashStreak() {
    const frames = deps.slashStreakFrames.current
    if (!frames || frames.length === 0) {
      // Громко и один раз. Механику это НЕ отключает — в Battle.tsx было
      // наоборот (`!slashFrames.length` гасил весь скилл), и повторять это
      // здесь нельзя: косметика не гейтит урон.
      if (!missingSlashFramesLogged) {
        missingSlashFramesLogged = true
        console.error('skills: кадры Slash_Streak не загружены — slash сработал, но дуги не будет')
      }
      return
    }
    destroySlashStreak()
    // Зафиксированный на нажатии, НЕ текущий (см. slashSwingFacing).
    slashStreakFacing = slashSwingFacing
    const sprite = new AnimatedSprite(frames)
    sprite.anchor.set(0.5, 0.5)
    sprite.width = C.SLASH_STREAK_DRAW_W
    sprite.height = C.SLASH_STREAK_DRAW_H
    // Зеркало ПОСЛЕ width/height: присваивание width ставит scale.x
    // положительным и стёрло бы флип, сделай мы его раньше.
    if (slashStreakFacing === -1) sprite.scale.x = -Math.abs(sprite.scale.x)
    sprite.animationSpeed = C.SLASH_STREAK_ANIM_SPEED
    sprite.loop = false
    positionSlashStreak(sprite)
    deps.worldContainer.addChild(sprite)
    sprite.gotoAndPlay(0)
    slashStreak = sprite
  }

  // Ближайшая цель СТРОГО в направлении взгляда. Хитбокс — по тому же правилу,
  // что у обычной атаки (прямоугольник перед игроком высотой в его боевой
  // бокс), только шире на SLASH_RANGE_MULT. Из-за односторонности прямоугольника
  // враг за спиной не выберется НИКОГДА, даже если он ближе. Босс — цель
  // наравне с обычными врагами. Проверка по обеим осям, как у обычного удара:
  // иначе slash доставал бы цель этажом выше/ниже.
  function pickSlashTarget(facing: 1 | -1): { enemy: Enemy | null; maxHp: number } | null {
    const box = deps.getPlayerCombatBox()
    const range = C.PLAYER_ATTACK_RANGE * C.SLASH_RANGE_MULT
    // facing — ЗАФИКСИРОВАННЫЙ на нажатии, не текущий: прямоугольник поиска
    // должен смотреть туда же, куда смотрела дуга и сам замах.
    const hx = facing === 1 ? box.x + box.w : box.x - range
    const playerCx = box.x + box.w / 2

    let best: { enemy: Enemy | null; maxHp: number } | null = null
    let bestDist = Infinity

    for (const enemy of deps.enemies.current) {
      if (enemy.dead) continue
      const overlap =
        hx < enemy.x + C.ENEMY_WIDTH &&
        hx + range > enemy.x &&
        box.y < enemy.y + C.ENEMY_HEIGHT &&
        box.y + box.h > enemy.y
      if (!overlap) continue
      const dist = Math.abs(enemy.x + C.ENEMY_WIDTH / 2 - playerCx)
      if (dist < bestDist) {
        bestDist = dist
        best = { enemy, maxHp: enemy.maxHp }
      }
    }

    const boss = deps.boss.current
    if (boss && !boss.dead) {
      const overlap =
        hx < boss.x + C.BOSS_WIDTH &&
        hx + range > boss.x &&
        box.y < boss.y + C.BOSS_HEIGHT &&
        box.y + box.h > boss.y
      if (overlap) {
        const dist = Math.abs(boss.x + C.BOSS_WIDTH / 2 - playerCx)
        if (dist < bestDist) {
          bestDist = dist
          best = { enemy: null, maxHp: boss.maxHp }
        }
      }
    }

    return best
  }

  // НЕ стакается: если цель уже кровоточит — сбрасываем таймер на полную
  // длительность и фазу тика на целую секунду, второй записи не заводим.
  // Так же вело себя присваивание `bleedingRef.current = 5` в Battle.tsx
  // (присваивание, а не +=).
  function applyBleed(target: { enemy: Enemy | null; maxHp: number }) {
    const existing = bleeds.find((b) => b.enemy === target.enemy)
    if (existing) {
      existing.msLeft = C.BLEED_DURATION_MS
      existing.tickMsLeft = C.BLEED_TICK_MS
      existing.maxHp = target.maxHp
      return
    }
    bleeds.push({
      enemy: target.enemy,
      maxHp: target.maxHp,
      msLeft: C.BLEED_DURATION_MS,
      tickMsLeft: C.BLEED_TICK_MS,
    })
  }

  // ⚠️ ВИЗУАЛА У КРОВОТЕЧЕНИЯ НЕТ — намеренно. Петля Bleeding_Loop была
  // подключена и снята: капли на цели не читались. Механика ниже работает
  // полностью (тики 3% макс. hp раз в секунду, 5 секунд, без стака), но
  // ИГРОК СЕЙЧАС НИКАК НЕ ВИДИТ, что цель кровоточит и что урон идёт: ни
  // спрайта, ни цифр, ни подсветки — только медленно убывающая полоса HP.
  // Показ нужно чем-то заменить (другой VFX, тинт цели, всплывающие числа
  // урона) — задача открыта. Сам файл Bleeding_Loop.png на диске оставлен.
  function updateBleeds(dt: number) {
    for (let i = bleeds.length - 1; i >= 0; i--) {
      const bleed = bleeds[i]
      const boss = deps.boss.current
      const targetDead = bleed.enemy ? bleed.enemy.dead : !boss || boss.dead
      // Цель умерла ИЛИ время вышло — кровотечение прекращается.
      // Порядок проверок как в Battle.tsx: время проверяется ДО декремента,
      // поэтому кадр, на котором остаток обнуляется, ещё может дать свой тик.
      if (targetDead || bleed.msLeft <= 0) {
        bleeds.splice(i, 1)
        continue
      }
      bleed.msLeft = Math.max(0, bleed.msLeft - dt)
      bleed.tickMsLeft -= dt
      if (bleed.tickMsLeft <= 0) {
        bleed.tickMsLeft = C.BLEED_TICK_MS
        // Урон — ТОЛЬКО через вынесенные damageEnemy/damageBoss, общую точку с
        // обычной атакой: клэмп, смерть, HP-бар и анимация трупа уже там,
        // здесь не дублируются. Аккумулятор — skillDamageDealt (растит
        // ловкость), а не attack-счётчик (растит силу).
        // Встряски (applyEnemyHitReaction/applyBossHitReaction) здесь
        // НАМЕРЕННО нет, хотя скиллам она доступна и разовые попадания
        // fireball/dash её зовут: тик идёт раз в секунду пять секунд подряд и
        // держал бы цель в стан-локе весь этот срок.
        const dmg = Math.floor(bleed.maxHp * C.BLEED_FRAC_PER_TICK)
        // Источник расследования — игрок НА МОМЕНТ ТИКА (не на момент
        // наложения): кровотечение тикает 5 секунд, за это время игрок
        // успевает уйти, и вести врага к месту, где его давно нет, незачем.
        const bleedSourceX = deps.phys.x + C.PLAYER_WIDTH / 2
        const died = bleed.enemy
          ? deps.damageEnemy(bleed.enemy, dmg, deps.skillDamageDealt, bleedSourceX)
          : deps.damageBoss(dmg, deps.skillDamageDealt, bleedSourceX)
        if (died) {
          bleeds.splice(i, 1)
          continue
        }
      }
    }
  }

  // Вспышка на месте смерти снаряда — разовая анимация, снимает себя сама
  // через onComplete (тот же приём, что у импакта шипа босса; heal/slash
  // вместо этого снимаются проверкой в update — в файле сосуществуют оба).
  function spawnProjectileImpact(spec: ProjectileSpec, worldX: number, worldY: number) {
    const frames = spec.impactFrames.current
    if (!frames || frames.length === 0) {
      // Громко и один раз на лист. Снаряд при этом ВСЁ РАВНО уже умер —
      // вспышка это косметика поверх смерти, а не сама смерть.
      if (!missingSheetLogged.has(spec.impactFramesName)) {
        missingSheetLogged.add(spec.impactFramesName)
        console.error('skills: кадры ' + spec.impactFramesName + ' не загружены — снаряд погас, но вспышки не будет')
      }
      return
    }
    const impact = new AnimatedSprite(frames)
    impact.anchor.set(0.5, 0.5)
    impact.loop = false
    impact.animationSpeed = C.FIREBALL_IMPACT_ANIM_SPEED
    // Задаётся высота, ширина считается из пропорции клетки — тот же приём,
    // что у импакта шипа босса: подбирать надо одно число, картинка не
    // растягивается.
    const drawH = C.FIREBALL_IMPACT_DRAW_H
    impact.height = drawH
    impact.width = drawH * (C.FIREBALL_IMPACT_CELL_W / C.FIREBALL_IMPACT_CELL_H)
    impact.x = worldX
    impact.y = worldY
    impact.onComplete = () => {
      deps.worldContainer.removeChild(impact)
      impact.destroy()
    }
    deps.worldContainer.addChild(impact)
    impact.play()
  }

  // Рождение снаряда. Зовётся НЕ на нажатии, а на кадре вылета анимации
  // каста (см. onCastSpawnFrame ниже) — он же взводит кулдаун.
  function spawnProjectile(spec: ProjectileSpec, dir: 1 | -1) {
    const frames = spec.frames.current
    if (!frames || frames.length === 0) {
      // Здесь спрайт И ЕСТЬ снаряд (в отличие от ауры heal и дуги slash, где
      // косметика механику не гейтит): рисовать нечего — значит и лететь
      // нечему. Молча не выходим, причина уходит в консоль один раз.
      if (!missingSheetLogged.has(spec.framesName)) {
        missingSheetLogged.add(spec.framesName)
        console.error('skills: кадры ' + spec.framesName + ' не загружены — снаряда не будет')
      }
      return
    }
    // dir приходит аргументом (снят на нажатии, см. pendingCastFacing) и
    // дальше живёт в снаряде: развернись герой в полёте, снаряд не должен
    // разворачиваться вместе с ним.
    const sprite = new AnimatedSprite(frames)
    sprite.anchor.set(0.5, 0.5)
    const drawH = C.FIREBALL_DRAW_H
    sprite.height = drawH
    sprite.width = drawH * (C.FIREBALL_PROJECTILE_CELL_W / C.FIREBALL_PROJECTILE_CELL_H)
    // ⚠️ Считаем, что на листе пламя смотрит ВПРАВО — при полёте влево спрайт
    // зеркалим. Проверялось только сборкой, не глазами: если на арте наоборот,
    // инвертируется этот один if. Зеркало ПОСЛЕ width: присваивание width
    // ставит scale.x положительным и стёрло бы флип, сделай мы его раньше
    // (та же грабля, что у дуги slash).
    if (dir === -1) sprite.scale.x = -Math.abs(sprite.scale.x)
    sprite.animationSpeed = C.FIREBALL_ANIM_SPEED
    sprite.loop = true // снаряд горит всю дорогу, в отличие от разовой вспышки
    // Точка вылета — от ЦЕНТРА хитбокса героя, тем же способом, что позиция
    // дуги slash. X зеркалится по направлению выстрела, Y нет.
    const offX = C.FIREBALL_OFFSET_X
    const offY = C.FIREBALL_OFFSET_Y
    sprite.x = deps.phys.x + C.PLAYER_WIDTH / 2 + dir * offX
    sprite.y = deps.phys.y + C.PLAYER_HEIGHT / 2 + offY
    deps.worldContainer.addChild(sprite)
    sprite.gotoAndPlay(0)
    // originX снимается ЗДЕСЬ, при рождении снаряда (кадр вылета анимации
    // каста), а не при нажатии кнопки: это и есть позиция игрока на момент
    // выстрела. Двигаться между нажатием и вылетом герой всё равно не может —
    // каст блокирует горизонталь (см. heroLocked в Explore.tsx), — так что
    // значение то же, но снятое в честной точке.
    projectiles.push({ spec, sprite, dir, lifeMs: 0, hitApplied: false, originX: deps.phys.x + C.PLAYER_WIDTH / 2 })
  }

  // Прямоугольники цели — одной функцией на оба типа: и враг, и босс заданы
  // левым верхним углом плюс константами габаритов, разница только в паре
  // констант. Возвращается {x,y,w,h} той же формы, что даёт
  // getPlayerCombatBox — чтобы обе проверки ниже читались одинаково.
  function enemyBox(enemy: Enemy) {
    return { x: enemy.x, y: enemy.y, w: C.ENEMY_WIDTH, h: C.ENEMY_HEIGHT }
  }
  function bossBox(boss: Boss) {
    return { x: boss.x, y: boss.y, w: C.BOSS_WIDTH, h: C.BOSS_HEIGHT }
  }

  // Глубина взаимного перекрытия двух AABB по каждой оси. Отрицательное
  // значение = не пересекаются (расстояние между ними), ноль = касаются
  // ровно кромкой. Считается ОДИН раз и используется двумя способами: порог
  // детонации сравнивает с C.FIREBALL_HIT_OVERLAP, зона взрыва — с нулём.
  function overlapDepth(
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number },
  ): { x: number; y: number } {
    return {
      x: Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x),
      y: Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y),
    }
  }

  // Бокс снаряда — ЕГО СПРАЙТ: прямоугольник от anchor (0.5, 0.5), то есть
  // половина ширины/высоты в каждую сторону. width/height берутся у спрайта,
  // а не считаются из констант, потому что высоту отрисовки на подборе даёт
  // тюнер — бокс обязан совпадать с тем, что игрок видит на экране. У
  // зеркального (dir === -1) снаряда scale.x отрицательный, но Pixi v8
  // возвращает из width уже модуль (Container.width = Math.abs(...)), так
  // что ширина здесь положительная и без своего Math.abs.
  function projectileBox(fb: Projectile) {
    const w = fb.sprite.width
    const h = fb.sprite.height
    return { x: fb.sprite.x - w / 2, y: fb.sprite.y - h / 2, w, h }
  }

  // Достаточно ли глубоко снаряд вошёл в цель, чтобы взорваться. Урона здесь
  // НЕТ — только решение "детонировать": бьёт потом взрыв по площади (см.
  // detonateProjectile), и бьёт он всех, а не ту цель, что первой поймала
  // снаряд. Поэтому цикл может обрываться на первом же совпадении.
  //
  // Порог по ОБЕИМ осям (C.FIREBALL_HIT_OVERLAP): касание углом боксов не
  // считается — снаряд гас, визуально не долетев. Босс — цель наравне с
  // обычными врагами.
  function shouldDetonate(fb: Projectile): boolean {
    const need = C.FIREBALL_HIT_OVERLAP
    const box = projectileBox(fb)

    for (const enemy of deps.enemies.current) {
      if (enemy.dead) continue
      const d = overlapDepth(box, enemyBox(enemy))
      if (d.x >= need && d.y >= need) return true
    }

    const boss = deps.boss.current
    if (!boss || boss.dead) return false
    const d = overlapDepth(box, bossBox(boss))
    return d.x >= need && d.y >= need
  }

  // Урон по площади. Зона — прямоугольник вокруг точки смерти снаряда, из ТЕХ
  // ЖЕ чисел, что и спрайт вспышки (высота × пропорция клетки импакта, центр
  // в точке попадания), домноженный на C.FIREBALL_BLAST_SCALE — он и разводит
  // зону поражения с картинкой, не трогая визуал.
  //
  // Высота берётся из того же источника, что у спрайта вспышки (тюнер, пока
  // панель жива, иначе константа): двигая IMPACT_H на подборе, игрок двигает
  // и картинку, и зону — они по замыслу одно и то же, а расходятся только
  // через BLAST_SCALE.
  //
  // Порог глубины (C.FIREBALL_HIT_OVERLAP) здесь НЕ применяется: он решает,
  // где снаряд взорвётся, а не кого накроет взрыв — накрывает любое
  // пересечение зоны с боксом цели, хоть углом.
  // worldX/worldY — ЦЕНТР ВЗРЫВА (от него строится зона поражения), sourceX —
  // X ИСТОЧНИКА урона для расследования цели (позиция стрелка, fb.originX).
  // Это РАЗНЫЕ точки, и путать их нельзя: зона бьёт там, где рвануло, а идти
  // цель должна туда, откуда прилетело.
  function applyBlast(spec: ProjectileSpec, worldX: number, worldY: number, sourceX: number) {
    const drawH = C.FIREBALL_IMPACT_DRAW_H
    const scale = C.FIREBALL_BLAST_SCALE
    // Стан — эффект попадания ИМЕННО этого скилла: у fireball stunMs === 0,
    // и всё, что ниже про стан, для него не выполняется.
    const stunMs = spec.stunMs
    const h = drawH * scale
    const w = h * (C.FIREBALL_IMPACT_CELL_W / C.FIREBALL_IMPACT_CELL_H)
    const blast = { x: worldX - w / 2, y: worldY - h / 2, w, h }

    // Каждая цель — ровно один раз за взрыв: список врагов проходится один
    // раз и хранит РАЗНЫЕ объекты, босс лежит отдельно от него (deps.boss) и
    // в enemies не дублируется. Отдельного Set, как у рывка, здесь не нужно:
    // рывок живёт полсекунды и бьёт каждый кадр, взрыв — одно мгновение.
    for (const enemy of deps.enemies.current) {
      if (enemy.dead) continue
      const d = overlapDepth(blast, enemyBox(enemy))
      if (d.x <= 0 || d.y <= 0) continue
      // Урон — тем же способом, что у рывка и тика кровотечения: доля
      // МАКСИМАЛЬНОГО hp цели, Math.floor, через общие с обычной атакой
      // damageEnemy/damageBoss. Аккумулятор — skillDamageDealt (растит
      // ловкость), а не attack-счётчик (растит силу).
      // Смерть цели тут НЕ обрабатывается намеренно: damageEnemy делает всё
      // сама (флаг dead, HP-бар, анимация трупа, закрытие события) — своей
      // ветки на смерть от снаряда нет, как у рывка и кровотечения. Возврат
      // нужен ровно для одного: не трясти труп (см. ниже).
      // Источник расследования — sourceX, то есть ПОЗИЦИЯ СТРЕЛКА на момент
      // выстрела (fb.originX), а НЕ worldX точки взрыва. Раньше сюда шёл
      // worldX, и это было ошибкой: взрыв случается при касании цели, в ~85px
      // от неё, так что зверь доходил до места взрыва за ~0.75с, вставал и
      // возвращался в патруль, ни на шаг не приблизившись к игроку.
      const died = deps.damageEnemy(enemy, Math.floor(enemy.maxHp * spec.damageFrac), deps.skillDamageDealt, sourceX)
      // Встряска — как от удара мечом (см. applyEnemyHitReaction в
      // Explore.tsx). Взрыв разовый, поэтому стан-лока он не даёт: каждая
      // цель проходит этот цикл один раз за взрыв.
      if (!died) deps.applyEnemyHitReaction(enemy)
      // Стан iceball (см. ICEBALL_STUN_MS) — ТОЛЬКО выставляем поле; сама
      // заморозка (пропуск AI/движения/кадров) живёт в обновлении сущности,
      // см. stunTimer в entities/enemy.ts. Не на трупе: у мёртвого врага
      // замирать нечему, а death-анимацию стан бы заморозил.
      if (!died && stunMs > 0) enemy.stunTimer = stunMs
    }

    const boss = deps.boss.current
    if (!boss || boss.dead) return
    const d = overlapDepth(blast, bossBox(boss))
    if (d.x <= 0 || d.y <= 0) return
    const bossDied = deps.damageBoss(Math.floor(boss.maxHp * spec.damageFrac), deps.skillDamageDealt, sourceX)
    if (!bossDied) deps.applyBossHitReaction(boss)
    // Босс станится наравне с обычным врагом (см. stunTimer в boss.ts).
    if (!bossDied && stunMs > 0) boss.stunTimer = stunMs
  }

  // Смерть снаряда С ПОСЛЕДСТВИЯМИ — одна точка на обе причины (цель и
  // стена): вспышка в точке смерти, затем урон по площади. Порядок именно
  // такой, как задуман сам эффект: сначала взрыв виден, потом он бьёт.
  // Снаряд, доживший до потолка времени жизни, сюда НЕ приходит — он гаснет
  // без вспышки и без урона (см. updateProjectiles).
  function detonateProjectile(fb: Projectile) {
    // Один снаряд — один взрыв. Ветки "цель" и "геометрия" в одном кадре
    // взаимоисключающи (первая же ставит remove), но флаг закрывает это
    // жёстко, а не порядком проверок.
    if (fb.hitApplied) return
    fb.hitApplied = true
    spawnProjectileImpact(fb.spec, fb.sprite.x, fb.sprite.y)
    applyBlast(fb.spec, fb.sprite.x, fb.sprite.y, fb.originX)
  }

  // Шаг снарядов. dt — МИЛЛИСЕКУНДЫ (см. update ниже), поэтому здесь своя
  // dtSec: скорость задана в px/СЕКУНДУ, как у шипа босса, а не в px/кадр,
  // как MOVE_SPEED игрока. Гравитации нет — чистая горизонталь.
  function updateProjectiles(dt: number) {
    if (projectiles.length === 0) return
    const dtSec = dt / 1000
    const stillFlying: Projectile[] = []
    for (const fb of projectiles) {
      fb.sprite.x += fb.dir * C.FIREBALL_SPEED * dtSec
      fb.lifeMs += dt

      // Порядок причин смерти снаряда: ЦЕЛЬ → ГЕОМЕТРИЯ → потолок времени
      // жизни. Он важен на кадре, где совпали две причины сразу: снаряд,
      // догнавший врага вплотную у стены, обязан взорваться, а не погаснуть
      // о кладку; долетевший до потолка времени в момент попадания — тоже.
      //
      // Первые две причины ведут в ОДНУ точку — detonateProjectile (вспышка +
      // урон по площади). Разница между ними только в том, что именно
      // остановило снаряд; на последствия она не влияет: взрыв о стену бьёт
      // ровно так же, и цель, прижатая к этой стене, урон получает.
      let remove = false

      // 1) Цель — с порогом глубины захода (см. fireballShouldDetonate):
      // касание углом боксов взрыв не запускает.
      if (shouldDetonate(fb)) {
        remove = true
        detonateProjectile(fb)
      }

      // 2) Геометрия — ТЕМИ ЖЕ двумя функциями, что у шипа босса, и приходят они
      // готовыми в deps (isSolid — твердь '#' и края карты,
      // isPlatformBandBlocking — верхняя полоса '='). Своего пути к сетке
      // модуль не заводит.
      // ⚠️ Проверка ТОЧЕЧНАЯ — одна точка, центр спрайта, свипа между кадрами
      // нет (как и у шипа). Отсюда потолок скорости, см. FIREBALL_SPEED в
      // constants.ts и верхнюю границу ползунка в тюнере.
      if (!remove) {
        const hitGeometry =
          deps.isSolid(deps.grid, deps.tileSize, fb.sprite.x, fb.sprite.y) ||
          deps.isPlatformBandBlocking(deps.grid, deps.tileSize, fb.sprite.x, fb.sprite.y, fb.sprite.y + 1) !== null
        if (hitGeometry) {
          remove = true
          detonateProjectile(fb)
        }
      }

      // 3) Потолок времени жизни — ПОСЛЕДНЯЯ причина, и ЕДИНСТВЕННАЯ, что
      // убивает снаряд без вспышки и без урона (как шип босса): взрыв
      // означает "во что-то попал", а истёкший снаряд не попал ни во что.
      if (!remove && fb.lifeMs >= C.FIREBALL_LIFETIME_MS) remove = true

      if (remove) {
        deps.worldContainer.removeChild(fb.sprite)
        fb.sprite.destroy()
      } else {
        stillFlying.push(fb)
      }
    }
    projectiles = stillFlying
  }

  // Урон рывка. Проверяется КАЖДЫЙ кадр, пока рывок идёт, а не один раз на
  // старте: за ~0.5с герой проезжает 4 тайла и задевает цели, которых в
  // момент нажатия рядом не было.
  //
  // Хитбокс игрока — тот же getPlayerCombatBox, что у slash, и та же
  // проверка пересечения по ОБЕИМ осям: иначе рывок доставал бы цель этажом
  // выше/ниже. Направления здесь нет намеренно (в отличие от
  // pickSlashTarget): рывок бьёт всех, сквозь кого прошёл, а едет он всегда
  // вперёд по facing.
  function applyDashHits() {
    const box = deps.getPlayerCombatBox()

    for (const enemy of deps.enemies.current) {
      // Уже задет ЭТИМ рывком — второй раз урон не идёт. Мёртвый пропускается
      // здесь же, поэтому убитый рывком враг на следующем кадре отсеется сам.
      if (enemy.dead || dashHitTargets.has(enemy)) continue
      const overlap =
        box.x < enemy.x + C.ENEMY_WIDTH &&
        box.x + box.w > enemy.x &&
        box.y < enemy.y + C.ENEMY_HEIGHT &&
        box.y + box.h > enemy.y
      if (!overlap) continue
      dashHitTargets.add(enemy)
      // Урон — тем же способом, что тик кровотечения выше: доля МАКСИМАЛЬНОГО
      // hp цели, Math.floor. Аккумулятор — skillDamageDealt (растит ловкость),
      // а не attack-счётчик (растит силу).
      // Смерть цели тут НЕ обрабатывается намеренно: damageEnemy делает всё
      // сама (флаг dead, HP-бар, анимация трупа, закрытие события) — своей
      // ветки на смерть от рывка нет, как и у кровотечения. Возврат нужен
      // ровно для одного: не трясти труп (см. ниже).
      // Источник — сам игрок: рывок это контактный удар телом.
      const died = deps.damageEnemy(enemy, Math.floor(enemy.maxHp * C.DASH_DAMAGE_FRAC), deps.skillDamageDealt, deps.phys.x + C.PLAYER_WIDTH / 2)
      // Встряска — как от удара мечом (см. applyEnemyHitReaction в
      // Explore.tsx). Ровно один раз за рывок на цель: дедуп тот же
      // dashHitTargets, что и у урона — цель добавлена в набор строкой выше.
      if (!died) deps.applyEnemyHitReaction(enemy)
    }

    const boss = deps.boss.current
    if (!boss || boss.dead || dashHitTargets.has(boss)) return
    const bossOverlap =
      box.x < boss.x + C.BOSS_WIDTH &&
      box.x + box.w > boss.x &&
      box.y < boss.y + C.BOSS_HEIGHT &&
      box.y + box.h > boss.y
    if (!bossOverlap) return
    dashHitTargets.add(boss)
    const bossDied = deps.damageBoss(Math.floor(boss.maxHp * C.DASH_DAMAGE_FRAC), deps.skillDamageDealt, deps.phys.x + C.PLAYER_WIDTH / 2)
    if (!bossDied) deps.applyBossHitReaction(boss)
  }

  // Прямого урона у самого slash НЕТ — весь урон СКИЛЛА идёт кровотечением
  // (как и в Battle.tsx). НО: здесь slash запускает ТУ ЖЕ анимацию, что
  // обычная атака, а значит на её strike-кадре сработает applyAttackHit() и
  // герой нанесёт ОБЫЧНЫЙ урон мечом. То есть slash в Explore = обычный удар
  // ПЛЮС кровотечение. Это НАМЕРЕННОЕ отличие от старого потока (решено с
  // пользователем), а не побочный эффект.
  function castSlash() {
    // Замах должен начаться первым: не начался (атака на кулдауне/идёт,
    // герой мёртв/в хитстане/пьёт) — кулдаун slash НЕ тратим.
    if (!deps.startPlayerAttack()) return
    // Кулдаун обычной атаки уже взведён ВНУТРИ startPlayerAttack — иначе
    // slash дал бы бесплатный удар в обход ATTACK_COOLDOWN.
    slashCdMs = C.SLASH_COOLDOWN_MS
    // ВСЁ. Дуга, выбор цели и кровотечение — не здесь, а на кадре удара
    // (см. onAttackStrike): по нажатию герой только начинает замах, и
    // показывать эффект в этот момент значило бы рисовать удар до удара.
    slashSwingPending = true
    slashSwingFacing = deps.facing.current
  }

  // Зовётся из Explore.tsx РОВНО в той точке, где вызывается applyAttackHit()
  // — на кадре ATTACK_STRIKE_FRAME анимации атаки, под тем же дедупом
  // (attackHitDoneRef), поэтому за один взмах приходит ровно один раз.
  // Обычный взмах сюда тоже попадает — на нём slashSwingPending false и
  // функция ничего не делает.
  //
  // Цель выбирается ЗДЕСЬ, а не на нажатии: за время замаха враг успевает
  // сдвинуться, и брать его положение на момент удара честнее.
  function onAttackStrike() {
    if (!slashSwingPending) return
    slashSwingPending = false
    spawnSlashStreak()
    // Цели может не быть — тогда просто взмах без кровотечения. "Нет цели" НЕ
    // входит в гейт нажатия: скилл сработал, кулдаун потрачен.
    const target = pickSlashTarget(slashSwingFacing)
    if (target) applyBleed(target)
  }

  // Зовётся из Explore.tsx РОВНО в той точке, где анимация каста дошла до
  // CAST_SPAWN_FRAME, под дедупом castSpawnDoneRef — поэтому за один каст
  // приходит ровно один раз. Тот же приём, что onAttackStrike выше.
  function onCastSpawnFrame() {
    if (!pendingCastSpec) return
    const spec = pendingCastSpec
    pendingCastSpec = null
    // Кулдаун — ИМЕННО ЗДЕСЬ, а не на нажатии (в отличие от heal/slash/dash):
    // выстрел состоялся ровно в этот момент. Каст, оборванный раньше кадра
    // вылета (прыжок, хитстан, смерть), снимает пометку в update() и сюда не
    // доходит — 5 секунд за него не списываются.
    // Если кадров снаряда нет, spawnProjectile кричит в консоль и не рождает
    // ничего, но кулдаун всё равно потрачен: анимация каста доиграла до
    // кадра вылета, и повторным нажатием эту дыру не заспамить. Случай
    // мёртвый — лист сверяется assertSheetSize на загрузке (см. assets.ts).
    projectileCdMs[spec.id] = spec.cooldownMs
    spawnProjectile(spec, pendingCastFacing)
  }

  // Хил идёт ИМПУЛЬСАМИ — по одному в начале каждого прохода анимации ауры.
  // Первый выдаётся здесь же (начало первого прохода), остальные — из update()
  // на перезапуске анимации. Цепочку анимаций ГЕРОЯ скилл по-прежнему не
  // трогает: аура это оверлей, своей позы у heal нет.
  function castHeal() {
    // Кулдаун стартует РОВНО ОДИН раз, на нажатии — не на каждом импульсе.
    // Независимо от того, сколько реально долилось: жать heal на полном HP —
    // решение игрока, а не осечка скилла.
    healCdMs = C.HEAL_COOLDOWN_MS
    // Спавн ПЕРЕД выставлением счётчика: внутри он зовёт destroyHealAura()
    // для предыдущей ауры, и порядок наоборот стёр бы свежее число.
    spawnHealAura()
    healPulsesLeft = C.HEAL_PULSE_COUNT
    applyHealPulse() // импульс в начале первого прохода
    if (!healAura) {
      // Кадров нет (см. spawnHealAura) — гнать импульсы нечему, аура не
      // появится. Досыпаем остаток сразу: косметика не должна решать, сколько
      // игрок вылечит.
      while (healPulsesLeft > 0) applyHealPulse()
    }
  }

  // Нажатие слота 0/1. Скилл срабатывает, только если лежит ИМЕННО в этом
  // слоте — кнопка привязана к слоту, а не к скиллу.
  function pressSlot(slot: 0 | 1) {
    const id = deps.equipped[slot]
    // Пустой слот — ЛЕГИТИМНОЕ состояние (игрок волен экипировать 0/1/2):
    // молча ничего не делаем и НЕ жжём кулдаун. Видно это на самой кнопке —
    // она приглушена (см. updateSkillButtons в Explore.tsx).
    if (id === null) return
    if (!KNOWN_SKILL_IDS.includes(id)) {
      if (!unknownIdLogged.has(id)) {
        unknownIdLogged.add(id)
        console.error('skills: в слоте ' + (slot + 1) + ' неизвестный скилл ' + JSON.stringify(id) + ' — рассинхрон с сервером?')
      }
      return
    }
    // Кулдаун везде проверяется тихо: нормальное состояние игры, не ошибка.
    if (id === 'heal') {
      if (healCdMs > 0) return
      castHeal()
      return
    }
    if (id === 'slash') {
      if (slashCdMs > 0) return
      // Гейт по обычной атаке (её кулдаун / уже идущий замах) — ВНУТРИ
      // castSlash: он спрашивает startPlayerAttack и при отказе не тратит
      // кулдаун slash.
      castSlash()
      return
    }
    if (id === 'dash') {
      if (dashCdMs > 0) return
      // Кулдаун тратится ТОЛЬКО на реально начавшийся рывок — тот же приём,
      // что у castSlash выше (там кулдаун не жжётся, если замах не начался).
      // Отказ startPlayerDash — это герой мёртв/в хитстане/пьёт, он в
      // воздухе, либо рывок или замах уже идут; ни один из этих случаев не
      // должен съедать 5 секунд.
      if (deps.startPlayerDash()) {
        dashCdMs = C.DASH_COOLDOWN_MS
        // Новый рывок — новый список задетых: каждая цель снова может
        // получить урон ровно один раз. Чистим ИМЕННО на старте, а не по
        // окончании рывка: так набор не зависит от того, чем рывок кончился
        // (доигранной анимацией, прыжком, хитстаном или смертью).
        dashHitTargets.clear()
      }
      return
    }
    // Оба снарядных скилла — ОДНА ветка: отличает их только спека (текстуры,
    // урон, кулдаун, эффект попадания), путь нажатия у них общий.
    if (id === 'fireball' || id === 'iceball') {
      const spec = id === 'fireball' ? FIREBALL_SPEC : ICEBALL_SPEC
      if (projectileCdMs[spec.id] > 0) return
      // Анимация каста должна начаться первой: не началась (герой мёртв/в
      // хитстане/пьёт, каст/замах/рывок уже идут) — снаряда не будет вообще,
      // и повторное нажатие во время каста сюда же и упирается.
      if (!deps.startPlayerCast()) return
      // ВСЁ. Сам снаряд — не здесь, а на кадре вылета (onCastSpawnFrame):
      // рождать его по нажатию значило бы выпускать огонь из опущенной руки.
      pendingCastSpec = spec
      pendingCastFacing = deps.facing.current
      return
    }
  }

  // dt — МИЛЛИСЕКУНДЫ (ticker.deltaMS), тот же выбор единиц, что уже
  // используют bossSpikesRef/bossWavesRef/rewardFloatsRef в Explore.tsx
  // (lifeMs/elapsed копятся в мс, а не в frame-scale ticker.deltaTime,
  // которым масштабируется движение phys).
  function update(dt: number) {
    // Кулдауны тикают ВСЕГДА, независимо от нажатий.
    healCdMs = Math.max(0, healCdMs - dt)
    slashCdMs = Math.max(0, slashCdMs - dt)
    dashCdMs = Math.max(0, dashCdMs - dt)
    projectileCdMs.fireball = Math.max(0, projectileCdMs.fireball - dt)
    projectileCdMs.iceball = Math.max(0, projectileCdMs.iceball - dt)

    // Замах закончился или был прерван (хитстан, прыжок, смерть), а кадра
    // удара так и не случилось — снимаем пометку, иначе она сработала бы на
    // следующей ОБЫЧНОЙ атаке. Проверка ДО обработки нажатий: свежую пометку,
    // поставленную в этом же кадре, она не трогает (attacking уже true).
    //
    // Кулдаун при этом остаётся потраченным, а дуги и кровотечения не будет
    // вообще — то же самое, что происходит с обычной атакой, прерванной до
    // кадра удара, и то же, о чём договорились про промах по цели.
    if (slashSwingPending && !deps.attacking.current) slashSwingPending = false

    // То же самое для каста: анимацию оборвали (прыжок, хитстан, смерть) ДО
    // кадра вылета — снаряда не будет вообще, пометка снимается, чтобы она не
    // сработала на следующем касте. Проверка ДО обработки нажатий: свежую
    // пометку, поставленную в этом же кадре, она не трогает (casting уже true).
    if (pendingCastSpec && !deps.casting.current) pendingCastSpec = null

    if (deps.skill1Pressed.current) pressSlot(0)
    if (deps.skill2Pressed.current) pressSlot(1)
    // Гасим БЕЗУСЛОВНО — в том числе когда слот пуст или идёт кулдаун. Иначе
    // флаг "залипнет" и нажатие сработает само через несколько секунд
    // (TouchControls/клавиатура пишут в него true независимо от того, слушает
    // ли кто-то эти рефы).
    deps.skill1Pressed.current = false
    deps.skill2Pressed.current = false

    // Снаряды fireball: шаг, проверка геометрии, смерть со вспышкой. Стоит
    // ПОСЛЕ обработки нажатий — снаряд, выпущенный в этом же кадре, сразу
    // получает свой первый шаг и hit-тест, не на следующем (тот же порядок,
    // что у босса: AI, породивший шип, и updateSpikes идут в одном кадре).
    updateProjectiles(dt)

    // Урон рывка — каждый кадр, пока рывок идёт. Стоит ПОСЛЕ обработки
    // нажатий: рывок, начатый в этом же кадре, уже считается с первого кадра
    // (герой мог стартовать вплотную к врагу). Владелец состояния рывка —
    // Explore.tsx, отсюда чтение через deps.dashing.
    if (deps.dashing.current) applyDashHits()

    // Дуга взмаха: тянется за героем и живёт до последнего кадра (разовая).
    if (slashStreak) {
      positionSlashStreak(slashStreak)
      if (slashStreak.currentFrame >= slashStreak.textures.length - 1 || !slashStreak.playing) {
        destroySlashStreak()
      }
    }

    // Кровотечения: тики урона, позиция капель, снятие по смерти/времени.
    updateBleeds(dt)

    // Аура: тянется за героем и живёт до последнего кадра. Тот же способ
    // определить конец разовой анимации, что у героя/зверя в Explore.tsx
    // (последний кадр ЛИБО спрайт сам остановился).
    if (healAura) {
      // Смерть между импульсами — остаток НЕ применяем, ауру снимаем сразу.
      if (deps.dead.current) {
        healPulsesLeft = 0
        destroyHealAura()
      } else {
        positionHealAura(healAura)
        // Конец прохода — тот же способ определить его, что у героя/зверя в
        // Explore.tsx (последний кадр ЛИБО спрайт сам остановился).
        if (healAura.currentFrame >= healAura.textures.length - 1 || !healAura.playing) {
          if (healPulsesLeft > 0) {
            // Ещё один проход, и он начинается с импульса. Кадры 0 и 13 листа
            // пустые, поэтому перезапуск с нулевого идёт без скачка.
            applyHealPulse()
            healAura.gotoAndPlay(0)
          } else {
            destroyHealAura()
          }
        }
      }
    }
  }

  function dispose() {
    // Узлы, которые эта система добавляет в worldContainer; Explore.tsx о них
    // не знает, поэтому чистим здесь.
    destroyHealAura()
    destroySlashStreak()
    // Снаряды в полёте — узлы, добавленные этой системой в worldContainer.
    // Вспышки импакта здесь не трогаем: они снимают себя сами по onComplete,
    // а недоигравшие умрут вместе с деревом (app.destroy в Explore.tsx).
    for (const fb of projectiles) {
      deps.worldContainer.removeChild(fb.sprite)
      fb.sprite.destroy()
    }
    projectiles = []
    bleeds.length = 0
    // Ссылки на Enemy/Boss — чтобы размонтированная сцена не держала их
    // живыми (сам набор чистится на старте каждого рывка, см. pressSlot).
    dashHitTargets.clear()
  }

  return { update, dispose, onAttackStrike, onCastSpawnFrame }
}
