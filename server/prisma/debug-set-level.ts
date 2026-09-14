// ⚠️ РАЗОВЫЙ ОТЛАДОЧНЫЙ СКРИПТ. НЕ ЧАСТЬ ПРОДАКШЕН-ЛОГИКИ.
//
// Выставляет статы персонажа так, чтобы calculateLevel() дал РОВНО заданный
// уровень (по умолчанию 30). Нужен для отладки контента высокого уровня:
// предметы 6 тира требуют levelRequired = 30, а честно доиграть до 30 —
// десятки забегов.
//
// Запускать ТОЛЬКО руками из server/:
//   npx tsx prisma\debug-set-level.ts --list            — список персонажей
//   npx tsx prisma\debug-set-level.ts <characterId>     — поднять до 30
//   npx tsx prisma\debug-set-level.ts <characterId> 30  — то же явно
//   npx tsx prisma\debug-set-level.ts <characterId> 1   — откатить к базе
//
// ЧЕГО ЗДЕСЬ БЫТЬ НЕ ДОЛЖНО: ни один эндпоинт, ни одна строка server/src не
// имеет права импортировать этот файл. Он лежит в prisma/ ровно потому, что
// эта папка вне "rootDir": "./src" и в сборку (npm run build) не попадает —
// как и соседние debug-give-all-items.ts / seed-items.ts. Если однажды
// появится настоящая механика выдачи уровней (например предмет-"сердце" с
// босса), она пишется в server/src с нуля, а не вызовом отсюда.

import { PrismaClient } from '@prisma/client';
// Формула уровня импортируется из боевого кода, а НЕ копируется сюда: вторая
// копия разошлась бы с game.ts молча, и скрипт начал бы выставлять статы под
// несуществующую формулу. game.ts — чистая логика (ни БД, ни HTTP), тянуть её
// в скрипт безопасно. Расширение .js — требование ESM (см. CLAUDE.md).
import { calculateLevel } from '../src/game.js';

const prisma = new PrismaClient();

const DEFAULT_TARGET_LEVEL = 30;

/**
 * Обратная задача к calculateLevel:
 *   level = 1 + max(floor((S + A - 20) / 6), floor((E - 10) / 3)) + bonusLevels
 *
 * Оба канала ставим на ОДНО И ТО ЖЕ значение — иначе получится перекос:
 * уровень определяется максимумом, и отстающий канал остался бы на базе
 * (герой 30 уровня с выносливостью 10 и 80 HP, либо с уроном как на 1-м).
 * Внутри канала урона сила и ловкость делятся ровно пополам: сила даёт урон
 * мечом (15 + floor(S/2)), ловкость — скиллы, и занижать одну в пользу другой
 * нет причины.
 *
 * bonusLevels НЕ трогаем и НЕ обнуляем — это счётчик реальных событий
 * (убийства босса), его место в формуле слагаемым. Поэтому нужный канал
 * считается С ЕГО УЧЁТОМ, и итоговый уровень получается ровно target, а не
 * target + bonusLevels.
 *
 * null — цель недостижима статами: bonusLevels уже поднял уровень выше
 * запрошенного, и уменьшить его можно только правкой самого счётчика, чего
 * скрипт намеренно не делает.
 */
function statsForLevel(targetLevel: number, bonusLevels: number): { strength: number; agility: number; endurance: number } | null {
  const needed = targetLevel - 1 - bonusLevels;
  if (needed < 0) return null;
  // Минимальные значения, дающие нужный канал: floor((S+A-20)/6) === needed
  // при S+A = needed*6 + 20, и floor((E-10)/3) === needed при E = needed*3+10.
  // Берём именно минимум — на единицу больше уровень не изменит, но лишних
  // очков в статах быть не должно.
  const sumSA = needed * 6 + 20; // всегда чётное, делится пополам без остатка
  const strength = sumSA / 2;
  const agility = sumSA - strength;
  const endurance = needed * 3 + 10;
  return { strength, agility, endurance };
}

async function list() {
  const characters = await prisma.character.findMany({
    include: { user: { select: { telegramId: true, username: true, firstName: true } } },
    orderBy: { id: 'asc' },
  });
  if (characters.length === 0) {
    console.log('\nПерсонажей в базе нет.\n');
    return;
  }
  console.log('\nПерсонажи в базе:\n');
  for (const c of characters) {
    const level = calculateLevel(c.strength, c.agility, c.endurance, c.bonusLevels);
    console.log(
      `  characterId=${c.id}  userId=${c.userId}  ` +
      `tg=@${c.user.username ?? '—'} (${c.user.firstName}, id ${c.user.telegramId})\n` +
      `      сила=${c.strength} ловкость=${c.agility} выносливость=${c.endurance} ` +
      `bonusLevels=${c.bonusLevels}  →  уровень ${level}  (колонка level=${c.level})`,
    );
  }
  console.log('\nНужный characterId — первым числом в строке.\n');
}

async function main() {
  const arg = process.argv[2];

  if (!arg || arg === '--help' || arg === '-h') {
    console.error('Usage: npx tsx prisma\\debug-set-level.ts --list');
    console.error('       npx tsx prisma\\debug-set-level.ts <characterId> [targetLevel=30]');
    process.exit(1);
  }

  if (arg === '--list') {
    await list();
    return;
  }

  const characterId = Number.parseInt(arg, 10);
  if (!Number.isInteger(characterId)) {
    console.error(`Invalid characterId: "${arg}". Список персонажей: --list`);
    process.exit(1);
  }

  const targetRaw = process.argv[3];
  const targetLevel = targetRaw === undefined ? DEFAULT_TARGET_LEVEL : Number.parseInt(targetRaw, 10);
  if (!Number.isInteger(targetLevel) || targetLevel < 1) {
    console.error(`Invalid targetLevel: "${targetRaw}" (нужно целое >= 1)`);
    process.exit(1);
  }

  const before = await prisma.character.findUnique({ where: { id: characterId } });
  if (!before) {
    console.error(`No character found with id=${characterId}. Список персонажей: --list`);
    process.exit(1);
  }

  const target = statsForLevel(targetLevel, before.bonusLevels);
  if (!target) {
    console.error(
      `\nУровень ${targetLevel} недостижим статами: bonusLevels=${before.bonusLevels} ` +
      `уже даёт минимум ${1 + before.bonusLevels}.\n` +
      'Скрипт bonusLevels не меняет намеренно — это счётчик убитых боссов.\n',
    );
    process.exit(1);
  }

  const levelBefore = calculateLevel(before.strength, before.agility, before.endurance, before.bonusLevels);
  console.log(
    `\nБыло:  сила=${before.strength} ловкость=${before.agility} выносливость=${before.endurance} ` +
    `bonusLevels=${before.bonusLevels}  →  уровень ${levelBefore}`,
  );
  console.log(
    `       прогресс: сила=${before.strengthProgress} выносливость=${before.enduranceProgress} ловкость=${before.agilityProgress}`,
  );

  const after = await prisma.character.update({
    where: { id: characterId },
    data: {
      strength: target.strength,
      agility: target.agility,
      endurance: target.endurance,
      // Накопленный прогресс обнуляется: он набирался против ПРЕЖНИХ порогов
      // (порог растёт от самого стата, см. applyStatProgress в game.ts), и
      // против новых это остаток от другой задачи. Ломать им ничего нельзя,
      // но и смысла он не несёт — обнуляем, чтобы состояние было предсказуемым.
      strengthProgress: 0,
      enduranceProgress: 0,
      agilityProgress: 0,
      // Денормализованный снимок — по схеме любая запись статов обязана его
      // обновить (логика его не читает, но аналитика/отладка смотрит именно
      // сюда).
      level: calculateLevel(target.strength, target.agility, target.endurance, before.bonusLevels),
    },
  });

  const levelAfter = calculateLevel(after.strength, after.agility, after.endurance, after.bonusLevels);
  console.log(
    `Стало: сила=${after.strength} ловкость=${after.agility} выносливость=${after.endurance} ` +
    `bonusLevels=${after.bonusLevels}  →  уровень ${levelAfter}  (колонка level=${after.level})`,
  );
  console.log(`       прогресс обнулён; HP в забеге = выносливость*8 = ${after.endurance * 8}; урон мечом = ${15 + Math.floor(after.strength / 2)}`);

  if (levelAfter !== targetLevel) {
    console.error(`\n⚠️ Уровень получился ${levelAfter}, а просили ${targetLevel} — формула calculateLevel изменилась, проверь statsForLevel.\n`);
    process.exit(1);
  }
  console.log(`\nГотово: уровень ровно ${targetLevel}. Перезайди в Mini App (••• → Reload Page) — профиль читается при логине.\n`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
