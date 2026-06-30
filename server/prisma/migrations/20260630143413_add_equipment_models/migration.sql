-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "nameRu" TEXT NOT NULL,
    "iconPath" TEXT NOT NULL,
    "levelRequired" INTEGER NOT NULL,
    "damage" INTEGER,
    "armor" INTEGER,
    "moveSpeed" DOUBLE PRECISION,
    "luck" INTEGER,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "characterId" INTEGER NOT NULL,
    "itemId" TEXT NOT NULL,
    "equipped" BOOLEAN NOT NULL DEFAULT false,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryItem_characterId_idx" ON "InventoryItem"("characterId");

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
