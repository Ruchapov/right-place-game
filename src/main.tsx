import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { init } from '@telegram-apps/sdk'
import App from './App.tsx'
import './index.css'

// TODO: временная диагностика (см. задачу "player становится null") — если
// эта строка появится в консоли больше одного раза за сессию, значит вся
// страница/WebView перезагрузилась целиком (main.tsx выполняется заново),
// а не что-то внутри React обнулило player — это единственный способ так
// получить свежий React-дерево с player=null посреди сессии, т.к. явного
// setPlayer(null) в App.tsx нет нигде.
console.log('main.tsx: script executing (page (re)loaded)', { time: Date.now(), visibilityState: document.visibilityState })

// Initialize Telegram SDK
try {
  init()
  console.log('Telegram SDK initialized')
} catch (error) {
  console.error('Failed to initialize Telegram SDK:', error)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)