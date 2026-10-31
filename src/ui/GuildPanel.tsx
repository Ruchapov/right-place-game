// Гильдия на вкладке «Сообщество» (30.10.2026, docs/guilds.md).
//
// Не в гильдии — список с поиском, топ, создание, приглашение по ссылке. В
// гильдии — экран из src/ui/guild/ (01.11.2026, новый вид): Зал · Чат · Состав
// · Склад своей панелью внизу (MemberView). Каждая пишущая кнопка зовёт
// guildAction (api.ts): ответ — полное состояние, его кладёт onMe; кошелёк
// игрока App.tsx берёт из него же (onWallet).
//
// Чат опрашивается раз в GUILD_CHAT_POLL_MS, ТОЛЬКО пока экран гильдии на
// экране (вкладка «Сообщество» → «Гильдия»).
import { useEffect, useState, type CSSProperties } from 'react'
import { C, FONT_DISPLAY } from './theme'
import {
  GUILD_CREATE_RP, GUILD_JOIN_MODE_LABEL, GUILD_NAME_MAX, GUILD_PRAYER_CRIT_PCT, GUILD_TAG_MAX,
  guildBuffPctAt, parseGuildJoinMode, parseGuildName, parseGuildTag, type GuildJoinMode,
} from '../guild'
import {
  fetchGuildByInvite, fetchGuildList, fetchGuildMe, guildAction, RequestError,
  type GuildActionResult, type GuildEmblemView, type GuildMe, type GuildSummary, type GuildWallet, type InventoryItem,
} from '../api'
import { fmt, fmtWait, guildErrorText } from './guildText'
import { EmblemPicker, GuildEmblem } from './guild/GuildEmblem'
import { JoinModePicker, Overlay } from './guild/common'
import { MemberView } from './guild/MemberView'
import { PRAYER_ICON } from './guild/hallState'
import { ICON } from './guild/style'

const sectionHeader: CSSProperties = { fontSize:10, letterSpacing:1, color:C.textDim, marginBottom:7, fontFamily:FONT_DISPLAY }
const panel: CSSProperties = { background:C.nicheDeep, border:`1px solid ${C.stoneDark}`, borderRadius:10, padding:'8px 10px', boxShadow:'inset 0 2px 6px rgba(0,0,0,0.45)' }
const input: CSSProperties = { width:'100%', boxSizing:'border-box', minHeight:40, padding:'8px 10px', borderRadius:8, border:`1px solid ${C.stoneDark}`, background:C.outline, color:C.textMain, fontSize:14 }

function btn(primary: boolean, enabled: boolean): CSSProperties {
  return {
    minHeight:44, padding:'8px 12px', borderRadius:8, cursor: enabled ? 'pointer' : 'default',
    border:`1px solid ${primary && enabled ? C.glowEdge : C.stoneDark}`,
    background: primary && enabled ? 'linear-gradient(180deg, #4a3a22, #2e2416)' : C.niche,
    color: enabled ? (primary ? C.glowCore : C.textMain) : C.textDim,
    fontFamily:FONT_DISPLAY, fontSize:12, opacity: enabled ? 1 : 0.6,
  }
}

// --- Иконки активных баффов (для «Персонажа» и подготовки) ---

/** Иконки молитв алтаря с таймером. Ничего не активно — ничего не рисует. */
export function GuildBuffChips({ me, now }: { me: GuildMe | null; now: number }) {
  if (me === null || me.kind !== 'member') return null
  const chips = (['attack', 'armor'] as const).map((k) => {
    const b = me.me.buffs[k]
    const pct = guildBuffPctAt(b.pct, b.untilMs, now)
    return pct > 0 && b.untilMs !== null ? { k, pct, left: b.untilMs - now } : null
  }).filter((c): c is { k: 'attack' | 'armor'; pct: number; left: number } => c !== null)
  if (chips.length === 0) return null
  return (
    <div data-guild-buffs="" style={{ display:'flex', gap:6, flexWrap:'wrap', justifyContent:'center' }}>
      {chips.map((c) => (
        <div key={c.k} title={c.k === 'attack' ? 'Молитва силы' : 'Молитва брони'}
          style={{ display:'flex', alignItems:'center', gap:4, background:C.nicheDeep, border:`1px solid ${c.pct >= GUILD_PRAYER_CRIT_PCT ? C.glowCore : C.stoneDark}`, borderRadius:12, padding:'2px 8px' }}>
          <img src={ICON(PRAYER_ICON[c.k])} alt="" width={18} height={18} />
          <span style={{ fontSize:11, color:C.glowCore }}>+{c.pct}%</span>
          <span style={{ fontSize:10, color:C.textDim }}>{fmtWait(c.left)}</span>
        </div>
      ))}
    </div>
  )
}

// --- Основной компонент ---

export type GuildPanelProps = {
  /** null — офлайн-заглушка без сервера: раздел гильдии недоступен. */
  token: string | null
  me: GuildMe | null
  onMe: (me: GuildMe) => void
  onWallet: (w: GuildWallet) => void
  /** Сумка изменилась снаряжением (склад) — App перечитает инвентарь. */
  onInventoryChanged: () => void
  inventory: InventoryItem[]
  /** Код приглашения из start_param (g_<код>), ещё не обработанный. */
  inviteCode: string | null
  onInviteHandled: () => void
  sideMenu: boolean
  overlayPad: CSSProperties
  overlayCard: CSSProperties
}

export function GuildPanel(props: GuildPanelProps) {
  const { token, me, onMe, onWallet, onInventoryChanged, inviteCode, onInviteHandled } = props
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // Состояние гильдии — при каждом открытии раздела.
  useEffect(() => {
    if (token === null) return
    let alive = true
    fetchGuildMe(token)
      .then((m) => { if (alive) { onMe(m); onWallet(m.wallet); setLoadError(null) } })
      .catch((e) => { if (alive) setLoadError(guildErrorText(e)) })
    return () => { alive = false }
    // onMe/onWallet — сеттеры App, стабильные по смыслу; перечитывать на их смене незачем.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  async function run(path: string, body: Record<string, unknown>, signature: string, after?: (r: GuildActionResult) => void) {
    if (token === null || pending) return
    setPending(true)
    setError(null)
    setNote(null)
    try {
      const r = await guildAction(token, path, body, signature)
      onMe(r.me)
      onWallet(r.me.wallet)
      after?.(r)
    } catch (e) {
      setError(guildErrorText(e))
      // Гонка или отказ по существу — перечитать, чтобы экран не врал.
      if (e instanceof RequestError && !e.retryable) {
        fetchGuildMe(token).then((m) => { onMe(m); onWallet(m.wallet) }).catch(() => {})
      }
    } finally {
      setPending(false)
    }
  }

  if (token === null) {
    return (
      <div style={{ ...panel, margin:'16px 8px', textAlign:'center', color:C.textDim, fontSize:12, lineHeight:1.5 }}>
        Гильдии нужен сервер — открой игру в Telegram.
      </div>
    )
  }

  const common = { pending, run, now, error, note, setNote }

  return (
    <div data-guild-panel="" style={{ padding: me?.kind === 'member' ? 0 : '0 8px' }}>
      {inviteCode !== null && (
        <InviteBanner token={token} code={inviteCode} me={me} pending={pending}
          onJoin={() => run('/guild/join-invite', { code: inviteCode }, `join-invite:${inviteCode}`, () => onInviteHandled())}
          onDismiss={onInviteHandled} />
      )}
      {me === null && (
        <div style={{ ...panel, textAlign:'center', color:C.textDim, fontSize:12 }}>
          {loadError ?? 'Загрузка гильдии…'}
        </div>
      )}
      {me !== null && me.kind === 'none' && <NoGuildView {...common} token={token} me={me} overlayPad={props.overlayPad} overlayCard={props.overlayCard} />}
      {me !== null && me.kind === 'member' && (
        <MemberView token={token} me={me} pending={pending} run={run} now={now} error={error} note={note}
          clearMessages={() => { setError(null); setNote(null) }} setNote={setNote}
          inventory={props.inventory} onInventoryChanged={onInventoryChanged}
          overlayPad={props.overlayPad} overlayCard={props.overlayCard} />
      )}
    </div>
  )
}

type CommonProps = {
  pending: boolean
  run: (path: string, body: Record<string, unknown>, signature: string, after?: (r: GuildActionResult) => void) => Promise<void>
  now: number
  error: string | null
  note: string | null
  setNote: (s: string | null) => void
}

function Messages({ error, note }: { error: string | null; note: string | null }) {
  return (
    <>
      {error && <div data-guild-error="" style={{ color:C.danger, fontSize:12, margin:'6px 0', textAlign:'center' }}>{error}</div>}
      {note && <div data-guild-note="" style={{ color:C.glowCore, fontSize:12, margin:'6px 0', textAlign:'center' }}>{note}</div>}
    </>
  )
}

function InviteBanner({ token, code, me, pending, onJoin, onDismiss }: { token: string; code: string; me: GuildMe | null; pending: boolean; onJoin: () => void; onDismiss: () => void }) {
  const [guild, setGuild] = useState<GuildSummary | null | 'missing'>(null)
  useEffect(() => {
    let alive = true
    fetchGuildByInvite(token, code)
      .then((g) => { if (alive) setGuild(g ?? 'missing') })
      .catch(() => { if (alive) setGuild('missing') })
    return () => { alive = false }
  }, [token, code])
  return (
    <div data-guild-invite="" style={{ ...panel, marginBottom:10, borderColor:C.glowEdge }}>
      <div style={sectionHeader}>ПРИГЛАШЕНИЕ В ГИЛЬДИЮ</div>
      {guild === null && <div style={{ fontSize:12, color:C.textDim }}>Загрузка…</div>}
      {guild === 'missing' && <div style={{ fontSize:12, color:C.textDim }}>Приглашение недействительно.</div>}
      {guild !== null && guild !== 'missing' && (
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <GuildEmblem emblem={guild.emblem} tag={guild.tag} size={40} />
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:13, color:C.textMain }}>[{guild.tag}] {guild.name}</div>
            <div style={{ fontSize:11, color:C.textDim }}>гильдия {guild.level} уровня · {guild.members} из {guild.cap} мест</div>
          </div>
        </div>
      )}
      <div style={{ display:'flex', gap:6, marginTop:8 }}>
        {me?.kind !== 'member' && guild !== null && guild !== 'missing' && (
          <button onClick={onJoin} disabled={pending} style={{ ...btn(true, !pending), flex:1 }}>Вступить</button>
        )}
        {me?.kind === 'member' && <div style={{ fontSize:11, color:C.textDim, flex:1, alignSelf:'center' }}>Уже в гильдии.</div>}
        <button onClick={onDismiss} style={{ ...btn(false, true), flex: guild === 'missing' || me?.kind === 'member' ? 0 : 1 }}>Закрыть</button>
      </div>
    </div>
  )
}

// --- Не в гильдии ---

function NoGuildView(props: CommonProps & { token: string; me: Extract<GuildMe, { kind: 'none' }>; overlayPad: CSSProperties; overlayCard: CSSProperties }) {
  const { token, me, pending, run, now, error, note } = props
  const [query, setQuery] = useState('')
  const [top, setTop] = useState(false)
  const [list, setList] = useState<GuildSummary[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let alive = true
    const t = setTimeout(() => {
      fetchGuildList(token, query.trim(), top)
        .then((g) => { if (alive) { setList(g); setListError(null) } })
        .catch((e) => { if (alive) setListError(guildErrorText(e)) })
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [token, query, top, reload])

  const rejoinLeft = me.rejoinInMs - (now - me.at)
  const canJoin = rejoinLeft <= 0

  return (
    <div>
      <div style={{ textAlign:'center', marginBottom:10 }}>
        <div style={{ fontFamily:FONT_DISPLAY, fontSize:17, color:C.textMain }}>Гильдии</div>
        <div style={{ fontSize:11, color:C.textDim, marginTop:2 }}>Вместе — казна, котёл, библиотека и алтарь</div>
      </div>
      {!canJoin && (
        <div data-guild-rejoin="" style={{ ...panel, textAlign:'center', fontSize:12, color:C.textDim, marginBottom:8 }}>
          Вступить можно через {fmtWait(rejoinLeft)}
        </div>
      )}
      <button onClick={() => setCreating(true)} disabled={pending || !canJoin}
        style={{ ...btn(true, !pending && canJoin && me.wallet.rp >= GUILD_CREATE_RP), width:'100%', marginBottom:4 }}>
        Создать гильдию ({fmt(me.createCostRp || GUILD_CREATE_RP)} RP)
      </button>
      <div style={{ fontSize:11, color:C.textDim, textAlign:'center', marginBottom:10 }}>
        RP: {fmt(me.wallet.rp)}
      </div>
      <Messages error={error} note={note} />

      <div style={{ display:'flex', gap:6, marginBottom:8 }}>
        <button onClick={() => setTop(false)} style={{ ...btn(!top, true), flex:1 }}>Все</button>
        <button onClick={() => setTop(true)} style={{ ...btn(top, true), flex:1 }}>Топ гильдий</button>
      </div>
      {!top && (
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск по названию или тегу" style={{ ...input, marginBottom:8 }} />
      )}
      {listError && <div style={{ color:C.danger, fontSize:12, textAlign:'center' }}>{listError}</div>}
      {list === null && !listError && <div style={{ color:C.textDim, fontSize:12, textAlign:'center' }}>Загрузка…</div>}
      {list !== null && list.length === 0 && <div style={{ color:C.textDim, fontSize:12, textAlign:'center' }}>Гильдий не найдено.</div>}
      {list !== null && list.map((g, i) => {
        const requested = me.myRequests.includes(g.id)
        const full = g.members >= g.cap
        return (
          <div key={g.id} data-guild-row={g.id} style={{ ...panel, display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
            {top && <span style={{ fontFamily:FONT_DISPLAY, fontSize:12, color:C.bone, width:18 }}>{i + 1}</span>}
            <GuildEmblem emblem={g.emblem} tag={g.tag} size={36} />
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, color:C.textMain, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>[{g.tag}] {g.name}</div>
              <div style={{ fontSize:11, color:C.textDim }}>
                гильдия {g.level} уровня · {g.members} из {g.cap} · {GUILD_JOIN_MODE_LABEL[parseGuildJoinMode(g.joinMode) ?? 'closed']}
              </div>
            </div>
            {g.joinMode === 'open' && (
              <button disabled={pending || !canJoin || full} onClick={() => run('/guild/join', { guildId: g.id }, `join:${g.id}`, () => setReload((n) => n + 1))}
                style={btn(true, !pending && canJoin && !full)}>{full ? 'Мест нет' : 'Вступить'}</button>
            )}
            {g.joinMode === 'request' && !requested && (
              <button disabled={pending || !canJoin || full} onClick={() => run('/guild/request', { guildId: g.id }, `request:${g.id}`, () => props.setNote('Заявка подана.'))}
                style={btn(true, !pending && canJoin && !full)}>Заявка</button>
            )}
            {g.joinMode === 'request' && requested && (
              <button disabled={pending} onClick={() => run('/guild/request/cancel', { guildId: g.id }, `request-cancel:${g.id}`)}
                style={btn(false, !pending)}>Отозвать</button>
            )}
            {g.joinMode === 'closed' && <span style={{ fontSize:10, color:C.textDim, textAlign:'right', width:70 }}>по приглашению</span>}
          </div>
        )
      })}

      {creating && (
        <CreateGuildCard pending={pending} rp={me.wallet.rp} overlayPad={props.overlayPad} overlayCard={props.overlayCard}
          onClose={() => setCreating(false)} error={error}
          onCreate={(body) => run('/guild/create', body, `create:${body.name}:${body.tag}`, () => setCreating(false))} />
      )}
    </div>
  )
}

function CreateGuildCard(props: {
  pending: boolean; rp: number; error: string | null; overlayPad: CSSProperties; overlayCard: CSSProperties
  onClose: () => void; onCreate: (body: { name: string; tag: string; joinMode: GuildJoinMode; emblem: GuildEmblemView }) => void
}) {
  const [name, setName] = useState('')
  const [tag, setTag] = useState('')
  const [joinMode, setJoinMode] = useState<GuildJoinMode>('open')
  const [emblem, setEmblem] = useState<GuildEmblemView>({ symbol: 0, frame: 0, bg: 0, color: 0 })
  const validName = parseGuildName(name)
  const validTag = parseGuildTag(tag)
  const can = !props.pending && validName !== null && validTag !== null && props.rp >= GUILD_CREATE_RP
  return (
    <Overlay onClose={props.onClose} pad={props.overlayPad} card={props.overlayCard}>
      <div style={{ fontFamily:FONT_DISPLAY, fontSize:15, color:C.textMain, textAlign:'center', marginBottom:10 }}>Новая гильдия</div>
      <div style={sectionHeader}>НАЗВАНИЕ</div>
      <input value={name} maxLength={GUILD_NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder="3–20 знаков" style={{ ...input, marginBottom:8 }} />
      <div style={sectionHeader}>ТЕГ</div>
      <input value={tag} maxLength={GUILD_TAG_MAX} onChange={(e) => setTag(e.target.value.toUpperCase())} placeholder="2–5 знаков" style={{ ...input, marginBottom:8 }} />
      <div style={sectionHeader}>ВСТУПЛЕНИЕ</div>
      <JoinModePicker value={joinMode} onChange={setJoinMode} />
      <div style={{ ...sectionHeader, marginTop:10 }}>ГЕРБ</div>
      <EmblemPicker value={emblem} onChange={setEmblem} tag={validTag ?? tag} />
      <div style={{ fontSize:11, color:C.textDim, textAlign:'center', marginTop:8 }}>Герб выбирается один раз — потом его поменять нельзя.</div>
      {props.error && <div style={{ color:C.danger, fontSize:12, marginTop:8, textAlign:'center' }}>{props.error}</div>}
      <button disabled={!can} onClick={() => validName && validTag && props.onCreate({ name: validName, tag: validTag, joinMode, emblem })}
        style={{ ...btn(true, can), width:'100%', marginTop:12 }}>
        Основать за {fmt(GUILD_CREATE_RP)} RP
      </button>
      {props.rp < GUILD_CREATE_RP && <div style={{ fontSize:11, color:C.textDim, textAlign:'center', marginTop:4 }}>Не хватает RP: в наличии {fmt(props.rp)}</div>}
    </Overlay>
  )
}
