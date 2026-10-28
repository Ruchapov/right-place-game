import type { ReactNode } from 'react'
import * as C from '../explore/constants'
import { C as Theme } from './theme'

// Каменная рамка итогов — ОБЩАЯ для экрана итогов забега (ResultsScreen,
// Explore.tsx) и окна о прошлом забеге (PastRunNotice.tsx). До 29.10.2026 у окна
// была копия геометрии с пометкой «менять вместе»; теперь оба берут её отсюда.
//
// Две раскладки, переключает их ТОЛЬКО CSS (медиа-запрос ниже), без рендера
// React — поворот телефона при открытом экране данных не теряет:
//   обычная (вертикаль, планшет, ПК) — портретная картинка results_frame.png,
//     все секции одной колонкой внутри поля рамки (space-evenly). Обёртки
//     четырёх частей здесь display:contents, и для раскладки их нет: она та же,
//     что до 29.10.2026, пиксель в пиксель;
//   низкий горизонтальный экран (телефон набок, LOW_LANDSCAPE_MAX_H, то же
//     условие, что у меню и забега) — та же картинка 9-slice'ом (border-image:
//     углы не тянутся, тянутся стороны и середина), рамка между безопасными
//     зонами, ≈85% ширины области и вся доступная высота. Внутри сетка:
//     шапка во всю ширину, ниже две колонки (слева — события и плита
//     трофеев, справа — прокачка, добыча, задание), кнопка внизу по центру.
//     Не влезает — прокручивается правая колонка, кнопка видна всегда (у левой
//     прокрутка — только запас: на 780×360 она влезает без неё).

export const RESULTS_FRAME_SRC = `${import.meta.env.BASE_URL}assets/results_frame.png`
export const RESULTS_PLATE_SRC = `${import.meta.env.BASE_URL}assets/results_plate.png`
// Реальный аспект файла (420×596), НЕ через CSS aspect-ratio — та же причина,
// что у ERROR_FRAME/HP-плиты (ломает %-позиционирование абсолютных детей в
// некоторых WebView).
const RESULTS_FRAME_ASPECT = 596 / 420
const RESULTS_FRAME_W = 'clamp(300px, 94vmin, 400px)'
const RESULTS_FRAME_H = `calc(${RESULTS_FRAME_W} * ${RESULTS_FRAME_ASPECT})`
// Внутреннее поле рамки — доли (0..1) от размера рамки, замерено по файлу.
const RESULTS_FIELD_X = 0.105
const RESULTS_FIELD_Y = 0.075
const RESULTS_FIELD_W = 0.789
const RESULTS_FIELD_H = 0.847
// Аспект плиты (420×139, высота/ширина) — задаёт ОБЁРТКЕ реальную высоту
// через padding-bottom% (см. TrophyPlate). padding-bottom% считается от ШИРИНЫ
// элемента (она определена — 100% готовой колонки), в отличие от auto-высоты
// от <img>: без этого проценты top/height внутреннего поля не резолвятся (тот
// же класс бага, что у HP-плиты, см. CLAUDE.md, Critical Gotchas).
const RESULTS_PLATE_ASPECT = 139 / 420
// Внутреннее поле плиты — доли от размера ПЛИТЫ, замерено по файлу.
const RESULTS_PLATE_FIELD_X = 0.055
const RESULTS_PLATE_FIELD_Y = 0.165
const RESULTS_PLATE_FIELD_W = 0.89
const RESULTS_PLATE_FIELD_H = 0.619

// 9-SLICE набок. Срез — 64 px файла со всех сторон: камень кончается на 34–35
// px, золотая линия идёт по 42–45 px (замер по файлу), так что и камень, и
// линия целиком в полосах среза, а середина — ровная заливка (25, 22, 29).
// Ширина полос на экране — FRAME_SIDE_BORDER, одна на все четыре стороны: угол
// масштабируется одинаково по обеим осям и не искажается. Золотая линия на
// экране — на 43/64 полосы от края; поле начинается чуть внутри неё
// (FRAME_SIDE_INSET — на сколько поле заходит в полосу).
const FRAME_SLICE = 64
const FRAME_SIDE_BORDER = 40
const FRAME_SIDE_INSET = Math.round(FRAME_SIDE_BORDER - (45 / FRAME_SLICE) * FRAME_SIDE_BORDER - 3)
const LOW_LANDSCAPE = `(orientation: landscape) and (max-height: ${C.LOW_LANDSCAPE_MAX_H}px)`
const SIDE_AREA_W = 'calc(100vw - var(--rp-safe-left, 0px) - var(--rp-safe-right, 0px) - 16px)'
const SIDE_AREA_H = 'calc(100vh - var(--rp-safe-top, 0px) - var(--rp-safe-bottom, 0px) - 16px)'

// Всё, что набок, — правилами по атрибутам с !important поверх инлайна:
// инлайн остаётся портретной раскладкой, и в вертикали ни одно правило не
// срабатывает.
const RESULTS_FRAME_CSS = `
  @media ${LOW_LANDSCAPE} {
    [data-rf-screen] {
      padding: calc(8px + var(--rp-safe-top, 0px)) calc(8px + var(--rp-safe-right, 0px)) calc(8px + var(--rp-safe-bottom, 0px)) calc(8px + var(--rp-safe-left, 0px)) !important;
      overflow: hidden !important;
    }
    [data-rf-frame] {
      width: min(calc(${SIDE_AREA_W} * 0.85), 760px) !important;
      height: ${SIDE_AREA_H} !important;
      box-sizing: border-box !important;
      border-style: solid !important;
      border-width: ${FRAME_SIDE_BORDER}px !important;
      border-image: url("${RESULTS_FRAME_SRC}") ${FRAME_SLICE} fill / ${FRAME_SIDE_BORDER}px stretch !important;
    }
    [data-rf-frame] > img { display: none !important; }
    [data-rf-field] {
      left: ${-FRAME_SIDE_INSET}px !important;
      top: ${-FRAME_SIDE_INSET}px !important;
      width: calc(100% + ${2 * FRAME_SIDE_INSET}px) !important;
      height: calc(100% + ${2 * FRAME_SIDE_INSET}px) !important;
      padding: 2px 10px !important;
      display: grid !important;
      align-items: stretch !important;
      justify-content: normal !important;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important;
      grid-template-rows: auto minmax(0, 1fr) auto !important;
      grid-template-areas: "head head" "left right" "foot foot" !important;
      column-gap: 18px !important;
      row-gap: 4px !important;
      overflow: hidden !important;
    }
    [data-rf-head] { grid-area: head; display: flex !important; flex-direction: column; align-items: center; min-width: 0; }
    [data-rf-head] > * { gap: 2px !important; max-width: 100%; }
    [data-rf-head] > * > * { white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; line-height: 1.15; }
    [data-rf-left], [data-rf-right] { display: flex !important; flex-direction: column; align-items: center; gap: 4px; min-height: 0; min-width: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; }
    [data-rf-left] { grid-area: left; }
    [data-rf-right] { grid-area: right; gap: 8px; }
    [data-rf-left] > :first-child, [data-rf-right] > :first-child { margin-top: auto; }
    [data-rf-left] > :last-child, [data-rf-right] > :last-child { margin-bottom: auto; }
    [data-rf-right] > div { gap: 4px !important; }
    [data-rf-events] { gap: clamp(14px, 4.5vmin, 24px) !important; }
    [data-rf-events] > img { width: clamp(34px, 10vmin, 44px) !important; }
    [data-rf-only="left"] [data-rf-left], [data-rf-only="right"] [data-rf-right] { grid-column: 1 / -1; }
    [data-rf-foot] { grid-area: foot; display: flex !important; justify-content: center; }
    [data-rf-plate] { width: min(100%, 54vh) !important; padding-bottom: min(${RESULTS_PLATE_ASPECT * 100}%, ${(54 * RESULTS_PLATE_ASPECT).toFixed(2)}vh) !important; }
    [data-rf-foot] button { padding-top: 11px !important; padding-bottom: 11px !important; }
  }
`

// Разделитель «линия-ромб-линия» под заголовком. Ширина снаружи: под
// заголовком он уже (68%), чем секционные разделители.
export function ResultsDivider({ width }: { width: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, width }}>
      <div style={{ flex: 1, height: 1, background: Theme.stoneDark }} />
      <div style={{ width: 6, height: 6, background: Theme.glowEdge, transform: 'rotate(45deg)', flexShrink: 0 }} />
      <div style={{ flex: 1, height: 1, background: Theme.stoneDark }} />
    </div>
  )
}

// Заголовок секции «— ПРОКАЧКА —» / «— ДОБЫЧА —» / «— ЗАДАНИЕ —».
export function ResultsSectionTitle({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
      <div style={{ flex: 1, height: 1, background: Theme.stoneDark }} />
      <div style={{ fontSize: 'clamp(9px, 2.6vmin, 11px)', letterSpacing: '0.08em', color: Theme.textDim, whiteSpace: 'nowrap' }}>
        {children}
      </div>
      <div style={{ flex: 1, height: 1, background: Theme.stoneDark }} />
    </div>
  )
}

// Плита трофеев. lossView — подпись «ПОТЕРЯНО» вместо «ПОЛУЧЕНО»; цвет числа
// задаёт вызывающий (у экрана итогов он от смерти, у окна прошлого забега — от
// подписи, как было).
export function TrophyPlate({ lossView, count, color }: { lossView: boolean; count: number; color: string }) {
  return (
    <div data-rf-plate="" style={{ position: 'relative', width: '100%', paddingBottom: `${RESULTS_PLATE_ASPECT * 100}%`, flexShrink: 0 }}>
      <img
        src={RESULTS_PLATE_SRC}
        alt=""
        draggable={false}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
      />
      <div
        style={{
          position: 'absolute',
          left: `${RESULTS_PLATE_FIELD_X * 100}%`,
          top: `${RESULTS_PLATE_FIELD_Y * 100}%`,
          width: `${RESULTS_PLATE_FIELD_W * 100}%`,
          height: `${RESULTS_PLATE_FIELD_H * 100}%`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
        }}
      >
        <div style={{ fontSize: 'clamp(8px, 2.4vmin, 10px)', letterSpacing: '0.05em', color: Theme.textDim }}>
          {lossView ? 'ТРОФЕЕВ ПОТЕРЯНО' : 'ТРОФЕЕВ ПОЛУЧЕНО'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              fontFamily: C.FONT_DISPLAY,
              fontWeight: 900,
              fontSize: 'clamp(19px, 5.8vmin, 25px)',
              color,
              lineHeight: 1,
            }}
          >
            {count}
          </span>
          <img src={C.REWARD_ICON_SRC.trophy} alt="" draggable={false} style={{ width: 20, height: 20, objectFit: 'contain' }} />
        </div>
      </div>
    </div>
  )
}

// Экран с рамкой. head — заголовок и подпись; left — события и плита; right —
// прокачка и остальные секции; foot — кнопки. left/right = null — этой колонки
// нет, и набок другая занимает обе (в вертикали разницы нет).
// dataName — атрибут на корне для правил и сценариев (data-past-run-notice).
export function ResultsFrame({
  head,
  left,
  right,
  foot,
  dataName,
  extraCss,
}: {
  head: ReactNode
  left: ReactNode | null
  right: ReactNode | null
  foot: ReactNode
  dataName?: string
  extraCss?: string
}) {
  const only = left === null ? 'right' : right === null ? 'left' : undefined
  const rootData = dataName ? { [`data-${dataName}`]: '' } : {}
  return (
    <div
      data-rf-screen=""
      {...rootData}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 2000,
        background: Theme.appBg,
        // Рамка выше экрана — экран прокручивается, и кнопка под рамкой
        // достижима. Центрирует рамку её собственный margin:auto, а не
        // alignItems: выровненное по центру содержимое, которое выше
        // контейнера, обрезается сверху, и до его верха не докрутить. Набок
        // (правило выше) рамка вписана в экран, и прокрутки нет.
        display: 'flex',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        // Сверху и снизу — безопасные зоны (28.10.2026): в полном экране и в
        // вертикали сверху кнопки Telegram и вырез, снизу полоса жеста.
        padding: 'calc(8px + var(--rp-safe-top, 0px)) 0 calc(8px + var(--rp-safe-bottom, 0px))',
        boxSizing: 'border-box',
      }}
    >
      <style>{RESULTS_FRAME_CSS + (extraCss ?? '')}</style>
      <div data-rf-frame="" data-rf-only={only} style={{ position: 'relative', width: RESULTS_FRAME_W, height: RESULTS_FRAME_H, margin: 'auto' }}>
        <img
          src={RESULTS_FRAME_SRC}
          alt=""
          draggable={false}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
        />
        {/* Содержимое — строго внутри внутреннего поля рамки (доли выше), плюс
            ~16px отступ по кругу. space-evenly — секции распределяются РАВНЫМИ
            промежутками по высоте поля; gap — пол на случай переполнения. */}
        <div
          data-rf-field=""
          style={{
            position: 'absolute',
            left: `${RESULTS_FIELD_X * 100}%`,
            top: `${RESULTS_FIELD_Y * 100}%`,
            width: `${RESULTS_FIELD_W * 100}%`,
            height: `${RESULTS_FIELD_H * 100}%`,
            padding: 16,
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'space-evenly',
            gap: 10,
            overflowY: 'auto',
          }}
        >
          <div data-rf-head="" style={{ display: 'contents' }}>{head}</div>
          {left !== null && <div data-rf-left="" style={{ display: 'contents' }}>{left}</div>}
          {right !== null && <div data-rf-right="" style={{ display: 'contents' }}>{right}</div>}
          <div data-rf-foot="" style={{ display: 'contents' }}>{foot}</div>
        </div>
      </div>
    </div>
  )
}
