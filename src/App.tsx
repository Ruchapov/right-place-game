import { useEffect, useState } from 'react'
import { retrieveRawInitData } from '@telegram-apps/sdk'
import { loginWithTelegram, startRun, type LoginResponse } from './api'
import './App.css'

type PlayerData = {
  id: number
  firstName: string
  level: number
  gold: number
}

const ROOM_LABELS: Record<string, string> = {
  enemy: '⚔️ Враг',
  boss: '👹 Босс',
  chest: '📦 Сундук',
  trap: '💥 Ловушка',
  smuggler: '🤝 Контрабандист',
  puzzle: '🧩 Загадка',
}

const MAX_ENERGY = 100

// Energy now = base value + minutes passed since it was true (capped at MAX).
function liveEnergy(base: number, baseAt: number, now: number): number {
  const minutes = Math.floor((now - baseAt) / 60000)
  return Math.min(MAX_ENERGY, base + minutes)
}

export default function App() {
  const [player, setPlayer] = useState<PlayerData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [rooms, setRooms] = useState<string[] | null>(null)
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  // Energy is computed live from a base value + when it was measured.
  const [energyBase, setEnergyBase] = useState(MAX_ENERGY)
  const [energyBaseAt, setEnergyBaseAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())

  // Re-render every 15s so the energy number climbs on screen.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(id)
  }, [])

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
        })
        setEnergyBase(data.character.energy)
        setEnergyBaseAt(Date.now())
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  const energy = liveEnergy(energyBase, energyBaseAt, now)
  const notEnoughEnergy = energy < 10

  async function handleStartRun() {
    const token = localStorage.getItem('jwt')
    if (!token) return
    setRunning(true)
    setRunError(null)
    try {
      const result = await startRun(token)
      setRooms(result.rooms)
      setEnergyBase(result.energy)
      setEnergyBaseAt(Date.now())
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'Run failed')
    } finally {
      setRunning(false)
    }
  }

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
        <p>⚡ Энергия: {energy} / {MAX_ENERGY}</p>
      </div>

      <button
        onClick={handleStartRun}
        disabled={running || notEnoughEnergy}
        style={{
          marginTop: 20, padding: '12px 20px', fontSize: 16, borderRadius: 8,
          border: 'none', color: 'white',
          background: running || notEnoughEnergy ? '#999' : '#4caf50',
        }}
      >
        {running ? 'Забег...' : 'Начать забег (-10 ⚡)'}
      </button>

      {notEnoughEnergy && <p style={{ color: '#c00', marginTop: 8 }}>Недостаточно энергии (нужно 10).</p>}
      {runError && <p style={{ color: 'red', marginTop: 8 }}>{runError}</p>}

      {rooms && (
        <div style={{ marginTop: 20 }}>
          <h2>Комнаты забега:</h2>
          <ol>
            {rooms.map((r, i) => (
              <li key={i} style={{ fontSize: 18, marginBottom: 4 }}>{ROOM_LABELS[r] ?? r}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}