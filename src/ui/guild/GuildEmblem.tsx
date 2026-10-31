// Герб гильдии (31.10.2026, арт guild_art): рамка, фон цвета палитры, символ.
// Выбор герба — только при создании гильдии: потом он не меняется (01.11.2026).
import { useState, type CSSProperties, type ReactNode } from 'react'
import { C, FONT_DISPLAY } from '../theme'
import { GUILD_EMBLEM_BG_COUNT, GUILD_EMBLEM_COLORS, GUILD_EMBLEM_FRAME_COUNT, GUILD_EMBLEM_SYMBOL_COUNT } from '../../guild'
import type { GuildEmblemView } from '../../api'
import { GUILD_ART } from './style'

/** Подписи частей герба в выборе — по номеру картинки emblem_<часть>_N.png. */
const EMBLEM_BG_LABEL = ['Щит', 'Круг', 'Знамя', 'Ромб']
const EMBLEM_FRAME_LABEL = ['Терновая', 'Лавровая', 'Каменная', 'Костяная']
const EMBLEM_SYMBOL_LABEL = ['Волк', 'Мечи', 'Череп', 'Свеча', 'Корона', 'Ворон']
if (EMBLEM_BG_LABEL.length !== GUILD_EMBLEM_BG_COUNT || EMBLEM_FRAME_LABEL.length !== GUILD_EMBLEM_FRAME_COUNT
  || EMBLEM_SYMBOL_LABEL.length !== GUILD_EMBLEM_SYMBOL_COUNT) {
  console.error('GuildEmblem: подписей частей герба не столько, сколько картинок в каталоге guild.ts')
}

/**
 * Фон герба: картинка серая и красится в цвет палитры — div цвета под маской
 * этой картинки, а поверх она же с multiply, чтобы осталась фактура.
 * onError — с верхней картинки: маска об ошибке не сообщает.
 */
function EmblemBg({ bg, color, onError }: { bg: number; color: string; onError?: () => void }) {
  const src = GUILD_ART(`emblem_bg_${bg}.png`)
  const mask = `url("${src}") center / contain no-repeat`
  return (
    <div style={{ position:'absolute', inset:0, isolation:'isolate' }}>
      <div style={{ position:'absolute', inset:0, background:color, mask, WebkitMask:mask }} />
      <img src={src} alt="" onError={onError}
        style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'contain', mixBlendMode:'multiply' }} />
    </div>
  )
}

/**
 * Герб из трёх картинок (public/assets/guild/emblem_*.png): рамка на весь
 * размер, фон цвета палитры ~66% по центру, символ ~40% поверх. Не загрузилась
 * хоть одна — заглушка кодом: круг цвета фона и буква тега.
 */
export function GuildEmblem({ emblem, tag, size }: { emblem: GuildEmblemView; tag: string; size: number }) {
  const color = GUILD_EMBLEM_COLORS[emblem.color] ?? GUILD_EMBLEM_COLORS[0]
  // Сбой помнится для этого набора картинок: в выборе герба набор меняется.
  const key = `${emblem.bg}:${emblem.frame}:${emblem.symbol}`
  const [brokenKey, setBrokenKey] = useState<string | null>(null)
  const broken = () => setBrokenKey(key)
  const centered = (frac: number): CSSProperties => {
    const s = Math.round(size * frac)
    return { position:'absolute', left:(size - s) / 2, top:(size - s) / 2, width:s, height:s }
  }
  if (brokenKey === key) {
    return (
      <div data-guild-emblem="" style={{ position:'relative', width:size, height:size, flexShrink:0 }}>
        <div style={{
          position:'absolute', inset:0, borderRadius:'50%', background:color, border:`2px solid ${C.bone}`,
          boxSizing:'border-box', display:'flex', alignItems:'center', justifyContent:'center',
        }}>
          <span style={{ fontFamily:FONT_DISPLAY, fontSize:Math.round(size * 0.42), color:C.textMain, textShadow:'0 1px 2px #000' }}>
            {tag.slice(0, 1)}
          </span>
        </div>
      </div>
    )
  }
  return (
    <div data-guild-emblem="" style={{ position:'relative', width:size, height:size, flexShrink:0 }}>
      <div style={centered(0.66)}><EmblemBg bg={emblem.bg} color={color} onError={broken} /></div>
      <img src={GUILD_ART(`emblem_symbol_${emblem.symbol}.png`)} alt="" onError={broken} style={{ ...centered(0.4), objectFit:'contain' }} />
      <img src={GUILD_ART(`emblem_frame_${emblem.frame}.png`)} alt="" onError={broken}
        style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'contain' }} />
    </div>
  )
}

export function EmblemPicker({ value, onChange, tag }: { value: GuildEmblemView; onChange: (e: GuildEmblemView) => void; tag: string }) {
  const color = GUILD_EMBLEM_COLORS[value.color] ?? GUILD_EMBLEM_COLORS[0]
  const title = (label: string) => <div style={{ fontSize:11, color:C.textDim, margin:'8px 0 4px' }}>{label}</div>
  const pick = (selected: boolean): CSSProperties => ({
    minHeight:52, padding:'4px 2px', borderRadius:6, cursor:'pointer', minWidth:0,
    border:`1px solid ${selected ? C.glowCore : C.stoneDark}`,
    background: selected ? C.niche : C.nicheDeep,
    display:'flex', flexDirection:'column', alignItems:'center', gap:2,
  })
  const caption = (text: string, selected: boolean) => (
    <span style={{ fontSize:9, color: selected ? C.glowCore : C.textDim, maxWidth:'100%', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{text}</span>
  )
  const grid = (labels: string[], key: 'bg' | 'frame' | 'symbol', preview: (i: number) => ReactNode) => (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(6, minmax(0, 1fr))', gap:4 }}>
      {labels.map((label, i) => (
        <button key={i} onClick={() => onChange({ ...value, [key]: i })} style={pick(value[key] === i)}>
          <div style={{ position:'relative', width:30, height:30 }}>{preview(i)}</div>
          {caption(label, value[key] === i)}
        </button>
      ))}
    </div>
  )
  const img = (file: string) => <img src={GUILD_ART(file)} alt="" style={{ width:30, height:30, objectFit:'contain' }} />
  return (
    <div>
      <div style={{ display:'flex', justifyContent:'center', margin:'4px 0' }}>
        <GuildEmblem emblem={value} tag={tag || '?'} size={64} />
      </div>
      {title('Фон')}
      {grid(EMBLEM_BG_LABEL.slice(0, GUILD_EMBLEM_BG_COUNT), 'bg', (i) => <EmblemBg bg={i} color={color} />)}
      {title('Цвет')}
      <div style={{ display:'grid', gridTemplateColumns:`repeat(${GUILD_EMBLEM_COLORS.length}, minmax(0, 1fr))`, gap:4 }}>
        {GUILD_EMBLEM_COLORS.map((c, i) => (
          <button key={i} aria-label={`Цвет ${i + 1}`} onClick={() => onChange({ ...value, color: i })}
            style={{ minHeight:36, minWidth:0, borderRadius:6, cursor:'pointer', background:c, border:`2px solid ${value.color === i ? C.glowCore : C.stoneDark}` }} />
        ))}
      </div>
      {title('Рамка')}
      {grid(EMBLEM_FRAME_LABEL.slice(0, GUILD_EMBLEM_FRAME_COUNT), 'frame', (i) => img(`emblem_frame_${i}.png`))}
      {title('Символ')}
      {grid(EMBLEM_SYMBOL_LABEL.slice(0, GUILD_EMBLEM_SYMBOL_COUNT), 'symbol', (i) => img(`emblem_symbol_${i}.png`))}
    </div>
  )
}
