// Ручки ежедневных заданий (26.10.2026, docs/daily-quests.md): получить
// состояние, взять задание, заменить задание. Правила — в server/src/questState.ts
// (чистые функции), каталог — в server/src/quests.ts (копия src/quests.ts).
// Прогресс и награду двигает не эта ручка, а финиш живой вылазки
// (POST /run/finish-explore, routes/run.ts).
//
// Все записи условные: фильтр по прежнему questState (questStateFilter), гонка —
// 409 'State changed, retry', не записано ничего. Испорченный questState — 500
// 'Corrupt quest state' и громкий лог: «починить» его молча значило бы отнять
// активное задание с прогрессом.
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { PrismaClient, Prisma, type Character } from '@prisma/client'
import { calculateLevel } from '../game.js'
import { QUEST_UNLOCK_LEVEL, parseQuestId } from '../quests.js'
import { readQuestState, settleQuestState, takeQuest, replaceQuest, questView, type QuestState, type QuestRefusal } from '../questState.js'
import { getUserId, questStateFilter } from './run.js'

const prisma = new PrismaClient()

/** Текст отказа по причине из questState.ts — один на обе ручки. */
function refusalError(reason: QuestRefusal): string {
  switch (reason) {
    case 'not-in-set': return 'Quest not in set'
    case 'already-taken': return 'Quest already taken'
    case 'no-replacement': return 'No replacement on this step'
    case 'nothing-to-pick': return 'No quest to replace with'
  }
}

/** Ответ всех трёх ручек: вид заданий и валюты, которые они приносят. */
function sendQuests(reply: FastifyReply, character: Character, state: QuestState | null, level: number, nowMs: number) {
  return reply.send({
    quests: questView(state, level, nowMs),
    hunterBadges: character.hunterBadges,
    rp: character.rp,
  })
}

/**
 * Прочитать персонажа и привести его задания к «сейчас» (settleQuestState: первый
 * набор с QUEST_UNLOCK_LEVEL, новый набор по истёкшему таймеру). НЕ пишет: запись
 * — у вызывающего, одной условной записью вместе с его действием. Отказ уже
 * отправлен — возвращает null.
 */
async function loadQuests(request: FastifyRequest, reply: FastifyReply, userId: number, nowMs: number) {
  const character = await prisma.character.findUnique({ where: { userId } })
  if (!character) {
    reply.status(404).send({ error: 'Character not found' })
    return null
  }
  const read = readQuestState(character.questState)
  if (read.kind === 'malformed') {
    request.log.error({ userId, questState: character.questState }, 'quests: corrupt questState')
    reply.status(500).send({ error: 'Corrupt quest state' })
    return null
  }
  const level = calculateLevel(character.strength, character.agility, character.endurance, character.bonusLevels)
  const settled = settleQuestState(read.kind === 'state' ? read.state : null, level, character.equippedSkills, nowMs)
  return { character, level, settled }
}

export async function questRoutes(server: FastifyInstance) {
  // Состояние заданий. Лениво приводит его к «сейчас» и, если пришёл первый или
  // новый набор, ПИШЕТ его — иначе следующий запрос бросил бы набор заново, и
  // задания на доске менялись бы от обновления к обновлению. Посреди вылазки
  // тоже работает: смотреть доску можно, брать и менять — нет.
  server.get('/character/quests', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })
    const now = Date.now()
    const loaded = await loadQuests(request, reply, userId, now)
    if (loaded === null) return reply
    const { character, level, settled } = loaded
    if (settled.changed && settled.state !== null) {
      const written = await prisma.character.updateMany({
        where: { userId, questState: questStateFilter(character.questState) },
        data: { questState: settled.state as unknown as Prisma.InputJsonValue },
      })
      if (written.count === 0) return reply.status(409).send({ error: 'State changed, retry' })
    }
    return sendQuests(reply, character, settled.state, level, now)
  })

  // Взять задание набора: { questId }. Активное пропадает вместе с прогрессом,
  // первое взятое запускает таймер набора.
  server.post<{ Body: { questId?: unknown } | null }>('/character/quests/take', async (request, reply) => {
    return await questAction(request, reply, 'take')
  })

  // Заменить невзятое задание набора случайным новым: { questId }. Одна замена
  // на шаг.
  server.post<{ Body: { questId?: unknown } | null }>('/character/quests/replace', async (request, reply) => {
    return await questAction(request, reply, 'replace')
  })
}

/**
 * Общий путь двух ручек: проверки, приведение к «сейчас», действие и ОДНА
 * условная запись. На отказе ничего не пишется — даже новый набор, если он
 * выпал при приведении: его запишет следующий GET, а вид, которого нет в базе,
 * клиенту не отдаётся.
 */
async function questAction(
  request: FastifyRequest<{ Body: { questId?: unknown } | null }>,
  reply: FastifyReply,
  action: 'take' | 'replace',
) {
  const userId = getUserId(request)
  if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })
  const questId = parseQuestId(request.body?.questId)
  if (questId === null) return reply.status(400).send({ error: 'Unknown quest' })

  const now = Date.now()
  const loaded = await loadQuests(request, reply, userId, now)
  if (loaded === null) return reply
  const { character, level, settled } = loaded

  // Посреди вылазки брать и менять нельзя: финиш двигает активное задание, и
  // сменить его, пока забег идёт, значило бы засчитать вылазку не тому заданию.
  if (character.currentRun !== null) return reply.status(400).send({ error: 'Run in progress' })
  if (level < QUEST_UNLOCK_LEVEL || settled.state === null) {
    return reply.status(400).send({ error: 'Quests locked', unlockLevel: QUEST_UNLOCK_LEVEL })
  }

  const outcome = action === 'take'
    ? takeQuest(settled.state, questId, now)
    : replaceQuest(settled.state, questId, character.equippedSkills)
  if (!outcome.ok) return reply.status(400).send({ error: refusalError(outcome.reason) })

  const written = await prisma.character.updateMany({
    where: {
      userId,
      // Вылазка не началась между чтением и записью — проверка выше к этому
      // моменту могла устареть.
      currentRun: { equals: Prisma.DbNull },
      questState: questStateFilter(character.questState),
    },
    data: { questState: outcome.state as unknown as Prisma.InputJsonValue },
  })
  if (written.count === 0) return reply.status(409).send({ error: 'State changed, retry' })

  if (action === 'take' && 'lost' in outcome && outcome.lost !== null) {
    request.log.info({ userId, taken: questId, lost: outcome.lost }, 'quests: active quest lost by taking another')
  }
  return sendQuests(reply, character, outcome.state, level, now)
}
