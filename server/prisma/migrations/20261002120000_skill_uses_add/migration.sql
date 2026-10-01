-- AlterTable: skillUsesFireball/skillUsesIceball/skillUsesSlash/skillUsesHeal/
-- skillUsesDash — счётчик РЕЗУЛЬТАТИВНЫХ применений каждого навыка, накопленный
-- в счёт СЛЕДУЮЩЕГО уровня. По колонке на навык, та же раскладка, что у
-- skillLevel* (миграция 20260929120000_skill_levels_add) и book*.
--
-- Зачем: до 02.10.2026 уровень навыка рос ТОЛЬКО за книгу и ни на что не влиял.
-- Теперь он усиливает урон и лечение навыка (skillPowerMult, общая пара
-- src/skillLevels.ts <-> server/src/skillLevels.ts) и растёт сам — за
-- применения в забегах. Порог до следующего уровня round(30 × √уровень)
-- (skillUsesThreshold там же), лишние применения переходят на следующий
-- уровень, поэтому хранится ОСТАТОК, а не всего применений за историю: порог
-- вычитается при каждом повышении (applySkillLevelProgress, game.ts).
--
-- Книга (POST /character/upgrade-skill) по-прежнему даёт +1 уровень и счётчик
-- НЕ сбрасывает — решение дизайнера: это два независимых источника уровня.
--
-- Растут ТОЛЬКО на закрытии забега: POST /run/finish-explore и, у забега,
-- брошенного закрытием приложения, POST /auth/login — обе ветки считают их
-- ОДНИМ кодом из currentRun.progress.skillUses, тем же приёмом, что рост
-- статов (иначе «убить приложение» и честная смерть качали бы по-разному).
-- Миграции под сам currentRun.progress.skillUses не нужно: это колонка Json?.
--
-- DEFAULT 0 сразу проставляет 0 всем существующим строкам, поэтому отдельный
-- UPDATE для переливки не нужен: до этой миграции применений не считал никто.
-- Уровни НЕ пересчитываются задним числом — прошлые забеги в счёт не идут, и
-- это осознанно: доказательств, сколько навыков применено до сегодня, нет.
--
-- Здесь ТОЛЬКО ADD COLUMN. Ни DROP, ни переливки данных: добавление колонки с
-- DEFAULT безопасно для ещё живого старого серверного процесса на Render
-- (деплой не мгновенный) — он про эти колонки не знает и в SELECT их не
-- перечисляет, так что читать персонажа продолжит без ошибок.
--
-- ⚠️ ПОРЯДОК ВЫКЛАДКИ (как у страниц и книг, и по той же причине): сначала эта
-- миграция против боевой БД, потом серверный код, и только потом фронт.
-- Обратный порядок уронит ЛОГИН: skillUsesOf (runState.ts) перечисляет эти
-- колонки поимённо, и Prisma запросит их в КАЖДОМ чтении персонажа.
ALTER TABLE "Character" ADD COLUMN "skillUsesFireball" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "skillUsesIceball" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "skillUsesSlash" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "skillUsesHeal" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "skillUsesDash" INTEGER NOT NULL DEFAULT 0;
