import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const before = await prisma.character.findMany({
    select: { id: true, level: true, strengthAtLevelUp: true, enduranceAtLevelUp: true },
    orderBy: { id: 'asc' },
  });

  console.log('BEFORE:');
  for (const c of before) {
    console.log(`  id=${c.id}  level=${c.level}  strengthAtLevelUp=${c.strengthAtLevelUp}  enduranceAtLevelUp=${c.enduranceAtLevelUp}`);
  }

  // Fix level < 1
  const levelFix = await prisma.character.updateMany({
    where: { level: { lt: 1 } },
    data: { level: 1 },
  });

  // Reset atLevelUp snapshots to match current stats (both now = 10)
  const snapshotFix = await prisma.character.updateMany({
    data: { strengthAtLevelUp: 10, enduranceAtLevelUp: 10 },
  });

  console.log(`\nUpdated ${levelFix.count} character(s) with level < 1 → level = 1`);
  console.log(`Updated ${snapshotFix.count} character(s): strengthAtLevelUp = 10, enduranceAtLevelUp = 10`);

  const after = await prisma.character.findMany({
    select: { id: true, level: true, strengthAtLevelUp: true, enduranceAtLevelUp: true },
    orderBy: { id: 'asc' },
  });

  console.log('\nAFTER:');
  for (const c of after) {
    console.log(`  id=${c.id}  level=${c.level}  strengthAtLevelUp=${c.strengthAtLevelUp}  enduranceAtLevelUp=${c.enduranceAtLevelUp}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
