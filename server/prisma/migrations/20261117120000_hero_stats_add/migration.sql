-- Летопись героя (17.11.2026): новая таблица HeroStats, 1:1 с Character.
-- Только CREATE TABLE — старому серверному процессу не мешает.
-- ⚠️ ПОРЯДОК ВЫКЛАДКИ: миграция → сервер → фронт. Сервер без неё уронит ЛОГИН:
-- heroStatsOf (heroStats.ts) читает таблицу в каждом ответе с персонажем.
-- Собрана prisma migrate diff (migrate dev смотрел бы в боевую базу).

-- CreateTable
CREATE TABLE "HeroStats" (
    "id" SERIAL NOT NULL,
    "characterId" INTEGER NOT NULL,
    "runsTotal" INTEGER NOT NULL DEFAULT 0,
    "runsCompleted" INTEGER NOT NULL DEFAULT 0,
    "runsDied" INTEGER NOT NULL DEFAULT 0,
    "killsTotal" INTEGER NOT NULL DEFAULT 0,
    "killsElite" INTEGER NOT NULL DEFAULT 0,
    "bossesKilled" INTEGER NOT NULL DEFAULT 0,
    "chestsOpened" INTEGER NOT NULL DEFAULT 0,
    "breakablesBroken" INTEGER NOT NULL DEFAULT 0,
    "potionsDrunk" INTEGER NOT NULL DEFAULT 0,
    "parries" INTEGER NOT NULL DEFAULT 0,
    "trophiesEarned" INTEGER NOT NULL DEFAULT 0,
    "questsCompleted" INTEGER NOT NULL DEFAULT 0,
    "timeInRunsMs" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HeroStats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HeroStats_characterId_key" ON "HeroStats"("characterId");

-- AddForeignKey
ALTER TABLE "HeroStats" ADD CONSTRAINT "HeroStats_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

