// Общий вид экрана гильдии (01.11.2026, макеты guild_redesign): цвета сверх
// палитры C, кнопки, пути к картинкам. Только данные и функции — компоненты в
// common.tsx (fast refresh).
import type { CSSProperties } from 'react'
import { C, FONT_DISPLAY } from '../theme'

const BASE = import.meta.env.BASE_URL
export const ASSET = (file: string) => `${BASE}assets/${file}`
export const ICON = (file: string) => `${BASE}assets/icons/${file}`
export const GUILD_ART = (file: string) => `${BASE}assets/guild/${file}`

/** Обычный текст — не Cinzel (в Cinzel нет кириллицы). */
export const TEXT_FONT = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"

/** Цвета макетов, которых нет в палитре C. */
export const G = {
  textSoft: C.stoneLight,   // приглушённый текст макетов (#A497A4)
  card: '#211E27',          // карточка здания, строка состава
  sheet: '#1E1B23',         // нижняя карточка, полоса ввода чата
  rowBorder: '#2E2A34',
  green: '#6FAE5A',
  greenText: '#9BD487',
  greenBg: '#22301F',
  pink: '#E89A9C',
  redBorder: '#6E3438',
  redBg: '#2A1C1E',
  amberBg: '#2A2420',       // своя строка, плашка улучшения
  requestBg: '#241F1A',
  leaderBg: '#3A2C14',      // бейдж главы, свой пузырь чата
  deputyBg: '#2C2A36',
  disabledText: '#6E6470',
  shade: 'rgba(21,18,24,.85)',
}

export const HALL_BG: CSSProperties = {
  backgroundImage: `linear-gradient(180deg,rgba(23,20,28,.35) 0%,rgba(23,20,28,.75) 60%,${C.appBg} 100%),url(${ASSET('refuge_bg.jpg')})`,
  backgroundSize: 'cover',
  backgroundPosition: 'center 30%',
}

export const PAGE_BG: CSSProperties = {
  backgroundColor: C.appBg,
  backgroundImage: `url(${ASSET('meta_bg.jpg')})`,
  backgroundSize: 'cover',
  backgroundPosition: 'center',
}

/** Золотая кнопка действия. */
export function goldBtn(enabled: boolean, height = 44): CSSProperties {
  return {
    height, minHeight: 44, minWidth: 44, borderRadius: 10, padding: '0 12px', boxSizing: 'border-box',
    border: `1px solid ${enabled ? C.glowCore : C.niche}`,
    background: enabled ? `linear-gradient(${C.glowMid},${C.glowEdge})` : G.card,
    color: enabled ? C.appBg : G.disabledText,
    fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14,
    cursor: enabled ? 'pointer' : 'default',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  }
}

/** Тёмная кнопка (второстепенное действие). */
export function darkBtn(enabled: boolean, height = 44): CSSProperties {
  return {
    height, minHeight: 44, minWidth: 44, borderRadius: 10, padding: '0 12px', boxSizing: 'border-box',
    border: `1px solid ${enabled ? C.stoneMid : C.niche}`,
    background: enabled ? C.nicheDeep : G.card,
    color: enabled ? C.textMain : G.disabledText,
    fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 13,
    cursor: enabled ? 'pointer' : 'default',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  }
}

/** Красная кнопка (выход, роспуск, исключение). */
export function dangerBtn(enabled: boolean): CSSProperties {
  return {
    ...darkBtn(enabled),
    border: `1px solid ${enabled ? G.redBorder : C.niche}`,
    background: enabled ? G.redBg : G.card,
    color: enabled ? G.pink : G.disabledText,
  }
}

/** Мелкая подпись блока заглавными («СЕЙЧАС», «БЛАГОСЛОВЕНИЯ»). */
export const capsLabel: CSSProperties = { fontSize: 11, color: G.textSoft, textTransform: 'uppercase', letterSpacing: 1.5 }

/** Шапка вкладки (Состав, Чат, Склад). */
export const tabHead: CSSProperties = { padding: '14px 16px', borderBottom: `1px solid ${C.stoneDark}`, background: G.shade }
export const tabTitle: CSSProperties = { fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.textMain }
export const tabSub: CSSProperties = { fontSize: 12, color: G.textSoft }

/** Тёмное поле ввода. */
export const textInput: CSSProperties = {
  width: '100%', boxSizing: 'border-box', minHeight: 44, padding: '8px 12px', borderRadius: 10,
  border: `1px solid ${C.stoneDark}`, background: C.outline, color: C.textMain, fontSize: 14, fontFamily: TEXT_FONT,
}

export const GUILD_CONTENT_MAX_W = 520
