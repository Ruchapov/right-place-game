-- Достижения (20.11.2026, docs/achievements.md): таблица Achievement, две
-- колонки Character (bagBonusCells, titleKey) и счётчик HeroStats.trapDeaths.
-- Только ADD COLUMN … DEFAULT и CREATE TABLE — старому серверу не мешает.
-- ⚠️ ПОРЯДОК ВЫКЛАДКИ: бэкап Neon (backup-2026-11-16-before-achievements) →
-- migrate deploy → сервер → фронт. Сервер без неё уронит вход: bagBonusCells и
-- titleKey читаются в каждом ответе с персонажем.
-- Собрана prisma migrate diff (migrate dev смотрел бы в боевую базу).

-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "bagBonusCells" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "titleKey" TEXT;

-- AlterTable
ALTER TABLE "HeroStats" ADD COLUMN     "trapDeaths" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Achievement" (
    "id" SERIAL NOT NULL,
    "characterId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rewardPending" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Achievement_characterId_key_key" ON "Achievement"("characterId", "key");

-- AddForeignKey
ALTER TABLE "Achievement" ADD CONSTRAINT "Achievement_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

