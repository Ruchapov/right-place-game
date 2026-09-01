/*
  Прод разошёлся с prisma/migrations: миграция 20260902130000_bonus_levels
  на диске сейчас (ADD COLUMN "bonusLevels" + UPDATE "level" ...) не
  совпадает с тем, что реально накатили на прод раньше — там прошла более
  ранняя версия того же файла, которая DROP'ала "level" вместо бэкфилла.
  "prisma migrate deploy" считает 20260902130000_bonus_levels уже применённой
  (по имени/истории в _prisma_migrations) и не перечитывает её заново, так
  что старую миграцию редактировать бессмысленно и опасно — правим ТОЛЬКО
  новой миграцией поверх фактического состояния прода: bonusLevels уже есть,
  level — нет (см. P2022 в проде).

  Warnings:

  - "level" возвращается как денормализованный снимок (см. комментарий к
    полю в schema.prisma) — источник истины calculateLevel(strength,
    agility, endurance, bonusLevels) в game.ts, эта колонка только для
    аналитики/отладки, логика её не читает.

*/
-- AlterTable
ALTER TABLE "Character" ADD COLUMN "level" INTEGER NOT NULL DEFAULT 1;

-- DataMigration: бэкфилл существующих строк той же формулой, что
-- calculateLevel в server/src/game.ts — включая bonusLevels (колонка уже
-- есть в проде, см. выше), не только чисто-статовую часть.
--   damageChannel   = floor((strength + agility - 20) / 6)
--   survivalChannel = floor((endurance - 10) / 3)
--   level = 1 + greatest(damageChannel, survivalChannel) + bonusLevels
-- FLOOR() на вещественном делении (не целочисленном "/"), чтобы совпадать с
-- Math.floor из JS на гипотетических отрицательных каналах.
UPDATE "Character"
SET "level" = 1 + GREATEST(
  FLOOR(("strength" + "agility" - 20) / 6.0)::int,
  FLOOR(("endurance" - 10) / 3.0)::int
) + "bonusLevels";
