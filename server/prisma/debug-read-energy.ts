// ⚠️ РАЗОВЫЙ ДИАГНОСТИЧЕСКИЙ СКРИПТ, ТОЛЬКО ЧТЕНИЕ. НЕ ЧАСТЬ ПРОДАКШЕН-ЛОГИКИ.
//
// Печатает energy/lastEnergyUpdate всех персонажей, время БД и время Node —
// чтобы понять, почему энергия стоит на 99. Ни одного update, ни одной
// миграции: только findMany и SELECT NOW().
//
// Запускать руками из server/:
//   npx tsx prisma\debug-read-energy.ts
//
// ⚠️ Смотрит в БОЕВУЮ базу (DATABASE_URL из server/.env).

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const nodeNow = new Date()
  const dbRows = await prisma.$queryRaw<{ now: Date }[]>`SELECT NOW() as now`
  const dbNow = dbRows[0]?.now ?? null

  const chars = await prisma.character.findMany({
    select: {
      id: true,
      energy: true,
      lastEnergyUpdate: true,
      level: true,
      currentRun: true,
      user: { select: { telegramId: true, firstName: true, username: true } },
    },
  })

  console.log('Node now :', nodeNow.toISOString())
  console.log('DB   now :', dbNow === null ? '—' : dbNow.toISOString())
  if (dbNow !== null) {
    console.log('перекос часов БД - Node:', ((dbNow.getTime() - nodeNow.getTime()) / 1000).toFixed(1), 'с')
  }
  console.log('персонажей:', chars.length)
  console.log('')

  for (const c of chars) {
    const last = c.lastEnergyUpdate
    const elapsedSec = (nodeNow.getTime() - last.getTime()) / 1000
    const minutes = Math.floor(elapsedSec / 60)
    console.log(`tg=${c.user.telegramId} ${c.user.firstName}${c.user.username ? ' @' + c.user.username : ''} (уровень ${c.level})`)
    console.log(`  energy (в БД)      : ${c.energy}`)
    console.log(`  lastEnergyUpdate   : ${last.toISOString()}`)
    console.log(`  прошло от Node now : ${elapsedSec.toFixed(1)} с = ${minutes} полных минут${elapsedSec < 0 ? '  ⚠️ МЕТКА В БУДУЩЕМ' : ''}`)
    console.log(`  при шаге 1/мин     : ${Math.min(100, c.energy + minutes)}`)
    console.log(`  при шаге 1/2мин    : ${Math.min(100, c.energy + Math.floor(minutes / 2))}`)
    console.log(`  currentRun         : ${c.currentRun === null ? 'пусто' : 'ЕСТЬ открытый забег'}`)
    console.log('')
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
