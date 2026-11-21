-- Сердце босса и ячейки сумки за золото (21.11.2026, docs/items.md, «СЕРДЦЕ
-- БОССА», docs/shop.md, «ЯЧЕЙКИ СУМКИ»). Только ADD COLUMN … DEFAULT — старому
-- серверу не мешает.
-- ⚠️ ПОРЯДОК ВЫКЛАДКИ: бэкап Neon (backup-2026-11-21-before-hearts) →
-- migrate deploy → сервер → фронт. Сервер без неё уронит вход: bossHearts
-- читается в каждом ответе с персонажем (classItemStockOf).

-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "bossHearts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "bagCellsBought" INTEGER NOT NULL DEFAULT 0;
