-- AlterTable: навык «Телекинез» (13.11.2026, id telekinesis) — шестой навык из
-- книги. Четыре колонки по образцу Тарана (dash): книга, страница, уровень,
-- применения в счёт следующего уровня.
--
-- Здесь ТОЛЬКО ADD COLUMN ... DEFAULT: безопасно для ещё живого старого
-- серверного процесса на Render (он про эти колонки не знает и в SELECT их не
-- перечисляет). DEFAULT сразу проставляет значение всем строкам: книги и
-- страницы Телекинеза до этой миграции получить никто не мог, уровень навыка
-- стартует с 1, как у остальных пяти.
--
-- ⚠️ ПОРЯДОК ВЫКЛАДКИ: миграция → сервер → фронт. Сервер без неё уронит ЛОГИН:
-- consumableStockOf / scrollStockOf / skillLevelsOf / skillUsesOf (runState.ts)
-- перечисляют эти колонки поимённо в каждом чтении персонажа.
ALTER TABLE "Character" ADD COLUMN "bookTelekinesis" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "scrollTelekinesis" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "skillLevelTelekinesis" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Character" ADD COLUMN "skillUsesTelekinesis" INTEGER NOT NULL DEFAULT 0;
