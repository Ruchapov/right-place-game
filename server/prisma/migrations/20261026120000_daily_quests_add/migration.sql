-- AlterTable: hunterBadges / rp / questState — ежедневные задания (каталог
-- src/quests.ts / server/src/quests.ts, docs/daily-quests.md).
--
-- hunterBadges — значки охотника, новая валюта: растут только наградой за
-- выполненное задание. rp — +1 за каждое выполненное задание. Оба начисляет
-- финиш живой вылазки increment'ом в той же условной записи, что закрывает
-- забег.
-- questState — набор из трёх заданий, активное задание с прогрессом, таймер
-- набора и замена; NULL — набора ещё не было. Пишут его ручки заданий
-- (GET /character/quests, POST /character/quests/take и /replace) и финиш
-- забега; читается только через readQuestState (server/src/questState.ts).
--
-- DEFAULT сразу даёт всем существующим строкам ноль значков, ноль RP и «набора
-- нет»; отдельный UPDATE не нужен: заданий до этой миграции не было.
--
-- Здесь ТОЛЬКО ADD COLUMN — безопасно для ещё живого старого серверного
-- процесса на Render: он про эти колонки не знает и в SELECT их не перечисляет.
--
-- ⚠️ ПОРЯДОК ВЫКЛАДКИ: сначала эта миграция против боевой БД, потом серверный
-- код. Обратный порядок уронит ЛОГИН: Prisma запросит новые колонки в КАЖДОМ
-- чтении персонажа.
--
-- ⚠️ Применять против боевой базы — Андрею (server/.env смотрит в прод):
--   cd server && npx prisma migrate deploy
-- и сразу после — npx prisma migrate status (read-only), чтобы увидеть
-- "Database schema is up to date!".
ALTER TABLE "Character" ADD COLUMN     "hunterBadges" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "questState" JSONB,
ADD COLUMN     "rp" INTEGER NOT NULL DEFAULT 0;
