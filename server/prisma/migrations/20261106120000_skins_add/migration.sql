-- AlterTable: Портной (14.11.2026, docs/shop.md, «ПОРТНОЙ»): облик тела, цвет
-- удара, плащи с уровнями улучшения, Кузнечное клеймо брони и оружия, запас
-- нашивок и клейм.
--
-- Здесь ТОЛЬКО ADD COLUMN ... DEFAULT: безопасно для ещё живого старого
-- серверного процесса на Render (он про эти колонки не знает и в SELECT их не
-- перечисляет). DEFAULT сразу даёт всем обычный облик, Пепельный плащ и нули.
--
-- ⚠️ Имя папки старше уже применённых (20261114…): так названа задачей. migrate
-- deploy применяет всё неприменённое, порядок имён ему не мешает.
--
-- ⚠️ ПОРЯДОК ВЫКЛАДКИ: миграция → сервер → фронт. Сервер без неё уронит ЛОГИН:
-- skinStateOf (skinState.ts) читает эти колонки в каждом ответе с персонажем.
ALTER TABLE "Character" ADD COLUMN "skinArmor" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "Character" ADD COLUMN "skinSlash" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "Character" ADD COLUMN "cloakId" TEXT NOT NULL DEFAULT 'ash';
ALTER TABLE "Character" ADD COLUMN "ownedArmorSkins" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Character" ADD COLUMN "ownedSlashSkins" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Character" ADD COLUMN "cloakLevelAsh" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "cloakLevelMidnight" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "cloakLevelWine" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "brandLevelArmor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "brandLevelWeapon" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "patchCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "brandCount" INTEGER NOT NULL DEFAULT 0;
