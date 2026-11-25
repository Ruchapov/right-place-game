// Знак «Печати Колокола» у имени (25.11.2026, docs/premium.md): золотой колокольчик
// под короной. Один компонент на все места — рейтинг, состав и чат гильдии,
// своё имя на «Персонаже» и в Убежище. Рисуется кодом (SVG): своей картинки у
// знака нет, а размер нужен от 12 до 40 px.
import { C } from './theme'

export function PremiumBadge({ size = 16, title = 'Печать Колокола' }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={title}
      style={{ flexShrink: 0, display: 'inline-block', verticalAlign: '-0.15em', filter: 'drop-shadow(0 0 3px rgba(245,188,91,.55))' }}>
      <title>{title}</title>
      <defs>
        <linearGradient id="rp-prem-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFE3A3" /><stop offset="55%" stopColor={C.glowCore} /><stop offset="100%" stopColor={C.glowEdge} />
        </linearGradient>
      </defs>
      {/* корона */}
      <path d="M6.5 7.2 8.3 3.6l2.1 2.3L12 2.6l1.6 3.3 2.1-2.3 1.8 3.6z" fill="url(#rp-prem-gold)" stroke={C.outline} strokeWidth="0.9" strokeLinejoin="round" />
      {/* колокол */}
      <path d="M12 7.4c-3.1 0-5 2.4-5 5.4v3.3l-1.6 2.1h13.2L17 16.1v-3.3c0-3-1.9-5.4-5-5.4z" fill="url(#rp-prem-gold)" stroke={C.outline} strokeWidth="0.9" strokeLinejoin="round" />
      <path d="M9.3 12.2c0-1.4.8-2.6 2-3.1" stroke="#FFF4D6" strokeOpacity=".7" strokeWidth="1" strokeLinecap="round" fill="none" />
      <circle cx="12" cy="20.3" r="1.6" fill={C.glowMid} stroke={C.outline} strokeWidth="0.8" />
    </svg>
  )
}
