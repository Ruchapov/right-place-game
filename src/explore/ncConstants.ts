import type { SheetBossKind, SheetEnemyKind } from './types'
import { NC_SHEETS } from './ncSheets'
import type { NcSheet, NcSheetName } from './ncSheets'

// НОВЫЕ ВРАГИ И БОССЫ (09.11.2026) — числа, которых нет в sheets.json.
// Листы (клетка, якорь, fps, кадры событий) — ncSheets.ts, сгенерирован из
// архива RightPlace_new_enemies_bosses.zip.

export type NcKind = SheetEnemyKind | SheetBossKind

/** Префикс имён листов вида в NC_SHEETS (Fencer_Idle, Serpent_Bite …). */
export const NC_PREFIX: Record<NcKind, string> = {
  fencer: 'Fencer',
  gravedigger: 'Gravedigger',
  crossbowman: 'Crossbowman',
  stoker: 'Stoker',
  beetle: 'Beetle',
  serpent: 'Serpent',
  crowking: 'CrowKing',
}

/** Все листы вида — грузятся только в забег, где этот вид есть. */
export function ncSheetNames(kind: NcKind): NcSheetName[] {
  const prefix = NC_PREFIX[kind] + '_'
  return (Object.keys(NC_SHEETS) as NcSheetName[]).filter((name) => name.startsWith(prefix))
}

/**
 * Высота тела в мире, px (задача, таблица «высота тела в мире»; герой — 140).
 * Масштаб = эта высота / высота тела на кадре 0 листа Idle (NC_BODY_H, замер по
 * альфе > 40 от верха силуэта до точки ног). Один масштаб на все листы вида.
 */
export const NC_DRAW_H: Record<NcKind, number> = {
  fencer: 140,
  gravedigger: 150,
  crossbowman: 140,
  stoker: 165,
  beetle: 95,
  serpent: 250,
  crowking: 235,
}
/** Высота тела на кадре 0 Idle, px листа (замер 09.11.2026). */
export const NC_BODY_H: Record<NcKind, number> = {
  fencer: 257.6,
  gravedigger: 303.8,
  crossbowman: 282.8,
  stoker: 303.8,
  beetle: 189.8,
  serpent: 335.0,
  crowking: 326.0,
}
export const NC_SCALE: Record<NcKind, number> = {
  fencer: NC_DRAW_H.fencer / NC_BODY_H.fencer,
  gravedigger: NC_DRAW_H.gravedigger / NC_BODY_H.gravedigger,
  crossbowman: NC_DRAW_H.crossbowman / NC_BODY_H.crossbowman,
  stoker: NC_DRAW_H.stoker / NC_BODY_H.stoker,
  beetle: NC_DRAW_H.beetle / NC_BODY_H.beetle,
  serpent: NC_DRAW_H.serpent / NC_BODY_H.serpent,
  crowking: NC_DRAW_H.crowking / NC_BODY_H.crowking,
}

/**
 * Видимая фигура кадра 0 Idle по X от точки ног, px листа (фигура смотрит
 * влево): [левый край, правый край]. Хитбокс тела — по ней: ширина
 * (x1 − x0) × масштаб, высота — NC_DRAW_H; спрайт сдвинут так, чтобы фигура
 * стояла в боксе (середина фигуры — на середине бокса).
 */
export const NC_FIG_X: Record<NcKind, readonly [number, number]> = {
  fencer: [-101.5, 74.5],
  gravedigger: [-60.3, 97.7],
  crossbowman: [-131.3, 46.7],
  stoker: [-148.2, 110.8],
  beetle: [-180.9, 209.1],
  serpent: [-173.5, 123.5],
  crowking: [-82.5, 86.5],
}
export function ncBoxW(kind: NcKind): number {
  const [x0, x1] = NC_FIG_X[kind]
  return Math.round((x1 - x0) * NC_SCALE[kind])
}

/**
 * Множители HP и урона поверх зверя ТОГО ЖЕ уровня (scaling.ts):
 * HP = round(MULT × scaledEnemyMaxHp), урон = ceil(MULT × scaledEnemyAttackDamage).
 * HP продублированы на сервере (server/src/game.ts, NC_ENEMY_HP_MULT) — по ним
 * потолок нанесённого урона.
 */
export const NC_HP_MULT: Record<SheetEnemyKind, number> = {
  fencer: 1.0,
  gravedigger: 1.2,
  crossbowman: 0.7,
  stoker: 1.5,
  beetle: 1.3,
}
export const FENCER_DMG_MULT = 1.0
export const GRAVEDIGGER_CLOD_DMG_MULT = 0.8
export const GRAVEDIGGER_SHOVEL_DMG_MULT = 1.3
export const CROSSBOW_BOLT_DMG_MULT = 1.2
export const STOKER_DMG_MULT = 1.3
export const BEETLE_MUD_DMG_MULT = 0.6
export const BEETLE_DASH_DMG_MULT = 1.2

/** Тень из сундука: HP = 3 × зверь, урон = 1 × зверь. */
export const SHADOW_HP_MULT = 3
export const SHADOW_DMG_MULT = 1

/** Пауза между действиями врага после конца атаки, мс. */
export const NC_ATTACK_COOLDOWN_MS = 700

// --- Дистанции, клетки ---
export const RANGED_MIN_TILES = 3 // ближе — ближний удар (гробокопатель, жук)
export const RANGED_MAX_TILES = 7 // дальше — подходит
export const CROSSBOW_RETREAT_TILES = 2 // ближе — пятится
export const CROSSBOW_SHOOT_MAX_TILES = 8

// --- Фехтовальщик ---
/** Два попадания по нему подряд с паузой не больше этой — встаёт в блок. */
export const FENCER_PARRY_GAP_MS = 800
/** Удар в кадрах open — урон × это. */
export const FENCER_OPEN_DMG_MULT = 1.5
/** Героя, ударившего в блок, отталкивает и держит на месте, мс. */
export const FENCER_BLOCK_STAGGER_MS = 300
/** Скорость отталкивания героя, px/кадр при 60 к/с (первые 120 мс стаггера). */
export const FENCER_BLOCK_PUSH_SPEED = 5
export const FENCER_BLOCK_PUSH_MS = 120

// --- Кочегар: горение героя ---
export const BURN_MS = 3000
export const BURN_TICK_MS = 500
/** Горение за 3 с суммарно = эта доля урона удара. */
export const BURN_TOTAL_FRAC = 0.45

// --- Жук: замедление и рывок ---
export const SLOW_MS = 2500
export const SLOW_MULT = 0.75
export const BEETLE_DASH_PX = 160
/** Грязное пятно на месте падения кома, мс. */
export const MUD_SPLAT_MS = 1000

// --- Снаряды ---
/** Гравитация дуги кома и грязи — как у шипа босса (BOSS_SPIKE_GRAVITY). */
export const ARC_GRAVITY = 1400
/** Горизонтальная скорость дуги, px/с: время полёта = дистанция / она (в пределах). */
export const ARC_SPEED_X = 520
export const ARC_MIN_T = 0.45
export const ARC_MAX_T = 1.0
/** Вращение кома, рад/с. */
export const ARC_SPIN = 9
export const BOLT_SPEED = 700 // px/с мира, строго по горизонтали
export const BOLT_RANGE_TILES = 10
export const BONES_SPEED = 900 // px/с мира
export const BONES_RANGE_TILES = 14
/** Цвет крошек кома (RGB 42,32,26) и пятна грязи. */
export const CLOD_CRUMB_COLOR = 0x2a201a
export const MUD_SPLAT_COLOR = 0x3a2a1c

// --- Боссы ---
export const NC_BOSS_HURT_MS = 300
export const NC_BOSS_ATTACK_COOLDOWN_MS = 600 // как у Настоятеля
export const SERPENT_EMERGE_DMG_MULT = 1.5
export const SERPENT_SPIT_DMG_MULT = 1.0
export const SERPENT_SLAM_INTERVAL_MS = 5000
export const SERPENT_DIVE_INTERVAL_MS = 10000
/** Под землёй перед выныриванием: трясётся пол и бегут трещины, мс (НЕ ускорять). */
export const SERPENT_QUAKE_MS = 800
/** Ширина кучи, клетки: вынырнуть можно только туда, где под ней сплошной пол. */
export const SERPENT_HEAP_TILES = 5.5
/** Ровный пол арены для нырка — не уже, клетки. */
export const SERPENT_MIN_FLOOR_TILES = 6
/** Урон выныривания — тому, кто над кучей в первые столько кадров листа Emerge. */
export const SERPENT_EMERGE_HIT_FRAMES = 10
export const SERPENT_RAGE_HP_FRAC = 0.5
export const SERPENT_RAGE_SPEED = 1.15
/** Свечение глаз в ярости: размер одного глаза в мире, px; цвет. */
export const SERPENT_EYE_DRAW = 28
export const SERPENT_EYE_TINT = 0xff8a2a
export const CROWKING_SCATTER_INTERVAL_MS = 8000
export const CROWKING_UNREACHABLE_MS = 2000
export const CROWKING_HITS_TO_SCATTER = 3
/** Собраться в стольких клетках за спиной героя. */
export const CROWKING_BEHIND_TILES = 3
/** Летит невидимым к точке сборки, мс. */
export const CROWKING_FLY_MS = 450

/** Имена боссов на полосе HP. */
export const NC_BOSS_NAME: Record<SheetBossKind, string> = {
  serpent: 'Костяной Змей',
  crowking: 'Вороний Король',
}

/** Лист по имени — с проверкой, что такой есть (опечатка в имени — громко). */
export function ncSheet(name: string): NcSheet {
  const spec = (NC_SHEETS as Record<string, NcSheet>)[name]
  if (!spec) throw new Error(`ncSheets: нет листа ${name}`)
  return spec
}
