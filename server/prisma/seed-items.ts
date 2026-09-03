import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // InventoryItem ПЕРВЫМ — FK InventoryItem.itemId -> Item.id стоит
  // ON DELETE RESTRICT (см. 20260630143413_add_equipment_models), удаление
  // Item с живыми InventoryItem иначе падает с ошибкой FK (см. задачу
  // "перезалить каталог предметов" — этим script раньше падал бы, если
  // запустить его при непустом InventoryItem, чего раньше просто не
  // случалось в деве).
  await prisma.inventoryItem.deleteMany();
  await prisma.item.deleteMany();

  // Новый каталог — 6 тиров на ВСЕ 6 слотов (было 10 тиров оружие/броня +
  // 5 тиров шлем/сапоги/перчатки/амулет), levelRequired = tier*5, сеттинг
  // тёмного фэнтези/нежити (лестница названий ржавый/драный → солдатский →
  // дознавателя → гвардейский → безымянного → правого места), названия и
  // флейвор-тексты — 1:1 из CLAUDE.md "СПИСОК ПРЕДМЕТОВ". moveSpeed —
  // ПРОЦЕНТ (2..10), не множитель (было 1.05..1.25) — единственный код,
  // читающий это поле (server/src/routes/run.ts), просто ретранслирует его
  // клиенту как есть, математики с ним нигде нет. growth% (рост
  // силы/выносливости/ловкости у оружия/брони/перчаток) — НЕ отдельное
  // поле в БД: по дизайну это tier*5%, выводится из tier на лету, нигде не
  // хранится (см. CLAUDE.md "СКОРОСТЬ ПРОКАЧКИ").
  const items = await prisma.item.createMany({
    data: [
      // ── WEAPON (урон 5/10/15/20/25/30) ──────────────────────────────
      { id: 'weapon_t1', slot: 'weapon', tier: 1, nameRu: 'Ржавый тесак',        iconPath: 'weapons/weapon_01.png', levelRequired: 5,  damage: 5,  armor: null, moveSpeed: null, luck: null, description: 'Им резали хлеб чаще, чем врагов. Держат такой от безысходности.' },
      { id: 'weapon_t2', slot: 'weapon', tier: 2, nameRu: 'Солдатский меч',      iconPath: 'weapons/weapon_02.png', levelRequired: 10, damage: 10, armor: null, moveSpeed: null, luck: null, description: 'Клеймо стёрлось, но балансировка честная. Такими вооружали тех, кого не жалко.' },
      { id: 'weapon_t3', slot: 'weapon', tier: 3, nameRu: 'Клинок дознавателя',  iconPath: 'weapons/weapon_03.png', levelRequired: 15, damage: 15, armor: null, moveSpeed: null, luck: null, description: 'Узкий, чтобы проходить между рёбер. Дознаватели редко спрашивали дважды.' },
      { id: 'weapon_t4', slot: 'weapon', tier: 4, nameRu: 'Гвардейский палаш',   iconPath: 'weapons/weapon_04.png', levelRequired: 20, damage: 20, armor: null, moveSpeed: null, luck: null, description: 'Тяжёлый и прямой, без хитростей. Гвардия не отступала, и оружие делали под это.' },
      { id: 'weapon_t5', slot: 'weapon', tier: 5, nameRu: 'Меч безымянного',     iconPath: 'weapons/weapon_05.png', levelRequired: 25, damage: 25, armor: null, moveSpeed: null, luck: null, description: 'На рукояти вырезано имя, но прочесть его уже нельзя. Владелец, похоже, не возражает.' },
      { id: 'weapon_t6', slot: 'weapon', tier: 6, nameRu: 'Клинок правого места', iconPath: 'weapons/weapon_06.png', levelRequired: 30, damage: 30, armor: null, moveSpeed: null, luck: null, description: 'Оказался там, где нужно, и тогда, когда нужно. Больше о нём сказать нечего.' },

      // ── HELMET (броня 2/3/5/6/7/8) ──────────────────────────────────
      { id: 'helmet_t1', slot: 'helmet', tier: 1, nameRu: 'Ржавый колпак',       iconPath: 'helmets/helmet_01.png', levelRequired: 5,  damage: null, armor: 2, moveSpeed: null, luck: null, description: 'Ведро с прорезью для глаз. Внутри до сих пор пахнет прежним хозяином.' },
      { id: 'helmet_t2', slot: 'helmet', tier: 2, nameRu: 'Солдатский шлем',     iconPath: 'helmets/helmet_02.png', levelRequired: 10, damage: null, armor: 3, moveSpeed: null, luck: null, description: 'Вмятина на лбу говорит, что он однажды уже сделал свою работу.' },
      { id: 'helmet_t3', slot: 'helmet', tier: 3, nameRu: 'Забрало дознавателя', iconPath: 'helmets/helmet_03.png', levelRequired: 15, damage: null, armor: 5, moveSpeed: null, luck: null, description: 'Прорезь узкая — чтобы видеть допрашиваемого, но не встречаться с ним взглядом.' },
      { id: 'helmet_t4', slot: 'helmet', tier: 4, nameRu: 'Гвардейский армет',   iconPath: 'helmets/helmet_04.png', levelRequired: 20, damage: null, armor: 6, moveSpeed: null, luck: null, description: 'Плотно садится, глушит звук. В нём слышно только собственное дыхание.' },
      { id: 'helmet_t5', slot: 'helmet', tier: 5, nameRu: 'Шлем безымянного',    iconPath: 'helmets/helmet_05.png', levelRequired: 25, damage: null, armor: 7, moveSpeed: null, luck: null, description: 'Подогнан под чужую голову, но садится как влитой. Лучше об этом не думать.' },
      { id: 'helmet_t6', slot: 'helmet', tier: 6, nameRu: 'Венец правого места', iconPath: 'helmets/helmet_06.png', levelRequired: 30, damage: null, armor: 8, moveSpeed: null, luck: null, description: 'Не корона и не шлем. Что-то, что носят, когда больше некому.' },

      // ── ARMOR (броня 5/8/12/15/18/21) ───────────────────────────────
      { id: 'armor_t1', slot: 'armor', tier: 1, nameRu: 'Драная кожанка',        iconPath: 'armor/armor_01.png', levelRequired: 5,  damage: null, armor: 5,  moveSpeed: null, luck: null, description: 'Больше от холода, чем от клинка. Но всё-таки лучше, чем ничего.' },
      { id: 'armor_t2', slot: 'armor', tier: 2, nameRu: 'Солдатская кольчуга',   iconPath: 'armor/armor_02.png', levelRequired: 10, damage: null, armor: 8,  moveSpeed: null, luck: null, description: 'Половина колец перебрана вручную, и не тобой. Кто-то за ней следил.' },
      { id: 'armor_t3', slot: 'armor', tier: 3, nameRu: 'Панцирь дознавателя',   iconPath: 'armor/armor_03.png', levelRequired: 15, damage: null, armor: 12, moveSpeed: null, luck: null, description: 'Чёрненая сталь, чтобы не бликовать в тёмных комнатах. Практично.' },
      { id: 'armor_t4', slot: 'armor', tier: 4, nameRu: 'Гвардейская кираса',    iconPath: 'armor/armor_04.png', levelRequired: 20, damage: null, armor: 15, moveSpeed: null, luck: null, description: 'Цельная, без стыков на груди. Такую не пробьёшь ударом в упор.' },
      { id: 'armor_t5', slot: 'armor', tier: 5, nameRu: 'Доспех безымянного',    iconPath: 'armor/armor_05.png', levelRequired: 25, damage: null, armor: 18, moveSpeed: null, luck: null, description: 'Ни герба, ни клейма — всё сточено начисто. Он не хотел, чтобы его узнали.' },
      { id: 'armor_t6', slot: 'armor', tier: 6, nameRu: 'Доспех правого места',  iconPath: 'armor/armor_06.png', levelRequired: 30, damage: null, armor: 21, moveSpeed: null, luck: null, description: 'Выдержал то, что не должно было выдержаться. Дальше зависит от тебя.' },

      // ── GLOVES (броня 2/3/4/6/8/9) ───────────────────────────────────
      { id: 'gloves_t1', slot: 'gloves', tier: 1, nameRu: 'Обмотки',              iconPath: 'gloves/gloves_01.png', levelRequired: 5,  damage: null, armor: 2, moveSpeed: null, luck: null, description: 'Полосы ткани, намотанные в несколько слоёв. Хотя бы не собьёшь костяшки.' },
      { id: 'gloves_t2', slot: 'gloves', tier: 2, nameRu: 'Солдатские рукавицы', iconPath: 'gloves/gloves_02.png', levelRequired: 10, damage: null, armor: 3, moveSpeed: null, luck: null, description: 'Грубая кожа, задубевшая от пота. Зато рукоять не проскальзывает.' },
      { id: 'gloves_t3', slot: 'gloves', tier: 3, nameRu: 'Латницы дознавателя', iconPath: 'gloves/gloves_03.png', levelRequired: 15, damage: null, armor: 4, moveSpeed: null, luck: null, description: 'Пластины на пальцах сидят плотно, движения не стесняют. Работа тонкая.' },
      { id: 'gloves_t4', slot: 'gloves', tier: 4, nameRu: 'Гвардейские латницы', iconPath: 'gloves/gloves_04.png', levelRequired: 20, damage: null, armor: 6, moveSpeed: null, luck: null, description: 'Закрывают кисть целиком, до середины предплечья. Тяжело, но привыкаешь.' },
      { id: 'gloves_t5', slot: 'gloves', tier: 5, nameRu: 'Перчатки безымянного', iconPath: 'gloves/gloves_05.png', levelRequired: 25, damage: null, armor: 8, moveSpeed: null, luck: null, description: 'Разношены под чужую руку, но твоей подходят. Совпадение, надо думать.' },
      { id: 'gloves_t6', slot: 'gloves', tier: 6, nameRu: 'Хватка правого места', iconPath: 'gloves/gloves_06.png', levelRequired: 30, damage: null, armor: 9, moveSpeed: null, luck: null, description: 'Пальцы смыкаются раньше, чем ты решаешь сжать. Так и должно быть.' },

      // ── BOOTS (скорость передвижения, ПРОЦЕНТ: 2/4/6/8/9/10) ────────
      { id: 'boots_t1', slot: 'boots', tier: 1, nameRu: 'Стоптанные башмаки',    iconPath: 'boots/boots_01.png', levelRequired: 5,  damage: null, armor: null, moveSpeed: 2,  luck: null, description: 'Подошва протёрта до дыр. Каждый камень чувствуется как свой.' },
      { id: 'boots_t2', slot: 'boots', tier: 2, nameRu: 'Солдатские сапоги',     iconPath: 'boots/boots_02.png', levelRequired: 10, damage: null, armor: null, moveSpeed: 4,  luck: null, description: 'Прошагали не одну сотню миль и готовы ещё. Голенище держит лодыжку.' },
      { id: 'boots_t3', slot: 'boots', tier: 3, nameRu: 'Поступь дознавателя',   iconPath: 'boots/boots_03.png', levelRequired: 15, damage: null, armor: null, moveSpeed: 6,  luck: null, description: 'Мягкая подошва, почти не слышно шагов. Он приходил без предупреждения.' },
      { id: 'boots_t4', slot: 'boots', tier: 4, nameRu: 'Гвардейские поножи',    iconPath: 'boots/boots_04.png', levelRequired: 20, damage: null, armor: null, moveSpeed: 8,  luck: null, description: 'Окованный носок, укреплённая пятка. В таких стоят насмерть.' },
      { id: 'boots_t5', slot: 'boots', tier: 5, nameRu: 'Сапоги безымянного',    iconPath: 'boots/boots_05.png', levelRequired: 25, damage: null, armor: null, moveSpeed: 9,  luck: null, description: 'Стёрты неровно, будто он всё время сворачивал куда-то влево.' },
      { id: 'boots_t6', slot: 'boots', tier: 6, nameRu: 'Поступь правого места', iconPath: 'boots/boots_06.png', levelRequired: 30, damage: null, armor: null, moveSpeed: 10, luck: null, description: 'Ноги сами выбирают, куда ступить. Спорить с ними себе дороже.' },

      // ── AMULET (удача 1/2/3/4/5/7) ───────────────────────────────────
      { id: 'amulet_t1', slot: 'amulet', tier: 1, nameRu: 'Медный грошик',       iconPath: 'amulets/amulet_01.png', levelRequired: 5,  damage: null, armor: null, moveSpeed: null, luck: 1, description: 'Монета с дыркой, на шнурке. Ничего не стоит, но с ней спокойнее.' },
      { id: 'amulet_t2', slot: 'amulet', tier: 2, nameRu: 'Солдатский образок',  iconPath: 'amulets/amulet_02.png', levelRequired: 10, damage: null, armor: null, moveSpeed: null, luck: 2, description: 'Затёртый до гладкости — его держали в кулаке слишком часто.' },
      { id: 'amulet_t3', slot: 'amulet', tier: 3, nameRu: 'Печать дознавателя',  iconPath: 'amulets/amulet_03.png', levelRequired: 15, damage: null, armor: null, moveSpeed: null, luck: 3, description: 'Оттиск сбит намеренно, чтобы никто не разобрал, чья она.' },
      { id: 'amulet_t4', slot: 'amulet', tier: 4, nameRu: 'Гвардейский знак',    iconPath: 'amulets/amulet_04.png', levelRequired: 20, damage: null, armor: null, moveSpeed: null, luck: 4, description: 'Выдавался за выслугу. Тем, кто дожил до выслуги.' },
      { id: 'amulet_t5', slot: 'amulet', tier: 5, nameRu: 'Оберег безымянного',  iconPath: 'amulets/amulet_05.png', levelRequired: 25, damage: null, armor: null, moveSpeed: null, luck: 5, description: 'Пустая оправа — камень выпал давно. Работать почему-то не перестал.' },
      { id: 'amulet_t6', slot: 'amulet', tier: 6, nameRu: 'Глаз правого места',  iconPath: 'amulets/amulet_06.png', levelRequired: 30, damage: null, armor: null, moveSpeed: null, luck: 7, description: 'Смотрит не наружу, а куда-то мимо. Иногда кажется, что он моргнул.' },
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
