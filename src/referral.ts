// Приглашения друзей (12.11.2026, docs/referral.md).
//
// ⚠️ ОБЩИЙ КАТАЛОГ: src/referral.ts и server/src/referral.ts — байт в байт
// (сверяет tools/check_potion_sync.py). Правишь — правь обе копии.
//
// Ссылка друга — https://t.me/RightPlaceGame_bot/game?startapp=r_<код>. Telegram
// кладёт start_param в ПОДПИСАННЫЙ initData, и сервер читает его только оттуда.
// Привязка — только при создании нового игрока. Награда — обоим, когда
// приглашённый дорос до REFERRAL_LEVEL: приглашённый получает её сам (вход или
// финиш), пригласивший — кнопкой «Забрать» во вкладке «Друзья». Ограничений на
// число друзей и наград нет (решение владельца 12.11.2026).

/** Префикс start_param ссылки-приглашения: startapp=r_<referralCode>. */
export const REFERRAL_PREFIX = 'r_'
/** Уровень (calculateLevel), с которого друг «дошёл» и награда выдаётся обоим. */
export const REFERRAL_LEVEL = 3
/** Награда каждой стороне. */
export const REFERRAL_GOLD = 5000
export const REFERRAL_RP = 100
/** Длина кода — 8 знаков [A-Za-z0-9]. */
export const REFERRAL_CODE_LENGTH = 8

export function referralUrl(code: string): string {
  return `https://t.me/RightPlaceGame_bot/game?startapp=${REFERRAL_PREFIX}${code}`
}

/** Код из start_param: «r_» + 8 знаков [A-Za-z0-9]; иначе null (не наша ссылка или мусор). */
export function parseReferralStartParam(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.startsWith(REFERRAL_PREFIX)) return null
  const code = raw.slice(REFERRAL_PREFIX.length)
  return /^[A-Za-z0-9]{8}$/.test(code) ? code : null
}

/** Состояние друга в списке пригласившего. */
export type FriendState = 'progress' | 'claim' | 'claimed'

export function friendState(level: number, inviterClaimed: boolean): FriendState {
  if (inviterClaimed) return 'claimed'
  return level >= REFERRAL_LEVEL ? 'claim' : 'progress'
}
