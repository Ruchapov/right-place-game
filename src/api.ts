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
    trophies: number
    equippedSkills: string[]
    potionCharges: number
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
export type RunResult = {
  energy: number
  rooms: string[]
  hp: number
  maxHp: number
  potions?: number
  armor?: number
}

export async function startRun(token: string): Promise<RunResult> {
  const response = await fetch(`${SERVER_URL}/run/start`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(`Run failed: ${response.status} ${JSON.stringify(err)}`)
  }
  return await response.json() as RunResult
}
export type RoomResult = {
  roomType: string
  goldGained: number
  damageTaken: number
  hp: number
  maxHp: number
  died: boolean
  message: string
  gold: number
  index: number
  done: boolean
  level: number
  levelsGained: number
  strength: number
  endurance: number
  droppedItem?: { name: string; slot: string; iconPath: string } | null
}

export async function enterRoom(token: string): Promise<RoomResult> {
  const response = await fetch(`${SERVER_URL}/run/room`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(`Room failed: ${response.status} ${JSON.stringify(err)}`)
  }
  return await response.json() as RoomResult
}
export type BattleResult = {
  roomType: string
  trophyGained: number
  damageTaken: number
  hp: number
  maxHp: number
  died: boolean
  message: string
  trophies: number
  index: number
  done: boolean
  level: number
  levelsGained: number
  strength: number
  endurance: number
  agility?: number
  potions?: number
  droppedItem?: { name: string; slot: string; iconPath: string } | null
}

export async function submitBattleResult(
  token: string,
  won: boolean,
  damageTaken: number,
  damageDealt: number,
  skillUses: number,
  actualHpLost: number,
  potionsUsed: number,
  attackDamageDealt: number,
  skillDamageDealt: number,
  healedAmount: number,
): Promise<BattleResult> {
  const response = await fetch(`${SERVER_URL}/run/battle-result`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ won, damageTaken, damageDealt, skillUses, actualHpLost, potionsUsed, attackDamageDealt, skillDamageDealt, healedAmount }),
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(`Battle result failed: ${response.status} ${JSON.stringify(err)}`)
  }
  return await response.json() as BattleResult
}
export type SmugglerResult = {
  roomType: string
  exchanged: boolean
  stolen: boolean
  trophies: number
  message: string
  hp: number
  maxHp: number
  died: boolean
  index: number
  done: boolean
}

export async function submitSmugglerResult(token: string, exchange: boolean): Promise<SmugglerResult> {
  const response = await fetch(`${SERVER_URL}/run/smuggler-result`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ exchange }),
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(`Smuggler result failed: ${response.status} ${JSON.stringify(err)}`)
  }
  return await response.json() as SmugglerResult
}
export type PuzzleQuestion = {
  question: string
  options: string[]
}

export async function getPuzzle(token: string): Promise<PuzzleQuestion> {
  const response = await fetch(`${SERVER_URL}/run/puzzle`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(`Get puzzle failed: ${response.status} ${JSON.stringify(err)}`)
  }
  return await response.json() as PuzzleQuestion
}

export type PuzzleResult = {
  roomType: string
  correct: boolean
  goldGained: number
  damageTaken: number
  hp: number
  maxHp: number
  died: boolean
  message: string
  gold: number
  index: number
  done: boolean
  level: number
  levelsGained: number
  strength: number
  endurance: number
}

export async function submitPuzzleResult(token: string, selectedIndex: number): Promise<PuzzleResult> {
  const response = await fetch(`${SERVER_URL}/run/puzzle-result`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ selectedIndex }),
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(`Puzzle result failed: ${response.status} ${JSON.stringify(err)}`)
  }
  return await response.json() as PuzzleResult
}

export async function saveEquippedSkills(token: string, skills: string[]): Promise<{ equippedSkills: string[] }> {
  const response = await fetch(`${SERVER_URL}/character/skills`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ skills }),
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(`Save skills failed: ${response.status} ${JSON.stringify(err)}`)
  }
  return await response.json()
}

export type BuyPotionResult = {
  gold: number
  potionCharges: number
}

export async function buyPotion(token: string): Promise<BuyPotionResult> {
  const response = await fetch(`${SERVER_URL}/character/buy-potion`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(`Buy potion failed: ${response.status} ${JSON.stringify(err)}`)
  }
  return await response.json()
}

export type InventoryItem = {
  inventoryItemId: string
  equipped: boolean
  item: {
    id: string
    slot: string
    tier: number
    nameRu: string
    iconPath: string
    levelRequired: number
    damage: number | null
    armor: number | null
    moveSpeed: number | null
    luck: number | null
  }
}

export type InventoryResponse = { inventory: InventoryItem[] }

export async function fetchInventory(token: string): Promise<InventoryResponse> {
  const response = await fetch(`${SERVER_URL}/character/inventory`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(`Fetch inventory failed: ${response.status} ${JSON.stringify(err)}`)
  }
  return await response.json() as InventoryResponse
}

export type EquipResponse = { success: boolean; equippedItemId: string | null; unequippedItemId: string | null }

export async function equipItem(token: string, inventoryItemId: string, equip: boolean): Promise<EquipResponse> {
  const response = await fetch(`${SERVER_URL}/character/equip`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ inventoryItemId, equip }),
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(`Equip item failed: ${response.status} ${JSON.stringify(err)}`)
  }
  return await response.json() as EquipResponse
}