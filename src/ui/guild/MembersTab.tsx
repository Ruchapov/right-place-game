// Вкладка «Состав» (01.11.2026, mock/Members.html): заявки карточкой сверху,
// список участников, меню действий по тапу на строку, настройки и выход внизу.
import { useState, type CSSProperties } from 'react'
import { C, FONT_DISPLAY } from '../theme'
import { GUILD_MAX_DEPUTIES, guildMemberCap, type GuildRole } from '../../guild'
import type { GuildMemberState, GuildMemberView } from '../../api'
import { CheckIcon, CrossIcon, CrownIcon, LevelCircle, Overlay, StarIcon } from './common'
import { isOnline, seenText } from './buildingTexts'
import { G, dangerBtn, darkBtn, tabHead, tabSub, tabTitle } from './style'

type Run = (path: string, body: Record<string, unknown>, signature: string) => Promise<void>

function roleOf(m: GuildMemberView): GuildRole {
  return m.role === 'leader' || m.role === 'deputy' ? m.role : 'member'
}

export function MembersTab({ me, pending, run, now, onSettings, overlayPad, overlayCard }: {
  me: GuildMemberState; pending: boolean; run: Run; now: number; onSettings: () => void
  overlayPad: CSSProperties; overlayCard: CSSProperties
}) {
  const [confirm, setConfirm] = useState<string | null>(null)
  const [menuFor, setMenuFor] = useState<number | null>(null)
  const role = me.role
  const selfId = me.me.characterId
  const canReview = role === 'leader' || role === 'deputy'
  const cap = guildMemberCap(me.guild.level)
  const online = me.members.filter((m) => m.characterId === selfId || isOnline(m.lastSeenAt, now)).length
  const ask = (key: string, action: () => void) => {
    if (confirm === key) { setConfirm(null); action() } else setConfirm(key)
  }
  // Кто что может с чужой строкой — как раньше: глава всё, заместитель — исключить участника.
  const canKick = (m: GuildMemberView) => m.characterId !== selfId && roleOf(m) !== 'leader'
    && (role === 'leader' || (role === 'deputy' && roleOf(m) === 'member'))
  const hasActions = (m: GuildMemberView) => m.characterId !== selfId && (role === 'leader' || canKick(m))
  const menuMember = me.members.find((m) => m.characterId === menuFor) ?? null

  return (
    <div data-guild-members="" style={{ flex:1, minHeight:0, overflowY:'auto', WebkitOverflowScrolling:'touch' }}>
      <div style={tabHead}>
        <div style={tabTitle}>Состав</div>
        <div style={tabSub}>{me.members.length} из {cap} мест · {online} в сети</div>
      </div>

      {canReview && me.requests.length > 0 && (
        <div data-guild-requests="" style={{ margin:'12px 14px 0', padding:'10px 12px', borderRadius:12, border:`1px solid ${C.glowMid}`, background:G.requestBg, display:'flex', flexDirection:'column', gap:8 }}>
          <div style={{ fontFamily:FONT_DISPLAY, fontWeight:700, fontSize:13, color:C.glowCore }}>Заявки · {me.requests.length}</div>
          {me.requests.map((r) => (
            <div key={r.characterId} style={{ display:'flex', alignItems:'center', gap:10 }}>
              <LevelCircle level={r.level} size={38} ring={C.stoneMid} />
              <div style={{ flex:1, minWidth:0, fontSize:14, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.name}</div>
              <button aria-label="Принять" disabled={pending} onClick={() => run('/guild/requests/decide', { characterId: r.characterId, accept: true }, `decide:${r.characterId}:1`)}
                style={{ width:44, height:44, borderRadius:10, border:`1px solid ${G.green}`, background:G.greenBg, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', opacity: pending ? 0.5 : 1, flexShrink:0 }}>
                <CheckIcon color={G.greenText} />
              </button>
              <button aria-label="Отклонить" disabled={pending} onClick={() => run('/guild/requests/decide', { characterId: r.characterId, accept: false }, `decide:${r.characterId}:0`)}
                style={{ width:44, height:44, borderRadius:10, border:`1px solid ${G.redBorder}`, background:G.redBg, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', opacity: pending ? 0.5 : 1, flexShrink:0 }}>
                <CrossIcon color={G.pink} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ padding:'10px 14px', display:'flex', flexDirection:'column', gap:6 }}>
        {me.members.map((m) => {
          const isSelf = m.characterId === selfId
          const r = roleOf(m)
          const on = isSelf || isOnline(m.lastSeenAt, now)
          const clickable = hasActions(m)
          return (
            <div key={m.characterId} role={clickable ? 'button' : undefined} onClick={clickable ? () => { setConfirm(null); setMenuFor(m.characterId) } : undefined}
              style={{
                display:'flex', alignItems:'center', gap:10, padding:'8px 10px', borderRadius:12, minHeight:44,
                background: isSelf ? G.amberBg : G.card, border:`1px solid ${isSelf ? C.glowEdge : G.rowBorder}`,
                cursor: clickable ? 'pointer' : 'default',
              }}>
              <LevelCircle level={m.level} size={42} ring={r === 'leader' ? C.glowCore : r === 'deputy' ? C.bone : C.stoneMid} online={on} />
              <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', gap:2 }}>
                <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                  <span style={{ fontSize:14, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:'100%' }}>
                    {m.name}{isSelf ? ' · вы' : ''}
                  </span>
                  {r === 'leader' && (
                    <span style={{ display:'flex', alignItems:'center', gap:3, height:20, padding:'0 7px', borderRadius:10, background:G.leaderBg, color:C.glowCore, fontSize:11, fontWeight:600 }}>
                      <CrownIcon color={C.glowCore} />Глава
                    </span>
                  )}
                  {r === 'deputy' && (
                    <span style={{ display:'flex', alignItems:'center', gap:3, height:20, padding:'0 7px', borderRadius:10, background:G.deputyBg, color:C.bone, fontSize:11, fontWeight:600 }}>
                      <StarIcon color={C.bone} />Заместитель
                    </span>
                  )}
                </div>
                <span style={{ fontSize:12, color:G.textSoft }}>{isSelf ? 'в сети' : seenText(m.lastSeenAt, now)}</span>
              </div>
            </div>
          )
        })}

        <div style={{ display:'flex', flexDirection:'column', gap:8, marginTop:10, marginBottom:6 }}>
          {role === 'leader' && <button onClick={onSettings} style={darkBtn(true)}>Настройки гильдии</button>}
          {role === 'leader' && me.members.length === 1 && (
            <button disabled={pending} onClick={() => ask('disband', () => run('/guild/disband', {}, 'disband'))} style={dangerBtn(!pending)}>
              {confirm === 'disband' ? 'Казна и склад пропадут. Точно?' : 'Распустить гильдию'}
            </button>
          )}
          {role !== 'leader' && (
            <button disabled={pending} onClick={() => ask('leave', () => run('/guild/leave', {}, 'leave'))} style={dangerBtn(!pending)}>
              {confirm === 'leave' ? 'Вступить снова — через 24 ч. Точно?' : 'Покинуть гильдию'}
            </button>
          )}
        </div>
      </div>

      {menuMember !== null && (
        <MemberMenu member={menuMember} myRole={role} deputies={me.members.filter((m) => roleOf(m) === 'deputy').length}
          canKick={canKick(menuMember)} pending={pending} confirm={confirm} ask={ask} run={run}
          overlayPad={overlayPad} overlayCard={overlayCard} onClose={() => { setMenuFor(null); setConfirm(null) }} />
      )}
    </div>
  )
}

function MemberMenu({ member, myRole, deputies, canKick, pending, confirm, ask, run, overlayPad, overlayCard, onClose }: {
  member: GuildMemberView; myRole: GuildRole; deputies: number; canKick: boolean; pending: boolean; confirm: string | null
  ask: (key: string, action: () => void) => void; run: Run; overlayPad: CSSProperties; overlayCard: CSSProperties; onClose: () => void
}) {
  const r = roleOf(member)
  const id = member.characterId
  const after = (p: Promise<void>) => { void p.then(onClose) }
  return (
    <Overlay onClose={onClose} pad={overlayPad} card={overlayCard}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
        <LevelCircle level={member.level} size={38} ring={r === 'leader' ? C.glowCore : r === 'deputy' ? C.bone : C.stoneMid} />
        <div style={{ fontFamily:FONT_DISPLAY, fontWeight:700, fontSize:16, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{member.name}</div>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {myRole === 'leader' && r === 'member' && deputies < GUILD_MAX_DEPUTIES && (
          <button disabled={pending} onClick={() => after(run('/guild/deputy', { characterId: id, deputy: true }, `deputy:${id}:1`))} style={darkBtn(!pending)}>Назначить заместителем</button>
        )}
        {myRole === 'leader' && r === 'deputy' && (
          <button disabled={pending} onClick={() => after(run('/guild/deputy', { characterId: id, deputy: false }, `deputy:${id}:0`))} style={darkBtn(!pending)}>Снять заместителя</button>
        )}
        {myRole === 'leader' && (
          <button disabled={pending} onClick={() => ask(`lead:${id}`, () => after(run('/guild/transfer-leader', { characterId: id }, `transfer:${id}`)))} style={darkBtn(!pending)}>
            {confirm === `lead:${id}` ? 'Точно передать главенство?' : 'Передать главенство'}
          </button>
        )}
        {canKick && (
          <button disabled={pending} onClick={() => ask(`kick:${id}`, () => after(run('/guild/kick', { characterId: id }, `kick:${id}`)))} style={dangerBtn(!pending)}>
            {confirm === `kick:${id}` ? 'Точно исключить?' : 'Исключить'}
          </button>
        )}
        <button onClick={onClose} style={{ ...darkBtn(true), border:'none', background:'none', color:G.textSoft }}>Отмена</button>
      </div>
    </Overlay>
  )
}
