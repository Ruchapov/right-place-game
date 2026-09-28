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

/** Доля → целые проценты, как в consumableEffectLine. */
function pct(frac: number): string {
  return String(Math.round(frac * 100))
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
 * ⚠️ Места под «что будет после улучшения» здесь НЕТ: что именно даёт уровень
 * скилла, ещё не решено (docs/skills.md), а заглушка вида «+? урона» обещала бы
 * игроку неизвестное — тот же запрет, что на тихие фолбэки.
 */
const SKILL_BOOK_LINES: Record<SkillBookSkillId & SkillId, string> = {
  fireball:
    `Огненный шар летит вперёд и взрывается о первого врага или стену. `
    + `Урон: ${pct(FIREBALL_DAMAGE_FRAC)}% здоровья каждой цели в зоне взрыва. `
    + `Перезарядка ${sec(FIREBALL_COOLDOWN_MS)} с.`,
  iceball:
    `Ледяной шар летит вперёд и взрывается о первого врага или стену. `
    + `Урон: ${pct(ICEBALL_DAMAGE_FRAC)}% здоровья каждой цели в зоне взрыва, `
    + `заморозка ${sec(ICEBALL_STUN_MS)} с. Перезарядка ${sec(ICEBALL_COOLDOWN_MS)} с.`,
  // «в секунду» — не литерал: доля за тик приведена к секунде через сам тик
  // (BLEED_TICK_MS). Сделают тик чаще или реже — процент в строке пересчитается,
  // а не станет врать.
  slash:
    `Удар клинком и кровотечение: ${pct(BLEED_FRAC_PER_TICK * (1000 / BLEED_TICK_MS))}% `
    + `здоровья цели в секунду, ${sec(BLEED_DURATION_MS)} с. `
    + `Повторный удар обновляет кровотечение. Перезарядка ${sec(SLASH_COOLDOWN_MS)} с.`,
  // Лечение идёт импульсами (HEAL_PULSE_COUNT штук по HEAL_PULSE_FRAC), а игрока
  // интересует итог — поэтому произведение, а не доля одного импульса.
  heal:
    `Восстанавливает ${pct(HEAL_PULSE_FRAC * HEAL_PULSE_COUNT)}% здоровья героя. `
    + `Перезарядка ${sec(HEAL_COOLDOWN_MS)} с.`,
  dash:
    `Рывок вперёд сквозь врагов. Урон: ${pct(DASH_DAMAGE_FRAC)}% здоровья каждого задетого. `
    + `Во время рывка герой неуязвим. Перезарядка ${sec(DASH_COOLDOWN_MS)} с.`,
}

/** Что делает скилл, который улучшает книга. */
export function skillBookLine(skillId: SkillBookSkillId): string {
  return SKILL_BOOK_LINES[skillId]
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
export function consumableMechanicLine(spec: Consumable): string {
  // Через consumableSkillBook, а не прямым разбором union: каталог разбирает свой
  // эффект сам, один раз (там же это делают consumableAttackBonus/ReviveFrac).
  const skillId = consumableSkillBook(spec)
  if (skillId !== null) return skillBookLine(skillId)
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
