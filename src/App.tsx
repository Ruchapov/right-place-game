import { useEffect, useState } from 'react'
import { retrieveRawInitData } from '@telegram-apps/sdk'
import { loginWithTelegram, startRun, enterRoom, submitBattleResult, submitSmugglerResult, getPuzzle, submitPuzzleResult, type LoginResponse, type BattleResult, type SmugglerResult, type PuzzleResult } from './api'
import Battle from './Battle'
import Smuggler from './Smuggler'
import Puzzle from './Puzzle'
import './App.css'

type PlayerData = { id: number; firstName: string; level: number; gold: number; strength: number; endurance: number; trophies: number }

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
  const [activeTab, setActiveTab] = useState<'hero' | 'shop' | 'explore' | 'gear' | 'friends'>('explore')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [inBattle, setInBattle] = useState(false)
  const [inSmuggler, setInSmuggler] = useState(false)
  const [puzzleData, setPuzzleData] = useState<{ question: string; options: string[] } | null>(null)
  const [runHp, setRunHp] = useState(80)
  const [runMaxHp, setRunMaxHp] = useState(80)

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
        setPlayer({ id: data.user.id, firstName: data.user.firstName, level: data.character.level, gold: data.character.gold, strength: data.character.strength, endurance: data.character.endurance, trophies: data.character.trophies })
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
      setRunHp(result.hp); setRunMaxHp(result.maxHp)
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'Run failed')
    } finally { setRunning(false) }
  }

  async function handleEnterRoom() {
    const token = localStorage.getItem('jwt')
    if (!token) return
    if (rooms && (rooms[roomIndex] === 'enemy' || rooms[roomIndex] === 'boss')) {
      setInBattle(true)
      return
    }
    if (rooms && rooms[roomIndex] === 'smuggler') {
      setInSmuggler(true)
      return
    }
    if (rooms && rooms[roomIndex] === 'puzzle') {
      setEntering(true); setRunError(null)
      try {
        const pz = await getPuzzle(token)
        setPuzzleData(pz)
      } catch (e) {
        setRunError(e instanceof Error ? e.message : 'Puzzle failed')
      } finally { setEntering(false) }
      return
    }
    setEntering(true); setRunError(null)
    try {
      const result = await enterRoom(token)
      setResults((prev) => [...prev, result.message])
      setRoomIndex(result.index)
      setRunHp(result.hp)
      setPlayer((prev) => (prev ? { ...prev, gold: result.gold, level: result.level, strength: result.strength, endurance: result.endurance } : prev))
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'Room failed')
    } finally { setEntering(false) }
  }

  async function handleBattleEnd(result: { won: boolean; damageTaken: number; damageDealt: number }) {
    setInBattle(false)
    const token = localStorage.getItem('jwt')
    if (!token) return
    setEntering(true); setRunError(null)
    try {
      const br: BattleResult = await submitBattleResult(token, result.won, result.damageTaken, result.damageDealt)
      setResults((prev) => [...prev, br.message])
      setRoomIndex(br.index)
      setRunHp(br.hp)
      setPlayer((prev) => (prev ? { ...prev, level: br.level, strength: br.strength, endurance: br.endurance, trophies: br.trophies } : prev))
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'Battle result failed')
    } finally { setEntering(false) }
  }

  async function handleSmugglerChoice(exchange: boolean) {
    setInSmuggler(false)
    const token = localStorage.getItem('jwt')
    if (!token) return
    setEntering(true); setRunError(null)
    try {
      const sr: SmugglerResult = await submitSmugglerResult(token, exchange)
      setResults((prev) => [...prev, sr.message])
      setRoomIndex(sr.index)
      setRunHp(sr.hp)
      setPlayer((prev) => (prev ? { ...prev, trophies: sr.trophies } : prev))
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'Smuggler failed')
    } finally { setEntering(false) }
  }

  async function handlePuzzleAnswer(selectedIndex: number) {
    setPuzzleData(null)
    const token = localStorage.getItem('jwt')
    if (!token) return
    setEntering(true); setRunError(null)
    try {
      const pr: PuzzleResult = await submitPuzzleResult(token, selectedIndex)
      setResults((prev) => [...prev, pr.message])
      setRoomIndex(pr.index)
      setRunHp(pr.hp)
      setPlayer((prev) => (prev ? { ...prev, gold: pr.gold, level: pr.level, strength: pr.strength, endurance: pr.endurance } : prev))
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'Puzzle failed')
    } finally { setEntering(false) }
  }

  function backToMenu() {
    setRooms(null); setRoomIndex(0); setResults([])
  }

  if (loading) return <div style={{ padding: 20 }}>⏳ Загрузка...</div>
  if (error) return <div style={{ padding: 20, color: 'red' }}><b>Ошибка:</b> {error}</div>

  return (
    <div style={{ padding: 20, paddingBottom: 80, fontFamily: 'sans-serif', minHeight: '100vh', background: '#1a1a2e', color: 'white' }}>
      {activeTab !== 'explore' && (
        <div>
          {activeTab === 'hero' && <div><h2>👤 Персонаж</h2><p>Скоро...</p></div>}
          {activeTab === 'shop' && <div><h2>🛒 Магазин</h2><p>Скоро...</p></div>}
          {activeTab === 'gear' && <div><h2>🎒 Снаряжение</h2><p>Скоро...</p></div>}
          {activeTab === 'friends' && <div><h2>👥 Друзья</h2><p>Скоро...</p></div>}
        </div>
      )}
      {activeTab === 'explore' && <div>
      <h1>⚔️ Right Place</h1>
      <div style={{ background: '#f0f0f0', padding: 15, borderRadius: 8 }}>
        <p>👤 {player?.firstName} (ID: {player?.id})</p>
        <p>⭐ Уровень: {player?.level}</p>
        <p>💰 Золото: {player?.gold}</p>
        <p>🏆 Трофеи: {player?.trophies}</p>
        <p>💪 Сила: {player?.strength}</p>
        <p>🛡️ Выносливость: {player?.endurance}</p>
        <p>⚡ Энергия: {energy} / {MAX_ENERGY}</p>
      </div>

      {rooms === null && (
        <>
          <button onClick={handleStartRun} disabled={running || notEnoughEnergy}
            style={{ marginTop: 20, padding: '12px 20px', fontSize: 16, borderRadius: 8, border: 'none', color: 'white', background: running || notEnoughEnergy ? '#999' : '#4caf50' }}>
            {running ? 'Забег...' : `Начать забег (-${RUN_COST} ⚡)`}
          </button>
          {notEnoughEnergy && <p style={{ color: '#c00', marginTop: 8 }}>Недостаточно энергии (нужно {RUN_COST}).</p>}
        </>
      )}

      {inBattle && <Battle initialHp={runHp} maxHp={runMaxHp} isBoss={rooms ? rooms[roomIndex] === 'boss' : false} level={player?.level ?? 1} onBattleEnd={handleBattleEnd} />}
      {inSmuggler && <Smuggler trophies={player?.trophies ?? 0} onChoice={handleSmugglerChoice} />}
      {puzzleData && <Puzzle question={puzzleData.question} options={puzzleData.options} onAnswer={handlePuzzleAnswer} />}
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
      </div>}
      <div style={{
        position:'fixed', bottom:0, left:0, right:0,
        display:'flex', background:'#12122a',
        borderTop:'1px solid rgba(255,255,255,0.1)',
        zIndex:999
      }}>
        {([
          {id:'hero', label:'Персонаж', icon:'👤'},
          {id:'shop', label:'Магазин', icon:'🛒'},
          {id:'explore', label:'Исследовать', icon:'⚔️'},
          {id:'gear', label:'Снаряжение', icon:'🎒'},
          {id:'friends', label:'Друзья', icon:'👥'},
        ] as const).map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            style={{
              flex:1, padding:'8px 0', border:'none', background:'none',
              color: activeTab === tab.id ? '#ffd700' : 'rgba(255,255,255,0.5)',
              fontSize:10, display:'flex', flexDirection:'column',
              alignItems:'center', gap:2, cursor:'pointer'
            }}>
            <span style={{fontSize:20}}>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  )
}