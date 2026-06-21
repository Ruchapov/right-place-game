type SmugglerProps = {
  trophies: number
  onChoice: (exchange: boolean) => void
}

export default function Smuggler({ trophies, onChoice }: SmugglerProps) {
  const noTrophies = trophies === 0

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
        <h1 style={{ fontSize: 32, marginBottom: 12 }}>🤝 Контрабандист</h1>
        <p style={{ fontSize: 16, marginBottom: 20, color: '#ccc' }}>
          Обменяешь свои трофеи? Шанс получить больше... или потерять часть.
        </p>
        <p style={{ fontSize: 20, marginBottom: 24 }}>
          🏆 Трофеи: <b>{trophies}</b>
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button
            onClick={() => onChoice(true)}
            disabled={noTrophies}
            style={{
              padding: '12px 20px',
              fontSize: 16,
              borderRadius: 8,
              border: 'none',
              color: 'white',
              background: noTrophies ? '#555' : '#ff9800',
              cursor: noTrophies ? 'default' : 'pointer',
            }}
          >
            Обменять
          </button>
          {noTrophies && <p style={{ color: '#999', margin: 0, fontSize: 14 }}>Нечего менять</p>}

          <button
            onClick={() => onChoice(false)}
            style={{
              padding: '12px 20px',
              fontSize: 16,
              borderRadius: 8,
              border: 'none',
              color: 'white',
              background: '#555',
              cursor: 'pointer',
            }}
          >
            Уйти
          </button>
        </div>
      </div>
    </div>
  )
}
