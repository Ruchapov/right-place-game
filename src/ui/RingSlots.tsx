// Гнёзда колец на «Персонаже» (Мастер, docs/crafter.md, 29.10.2026). Их два, и
// открывают их Длани иного места. Тап по гнезду — список колец из сумки и
// «Снять». Сняли Длани — кольца остаются в гнёздах, но молчат (gearEffectsOf),
// и строка об этом говорит.
//
// Компонент только рисует и зовёт onChange; запрос и ошибки — в App.tsx.
import { useState, type CSSProperties } from 'react'
import { C, FONT_DISPLAY } from './theme'
import { classItemById, type ClassItemId } from '../classItems'
import { RING_IDS, type RingId } from '../crafter'

const ICON = (file: string) => `${import.meta.env.BASE_URL}assets/icons/${file}`

export function RingSlots(props: {
  /** null — сервер не назвал гнёзда: прочерк. */
  slots: (RingId | '')[] | null
  classItems: Record<ClassItemId, number> | null
  glovesOn: boolean
  pending: boolean
  error: string | null
  onChange: (slot: number, ringId: RingId | null) => void
}) {
  const { slots, classItems, glovesOn, pending } = props
  const [open, setOpen] = useState<number | null>(null)
  const header: CSSProperties = { fontSize:10, letterSpacing:1, color:C.textDim, margin:'10px 0 6px', fontFamily:FONT_DISPLAY }
  if (slots === null) {
    return <div style={{ ...header, fontFamily:undefined }}>Кольца: — (сервер не назвал)</div>
  }
  const inBag = RING_IDS.filter((id) => (classItems?.[id] ?? 0) > 0)
  return (
    <div data-rings="">
      <div style={header}>КОЛЬЦА</div>
      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
        {slots.map((ring, i) => {
          const spec = ring === '' ? null : classItemById(ring)
          return (
            <div key={i} data-ring-slot={i}
              onClick={() => setOpen(open === i ? null : i)}
              style={{
                width:46, height:46, boxSizing:'border-box', borderRadius:23,
                background:C.nicheDeep,
                border:`1px solid ${spec && glovesOn ? C.glowEdge : C.stoneDark}`,
                boxShadow: spec && glovesOn ? 'inset 0 0 12px rgba(209,151,68,0.35)' : 'inset 0 2px 5px rgba(0,0,0,0.55)',
                display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer',
                opacity: glovesOn ? 1 : 0.5,
              }}>
              {spec
                ? <img src={ICON(spec.icon)} alt={spec.nameRu} width={34} height={34} style={{ display:'block', objectFit:'contain' }} />
                : <span style={{ fontSize:18, color:C.stoneMid }}>○</span>}
            </div>
          )
        })}
        <div style={{ flex:1, fontSize:10, color:C.textDim, lineHeight:1.4 }}>
          {glovesOn ? 'Тапни гнездо, чтобы надеть или снять кольцо.' : 'Кольца действуют, только пока надеты Длани иного места.'}
        </div>
      </div>
      {open !== null && (
        <div data-ring-picker={open} style={{ marginTop:8, background:C.nicheDeep, border:`1px solid ${C.stoneDark}`, borderRadius:10, padding:8, display:'flex', flexDirection:'column', gap:6 }}>
          {glovesOn && inBag.length === 0 && (
            <div style={{ fontSize:11, color:C.textDim }}>В сумке нет колец. Они падают в вылазках с 30 уровня.</div>
          )}
          {glovesOn && inBag.map((id) => {
            const spec = classItemById(id)
            if (!spec) return null
            return (
              <button key={id} data-ring-put={id} disabled={pending}
                onClick={() => { props.onChange(open, id); setOpen(null) }}
                style={{ display:'flex', alignItems:'center', gap:8, textAlign:'left', background:C.niche, border:`1px solid ${C.stoneDark}`, borderRadius:8, padding:'6px 8px', color:C.textMain, cursor: pending ? 'default' : 'pointer' }}>
                <img src={ICON(spec.icon)} alt="" width={28} height={28} style={{ display:'block', objectFit:'contain', flexShrink:0 }} />
                <span style={{ flex:1, minWidth:0 }}>
                  <span style={{ fontSize:12, display:'block' }}>{spec.nameRu} <span style={{ color:C.textDim }}>×{classItems?.[id] ?? 0}</span></span>
                  <span style={{ fontSize:10, color:C.textDim, display:'block', lineHeight:1.35 }}>{spec.desc}</span>
                </span>
              </button>
            )
          })}
          {slots[open] !== '' && (
            <button data-ring-remove={open} disabled={pending}
              onClick={() => { props.onChange(open, null); setOpen(null) }}
              style={{ background:'transparent', border:`1px solid ${C.stoneDark}`, borderRadius:8, padding:'7px 8px', color:C.bone, fontFamily:FONT_DISPLAY, fontSize:12, cursor: pending ? 'default' : 'pointer' }}>
              Снять кольцо в сумку
            </button>
          )}
        </div>
      )}
      {props.error !== null && <div data-ring-error="" style={{ marginTop:6, fontSize:11, color:C.danger }}>{props.error}</div>}
    </div>
  )
}
