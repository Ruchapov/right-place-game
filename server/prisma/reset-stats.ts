import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.character.updateMany({
    data: {
      strength: 10,
      endurance: 10,
      agility: 10,
      strengthProgress: 0,
      enduranceProgress: 0,
      agilityProgress: 0,
    },
  });

  console.log(`\nUpdated ${result.count} character(s).\n`);

  const sample = await prisma.character.findFirst({
    select: {
      id: true,
      strength: true,
      endurance: true,
      agility: true,
      strengthProgress: true,
      enduranceProgress: true,
      agilityProgress: true,
    },
  });

  console.log('Sanity check (first character):');
  console.log(JSON.stringify(sample, null, 2));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
