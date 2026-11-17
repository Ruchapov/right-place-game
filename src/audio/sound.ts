// ЗВУК (16.11.2026, docs/audio.md). Чистый Web Audio API, без пакетов.
//
// Один AudioContext, три GainNode: master → (music, sfx). На телефоне (iOS,
// Telegram) звук молчит до первого касания: pointerdown/touchend
// на window зовут ctx.resume(), до этого play просто ничего не делает.
// Свернули Telegram (document.visibilitychange → hidden) — ctx.suspend().
//
// Эффекты грузятся один раз фоном (preloadSfx, ~550 КБ). Ошибка одного файла —
// console.warn и дальше без него: игра не падает.

const AUDIO_BASE = `${import.meta.env.BASE_URL}assets/audio/`

/** Базовые громкости эффектов (0–1). Подкручивать здесь. */
export const SFX_VOLUMES = {
  sword_swing_1: 0.55,
  enemy_hit_1: 0.7,
  step_stone: 0.22,
  jump: 0.4,
  land: 0.35,
  dash: 0.6,
  block: 0.7,
  hero_hurt: 0.75,
  hero_death: 0.9,
  potion: 0.6,
  chest_open: 0.7,
  pickup: 0.45,
  barrel_break: 0.65,
  jar_break: 0.65,
  spikes: 0.7,
  ui_click: 0.35,
  enemy_alert: 0.5,
  enemy_death: 0.6,
  boss_appear: 0.9,
  boss_slam: 0.9,
  boss_bell_swing: 0.8,
  boss_hurt: 0.7,
  boss_death: 1.0,
  werewolf_roar: 0.85,
  werewolf_claws: 0.7,
  serpent_bite: 0.8,
  serpent_spit: 0.6,
  crowking_wings: 0.75,
  crowking_scatter: 0.75,
  shadow_chest: 0.7,
  gravedigger_shovel: 0.6,
  gravedigger_dirt: 0.5,
  crossbow_shot: 0.6,
  stoker_fire: 0.65,
  beetle_throw: 0.55,
  beetle_dash: 0.55,
} as const

export type SfxName = keyof typeof SFX_VOLUMES

/** Звуки с вариантами: имя → файлы (случайный, не тот же, что в прошлый раз). */
const SFX_VARIANTS: Partial<Record<SfxName, string[]>> = {
  step_stone: ['step_stone_1', 'step_stone_2', 'step_stone_3', 'step_stone_4', 'step_stone_5'],
}

const SFX_MIN_GAP_MS = 50
const SFX_MAX_SAME = 4
const SFX_MAX_TOTAL = 16
/** Пространственность: полная громкость до FULL тайлов, ноль дальше ZERO. */
const TILE = 64
const SPATIAL_FULL_PX = 6 * TILE
const SPATIAL_ZERO_PX = 16 * TILE
const PAN_MAX = 0.6

// --- Настройки ---
const STORAGE_KEY = 'rp_audio_v1'
export type AudioSettings = { musicVolume: number; sfxVolume: number; muted: boolean }
const DEFAULT_SETTINGS: AudioSettings = { musicVolume: 0.5, sfxVolume: 0.8, muted: false }

function clamp01(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback
}

function readSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const p = JSON.parse(raw) as Partial<AudioSettings>
    return {
      musicVolume: clamp01(p.musicVolume, DEFAULT_SETTINGS.musicVolume),
      sfxVolume: clamp01(p.sfxVolume, DEFAULT_SETTINGS.sfxVolume),
      muted: p.muted === true,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

let settings: AudioSettings = readSettings()
const listeners = new Set<() => void>()

export function getAudioSettings(): AudioSettings {
  return settings
}

export function setAudioSettings(patch: Partial<AudioSettings>): void {
  settings = {
    musicVolume: clamp01(patch.musicVolume ?? settings.musicVolume, settings.musicVolume),
    sfxVolume: clamp01(patch.sfxVolume ?? settings.sfxVolume, settings.sfxVolume),
    muted: patch.muted ?? settings.muted,
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // WebView Telegram может запретить хранилище — настройка живёт до перезапуска.
  }
  applyBusVolumes()
  for (const l of listeners) l()
}

/** Подписка для React (useSyncExternalStore). */
export function subscribeAudioSettings(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

// --- Контекст и шины ---
let ctx: AudioContext | null = null
let master: GainNode | null = null
let musicBus: GainNode | null = null
let sfxBus: GainNode | null = null
let unlocked = false

function applyBusVolumes() {
  if (!ctx || !master || !musicBus || !sfxBus) return
  const t = ctx.currentTime
  master.gain.setTargetAtTime(settings.muted ? 0 : 1, t, 0.02)
  musicBus.gain.setTargetAtTime(settings.musicVolume, t, 0.02)
  sfxBus.gain.setTargetAtTime(settings.sfxVolume, t, 0.02)
}

/** Контекст и шина музыки — для music.ts. null, пока звук не создан. */
export function audioContext(): AudioContext | null {
  return ctx
}
export function musicOutput(): GainNode | null {
  return musicBus
}
/** Разблокирован ли звук касанием (до этого всё молчит). */
export function audioUnlocked(): boolean {
  return unlocked && ctx !== null && ctx.state === 'running'
}

/**
 * Создать звук: контекст, шины, разблокировка касанием, пауза при
 * сворачивании и фоновая загрузка эффектов. Зовётся один раз из main.tsx.
 */
export function initAudio(): void {
  if (ctx) return
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) {
    console.warn('audio: Web Audio недоступен — игра без звука')
    return
  }
  try {
    ctx = new Ctor()
  } catch (e) {
    console.warn('audio: AudioContext не создан — игра без звука', e)
    ctx = null
    return
  }
  master = ctx.createGain()
  musicBus = ctx.createGain()
  sfxBus = ctx.createGain()
  musicBus.connect(master)
  sfxBus.connect(master)
  master.connect(ctx.destination)
  applyBusVolumes()

  // Разблокировка касанием. Слушатели НЕ снимаются (17.11.2026): iOS может
  // «прервать» контекст (звонок, Siri, сворачивание Telegram), и тогда
  // resume без касания не проходит — следующее касание поднимет его снова.
  // Пока всё играет, обработчик выходит сразу.
  const unlock = () => {
    if (!ctx) return
    // Аудиосессия iPhone — «воспроизведение», а не «окружение»: звук игры
    // играет и при переключателе «Без звука» сбоку (решение Андрея
    // 17.11.2026). Громкость и «Без звука» — только из настроек игры.
    enablePlaybackSession()
    if (ctx.state === 'running' && unlocked) return
    ctx.resume().then(() => {
      const first = !unlocked
      unlocked = true
      if (first) for (const cb of unlockCallbacks) cb()
    }).catch(() => { /* следующее касание попробует снова */ })
  }
  window.addEventListener('pointerdown', unlock)
  window.addEventListener('touchend', unlock)

  document.addEventListener('visibilitychange', () => {
    if (!ctx) return
    if (document.hidden) {
      void ctx.suspend().catch(() => {})
      silentKeeper?.pause()
    } else if (unlocked) {
      if (silentKeeper) void silentKeeper.play().catch(() => {})
      void ctx.resume().catch(() => { /* поднимет следующее касание (unlock) */ })
    }
  })

  preloadSfx()
}

// --- Звук и при переключателе «Без звука» (iPhone, 17.11.2026) ---
// Web Audio на iOS по умолчанию в аудиосессии «ambient» — её глушит боковой
// переключатель. iOS 16.4+ даёт navigator.audioSession.type = 'playback'.
// Старым iOS — приём с тихим зацикленным <audio>: пока он играет, сессия
// страницы «playback», и Web Audio звучит тоже. Запускать его можно только из
// касания — поэтому всё это зовёт unlock.
let silentKeeper: HTMLAudioElement | null = null
let playbackSessionSet = false

/** Короткая тишина WAV (0.5 с, 8 кГц, 8 бит моно) — без отдельного файла. */
function silentWavUrl(): string {
  const samples = 4000
  const buf = new Uint8Array(44 + samples)
  const dv = new DataView(buf.buffer)
  const str = (o: number, t: string) => { for (let i = 0; i < t.length; i++) buf[o + i] = t.charCodeAt(i) }
  str(0, 'RIFF'); dv.setUint32(4, 36 + samples, true); str(8, 'WAVE')
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true)
  dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true)
  str(36, 'data'); dv.setUint32(40, samples, true)
  buf.fill(128, 44) // 8-битная тишина — середина шкалы
  let bin = ''
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i])
  return `data:audio/wav;base64,${btoa(bin)}`
}

function enablePlaybackSession(): void {
  const nav = navigator as unknown as { audioSession?: { type: string } }
  if (nav.audioSession) {
    if (!playbackSessionSet) {
      try {
        nav.audioSession.type = 'playback'
        playbackSessionSet = true
      } catch (e) {
        console.warn('audio: audioSession.type не принят', e)
      }
    }
    return
  }
  // Старый iOS (и любой браузер без audioSession): тихий зацикленный <audio>.
  // На ПК он безвреден. Только на устройствах Apple — на Android переключателя
  // «Без звука» для страниц нет, а лишний медиаплеер в шторке ни к чему.
  if (!/iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) || !('ontouchend' in document)) return
  if (!silentKeeper) {
    const a = document.createElement('audio')
    a.setAttribute('playsinline', '')
    a.setAttribute('webkit-playsinline', '')
    a.loop = true
    a.preload = 'auto'
    a.src = silentWavUrl()
    silentKeeper = a
  }
  if (silentKeeper.paused && !document.hidden) void silentKeeper.play().catch(() => { /* попробует следующее касание */ })
}

const unlockCallbacks = new Set<() => void>()
/** Колбэк на разблокировку звука (музыка стартует, как только можно). */
export function onAudioUnlocked(cb: () => void): void {
  unlockCallbacks.add(cb)
}

// --- Загрузка ---
const buffers = new Map<string, AudioBuffer>()
const loading = new Map<string, Promise<AudioBuffer | null>>()

/** Загрузить и декодировать файл (кэш по пути). null — не удалось. */
export function loadAudioBuffer(path: string): Promise<AudioBuffer | null> {
  const ready = buffers.get(path)
  if (ready) return Promise.resolve(ready)
  const pending = loading.get(path)
  if (pending) return pending
  const c = ctx
  if (!c) return Promise.resolve(null)
  const p = fetch(AUDIO_BASE + path)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.arrayBuffer()
    })
    .then((data) => c.decodeAudioData(data))
    .then((buf) => {
      buffers.set(path, buf)
      loading.delete(path)
      return buf
    })
    .catch((e) => {
      console.warn(`audio: не загрузился ${path} — дальше без него`, e)
      loading.delete(path)
      return null
    })
  loading.set(path, p)
  return p
}

/** Отпустить декодированный буфер (музыка ~35 МБ на трек). */
export function releaseAudioBuffer(path: string): void {
  buffers.delete(path)
}

export function cachedAudioBuffer(path: string): AudioBuffer | null {
  return buffers.get(path) ?? null
}

const sfxPath = (file: string) => `sfx/${file}.mp3`

function preloadSfx() {
  for (const name of Object.keys(SFX_VOLUMES) as SfxName[]) {
    const files = SFX_VARIANTS[name] ?? [name]
    for (const f of files) void loadAudioBuffer(sfxPath(f))
  }
}

// --- Эффекты ---
let listenerX = 0
let listenerY = 0
let listenerSet = false
/** Положение героя в мире — от него считается громкость и панорама. */
export function setAudioListener(x: number, y: number): void {
  listenerX = x
  listenerY = y
  listenerSet = true
}

const lastPlayed = new Map<string, number>()
const lastVariant = new Map<string, string>()
const activeByName = new Map<string, number>()
let activeTotal = 0

export type SfxOptions = {
  /** Множитель к базовой громкости. */
  volume?: number
  rate?: number
  /** Позиция в мире: громкость падает с расстоянием до героя, панорама по X. */
  x?: number
  y?: number
}

export function playSfx(name: SfxName, opts: SfxOptions = {}): void {
  const c = ctx
  if (!c || !sfxBus || !unlocked || c.state !== 'running') return
  if (settings.muted || settings.sfxVolume <= 0) return
  const now = performance.now()
  if (now - (lastPlayed.get(name) ?? -Infinity) < SFX_MIN_GAP_MS) return
  if ((activeByName.get(name) ?? 0) >= SFX_MAX_SAME) return
  if (activeTotal >= SFX_MAX_TOTAL) return

  // Вариант — случайный, не тот же, что в прошлый раз.
  let file: string = name
  const variants = SFX_VARIANTS[name]
  if (variants && variants.length > 0) {
    const prev = lastVariant.get(name)
    const pool = variants.length > 1 ? variants.filter((v) => v !== prev) : variants
    file = pool[Math.floor(Math.random() * pool.length)]
    lastVariant.set(name, file)
  }
  const buf = buffers.get(sfxPath(file))
  if (!buf) return

  let volume = SFX_VOLUMES[name] * (opts.volume ?? 1)
  let rate = opts.rate ?? 1
  if (name !== 'ui_click') {
    rate *= 0.95 + Math.random() * 0.1
    volume *= 0.9 + Math.random() * 0.1
  }
  let pan = 0
  if (opts.x !== undefined && listenerSet) {
    const dx = opts.x - listenerX
    const dy = (opts.y ?? listenerY) - listenerY
    const dist = Math.hypot(dx, dy)
    const k = dist <= SPATIAL_FULL_PX ? 1 : dist >= SPATIAL_ZERO_PX ? 0 : 1 - (dist - SPATIAL_FULL_PX) / (SPATIAL_ZERO_PX - SPATIAL_FULL_PX)
    if (k <= 0) return
    volume *= k
    pan = Math.max(-PAN_MAX, Math.min(PAN_MAX, (dx / SPATIAL_ZERO_PX) * PAN_MAX * 2))
  }

  const src = c.createBufferSource()
  src.buffer = buf
  src.playbackRate.value = rate
  const gain = c.createGain()
  gain.gain.value = volume
  src.connect(gain)
  if (pan !== 0 && typeof c.createStereoPanner === 'function') {
    const p = c.createStereoPanner()
    p.pan.value = pan
    gain.connect(p)
    p.connect(sfxBus)
  } else {
    gain.connect(sfxBus)
  }
  lastPlayed.set(name, now)
  activeByName.set(name, (activeByName.get(name) ?? 0) + 1)
  activeTotal += 1
  src.onended = () => {
    activeByName.set(name, Math.max(0, (activeByName.get(name) ?? 1) - 1))
    activeTotal = Math.max(0, activeTotal - 1)
    src.disconnect()
    gain.disconnect()
  }
  src.start()
}
