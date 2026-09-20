import { FastifyInstance } from 'fastify'
import jwt from 'jsonwebtoken'
import { PrismaClient, Prisma } from '@prisma/client'
import { verifyTelegramInitData, parseTelegramUser } from '../auth.js'
import { getCurrentEnergy, calculateLevel, applyStatGrowth } from '../game.js'
import {
  type ActiveExploreRun,
  readRunPotionsDrunk,
  readRunProgress,
  emptyRunProgress,
  clampRunProgress,
  runPotionStock,
  runSipsAllowed,
  clampPotionsSpent,
  subtractPotionStock,
  potionStockOf,
  potionStockToColumns,
} from '../runState.js'
import { emptyPotionStock } from '../potions.js'
import type { RunResultSummary } from './run.js'

const prisma = new PrismaClient()

export async function authRoutes(server: FastifyInstance) {
  // POST /auth/login — verify Telegram initData and return JWT
  server.post<{
    Body: { initData: string }
  }>('/auth/login', async (request, reply) => {
    const { initData } = request.body

    if (!initData) {
      return reply.status(400).send({ error: 'initData is required' })
    }

    // Verify initData signature from Telegram
    const botToken = process.env.BOT_TOKEN
    if (!botToken) {
      return reply.status(500).send({ error: 'Server configuration error' })
    }

    const isValid = await verifyTelegramInitData(initData, botToken)
    if (!isValid) {
      return reply.status(401).send({ error: 'Invalid initData' })
    }

    // Parse user from initData
    const telegramUser = parseTelegramUser(initData)
    if (!telegramUser) {
      return reply.status(400).send({ error: 'Cannot parse user data' })
    }

    // Find or create user in database
    let user = await prisma.user.findUnique({
      where: { telegramId: BigInt(telegramUser.id) },
      include: { character: true }
    })

    if (!user) {
      // New player — create user + character
      user = await prisma.user.create({
        data: {
          telegramId: BigInt(telegramUser.id),
          firstName: telegramUser.first_name,
          username: telegramUser.username,
          character: {
            create: {} // All defaults from schema
          }
        },
        include: { character: true }
      })
    }

    // Generate JWT token (expires in 7 days)
    const jwtSecret = process.env.JWT_SECRET || 'fallback-secret'
    const token = jwt.sign(
      { userId: user.id, telegramId: telegramUser.id },
      jwtSecret,
      { expiresIn: '7d' }
    )

    const char = user.character
    if (!char) return reply.status(500).send({ error: 'No character' })

    // A map-based Explore run (mode: 'explore', see routes/run.ts) left open
    // when the player closed the app is abandoned on the next login — there
    // is no way to know what they were doing, so it's closed as a death,
    // same treatment POST /run/finish-explore gives an explicit died:true.
    // Trophies and currentRun are wiped in the SAME update (not two separate
    // calls) — split them and a crash between the two would leave the run
    // closed but the trophies intact, making closing the app strictly better
    // than dying, which is exactly the outcome the design forbids (see
    // CLAUDE.md: "закрыть приложение никогда не должно быть выгоднее, чем
    // умереть в забеге"). A run in the OLD (3-room Battle.tsx) shape has no
    // `mode` field at all — left completely untouched, it's a different flow.
    const rawRun = char.currentRun as unknown
    let interruptedRun: RunResultSummary | undefined

    if (rawRun && typeof rawRun === 'object' && (rawRun as { mode?: unknown }).mode === 'explore') {
      const run = rawRun as ActiveExploreRun
      const trophiesLost = char.trophies
      const eventsTotal = Array.isArray(run.events) ? run.events.length : 0

      // Зелья брошенного забега списываются ЗДЕСЬ — иначе убить приложение
      // выгоднее, чем умереть (выпитое остаётся на складе), а это ровно то, что
      // дизайн запрещает (см. CLAUDE.md, вариант А). Единственный источник —
      // currentRun.potionsDrunk, который пишет /run/sip по одному глотку в
      // момент питья: клиент закрылся, ничего не сообщив, и других данных о
      // выпитом не существует. Потолки — ТЕ ЖЕ, что у /run/finish-explore
      // (clampPotionsSpent, runState.ts): не больше выданного на забег по
      // каждому тиру и не больше run.sips по сумме.
      //
      // Ни одна форма currentRun не имеет права уронить ЭТОТ эндпоинт: без
      // логина игра не открывается вообще, так что цена ошибки здесь —
      // несписанные зелья, а не потерянный доступ. Поэтому испорченное или
      // отсутствующее содержимое — громкий warn и списание нуля, без throw.
      const recordedDrunk = readRunPotionsDrunk(run)
      let potionsSpent: number[]
      if (recordedDrunk === null) {
        potionsSpent = emptyPotionStock()
        request.log.warn(
          { userId: user.id, characterId: char.id, potionsDrunk: run.potionsDrunk },
          'login: interrupted run has malformed currentRun.potionsDrunk, spending 0 potions',
        )
      } else {
        const runStock = runPotionStock(run)
        const sipsAllowed = runSipsAllowed(run)
        potionsSpent = clampPotionsSpent(recordedDrunk, runStock, sipsAllowed)
        if (recordedDrunk.some((n, i) => n !== potionsSpent[i])) {
          request.log.warn(
            { userId: user.id, characterId: char.id, recordedDrunk, potionsSpent, runStock, sipsAllowed },
            'login: interrupted run potionsDrunk exceeded per-tier or sip cap, clamped',
          )
        }
      }
      const newPotionStock = subtractPotionStock(potionStockOf(char), potionsSpent)

      // Рост статов за брошенный забег — из последнего среза, который клиент
      // клал в currentRun.progress по ходу дела (POST /run/progress). До него
      // смерть статы растила, а закрытие приложения — нет, и правило "закрыть
      // не выгоднее, чем умереть" нарушалось в обе стороны сразу.
      //
      // Формула и потолки — ТЕ ЖЕ, что в /run/finish-explore, одним кодом
      // (clampRunProgress + applyStatGrowth): разойдись они, закрытие
      // приложения снова стало бы отдельной, выгодной или невыгодной, дорогой.
      // bonusLevels НЕ меняется — босс брошенного забега бонуса не даёт
      // (сервер не знает, убит ли он), но в applyStatGrowth уходит текущий:
      // уровень обязан пересчитаться по полной формуле.
      const levelBefore = calculateLevel(char.strength, char.agility, char.endurance, char.bonusLevels)
      const recordedProgress = readRunProgress(run)
      const progressToApply = recordedProgress ?? emptyRunProgress()
      if (recordedProgress === null) {
        request.log.warn(
          { userId: user.id, characterId: char.id, progress: run.progress },
          'login: interrupted run has malformed currentRun.progress, applying zero stat growth',
        )
      } else if (
        progressToApply.attackDamageDealt === 0 && progressToApply.skillDamageDealt === 0 &&
        progressToApply.healedAmount === 0 && progressToApply.damageTaken === 0
      ) {
        // Ноль по всем четырём — среза не было вовсе (забег прерван раньше
        // первой отправки) либо он пуст. Рост статов за этот забег потерян
        // целиком, и это стоит видеть в логах: ровно та дыра, ради которой
        // /run/progress и заводился.
        request.log.warn(
          { userId: user.id, characterId: char.id, hasSnapshot: run.progress !== undefined },
          'login: interrupted run has no accumulated progress, stat growth is zero',
        )
      }
      const cappedProgress = clampRunProgress(progressToApply, run, levelBefore)
      const growth = applyStatGrowth(
        char.strength, char.strengthProgress, cappedProgress.progress.attackDamageDealt,
        char.endurance, char.enduranceProgress, cappedProgress.progress.damageTaken,
        char.agility, char.agilityProgress, cappedProgress.progress.skillDamageDealt + cappedProgress.progress.healedAmount,
        run.maxHp,
        run.hp,
        char.bonusLevels,
      )

      // Один update на всё: трофеи, забег, склад зелий и статы. Разнести их по
      // двум записям нельзя — падение между ними оставило бы забег закрытым, а
      // трофеи/зелья целыми, то есть снова сделало бы закрытие приложения
      // выгоднее смерти. level пишется ОБЯЗАТЕЛЬНО вместе со статами: колонка
      // денормализованная, и схема требует обновлять её при любой записи
      // статов (см. комментарий к полю в schema.prisma).
      await prisma.character.update({
        where: { id: char.id },
        data: {
          trophies: 0,
          currentRun: Prisma.DbNull,
          ...potionStockToColumns(newPotionStock),
          strength: growth.strength,
          strengthProgress: growth.strengthProgress,
          endurance: growth.endurance,
          enduranceProgress: growth.enduranceProgress,
          agility: growth.agility,
          agilityProgress: growth.agilityProgress,
          bonusLevels: char.bonusLevels,
          level: growth.level,
        },
      })
      char.trophies = 0
      // Склад в памяти — вслед за записью, тем же приёмом, что char.trophies
      // выше: из char ниже собираются И ответ (character.potions, его клиент
      // реально читает), И interruptedRun.potions, и оба обязаны показать склад
      // ПОСЛЕ списания, а не до.
      char.potionT1 = newPotionStock[0]
      char.potionT2 = newPotionStock[1]
      char.potionT3 = newPotionStock[2]
      char.potionT4 = newPotionStock[3]
      char.potionT5 = newPotionStock[4]
      // Статы — тем же приёмом и по той же причине: ниже из char собирается
      // блок character ответа (клиент кладёт его прямо в player), и показать
      // там статы ДО роста значило бы соврать ровно на величину роста.
      const strengthGained = growth.strength - char.strength
      const enduranceGained = growth.endurance - char.endurance
      const agilityGained = growth.agility - char.agility
      char.strength = growth.strength
      char.strengthProgress = growth.strengthProgress
      char.endurance = growth.endurance
      char.enduranceProgress = growth.enduranceProgress
      char.agility = growth.agility
      char.agilityProgress = growth.agilityProgress
      char.level = growth.level

      interruptedRun = {
        interrupted: true,
        died: true,
        trophiesEarned: 0,
        trophiesLost,
        eventsClosed: 0, // сервер не знает прогресс брошенного забега — осознанно всегда 0
        eventsTotal,
        items: [],
        bonuses: [],
        // Настоящие приросты за брошенный забег — из последнего среза
        // (см. applyStatGrowth выше). Нулями они остаются только тогда, когда
        // среза не было или он испорчен, и это честный ноль, а не заглушка,
        // какой эти поля были раньше.
        strengthGained,
        enduranceGained,
        agilityGained,
        leveledUp: growth.level > levelBefore,
        // Абсолютные значения ПОСЛЕ роста — char.* уже обновлены выше, тем же
        // приёмом, что ответ /run/finish-explore.
        trophies: 0,
        strength: char.strength,
        endurance: char.endurance,
        agility: char.agility,
        level: growth.level,
        // Склад ПОСЛЕ списания выпитого за брошенный забег (см. выше) — то же
        // самое число, что записано в колонки этим же update. Абсолютное
        // значение, как trophies/strength рядом: клиент им перезаписывает своё,
        // и разойтись с БД оно не может.
        potions: newPotionStock,
        bonusLevels: char.bonusLevels, // не менялся — брошенный забег бонус не даёт
      }
    }

    // level — денормализованный снимок в БД (см. комментарий к полю в
    // schema.prisma), но эндпоинт профиля им не пользуется — уровень для
    // ответа клиенту всегда пересчитывается явно, как и везде в проекте
    // (см. calculateLevel в game.ts, правило "логика level не читает").
    const level = calculateLevel(char.strength, char.agility, char.endurance, char.bonusLevels)

    // currentRun в ответ не уходит. Клиент его не читает (см. LoginResponse в
    // src/api.ts — такого поля в типе нет), а у прерванного забега в char
    // осталась ЗАКРЫТАЯ выше запись: в памяти она не обнуляется, и `...char`
    // отправил бы игроку забег, которого на сервере уже нет. Снимаем здесь, а
    // не обнулением char.currentRun, — тогда поле не уедет и у забега старой
    // 3-комнатной формы, который ветка выше намеренно не трогает.
    const { currentRun: _closedRun, ...charFields } = char

    return reply.send({
      token,
      user: {
        id: user.id,
        firstName: user.firstName,
        username: user.username,
      },
      // potions — склад по тирам одним массивом (индекс = тир-1) вместо прежнего
      // скалярного potionCharges. Сама колонка удалена из БД миграцией
      // 20260911130000_potion_charges_drop, так что `...char` её больше не
      // несёт — данные живут в potionT1..potionT5.
      character: {
        ...charFields,
        level,
        energy: getCurrentEnergy(char.energy, char.lastEnergyUpdate),
        equippedSkills: char.equippedSkills,
        potions: potionStockOf(char),
      },
      ...(interruptedRun ? { interruptedRun } : {}),
    })
  })
}