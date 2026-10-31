// Вкладка «Чат» (01.11.2026, mock/Chat.html). Опрос и отправка — useGuildChat.
import { useEffect, useRef, useState } from 'react'
import { C, FONT_DISPLAY } from '../theme'
import { GUILD_CHAT_MAX_LEN } from '../../guild'
import type { GuildChatMessage, GuildMemberView } from '../../api'
import { LevelCircle, SendIcon } from './common'
import { G, GUILD_ART, ICON, TEXT_FONT, tabHead, tabSub, tabTitle } from './style'
import type { GuildChat } from './useGuildChat'

/** Маленькая иконка системного сообщения по смыслу; null — без иконки. */
function systemIcon(text: string): string | null {
  if (text.includes('в казну')) return text.includes('элитн') ? ICON('icon_elite_trophy.png') : ICON('icon_gold.png')
  if (text.includes('в библиотеке')) return GUILD_ART('building_library.png')
  if (text.includes('Котёл')) return GUILD_ART('building_cauldron.png')
  if (text.includes('Библиотека')) return GUILD_ART('building_library.png')
  if (text.includes('Алтарь')) return GUILD_ART('building_altar.png')
  if (text.includes('Склад') || text.includes('склад')) return GUILD_ART('building_storage.png')
  if (text.includes('Уровень гильдии')) return GUILD_ART('building_hall.png')
  return null
}

export function ChatTab({ chat, members, online }: { chat: GuildChat; members: GuildMemberView[]; online: number }) {
  const [text, setText] = useState('')
  const listRef = useRef<HTMLDivElement | null>(null)
  const levelOf = new Map(members.map((m) => [m.name, m]))

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat.messages.length])

  const canSend = !chat.sending && text.trim() !== ''
  const send = async () => {
    if (await chat.send(text)) setText('')
  }

  const bubble = (m: GuildChatMessage) => {
    if (m.system) {
      const icon = systemIcon(m.text)
      return (
        <div key={m.id} style={{
          alignSelf:'center', display:'flex', alignItems:'center', gap:6, maxWidth:'92%', padding:'5px 12px', borderRadius:14,
          background:'rgba(41,38,47,.85)', fontSize:12, color:C.bone, lineHeight:1.35, wordBreak:'break-word',
        }}>
          {icon && <img src={icon} alt="" width={18} height={18} style={{ flexShrink:0, objectFit:'contain' }} />}
          <span>{m.text}</span>
        </div>
      )
    }
    if (m.mine) {
      return (
        <div key={m.id} style={{ display:'flex', flexDirection:'row-reverse' }}>
          <div style={{ maxWidth:'78%', padding:'8px 11px', borderRadius:'14px 14px 4px 14px', background:G.leaderBg, border:`1px solid ${C.glowEdge}`, fontSize:14, lineHeight:1.4, wordBreak:'break-word' }}>
            {m.text}
          </div>
        </div>
      )
    }
    const author = m.author !== null ? levelOf.get(m.author) : undefined
    const ring = author?.role === 'leader' ? C.glowCore : author?.role === 'deputy' ? C.bone : C.stoneMid
    return (
      <div key={m.id} style={{ display:'flex', gap:8, alignItems:'flex-end' }}>
        {author ? <LevelCircle level={author.level} size={32} ring={ring} /> : <div style={{ width:32, flexShrink:0 }} />}
        <div style={{ maxWidth:'72%', padding:'8px 11px', borderRadius:'14px 14px 14px 4px', background:C.nicheDeep, border:`1px solid ${C.niche}`, wordBreak:'break-word' }}>
          <div style={{ fontSize:11, color:C.bone, fontWeight:600, marginBottom:2 }}>{m.author ?? '?'}</div>
          <div style={{ fontSize:14, lineHeight:1.4 }}>{m.text}</div>
        </div>
      </div>
    )
  }

  return (
    <div data-guild-chat="" style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column' }}>
      <div style={tabHead}>
        <div style={tabTitle}>Чат гильдии</div>
        <div style={tabSub}>{online} в сети</div>
      </div>
      <div ref={listRef} style={{ flex:1, minHeight:0, overflowY:'auto', WebkitOverflowScrolling:'touch', padding:'12px 14px', display:'flex', flexDirection:'column', gap:10 }}>
        {/* Прижать короткую ленту к низу, длинную — прокручивать. */}
        <div style={{ flex:'1 0 auto' }} />
        {chat.messages.length === 0 && <div style={{ color:G.textSoft, fontSize:13, textAlign:'center' }}>Пока тихо.</div>}
        {chat.messages.map(bubble)}
      </div>
      {chat.error && <div style={{ color:G.pink, fontSize:12, padding:'0 14px 6px' }}>{chat.error}</div>}
      <div style={{ display:'flex', gap:8, padding:'10px 12px', borderTop:`1px solid ${C.niche}`, background:G.sheet }}>
        <label style={{ flex:1, display:'flex', minWidth:0 }}>
          <input aria-label="Сообщение" value={text} maxLength={GUILD_CHAT_MAX_LEN} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void send() }}
            placeholder="Написать гильдии…"
            style={{ flex:1, minWidth:0, height:44, boxSizing:'border-box', padding:'0 14px', borderRadius:22, border:`1px solid ${C.stoneDark}`, background:C.outline, color:C.textMain, fontFamily:TEXT_FONT, fontSize:14 }} />
        </label>
        <button aria-label="Отправить" disabled={!canSend} onClick={() => void send()} style={{
          width:44, height:44, borderRadius:22, flexShrink:0, cursor: canSend ? 'pointer' : 'default',
          border:`1px solid ${C.glowCore}`, background:`linear-gradient(${C.glowMid},${C.glowEdge})`, opacity: canSend ? 1 : 0.5,
          display:'flex', alignItems:'center', justifyContent:'center', fontFamily:FONT_DISPLAY,
        }}>
          <SendIcon color={C.appBg} />
        </button>
      </div>
    </div>
  )
}
