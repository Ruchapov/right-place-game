type PuzzleProps = {
  question: string
  options: string[]
  onAnswer: (selectedIndex: number) => void
}

export default function Puzzle({ question, options, onAnswer }: PuzzleProps) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 1000,
        background: '#1a1a2e',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{ padding: 30, maxWidth: 360, textAlign: 'center', color: 'white' }}>
        <h1 style={{ fontSize: 32, marginBottom: 12 }}>🧩 Загадка</h1>
        <p style={{ fontSize: 18, marginBottom: 24, color: '#ccc' }}>{question}</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {options.map((option, i) => (
            <button
              key={i}
              onClick={() => onAnswer(i)}
              style={{
                padding: '12px 20px',
                fontSize: 16,
                borderRadius: 8,
                border: 'none',
                color: 'white',
                background: '#1976d2',
                cursor: 'pointer',
              }}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
