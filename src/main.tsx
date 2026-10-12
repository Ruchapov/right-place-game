import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { init, mountViewport, bindViewportCssVars, isViewportCssVarsBound } from '@telegram-apps/sdk'
import App from './App.tsx'
import { followOrientationWithFullscreen } from './telegramFullscreen'
import './index.css'

// Initialize Telegram SDK
try {
  init()
  console.log('Telegram SDK initialized')
} catch (error) {
  console.error('Failed to initialize Telegram SDK:', error)
}

// CSS-переменные вьюпорта Telegram, в том числе safe-area. Без этого вызова их
// НЕТ НИ ОДНОЙ, и отступ снизу неоткуда взять:
//   • env(safe-area-inset-bottom) в нашем index.html всегда 0 — у meta viewport
//     нет viewport-fit=cover, а без него браузер insets не отдаёт вовсе;
//   • --tg-safe-area-inset-* ставит собственный скрипт Telegram
//     (telegram-web-app.js), а мы работаем через @telegram-apps/sdk и тот скрипт
//     не грузим;
//   • этот SDK заводит СВОИ имена — --tg-viewport-safe-area-inset-bottom и
//     --tg-viewport-content-safe-area-inset-bottom, — но только после
//     bindViewportCssVars(). Их и читает панель кнопок (TouchControls).
// Вне Telegram isAvailable() ложно, и блок молча не делает ничего.
// Ошибку глушить нельзя: без переменных кнопки лягут на домашнюю полосу, и
// знать об этом надо (см. правило про тихие фолбэки в CLAUDE.md).
async function bindTelegramViewportCssVars() {
  if (!mountViewport.isAvailable()) return
  await mountViewport()
  if (bindViewportCssVars.isAvailable() && !isViewportCssVarsBound()) bindViewportCssVars()
  // Полный экран в горизонтали — СТРОГО после монтирования вьюпорта (без него
  // методы полного экрана недоступны) и после переменных: отступы под кнопки
  // Telegram должны уже работать, когда шапка исчезнет. Свой try — сбой здесь
  // не должен выглядеть как «переменные не подключились» (см. catch ниже), а
  // игра без полного экрана полностью рабочая.
  try {
    followOrientationWithFullscreen()
  } catch (error) {
    console.warn('Полный экран Telegram по повороту не подключён — игра работает в обычном окне', error)
  }
}
void bindTelegramViewportCssVars().catch((error) => {
  console.error('Не удалось подключить CSS-переменные вьюпорта Telegram (safe-area)', error)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)