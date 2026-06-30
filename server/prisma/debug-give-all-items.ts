import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: npx tsx prisma/debug-give-all-items.ts <characterId>');
    process.exit(1);
  }

  const characterId = parseInt(arg, 10);
  if (isNaN(characterId)) {
    console.error(`Invalid characterId: "${arg}"`);
    process.exit(1);
  }

  const character = await prisma.character.findUnique({ where: { id: characterId } });
  if (!character) {
    console.error(`No character found with id=${characterId}`);
    process.exit(1);
  }

  const allItems = await prisma.item.findMany({ orderBy: [{ slot: 'asc' }, { tier: 'asc' }] });
  if (allItems.length === 0) {
    console.error('Item catalog is empty — run seed-items.ts first');
    process.exit(1);
  }

  const existing = await prisma.inventoryItem.findMany({
    where: { characterId },
    select: { itemId: true },
  });
  const ownedItemIds = new Set(existing.map((i) => i.itemId));

  const toCreate = allItems.filter((item) => !ownedItemIds.has(item.id));

  if (toCreate.length === 0) {
    console.log(`Character ${characterId} already owns all ${allItems.length} items — nothing to add.`);
    return;
  }

  await prisma.inventoryItem.createMany({
    data: toCreate.map((item) => ({
      characterId,
      itemId: item.id,
      equipped: false,
    })),
  });

  console.log(`\nCharacter id=${characterId} — items added: ${toCreate.length} (skipped ${ownedItemIds.size} already owned)\n`);

  const counts = await prisma.inventoryItem.groupBy({
    by: ['itemId'],
    where: { characterId },
    _count: { _all: true },
  });
  console.log(`Total inventory size: ${counts.length} items`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
