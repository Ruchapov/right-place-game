import type { MutableRefObject } from 'react'
import { Container, Graphics, GraphicsContext } from 'pixi.js'
import type { Enemy, Boss, EnemyKind } from '../types'
import * as C from '../constants'

// ЗНАЧОК СТАНА — звёздочки, кружащие над головой врага, оглушённого
// парированием (решение Андрея 13.10.2026).
//
// Только парирование: заморозка льдом (stunTimer) и обычный хитстан (hurtTimer)
// значка не дают. Висит он ровно пока у врага parryStunTimer > 0 и враг жив —
// это и есть всё условие, своего состояния «оглушён» у модуля нет: второй
// источник правды однажды разошёлся бы с таймером, и звёзды кружили бы над
// врагом, который уже бьёт.
//
// Системы врагов о значке не знают вовсе. Модуль сам обходит общий список
// врагов и босса в конце тика (см. вызов в тикере Explore.tsx) и читает у
// каждого только таймеры и спрайт: новый вид врага получит значок сам, если
// его макушка названа в PARRY_STUN_HEAD (без неё не соберётся — Record по виду).
export type StunStarsDeps = {
  worldContainer: Container
  // Те же рефы, что у систем врагов и босса: владеет ими Explore.tsx.
  enemies: MutableRefObject<Enemy[]>
  boss: MutableRefObject<Boss | null>
}

type Halo = {
  node: Container
  stars: Graphics[]
  // Над кем висит; null — свободен и спрятан, ждёт следующего оглушённого.
  owner: Enemy | Boss | null
  // Сколько оглушение уже идёт, мс — из него угол орбиты.
  ms: number
}

export function createStunStarsSystem(deps: StunStarsDeps) {
  // Одна геометрия звезды на все значки забега: каждая Graphics ниже рисует её
  // же, своей не строит.
  const starShape = new GraphicsContext()
    .star(0, 0, 5, C.PARRY_STUN_STAR_R, C.PARRY_STUN_STAR_R_INNER)
    .fill(C.PARRY_STUN_STAR_COLOR)
    .stroke({ width: C.PARRY_STUN_STAR_STROKE, color: C.PARRY_STUN_STAR_OUTLINE })

  // Значки создаются по мере надобности и НЕ уничтожаются до конца забега:
  // освободившийся прячется и достаётся следующему оглушённому. Больше трёх
  // сразу не бывает (группа Привратников, отбитая одним нажатием), а кадр
  // тикера обходится без создания узлов.
  const halos: Halo[] = []

  function isParryStunned(owner: Enemy | Boss): boolean {
    return !owner.dead && owner.parryStunTimer > 0
  }

  // Значок, который уже висит над этим врагом.
  function haloOf(owner: Enemy | Boss): Halo | null {
    for (let i = 0; i < halos.length; i++) {
      if (halos[i].owner === owner) return halos[i]
    }
    return null
  }

  // Новое оглушение: свободный значок, а нет такого — новый.
  function takeHalo(owner: Enemy | Boss): Halo {
    let free: Halo | null = null
    for (let i = 0; i < halos.length; i++) {
      if (halos[i].owner === null) {
        free = halos[i]
        break
      }
    }
    if (!free) {
      const node = new Container()
      // Ближняя звезда рисуется поверх дальней — порядок меняется дважды за
      // оборот, его задаёт zIndex ниже.
      node.sortableChildren = true
      const stars: Graphics[] = []
      for (let i = 0; i < C.PARRY_STUN_STAR_COUNT; i++) {
        const star = new Graphics(starShape)
        stars.push(star)
        node.addChild(star)
      }
      free = { node, stars, owner: null, ms: 0 }
      halos.push(free)
    }
    free.owner = owner
    free.ms = 0
    free.node.visible = true
    // addChild на каждое новое оглушение, а не один раз при создании: он кладёт
    // узел в конец списка детей, то есть поверх всех спрайтов мира.
    deps.worldContainer.addChild(free.node)
    return free
  }

  function place(owner: Enemy | Boss, kind: EnemyKind | 'boss', deltaMS: number) {
    let halo = haloOf(owner)
    if (halo) {
      // Под льдом таймер оглушения стоит (заслон льда выше заслона оглушения) —
      // стоят и звёзды: значок остаётся на месте и не кружит.
      if (owner.stunTimer <= 0) halo.ms += deltaMS
    } else {
      halo = takeHalo(owner)
    }

    // Макушка — точка в клетке листа; в мир её переводит то же преобразование,
    // каким Pixi рисует сам спрайт (якорь, масштаб, зеркало по scale.x), поэтому
    // значок стоит над головой и у врага, смотрящего вправо.
    const head = C.PARRY_STUN_HEAD[kind]
    const sprite = owner.sprite
    const cell = sprite.texture
    halo.node.x = sprite.x + (head.x - sprite.anchor.x * cell.width) * sprite.scale.x
    halo.node.y =
      sprite.y + (head.y - sprite.anchor.y * cell.height) * sprite.scale.y - C.PARRY_STUN_ORBIT_LIFT * head.size
    halo.node.scale.set(head.size)

    // Четверть оборота в запасе: в кадр отбива одна звезда стоит спереди по
    // центру, остальные — сзади по бокам. С нуля две из трёх начинали бы одна
    // над другой.
    const turn = Math.PI / 2 + (halo.ms / C.PARRY_STUN_ORBIT_MS) * Math.PI * 2
    for (let i = 0; i < halo.stars.length; i++) {
      const angle = turn + (i / halo.stars.length) * Math.PI * 2
      // +1 — ближняя к зрителю точка орбиты (она же нижняя на экране), −1 — дальняя.
      const depth = Math.sin(angle)
      const near = (depth + 1) / 2
      const star = halo.stars[i]
      star.x = Math.cos(angle) * C.PARRY_STUN_ORBIT_RX
      star.y = depth * C.PARRY_STUN_ORBIT_RY
      star.scale.set(C.PARRY_STUN_STAR_FAR_SCALE + (1 - C.PARRY_STUN_STAR_FAR_SCALE) * near)
      star.alpha = C.PARRY_STUN_STAR_FAR_ALPHA + (1 - C.PARRY_STUN_STAR_FAR_ALPHA) * near
      star.zIndex = depth
    }
  }

  // deltaMS — ticker.deltaMS. Зовётся в КОНЦЕ тика — после систем врагов и
  // босса (отбив и конец оглушения случаются внутри них) и после удара меча
  // героя (он может убить оглушённого): значок появляется и исчезает в тот же
  // кадр, в который изменилось состояние врага.
  function update(deltaMS: number) {
    // Сначала снять с тех, у кого оглушение кончилось или кто умер. Читаются
    // только поля — спрайт убитого к этому времени может быть уничтожен.
    for (let i = 0; i < halos.length; i++) {
      const halo = halos[i]
      if (halo.owner !== null && !isParryStunned(halo.owner)) {
        halo.owner = null
        halo.node.visible = false
      }
    }
    const enemies = deps.enemies.current
    for (let i = 0; i < enemies.length; i++) {
      if (isParryStunned(enemies[i])) place(enemies[i], enemies[i].kind, deltaMS)
    }
    const boss = deps.boss.current
    if (boss && isParryStunned(boss)) place(boss, 'boss', deltaMS)
  }

  function dispose() {
    // Узлы, которые эта система сама добавила в worldContainer; Explore.tsx о
    // них не знает, поэтому чистим здесь. Геометрия общая — уничтожается одна
    // и после узлов.
    for (const halo of halos) {
      deps.worldContainer.removeChild(halo.node)
      halo.node.destroy({ children: true })
    }
    halos.length = 0
    starShape.destroy()
  }

  return { update, dispose }
}
