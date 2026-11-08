import { C, FONT_DISPLAY } from './theme'
import { RUNES, RUNE_KINDS, RUNE_DROP_MIN_LEVEL, runeLimit, type RuneKind } from '../runes'
import type { RuneState } from '../api'

// РУНЫ (09.11.2026, docs/items.md, «РУНЫ»): вкладка «Руны» в инвентаре и блок
// «Получено рун» на «Статистике» героя. Числа (цены, прибавки, лимиты) — общий
// каталог runes.ts, тот же, что применяет сервер.

const icon = (file: string) => `${import.meta.env.BASE_URL}assets/icons/${file}`

/**
 * Три карточки рун: иконка, сколько есть, что даёт, цена в значках и кнопка
 * «Использовать». Кнопка неактивна, если руны нет, значков не хватает или идёт
 * забег — причина подписью под ней. wide — телефон набок: три в ряд.
 */
export function RuneInventory({
  runes,
  hunterBadges,
  runActive,
  pending,
  error,
  wide,
  onUse,
}: {
  runes: RuneState | null
  hunterBadges: number | null
  runActive: boolean
  pending: RuneKind | null
  error: string | null
  wide: boolean
  onUse: (kind: RuneKind) => void
}) {
  if (runes === null) {
    return (
      <div style={{ margin: '0 8px', padding: '10px 12px', borderRadius: 8, background: C.nicheDeep, border: `1px solid ${C.stoneDark}`, fontSize: 12, color: C.textDim }}>
        Сервер не назвал руны — открой игру заново.
      </div>
    )
  }
  return (
    <div style={{ padding: '0 8px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: wide ? 'repeat(3, minmax(0, 1fr))' : 'minmax(0, 1fr)', gap: 8 }}>
        {RUNE_KINDS.map((kind) => {
          const spec = RUNES[kind]
          const have = runes.stock[kind]
          const reason = runActive ? 'Идёт забег'
            : have < 1 ? 'Нет руны'
              : hunterBadges === null ? 'Значки охотника неизвестны'
                : hunterBadges < spec.price ? `Не хватает значков: нужно ${spec.price}`
                  : null
          const busy = pending !== null
          const disabled = reason !== null || busy
          return (
            <div key={kind} data-rune-card={kind} style={{
              boxSizing: 'border-box', minWidth: 0,
              display: 'flex', flexDirection: wide ? 'column' : 'row', alignItems: wide ? 'stretch' : 'center', gap: 10,
              padding: 10, borderRadius: 10, background: C.niche, border: `1px solid ${C.stoneDark}`,
            }}>
              <div style={{ position: 'relative', flex: 'none', alignSelf: 'center', width: 56, height: 56, borderRadius: 8, background: C.nicheDeep, boxShadow: 'inset 0 2px 5px rgba(0,0,0,0.5)' }}>
                <img src={icon(spec.icon)} alt={spec.nameRu} style={{ width: '100%', height: '100%', objectFit: 'contain', opacity: have > 0 ? 1 : 0.45 }} />
                <div style={{ position: 'absolute', right: 2, bottom: 2, fontSize: 10, lineHeight: '12px', color: C.bone, background: 'rgba(8,6,10,0.72)', borderRadius: 3, padding: '0 3px' }}>×{have}</div>
              </div>
              <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4, textAlign: wide ? 'center' : 'left' }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontSize: 14, color: C.textMain }}>{spec.nameRu}</div>
                <div style={{ fontSize: 12, color: C.bone }}>{spec.effectLine}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: wide ? 'center' : 'flex-start', fontSize: 12, color: hunterBadges !== null && hunterBadges < spec.price ? C.danger : C.textDim }}>
                  <img src={icon('icon_hunter_badge.png')} alt="Значки охотника" style={{ width: 16, height: 16 }} />
                  {spec.price}
                </div>
                <button type="button" disabled={disabled} onClick={() => onUse(kind)}
                  style={{
                    minHeight: 44, marginTop: 2, borderRadius: 8, fontFamily: FONT_DISPLAY, fontSize: 13,
                    border: `1px solid ${disabled ? C.stoneDark : C.glowEdge}`,
                    background: disabled ? C.nicheDeep : 'linear-gradient(180deg, #4a3a22, #2e2416)',
                    color: disabled ? C.textDim : C.glowCore,
                    cursor: disabled ? 'default' : 'pointer',
                  }}>
                  {pending === kind ? 'Применяю...' : 'Использовать'}
                </button>
                {reason !== null && <div style={{ fontSize: 11, color: C.textDim }}>{reason}</div>}
              </div>
            </div>
          )
        })}
      </div>
      {error !== null && <div style={{ marginTop: 8, fontSize: 12, color: C.danger, textAlign: 'center' }}>{error}</div>}
      <div style={{ marginTop: 10, fontSize: 11, color: C.textDim, textAlign: 'center' }}>
        Руны не занимают место в сумке. Бонус от руны — навсегда.
      </div>
    </div>
  )
}

/**
 * «Получено рун»: три полоски получено / лимит текущего уровня, число по центру.
 * До RUNE_DROP_MIN_LEVEL — строка вместо полосок.
 */
export function RuneStats({ runes, level }: { runes: RuneState | null; level: number }) {
  return (
    <div data-rune-stats="" style={{ margin: '0 8px', padding: 12, borderRadius: 10, background: C.niche, border: `1px solid ${C.stoneDark}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 14, color: C.textMain }}>Получено рун</div>
      {level < RUNE_DROP_MIN_LEVEL ? (
        <div style={{ fontSize: 13, color: C.textDim }}>Руны начнут падать с {RUNE_DROP_MIN_LEVEL} уровня</div>
      ) : runes === null ? (
        <div style={{ fontSize: 13, color: C.textDim }}>Сервер не назвал руны.</div>
      ) : (
        <>
          {RUNE_KINDS.map((kind) => {
            const spec = RUNES[kind]
            const limit = runeLimit(kind, level)
            const found = runes.found[kind]
            const frac = limit > 0 ? Math.min(1, found / limit) : 0
            return (
              <div key={kind} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <img src={icon(spec.icon)} alt="" style={{ width: 28, height: 28, flex: 'none' }} />
                <div style={{ flex: '0 0 auto', width: 'clamp(84px, 26vmin, 120px)', fontSize: 12, color: C.textMain, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{spec.nameRu}</div>
                <div style={{ position: 'relative', flex: '1 1 auto', minWidth: 0, height: 20, borderRadius: 6, background: C.nicheDeep, border: `1px solid ${C.stoneDark}`, overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${frac * 100}%`, background: spec.color, opacity: 0.85 }} />
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: C.textMain, textShadow: '0 1px 2px #000, 0 0 2px #000' }}>
                    {found} / {limit}
                  </div>
                </div>
              </div>
            )
          })}
        </>
      )}
      <div style={{ fontSize: 11, lineHeight: 1.4, color: C.textDim }}>
        Чем больше рун получено от лимита, тем реже падает следующая такая руна. Лимит растёт с уровнем. Использование рун не уменьшает прогресс.
      </div>
    </div>
  )
}
