// Общие кусочки экрана гильдии: окна, плашка сообщений, кружок уровня, иконки.
//
// Окна рисуются ПОРТАЛОМ в body: контейнер прокрутки меню (App.tsx) гасит
// маской нижние 96 px экрана и лежит под нижней панелью — окно внутри него
// гасло бы вместе с ним, каким бы ни был zIndex.
import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { C, FONT_DISPLAY } from '../theme'
import { GUILD_JOIN_MODE_LABEL, type GuildJoinMode } from '../../guild'
import { G, GUILD_CONTENT_MAX_W, TEXT_FONT, darkBtn, goldBtn } from './style'

/** Окно по центру; тап мимо закрывает. */
export function Overlay({ onClose, pad, card, children }: { onClose: () => void; pad: CSSProperties; card: CSSProperties; children: ReactNode }) {
  return createPortal(
    <div onClick={onClose} style={{
      position:'fixed', inset:0, zIndex:1500, background:'rgba(10,8,12,.72)', display:'flex', alignItems:'center', justifyContent:'center',
      fontFamily:TEXT_FONT, color:C.textMain, textAlign:'left', ...pad,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background:G.sheet, border:`1px solid ${C.stoneDark}`, borderRadius:16, boxShadow:'0 10px 30px rgba(0,0,0,.6)',
        width:'min(340px, 92vw)', maxHeight:'86vh', overflowY:'auto', padding:'16px 16px', boxSizing:'border-box', ...card,
      }}>
        {children}
      </div>
    </div>,
    document.body,
  )
}

/**
 * Карточка, выезжающая снизу. Закрывается крестиком, тапом по фону и свайпом
 * вниз (когда содержимое прокручено к началу).
 */
export function BottomSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const [drag, setDrag] = useState(0)
  const startRef = useRef<number | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  return createPortal(
    <div onClick={onClose} style={{
      position:'fixed', inset:0, zIndex:1500, background:'rgba(10,8,12,.72)', display:'flex', alignItems:'flex-end', justifyContent:'center',
      paddingTop:'calc(8px + var(--rp-safe-top, 0px))', paddingLeft:'var(--rp-safe-left, 0px)', paddingRight:'var(--rp-safe-right, 0px)',
      boxSizing:'border-box', fontFamily:TEXT_FONT, color:C.textMain, textAlign:'left',
    }}>
      <div ref={scrollRef} onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => { startRef.current = (scrollRef.current?.scrollTop ?? 0) <= 0 ? e.touches[0].clientY : null }}
        onTouchMove={(e) => { if (startRef.current !== null) setDrag(Math.max(0, e.touches[0].clientY - startRef.current)) }}
        onTouchEnd={() => { const d = drag; startRef.current = null; setDrag(0); if (d > 90) onClose() }}
        style={{
          position:'relative', width:'100%', maxWidth:GUILD_CONTENT_MAX_W, maxHeight:'100%', overflowY:'auto', boxSizing:'border-box',
          borderRadius:'22px 22px 0 0', background:G.sheet, borderTop:`1px solid ${C.glowMid}`, boxShadow:'0 -10px 30px rgba(0,0,0,.6)',
          padding:'14px 18px calc(22px + var(--rp-safe-bottom, 0px))', display:'flex', flexDirection:'column', gap:14,
          transform: drag > 0 ? `translateY(${drag}px)` : undefined, transition: drag > 0 ? undefined : 'transform .15s',
        }}>
        <div style={{ alignSelf:'center', width:44, height:4, borderRadius:2, background:C.stoneDark, flexShrink:0 }} />
        <button aria-label="Закрыть" onClick={onClose} style={{
          position:'absolute', top:12, right:12, width:44, height:44, borderRadius:22, border:'none', background:'none',
          display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer',
        }}>
          <CrossIcon color={G.textSoft} size={20} />
        </button>
        {children}
      </div>
    </div>,
    document.body,
  )
}

/** Ошибка или сообщение — плашкой сверху текущей вкладки. */
export function Notice({ error, note, onClose }: { error: string | null; note: string | null; onClose: () => void }) {
  if (!error && !note) return null
  const bad = Boolean(error)
  return (
    <div data-guild-error={bad ? '' : undefined} data-guild-note={bad ? undefined : ''} style={{
      display:'flex', alignItems:'center', gap:8, margin:'10px 14px 0', padding:'6px 4px 6px 12px', borderRadius:10,
      border:`1px solid ${bad ? G.redBorder : C.glowEdge}`, background: bad ? G.redBg : G.amberBg,
      color: bad ? G.pink : C.glowCore, fontSize:13, lineHeight:1.4,
    }}>
      <span style={{ flex:1, minWidth:0 }}>{error ?? note}</span>
      <button aria-label="Скрыть" onClick={onClose} style={{ width:36, height:36, border:'none', background:'none', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0 }}>
        <CrossIcon color={bad ? G.pink : C.glowCore} size={14} />
      </button>
    </div>
  )
}

/** Кружок с уровнем персонажа. */
export function LevelCircle({ level, size, ring, online }: { level: number; size: number; ring: string; online?: boolean }) {
  return (
    <div style={{
      position:'relative', width:size, height:size, borderRadius:size / 2, background:C.niche, border:`1.5px solid ${ring}`, boxSizing:'border-box',
      display:'flex', alignItems:'center', justifyContent:'center', fontFamily:FONT_DISPLAY, fontWeight:700,
      fontSize: size >= 40 ? 14 : size >= 36 ? 13 : 11, color:C.textMain, flexShrink:0,
    }}>
      {level}
      {online !== undefined && (
        <span style={{ position:'absolute', right:-1, bottom:-1, width:11, height:11, borderRadius:6, background: online ? G.green : C.stoneDark, border:`2px solid ${C.appBg}` }} />
      )}
    </div>
  )
}

export function JoinModePicker({ value, onChange }: { value: GuildJoinMode; onChange: (m: GuildJoinMode) => void }) {
  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(3, minmax(0, 1fr))', gap:6 }}>
      {(['open', 'request', 'closed'] as const).map((m) => (
        <button key={m} onClick={() => onChange(m)} style={{ ...(value === m ? goldBtn(true) : darkBtn(true)), fontSize:12, padding:'0 4px' }}>
          {GUILD_JOIN_MODE_LABEL[m]}
        </button>
      ))}
    </div>
  )
}

// --- Иконки (svg из макетов) ---

type IconProps = { color: string; size?: number }

export function PeopleIcon({ color, size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" /><circle cx="17" cy="9" r="2.6" /><path d="M17 14c2.8 0 4.5 2 4.5 5" />
    </svg>
  )
}

export function InviteIcon({ color, size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" /><path d="M19 8v6M16 11h6" />
    </svg>
  )
}

export function LockIcon({ color, size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} aria-label="Закрыто" role="img">
      <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  )
}

export function ChevronIcon({ color, size = 18 }: IconProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
}

export function CrossIcon({ color, size = 18 }: IconProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.4} aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
}

export function CheckIcon({ color, size = 18 }: IconProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.4} aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
}

export function UpArrowIcon({ color, size = 18 }: IconProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} aria-hidden="true" style={{ flexShrink:0, marginTop:1 }}><path d="M12 19V5M6 11l6-6 6 6" /></svg>
}

export function SendIcon({ color, size = 18 }: IconProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.4} aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6" /></svg>
}

export function CrownIcon({ color, size = 12 }: IconProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true"><path d="M3 18l2-11 5 5 2-7 2 7 5-5 2 11z" /></svg>
}

export function StarIcon({ color, size = 12 }: IconProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true"><path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z" /></svg>
}

export function NavIcon({ kind, color }: { kind: 'hall' | 'chat' | 'members' | 'storage'; color: string }) {
  const p = { width:22, height:22, viewBox:'0 0 24 24', fill:'none', stroke:color, strokeWidth:1.8, 'aria-hidden':true } as const
  switch (kind) {
    case 'hall': return <svg {...p}><path d="M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6" /></svg>
    case 'chat': return <svg {...p}><path d="M4 5h16v11H9l-5 4z" /></svg>
    case 'members': return <svg {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" /><circle cx="17" cy="9" r="2.6" /><path d="M17 14c2.8 0 4.5 2 4.5 5" /></svg>
    case 'storage': return <svg {...p}><path d="M3 8l9-4 9 4v12H3z" /><path d="M3 8h18M9 12h6" /></svg>
  }
}

/** Красный кружок с числом (новые сообщения, заявки). */
export function CountBadge({ n, style }: { n: number; style?: CSSProperties }) {
  return (
    <span style={{
      position:'absolute', minWidth:16, height:16, padding:'0 4px', boxSizing:'border-box', borderRadius:8, background:C.danger, color:'#fff',
      fontFamily:TEXT_FONT, fontSize:10, fontWeight:600, display:'flex', alignItems:'center', justifyContent:'center', ...style,
    }}>{n > 99 ? '99+' : n}</span>
  )
}
