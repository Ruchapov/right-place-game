// Книги скиллов — КЛИЕНТСКАЯ половина каталога: строка «что делает скилл»,
// которую показывает карточка книги в магазине и в сумке.
//
// Живёт ОТДЕЛЬНО от src/consumables.ts намеренно. Тот файл обязан быть
// байт-в-байт с серверной копией, а числа скиллов (урон, кулдаун, длительность
// кровотечения) лежат в боевых константах src/explore/constants.ts, которых на
// сервере нет вовсе. Сложить их в общий каталог значило бы либо сломать
// байт-в-байт, либо завести ТРЕТИЙ экземпляр чисел, правящихся при каждом
// балансе, — и витрина начала бы обещать не то, что делает забег.
//
// ⚠️ Поэтому здесь НЕТ НИ ОДНОГО ЧИСЛА текстом: всё подставляется из констант.
// Меняется баланс скилла — строка в магазине меняется сама.
import {
  FIREBALL_DAMAGE_FRAC, FIREBALL_COOLDOWN_MS,
  ICEBALL_DAMAGE_FRAC, ICEBALL_COOLDOWN_MS, ICEBALL_STUN_MS,
  BLEED_FRAC_PER_TICK, BLEED_TICK_MS, BLEED_DURATION_MS, SLASH_COOLDOWN_MS,
  HEAL_PULSE_FRAC, HEAL_PULSE_COUNT, HEAL_COOLDOWN_MS,
  DASH_DAMAGE_FRAC, DASH_COOLDOWN_MS,
} from './explore/constants'
import type { SkillId } from './explore/entities/skills'
import { consumableEffectLine, consumableSkillBook, type Consumable, type SkillBookSkillId } from './consumables'
import { skillPowerMult } from './skillLevels'

/** Доля → целые проценты, как в consumableEffectLine. */
function pct(frac: number): string {
  return String(Math.round(frac * 100))
}

/**
 * Доля урона или лечения → проценты НА ЗАДАННОМ УРОВНЕ навыка (02.10.2026).
 *
 * Уровень null — «сервер уровней не назвал»: тогда вместо числа прочерк, а НЕ
 * числа первого уровня. Подставить единицу значило бы показать игроку 40-го
 * уровня силу новичка — тот самый тихий фолбэк, который в проекте запрещён
 * (CLAUDE.md, Design Decisions).
 *
 * Применяется ТОЛЬКО к урону и лечению: перезарядки, заморозка и длительность
 * кровотечения уровнем не меняются, поэтому у них остаётся sec() без поправки.
 */
function pctAt(frac: number, level: number | null): string {
  if (level === null) return '—'
  return pct(frac * skillPowerMult(level))
}

/**
 * Миллисекунды → секунды для текста. Десятые оставляем (2500 → «2,5»), целое
 * печатаем без хвостового нуля (5000 → «5»), разделитель русский — запятая.
 * Округление до десятых, а не до целых: кулдаун 2500 мс, поданный как «3 с»,
 * врал бы игроку в пользу разработчика.
 */
function sec(ms: number): string {
  return String(Math.round(ms / 100) / 10).replace('.', ',')
}

/**
 * Строка «что делает» для каждого из пяти скиллов.
 *
 * Ключ — SkillBookSkillId & SkillId, то есть ОБЩИЕ значения двух типов: id книг
 * из общего каталога и боевых id из src/explore/entities/skills.ts. Это и есть
 * проверка ручного дубля: разъедутся они — пересечение изменится, и Record
 * перестанет совпадать с этим литералом (лишний ключ или недостающий), то есть
 * СБОРКА УПАДЁТ. Рантайм-списка id для этого не нужно.
 *
 * ⚠️ С 02.10.2026 это ФУНКЦИЯ ОТ УРОВНЯ, а не готовая строка: уровень навыка
 * усиливает его урон и лечение (skillPowerMult, src/skillLevels.ts), и строка
 * обязана называть силу ТОГО САМОГО героя, который её читает. Иначе и витрина, и
 * сумка, и карточка навыка продолжили бы показывать числа первого уровня тому, у
 * кого уровень уже третий — ровно та ловушка, что была записана в docs/skills.md
 * как «ловушка для того, кто будет делать эффект уровня».
 *
 * Одна карта на все три места намеренно: параметризовать уровнем только одно из
 * них не вышло бы — строка собирается здесь, в одном экземпляре.
 */
const SKILL_BOOK_LINES: Record<SkillBookSkillId & SkillId, (level: number | null) => string> = {
  fireball: (level) =>
    `Огненный шар летит вперёд и взрывается о первого врага или стену. `
    + `Урон: ${pctAt(FIREBALL_DAMAGE_FRAC, level)}% здоровья каждой цели в зоне взрыва. `
    + `Перезарядка ${sec(FIREBALL_COOLDOWN_MS)} с.`,
  iceball: (level) =>
    `Ледяной шар летит вперёд и взрывается о первого врага или стену. `
    + `Урон: ${pctAt(ICEBALL_DAMAGE_FRAC, level)}% здоровья каждой цели в зоне взрыва, `
    + `заморозка ${sec(ICEBALL_STUN_MS)} с. Перезарядка ${sec(ICEBALL_COOLDOWN_MS)} с.`,
  // «в секунду» — не литерал: доля за тик приведена к секунде через сам тик
  // (BLEED_TICK_MS). Сделают тик чаще или реже — процент в строке пересчитается,
  // а не станет врать. Уровень множит КАЖДЫЙ тик, поэтому и приведённую к
  // секунде долю — тоже (длительность и число тиков он не трогает).
  slash: (level) =>
    `Удар клинком и кровотечение: ${pctAt(BLEED_FRAC_PER_TICK * (1000 / BLEED_TICK_MS), level)}% `
    + `здоровья цели в секунду, ${sec(BLEED_DURATION_MS)} с. `
    + `Повторный удар обновляет кровотечение. Перезарядка ${sec(SLASH_COOLDOWN_MS)} с.`,
  // Лечение идёт импульсами (HEAL_PULSE_COUNT штук по HEAL_PULSE_FRAC), а игрока
  // интересует итог — поэтому произведение, а не доля одного импульса. Уровень
  // усиливает каждый импульс, значит и произведение.
  heal: (level) =>
    `Восстанавливает ${pctAt(HEAL_PULSE_FRAC * HEAL_PULSE_COUNT, level)}% здоровья героя. `
    + `Перезарядка ${sec(HEAL_COOLDOWN_MS)} с.`,
  dash: (level) =>
    `Рывок вперёд сквозь врагов. Урон: ${pctAt(DASH_DAMAGE_FRAC, level)}% здоровья каждого задетого. `
    + `Во время рывка герой неуязвим. Перезарядка ${sec(DASH_COOLDOWN_MS)} с.`,
}

/**
 * Печать навыка — иконка для кнопки в бою (public/assets/icons/skill_*.png,
 * 128×128, круглая каменная печать).
 *
 * Здесь, а не в src/explore/constants.ts: это иконка МЕНЮ-набора (та же партия,
 * что обложки книг), и связка «навык → его арт» должна лежать в одном месте с
 * остальным про навыки. Имена файлов идут от стихии (skill_fire), а id навыка —
 * от снаряда (fireball), поэтому карта нужна явная.
 *
 * Ключ — то же пересечение двух типов, что у строк ниже: разъедутся id книг и
 * боевые id — сборка упадёт.
 */
const SKILL_SEAL_FILE: Record<SkillBookSkillId & SkillId, string> = {
  fireball: 'skill_fire.png',
  iceball: 'skill_ice.png',
  slash: 'skill_bleed.png',
  heal: 'skill_heal.png',
  dash: 'skill_dash.png',
}

/** Путь к печати навыка. BASE_URL обязателен — сайт живёт в подкаталоге. */
export function skillSealSrc(skillId: SkillBookSkillId): string {
  return `${import.meta.env.BASE_URL}assets/icons/${SKILL_SEAL_FILE[skillId]}`
}

/**
 * Что делает скилл, который улучшает книга, НА УРОВНЕ ГЕРОЯ по этому скиллу.
 *
 * `level === null` — уровни неизвестны (сервер их не назвал): числа урона и
 * лечения становятся прочерком, см. pctAt. Перезарядки в строке остаются — они
 * от уровня не зависят.
 */
export function skillBookLine(skillId: SkillBookSkillId, level: number | null): string {
  return SKILL_BOOK_LINES[skillId](level)
}

/**
 * Строка механики ЛЮБОГО расходника — единственная точка, через которую её
 * берут витрина и сумка.
 *
 * Нужна потому, что источников строки два: числа камня и оберега живут в общем
 * каталоге (consumableEffectLine), числа книг — в боевых константах (здесь).
 * Развилка обязана быть одна: две копии разошлись бы, и один экран показывал бы
 * не то, что другой.
 */
export function consumableMechanicLine(
  spec: Consumable,
  // Уровни навыков ГЕРОЯ (App.tsx: player.skillLevels). null — сервер их не
  // назвал; тогда у книг числа урона и лечения станут прочерком, а у камня и
  // оберега строка не изменится вовсе (их числа от уровня не зависят).
  skillLevels: Record<SkillBookSkillId, number> | null,
): string {
  // Через consumableSkillBook, а не прямым разбором union: каталог разбирает свой
  // эффект сам, один раз (там же это делают consumableAttackBonus/ReviveFrac).
  const skillId = consumableSkillBook(spec)
  if (skillId !== null) return skillBookLine(skillId, skillLevels?.[skillId] ?? null)
  const line = consumableEffectLine(spec)
  if (line === null) {
    // Недостижимо: null каталог отдаёт только на skillBook, а он разобран выше.
    // Но подставлять сюда правдоподобную строку нельзя (запрет тихих фолбэков) —
    // если ветвление разъедется, это должно быть видно и в консоли, и на экране.
    console.error('consumableMechanicLine: каталог не назвал эффект', spec.id)
    return 'Эффект неизвестен'
  }
  return line
}
