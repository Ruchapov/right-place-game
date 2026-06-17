# Right Place — Telegram Roguelike Game

## Project Info
- **Bot:** @RightPlaceGame_bot
- **Mini App:** t.me/RightPlaceGame_bot/game
- **GitHub:** https://github.com/Ruchapov/right-place-game
- **Production URL:** https://ruchapov.github.io/right-place-game/
- **Developer:** Andrey Rychapov (solo)

## Tech Stack
- Frontend: React 18 + TypeScript + Vite
- Game Engine: PixiJS (to be added)
- Telegram SDK: @telegram-apps/sdk-react
- Backend: Node.js + Fastify + TypeScript (to be added)
- Database: PostgreSQL + Prisma (to be added)
- Package manager: npm

## Local Development
- Vite dev server: `npm run dev -- --host` (port 5173)
- ngrok tunnel: `ngrok http 5173` (only for local Telegram testing)
- Deploy to production: `npm run deploy`
- Production changes live in 1-2 minutes after deploy

## Coding Rules
- Always use TypeScript (no plain .js files in src/)
- Use functional React components with hooks only
- No class components
- Keep components small and focused
- All game logic must be in /src/game/ — never inside UI components
- Game engine (PixiJS) renders in canvas, React handles UI overlays only

---

## GAME DESIGN DOCUMENT

### Overview
- **Genre:** Roguelike with Souls-like combat
- **Platform:** Telegram Mini App (mobile first)
- **Camera:** 2D Side View
- **Initial Mode:** PvE only
- **Future:** PvP planned post-MVP
- **MVP Goal:** Player reaches Level 20

---

### Core Game Loop
1. Player presses "Start Run"
2. Selects equipment (or keeps current)
3. Spends 10 Energy
4. Receives 3 random rooms
5. Completes rooms
6. Receives rewards
7. Returns to menu
8. Upgrades character
9. Repeat

---

### Energy System
- Maximum: 100 Energy
- Regeneration: 1 Energy per minute (SERVER TIME — cannot be exploited by changing phone clock)
- Cost per Run: 10 Energy

---

### Room System
Each run = exactly 3 random rooms.

Room type probabilities:
| Room Type | Chance |
|-----------|--------|
| Normal Enemy | 60% |
| Chest | 15% |
| Trap | 10% |
| Puzzle | 10% |
| Smuggler | 3% |
| Boss | 2% |

**Trap Room:** Player takes damage on entry. Cannot be avoided. No combat. Proceed to next room.

**Puzzle Room:** TBD (mechanics not yet designed)

**Smuggler Room:**
- Exchange all trophies × 1.5 (rounded down)
- OR 20% chance Smuggler STEALS 50% of carried trophies
- Player does not know in advance if Smuggler will steal

**Boss Room:**
- Boss = 1.5× normal enemy stats
- AoE attack + Ranged attack
- Killing boss: instant Level Up + permanent stat reward choice

**Exit Rules:**
- Exiting mid-run = ALL trophies lost (treated as death for trophies)
- Cannot exit during active combat (prevents Endurance farming exploit)

---

### Combat System
**Player Actions:** Movement, Attack (single hit), Dodge, Skills (2 active), Potions

**Not included:** Block, Parry, Combo chains

**Philosophy:** Attack → Dodge → Reposition → Attack

**Dodge:** Skill-based timing, NOT RNG

---

### Skills
Player equips exactly 2 skills from 5 available.

All skills: 5-second cooldown, no mana cost.

| Skill | Effect |
|-------|--------|
| Dash Strike | Dash forward; deals damage if passes through enemy |
| Fireball | Ranged damage projectile |
| Slash | Damage + Bleeding (damage per second) |
| Heal | Restores 10% HP |
| Ice Ball | Damage + slows enemy |

Skills can be upgraded (with diminishing returns on upgrades).

Each skill's Agility scaling is defined per skill individually.

---

### Potions
- Starting charges: 3
- Cooldown between uses: 2 seconds
- Heal amount: 50% of player's current max HP
- Usable: during combat AND between rooms
- Restock: buy with Gold at shop
- Charges carry over to next run (if you have them)

---

### Character Stats

| Stat | Base | Growth Method |
|------|------|---------------|
| Endurance | 10 | +1 per X total damage received (lifetime) |
| HP | 80 | 1 Endurance = 8 HP |
| Strength | — | +1 per X damage dealt (with diminishing returns) |
| Agility | — | +1 per X skill uses (with diminishing returns) |
| Crit Damage | 1.5× | Fixed starting value |
| Movement Speed | Base | Equipment only, max 1.5× base |
| Luck | — | Affects gold/loot quality, NOT dodge |

**Strength:** 2 Strength = 1 Damage

**Agility:** Each skill has its own Agility scaling formula

---

### Growth Formulas (designed for slow progression, no content burn in 1 day)

**Endurance growth:**
- Every 50 cumulative damage received = +1 Endurance
- Diminishing returns: after Endurance 30, requires 100 damage per point

**Strength growth:**
- Every 100 damage dealt = +1 Strength
- Diminishing returns: after Strength 20, requires 200 damage per point

**Agility growth:**
- Every 20 skill uses = +1 Agility
- Diminishing returns: after Agility 20, requires 40 skill uses per point

---

### Leveling System

**Method 1 — Stat Progression:**
- Requires: Endurance +3 AND (Strength + Agility) +6 since last level
- Stats must be gained through gameplay (not purchases)

**Method 2 — Boss Kill:**
- Instant Level Up upon boss death
- Stats do NOT automatically increase
- Player chooses a permanent stat reward (HP / Damage / other)

**Enemy Scaling per Level:**
- Every player level: enemy HP +10%, enemy Damage +8%
- Players who level via bosses without stat growth will feel this pressure

---

### Equipment Slots
| Slot | Effect |
|------|--------|
| Weapon | Damage + bonus stats + Crit Chance + Attack Speed + Armor Pen |
| Helmet | Defense + bonus stats |
| Armor | Defense only |
| Boots | Movement Speed |
| Gloves | Bonus to Strength OR Agility gain (%) — increases per gear level |
| Amulet | Luck bonus — increases per gear level |

**Gloves (Strength type):** +5% Strength gain per gear tier (Tier 1: +5%, Tier 2: +10%, etc.)
**Gloves (Agility type):** +5% Agility gain per gear tier
**Amulet:** +3 Luck per gear tier

New equipment tier unlocks every 5 player levels (up to Level 50).
Items drop at player level or below.
No rarity system at launch.

---

### Currencies

| Currency | Use | Source | Lost on death? |
|----------|-----|--------|----------------|
| Gold | Upgrades, shop, potions | Chests, events, selling items, trophy exchange | No |
| Trophies | Exchange for Gold | Killing enemies | YES — all lost on death or exit |
| Crystals | Premium | Daily quests, real money | No |

Normal enemies do NOT drop Gold directly.
Trophies → Gold exchange rate: TBD (tune after playtesting)

---

### Death Rules
On death (or mid-run exit):
- LOST: All carried trophies
- KEPT: Level, all stats, all equipment, all Gold, all progression

---

### Enemies (Initial Faction: Undead)
| Type | Behavior |
|------|----------|
| Melee Fighter | Moves toward player, uses AoE attacks |
| Ranged Fighter | Maintains distance, attacks frequently |

**Boss (MVP):** Enhanced normal enemy, 1.5× stats, AoE + Ranged attacks

---

### Reward Summary
| Source | Reward |
|--------|--------|
| Normal enemy kill | Trophy |
| Normal enemy kill | Chance: equipment drop |
| Chest room | Gold |
| Boss kill | Level Up + stat reward choice + Boss Trophy |
| Smuggler (success) | Trophies × 1.5 |
| Smuggler (steal) | Lose 50% trophies (20% chance) |
| Trap room | Damage to player |

---

### Anti-Exploit Rules
1. Energy spent on run start (server-side) — rooms fixed after energy deducted
2. Cannot exit active combat — prevents trophy-free Endurance farming
3. All trophies lost on exit OR death
4. Energy regeneration calculated server-side only
5. Smuggler steal chance (20%) calculated server-side

---

## Important Notes
- NEVER commit .env file
- Bot token: VITE_BOT_TOKEN in .env
- Energy regen MUST be server-side (never trust client time)
- Combat results validated server-side before saving
- Test on real phone via t.me/RightPlaceGame_bot/game