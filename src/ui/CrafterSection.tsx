// Мастер у Кузнеца (docs/crafter.md, 29.10.2026): переплавка сырья в Слиток и
// ковка вещей иного места. Отдельной вкладки нет (решение Андрея 26.10.2026) —
// раздел ниже закалок. До CRAFTER_LEVEL виден, но закрыт замком «С 30 уровня».
//
// Компонент только рисует и зовёт колбэки: запросы, ожидание и ошибки живут в
// App.tsx (handleSmelt / handleForge), рядом с остальными покупками.
import { useState, type CSSProperties } from 'react'
import { C, FONT_DISPLAY } from './theme'
import { classItemById, type ClassItemId } from '../classItems'
import {
  CRAFTER_LEVEL, CRAFTER_RAW_IDS, FORGE_GOLD, FORGE_INGOTS, FORGE_RP, FORGE_SOURCE_TIER, OTHER_ITEMS, SMELT_POTION_TIER,
  type CrafterRawId, type OtherItem, type OtherItemId,
} from '../crafter'
import { POTION_TIERS } from '../potions'
import type { InventoryItem } from '../api'

const ICON = (file: string) => `${import.meta.env.BASE_URL}assets/icons/${file}`
const ITEM_ICON = (file: string) => `${import.meta.env.BASE_URL}assets/icons/items/${file}`
const GREEN = '#6FCF7F'

export type CrafterSectionProps = {
  level: number
  /** null — неизвестно (сервер не назвал): прочерки, кнопки гаснут. */
  classItems: Record<ClassItemId, number> | null
  potions: number[] | null
  gold: number | null
  rp: number | null
  inventory: InventoryItem[]
  columns: number
  pending: boolean
  error: string | null
  /** Итог последней переплавки — строкой под блоком. */
  smeltNote: string | null
  onSmelt: (raw: CrafterRawId) => void
  onForge: (itemId: OtherItemId, sourceInventoryItemId: string) => void
  /** Внешний вид оверлея — те же поля безопасных зон, что у остальных карточек. */
  overlayPad: CSSProperties
  overlayCard: CSSProperties
}

const sectionHeader: CSSProperties = { fontSize:10, letterSpacing:1, color:C.textDim, marginBottom:7, fontFamily:FONT_DISPLAY }
const panel: CSSProperties = { background:C.nicheDeep, border:`1px solid ${C.stoneDark}`, borderRadius:10, padding:'8px 10px', boxShadow:'inset 0 2px 6px rgba(0,0,0,0.45)' }

export function CrafterSection(props: CrafterSectionProps) {
  const { level, classItems, potions, gold, rp, inventory, columns, pending, error, smeltNote } = props
  const [selected, setSelected] = useState<OtherItemId | null>(null)
  const unlocked = level >= CRAFTER_LEVEL
  const potionSpec = POTION_TIERS[SMELT_POTION_TIER - 1]
  const blood = potions === null ? null : (potions[SMELT_POTION_TIER - 1] ?? 0)
  const ingots = classItems === null ? null : classItems.other_ingot
  const ingotSpec = classItemById('other_ingot')

  return (
    <div data-crafter="" style={{ padding:'0 8px', margin:'16px 0', textAlign:'left' }}>
      <div style={sectionHeader}>МАСТЕР · ВЕЩИ ИНОГО МЕСТА</div>
      {!unlocked && (
        <div data-crafter-locked="" style={{ ...panel, opacity:0.6, display:'flex', alignItems:'center', gap:10 }}>
          <img src={ITEM_ICON(OTHER_ITEMS[0].icon)} alt="" width={36} height={36} style={{ display:'block', objectFit:'contain', filter:'grayscale(1)' }} />
          <span style={{ fontSize:12, color:C.textDim, flex:1 }}>Мастер берётся за работу с героями посильнее.</span>
          <span style={{ fontFamily:FONT_DISPLAY, fontSize:12, color:C.textDim, whiteSpace:'nowrap' }}>С {CRAFTER_LEVEL} уровня</span>
        </div>
      )}
      {unlocked && (
        <>
          {/* Переплавка: по строке на каждое сырьё. */}
          <div style={{ ...panel, marginBottom:10 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
              <span style={{ fontFamily:FONT_DISPLAY, fontSize:12, color:C.bone, flex:1 }}>Переплавка</span>
              {ingotSpec && <img src={ICON(ingotSpec.icon)} alt="" width={18} height={18} style={{ display:'block', objectFit:'contain' }} />}
              <span data-crafter-ingots="" style={{ fontSize:12, color:C.bone }}>Слитков: {ingots ?? '—'}</span>
            </div>
            {CRAFTER_RAW_IDS.map((raw) => {
              const spec = classItemById(raw)
              const have = classItems === null ? null : classItems[raw]
              const can = !pending && have !== null && have >= 1 && blood !== null && blood >= 1
              return (
                <div key={raw} data-smelt-row={raw} style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 0', borderTop:`1px solid ${C.stoneDark}` }}>
                  {spec && <img src={ICON(spec.icon)} alt={spec.nameRu} width={26} height={26} style={{ display:'block', objectFit:'contain', flexShrink:0 }} />}
                  <span style={{ fontSize:11, color: have !== null && have >= 1 ? C.textMain : C.textDim, minWidth:0, flex:'1 1 auto' }}>
                    {spec?.nameRu ?? raw} <span style={{ color:C.textDim }}>×{have ?? '—'}</span>
                  </span>
                  <span style={{ fontSize:11, color:C.textDim }}>+</span>
                  {potionSpec && <img src={ICON(potionSpec.icon)} alt={potionSpec.nameRu} title={potionSpec.nameRu} width={22} height={22} style={{ display:'block', objectFit:'contain', flexShrink:0 }} />}
                  <span style={{ fontSize:11, color: blood !== null && blood >= 1 ? C.textMain : C.textDim }}>×{blood ?? '—'}</span>
                  <button
                    data-smelt={raw}
                    disabled={!can}
                    onClick={() => props.onSmelt(raw)}
                    style={actionButton(can)}>
                    Переплавить
                  </button>
                </div>
              )
            })}
            <div style={{ fontSize:10, color:C.textDim, marginTop:4, lineHeight:1.4 }}>
              1 сырьё и 1 {potionSpec?.nameRu ?? 'зелье'} дают Слиток иного места. Иногда плавка удаётся, и Слитков выходит два.
            </div>
            {smeltNote !== null && (
              <div data-smelt-note="" style={{ fontSize:12, color:C.glowCore, marginTop:6, fontFamily:FONT_DISPLAY }}>{smeltNote}</div>
            )}
          </div>

          {/* Десять вещей: тап — рецепт. */}
          <div style={{ display:'grid', gridTemplateColumns:`repeat(${columns}, minmax(0, 1fr))`, gap:8 }}>
            {OTHER_ITEMS.map((o) => (
              <div key={o.id} data-forge-cell={o.id}
                onClick={() => setSelected(o.id)}
                style={{
                  boxSizing:'border-box', aspectRatio:'1', background:C.nicheDeep,
                  border:`1px solid ${C.glowEdge}`, borderRadius:10, padding:5,
                  boxShadow:'inset 0 0 10px rgba(209,151,68,0.25), inset 0 2px 6px rgba(0,0,0,0.5)', cursor:'pointer',
                }}>
                <img src={ITEM_ICON(o.icon)} alt={o.nameRu} style={{ width:'100%', height:'100%', objectFit:'contain', display:'block' }} />
              </div>
            ))}
          </div>
        </>
      )}
      {error !== null && (
        <div data-crafter-error="" style={{ marginTop:8, fontSize:11, color:C.danger }}>{error}</div>
      )}

      {selected !== null && (() => {
        const o = OTHER_ITEMS.find((x) => x.id === selected)
        if (!o) return null
        return (
          <RecipeCard
            item={o}
            classItems={classItems}
            gold={gold}
            rp={rp}
            inventory={inventory}
            pending={pending}
            error={error}
            onClose={() => setSelected(null)}
            onForge={(sourceId) => props.onForge(o.id, sourceId)}
            overlayPad={props.overlayPad}
            overlayCard={props.overlayCard}
          />
        )
      })()}
    </div>
  )
}

function actionButton(enabled: boolean): CSSProperties {
  return {
    flexShrink:0, height:34, padding:'0 10px', borderRadius:8,
    fontFamily:FONT_DISPLAY, fontSize:11,
    border:`1px solid ${enabled ? C.glowEdge : C.stoneDark}`,
    background: enabled ? C.glowCore : C.niche,
    color: enabled ? C.appBg : C.textDim,
    cursor: enabled ? 'pointer' : 'default',
  }
}

const SLOT_NAME_GEN: Record<OtherItem['slot'], string> = {
  weapon: 'Оружие', armor: 'Броня', helmet: 'Шлем', gloves: 'Перчатки', boots: 'Сапоги', amulet: 'Амулет',
}

function RecipeCard(props: {
  item: OtherItem
  classItems: Record<ClassItemId, number> | null
  gold: number | null
  rp: number | null
  inventory: InventoryItem[]
  pending: boolean
  error: string | null
  onClose: () => void
  onForge: (sourceInventoryItemId: string) => void
  overlayPad: CSSProperties
  overlayCard: CSSProperties
}) {
  const { item, classItems, gold, rp, inventory } = props
  const ingots = classItems === null ? null : classItems.other_ingot
  // Вещь шестого тира того же слота: годится только та, что лежит в сумке.
  const bagSource = inventory.find((i) => !i.equipped && i.item.slot === item.slot && i.item.tier === FORGE_SOURCE_TIER) ?? null
  const wornSource = inventory.find((i) => i.equipped && i.item.slot === item.slot && i.item.tier === FORGE_SOURCE_TIER) ?? null
  const rows: { key: string; icon: string | null; label: string; need: string; ok: boolean }[] = [
    { key: 'rp', icon: ICON('icon_rp.png'), label: 'RP', need: `${rp ?? '—'} / ${FORGE_RP}`, ok: rp !== null && rp >= FORGE_RP },
    { key: 'ingot', icon: ICON('item_other_ingot.png'), label: 'Слиток иного места', need: `${ingots ?? '—'} / ${FORGE_INGOTS}`, ok: ingots !== null && ingots >= FORGE_INGOTS },
    { key: 'gold', icon: ICON('icon_gold.png'), label: 'Золото', need: `${gold ?? '—'} / ${FORGE_GOLD}`, ok: gold !== null && gold >= FORGE_GOLD },
    {
      key: 'source',
      icon: null,
      label: bagSource ? bagSource.item.nameRu : `${SLOT_NAME_GEN[item.slot]} ${FORGE_SOURCE_TIER} тира в сумке`,
      need: bagSource ? 'есть' : wornSource ? 'надета — сними' : 'нет',
      ok: bagSource !== null,
    },
  ]
  const canForge = !props.pending && rows.every((r) => r.ok) && bagSource !== null
  return (
    <div
      onClick={props.onClose}
      style={{ position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.55)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, ...props.overlayPad }}>
      <div
        data-recipe={item.id}
        onClick={(e) => e.stopPropagation()}
        style={{ ...props.overlayCard, position:'relative', maxWidth:300, width:'100%', background:C.appBg, border:`1px solid ${C.stoneDark}`, borderRadius:14, padding:16, textAlign:'left' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:10 }}>
          <div style={{ width:64, height:64, flexShrink:0, background:C.nicheDeep, borderRadius:8, boxShadow:'inset 0 2px 5px rgba(0,0,0,0.55)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <img src={ITEM_ICON(item.icon)} alt={item.nameRu} style={{ width:56, height:56, objectFit:'contain', display:'block' }} />
          </div>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:15, color:C.textMain }}>{item.nameRu}</div>
            <div style={{ fontSize:11, color:C.textDim, marginTop:2 }}>{SLOT_NAME_GEN[item.slot]} · с {CRAFTER_LEVEL} уровня</div>
          </div>
        </div>
        <div style={{ fontSize:12, lineHeight:1.55, fontStyle:'italic', color:C.textDim, marginBottom:8 }}>{item.desc}</div>
        <div style={{ background:C.nicheDeep, borderRadius:8, padding:'8px 10px', fontSize:12, color:C.bone, textAlign:'center', marginBottom:10 }}>
          {item.baseStat} · {item.effectLine}
        </div>
        <div style={{ fontSize:10, letterSpacing:1, color:C.textDim, marginBottom:5, fontFamily:FONT_DISPLAY }}>РЕЦЕПТ</div>
        <div style={{ display:'flex', flexDirection:'column', gap:4, marginBottom:12 }}>
          {rows.map((r) => (
            <div key={r.key} data-recipe-row={r.key} data-ok={r.ok ? '1' : '0'} style={{ display:'flex', alignItems:'center', gap:8, fontSize:12 }}>
              {r.icon !== null
                ? <img src={r.icon} alt="" width={18} height={18} style={{ display:'block', objectFit:'contain', flexShrink:0 }} />
                : <span style={{ width:18, flexShrink:0 }} />}
              <span style={{ flex:1, minWidth:0, color:C.textMain }}>{r.label}</span>
              <span style={{ color: r.ok ? GREEN : C.danger, whiteSpace:'nowrap' }}>{r.need}</span>
            </div>
          ))}
        </div>
        {props.error !== null && <div style={{ fontSize:11, color:C.danger, marginBottom:8 }}>{props.error}</div>}
        <div style={{ display:'flex', gap:8 }}>
          <button
            data-forge={item.id}
            disabled={!canForge}
            onClick={() => { if (bagSource) props.onForge(bagSource.inventoryItemId) }}
            style={{ ...actionButton(canForge), flex:1, height:42, fontSize:14 }}>
            {props.pending ? '…' : 'Выковать'}
          </button>
          <button onClick={props.onClose} style={{ ...actionButton(false), cursor:'pointer', height:42, color:C.textMain }}>Закрыть</button>
        </div>
      </div>
    </div>
  )
}
