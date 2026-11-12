-- Приглашения друзей (docs/referral.md, 12.11.2026).
--
-- Только добавление: пять колонок NULL без значения по умолчанию, уникальный
-- индекс кода, индекс и внешний ключ «кто пригласил». Старый серверный процесс
-- новых колонок не перечисляет — ему миграция не мешает. Написана по
-- `prisma migrate diff` против схемы до правки (не migrate dev — тот смотрит в
-- боевую базу). ⚠️ Перед применением — бэкап-ветка Neon
-- backup-2026-11-12-before-referral от production.
--
-- Character:
--   referralCode      — код ссылки startapp=r_<код> (8 знаков), лениво;
--   invitedById       — кто пригласил (Character.id), только при создании игрока;
--   inviteeRewardAt   — когда приглашённый получил награду за порог уровня;
--   inviterClaimedAt  — когда пригласивший забрал награду за этого друга;
--   referralReadyAt   — когда друг дошёл до порога (для уведомлений бота).

ALTER TABLE "Character" ADD COLUMN     "invitedById" INTEGER,
ADD COLUMN     "inviteeRewardAt" TIMESTAMP(3),
ADD COLUMN     "inviterClaimedAt" TIMESTAMP(3),
ADD COLUMN     "referralCode" TEXT,
ADD COLUMN     "referralReadyAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Character_referralCode_key" ON "Character"("referralCode");

-- CreateIndex
CREATE INDEX "Character_invitedById_idx" ON "Character"("invitedById");

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;
