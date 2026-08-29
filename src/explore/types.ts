export type Grid = string[][]

// "3 события за забег" — ВРЕМЕННЫЙ каркас (Phase 2, часть 2). kind совпадает
// со строками ROOM_LABELS в App.tsx (enemy/chest/smuggler/puzzle/boss), чтобы
// результат забега можно было отдать старому results-экрану без маппинга.
export type EventKind = 'enemy' | 'chest' | 'smuggler' | 'puzzle' | 'boss' | 'obelisk'

// clusterPoints — ТОЛЬКО для kind='enemy': все 3 точки кластера (не только
// points[0]) — нужны, чтобы заспавнить весь кластер, а не одного врага.
export type EventCandidate = { kind: EventKind; x: number; y: number; clusterPoints?: [number, number][] }

// Тело босса стоит в клетке НЕ по центру и по-разному в каждом листе (см.
// задачу) — anchor.x И anchor.y меняются ТОЛЬКО при смене листа (playBossAnim),
// внутри одной анимации запрещено трогать оба.
export type BossAnimKind = 'idle' | 'walk' | 'melee' | 'melee2' | 'hurt' | 'death' | 'ranged' | 'stomp'

// Плавающий попап награды над объектом (Explore офлайн — НИКАКОГО начисления
// player.gold/trophies/crystals, только визуал поверх мира, см. spawnRewardFloat
// в setup). Иконки — тот же способ пути (BASE_URL), что у героя/зверя/сундука.
export type RewardKind = 'gold' | 'trophy' | 'rp'
