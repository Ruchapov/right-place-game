import type { MutableRefObject } from 'react'
import * as C from '../constants'

/**
 * Состояние ОДНОГО гнезда навыка для кнопки в бою.
 *   null        — навык не надет: кнопки нет;
 *   'unknown'   — что надето, неизвестно: кнопка «?» приглушённая;
 *   { iconSrc } — навык надет: кнопка с печатью навыка.
 * Собирает это Explore.tsx (единственный источник — проп equippedSkills), здесь
 * только рисуется.
 */
export type SkillButtonSlot = { iconSrc: string } | 'unknown' | null

// Подсветка нажатия боевых кнопок. Горит ТОЛЬКО по решению кода: атрибут
// data-pressed ставится в том же обработчике pointerdown, где пишется реф
// нажатия, и снимается там же, где нажатие отпускается (у ◀/▶ — там же, где
// сбрасывается dirRef). Не :active — горящая кнопка значит "код увидел
// нажатие", а не "браузер что-то нарисовал".
//
// Вид задан правилом по атрибуту (PRESS_CSS), а не инлайн-стилями: функция-реф
// контейнера на КАЖДОМ рендере перезаписывает cssText скриптовых кнопок, и
// инлайн-подсветка удерживаемой кнопки стёрлась бы. Атрибут cssText не трогает.
// !important — чтобы правило перебило инлайновые background/border. Только
// background-color, не background целиком: у 🧪 фоном идёт иконка тира.
// --- ГЕОМЕТРИЯ ЭКРАННЫХ КНОПОК — одно место на весь файл ---
//
// Все круглые кнопки ОДНОГО радиуса. Раньше их было четыре разных (атака и
// прыжок 28, ◀/▶ 26, веер 22, зелье 20), и печати навыков рядом с атакой
// выглядели мелкими, а ряд — неровным.
// 26 -> кнопка 52px, заметно больше минимума 44px из дизайн-скилла.
const BTN_R = 26
// Минимальный зазор между соседними кнопками ПО ВИДИМЫМ кругам.
const BTN_GAP = 8
// Отступы от краёв панели. По X маленький намеренно: на 320px левый блок и
// правый кластер иначе налезают друг на друга (расчёт — в комментарии к
// раскладке ниже).
const EDGE_X = 8
const EDGE_Y = 12
// Шаг «соседняя кнопка вплотную, с зазором» — им разнесены ◀/▶, прыжок и зелье.
const BTN_STEP = 2 * BTN_R + BTN_GAP
// Веер вокруг атаки: три позиции с шагом 45° — 180° (уклонение), 225° и 270°
// (навыки). В экранных координатах y растёт ВНИЗ, поэтому 225° это влево-вверх,
// а 270° — прямо вверх.
const FAN_STEP = Math.PI / 4
// Радиус веера ВЫВОДИТСЯ из требуемой хорды, а не подбирается руками: хорда
// между соседними кнопками равна 2*D*sin(шаг/2) и обязана быть не меньше
// 2*BTN_R + BTN_GAP. Отсюда D = 79 при нынешних числах. Прежняя формула считала
// угол под хорду РОВНО 2*BTN_R, то есть кнопки веера стояли впритык.
const FAN_D = Math.ceil((2 * BTN_R + BTN_GAP) / (2 * Math.sin(FAN_STEP / 2)))
// Высота панели = от низа до верха самой высокой кнопки (верх веера).
const PANEL_H = EDGE_Y + BTN_R + FAN_D + BTN_R
// Насколько зона захвата ▲ шире видимой кнопки (см. PRESS_CSS).
const JUMP_ZONE_PAD = 6

/**
 * Общий вид круглой кнопки. ОДНА функция на все пять видов — иначе размеры
 * снова разъедутся по пяти копиям cssText, как это уже случилось.
 *
 * ⚠️ box-sizing: border-box ОБЯЗАТЕЛЕН. Без него рамка 1px делает кнопку на 2px
 * шире номинала, и реальный радиус равен BTN_R + 1 — на этом в проекте уже
 * ошибались при расчёте зазоров (см. CLAUDE.md, «Реальный радиус боевой кнопки
 * на 1px БОЛЬШЕ константы»). С border-box номинал и факт совпадают, и все
 * зазоры ниже честные.
 *
 * art — картинка кнопки фоном, а не <img>: у кнопок есть textContent (цифра
 * глотков, «?»), и вложенную картинку он бы затирал.
 *
 * ⚠️ Арт рисуется ВО ВСЮ кнопку и ЗАМЕНЯЕТ CSS-круг: у каждой картинки каменный
 * диск уже нарисован, и оставить под ней прежний тёмный круг с рамкой значило бы
 * камень внутри камня. Поэтому при art рамки и фона нет вовсе. Подсветку нажатия
 * в таком виде даёт яркость, а не заливка (см. PRESS_CSS).
 */
function roundButtonCss(x: number, y: number, opts: { fontSize: number; art?: string | null; dimmed?: boolean }): string {
  return `
    position:absolute;
    box-sizing:border-box;
    left:${x - BTN_R}px; top:${y - BTN_R}px;
    width:${BTN_R * 2}px; height:${BTN_R * 2}px;
    border-radius:50%;
    ${opts.art ? 'border:none; background:transparent;' : 'border:1px solid #3A3344; background:#221E2B;'}
    color:#EDE7F2; font-size:${opts.fontSize}px;
    display:flex; align-items:center; justify-content:center;
    touch-action:none; user-select:none; -webkit-user-select:none;
    -webkit-touch-callout:none; pointer-events:all; cursor:pointer;
    text-shadow:0 1px 2px rgba(0,0,0,0.9);
    opacity:${opts.dimmed ? '0.5' : '1'};
    background-repeat:no-repeat; background-position:center; background-size:100%;
    ${opts.art ? `background-image:url("${opts.art}");` : ''}
    transition:${PRESS_TRANSITION};
  `
}

const PRESS_MIN_VISIBLE_MS = 120
const PRESS_TRANSITION = 'transform 70ms ease-out, background-color 70ms ease-out, border-color 70ms ease-out'
const PRESS_CSS = `
  /* Нажатие: сжатие + подсветка ЯРКОСТЬЮ. Прежняя заливка фона и подсветка
     рамки сняты вместе с CSS-кругом: у кнопок теперь картинка во всю площадь,
     заливка светилась бы квадратом в прозрачных углах, а рамки нет вовсе. */
  [data-touch-controls] [data-pressed="1"] {
    transform: scale(0.88) !important;
    filter: brightness(1.5) !important;
  }
  /* ◀ — тот же файл стрелки, что у ▶, зеркально. Зеркало ПРАВИЛОМ, а не инлайном:
     иначе подсветка нажатия (transform выше, с !important) перетёрла бы его и
     стрелка на нажатие разворачивалась бы вправо. */
  [data-touch-controls] [data-flip="1"] {
    transform: scaleX(-1);
  }
  [data-touch-controls] [data-flip="1"][data-pressed="1"] {
    transform: scaleX(-1) scale(0.88) !important;
  }
  /* Зона захвата ▲ шире видимой кнопки на JUMP_ZONE_PAD во все стороны
     (радиус 26 -> 32). Промах мимо прыжка стоит жизни — шипы или яма, — а лишнее
     уклонение стоит секунды кулдауна, поэтому спорный зазор отдан прыжку.
     Считается это теперь ЧЕСТНО: с box-sizing:border-box номинальный радиус и
     фактический совпадают (раньше рамка добавляла 1px, см. CLAUDE.md). Соседи
     прыжка — уклонение и зелье, оба на расстоянии BTN_STEP = 60px, то есть
     между зоной прыжка (32) и их кругами (26) остаётся 2px.
     Почему правилом, а не инлайном: cssText скриптовых кнопок переписывается
     ЦЕЛИКОМ на каждом рендере (см. ref-колбэк ниже), инлайн-зона стёрлась бы —
     ровно та же причина, по которой подсветка выше живёт правилом.
     position:absolute здесь обязателен дважды: он и выносит псевдоэлемент за
     границы кнопки, и не даёт ему стать флекс-элементом — иначе глиф ▲ уехал
     бы с центра. border-radius:50% — иначе зона была бы квадратной, и углы
     квадрата залезли бы на соседей. */
  [data-touch-controls] [data-btn="jump"]::after {
    content: '';
    position: absolute;
    inset: -${JUMP_ZONE_PAD}px;
    border-radius: 50%;
    background: transparent;
  }
`

// Момент нажатия и таймер отложенного гашения — по самому DOM-узлу, а не в
// замыкании bindTap: bindTap переназначается на каждом рендере, и таймер
// старого замыкания погасил бы уже НОВОЕ нажатие той же кнопки.
const pressState = new WeakMap<HTMLElement, { at: number; timer: number | null }>()

function pressOn(el: HTMLElement) {
  const prev = pressState.get(el)
  if (prev?.timer != null) window.clearTimeout(prev.timer)
  pressState.set(el, { at: performance.now(), timer: null })
  el.setAttribute('data-pressed', '1')
}

function pressOff(el: HTMLElement) {
  const st = pressState.get(el)
  if (st?.timer != null) window.clearTimeout(st.timer)
  pressState.delete(el)
  el.removeAttribute('data-pressed')
}

// Разовые кнопки: мгновенный тап всё равно виден — гаснет не раньше, чем через
// PRESS_MIN_VISIBLE_MS после нажатия. Дольше уже прошедшего не держит.
function pressOffAfterMin(el: HTMLElement) {
  const st = pressState.get(el)
  if (!st) {
    el.removeAttribute('data-pressed')
    return
  }
  const left = PRESS_MIN_VISIBLE_MS - (performance.now() - st.at)
  if (left <= 0) {
    pressOff(el)
    return
  }
  if (st.timer != null) window.clearTimeout(st.timer)
  st.timer = window.setTimeout(() => pressOff(el), left)
}

interface TouchControlsProps {
  dirRef: MutableRefObject<number>
  jumpPressedRef: MutableRefObject<boolean>
  attackPressedRef: MutableRefObject<boolean>
  dodgePressedRef: MutableRefObject<boolean>
  drinkPressedRef: MutableRefObject<boolean>
  skill1PressedRef: MutableRefObject<boolean>
  skill2PressedRef: MutableRefObject<boolean>
  potionBtnRef: MutableRefObject<HTMLButtonElement | null>
  // Пишет "🧪 ×N"/opacity в potionBtnRef.current — вызывается сразу после
  // создания DOM-узла кнопки зелья (см. ref-колбэк ниже), чтобы подпись не
  // была пустой до первого срабатывания тикера в Explore.tsx.
  updatePotionButton: () => void
  // DOM-узлы кнопок ⚡/🔥 — по образцу potionBtnRef выше: Explore гасит кнопку
  // пустого слота через style.opacity, без React-состояния.
  skill1BtnRef: MutableRefObject<HTMLButtonElement | null>
  skill2BtnRef: MutableRefObject<HTMLButtonElement | null>
  /**
   * Что в двух гнёздах навыков. ТРИ различимых состояния на гнездо, и схлопывать
   * их нельзя:
   *   null        — навык НЕ надет: кнопки нет вовсе (решение дизайнера — нет
   *                 надетых навыков, нет и кнопок; пустая кнопка обещала бы
   *                 действие, которого у героя нет);
   *   'unknown'   — что надето, неизвестно (профиль не загружен): кнопка есть,
   *                 но с «?» и приглушённая — это состояние ошибки, и оно обязано
   *                 быть видно, а не выглядеть как пустое гнездо;
   *   { iconSrc } — навык надет: кнопка с печатью навыка (skill_*.png).
   */
  skillSlots: [SkillButtonSlot, SkillButtonSlot]
  // Ставит кнопкам скиллов opacity (и значок "?", если данных нет) — по той же
  // причине, что updatePotionButton: cssText в ref-колбэке ниже стирает
  // opacity при каждом ре-рендере, вид переустанавливается сразу после.
  updateSkillButtons: () => void
}

export default function TouchControls({
  dirRef,
  jumpPressedRef,
  attackPressedRef,
  dodgePressedRef,
  drinkPressedRef,
  skill1PressedRef,
  skill2PressedRef,
  potionBtnRef,
  updatePotionButton,
  skill1BtnRef,
  skill2BtnRef,
  skillSlots,
  updateSkillButtons,
}: TouchControlsProps) {
  return (
    <>
      {/* Вид подсветки нажатия — см. PRESS_CSS вверху файла. */}
      <style>{PRESS_CSS}</style>
      {/* Экранные кнопки управления — компактная раскладка в стиле Battle.tsx
          (круглые кнопки, радиальный веер вокруг атаки). Ввод дёргает те же
          refs, что и клавиатура (dirRef/jumpPressedRef/attackPressedRef/
          dodgePressedRef) — меняется только вид, не способ ввода. */}
      {/* Панель кнопок. bottom — НЕ 0, а нижний safe-area iOS: на айфонах с
          жестом «домой» нижние ~34px экрана принадлежат системе, и кнопки,
          прибитые к самому низу, попадали в полосу жеста (открытая задача в
          CLAUDE.md). env(...) с запасным 0px — на устройствах без выреза
          поведение прежнее. Высота — из PANEL_H, а не число рядом с числом:
          раскладка внутри считается от той же константы. */}
      <div data-touch-controls="" style={{ position: 'absolute', bottom: 'env(safe-area-inset-bottom, 0px)', left: 0, right: 0, height: PANEL_H, zIndex: 1001, pointerEvents: 'none' }}>
        {/* Движение — левый блок */}
        <button
          aria-label="Влево"
          // Зеркалит стрелку: файл арта один на обе стороны и смотрит вправо.
          // Атрибутом, а не инлайновым transform — см. правило в PRESS_CSS.
          data-flip="1"
          onPointerDown={(e) => {
            e.preventDefault()
            e.currentTarget.setPointerCapture(e.pointerId)
            dirRef.current = -1
            pressOn(e.currentTarget)
          }}
          onPointerUp={(e) => {
            dirRef.current = 0
            pressOff(e.currentTarget)
            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
          }}
          onPointerLeave={(e) => { dirRef.current = 0; pressOff(e.currentTarget) }}
          onPointerCancel={(e) => {
            dirRef.current = 0
            pressOff(e.currentTarget)
            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
          }}
          onLostPointerCapture={(e) => { dirRef.current = 0; pressOff(e.currentTarget) }}
          style={{
            // Тот же радиус и та же базовая линия (EDGE_Y от низа), что у атаки,
            // прыжка и веера справа: раньше ◀/▶ были 52px при атаке 56px и
            // веере 44px, и нижний ряд читался неровным.
            position: 'absolute', left: EDGE_X, bottom: EDGE_Y,
            boxSizing: 'border-box',
            width: BTN_R * 2, height: BTN_R * 2,
            borderRadius: '50%', border: 'none', background: 'transparent',
            backgroundImage: `url(${C.BTN_ART_SRC.move})`,
            backgroundRepeat: 'no-repeat', backgroundPosition: 'center', backgroundSize: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none',
            WebkitTouchCallout: 'none',
            pointerEvents: 'all',
            transition: PRESS_TRANSITION,
          }}
        />
        <button
          aria-label="Вправо"
          onPointerDown={(e) => {
            e.preventDefault()
            e.currentTarget.setPointerCapture(e.pointerId)
            dirRef.current = 1
            pressOn(e.currentTarget)
          }}
          onPointerUp={(e) => {
            dirRef.current = 0
            pressOff(e.currentTarget)
            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
          }}
          onPointerLeave={(e) => { dirRef.current = 0; pressOff(e.currentTarget) }}
          onPointerCancel={(e) => {
            dirRef.current = 0
            pressOff(e.currentTarget)
            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
          }}
          onLostPointerCapture={(e) => { dirRef.current = 0; pressOff(e.currentTarget) }}
          style={{
            // Ровно BTN_STEP правее ◀ — тот же шаг, которым разнесены прыжок и
            // зелье, поэтому зазоры по всей панели одинаковые.
            position: 'absolute', left: EDGE_X + BTN_STEP, bottom: EDGE_Y,
            boxSizing: 'border-box',
            width: BTN_R * 2, height: BTN_R * 2,
            borderRadius: '50%', border: 'none', background: 'transparent',
            backgroundImage: `url(${C.BTN_ART_SRC.move})`,
            backgroundRepeat: 'no-repeat', backgroundPosition: 'center', backgroundSize: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none',
            WebkitTouchCallout: 'none',
            pointerEvents: 'all',
            transition: PRESS_TRANSITION,
          }}
        />

        {/* Правый блок — атака/dodge/скиллы/прыжок/зелье через JS в
            ref-колбэке, та же техника и геометрия, что в Battle.tsx.
            skill1/skill2 пишут в skill1PressedRef/skill2PressedRef (как
            dodge пишет в dodgePressedRef) — сама логика скиллов ещё не
            реализована, см. explore/entities/skills.ts. Зелье (🧪) —
            ТОЛЬКО визуал (анимация питья через drinkPressedRef), без
            хила/зарядов/кулдауна. */}
        <div
          ref={(container) => {
            if (!container) return
            const W = window.innerWidth
            // РАСКЛАДКА ПРАВОГО КЛАСТЕРА (числа — для экрана 375px):
            //   атака     (337, 105) — правый нижний угол, EDGE_X/EDGE_Y от краёв
            //   уклонение (258, 105) — веер, 180°, на одной линии с атакой
            //   навык 1   (281,  49) — веер, 225°
            //   навык 2   (337,  26) — веер, 270°, прямо над атакой
            //   прыжок    (198, 105) — BTN_STEP левее уклонения, та же линия
            //   зелье     (198,  45) — BTN_STEP выше прыжка
            // Слева на той же линии: ◀ (34, 105) и ▶ (94, 105).
            // Минимальное расстояние между центрами соседей = BTN_STEP = 60 при
            // диаметре 52, то есть зазор 8px везде; ближайшая пара «левый блок —
            // правый кластер» на 375px это ▶ и прыжок, между ними 104px.
            // ⚠️ На 320px правый кластер сдвигается влево на 55px, и между ▶ и
            // прыжком остаётся 1px по видимым кругам (зоны захвата ▲ при этом
            // пересекаются с ▶ на 5px). Это ровно та открытая задача про узкие
            // экраны из CLAUDE.md: лечится не зазорами, а раскладкой, зависящей
            // от ширины, — отдельным шагом.
            const ATK = { x: W - EDGE_X - BTN_R, y: PANEL_H - EDGE_Y - BTN_R }
            // 180° / 225° / 270°: уклонение слева от атаки, навыки выше.
            const angles = [Math.PI, Math.PI + FAN_STEP, Math.PI + 2 * FAN_STEP]

            // Веер: dodge плюс ДО ДВУХ навыков. Углы фиксированы тремя
            // позициями и НЕ пересчитываются под число кнопок — хорда между
            // соседними кнопками веера ровно 2·BTN_R, и любое сближение даёт
            // наложение (CLAUDE.md, Critical Gotchas про радиусы кнопок). Нет
            // навыка — позиция просто пустует, соседи не двигаются.
            //
            // Печать навыка — ФОНОМ, а не <img>: у кнопки textContent, и вложенную
            // картинку он затирал бы (та же причина, что у кнопки зелья).
            // background-size 74% — как у зелья, чтобы круглые иконки на кнопках
            // выглядели одним набором.
            // «?» — на пустом каменном диске (btn_blank): своего арта у этого
            // состояния нет, а без подложки от кнопки остался бы голый знак.
            // Печати навыков подложки не требуют — камень у них свой.
            const skillFan = (slot: SkillButtonSlot) =>
              slot === null ? null
                : slot === 'unknown' ? { label: '?', art: C.BTN_ART_SRC.blank, dimmed: true }
                  : { label: '', art: slot.iconSrc, dimmed: false }
            const fanButtons: { id: string; angle: number; spec: { label: string; art: string | null; dimmed: boolean } | null }[] = [
              { id: 'dodge', angle: angles[0], spec: { label: '', art: C.BTN_ART_SRC.dodge, dimmed: false } },
              { id: 'skill1', angle: angles[1], spec: skillFan(skillSlots[0]) },
              { id: 'skill2', angle: angles[2], spec: skillFan(skillSlots[1]) },
            ]

            fanButtons.forEach(b => {
              const existing = container.querySelector(`[data-btn="${b.id}"]`) as HTMLElement | null
              if (b.spec === null) {
                // Гнездо пусто. Кнопку не создаём, а уже созданную (перерисовка
                // с другими пропами) убираем — иначе она осталась бы висеть
                // нажимаемой.
                existing?.remove()
                return
              }
              const x = ATK.x + FAN_D * Math.cos(b.angle)
              const y = ATK.y + FAN_D * Math.sin(b.angle)
              const el = existing || document.createElement('button')
              el.dataset.btn = b.id
              el.textContent = b.spec.label
              el.style.cssText = roundButtonCss(x, y, {
                fontSize: 20,
                art: b.spec.art,
                dimmed: b.spec.dimmed,
              })
              if (!existing) container.appendChild(el)
            })

            const atkEl = container.querySelector('[data-btn="atk"]') as HTMLElement
            const atk = atkEl || document.createElement('button')
            atk.dataset.btn = 'atk'
            atk.textContent = ''
            atk.style.cssText = roundButtonCss(ATK.x, ATK.y, { fontSize: 20, art: C.BTN_ART_SRC.attack })
            if (!atkEl) container.appendChild(atk)

            // Прыжок — на базовой линии, BTN_STEP левее крайней кнопки веера
            // (уклонения), а не «минус подобранные 30px» от центра атаки: шаг
            // общий со всеми соседними парами панели.
            const jumpX = ATK.x - FAN_D - BTN_STEP
            const jumpY = ATK.y

            const jumpEl = container.querySelector('[data-btn="jump"]') as HTMLElement
            const jump = jumpEl || document.createElement('button')
            jump.dataset.btn = 'jump'
            jump.textContent = ''
            jump.style.cssText = roundButtonCss(jumpX, jumpY, { fontSize: 20, art: C.BTN_ART_SRC.jump })
            if (!jumpEl) container.appendChild(jump)

            // Зелье — ровно над прыжком, тем же шагом. Над веером его держать
            // больше нельзя: с равными радиусами верхняя кнопка веера уже стоит
            // на высоте панели, и зелье вышло бы за её верх.
            const potX = jumpX
            const potY = ATK.y - BTN_STEP

            const potEl = container.querySelector('[data-btn="potion"]') as HTMLElement
            const pot = (potEl || document.createElement('button')) as HTMLButtonElement
            pot.dataset.btn = 'potion'
            // Иконку тира ставит updatePotionButton (меняется по ходу забега —
            // какой тир выпьется следующим), здесь только раскладка. Число
            // глотков рисуется ТЕКСТОМ поверх фона: <img> нельзя, textContent
            // затирает детей. fontSize меньше прочих — цифра поверх картинки.
            // Подложка — пустой диск; иконку тира кладёт ПОВЕРХ неё
            // updatePotionButton вторым слоем фона (он же вызывается сразу
            // ниже, после установки cssText).
            pot.style.cssText = roundButtonCss(potX, potY, { fontSize: 12, art: C.BTN_ART_SRC.blank })
            if (!potEl) container.appendChild(pot)
            // Ref на DOM-узел кнопки — чтобы ticker мог обновлять подпись
            // "🧪 ×N"/opacity без React-состояния (см. updatePotionButton).
            // cssText выше стирает opacity при каждом ре-рендере компонента —
            // updatePotionButton() сразу после переустанавливает актуальную.
            potionBtnRef.current = pot
            updatePotionButton()

            // Разовые кнопки (не удержание): действие срабатывает на
            // pointerdown (не click/mouseup) — с захватом пойнтера, чтобы
            // второй одновременный палец на другой кнопке (движение) не
            // терялся при мультитаче (браузер эмулирует mouse/click только
            // для первого пальца). pointerdown физически не повторяется при
            // удержании пальца (в отличие от keydown), так что действие
            // естественно срабатывает один раз за нажатие — повтор только
            // после нового pointerdown, т.е. после отпускания.
            const bindTap = (el: HTMLElement, action: () => void) => {
              el.onpointerdown = (e) => {
                e.preventDefault()
                el.setPointerCapture(e.pointerId)
                action()
                // Подсветка — сразу за записью в реф внутри action(): горит,
                // только если код дошёл до фиксации нажатия.
                pressOn(el)
              }
              const release = (e: PointerEvent) => {
                pressOffAfterMin(el)
                if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
              }
              el.onpointerup = release
              el.onpointercancel = release
            }

            bindTap(atk, () => { attackPressedRef.current = true })
            bindTap(jump, () => { jumpPressedRef.current = true })

            const dodgeEl = container.querySelector('[data-btn="dodge"]') as HTMLElement
            if (dodgeEl) bindTap(dodgeEl, () => { dodgePressedRef.current = true })

            const skill1El = container.querySelector('[data-btn="skill1"]') as HTMLButtonElement | null
            if (skill1El) bindTap(skill1El, () => { skill1PressedRef.current = true })
            skill1BtnRef.current = skill1El

            const skill2El = container.querySelector('[data-btn="skill2"]') as HTMLButtonElement | null
            if (skill2El) bindTap(skill2El, () => { skill2PressedRef.current = true })
            skill2BtnRef.current = skill2El
            // Строго ПОСЛЕ cssText в fan-блоке выше (он стирает opacity) — тот
            // же порядок, что у potionBtnRef/updatePotionButton.
            updateSkillButtons()

            bindTap(pot, () => { drinkPressedRef.current = true })
          }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none' }}
        />
      </div>
    </>
  )
}
