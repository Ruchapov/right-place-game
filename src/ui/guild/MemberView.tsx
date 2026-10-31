// Экран гильдии для участника (01.11.2026, макеты guild_redesign): вкладки
// Зал · Чат · Состав · Склад своей панелью внизу, плашка сообщений сверху,
// окна казны, приглашения и настроек.
//
// Высота экрана — ровно до низа области прокрутки меню (App.tsx): свою панель
// вкладок он держит внизу, а прокручивается внутри вкладки. Высота пишется в
// стиль узла из замера, без состояния React.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { C, FONT_DISPLAY } from '../theme'
import { guildInviteUrl, parseGuildJoinMode, type GuildBuilding, type GuildJoinMode } from '../../guild'
import type { GuildActionResult, GuildMemberState, InventoryItem } from '../../api'
import { fmt } from '../guildText'
import { CountBadge, JoinModePicker, NavIcon, Notice, Overlay } from './common'
import { HallTab } from './HallTab'
import { BuildingSheet } from './BuildingSheet'
import { MembersTab } from './MembersTab'
import { ChatTab } from './ChatTab'
import { StorageTab } from './StorageTab'
import { useGuildChat } from './useGuildChat'
import { isOnline } from './buildingTexts'
import { G, GUILD_CONTENT_MAX_W, PAGE_BG, TEXT_FONT, capsLabel, darkBtn, goldBtn, textInput } from './style'

type Tab = 'hall' | 'chat' | 'members' | 'storage'
type Run = (path: string, body: Record<string, unknown>, signature: string, after?: (r: GuildActionResult) => void) => Promise<void>

const TABS: [Tab, string][] = [['hall', 'Зал'], ['chat', 'Чат'], ['members', 'Состав'], ['storage', 'Склад']]
/** Ниже этого экран не сжимается — тогда прокручивается меню целиком. */
const MIN_HEIGHT = 280

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY
    if (o === 'auto' || o === 'scroll') return p
  }
  return null
}

export function MemberView(props: {
  token: string; me: GuildMemberState; pending: boolean; run: Run; now: number
  error: string | null; note: string | null; clearMessages: () => void; setNote: (s: string | null) => void
  inventory: InventoryItem[]; onInventoryChanged: () => void
  overlayPad: CSSProperties; overlayCard: CSSProperties
}) {
  const { me, pending, run, now } = props
  const g = me.guild
  const [tab, setTab] = useState<Tab>('hall')
  const [sheet, setSheet] = useState<GuildBuilding | null>(null)
  const [donating, setDonating] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [settings, setSettings] = useState(false)
  const chat = useGuildChat(props.token, tab === 'chat')
  const rootRef = useRef<HTMLDivElement | null>(null)

  // Высота до низа области прокрутки меню; пересчёт на каждый рендер (над
  // экраном может появиться или пропасть плашка приглашения) и на поворот.
  const fit = () => {
    const el = rootRef.current
    if (!el) return
    const scroller = scrollParent(el)
    if (!scroller) { el.style.height = `${Math.max(MIN_HEIGHT, window.innerHeight - el.getBoundingClientRect().top)}px`; return }
    const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
    const avail = scroller.clientHeight - parseFloat(getComputedStyle(scroller).paddingBottom) - top
    el.style.height = `${Math.max(MIN_HEIGHT, Math.floor(avail))}px`
  }
  useLayoutEffect(fit)
  useEffect(() => {
    const el = rootRef.current
    const scroller = el ? scrollParent(el) : null
    const ro = new ResizeObserver(() => fit())
    if (scroller) ro.observe(scroller)
    window.addEventListener('resize', fit)
    return () => { ro.disconnect(); window.removeEventListener('resize', fit) }
  }, [])

  const selectTab = (t: Tab) => {
    setTab(t)
    props.clearMessages()
    if (t === 'chat') chat.markSeen()
  }

  const online = me.members.filter((m) => m.characterId === me.me.characterId || isOnline(m.lastSeenAt, now)).length
  const canReview = me.role === 'leader' || me.role === 'deputy'
  const badge = (t: Tab) => (t === 'chat' ? chat.unread : t === 'members' && canReview ? me.requests.length : 0)

  return (
    <div ref={rootRef} data-guild-member="" style={{
      // Чуть шире колонки меню: заходит в её поля (12 px), но не за край.
      ...PAGE_BG, display:'flex', flexDirection:'column', minHeight:MIN_HEIGHT, borderRadius:14, overflow:'hidden', margin:'0 -12px',
      border:`1px solid ${C.stoneDark}`, fontFamily:TEXT_FONT, color:C.textMain, textAlign:'left',
    }}>
      <div style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column', width:'100%', maxWidth:GUILD_CONTENT_MAX_W, margin:'0 auto' }}>
        <Notice error={props.error} note={props.note} onClose={props.clearMessages} />
        {tab === 'hall' && (
          <HallTab me={me} now={now} onOpenBuilding={(b) => { props.clearMessages(); setSheet(b) }}
            onDonate={() => setDonating(true)} onInvite={() => setInviting(true)} />
        )}
        {tab === 'chat' && <ChatTab chat={chat} members={me.members} online={online} />}
        {tab === 'members' && (
          <MembersTab me={me} pending={pending} run={run} now={now} onSettings={() => setSettings(true)}
            overlayPad={props.overlayPad} overlayCard={props.overlayCard} />
        )}
        {tab === 'storage' && (
          <StorageTab me={me} pending={pending} run={run} inventory={props.inventory} onInventoryChanged={props.onInventoryChanged}
            overlayPad={props.overlayPad} overlayCard={props.overlayCard} />
        )}
      </div>

      <nav data-guild-tabs="" style={{ flexShrink:0, height:64, borderTop:`1px solid ${C.stoneDark}`, background:C.outline }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4, minmax(0, 1fr))', height:'100%', maxWidth:GUILD_CONTENT_MAX_W, margin:'0 auto' }}>
          {TABS.map(([id, label]) => {
            const active = tab === id
            const color = active ? C.glowCore : G.textSoft
            const n = badge(id)
            return (
              <button key={id} onClick={() => selectTab(id)} aria-current={active ? 'page' : undefined} style={{
                position:'relative', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:3,
                background:'none', border:'none', borderTop:`2px solid ${active ? C.glowCore : 'transparent'}`, color,
                fontFamily:FONT_DISPLAY, fontSize:11, fontWeight:700, cursor:'pointer', minWidth:0,
              }}>
                {n > 0 && <CountBadge n={n} style={{ top:8, left:'54%' }} />}
                <NavIcon kind={id} color={color} />{label}
              </button>
            )
          })}
        </div>
      </nav>

      {sheet !== null && (
        <BuildingSheet building={sheet} me={me} now={now} pending={pending} run={run} setNote={props.setNote}
          onClose={() => setSheet(null)}
          onOpenStorage={() => { setSheet(null); selectTab('storage') }} />
      )}
      {donating && (
        <DonateCard me={me} pending={pending} error={props.error} overlayPad={props.overlayPad} overlayCard={props.overlayCard}
          onClose={() => setDonating(false)}
          onDonate={(gold, elite) => run('/guild/donate', { gold, eliteTrophies: elite }, `donate:${gold}:${elite}`, () => setDonating(false))} />
      )}
      {inviting && (
        <InviteCard tag={g.tag} name={g.name} inviteCode={g.inviteCode} overlayPad={props.overlayPad} overlayCard={props.overlayCard}
          onClose={() => setInviting(false)} />
      )}
      {settings && me.role === 'leader' && (
        <SettingsCard me={me} pending={pending} error={props.error} overlayPad={props.overlayPad} overlayCard={props.overlayCard}
          onClose={() => setSettings(false)}
          onSave={(joinMode) => run('/guild/settings', { joinMode }, `settings:${joinMode}`, () => setSettings(false))} />
      )}
    </div>
  )
}

const cardTitle: CSSProperties = { fontFamily:FONT_DISPLAY, fontWeight:700, fontSize:16, textAlign:'center', marginBottom:6 }

function DonateCard({ me, pending, error, overlayPad, overlayCard, onClose, onDonate }: {
  me: GuildMemberState; pending: boolean; error: string | null; overlayPad: CSSProperties; overlayCard: CSSProperties
  onClose: () => void; onDonate: (gold: number, elite: number) => void
}) {
  const [gold, setGold] = useState('')
  const [elite, setElite] = useState('')
  const parse = (s: string) => (s.trim() === '' ? 0 : /^\d+$/.test(s.trim()) ? Number(s.trim()) : NaN)
  const g = parse(gold)
  const e = parse(elite)
  const valid = Number.isInteger(g) && Number.isInteger(e) && g >= 0 && e >= 0 && g + e > 0 && g <= me.wallet.gold && e <= me.wallet.eliteTrophies
  const can = !pending && valid
  const field = (label: string, have: number, value: string, set: (s: string) => void) => (
    <>
      <div style={{ ...capsLabel, marginBottom:6 }}>{label} · в кошельке {fmt(have)}</div>
      <div style={{ display:'flex', gap:8, marginBottom:12 }}>
        <input inputMode="numeric" value={value} onChange={(ev) => set(ev.target.value.replace(/[^\d]/g, ''))} placeholder="0" style={{ ...textInput, flex:1 }} />
        <button onClick={() => set(String(have))} style={darkBtn(true)}>Всё</button>
      </div>
    </>
  )
  return (
    <Overlay onClose={onClose} pad={overlayPad} card={overlayCard}>
      <div style={cardTitle}>Пополнить казну</div>
      <div style={{ fontSize:12, color:G.textSoft, textAlign:'center', marginBottom:12, lineHeight:1.4 }}>Забрать из казны нельзя никому — тратит только глава на здания.</div>
      {field('Золото', me.wallet.gold, gold, setGold)}
      {field('Элитные трофеи', me.wallet.eliteTrophies, elite, setElite)}
      {error && <div style={{ color:G.pink, fontSize:12, textAlign:'center', marginBottom:6 }}>{error}</div>}
      <button disabled={!can} onClick={() => onDonate(g, e)} style={{ ...goldBtn(can), width:'100%' }}>Сдать в казну</button>
    </Overlay>
  )
}

function InviteCard({ tag, name, inviteCode, overlayPad, overlayCard, onClose }: {
  tag: string; name: string; inviteCode: string; overlayPad: CSSProperties; overlayCard: CSSProperties; onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const url = guildInviteUrl(inviteCode)
  const share = () => {
    const text = `Вступай в гильдию [${tag}] ${name} в Right Place!`
    window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`, '_blank')
  }
  return (
    <Overlay onClose={onClose} pad={overlayPad} card={overlayCard}>
      <div style={cardTitle}>Позвать в гильдию</div>
      <div style={{ fontSize:12, color:G.textSoft, textAlign:'center', marginBottom:12, lineHeight:1.4 }}>По этой ссылке можно вступить, даже если гильдия закрыта.</div>
      <button onClick={share} style={{ ...goldBtn(true), width:'100%', marginBottom:12 }}>Отправить в Telegram</button>
      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
        <div style={{ ...textInput, flex:1, minWidth:0, display:'flex', alignItems:'center', fontSize:12, color:G.textSoft, overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>{url}</div>
        <button onClick={() => { void navigator.clipboard?.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000) }} style={darkBtn(true)}>
          {copied ? 'Готово' : 'Копировать'}
        </button>
      </div>
    </Overlay>
  )
}

function SettingsCard({ me, pending, error, overlayPad, overlayCard, onClose, onSave }: {
  me: GuildMemberState; pending: boolean; error: string | null; overlayPad: CSSProperties; overlayCard: CSSProperties
  onClose: () => void; onSave: (joinMode: GuildJoinMode) => void
}) {
  const [joinMode, setJoinMode] = useState<GuildJoinMode>(parseGuildJoinMode(me.guild.joinMode) ?? 'open')
  return (
    <Overlay onClose={onClose} pad={overlayPad} card={overlayCard}>
      <div style={{ ...cardTitle, marginBottom:12 }}>Настройки гильдии</div>
      <div style={{ ...capsLabel, marginBottom:6 }}>Вступление</div>
      <JoinModePicker value={joinMode} onChange={setJoinMode} />
      {error && <div style={{ color:G.pink, fontSize:12, marginTop:8, textAlign:'center' }}>{error}</div>}
      <button disabled={pending} onClick={() => onSave(joinMode)} style={{ ...goldBtn(!pending), width:'100%', marginTop:14 }}>Сохранить</button>
    </Overlay>
  )
}
