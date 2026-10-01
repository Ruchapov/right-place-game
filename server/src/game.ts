// Pure game logic (no DB, no HTTP) - easy to reason about and test.
//
// Импорты здесь только на ТАКИЕ ЖЕ чистые модули: каталог расходников
// (байт-в-байт копия с клиентом, без своих импортов) и формулы уровня навыка
// (skillLevels.ts, такая же пара). Цикла нет и быть не может: runState.ts
// импортирует ЭТОТ файл, а не наоборот.
import { CONSUMABLES, consumableSkillBook, type SkillBookSkillId } from './consumables.js'
import { skillUsesThreshold } from './skillLevels.js'

const MAX_ENERGY = 100
const ENERGY_PER_MINUTE = 1

/**
 * Current energy, accounting for regeneration since lastUpdate.
 * Regenerates 1 per minute, never above MAX_ENERGY.
 */
export function getCurrentEnergy(storedEnergy: number, lastUpdate: Date): number {
  const minutesPassed = Math.floor((Date.now() - lastUpdate.getTime()) / 60_000)
  const regenerated = storedEnergy + minutesPassed * ENERGY_PER_MINUTE
  return Math.min(MAX_ENERGY, regenerated)
}

/**
 * Возврат энергии за забег, который так и не начался (см. judgeInterruptedRun
 * в runState.ts). Сначала доначисляем всё, что натикало (getCurrentEnergy),
 * потом возвращаем списанное и упираемся в потолок — так игрок получает ровно
 * то, что имел бы, не нажав кнопку: двойной регенерации не возникает, выше
 * MAX_ENERGY не подняться.
 *
 * `refunded` — ФАКТИЧЕСКАЯ прибавка, а не spentEnergy: у игрока с энергией под
 * потолок она меньше списанного (или ноль), и сообщать ему списанное было бы
 * неправдой.
 *
 * ⚠️ Дробный остаток минуты теряется — его отбрасывает floor внутри
 * getCurrentEnergy, и lastUpdate сдвигается на now. Это та же потеря, что уже
 * есть у каждого списания энергии в проекте (см. задачу «энергия упирается в
 * 99»), отдельной новой она здесь не становится.
 */
export function refundEnergy(
  storedEnergy: number,
  lastUpdate: Date,
  spentEnergy: number,
): { energy: number; refunded: number } {
  const before = getCurrentEnergy(storedEnergy, lastUpdate)
  const energy = Math.min(MAX_ENERGY, before + spentEnergy)
  return { energy, refunded: energy - before }
}
// --- Stat growth: incremental accumulation ---

// Given the current stat value, current leftover progress, and new RAW damage
// (dealt/taken/skill+heal — no more per-level normalization, see below),
// returns the new stat (incremented for each threshold crossed) and new
// leftover progress. threshold(stat) = round(base * (stat/10)^EXPONENT) —
// same shape for all three stats, only `base` differs (see
// STRENGTH_THRESHOLD_BASE/ENDURANCE_THRESHOLD_BASE/AGILITY_THRESHOLD_BASE
// below).
const STAT_THRESHOLD_EXPONENT = 1.2

export function applyStatProgress(
  currentStat: number,
  currentProgress: number,
  newDamage: number,
  base: number,
): { stat: number; progress: number } {
  let stat = currentStat
  let progress = currentProgress + newDamage
  while (true) {
    const threshold = Math.round(base * Math.pow(stat / 10, STAT_THRESHOLD_EXPONENT))
    // Условие ОТРИЦАНИЕМ, не `progress < threshold`: на нечисле обе прямые
    // проверки ложны, цикл не вышел бы никогда и повесил бы весь сервер
    // (событийный цикл один). Так нечисло выходит на первой же итерации.
    // Вызывающие обязаны давать конечные числа (см. clampRunProgress в
    // runState.ts) — это не подмена их проверок, а защита от зависания.
    if (!(progress >= threshold)) break
    progress -= threshold
    stat++
  }
  return { stat, progress }
}

export const STRENGTH_THRESHOLD_BASE = 710
export const ENDURANCE_THRESHOLD_BASE = 290
export const AGILITY_THRESHOLD_BASE = 710

// --- Уровень навыка от применений (02.10.2026) ---
//
// Тот же механизм, что у статов выше, и намеренно одной формы: накопленное
// сравнивается с порогом, при пересечении порог вычитается и остаток переходит
// на следующий уровень (решение дизайнера). Отличие одно: порог считает НЕ
// этот файл, а общая с клиентом пара skillLevels.ts — тот же skillUsesThreshold
// рисует полосу «X / Y» в карточке навыка, и вторая формула здесь значила бы,
// что полоса дошла до конца, а уровень не вырос.

/**
 * ОДИН навык: прибавляет применения забега к накопленному остатку и
 * повышает уровень, пока хватает на порог.
 *
 * ⚠️ Условие выхода — ОТРИЦАНИЕМ, ровно как в applyStatProgress и ровно по той
 * же причине: на нечисле ложны ОБА прямых сравнения, цикл не вышел бы
 * никогда и повесил бы весь сервер (Node однопоточен) — а сюда ведёт путь с
 * /auth/login, без которого игра не откроется вообще. См. CLAUDE.md, «Цикл while со
 * сравнением чисел». Вторая половина защиты — в skillUsesThreshold: он никогда
 * не возвращает ноль (иначе одно применение давало бы бесконечный уровень).
 */
export function applySkillLevelProgress(
  currentLevel: number,
  currentUses: number,
  newUses: number,
): { level: number; uses: number } {
  let level = currentLevel
  let uses = currentUses + newUses
  while (true) {
    const threshold = skillUsesThreshold(level)
    if (!(uses >= threshold)) break
    uses -= threshold
    level++
  }
  return { level, uses }
}

/**
 * Пять id навыков в рантайме — из каталога расходников, а не отдельным списком:
 * тип SkillBookSkillId в рантайме не существует, а вторая копия списка разъехалась
 * бы с каталогом при добавлении шестой книги. Тот же приём, что у
 * parseSkillBookSkillId (consumables.ts) и клиентского readSkillLevels.
 *
 * Живёт здесь, а не в runState.ts, где тоже нужен: по нему идёт
 * applySkillUsesGrowth ниже, а runState импортирует этот файл и без того
 * (scaledEnemyMaxHp) — обратный импорт дал бы цикл на инициализации этой
 * самой константы.
 */
export const SKILL_BOOK_SKILL_IDS: readonly SkillBookSkillId[] = CONSUMABLES
  .map((spec) => consumableSkillBook(spec))
  .filter((id): id is SkillBookSkillId => id !== null)

/** Навык, у которого за этот забег вырос уровень, и его НОВЫЙ уровень. */
export type SkillLevelUp = { skillId: SkillBookSkillId; level: number }

/**
 * Все пять навыков за один закрытый забег — ОДНА копия на оба пути
 * закрытия (/run/finish-explore и /auth/login с брошенным забегом), ровно как
 * applyStatGrowth выше и ровно по той же причине: разошлись бы две формулы —
 * и «убить приложение» снова стало бы отдельной дорогой, дешёвой или дорогой.
 *
 * Возвращает ПОЛНЫЕ наборы уровней и остатков (все пять, даже
 * нетронутые) — их ждёт и ответ клиенту, и запись в колонки, и неполный
 * объект клиентский разборщик целиком превратил бы в null.
 *
 * Плюс levelUps — только те, кто РЕАЛЬНО вырос: из них строится строка на
 * экране итогов, и сравнивать там два набора заново клиент не должен.
 */
export function applySkillUsesGrowth(
  currentLevels: Record<SkillBookSkillId, number>,
  currentUses: Record<SkillBookSkillId, number>,
  newUses: Record<SkillBookSkillId, number>,
): {
  levels: Record<SkillBookSkillId, number>
  uses: Record<SkillBookSkillId, number>
  levelUps: SkillLevelUp[]
} {
  const levels = {} as Record<SkillBookSkillId, number>
  const uses = {} as Record<SkillBookSkillId, number>
  const levelUps: SkillLevelUp[] = []
  for (const skillId of SKILL_BOOK_SKILL_IDS) {
    const result = applySkillLevelProgress(currentLevels[skillId], currentUses[skillId], newUses[skillId])
    levels[skillId] = result.level
    uses[skillId] = result.uses
    if (result.level > currentLevels[skillId]) levelUps.push({ skillId, level: result.level })
  }
  return { levels, uses, levelUps }
}

// Applies one run's worth of RAW damage (no more per-level normalization —
// see above) to all three stats via applyStatProgress, then recomputes level
// via calculateLevel (stat-derived channels + bonusLevels) and adjusts HP for
// any maxHp increase. bonusLevels here is Character.bonusLevels AS OF THIS
// WRITE — the caller decides whether it changed (only /run/finish-explore
// increments it, on a boss kill) and passes the already-updated value in;
// this function only reads it, never mutates it.
//
// Живёт здесь, а не в routes/run.ts, где вырос: вызывающих стало ДВА —
// /run/finish-explore и /auth/login, который применяет срез брошенного забега
// (см. runState.ts). Ни один из них не имеет права считать рост статов своей
// формулой, иначе закрытое приложение и честная смерть растили бы статы
// по-разному.
export function applyStatGrowth(
  currentStrength: number, currentStrengthProgress: number, attackDamage: number,
  currentEndurance: number, currentEnduranceProgress: number, damageTaken: number,
  currentAgility: number, currentAgilityProgress: number, skillDamage: number,
  previousMaxHp: number,
  currentHp: number,
  bonusLevels: number,
) {
  const strResult = applyStatProgress(currentStrength, currentStrengthProgress, attackDamage, STRENGTH_THRESHOLD_BASE)
  const endResult = applyStatProgress(currentEndurance, currentEnduranceProgress, damageTaken, ENDURANCE_THRESHOLD_BASE)
  const agiResult = applyStatProgress(currentAgility, currentAgilityProgress, skillDamage, AGILITY_THRESHOLD_BASE)

  const maxHp = endResult.stat * 8
  const hpGain = Math.max(0, maxHp - previousMaxHp)
  const hp = currentHp + hpGain

  const level = calculateLevel(strResult.stat, agiResult.stat, endResult.stat, bonusLevels)

  return {
    strength: strResult.stat,
    strengthProgress: strResult.progress,
    endurance: endResult.stat,
    enduranceProgress: endResult.progress,
    agility: agiResult.stat,
    agilityProgress: agiResult.progress,
    maxHp,
    hp,
    level,
  }
}

// --- Leveling: function of current stats PLUS bonusLevels, no stat history ---
// Replaces the old incremental +3 Endurance / +6 Strength bookkeeping
// (strengthAtLevelUp/enduranceAtLevelUp are gone). Two independent stat
// channels — offense (strength+agility) and survival (endurance) — whichever
// is further ahead sets the stat-derived level; bonusLevels is added on top.
// bonusLevels is NOT derived from stats — it's Character.bonusLevels, a
// persisted counter incremented by discrete events (currently: boss kills,
// see /run/finish-explore's bossClosed). Level overall is not stat-history-free — it's
// still a pure function of (strength, agility, endurance, bonusLevels), it
// just has a second, non-stat input now.
export function calculateLevel(strength: number, agility: number, endurance: number, bonusLevels: number): number {
  const damageChannel = Math.floor((strength + agility - 20) / 6)
  const survivalChannel = Math.floor((endurance - 10) / 3)
  return 1 + Math.max(damageChannel, survivalChannel) + bonusLevels
}

// --- Enemy HP scaling (mirrors src/explore/scaling.ts on the CLIENT —
// ENEMY_MAX_HP/ENEMY_HP_PER_LEVEL there, same formula) ---
// No shared package between frontend and server in this repo (same situation
// as runEvents.ts's TROPHY_* constants, see its own comment) — kept in sync
// BY HAND. If the client's ENEMY_MAX_HP/ENEMY_HP_PER_LEVEL ever change,
// update these two to match, or the anti-cheat cap in /run/finish-explore
// will silently drift from what the client actually spawned.
export const ENEMY_HP_BASE = 100
export const ENEMY_HP_PER_LEVEL = 9.0

export function scaledEnemyMaxHp(level: number): number {
  return Math.round(ENEMY_HP_BASE + ENEMY_HP_PER_LEVEL * (level - 1))
}

// Босс — не отдельная формула, а множитель поверх уже отмасштабированного
// HP обычного врага (mirrors BOSS_HP_MULT в src/explore/constants.ts на
// клиенте, тот же ручной синк, что у ENEMY_HP_BASE/ENEMY_HP_PER_LEVEL выше).
export const BOSS_HP_MULT = 2.5

export function scaledBossMaxHp(level: number): number {
  return Math.round(BOSS_HP_MULT * scaledEnemyMaxHp(level))
}


// --- Экономика: обмен трофеев на золото (POST /character/exchange-trophies) ---
//
// Сколько золота даёт ОДИН трофей при обмене в меню (между забегами; не путать
// с Контрабандистом — тот меняет трофеи на трофеи ВНУТРИ забега, другая
// механика и свои константы в runEvents.ts).
//
// Живёт ТОЛЬКО здесь, копии на клиенте нет и заводить её нельзя. Пятая ручная
// копия между src/ и server/src/ (см. CLAUDE.md, "Общего пакета между клиентом
// и сервером НЕТ" — там уже три пары без сверяющего скрипта) разъехалась бы
// молча: витрина обещала бы один курс, сервер начислял другой. Вместо копии
// клиент получает само число — GET /character/profile и ответ логина отдают
// trophyGoldRate, а обмен возвращает готовый goldGained.
//
// 1 — решение дизайнера, подбирается плейтестами: трофей и золото пока
// равноценны, обмен это чистый перевод рискованной валюты в стабильную, без
// премии за риск и без комиссии.
//
// ⚠️ Опустят курс НИЖЕ 1 — понадобится отдельная проверка `goldGained > 0` в
// обработчике: Math.floor округляет вниз, и мелкий остаток трофеев сгорит за
// ноль золота. Сейчас такой ветки нет намеренно — при курсе >= 1 она
// недостижима (trophies >= 1 всегда даёт goldGained >= 1).
/**
 * Сколько золота даёт продажа предмета: 50 за тир (тир 1 -> 50, тир 6 -> 300).
 *
 * Живёт ТОЛЬКО здесь, копии на клиенте НЕТ: цену каждой строки инвентаря сервер
 * присылает готовым полем sellPrice (GET /character/inventory), а клиент её
 * рисует. Тот же приём, что у TROPHY_GOLD_RATE ниже, и по той же причине —
 * передать значением дешевле, чем держать ещё одну ручную копию без сверяющего
 * скрипта.
 */
export const ITEM_SELL_PRICE_PER_TIER = 50

export function itemSellPrice(tier: number): number {
  return ITEM_SELL_PRICE_PER_TIER * tier
}

export const TROPHY_GOLD_RATE = 1
