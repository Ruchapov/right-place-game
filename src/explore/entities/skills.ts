import type { MutableRefObject } from 'react'
import type { Container } from 'pixi.js'
import type { Grid } from '../types'
import type { PlayerPhysics, Enemy, Boss } from '../types'

// Скиллы игрока (fireball/iceball/slash/dash) — модуль подключён к игровому
// циклу ПУСТЫМ, до реализации самих скиллов (см. задачу). Арт уже лежит в
// public/assets/skills, но набор файлов на диске не совпадает с тем, что
// описано в CLAUDE.md, и число кадров/колонок по одним заголовкам PNG не
// вывести — текстуры сюда НЕ подключаем, пока эти числа не подтверждены.
// Интерфейс (SkillsDeps/createSkillsSystem) спроектирован под будущую
// реализацию заранее, чтобы точку подключения в Explore.tsx не пришлось
// переделывать, когда скиллы появятся.
export type SkillId = 'fireball' | 'iceball' | 'slash' | 'dash'

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

  // Какой SkillId висит на кнопке 1/2 — источника данных пока нет: Explore
  // не получает equippedSkills пропом (в отличие от Battle.tsx) — это часть
  // серверной интеграции (см. CLAUDE.md, Next Steps). Заглушка до тех пор.
  equipped: [SkillId | null, SkillId | null]
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
