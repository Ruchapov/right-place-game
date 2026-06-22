-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "equippedSkills" TEXT[] DEFAULT ARRAY[]::TEXT[];
