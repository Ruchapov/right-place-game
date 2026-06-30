/*
  Warnings:

  - You are about to drop the column `totalDamageDealt` on the `Character` table. All the data in the column will be lost.
  - You are about to drop the column `totalDamageReceived` on the `Character` table. All the data in the column will be lost.
  - You are about to drop the column `totalSkillUses` on the `Character` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Character" DROP COLUMN "totalDamageDealt",
DROP COLUMN "totalDamageReceived",
DROP COLUMN "totalSkillUses",
ADD COLUMN     "agilityProgress" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "enduranceProgress" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "strengthProgress" DOUBLE PRECISION NOT NULL DEFAULT 0,
ALTER COLUMN "strength" SET DEFAULT 10,
ALTER COLUMN "agility" SET DEFAULT 10;
