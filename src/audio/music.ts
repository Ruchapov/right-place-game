import type { BackdropPreset } from '../mapRenderer'
import { audioContext, cachedAudioBuffer, loadAudioBuffer, musicOutput, releaseAudioBuffer } from './sound'

// МУЗЫКА (16.11.2026, docs/audio.md): «дирижёр» состояний menu / explore /
// battle / boss / off. Каждый трек — AudioBufferSourceNode с loop (бесшовный
// круг; <audio> не годится — щель на повторе и громкость на iOS). Смена —
// плавный кроссфейд linearRampToValueAtTime. Возврат в explore продолжает трек
// с того места, где его увели (exploreOffset).
//
// Память телефона: декодированный трек ≈35 МБ. В забеге держим трек темы +
// battle (+ boss, только если на карте босс), в меню — только menu.

export type MusicState = 'menu' | 'explore' | 'battle' | 'boss' | 'off'
type Track = 'menu' | 'battle' | 'boss' | 'crypt_explore' | 'foundry_explore' | 'swamp_explore' | 'graveyard_explore'

const TRACK_VOLUME: Record<Exclude<MusicState, 'off'>, number> = { explore: 0.8, battle: 0.85, boss: 1.0, menu: 0.7 }

/** Кроссфейды, с. */
export const FADE_TO_BATTLE = 1
export const FADE_BATTLE_TO_EXPLORE = 2.5
export const FADE_TO_BOSS = 1.5
export const FADE_MENU = 1.5
/** Бой: минимум в бою и сколько «тихо» до возврата, мс. */
const BATTLE_MIN_MS = 6000
const BATTLE_CALM_MS = 4000
/** После смерти босса: тишина (гаснет за 1.5 с), потом explore. */
const BOSS_DEATH_SILENCE_MS = 3000

const RUN_TRACKS: Track[] = ['battle', 'boss', 'crypt_explore', 'foundry_explore', 'swamp_explore', 'graveyard_explore']

const trackPath = (t: Track) => `music/${t}.mp3`

/** Трек «спокойно» по теме карты (тема — backdropForMap, как у фона). */
export function exploreTrackFor(theme: BackdropPreset | string): Track {
  switch (theme) {
    case 'graveyard': return 'graveyard_explore'
    case 'flooded_crypt': return 'crypt_explore'
    case 'foundry': return 'foundry_explore'
    case 'swamp': return 'swamp_explore'
    default:
      console.warn(`music: неизвестная тема ${theme} — играет crypt_explore`)
      return 'crypt_explore'
  }
}

/** Запасной трек, если файла нет. */
const FALLBACK: Partial<Record<Track, Track>> = { graveyard_explore: 'crypt_explore', boss: 'battle' }

async function loadTrack(t: Track): Promise<{ track: Track; buf: AudioBuffer } | null> {
  const buf = await loadAudioBuffer(trackPath(t))
  if (buf) return { track: t, buf }
  const fb = FALLBACK[t]
  if (!fb) return null
  const b2 = await loadAudioBuffer(trackPath(fb))
  return b2 ? { track: fb, buf: b2 } : null
}

type Playing = { state: MusicState; track: Track; src: AudioBufferSourceNode; gain: GainNode; startedAt: number; offset: number; duration: number }

let state: MusicState = 'off'
let current: Playing | null = null
let exploreTrack: Track = 'crypt_explore'
let exploreOffset = 0
let switchToken = 0
let battleMinMs = 0
let calmMs = 0
let bossDeathMs = 0

export function musicState(): MusicState {
  return state
}

function fadeOut(p: Playing, fade: number) {
  const c = audioContext()
  if (!c) return
  if (p.state === 'explore') exploreOffset = (p.offset + (c.currentTime - p.startedAt)) % p.duration
  const t = c.currentTime
  p.gain.gain.cancelScheduledValues(t)
  p.gain.gain.setValueAtTime(p.gain.gain.value, t)
  p.gain.gain.linearRampToValueAtTime(0, t + fade)
  try { p.src.stop(t + fade + 0.05) } catch { /* уже остановлен */ }
  p.src.onended = () => { p.src.disconnect(); p.gain.disconnect() }
}

function trackForState(s: Exclude<MusicState, 'off'>): Track {
  return s === 'explore' ? exploreTrack : s
}

/** Сменить состояние музыки с кроссфейдом fade секунд. */
export function setMusicState(next: MusicState, fade: number = FADE_MENU): void {
  if (next === state) return
  state = next
  const token = ++switchToken
  if (current) { fadeOut(current, fade); current = null }
  if (next === 'battle') { battleMinMs = BATTLE_MIN_MS; calmMs = 0 }
  if (next === 'off') return
  const want = trackForState(next)
  const startOffset = next === 'explore' ? exploreOffset : 0
  void loadTrack(want).then((res) => {
    const c = audioContext()
    const out = musicOutput()
    if (!res || !c || !out || token !== switchToken) return
    const src = c.createBufferSource()
    src.buffer = res.buf
    src.loop = true
    const gain = c.createGain()
    const t = c.currentTime
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(TRACK_VOLUME[next], t + fade)
    src.connect(gain)
    gain.connect(out)
    const offset = startOffset % res.buf.duration
    src.start(t, offset)
    current = { state: next, track: res.track, src, gain, startedAt: t, offset, duration: res.buf.duration }
  })
}

/** Вход в забег: трек темы, память — только треки забега. */
export function prepareRunMusic(theme: BackdropPreset | string, hasBoss: boolean): void {
  exploreTrack = exploreTrackFor(theme)
  exploreOffset = 0
  bossDeathMs = 0
  const keep = new Set<Track>([exploreTrack, 'battle'])
  if (exploreTrack === 'graveyard_explore') keep.add('crypt_explore') // запасной
  if (hasBoss) keep.add('boss')
  releaseAudioBuffer(trackPath('menu'))
  for (const t of RUN_TRACKS) if (!keep.has(t)) releaseAudioBuffer(trackPath(t))
  for (const t of keep) if (t !== 'crypt_explore' || exploreTrack === 'crypt_explore') void loadAudioBuffer(trackPath(t))
  // Смена карты посреди забега — новый трек темы с начала.
  if (state === 'explore' || state === 'battle' || state === 'boss') state = 'off'
  setMusicState('explore', FADE_MENU)
}

/** Меню (вне забега или экран итогов): отпустить треки забега, играть menu. */
export function enterMenuMusic(): void {
  bossDeathMs = 0
  setMusicState('menu', FADE_MENU)
  for (const t of RUN_TRACKS) if (!(current && current.track === t)) releaseAudioBuffer(trackPath(t))
}

/** Отпустить треки забега, которые уже не звучат (после кроссфейда в меню). */
export function releaseRunMusic(): void {
  for (const t of RUN_TRACKS) if (!(current && current.track === t)) releaseAudioBuffer(trackPath(t))
}

/** Герой получил урон от врага — бой. */
export function musicHeroHit(): void {
  if (state === 'explore') setMusicState('battle', FADE_TO_BATTLE)
  else if (state === 'battle') calmMs = 0
}

export function musicBossAppeared(): void {
  bossDeathMs = 0
  setMusicState('boss', FADE_TO_BOSS)
}

export function musicBossDied(): void {
  if (state !== 'boss') return
  setMusicState('off', 1.5)
  bossDeathMs = BOSS_DEATH_SILENCE_MS
}

export function musicHeroDied(): void {
  bossDeathMs = 0
  setMusicState('off', 1)
}

/**
 * Каждый кадр забега: engaged — хоть один враг преследует героя или атакует.
 * Вход в бой — сразу; выход — после BATTLE_CALM_MS тишины, но не раньше
 * BATTLE_MIN_MS от входа.
 */
export function updateCombatMusic(deltaMS: number, engaged: boolean): void {
  if (bossDeathMs > 0) {
    bossDeathMs -= deltaMS
    if (bossDeathMs <= 0 && state === 'off') setMusicState('explore', FADE_MENU)
    return
  }
  if (state === 'explore') {
    if (engaged) setMusicState('battle', FADE_TO_BATTLE)
  } else if (state === 'battle') {
    battleMinMs = Math.max(0, battleMinMs - deltaMS)
    calmMs = engaged ? 0 : calmMs + deltaMS
    if (battleMinMs <= 0 && calmMs >= BATTLE_CALM_MS) setMusicState('explore', FADE_BATTLE_TO_EXPLORE)
  }
}

/** Для отладки: загружен ли трек. */
export function musicTrackCached(t: Track): boolean {
  return cachedAudioBuffer(trackPath(t)) !== null
}
