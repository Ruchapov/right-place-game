// Вкладка «Склад» (01.11.2026: новый вид, логика прежняя).
import { useState, type CSSProperties } from 'react'
import { C, FONT_DISPLAY } from '../theme'
import { guildBooksFreeInStorage } from '../../guild'
import type { GuildMemberState, InventoryItem } from '../../api'
import { CONSUMABLES, consumableById } from '../../consumables'
import { CLASS_ITEMS, classItemById } from '../../classItems'
import { itemIconSrc } from '../../itemIcons'
import { Overlay } from './common'
import { G, ICON, darkBtn, goldBtn, tabHead, tabSub, tabTitle } from './style'

type Run = (path: string, body: Record<string, unknown>, signature: string, after?: () => void) => Promise<void>

type StorageView = { key: string; kind: string; ref: string; name: string; icon: string | null; count: number }

function storageViewOf(row: GuildMemberState['storage'][number]): StorageView {
  if (row.kind === 'item') {
    return { key: `item:${row.ref}`, kind: row.kind, ref: row.ref, name: row.item?.nameRu ?? 'Предмет', icon: row.item ? itemIconSrc(row.item.slot, row.item.tier, row.ref) : null, count: row.count }
  }
  if (row.kind === 'consumable') {
    const spec = consumableById(row.ref)
    return { key: `c:${row.ref}`, kind: row.kind, ref: row.ref, name: spec?.nameRu ?? row.ref, icon: spec ? ICON(spec.icon) : null, count: row.count }
  }
  const spec = classItemById(row.ref)
  return { key: `${row.kind}:${row.ref}`, kind: row.kind, ref: row.ref, name: spec?.nameRu ?? row.ref, icon: spec ? ICON(spec.icon) : null, count: row.count }
}

const cell: CSSProperties = {
  position:'relative', display:'flex', flexDirection:'column', alignItems:'center', gap:4, padding:'8px 6px', minWidth:0,
  borderRadius:12, border:`1px solid ${C.stoneDark}`, background:`radial-gradient(circle at 50% 35%,${C.niche},${G.card})`,
}

export function StorageTab({ me, pending, run, inventory, onInventoryChanged, overlayPad, overlayCard }: {
  me: GuildMemberState; pending: boolean; run: Run; inventory: InventoryItem[]; onInventoryChanged: () => void
  overlayPad: CSSProperties; overlayCard: CSSProperties
}) {
  const [putting, setPutting] = useState(false)
  const canTake = me.role === 'leader' || me.role === 'deputy'
  const rows = me.storage.map(storageViewOf)
  const booksFree = guildBooksFreeInStorage(me.guild.buildings.library)
  const used = me.guild.storageUsed
  const cap = me.guild.storageCap
  return (
    <div data-guild-storage="" style={{ flex:1, minHeight:0, overflowY:'auto', WebkitOverflowScrolling:'touch' }}>
      <div style={{ ...tabHead, display:'flex', alignItems:'center', gap:10 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={tabTitle}>Склад</div>
          <div style={tabSub}>{used} / {cap} мест{booksFree ? ' · книги не занимают места' : ''}</div>
        </div>
        <button onClick={() => setPutting(true)} style={goldBtn(true)}>Положить</button>
      </div>
      <div style={{ padding:'12px 14px', display:'flex', flexDirection:'column', gap:10 }}>
        <div style={{ height:6, borderRadius:3, background:C.nicheDeep, overflow:'hidden' }}>
          <div style={{ width:`${cap > 0 ? Math.min(100, (used / cap) * 100) : 0}%`, height:6, background:C.glowEdge }} />
        </div>
        {!canTake && <div style={{ fontSize:12, color:G.textSoft }}>Брать со склада могут глава и заместители.</div>}
        {rows.length === 0 && <div style={{ textAlign:'center', color:G.textSoft, fontSize:13, padding:'24px 0' }}>Склад пуст.</div>}
        {rows.length > 0 && (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3, minmax(0, 1fr))', gap:8 }}>
            {rows.map((r) => (
              <div key={r.key} style={cell}>
                <div style={{ position:'relative', width:56, height:56 }}>
                  {r.icon ? <img src={r.icon} alt="" width={56} height={56} style={{ objectFit:'contain' }} /> : null}
                  {r.count > 1 && (
                    <span style={{ position:'absolute', right:-4, bottom:-2, fontSize:11, lineHeight:'14px', color:C.bone, background:'rgba(8,6,10,0.8)', borderRadius:4, padding:'0 4px' }}>×{r.count}</span>
                  )}
                </div>
                <span style={{ fontSize:11, color:C.textMain, textAlign:'center', lineHeight:1.3, maxWidth:'100%', overflow:'hidden', textOverflow:'ellipsis', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical' }}>{r.name}</span>
                {canTake && (
                  <button disabled={pending} onClick={() => run('/guild/storage/take', { kind: r.kind, ref: r.ref, count: 1 }, `take:${r.kind}:${r.ref}:${r.count}`, () => { if (r.kind === 'item') onInventoryChanged() })}
                    style={{ ...darkBtn(!pending), width:'100%', fontSize:12, padding:'0 4px', marginTop:'auto' }}>Взять</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {putting && (
        <PutCard me={me} pending={pending} inventory={inventory} overlayPad={overlayPad} overlayCard={overlayCard}
          onClose={() => setPutting(false)}
          onPut={(body, sig, isItem) => run('/guild/storage/put', body, sig, () => { if (isItem) onInventoryChanged() })} />
      )}
    </div>
  )
}

function PutCard({ me, pending, inventory, overlayPad, overlayCard, onClose, onPut }: {
  me: GuildMemberState; pending: boolean; inventory: InventoryItem[]; overlayPad: CSSProperties; overlayCard: CSSProperties
  onClose: () => void; onPut: (body: Record<string, unknown>, signature: string, isItem: boolean) => void
}) {
  // Только то, что занимает клетку сумки: ненадетое снаряжение, расходники и
  // предметы класса с takesCell. Зелья, страницы и Осколки — нет.
  const consumables = me.wallet.consumables
  const classItems = me.wallet.classItems
  const items = inventory.filter((i) => !i.equipped)
  const stacks = [
    ...CONSUMABLES.filter((c) => c.takesCell && (consumables?.[c.id] ?? 0) > 0).map((c) => ({ kind: 'consumable', ref: c.id, name: c.nameRu, icon: ICON(c.icon), count: consumables?.[c.id] ?? 0 })),
    ...CLASS_ITEMS.filter((c) => c.takesCell && (classItems?.[c.id] ?? 0) > 0).map((c) => ({ kind: 'classItem', ref: c.id, name: c.nameRu, icon: ICON(c.icon), count: classItems?.[c.id] ?? 0 })),
  ]
  const row: CSSProperties = { display:'flex', alignItems:'center', gap:8, padding:'6px 0', borderTop:`1px solid ${C.niche}` }
  return (
    <Overlay onClose={onClose} pad={overlayPad} card={overlayCard}>
      <div style={{ fontFamily:FONT_DISPLAY, fontWeight:700, fontSize:16, textAlign:'center', marginBottom:6 }}>На склад гильдии</div>
      <div style={{ fontSize:12, color:G.textSoft, textAlign:'center', marginBottom:10, lineHeight:1.4 }}>Только то, что занимает место в сумке. Забрать смогут глава и заместители.</div>
      {stacks.length === 0 && items.length === 0 && <div style={{ color:G.textSoft, fontSize:13, textAlign:'center' }}>Класть нечего.</div>}
      {stacks.map((s) => (
        <div key={`${s.kind}:${s.ref}`} style={row}>
          <img src={s.icon} alt="" width={32} height={32} style={{ objectFit:'contain' }} />
          <span style={{ fontSize:13, flex:1, minWidth:0 }}>{s.name} <span style={{ color:G.textSoft }}>×{s.count}</span></span>
          <button disabled={pending} onClick={() => onPut({ kind: s.kind, ref: s.ref, count: 1 }, `put:${s.kind}:${s.ref}:${s.count}`, false)} style={goldBtn(!pending)}>+1</button>
          {s.count > 1 && <button disabled={pending} onClick={() => onPut({ kind: s.kind, ref: s.ref, count: s.count }, `put:${s.kind}:${s.ref}:all:${s.count}`, false)} style={darkBtn(!pending)}>Все</button>}
        </div>
      ))}
      {items.map((i) => {
        const src = itemIconSrc(i.item.slot, i.item.tier, i.item.id)
        return (
          <div key={i.inventoryItemId} style={row}>
            {src ? <img src={src} alt="" width={32} height={32} style={{ objectFit:'contain' }} /> : <div style={{ width:32 }} />}
            <span style={{ fontSize:13, flex:1, minWidth:0 }}>{i.item.nameRu}</span>
            <button disabled={pending} onClick={() => onPut({ kind: 'item', inventoryItemId: i.inventoryItemId }, `put:item:${i.inventoryItemId}`, true)} style={goldBtn(!pending)}>Положить</button>
          </div>
        )
      })}
    </Overlay>
  )
}
