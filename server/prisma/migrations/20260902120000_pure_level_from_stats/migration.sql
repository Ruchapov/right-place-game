/*
  Warnings:

  - You are about to drop the column `strengthAtLevelUp` on the `Character` table. All the data in the column will be lost.
  - You are about to drop the column `enduranceAtLevelUp` on the `Character` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Character" DROP COLUMN "strengthAtLevelUp",
DROP COLUMN "enduranceAtLevelUp";
