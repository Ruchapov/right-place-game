// Портной — пятый житель Убежища (14.11.2026, docs/shop.md, «ПОРТНОЙ»; задача —
// docs/skins-task.md, раздел 7 главнее разделов 1–6). Четыре раздела:
//   1. Облик тела — Обычная / Золотая / Багровая / Фиолетовая, превью — кадр
//      стойки из листа облика, цена или «Куплено», «Надеть».
//   2. Цвет удара — Обычный / Красный / Фиолетовый / Золотой, превью — кадр 6
//      удара (вспышка) из листа надетой брони с этим цветом.
//   3. Плащи — три карточки: бонусы на текущем уровне, «+L / 20», замок по
//      уровню, «Надеть» и «Пришить нашивку».
//   4. Закалка облика — Кузнечное клеймо: броня и оружие, «Поставить клеймо».
// Числа бонусов — только из общего каталога skins.ts (cloakBonus, brandBonus):
// карточка пишет ровно то, чем бьётся бой и что держит сервер.
import { useRef, useState, type CSSProperties } from 'react'
import { C, FONT_DISPLAY } from './theme'
import {
  ARMOR_NONE_NAME, ARMOR_SKINS, CLOAKS, SKIN_UPGRADE_MAX_LEVEL, SLASH_NONE_NAME, SLASH_SKINS, TAILOR_ITEMS,
  brandBonus, cloakBonus, upgradeItemFor, upgradePriceRp,
  type ArmorSkinId, type CloakColor, type CloakId, type SkinState, type SlashSkinId, type UpgradeTarget,
} from '../skins'
import { RequestError, buySkin, equipSkins, patchSkin, type SkinActionResult } from '../api'
import * as HC from '../explore/constants'
import { heroAttackSrc, heroSheetSrc } from '../explore/assets'

const ICONS = `${import.meta.env.BASE_URL}assets/icons`

/** Процент без лишних нулей: 0.035 → «3.5%», 0.1 → «10%». */
function pct(x: number): string {
  return `${+(x * 100).toFixed(1)}%`
}

/** Строка бонусов плаща на уровне L — то, чем он бьётся в бою. */
function cloakBonusLine(id: CloakId, level: number): string {
  const b = cloakBonus(id, level)
  if (id === 'ash') return `Поглощает ${pct(b.damageAbsorbFrac)} урона. Зелья лечат на ${pct(b.potionHealBonusFrac)} больше`
  if (id === 'midnight') return `Удар мечом быстрее на ${pct(b.attackSpeedFrac)}. Таран перезаряжается на ${pct(b.dashCooldownCutFrac)} быстрее`
  return `Оглушение после парирования дольше на ${+(b.parryStunExtraMs / 1000).toFixed(2)} с. Первый удар после парирования сильнее на ${pct(b.parryStrikeBonusFrac)}`
}

/** Строка бонусов клейма на уровне L. */
function brandBonusLine(target: 'armor' | 'weapon', level: number): string {
  const b = brandBonus(target, level)
  if (target === 'armor') return `+${pct(b.maxHpFrac)} к здоровью, урон по тебе меньше на ${pct(b.damageReduceFrac)}`
  return `+${pct(b.swordDamageFrac)} к урону мечом, шанс крита ×2 — ${pct(b.critChance)}`
}

/**
 * Строка «что даст следующая нашивка/клеймо» (17.11.2026): бонусы уровня L+1
 * той же функцией, что строка текущих; на пределе — «Максимум».
 */
function NextLevelLine({ level, line }: { level: number; line: (l: number) => string }) {
  const text = level >= SKIN_UPGRADE_MAX_LEVEL ? 'Максимум' : `На +${level + 1}: ${line(level + 1)}`
  return <div style={{ fontSize: 11, color: C.glowCore, lineHeight: 1.35, marginTop: 2, opacity: 0.85 }}>{text}</div>
}

/** Цвет плаща для плашки-образца (HSV каталога при яркости побольше). */
function swatch(color: CloakColor): string {
  if (color === null) return '#6f6a72'
  const { h, s } = color
  const v = Math.min(1, color.v * 1.9)
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))))
  }
  return `rgb(${f(5)}, ${f(3)}, ${f(1)})`
}

/**
 * Кадр листа героя фоном: col/row — клетка 394×296, w — ширина окна. Фигура
 * занимает середину клетки, поэтому окно — обрезка вокруг неё: по ширине доля
 * cropW клетки по центру, по высоте — от 40 px сверху до низа клетки.
 */
function framePreview(src: string, col: number, row: number, w: number, cropW = 0.55): CSSProperties {
  const top = 40
  const k = w / (HC.HERO_CELL_W * cropW)
  const left = (HC.HERO_CELL_W * (1 - cropW)) / 2
  return {
    width: w,
    height: Math.round((HC.HERO_CELL_H - top) * k),
    backgroundImage: `url(${src})`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: `${HC.HERO_CELL_W * 12 * k}px auto`,
    backgroundPosition: `${-(col * HC.HERO_CELL_W + left) * k}px ${-(row * HC.HERO_CELL_H + top) * k}px`,
  }
}

export function TailorShop({ skins, rp, level, online, columns, onState, onRefreshBalance }: {
  /** null — сервер не назвал (старый сервер или мусор). */
  skins: SkinState | null
  rp: number | null
  level: number
  /** Есть ли сервер (Telegram). Заглушка вне Telegram ничего не покупает. */
  online: boolean
  columns: number
  /** Новое состояние Портного и RP после удачного ответа. */
  onState: (r: SkinActionResult) => void
  onRefreshBalance: () => Promise<void>
}) {
  const [pending, setPending] = useState<string | null>(null)
  const pendingRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ key: string; text: string; ok: boolean } | null>(null)

  async function run(key: string, action: (token: string) => Promise<SkinActionResult>, after?: (r: SkinActionResult) => void) {
    const token = localStorage.getItem('jwt')
    if (!online || !token) {
      setError('Портной работает только в Telegram — здесь сервера нет.')
      return
    }
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(key)
    setError(null)
    setResult(null)
    try {
      const r = await action(token)
      if (r.skins === null || r.rp === null) {
        // Действие прошло, но чисел нет — не показывать старые как новые.
        console.error('Tailor: сервер не назвал итог', r)
        await onRefreshBalance()
        return
      }
      onState(r)
      after?.(r)
    } catch (e) {
      console.error('Tailor action failed', key, e)
      const refusal = e instanceof RequestError ? e.serverError : null
      if (refusal === 'Run in progress') { setError('Пока идёт вылазка, Портной не работает.'); return }
      if (refusal === 'Not enough RP') { setError('Не хватает RP.'); await onRefreshBalance(); return }
      if (refusal === 'Max level') { setError('Уже предельный уровень.'); return }
      if (refusal === 'Cloak locked') { setError('Этот плащ ещё закрыт по уровню.'); return }
      if (refusal === 'Already owned' || refusal === 'State changed, retry' || refusal === 'Not owned') {
        await onRefreshBalance()
        setError('Данные изменились — показаны актуальные.')
        return
      }
      if (e instanceof RequestError && e.retryable) {
        setError(key.startsWith('patch:')
          ? 'Ответ не пришёл. Нажми ещё раз — второй раз не спишется.'
          : 'Ответ не пришёл. Нажми «Обновить» в шапке Убежища или попробуй ещё раз.')
        return
      }
      setError('Портной отказал — попробуй позже.')
    } finally {
      pendingRef.current = false
      setPending(null)
    }
  }

  function upgrade(target: UpgradeTarget, cloakId?: CloakId) {
    const key = `patch:${target}:${cloakId ?? ''}`
    void run(key, (t) => patchSkin(t, target, cloakId), (r) => {
      const res = r as Awaited<ReturnType<typeof patchSkin>>
      const lvl = res.newLevel ?? 0
      const what = target === 'cloak' ? 'Плащ' : target === 'armor' ? 'Броня' : 'Оружие'
      if (res.success === true) setResult({ key, ok: true, text: `Успех! ${what} +${lvl}${res.replayed ? ' (попытка уже засчитана)' : ''}` })
      else setResult({ key, ok: false, text: target === 'cloak' ? 'Нашивка порвалась. Уровень сброшен до 0' : 'Клеймо треснуло. Уровень сброшен до 0' })
    })
  }

  if (skins === null) {
    return (
      <div style={{ margin: '0 8px 10px', padding: '8px 10px', borderRadius: 8, background: C.nicheDeep, border: `1px solid ${C.stoneDark}`, fontSize: 11, color: C.textDim }}>
        Профиль не загружен — Портной недоступен. Нажми «Обновить баланс» или зайди позже.
      </div>
    )
  }

  const busy = pending !== null
  const card: CSSProperties = {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: 6, minWidth: 0,
    background: C.nicheDeep, border: `1px solid ${C.stoneDark}`, borderRadius: 10, boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.45)',
  }
  const head: CSSProperties = { fontSize: 10, letterSpacing: 1, color: C.textDim, margin: '14px 0 7px', fontFamily: FONT_DISPLAY }
  const btn = (disabled: boolean, primary = true): CSSProperties => ({
    width: '100%', minHeight: 36, borderRadius: 8, fontSize: 12, padding: '0 4px',
    border: `1px solid ${disabled ? C.stoneDark : C.glowEdge}`,
    background: disabled ? C.niche : primary ? C.glowCore : C.nicheDeep,
    color: disabled ? C.textDim : primary ? C.appBg : C.glowCore,
    cursor: disabled ? 'default' : 'pointer',
  })
  const grid: CSSProperties = { display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 8 }
  const rpIcon = <img src={`${ICONS}/icon_rp.png`} alt="" width={14} height={14} style={{ display: 'inline-block', verticalAlign: 'middle' }} />
  const note = <div style={{ fontSize: 10, color: C.textDim, lineHeight: 1.35, textAlign: 'center' }}>Шанс 50%. Неудача — уровень сбросится до 0</div>

  // Карточка покупаемого облика или удара: превью, имя, цена/«Куплено», кнопка.
  function lookCard(kind: 'armor' | 'slash', id: ArmorSkinId | SlashSkinId, name: string, price: number | null, preview: CSSProperties) {
    const owned = id === 'none' || (kind === 'armor' ? skins!.ownedArmor.includes(id as never) : skins!.ownedSlash.includes(id as never))
    const worn = kind === 'armor' ? skins!.armor === id : skins!.slash === id
    const canBuy = !owned && price !== null && rp !== null && rp >= price
    const key = `${kind}:${id}`
    return (
      <div key={key} data-tailor-look={key} style={{ ...card, borderColor: worn ? C.glowEdge : C.stoneDark }}>
        <div style={{ ...preview, maxWidth: '100%' }} />
        <div style={{ fontSize: 11, color: C.textMain, textAlign: 'center', minHeight: 28, display: 'flex', alignItems: 'center' }}>{name}</div>
        <div style={{ fontSize: 11, color: owned ? C.bone : C.textDim }}>
          {owned ? (id === 'none' ? 'Есть у всех' : 'Куплено') : <>{price} {rpIcon}</>}
        </div>
        {worn ? (
          <button disabled style={btn(true)}>Надето</button>
        ) : owned ? (
          <button disabled={busy} style={btn(busy, false)} onClick={() => void run(`equip:${key}`, (t) => equipSkins(t, kind === 'armor' ? { armor: id as ArmorSkinId } : { slash: id as SlashSkinId }))}>
            {pending === `equip:${key}` ? '…' : 'Надеть'}
          </button>
        ) : (
          <button disabled={busy || !canBuy} style={btn(busy || !canBuy)} onClick={() => void run(`buy:${key}`, (t) => buySkin(t, kind, id as never))}>
            {pending === `buy:${key}` ? '…' : 'Купить'}
          </button>
        )}
      </div>
    )
  }

  // Кнопка улучшения: свой предмет есть — «(есть N)», нет — «— 100 RP».
  function upgradeButton(target: UpgradeTarget, label: string, current: number, cloakId?: CloakId, locked = false) {
    const item = upgradeItemFor(target)
    const have = item === 'patch' ? skins!.patchCount : skins!.brandCount
    const price = upgradePriceRp(target)
    const max = current >= SKIN_UPGRADE_MAX_LEVEL
    const affordable = have >= 1 || (rp !== null && rp >= price)
    const disabled = busy || max || locked || !affordable
    const key = `patch:${target}:${cloakId ?? ''}`
    return (
      <button data-tailor-upgrade={key} disabled={disabled} style={btn(disabled)} onClick={() => upgrade(target, cloakId)}>
        {pending === key ? '…' : max ? 'Предельный уровень' : <>{label} {have >= 1 ? `(есть ${have})` : <>— {price} {rpIcon}</>}</>}
      </button>
    )
  }

  const resultLine = (key: string) => result !== null && result.key === key && (
    <div style={{ fontSize: 11, color: result.ok ? C.glowCore : C.danger, textAlign: 'center' }}>{result.text}</div>
  )

  return (
    <div data-tailor="" style={{ padding: '0 8px', marginBottom: 16, textAlign: 'left' }}>
      {/* Баланс: RP, нашивки, клейма. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 12px', background: C.nicheDeep, border: `1px solid ${C.stoneDark}`, borderRadius: 8 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <img src={`${ICONS}/icon_rp.png`} alt="RP" width={22} height={22} style={{ display: 'block', objectFit: 'contain' }} />
          <span data-tailor-rp="" style={{ fontFamily: FONT_DISPLAY, fontSize: 16, color: C.bone }}>{rp ?? '—'}</span>
        </span>
        {TAILOR_ITEMS.map((t) => (
          <span key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: C.textDim }}>
            <img src={`${ICONS}/${t.icon}`} alt="" width={20} height={20} style={{ display: 'block', objectFit: 'contain' }} />
            {t.id === 'patch' ? 'Нашивок' : 'Клейм'}: <span style={{ color: C.bone }}>{t.id === 'patch' ? skins.patchCount : skins.brandCount}</span>
          </span>
        ))}
      </div>
      {error !== null && <div data-tailor-error="" style={{ marginTop: 8, fontSize: 11, color: C.danger }}>{error}</div>}

      <div style={head}>ОБЛИК ТЕЛА</div>
      <div style={grid}>
        {lookCard('armor', 'none', ARMOR_NONE_NAME, null, framePreview(heroSheetSrc(HC.HERO_IDLE_SRC, 'idle.png', 'none'), 0, 0, 84))}
        {ARMOR_SKINS.map((s) => lookCard('armor', s.id, s.nameRu, s.price, framePreview(heroSheetSrc(HC.HERO_IDLE_SRC, 'idle.png', s.id), 0, 0, 84)))}
      </div>

      <div style={head}>ЦВЕТ УДАРА</div>
      <div style={grid}>
        {lookCard('slash', 'none', SLASH_NONE_NAME, null, framePreview(heroAttackSrc({ armor: skins.armor, slash: 'none' }), 6, 0, 84, 0.8))}
        {SLASH_SKINS.map((s) => lookCard('slash', s.id, s.nameRu, s.price, framePreview(heroAttackSrc({ armor: skins.armor, slash: s.id }), 6, 0, 84, 0.8)))}
      </div>

      <div style={head}>ПЛАЩИ</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {CLOAKS.map((cl) => {
          const lvl = skins.cloakLevels[cl.id]
          const locked = level < cl.unlockLevel
          const worn = skins.cloak === cl.id
          const key = `patch:cloak:${cl.id}`
          return (
            <div key={cl.id} data-tailor-cloak={cl.id} style={{ ...card, alignItems: 'stretch', borderColor: worn ? C.glowEdge : C.stoneDark, opacity: locked ? 0.6 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 28, height: 28, borderRadius: 6, background: swatch(cl.color), border: `1px solid ${C.stoneDark}`, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: C.textMain }}>{cl.nameRu}</div>
                  <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.35 }}>{cloakBonusLine(cl.id, locked ? 0 : lvl)}</div>
                  {!locked && <NextLevelLine level={lvl} line={(l) => cloakBonusLine(cl.id, l)} />}
                </div>
                <div style={{ fontFamily: FONT_DISPLAY, fontSize: 14, color: C.glowCore, flexShrink: 0 }}>+{lvl} / {SKIN_UPGRADE_MAX_LEVEL}</div>
              </div>
              {locked ? (
                <div style={{ fontSize: 11, color: C.textDim, textAlign: 'center' }}>🔒 С {cl.unlockLevel} уровня</div>
              ) : (
                <div style={{ display: 'flex', gap: 6 }}>
                  <div style={{ flex: '0 0 32%' }}>
                    {worn
                      ? <button disabled style={btn(true)}>Надет</button>
                      : <button disabled={busy} style={btn(busy, false)} onClick={() => void run(`equip:cloak:${cl.id}`, (t) => equipSkins(t, { cloak: cl.id }))}>{pending === `equip:cloak:${cl.id}` ? '…' : 'Надеть'}</button>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>{upgradeButton('cloak', 'Пришить нашивку', lvl, cl.id, locked)}</div>
                </div>
              )}
              {!locked && note}
              {resultLine(key)}
            </div>
          )
        })}
      </div>

      <div style={head}>ЗАКАЛКА ОБЛИКА</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(['armor', 'weapon'] as const).map((target) => {
          const lvl = skins.brandLevels[target]
          return (
            <div key={target} data-tailor-brand={target} style={{ ...card, alignItems: 'stretch' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <img src={`${ICONS}/item_brand.png`} alt="" width={28} height={28} style={{ display: 'block', objectFit: 'contain', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: C.textMain }}>{target === 'armor' ? 'Броня' : 'Оружие'}</div>
                  <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.35 }}>{brandBonusLine(target, lvl)}</div>
                  <NextLevelLine level={lvl} line={(l) => brandBonusLine(target, l)} />
                </div>
                <div style={{ fontFamily: FONT_DISPLAY, fontSize: 14, color: C.glowCore, flexShrink: 0 }}>+{lvl} / {SKIN_UPGRADE_MAX_LEVEL}</div>
              </div>
              {upgradeButton(target, 'Поставить клеймо', lvl)}
              {note}
              {resultLine(`patch:${target}:`)}
            </div>
          )
        })}
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: C.textDim, lineHeight: 1.45 }}>
        Облик и цвет удара покупаются за RP навсегда. Плащи бесплатные, открываются по уровню; носить можно один.
        Нашивки и клейма изредка падают с групп врагов и боссов.
      </div>
    </div>
  )
}
