import * as C from '../constants'
import { NC_BOSS_NAME } from '../ncConstants'
import type { Boss } from '../types'

// ЗАСТАВКА БОССА (12.11.2026, задание shaders_task/task-freeze-candles.md, часть 4).
// Общая для любого босса: при первом входе героя в зону босса (ближе
// BOSS_INTRO_ZONE_TILES по x и y к центру живого босса) всё замирает, камера за
// BOSS_INTRO_IN_MS едет к боссу и приближается ×BOSS_INTRO_ZOOM, держится
// BOSS_INTRO_HOLD_MS и за BOSS_INTRO_OUT_MS возвращается; внизу — имя босса кистью,
// сверху и снизу кашетки. Один раз за забег; тап пропускает.
//
// Здесь — только таймлайн и правила; камера, пауза тикера и титр (DOM поверх холста)
// живут в Explore.tsx. Пауза — тот же приём, что у подсказок обучения: тикер забега
// не выполняет логику (босс не ходит, не бьёт и не получает урона, герой стоит, ввод
// не обрабатывается), анимации спрайтов стоят (Ticker.shared.speed = 0).

/** Имя босса для титра — из данных босса. */
export function bossDisplayName(boss: Boss): string {
  if (boss.nc) return NC_BOSS_NAME[boss.nc.kind]
  if (boss.abbot) return 'Настоятель'
  return 'Тварь'
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)

export const BOSS_INTRO_TOTAL_MS = C.BOSS_INTRO_IN_MS + C.BOSS_INTRO_HOLD_MS + C.BOSS_INTRO_OUT_MS

/** Доля пути камеры к боссу (0 — герой, 1 — босс) в момент ms от начала заставки. */
export function bossIntroBlend(ms: number): number {
  if (ms <= 0) return 0
  if (ms < C.BOSS_INTRO_IN_MS) return easeInOut(ms / C.BOSS_INTRO_IN_MS)
  if (ms < C.BOSS_INTRO_IN_MS + C.BOSS_INTRO_HOLD_MS) return 1
  if (ms < BOSS_INTRO_TOTAL_MS) return 1 - easeInOut((ms - C.BOSS_INTRO_IN_MS - C.BOSS_INTRO_HOLD_MS) / C.BOSS_INTRO_OUT_MS)
  return 0
}

/**
 * Таймеры босса — «с начала» после заставки: у каждой его атаки, призыва, нырка и
 * т.п. до первого раза не меньше BOSS_INTRO_GRACE_MS (босс не бьёт в первый кадр).
 */
export function restartBossTimers(boss: Boss) {
  const g = C.BOSS_INTRO_GRACE_MS
  boss.attackCooldownTimer = Math.max(boss.attackCooldownTimer, g)
  boss.rangedCooldownTimer = Math.max(boss.rangedCooldownTimer, g)
  boss.stompCooldownTimer = Math.max(boss.stompCooldownTimer, g)
  if (boss.abbot) {
    boss.abbot.slamCooldownTimer = Math.max(boss.abbot.slamCooldownTimer, g)
    boss.abbot.summonCooldownTimer = Math.max(boss.abbot.summonCooldownTimer, g)
  }
  if (boss.nc) {
    boss.nc.slamCooldownMs = Math.max(boss.nc.slamCooldownMs, g)
    boss.nc.diveCooldownMs = Math.max(boss.nc.diveCooldownMs, g)
    boss.nc.scatterCooldownMs = Math.max(boss.nc.scatterCooldownMs, g)
  }
}

/** Титр: проявление, черта и растворение — CSS-анимации, тайминги от таймлайна. */
export const BOSS_INTRO_CSS = `
@keyframes rp-bi-bar-top { 0% { transform: translateY(-100%) } 12% { transform: translateY(0) } 88% { transform: translateY(0) } 100% { transform: translateY(-100%) } }
@keyframes rp-bi-bar-bot { 0% { transform: translateY(100%) } 12% { transform: translateY(0) } 88% { transform: translateY(0) } 100% { transform: translateY(100%) } }
@keyframes rp-bi-reveal { from { clip-path: inset(0 100% 0 0) } to { clip-path: inset(0 0 0 0) } }
@keyframes rp-bi-line { from { transform: scaleX(0) } to { transform: scaleX(1) } }
@keyframes rp-bi-fade { from { opacity: 1 } to { opacity: 0 } }
.rp-bi[data-on="1"] .rp-bi-top { animation: rp-bi-bar-top ${BOSS_INTRO_TOTAL_MS}ms ease-in-out both }
.rp-bi[data-on="1"] .rp-bi-bot { animation: rp-bi-bar-bot ${BOSS_INTRO_TOTAL_MS}ms ease-in-out both }
.rp-bi[data-on="1"] .rp-bi-title { animation: rp-bi-fade 400ms ease-in ${BOSS_INTRO_TOTAL_MS - 400}ms both }
.rp-bi[data-on="1"] .rp-bi-name { animation: rp-bi-reveal 500ms ease-out ${C.BOSS_INTRO_IN_MS - 200}ms both }
.rp-bi[data-on="1"] .rp-bi-line { animation: rp-bi-line 450ms ease-out ${C.BOSS_INTRO_IN_MS + 200}ms both }
`
