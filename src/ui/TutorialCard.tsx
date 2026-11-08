import type { CSSProperties } from 'react'
import { C as Theme, FONT_DISPLAY } from './theme'
import { RESULTS_FRAME_SRC } from './ResultsFrame'
import { tipIconSrc, type TutorialTip } from '../tutorial'

// КАРТОЧКА ОБУЧЕНИЯ (08.11.2026, src/tutorial.ts). Одна на все подсказки:
// интро (листается: «Дальше» / «Пропустить», точки страниц), подсказка забега и
// меню («Понятно»).
//
// Рамка — та же картинка, что у экрана итогов (results_frame.png), 9-slice'ом
// в ОБОИХ положениях экрана: карточка небольшая, и портретный аспект рамки ей
// не нужен. Ширина — не больше 360 px и экрана минус безопасные зоны, высота —
// не больше экрана; текст длиннее — прокручивается внутри, кнопки всегда видны.
// Стоит над всем (zIndex 3000): над забегом (1000), окном прошлого забега и
// экраном итогов (2000).

const FRAME_SLICE = 64
const FRAME_BORDER = 34

const btn: CSSProperties = {
  minHeight: 44,
  padding: '0 18px',
  borderRadius: 8,
  border: `1px solid ${Theme.stoneDark}`,
  background: Theme.nicheDeep,
  color: Theme.textMain,
  fontFamily: FONT_DISPLAY,
  fontSize: 14,
  cursor: 'pointer',
}

export default function TutorialCard({
  tip,
  page,
  onNext,
  onSkip,
}: {
  tip: TutorialTip
  /** Интро: номер карточки и сколько всего. Нет — одиночная подсказка. */
  page?: { index: number; count: number }
  /** «Дальше» в интро или «Понятно» у одиночной. */
  onNext: () => void
  /** «Пропустить» — только в интро. */
  onSkip?: () => void
}) {
  const icon = tipIconSrc(tip.icon)
  const last = page ? page.index >= page.count - 1 : true
  return (
    <div
      data-tutorial=""
      // Тап мимо карточки не закрывает: подсказку надо увидеть.
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed', inset: 0, zIndex: 3000,
        background: 'rgba(10, 8, 12, 0.72)',
        display: 'flex',
        padding: 'calc(8px + var(--rp-safe-top, 0px)) calc(8px + var(--rp-safe-right, 0px)) calc(8px + var(--rp-safe-bottom, 0px)) calc(8px + var(--rp-safe-left, 0px))',
        boxSizing: 'border-box',
        touchAction: 'none',
      }}
    >
      <div style={{
        margin: 'auto',
        width: 'min(360px, 100%)',
        maxHeight: '100%',
        boxSizing: 'border-box',
        borderStyle: 'solid',
        borderWidth: FRAME_BORDER,
        borderImage: `url("${RESULTS_FRAME_SRC}") ${FRAME_SLICE} fill / ${FRAME_BORDER}px stretch`,
        display: 'flex', flexDirection: 'column',
        minHeight: 0,
      }}>
        <div style={{
          flex: '1 1 auto', minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
          padding: '4px 6px 10px', textAlign: 'center',
        }}>
          {icon && (
            <img src={icon} alt="" draggable={false}
              style={{ width: 'clamp(40px, 13vmin, 56px)', height: 'clamp(40px, 13vmin, 56px)', objectFit: 'contain', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.8))' }} />
          )}
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 17, color: Theme.glowCore, letterSpacing: 0.4 }}>
            {tip.title}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '70%' }}>
            <div style={{ flex: 1, height: 1, background: Theme.stoneDark }} />
            <div style={{ width: 6, height: 6, background: Theme.glowEdge, transform: 'rotate(45deg)', flexShrink: 0 }} />
            <div style={{ flex: 1, height: 1, background: Theme.stoneDark }} />
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.45, color: Theme.textMain, whiteSpace: 'pre-line' }}>
            {tip.text}
          </div>
          {page && page.count > 1 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
              {Array.from({ length: page.count }, (_, i) => (
                <div key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: i === page.index ? Theme.glowCore : Theme.stoneDark }} />
              ))}
            </div>
          )}
        </div>
        <div style={{ flex: 'none', display: 'flex', gap: 10, justifyContent: 'center', paddingTop: 4 }}>
          {page && onSkip && !last && (
            <button type="button" onClick={onSkip} style={{ ...btn, color: Theme.textDim }}>Пропустить</button>
          )}
          <button type="button" onClick={onNext}
            style={{ ...btn, color: Theme.glowCore, borderColor: Theme.glowEdge }}>
            {page && !last ? 'Дальше' : 'Понятно'}
          </button>
        </div>
      </div>
    </div>
  )
}
