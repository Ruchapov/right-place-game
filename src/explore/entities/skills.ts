import type { MutableRefObject } from 'react'
import type { Container } from 'pixi.js'
import type { Grid } from '../types'
import type { PlayerPhysics, Enemy, Boss } from '../types'

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

// Создаётся ОДИН раз в setup() (после того как определены worldContainer/
// grid/getPlayerCombatBox), возвращает { update, dispose }. Состояние
// активных снарядов/кулдаунов будет жить ВНУТРИ этого модуля (закрытыми
// переменными), наружу в Explore.tsx не течёт.
export function createSkillsSystem(deps: SkillsDeps) {
  // dt — МИЛЛИСЕКУНДЫ (ticker.deltaMS), тот же выбор единиц, что уже
  // используют bossSpikesRef/bossWavesRef/rewardFloatsRef в Explore.tsx
  // (lifeMs/elapsed копятся в мс, а не в frame-scale ticker.deltaTime,
  // которым масштабируется движение phys).
  function update(dt: number) {
    void dt // пока не используется — ни у одного скилла ещё нет ни кулдауна, ни времени жизни снаряда

    // Скиллов пока нет — только гасим нажатия, чтобы флаг не оставался
    // "залипшим" (TouchControls/клавиатура продолжают писать в него true
    // независимо от того, слушает кто-то эти рефы или нет).
    deps.skill1Pressed.current = false
    deps.skill2Pressed.current = false
  }

  function dispose() {
    // Здесь будут удаляться из deps.worldContainer спрайты активных
    // снарядов/VFX скиллов при размонтировании Explore — пока удалять нечего.
  }

  return { update, dispose }
}
