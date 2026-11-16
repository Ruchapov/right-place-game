// Летопись героя (17.11.2026): общие счётчики за всё время на вкладке
// «Статистика» экрана героя, над <RuneStats>. Данные — PlayerData.stats
// (сервер, таблица HeroStats; пишет её только финиш забега — CLAUDE.md,
// «Летопись героя»). null — сервер не назвал: строка вместо нулей.
//
// Вид: карточка с заголовком и орнаментом, три главные плитки, плашка «Исход
// вылазок» с кольцом, сетка шести малых плиток (две колонки, если поле карточки уже
// 270 px — контейнер-запрос, так и в узкой вертикали, и в половине экрана
// набок), строка времени внизу. При открытии числа набегают от нуля за 0.8 с,
// плитки проявляются по очереди; при «уменьшении движения» — сразу.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { C, FONT_DISPLAY } from './theme'
import type { HeroStatsView } from '../api'

const ICONS = `${import.meta.env.BASE_URL}assets/icons/`
const icon = (name: string) => `${ICONS}${name}.png`
const BARREL_SRC = `${import.meta.env.BASE_URL}assets/objects/breakables/barrel_idle.webp`
// Бочка лежит в картинке 305×165 в рамке x 105..215, y 2..128 (замер альфы).
const BARREL_IMG = { w: 305, h: 165, cx: 160, top: 2, bodyH: 126 }

const NBSP = String.fromCharCode(0xa0)
const COUNT_UP_MS = 800
const STAGGER_MS = 60

const CSS = `
.rp-hs { container-type: inline-size; }
.rp-hs-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
@container (max-width: 270px) { .rp-hs-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@keyframes rp-hs-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.rp-hs-in { animation: rp-hs-up 420ms cubic-bezier(.2,.7,.3,1) both; }
@media (prefers-reduced-motion: reduce) { .rp-hs-in { animation: none; } }
`

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

/** 0 → 1 за COUNT_UP_MS с ease-out, один раз на появление карточки. */
function useCountUp(): number {
  const [t, setT] = useState(() => (reducedMotion() ? 1 : 0))
  useEffect(() => {
    if (t >= 1) return
    let raf = 0
    const start = performance.now()
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / COUNT_UP_MS)
      setT(1 - Math.pow(1 - k, 3))
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- один раз на появление
  }, [])
  return t
}

/** 1234 → «1 234» (неразрывный пробел: число не ломается на две строки). */
function formatCount(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)
}

function formatTime(ms: number): string {
  const totalMin = Math.floor(ms / 60_000)
  return `${Math.floor(totalMin / 60)}${NBSP}ч ${totalMin % 60}${NBSP}мин`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
}

function Appear({ index, style, children }: { index: number; style?: CSSProperties; children: ReactNode }) {
  return <div className="rp-hs-in" style={{ animationDelay: `${index * STAGGER_MS}ms`, minWidth: 0, ...style }}>{children}</div>
}

function BarrelIcon({ size }: { size: number }) {
  const s = size / BARREL_IMG.bodyH
  return (
    <div aria-hidden style={{
      width: size, height: size, flex: 'none',
      backgroundImage: `url(${BARREL_SRC})`, backgroundRepeat: 'no-repeat',
      backgroundSize: `${BARREL_IMG.w * s}px ${BARREL_IMG.h * s}px`,
      backgroundPosition: `${size / 2 - BARREL_IMG.cx * s}px ${-BARREL_IMG.top * s}px`,
    }} />
  )
}

function bigNumberSize(text: string): number {
  return text.length <= 5 ? 24 : text.length <= 7 ? 20 : 17
}

function MainTile({ index, iconName, value, label }: { index: number; iconName: string; value: number; label: string }) {
  const text = formatCount(value)
  return (
    <Appear index={index} style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
      padding: '10px 4px 9px', borderRadius: 10, border: `1px solid ${C.glowEdge}`,
      background: `linear-gradient(180deg, rgba(165,113,58,0.14), ${C.nicheDeep} 70%)`,
      boxShadow: 'inset 0 0 14px rgba(209,151,68,0.28), 0 2px 6px rgba(0,0,0,0.35)',
    }}>
      <img src={icon(iconName)} alt="" style={{ width: 38, height: 38, objectFit: 'contain', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.7))' }} />
      <div style={{
        fontFamily: FONT_DISPLAY, fontSize: bigNumberSize(text), lineHeight: 1.1, color: C.glowCore, whiteSpace: 'nowrap',
        textShadow: '0 0 10px rgba(245,188,91,0.45), 0 1px 2px #000',
      }}>{text}</div>
      <div style={{ fontSize: 11, lineHeight: 1.25, color: C.bone, textAlign: 'center' }}>{label}</div>
    </Appear>
  )
}

function SmallTile({ index, iconNode, value, label }: { index: number; iconNode: ReactNode; value: number; label: string }) {
  return (
    <Appear index={index} style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
      padding: '8px 4px', borderRadius: 8, background: C.nicheDeep, border: `1px solid ${C.stoneDark}`,
    }}>
      {iconNode}
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 17, lineHeight: 1.15, color: C.textMain, whiteSpace: 'nowrap' }}>{formatCount(value)}</div>
      <div style={{ fontSize: 10.5, lineHeight: 1.25, color: C.textDim, textAlign: 'center' }}>{label}</div>
    </Appear>
  )
}

function smallIcon(name: string): ReactNode {
  return <img src={icon(name)} alt="" style={{ width: 30, height: 30, objectFit: 'contain', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))' }} />
}

function Ornament() {
  const line = (dir: 'left' | 'right'): CSSProperties => ({
    flex: '1 1 0', height: 1,
    background: `linear-gradient(${dir === 'left' ? '90deg' : '270deg'}, transparent, ${C.glowEdge})`,
  })
  return (
    <div aria-hidden style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '6px 10% 12px' }}>
      <div style={line('left')} />
      <div style={{ width: 7, height: 7, transform: 'rotate(45deg)', background: C.glowMid, boxShadow: '0 0 6px rgba(209,151,68,0.6)' }} />
      <div style={line('right')} />
    </div>
  )
}

function OutcomeRing({ completed, died, t }: { completed: number; died: number; t: number }) {
  const total = completed + died
  const pct = total > 0 ? completed / total * 100 : null
  const shown = pct === null ? null : pct * t
  const ring = shown === null
    ? C.stoneDark
    : `conic-gradient(${C.glowMid} 0 ${shown}%, ${C.danger} ${shown}% ${t * 100}%, ${C.stoneDark} ${t * 100}% 100%)`
  return (
    <div style={{ position: 'relative', width: 84, height: 84, flex: 'none', borderRadius: '50%', background: ring, boxShadow: '0 0 10px rgba(0,0,0,0.5)' }}>
      <div style={{
        position: 'absolute', inset: 9, borderRadius: '50%', background: C.nicheDeep,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.6)',
      }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, lineHeight: 1.05, color: pct === null ? C.textDim : C.glowCore }}>
          {pct === null ? '—' : `${Math.round(pct * t)}%`}
        </div>
        <div style={{ fontSize: 10, color: C.textDim }}>вернулся</div>
      </div>
    </div>
  )
}

function LegendRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, fontSize: 12.5, lineHeight: 1.3, color: C.textMain }}>
      <span aria-hidden style={{ width: 9, height: 9, flex: 'none', borderRadius: 2, background: color, alignSelf: 'center' }} />
      <span style={{ minWidth: 0 }}>{label} <span style={{ whiteSpace: 'nowrap' }}>— {value}</span></span>
    </div>
  )
}

export function HeroStatsPanel({ stats }: { stats: HeroStatsView | null }) {
  const t = useCountUp()
  const n = (v: number) => v * t

  const card: CSSProperties = {
    margin: '0 8px', padding: '14px 12px 12px', borderRadius: 12,
    border: `1px solid ${C.stoneDark}`,
    background: `linear-gradient(180deg, ${C.niche}, #2c2b33)`,
    boxShadow: '0 6px 18px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)',
    minWidth: 0,
  }
  const title = (
    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, textAlign: 'center', color: C.glowCore, textShadow: '0 0 10px rgba(245,188,91,0.45), 0 1px 2px #000' }}>
      Летопись героя
    </div>
  )

  if (stats === null) {
    return (
      <div data-hero-chronicle="" style={card}>
        {title}
        <Ornament />
        <div style={{ fontSize: 13, textAlign: 'center', color: C.textDim }}>Летопись не загрузилась — сервер её не назвал.</div>
      </div>
    )
  }

  return (
    <div data-hero-chronicle="" className="rp-hs" style={card}>
      <style>{CSS}</style>
      {title}
      <Ornament />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
        <MainTile index={0} iconName="nav_explore" value={n(stats.runsTotal)} label="вылазок" />
        <MainTile index={1} iconName="event_enemy" value={n(stats.killsTotal)} label="врагов повержено" />
        <MainTile index={2} iconName="event_boss" value={n(stats.bossesKilled)} label="боссов пало" />
      </div>

      <Appear index={3} style={{
        display: 'flex', alignItems: 'center', gap: 12, margin: '10px 0',
        padding: 10, borderRadius: 10, background: C.nicheDeep, border: `1px solid ${C.stoneDark}`,
      }}>
        <OutcomeRing completed={stats.runsCompleted} died={stats.runsDied} t={t} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0, textAlign: 'left' }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 13, color: C.bone }}>Исход вылазок</div>
          <LegendRow color={C.glowMid} label="Дошёл до конца" value={formatCount(n(stats.runsCompleted))} />
          <LegendRow color={C.danger} label="Пал в бою" value={formatCount(n(stats.runsDied))} />
          <div style={{ fontSize: 11, lineHeight: 1.3, color: C.textDim }}>Из повергнутых элитных <span style={{ whiteSpace: 'nowrap' }}>— {formatCount(n(stats.killsElite))}</span></div>
        </div>
      </Appear>

      <div className="rp-hs-grid">
        <SmallTile index={4} iconNode={smallIcon('event_chest')} value={n(stats.chestsOpened)} label="сундуков открыто" />
        <SmallTile index={5} iconNode={<BarrelIcon size={30} />} value={n(stats.breakablesBroken)} label="бочек и кувшинов" />
        <SmallTile index={6} iconNode={smallIcon('potion_1_vial')} value={n(stats.potionsDrunk)} label="зелий выпито" />
        <SmallTile index={7} iconNode={smallIcon('icon_armor')} value={n(stats.parries)} label="ударов отбито" />
        <SmallTile index={8} iconNode={smallIcon('icon_trophy')} value={n(stats.trophiesEarned)} label="трофеев добыто" />
        <SmallTile index={9} iconNode={smallIcon('icon_hunter_badge')} value={n(stats.questsCompleted)} label="заданий выполнено" />
      </div>

      <div style={{ marginTop: 12, fontSize: 11, lineHeight: 1.4, textAlign: 'center', color: C.textDim }}>
        ⌛ В вылазках: {formatTime(stats.timeInRunsMs)} · {stats.since === null ? 'летопись начнётся с первой вылазки' : `летопись ведётся с ${formatDate(stats.since)}`}
      </div>
    </div>
  )
}
