import type { QuestId } from '../quests'
import type { QuestReward, QuestView } from '../api'

// Что доска заданий показывает — без вёрстки (вёрстка — QuestBoard.tsx). Отдельным
// модулем: App.tsx берёт отсюда активное задание для вопроса «Взять …?» и текст
// таймера, а файл компонентов должен экспортировать только компоненты.

/** Один листок на доске — то, что от вида заданий нужно его вёрстке. */
export type BoardNote = {
  id: QuestId
  goal: number
  reward: QuestReward
  /** Прогресс — только у активного (взятого или переходящего). */
  progress: number | null
  active: boolean
}

/**
 * Какие листки видны: только оставшиеся. Выполненные и пропавшие с доски
 * исчезают. Активное (взятое или переходящее из прошлого набора) — первым, под
 * кинжалом; невзятые — за ним, в порядке набора.
 */
export function boardNotes(view: QuestView): BoardNote[] {
  const notes: BoardNote[] = []
  if (view.carried) notes.push({ id: view.carried.id, goal: view.carried.goal, reward: view.carried.reward, progress: view.carried.progress, active: true })
  for (const s of view.set) if (s.status === 'active') notes.push({ id: s.id, goal: s.goal, reward: s.reward, progress: s.progress ?? 0, active: true })
  for (const s of view.set) if (s.status === 'open') notes.push({ id: s.id, goal: s.goal, reward: s.reward, progress: null, active: false })
  return notes
}

/** «Ч:ММ» до нового набора — минуты вверх: последняя минута показывается «0:01». */
export function questCountdownLabel(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60000))
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}
