-- Бот @RightPlaceGame_bot (13.11.2026): разрешение и настройки уведомлений,
-- отметки отправленного, награда за канал, очередь BotNotification.
-- Только ADD COLUMN … DEFAULT / NULL и CREATE TABLE — старому серверу не мешает.
-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "botAllowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "botBlocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "channelRewardAt" TIMESTAMP(3),
ADD COLUMN     "comebackStage" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "energyNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "lastActiveAt" TIMESTAMP(3),
ADD COLUMN     "notifySettings" JSONB,
ADD COLUMN     "questsNotifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BotNotification" (
    "id" SERIAL NOT NULL,
    "characterId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sendAfter" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    "payload" JSONB,

    CONSTRAINT "BotNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BotNotification_sentAt_sendAfter_idx" ON "BotNotification"("sentAt", "sendAfter");

-- CreateIndex
CREATE INDEX "BotNotification_characterId_idx" ON "BotNotification"("characterId");

-- AddForeignKey
ALTER TABLE "BotNotification" ADD CONSTRAINT "BotNotification_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

