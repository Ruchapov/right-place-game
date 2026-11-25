import { C, FONT_DISPLAY } from './theme'
import { classItemById } from '../classItems'
import { HUNTER_STATS, type HunterStat } from '../hunter'

// Окно после съеденного сердца босса (23.11.2026, жалоба Андрея: «повысил —
// непонятно, повысилось или нет»). Тот же вид, что у окна «Ты стал …»
// (HeroClassViews.tsx): тёмный фон с тёплым пятном, иконка со свечением, крупная
// строка шрифтом заголовков. Числа — из ОТВЕТА сервера (было → стало), уровень —
// строкой, только если вырос. Закрывается кнопкой «Хорошо» или тапом мимо.

export type BossHeartResult = {
  stat: HunterStat
  from: number
  to: number
  levelFrom: number
  levelTo: number
}

// Короткая фраза на стат — голос игры: тёмный, без канцелярита.
const LINE: Record<HunterStat, string> = {
  strength: 'Чужая ярость прижилась в твоих руках. Клинок теперь ложится тяжелее.',
  agility: 'Сердце бьётся чужим ритмом — и ты успеваешь на полшага раньше.',
  endurance: 'Кровь чудовища густеет в жилах. Свалить тебя стало труднее.',
}

export function BossHeartNotice({ result, onClose }: { result: BossHeartResult; onClose: () => void }) {
  const item = classItemById('boss_heart')
  const name = HUNTER_STATS.find((s) => s.id === result.stat)?.nameRu ?? result.stat
  const gained = result.to - result.from
  return (
    <div onClick={onClose} style={{
      boxSizing:'border-box', position:'fixed', top:0, left:0, right:0, bottom:0,
      padding:'calc(var(--rp-safe-top) + 24px) calc(var(--rp-safe-right) + 16px) calc(var(--rp-safe-bottom) + 24px) calc(var(--rp-safe-left) + 16px)',
      // Плотный фон: карточка сердца под окном не должна просвечивать текстом.
      background:'radial-gradient(circle at 50% 40%, rgba(84,30,30,0.99) 0%, rgba(16,13,20,0.995) 62%)',
      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:14,
      zIndex:1500, overflowY:'auto',
    }}>
      <style>{`
        @keyframes rp-heart-rise { from { opacity: 0; transform: translateY(12px) scale(0.92); } to { opacity: 1; transform: none; } }
        @keyframes rp-heart-beat { 0%, 100% { transform: scale(1); } 12% { transform: scale(1.07); } 24% { transform: scale(1); } 36% { transform: scale(1.04); } }
        .rp-heart-rise { animation: rp-heart-rise 480ms ease-out both; }
        .rp-heart-beat { animation: rp-heart-beat 1.6s ease-in-out 480ms infinite; }
        @media (prefers-reduced-motion: reduce) { .rp-heart-rise, .rp-heart-beat { animation: none; } }
      `}</style>
      {item !== null && (
        <div className="rp-heart-rise">
          <img
            className="rp-heart-beat"
            src={`${import.meta.env.BASE_URL}assets/icons/${item.icon}`}
            alt={item.nameRu}
            style={{
              width:'min(34vmin, 140px)', height:'min(34vmin, 140px)', objectFit:'contain', display:'block',
              filter:'drop-shadow(0 0 20px rgba(224,53,59,0.5)) drop-shadow(0 6px 14px rgba(0,0,0,0.7))',
            }}
          />
        </div>
      )}
      <div className="rp-heart-rise" style={{
        fontFamily:FONT_DISPLAY, fontSize:30, lineHeight:1.2, color:C.glowCore, textAlign:'center',
        textShadow:'0 0 18px rgba(209,151,68,0.45)',
      }}>
        {name} +{gained > 0 ? gained : 1}
      </div>
      <div className="rp-heart-rise" style={{ fontSize:20, color:C.textMain, fontVariantNumeric:'tabular-nums' }}>
        {result.from} <span style={{ color:C.textDim }}>→</span> <span style={{ color:C.glowCore }}>{result.to}</span>
      </div>
      {result.levelTo > result.levelFrom && (
        <div style={{ fontSize:13, color:C.glowCore }}>Уровень {result.levelFrom} → {result.levelTo}</div>
      )}
      <div style={{ fontSize:13, lineHeight:1.5, fontStyle:'italic', color:C.textDim, textAlign:'center', maxWidth:300 }}>
        {LINE[result.stat]}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onClose() }}
        style={{
          marginTop:6, minWidth:160, minHeight:48, padding:'10px 26px', borderRadius:10,
          background:C.nicheDeep, border:`1px solid ${C.glowEdge}`, color:C.glowCore,
          fontFamily:FONT_DISPLAY, fontSize:17, cursor:'pointer',
          boxShadow:'inset 0 0 14px rgba(209,151,68,0.3)',
        }}>
        Хорошо
      </button>
    </div>
  )
}
