-- Ключи идемпотентности (15.10.2026): повтор запроса с тем же ключом не
-- применяется второй раз. Читают и пишут покупки (buy-potion, buy-consumable,
-- buy-upgrade) и финиш забега — см. комментарий к модели IdempotencyKey в
-- schema.prisma.
--
-- Миграция ТОЛЬКО ДОБАВЛЯЕТ таблицу: ни одна существующая колонка не меняется,
-- данные персонажей не трогаются. Поэтому порядок выкладки обычный и
-- безопасный: миграция -> сервер -> клиент. Старый сервер, работающий в момент
-- применения, этой таблицы не видит и не читает, — уронить его она не может.
--
-- ⚠️ Применять против боевой базы — Андрею (server/.env смотрит в прод):
--   cd server && npx prisma migrate deploy
-- и сразу после — npx prisma migrate status (read-only), чтобы увидеть
-- "Database schema is up to date!".

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" SERIAL NOT NULL,
    "characterId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IdempotencyKey_characterId_createdAt_idx" ON "IdempotencyKey"("characterId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_characterId_key_key" ON "IdempotencyKey"("characterId", "key");

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

