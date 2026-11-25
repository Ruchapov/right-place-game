-- «Печать Колокола» — премиум за RP (25.11.2026, docs/premium.md). Только
-- ADD COLUMN — старому серверу не мешает. Сервер без неё уронит вход
-- (premiumUntil читается в каждом ответе с персонажем). Применяет npm run
-- deploy на сервере, после бэкапа predeploy-*.dump.

-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "premiumUntil" TIMESTAMP(3),
ADD COLUMN     "premiumNoticeStage" INTEGER NOT NULL DEFAULT 0;
