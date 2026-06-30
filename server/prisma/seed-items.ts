import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.item.deleteMany();

  const items = await prisma.item.createMany({
    data: [
      // ── WEAPONS ─────────────────────────────────────────────────────────────
      { slot: 'weapon', tier: 1,  nameRu: 'Железный кинжал с кожаной рукоятью', iconPath: 'weapons/weapon_01.png', levelRequired: 5,  damage: 9,  armor: null, moveSpeed: null, luck: null },
      { slot: 'weapon', tier: 2,  nameRu: 'Медный боевой молот',                iconPath: 'weapons/weapon_02.png', levelRequired: 10, damage: 13, armor: null, moveSpeed: null, luck: null },
      { slot: 'weapon', tier: 3,  nameRu: 'Изогнутый кинжал',                   iconPath: 'weapons/weapon_03.png', levelRequired: 15, damage: 17, armor: null, moveSpeed: null, luck: null },
      { slot: 'weapon', tier: 4,  nameRu: 'Тяжёлая железная булава',             iconPath: 'weapons/weapon_04.png', levelRequired: 20, damage: 21, armor: null, moveSpeed: null, luck: null },
      { slot: 'weapon', tier: 5,  nameRu: 'Стальной боевой топор',               iconPath: 'weapons/weapon_05.png', levelRequired: 25, damage: 25, armor: null, moveSpeed: null, luck: null },
      { slot: 'weapon', tier: 6,  nameRu: 'Стальной длинный меч',                iconPath: 'weapons/weapon_06.png', levelRequired: 30, damage: 29, armor: null, moveSpeed: null, luck: null },
      { slot: 'weapon', tier: 7,  nameRu: 'Средневековый длинный меч',           iconPath: 'weapons/weapon_07.png', levelRequired: 35, damage: 33, armor: null, moveSpeed: null, luck: null },
      { slot: 'weapon', tier: 8,  nameRu: 'Проклятый кинжал некроманта',         iconPath: 'weapons/weapon_08.png', levelRequired: 40, damage: 37, armor: null, moveSpeed: null, luck: null },
      { slot: 'weapon', tier: 9,  nameRu: 'Вулканический боевой молот',          iconPath: 'weapons/weapon_09.png', levelRequired: 45, damage: 41, armor: null, moveSpeed: null, luck: null },
      { slot: 'weapon', tier: 10, nameRu: 'Небесный двуручный меч',              iconPath: 'weapons/weapon_10.png', levelRequired: 50, damage: 45, armor: null, moveSpeed: null, luck: null },

      // ── ARMOR ────────────────────────────────────────────────────────────────
      { slot: 'armor', tier: 1,  nameRu: 'Кованые латы гнома',             iconPath: 'armor/armor_01.png', levelRequired: 5,  damage: null, armor: 6,  moveSpeed: null, luck: null },
      { slot: 'armor', tier: 2,  nameRu: 'Ламеллярная броня викинга',      iconPath: 'armor/armor_02.png', levelRequired: 10, damage: null, armor: 9,  moveSpeed: null, luck: null },
      { slot: 'armor', tier: 3,  nameRu: 'Одеяние ассасина',               iconPath: 'armor/armor_03.png', levelRequired: 15, damage: null, armor: 12, moveSpeed: null, luck: null },
      { slot: 'armor', tier: 4,  nameRu: 'Кольчуга кракена',               iconPath: 'armor/armor_04.png', levelRequired: 20, damage: null, armor: 15, moveSpeed: null, luck: null },
      { slot: 'armor', tier: 5,  nameRu: 'Проклятые латы некроманта',      iconPath: 'armor/armor_05.png', levelRequired: 25, damage: null, armor: 18, moveSpeed: null, luck: null },
      { slot: 'armor', tier: 6,  nameRu: 'Призрачная кольчуга',            iconPath: 'armor/armor_06.png', levelRequired: 30, damage: null, armor: 21, moveSpeed: null, luck: null },
      { slot: 'armor', tier: 7,  nameRu: 'Доспехи ледяного воина',         iconPath: 'armor/armor_07.png', levelRequired: 35, damage: null, armor: 24, moveSpeed: null, luck: null },
      { slot: 'armor', tier: 8,  nameRu: 'Нагрудник кровавого рыцаря',     iconPath: 'armor/armor_08.png', levelRequired: 40, damage: null, armor: 27, moveSpeed: null, luck: null },
      { slot: 'armor', tier: 9,  nameRu: 'Одеяние пустоты',                iconPath: 'armor/armor_09.png', levelRequired: 45, damage: null, armor: 30, moveSpeed: null, luck: null },
      { slot: 'armor', tier: 10, nameRu: 'Драконьи доспехи',               iconPath: 'armor/armor_10.png', levelRequired: 50, damage: null, armor: 33, moveSpeed: null, luck: null },

      // ── HELMETS ──────────────────────────────────────────────────────────────
      // armor = Math.round(3 + tier * 1.5): 5, 6, 8, 9, 11
      { slot: 'helmet', tier: 1, nameRu: 'Гномий боевой шлем',          iconPath: 'helmets/helmet_01.png', levelRequired: 10, damage: null, armor: 5,  moveSpeed: null, luck: null },
      { slot: 'helmet', tier: 2, nameRu: 'Капюшон и маска ассасина',    iconPath: 'helmets/helmet_02.png', levelRequired: 20, damage: null, armor: 6,  moveSpeed: null, luck: null },
      { slot: 'helmet', tier: 3, nameRu: 'Костяной шлем некроманта',    iconPath: 'helmets/helmet_03.png', levelRequired: 30, damage: null, armor: 8,  moveSpeed: null, luck: null },
      { slot: 'helmet', tier: 4, nameRu: 'Маска тени пустоты',          iconPath: 'helmets/helmet_04.png', levelRequired: 40, damage: null, armor: 9,  moveSpeed: null, luck: null },
      { slot: 'helmet', tier: 5, nameRu: 'Драконий шлем-визор',         iconPath: 'helmets/helmet_05.png', levelRequired: 50, damage: null, armor: 11, moveSpeed: null, luck: null },

      // ── BOOTS ────────────────────────────────────────────────────────────────
      // moveSpeed = 1.0 + tier * 0.05: 1.05, 1.10, 1.15, 1.20, 1.25
      { slot: 'boots', tier: 1, nameRu: 'Кованые сабатоны гнома',      iconPath: 'boots/boots_01.png', levelRequired: 10, damage: null, armor: null, moveSpeed: 1.05, luck: null },
      { slot: 'boots', tier: 2, nameRu: 'Кожаные сапоги ассасина',     iconPath: 'boots/boots_02.png', levelRequired: 20, damage: null, armor: null, moveSpeed: 1.10, luck: null },
      { slot: 'boots', tier: 3, nameRu: 'Сапоги некроманта',           iconPath: 'boots/boots_03.png', levelRequired: 30, damage: null, armor: null, moveSpeed: 1.15, luck: null },
      { slot: 'boots', tier: 4, nameRu: 'Сапоги тени пустоты',         iconPath: 'boots/boots_04.png', levelRequired: 40, damage: null, armor: null, moveSpeed: 1.20, luck: null },
      { slot: 'boots', tier: 5, nameRu: 'Драконьи сабатоны',           iconPath: 'boots/boots_05.png', levelRequired: 50, damage: null, armor: null, moveSpeed: 1.25, luck: null },

      // ── GLOVES ───────────────────────────────────────────────────────────────
      // armor = 2 + tier * 2: 4, 6, 8, 10, 12
      { slot: 'gloves', tier: 1, nameRu: 'Кованые перчатки гнома',           iconPath: 'gloves/gloves_01.png', levelRequired: 10, damage: null, armor: 4,  moveSpeed: null, luck: null },
      { slot: 'gloves', tier: 2, nameRu: 'Кожаные перчатки ассасина',        iconPath: 'gloves/gloves_02.png', levelRequired: 20, damage: null, armor: 6,  moveSpeed: null, luck: null },
      { slot: 'gloves', tier: 3, nameRu: 'Чешуйчатые перчатки кракена',      iconPath: 'gloves/gloves_03.png', levelRequired: 30, damage: null, armor: 8,  moveSpeed: null, luck: null },
      { slot: 'gloves', tier: 4, nameRu: 'Проклятые перчатки некроманта',    iconPath: 'gloves/gloves_04.png', levelRequired: 40, damage: null, armor: 10, moveSpeed: null, luck: null },
      { slot: 'gloves', tier: 5, nameRu: 'Драконьи латные перчатки',         iconPath: 'gloves/gloves_05.png', levelRequired: 50, damage: null, armor: 12, moveSpeed: null, luck: null },

      // ── AMULETS ──────────────────────────────────────────────────────────────
      // luck = 2 + tier * 2: 4, 6, 8, 10, 12
      { slot: 'amulet', tier: 1, nameRu: 'Ламеллярный амулет викинга',    iconPath: 'amulets/amulet_01.png', levelRequired: 10, damage: null, armor: null, moveSpeed: null, luck: 4  },
      { slot: 'amulet', tier: 2, nameRu: 'Подвеска ассасина',             iconPath: 'amulets/amulet_02.png', levelRequired: 20, damage: null, armor: null, moveSpeed: null, luck: 6  },
      { slot: 'amulet', tier: 3, nameRu: 'Костяной амулет некроманта',    iconPath: 'amulets/amulet_03.png', levelRequired: 30, damage: null, armor: null, moveSpeed: null, luck: 8  },
      { slot: 'amulet', tier: 4, nameRu: 'Амулет драконьего сердца',      iconPath: 'amulets/amulet_04.png', levelRequired: 40, damage: null, armor: null, moveSpeed: null, luck: 10 },
      { slot: 'amulet', tier: 5, nameRu: 'Солнечный амулет паладина',     iconPath: 'amulets/amulet_05.png', levelRequired: 50, damage: null, armor: null, moveSpeed: null, luck: 12 },
    ],
  });

  // ── Summary ──────────────────────────────────────────────────────────────────
  const counts = await prisma.item.groupBy({
    by: ['slot'],
    _count: { _all: true },
    orderBy: { slot: 'asc' },
  });

  console.log(`\nSeeded ${items.count} items total:\n`);
  for (const row of counts) {
    console.log(`  ${row.slot.padEnd(8)} ${row._count._all}`);
  }
  console.log();
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
