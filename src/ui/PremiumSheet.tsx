// «Печать Колокола» — окно премиума и окно подарка (25.11.2026, docs/premium.md).
//
// Окно — каменная рамка итогов (results_frame.png) 9-slice'ом: углы не тянутся,
// стороны и середина тянутся, поэтому одна рамка годится и в вертикали, и
// набок. Внутри — колокол со свечением, заголовок, семь даров плитками (две
// колонки, набок — четыре), внизу кнопка или срок. Содержимое прокручивается
// внутри рамки, кнопка всегда видна.
//
// Ничего не решает: активна ли печать, хватает ли RP, какой тир подарка — всё
// это считают вызывающий (App.tsx, по isPremium) и сервер. Здесь только вид.
import type { ReactNode } from 'react'
import { C, FONT_DISPLAY } from './theme'
import { BellEmblem } from './ChannelPanel'
import { PremiumBadge } from './PremiumBadge'
import { RESULTS_FRAME_SRC } from './ResultsFrame'
import { POTION_TIERS } from '../potions'
import { LOW_LANDSCAPE_MAX_H } from '../explore/constants'
import {
  PREMIUM_PRICE_RP, PREMIUM_DAYS, PREMIUM_GIFT_POTIONS, PREMIUM_LUCK, PREMIUM_BAG_CELLS, premiumLeftLine,
} from '../premium'

const ICON = (name: string) => `${import.meta.env.BASE_URL}assets/icons/${name}`
const LOW_LANDSCAPE = `(orientation: landscape) and (max-height: ${LOW_LANDSCAPE_MAX_H}px)`

const CSS = `
@keyframes rp-prem-rise { from { opacity: 0; transform: translateY(14px) scale(.97) } to { opacity: 1; transform: none } }
@keyframes rp-prem-glow { 0%, 100% { opacity: .55 } 50% { opacity: 1 } }
@keyframes rp-prem-tile { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
.rp-prem-frame { animation: rp-prem-rise 420ms cubic-bezier(.2,.9,.3,1.1) both }
.rp-prem-glow { animation: rp-prem-glow 3.4s ease-in-out infinite }
.rp-prem-tile { animation: rp-prem-tile 380ms ease-out both }
/* Даров семь (26.11.2026: «Знак Колокола у имени» убран). Последний — подарок —
   на две колонки: в вертикали это вся строка (3 ряда по 2 + 1 широкая), набок
   — 4 + (1 + 1 + 2): одинокой плитки в последнем ряду нет. */
.rp-prem-gift { grid-column: span 2 }
.rp-prem-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px }
.rp-prem-head { display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center }
.rp-prem-btn { transition: transform .08s ease, filter .12s ease }
.rp-prem-btn:active:not(:disabled) { transform: scale(.97); filter: brightness(1.15) }
@media ${LOW_LANDSCAPE} {
  .rp-prem-grid { grid-template-columns: repeat(4, minmax(0, 1fr)) }
  .rp-prem-head { flex-direction: row; justify-content: center; gap: 14px; text-align: left }
  .rp-prem-frame { width: min(760px, calc(100vw - var(--rp-safe-left, 0px) - var(--rp-safe-right, 0px) - 24px)) !important }
}
@media (prefers-reduced-motion: reduce) { .rp-prem-frame, .rp-prem-glow, .rp-prem-tile { animation: none } }
`

type Gift = { title: string; line: string; icon: ReactNode }

function Img({ src, alt }: { src: string; alt: string }) {
  return <img src={src} alt={alt} width={34} height={34} style={{ width: 34, height: 34, objectFit: 'contain', display: 'block', filter: 'drop-shadow(0 0 6px rgba(245,188,91,.35))' }} />
}

function gifts(giftTier: number): Gift[] {
  const potion = POTION_TIERS[giftTier]
  return [
    { title: 'Трофеев больше на четверть', line: 'К тому, что вынес живым из вылазки', icon: <Img src={ICON('icon_trophy.png')} alt="Трофеи" /> },
    { title: 'Ещё два задания на доске', line: 'Пять заказов вместо трёх', icon: <Img src={`${import.meta.env.BASE_URL}assets/quests/quest_note.webp`} alt="Задание" /> },
    { title: `Удача +${PREMIUM_LUCK}`, line: 'Добыча щедрее, редкое ближе', icon: <Img src={ICON('icon_luck.png')} alt="Удача" /> },
    { title: `Сумка шире на ${PREMIUM_BAG_CELLS} ячеек`, line: 'Унесёшь больше добычи', icon: <Img src={ICON('nav_shop.png')} alt="Сумка" /> },
    { title: 'Боссы попадаются чаще', line: 'Вдвое чаще там, где они живут', icon: <Img src={ICON('event_boss.png')} alt="Босс" /> },
    { title: 'Сила, выносливость и ловкость растут вдвое быстрее', line: 'Каждый удар и рана учат вдвое', icon: <Img src={ICON('icon_strength.png')} alt="Рост" /> },
    { title: `В подарок ${PREMIUM_GIFT_POTIONS} зелий твоего уровня`, line: potion ? `${potion.nameRu} — при каждой печати` : 'При каждой печати', icon: potion ? <Img src={ICON(potion.icon)} alt={potion.nameRu} /> : null },
  ]
}

export type PremiumSheetProps = {
  /** Остаток по часам телефона (0 — печать не активна). */
  leftMs: number
  /** RP героя; null — неизвестно (кнопка гаснет). */
  rp: number | null
  /** Индекс тира подарка (premiumGiftTier). */
  giftTier: number
  busy: boolean
  error: string | null
  onBuy: () => void
  onClose: () => void
}

export function PremiumSheet({ leftMs, rp, giftTier, busy, error, onBuy, onClose }: PremiumSheetProps) {
  const active = leftMs > 0
  const lack = rp === null ? null : Math.max(0, PREMIUM_PRICE_RP - rp)
  const canBuy = !active && !busy && lack === 0
  return (
    <div onClick={onClose} style={{
      boxSizing: 'border-box', position: 'fixed', inset: 0, zIndex: 1500,
      padding: 'calc(var(--rp-safe-top, 0px) + 12px) calc(var(--rp-safe-right, 0px) + 12px) calc(var(--rp-safe-bottom, 0px) + 12px) calc(var(--rp-safe-left, 0px) + 12px)',
      background: 'radial-gradient(circle at 50% 30%, rgba(70,50,22,0.92) 0%, rgba(10,8,13,0.96) 65%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <style>{CSS}</style>
      <div className="rp-prem-frame" data-premium-sheet="" onClick={(e) => e.stopPropagation()} style={{
        boxSizing: 'border-box', width: 'min(420px, 100%)', maxHeight: '100%',
        display: 'flex', flexDirection: 'column',
        borderStyle: 'solid', borderWidth: 40, borderImage: `url(${RESULTS_FRAME_SRC}) 64 fill / 40px stretch`,
        boxShadow: '0 0 60px rgba(245,188,91,0.18), 0 18px 40px rgba(0,0,0,0.7)',
        position: 'relative',
      }}>
        {/* Тёплое свечение изнутри, как у свитка у огня. */}
        <div className="rp-prem-glow" aria-hidden style={{
          position: 'absolute', inset: -20, pointerEvents: 'none',
          background: 'radial-gradient(ellipse at 50% 0%, rgba(245,188,91,0.22), transparent 60%)',
        }} />
        <div style={{ position: 'relative', overflowY: 'auto', minHeight: 0, margin: '-14px -14px 0', padding: '0 4px 4px' }}>
          <div className="rp-prem-head">
            <BellEmblem size={72} />
            <div>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 25, color: C.glowCore, textShadow: '0 0 16px rgba(245,188,91,.45)', lineHeight: 1.15 }}>Печать Колокола</div>
              <div style={{ fontSize: 13, color: C.bone, fontStyle: 'italic', marginTop: 4 }}>Тридцать дней Убежище на твоей стороне</div>
            </div>
          </div>
          <div style={{ height: 1, margin: '12px 8px', background: `linear-gradient(90deg, transparent, ${C.glowEdge}, transparent)` }} />
          <div className="rp-prem-grid">
            {gifts(giftTier).map((g, i, all) => (
              <div key={g.title} className={i === all.length - 1 ? 'rp-prem-tile rp-prem-gift' : 'rp-prem-tile'} style={{
                animationDelay: `${120 + i * 45}ms`,
                boxSizing: 'border-box', minWidth: 0, display: 'flex', gap: 8, alignItems: 'center', textAlign: 'left',
                padding: '9px 9px', borderRadius: 10,
                background: 'linear-gradient(180deg, rgba(58,44,20,0.55), rgba(26,21,30,0.85))',
                border: `1px solid rgba(209,151,68,0.35)`,
                boxShadow: 'inset 0 0 10px rgba(209,151,68,0.12)',
              }}>
                <div style={{ flex: 'none', width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{g.icon}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, lineHeight: 1.25, color: C.textMain, fontWeight: 600 }}>{g.title}</div>
                  <div style={{ fontSize: 10.5, lineHeight: 1.3, color: C.textDim, marginTop: 2 }}>{g.line}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ position: 'relative', margin: '12px -14px -16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          {active ? (
            <div data-premium-left="" style={{
              boxSizing: 'border-box', width: '100%', minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              borderRadius: 10, border: `1px solid ${C.glowEdge}`, background: 'rgba(58,44,20,0.5)',
              fontFamily: FONT_DISPLAY, fontSize: 16, color: C.glowCore, textAlign: 'center', padding: '6px 10px',
            }}>
              <PremiumBadge size={20} />Печать с тобой ещё {premiumLeftLine(leftMs)}
            </div>
          ) : (
            <>
              <button type="button" className="rp-prem-btn" data-premium-buy="" disabled={!canBuy} onClick={onBuy} style={{
                boxSizing: 'border-box', width: '100%', minHeight: 50, borderRadius: 10, cursor: canBuy ? 'pointer' : 'default',
                fontFamily: FONT_DISPLAY, fontSize: 18, letterSpacing: .3,
                border: `1px solid ${canBuy ? C.glowCore : C.stoneDark}`,
                background: canBuy ? 'linear-gradient(180deg, #8a6324, #5a3e14)' : C.nicheDeep,
                color: canBuy ? '#FFF1CF' : C.textDim,
                boxShadow: canBuy ? '0 0 18px rgba(245,188,91,.35), inset 0 1px 0 rgba(255,230,170,.35)' : 'none',
                opacity: canBuy || busy ? 1 : 0.7,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}>
                {busy ? 'Колокол слушает…' : <>Принять печать · {PREMIUM_PRICE_RP}<img src={ICON('icon_rp.png')} alt="RP" width={18} height={18} style={{ display: 'block' }} /></>}
              </button>
              {lack !== null && lack > 0 && <div style={{ fontSize: 12, color: C.textDim }}>Не хватает {lack} RP</div>}
              {rp === null && <div style={{ fontSize: 12, color: C.textDim }}>Запас RP не загружен</div>}
            </>
          )}
          {error !== null && <div style={{ fontSize: 12, color: '#E0353B', textAlign: 'center' }}>{error}</div>}
          <div style={{ fontSize: 10.5, color: C.textDim }}>{PREMIUM_DAYS} дней · без автопродления</div>
        </div>
      </div>
    </div>
  )
}

/** Окно после покупки: «Колокол признал тебя» и подарок — зелья ×100. */
export function PremiumGiftNotice({ tier, count, onClose }: { tier: number; count: number; onClose: () => void }) {
  const potion = POTION_TIERS[tier - 1]
  return (
    <div onClick={onClose} data-premium-gift="" style={{
      boxSizing: 'border-box', position: 'fixed', inset: 0, zIndex: 1600,
      padding: 'calc(var(--rp-safe-top, 0px) + 24px) calc(var(--rp-safe-right, 0px) + 16px) calc(var(--rp-safe-bottom, 0px) + 24px) calc(var(--rp-safe-left, 0px) + 16px)',
      background: 'radial-gradient(circle at 50% 40%, rgba(92,66,24,0.99) 0%, rgba(14,11,17,0.995) 62%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, overflowY: 'auto',
    }}>
      <style>{CSS}</style>
      <div className="rp-prem-frame"><BellEmblem size={96} /></div>
      <div className="rp-prem-frame" style={{ fontFamily: FONT_DISPLAY, fontSize: 28, color: C.glowCore, textAlign: 'center', textShadow: '0 0 18px rgba(245,188,91,.5)' }}>
        Колокол признал тебя
      </div>
      <div style={{ fontSize: 13, color: C.bone, fontStyle: 'italic', textAlign: 'center', maxWidth: 300, lineHeight: 1.5 }}>
        Печать легла на тебя на {PREMIUM_DAYS} дней. Убежище помнит своих.
      </div>
      {potion && (
        <div style={{ position: 'relative', marginTop: 4 }}>
          <img src={ICON(potion.icon)} alt={potion.nameRu} style={{ width: 'min(28vmin, 112px)', height: 'min(28vmin, 112px)', objectFit: 'contain', display: 'block', filter: 'drop-shadow(0 0 18px rgba(245,188,91,.55))' }} />
          <div style={{ position: 'absolute', right: -14, bottom: -4, fontFamily: FONT_DISPLAY, fontSize: 24, color: '#FFF1CF', textShadow: '0 0 8px #000, 0 0 14px rgba(245,188,91,.6)' }}>×{count}</div>
        </div>
      )}
      {potion && <div style={{ fontSize: 14, color: C.textMain }}>{potion.nameRu} — уже в твоих запасах</div>}
      <button type="button" className="rp-prem-btn" onClick={(e) => { e.stopPropagation(); onClose() }} style={{
        marginTop: 6, minWidth: 170, minHeight: 48, padding: '10px 26px', borderRadius: 10,
        background: C.nicheDeep, border: `1px solid ${C.glowEdge}`, color: C.glowCore,
        fontFamily: FONT_DISPLAY, fontSize: 17, cursor: 'pointer', boxShadow: 'inset 0 0 14px rgba(209,151,68,0.3)',
      }}>
        Хорошо
      </button>
    </div>
  )
}
