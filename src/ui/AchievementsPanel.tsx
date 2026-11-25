// Достижения (20.11.2026, docs/achievements.md): вкладка «Достижения» экрана
// героя и карточка «Новое достижение» на экране итогов вылазки.
//
// Все достижения ТАЙНЫЕ: каталога на клиенте нет — список, условия и прогресс
// игрок не видит. Сервер присылает только полученные (AchievementView):
// название, фразу, строку награды, иконку печати. Общее число не показывается
// нигде — только «Найдено N».
//
// Тексты — дословно из задачи; свои не придумывать.
import type { CSSProperties } from 'react'
import { C, FONT_DISPLAY } from './theme'
import type { AchievementView } from '../api'

const ICONS = `${import.meta.env.BASE_URL}assets/icons/`

/** Ключи достижений, у которых на карточке есть «Выучить» (обучалка навыков). */
const LEARN_ACHIEVEMENTS = ['first_steps_1', 'first_steps_2', 'first_steps_3'] as const
function isLearnAchievement(key: string): boolean {
  return (LEARN_ACHIEVEMENTS as readonly string[]).includes(key)
}

const CSS = `
.rp-ach-seal { position: relative; flex: none; width: 52px; height: 52px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #a3362f, #5c1612 70%, #3a0d0b);
  box-shadow: 0 0 0 2px #2a0a08, 0 0 0 4px ${C.glowEdge}, 0 2px 6px rgba(0,0,0,.6), inset 0 2px 4px rgba(255,190,150,.25);
  display: flex; align-items: center; justify-content: center; }
.rp-ach-seal img { width: 30px; height: 30px; object-fit: contain; filter: drop-shadow(0 1px 2px rgba(0,0,0,.8)); }
@keyframes rp-ach-in { from { opacity: 0; transform: translateY(10px) scale(.97); } to { opacity: 1; transform: none; } }
.rp-ach-new { animation: rp-ach-in 520ms cubic-bezier(.2,.7,.3,1) both; }
@media (prefers-reduced-motion: reduce) { .rp-ach-new { animation: none; } }
.rp-red-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${C.danger};
  box-shadow: 0 0 0 2px ${C.outline}; flex: none; }
`

export function AchievementCss() {
  return <style>{CSS}</style>
}

export function AchievementSeal({ icon, size = 52 }: { icon: string; size?: number }) {
  return (
    <div className="rp-ach-seal" style={size !== 52 ? { width: size, height: size } : undefined}>
      <img src={`${ICONS}${icon}`} alt="" style={size !== 52 ? { width: size * 0.58, height: size * 0.58 } : undefined} />
    </div>
  )
}

/** Красная точка «есть новое». */
export function RedDot({ style }: { style?: CSSProperties }) {
  return <span className="rp-red-dot" aria-label="Новое" style={style} />
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

const smallBtn = (primary: boolean): CSSProperties => ({
  minHeight: 44, padding: '0 14px', borderRadius: 8, cursor: 'pointer', boxSizing: 'border-box',
  fontFamily: FONT_DISPLAY, fontSize: 12, flex: '1 1 auto', minWidth: 0,
  border: `1px solid ${primary ? C.glowEdge : C.stoneDark}`,
  background: primary ? 'linear-gradient(180deg, #4a3a22, #2e2416)' : C.niche,
  color: primary ? C.glowCore : C.textMain,
})

export type AchievementsPanelProps = {
  /** null — список ещё не загружен или не загрузился (status). */
  list: AchievementView[] | null
  status: 'loading' | 'ready' | 'error' | 'offline'
  unseen: ReadonlySet<string>
  /** Какое действие сейчас идёт (key) — кнопки этой карточки гаснут. */
  pendingKey: string | null
  /** Отказ последнего действия: key карточки и текст. */
  error: { key: string; text: string } | null
  onClaim: (key: string) => void
  onLearn: (key: string) => void
  onRetry: () => void
}

export function AchievementsPanel(p: AchievementsPanelProps) {
  const head = (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, margin: '0 0 10px' }}>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 15, color: C.glowCore, letterSpacing: 1 }}>Достижения</div>
      {p.list !== null && <div style={{ fontSize: 12, color: C.textDim }}>Найдено {p.list.length}</div>}
    </div>
  )
  const card: CSSProperties = {
    background: C.nicheDeep, border: `1px solid ${C.stoneDark}`, borderRadius: 10,
    boxShadow: 'inset 0 2px 6px rgba(0,0,0,.5)', padding: 12, boxSizing: 'border-box', minWidth: 0,
  }
  if (p.list === null) {
    return (
      <div data-achievements="" style={{ ...card, textAlign: 'left' }}>
        <AchievementCss />
        {head}
        <div style={{ fontSize: 12, color: p.status === 'error' ? C.danger : C.textDim }}>
          {p.status === 'loading' ? 'Загружаем…' : p.status === 'offline' ? 'Достижения видны только в Telegram.' : 'Достижения не загрузились.'}
        </div>
        {p.status === 'error' && (
          <button type="button" onClick={p.onRetry} style={{ ...smallBtn(false), marginTop: 10, width: '100%' }}>Ещё раз</button>
        )}
      </div>
    )
  }
  return (
    <div data-achievements="" style={{ minWidth: 0, textAlign: 'left' }}>
      <AchievementCss />
      <div style={{ ...card, marginBottom: 10 }}>
        {head}
        {p.list.length === 0 && (
          <div style={{ fontSize: 13, color: C.textDim, fontStyle: 'italic', lineHeight: 1.45 }}>
            Пока ни одного. Тьма ещё присматривается к тебе.
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {p.list.map((a) => {
          const busy = p.pendingKey !== null
          // Титулы убраны 23.11.2026 (решение Андрея): у карточки только «Забрать»
          // и «Выучить», и то не у всех — ряд кнопок рисуется, если есть что.
          const learn = isLearnAchievement(a.key) && !a.rewardPending
          const err = p.error?.key === a.key ? p.error.text : null
          return (
            <div key={a.key} data-achievement={a.key} style={{ ...card, border: `1px solid ${a.rewardPending || p.unseen.has(a.key) ? C.glowEdge : C.stoneDark}` }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', minWidth: 0 }}>
                <AchievementSeal icon={a.icon} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14, color: C.textMain, overflowWrap: 'anywhere' }}>{a.title}</div>
                    {(p.unseen.has(a.key) || a.rewardPending) && <RedDot />}
                  </div>
                  <div style={{ fontSize: 12, color: C.bone, fontStyle: 'italic', lineHeight: 1.45, marginTop: 4 }}>{a.phrase}</div>
                  <div style={{ fontSize: 12, color: C.glowCore, marginTop: 6 }}>{a.reward}</div>
                  <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>
                    {formatDate(a.earnedAt)}
                  </div>
                </div>
              </div>
              {a.rewardPending && (
                <div style={{ fontSize: 12, color: C.textDim, marginTop: 8 }}>Сумка полна — награда ждёт во вкладке Достижения</div>
              )}
              {err !== null && <div style={{ fontSize: 12, color: C.danger, marginTop: 8 }}>{err}</div>}
              {(a.rewardPending || learn) && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                  {a.rewardPending && (
                    <button type="button" disabled={busy} onClick={() => p.onClaim(a.key)} style={{ ...smallBtn(true), opacity: busy ? 0.55 : 1 }}>Забрать</button>
                  )}
                  {learn && (
                    <button type="button" disabled={busy} onClick={() => p.onLearn(a.key)} style={{ ...smallBtn(true), opacity: busy ? 0.55 : 1 }}>Выучить</button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Карточка «Новое достижение» на экране итогов вылазки (и в окне о прошлой
 * вылазке). Одна на каждое новое достижение.
 */
export function NewAchievementCard({ a, compact = false }: { a: AchievementView; compact?: boolean }) {
  return (
    <div className="rp-ach-new" data-new-achievement={a.key} style={{
      display: 'flex', gap: 10, alignItems: 'flex-start', minWidth: 0, boxSizing: 'border-box',
      background: 'linear-gradient(180deg, rgba(74,58,34,.55), rgba(30,24,18,.75))',
      border: `1px solid ${C.glowEdge}`, borderRadius: 10, padding: compact ? 8 : 10, textAlign: 'left',
    }}>
      <AchievementCss />
      <AchievementSeal icon={a.icon} size={compact ? 40 : 48} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, letterSpacing: 1, color: C.glowCore, fontFamily: FONT_DISPLAY }}>Новое достижение</div>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: compact ? 13 : 14, color: C.textMain, marginTop: 2, overflowWrap: 'anywhere' }}>{a.title}</div>
        <div style={{ fontSize: 12, color: C.bone, fontStyle: 'italic', lineHeight: 1.4, marginTop: 3 }}>{a.phrase}</div>
        <div style={{ fontSize: 12, color: C.glowCore, marginTop: 4 }}>{a.reward}</div>
        {a.rewardPending && (
          <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>Сумка полна — награда ждёт во вкладке Достижения</div>
        )}
      </div>
    </div>
  )
}

const LEARN_CSS = `
@keyframes rp-learn-pulse { 0%,100% { box-shadow: 0 0 0 2px ${C.glowEdge}, 0 0 10px rgba(245,188,91,.35); } 50% { box-shadow: 0 0 0 2px ${C.glowCore}, 0 0 18px rgba(245,188,91,.7); } }
.rp-learn-glow { animation: rp-learn-pulse 1.4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .rp-learn-glow { animation: none; box-shadow: 0 0 0 2px ${C.glowCore}; } }
`

/**
 * Подсказка обучалки навыков (20.11.2026) — пузырь над подсвеченным местом.
 * onOk — кнопка «Понятно»; без неё пузырь закрывает действие на подсвеченном.
 */
export function LearnBubble({ text, onOk }: { text: string; onOk?: () => void }) {
  return (
    <div data-learn-bubble="" style={{ textAlign: 'left',
      position: 'relative', boxSizing: 'border-box', minWidth: 0,
      background: 'linear-gradient(180deg, #4a3a22, #2e2416)', border: `1px solid ${C.glowCore}`,
      borderRadius: 10, padding: '10px 12px', color: C.textMain, fontSize: 13, lineHeight: 1.45,
      boxShadow: '0 4px 14px rgba(0,0,0,.55)',
    }}>
      <style>{LEARN_CSS}</style>
      <div>{text}</div>
      {onOk && (
        <button type="button" onClick={onOk} style={{
          marginTop: 8, minHeight: 44, width: '100%', borderRadius: 8, cursor: 'pointer',
          border: `1px solid ${C.glowEdge}`, background: C.nicheDeep, color: C.glowCore, fontFamily: FONT_DISPLAY, fontSize: 13,
        }}>Понятно</button>
      )}
    </div>
  )
}
