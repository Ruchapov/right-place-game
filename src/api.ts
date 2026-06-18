const SERVER_URL = 'https://right-place-game.onrender.com'

export type LoginResponse = {
  token: string
  user: { id: number; firstName: string; username: string | null }
  character: {
    level: number
    energy: number
    gold: number
    endurance: number
    strength: number
    agility: number
    luck: number
  }
}

export async function loginWithTelegram(initDataRaw: string): Promise<LoginResponse> {
  const response = await fetch(`${SERVER_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData: initDataRaw }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(`Login failed: ${response.status} ${JSON.stringify(err)}`)
  }

  return await response.json() as LoginResponse
}