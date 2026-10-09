import { Assets, Rectangle, Texture } from 'pixi.js'
import * as C from './constants'
import type { BossAnimKind, RewardKind } from './types'
import { loadSheetFrames } from './spriteLoader'

// ЗАГРУЗКА ЛИСТОВ ЗАБЕГА — ДВА ПРАВИЛА (09.10.2026).
//
// 1. Забег качает только то, что нужно ЕМУ. Листы делятся на общие
//    (loadCommonAssets: герой, эффекты навыков и парирования, иконки наград, шар
//    маны — нужны в любом забеге) и листы «под событие» (loadEventAssets: зверь,
//    Звонарь, Привратник, сундук, Контрабандист, обелиск, босс — каждый только
//    если такое событие есть среди событий ЭТОГО забега). Раньше условными были
//    лишь Звонарь и Привратник, а восемь листов босса (15.5 МБ, треть всей
//    загрузки) ехали в каждый забег, хотя босс есть не в каждом.
// 2. Независимые файлы грузятся ПАРАЛЛЕЛЬНО (Promise.all), а не цепочкой await:
//    цепочка платила задержкой сети за каждый из шестидесяти файлов по очереди.
//
// Чего правила НЕ меняют: сверка размера листа (assertSheetSize) стоит у тех же
// листов, что и раньше; сбой загрузки нужного листа по-прежнему роняет setup() в
// экран ошибки — промис Promise.all отклоняется первой же ошибкой. Тихих
// фолбэков нет: «не просили» — это null, а не пустой массив кадров.
//
// Отмены посреди загрузки здесь больше нет (раньше isCancelled() проверялся
// после каждого await и не давал запросить следующий лист): при параллельной
// загрузке все запросы уходят сразу. Размонтировали компонент — вызывающий
// (setup() в Explore.tsx) проверяет свой cancelled после await и просто не
// пользуется результатом; сами листы остаются в кэше Assets до следующего забега.
//
// Фон карты и её готовый слой сюда НЕ входят — их грузит сам setup().

/** Листы, нужные в ЛЮБОМ забеге. */
export type CommonAssets = {
  hero: {
    idle: Texture[]
    run: Texture[]
    jump: Texture[]
    land: Texture[]
    attack: Texture[]
    drink: Texture[]
    hurt: Texture[]
    death: Texture[]
    // Каст (поднятие руки → удержание → опускание) — анимация под fireball.
    cast: Texture[]
    // Скилл dash. Лежит в hero, а НЕ рядом с healAura/slashStreak ниже, хотя
    // файл и живёт в assets/skills: dash проигрывается подменой текстур на
    // спрайте ГЕРОЯ, это его анимация, а не VFX-оверлей поверх него.
    dash: Texture[]
    // Блок (парирование). Лежит в hero по той же причине, что dash: это
    // анимация ГЕРОЯ, проигрываемая подменой текстур на его спрайте.
    // ⚠️ Клетка у листа ВЫШЕ остальных (394×342) — см. HERO_BLOCK_* в
    // constants.ts, там же про масштаб.
    block: Texture[]
  }
  // Искра отбива (парирование) — ОДНОРАЗОВЫЙ VFX поверх героя, поэтому рядом с
  // healAura/slashStreak, а не в hero: это не его анимация, а вспышка на клинке.
  parrySpark: Texture[]
  // Аура лечения (скилл heal).
  healAura: Texture[]
  // Скилл slash: дуга взмаха (разовая). Петля кровотечения (Bleeding_Loop)
  // НЕ грузится — визуал кровотечения убран намеренно, см. updateBleeds в
  // explore/entities/skills.ts. Сам файл на диске остался.
  slashStreak: Texture[]
  // Скилл fireball: летящий снаряд (лупится) и разовая вспышка на месте его
  // смерти — от попадания в цель или в геометрию.
  fireballProjectile: Texture[]
  fireballImpact: Texture[]
  // Скилл iceball — тот же снаряд на своих текстурах (см. ProjectileSpec в
  // entities/skills.ts): пара листов той же формы, что у fireball.
  iceballProjectile: Texture[]
  iceballImpact: Texture[]
  rewardIcons: Record<RewardKind, Texture>
  // Шар маны, летящий из убитого врага в героя (см. entities/mana.ts).
  manaOrb: Texture
}

export type BeastAssets = {
  idle: Texture[]
  walk: Texture[]
  attack: Texture[]
  hurt: Texture[]
  death: Texture[]
}

export type ZvonarAssets = {
  idle: Texture[]
  walk: Texture[]
  attack: Texture[]
  hurt: Texture[]
  death: Texture[]
  // Волна — ОДИН кадр, поэтому обычный Assets.load, без нарезки (тот же приём,
  // что у шипа босса).
  wave: Texture
  impact: Texture[]
}

export type GatekeeperAssets = Record<keyof typeof C.GATEKEEPER_SHEETS, Texture[]>

/** Сундук: добрый лист и лист мимика. Исход решает бросок на первом ударе, поэтому нужны оба. */
export type ChestAssets = {
  open: Texture[]
  trap: Texture[]
}

export type ObeliskAssets = {
  idle: Texture[]
  burning: Texture[]
}

export type BossAssets = {
  // Карта листов по BossAnimKind — её читают playBossAnim в setup() и модуль босса.
  frames: Record<BossAnimKind, Texture[]>
  // Три эффекта ниже — единственные листы забега, чей сбой загрузки НЕ роняет
  // setup(): босс без шипа или волны остаётся боссом, просто не создаёт этот
  // снаряд (см. entities/boss.ts). Сбой при этом громкий — console.error.
  // null / пустой массив здесь значит «не загрузился», а не «не просили».
  spikeTexture: Texture | null
  spikeImpactFrames: Texture[]
  waveLeftFrames: Texture[]
  waveRightFrames: Texture[]
}

/**
 * Что из листов «под событие» нужно забегу. Считается в setup() по списку событий
 * забега — тому же, по которому потом идёт спавн, — и только по нему.
 */
export type RunAssetNeeds = {
  beast: boolean
  zvonar: boolean
  gatekeeper: boolean
  chest: boolean
  smuggler: boolean
  obelisk: boolean
  boss: boolean
}

/**
 * Листы «под событие». null — события этого вида в забеге нет, и листы не
 * запрашивались. Спрашивать лист можно только там, куда без события не дойти
 * (спавн и ветки по своим спискам объектов); null в таком месте — ошибка в
 * условии загрузки, и встречать её надо громко, см. sheetsFor в Explore.tsx.
 */
export type EventAssets = {
  beast: BeastAssets | null
  zvonar: ZvonarAssets | null
  gatekeeper: GatekeeperAssets | null
  chest: ChestAssets | null
  smuggler: Texture[] | null
  obelisk: ObeliskAssets | null
  boss: BossAssets | null
}

// Сверка нарезанного листа с ожидаемым размером — ГРОМКАЯ. loadSheetFrames
// размер файла НЕ проверяет: он честно нарежет count прямоугольников по тем
// же координатам из файла любого размера и вернёт пустые/сдвинутые кадры —
// снаружи это выглядит как "скилл не сработал", и причину пришлось бы искать
// глазами. Брошенная отсюда ошибка уходит наверх в setup().catch() и
// показывает экран ошибки (см. setSetupError в Explore.tsx).
//
// rows — число РЯДОВ клеток на листе (по умолчанию 1, однорядный лист).
// Многорядные листы героя (12 колонок × 2 ряда) проходят через эту же
// проверку, просто с rows=2.
function assertSheetSize(
  fileName: string,
  frames: Texture[],
  cellW: number,
  cellH: number,
  count: number,
  cols: number,
  rows = 1,
): void {
  if (frames.length !== count) {
    throw new Error(`${fileName}: ожидалось ${count} кадров, нарезано ${frames.length}`)
  }
  // Кадры не помещаются в сетку — нарезка полезет за пределы листа и вернёт
  // пустые клетки. Проверяется ОТДЕЛЬНО от размера: сетка бывает верной, а
  // count больше, чем в неё влезает.
  if (count > cols * rows) {
    throw new Error(
      `${fileName}: ${count} кадров не помещаются в сетку ${cols}×${rows} (${cols * rows} клеток)`,
    )
  }
  const sheet = frames[0].source
  if (sheet.width !== cellW * cols || sheet.height !== cellH * rows) {
    throw new Error(
      `${fileName}: ожидался лист ${cellW * cols}×${cellH * rows} ` +
        `(клетка ${cellW}×${cellH}, сетка ${cols}×${rows}), ` +
        `а пришёл ${sheet.width}×${sheet.height} — нарезка на кадры неверна`,
    )
  }
}

// Лист СО сверкой размера — одним промисом. При параллельной загрузке сверка
// обязана ехать вместе с листом: отдельной строкой после Promise.all её легко
// потерять, а без неё неверные cols/клетка дают сдвинутые или пустые кадры.
async function loadCheckedSheet(
  fileName: string,
  src: string,
  cellW: number,
  cellH: number,
  count: number,
  cols: number,
  rows = 1,
): Promise<Texture[]> {
  const frames = await loadSheetFrames(src, cellW, cellH, count, cols)
  assertSheetSize(fileName, frames, cellW, cellH, count, cols, rows)
  return frames
}

// Листы героя. Клетка у всех, кроме block и dash, одна — HERO_CELL_W×HERO_CELL_H,
// 12 колонок в ряд (дефолт loadSheetFrames).
async function loadHeroSheets(): Promise<CommonAssets['hero']> {
  const [idle, run, jump, attack, drink, hurt, death, cast, block, dash] = await Promise.all([
    loadSheetFrames(C.HERO_IDLE_SRC, C.HERO_CELL_W, C.HERO_CELL_H, 24),
    loadSheetFrames(C.HERO_RUN_SRC, C.HERO_CELL_W, C.HERO_CELL_H, 21),
    loadSheetFrames(C.HERO_JUMP_SRC, C.HERO_CELL_W, C.HERO_CELL_H, 24),
    loadSheetFrames(C.HERO_ATTACK_SRC, C.HERO_CELL_W, C.HERO_CELL_H, 14),
    // Питьё зелья — та же клетка и раскладка, что у остальных листов героя.
    loadSheetFrames(C.HERO_DRINK_SRC, C.HERO_CELL_W, C.HERO_CELL_H, 14),
    loadSheetFrames(C.HERO_HURT_SRC, C.HERO_CELL_W, C.HERO_CELL_H, 10),
    loadSheetFrames(C.HERO_DEATH_SRC, C.HERO_CELL_W, C.HERO_CELL_H, 18),
    // Каст — та же клетка и та же раскладка, что у остальных листов героя
    // (394×296, 12×2, 24 кадра, лист 4728×592), cols — дефолтные 12.
    loadCheckedSheet('cast_v2.png', C.HERO_CAST_SRC, C.HERO_CELL_W, C.HERO_CELL_H, C.HERO_CAST_COUNT, 12, C.HERO_CAST_ROWS),
    // Блок (парирование) — 9 кадров в ОДИН ряд, клетка 394×342. COLS передаётся
    // ЯВНО: дефолт loadSheetFrames — 12.
    // ⚠️ Клетка ВЫШЕ остальных листов героя (342 против 296) — над головой место
    // под поднятый меч. Масштаб спрайта при этом НЕ пересчитывается (см.
    // HERO_BLOCK_* в constants.ts): блок обязан рисоваться тем же множителем, что
    // idle, иначе переключение туда-обратно давало бы скачок размера.
    loadCheckedSheet('block.png', C.HERO_BLOCK_SRC, C.HERO_BLOCK_CELL_W, C.HERO_BLOCK_CELL_H, C.HERO_BLOCK_COUNT, C.HERO_BLOCK_COLS),
    // Dash — анимация героя на СВОЁМ листе: клетка 240×128, 11 кадров в один
    // ряд, файл лежит в assets/skills (см. DASH_* в constants.ts). COLS
    // передаётся ЯВНО: дефолт loadSheetFrames — 12, и на нём кадры съехали бы.
    loadCheckedSheet('Dash_Strike.png', C.DASH_SRC, C.DASH_CELL_W, C.DASH_CELL_H, C.DASH_COUNT, C.DASH_COLS),
  ])
  return {
    idle,
    run,
    jump,
    // Land — подпоследовательность кадров прыжка 18..24 (индексы 17..23),
    // один раз вырезанная при загрузке, а не при каждом приземлении.
    land: jump.slice(17, 24),
    attack,
    drink,
    hurt,
    death,
    cast,
    dash,
    block,
  }
}

/**
 * Общие листы забега: герой, эффекты навыков и парирования, иконки наград, шар
 * маны. От событий забега не зависят, поэтому setup() запускает эту загрузку
 * РАНЬШЕ всего остального — ещё до ответа /run/start-explore.
 *
 * Листы эффектов навыков — БЕЗ try/catch, намеренно (в отличие от шипа и волны
 * босса ниже): пустой массив кадров был бы тихим фолбэком — эффект молча не
 * нарисовался бы, и причину пришлось бы искать глазами. Assets.load отклоняет
 * промис на 404, ошибка уходит наверх в setup().catch() и показывает экран
 * ошибки. COLS у всех передаётся ЯВНО: у Heal_Aura их 14, у снарядов 10, а
 * дефолт loadSheetFrames равен 12 — на нём нарезка съехала бы молча.
 * Из восьми листов скиллов на диске грузятся семь: шесть здесь и Dash_Strike
 * среди листов героя. Восьмой, Bleeding_Loop.png, не грузится — визуал
 * кровотечения убран.
 */
export async function loadCommonAssets(): Promise<CommonAssets> {
  const [
    hero, parrySpark, healAura, slashStreak,
    fireballProjectile, fireballImpact, iceballProjectile, iceballImpact,
    gold, trophy, rp, manaOrb,
  ] = await Promise.all([
    loadHeroSheets(),
    // Искра отбива — своя клетка 192×192, 11 кадров в один ряд.
    loadCheckedSheet('parry_spark.png', C.PARRY_SPARK_SRC, C.PARRY_SPARK_CELL, C.PARRY_SPARK_CELL, C.PARRY_SPARK_COUNT, C.PARRY_SPARK_COLS),
    loadSheetFrames(C.HEAL_AURA_SRC, C.HEAL_AURA_CELL_W, C.HEAL_AURA_CELL_H, C.HEAL_AURA_COUNT, C.HEAL_AURA_COLS),
    // Slash — дуга взмаха. Размер клетки сверен по IHDR: 1920/12 = 160 нацело,
    // высота листа равна высоте кадра (один ряд).
    loadSheetFrames(C.SLASH_STREAK_SRC, C.SLASH_STREAK_CELL_W, C.SLASH_STREAK_CELL_H, C.SLASH_STREAK_COUNT, C.SLASH_STREAK_COLS),
    loadCheckedSheet(
      'Fireball_Projectile.png', C.FIREBALL_PROJECTILE_SRC,
      C.FIREBALL_PROJECTILE_CELL_W, C.FIREBALL_PROJECTILE_CELL_H,
      C.FIREBALL_PROJECTILE_COUNT, C.FIREBALL_PROJECTILE_COLS,
    ),
    loadCheckedSheet(
      'Fireball_Impact.png', C.FIREBALL_IMPACT_SRC,
      C.FIREBALL_IMPACT_CELL_W, C.FIREBALL_IMPACT_CELL_H,
      C.FIREBALL_IMPACT_COUNT, C.FIREBALL_IMPACT_COLS,
    ),
    loadCheckedSheet(
      'IceBall_Projectile.png', C.ICEBALL_PROJECTILE_SRC,
      C.ICEBALL_PROJECTILE_CELL_W, C.ICEBALL_PROJECTILE_CELL_H,
      C.ICEBALL_PROJECTILE_COUNT, C.ICEBALL_PROJECTILE_COLS,
    ),
    loadCheckedSheet(
      'IceBall_Impact.png', C.ICEBALL_IMPACT_SRC,
      C.ICEBALL_IMPACT_CELL_W, C.ICEBALL_IMPACT_CELL_H,
      C.ICEBALL_IMPACT_COUNT, C.ICEBALL_IMPACT_COLS,
    ),
    // Иконки наград (см. spawnRewardFloat в setup) и шар маны — обычные
    // картинки, не спрайт-листы, поэтому просто Assets.load.
    Assets.load(C.REWARD_ICON_SRC.gold) as Promise<Texture>,
    Assets.load(C.REWARD_ICON_SRC.trophy) as Promise<Texture>,
    Assets.load(C.REWARD_ICON_SRC.rp) as Promise<Texture>,
    Assets.load(C.MANA_ORB_SRC) as Promise<Texture>,
  ])
  return {
    hero,
    parrySpark,
    healAura,
    slashStreak,
    fireballProjectile,
    fireballImpact,
    iceballProjectile,
    iceballImpact,
    rewardIcons: { gold, trophy, rp },
    manaOrb,
  }
}

// Зверь — пять листов в единой клетке 600×288 с одинаковой посадкой, 12 колонок
// в ряд. Грузятся ОДИН раз на забег, не на каждого врага кластера.
async function loadBeastAssets(): Promise<BeastAssets> {
  const [idle, walk, attack, hurt, death] = await Promise.all([
    loadSheetFrames(C.BEAST_IDLE_SRC, 600, 288, 24),
    loadSheetFrames(C.BEAST_WALK_SRC, 600, 288, 16),
    loadSheetFrames(C.BEAST_ATTACK_SRC, 600, 288, 24),
    loadSheetFrames(C.BEAST_HURT_SRC, 600, 288, 12),
    loadSheetFrames(C.BEAST_DEATH_SRC, 600, 288, 18),
  ])
  return { idle, walk, attack, hurt, death }
}

// Звонарь — 8.7 МБ на семь листов. Пять листов фигуры идут через общую таблицу
// ZVONAR_SHEETS: клетка, колонки и число кадров у каждого СВОИ, и перечислять их
// здесь вторым списком значило бы завести копию, которая однажды разойдётся с
// той, по которой рисуют.
async function loadZvonarAssets(): Promise<ZvonarAssets> {
  const keys = Object.keys(C.ZVONAR_SHEETS) as (keyof typeof C.ZVONAR_SHEETS)[]
  const [figure, wave, impact] = await Promise.all([
    Promise.all(keys.map((key) => {
      const spec = C.ZVONAR_SHEETS[key]
      // Сверка размера — ГРОМКАЯ и дешёвая: без неё неверные cols/клетка дали бы
      // сдвинутые или пустые кадры, и выглядело бы это как «Звонарь не
      // прорисовался», а не как ошибка нарезки.
      // ⚠️ rows ОБЯЗАТЕЛЕН: по умолчанию он 1, а у Звонаря многорядные все пять
      // листов (2/2/5/2/5). Без него проверка требовала бы лист в один ряд и
      // падала бы на каждом.
      return loadCheckedSheet(
        spec.src.split('/').pop() ?? spec.src,
        spec.src,
        spec.cellW,
        spec.cellH,
        spec.count,
        spec.cols,
        Math.ceil(spec.count / spec.cols),
      )
    })),
    Assets.load(C.ZVONAR_WAVE_SRC) as Promise<Texture>,
    loadCheckedSheet(
      'Zvonar_Wave_Impact_v2.png',
      C.ZVONAR_WAVE_IMPACT_SRC,
      C.ZVONAR_WAVE_IMPACT_CELL,
      C.ZVONAR_WAVE_IMPACT_CELL,
      C.ZVONAR_WAVE_IMPACT_COUNT,
      C.ZVONAR_WAVE_IMPACT_COLS,
      Math.ceil(C.ZVONAR_WAVE_IMPACT_COUNT / C.ZVONAR_WAVE_IMPACT_COLS),
    ),
  ])
  const sheets = {} as Record<keyof typeof C.ZVONAR_SHEETS, Texture[]>
  keys.forEach((key, i) => { sheets[key] = figure[i] })
  return {
    idle: sheets.idle,
    walk: sheets.walk,
    attack: sheets.attack,
    hurt: sheets.hurt,
    death: sheets.death,
    wave,
    impact,
  }
}

// Привратник — 5.8 МБ на пять листов. Листы — WebP БЕЗ ПОТЕРЬ (пиксели совпадают
// с исходными PNG арт-сессии): тот же loadSheetFrames, формат ему безразличен.
async function loadGatekeeperAssets(): Promise<GatekeeperAssets> {
  const keys = Object.keys(C.GATEKEEPER_SHEETS) as (keyof typeof C.GATEKEEPER_SHEETS)[]
  const figure = await Promise.all(keys.map((key) => {
    const spec = C.GATEKEEPER_SHEETS[key]
    return loadCheckedSheet(
      spec.src.split('/').pop() ?? spec.src,
      spec.src,
      spec.cellW,
      spec.cellH,
      spec.count,
      spec.cols,
      Math.ceil(spec.count / spec.cols),
    )
  }))
  const sheets = {} as GatekeeperAssets
  keys.forEach((key, i) => { sheets[key] = figure[i] })
  return sheets
}

async function loadChestAssets(): Promise<ChestAssets> {
  const [open, trap] = await Promise.all([
    // Сундук. Лист ОДНОРЯДНЫЙ (1820×178px = 13 колонок × 1 ряд, проверено по
    // IHDR) — cols=13 ОБЯЗАТЕЛЕН, дефолтный cols=12 резал 13-й кадр (индекс 12,
    // открытый сундук) как "второй ряд", т.е. область за пределами картинки —
    // отсюда пустая текстура и "исчезающий" сундук после открытия.
    loadSheetFrames(C.CHEST_OPEN_SRC, 140, 178, 13, 13),
    // Мимик — 14 колонок в ряд.
    loadSheetFrames(C.CHEST_TRAP_SRC, 190, 137, 14, 14),
  ])
  return { open, trap }
}

// Контрабандист (idle) — лист 230×296, 14 кадров, 14 колонок в ряд. cols=14
// ОБЯЗАТЕЛЕН (дефолт loadSheetFrames — 12) — та же грабля, что у сундука: без
// явного cols последние кадры режутся как несуществующий второй ряд, пустая
// текстура, "исчезающий" персонаж.
function loadSmugglerAssets(): Promise<Texture[]> {
  return loadSheetFrames(C.SMUGGLER_SRC, 230, 296, 14, 14)
}

// Обелиск — лист 190×512, 10 кадров, 10 колонок в ряд. cols=10 ОБЯЗАТЕЛЕН
// (дефолт loadSheetFrames — 12) — та же грабля, что у сундука и Контрабандиста.
async function loadObeliskAssets(): Promise<ObeliskAssets> {
  const [idle, burning] = await Promise.all([
    loadSheetFrames(C.OBELISK_IDLE_SRC, C.OBELISK_FRAME_W, C.OBELISK_FRAME_H, C.OBELISK_IDLE_COUNT, 10),
    loadSheetFrames(C.OBELISK_BURNING_SRC, C.OBELISK_FRAME_W, C.OBELISK_FRAME_H, C.OBELISK_BURNING_COUNT, 10),
  ])
  return { idle, burning }
}

// Шип дальней атаки босса. В try/catch: при ошибке загрузки не рушим setup(),
// снаряд просто не создаётся (см. spawnBossSpike в entities/boss.ts), остальная
// игра работает. Сбой громкий — console.error.
async function loadBossSpikeTexture(): Promise<Texture | null> {
  try {
    return await Assets.load(C.BOSS_SPIKE_SRC) as Texture
  } catch (err) {
    console.error('Explore: не удалось загрузить Boss_Spike.png', err)
    return null
  }
}

// Вспышка на месте шипа — по тому же правилу, что сам шип.
async function loadBossSpikeImpact(): Promise<Texture[]> {
  try {
    return await loadSheetFrames(C.BOSS_SPIKE_IMPACT_SRC, C.BOSS_SPIKE_IMPACT_CELL_W, C.BOSS_SPIKE_IMPACT_CELL_H, C.BOSS_SPIKE_IMPACT_COUNT, C.BOSS_SPIKE_IMPACT_COLS)
  } catch (err) {
    console.error('Explore: не удалось загрузить Boss_Spike_Impact.png', err)
    return []
  }
}

// AoE-волна топота — в try/catch, тем же приёмом, что шип и его вспышка: при
// ошибке загрузки топот просто не создаёт волн, урона не будет, остальная игра
// не ломается. НЕ через loadSheetFrames — в клетке нарисованы ОБЕ дуги сразу
// (левая+правая), режем каждую клетку вручную пополам по BOSS_WAVE_SPLIT_X (см.
// константы), тем же приёмом (Texture + frame Rectangle внутри общего source),
// что и loadSheetFrames — получаем ДВА набора по BOSS_WAVE_COUNT кадров.
async function loadBossWave(): Promise<{ left: Texture[]; right: Texture[] }> {
  const left: Texture[] = []
  const right: Texture[] = []
  try {
    const base = await Assets.load(C.BOSS_WAVE_SRC)
    base.source.scaleMode = 'linear'
    for (let i = 0; i < C.BOSS_WAVE_COUNT; i++) {
      const col = i % C.BOSS_WAVE_COLS
      const row = Math.floor(i / C.BOSS_WAVE_COLS)
      const cellX = col * C.BOSS_WAVE_CELL_W
      const cellY = row * C.BOSS_WAVE_CELL_H
      left.push(new Texture({
        source: base.source,
        frame: new Rectangle(cellX, cellY, C.BOSS_WAVE_SPLIT_X, C.BOSS_WAVE_CELL_H),
      }))
      right.push(new Texture({
        source: base.source,
        frame: new Rectangle(cellX + C.BOSS_WAVE_SPLIT_X, cellY, C.BOSS_WAVE_CELL_W - C.BOSS_WAVE_SPLIT_X, C.BOSS_WAVE_CELL_H),
      }))
    }
  } catch (err) {
    console.error('Explore: не удалось загрузить Boss_Wave.png', err)
    // Обе дуги режутся из одного файла: не загрузился — нет ни левой, ни правой.
    return { left: [], right: [] }
  }
  return { left, right }
}

// Босс — восемь листов фигуры (15.5 МБ) и три эффекта. Высота клетки СВОЯ у
// каждого листа (общей BOSS_CELL_H нет), cols указан ЯВНО у всех: у Melee2 — 6,
// не дефолтные 12; Ranged и Stomp — 12×2. Ranged НЕ приведён к общему масштабу —
// это отдельно компенсируется в applyBossLayout, cols тут ни при чём.
async function loadBossAssets(): Promise<BossAssets> {
  const [idleRaw, walk, melee, melee2, hurt, death, ranged, stomp, spikeTexture, spikeImpactFrames, wave] = await Promise.all([
    loadSheetFrames(C.BOSS_IDLE_SRC, C.BOSS_IDLE_CELL_W, C.BOSS_IDLE_CELL_H, C.BOSS_IDLE_COUNT, C.BOSS_IDLE_COLS),
    loadSheetFrames(C.BOSS_WALK_SRC, C.BOSS_WALK_CELL_W, C.BOSS_WALK_CELL_H, C.BOSS_WALK_COUNT, C.BOSS_WALK_COLS),
    loadSheetFrames(C.BOSS_MELEE_SRC, C.BOSS_MELEE_CELL_W, C.BOSS_MELEE_CELL_H, C.BOSS_MELEE_COUNT, C.BOSS_MELEE_COLS),
    loadSheetFrames(C.BOSS_MELEE2_SRC, C.BOSS_MELEE2_CELL_W, C.BOSS_MELEE2_CELL_H, C.BOSS_MELEE2_COUNT, C.BOSS_MELEE2_COLS),
    loadSheetFrames(C.BOSS_HURT_SRC, C.BOSS_HURT_CELL_W, C.BOSS_HURT_CELL_H, C.BOSS_HURT_COUNT, C.BOSS_HURT_COLS),
    loadSheetFrames(C.BOSS_DEATH_SRC, C.BOSS_DEATH_CELL_W, C.BOSS_DEATH_CELL_H, C.BOSS_DEATH_COUNT, C.BOSS_DEATH_COLS),
    loadSheetFrames(C.BOSS_RANGED_SRC, C.BOSS_RANGED_CELL_W, C.BOSS_RANGED_CELL_H, C.BOSS_RANGED_COUNT, C.BOSS_RANGED_COLS),
    loadSheetFrames(C.BOSS_STOMP_SRC, C.BOSS_STOMP_CELL_W, C.BOSS_STOMP_CELL_H, C.BOSS_STOMP_COUNT, C.BOSS_STOMP_COLS),
    loadBossSpikeTexture(),
    loadBossSpikeImpact(),
    loadBossWave(),
  ])
  return {
    frames: {
      // Пинг-понг: встык (кадр 23 -> кадр 0) цикл дыхания не сходится, шов
      // виден — 0..23 достраивается кадрами 22..1 в обратном порядке.
      idle: [...idleRaw, ...idleRaw.slice(1, -1).reverse()],
      walk,
      melee,
      melee2,
      hurt,
      death,
      ranged,
      stomp,
    },
    spikeTexture,
    spikeImpactFrames,
    waveLeftFrames: wave.left,
    waveRightFrames: wave.right,
  }
}

/**
 * Листы «под событие» — только те, чьё событие есть в этом забеге, все разом.
 *
 * Зачем условие: босс (15.5 МБ листов + 1.3 МБ эффектов) есть не в каждом
 * забеге, Звонарь (8.7 МБ) и Привратник (5.8 МБ) — тоже, сундука, Контрабандиста
 * (он бывает только на карте D) или обелиска (только карта F) может не быть
 * вовсе, а группа врагов бывает без зверей. Грузить всё это каждому значило бы
 * держать игрока на «ПОДГОТОВКЕ» ради того, чего он в этом забеге не увидит.
 *
 * Сбой любого запрошенного листа отклоняет общий промис — setup() уходит в экран
 * ошибки, как и раньше (кроме трёх эффектов босса, см. BossAssets).
 */
export async function loadEventAssets(needs: RunAssetNeeds): Promise<EventAssets> {
  const [beast, zvonar, gatekeeper, chest, smuggler, obelisk, boss] = await Promise.all([
    needs.beast ? loadBeastAssets() : null,
    needs.zvonar ? loadZvonarAssets() : null,
    needs.gatekeeper ? loadGatekeeperAssets() : null,
    needs.chest ? loadChestAssets() : null,
    needs.smuggler ? loadSmugglerAssets() : null,
    needs.obelisk ? loadObeliskAssets() : null,
    needs.boss ? loadBossAssets() : null,
  ])
  return { beast, zvonar, gatekeeper, chest, smuggler, obelisk, boss }
}
