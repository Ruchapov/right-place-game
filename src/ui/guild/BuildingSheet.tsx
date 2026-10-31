// Карточка здания снизу (01.11.2026, mock/Building.html): уровень, «Сейчас»,
// кнопка действия, блок улучшения «казна против цены».
import { C, FONT_DISPLAY } from '../theme'
import { GUILD_BUILDING_MAX, guildUpgradeCost, type GuildBuilding } from '../../guild'
import type { GuildActionResult, GuildMemberState } from '../../api'
import { consumableById } from '../../consumables'
import { BottomSheet, UpArrowIcon } from './common'
import { BUILDING_ICON, BUILDING_NAME, buildingLevelText, fmtLeft } from './buildingTexts'
import { PRAYERS, PRAYER_ICON, PRAYER_LABEL, cauldronAction, libraryAction, prayerState } from './hallState'
import { fmt, fmtWait } from '../guildText'
import { G, GUILD_ART, ICON, capsLabel, darkBtn, goldBtn } from './style'

type Run = (path: string, body: Record<string, unknown>, signature: string, after?: (r: GuildActionResult) => void) => Promise<void>

/** Уровни делениями, если их немного; у Ратуши (25) — сплошной полосой. */
const SEGMENTS_MAX = 15

export function BuildingSheet({ building, me, now, pending, run, setNote, onClose, onDonate, onOpenStorage }: {
  building: GuildBuilding; me: GuildMemberState; now: number; pending: boolean; run: Run
  setNote: (s: string | null) => void; onClose: () => void; onDonate: () => void; onOpenStorage: () => void
}) {
  const g = me.guild
  const lvl = g.buildings[building]
  const max = GUILD_BUILDING_MAX[building]
  const name = BUILDING_NAME[building]
  const open = lvl > 0
  const cost = guildUpgradeCost(building, lvl)
  const isLeader = me.role === 'leader'

  const levelBar = max <= SEGMENTS_MAX ? (
    <div style={{ display:'grid', gridTemplateColumns:`repeat(${max}, minmax(0, 1fr))`, gap:4 }}>
      {Array.from({ length: max }, (_, i) => (
        <div key={i} style={{ height:6, borderRadius:3, background: i < lvl ? C.glowCore : C.niche }} />
      ))}
    </div>
  ) : (
    <div style={{ height:6, borderRadius:3, background:C.niche, overflow:'hidden' }}>
      <div style={{ width:`${(lvl / max) * 100}%`, height:6, background:C.glowCore }} />
    </div>
  )

  const actionBtn = (label: string, enabled: boolean, onClick: () => void) => (
    <button disabled={!enabled} onClick={onClick} style={{ ...goldBtn(enabled, 52), fontSize:16, boxShadow: enabled ? '0 0 16px rgba(245,188,91,.35)' : 'none' }}>{label}</button>
  )
  const treasuryEmptyLine = <div style={{ fontSize:12, color:G.pink, textAlign:'center', marginTop:-6 }}>Казна пуста — сдайте элитный трофей</div>

  let action = null
  if (open && building === 'cauldron') {
    const a = cauldronAction(me, now)
    action = (
      <>
        {actionBtn(a.leftMs > 0 ? `Зачерпнуть через ${fmtLeft(a.leftMs)}` : 'Зачерпнуть', a.ready && !pending, () =>
          run('/guild/cauldron', {}, `cauldron:${Math.floor(me.at / 1000)}`, (r) => {
            if (r.cauldron) setNote(`Зачерпнуто: ${r.cauldron.potions} зел. ${r.cauldron.tier}-го тира${r.cauldron.reflect ? ` и ${r.cauldron.reflect} зелье отражения` : ''}.`)
          }))}
        {a.treasuryBlocked && treasuryEmptyLine}
      </>
    )
  }
  if (open && building === 'library') {
    const a = libraryAction(me, now)
    action = (
      <>
        {actionBtn(a.leftMs > 0 ? `Книга через ${fmtLeft(a.leftMs)}` : 'Взять книгу', a.ready && !pending, () =>
          run('/guild/library', {}, `library:${Math.floor(me.at / 1000)}`, (r) => {
            if (r.libraryBook) setNote(`Взята книга: ${consumableById(r.libraryBook)?.nameRu ?? r.libraryBook}.`)
          }))}
        {a.treasuryBlocked && treasuryEmptyLine}
      </>
    )
  }
  if (open && building === 'altar') {
    action = (
      <div style={{ display:'grid', gridTemplateColumns:'repeat(2, minmax(0, 1fr))', gap:8 }}>
        {PRAYERS.map((p) => {
          const s = prayerState(me, p, now)
          const buff = me.me.buffs[p]
          const can = !pending && !s.active
          return (
            <button key={p} disabled={!can} onClick={() => run('/guild/pray', { prayer: p }, `pray:${p}:${buff.untilMs ?? 0}`, (r) => {
              if (r.prayer) setNote(r.prayer.crit ? `Сильная молитва! +${r.prayer.pct}%` : `${r.prayer.label}: +${r.prayer.pct}% на 2 ч.`)
            })} style={{ ...goldBtn(can, 72), flexDirection:'column', gap:2, padding:'4px 6px', fontSize:13, boxShadow: can ? '0 0 16px rgba(245,188,91,.35)' : 'none' }}>
              <img src={ICON(PRAYER_ICON[p])} alt="" width={28} height={28} />
              {PRAYER_LABEL[p]}
              <span style={{ fontSize:11, fontWeight:600, opacity:.85 }}>{s.active ? `+${s.pct}% · ${fmtWait(s.leftMs)}` : 'помолиться'}</span>
            </button>
          )
        })}
      </div>
    )
  }
  if (building === 'storage') {
    action = actionBtn('Открыть склад', true, onOpenStorage)
  }

  return (
    <BottomSheet onClose={onClose}>
      <div data-guild-building-sheet={building} style={{ display:'flex', alignItems:'center', gap:14, paddingRight:36 }}>
        <div style={{ width:108, height:108, flexShrink:0, borderRadius:16, background:`radial-gradient(circle,${C.stoneDark} 0%,${G.card} 70%)`, display:'flex', alignItems:'center', justifyContent:'center', border:`1px solid ${C.stoneDark}` }}>
          <img src={GUILD_ART(BUILDING_ICON[building])} alt="" width={96} height={96} style={open ? undefined : { filter:'grayscale(1) brightness(.6)' }} />
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:6, flex:1, minWidth:0 }}>
          <div style={{ fontFamily:FONT_DISPLAY, fontWeight:700, fontSize:24 }}>{name}</div>
          <div style={{ fontSize:12, color:C.bone }}>Уровень {lvl} из {max}</div>
          {levelBar}
        </div>
      </div>

      <div style={{ display:'flex', flexDirection:'column', gap:6, padding:12, borderRadius:12, background:C.nicheDeep }}>
        <div style={capsLabel}>{open ? 'Сейчас' : 'Закрыто'}</div>
        <div style={{ fontSize:14, lineHeight:1.45 }}>{buildingLevelText(building, open ? lvl : 1)}</div>
      </div>

      {action}

      {cost === null ? (
        <div style={{ padding:12, borderRadius:12, border:`1px solid ${C.stoneDark}`, textAlign:'center', fontFamily:FONT_DISPLAY, fontWeight:700, fontSize:14, color:C.bone }}>
          Наивысший уровень
        </div>
      ) : (
        <UpgradeBlock building={building} lvl={lvl} cost={cost} me={me} pending={pending} isLeader={isLeader} run={run} onDonate={onDonate} />
      )}
    </BottomSheet>
  )
}

function UpgradeBlock({ building, lvl, cost, me, pending, isLeader, run, onDonate }: {
  building: GuildBuilding; lvl: number; cost: { gold: number; eliteTrophies: number }; me: GuildMemberState
  pending: boolean; isLeader: boolean; run: Run; onDonate: () => void
}) {
  const g = me.guild
  const next = lvl + 1
  const goldShort = Math.max(0, cost.gold - g.gold)
  const eliteShort = Math.max(0, cost.eliteTrophies - g.eliteTrophies)
  const affordable = goldShort === 0 && eliteShort === 0
  const canUpgrade = isLeader && affordable && !pending
  const eliteWord = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'элитного трофея' : 'элитных трофеев')
  const shortLine = goldShort > 0 && eliteShort > 0
    ? `В казне не хватает ${fmt(goldShort)} золота и ${fmt(eliteShort)} ${eliteWord(eliteShort)}.`
    : goldShort > 0 ? `В казне не хватает ${fmt(goldShort)} золота.`
      : eliteShort > 0 ? `В казне не хватает ${fmt(eliteShort)} ${eliteWord(eliteShort)}.` : null

  const costRow = (icon: string, alt: string, have: number, need: number) => (
    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
      <img src={ICON(icon)} alt={alt} width={22} height={22} />
      <div style={{ flex:1, display:'flex', flexDirection:'column', gap:3 }}>
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:12 }}><span>{fmt(have)}</span><span style={{ color:G.textSoft }}>из {fmt(need)}</span></div>
        <div style={{ height:6, borderRadius:3, background:C.nicheDeep, overflow:'hidden' }}>
          <div style={{ width:`${Math.min(100, need > 0 ? (have / need) * 100 : 100)}%`, height:6, background: have >= need ? G.green : C.danger }} />
        </div>
      </div>
    </div>
  )

  return (
    <div data-guild-upgrade="" style={{ display:'flex', flexDirection:'column', gap:10, padding:12, borderRadius:12, border:`1px solid ${C.stoneDark}` }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
        <span style={{ fontFamily:FONT_DISPLAY, fontWeight:700, fontSize:14 }}>{lvl === 0 ? 'Открыть здание' : `Улучшить до ур. ${next}`}</span>
        <span style={{ fontSize:11, color:G.textSoft }}>платит казна</span>
      </div>
      <div style={{ display:'flex', alignItems:'flex-start', gap:8, padding:'8px 10px', borderRadius:10, background:G.amberBg, border:`1px solid ${C.glowEdge}` }}>
        <UpArrowIcon color={C.glowCore} />
        <div style={{ display:'flex', flexDirection:'column', gap:2, minWidth:0 }}>
          <span style={capsLabel}>{BUILDING_NAME[building]} {next} уровня</span>
          <span style={{ fontSize:14, lineHeight:1.45 }}>{buildingLevelText(building, next)}</span>
        </div>
      </div>
      {cost.gold > 0 && costRow('icon_gold.png', 'Золото', g.gold, cost.gold)}
      {cost.eliteTrophies > 0 && costRow('icon_elite_trophy.png', 'Элитные трофеи', g.eliteTrophies, cost.eliteTrophies)}
      {shortLine && <div style={{ fontSize:12, lineHeight:1.4, color:G.pink }}>{shortLine}</div>}
      <div style={{ display:'flex', gap:8 }}>
        <button onClick={onDonate} style={{ ...darkBtn(true), flex:1 }}>Пополнить казну</button>
        {isLeader && (
          <button disabled={!canUpgrade} onClick={() => run('/guild/upgrade', { building }, `upgrade:${building}:${lvl}`)}
            style={{ ...(canUpgrade ? goldBtn(true) : darkBtn(false)), flex:1, fontSize:13 }}>
            {lvl === 0 ? 'Открыть' : 'Улучшить'}
          </button>
        )}
      </div>
      {!isLeader && <div style={{ fontSize:12, color:G.textSoft, textAlign:'center' }}>Улучшать здания может только глава гильдии</div>}
    </div>
  )
}
