export async function verifyTelegramInitData(initData: string, botToken: string): Promise<boolean> {
  try {
    const params = new URLSearchParams(initData)
    const hash = params.get('hash')
    if (!hash) return false

    params.delete('hash')

    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')

    const encoder = new TextEncoder()

    const baseKey = await globalThis.crypto.subtle.importKey(
      'raw',
      encoder.encode('WebAppData'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )

    const secretKey = await globalThis.crypto.subtle.sign(
      'HMAC',
      baseKey,
      encoder.encode(botToken)
    )

    const hmacKey = await globalThis.crypto.subtle.importKey(
      'raw',
      secretKey,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )

    const signature = await globalThis.crypto.subtle.sign(
      'HMAC',
      hmacKey,
      encoder.encode(dataCheckString)
    )

    const expectedHash = Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    return expectedHash === hash
  } catch {
    return false
  }
}

export function parseTelegramUser(initData: string) {
  const params = new URLSearchParams(initData)
  const userStr = params.get('user')
  if (!userStr) return null

  type TgUser = { id: number; first_name: string; last_name?: string; username?: string }
  // URLSearchParams.get УЖЕ раскодировал поле (26.11.2026): второй
  // decodeURIComponent ронял вход у игрока, в имени которого есть «%» (URIError →
  // 400 «Cannot parse user data» — новый игрок не мог войти вовсе). Сначала —
  // как есть; старый путь — только запасной.
  try {
    return JSON.parse(userStr) as TgUser
  } catch {
    try {
      return JSON.parse(decodeURIComponent(userStr)) as TgUser
    } catch {
      return null
    }
  }
}