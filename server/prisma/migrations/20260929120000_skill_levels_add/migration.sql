-- AlterTable: skillLevelFireball/Iceball/Slash/Heal/Dash — уровень КАЖДОГО навыка.
-- Растёт на 1 за применённую книгу (POST /character/upgrade-skill) и никогда не
-- убывает: «забыть» навык (POST /character/forget-skill) снимает его из
-- equippedSkills, но уровень остаётся — решение дизайнера.
--
-- DEFAULT 1, а не 0: навык существует с первого уровня. Ноль читался бы как
-- «навыка нет», а это состояние выражено иначе — отсутствием навыка в
-- equippedSkills и пустым складом книг. Существующим строкам DEFAULT сразу
-- проставит 1, отдельная переливка не нужна.
--
-- Колонка на навык, а не Json — та же причина, что у potionT1..T5 и book*:
-- навыков ровно пять по каталогу (src/consumables.ts, SkillBookSkillId), а
-- счётчику нужен атомарный increment в том же UPDATE, где списывается книга.

ALTER TABLE "Character" ADD COLUMN "skillLevelFireball" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Character" ADD COLUMN "skillLevelIceball" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Character" ADD COLUMN "skillLevelSlash" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Character" ADD COLUMN "skillLevelHeal" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Character" ADD COLUMN "skillLevelDash" INTEGER NOT NULL DEFAULT 1;

-- ⚠️ ЕДИНСТВЕННАЯ в проекте миграция, которая МЕНЯЕТ ДАННЫЕ ИГРОКОВ, а не только
-- схему: снимает надетые навыки у ВСЕХ персонажей. Причина — решение дизайнера:
-- навык теперь бывает только от книги, а прежний POST /character/skills позволял
-- надеть любой из пяти бесплатно. Оставить старые наборы значило бы сохранить
-- результат удалённой механики: у одних игроков навыки «из ниоткуда», у других,
-- зашедших позже, — только купленные.
--
-- Уровни при этом НЕ сбрасываются (их до этой миграции и не было — все стартуют
-- с 1): обнуляется ровно то, что было выдано без книги.
--
-- Безопасно для ещё живого СТАРОГО серверного процесса на Render: пустой
-- equippedSkills — штатное значение (default в схеме), никакой код на нём не
-- падает, игрок просто видит пустые гнёзда навыков.
-- '{}' — это ПУСТОЙ массив в синтаксисе Postgres, не JSON-объект: колонка
-- equippedSkills имеет тип text[].
UPDATE "Character" SET "equippedSkills" = '{}';
