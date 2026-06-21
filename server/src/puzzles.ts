// Pre-written quiz questions for the Puzzle room — testing the player's knowledge
// of the game's own mechanics. Correct answers are server-side only — the client
// never receives which option is correct, only the question and option text.

export type Puzzle = {
  id: string
  question: string
  options: string[]
  correctIndex: number
}

export const PUZZLES: Puzzle[] = [
  {
    id: 'endurance_source',
    question: 'Что растёт от полученного урона?',
    options: ['Выносливость', 'Сила', 'Удача'],
    correctIndex: 0,
  },
  {
    id: 'strength_source',
    question: 'Что растёт от нанесённого урона?',
    options: ['Сила', 'Выносливость', 'Ловкость'],
    correctIndex: 0,
  },
  {
    id: 'hp_per_endurance',
    question: 'Сколько HP даёт 1 очко Выносливости?',
    options: ['8 HP', '5 HP', '10 HP'],
    correctIndex: 0,
  },
  {
    id: 'trophies_on_death',
    question: 'Что теряется при смерти персонажа?',
    options: ['Трофеи', 'Золото', 'Уровень'],
    correctIndex: 0,
  },
  {
    id: 'dodge_mechanic',
    question: 'Как работает Додж в этой игре?',
    options: ['По таймингу игрока', 'По случайности (шанс %)', 'Автоматически'],
    correctIndex: 0,
  },
  {
    id: 'smuggler_risk',
    question: 'Какой риск несёт обмен у Контрабандиста?',
    options: ['Шанс потерять часть трофеев', 'Шанс потерять золото', 'Шанс получить урон'],
    correctIndex: 0,
  },
]

export function pickRandomPuzzle(): Puzzle {
  return PUZZLES[Math.floor(Math.random() * PUZZLES.length)]
}