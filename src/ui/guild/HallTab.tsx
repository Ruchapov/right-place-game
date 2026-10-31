// Вкладка «Зал» (01.11.2026, mock/Main.html): баннер с гербом, казна, кнопки,
// благословения, сетка зданий и Ратуша. Тап по зданию — карточка снизу.
import type { CSSProperties, ReactNode } from 'react'
import { C, FONT_DISPLAY } from '../theme'
import { guildMemberCap, guildUpgradeCost, type GuildBuilding } from '../../guild'
import type { GuildMemberState } from '../../api'
import { GuildEmblem } from './GuildEmblem'
import { ChevronIcon, InviteIcon, LockIcon, PeopleIcon } from './common'
import { BUILDING_ICON, BUILDING_NAME, fmtLeft } from './buildingTexts'
import { PRAYERS, PRAYER_ICON, PRAYER_LABEL, cauldronAction, libraryAction, prayerState } from './hallState'
import { fmt } from '../guildText'
import { G, GUILD_ART, HALL_BG, ICON, darkBtn, goldBtn } from './style'

const chip: CSSProperties = {
  display:'flex', alignItems:'center', gap:6, height:30, padding:'0 10px', borderRadius:15,
  background:'rgba(21,18,24,.8)', border:`1px solid ${C.stoneDark}`, fontSize:13, color:C.textMain, whiteSpace:'nowrap',
}

const nowrapPair: CSSProperties = { display:'inline-flex', alignItems:'center', gap:3, whiteSpace:'nowrap' }

/** «1:42» — часы и минуты действующей молитвы. */
function clock(ms: number): string {
  const m = Math.max(0, Math.ceil(ms / 60_000))
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
}

type CardState = { status: ReactNode; ready: boolean }

export function HallTab({ me, now, onOpenBuilding, onDonate, onInvite }: {
  me: GuildMemberState; now: number; onOpenBuilding: (b: GuildBuilding) => void; onDonate: () => void; onInvite: () => void
}) {
  const g = me.guild
  const b = g.buildings
  const green = (t: string) => <span style={{ color:G.greenText }}>{t}</span>
  const soft = (t: string) => <span style={{ color:G.textSoft }}>{t}</span>
  const pinkT = (t: string) => <span style={{ color:G.pink }}>{t}</span>

  const stateOf = (k: GuildBuilding): CardState => {
    if (k === 'cauldron') {
      const a = cauldronAction(me, now)
      return a.ready ? { status: green('Можно зачерпнуть'), ready: true }
        : a.treasuryBlocked && a.leftMs <= 0 ? { status: pinkT('Казна пуста'), ready: false }
          : { status: soft(`Через ${fmtLeft(a.leftMs)}`), ready: false }
    }
    if (k === 'library') {
      const a = libraryAction(me, now)
      return a.ready ? { status: green('Можно взять книгу'), ready: true }
        : a.treasuryBlocked && a.leftMs <= 0 ? { status: pinkT('Казна пуста'), ready: false }
          : { status: soft(`Книга через ${fmtLeft(a.leftMs)}`), ready: false }
    }
    if (k === 'altar') {
      const any = PRAYERS.some((p) => !prayerState(me, p, now).active)
      return any ? { status: green('Можно помолиться'), ready: true } : { status: <span style={{ color:C.glowCore }}>Молитвы активны</span>, ready: false }
    }
    return { status: soft(`${g.storageUsed} / ${g.storageCap} мест`), ready: false }
  }

  const card = (k: GuildBuilding) => {
    const lvl = b[k]
    const label = BUILDING_NAME[k]
    if (lvl === 0) {
      const cost = guildUpgradeCost(k, 0)
      return (
        <button key={k} data-guild-building={k} onClick={() => onOpenBuilding(k)} style={{
          position:'relative', display:'flex', flexDirection:'column', alignItems:'center', gap:4, padding:'10px 8px', minWidth:0, minHeight:44,
          borderRadius:12, border:`1px dashed ${C.stoneDark}`, background:G.sheet, color:C.textMain, fontFamily:'inherit', cursor:'pointer',
        }}>
          <span style={{ position:'absolute', top:8, left:8 }}><LockIcon color={G.textSoft} /></span>
          <img src={GUILD_ART(BUILDING_ICON[k])} alt="" width={72} height={72} style={{ filter:'grayscale(1) brightness(.6)' }} />
          <span style={{ fontFamily:FONT_DISPLAY, fontWeight:700, fontSize:14, color:G.textSoft }}>{label}</span>
          {cost !== null && (
            <span style={{ fontSize:11, color:G.textSoft, display:'flex', alignItems:'center', gap:3, flexWrap:'wrap', justifyContent:'center' }}>
              Открыть:
              {cost.gold > 0 && <span style={nowrapPair}><img src={ICON('icon_gold.png')} alt="" width={13} height={13} />{fmt(cost.gold)}</span>}
              {cost.eliteTrophies > 0 && <span style={nowrapPair}><img src={ICON('icon_elite_trophy.png')} alt="" width={13} height={13} />{fmt(cost.eliteTrophies)}</span>}
            </span>
          )}
        </button>
      )
    }
    const s = stateOf(k)
    return (
      <button key={k} data-guild-building={k} onClick={() => onOpenBuilding(k)} style={{
        position:'relative', display:'flex', flexDirection:'column', alignItems:'center', gap:4, padding:'10px 8px', minWidth:0, minHeight:44,
        borderRadius:12, border:`1px solid ${s.ready ? C.glowMid : C.stoneDark}`,
        background:`radial-gradient(circle at 50% 35%,${C.niche},${G.card})`,
        boxShadow: s.ready ? '0 0 14px rgba(245,188,91,.25)' : 'none', color:C.textMain, fontFamily:'inherit', cursor:'pointer',
      }}>
        {s.ready && <span style={{ position:'absolute', top:8, right:8, width:10, height:10, borderRadius:5, background:C.danger, border:`2px solid ${C.appBg}` }} />}
        <span style={{ position:'absolute', top:8, left:8, fontFamily:FONT_DISPLAY, fontSize:11, color: s.ready ? C.glowCore : C.bone }}>ур. {lvl}</span>
        <img src={GUILD_ART(BUILDING_ICON[k])} alt="" width={72} height={72} />
        <span style={{ fontFamily:FONT_DISPLAY, fontWeight:700, fontSize:14 }}>{label}</span>
        {k === 'storage' && (
          <div style={{ width:'80%', height:6, borderRadius:3, background:C.nicheDeep, overflow:'hidden' }}>
            <div style={{ width:`${g.storageCap > 0 ? Math.min(100, (g.storageUsed / g.storageCap) * 100) : 0}%`, height:6, background:C.glowEdge }} />
          </div>
        )}
        <span style={{ fontSize:11, textAlign:'center' }}>{s.status}</span>
      </button>
    )
  }

  return (
    <div data-guild-hall="" style={{ flex:1, minHeight:0, overflowY:'auto', WebkitOverflowScrolling:'touch' }}>
      {/* Баннер */}
      <div data-guild-head="" style={{ ...HALL_BG, padding:'22px 18px 16px', display:'flex', flexDirection:'column', alignItems:'center', gap:8, borderBottom:`1px solid ${C.stoneDark}` }}>
        <div style={{ position:'relative', width:112, height:112 }}>
          <GuildEmblem emblem={g.emblem} tag={g.tag} size={112} />
          <div style={{
            position:'absolute', left:'50%', bottom:-6, transform:'translateX(-50%)', minWidth:30, height:24, padding:'0 6px', boxSizing:'border-box',
            borderRadius:12, background:C.nicheDeep, border:`1.5px solid ${C.glowMid}`, display:'flex', alignItems:'center', justifyContent:'center',
            fontFamily:FONT_DISPLAY, fontWeight:700, fontSize:13, color:C.glowCore,
          }}>{g.level}</div>
        </div>
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2, marginTop:4, maxWidth:'100%' }}>
          <div style={{ fontFamily:FONT_DISPLAY, fontWeight:700, fontSize:22, letterSpacing:.5, textShadow:'0 2px 6px #000', textAlign:'center', overflowWrap:'anywhere' }}>{g.name}</div>
          <div style={{ fontSize:12, color:C.bone, letterSpacing:2 }}>[{g.tag}] · гильдия {g.level} уровня</div>
        </div>
        <div style={{ display:'flex', gap:8, marginTop:4, flexWrap:'wrap', justifyContent:'center' }}>
          <div style={chip}><PeopleIcon color={C.bone} /><span>{g.members} / {guildMemberCap(g.level)}</span></div>
          <div style={chip}><img src={ICON('icon_gold.png')} alt="Золото в казне" width={18} height={18} /><span>{fmt(g.gold)}</span></div>
          <div style={chip}><img src={ICON('icon_elite_trophy.png')} alt="Элитные трофеи в казне" width={18} height={18} /><span>{fmt(g.eliteTrophies)}</span></div>
        </div>
        <div style={{ display:'flex', gap:8, width:'100%', marginTop:6 }}>
          <button onClick={onDonate} style={{ ...goldBtn(true), flex:1, minWidth:0, whiteSpace:'nowrap', padding:'0 6px' }}>Пополнить казну</button>
          <button onClick={onInvite} style={{ ...darkBtn(true), flex:1, minWidth:0, fontSize:14, whiteSpace:'nowrap', padding:'0 6px' }}><InviteIcon color={C.textMain} />Позвать</button>
        </div>
      </div>

      {/* Благословения */}
      <div data-guild-blessings="" style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 18px', background:'rgba(21,18,24,.7)', borderBottom:`1px solid ${C.niche}`, flexWrap:'wrap' }}>
        <span style={{ fontSize:11, color:G.textSoft, textTransform:'uppercase', letterSpacing:1.5 }}>Благословения</span>
        {PRAYERS.map((p) => {
          const s = prayerState(me, p, now)
          return (
            <div key={p} title={PRAYER_LABEL[p]} style={{ display:'flex', alignItems:'center', gap:4, fontSize:12, color: s.active ? C.glowCore : G.textSoft }}>
              <img src={ICON(PRAYER_ICON[p])} alt={PRAYER_LABEL[p]} width={24} height={24} style={s.active ? undefined : { opacity:.45 }} />
              {s.active ? `+${s.pct}% · ${clock(s.leftMs)}` : 'нет'}
            </div>
          )
        })}
      </div>

      {/* Здания */}
      <div style={{ padding:'14px 14px 16px', display:'flex', flexDirection:'column', gap:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ flex:1, height:1, background:`linear-gradient(90deg,transparent,${C.glowEdge})` }} />
          <div style={{ fontFamily:FONT_DISPLAY, fontWeight:700, fontSize:13, color:C.bone, letterSpacing:2 }}>ЗАЛ ГИЛЬДИИ</div>
          <div style={{ flex:1, height:1, background:`linear-gradient(90deg,${C.glowEdge},transparent)` }} />
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(2, minmax(0, 1fr))', gap:10 }}>
          {(['cauldron', 'library', 'altar', 'storage'] as const).map(card)}
        </div>
        <button data-guild-building="level" onClick={() => onOpenBuilding('level')} style={{
          display:'flex', alignItems:'center', gap:10, padding:'8px 12px', borderRadius:12, border:`1px solid ${C.stoneDark}`,
          background:G.card, color:C.textMain, fontFamily:'inherit', textAlign:'left', cursor:'pointer', minHeight:44,
        }}>
          <img src={GUILD_ART(BUILDING_ICON.level)} alt="" width={52} height={52} />
          <div style={{ flex:1, display:'flex', flexDirection:'column', gap:4, minWidth:0 }}>
            <span style={{ fontFamily:FONT_DISPLAY, fontWeight:700, fontSize:14 }}>{BUILDING_NAME.level} · ур. {b.level}</span>
            <span style={{ fontSize:11, color:G.textSoft }}>Мест в гильдии: {guildMemberCap(b.level)}</span>
          </div>
          <ChevronIcon color={C.bone} />
        </button>
      </div>
    </div>
  )
}
