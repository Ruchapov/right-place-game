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
// Отступ края кнопки от края экрана и от низа панели — как было до правки
// размеров.
const BTN_EDGE = 10
// Зазор между кругом атаки и кольцом веера — тоже прежний.
const FAN_GAP = 6
// Радиус кольца веера. Формула прежняя (ATK_R + BTN_R + зазор), просто оба
// радиуса теперь равны BTN_R.
const FAN_D = 2 * BTN_R + FAN_GAP
// Середина веера — влево-вверх от атаки (y растёт ВНИЗ, поэтому 225° это
// влево-вверх). Уклонение и два навыка стоят вокруг неё.
const FAN_MID = 225 * Math.PI / 180
// Шаг веера — из хорды РОВНО в два радиуса, то есть соседние кнопки веера
// КАСАЮТСЯ. Так было и раньше; расширять веер нельзя, любое увеличение шага
// уводит навыки от атаки, а уменьшение даёт наложение (CLAUDE.md).
const FAN_THETA = Math.acos(1 - 2 * Math.pow(BTN_R / FAN_D, 2))
// Насколько верхняя кнопка веера поднята над центром атаки.
const FAN_TOP_RISE = -FAN_D * Math.sin(FAN_MID + FAN_THETA)
// Зазор между верхней кнопкой веера и зельем над ней — прежний.
const POT_GAP = 4
// Высота панели. 178 — прежнее значение; max с расчётным нужен, чтобы при
// правке радиусов верхняя кнопка (зелье) не оказалась молча срезанной: расчёт —
// это низ + атака + подъём веера + зелье над ним.
const PANEL_H = Math.max(178, Math.ceil(BTN_EDGE + BTN_R + FAN_TOP_RISE + 2 * BTN_R + POT_GAP + BTN_R))
// Насколько зона захвата ▲ шире видимой кнопки (см. PRESS_CSS).
const JUMP_ZONE_PAD = 6

// --- ПРАВЫЙ БЛОК: центры кнопок от ПРАВОГО края панели (rx) и от её верха (y) ---
//
// ⚠️ От правого края, а не от левого, и это не вкус. До 12.10.2026 кнопки
// ставились по left, а left считался из window.innerWidth прямо в ref-колбэке —
// то есть ширина экрана читалась только при рендере React. Поворот телефона
// рендера не вызывает, и блок оставался стоять по старой ширине, пока меню не
// перерисуется само (его таймер — раз в 15 с): замер дал 7.0 и 12.4 с, причём
// после поворота обратно в вертикаль блок был ЗА экраном — без атаки и прыжка.
// Расстояние от правого края от ширины экрана не зависит вовсе: браузер ставит
// кнопку на место сам, в том же кадре, что и поворот.
// Три угла веера: уклонение и два навыка вокруг атаки.
const FAN_ANGLES = [FAN_MID - FAN_THETA, FAN_MID, FAN_MID + FAN_THETA] as const
const ATK_POS = { rx: BTN_EDGE + BTN_R, y: PANEL_H - BTN_EDGE - BTN_R }
const fanPos = (angle: number) => ({
  // cos у всех трёх углов отрицательный или около нуля (кнопки левее атаки или
  // над ней) — минус перед ним и даёт rx не меньше, чем у атаки.
  rx: ATK_POS.rx - FAN_D * Math.cos(angle),
  y: ATK_POS.y + FAN_D * Math.sin(angle),
})
// Прыжок — вплотную слева от всего веера (не от центра атаки), на высоте центра
// атаки. Формула прежняя, только отсчёт от правого края.
const JUMP_POS = { rx: ATK_POS.rx + FAN_D + BTN_R + 30, y: ATK_POS.y }
// Зелье — НАД самым верхним навыком веера (FAN_ANGLES[2]), как и было. Высота
// панели (PANEL_H) посчитана так, чтобы эта кнопка в неё умещалась целиком.
const POTION_POS = { rx: fanPos(FAN_ANGLES[2]).rx, y: fanPos(FAN_ANGLES[2]).y - BTN_R - BTN_R - POT_GAP }

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
 * pos — центр кнопки: rx от ПРАВОГО края панели, y от её верха (см. «ПРАВЫЙ
 * БЛОК» выше — почему именно от правого).
 *
 * art — картинка кнопки фоном, а не <img>: у кнопок есть textContent (цифра
 * глотков, «?»), и вложенную картинку он бы затирал.
 *
 * ⚠️ Арт рисуется ВО ВСЮ кнопку и ЗАМЕНЯЕТ CSS-круг: у каждой картинки каменный
 * диск уже нарисован, и оставить под ней прежний тёмный круг с рамкой значило бы
 * камень внутри камня. Поэтому при art рамки и фона нет вовсе. Подсветку нажатия
 * в таком виде даёт яркость, а не заливка (см. PRESS_CSS).
 */
function roundButtonCss(pos: { rx: number; y: number }, opts: { fontSize: number; art?: string | null; dimmed?: boolean }): string {
  return `
    position:absolute;
    box-sizing:border-box;
    right:${pos.rx - BTN_R}px; top:${pos.y - BTN_R}px;
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

// --- ИНДИКАТОР ПЕРЕЗАРЯДКИ НА КНОПКАХ НАВЫКОВ ---
//
// Числа приходят из модуля навыков (skills.readCooldown) через тикер
// Explore.tsx, рисуются ЗДЕСЬ — тот же раздел труда, что у skillSlots выше:
// кто считает, тот не рисует.
//
// ⚠️ Тень — ЕЩЁ ОДИН СЛОЙ ФОНА поверх печати, а НЕ псевдоэлемент. Слои фона
// рисуются НИЖЕ текста, поэтому цифра секунд остаётся поверх тени и читаемой.
// Абсолютно спозиционированный псевдоэлемент накрыл бы её собой, а не
// абсолютный стал бы флекс-элементом и сдвинул бы её с центра — та же грабля,
// что у зоны захвата ▲ ниже.
const CD_SHADE = 'rgba(8,6,12,0.66)'
// Сглаживание кромки сектора: у конического градиента без него край
// лестничный. Полтора градуса — меньше, чем шаг цифры, и в раскладке не видно.
const CD_FEATHER_DEG = 1.5
// Вспышка ободка в момент готовности — «около 0.3 с» по дизайну.
const CD_FLASH_MS = 300
const CD_FLASH_ATTR = 'data-cd-flash'
// Маны на навык не хватает — кнопка тусклая (см. paintSkillAffordable ниже).
const NO_MANA_ATTR = 'data-no-mana'
const NO_MANA_OPACITY = 0.45

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
     парирование стоит секунды кулдауна, поэтому спорный зазор отдан прыжку.
     Считается это теперь ЧЕСТНО: с box-sizing:border-box номинальный радиус и
     фактический совпадают (раньше рамка добавляла 1px, см. CLAUDE.md). Соседи
     прыжка — парирование и зелье, оба на расстоянии BTN_STEP = 60px, то есть
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
  /* Навык готов: ободок кнопки один раз коротко вспыхивает. Атрибут ставит и
     снимает paintSkillCooldown, вид задан ЗДЕСЬ — инлайн-стиль на этой кнопке
     жил бы до первого ре-рендера (cssText переписывается целиком), ровно та же
     причина, по которой правилом задана подсветка нажатия выше.
     Ободок ВНУТРЕННИЙ (inset): кнопки веера КАСАЮТСЯ друг друга, и внешнее
     кольцо залезло бы на соседей.
     Цвет — золото дизайн-системы, но вспышка на цвет не опирается: её главный
     сигнал — движение (кольцо появляется и гаснет).
     filter назван во ВСЕХ трёх кадрах намеренно: кадр без свойства берёт
     значение из «подложки», и у разных движков это считается по-разному.
     При нажатии яркость перебивает подсветка (у неё !important, а important
     старше анимации) — так и надо, нажатая кнопка важнее вспышки. */
  @keyframes rp-skill-ready {
    0%   { box-shadow: inset 0 0 0 0 rgba(232,178,58,0); filter: brightness(1); }
    30%  { box-shadow: inset 0 0 0 3px rgba(232,178,58,0.95); filter: brightness(1.25); }
    100% { box-shadow: inset 0 0 0 0 rgba(232,178,58,0); filter: brightness(1); }
  }
  [data-touch-controls] [${CD_FLASH_ATTR}="1"] {
    animation: rp-skill-ready ${CD_FLASH_MS}ms ease-out;
  }
  /* Маны на навык не хватает: кнопка тусклая. Атрибут ставит и снимает
     paintSkillAffordable, вид задан ЗДЕСЬ — по той же причине, что вспышка
     выше: инлайновая opacity жила бы до первого ре-рендера (cssText
     переписывается целиком), а атрибут он не трогает. !important перебивает
     opacity:1, которую пишет в инлайн roundButtonCss. */
  [data-touch-controls] [${NO_MANA_ATTR}="1"] {
    opacity: ${NO_MANA_OPACITY} !important;
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

/**
 * Состояние индикатора перезарядки ОДНОЙ кнопки. Живёт по самому DOM-узлу
 * (WeakMap, как pressState выше), а не в замыкании компонента: узлы веера
 * создаются императивно и переживают ре-рендеры, а замыкание — нет.
 */
type SkillCdState = {
  // Слои фона БЕЗ тени — ровно то, что написал roundButtonCss (печать навыка).
  // Снимается С УЗЛА, а не приходит пропом: cssText кнопки переписывается
  // целиком при каждом ре-рендере, и что в нём сейчас лежит, знает только он.
  base: string
  // Что УЖЕ нарисовано. Сравнение с ним и есть вся экономия: DOM трогается
  // только когда поменялся угол или цифра, а не каждый кадр. -1 = не нарисовано
  // ничего (навык готов).
  drawnDeg: number
  drawnSecs: number
  // Последние ПОЛУЧЕННЫЕ числа — чтобы перерисовать тень после перезаписи
  // cssText, не дожидаясь следующего кадра (см. repaintSkillCooldown).
  leftMs: number
  totalMs: number
  // Перезарядка шла в прошлый вызов. По фронту «шла → кончилась» заводится
  // вспышка. Отдельное поле, а не вывод из drawnDeg: нарисованное после
  // ре-рендера сбрасывается, а состояние перезарядки — нет.
  onCd: boolean
  flashMs: number
}
const skillCdState = new WeakMap<HTMLElement, SkillCdState>()

function drawSkillCd(el: HTMLElement, st: SkillCdState) {
  const onCd = st.leftMs > 0 && st.totalMs > 0
  // Открытая (светлая) часть растёт по часовой стрелке от 12 часов, тень
  // убывает вместе с ней: `from 0deg` — это и есть 12 часов, и конический
  // градиент идёт по часовой стрелке сам.
  // Угол в ЦЕЛЫХ градусах — и чтобы строка не дёргалась по десятым, и чтобы
  // кадров без записи в DOM было больше.
  const deg = onCd ? Math.round(360 * (1 - Math.min(1, st.leftMs / st.totalMs))) : -1
  // ВВЕРХ: 4.2 с -> «5». Ноль на кнопке не появится никогда — на нуле
  // перезарядки уже нет, и ветка ниже стирает цифру вместе с тенью.
  const secs = onCd ? Math.ceil(st.leftMs / 1000) : -1
  if (deg === st.drawnDeg && secs === st.drawnSecs) return
  st.drawnDeg = deg
  st.drawnSecs = secs
  if (!onCd) {
    el.style.backgroundImage = st.base
    el.style.backgroundSize = '100%'
    el.textContent = ''
    return
  }
  const clearTo = Math.max(0, deg - CD_FEATHER_DEG)
  // ⚠️ Если движок не знает conic-gradient, CSSOM отбрасывает ВСЁ присваивание
  // и на кнопке остаётся прежний фон — печать навыка, без тени. То есть
  // деградация тихая и безопасная: цифра секунд остаётся на месте в любом
  // случае, потому что она в textContent, а не в фоне.
  const shade = `conic-gradient(from 0deg, rgba(0,0,0,0) ${clearTo}deg, ${CD_SHADE} ${deg}deg)`
  // Пустой base бывает только у кнопки без арта (у навыков такой нет). Запятая
  // без второго слоя сделала бы значение невалидным, и фон не сменился бы
  // вовсе — поэтому ветка, а не склейка наугад.
  el.style.backgroundImage = st.base ? `${shade}, ${st.base}` : shade
  el.style.backgroundSize = st.base ? '100%, 100%' : '100%'
  el.textContent = String(secs)
}

/**
 * Обновить индикатор перезарядки на кнопке навыка.
 *
 * Зовётся КАЖДЫЙ КАДР из тикера Explore.tsx, а не из React-рендера: дерево
 * перерисовывать на каждый кадр нельзя (на телефоне это заикание — см.
 * .claude/skills/pixijs-conventions). Поэтому и пишем прямо в стиль узла.
 *
 * leftMs/totalMs — из skills.readCooldown; dtMs — ticker.deltaMS, им тикает
 * вспышка. Именно в миллисекундах, а не в кадрах: по кадрам она на просевшем
 * FPS укоротилась бы в реальных секундах (общее правило проекта по окнам).
 */
export function paintSkillCooldown(el: HTMLElement, leftMs: number, totalMs: number, dtMs: number) {
  let st = skillCdState.get(el)
  if (!st) {
    st = { base: el.style.backgroundImage, drawnDeg: -1, drawnSecs: -1, leftMs, totalMs, onCd: false, flashMs: 0 }
    skillCdState.set(el, st)
  }
  st.leftMs = leftMs
  st.totalMs = totalMs
  const onCd = leftMs > 0 && totalMs > 0
  // Фронт готовности. На первом кадре забега сюда тоже заходим, но onCd там
  // false с самого начала — вспышки на старте не будет.
  if (st.onCd && !onCd) st.flashMs = CD_FLASH_MS
  st.onCd = onCd
  if (st.flashMs > 0) {
    // Атрибут ставится ОДИН раз: переписывать его тем же значением каждый кадр
    // значит каждый кадр пересчитывать стиль узла задаром.
    if (el.getAttribute(CD_FLASH_ATTR) !== '1') el.setAttribute(CD_FLASH_ATTR, '1')
    st.flashMs -= dtMs
    if (st.flashMs <= 0) {
      st.flashMs = 0
      el.removeAttribute(CD_FLASH_ATTR)
    }
  }
  drawSkillCd(el, st)
}

/**
 * Перечитать базовый фон кнопки и нарисовать индикатор заново. Зовётся сразу
 * после перезаписи cssText (fan-блок ниже): та стирает и тень, и
 * background-size, а перезарядка при этом никуда не делась.
 *
 * Без этого тень гасла бы на один кадр при каждом ре-рендере Explore — а они
 * идут регулярно (таймер обелиска тикает раз в секунду), то есть вышло бы
 * мерцание на ровном месте.
 */
export function repaintSkillCooldown(el: HTMLElement) {
  const st = skillCdState.get(el)
  // Записи нет — по этой кнопке индикатор не рисовали ни разу (или его у неё
  // не бывает вовсе, как у 🔄). Завести её здесь нечем: чисел перезарядки тут
  // не знают.
  if (!st) return
  st.base = el.style.backgroundImage
  st.drawnDeg = -1
  st.drawnSecs = -1
  drawSkillCd(el, st)
}

/**
 * Приглушить кнопку навыка, на который не хватает маны, или вернуть ей вид.
 *
 * Зовётся КАЖДЫЙ КАДР из тикера Explore.tsx, рядом с paintSkillCooldown и по
 * той же причине не через React. В DOM пишет только на СМЕНУ состояния.
 * Хватает ли маны, решает модуль навыков (skills.canAfford) — тем же условием,
 * которым он гейтит само нажатие; здесь только вид.
 */
export function paintSkillAffordable(el: HTMLElement, affordable: boolean) {
  const dimmed = el.getAttribute(NO_MANA_ATTR) === '1'
  if (dimmed === !affordable) return
  if (affordable) el.removeAttribute(NO_MANA_ATTR)
  else el.setAttribute(NO_MANA_ATTR, '1')
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
      {/* Панель кнопок поднята над низом экрана на безопасную зону + 16px.
          Сама зона — общая переменная --rp-safe-bottom (src/index.css, раздел
          «БЕЗОПАСНЫЕ ЗОНЫ ЭКРАНА»): там же записано, из каких четырёх источников
          она берётся и почему между ними max, а не сумма. Формула та же, что
          стояла здесь до 12.10.2026, — переехала, чтобы её читали и остальные
          края экрана.
          16px — собственный отступ. Он же и есть весь подъём там, где зона
          нулевая (браузер, старый клиент Telegram).
          Запасное значение в var() — на случай, если переменной нет вовсе: без
          него calc() стал бы невалидным и панель легла бы на нижний край. */}
      <div data-touch-controls="" style={{
        position: 'absolute',
        bottom: 'calc(16px + var(--rp-safe-bottom, 0px))',
        left: 0, right: 0, height: PANEL_H, zIndex: 1001, pointerEvents: 'none',
      }}>
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
            // Координаты прежние (left 23 / bottom 12) — их правка была лишней.
            // Слева прибавлена безопасная зона: в горизонтали там чёлка или
            // скруглённый угол экрана (в вертикали она нулевая).
            position: 'absolute', left: 'calc(23px + var(--rp-safe-left, 0px))', bottom: 12,
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
            // Координаты прежние (left 90 / bottom 12), плюс та же безопасная
            // зона слева, что у ◀.
            position: 'absolute', left: 'calc(90px + var(--rp-safe-left, 0px))', bottom: 12,
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
            // РАСКЛАДКА ПРАВОГО КЛАСТЕРА — прежняя, веером вокруг атаки. Где
            // стоит каждая кнопка — ATK_POS / fanPos / JUMP_POS / POTION_POS
            // вверху файла: атака в правом нижнем углу, веер (парирование и два
            // навыка) вокруг неё, прыжок слева от веера на линии атаки, зелье
            // над верхней кнопкой веера. Слева на той же линии — ◀ и ▶.
            // Кнопки веера КАСАЮТСЯ друг друга — так было и раньше (хорда ровно
            // в два радиуса), это и держит навыки рядом с атакой.
            // Ближайшая пара «левый блок — правый кластер» это ▶ и прыжок: на
            // 390px между их кругами 72px, на 375px — 57px, на 320px — 2px.
            // ⚠️ Ширина экрана здесь НЕ читается (см. «ПРАВЫЙ БЛОК» вверху файла):
            // всё, что зависит от неё, обязано быть выражено CSS.
            const angles = FAN_ANGLES

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
              const el = existing || document.createElement('button')
              el.dataset.btn = b.id
              el.textContent = b.spec.label
              el.style.cssText = roundButtonCss(fanPos(b.angle), {
                fontSize: 20,
                art: b.spec.art,
                dimmed: b.spec.dimmed,
              })
              // cssText выше стёр тень перезарядки вместе со всем остальным —
              // возвращаем её по тому состоянию, которое ведёт
              // paintSkillCooldown. Для 🔄 (перезарядки у кнопки нет) вызов
              // ничего не делает.
              repaintSkillCooldown(el)
              if (!existing) container.appendChild(el)
            })

            const atkEl = container.querySelector('[data-btn="atk"]') as HTMLElement
            const atk = atkEl || document.createElement('button')
            atk.dataset.btn = 'atk'
            atk.textContent = ''
            atk.style.cssText = roundButtonCss(ATK_POS, { fontSize: 20, art: C.BTN_ART_SRC.attack })
            if (!atkEl) container.appendChild(atk)

            // Прыжок — см. JUMP_POS вверху файла.
            const jumpEl = container.querySelector('[data-btn="jump"]') as HTMLElement
            const jump = jumpEl || document.createElement('button')
            jump.dataset.btn = 'jump'
            jump.textContent = ''
            jump.style.cssText = roundButtonCss(JUMP_POS, { fontSize: 20, art: C.BTN_ART_SRC.jump })
            if (!jumpEl) container.appendChild(jump)

            // Зелье — см. POTION_POS вверху файла.
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
            pot.style.cssText = roundButtonCss(POTION_POS, { fontSize: 12, art: C.BTN_ART_SRC.blank })
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
          // right — безопасная зона справа: кнопки блока стоят от ПРАВОГО края
          // этого контейнера (см. «ПРАВЫЙ БЛОК» вверху файла), и сдвиг самого
          // контейнера уводит их из-под чёлки всем блоком сразу.
          style={{ position: 'absolute', top: 0, left: 0, right: 'var(--rp-safe-right, 0px)', bottom: 0, pointerEvents: 'none' }}
        />
      </div>
    </>
  )
}
