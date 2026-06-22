# Right Place — Telegram Roguelike

## Project Info
- **Bot:** @RightPlaceGame_bot | **Mini App:** t.me/RightPlaceGame_bot/game
- **GitHub:** https://github.com/Ruchapov/right-place-game
- **Frontend:** https://ruchapov.github.io/right-place-game/ (GitHub Pages)
- **Server:** https://right-place-game.onrender.com (Render, Frankfurt, Free)
- **Dev:** Andrey Rychapov (solo) | **Working dir:** D:\dev\telegram-game

## Mentor Rules
- Beginner solo dev. ONE step at a time. Explain WHAT/WHY, then HOW to verify.
- Commands for **cmd** (not PowerShell). Russian is fine.
- When broken: ask for actual error before guessing.
- Design decisions in chat; Claude Code applies edits in terminal (same usage pool).
- When giving code: always give FULL file replacements, not partial diffs — reduces errors.

## Tech Stack
- Frontend: React 19 + TypeScript + Vite 8 → GitHub Pages
- Game engine: PixiJS v8 (combat scenes)
- Telegram SDK: @telegram-apps/sdk v3
- Backend: Node.js v24 + Fastify 5 + TypeScript (ESM) → Render
- DB: PostgreSQL (Neon, Frankfurt) + Prisma ORM v5
- Auth: Telegram initData verification + JWT (7d)

## Key Commands
```
# Frontend
npm run dev -- --host     # dev server, ROOT, port 5173
npm run deploy            # deploy to GitHub Pages (hard-reload Mini App after!)

# Server
cd server && npm run dev  # tsx (NOT ts-node), port 3000
cd server && npm run build && npm start  # local prod test
git push                  # triggers Render auto-deploy (sometimes needs Manual Deploy)
```

## Critical Gotchas
- **Server dev runner is `tsx`** — `ts-node --esm` had Windows ERR_MODULE_NOT_FOUND bug.
  `package.json` dev: `nodemon --watch src --ext ts --exec tsx src/index.ts`
- **Server imports need .js extension**: `from '../auth.js'` not `from '../auth'` (ESM)
- **Two auth.ts files**: `server/src/auth.ts` (Telegram verify) vs `server/src/routes/auth.ts` (login route)
- **Run server from server/**: prompt must read `...\telegram-game\server>`
- **After `npm run deploy`**: `•••` → Reload Page in Telegram (aggressive caching)
- **Render auto-deploy sometimes doesn't fire** → Manual Deploy → Deploy latest commit
- **Prisma `migrate dev` reset prompt**: NEVER auto-confirm — already wiped test data once.
  Backup via Neon SQL Editor (`SELECT * FROM "Character"`) before risky migrations.
- **Open as Mini App** (t.me/RightPlaceGame_bot/game) — initData only works in Telegram
- **VPN blocks localhost** — disable during local dev
- Render env vars in dashboard: DATABASE_URL, JWT_SECRET, BOT_TOKEN. Don't set PORT.
- `type nul > path` creates new files in cmd — WARNING: empties existing files

## Security TODO (before real users)
- Rotate JWT_SECRET (weak placeholder) and Neon DB password (shown on screen during setup)

---

## Architecture

### Server (server/src/)

**`routes/run.ts`** — RUN_COST = 3 (DEV, restore to 10 before release)

| Endpoint | Body | Description |
|---|---|---|
| `POST /run/start` | — | Spend energy, generate 3 rooms, save `currentRun: {rooms, index, hp}` |
| `POST /run/room` | — | Process chest/trap (enemy/boss/smuggler/puzzle intercepted on frontend) |
| `POST /run/battle-result` | `{won, damageTaken, damageDealt}` | After fight: sanity-clamps damage, grants trophies, stat growth + leveling |
| `POST /run/smuggler-result` | `{exchange: bool}` | 80% → trophies×1.5, 20% → trophies×0.5 (stolen) |
| `POST /run/puzzle` | — | Returns `{question, options}`, saves puzzleId to currentRun |
| `POST /run/puzzle-result` | `{selectedIndex}` | Correct → +15-60 gold. Wrong → -20% maxHP |

All run endpoints return `{hp, maxHp, died, level, strength, endurance, index, done, ...}`

**`game.ts`** — `getCurrentEnergy`, `generateRooms`, `calculateStrength`, `calculateEnduranceBonus`

**`puzzles.ts`** — 6 game-mechanics quiz questions (correct answers server-side only)

**Prisma Character fields:**
`level(1), energy(100), endurance(10), strength(0), agility(0), luck(0), gold(0), trophies(0), crystals(0), potionCharges(3), totalDamageReceived(0), totalDamageDealt(0), totalSkillUses(0), strengthAtLevelUp(0), enduranceAtLevelUp(10), currentRun(Json?)`

**`currentRun` shape:** `{ rooms: string[], index: number, hp: number, puzzleId?: string } | null`

### Frontend (src/)

**`Battle.tsx`** — PixiJS v8 fullscreen combat. Props: `{initialHp, maxHp, isBoss?, onBattleEnd}`
- Player: ◀/▶ (3px/frame), ⚔ Attack (15dmg, <70px, 0.5s cd), 🔄 Dodge (timing during windup)
- Normal enemy: chases (1px/frame), windup attack every 2s (scale 1.3×), dodgeable
- Boss: 150HP, 15dmg, 1.5s interval, random attack type:
  - MELEE: same as normal, requires <70px
  - AOE: red screen overlay windup, hits anywhere, dodgeable with button
  - RANGED: orange projectile (4px/frame), dodge by MOVING away (not button)
- All battle state in JS refs (not React state) — ticker-driven
- Calls `onBattleEnd({ won, damageTaken, damageDealt })`

**`Smuggler.tsx`** — Fullscreen dialog. Props: `{trophies, onChoice(exchange: bool)}`

**`Puzzle.tsx`** — Fullscreen quiz. Props: `{question, options, onAnswer(selectedIndex)}`
No correct/wrong feedback in component — handled via server message in results list.

**`App.tsx`** — Main state. PlayerData: `{id, firstName, level, gold, trophies, strength, endurance}`
- Room routing: enemy/boss → `inBattle=true` (Battle), smuggler → `inSmuggler=true`,
  puzzle → `getPuzzle()` → `puzzleData` set (Puzzle), chest/trap → `enterRoom()`
- `runHp`/`runMaxHp` tracked across all room results (HP persists full run)

**`api.ts`** — Types: `LoginResponse`, `RunResult`, `RoomResult`, `BattleResult`,
`SmugglerResult`, `PuzzleQuestion`, `PuzzleResult`. Functions for all endpoints.

---

## Stat & Leveling System

### Growth (IMPLEMENTED)
- **Endurance**: +1 per 30 dmg received (until End=30), then +1 per 100
- **Strength**: +1 per 100 dmg dealt (until Str=20), then +1 per 200
- **Agility**: DEFERRED until skills exist

### Leveling (OR logic — IMPLEMENTED)
- **Method 1**: +3 Endurance OR +6 Strength since last level-up (tracked independently
  via `enduranceAtLevelUp`/`strengthAtLevelUp`, each advances by its own threshold only)
- **Method 2**: boss kill → instant +1 level
- If Endurance rises mid-run → `currentRun.hp` also increases by the maxHp difference

---

## Room System

| Room | Chance | Status | Reward / Penalty |
|---|---|---|---|
| Enemy | 60% | ✅ | Trophies 10-15, stat growth |
| Chest | 15% | ✅ | Gold 10-50 |
| Trap | 10% | ✅ | −20% maxHP |
| Puzzle | 10% | ✅ | +15-60 gold OR −20% maxHP |
| Smuggler | 3% | ✅ | Trophies ×1.5 OR ×0.5 (20% steal) |
| Boss | 2% | ✅ | Trophies 15-22, instant level-up |

---

## 🔜 Next Steps

1. **Fix Puzzle 404** — `/run/puzzle` returns 404 in production (last commit may not have deployed).
   Check Render Events, Manual Deploy if needed. This is the immediate blocker.
2. **Boss reward choice** — instant level-up works, but no stat reward selection UI yet.
3. **Enemy scaling by level** — each level → enemy HP +10%, Damage +8%. Not coded.
4. **Skills** — 5 designed (Dash Strike, Fireball, Slash, Heal, Ice Ball), none built.
   Needed for Agility growth. Equip 2 of 5, 5s cooldown, no mana.
5. **Potions** — 3 charges, heal 50% maxHP, 2s cooldown, buy with gold. Not built.
6. **Equipment** — 6 slots, tier every 5 levels up to 50. Not built.
7. **RUN_COST**: restore to 10 before real users.

---

## Design Decisions (changed from original doc)

- **Leveling OR not AND**: original "Endurance +3 AND Strength+Agility +6" → changed to OR.
- **Puzzle mechanic**: original "TBD" → game-mechanics quiz (6 questions about own game).
- **Trophy drops**: original 1 per kill → 10-15 (enemy) / 15-22 (boss).
- **Boss attacks**: 3 types (melee/AoE/ranged), random per attack, 1.5s interval.