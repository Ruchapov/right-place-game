import { Assets, Rectangle, Texture } from 'pixi.js'
import * as C from './constants'
import type { BossAnimKind, RewardKind } from './types'
import { loadSheetFrames } from './spriteLoader'

export type ExploreAssets = {
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
    // Скилл dash — ЭТАП 1, только визуал. Лежит в hero, а НЕ рядом с
    // healAura/slashStreak ниже, хотя файл и живёт в assets/skills: dash
    // проигрывается подменой текстур на спрайте ГЕРОЯ, это его анимация,
    // а не VFX-оверлей поверх него.
    dash: Texture[]
  }
  beast: {
    idle: Texture[]
    walk: Texture[]
    attack: Texture[]
    hurt: Texture[]
    death: Texture[]
  }
  chest: Texture[]
  chestTrap: Texture[]
  smuggler: Texture[]
  obeliskIdle: Texture[]
  obeliskBurning: Texture[]
  boss: Record<BossAnimKind, Texture[]>
  bossSpikeTexture: Texture | null
  bossSpikeImpactFrames: Texture[]
  bossWaveLeftFrames: Texture[]
  bossWaveRightFrames: Texture[]
  // Аура лечения (скилл heal) — кадры загружены, механики heal ещё нет
  // (см. explore/entities/skills.ts).
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
}

// Последовательная загрузка всех спрайт-листов забега (герой/зверь/сундук/
// смуглер/обелиск/босс/шип/волна/иконки наград) — ПОРЯДОК и числа перенесены
// из setup() Explore.tsx как есть. isCancelled() проверяется после каждого
// await — тот же механизм, что раньше давала переменная cancelled из
// замыкания useEffect: если компонент размонтировался посреди загрузки,
// последующие листы вообще не запрашиваются, функция возвращает null.
//
// Фон карты (bgFar/bgMid) СОЗНАТЕЛЬНО не входит сюда — он грузится в setup()
// раньше и отдельно, чтобы карта и фон появлялись на экране быстро, не
// дожидаясь всех остальных (более тяжёлых) листов.
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

export async function loadExploreAssets(isCancelled: () => boolean): Promise<ExploreAssets | null> {
  // Визуал героя — AnimatedSprite поверх хитбокса. Только idle в этом
  // шаге (run/attack/jump/hurt/death — отдельно). Кадры режутся из
  // idle.png: 12 колонок в ряд (см. loadSheetFrames), клетка 674×512 —
  // тот же размер, что задокументирован в CLAUDE.md для idle/run/attack/hurt.
  const idleFrames = await loadSheetFrames(C.HERO_IDLE_SRC, C.HERO_CELL_W, C.HERO_CELL_H, 24)
  if (isCancelled()) {
    // Компонент размонтировался, пока грузился спрайт-лист — не создаём
    // спрайт и не трогаем worldContainer (он в любом случае будет уничтожен
    // вместе с app при cancelled-выходе выше по функции... но сюда мы уже
    // прошли мимо тех проверок, поэтому просто не продолжаем настройку героя).
    return null
  }
  const runFrames = await loadSheetFrames(C.HERO_RUN_SRC, C.HERO_CELL_W, C.HERO_CELL_H, 21)
  if (isCancelled()) {
    // Тот же случай, что и выше — ещё один await, ещё одна проверка.
    return null
  }
  const jumpFrames = await loadSheetFrames(C.HERO_JUMP_SRC, C.HERO_CELL_W, C.HERO_CELL_H, 24)
  if (isCancelled()) {
    // Тот же случай, что и выше — ещё один await, ещё одна проверка.
    return null
  }
  // Land — подпоследовательность кадров прыжка 18..24 (индексы 17..23),
  // один раз вырезанная при загрузке, а не при каждом приземлении.
  const landFrames = jumpFrames.slice(17, 24)
  const attackFrames = await loadSheetFrames(C.HERO_ATTACK_SRC, C.HERO_CELL_W, C.HERO_CELL_H, 14)
  if (isCancelled()) {
    // Тот же случай, что и выше — ещё один await, ещё одна проверка.
    return null
  }
  // Питьё зелья — та же клетка/раскладка, что у idle/run/attack (379×288,
  // 12 кадров в один ряд). ТОЛЬКО визуал (см. drinkingRef выше) — хила,
  // зарядов и кулдауна здесь нет, это отдельный будущий шаг.
  const drinkFrames = await loadSheetFrames(C.HERO_DRINK_SRC, C.HERO_CELL_W, C.HERO_CELL_H, 14)
  if (isCancelled()) {
    // Тот же случай, что и выше — ещё один await, ещё одна проверка.
    return null
  }
  const hurtFrames = await loadSheetFrames(C.HERO_HURT_SRC, C.HERO_CELL_W, C.HERO_CELL_H, 10)
  if (isCancelled()) {
    // Тот же случай, что и выше — ещё один await, ещё одна проверка.
    return null
  }
  const deathFrames = await loadSheetFrames(C.HERO_DEATH_SRC, C.HERO_CELL_W, C.HERO_CELL_H, 18)
  if (isCancelled()) {
    // Тот же случай, что и выше — ещё один await, ещё одна проверка.
    return null
  }
  // Каст — та же клетка и та же раскладка, что у остальных листов героя,
  // поэтому cols НЕ передаётся: дефолт loadSheetFrames равен 12 и здесь верен.
  // Лист перерисован (HERO_CAST_SRC теперь cast_v2.png) — сетка у новой
  // версии та же (394×296, 12×2, 24 кадра, лист 4728×592), поэтому числа
  // проверки ниже не менялись, сменилось только имя файла в сообщении.
  const castFrames = await loadSheetFrames(C.HERO_CAST_SRC, C.HERO_CELL_W, C.HERO_CELL_H, C.HERO_CAST_COUNT)
  if (isCancelled()) {
    // Тот же случай, что и выше — ещё один await, ещё одна проверка.
    return null
  }
  assertSheetSize('cast_v2.png', castFrames, C.HERO_CELL_W, C.HERO_CELL_H, C.HERO_CAST_COUNT, 12, C.HERO_CAST_ROWS)
  // Dash — анимация героя на СВОЁМ листе: клетка 240×128, 11 кадров в один
  // ряд, файл лежит в assets/skills (см. DASH_* в constants.ts). COLS
  // передаётся ЯВНО: дефолт loadSheetFrames — 12, и на нём кадры съехали бы.
  const dashFrames = await loadSheetFrames(C.DASH_SRC, C.DASH_CELL_W, C.DASH_CELL_H, C.DASH_COUNT, C.DASH_COLS)
  if (isCancelled()) {
    // Тот же случай, что и выше — ещё один await, ещё одна проверка.
    return null
  }
  assertSheetSize('Dash_Strike.png', dashFrames, C.DASH_CELL_W, C.DASH_CELL_H, C.DASH_COUNT, C.DASH_COLS)

  // Кадры зверя — тот же loadSheetFrames, 12 колонок в ряд, грузятся ОДИН
  // раз (не на каждого врага кластера). Все 5 листов пересобраны в единую
  // клетку 600×288 с одинаковой посадкой — cellW/cellH теперь одни и те
  // же для всех анимаций (раньше у attack/walk/death была своя ширина).
  const beastIdleFrames = await loadSheetFrames(C.BEAST_IDLE_SRC, 600, 288, 24)
  if (isCancelled()) return null
  const beastWalkFrames = await loadSheetFrames(C.BEAST_WALK_SRC, 600, 288, 16)
  if (isCancelled()) return null
  const beastAttackFrames = await loadSheetFrames(C.BEAST_ATTACK_SRC, 600, 288, 24)
  if (isCancelled()) return null
  const beastHurtFrames = await loadSheetFrames(C.BEAST_HURT_SRC, 600, 288, 12)
  if (isCancelled()) return null
  const beastDeathFrames = await loadSheetFrames(C.BEAST_DEATH_SRC, 600, 288, 18)
  if (isCancelled()) return null

  // Сундук — тот же loadSheetFrames, что и герой/зверь. Лист ОДНОРЯДНЫЙ
  // (1820×178px = 13 колонок × 1 ряд, проверено по IHDR) — cols=13
  // ОБЯЗАТЕЛЕН, дефолтный cols=12 резал 13-й кадр (индекс 12, открытый
  // сундук) как "второй ряд", т.е. область за пределами картинки —
  // отсюда пустая текстура и "исчезающий" сундук после открытия.
  const chestFrames = await loadSheetFrames(C.CHEST_OPEN_SRC, 140, 178, 13, 13)
  if (isCancelled()) return null

  // Мимик — тот же loadSheetFrames, 14 колонок в ряд (см. задачу).
  const chestTrapFrames = await loadSheetFrames(C.CHEST_TRAP_SRC, 190, 137, 14, 14)
  if (isCancelled()) return null

  // Смуглер (idle) — лист 230×296, 14 кадров, 14 колонок в ряд. cols=14
  // ОБЯЗАТЕЛЕН (дефолт loadSheetFrames — 12) — та же грабля, что у
  // сундука: без явного cols последние кадры режутся как несуществующий
  // второй ряд, пустая текстура, "исчезающий" персонаж.
  const smugglerFrames = await loadSheetFrames(C.SMUGGLER_SRC, 230, 296, 14, 14)
  if (isCancelled()) return null

  // Обелиск (карта F) — лист 190×512, 10 кадров, 10 колонок в ряд. cols=10
  // ОБЯЗАТЕЛЕН (дефолт loadSheetFrames — 12) — та же грабля, что у
  // сундука/смуглера: без явного cols последние кадры режутся как
  // несуществующий второй ряд. Burning загружен и сохранён в ref — в
  // этом шаге не используется (следующий шаг).
  const obeliskIdleFrames = await loadSheetFrames(C.OBELISK_IDLE_SRC, C.OBELISK_FRAME_W, C.OBELISK_FRAME_H, C.OBELISK_IDLE_COUNT, 10)
  if (isCancelled()) return null
  const obeliskBurningFrames = await loadSheetFrames(C.OBELISK_BURNING_SRC, C.OBELISK_FRAME_W, C.OBELISK_FRAME_H, C.OBELISK_BURNING_COUNT, 10)
  if (isCancelled()) return null

  // Босс (карта C) — Idle, лист 188×287, 24 кадра, 12 колонок в ряд.
  const bossIdleRaw = await loadSheetFrames(C.BOSS_IDLE_SRC, C.BOSS_IDLE_CELL_W, C.BOSS_IDLE_CELL_H, C.BOSS_IDLE_COUNT, C.BOSS_IDLE_COLS)
  if (isCancelled()) return null
  // Пинг-понг: встык (кадр 23 -> кадр 0) цикл дыхания не сходится, шов
  // виден — 0..23 достраивается кадрами 22..1 в обратном порядке.
  const bossIdleFrames = [...bossIdleRaw, ...bossIdleRaw.slice(1, -1).reverse()]

  // Босс (карта C, ФАЗА 2 шаг 1, см. задачу) — остальные листы, ТОЛЬКО
  // загрузка (см. playBossAnim ниже — переключатель, без AI/боя/урона).
  // Stomp не грузится (нужен только для AoE — фаза 4, см. закомментированные
  // константы выше). Высота клетки СВОЯ у каждого листа (общей BOSS_CELL_H
  // больше нет) — cols указан ЯВНО у всех, у Melee2 — 6, не дефолтные 12.
  const bossWalkFrames = await loadSheetFrames(C.BOSS_WALK_SRC, C.BOSS_WALK_CELL_W, C.BOSS_WALK_CELL_H, C.BOSS_WALK_COUNT, C.BOSS_WALK_COLS)
  if (isCancelled()) return null
  const bossMeleeFrames = await loadSheetFrames(C.BOSS_MELEE_SRC, C.BOSS_MELEE_CELL_W, C.BOSS_MELEE_CELL_H, C.BOSS_MELEE_COUNT, C.BOSS_MELEE_COLS)
  if (isCancelled()) return null
  const bossMelee2Frames = await loadSheetFrames(C.BOSS_MELEE2_SRC, C.BOSS_MELEE2_CELL_W, C.BOSS_MELEE2_CELL_H, C.BOSS_MELEE2_COUNT, C.BOSS_MELEE2_COLS)
  if (isCancelled()) return null
  const bossHurtFrames = await loadSheetFrames(C.BOSS_HURT_SRC, C.BOSS_HURT_CELL_W, C.BOSS_HURT_CELL_H, C.BOSS_HURT_COUNT, C.BOSS_HURT_COLS)
  if (isCancelled()) return null
  const bossDeathFrames = await loadSheetFrames(C.BOSS_DEATH_SRC, C.BOSS_DEATH_CELL_W, C.BOSS_DEATH_CELL_H, C.BOSS_DEATH_COUNT, C.BOSS_DEATH_COLS)
  if (isCancelled()) return null
  // Ranged (ФАЗА 3, шаг 1, см. задачу) — cols=12 указан ЯВНО (лист НЕ
  // приведён к общему масштабу, см. константы выше — это отдельно
  // компенсируется в applyBossLayout, cols тут ни при чём).
  const bossRangedFrames = await loadSheetFrames(C.BOSS_RANGED_SRC, C.BOSS_RANGED_CELL_W, C.BOSS_RANGED_CELL_H, C.BOSS_RANGED_COUNT, C.BOSS_RANGED_COLS)
  if (isCancelled()) return null
  // Stomp (ФАЗА 4, шаг 1, см. задачу) — cols=12 указан ЯВНО (лист 12×2,
  // НЕ дефолтные 12×N вподряд по одной строке).
  const bossStompFrames = await loadSheetFrames(C.BOSS_STOMP_SRC, C.BOSS_STOMP_CELL_W, C.BOSS_STOMP_CELL_H, C.BOSS_STOMP_COUNT, C.BOSS_STOMP_COLS)
  if (isCancelled()) return null

  // Шип дальней атаки + импакт (ФАЗА 3, шаг 2, см. задачу) — в try/catch:
  // при ошибке загрузки не рушим setup(), снаряд/импакт просто не
  // создаются (см. spawnBossSpike/spawnBossSpikeImpact ниже), остальная
  // игра работает.
  let bossSpikeTexture: Texture | null = null
  try {
    bossSpikeTexture = await Assets.load(C.BOSS_SPIKE_SRC)
  } catch (err) {
    console.error('Explore: не удалось загрузить Boss_Spike.png', err)
  }
  if (isCancelled()) return null
  let bossSpikeImpactFrames: Texture[] = []
  try {
    bossSpikeImpactFrames = await loadSheetFrames(C.BOSS_SPIKE_IMPACT_SRC, C.BOSS_SPIKE_IMPACT_CELL_W, C.BOSS_SPIKE_IMPACT_CELL_H, C.BOSS_SPIKE_IMPACT_COUNT, C.BOSS_SPIKE_IMPACT_COLS)
  } catch (err) {
    console.error('Explore: не удалось загрузить Boss_Spike_Impact.png', err)
  }
  if (isCancelled()) return null

  // AoE-волна топота (см. задачу) — в try/catch, тем же приёмом, что шип/
  // импакт выше: при ошибке загрузки топот просто не создаёт волн, урона
  // не будет, остальная игра не ломается. НЕ через loadSheetFrames — в
  // клетке нарисованы ОБЕ дуги сразу (левая+правая), режем каждую клетку
  // вручную пополам по BOSS_WAVE_SPLIT_X (см. константы выше), тем же
  // приёмом (Texture + frame Rectangle внутри общего source), что и
  // loadSheetFrames — получаем ДВА набора по BOSS_WAVE_COUNT кадров.
  const bossWaveLeftFrames: Texture[] = []
  const bossWaveRightFrames: Texture[] = []
  try {
    const bossWaveBase = await Assets.load(C.BOSS_WAVE_SRC)
    bossWaveBase.source.scaleMode = 'linear'
    for (let i = 0; i < C.BOSS_WAVE_COUNT; i++) {
      const col = i % C.BOSS_WAVE_COLS
      const row = Math.floor(i / C.BOSS_WAVE_COLS)
      const cellX = col * C.BOSS_WAVE_CELL_W
      const cellY = row * C.BOSS_WAVE_CELL_H
      bossWaveLeftFrames.push(new Texture({
        source: bossWaveBase.source,
        frame: new Rectangle(cellX, cellY, C.BOSS_WAVE_SPLIT_X, C.BOSS_WAVE_CELL_H),
      }))
      bossWaveRightFrames.push(new Texture({
        source: bossWaveBase.source,
        frame: new Rectangle(cellX + C.BOSS_WAVE_SPLIT_X, cellY, C.BOSS_WAVE_CELL_W - C.BOSS_WAVE_SPLIT_X, C.BOSS_WAVE_CELL_H),
      }))
    }
  } catch (err) {
    console.error('Explore: не удалось загрузить Boss_Wave.png', err)
  }
  if (isCancelled()) return null

  // Аура лечения (скилл heal) — ПОДГОТОВКА: кадры грузятся, сама механика
  // heal ещё не написана (см. explore/entities/skills.ts). Остальные 7 листов
  // скиллов на диске есть, но здесь НЕ грузятся — вместе с их механикой.
  //
  // БЕЗ try/catch, намеренно — в отличие от шипа/волны босса выше: там сбой
  // загрузки осознанно проглатывается (босс просто не создаёт снарядов), а
  // здесь пустой массив кадров был бы тихим фолбэком — аура молча не
  // нарисовалась бы, и причину пришлось бы искать глазами. Assets.load
  // реджектит промис на 404, ошибка уходит наверх в setup().catch() и
  // показывает экран ошибки.
  //
  // HEAL_AURA_COLS=14 обязателен (дефолт loadSheetFrames — 12), почему —
  // см. комментарий у констант в constants.ts.
  const healAuraFrames = await loadSheetFrames(C.HEAL_AURA_SRC, C.HEAL_AURA_CELL_W, C.HEAL_AURA_CELL_H, C.HEAL_AURA_COUNT, C.HEAL_AURA_COLS)
  if (isCancelled()) return null

  // Slash — дуга взмаха. БЕЗ try/catch, по тому же правилу, что и Heal_Aura
  // выше: 404 должен всплыть наверх экраном ошибки (setup().catch), а не
  // подмениться пустым массивом кадров, из-за которого эффект молча не
  // нарисуется. Размер клетки сверен по IHDR: 1920/12 = 160 нацело, высота
  // листа равна высоте кадра (один ряд). COLS передан явно.
  // Bleeding_Loop.png здесь НЕ грузится: визуал кровотечения убран (см.
  // updateBleeds в explore/entities/skills.ts), файл на диске оставлен.
  const slashStreakFrames = await loadSheetFrames(C.SLASH_STREAK_SRC, C.SLASH_STREAK_CELL_W, C.SLASH_STREAK_CELL_H, C.SLASH_STREAK_COUNT, C.SLASH_STREAK_COLS)
  if (isCancelled()) return null

  // Fireball — снаряд и импакт. БЕЗ try/catch, по тому же правилу, что и два
  // листа выше: 404 должен всплыть экраном ошибки, а не подмениться пустым
  // массивом кадров. COLS передаётся ЯВНО у обоих — у снаряда их 10, и на
  // дефолтных 12 нарезка съехала бы молча.
  const fireballProjectileFrames = await loadSheetFrames(
    C.FIREBALL_PROJECTILE_SRC, C.FIREBALL_PROJECTILE_CELL_W, C.FIREBALL_PROJECTILE_CELL_H,
    C.FIREBALL_PROJECTILE_COUNT, C.FIREBALL_PROJECTILE_COLS,
  )
  if (isCancelled()) return null
  assertSheetSize(
    'Fireball_Projectile.png', fireballProjectileFrames,
    C.FIREBALL_PROJECTILE_CELL_W, C.FIREBALL_PROJECTILE_CELL_H,
    C.FIREBALL_PROJECTILE_COUNT, C.FIREBALL_PROJECTILE_COLS,
  )

  const fireballImpactFrames = await loadSheetFrames(
    C.FIREBALL_IMPACT_SRC, C.FIREBALL_IMPACT_CELL_W, C.FIREBALL_IMPACT_CELL_H,
    C.FIREBALL_IMPACT_COUNT, C.FIREBALL_IMPACT_COLS,
  )
  if (isCancelled()) return null
  assertSheetSize(
    'Fireball_Impact.png', fireballImpactFrames,
    C.FIREBALL_IMPACT_CELL_W, C.FIREBALL_IMPACT_CELL_H,
    C.FIREBALL_IMPACT_COUNT, C.FIREBALL_IMPACT_COLS,
  )

  // Iceball — те же два листа своей стихии. БЕЗ try/catch и с теми же
  // громкими assertSheetSize, что у fireball выше: 404 или несовпавший размер
  // должны всплыть экраном ошибки, а не пустым/сдвинутым набором кадров.
  // COLS у обоих передаётся ЯВНО по той же причине — у снаряда их 10, дефолт
  // loadSheetFrames равен 12, и нарезка съехала бы молча.
  const iceballProjectileFrames = await loadSheetFrames(
    C.ICEBALL_PROJECTILE_SRC, C.ICEBALL_PROJECTILE_CELL_W, C.ICEBALL_PROJECTILE_CELL_H,
    C.ICEBALL_PROJECTILE_COUNT, C.ICEBALL_PROJECTILE_COLS,
  )
  if (isCancelled()) return null
  assertSheetSize(
    'IceBall_Projectile.png', iceballProjectileFrames,
    C.ICEBALL_PROJECTILE_CELL_W, C.ICEBALL_PROJECTILE_CELL_H,
    C.ICEBALL_PROJECTILE_COUNT, C.ICEBALL_PROJECTILE_COLS,
  )

  const iceballImpactFrames = await loadSheetFrames(
    C.ICEBALL_IMPACT_SRC, C.ICEBALL_IMPACT_CELL_W, C.ICEBALL_IMPACT_CELL_H,
    C.ICEBALL_IMPACT_COUNT, C.ICEBALL_IMPACT_COLS,
  )
  if (isCancelled()) return null
  assertSheetSize(
    'IceBall_Impact.png', iceballImpactFrames,
    C.ICEBALL_IMPACT_CELL_W, C.ICEBALL_IMPACT_CELL_H,
    C.ICEBALL_IMPACT_COUNT, C.ICEBALL_IMPACT_COLS,
  )

  // Карта листов по BossAnimKind — используется ТОЛЬКО playBossAnim в setup().
  const bossFramesByKind: Record<BossAnimKind, Texture[]> = {
    idle: bossIdleFrames,
    walk: bossWalkFrames,
    melee: bossMeleeFrames,
    melee2: bossMelee2Frames,
    hurt: bossHurtFrames,
    death: bossDeathFrames,
    ranged: bossRangedFrames,
    stomp: bossStompFrames,
  }

  // Иконки наград (см. spawnRewardFloat в setup) — обычные PNG, не спрайт-
  // лист, поэтому просто Assets.load без loadSheetFrames.
  const goldIconTexture = await Assets.load(C.REWARD_ICON_SRC.gold)
  if (isCancelled()) return null
  const trophyIconTexture = await Assets.load(C.REWARD_ICON_SRC.trophy)
  if (isCancelled()) return null
  const rpIconTexture = await Assets.load(C.REWARD_ICON_SRC.rp)
  if (isCancelled()) return null
  const rewardIconTextures: Record<RewardKind, Texture> = {
    gold: goldIconTexture,
    trophy: trophyIconTexture,
    rp: rpIconTexture,
  }

  return {
    hero: {
      idle: idleFrames,
      run: runFrames,
      jump: jumpFrames,
      land: landFrames,
      attack: attackFrames,
      drink: drinkFrames,
      hurt: hurtFrames,
      death: deathFrames,
      cast: castFrames,
      dash: dashFrames,
    },
    beast: {
      idle: beastIdleFrames,
      walk: beastWalkFrames,
      attack: beastAttackFrames,
      hurt: beastHurtFrames,
      death: beastDeathFrames,
    },
    chest: chestFrames,
    chestTrap: chestTrapFrames,
    smuggler: smugglerFrames,
    obeliskIdle: obeliskIdleFrames,
    obeliskBurning: obeliskBurningFrames,
    boss: bossFramesByKind,
    bossSpikeTexture,
    bossSpikeImpactFrames,
    bossWaveLeftFrames,
    bossWaveRightFrames,
    healAura: healAuraFrames,
    slashStreak: slashStreakFrames,
    fireballProjectile: fireballProjectileFrames,
    fireballImpact: fireballImpactFrames,
    iceballProjectile: iceballProjectileFrames,
    iceballImpact: iceballImpactFrames,
    rewardIcons: rewardIconTextures,
  }
}
