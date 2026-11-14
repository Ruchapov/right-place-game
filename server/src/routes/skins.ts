// Ручки Портного (14.11.2026, docs/shop.md, «ПОРТНОЙ»; задача — docs/skins-task.md,
// раздел 7 главнее): купить облик или цвет удара за RP, надеть облик / удар /
// плащ, пришить нашивку (плащ) или поставить Кузнечное клеймо (броня, оружие).
//
// Все записи УСЛОВНЫЕ и одной строкой updateMany — та же дисциплина, что у
// Ловчего (routes/run.ts): проверка «хватает RP / предмет есть / ещё не куплено
// / уровень тот же» стоит в фильтре, и между проверкой и списанием ничего не
// влезет. 0 строк — 409 'State changed, retry' (или 400 по существу, если
// свежее чтение это объясняет).
//
// ⚠️ Во время вылазки НАДЕВАТЬ и УЛУЧШАТЬ нельзя — 400 'Run in progress', как у
// Ловчего: облик и его бонусы — снимок старта забега (currentRun.skins), по нему
// сервер держит запас в потолках. Покупка облика вылазке не мешает (RP финиш
// пишет приращением, а облик надевается отдельно) — она разрешена.
import { randomInt } from 'node:crypto'
import { FastifyInstance } from 'fastify'
import { PrismaClient, Prisma } from '@prisma/client'
import { calculateLevel } from '../game.js'
import {
  SKIN_UPGRADE_MAX_LEVEL, SKIN_UPGRADE_SUCCESS_CHANCE, armorSkinPrice, cloakById, parseArmorSkinId, parseCloakId,
  parseSlashSkinId, parseUpgradeTarget, slashSkinPrice, upgradeItemFor, upgradePriceRp, type CloakId, type UpgradeTarget,
} from '../skins.js'
import { cloakLevelColumn, skinStateOf } from '../skinState.js'
import { RouteRejection, applyOnce, getUserId, readOptionalRequestId } from './run.js'

const prisma = new PrismaClient()

/** Ответ всех ручек Портного: состояние облика и RP, перечитанные из базы. */
async function sendSkinState(userId: number, extra: Record<string, unknown> = {}) {
  const updated = await prisma.character.findUnique({ where: { userId } })
  if (!updated) return null
  return { skins: skinStateOf(updated), rp: updated.rp, ...extra }
}

/** Колонка уровня цели улучшения. */
function upgradeLevelColumn(target: UpgradeTarget, cloakId: CloakId): 'cloakLevelAsh' | 'cloakLevelMidnight' | 'cloakLevelWine' | 'brandLevelArmor' | 'brandLevelWeapon' {
  if (target === 'cloak') return cloakLevelColumn(cloakId)
  return target === 'armor' ? 'brandLevelArmor' : 'brandLevelWeapon'
}

/** Успех нашивки / клейма — бросок СЕРВЕРА, криптографический: шанс всегда 50%. */
function rollUpgradeSuccess(): boolean {
  const SCALE = 1_000_000
  return randomInt(SCALE) < SKIN_UPGRADE_SUCCESS_CHANCE * SCALE
}

export async function skinRoutes(server: FastifyInstance) {
  // Купить облик тела или цвет удара за RP — навсегда. Цена — из каталога;
  // из тела читаются только вид и id. Условная запись: RP >= цены И id ещё НЕ
  // в списке купленных — двойное нажатие второй раз не спишет (второй запрос
  // упрётся в `has` и получит 400 'Already owned').
  server.post<{ Body: { kind?: unknown; id?: unknown } }>('/skins/buy', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })
    const kind = request.body?.kind
    if (kind !== 'armor' && kind !== 'slash') return reply.status(400).send({ error: 'Unknown kind' })
    const id = kind === 'armor' ? parseArmorSkinId(request.body?.id) : parseSlashSkinId(request.body?.id)
    const price = id === null ? null : kind === 'armor' ? armorSkinPrice(id as never) : slashSkinPrice(id as never)
    if (id === null || id === 'none' || price === null) return reply.status(400).send({ error: 'Unknown skin' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })
    const ownedCol = kind === 'armor' ? 'ownedArmorSkins' : 'ownedSlashSkins'
    if (character[ownedCol].includes(id)) return reply.status(400).send({ error: 'Already owned' })
    if (character.rp < price) return reply.status(400).send({ error: 'Not enough RP', price, rp: character.rp })

    const written = await prisma.character.updateMany({
      where: { userId, rp: { gte: price }, NOT: { [ownedCol]: { has: id } } },
      data: { rp: { decrement: price }, [ownedCol]: { push: id } },
    })
    if (written.count === 0) return reply.status(409).send({ error: 'State changed, retry' })
    const out = await sendSkinState(userId)
    if (!out) return reply.status(500).send({ error: 'Bought but state could not be read' })
    return reply.send(out)
  })

  // Надеть облик, удар и/или плащ (любые из трёх полей). Облик и удар — только
  // купленные или 'none'; плащ — если уровень героя (calculateLevel от статов, не
  // колонка level) не ниже порога открытия. Владение проверяется И в фильтре
  // записи (`has`): чтение выше — только чтобы ответить по существу.
  server.post<{ Body: { armor?: unknown; slash?: unknown; cloak?: unknown } }>('/skins/equip', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })
    const body = request.body ?? {}
    const armor = body.armor === undefined ? undefined : parseArmorSkinId(body.armor)
    const slash = body.slash === undefined ? undefined : parseSlashSkinId(body.slash)
    const cloak = body.cloak === undefined ? undefined : parseCloakId(body.cloak)
    if (armor === null || slash === null || cloak === null) return reply.status(400).send({ error: 'Unknown skin' })
    if (armor === undefined && slash === undefined && cloak === undefined) return reply.status(400).send({ error: 'Nothing to equip' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })
    if (character.currentRun !== null) return reply.status(400).send({ error: 'Run in progress' })
    if (armor !== undefined && armor !== 'none' && !character.ownedArmorSkins.includes(armor)) return reply.status(400).send({ error: 'Not owned' })
    if (slash !== undefined && slash !== 'none' && !character.ownedSlashSkins.includes(slash)) return reply.status(400).send({ error: 'Not owned' })
    if (cloak !== undefined) {
      const heroLevel = calculateLevel(character.strength, character.agility, character.endurance, character.bonusLevels)
      const need = cloakById(cloak).unlockLevel
      if (heroLevel < need) return reply.status(400).send({ error: 'Cloak locked', unlockLevel: need })
    }

    const where: Prisma.CharacterWhereInput = { userId, currentRun: { equals: Prisma.DbNull } }
    const and: Prisma.CharacterWhereInput[] = []
    if (armor !== undefined && armor !== 'none') and.push({ ownedArmorSkins: { has: armor } })
    if (slash !== undefined && slash !== 'none') and.push({ ownedSlashSkins: { has: slash } })
    const written = await prisma.character.updateMany({
      where: and.length > 0 ? { ...where, AND: and } : where,
      data: {
        ...(armor !== undefined ? { skinArmor: armor } : {}),
        ...(slash !== undefined ? { skinSlash: slash } : {}),
        ...(cloak !== undefined ? { cloakId: cloak } : {}),
      },
    })
    if (written.count === 0) return reply.status(409).send({ error: 'State changed, retry' })
    const out = await sendSkinState(userId)
    if (!out) return reply.status(500).send({ error: 'Equipped but state could not be read' })
    return reply.send(out)
  })

  // Нашивка (плащ) или Кузнечное клеймо (броня, оружие) — попытка +1.
  //   • Есть свой предмет (patchCount / brandCount >= 1) — тратится он; нет —
  //     100 RP. Что именно тратить, решает прочитанное состояние, и это же
  //     условие стоит в фильтре записи.
  //   • Шанс успеха всегда 50%, бросок сервера (crypto). Успех — уровень +1,
  //     неудача — уровень цели в 0. Максимум 20: на нём отказ 'Max level'.
  //   • В фильтре — уровень РАВЕН прочитанному: иначе «сброс в 0» после чужого
  //     +1 со второго устройства посчитан бы не от того уровня.
  //   • requestId — ключ идемпотентности: повтор с тем же ключом не тратит
  //     второй предмет и не бросает второй раз, а отвечает ТЕМ ЖЕ исходом —
  //     он записан в строку ключа (response) внутри той же транзакции.
  server.post<{ Body: { target?: unknown; cloakId?: unknown; requestId?: unknown } }>('/skins/patch', async (request, reply) => {
    const userId = getUserId(request)
    if (userId === null) return reply.status(401).send({ error: 'Invalid or missing token' })
    const target = parseUpgradeTarget(request.body?.target)
    if (target === null) return reply.status(400).send({ error: 'Unknown target' })
    const requestId = readOptionalRequestId(request.body?.requestId)
    if (requestId === 'invalid') return reply.status(400).send({ error: 'Invalid requestId' })

    const character = await prisma.character.findUnique({ where: { userId } })
    if (!character) return reply.status(404).send({ error: 'Character not found' })

    // Плащ — названный в теле, иначе надетый («улучшить надетый или выбранный»).
    let cloakId: CloakId = parseCloakId(character.cloakId) ?? 'ash'
    if (target === 'cloak' && request.body?.cloakId !== undefined) {
      const named = parseCloakId(request.body.cloakId)
      if (named === null) return reply.status(400).send({ error: 'Unknown cloak' })
      cloakId = named
    }
    if (target === 'cloak') {
      const heroLevel = calculateLevel(character.strength, character.agility, character.endurance, character.bonusLevels)
      const need = cloakById(cloakId).unlockLevel
      if (heroLevel < need) return reply.status(400).send({ error: 'Cloak locked', unlockLevel: need })
    }
    const levelCol = upgradeLevelColumn(target, cloakId)
    const item = upgradeItemFor(target)
    const countCol = item === 'patch' ? 'patchCount' : 'brandCount'
    const price = upgradePriceRp(target)
    const level = character[levelCol]

    const success = rollUpgradeSuccess()
    let applied
    try {
      applied = await applyOnce(character.id, requestId, `skins-patch:${target}`, request.log, async (db) => {
        if (character.currentRun !== null) throw new RouteRejection(400, { error: 'Run in progress' })
        if (level >= SKIN_UPGRADE_MAX_LEVEL) throw new RouteRejection(400, { error: 'Max level' })
        const useItem = character[countCol] >= 1
        if (!useItem && character.rp < price) throw new RouteRejection(400, { error: 'Not enough RP', price, rp: character.rp })
        const newLevel = success ? level + 1 : 0
        const written = await db.character.updateMany({
          where: {
            userId,
            currentRun: { equals: Prisma.DbNull },
            [levelCol]: level,
            ...(useItem ? { [countCol]: { gte: 1 } } : { rp: { gte: price } }),
          },
          data: {
            [levelCol]: newLevel,
            ...(useItem ? { [countCol]: { decrement: 1 } } : { rp: { decrement: price } }),
          },
        })
        if (written.count === 0) throw new RouteRejection(409, { error: 'State changed, retry' })
        const outcome = { success, newLevel, spent: useItem ? item : 'rp' }
        if (requestId !== null) {
          await db.idempotencyKey.update({
            where: { characterId_key: { characterId: character.id, key: requestId } },
            data: { response: outcome },
          })
        }
        return outcome
      })
    } catch (e) {
      if (e instanceof RouteRejection) return reply.status(e.status).send(e.body)
      throw e
    }

    // Повтор — тот же исход, что у первого запроса (из строки ключа).
    const outcome = applied.replayed ? (applied.response as { success?: unknown; newLevel?: unknown } | null) : applied.value
    const out = await sendSkinState(userId, {
      target,
      ...(target === 'cloak' ? { cloakId } : {}),
      success: outcome?.success === true,
      ...(applied.replayed ? { replayed: true } : {}),
    })
    if (!out) return reply.status(500).send({ error: 'Upgraded but state could not be read' })
    const s = out.skins
    const newLevel = target === 'cloak' ? s.cloakLevels[cloakId] : target === 'armor' ? s.brandLevels.armor : s.brandLevels.weapon
    return reply.send({ ...out, newLevel, patchCount: s.patchCount, brandCount: s.brandCount })
  })
}
