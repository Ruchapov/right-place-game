import type { MutableRefObject } from 'react'
import { Container, Sprite } from 'pixi.js'
import type { Texture } from 'pixi.js'
import type { PlayerPhysics } from '../types'
import * as C from '../constants'

// Мана с убитых врагов: бросок выпадения и полёт шаров из туши в героя.
//
// Сам ЗАПАС маны здесь НЕ живёт: им владеет Explore.tsx (manaRef), потому что
// тот же запас читают гнёзда на HUD-плите и модуль навыков. Сюда приходит
// только gainMana — «герой получил столько-то». Тот же раздел труда, что у
// остальных модулей: рефами владеет Explore.tsx, система получает их депом.
//
// Сервер в этом не участвует вовсе: мана не хранится и не начисляется, поэтому
// бросок здесь клиентский, и это не расхождение с правилом «дроп бросает
// сервер» — то правило про то, что попадает в сумку.
export type ManaDeps = {
  // Тот же объект, что двигает физика игрока в тикере: шар наводится на
  // ТЕКУЩЕЕ положение героя, а не на то, где он стоял в момент убийства.
  phys: PlayerPhysics
  worldContainer: Container
  // Картинка шара. Готовая текстура, а не реф (в отличие от кадров в
  // skills.ts): эта система создаётся в setup() уже ПОСЛЕ загрузки общих листов,
  // а без самой картинки забег не стартует вовсе — загрузка упала бы раньше.
  orbTexture: Texture
  // Мёртв ли герой — тот же deathRef, что гейтит анимации в Explore.tsx.
  dead: MutableRefObject<boolean>
  // +N маны герою. Потолок (MANA_MAX) и перерисовка гнёзд — внутри, здесь не
  // дублируются.
  gainMana: (amount: number) => void
}

type ManaOrb = {
  // Свечение и сам шар одним узлом — двигается и гаснет он целиком.
  node: Container
  // Точка вылета (тело врага), снята в момент выпадения: труп к началу полёта
  // уже снят со сцены, спросить у него позицию нечем.
  startX: number
  startY: number
  // Сколько ещё ждать вылета (второй шар той же туши стартует позже). Пока > 0,
  // шар невидим и не летит.
  delayMs: number
  elapsedMs: number
  arcH: number
  // Долетел: мана уже засчитана, идёт гашение. Отдельный флаг, а не вывод из
  // elapsedMs — мана за шар должна прийти РОВНО один раз.
  arrived: boolean
  fadeMs: number
}

export function createManaSystem(deps: ManaDeps) {
  // Обычный массив, чистится на месте (см. update): выпадение — редкое событие,
  // а кадр тикера аллокаций иметь не должен.
  const orbs: ManaOrb[] = []

  function destroyOrb(orb: ManaOrb) {
    deps.worldContainer.removeChild(orb.node)
    orb.node.destroy({ children: true })
  }

  function spawnOrb(worldX: number, worldY: number, index: number) {
    const texture = deps.orbTexture
    const node = new Container()
    const glow = new Sprite(texture)
    glow.anchor.set(0.5)
    glow.width = C.MANA_ORB_SIZE * C.MANA_ORB_GLOW_SCALE
    glow.height = C.MANA_ORB_SIZE * C.MANA_ORB_GLOW_SCALE
    glow.alpha = C.MANA_ORB_GLOW_ALPHA
    glow.blendMode = 'add'
    const core = new Sprite(texture)
    core.anchor.set(0.5)
    core.width = C.MANA_ORB_SIZE
    core.height = C.MANA_ORB_SIZE
    node.addChild(glow, core)
    node.x = worldX
    node.y = worldY
    const delayMs = index * C.MANA_ORB_STAGGER_MS
    // Отложенный шар создаётся сразу, но невидимым: так список один, и чистить
    // при смерти героя или конце забега нужно его же, без второй очереди.
    node.visible = delayMs <= 0
    deps.worldContainer.addChild(node)
    orbs.push({
      node,
      startX: worldX,
      startY: worldY,
      delayMs,
      elapsedMs: 0,
      arcH: index % 2 === 0 ? C.MANA_ORB_ARC_H : C.MANA_ORB_ARC_H * C.MANA_ORB_ARC_ALT,
      arrived: false,
      fadeMs: 0,
    })
  }

  // Враг убит — зовётся ОДИН раз на каждого, из той же ветки, где событие
  // закрывается и всплывает награда (enemy.ts, zvonar.ts, boss.ts).
  // worldX/worldY — центр тела в мировых координатах.
  function dropFrom(worldX: number, worldY: number) {
    // Мёртвому герою мана ни к чему, а шары над трупом висели бы до экрана
    // итогов (враг может умереть и после героя — от кровотечения).
    if (deps.dead.current) return
    if (Math.random() >= C.MANA_DROP_CHANCE) return
    const count = C.MANA_DROP_MIN + Math.floor(Math.random() * (C.MANA_DROP_MAX - C.MANA_DROP_MIN + 1))
    for (let i = 0; i < count; i++) spawnOrb(worldX, worldY, i)
  }

  // Убрать все шары БЕЗ начисления: смерть героя и конец забега. Недолетевшая
  // мана пропадает — засчитывается она только прилётом.
  function clear() {
    for (const orb of orbs) destroyOrb(orb)
    orbs.length = 0
  }

  // deltaMS — ticker.deltaMS: и задержка вылета, и полёт, и гашение идут в
  // реальных миллисекундах, как все таймеры забега.
  function update(deltaMS: number) {
    if (orbs.length === 0) return
    if (deps.dead.current) {
      clear()
      return
    }
    // Цель — центр хитбокса героя, тем же способом, каким от него считаются
    // дуга slash и точка вылета снаряда в skills.ts.
    const targetX = deps.phys.x + C.PLAYER_WIDTH / 2
    const targetY = deps.phys.y + C.PLAYER_HEIGHT / 2
    // Выжившие сдвигаются к началу того же массива — без нового на каждый кадр.
    let kept = 0
    for (let i = 0; i < orbs.length; i++) {
      const orb = orbs[i]
      let remove = false
      if (orb.delayMs > 0) {
        orb.delayMs -= deltaMS
        if (orb.delayMs <= 0) orb.node.visible = true
      } else if (!orb.arrived) {
        orb.elapsedMs += deltaMS
        const t = Math.min(1, orb.elapsedMs / C.MANA_ORB_FLIGHT_MS)
        // Разгон к цели (t²): шар сначала всплывает над тушей, потом его
        // втягивает в героя. Цель читается КАЖДЫЙ кадр — герой может бежать,
        // и при t = 1 шар оказывается ровно там, где герой сейчас.
        const pull = t * t
        orb.node.x = orb.startX + (targetX - orb.startX) * pull
        orb.node.y = orb.startY + (targetY - orb.startY) * pull - Math.sin(Math.PI * t) * orb.arcH
        if (t >= 1) {
          orb.arrived = true
          deps.gainMana(1)
        }
      } else {
        // Гаснет на герое: позиция продолжает идти за ним.
        orb.fadeMs += deltaMS
        orb.node.x = targetX
        orb.node.y = targetY
        orb.node.alpha = Math.max(0, 1 - orb.fadeMs / C.MANA_ORB_FADE_MS)
        if (orb.fadeMs >= C.MANA_ORB_FADE_MS) remove = true
      }
      if (remove) {
        destroyOrb(orb)
      } else {
        orbs[kept] = orb
        kept++
      }
    }
    orbs.length = kept
  }

  function dispose() {
    // Узлы, которые эта система сама добавила в worldContainer; Explore.tsx о
    // них не знает, поэтому чистим здесь.
    clear()
  }

  return { dropFrom, update, clear, dispose }
}
