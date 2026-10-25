import { AnimatedSprite } from 'pixi.js'
import type { Container, Texture } from 'pixi.js'
import * as C from '../constants'

// Критический удар мечом ветки «Клинок» (Выпад и Острый глаз, 26.10.2026;
// docs/classes.md, «Визуал»): красная копия искры отбива — крупнее обычной — в
// точке удара, и цель — враг или босс — на CRIT_FLASH_MS вспыхивает красным.
//
// Только картинка: решает, был ли удар критическим, и множит урон applyAttackHit
// в Explore.tsx — сюда приходит уже случившийся крит. Казнь сама по себе крита
// не рисует: это не крит, а добивание (см. applyAttackHit).
//
// Без аллокаций в тикере (.claude/skills/pixijs-conventions): искры — из пула,
// доигравшая прячется и ждёт следующего крита; записи вспышек — тоже. Новые
// объекты появляются, только если одновременно идёт больше искр, чем бывало до
// сих пор (взмах задел сразу несколько врагов), — и остаются в пуле.
//
// Цвет вспышки модуль пишет в спрайт цели КАЖДЫЙ тик, пока она горит, а не
// один раз: у босса tint каждый кадр пишет и boss.ts (по своему hitFlashTimer),
// и вспышку крита он бы стёр следующим же кадром. update() стоит в тикере ПОСЛЕ
// систем врагов и босса — его запись и попадает в кадр. Через hitFlashTimer
// босса крит не идёт намеренно: под оглушением boss.ts этот таймер не трогает
// (заслон стана выше по его update), и крит по оглушённому парированием боссу —
// самый частый случай — прошёл бы без вспышки, а после стана босс вспыхнул бы
// невпопад. Погасив вспышку, модуль ставит белый; дальше цветом снова владеет
// хозяин спрайта.
export type CritFlashDeps = {
  worldContainer: Container
  // Кадры красной искры; null — забег не этой ветки (лист не грузился). Тогда
  // strike() не зовётся вовсе: крита у других веток не бывает.
  frames: Texture[] | null
  // Масштаб искры — от масштаба героя, как у искры отбива (там же и считается,
  // в Explore.tsx), но с C.CRIT_SPARK_SCALE вместо C.PARRY_SPARK_SCALE.
  sparkScale: number
}

// fresh — вспышка поставлена в ЭТОМ тике: её кадр ещё не показан, и тикер его
// не считает (иначе первый кадр крита съедал бы ~17 мс из CRIT_FLASH_MS).
type TintEntry = { sprite: Container; msLeft: number; fresh: boolean }

export function createCritFlashSystem(deps: CritFlashDeps) {
  const sparks: AnimatedSprite[] = []
  const tints: TintEntry[] = []
  let missingFramesLogged = false

  function spawnSpark(x: number, y: number) {
    const frames = deps.frames
    if (!frames || frames.length === 0) {
      // Громко и один раз: урон крита уже прошёл, искра — косметика, но «крит без
      // искры» снаружи выглядит как «крита не было».
      if (!missingFramesLogged) {
        missingFramesLogged = true
        console.error('critFlash: кадры parry_spark_Red не загружены — крит прошёл, искры не будет')
      }
      return
    }
    let spark = sparks.find((s) => !s.visible)
    if (!spark) {
      spark = new AnimatedSprite(frames)
      spark.anchor.set(0.5, 0.5)
      spark.scale.set(deps.sparkScale)
      // Альфа в этом арте = яркость (как у искры отбива): 'add', иначе вокруг
      // блика был бы тёмный квадрат.
      spark.blendMode = 'add'
      spark.loop = false
      // Та же длительность, что у искры отбива (PARRY_SPARK_MS), и тот же способ
      // её задать — см. spawnParrySparkRef в Explore.tsx.
      spark.animationSpeed = (frames.length / C.PARRY_SPARK_MS) * (1000 / 60)
      const own = spark
      spark.onComplete = () => { own.visible = false }
      deps.worldContainer.addChild(spark)
      sparks.push(spark)
    }
    spark.x = x
    spark.y = y
    spark.visible = true
    spark.gotoAndPlay(0)
  }

  // Крит по цели: искра в точке удара (x, y — мировые координаты) и красная
  // вспышка спрайта цели (враг или босс).
  function strike(x: number, y: number, target: Container) {
    spawnSpark(x, y)
    target.tint = C.CRIT_FLASH_TINT
    // Цель уже вспыхивает (второй крит подряд) — вспышка начинается заново.
    const entry = tints.find((t) => t.sprite === target) ?? tints.find((t) => t.msLeft <= 0)
    if (entry) {
      entry.sprite = target
      entry.msLeft = C.CRIT_FLASH_MS
      entry.fresh = true
    } else {
      tints.push({ sprite: target, msLeft: C.CRIT_FLASH_MS, fresh: true })
    }
  }

  // Каждый кадр из тикера: держит цвет горящих вспышек и гасит отгоревшие.
  // Спрайт врага, снятый со сцены за это время (труп убран), не трогается — он
  // уже уничтожен.
  function update(deltaMS: number) {
    for (const t of tints) {
      if (t.msLeft <= 0) continue
      if (t.sprite.destroyed) { t.msLeft = 0; continue }
      if (t.fresh) t.fresh = false
      else t.msLeft -= deltaMS
      t.sprite.tint = t.msLeft > 0 ? C.CRIT_FLASH_TINT : 0xffffff
    }
  }

  function dispose() {
    for (const s of sparks) {
      deps.worldContainer.removeChild(s)
      s.destroy()
    }
    sparks.length = 0
    tints.length = 0
  }

  return { strike, update, dispose }
}
