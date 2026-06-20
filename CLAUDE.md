# Right Place — Telegram Roguelike Game

## Project Info
- **Bot:** @RightPlaceGame_bot
- **Mini App:** t.me/RightPlaceGame_bot/game
- **GitHub:** https://github.com/Ruchapov/right-place-game (public)
- **Frontend URL (GitHub Pages):** https://ruchapov.github.io/right-place-game/
- **Server URL (Render, Frankfurt, Free):** https://right-place-game.onrender.com
- **Developer:** Andrey Rychapov (solo, GitHub username: Ruchapov)
- **Working directory:** D:\dev\telegram-game

## How to mentor Andrey (IMPORTANT — read this)
- Andrey is a beginner solo developer. Work as a step-by-step mentor.
- ONE action at a time. Explain WHAT we do and WHY, then HOW to verify.
- Do NOT jump ahead. Wait for confirmation before the next step.
- Write commands for **cmd** (not PowerShell — ExecutionPolicy blocks npm).
- Use simple language. Russian is fine for explanations.
- When something breaks, ask to see the actual error (screenshot/paste) before guessing.
- **File creation rule:** to make a NEW file, give `type nul > path` (cmd), then provide
  the code in a separate block to paste in VS Code. Do NOT embed code inside console
  commands. WARNING: `type nul >` empties an existing file — only use it for new files.

---

## Tech Stack
- Frontend: React 19 + TypeScript + Vite 8 (deployed to GitHub Pages)
- Game Engine: PixiJS (planned, not added yet)
- Telegram SDK: @telegram-apps/sdk + @telegram-apps/sdk-react (v3)
- Backend: Node.js v24 + Fastify 5 + TypeScript (ESM)
- Database: PostgreSQL (Neon, Frankfurt region) + Prisma ORM v5
- Auth: Telegram initData verification + JWT
- Hosting: frontend on GitHub Pages, server on Render (Frankfurt, Free tier)
- Package manager: npm

## Key Commands
- Frontend dev: `npm run dev -- --host` (in ROOT, port 5173)
- Server dev: `cd server && npm run dev` (port 3000)
- Server prod build+run (local test): `cd server && npm run build && npm start`
  (build = `prisma generate && tsc`; start = `node dist/index.js`)
- Deploy frontend: `npm run deploy` (in ROOT; gh-pages, live in 1-2 min)
- Deploy server: `git push` → Render auto-deploys (if Auto-Deploy is on), else Manual Deploy
- Check server alive (local): http://localhost:3000/health
- Check server alive (cloud): https://right-place-game.onrender.com/health

## Environment / Gotchas (these caused real bugs)
- server/.env contains: DATABASE_URL (Neon), JWT_SECRET, BOT_TOKEN — NEVER commit (gitignored)
- BOT_TOKEN is NOT in .env by default — pull it from BotFather (/mybots → bot → API Token)
- On Render, env vars live in the dashboard (Environment), NOT in .env:
  set DATABASE_URL, JWT_SECRET, BOT_TOKEN. Do NOT set PORT — Render provides it.
- Server listens on `Number(process.env.PORT) || 3000`, host `0.0.0.0` (required by Render).
- server/tsconfig.json: "module": "ES2022", "moduleResolution": "Bundler", outDir "./dist".
- Server imports MUST include the .js extension: `from '../auth.js'` NOT `from '../auth'`
  (ESM requires it at runtime: `node dist/index.js` won't resolve extensionless imports.
   ts-node in dev tolerated it, the production build does not.)
- Files for the SERVER go in server/src/ — NOT the root src/ (root src is frontend!)
- RUN SERVER COMMANDS FROM server/ : prompt must read `...\telegram-game\server>`.
  Running `npm run build` / `npm start` from ROOT runs the FRONTEND build / errors
  ("Missing script: start"). Root = frontend, server/ = backend.
- **After `npm run deploy`: hard-reload the Mini App** — open `•••` (top-right) → "Reload Page",
  or clear Telegram cache (Settings → Data and Storage → Storage Usage → Clear Cache).
  Telegram caches aggressively; close/reopen alone keeps the OLD bundle and looks like
  "my fix didn't work."
- Render auto-deploy: with Root Directory = server, only changes inside server/ trigger it,
  and it sometimes doesn't fire. If the cloud runs an old commit → Manual Deploy → Deploy
  latest commit. Check Settings → Build & Deploy → Auto-Deploy = On Commit.
- Open the app as a real Mini App (t.me/RightPlaceGame_bot/game), NOT a browser link.
  `retrieveRawInitData()` only works inside Telegram; in a browser it throws "Unable to
  retrieve launch parameters".
- Windows: use cmd, not PowerShell (or set PowerShell ExecutionPolicy RemoteSigned).
- VPN blocks localhost access — disable VPN during local dev.
- Vite config has `allowedHosts: true` and `host: true` for tunnel/Telegram testing.
- Claude Code plugins installed: frontend-design, typescript-lsp.

## Security TODO (tech debt — do before real users)
- JWT_SECRET is a weak placeholder ("...change-in-production"): generate a strong random secret.
- DATABASE_URL password + JWT_SECRET were shown on screen during setup → rotate them
  (regenerate Neon DB password, set new JWT_SECRET) when convenient.

---

## ARCHITECTURE (current code)

### Server (server/src/)
- `index.ts` — Fastify app: CORS (allows localhost:5173 + ruchapov.github.io),
  registers `authRoutes` + `runRoutes`, `/health`, listens on process.env.PORT / 0.0.0.0.
- `auth.ts` — `verifyTelegramInitData(initData, botToken)`, `parseTelegramUser(initData)`
  (Web Crypto API).
- `routes/auth.ts` — `POST /auth/login`: verify initData → find/create User+Character →
  JWT `{ userId, telegramId }` (7d). Returns `{ token, user, character }`.
- `routes/run.ts` — `POST /run/start` (PROTECTED): reads `Authorization: Bearer <jwt>`,
  verifies → userId; loads character; computes current energy; if < 10 → 400;
  else spend 10, generate 3 rooms, save (energy + lastEnergyUpdate=now); returns
  `{ energy, rooms }`.
- `game.ts` — pure game logic (no DB/HTTP):
  - `getCurrentEnergy(storedEnergy, lastUpdate)` → regen 1/min, capped at 100.
  - `generateRooms(count=3)` → weighted RoomType[] (enemy 60, chest 15, trap 10,
    puzzle 10, smuggler 3, boss 2).
  - `RoomType = 'enemy'|'boss'|'chest'|'trap'|'smuggler'|'puzzle'`.

### Auth pattern (IMPORTANT)
- JWT carries ONLY `{ userId, telegramId }`. **Do NOT read game data (level/gold/energy)
  from the JWT** — it's not there and would be stale. Read it from the API response
  (`data.character` on login) or a future `/me` endpoint.
- Protected endpoints: read `Authorization: Bearer <jwt>` header, `jwt.verify`, get userId.

### Frontend (src/)
- `api.ts` — `SERVER_URL`; `loginWithTelegram(initDataRaw)` → `LoginResponse {token, user, character}`;
  `startRun(token)` → `RunResult {energy, rooms}`.
  NOTE: `startRun` sends NO body and NO `Content-Type` header (Fastify rejects empty
  JSON body with FST_ERR_CTP_EMPTY_REQUEST). `loginWithTelegram` DOES send JSON (has a body).
- `App.tsx` — on open: `retrieveRawInitData()` → `loginWithTelegram` → store JWT in
  localStorage('jwt') → show player from `data.character`. "Start Run" button →
  `startRun(token)` → show 3 rooms + update energy. Button disabled while running or energy < 10.

### Render deploy config
- Service: right-place-game | Region: Frankfurt (EU Central) | Instance: Free
- Root Directory: `server`
- Build Command: `npm install && npm run build`
- Start Command: `npm start`

### Prisma — Character model (server/prisma/schema.prisma)
`id, userId, level(1), energy(100), lastEnergyUpdate(now), endurance(10), strength(0),`
`agility(0), luck(0), totalDamageReceived(0), totalDamageDealt(0), totalSkillUses(0),`
`gold(0), crystals(0), potionCharges(3), createdAt, updatedAt`.
Energy is stored + regenerated from `lastEnergyUpdate` (never trust a raw `energy` value
without running it through `getCurrentEnergy`).

---

## DEVELOPMENT PROGRESS

### ✅ Completed (sessions 1-4)
- Dev environment: Node v24, Git, VS Code, Claude Code (Pro), ngrok
- Frontend scaffolded (React+TS+Vite), Telegram SDK initialized
- Deployed frontend to GitHub Pages (permanent URL, no ngrok needed)
- Telegram bot + Mini App created via BotFather, works on real phone
- GitHub repo set up, CLAUDE.md created
- Backend: Fastify server (server/src/index.ts), /health endpoint, CORS
- Database: Neon PostgreSQL + Prisma, tables User & Character created & migrated
- Auth: Telegram initData verification, JWT, POST /auth/login

### ✅ Completed (session 5)
- Prepared server for ESM cloud build: `.js` import extensions, `process.env.PORT`,
  `prisma generate && tsc` in build script.
- Deployed server to Render (Frankfurt, Free). Cloud /health works.
- Connected frontend to server: Mini App sends initData → /auth/login → JWT (localStorage)
  → shows real player data from `data.character`. Verified on phone.
- Fixed bug: player data was read from JWT (placeholders) → now read from login response.
- Run system: `game.ts` (getCurrentEnergy, generateRooms) + `POST /run/start` endpoint
  (energy regen + spend 10 + generate 3 rooms, saved to DB).
- Frontend: "Start Run" button → calls /run/start → shows rooms + updated energy.
  Verified the full loop on phone (energy persists in DB).

### 🔜 Next steps (in order)
1. **Room completion** — what happens when you enter each room:
   chest → gold, trap → damage, enemy → combat, smuggler/puzzle/boss logic.
   Persist the run server-side (rooms fixed after deduction) when doing this.
2. **Combat on PixiJS** — movement, attack, dodge (the big one).
3. **Trophies & rewards** — trophy on enemy kill, lost on death/exit, smuggler exchange.
4. **Stat progression / leveling** — endpoints for Endurance/Strength/Agility growth + level-ups.
5. Equipment, skills, potions shop, etc.

---

## GAME DESIGN DOCUMENT

### Overview
- Genre: Roguelike with Souls-like combat
- Platform: Telegram Mini App (mobile first)
- Camera: 2D Side View
- Initial Mode: PvE only. Future: PvP.
- MVP Goal: Player reaches Level 20

### Core Game Loop
Start Run → select equipment → spend 10 Energy → get 3 random rooms →
complete rooms → get rewards → return to menu → upgrade → repeat.

### Energy System
- Max 100. Regen 1/min (SERVER TIME — not client clock). Run costs 10.

### Room System (each run = 3 random rooms)
Probabilities: Normal Enemy 60%, Chest 15%, Trap 10%, Puzzle 10%, Smuggler 3%, Boss 2%.
- Trap: damage on entry, unavoidable, no combat, proceed.
- Puzzle: TBD.
- Smuggler: exchange all trophies ×1.5, OR 20% chance steals 50% of trophies (player doesn't know in advance).
- Boss: 1.5× normal enemy stats, AoE + Ranged. Kill = instant Level Up + permanent stat reward choice.
- Exit mid-run = ALL trophies lost. Cannot exit during active combat.

### Combat
Actions: Move, Attack (single hit), Dodge, Skills (2 active), Potions.
No block/parry/combos. Philosophy: Attack → Dodge → Reposition → Attack.
Dodge = skill-based timing, NOT RNG.

### Skills (equip 2 of 5; all 5s cooldown, no mana; upgradable w/ diminishing returns)
- Dash Strike: dash; damage if passes through enemy
- Fireball: ranged projectile
- Slash: damage + bleeding (DoT)
- Heal: restores 10% HP (no damage skill, so equal value)
- Ice Ball: damage + slow
Each skill has its own Agility scaling.

### Potions
3 charges, 2s cooldown, heal 50% of max HP. Usable in combat & between rooms.
Buy with gold at shop. Carry over to next run.

### Character Stats
- Endurance base 10; 1 Endurance = 8 HP (so 80 HP start). Grows from damage RECEIVED.
- Strength: grows from damage DEALT. 2 Strength = 1 Damage.
- Agility: grows from skill uses. Per-skill scaling.
- Crit Damage 1.5× start. Movement speed: equipment only, max 1.5×.
- Luck: affects gold/loot, NOT dodge.

### Growth Formulas (slow progression, no 1-day content burn)
- Endurance: +1 per 50 cumulative damage received; after End 30 → 100/point.
- Strength: +1 per 100 damage dealt; after Str 20 → 200/point.
- Agility: +1 per 20 skill uses; after Agi 20 → 40 uses/point.
(These are starting values — tune after Andrey playtests.)

### Leveling
- Method 1 (stats): Endurance +3 AND (Strength+Agility) +6 since last level.
- Method 2 (boss): instant level up, no auto stat gain, choose permanent stat reward.
- Enemy scaling: each player level → enemy HP +10%, enemy Damage +8%.
  (Players who level only via bosses without stat growth will struggle.)

### Equipment Slots
Weapon (dmg + crit + atkspeed + armorpen), Helmet (def+stats), Armor (def),
Boots (move speed), Gloves (+% Strength OR Agility gain, scales by tier),
Amulet (+Luck, scales by tier). New tier every 5 levels up to 50. Items drop at player level or below. No rarity at launch.

### Currencies
- Gold: upgrades/shop/potions. From chests, events, selling, trophy exchange. NOT lost on death.
- Trophies: main loot, from enemy kills. Exchange for gold. LOST on death OR exit.
- Crystals: premium, from daily quests / real money. Not needed for MVP.

### Death
Lost: all carried trophies. Kept: level, stats, equipment, gold, progression.

### Enemies (faction: Undead)
- Melee Fighter: moves to player, AoE attacks.
- Ranged Fighter: keeps distance, attacks often.
- Boss (MVP): enhanced normal enemy, 1.5× stats, AoE + Ranged.

### Anti-Exploit Rules
1. Energy spent on run start (server-side); rooms fixed after deduction.
2. Cannot exit active combat (prevents trophy-free Endurance farming).
3. All trophies lost on exit OR death.
4. Energy regen server-side only.
5. Smuggler steal chance (20%) server-side.