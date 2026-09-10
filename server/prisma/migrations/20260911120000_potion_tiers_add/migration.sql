-- Система зелий пяти тиров, ШАГ 1 из 2: добавить колонки и перелить старый запас.
--
-- Зелье одно, у него пять тиров; тир задаёт силу лечения и уровень открытия
-- (каталог — src/potions.ts / server/src/potions.ts, POTION_TIERS). У игрока
-- свой запас по каждому тиру, поэтому пять скалярных колонок, а не Json и не
-- отдельная таблица: тиров ровно пять и это фиксировано каталогом, а счётчику
-- нужны атомарные +1/-1 в том же UPDATE, где пишутся золото и трофеи.
--
-- potionT1 DEFAULT 3 — сохраняем нынешний онбординг: столько же давала старая
-- potionCharges. Остальные тиры стартуют пустыми.
ALTER TABLE "Character" ADD COLUMN "potionT1" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "Character" ADD COLUMN "potionT2" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "potionT3" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "potionT4" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "potionT5" INTEGER NOT NULL DEFAULT 0;

-- Переливка: весь старый абстрактный запас становится первым тиром. DEFAULT 3
-- выше распространяется только на новые строки, существующим нужен явный
-- UPDATE — иначе у живых персонажей запас молча стал бы тройкой независимо от
-- того, сколько у них было на самом деле.
UPDATE "Character" SET "potionT1" = "potionCharges";

-- "potionCharges" НАМЕРЕННО остаётся в таблице до следующего захода.
-- Уронить её здесь же нельзя: Prisma перечисляет колонки в SELECT поимённо, и
-- ещё живой старый серверный процесс на Render (деплой не мгновенный) начал бы
-- падать на каждом чтении персонажа, то есть на логине. DROP делает отдельная
-- миграция _potion_charges_drop — ПОСЛЕ того, как новый сервер отработает.
-- Правило проекта: применённую миграцию не редактировать, только новая поверх.
