import { AnimatedSprite } from 'pixi.js'
import type { Container, Texture } from 'pixi.js'
import type { PlayerPhysics } from '../types'
import * as C from '../constants'

// Красная вспышка лечения класса «Кровь» (26.10.2026, docs/classes.md, «Визуал»):
// короткий проход красной копии ауры исцеления на КАЖДОМ лечении Упыря и
// Владыки крови, которое реально долило HP — тик кровотечения, Кровавый клинок,
// Пир. На полном HP лечения нет, нет и вспышки: решает вызывающий (healPlayerByClass
// в Explore.tsx зовёт flash() только при долитом > 0).
//
// Отдельным модулем, а не второй аурой в skills.ts: лечат класс не только навык
// (меч и Пир живут в Explore.tsx), и вспышка не должна гасить ауру исцеления —
// у той своя механика импульсов. Обе могут идти одновременно.
//
// Спрайт ОДИН на забег и переиспользуется: тик раз в секунду и удары мечом —
// частые события, и новый AnimatedSprite на каждое значил бы аллокацию в тикере
// (.claude/skills/pixijs-conventions, «no per-frame object allocation»). Новая
// вспышка поверх недоигравшей просто начинает проход заново.
export type ClassHealFlashDeps = {
  worldContainer: Container
  // Тот же объект, что двигает физика героя в тикере, — вспышка едет за героем.
  phys: PlayerPhysics
  // Кадры красной ауры; null — забег не этой ветки (лист не грузился). Тогда
  // flash() не зовётся вовсе: его зовёт только лечение класса.
  frames: Texture[] | null
}

export function createClassHealFlashSystem(deps: ClassHealFlashDeps) {
  let sprite: AnimatedSprite | null = null
  let missingFramesLogged = false

  // Та же посадка, что у ауры исцеления (positionHealAura в skills.ts): низ у
  // ног героя, на HEAL_AURA_OFFSET_Y ниже ступней.
  function position(s: AnimatedSprite) {
    s.x = deps.phys.x + C.PLAYER_WIDTH / 2 + C.HEAL_AURA_OFFSET_X
    s.y = deps.phys.y + C.PLAYER_HEIGHT + C.HEAL_AURA_OFFSET_Y
  }

  function flash() {
    const frames = deps.frames
    if (!frames || frames.length === 0) {
      // Громко и один раз: лечение уже прошло, вспышка — косметика, но
      // «вылечил без вспышки» снаружи выглядит как «класс не сработал».
      if (!missingFramesLogged) {
        missingFramesLogged = true
        console.error('classHealFlash: кадры Heal_Aura_Red не загружены — лечение класса прошло, вспышки не будет')
      }
      return
    }
    if (!sprite) {
      sprite = new AnimatedSprite(frames)
      sprite.anchor.set(0.5, 1)
      sprite.width = C.HEAL_AURA_DRAW_W
      sprite.height = C.HEAL_AURA_DRAW_H
      sprite.animationSpeed = C.HEAL_AURA_RED_ANIM_SPEED
      sprite.loop = false
      deps.worldContainer.addChild(sprite)
    }
    sprite.visible = true
    position(sprite)
    sprite.gotoAndPlay(0)
  }

  // Каждый кадр из тикера: тянется за героем, доиграла — прячется. Герой умер —
  // прячется сразу (лечения после смерти нет, и висеть над трупом ей незачем).
  function update(dead: boolean) {
    if (!sprite || !sprite.visible) return
    if (dead || sprite.currentFrame >= sprite.textures.length - 1 || !sprite.playing) {
      sprite.stop()
      sprite.visible = false
      return
    }
    position(sprite)
  }

  function dispose() {
    if (!sprite) return
    deps.worldContainer.removeChild(sprite)
    sprite.destroy()
    sprite = null
  }

  return { flash, update, dispose }
}
