import type { Renderer } from 'pixi.js'
import { heldAssetCount } from './spriteLoader'

// ?debugMem=1 (16.11.2026, docs/explore-engine.md, «Видеопамять забега»): в
// углу забега — сколько видеопамяти занимают все живые текстуры и пик за забег;
// то же в console.info на старте и раз в 5 с. В Telegram — startapp=debugMem.
// Без флага ничего не рисуется и не считается.
//
// Счёт — по текстурам, которые сейчас лежат в видеопамяти (renderer.texture
// .managedTextures): pixelWidth × pixelHeight × 4, у текстур с мипмапами ×4/3.
// Буферы кадра и фильтров Pixi сюда не входят (их немного и они постоянны).
export const DEBUG_MEM = typeof window !== 'undefined' && /debugMem/.test(window.location.href)

type SourceLike = { pixelWidth: number; pixelHeight: number; mipLevelCount?: number; autoGenerateMipmaps?: boolean }

function vramMb(renderer: Renderer): { mb: number; n: number } {
  const list = (renderer.texture as unknown as { managedTextures?: (SourceLike | null)[] }).managedTextures ?? []
  let bytes = 0
  let n = 0
  for (const s of list) {
    if (!s) continue
    n++
    const mip = (s.mipLevelCount ?? 1) > 1 || s.autoGenerateMipmaps ? 4 / 3 : 1
    bytes += s.pixelWidth * s.pixelHeight * 4 * mip
  }
  return { mb: bytes / 1048576, n }
}

/** Запустить счётчик; вернёт функцию остановки (cleanup забега). */
export function startDebugMem(renderer: Renderer): () => void {
  if (!DEBUG_MEM) return () => {}
  const el = document.createElement('div')
  el.style.cssText = 'position:fixed;left:calc(var(--rp-safe-left, 0px) + 4px);bottom:calc(var(--rp-safe-bottom, 0px) + 4px);z-index:2500;pointer-events:none;font:11px/1.3 monospace;color:#9f9;background:rgba(0,0,0,0.6);padding:2px 5px;border-radius:3px'
  document.body.appendChild(el)
  let peak = 0
  const line = () => {
    const { mb, n } = vramMb(renderer)
    if (mb > peak) peak = mb
    return `VRAM ${Math.round(mb)} МБ · пик ${Math.round(peak)} · текстур ${n} · держит ${heldAssetCount()}`
  }
  el.textContent = line()
  console.info(`debugMem: старт забега — ${el.textContent}`)
  const fast = window.setInterval(() => { el.textContent = line() }, 250)
  const slow = window.setInterval(() => console.info(`debugMem: ${line()}`), 5000)
  return () => {
    window.clearInterval(fast)
    window.clearInterval(slow)
    console.info(`debugMem: конец забега — пик ${Math.round(peak)} МБ`)
    el.remove()
  }
}
