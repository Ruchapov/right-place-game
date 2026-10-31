// Чат гильдии: опрос раз в GUILD_CHAT_POLL_MS, пока экран гильдии открыт
// (01.11.2026: опрос поднят из вкладки «Чат» на весь экран гильдии — ради
// кружка новых сообщений на вкладке; частота и лимиты прежние).
import { useEffect, useRef, useState } from 'react'
import { GUILD_CHAT_POLL_MS } from '../../guild'
import { fetchGuildChat, sendGuildChat, type GuildChatMessage } from '../../api'
import { guildErrorText } from '../guildText'

export type GuildChat = {
  messages: GuildChatMessage[]
  error: string | null
  sending: boolean
  /** Чужих сообщений, пришедших после последнего взгляда на чат. */
  unread: number
  send: (text: string) => Promise<boolean>
  markSeen: () => void
}

export function useGuildChat(token: string, chatOpen: boolean): GuildChat {
  const [messages, setMessages] = useState<GuildChatMessage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  // id последнего сообщения, которое игрок видел; null — первый опрос ещё не пришёл.
  const [seenId, setSeenId] = useState<number | null>(null)
  const lastIdRef = useRef(0)
  const chatOpenRef = useRef(chatOpen)

  useEffect(() => { chatOpenRef.current = chatOpen }, [chatOpen])

  const take = (fresh: GuildChatMessage[], first: boolean) => {
    if (fresh.length > 0) {
      lastIdRef.current = fresh[fresh.length - 1].id
      setMessages((prev) => [...prev, ...fresh].slice(-200))
    }
    // Что было до открытия экрана — не новое; пока чат открыт — всё видно.
    if (first || chatOpenRef.current) setSeenId(lastIdRef.current)
  }

  useEffect(() => {
    let alive = true
    let first = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const poll = async () => {
      try {
        const r = await fetchGuildChat(token, lastIdRef.current)
        if (!alive) return
        take(r.messages, first)
        first = false
        setError(null)
      } catch (e) {
        if (alive) setError(guildErrorText(e))
      }
      if (alive) timer = setTimeout(poll, GUILD_CHAT_POLL_MS)
    }
    void poll()
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [token])

  const send = async (text: string): Promise<boolean> => {
    const t = text.trim()
    if (t === '' || sending) return false
    setSending(true)
    try {
      await sendGuildChat(token, t)
      const r = await fetchGuildChat(token, lastIdRef.current)
      take(r.messages, false)
      setError(null)
      return true
    } catch (e) {
      setError(guildErrorText(e))
      return false
    } finally {
      setSending(false)
    }
  }

  const seen = seenId ?? Number.MAX_SAFE_INTEGER
  const unread = messages.filter((m) => m.id > seen && !m.mine && !m.system).length

  return { messages, error, sending, unread, send, markSeen: () => setSeenId(lastIdRef.current) }
}
