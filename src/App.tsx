import { useEffect, useState } from 'react'
import { retrieveRawInitData } from '@telegram-apps/sdk'
import { loginWithTelegram, startRun, enterRoom, submitBattleResult, submitSmugglerResult, getPuzzle, submitPuzzleResult, saveEquippedSkills, buyPotion, type LoginResponse, type BattleResult, type SmugglerResult, type PuzzleResult } from './api'
import Battle from './Battle'
import Smuggler from './Smuggler'
import Puzzle from './Puzzle'
import './App.css'

type PlayerData = { id: number; firstName: string; level: number; gold: number; strength: number; endurance: number; agility: number; trophies: number; equippedSkills: string[]; potionCharges: number }

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
  const [savingSkills, setSavingSkills] = useState(false)
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
  const [results, setResults] = useState<{ room: string; message: string }[]>([])
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [roomIntro, setRoomIntro] = useState(false)

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
        setPlayer({ id: data.user.id, firstName: data.user.firstName, level: data.character.level, gold: data.character.gold, strength: data.character.strength, endurance: data.character.endurance, agility: data.character.agility ?? 0, trophies: data.character.trophies, equippedSkills: data.character.equippedSkills ?? [], potionCharges: data.character.potionCharges ?? 3 })
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

  async function handleStartRun() {
    const token = localStorage.getItem('jwt')
    if (!token) return
    setRunning(true); setRunError(null)
    try {
      const result = await startRun(token)
      setRooms(result.rooms); setRoomIndex(0); setResults([])
      setEnergyBase(result.energy); setEnergyBaseAt(Date.now())
      setRunHp(result.hp); setRunMaxHp(result.maxHp)
      if (result.potions !== undefined) setPlayer(prev => prev ? { ...prev, potionCharges: result.potions! } : prev)
      showRoomIntro(0, result.rooms)
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'Run failed')
    } finally { setRunning(false) }
  }

  function showRoomIntro(index: number, currentRooms: string[]) {
    if (index >= currentRooms.length) return
    setRoomIntro(true)
    setTimeout(() => {
      setRoomIntro(false)
      enterCurrentRoomDirect(index, currentRooms)
    }, 2000)
  }

  async function enterCurrentRoomDirect(index: number, currentRooms: string[]) {
    const token = localStorage.getItem('jwt')
    if (!token) return
    const roomType = currentRooms[index]
    setRoomIndex(index)
    if (roomType === 'enemy' || roomType === 'boss') {
      setInBattle(true)
      return
    }
    if (roomType === 'smuggler') {
      setInSmuggler(true)
      return
    }
    if (roomType === 'puzzle') {
      setRunError(null)
      try {
        const pz = await getPuzzle(token)
        setPuzzleData(pz)
      } catch (e) {
        setRunError(e instanceof Error ? e.message : 'Puzzle failed')
      }
      return
    }
    setRunError(null)
    try {
      const result = await enterRoom(token)
      setResults((prev) => [...prev, { room: roomType, message: result.message }])
      setRoomIndex(result.index)
      setRunHp(result.hp)
      setPlayer((prev) => (prev ? { ...prev, gold: result.gold, level: result.level, strength: result.strength, endurance: result.endurance } : prev))
      if (!result.done && !result.died) showRoomIntro(result.index, currentRooms)
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'Room failed')
    }
  }

  async function handleBattleEnd(result: { won: boolean; damageTaken: number; damageDealt: number; skillUses: number; actualHpLost: number; potionsUsed: number }) {
    setInBattle(false)
    const token = localStorage.getItem('jwt')
    if (!token) return
    setRunError(null)
    try {
      const br: BattleResult = await submitBattleResult(token, result.won, result.damageTaken, result.damageDealt, result.skillUses, result.actualHpLost, result.potionsUsed)
      setResults((prev) => [...prev, { room: rooms?.[roomIndex] ?? 'enemy', message: br.message }])
      setRoomIndex(br.index)
      setRunHp(br.hp)
      if (!br.done && !br.died && rooms) showRoomIntro(br.index, rooms)
      setPlayer((prev) => (prev ? { ...prev, level: br.level, strength: br.strength, endurance: br.endurance, agility: br.agility ?? prev.agility, trophies: br.trophies, potionCharges: br.potions ?? prev.potionCharges } : prev))
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'Battle result failed')
    }
  }

  async function handleSmugglerChoice(exchange: boolean) {
    setInSmuggler(false)
    const token = localStorage.getItem('jwt')
    if (!token) return
    setRunError(null)
    try {
      const sr: SmugglerResult = await submitSmugglerResult(token, exchange)
      setResults((prev) => [...prev, { room: 'smuggler', message: sr.message }])
      setRoomIndex(sr.index)
      setRunHp(sr.hp)
      setPlayer((prev) => (prev ? { ...prev, trophies: sr.trophies } : prev))
      if (!sr.done && rooms) {
        setTimeout(() => showRoomIntro(sr.index, rooms), 100)
      }
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'Smuggler failed')
    }
  }

  async function handlePuzzleAnswer(selectedIndex: number) {
    setPuzzleData(null)
    const token = localStorage.getItem('jwt')
    if (!token) return
    setRunError(null)
    try {
      const pr: PuzzleResult = await submitPuzzleResult(token, selectedIndex)
      setResults((prev) => [...prev, { room: 'puzzle', message: pr.message }])
      setRoomIndex(pr.index)
      setRunHp(pr.hp)
      if (!pr.done && !pr.died && rooms) showRoomIntro(pr.index, rooms)
      setPlayer((prev) => (prev ? { ...prev, gold: pr.gold, level: pr.level, strength: pr.strength, endurance: pr.endurance } : prev))
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'Puzzle failed')
    }
  }

  function backToMenu() {
    setRooms(null); setRoomIndex(0); setResults([]); setRoomIntro(false); setRunning(false); setRunError(null)
  }

  async function handleSkillToggle(skillId: string) {
    if (!player) return
    const current = player.equippedSkills ?? []
    let next: string[]
    if (current.includes(skillId)) {
      next = current.filter(s => s !== skillId)
    } else {
      if (current.length >= 2) return
      next = [...current, skillId]
    }
    const token = localStorage.getItem('jwt')
    if (!token) return
    setSavingSkills(true)
    try {
      const result = await saveEquippedSkills(token, next)
      setPlayer(prev => prev ? { ...prev, equippedSkills: result.equippedSkills } : prev)
    } catch (e) {
      console.error('Save skills failed', e)
    } finally {
      setSavingSkills(false)
    }
  }

  async function handleBuyPotion() {
    const token = localStorage.getItem('jwt')
    if (!token || !player) return
    if (player.gold < 20) return
    try {
      const result = await buyPotion(token)
      setPlayer(prev => prev ? { ...prev, gold: result.gold, potionCharges: result.potionCharges } : prev)
    } catch (e) {
      console.error('Buy potion failed', e)
    }
  }

  if (loading) return <div style={{ padding: 20 }}>⏳ Загрузка...</div>
  if (error) return <div style={{ padding: 20, color: 'red' }}><b>Ошибка:</b> {error}</div>

  return (
    <div style={{ padding: 20, paddingBottom: 80, fontFamily: 'sans-serif', minHeight: '100vh', background: '#1a1a2e', color: 'white' }}>
      {activeTab !== 'explore' && (
        <div>
          {activeTab === 'hero' && (
            <div style={{ padding: '0 4px', paddingBottom: 20 }}>

              {/* Шапка */}
              <div style={{ display:'flex', alignItems:'center', gap:16, padding:'20px 16px 16px' }}>
                <div style={{
                  width:64, height:64, borderRadius:'50%',
                  background:'linear-gradient(135deg, #ffd700, #ff8c00)',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:26, fontWeight:'bold', color:'#0f0f1a', flexShrink:0,
                  boxShadow:'0 0 16px rgba(255,215,0,0.4)',
                }}>
                  {player?.firstName?.[0]?.toUpperCase() ?? '?'}
                </div>
                <div>
                  <div style={{ fontSize:20, fontWeight:'bold', color:'#e8e8f0' }}>
                    {player?.firstName}
                  </div>
                  <div style={{ fontSize:12, color:'rgba(255,255,255,0.35)', marginTop:3 }}>
                    {(player?.level ?? 1) < 5 ? '— класс не выбран —' : '— класс не выбран —'}
                  </div>
                </div>
              </div>

              {/* Разделитель */}
              <div style={{
                height:1,
                background:'linear-gradient(90deg, transparent, #ffd700, transparent)',
                boxShadow:'0 0 8px rgba(255,215,0,0.5)',
                margin:'0 16px 20px',
              }} />

              {/* Сетка статов 3x3 */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:10, padding:'0 8px' }}>
                {[
                  { icon:'⭐', value: player?.level ?? 1,                          label:'Уровень' },
                  { icon:'🗡️', value: 15 + Math.floor((player?.strength ?? 0) / 2), label:'Урон' },
                  { icon:'🛡️', value: 0,                                            label:'Броня' },
                  { icon:'❤️', value: player?.endurance ?? 10, label:'Выносливость' },
                  { icon:'💪', value: player?.strength ?? 0,                        label:'Сила' },
                  { icon:'🌀', value: player?.agility ?? 0,                         label:'Ловкость' },
                  { icon:'🍀', value: 0,                                             label:'Удача' },
                  { icon:'💰', value: player?.gold ?? 0,                            label:'Золото' },
                  { icon:'🏆', value: player?.trophies ?? 0,                        label:'Трофеи' },
                ].map((stat, i) => (
                  <div key={i} style={{
                    background:'#1a1a2e',
                    border:'1px solid rgba(255,215,0,0.15)',
                    borderRadius:12, padding:'14px 8px',
                    display:'flex', flexDirection:'column', alignItems:'center', gap:4,
                  }}>
                    <div style={{ fontSize:22 }}>{stat.icon}</div>
                    <div style={{ fontSize:20, fontWeight:'bold', color:'#e8e8f0' }}>{stat.value}</div>
                    <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', textAlign:'center' }}>{stat.label}</div>
                  </div>
                ))}
              </div>

              {/* Энергия внизу */}
              <div style={{ padding:'24px 8px 0' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                  <div style={{ fontSize:12, color:'rgba(255,255,255,0.4)', letterSpacing:1 }}>ЭНЕРГИЯ</div>
                  <div style={{ fontSize:13, color:'#ffd700', fontWeight:'bold' }}>{energy} / {MAX_ENERGY}</div>
                </div>
                <div style={{ display:'flex', gap:2, alignItems:'flex-end', height:28 }}>
                  {Array.from({ length: MAX_ENERGY }, (_, i) => (
                    <div key={i} style={{
                      flex:1,
                      height: i < energy ? (16 + Math.sin(i * 0.3) * 6) : 8,
                      borderRadius:2,
                      background: i < energy
                        ? `rgba(255, ${180 + Math.floor(i * 0.35)}, 0, ${0.7 + (i / MAX_ENERGY) * 0.3})`
                        : 'rgba(255,255,255,0.07)',
                      transition:'height 0.3s ease',
                      boxShadow: i < energy ? '0 0 4px rgba(255,200,0,0.4)' : 'none',
                    }} />
                  ))}
                </div>
              </div>

            </div>
          )}
          {activeTab === 'shop' && (
            <div style={{ padding: '0 4px' }}>
              <div style={{ padding: '20px 16px 16px' }}>
                <div style={{ fontSize: 20, fontWeight: 'bold', color: '#e8e8f0' }}>🛒 Магазин</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>Трать золото с умом</div>
              </div>
              <div style={{ height:1, background:'linear-gradient(90deg, transparent, #ffd700, transparent)', boxShadow:'0 0 8px rgba(255,215,0,0.5)', margin:'0 16px 20px' }} />

              <div style={{ padding: '0 8px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* Карточка зелья */}
                <div style={{
                  background: '#1a1a2e', border: '1px solid rgba(255,215,0,0.15)',
                  borderRadius: 12, padding: '16px',
                  display: 'flex', alignItems: 'center', gap: 16,
                }}>
                  <div style={{ fontSize: 48 }}>💊</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 16, fontWeight: 'bold', color: '#e8e8f0' }}>Зелье лечения</div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>Восстанавливает 50% HP</div>
                    <div style={{ fontSize: 12, color: '#ffd700', marginTop: 4 }}>
                      Запас: {player?.potionCharges ?? 0} шт
                    </div>
                  </div>
                  <button
                    onClick={handleBuyPotion}
                    disabled={(player?.gold ?? 0) < 20}
                    style={{
                      padding: '10px 16px', borderRadius: 8,
                      background: (player?.gold ?? 0) < 20 ? 'rgba(100,100,100,0.4)' : 'rgba(255,215,0,0.2)',
                      color: (player?.gold ?? 0) < 20 ? 'rgba(255,255,255,0.3)' : '#ffd700',
                      fontWeight: 'bold', fontSize: 14, cursor: (player?.gold ?? 0) < 20 ? 'default' : 'pointer',
                      border: '1px solid ' + ((player?.gold ?? 0) < 20 ? 'rgba(100,100,100,0.3)' : 'rgba(255,215,0,0.4)'),
                      whiteSpace: 'nowrap',
                    }}
                  >
                    20 💰
                  </button>
                </div>

                {/* Баланс */}
                <div style={{
                  background: '#1a1a2e', border: '1px solid rgba(255,215,0,0.1)',
                  borderRadius: 12, padding: '12px 16px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)' }}>Твоё золото</div>
                  <div style={{ fontSize: 18, fontWeight: 'bold', color: '#ffd700' }}>💰 {player?.gold ?? 0}</div>
                </div>
              </div>
            </div>
          )}
          {activeTab === 'gear' && (
            <div style={{ padding: '0 4px' }}>
              <div style={{ padding: '20px 16px 16px' }}>
                <div style={{ fontSize: 20, fontWeight: 'bold', color: '#e8e8f0' }}>🎒 Снаряжение</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
                  Выбери 2 скилла {savingSkills ? '...' : ''}
                </div>
              </div>
              <div style={{ height:1, background:'linear-gradient(90deg, transparent, #ffd700, transparent)', boxShadow:'0 0 8px rgba(255,215,0,0.5)', margin:'0 16px 20px' }} />
              <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:12, padding:'0 8px' }}>
                {[
                  { id:'heal',     icon:'💊', name:'Лечение',        desc:'+10% HP. Кулдаун 5с.' },
                  { id:'dash',     icon:'⚡', name:'Рывок-удар',     desc:'Рывок с уроном.' },
                  { id:'fireball', icon:'🔥', name:'Огненный шар',   desc:'Дальний урон.' },
                  { id:'slash',    icon:'🗡️', name:'Разрез',         desc:'Урон + кровотечение.' },
                  { id:'iceball',  icon:'🧊', name:'Ледяной шар',    desc:'Урон + замедление.' },
                ].map(skill => {
                  const equipped = player?.equippedSkills?.includes(skill.id) ?? false
                  const full = (player?.equippedSkills?.length ?? 0) >= 2 && !equipped
                  return (
                    <div key={skill.id} onClick={() => !full && handleSkillToggle(skill.id)}
                      style={{
                        background: equipped ? 'rgba(255,215,0,0.1)' : '#1a1a2e',
                        border: `1px solid ${equipped ? '#ffd700' : 'rgba(255,255,255,0.1)'}`,
                        borderRadius: 12, padding: '16px 12px',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                        opacity: full ? 0.4 : 1,
                        cursor: full ? 'default' : 'pointer',
                        boxShadow: equipped ? '0 0 12px rgba(255,215,0,0.2)' : 'none',
                        transition: 'all 0.2s',
                      }}>
                      <div style={{ fontSize: 36 }}>{skill.icon}</div>
                      <div style={{ fontSize: 15, fontWeight: 'bold', color: '#e8e8f0', textAlign:'center' }}>{skill.name}</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', textAlign:'center' }}>{skill.desc}</div>
                      <div style={{
                        marginTop: 4, fontSize: 11, fontWeight: 'bold',
                        color: equipped ? '#ffd700' : 'rgba(255,255,255,0.3)',
                      }}>
                        {equipped ? '✓ Экипирован' : 'Экипировать'}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {activeTab === 'friends' && (
            <div style={{ padding: '0 4px' }}>
              <div style={{ padding: '20px 16px 16px' }}>
                <div style={{ fontSize: 20, fontWeight: 'bold', color: '#e8e8f0' }}>👥 Друзья</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>Зови друзей в Right Place</div>
              </div>
              <div style={{ height:1, background:'linear-gradient(90deg, transparent, #ffd700, transparent)', boxShadow:'0 0 8px rgba(255,215,0,0.5)', margin:'0 16px 20px' }} />
              <div style={{ padding: '0 8px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{
                  background: '#1a1a2e', border: '1px solid rgba(255,215,0,0.15)',
                  borderRadius: 12, padding: '20px 16px', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 48, marginBottom: 12 }}>⚔️</div>
                  <div style={{ fontSize: 16, fontWeight: 'bold', color: '#e8e8f0', marginBottom: 8 }}>
                    Позови друга в бой
                  </div>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginBottom: 20 }}>
                    Пусть тоже испытает Right Place
                  </div>
                  <button
                    onClick={() => {
                      const url = 'https://t.me/RightPlaceGame_bot/game'
                      const text = 'Играю в Right Place — roguelike в Telegram. Присоединяйся!'
                      window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`, '_blank')
                    }}
                    style={{
                      width: '100%', padding: '14px', borderRadius: 10,
                      border: '1px solid rgba(255,215,0,0.4)',
                      background: 'rgba(255,215,0,0.15)', color: '#ffd700',
                      fontSize: 15, fontWeight: 'bold', cursor: 'pointer',
                    }}
                  >
                    📨 Пригласить друга
                  </button>
                </div>
              </div>
            </div>
          )}
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
        <p>🌀 Ловкость: {player?.agility}</p>
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

      {inBattle && <Battle initialHp={runHp} maxHp={runMaxHp} isBoss={rooms ? rooms[roomIndex] === 'boss' : false} level={player?.level ?? 1} equippedSkills={player?.equippedSkills ?? []} potionCharges={player?.potionCharges ?? 0} strength={player?.strength ?? 0} onBattleEnd={handleBattleEnd} />}
      {inSmuggler && <Smuggler trophies={player?.trophies ?? 0} onChoice={handleSmugglerChoice} />}
      {puzzleData && <Puzzle question={puzzleData.question} options={puzzleData.options} onAnswer={handlePuzzleAnswer} />}
      {roomIntro && rooms && roomIndex < rooms.length && (
        <div style={{
          position:'fixed', top:0, left:0, right:0, bottom:0,
          background:'#1a1a2e', display:'flex', flexDirection:'column',
          alignItems:'center', justifyContent:'center', zIndex:500
        }}>
          <div style={{ fontSize: 80 }}>
            {rooms[roomIndex] === 'enemy' ? '⚔️' :
             rooms[roomIndex] === 'boss' ? '👹' :
             rooms[roomIndex] === 'chest' ? '📦' :
             rooms[roomIndex] === 'trap' ? '💥' :
             rooms[roomIndex] === 'smuggler' ? '🤝' : '🧩'}
          </div>
          <div style={{ fontSize: 28, fontWeight: 'bold', marginTop: 16, color: 'white' }}>
            {ROOM_LABELS[rooms[roomIndex]]}
          </div>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', marginTop: 8 }}>
            Комната {roomIndex + 1} из {rooms.length}
          </div>
        </div>
      )}
      {rooms !== null && roomIndex >= rooms.length && (
        <div style={{ marginTop: 20 }}>
          <h2>🏆 Забег завершён!</h2>
          {results.map((r, i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8, fontSize:16 }}>
              <span>{ROOM_LABELS[r.room] ?? r.room}</span>
              <span style={{ color:'#aaa' }}>→</span>
              <span style={{ color:'#ffd700' }}>{r.message}</span>
            </div>
          ))}
          <button onClick={backToMenu} style={{ marginTop:16, padding:'12px 24px', borderRadius:8, border:'none', background:'#4caf50', color:'white', fontSize:16 }}>
            Исследовать снова
          </button>
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