import { useEffect, useState } from 'react'
import { retrieveRawInitData } from '@telegram-apps/sdk'
import { loginWithTelegram, startRun, enterRoom, type LoginResponse } from './api'
import Battle from './Battle'
import './App.css'

type PlayerData = { id: number; firstName: string; level: number; gold: number }

const ROOM_LABELS: Record<string, string> = {
  enemy: '⚔️ Враг',
  boss: '👹 Босс',
  chest: '📦 Сундук',
  trap: '💥 Ловушка',
  smuggler: '🤝 Контрабандист',
  puzzle: '🧩 Загадка',
}

const MAX_ENERGY = 100
const RUN_COST = 3 // DEV: держать в синхроне с сервером (вернуть 10 перед релизом)

function liveEnergy(base: number, baseAt: number, now: number): number {
  const minutes = Math.floor((now - baseAt) / 60000)
  return Math.min(MAX_ENERGY, base + minutes)
}

export default function App() {
  const [player, setPlayer] = useState<PlayerData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showBattleTest, setShowBattleTest] = useState(false) // TEMP: тестовая кнопка, удалить позже

  // Run state
  const [rooms, setRooms] = useState<string[] | null>(null)
  const [roomIndex, setRoomIndex] = useState(0)
  const [results, setResults] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [entering, setEntering] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  // Live energy
  const [energyBase, setEnergyBase] = useState(MAX_ENERGY)
  const [energyBaseAt, setEnergyBaseAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())

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
        setPlayer({ id: data.user.id, firstName: data.user.firstName, level: data.character.level, gold: data.character.gold })
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
  const notEnoughEnergy = energy < RUN_COST
  const runDone = rooms !== null && roomIndex >= rooms.length

  async function handleStartRun() {
    const token = localStorage.getItem('jwt')
    if (!token) return
    setRunning(true); setRunError(null)
    try {
      const result = await startRun(token)
      setRooms(result.rooms); setRoomIndex(0); setResults([])
      setEnergyBase(result.energy); setEnergyBaseAt(Date.now())
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'Run failed')
    } finally { setRunning(false) }
  }

  async function handleEnterRoom() {
    const token = localStorage.getItem('jwt')
    if (!token) return
    setEntering(true); setRunError(null)
    try {
      const result = await enterRoom(token)
      setResults((prev) => [...prev, result.message])
      setRoomIndex(result.index)
      setPlayer((prev) => (prev ? { ...prev, gold: result.gold } : prev))
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'Room failed')
    } finally { setEntering(false) }
  }

  function backToMenu() {
    setRooms(null); setRoomIndex(0); setResults([])
  }

  if (loading) return <div style={{ padding: 20 }}>⏳ Загрузка...</div>
  if (error) return <div style={{ padding: 20, color: 'red' }}><b>Ошибка:</b> {error}</div>

  return (
    <div style={{ padding: 20, fontFamily: 'sans-serif' }}>
      <h1>⚔️ Right Place</h1>
      <div style={{ background: '#f0f0f0', padding: 15, borderRadius: 8 }}>
        <p>👤 {player?.firstName} (ID: {player?.id})</p>
        <p>⭐ Уровень: {player?.level}</p>
        <p>💰 Золото: {player?.gold}</p>
        <p>⚡ Энергия: {energy} / {MAX_ENERGY}</p>
      </div>

      {rooms === null && (
        <>
          <button onClick={handleStartRun} disabled={running || notEnoughEnergy}
            style={{ marginTop: 20, padding: '12px 20px', fontSize: 16, borderRadius: 8, border: 'none', color: 'white', background: running || notEnoughEnergy ? '#999' : '#4caf50' }}>
            {running ? 'Забег...' : `Начать забег (-${RUN_COST} ⚡)`}
          </button>
          {notEnoughEnergy && <p style={{ color: '#c00', marginTop: 8 }}>Недостаточно энергии (нужно {RUN_COST}).</p>}

          {/* TEMP: кнопка для теста сцены боя, удалить когда бой подключим к комнате enemy */}
          <button onClick={() => setShowBattleTest(true)}
            style={{ marginTop: 12, marginLeft: 10, padding: '12px 20px', fontSize: 16, borderRadius: 8, border: 'none', color: 'white', background: '#9c27b0' }}>
            🧪 Тест боя
          </button>
        </>
      )}

      {showBattleTest && <Battle onClose={() => setShowBattleTest(false)} />}
      {rooms !== null && (
        <div style={{ marginTop: 20 }}>
          <h2>Забег: комната {Math.min(roomIndex + 1, rooms.length)} / {rooms.length}</h2>
          <ol>
            {rooms.map((r, i) => (
              <li key={i} style={{ fontSize: 18, marginBottom: 6, opacity: i < roomIndex ? 0.5 : 1 }}>
                {ROOM_LABELS[r] ?? r}
                {i < roomIndex && results[i] && <span style={{ color: '#2e7d32' }}> — {results[i]}</span>}
                {i === roomIndex && !runDone && (
                  <button onClick={handleEnterRoom} disabled={entering}
                    style={{ marginLeft: 10, padding: '4px 12px', borderRadius: 6, border: 'none', background: entering ? '#999' : '#1976d2', color: 'white' }}>
                    {entering ? '...' : 'Войти'}
                  </button>
                )}
              </li>
            ))}
          </ol>

          {runDone && (
            <div style={{ marginTop: 10 }}>
              <p style={{ fontWeight: 'bold' }}>🏁 Забег завершён!</p>
              <button onClick={backToMenu} style={{ padding: '10px 18px', borderRadius: 8, border: 'none', background: '#4caf50', color: 'white' }}>В меню</button>
            </div>
          )}
        </div>
      )}

      {runError && <p style={{ color: 'red', marginTop: 8 }}>{runError}</p>}
    </div>
  )
}