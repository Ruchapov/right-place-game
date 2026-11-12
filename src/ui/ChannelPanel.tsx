// «Сообщество → Канал» (13.11.2026): +50 RP за подписку на @rightplace_news.
//
// Два шага по порядку: открыть канал (openTelegramLink), проверить подписку
// (POST /character/channel-reward, сервер спрашивает getChatMember). Награда —
// один раз; после неё плашка «+50 RP» становится «Награда получена».
// Логотип — колокол Убежища, нарисованный кодом (картинки канала в игре нет).
import { useState } from 'react'
import { openTelegramLink } from '@telegram-apps/sdk'
import { C, FONT_DISPLAY } from './theme'
import { G, ICON, TEXT_FONT, darkBtn, goldBtn } from './guild/style'
import { CheckIcon } from './guild/common'
import { claimChannelReward } from '../api'

export const CHANNEL_URL = 'https://t.me/rightplace_news'
export const CHANNEL_REWARD_RP = 50
const GOLD = '#D99A3E'

const CSS = `
@keyframes rp-ch-in { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
@keyframes rp-ch-ember { 0%,100% { opacity: .55; transform: scale(1) } 50% { opacity: .9; transform: scale(1.06) } }
@keyframes rp-ch-float { 0% { opacity: 0; transform: translate(-50%, 6px) scale(.8) } 20% { opacity: 1; transform: translate(-50%, -6px) scale(1.1) } 100% { opacity: 0; transform: translate(-50%, -64px) scale(1) } }
@keyframes rp-ch-stamp { 0% { transform: scale(1.25); opacity: 0 } 60% { transform: scale(.96); opacity: 1 } 100% { transform: scale(1) } }
.rp-press { transition: transform .08s ease, filter .12s ease }
.rp-press:active:not(:disabled) { transform: scale(.97); filter: brightness(1.15) }
.rp-press:focus-visible { outline: 2px solid ${GOLD}; outline-offset: 2px }
@media (prefers-reduced-motion: reduce) { .rp-ch-anim, .rp-ch-anim * { animation: none !important } }
`

/** Колокол в каменной нише с тлеющим ореолом. */
export function BellEmblem({ size = 96 }: { size?: number }) {
  return (
    <div className="rp-ch-anim" style={{ position:'relative', width:size, height:size, flexShrink:0 }}>
      <div style={{
        position:'absolute', inset:-10, borderRadius:'50%',
        background:`radial-gradient(circle, rgba(245,188,91,.35) 0%, rgba(165,113,58,.12) 45%, transparent 70%)`,
        animation:'rp-ch-ember 3.2s ease-in-out infinite',
      }} />
      <svg width={size} height={size} viewBox="0 0 96 96" aria-hidden="true" style={{ position:'relative' }}>
        <defs>
          <radialGradient id="rp-bell-niche" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor={C.niche} /><stop offset="100%" stopColor={C.outline} />
          </radialGradient>
          <linearGradient id="rp-bell-gold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.glowCore} /><stop offset="100%" stopColor={C.glowEdge} />
          </linearGradient>
        </defs>
        <circle cx="48" cy="48" r="45" fill="url(#rp-bell-niche)" stroke={C.stoneDark} strokeWidth="3" />
        <circle cx="48" cy="48" r="38" fill="none" stroke={GOLD} strokeOpacity=".45" strokeWidth="1" strokeDasharray="2 4" />
        <path d="M48 20c-2 0-3.5 1.4-3.5 3.2v2.1C35.6 27 30 34.6 30 44v11l-5 7h46l-5-7V44c0-9.4-5.6-17-14.5-18.7v-2.1C51.5 21.4 50 20 48 20z"
          fill="url(#rp-bell-gold)" stroke={C.outline} strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M37 44c0-5 3-9.4 7.5-11" stroke={C.textMain} strokeOpacity=".55" strokeWidth="2" strokeLinecap="round" fill="none" />
        <circle cx="48" cy="68" r="5" fill={C.glowMid} stroke={C.outline} strokeWidth="1.5" />
        <path d="M20 40c-2 3-2 8 0 11M76 40c2 3 2 8 0 11M14 36c-3.5 5-3.5 14 0 19M82 36c3.5 5 3.5 14 0 19"
          stroke={C.glowCore} strokeOpacity=".5" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      </svg>
    </div>
  )
}

type Status = 'idle' | 'checking' | 'not_subscribed' | 'error' | 'offline'

export function ChannelPanel(props: {
  token: string | null
  /** null — сервер не назвал; true — награда уже получена. */
  claimed: boolean | null
  onClaimed: (rp: number | null) => void
  sideMenu: boolean
}) {
  const [opened, setOpened] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [burst, setBurst] = useState(0)
  const claimed = props.claimed === true

  const openChannel = () => {
    setOpened(true)
    if (openTelegramLink.isAvailable()) openTelegramLink(CHANNEL_URL)
    else window.open(CHANNEL_URL, '_blank')
  }

  const check = async () => {
    if (props.token === null) { setStatus('offline'); return }
    setStatus('checking')
    try {
      const r = await claimChannelReward(props.token)
      if (r.kind === 'granted') { setStatus('idle'); setBurst((n) => n + 1); props.onClaimed(r.rp) }
      else if (r.kind === 'already') { setStatus('idle'); props.onClaimed(null) }
      else setStatus('not_subscribed')
    } catch (e) {
      console.error('ChannelPanel: проверка подписки не удалась', e)
      setStatus('error')
    }
  }

  const line =
    status === 'not_subscribed' ? { text: 'Подписка не найдена. Подпишись и проверь ещё раз.', color: G.pink }
    : status === 'error' ? { text: 'Не удалось проверить. Попробуй через минуту.', color: G.pink }
    : status === 'offline' ? { text: 'Награда выдаётся только в Telegram.', color: G.textSoft }
    : null

  return (
    <div className="rp-ch-anim" data-channel-panel="" style={{
      fontFamily: TEXT_FONT, color: C.textMain, margin: props.sideMenu ? '0 8px' : '4px 8px 0',
      animation: 'rp-ch-in .28s ease-out both',
    }}>
      <style>{CSS}</style>
      <div style={{
        position:'relative', borderRadius:16, border:`1px solid ${C.stoneDark}`, overflow:'hidden',
        background:`linear-gradient(180deg, ${G.sheet} 0%, ${C.appBg} 100%)`,
        boxShadow:`inset 0 1px 0 rgba(164,151,164,.12), 0 8px 24px rgba(0,0,0,.45)`,
        padding: props.sideMenu ? '16px 20px' : '22px 18px 20px',
        display: props.sideMenu ? 'grid' : 'flex', gridTemplateColumns: props.sideMenu ? 'auto minmax(0, 1fr)' : undefined,
        flexDirection:'column', alignItems: props.sideMenu ? 'center' : 'center', columnGap:24, rowGap:14,
      }}>
        <div style={{ position:'absolute', left:0, right:0, top:0, height:2, background:`linear-gradient(90deg, transparent, ${GOLD}, transparent)`, opacity:.7 }} />

        <BellEmblem size={props.sideMenu ? 104 : 96} />

        <div style={{ display:'flex', flexDirection:'column', alignItems: props.sideMenu ? 'flex-start' : 'center', gap:12, minWidth:0, width:'100%' }}>
          <div style={{ textAlign: props.sideMenu ? 'left' : 'center' }}>
            <div style={{ fontFamily:FONT_DISPLAY, fontWeight:700, fontSize:21, color:C.textMain, letterSpacing:.3 }}>Канал Убежища</div>
            <div style={{ fontSize:13, color:G.textSoft, marginTop:4, lineHeight:1.45 }}>Новости, новые карты и боссы, подарки</div>
          </div>

          {/* Плашка награды; после получения — печать «получено». */}
          <div style={{ position:'relative' }}>
            {claimed ? (
              <div key="done" style={{
                display:'flex', alignItems:'center', gap:8, padding:'8px 16px', borderRadius:999,
                border:`1px solid ${G.green}`, background:G.greenBg, color:G.greenText, fontSize:14, fontWeight:600,
                animation: burst > 0 ? 'rp-ch-stamp .4s ease-out both' : undefined,
              }}>
                <CheckIcon color={G.greenText} size={16} /> Награда получена
              </div>
            ) : (
              <div style={{
                display:'flex', alignItems:'center', gap:8, padding:'7px 18px 7px 10px', borderRadius:999,
                border:`1px solid ${GOLD}`, background:`linear-gradient(180deg, #3a2c14, #241b0e)`,
                boxShadow:`0 0 14px rgba(217,154,62,.25)`,
              }}>
                <img src={ICON('icon_rp.png')} alt="" width={26} height={26} style={{ display:'block' }} />
                <span style={{ fontFamily:FONT_DISPLAY, fontWeight:700, fontSize:18, color:C.glowCore }}>+{CHANNEL_REWARD_RP} RP</span>
              </div>
            )}
            {burst > 0 && (
              <span key={burst} aria-live="polite" style={{
                position:'absolute', left:'50%', top:0, pointerEvents:'none', whiteSpace:'nowrap',
                fontFamily:FONT_DISPLAY, fontWeight:700, fontSize:22, color:C.glowCore,
                textShadow:`0 0 10px rgba(245,188,91,.8), 0 2px 0 ${C.outline}`,
                animation:'rp-ch-float 1.4s ease-out both',
              }}>+{CHANNEL_REWARD_RP} RP</span>
            )}
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:8, width:'100%', maxWidth:340 }}>
            <button className="rp-press" onClick={openChannel} style={{
              ...(claimed || opened ? darkBtn(true, 48) : goldBtn(true, 48)), justifyContent:'flex-start', gap:12, fontSize:14,
            }}>
              <StepMark n={1} done={opened || claimed} gold={!(claimed || opened)} />
              Открыть канал
            </button>
            {!claimed && (
              <button className="rp-press" onClick={() => { void check() }} disabled={status === 'checking'} style={{
                ...(opened ? goldBtn(status !== 'checking', 48) : darkBtn(status !== 'checking', 48)), justifyContent:'flex-start', gap:12, fontSize:14,
              }}>
                <StepMark n={2} done={false} gold={opened} />
                {status === 'checking' ? 'Проверяю…' : 'Проверить подписку'}
              </button>
            )}
          </div>

          {line && (
            <div role="status" style={{ fontSize:13, color:line.color, textAlign: props.sideMenu ? 'left' : 'center', lineHeight:1.4, animation:'rp-ch-in .2s ease-out both' }}>
              {line.text}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Номер шага в кружке; пройденный — галочка. На золотой кнопке — тёмный. */
function StepMark({ n, done, gold }: { n: number; done: boolean; gold: boolean }) {
  const ink = gold ? C.appBg : GOLD
  return (
    <span style={{
      width:26, height:26, borderRadius:13, flexShrink:0, boxSizing:'border-box',
      border:`1.5px solid ${ink}`, color:ink, display:'flex', alignItems:'center', justifyContent:'center',
      fontFamily:FONT_DISPLAY, fontSize:13, fontWeight:700,
    }}>
      {done ? <CheckIcon color={ink} size={14} /> : n}
    </span>
  )
}
