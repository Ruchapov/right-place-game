-- Руны (docs/items.md, «РУНЫ», 09.11.2026).
--
-- Только ADD COLUMN … DEFAULT 0 — безопасно для ещё живого старого серверного
-- процесса: он новых колонок не перечисляет. Написана руками по
-- `prisma migrate diff` против схемы до правки (не migrate dev — тот смотрит в
-- боевую базу).
--
-- Character:
--   runeAttack / runeArmor / runeLuck            — лежат в инвентаре;
--   runeAttackFound / runeArmorFound / runeLuckFound — получено всего (лимит);
--   runeAttackUsed / runeArmorUsed               — применено (постоянная прибавка).

ALTER TABLE "Character" ADD COLUMN "runeAttack" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "runeArmor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "runeLuck" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "runeAttackFound" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "runeArmorFound" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "runeLuckFound" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "runeAttackUsed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "runeArmorUsed" INTEGER NOT NULL DEFAULT 0;
