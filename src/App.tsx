import { useEffect, useState } from 'react'
import { retrieveRawInitData } from '@telegram-apps/sdk'
import { loginWithTelegram, type LoginResponse } from './api'
import './App.css'

type PlayerData = {
  id: number
  firstName: string
  level: number
  gold: number
  energy: number
}

export default function App() {
  const [player, setPlayer] = useState<PlayerData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function init() {
      try {
        const initDataRaw = retrieveRawInitData()
        if (!initDataRaw) throw new Error('No initData from Telegram')

        const data: LoginResponse = await loginWithTelegram(initDataRaw)
        localStorage.setItem('jwt', data.token)

        setPlayer({
          id: data.user.id,
          firstName: data.user.firstName,
          level: data.character.level,
          gold: data.character.gold,
          energy: data.character.energy,
        })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  if (loading) return <div style={{ padding: 20 }}>⏳ Загрузка...</div>

  if (error) return (
    <div style={{ padding: 20, color: 'red' }}>
      <b>Ошибка:</b> {error}
    </div>
  )

  return (
    <div style={{ padding: 20, fontFamily: 'sans-serif' }}>
      <h1>⚔️ Right Place</h1>
      <div style={{ background: '#f0f0f0', padding: 15, borderRadius: 8 }}>
        <p>👤 {player?.firstName} (ID: {player?.id})</p>
        <p>⭐ Уровень: {player?.level}</p>
        <p>💰 Золото: {player?.gold}</p>
        <p>⚡ Энергия: {player?.energy}</p>
      </div>
    </div>
  )
}