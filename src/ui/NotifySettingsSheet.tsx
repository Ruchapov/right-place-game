// «Персонаж → 🔔 Уведомления» (13.11.2026): о чём звонить Колоколу (бот).
//
// GET /character/notify-settings при открытии, POST на каждый переключатель —
// сразу, без кнопки «Сохранить»; при отказе переключатель возвращается.
// Боту нельзя писать (botAllowed=false) — сверху просьба разрешить:
// requestWriteAccess() SDK, при согласии POST /character/bot-allowed.
import { useEffect, useState } from 'react'
import { requestWriteAccess } from '@telegram-apps/sdk'
import { C, FONT_DISPLAY } from './theme'
import { G, goldBtn } from './guild/style'
import { BottomSheet } from './guild/common'
import { BellEmblem } from './ChannelPanel'
import { NOTIFY_SETTING_KEYS, fetchNotifySettings, markBotAllowed, saveNotifySettings, type NotifySettingKey, type NotifySettingsView } from '../api'

const GOLD = '#D99A3E'

const ROWS: Record<NotifySettingKey, { title: string; hint: string }> = {
  energy:   { title: 'Энергия полна',  hint: 'Костёр снова горит: 100 из 100' },
  quests:   { title: 'Новые задания',  hint: 'На доске Убежища свежий набор' },
  friends:  { title: 'Друзья',         hint: 'Друг пришёл по ссылке или дорос до награды' },
  guild:    { title: 'Гильдия',        hint: 'Заявки в гильдию и ответы на твои' },
  comeback: { title: 'Убежище ждёт',   hint: 'Если долго не заглядываешь' },
}

const CSS = `
.rp-sw { position: relative; width: 54px; height: 30px; flex-shrink: 0; border-radius: 15px; cursor: pointer; padding: 0;
  border: 1px solid ${C.stoneDark}; background: ${C.outline}; box-shadow: inset 0 2px 4px rgba(0,0,0,.6);
  transition: background .2s ease, border-color .2s ease }
.rp-sw[aria-checked="true"] { background: linear-gradient(180deg, #3a2c14, #2a1f10); border-color: ${GOLD} }
.rp-sw::after { content: ''; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, ${C.stoneLight}, ${C.stoneDark}); box-shadow: 0 2px 3px rgba(0,0,0,.5);
  transition: transform .2s cubic-bezier(.3,1.4,.5,1), background .2s ease, box-shadow .2s ease }
.rp-sw[aria-checked="true"]::after { transform: translateX(24px);
  background: radial-gradient(circle at 35% 30%, #FFE3A3, ${C.glowCore} 45%, ${C.glowEdge}); box-shadow: 0 0 10px rgba(245,188,91,.75), 0 2px 3px rgba(0,0,0,.5) }
.rp-sw:active { filter: brightness(1.2) }
.rp-sw:focus-visible { outline: 2px solid ${GOLD}; outline-offset: 3px }
.rp-sw:disabled { cursor: default; opacity: .5 }
.rp-press { transition: transform .08s ease, filter .12s ease }
.rp-press:active:not(:disabled) { transform: scale(.97); filter: brightness(1.15) }
.rp-nrow { transition: background .15s ease }
.rp-nrow:active { background: rgba(217,154,62,.06) }
@media (prefers-reduced-motion: reduce) { .rp-sw, .rp-sw::after { transition: none } }
`

export function NotifySettingsSheet({ token, onClose }: { token: string | null; onClose: () => void }) {
  const [view, setView] = useState<NotifySettingsView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<NotifySettingKey | 'allow' | null>(null)

  useEffect(() => {
    if (token === null) { setError('Уведомления настраиваются в Telegram.'); return }
    let alive = true
    fetchNotifySettings(token).then((v) => { if (alive) setView(v) }, (e) => {
      console.error('NotifySettingsSheet: настройки не загрузились', e)
      if (alive) setError('Настройки не загрузились. Закрой окно и открой ещё раз.')
    })
    return () => { alive = false }
  }, [token])

  const toggle = async (key: NotifySettingKey) => {
    if (!token || !view || pending) return
    const next = !view.settings[key]
    setView({ ...view, settings: { ...view.settings, [key]: next } })
    setPending(key)
    setError(null)
    try {
      setView(await saveNotifySettings(token, { [key]: next }))
    } catch (e) {
      console.error('NotifySettingsSheet: переключатель не сохранился', e)
      setView(view)
      setError('Не сохранилось. Проверь связь и нажми ещё раз.')
    } finally {
      setPending(null)
    }
  }

  const allow = async () => {
    if (!token || pending) return
    setPending('allow')
    setError(null)
    try {
      if (!requestWriteAccess.isAvailable()) { setError('Этот Telegram не умеет спрашивать разрешение. Напиши боту /start.'); return }
      const status = await requestWriteAccess()
      if (status !== 'allowed') { setError('Без разрешения Колокол молчит.'); return }
      setView(await markBotAllowed(token))
    } catch (e) {
      console.error('NotifySettingsSheet: разрешение не прошло', e)
      setError('Разрешение не сохранилось. Попробуй ещё раз.')
    } finally {
      setPending(null)
    }
  }

  return (
    <BottomSheet onClose={onClose}>
      <style>{CSS}</style>
      <div style={{ display:'flex', alignItems:'center', gap:14, paddingRight:40 }}>
        <BellEmblem size={56} />
        <div style={{ minWidth:0 }}>
          <div style={{ fontFamily:FONT_DISPLAY, fontWeight:700, fontSize:19, color:C.textMain }}>Уведомления</div>
          <div style={{ fontSize:13, color:G.textSoft, lineHeight:1.4, marginTop:2 }}>О чём звонить Колоколу. Ночью (23:00–9:00) он молчит — всё приходит утром.</div>
        </div>
      </div>

      {view !== null && !view.botAllowed && (
        <div style={{ borderRadius:12, border:`1px solid ${GOLD}`, background:G.amberBg, padding:'12px 14px', display:'flex', flexDirection:'column', gap:10 }}>
          <div style={{ fontSize:13, color:C.textMain, lineHeight:1.45 }}>Колокол пишет в чат с ботом. Разреши ему сообщения — иначе звона не будет.</div>
          <button className="rp-press" onClick={() => { void allow() }} disabled={pending === 'allow'} style={{ ...goldBtn(pending !== 'allow', 46), width:'100%' }}>
            {pending === 'allow' ? 'Жду ответа…' : 'Разрешить сообщения от бота'}
          </button>
        </div>
      )}
      {view !== null && view.botAllowed && view.botBlocked && (
        <div style={{ borderRadius:12, border:`1px solid ${G.redBorder}`, background:G.redBg, padding:'10px 14px', fontSize:13, color:G.pink, lineHeight:1.45 }}>
          Бот заблокирован в Telegram. Открой чат с @RightPlaceGame_bot и нажми «Перезапустить».
        </div>
      )}

      <div style={{ borderRadius:14, border:`1px solid ${C.stoneDark}`, background:C.appBg, overflow:'hidden' }}>
        {NOTIFY_SETTING_KEYS.map((k, i) => {
          const on = view?.settings[k] ?? false
          return (
            <label key={k} className="rp-nrow" style={{
              display:'flex', alignItems:'center', gap:12, minHeight:60, padding:'8px 14px', boxSizing:'border-box', cursor: view ? 'pointer' : 'default',
              borderTop: i === 0 ? 'none' : `1px solid ${G.rowBorder}`,
            }}>
              <span style={{ width:6, height:6, borderRadius:3, flexShrink:0, background: on ? C.glowCore : C.stoneDark, boxShadow: on ? '0 0 6px rgba(245,188,91,.8)' : 'none', transition:'background .2s, box-shadow .2s' }} />
              <span style={{ flex:1, minWidth:0 }}>
                <span style={{ display:'block', fontSize:15, color: on ? C.textMain : G.textSoft, fontWeight:600, transition:'color .2s' }}>{ROWS[k].title}</span>
                <span style={{ display:'block', fontSize:12, color:G.textSoft, lineHeight:1.35, marginTop:2 }}>{ROWS[k].hint}</span>
              </span>
              <button type="button" role="switch" aria-checked={on} aria-label={ROWS[k].title} className="rp-sw"
                disabled={view === null || (pending !== null && pending !== k)} onClick={() => { void toggle(k) }} />
            </label>
          )
        })}
      </div>

      {view === null && error === null && <div style={{ fontSize:13, color:G.textSoft, textAlign:'center' }}>Колокол вспоминает…</div>}
      {error !== null && <div role="status" style={{ fontSize:13, color:G.pink, textAlign:'center', lineHeight:1.4 }}>{error}</div>}
    </BottomSheet>
  )
}
