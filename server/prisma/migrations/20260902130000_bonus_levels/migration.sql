-- AlterTable: bonusLevels — уровни НЕ от статов (сейчас только убийство
-- босса, +1, см. /run/battle-result), инкрементируются событиями, никогда
-- не пересчитываются из статов. DEFAULT 0 сразу проставляет 0 всем
-- существующим строкам.
ALTER TABLE "Character" ADD COLUMN "bonusLevels" INTEGER NOT NULL DEFAULT 0;

-- DataMigration: level остаётся в схеме как денормализованный снимок (см.
-- комментарий к полю в schema.prisma) — но старые значения были посчитаны
-- по УДАЛЁННОЙ экспоненциальной формуле (base*growth^(stat-10) плюс
-- strengthAtLevelUp/enduranceAtLevelUp — обе колонки уже снесены прошлой
-- миграцией), так что переносить их как есть бессмысленно. Пересчитываем
-- каждую строку по новой формуле — той же, что calculateLevel в game.ts:
--   damageChannel   = floor((strength + agility - 20) / 6)
--   survivalChannel = floor((endurance - 10) / 3)
--   level = 1 + greatest(damageChannel, survivalChannel) + bonusLevels
-- bonusLevels здесь всегда 0 (только что добавлен выше), так что это
-- фактически чисто-статовый уровень. FLOOR() на вещественном делении (не
-- целочисленном "/"), чтобы совпадать с Math.floor из JS на гипотетических
-- отрицательных каналах.
UPDATE "Character"
SET "level" = 1 + GREATEST(
  FLOOR(("strength" + "agility" - 20) / 6.0)::int,
  FLOOR(("endurance" - 10) / 3.0)::int
) + "bonusLevels";
