// «Сообщество → Рейтинг» (17.11.2026): пять досок — Уровни, Новички, Гильдии,
// Охотники, Гроза боссов. Данные — GET /leaderboard (server/src/routes/leaderboard.ts),
// грузятся при открытии вкладки и при смене доски.
//
// Вид: ряд чипов досок (листается вбок), название и подпись, пьедестал на
// троих (1-е в центре и выше), список мест 4–50, своё место закреплено внизу
// (sticky — видно при прокрутке; в вертикали — над нижней панелью меню).
// Вне Telegram (token null) — пример рейтинга с пометкой: так вёрстку видно в
// браузере без сервера.
import { useEffect, useState, type CSSProperties } from 'react'
import { C, FONT_DISPLAY } from './theme'
import { TEXT_FONT, darkBtn } from './guild/style'
import { GuildEmblem } from './guild/GuildEmblem'
import { LEADERBOARD_BOARDS, fetchLeaderboard, type LeaderboardBoard, type LeaderboardRow, type LeaderboardView } from '../api'

const BOARDS: Record<LeaderboardBoard, { title: string; sub: string }> = {
  level: { title: 'Уровни', sub: 'Кто забрался выше всех' },
  newbies: { title: 'Новички', sub: 'Лучшие из пришедших за две недели' },
  guilds: { title: 'Гильдии', sub: 'Самые крепкие гильдии Убежища' },
  hunters: { title: 'Охотники', sub: 'Больше всех поверженных врагов' },
  bosses: { title: 'Гроза боссов', sub: 'Кто чаще всех валил боссов' },
}

const MEDAL = {
  1: { fill: '#E8B23A', dark: '#8A5F14', step: 66 },
  2: { fill: '#C9CED6', dark: '#6C727C', step: 46 },
  3: { fill: '#C0653A', dark: '#6E3317', step: 32 },
} as const

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

function formatNum(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, String.fromCharCode(0xa0))
}

function valueLabel(board: LeaderboardBoard, v: number): string {
  if (board === 'hunters') return `${formatNum(v)} ${plural(v, 'враг', 'врага', 'врагов')}`
  if (board === 'bosses') return `${formatNum(v)} ${plural(v, 'босс', 'босса', 'боссов')}`
  return `${formatNum(v)} ур.`
}

function membersLabel(n: number): string {
  return `${n} ${plural(n, 'участник', 'участника', 'участников')}`
}

// TEMP: пример рейтинга вне Telegram (офлайн-заглушка). Убрать вместе с заглушкой.
const TEMP_DEV_NAMES = ['Морвен', 'Ярослав', 'Кхарн', 'Ильва', 'Тень-с-Болот', 'Велимир', 'Астрид', 'Горан', 'Сварт', 'Лиора']
function devView(board: LeaderboardBoard): LeaderboardView {
  const guild = board === 'guilds'
  const rows: LeaderboardRow[] = Array.from({ length: 14 }, (_, i) => ({
    place: i + 1,
    name: guild ? ['Стражи Пепла', 'Костяной Венец', 'Ночной Дозор', 'Сыны Колокола'][i % 4] : TEMP_DEV_NAMES[i % TEMP_DEV_NAMES.length],
    title: !guild && i % 4 === 1 ? 'Жнец' : null,
    guildTag: guild || i % 3 !== 2 ? ['ПЕП', 'КВН', 'НД', 'СК'][i % 4] : null,
    emblem: guild || i % 3 !== 2 ? { symbol: i % 6, frame: i % 3, bg: i % 4, color: i % 5 } : null,
    value: board === 'hunters' ? 2400 - i * 151 : board === 'bosses' ? 41 - i * 3 : guild ? 9 - Math.floor(i / 2) : 48 - i * 2,
    isMe: i === 6,
    members: guild ? 24 - i : null,
  }))
  return { board, rows, me: board === 'newbies' ? null : { place: 7, value: rows[6].value } }
}

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; view: LeaderboardView }
  | { kind: 'error' }

const CSS = `
.rp-lb-chips { scrollbar-width: none; }
.rp-lb-chips::-webkit-scrollbar { display: none; }
@keyframes rp-lb-in { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
.rp-lb-in { animation: rp-lb-in .28s ease-out both; }
@media (prefers-reduced-motion: reduce) { .rp-lb-in { animation: none; } }
`

function Medal({ place, size }: { place: 1 | 2 | 3; size: number }) {
  const m = MEDAL[place]
  return (
    <div aria-label={`${place} место`} style={{
      width: size, height: size, borderRadius: '50%', flex: 'none',
      background: `radial-gradient(circle at 35% 30%, #fff8 0%, ${m.fill} 35%, ${m.dark} 100%)`,
      border: `2px solid ${m.dark}`, boxShadow: `0 0 12px ${m.fill}55, 0 2px 4px #000a`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: size * 0.48, color: '#2a1d0c', textShadow: `0 1px 0 ${m.fill}`,
    }}>{place}</div>
  )
}

function TagLine({ tag }: { tag: string | null }) {
  if (tag === null) return null
  return <span style={{ fontSize: 10.5, color: C.textDim, letterSpacing: 0.5, whiteSpace: 'nowrap' }}>[{tag}]</span>
}

function PodiumSlot({ row, place, board }: { row: LeaderboardRow | undefined; place: 1 | 2 | 3; board: LeaderboardBoard }) {
  const guild = board === 'guilds'
  const m = MEDAL[place]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0, gap: 4 }}>
      <Medal place={place} size={place === 1 ? 40 : 32} />
      {row && guild && row.emblem && <GuildEmblem emblem={row.emblem} tag={row.guildTag ?? ''} size={place === 1 ? 46 : 38} />}
      <div style={{
        maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        fontSize: place === 1 ? 14 : 13, fontWeight: 600, color: row?.isMe ? C.glowCore : C.textMain,
      }}>{row ? row.name : '—'}</div>
      {row && !guild && row.title !== null && <TitleLine title={row.title} />}
      {row && <TagLine tag={row.guildTag} />}
      {row && <div style={{ fontFamily: FONT_DISPLAY, fontSize: place === 1 ? 15 : 13, color: m.fill, whiteSpace: 'nowrap' }}>{valueLabel(board, row.value)}</div>}
      {row && guild && row.members !== null && <div style={{ fontSize: 10.5, color: C.textDim }}>{membersLabel(row.members)}</div>}
      <div style={{
        width: '100%', height: m.step, marginTop: 2, borderRadius: '6px 6px 0 0',
        background: `linear-gradient(180deg, ${C.niche}, ${C.nicheDeep})`,
        border: `1px solid ${C.stoneDark}`, borderTop: `2px solid ${m.fill}`, borderBottom: 'none',
        boxShadow: `inset 0 8px 14px -10px ${m.fill}`,
        display: 'flex', justifyContent: 'center', paddingTop: 6, boxSizing: 'border-box',
        fontFamily: FONT_DISPLAY, fontSize: 18, color: `${m.fill}88`,
      }}>{place === 1 ? 'I' : place === 2 ? 'II' : 'III'}</div>
    </div>
  )
}

/** Титул героя (20.11.2026, достижения) — курсивом под именем. */
function TitleLine({ title }: { title: string }) {
  return <span style={{ fontSize: 10.5, fontStyle: 'italic', color: C.bone, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{title}</span>
}

function ListRow({ row, board }: { row: LeaderboardRow; board: LeaderboardBoard }) {
  const guild = board === 'guilds'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', minHeight: 44, boxSizing: 'border-box',
      borderRadius: 8,
      border: `1px solid ${row.isMe ? C.glowEdge : 'transparent'}`,
      background: row.isMe ? 'linear-gradient(180deg, #4a3a22, #2e2416)' : 'transparent',
    }}>
      <div style={{ width: 26, flex: 'none', textAlign: 'right', fontFamily: FONT_DISPLAY, fontSize: 13, color: row.isMe ? C.glowCore : C.textDim }}>{row.place}</div>
      {guild && row.emblem && <GuildEmblem emblem={row.emblem} tag={row.guildTag ?? ''} size={30} />}
      <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13.5, color: row.isMe ? C.glowCore : C.textMain }}>{row.name}</span>
          {!guild && <TagLine tag={row.guildTag} />}
        </div>
        {!guild && row.title !== null && <TitleLine title={row.title} />}
        {/* У гильдии тег — во второй строке, рядом с участниками: так название не режется. */}
        {guild && row.members !== null && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
            <TagLine tag={row.guildTag} />
            <span style={{ fontSize: 10.5, color: C.textDim }}>{membersLabel(row.members)}</span>
          </div>
        )}
      </div>
      <div style={{ flex: 'none', fontFamily: FONT_DISPLAY, fontSize: 13, color: row.isMe ? C.glowCore : C.bone, whiteSpace: 'nowrap' }}>{valueLabel(board, row.value)}</div>
    </div>
  )
}

function meLine(board: LeaderboardBoard, me: LeaderboardView['me']): string {
  if (me !== null) {
    return board === 'guilds'
      ? `Твоя гильдия — ${formatNum(me.place)} место · ${valueLabel(board, me.value)}`
      : `Твоё место — ${formatNum(me.place)} · ${valueLabel(board, me.value)}`
  }
  if (board === 'guilds') return 'Ты не в гильдии'
  if (board === 'newbies') return 'Эта доска — для тех, кто пришёл за последние две недели'
  return 'Ты пока не в рейтинге — вперёд, на вылазку!'
}

export function LeaderboardPanel(props: { token: string | null; sideMenu: boolean }) {
  const { token, sideMenu } = props
  const [board, setBoard] = useState<LeaderboardBoard>('level')
  const [attempt, setAttempt] = useState(0)
  // Ответ помнит, на какой запрос он (доска + попытка): чужой или старый —
  // значит, идёт загрузка. Так «Считаем…» не нужно ставить в эффекте.
  const [result, setResult] = useState<{ key: string; state: State } | null>(null)
  const key = `${board}:${attempt}`

  useEffect(() => {
    if (token === null) return
    let alive = true
    fetchLeaderboard(token, board).then(
      (view) => { if (alive) setResult({ key, state: { kind: 'ok', view } }) },
      (e) => {
        console.error('LeaderboardPanel: рейтинг не загрузился', e)
        if (alive) setResult({ key, state: { kind: 'error' } })
      },
    )
    return () => { alive = false }
  }, [token, board, key])

  const state: State = token === null
    ? { kind: 'ok', view: devView(board) }
    : result !== null && result.key === key ? result.state : { kind: 'loading' }

  const info = BOARDS[board]
  const view = state.kind === 'ok' ? state.view : null
  const top3 = view?.rows.slice(0, 3) ?? []
  const rest = view?.rows.slice(3) ?? []

  const chip = (id: LeaderboardBoard): CSSProperties => ({
    flex: 'none', minHeight: 44, padding: '0 14px', borderRadius: 8, cursor: 'pointer',
    fontFamily: FONT_DISPLAY, fontSize: 13, whiteSpace: 'nowrap',
    border: `1px solid ${board === id ? C.glowEdge : C.stoneDark}`,
    background: board === id ? 'linear-gradient(180deg, #4a3a22, #2e2416)' : C.niche,
    color: board === id ? C.glowCore : C.textMain,
  })

  return (
    <div data-leaderboard="" style={{
      fontFamily: TEXT_FONT, color: C.textMain, margin: '0 8px', minWidth: 0,
      ...(sideMenu ? { maxWidth: 560, marginLeft: 'auto', marginRight: 'auto' } : {}),
    }}>
      <style>{CSS}</style>
      <div className="rp-lb-chips" role="tablist" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
        {LEADERBOARD_BOARDS.map((id) => (
          <button key={id} type="button" role="tab" aria-selected={board === id} onClick={() => setBoard(id)} style={chip(id)}>
            {BOARDS[id].title}
          </button>
        ))}
      </div>

      <div style={{ textAlign: 'center', margin: '14px 0 10px' }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, color: C.glowCore, textShadow: '0 0 10px rgba(245,188,91,0.35)' }}>{info.title}</div>
        <div style={{ fontSize: 12, color: C.textDim, marginTop: 2 }}>{info.sub}</div>
        {token === null && <div style={{ fontSize: 11, color: '#F08A24', marginTop: 4 }}>Вне Telegram — пример рейтинга</div>}
      </div>

      {state.kind === 'loading' && (
        <div style={{ textAlign: 'center', padding: '40px 0', fontSize: 13, color: C.textDim }}>Считаем…</div>
      )}

      {state.kind === 'error' && (
        <div style={{ textAlign: 'center', padding: '32px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 13, color: C.textMain }}>Не удалось загрузить рейтинг</div>
          <button type="button" onClick={() => setAttempt((a) => a + 1)} style={{ ...darkBtn(true), padding: '0 22px' }}>Ещё раз</button>
        </div>
      )}

      {view !== null && view.rows.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 0', fontSize: 13, color: C.textDim }}>Здесь пока никого. Стань первым!</div>
      )}

      {view !== null && view.rows.length > 0 && (
        <div key={board} className="rp-lb-in">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, alignItems: 'end', padding: '4px 2px 0' }}>
            <PodiumSlot row={top3[1]} place={2} board={board} />
            <PodiumSlot row={top3[0]} place={1} board={board} />
            <PodiumSlot row={top3[2]} place={3} board={board} />
          </div>
          {rest.length > 0 && (
            <div style={{
              marginTop: 0, padding: 4, borderRadius: '0 0 10px 10px',
              background: C.nicheDeep, border: `1px solid ${C.stoneDark}`,
              display: 'flex', flexDirection: 'column', gap: 2,
            }}>
              {rest.map((row) => <ListRow key={row.place} row={row} board={board} />)}
            </div>
          )}
        </div>
      )}

      {view !== null && (
        <div data-leaderboard-me="" style={{
          position: 'sticky', zIndex: 2,
          // От края внутри отступа контейнера прокрутки: в вертикали этот
          // отступ (96 px + зона жеста) уже лежит под нижней панелью меню.
          bottom: 4,
          marginTop: 12, padding: sideMenu ? '8px 14px' : '12px 14px', borderRadius: 10, textAlign: 'center',
          border: `1px solid ${view.me !== null ? C.glowEdge : C.stoneDark}`,
          background: view.me !== null ? 'linear-gradient(180deg, #4a3a22, #2a2116)' : C.niche,
          boxShadow: '0 -6px 16px rgba(0,0,0,0.55)',
          fontFamily: view.me !== null ? FONT_DISPLAY : TEXT_FONT, fontSize: view.me !== null ? 14 : 13,
          color: view.me !== null ? C.glowCore : C.textDim,
        }}>{meLine(board, view.me)}</div>
      )}
    </div>
  )
}
