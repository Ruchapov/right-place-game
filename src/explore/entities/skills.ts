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
// Dash_Strike), размеры сверены по заголовкам PNG. Грузится ПОКА только
// Heal_Aura (см. loadExploreAssets в ../assets.ts, HEAL_AURA_* в
// ../constants.ts) — остальные подключим вместе с их механикой.
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
  // внутри. Хитстан и прерывание замаха туда НЕ входят намеренно: они
  // относятся к удару мечом, а периодический урон (кровотечение) не должен
  // станить цель каждым тиком.
  damageEnemy: (enemy: Enemy, amount: number, accumulator: MutableRefObject<number>) => boolean
  damageBoss: (amount: number, accumulator: MutableRefObject<number>) => boolean
  // Аккумулятор урона СКИЛЛОВ (Explore.tsx: skillDamageDealtRef) — растит
  // ловкость на сервере, отдельно от attackDamageDealtRef, который растит
  // силу. Передаётся третьим аргументом в damageEnemy/damageBoss выше.
  skillDamageDealt: MutableRefObject<number>

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
  // Гейты "сказать один раз": без них ошибки сыпались бы каждое нажатие.
  let missingFramesLogged = false
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
    // Остальные четыре пока не реализованы (см. задачу) — тихо, это ожидаемое
    // состояние, а не ошибка: id известный, механики просто ещё нет.
    if (id !== 'heal') return
    // Кулдаун — тоже тихо: нормальное состояние игры.
    if (healCdMs > 0) return
    castHeal()
  }

  // dt — МИЛЛИСЕКУНДЫ (ticker.deltaMS), тот же выбор единиц, что уже
  // используют bossSpikesRef/bossWavesRef/rewardFloatsRef в Explore.tsx
  // (lifeMs/elapsed копятся в мс, а не в frame-scale ticker.deltaTime,
  // которым масштабируется движение phys).
  function update(dt: number) {
    // Кулдауны тикают ВСЕГДА, независимо от нажатий.
    healCdMs = Math.max(0, healCdMs - dt)

    if (deps.skill1Pressed.current) pressSlot(0)
    if (deps.skill2Pressed.current) pressSlot(1)
    // Гасим БЕЗУСЛОВНО — в том числе когда слот пуст или идёт кулдаун. Иначе
    // флаг "залипнет" и нажатие сработает само через несколько секунд
    // (TouchControls/клавиатура пишут в него true независимо от того, слушает
    // ли кто-то эти рефы).
    deps.skill1Pressed.current = false
    deps.skill2Pressed.current = false

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
    // Аура — единственный узел, который эта система добавляет в
    // worldContainer; Explore.tsx о нём не знает, поэтому чистим здесь.
    destroyHealAura()
  }

  return { update, dispose }
}
