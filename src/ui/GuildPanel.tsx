// Гильдия на вкладке «Сообщество» (30.10.2026, docs/guilds.md).
//
// Не в гильдии — список с поиском, топ, создание, приглашение по ссылке. В
// гильдии — шапка (герб, тег, уровень, люди, казна) и вкладки: Чат, Участники,
// Склад, Здания, Заявки (глава и заместитель). Каждая пишущая кнопка зовёт
// guildAction (api.ts): ответ — полное состояние, его кладёт onMe; кошелёк
// игрока App.tsx берёт из него же (onWallet).
//
// Чат опрашивается раз в GUILD_CHAT_POLL_MS, ТОЛЬКО пока этот компонент на
// экране (вкладка «Сообщество» → «Гильдия»).
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { C, FONT_DISPLAY } from './theme'
import {
  GUILD_BUILDING_LABEL, GUILD_BUILDING_MAX, GUILD_CHAT_MAX_LEN, GUILD_CHAT_POLL_MS, GUILD_CREATE_RP,
  GUILD_EMBLEM_BG_COUNT, GUILD_EMBLEM_COLORS, GUILD_EMBLEM_FRAME_COUNT, GUILD_EMBLEM_SYMBOL_COUNT,
  GUILD_JOIN_MODE_LABEL, GUILD_NAME_MAX, GUILD_PRAYER_CRIT_PCT, GUILD_PRAYER_PCT, GUILD_ROLE_LABEL, GUILD_TAG_MAX,
  guildBooksFreeInStorage, guildBuffPctAt, guildCauldronYield, guildInviteUrl, guildLibraryCostsElite, guildMemberCap,
  guildPrayerCritChance, guildStorageCapacity, guildUpgradeCost, parseGuildJoinMode, parseGuildName, parseGuildTag,
  type GuildBuilding, type GuildJoinMode, type GuildPrayer, type GuildRole,
} from '../guild'
import {
  fetchGuildByInvite, fetchGuildChat, fetchGuildList, fetchGuildMe, guildAction, sendGuildChat, RequestError,
  type GuildActionResult, type GuildChatMessage, type GuildEmblemView, type GuildMe, type GuildMemberState,
  type GuildSummary, type GuildWallet, type InventoryItem,
} from '../api'
import { CONSUMABLES, consumableById } from '../consumables'
import { fmt, fmtWait, guildErrorText } from './guildText'
import { CLASS_ITEMS, classItemById } from '../classItems'
import { itemIconSrc } from '../itemIcons'

const ICON = (file: string) => `${import.meta.env.BASE_URL}assets/icons/${file}`
const GUILD_ART = (file: string) => `${import.meta.env.BASE_URL}assets/guild/${file}`
const GREEN = '#6FCF7F'

const sectionHeader: CSSProperties = { fontSize:10, letterSpacing:1, color:C.textDim, marginBottom:7, fontFamily:FONT_DISPLAY }
const panel: CSSProperties = { background:C.nicheDeep, border:`1px solid ${C.stoneDark}`, borderRadius:10, padding:'8px 10px', boxShadow:'inset 0 2px 6px rgba(0,0,0,0.45)' }
const input: CSSProperties = { width:'100%', boxSizing:'border-box', minHeight:40, padding:'8px 10px', borderRadius:8, border:`1px solid ${C.stoneDark}`, background:C.outline, color:C.textMain, fontSize:14 }

function btn(primary: boolean, enabled: boolean): CSSProperties {
  return {
    minHeight:40, padding:'8px 12px', borderRadius:8, cursor: enabled ? 'pointer' : 'default',
    border:`1px solid ${primary && enabled ? C.glowEdge : C.stoneDark}`,
    background: primary && enabled ? 'linear-gradient(180deg, #4a3a22, #2e2416)' : C.niche,
    color: enabled ? (primary ? C.glowCore : C.textMain) : C.textDim,
    fontFamily:FONT_DISPLAY, fontSize:12, opacity: enabled ? 1 : 0.6,
  }
}

// --- Герб ---

/**
 * Герб из трёх слоёв: фон (цвет палитры), рамка, символ. Арт будет позже
 * (public/assets/guild/emblem_*.png); пока файла нет — картинка прячется по
 * onError, и остаётся заглушка кодом: круг цвета фона, рамка и буква тега.
 */
export function GuildEmblem({ emblem, tag, size }: { emblem: GuildEmblemView; tag: string; size: number }) {
  const color = GUILD_EMBLEM_COLORS[emblem.color] ?? GUILD_EMBLEM_COLORS[0]
  const frameStyles: CSSProperties[] = [
    { border:`2px solid ${C.bone}` },
    { border:`3px double ${C.glowMid}` },
    { border:`2px dashed ${C.stoneLight}` },
    { border:`3px solid ${C.outline}`, boxShadow:`0 0 0 2px ${C.glowEdge}` },
  ]
  const hide = (e: { currentTarget: HTMLImageElement }) => { e.currentTarget.style.display = 'none' }
  const layer: CSSProperties = { position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'contain' }
  return (
    <div data-guild-emblem="" style={{ position:'relative', width:size, height:size, flexShrink:0 }}>
      <div style={{
        position:'absolute', inset:0, borderRadius: emblem.bg === 0 ? '50%' : '22%', background:color,
        boxSizing:'border-box', display:'flex', alignItems:'center', justifyContent:'center',
        ...frameStyles[emblem.frame % frameStyles.length],
      }}>
        <span style={{ fontFamily:FONT_DISPLAY, fontSize:Math.round(size * 0.42), color:C.textMain, textShadow:'0 1px 2px #000' }}>
          {tag.slice(0, 1)}
        </span>
      </div>
      <img src={GUILD_ART(`emblem_bg_${emblem.bg}.png`)} alt="" onError={hide} style={layer} />
      <img src={GUILD_ART(`emblem_frame_${emblem.frame}.png`)} alt="" onError={hide} style={layer} />
      <img src={GUILD_ART(`emblem_symbol_${emblem.symbol}.png`)} alt="" onError={hide} style={layer} />
    </div>
  )
}

function EmblemPicker({ value, onChange, tag }: { value: GuildEmblemView; onChange: (e: GuildEmblemView) => void; tag: string }) {
  const row = (label: string, count: number, key: keyof GuildEmblemView) => (
    <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:6 }}>
      <span style={{ fontSize:11, color:C.textDim, width:58, flexShrink:0 }}>{label}</span>
      <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
        {Array.from({ length: count }, (_, i) => (
          <button key={i} onClick={() => onChange({ ...value, [key]: i })}
            style={{
              minWidth:32, minHeight:32, borderRadius:6, cursor:'pointer', fontSize:11,
              border:`1px solid ${value[key] === i ? C.glowCore : C.stoneDark}`,
              background: key === 'color' ? GUILD_EMBLEM_COLORS[i] : C.niche, color:C.textMain,
            }}>
            {key === 'color' ? '' : i + 1}
          </button>
        ))}
      </div>
    </div>
  )
  return (
    <div>
      <div style={{ display:'flex', justifyContent:'center', margin:'4px 0' }}>
        <GuildEmblem emblem={value} tag={tag || '?'} size={64} />
      </div>
      {row('Фон', GUILD_EMBLEM_BG_COUNT, 'bg')}
      {row('Цвет', GUILD_EMBLEM_COLORS.length, 'color')}
      {row('Рамка', GUILD_EMBLEM_FRAME_COUNT, 'frame')}
      {row('Символ', GUILD_EMBLEM_SYMBOL_COUNT, 'symbol')}
    </div>
  )
}

function JoinModePicker({ value, onChange }: { value: GuildJoinMode; onChange: (m: GuildJoinMode) => void }) {
  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(3, minmax(0, 1fr))', gap:5 }}>
      {(['open', 'request', 'closed'] as const).map((m) => (
        <button key={m} onClick={() => onChange(m)} style={{ ...btn(value === m, true), padding:'6px 4px', fontSize:11 }}>
          {GUILD_JOIN_MODE_LABEL[m]}
        </button>
      ))}
    </div>
  )
}

/** Оверлей поверх меню — те же поля безопасных зон, что у остальных карточек. */
function Overlay({ onClose, pad, card, children }: { onClose: () => void; pad: CSSProperties; card: CSSProperties; children: ReactNode }) {
  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, zIndex:1500, background:'rgba(0,0,0,0.65)', display:'flex', alignItems:'center', justifyContent:'center', ...pad }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...panel, width:'min(340px, 92vw)', maxHeight:'86vh', overflowY:'auto', padding:'14px 14px', ...card }}>
        {children}
      </div>
    </div>
  )
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
          <span style={{ fontSize:12 }}>{c.k === 'attack' ? '⚔' : '🛡'}</span>
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

type SubTab = 'chat' | 'members' | 'storage' | 'buildings' | 'requests'

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
    <div data-guild-panel="" style={{ padding:'0 8px' }}>
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
        <MemberView {...common} token={token} me={me} inventory={props.inventory} onInventoryChanged={onInventoryChanged}
          sideMenu={props.sideMenu} overlayPad={props.overlayPad} overlayCard={props.overlayCard} />
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
            <div style={{ fontSize:11, color:C.textDim }}>ур. {guild.level} · {guild.members}/{guild.cap}</div>
          </div>
        </div>
      )}
      <div style={{ display:'flex', gap:6, marginTop:8 }}>
        {me?.kind !== 'member' && guild !== null && guild !== 'missing' && (
          <button onClick={onJoin} disabled={pending} style={{ ...btn(true, !pending), flex:1 }}>Вступить</button>
        )}
        {me?.kind === 'member' && <div style={{ fontSize:11, color:C.textDim, flex:1, alignSelf:'center' }}>Ты уже в гильдии.</div>}
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
        У тебя RP: {fmt(me.wallet.rp)}
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
                ур. {g.level} · {g.members}/{g.cap} · {GUILD_JOIN_MODE_LABEL[parseGuildJoinMode(g.joinMode) ?? 'closed']}
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
      {props.error && <div style={{ color:C.danger, fontSize:12, marginTop:8, textAlign:'center' }}>{props.error}</div>}
      <button disabled={!can} onClick={() => validName && validTag && props.onCreate({ name: validName, tag: validTag, joinMode, emblem })}
        style={{ ...btn(true, can), width:'100%', marginTop:12 }}>
        Основать за {fmt(GUILD_CREATE_RP)} RP
      </button>
      {props.rp < GUILD_CREATE_RP && <div style={{ fontSize:11, color:C.textDim, textAlign:'center', marginTop:4 }}>Не хватает RP: у тебя {fmt(props.rp)}</div>}
    </Overlay>
  )
}

// --- В гильдии ---

function MemberView(props: CommonProps & {
  token: string; me: GuildMemberState; inventory: InventoryItem[]; onInventoryChanged: () => void
  sideMenu: boolean; overlayPad: CSSProperties; overlayCard: CSSProperties
}) {
  const { me, pending, run, error, note } = props
  const g = me.guild
  const role = me.role as GuildRole
  const canReview = role === 'leader' || role === 'deputy'
  const [tab, setTab] = useState<SubTab>('chat')
  const [donating, setDonating] = useState(false)
  const [settings, setSettings] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const tabs: [SubTab, string][] = [['chat', 'Чат'], ['members', 'Участники'], ['storage', 'Склад'], ['buildings', 'Здания'], ...(canReview ? [['requests', 'Заявки'] as [SubTab, string]] : [])]
  const inviteUrl = guildInviteUrl(g.inviteCode)

  const shareInvite = () => {
    const text = `Вступай в гильдию [${g.tag}] ${g.name} в Right Place!`
    window.open(`https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}&text=${encodeURIComponent(text)}`, '_blank')
  }

  return (
    <div>
      {/* Шапка */}
      <div data-guild-head="" style={{ ...panel, display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
        <GuildEmblem emblem={g.emblem} tag={g.tag} size={52} />
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontFamily:FONT_DISPLAY, fontSize:15, color:C.textMain, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>[{g.tag}] {g.name}</div>
          <div style={{ fontSize:11, color:C.textDim }}>ур. {g.level} · люди {g.members}/{guildMemberCap(g.level)} · ты — {GUILD_ROLE_LABEL[role].toLowerCase()}</div>
          <div style={{ display:'flex', gap:12, marginTop:4, flexWrap:'wrap' }}>
            <span style={{ display:'flex', alignItems:'center', gap:4, fontSize:12, color:C.bone }}>
              <img src={ICON('icon_gold.png')} alt="Золото" width={14} height={14} />{fmt(g.gold)}
            </span>
            <span style={{ display:'flex', alignItems:'center', gap:4, fontSize:12, color:C.bone }}>
              <img src={ICON('icon_elite_trophy.png')} alt="Элитные трофеи" width={14} height={14} />{fmt(g.eliteTrophies)}
            </span>
          </div>
        </div>
      </div>
      <div style={{ display:'flex', gap:6, marginBottom:8 }}>
        <button onClick={() => setDonating(true)} style={{ ...btn(true, true), flex:1 }}>Сдать в казну</button>
        <button onClick={shareInvite} style={{ ...btn(false, true), flex:1 }}>Позвать в гильдию</button>
      </div>
      <div style={{ display:'flex', gap:6, marginBottom:8, alignItems:'center' }}>
        <div style={{ flex:1, minWidth:0, fontSize:10, color:C.textDim, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{inviteUrl}</div>
        <button onClick={() => { void navigator.clipboard?.writeText(inviteUrl); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000) }}
          style={{ ...btn(false, true), minHeight:32, padding:'4px 8px', fontSize:10 }}>{linkCopied ? 'скопировано' : 'копировать'}</button>
      </div>
      <Messages error={error} note={note} />

      {/* Вкладки */}
      <div style={{ display:'grid', gridTemplateColumns:`repeat(${tabs.length}, minmax(0, 1fr))`, gap:4, marginBottom:8 }}>
        {tabs.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{ ...btn(tab === id, true), padding:'6px 2px', fontSize:11, minHeight:44, position:'relative' }}>
            {label}
            {id === 'requests' && me.requests.length > 0 && (
              <span style={{ position:'absolute', top:2, right:4, fontSize:10, color:C.glowCore }}>{me.requests.length}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'chat' && <ChatTab token={props.token} tag={g.tag} />}
      {tab === 'members' && <MembersTab me={me} pending={pending} run={run} now={props.now} onSettings={() => setSettings(true)} />}
      {tab === 'storage' && <StorageTab me={me} pending={pending} run={run} inventory={props.inventory} onInventoryChanged={props.onInventoryChanged} overlayPad={props.overlayPad} overlayCard={props.overlayCard} />}
      {tab === 'buildings' && <BuildingsTab me={me} pending={pending} run={run} now={props.now} setNote={props.setNote} />}
      {tab === 'requests' && canReview && <RequestsTab me={me} pending={pending} run={run} />}

      {donating && (
        <DonateCard me={me} pending={pending} error={error} overlayPad={props.overlayPad} overlayCard={props.overlayCard}
          onClose={() => setDonating(false)}
          onDonate={(gold, elite) => run('/guild/donate', { gold, eliteTrophies: elite }, `donate:${gold}:${elite}`, () => setDonating(false))} />
      )}
      {settings && role === 'leader' && (
        <SettingsCard me={me} pending={pending} error={error} overlayPad={props.overlayPad} overlayCard={props.overlayCard}
          onClose={() => setSettings(false)}
          onSave={(joinMode, emblem) => run('/guild/settings', { joinMode, emblem }, `settings:${joinMode}:${emblem.bg}${emblem.color}${emblem.frame}${emblem.symbol}`, () => setSettings(false))} />
      )}
    </div>
  )
}

function ChatTab({ token, tag }: { token: string; tag: string }) {
  const [messages, setMessages] = useState<GuildChatMessage[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const lastIdRef = useRef(0)
  const listRef = useRef<HTMLDivElement | null>(null)

  // Опрос раз в GUILD_CHAT_POLL_MS, пока вкладка чата на экране.
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const poll = async () => {
      try {
        const r = await fetchGuildChat(token, lastIdRef.current)
        if (!alive) return
        if (r.messages.length > 0) {
          lastIdRef.current = r.messages[r.messages.length - 1].id
          setMessages((prev) => [...prev, ...r.messages].slice(-200))
        }
        setChatError(null)
      } catch (e) {
        if (alive) setChatError(guildErrorText(e))
      }
      if (alive) timer = setTimeout(poll, GUILD_CHAT_POLL_MS)
    }
    void poll()
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [token])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length])

  const send = async () => {
    const t = text.trim()
    if (t === '' || sending) return
    setSending(true)
    try {
      await sendGuildChat(token, t)
      setText('')
      const r = await fetchGuildChat(token, lastIdRef.current)
      if (r.messages.length > 0) {
        lastIdRef.current = r.messages[r.messages.length - 1].id
        setMessages((prev) => [...prev, ...r.messages].slice(-200))
      }
      setChatError(null)
    } catch (e) {
      setChatError(guildErrorText(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <div data-guild-chat="">
      <div ref={listRef} style={{ ...panel, height:'min(46vh, 320px)', overflowY:'auto', display:'flex', flexDirection:'column', gap:4 }}>
        {messages.length === 0 && <div style={{ color:C.textDim, fontSize:12, textAlign:'center', margin:'auto' }}>Пока тихо.</div>}
        {messages.map((m) => (
          <div key={m.id} style={{ fontSize:12, lineHeight:1.4, color: m.system ? C.textDim : C.textMain, fontStyle: m.system ? 'italic' : 'normal', wordBreak:'break-word' }}>
            {!m.system && <span style={{ color: m.mine ? C.glowCore : C.bone }}>[{tag}] {m.author ?? '?'}: </span>}
            {m.text}
          </div>
        ))}
      </div>
      {chatError && <div style={{ color:C.danger, fontSize:11, marginTop:4 }}>{chatError}</div>}
      <div style={{ display:'flex', gap:6, marginTop:6 }}>
        <input value={text} maxLength={GUILD_CHAT_MAX_LEN} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void send() }}
          placeholder="Сообщение" style={{ ...input, flex:1 }} />
        <button disabled={sending || text.trim() === ''} onClick={() => void send()} style={btn(true, !sending && text.trim() !== '')}>➤</button>
      </div>
    </div>
  )
}

function MembersTab({ me, pending, run, now, onSettings }: { me: GuildMemberState; pending: boolean; run: CommonProps['run']; now: number; onSettings: () => void }) {
  const [confirm, setConfirm] = useState<string | null>(null)
  const role = me.role
  const selfId = me.me.characterId
  const deputies = me.members.filter((m) => m.role === 'deputy').length
  const ask = (key: string, action: () => void) => {
    if (confirm === key) { setConfirm(null); action() } else setConfirm(key)
  }
  return (
    <div data-guild-members="">
      {me.members.map((m) => {
        const isSelf = m.characterId === selfId
        const mRole = (m.role === 'leader' || m.role === 'deputy' ? m.role : 'member') as GuildRole
        const canKick = !isSelf && mRole !== 'leader' && (role === 'leader' || (role === 'deputy' && mRole === 'member'))
        const seenDays = m.lastSeenAt === null ? null : Math.floor((now - m.lastSeenAt) / 86_400_000)
        return (
          <div key={m.characterId} style={{ ...panel, marginBottom:5 }}>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <span style={{ fontSize:13, color: isSelf ? C.glowCore : C.textMain, flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{m.name}</span>
              <span style={{ fontSize:11, color: mRole === 'leader' ? C.glowCore : mRole === 'deputy' ? C.bone : C.textDim }}>{GUILD_ROLE_LABEL[mRole]}</span>
              <span style={{ fontSize:11, color:C.textDim }}>ур. {m.level}</span>
            </div>
            {seenDays !== null && seenDays >= 1 && <div style={{ fontSize:10, color:C.textDim }}>заходил {seenDays} дн. назад</div>}
            {!isSelf && (canKick || role === 'leader') && (
              <div style={{ display:'flex', gap:4, marginTop:5, flexWrap:'wrap' }}>
                {role === 'leader' && mRole === 'member' && deputies < 3 && (
                  <button disabled={pending} onClick={() => run('/guild/deputy', { characterId: m.characterId, deputy: true }, `deputy:${m.characterId}:1`)} style={{ ...btn(false, !pending), fontSize:10, minHeight:32 }}>В заместители</button>
                )}
                {role === 'leader' && mRole === 'deputy' && (
                  <button disabled={pending} onClick={() => run('/guild/deputy', { characterId: m.characterId, deputy: false }, `deputy:${m.characterId}:0`)} style={{ ...btn(false, !pending), fontSize:10, minHeight:32 }}>Снять зама</button>
                )}
                {role === 'leader' && (
                  <button disabled={pending} onClick={() => ask(`lead:${m.characterId}`, () => run('/guild/transfer-leader', { characterId: m.characterId }, `transfer:${m.characterId}`))} style={{ ...btn(false, !pending), fontSize:10, minHeight:32 }}>
                    {confirm === `lead:${m.characterId}` ? 'Точно передать?' : 'Передать главенство'}
                  </button>
                )}
                {canKick && (
                  <button disabled={pending} onClick={() => ask(`kick:${m.characterId}`, () => run('/guild/kick', { characterId: m.characterId }, `kick:${m.characterId}`))} style={{ ...btn(false, !pending), fontSize:10, minHeight:32, color:C.danger }}>
                    {confirm === `kick:${m.characterId}` ? 'Точно исключить?' : 'Исключить'}
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
      <div style={{ display:'flex', gap:6, marginTop:8 }}>
        {role === 'leader' && <button onClick={onSettings} style={{ ...btn(false, true), flex:1 }}>Настройки и герб</button>}
        {role === 'leader' && me.members.length === 1 ? (
          <button disabled={pending} onClick={() => ask('disband', () => run('/guild/disband', {}, 'disband'))} style={{ ...btn(false, !pending), flex:1, color:C.danger }}>
            {confirm === 'disband' ? 'Казна и склад пропадут. Точно?' : 'Распустить'}
          </button>
        ) : role !== 'leader' ? (
          <button disabled={pending} onClick={() => ask('leave', () => run('/guild/leave', {}, 'leave'))} style={{ ...btn(false, !pending), flex:1, color:C.danger }}>
            {confirm === 'leave' ? 'Вступить снова — через 24 ч. Точно?' : 'Выйти из гильдии'}
          </button>
        ) : null}
      </div>
    </div>
  )
}

function RequestsTab({ me, pending, run }: { me: GuildMemberState; pending: boolean; run: CommonProps['run'] }) {
  if (me.requests.length === 0) return <div style={{ ...panel, textAlign:'center', color:C.textDim, fontSize:12 }}>Заявок нет.</div>
  return (
    <div data-guild-requests="">
      {me.requests.map((r) => (
        <div key={r.characterId} style={{ ...panel, display:'flex', alignItems:'center', gap:6, marginBottom:5 }}>
          <span style={{ fontSize:13, color:C.textMain, flex:1, minWidth:0 }}>{r.name}</span>
          <span style={{ fontSize:11, color:C.textDim }}>ур. {r.level}</span>
          <button disabled={pending} onClick={() => run('/guild/requests/decide', { characterId: r.characterId, accept: true }, `decide:${r.characterId}:1`)} style={{ ...btn(true, !pending), color: pending ? C.textDim : GREEN }}>Принять</button>
          <button disabled={pending} onClick={() => run('/guild/requests/decide', { characterId: r.characterId, accept: false }, `decide:${r.characterId}:0`)} style={btn(false, !pending)}>✕</button>
        </div>
      ))}
    </div>
  )
}

// --- Склад ---

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

function StorageTab({ me, pending, run, inventory, onInventoryChanged, overlayPad, overlayCard }: {
  me: GuildMemberState; pending: boolean; run: CommonProps['run']; inventory: InventoryItem[]; onInventoryChanged: () => void
  overlayPad: CSSProperties; overlayCard: CSSProperties
}) {
  const [putting, setPutting] = useState(false)
  const canTake = me.role === 'leader' || me.role === 'deputy'
  const rows = me.storage.map(storageViewOf)
  const booksFree = guildBooksFreeInStorage(me.guild.buildings.library)
  return (
    <div data-guild-storage="">
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
        <span style={{ fontSize:12, color:C.bone, flex:1 }}>Места: {me.guild.storageUsed} / {me.guild.storageCap}{booksFree ? ' · книги даром' : ''}</span>
        <button onClick={() => setPutting(true)} style={btn(true, true)}>Положить</button>
      </div>
      {!canTake && <div style={{ fontSize:11, color:C.textDim, marginBottom:6 }}>Брать со склада могут глава и заместители.</div>}
      {rows.length === 0 && <div style={{ ...panel, textAlign:'center', color:C.textDim, fontSize:12 }}>Склад пуст.</div>}
      {rows.map((r) => (
        <div key={r.key} style={{ ...panel, display:'flex', alignItems:'center', gap:8, marginBottom:5 }}>
          {r.icon ? <img src={r.icon} alt="" width={30} height={30} style={{ objectFit:'contain', flexShrink:0 }} /> : <div style={{ width:30, height:30 }} />}
          <span style={{ fontSize:12, color:C.textMain, flex:1, minWidth:0 }}>{r.name} <span style={{ color:C.textDim }}>×{r.count}</span></span>
          {canTake && (
            <button disabled={pending} onClick={() => run('/guild/storage/take', { kind: r.kind, ref: r.ref, count: 1 }, `take:${r.kind}:${r.ref}:${r.count}`, () => { if (r.kind === 'item') onInventoryChanged() })}
              style={btn(false, !pending)}>Взять</button>
          )}
        </div>
      ))}
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
  return (
    <Overlay onClose={onClose} pad={overlayPad} card={overlayCard}>
      <div style={{ fontFamily:FONT_DISPLAY, fontSize:15, color:C.textMain, textAlign:'center', marginBottom:8 }}>На склад гильдии</div>
      <div style={{ fontSize:11, color:C.textDim, textAlign:'center', marginBottom:8 }}>Только то, что занимает место в сумке. Забрать смогут глава и заместители.</div>
      {stacks.length === 0 && items.length === 0 && <div style={{ color:C.textDim, fontSize:12, textAlign:'center' }}>Класть нечего.</div>}
      {stacks.map((s) => (
        <div key={`${s.kind}:${s.ref}`} style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 0', borderTop:`1px solid ${C.stoneDark}` }}>
          <img src={s.icon} alt="" width={28} height={28} style={{ objectFit:'contain' }} />
          <span style={{ fontSize:12, color:C.textMain, flex:1 }}>{s.name} <span style={{ color:C.textDim }}>×{s.count}</span></span>
          <button disabled={pending} onClick={() => onPut({ kind: s.kind, ref: s.ref, count: 1 }, `put:${s.kind}:${s.ref}:${s.count}`, false)} style={btn(true, !pending)}>+1</button>
          {s.count > 1 && <button disabled={pending} onClick={() => onPut({ kind: s.kind, ref: s.ref, count: s.count }, `put:${s.kind}:${s.ref}:all:${s.count}`, false)} style={btn(false, !pending)}>Все</button>}
        </div>
      ))}
      {items.map((i) => (
        <div key={i.inventoryItemId} style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 0', borderTop:`1px solid ${C.stoneDark}` }}>
          {(() => { const src = itemIconSrc(i.item.slot, i.item.tier, i.item.id); return src ? <img src={src} alt="" width={28} height={28} style={{ objectFit:'contain' }} /> : <div style={{ width:28 }} /> })()}
          <span style={{ fontSize:12, color:C.textMain, flex:1, minWidth:0 }}>{i.item.nameRu}</span>
          <button disabled={pending} onClick={() => onPut({ kind: 'item', inventoryItemId: i.inventoryItemId }, `put:item:${i.inventoryItemId}`, true)} style={btn(true, !pending)}>Положить</button>
        </div>
      ))}
    </Overlay>
  )
}

// --- Здания ---

function BuildingsTab({ me, pending, run, now, setNote }: { me: GuildMemberState; pending: boolean; run: CommonProps['run']; now: number; setNote: (s: string | null) => void }) {
  const g = me.guild
  const b = g.buildings
  const isLeader = me.role === 'leader'
  const elapsed = now - me.at
  const levels: Record<GuildBuilding, number> = { level: b.level, storage: b.storage, cauldron: b.cauldron, library: b.library, altar: b.altar }

  const gives = (k: GuildBuilding, lvl: number): string => {
    switch (k) {
      case 'level': return `Мест в гильдии: ${guildMemberCap(lvl)}.`
      case 'storage': return `Мест на складе: ${guildStorageCapacity(lvl)}.`
      case 'cauldron': {
        const y = guildCauldronYield(lvl)
        if (!y) return 'Раз в 16 ч: зелья твоего тира. Закрыт.'
        return `Раз в 16 ч: ${y.potions} зел. твоего тира${y.reflect ? ` + ${y.reflect} отражения` : ''}${y.costsElite ? ', из казны −1 элитный трофей' : ', бесплатно'}.`
      }
      case 'library':
        if (lvl < 1) return 'Раз в 16 ч: случайная книга навыка. Закрыта.'
        return `Раз в 16 ч: случайная книга навыка${guildLibraryCostsElite(lvl) ? ', из казны −1 элитный трофей' : ', бесплатно'}.${guildBooksFreeInStorage(lvl) ? ' Книги на складе мест не занимают.' : ''}`
      case 'altar':
        if (lvl < 1) return 'Молитвы силы и брони на 2 ч. Закрыт.'
        return `Молитвы на 2 ч: +${GUILD_PRAYER_PCT}% к атаке без силы или к броне; крит +${GUILD_PRAYER_CRIT_PCT}% с шансом ${Math.round(guildPrayerCritChance(lvl) * 100)}%.`
    }
  }

  const cauldronLeft = me.me.cauldronInMs - elapsed
  const libraryLeft = me.me.libraryInMs - elapsed
  const treasuryEmpty = g.eliteTrophies < 1

  return (
    <div data-guild-buildings="">
      {(['level', 'storage', 'cauldron', 'library', 'altar'] as const).map((k) => {
        const lvl = levels[k]
        const cost = guildUpgradeCost(k, lvl)
        const affordable = cost !== null && g.gold >= cost.gold && g.eliteTrophies >= cost.eliteTrophies
        const canUpgrade = isLeader && affordable && !pending
        return (
          <div key={k} data-guild-building={k} style={{ ...panel, marginBottom:6 }}>
            <div style={{ display:'flex', alignItems:'baseline', gap:6 }}>
              <span style={{ fontFamily:FONT_DISPLAY, fontSize:13, color:C.textMain, flex:1 }}>{GUILD_BUILDING_LABEL[k]}</span>
              <span style={{ fontSize:11, color: lvl > 0 ? C.glowCore : C.textDim }}>{lvl > 0 ? `ур. ${lvl} / ${GUILD_BUILDING_MAX[k]}` : 'закрыто'}</span>
            </div>
            <div style={{ fontSize:11, color:C.textDim, margin:'3px 0 6px', lineHeight:1.4 }}>{gives(k, lvl)}</div>
            {cost !== null && (
              <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                <span style={{ fontSize:11, color: affordable ? C.bone : C.textDim, flex:1, display:'flex', alignItems:'center', gap:4 }}>
                  <img src={ICON('icon_gold.png')} alt="" width={12} height={12} />{fmt(cost.gold)}
                  <img src={ICON('icon_elite_trophy.png')} alt="" width={12} height={12} style={{ marginLeft:4 }} />{fmt(cost.eliteTrophies)}
                </span>
                <button disabled={!canUpgrade} onClick={() => run('/guild/upgrade', { building: k }, `upgrade:${k}:${lvl}`)} style={btn(true, canUpgrade)}>
                  {lvl === 0 ? 'Открыть' : 'Улучшить'}
                </button>
              </div>
            )}
            {cost === null && <div style={{ fontSize:11, color:C.textDim }}>Наивысший уровень.</div>}
            {!isLeader && cost !== null && <div style={{ fontSize:10, color:C.textDim, marginTop:3 }}>Улучшает только глава.</div>}

            {k === 'cauldron' && lvl > 0 && (() => {
              const y = guildCauldronYield(lvl)
              const needsElite = y?.costsElite ?? true
              const blocked = needsElite && treasuryEmpty
              const can = !pending && cauldronLeft <= 0 && !blocked
              return (
                <div style={{ marginTop:6, borderTop:`1px solid ${C.stoneDark}`, paddingTop:6 }}>
                  <button disabled={!can} style={{ ...btn(true, can), width:'100%' }}
                    onClick={() => run('/guild/cauldron', {}, `cauldron:${Math.floor(me.at / 1000)}`, (r) => {
                      if (r.cauldron) setNote(`Зачерпнул: ${r.cauldron.potions} зел. ${r.cauldron.tier}-го тира${r.cauldron.reflect ? ` и ${r.cauldron.reflect} зелье отражения` : ''}.`)
                    })}>
                    {cauldronLeft > 0 ? `Зачерпнуть через ${fmtWait(cauldronLeft)}` : 'Зачерпнуть'}
                  </button>
                  {blocked && <div style={{ fontSize:11, color:C.danger, marginTop:3, textAlign:'center' }}>Казна пуста — сдайте элитный трофей</div>}
                </div>
              )
            })()}
            {k === 'library' && lvl > 0 && (() => {
              const blocked = guildLibraryCostsElite(lvl) && treasuryEmpty
              const can = !pending && libraryLeft <= 0 && !blocked
              return (
                <div style={{ marginTop:6, borderTop:`1px solid ${C.stoneDark}`, paddingTop:6 }}>
                  <button disabled={!can} style={{ ...btn(true, can), width:'100%' }}
                    onClick={() => run('/guild/library', {}, `library:${Math.floor(me.at / 1000)}`, (r) => {
                      if (r.libraryBook) setNote(`Взял книгу: ${consumableById(r.libraryBook)?.nameRu ?? r.libraryBook}.`)
                    })}>
                    {libraryLeft > 0 ? `Взять книгу через ${fmtWait(libraryLeft)}` : 'Взять книгу'}
                  </button>
                  {blocked && <div style={{ fontSize:11, color:C.danger, marginTop:3, textAlign:'center' }}>Казна пуста — сдайте элитный трофей</div>}
                </div>
              )
            })()}
            {k === 'altar' && lvl > 0 && (
              <div style={{ marginTop:6, borderTop:`1px solid ${C.stoneDark}`, paddingTop:6, display:'grid', gridTemplateColumns:'repeat(2, minmax(0, 1fr))', gap:5 }}>
                {(['attack', 'armor'] as GuildPrayer[]).map((p) => {
                  const buff = me.me.buffs[p]
                  const left = buff.untilMs === null ? 0 : buff.untilMs - now
                  const active = guildBuffPctAt(buff.pct, buff.untilMs, now) > 0
                  const can = !pending && !active
                  return (
                    <button key={p} disabled={!can} style={{ ...btn(true, can), fontSize:11 }}
                      onClick={() => run('/guild/pray', { prayer: p }, `pray:${p}:${buff.untilMs ?? 0}`, (r) => {
                        if (r.prayer) setNote(r.prayer.crit ? `Критическая молитва! +${r.prayer.pct}%` : `${r.prayer.label}: +${r.prayer.pct}% на 2 ч.`)
                      })}>
                      {p === 'attack' ? 'Молитва силы' : 'Молитва брони'}
                      <div style={{ fontSize:10, color:C.textDim, fontFamily:'inherit' }}>
                        {active ? `+${buff.pct}% · ${fmtWait(left)}` : 'помолиться'}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

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
  return (
    <Overlay onClose={onClose} pad={overlayPad} card={overlayCard}>
      <div style={{ fontFamily:FONT_DISPLAY, fontSize:15, color:C.textMain, textAlign:'center', marginBottom:6 }}>В казну гильдии</div>
      <div style={{ fontSize:11, color:C.textDim, textAlign:'center', marginBottom:10 }}>Забрать из казны нельзя никому — тратит только глава на улучшения.</div>
      <div style={sectionHeader}>ЗОЛОТО · у тебя {fmt(me.wallet.gold)}</div>
      <div style={{ display:'flex', gap:6, marginBottom:8 }}>
        <input inputMode="numeric" value={gold} onChange={(ev) => setGold(ev.target.value.replace(/[^\d]/g, ''))} placeholder="0" style={{ ...input, flex:1 }} />
        <button onClick={() => setGold(String(me.wallet.gold))} style={btn(false, true)}>Всё</button>
      </div>
      <div style={sectionHeader}>ЭЛИТНЫЕ ТРОФЕИ · у тебя {fmt(me.wallet.eliteTrophies)}</div>
      <div style={{ display:'flex', gap:6, marginBottom:8 }}>
        <input inputMode="numeric" value={elite} onChange={(ev) => setElite(ev.target.value.replace(/[^\d]/g, ''))} placeholder="0" style={{ ...input, flex:1 }} />
        <button onClick={() => setElite(String(me.wallet.eliteTrophies))} style={btn(false, true)}>Всё</button>
      </div>
      {error && <div style={{ color:C.danger, fontSize:12, textAlign:'center' }}>{error}</div>}
      <button disabled={!can} onClick={() => onDonate(g, e)} style={{ ...btn(true, can), width:'100%', marginTop:6 }}>Сдать</button>
    </Overlay>
  )
}

function SettingsCard({ me, pending, error, overlayPad, overlayCard, onClose, onSave }: {
  me: GuildMemberState; pending: boolean; error: string | null; overlayPad: CSSProperties; overlayCard: CSSProperties
  onClose: () => void; onSave: (joinMode: GuildJoinMode, emblem: GuildEmblemView) => void
}) {
  const [joinMode, setJoinMode] = useState<GuildJoinMode>(parseGuildJoinMode(me.guild.joinMode) ?? 'open')
  const [emblem, setEmblem] = useState<GuildEmblemView>(me.guild.emblem)
  return (
    <Overlay onClose={onClose} pad={overlayPad} card={overlayCard}>
      <div style={{ fontFamily:FONT_DISPLAY, fontSize:15, color:C.textMain, textAlign:'center', marginBottom:10 }}>Настройки гильдии</div>
      <div style={sectionHeader}>ВСТУПЛЕНИЕ</div>
      <JoinModePicker value={joinMode} onChange={setJoinMode} />
      <div style={{ ...sectionHeader, marginTop:10 }}>ГЕРБ</div>
      <EmblemPicker value={emblem} onChange={setEmblem} tag={me.guild.tag} />
      {error && <div style={{ color:C.danger, fontSize:12, marginTop:8, textAlign:'center' }}>{error}</div>}
      <button disabled={pending} onClick={() => onSave(joinMode, emblem)} style={{ ...btn(true, !pending), width:'100%', marginTop:12 }}>Сохранить</button>
    </Overlay>
  )
}
