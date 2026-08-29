// Константы верхнего уровня, вынесенные из Explore.tsx (механический перенос).
import type { BackdropPreset } from '../mapRenderer'
import type { BossAnimKind, RewardKind, EventKind } from './types'

export const DEFAULT_MAP_FILE = 'map_A_serpentine.txt'

// Фон по карте — фиксированный выбор пресета под тему каждой карты.
export const BACKDROP_BY_MAP: Record<string, BackdropPreset> = {
  A: 'graveyard',      // Серпантин — открытый подъём, землистые тона
  B: 'flooded_crypt',  // Разлом — тесный тёмный низ
  C: 'throne_room',    // Спуск к боссу — драматичная арена
  D: 'flooded_crypt',  // Тайник — подвал Смуглера
  E: 'throne_room',    // Башни — замковая архитектура
  F: 'graveyard',      // Святилище — алтарь и обелиски рифмуются со стелами
}

export const TILE_SIZE = 64
export const PLAYER_COLOR = 0xe0353b
// Финальные размеры хитбоксов — подобраны вживую отладочными слайдерами
// (убраны, см. историю), захардкожены сюда как обычные const.
export const PLAYER_WIDTH = 54
export const PLAYER_HEIGHT = 128
// Прыжковый боевой хитбокс (уязвимая зона игрока в воздухе, см.
// getPlayerCombatBox) — меньше обычного (ноги поджаты в позе прыжка), числа
// подобраны вживую отладочным тюнером (убран, см. историю).
export const JUMP_HIT_WIDTH = 54
export const JUMP_HIT_HEIGHT = 100
export const JUMP_HIT_OFFSET_Y = 40

// Визуал героя (спрайт поверх хитбокса-прямоугольника — см. HERO_IDLE_SRC
// ниже). Хитбокс/физика игрока (PLAYER_WIDTH/PLAYER_HEIGHT выше) НЕ меняются
// заменой визуала — прямоугольник остаётся, просто visible=false.
export const HERO_DRAW_H = 140 // высота отрисовки героя в пикселях мира (подбирается на глаз)
// Подстройка Y отрисовки спрайта (герой и враги) поверх найденной
// поверхности тайла (findGroundSurfaceY) — подобрана вживую отладочным
// тюнером, чтобы ноги ложились точно на пол.
export const FOOT_TUNE = 11
// Тот же способ формирования пути (BASE_URL), что у HP_FRAME_SRC — работает
// и на GitHub Pages с префиксом.
export const HERO_IDLE_SRC = `${import.meta.env.BASE_URL}assets/sprites/hero/idle.png`
export const HERO_RUN_SRC = `${import.meta.env.BASE_URL}assets/sprites/hero/run.png`
export const HERO_JUMP_SRC = `${import.meta.env.BASE_URL}assets/sprites/hero/jump.png`
export const HERO_ATTACK_SRC = `${import.meta.env.BASE_URL}assets/sprites/hero/attack.png`
export const HERO_HURT_SRC = `${import.meta.env.BASE_URL}assets/sprites/hero/hurt.png`
export const HERO_DEATH_SRC = `${import.meta.env.BASE_URL}assets/sprites/hero/death.png`
export const HERO_DRINK_SRC = `${import.meta.env.BASE_URL}assets/sprites/hero/drink.png`
// Все 7 листов героя пересобраны в ЕДИНУЮ клетку — одна пара констант вместо
// разных ширин на каждую анимацию (было 338/379/315/302/313). Только герой —
// зверь (BEAST_*) остаётся на своей клетке 600×288, не путать.
export const HERO_CELL_W = 394
export const HERO_CELL_H = 296

// Спрайты зверя (Шаг "спрайт зверя, без AI/флипа") — тот же способ пути
// (BASE_URL) и тот же loadSheetFrames (12 колонок в ряд), что у героя выше.
// Высота клетки везде 288 (как у героя), НО ширина клетки разная по анимациям
// (idle/attack/hurt — 481, walk — 418, death — 537) — не сводить к одной
// общей ширине, каждая грузится своим cellW (см. loadSheetFrames-вызовы ниже).
export const BEAST_IDLE_SRC = `${import.meta.env.BASE_URL}assets/sprites/beast/idle.png`
export const BEAST_WALK_SRC = `${import.meta.env.BASE_URL}assets/sprites/beast/walk.png`
export const BEAST_ATTACK_SRC = `${import.meta.env.BASE_URL}assets/sprites/beast/attack.png`
export const BEAST_HURT_SRC = `${import.meta.env.BASE_URL}assets/sprites/beast/hurt.png`
export const BEAST_DEATH_SRC = `${import.meta.env.BASE_URL}assets/sprites/beast/death.png`
// Высота отрисовки зверя в пикселях мира (по образцу HERO_DRAW_H выше) —
// уменьшено на 30% (было 180) по правке размера. Масштаб спрайта = эта
// константа / 288 (высота клетки, одна и та же для всех анимаций зверя) —
// см. применение в spawnEnemy, размер нигде не хардкодится мимо неё.
export const BEAST_CELL_RENDER_H = 126
// Босс (карта C, ФАЗА 1) — высота отрисовки в мировых px и доп. сдвиг сверх
// найденной поверхности пола (findGroundSurfaceY), см. applyBossLayout ниже.
// Подобраны вживую отладочным тюнером (убран, см. историю), теперь обычные
// const — тот же смысл, что у BEAST_CELL_RENDER_H/FOOT_TUNE выше.
export const BOSS_DRAW_H = 240
export const BOSS_OFFSET_Y = -2
// idle зверя — 24 кадра, полный цикл дыхания ~2.4с (медленно, спокойно):
// 24 кадра / 2.4с = 10 кадров/сек, AnimatedSprite.animationSpeed — доля от
// 60 кадров/сек тикера (тот же способ проигрывания, что у героя — play() +
// общий Ticker, без ручного продвижения кадров).
export const BEAST_IDLE_ANIM_SPEED = 10 / 60
// walk — та же анимация в патруле и в погоне, только СКОРОСТЬ проигрывания
// разная (лап нет отдельного run-спрайта): в патруле спокойнее, в погоне
// заметно чаще — выбор между ними идёт по уже существующему признаку
// aggroed (тот же, что решает патруль/погоня в самом AI, см. ticker).
export const WALK_ANIM_PATROL = 0.2
// Поднято вместе с ENEMY_CHASE_SPEED (сейчас 1.6→1.9, ×1.19), чтобы темп лап
// не "пробуксовывал" при более быстром перемещении в погоне: 0.57×1.19≈0.68.
export const WALK_ANIM_CHASE = 0.68

// Босс (карта C) — все 8 листов ПЕРЕСОБРАНЫ на ОБЩИЙ пиксельный масштаб
// персонажа (см. задачу) — больше нет одной общей BOSS_CELL_W/BOSS_CELL_H:
// у каждого листа своя клетка ШxВ, своё число колонок И свой якорь (и
// anchor.x, И anchor.y — см. BOSS_ANCHOR_X/BOSS_ANCHOR_Y ниже). Путать с
// зверем (BEAST_*, клетка 600×288, общая на все анимации) нельзя.
export const BOSS_IDLE_SRC = `${import.meta.env.BASE_URL}assets/sprites/boss/Boss_Idle.png`
export const BOSS_IDLE_CELL_W = 187
export const BOSS_IDLE_CELL_H = 287
export const BOSS_IDLE_COUNT = 24
export const BOSS_IDLE_COLS = 12
// Idle — ПИНГ-ПОНГ: встык (кадр 23 -> кадр 0) цикл дыхания не сходится, шов
// виден на глаз — вместо loop=true на сыром листе кадры 0..23 достраиваются
// кадрами 22..1 в обратном порядке (см. сборку bossIdleFrames в setup()).
export const BOSS_IDLE_ANIM_SPEED = 0.15

export const BOSS_WALK_SRC = `${import.meta.env.BASE_URL}assets/sprites/boss/Boss_Walk.png`
export const BOSS_WALK_CELL_W = 231
export const BOSS_WALK_CELL_H = 283
export const BOSS_WALK_COUNT = 24
export const BOSS_WALK_COLS = 12

export const BOSS_MELEE_SRC = `${import.meta.env.BASE_URL}assets/sprites/boss/Boss_Melee.png`
export const BOSS_MELEE_CELL_W = 345
export const BOSS_MELEE_CELL_H = 345
export const BOSS_MELEE_COUNT = 24
export const BOSS_MELEE_COLS = 11 // НЕ 12 — пересборка сменила и cols

export const BOSS_MELEE2_SRC = `${import.meta.env.BASE_URL}assets/sprites/boss/Boss_Melee2.png`
export const BOSS_MELEE2_CELL_W = 679
export const BOSS_MELEE2_CELL_H = 469
export const BOSS_MELEE2_COUNT = 37
export const BOSS_MELEE2_COLS = 5 // НЕ 12 — единственный лист с 5 колонками в ряд

// Ranged — лист, в отличие от Idle/Walk/Melee/Melee2/Hurt/Death, НЕ приведён
// к общему пиксельному масштабу персонажа — исходные размеры как есть,
// компенсируется константами BOSS_SCALE_FIX_RANGED/BOSS_ANCHOR_X_RANGED/
// BOSS_ANCHOR_Y_RANGED (подобраны живым тюнером, см. applyBossLayout ниже —
// тюнер убран), пока лист не перегенерят/не пересоберут в масштаб остальных.
export const BOSS_RANGED_SRC = `${import.meta.env.BASE_URL}assets/sprites/boss/Boss_Ranged.png`
export const BOSS_RANGED_CELL_W = 297
export const BOSS_RANGED_CELL_H = 328
export const BOSS_RANGED_COUNT = 24
export const BOSS_RANGED_COLS = 12
// Stomp (ФАЗА 4, шаг 1, см. задачу) — подключена анимация топота, БЕЗ волны/
// урона (только console.log на кадре удара — см. ticker). Клетка 298×378
// измерена по самому файлу (лист 3576×756, 12 колонок, 2 ряда) — В CLAUDE.md
// указано неверное 221×288, это ошибка документации, не бери оттуда.
export const BOSS_STOMP_SRC = `${import.meta.env.BASE_URL}assets/sprites/boss/Boss_Stomp.png`
export const BOSS_STOMP_CELL_W = 298
export const BOSS_STOMP_CELL_H = 378
export const BOSS_STOMP_COUNT = 24
export const BOSS_STOMP_COLS = 12
export const BOSS_STOMP_STRIKE_FRAME = 7 // удар лапами о землю
export const BOSS_STOMP_COOLDOWN_MS = 5000
export const BOSS_STOMP_MIN_TILES = 3 // дальше этого — может топнуть (волне нужно время докатиться)

// AoE-волны топота (см. задачу) — ДВЕ независимые головки (влево/вправо),
// спавнятся на BOSS_STOMP_STRIKE_FRAME. Уклонение ТОЛЬКО прыжком (см. ticker
// — dodgeIframeRef здесь НЕ учитывается, в отличие от шипа).
export const BOSS_WAVE_SRC = `${import.meta.env.BASE_URL}assets/vfx/Boss_Wave.png`
export const BOSS_WAVE_CELL_W = 280
export const BOSS_WAVE_CELL_H = 153
export const BOSS_WAVE_COUNT = 8
export const BOSS_WAVE_COLS = 8
export const BOSS_WAVE_DAMAGE = 16
export const BOSS_WAVE_SPEED = 300 // px/сек
export const BOSS_WAVE_DRAW_H = 100 // высота отрисовки в мире
export const BOSS_WAVE_DRAW_W = BOSS_WAVE_DRAW_H * (BOSS_WAVE_CELL_W / BOSS_WAVE_CELL_H) // пропорция листа
export const BOSS_WAVE_LIFETIME_MS = 4000
export const BOSS_WAVE_ANIM_SPEED = 0.2
// Обе дуги нарисованы в ОДНОЙ клетке (лист даёт пару "влево+вправо" сразу) —
// клетка режется пополам по пустому промежутку между ними, каждой волне
// достаётся своя половина (см. загрузку/spawnBossWave ниже), иначе 2 спавна
// дают 4 видимые дуги.
export const BOSS_WAVE_SPLIT_X = 107 // граница между дугами в клетке
export const BOSS_WAVE_ANCHOR_Y = 0.895 // низ дуги нарисован на y=137 из 153, не у края кадра

export const BOSS_HURT_SRC = `${import.meta.env.BASE_URL}assets/sprites/boss/Boss_Hurt.png`
export const BOSS_HURT_CELL_W = 220
export const BOSS_HURT_CELL_H = 286
export const BOSS_HURT_COUNT = 31
export const BOSS_HURT_COLS = 12 // было 16 у старого листа — пересборка сменила и cols

export const BOSS_DEATH_SRC = `${import.meta.env.BASE_URL}assets/sprites/boss/Boss_Death.png`
export const BOSS_DEATH_CELL_W = 355
export const BOSS_DEATH_CELL_H = 298
export const BOSS_DEATH_COUNT = 46
export const BOSS_DEATH_COLS = 11 // НЕ 12 — пересборка сменила и cols

export const BOSS_ANCHOR_X: Record<BossAnimKind, number> = {
  idle: 0.4064,
  walk: 0.4719,
  melee: 0.5391,
  melee2: 0.6127,
  hurt: 0.4818,
  death: 0.5183,
  // ranged — статический дефолт для Record-полноты/самого первого кадра до
  // первого тика applyBossLayout; реально применяется BOSS_ANCHOR_X_RANGED
  // (см. константы выше и applyBossLayout ниже), не это значение.
  ranged: 0.5926,
  // stomp (ФАЗА 4, шаг 1, см. задачу) — ПРИБЛИЗИТЕЛЬНОЕ, не измерено/не
  // подгонялось тюнером (задачи на это не было) — визуально проверить и
  // зафиксировать точным числом при подключении волны (следующий шаг).
  stomp: 0.5,
}
export const BOSS_ANCHOR_Y: Record<BossAnimKind, number> = {
  idle: 0.9826,
  walk: 0.9788,
  melee: 0.9855,
  melee2: 0.8380,
  hurt: 0.9825,
  death: 0.9329,
  // ranged — см. комментарий у BOSS_ANCHOR_X.ranged выше, тот же смысл.
  ranged: 0.9848,
  // stomp — см. комментарий у BOSS_ANCHOR_X.stomp выше, тот же смысл.
  stomp: 0.98,
}

// Speed/loop на анимацию (см. playBossAnim) — idle пинг-понг и walk цикл
// вперёд крутятся, melee/melee2/hurt/death/ranged/stomp разовые. Скорости —
// ПРЕДВАРИТЕЛЬНЫЕ (нет привязки к strike-кадрам/таймингам AI, это будущая
// фаза) — только чтобы переключатель на этом шаге отличал анимации на глаз.
export const BOSS_ANIM_SPEED: Record<BossAnimKind, number> = {
  idle: BOSS_IDLE_ANIM_SPEED,
  walk: 0.2,
  melee: 0.4,
  melee2: 0.35,
  // hurt — ускорено (см. задачу, "починка стан-лока" + баланс): кадры (31)
  // НЕ обрезаны, ускорено только проигрывание. 2.07 даёт BOSS_HURT_MS
  // ≈250мс (см. формулу ниже).
  hurt: 2.07,
  death: 0.3,
  // ranged — ПРЕДВАРИТЕЛЬНО, как melee/melee2 (см. задачу, п.2 — броска/AI
  // ещё нет, важно только чтобы анимацию было видно на глаз).
  ranged: 0.35,
  // stomp — ПРЕДВАРИТЕЛЬНО, тем же приёмом, что и у ranged на его первом шаге.
  stomp: 0.35,
}
export const BOSS_ANIM_LOOP: Record<BossAnimKind, boolean> = {
  idle: true,
  walk: true,
  melee: false,
  melee2: false,
  hurt: false,
  ranged: false,
  stomp: false,
  death: false,
}

// Босс (карта C, ФАЗА 2, шаг 3, см. задачу) — урон/HP/hurt, ещё БЕЗ AI/атак.
export const BOSS_MAX_HP = 300 // было 200, баланс — порог стадии 2 (50%) теперь 150
// Хитстан ЖЁСТКО выведен из длины/скорости hurt-листа босса (31 кадр,
// BOSS_ANIM_SPEED.hurt) — та же причина, что у ENEMY_HURT_MS выше: иначе
// таймер и анимация могли бы разъехаться (таймер истёк бы раньше конца
// анимации, т.к. лист/скорость у босса другие, чем у зверя). Poise/анти-
// стан-лок у босса — СВОИ константы BOSS_STUN_LIMIT/BOSS_POISE_IMMUNE_MS
// (см. ниже), не POISE_POINT/STUN_LIMIT/POISE_IMMUNE_MS зверя — те не
// подходят по смыслу (у босса нет фазы замаха, которую можно "не успеть
// пройти", см. применение в applyAttackHit).
export const BOSS_HURT_MS = (1000 * BOSS_HURT_COUNT) / (60 * BOSS_ANIM_SPEED.hurt)
// Стадии босса — переход считается ОДИН раз при первом пересечении порога
// вниз (см. boss.stage-гейт в applyAttackHit), не каждый кадр. Новых атак на
// этом шаге стадия 2 не даёт — только console.log, см. задачу.
export const BOSS_STAGE2_HP_RATIO = 0.5
// HP-бар босса — та же высота/зазор, что у зверя (ENEMY_HP_BAR_HEIGHT/
// ENEMY_HP_BAR_MARGIN, отдельных боссовых констант для них нет), но заметно
// ШИРЕ (ENEMY_WIDTH=116) и СВОЙ вертикальный отступ — босс визуально намного
// крупнее (BOSS_DRAW_H=240 против 126 у зверя).
export const BOSS_HP_BAR_WIDTH = 220
export const BOSS_HPBAR_OFFSET_Y = 30

// Босс (карта C, ФАЗА 2, шаг 4, см. задачу) — передвижение, ещё БЕЗ атак.
// Агро — больше, чем у зверя (AGGRO_RANGE_TILES=7): босс крупнее, площадка
// C просторнее, боссу нужно замечать героя издалека. Патруль НЕ делаем — вне
// агро босс просто стоит (см. задачу).
export const BOSS_AGGRO_RANGE_TILES = 20
// STOP_DISTANCE/MOVE_SPEED — зафиксированы после подбора живым тюнером
// (тюнер убран, см. историю — та же судьба, что у BOSS_DRAW_H/BOSS_OFFSET_Y и
// BOSS_WIDTH/BOSS_HEIGHT).
export const BOSS_STOP_DISTANCE = 149
export const BOSS_MOVE_SPEED = 2.0
// Гистерезис остановки (см. задачу, п.5) — мёртвая зона вокруг STOP_DISTANCE:
// уже идущий босс тормозит РОВНО на STOP_DISTANCE, но снова трогается с
// места только когда игрок отошёл на STOP_DISTANCE + это число — без зазора
// на самой границе анимация walk/idle дёргалась бы каждый кадр.
export const BOSS_STOP_HYSTERESIS = 20

// Босс (карта C, ФАЗА 2, шаг 5, см. задачу) — ближний бой, 2 атаки. БЕЗ
// windup-фазы (в отличие от зверя выше) — атака стартует сразу по решению
// AI, как только босс СТОИТ (boss.moving===false, дошёл до BOSS_STOP_
// DISTANCE) и кулдаун истёк; сама анимация — единственный телеграф, урон —
// на конкретном кадре (strike-кадр), не по началу анимации и не по нажатию.
export const BOSS_MELEE_DAMAGE = 18
export const BOSS_MELEE_STRIKE_FRAME = 9
export const BOSS_MELEE2_DAMAGE = 26
export const BOSS_MELEE2_STRIKE_FRAME = 19
// RANGE/COOLDOWN — зафиксированы после подбора живым тюнером (тюнер убран,
// см. историю — та же судьба, что у BOSS_STOP_DISTANCE/BOSS_MOVE_SPEED).
export const BOSS_MELEE_RANGE = 160
export const BOSS_MELEE2_RANGE = 200
export const BOSS_ATTACK_COOLDOWN_MS = 600

// Босс (карта C, ФАЗА 2, шаг 5 — починка стан-лока, см. задачу) — ДВА слоя
// защиты от бесконечного затыкания хитстаном:
// СЛОЙ 1 (главный) — пока boss.attackAnimPlaying, Hurt не проигрывается
// ВООБЩЕ, ни на каком кадре, независимо от poise (см. applyAttackHit) —
// атака всегда доигрывает до конца и до кадра урона. Урон при этом
// проходит нормально (hp/HP-бар), обратная связь — короткая красная
// вспышка спрайта (BOSS_HIT_FLASH_MS, tint) вместо хитстана.
export const BOSS_HIT_FLASH_MS = 120
// СЛОЙ 2 — тот же механизм накопительного стан-резиста, что у зверя
// (см. STUN_LIMIT/POISE_IMMUNE_MS выше и применение в applyAttackHit), но
// СВОИМИ константами и ТОЛЬКО пока босс НЕ атакует (см. слой 1 — во время
// атаки этот слой не участвует вообще, там просто нет хитстана). У босса
// порог выше и иммунитет дольше — крупный враг, HP-бар большой.
export const BOSS_STUN_LIMIT = 3 // у зверя 2
export const BOSS_POISE_IMMUNE_MS = 1500 // у зверя 1200

// Ranged — числа подобраны живым тюнером (убран, см. историю выше), та же
// судьба, что у прежних боевых тюнеров до их фиксации. Лист Boss_Ranged не
// приведён к общему масштабу — BOSS_SCALE_FIX_RANGED умножает базовый scale
// в applyBossLayout ТОЛЬКО пока активна анимация ranged, BOSS_ANCHOR_X_RANGED/
// BOSS_ANCHOR_Y_RANGED там же подменяют якорь.
export const BOSS_SCALE_FIX_RANGED = 1.0
export const BOSS_ANCHOR_X_RANGED = 0.593
export const BOSS_ANCHOR_Y_RANGED = 0.985

// Ranged — условия броска и сам бросок (ФАЗА 3, см. задачу): доступен С
// ПЕРВОЙ стадии (в отличие от Melee2), СТОЛЬКО ЖЕ высокий приоритет, что у
// Melee/Melee2 — ВЫШЕ hurt, доигрывает до конца, не прерывается (тот же
// слой 1, см. applyAttackHit). Ближе BOSS_RANGED_MIN_TILES босс броском не
// пользуется — идёт в ближний бой (см. AI-гейт в ticker'е). Снаряд создаётся
// на кадре выпуска (см. spawnBossSpike в ticker'е, ФАЗА 3 шаг 2).
export const BOSS_RANGED_MIN_TILES = 6
export const BOSS_RANGED_COOLDOWN_MS = 1500
export const BOSS_RANGED_RELEASE_FRAME = 20
export const BOSS_RANGED_DOUBLE_CHANCE = 0.5 // шанс второго шипа

// Шип дальней атаки — снаряд + импакт (ФАЗА 3, шаг 2, см. задачу). Траектория
// ПРЯМАЯ горизонтальная, снаряд НЕ вращается. Импакт при попадании
// обязателен — вблизи иначе непонятно, откуда урон (см. задачу).
export const BOSS_RANGED_DAMAGE = 14
export const BOSS_SPIKE_SPEED_X = 700 // горизонтальная скорость, px/сек
export const BOSS_SPIKE_GRAVITY = 1400 // ускорение вниз, px/сек^2
export const BOSS_SPIKE_SRC = `${import.meta.env.BASE_URL}assets/objects/Boss_Spike.png`
export const BOSS_SPIKE_DRAW_W = 90 // ширина отрисовки в мире
export const BOSS_SPIKE_DRAW_H = 30 // 90 * 67/200, сохраняет пропорции
// Точка вылета — кисть на кадре 20 листа Boss_Ranged.png, доля ширины/высоты
// клетки (не хитбокса — см. spawnBossSpike, считается от трансформа спрайта).
export const BOSS_SPIKE_HAND_X = 0.061 // центр кисти, доля ширины клетки
export const BOSS_SPIKE_HAND_Y = 0.376 // центр кисти, доля высоты клетки
export const BOSS_SPIKE_LIFETIME_MS = 2500
export const BOSS_SPIKE_IMPACT_SRC = `${import.meta.env.BASE_URL}assets/vfx/Boss_Spike_Impact.png`
export const BOSS_SPIKE_IMPACT_CELL_W = 347
export const BOSS_SPIKE_IMPACT_CELL_H = 369
export const BOSS_SPIKE_IMPACT_COUNT = 20
export const BOSS_SPIKE_IMPACT_COLS = 10 // НЕ 12 — у этого листа своя раскладка
export const BOSS_SPIKE_IMPACT_DRAW_H = 130
export const BOSS_SPIKE_IMPACT_ANIM_SPEED = 0.3 // разовая, тайминг-константы нет — на глаз

// Сундук (reward-событие) — ТОЛЬКО визуал на этом шаге: статичный кадр 0
// (закрыт) поверх прежнего маркера-хитбокса касания, без анимации открытия
// и без награды (см. задачу). Путь — тот же способ (BASE_URL), что у героя/
// зверя выше.
export const CHEST_OPEN_SRC = `${import.meta.env.BASE_URL}assets/objects/Chest_Open.png`
// Высота отрисовки сундука в пикселях мира (по образцу HERO_DRAW_H/
// BEAST_CELL_RENDER_H выше). Ширина считается пропорционально от исходных
// 140×178. Числа подобраны вживую отладочным тюнером (убран, см. историю).
export const CHEST_DRAW_H = 90
// Доп. вертикальный сдвиг спрайта сверх floorY (findGroundSurfaceY) — тот же
// смысл, что FOOT_TUNE у героя/врагов, но своё число: сундук ниже к земле.
export const CHEST_OFFSET_Y = 27
// Ширина хитбокса-стены сундука (мягкая стена по X, см. pushPlayerOutX).
// Числа подобраны вживую отладочным тюнером (убран, см. историю).
export const CHEST_WALL_W = 40
// Скорость анимации Chest_Open (открытие ударом, см. applyAttackHit) — было
// 0.25 "на глаз", слишком быстро.
export const CHEST_ANIM_SPEED = 0.15

// Мимик — бросок решается ОДИН раз на первом ударе по сундуку (см.
// applyAttackHit): CHEST_MIMIC_CHANCE шанс, что сундук окажется ловушкой
// (Chest_Trap_Explode, урон, без награды) вместо доброго (Chest_Open).
export const CHEST_TRAP_SRC = `${import.meta.env.BASE_URL}assets/objects/Chest_Trap_Explode.png`
export const CHEST_MIMIC_CHANCE = 0.2
export const CHEST_TRAP_DAMAGE_FRAC = 0.2 // урон мимика — 20% maxHp, без уклонения
export const CHEST_TRAP_STRIKE_FRAME = 5 // кадр взрыва (0-based) в Chest_Trap_Explode
export const CHEST_TRAP_ANIM_SPEED = 0.15 // как у CHEST_ANIM_SPEED
// Посадка ловушки — своя высота/оффсет (не CHEST_DRAW_H/CHEST_OFFSET_Y):
// Chest_Trap_Explode (190×137) имеет другую пропорцию кадра, чем Chest_Open
// (140×178), числа подобраны вживую временным тюнером (убран, см. историю).
export const CHEST_TRAP_DRAW_H = 76
export const CHEST_TRAP_OFFSET_Y = 10

// Смуглер (NPC-событие) — на этом шаге ТОЛЬКО визуал: стоит и дышит (idle),
// без взаимодействия (см. задачу) — обмен/диалог будет отдельным шагом.
// Путь — тот же способ (BASE_URL), что у сундука/героя/зверя выше.
export const SMUGGLER_SRC = `${import.meta.env.BASE_URL}assets/sprites/smuggler/smuggler_idle.png`
// Высота отрисовки, ширина — из клетки 230×296 (по образцу CHEST_DRAW_H).
// Числа подобраны вживую отладочным тюнером (убран, см. историю).
export const SMUGGLER_DRAW_H = 148
export const SMUGGLER_OFFSET_Y = 12
export const SMUGGLER_ANIM_SPEED = 0.15
// Поворот к игроку (см. ticker) — смотрит в сторону игрока, только пока тот
// в пределах TURN_RANGE; дальше — держит последнее направление (не дёргается).
export const SMUGGLER_TURN_RANGE = TILE_SIZE * 4
// Дальность взаимодействия (dodge рядом со смуглером открывает панель) —
// подберём при желании позже.
export const SMUGGLER_INTERACT_RANGE = TILE_SIZE * 2

// Обелиски (карта F)
export const OBELISK_IDLE_SRC = `${import.meta.env.BASE_URL}assets/objects/Obelisk_Idle.png`
export const OBELISK_BURNING_SRC = `${import.meta.env.BASE_URL}assets/objects/Obelisk_Burning.png`
export const OBELISK_FRAME_W = 190
export const OBELISK_FRAME_H = 512
export const OBELISK_IDLE_COUNT = 10
export const OBELISK_BURNING_COUNT = 10
export const OBELISK_DRAW_H = 195
export const OBELISK_OFFSET_Y = 18
export const OBELISK_HITBOX_W = 40
export const OBELISK_ANIM_SPEED = 0.12
export const OBELISK_TOTAL = 4 // всего обелисков за событие (1 стартовый + 3)
export const OBELISK_TIME_MS = 30000 // стартовый таймер после первого удара
export const OBELISK_TIME_BONUS_MS = 15000 // добавка к таймеру за каждый следующий удар
// Дисплейный шрифт HUD-таймера обелисков (Cinzel, подключён через <link> в
// index.html) — Georgia в fallback ОБЯЗАТЕЛЬНА: без неё до загрузки шрифта
// цифры сначала рисуются системным sans и "прыгают" в размере при подмене.
export const FONT_DISPLAY = "'Cinzel', Georgia, serif"
// Размеры окна обмена (мировые единицы, до зума worldContainer) и его кнопок.
// Ширина 300 — под самый длинный текст заголовка ("Контрабандист предлагает
// обмен") с полями ~16px по краям, было 220 — обрезалось.
export const SMUGGLER_PANEL_W = 300
export const SMUGGLER_PANEL_H = 120
export const SMUGGLER_BTN_W = 90
export const SMUGGLER_BTN_H = 34
export const SMUGGLER_BTN_GAP = 16
// Поле от края экрана при зажатии окна в границах вьюпорта (см. ticker).
export const SMUGGLER_PANEL_MARGIN = 8
// Логика обмена (см. кнопку "Обменять") — Explore офлайн, трофеи нигде не
// начисляются/списываются по-настоящему, только визуальный float. Реальный
// счёт трофеев — Phase 2.5.
export const SMUGGLER_TEST_TROPHIES = 10 // заглушка "было"
export const SMUGGLER_MULT = 1.5 // множитель при успехе
export const SMUGGLER_STEAL_CHANCE = 0.2 // шанс кражи
export const SMUGGLER_STEAL_FRAC = 0.5 // доля кражи (половина)

export const REWARD_ICON_SRC: Record<RewardKind, string> = {
  gold: `${import.meta.env.BASE_URL}assets/icons/icon_gold.png`,
  trophy: `${import.meta.env.BASE_URL}assets/icons/icon_trophy.png`,
  rp: `${import.meta.env.BASE_URL}assets/icons/icon_rp.png`,
}
// Цвета текста — дизайн-система (right-place-design): gold/trophy/rp разными
// оттенками, чтобы попап читался по типу награды без подписи.
export const REWARD_TEXT_COLOR: Record<RewardKind, number> = {
  gold: 0xe8b23a,
  trophy: 0xc0653a,
  rp: 0xf08a24,
}
export const REWARD_FLOAT_MS = 2000
export const REWARD_FLOAT_RISE = 45 // px всплытия за REWARD_FLOAT_MS
export const REWARD_ICON_H = 24 // высота отрисовки иконки, px мира
export const REWARD_ROW_GAP = 28 // вертикальный интервал между наградами в столбике

// Трофеи за события (см. задачу) — общая формула, множитель применяется
// снаружи (TROPHY_MULT_ENEMY и будущие TROPHY_MULT_* для других событий).
export const TROPHY_BASE = 12.5
export const TROPHY_LEVEL_POWER = 0.446
export const TROPHY_SPREAD = 0.4 // разброс +-20%
export const PLAYER_LEVEL_FALLBACK = 1 // ВРЕМЕННО: уровень в Explore пока

export const TROPHY_MULT_ENEMY = 1
export const TROPHY_MULT_CHEST = 3
export const TROPHY_MULT_OBELISK = 2
export const TROPHY_MULT_BOSS = 4

// Прыжок пока БЕЗ проигрывания — статичная поза по вертикальной скорости
// (взлёт/падение), см. использование в тикере. Индексы 0-based.
export const RISE_FRAME = 9 // кадр 10 = взлёт
export const FALL_FRAME = 14 // кадр 15 = падение
// У кадров взлёта/падения ноги подняты внутри клетки — якорь ниже, чем у
// idle/run (GROUND_ANCHOR_Y=1.0), иначе герой "проваливается" визуально.
export const RISE_ANCHOR_Y = 0.729
export const FALL_ANCHOR_Y = 0.816
export const GROUND_ANCHOR_Y = 1

// Land — короткая анимация приземления, играется один раз при касании земли
// (см. landTimerRef), прерывается движением/прыжком. Подпоследовательность
// последних кадров jumpFrames (индексы 17..23), не отдельный спрайт-лист.
export const LAND_MS = 260

// Атака — урон теперь привязан к КАДРУ анимации (см. applyAttackHit в setup),
// не к моменту нажатия. Индекс 0-based.
export const ATTACK_STRIKE_FRAME = 6 // 7-й кадр из 14 — момент удара
export const ATTACK_ANIM_SPEED = 0.5

// Hurt — хардкор-вариант: обрывает собственный замах атаки (хитстан) и на
// это время блокирует начало новой атаки (см. triggerHurt/attackPressedRef).
export const HURT_MS = 350
export const HURT_ANIM_SPEED = 0.45

// Смерть — играется один раз, последний кадр держится DEATH_HOLD_MS, потом
// тот же abandon, что раньше срабатывал сразу при hp<=0 (см. triggerDeath).
export const DEATH_HOLD_MS = 500
export const DEATH_ANIM_SPEED = 0.4

export const HP_PER_ENDURANCE = 8 // как в бою: 1 Endurance = 8 HP
export const FALLBACK_MAX_HP = 80 // если endurance ещё не прокинут/недоступен

// Арт-плита HP-бара (каменная оправа с портретом героя + тёмная ниша под
// полосу + 3 гнезда под иконки событий). Ширина отрисовки — доля экрана с
// потолком/полом в px, чтобы не раздувался гигантским на широких экранах;
// высота — из пропорции картинки. Все числа ниже подобраны вживую временным
// тюнером (снят после подгонки).
export const HP_FRAME_SRC = `${import.meta.env.BASE_URL}assets/hp_frame_v2.png`
export const HP_FRAME_ASPECT = 1 / 2.391 // height/width исходного PNG
export const PLAQUE_VW = 40
export const HP_FRAME_W = `clamp(160px, ${PLAQUE_VW}vw, 340px)`
// Высота — тем же выражением, что и ширина, умноженным на аспект: НЕ через
// CSS aspect-ratio. aspect-ratio даёт контейнеру "auto"-высоту для целей
// разрешения %-высоты/позиции АБСОЛЮТНО спозиционированных детей в part
// WebView (Android system WebView в Telegram) — из-за этого fill-полоса
// внутри окна теряла привязку и вылезала за рамку. calc() даёт контейнеру
// РЕАЛЬНУЮ пиксельную высоту, поэтому left/top/width/height потомков в %
// считаются от неё однозначно во всех движках.
export const HP_FRAME_H = `calc(${HP_FRAME_W} * ${HP_FRAME_ASPECT})`
// Окно под полосу HP внутри плиты — доли (0..1) от размера ВСЕЙ картинки,
// не пиксели, чтобы не зависеть от масштаба отрисовки (см. HP_FRAME_W).
export const HP_WINDOW_X = 0.395
export const HP_WINDOW_Y = 0.24
export const HP_WINDOW_W = 0.56
export const HP_WINDOW_H = 0.215
// Число HP — центр ниши, отдельные доли (не строго X+W/2 — подобрано глазом).
export const HPTXT_X = 0.685
export const HPTXT_Y = 0.345
// 3 гнезда под иконки событий — общий Y и размер (доля ширины плиты), у
// каждого гнезда свой X.
export const SOCK_Y = 0.79
export const SOCK_SIZE = 0.185
export const SOCK_X: [number, number, number] = [0.484, 0.672, 0.859]

// Кольцо "событие завершено" на иконке — доли размера иконки (не гнезда).
// Диаметр = SOCK_SIZE(иконки)*RING_SCALE, центр смещён на (RING_DX,RING_DY).
export const RING_SCALE = 0.93
export const RING_W = 4
export const RING_DX = 0
export const RING_DY = -0.09

export const SPIKE_DAMAGE_RATIO = 0.5 // урон шипов — 50% от maxHp за касание
export const SPIKE_IFRAME_MS = 1000 // неуязвимость после касания шипов, мс
export const HAZARD_SPIKES_PER_RUN = 10 // сколько точек из hazard-пула ставим на карту за забег

// Зелье (Explore офлайн — заряды/кулдаун ТОЛЬКО локальные, currentRun/сервер
// не трогаем). Хил применяется один раз за питьё — на кадре глотка анимации
// (POTION_GULP_FRAME из 14 кадров drink.png), не на нажатии кнопки.
export const POTION_HEAL_FRAC = 0.25 // лечит 25% maxHp
export const POTION_COOLDOWN = 2.0 // секунды, тикает как ATTACK_COOLDOWN
export const POTION_GULP_FRAME = 6 // кадр глотка (0-based) в drink.png

// Атака игрока — изначально те же ПРАВИЛА И ЧИСЛА, что в Battle.tsx (общая
// ATTACK_RANGE=70 на игрока и врага), позже РАЗДЕЛЕНА на два независимых
// значения (подобраны вживую отладочными слайдерами, см. историю) —
// PLAYER_ATTACK_RANGE для хитбокса атаки игрока, ENEMY_ATTACK_RANGE для
// inMeleeReach (дальность удара врага). ATTACK_DAMAGE=15+floor(strength/2),
// ATTACK_COOLDOWN=0.5с (там cooldownLeft тоже тикает в секундах через
// ticker.deltaMS/1000).
export const PLAYER_ATTACK_RANGE = 56
// ATTACK_ACTIVE_MS — НОВОЕ, в Battle.tsx нет: там урон применяется мгновенно
// в момент нажатия (нет врага, по которому проверять позже), а тут хитбоксу
// нужно продержаться хоть сколько-то кадров, чтобы следующий шаг (враг/сундук)
// успел его проверить.
export const ATTACK_COOLDOWN = 0.5
export const ATTACK_ACTIVE_MS = 150

// Враг (Шаг 2-1) — пока НЕПОДВИЖНЫЙ прямоугольник-заглушка, спрайт зверя
// подключим отдельным шагом. Габариты — не из Battle.tsx (там это размер
// PixiJS-спрайта на весь экран боя, с тайлами Explore не сравнить напрямую),
// а по описанию "шире игрока, приземистый" (см. CLAUDE.md, Враг №1 "Зверь" —
// тяжёлый сгорбленный четвероногий монстр): шире игрока (1 тайл), ниже его
// (2 тайла). Финальные числа — подобраны вживую отладочными слайдерами.
export const ENEMY_WIDTH = 116
export const ENEMY_HEIGHT = 80
export const ENEMY_COLOR = 0x4a3728
// Хитбокс босса (ФАЗА 2, шаг 2, см. задачу) — подобран вживую отладочным
// тюнером (убран, см. историю), теперь обычные const, как ENEMY_WIDTH/
// ENEMY_HEIGHT выше. Узкий и высокий (в отличие от приземистого зверя) —
// под позу двуногого босса.
export const BOSS_WIDTH = 60
export const BOSS_HEIGHT = 214
// ENEMY_ATTACK_RANGE — дальность удара врага (inMeleeReach), см. комментарий
// про разделение ATTACK_RANGE выше.
export const ENEMY_ATTACK_RANGE = 92
export const PUSH_TOP_MARGIN = 0.35
// доля высоты врага сверху, которую НЕ считаем телом для бокового упора:
// если ноги игрока выше этой линии — считаем перепрыгивание, упор не применяем
export const TOUCH_EPS = 4
// пикселей допуска для bodiesTouchingX — выталкивание ставит игрока РОВНО
// в edge-to-edge позицию (phys.x + PLAYER_WIDTH === enemy.x), строгое >
// в этой точке даёт false, замах не стартует (см. диагностику: touch=false
// при dist=80)
// BASE_ENEMY_HP обычного (не boss) врага из Battle.tsx — берём как есть, БЕЗ
// level-scaling (там `Math.round(BASE_ENEMY_HP * (1 + 0.18*(level-1)))` — в
// Explore пока нет level, это база "как в бою"; см. CLAUDE.md "normal 120HP".
export const ENEMY_MAX_HP = 120
export const ENEMY_HP_BAR_HEIGHT = 8
export const ENEMY_HP_BAR_MARGIN = 6 // зазор между полоской HP и головой врага
// Спрайт зверя (BEAST_CELL_RENDER_H) заметно выше хитбокса (ENEMY_HEIGHT) —
// этот сдвиг поднимает полоску HP выше верха спрайта (спины/головы), а не в
// его середину; ENEMY_HP_BAR_MARGIN сверху даёт небольшой зазор поверх этого.
// Было 58 — висело слишком высоко над зверем, уменьшено вживую на глаз.
export const ENEMY_HPBAR_OFFSET_Y = 30

// AI зверя (Шаг 2-2) — числа из Battle.tsx (обычный враг, БЕЗ level-scaling —
// как и ENEMY_MAX_HP выше, в Explore пока нет level):
// - ENEMY_SPEED=1 px/кадр в Battle БЕЗ dt (там ticker вообще не масштабирует
//   движение врага по deltaTime) — здесь то же число, но умножаем на dt, как
//   уже сделано для игрока (MOVE_SPEED*dt).
// - ENEMY_ATTACK_INTERVAL=2с (обычный, не boss) — кулдаун МЕЖДУ атаками:
//   стартует ПОСЛЕ удара (см. ниже), не перед первым — см. настройку боя.
// - BASE_ENEMY_DAMAGE=14 (обычный, не boss) — урон удара, без dmgMultiplier
//   по той же причине (нет level).
// - ATTACK_RANGE переиспользуем как есть (см. выше) — в Battle.tsx ОДНА и та
//   же константа используется и для атаки игрока, и для дальности врага; это
//   по-прежнему радиус ПОПАДАНИЯ удара, отдельно от ATTACK_STOP_DIST ниже.
export const ENEMY_CHASE_SPEED = 1.9 // было 1.6 — погоня ещё быстрее (см. MOVE_SPEED игрока ниже)
// Шаг C "умного врага" — скорость патруля (когда НЕ агрён), медленнее погони.
// Зафиксирована ЧИСЛОМ (не как доля от ENEMY_CHASE_SPEED) — при полировке
// погони её трогать не просили, а множитель от ENEMY_CHASE_SPEED утянул бы
// её за собой молча.
export const ENEMY_PATROL_SPEED = 0.55

// Настройка боя (правки после первой версии AI):
// - ATTACK_STOP_DIST — НЕ из Battle: там 1D-дорожка со своим PLAYER_W-порогом,
//   здесь подобрано отдельно под ощущение боя в Explore — враг перестаёт
//   сближаться заметно РАНЬШЕ края ATTACK_RANGE (не долезает вплотную), но и
//   не останавливается на самом краю дальности (иначе от него легко отбежать
//   шагом) — ~64% от ATTACK_RANGE=70.
// - WINDUP_MS — заменяет прежний ENEMY_WINDUP_S (был 0.6с = 600мс), в мс (как
//   остальные *_MS-константы в файле), значение из разрешённого диапазона
//   задачи (600-700). Телеграф (см. tint ниже) остаётся видимым всё окно —
//   укоротили длительность, не тронув сам факт телеграфа.
//   ⚠️ Ощущение "замах ~2с" в исходной версии давала не длительность windup
//   (она и была 0.6с), а ENEMY_ATTACK_INTERVAL, накапливавшийся ДО первого
//   windup как пауза "подумать" — эта пауза убрана отдельно, см. ниже.
export const ATTACK_STOP_DIST = 45
export const WINDUP_MS = 650

// Attack-анимация зверя (24 кадра, 481×288, loop=НЕТ) — урон теперь наносится
// на strike-кадре анимации, а НЕ по истечении WINDUP_MS напрямую (см. ticker,
// как applyAttackHit у героя привязан к ATTACK_STRIKE_FRAME). Само число
// WINDUP_MS/урон/дистанция не меняются — подстраивается только скорость
// проигрывания, чтобы ВРЕМЯ до strike-кадра совпадало с прежним моментом
// удара (конец WINDUP_MS): BEAST_ATTACK_STRIKE_FRAME кадров при 60 кадров/сек
// тикере должны занять WINDUP_MS миллисекунд — отсюда animationSpeed ниже.
// Остаток анимации (24 - strike кадров) после этого — чисто визуальный довод
// лапы (follow-through), которого раньше не было (урон бил мгновенно).
export const BEAST_ATTACK_STRIKE_FRAME = 13
export const BEAST_ATTACK_ANIM_SPEED = BEAST_ATTACK_STRIKE_FRAME / (60 * (WINDUP_MS / 1000))

export const ENEMY_ATTACK_INTERVAL = 2
export const ENEMY_ATTACK_DAMAGE = 14

// Hurt-анимация зверя (12 кадров, 600×288, loop=НЕТ) — короткий читаемый
// хитстан. Скорость выбрана напрямую (~0.3-0.4с ощущается коротко и чётко),
// а сама длительность хитстана (ENEMY_HURT_MS) ЖЁСТКО выведена из неё же
// (12 кадров при этой скорости), а не задана вторым независимым числом —
// иначе таймер и анимация могли бы разъехаться, если один поправят без другого.
export const BEAST_HURT_ANIM_SPEED = 0.57
export const ENEMY_HURT_MS = (1000 * 12) / (60 * BEAST_HURT_ANIM_SPEED) // ≈351мс

// Death-анимация зверя (18 кадров, 600×288, 2 ряда, loop=НЕТ) — тяжёлое,
// небыстрое падение (~0.7-0.9с), НЕ мгновенное. DEATH_HOLD_MS (удержание
// последнего кадра перед удалением) — тот же общий с героем таймер выше.
export const BEAST_DEATH_ANIM_SPEED = 0.375 // 18 кадров / (60×0.375) = 0.8с

// "Точка невозврата" замаха — защита от stun-lock (см. применение в
// applyAttackHit): доля прогресса windup (0 = начало замаха, 1 = момент
// удара, см. enemy.windupTimer/WINDUP_MS), после которой урон по врагу
// больше НЕ прерывает его замах — тот доводит удар до конца как обычно.
// До этой точки — прерывает, как раньше. Крутить по ощущению.
export const POISE_POINT = 0.25

// Накопительный стан-резист — гарантия, что зверь прорвётся в атаку, даже
// если игрок ритмично сбивает КАЖДЫЙ замах в ранней фазе (POISE_POINT сам по
// себе этого не решает — см. описание задачи). После STUN_LIMIT сбитых замахов
// подряд враг получает POISE_IMMUNE_MS иммунитета к прерыванию (см. применение
// в applyAttackHit/ticker) — на это время он ведёт себя как в поздней фазе
// (COMMIT), независимо от POISE_POINT.
export const STUN_LIMIT = 2
export const POISE_IMMUNE_MS = 1200

// Шаг B "умного врага" — радиус агро. Враг преследует, только пока игрок И в
// пределах AGGRO_RANGE_TILES по X, И примерно на том же этаже по Y (разница
// не больше FLOOR_Y_TOLERANCE тайлов — допуск нужен для мелких перепадов в
// ±1 тайл, но прыжок на платформу выше/яма ниже уже считаются другим этажом).
// Сравниваем по ногам (y+height), а не по верхней точке — рост игрока и
// врага разный (128 vs 64), сравнение "потолка" тел давало бы системный сдвиг.
export const AGGRO_RANGE_TILES = 7 // было 8 — полировка, замечает игрока чуть позже
export const FLOOR_Y_TOLERANCE = 1.5

// Допуск sameFloor ДЛЯ АГРО (зверь И босс, см. задачу) — отдельная, более
// широкая константа, чем FLOOR_Y_TOLERANCE выше (которая держит смуглера/
// пороги обмена). FLOOR_Y_TOLERANCE=1.5 слишком узкая для агро: обычный
// прыжок героя поднимает его формально "на этаж выше", и враг терял цель
// (замирал) прямо во время погони. 2.5 тайла перекрывает высоту прыжка, не
// затирая сам смысл "другого этажа" (переход на платформу заметно выше).
export const SAME_FLOOR_TOLERANCE_TILES = 2.5

// Шаг C — патруль вокруг стартовой точки спавна (enemy.spawnX), когда враг НЕ
// агрён. Разворот на границе патруля, у стены '#' и у края платформы (в
// отличие от погони — в патруле с края НЕ падают, см. ниже в ticker'е).
export const PATROL_RANGE_TILES = 3.5

// Кнопка dodge (Шаг 2-2) — окно неуязвимости и кулдаун кнопки. НЕ из Battle.tsx:
// там dodge — не таймер неуязвимости, а мгновенная отмена текущего замаха
// врага (`enemyWindingUp = false`) БЕЗ какого-либо окна и БЕЗ кулдауна кнопки.
// Здесь по прямому заданию задачи — именно окно i-frames; длительность и
// кулдаун — в разрешённом задачей диапазоне (0.4-0.5с / "небольшой"), не
// перенесены из Battle, потому что там такого механизма попросту нет.
export const PLAYER_DODGE_IFRAME_MS = 450
export const PLAYER_DODGE_COOLDOWN_MS = 1000

// Физика (калибруется под модель прыжка из SKILL-maps: вверх 1 и вверх 2
// берутся, вверх 3 — нет; по прямой до 4 тайлов)
export const GRAVITY = 0.31 // было 0.8 — пересчитано под модель
export const MAX_FALL = 20
export const MOVE_SPEED = 4 // px/кадр, подберём на телефоне
export const JUMP_VELOCITY = 11.5 // сила толчка вверх (было 10, подобрано тюнером — тюнер убран)

export const CAMERA_V_ANCHOR = 0.65 // 0.5 = центр экрана, больше = игрок ниже
export const WORLD_SCALE = 0.55 // 1 = как сейчас, меньше = видно больше карты; зафиксировано после подбора тюнером

// Look-ahead камеры (только по X, см. updateCamera): целимся не в игрока,
// а в точку на LOOKAHEAD_TILES тайлов ВПЕРЕДИ по факту движения — видно
// больше пространства в ту сторону, куда бежит игрок.
export const LOOKAHEAD_TILES = 1.75
// Коэффициент сглаживания камеры (lerp за кадр, масштабирован по dt) — меньше
// = медленнее/плавнее, камера не прыгает к цели скачком.
export const SMOOTH = 0.055

export const EVENT_MARKER_COLOR: Record<EventKind, number> = {
  enemy: 0xe0353b,
  chest: 0xe8b23a,
  smuggler: 0x8fd9f0,
  puzzle: 0x46c4e8,
  boss: 0xf08a24,
  obelisk: 0xf08a24,
}

// Иконки HUD-прогресса событий — тот же способ формирования пути (BASE_URL),
// что у HP_FRAME_SRC, чтобы работало и на GitHub Pages с префиксом.
export const EVENT_ICON_SRC: Record<EventKind, string> = {
  enemy: `${import.meta.env.BASE_URL}assets/icons/event_enemy.png`,
  chest: `${import.meta.env.BASE_URL}assets/icons/event_chest.png`,
  smuggler: `${import.meta.env.BASE_URL}assets/icons/event_smuggler.png`,
  puzzle: `${import.meta.env.BASE_URL}assets/icons/event_puzzle.png`,
  boss: `${import.meta.env.BASE_URL}assets/icons/event_boss.png`,
  // Отдельной иконки для обелисков нет — переиспользуем event_puzzle.png
  // (та же роль "загадка", обелиски заменяют Puzzle на карте F).
  obelisk: `${import.meta.env.BASE_URL}assets/icons/event_puzzle.png`,
}

export const SETTINGS_ICON_SRC = `${import.meta.env.BASE_URL}assets/icons/event_settings.png`
// Размер/отступ кнопки-шестерёнки (см. её JSX ниже, width/right) — вынесены
// сюда, чтобы HUD обелисков (см. ниже) мог посчитать просвет между HP-плитой
// и шестерёнкой по РЕАЛЬНЫМ числам кнопки, а не задваивать их вручную.
export const SETTINGS_BTN_SIZE = 40
export const SETTINGS_BTN_RIGHT = 8

// Каменная рамка панели настроек — тот же способ пути (BASE_URL), что у
// HP_FRAME_SRC/EVENT_ICON_SRC. Вертикальная 3:4, реальный аспект картинки
// width/height = 0.767 (816×1064 px исходник).
export const SETTINGS_FRAME_SRC = `${import.meta.env.BASE_URL}assets/settings_frame.png`
export const SETTINGS_FRAME_ASPECT = 0.767 // width/height
export const SETTINGS_FRAME_H = 'clamp(340px, 70vh, 520px)'
export const SETTINGS_FRAME_W = `calc(${SETTINGS_FRAME_H} * ${SETTINGS_FRAME_ASPECT})`

export const EVENTS_PER_RUN = 3
// Шанс, что босс появится на карте C (см. задачу) — разыгрывается ОДИН раз
// при выборе chosenEvents, наравне с гарантией Контрабандиста на карте D
// OPEN; не выпало — босс не спавнится вообще (см. spawnBoss/bossRef ниже).
export const BOSS_SPAWN_CHANCE = 0.3
