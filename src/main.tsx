import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { init } from '@telegram-apps/sdk'
import App from './App.tsx'
import './index.css'

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