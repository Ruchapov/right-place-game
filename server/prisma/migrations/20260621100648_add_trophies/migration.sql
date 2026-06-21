-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "currentRun" JSONB,
ADD COLUMN     "trophies" INTEGER NOT NULL DEFAULT 0;
