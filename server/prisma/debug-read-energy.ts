// ⚠️ РАЗОВЫЙ ДИАГНОСТИЧЕСКИЙ СКРИПТ, ТОЛЬКО ЧТЕНИЕ. НЕ ЧАСТЬ ПРОДАКШЕН-ЛОГИКИ.
//
// Печатает всё, из чего складывается энергия ОДНОГО персонажа: что лежит в БД,
// что по этим числам посчитает сервер и что по ним обязан показать экран. Нужен
// затем, ради чего и писался (04.10.2026, баг «99 / 100»): отличить «сервер
// считает неверно» от «сервер прав, врёт клиент». В тот раз ответ дали ровно эти
// числа — `lastEnergyUpdate` не двигался 4.5 суток, значит никто его на входе не
// переписывает.
//
// Запускать руками из server/, Telegram id — АРГУМЕНТОМ:
//   npx tsx prisma\debug-read-energy.ts 6300469853
//
// ⚠️ id НЕ ЗАШИТ в файл и зашит быть не должен: в репозитории ему не место (это
// личные данные игрока), а скрипт одинаково нужен для любого аккаунта. Без
// аргумента скрипт печатает подсказку и выходит — списка всех персонажей он тоже
// не печатает намеренно, чтобы диагностика одного игрока не выгружала чужие
// данные.
//
// ⚠️ Смотрит в БОЕВУЮ базу (DATABASE_URL из server/.env). Ни одного update, ни
// одной миграции: только findUnique и SELECT NOW().
//
// ЧЕГО ЗДЕСЬ БЫТЬ НЕ ДОЛЖНО: ни один эндпоинт, ни одна строка server/src не
// имеет права импортировать этот файл. Он лежит в prisma/ ровно потому, что эта
// папка вне "rootDir": "./src" и в сборку (npm run build) не попадает — как и
// соседние debug-set-level.ts / debug-give-all-items.ts / seed-items.ts.
// Проверено: после `npm run build` в dist/ его нет.

import { PrismaClient } from '@prisma/client'
// Формулы импортируются из БОЕВОГО кода, а не копируются сюда: вторая копия
// разошлась бы молча, и скрипт начал бы «проверять» несуществующий темп. Тот же
// приём, что в debug-set-level.ts с calculateLevel. Расширение .js — требование
// ESM (см. CLAUDE.md).
import { energyForClient, regenerateEnergy } from '../src/game.js'
import { MAX_ENERGY, ENERGY_REGEN_MS, msToNextEnergy } from '../src/energy.js'

const prisma = new PrismaClient()

const USAGE = 'Запуск: npx tsx prisma\\debug-read-energy.ts <telegramId>'

/** Аргумент → telegramId (BigInt в схеме), либо null с подсказкой. */
function parseTelegramId(raw: string | undefined): bigint | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null
  return BigInt(raw)
}

/** Остаток до следующей единицы как «2:00» — ровно так же, как считает экран. */
function countdownText(stored: number, elapsedMs: number): string {
  const left = msToNextEnergy(stored, elapsedMs)
  if (left === null) return 'энергия полна, таймера нет'
  const totalSec = Math.ceil(left / 1000)
  return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`
}

async function main() {
  const telegramId = parseTelegramId(process.argv[2])
  if (telegramId === null) {
    console.error(process.argv[2] === undefined ? 'Не указан Telegram id.' : `Telegram id должен быть числом, получено: ${process.argv[2]}`)
    console.error(USAGE)
    process.exitCode = 1
    return
  }

  const nodeNow = new Date()
  const dbRows = await prisma.$queryRaw<{ now: Date }[]>`SELECT NOW() as now`
  const dbNow = dbRows[0]?.now ?? null

  const user = await prisma.user.findUnique({
    where: { telegramId },
    select: {
      firstName: true,
      username: true,
      character: {
        select: { energy: true, lastEnergyUpdate: true, level: true, currentRun: true },
      },
    },
  })

  console.log(`шаг восстановления: ${ENERGY_REGEN_MS / 1000} с на единицу, потолок ${MAX_ENERGY}`)
  console.log(`Node now : ${nodeNow.toISOString()}`)
  console.log(`DB   now : ${dbNow === null ? '—' : dbNow.toISOString()}`)
  if (dbNow !== null) {
    console.log(`перекос часов БД − Node: ${((dbNow.getTime() - nodeNow.getTime()) / 1000).toFixed(1)} с`)
  }
  console.log('')

  if (user === null) {
    console.error(`Пользователь с telegramId=${telegramId} не найден.`)
    process.exitCode = 1
    return
  }
  if (user.character === null) {
    console.error(`У ${user.firstName} (telegramId=${telegramId}) нет персонажа.`)
    process.exitCode = 1
    return
  }

  const c = user.character
  const elapsedMs = nodeNow.getTime() - c.lastEnergyUpdate.getTime()
  const forClient = energyForClient(c.energy, c.lastEnergyUpdate, nodeNow)
  const regen = regenerateEnergy(c.energy, c.lastEnergyUpdate, nodeNow)

  console.log(`${user.firstName}${user.username ? ' @' + user.username : ''} (telegramId=${telegramId}, уровень ${c.level})`)
  console.log('  --- что лежит в БД ---')
  console.log(`  energy            : ${c.energy}`)
  console.log(`  lastEnergyUpdate  : ${c.lastEnergyUpdate.toISOString()}`)
  console.log(`  прошло с тех пор  : ${(elapsedMs / 1000).toFixed(1)} с${elapsedMs < 0 ? '  ⚠️ МЕТКА В БУДУЩЕМ' : ''}`)
  console.log(`  currentRun        : ${c.currentRun === null ? 'пусто' : 'ЕСТЬ открытый забег'}`)
  console.log('  --- что посчитает сервер ---')
  console.log(`  энергия сейчас    : ${regen.energy}`)
  console.log(`  новая метка (если бы писал): ${regen.lastEnergyUpdate.toISOString()}`)
  console.log('  --- что уйдёт клиенту и что он покажет ---')
  console.log(`  energy            : ${forClient.energy} / ${MAX_ENERGY}`)
  console.log(`  energyAccruedSec  : ${forClient.accruedSec}`)
  console.log(`  «+1 через»        : ${countdownText(c.energy, elapsedMs)}`)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
