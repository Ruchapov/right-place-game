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
- Andrey now also uses Claude Code (terminal, in VS Code) to apply file edits directly —
  design decisions still happen in chat with the mentor; Claude Code is just given a
  precise task description and applies it without manual copy-pasting. Both draw from
  the same Pro/Max subscription usage limit (5-hour window), so keep tasks scoped small.

---

## Tech Stack
- Frontend: React 19 + TypeScript + Vite 8 (deployed to GitHub Pages)
- Game Engine: PixiJS v8 (installed session 6 — see Combat section below)
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
- **Server dev runner is `tsx` (NOT `ts-node`)** — `ts-node --esm` had a Windows-specific
  bug: `ERR_MODULE_NOT_FOUND` on files that existed, at correct paths, with valid content
  (confirmed via `dir` + file content review — not a real missing-file issue). Switching
  `server/package.json`'s `dev` script to `nodemon --watch src --ext ts --exec tsx src/index.ts`
  fixed it; `tsx` resolves ESM reliably on Windows. `npm run build` still uses plain `tsc`
  (prod build on Render is unaffected, only local `dev` was broken).
- Files for the SERVER go in server/src/ — NOT the root src/ (root src is frontend!)
  NOTE: there are two `auth.ts` files — `server/src/auth.ts` (Telegram verification logic)
  and `server/src/routes/auth.ts` (the `/auth/login` route) — easy to open the wrong one.
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
- **Prisma `migrate dev` can prompt "Do you want to continue? All data will be lost"
  (database reset) when schema and DB migration history diverge.** NEVER auto-confirm
  this — stop and check with the mentor first. This already wiped test character data
  once (gold/level/trophies reset to defaults) when the prompt was accepted without
  realizing what it meant. Acceptable for dev/test data; would NOT be acceptable once
  real users exist. Before any future migration that could touch existing data, consider
  a manual backup via Neon Console SQL Editor (`SELECT * FROM "Character"`) or check
  Neon's point-in-time restore options first.

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
- `routes/run.ts` — RUN_COST = 3 (DEV value, restore to 10 before release).
  - `POST /run/start` (PROTECTED): spend energy, generate 3 rooms, maxHp = endurance*8,
    save `currentRun: { rooms, index: 0, hp: maxHp }` on Character. Returns
    `{ energy, rooms, index, hp, maxHp }`.
  - `POST /run/room` (PROTECTED): processes `currentRun.rooms[index]`, advances index.
    Implemented: `chest` (+10..50 gold, random), `trap` (-20% maxHp damage, adds to
    totalDamageReceived). `boss`/`smuggler`/`puzzle` not implemented yet (room is
    "entered" but does nothing — message says "not implemented yet"). `enemy` rooms
    are intercepted on the FRONTEND before this endpoint is called (see App.tsx below) —
    server-side this endpoint would still say "not implemented" for enemy if hit directly.
    If hp <= 0 → died: true, currentRun cleared (Prisma.DbNull). Returns
    `{ roomType, goldGained, damageTaken, hp, maxHp, died, message, gold, index, done }`.
  - `POST /run/battle-result` (PROTECTED): client reports the outcome of a battle fought
    in the PixiJS Battle component. Body: `{ won: boolean; damageTaken: number }`.
    Validates current room is actually 'enemy'. Sanity-check: `damageTaken` is clamped
    to character maxHp server-side (NOT full replay validation — see Combat Authority
    note in Anti-Exploit Rules). Grants 1 trophy on win (DEV value, balance later).
    Trophies zeroed on death (per design — trophies lost on death). Advances
    `currentRun` same as `/run/room`. Returns `{ roomType, trophyGained, damageTaken,
    hp, maxHp, died, message, trophies, index, done }`.
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
- `api.ts` — `SERVER_URL`; functions: `loginWithTelegram(initDataRaw)` → `LoginResponse
  {token, user, character}`; `startRun(token)` → `RunResult {energy, rooms, hp, maxHp}`;
  `enterRoom(token)` → `RoomResult {roomType, goldGained, damageTaken, hp, maxHp, died,
  message, gold, index, done}`; `submitBattleResult(token, won, damageTaken)` →
  `BattleResult {roomType, trophyGained, damageTaken, hp, maxHp, died, message, trophies,
  index, done}`.
  NOTE: `startRun` sends NO body and NO `Content-Type` header (Fastify rejects empty
  JSON body with FST_ERR_CTP_EMPTY_REQUEST). `loginWithTelegram`/`submitBattleResult`
  DO send JSON (have a body).
- `App.tsx` — on open: `retrieveRawInitData()` → `loginWithTelegram` → store JWT in
  localStorage('jwt') → show player from `data.character`. "Start Run" button →
  `startRun(token)` → show 3 rooms + update energy + HP. Button disabled while running
  or energy < RUN_COST.
  - State `runHp`/`runMaxHp` tracks current-run HP, updated from every endpoint response
    (start/room/battle-result) and passed into `<Battle>` as props — this is what makes
    damage persist correctly across the whole run instead of resetting per fight.
  - `handleEnterRoom`: for any room type EXCEPT 'enemy', calls `enterRoom()` as before.
    For 'enemy', instead sets `inBattle = true` (does NOT call enterRoom/enter the old way).
  - `handleBattleEnd(result)`: called by `<Battle onBattleEnd={...}>` after a fight ends;
    calls `submitBattleResult`, updates results/roomIndex/runHp, closes the battle overlay.
  - `<Battle initialHp={runHp} maxHp={runMaxHp} onBattleEnd={handleBattleEnd} />` rendered
    conditionally when `inBattle` is true — fullscreen overlay on top of everything else.
- `Battle.tsx` — PixiJS v8 fullscreen combat scene (`position: fixed`, 100vw/100vh,
  `resizeTo: window`). Props: `{ initialHp: number; maxHp: number; onBattleEnd: (result:
  { won: boolean; damageTaken: number }) => void }`.
  - Player (green square) and enemy (red square, HP 100 hardcoded for normal enemies).
  - Movement: ◀/▶ buttons, hold to move continuously via `app.ticker` (NOT setInterval),
    3px/frame, clamped to canvas width.
  - Attack: "⚔ Атака" button, requires distance < 70px to enemy, deals 15 damage,
    0.5s cooldown (via ticker-based timer, not setState).
  - Enemy AI: chases player at 1px/frame (slower than player's 3px/frame, so player CAN
    outrun it). When within 70px, attacks every 2s: 0.6s "windup" (enemy scales to 1.3x)
    then deals 10 damage if not dodged.
  - Dodge: "🔄 Додж" button. Pressing it DURING the enemy's windup phase negates the
    upcoming damage and resets the attack-interval timer. Pressing outside windup does
    nothing. No cooldown on dodge itself. NO visual feedback on the player square on
    successful dodge — this is intentional for now; a real uklonenie animation is
    deferred until character art/sprites exist (see Next steps).
  - End of battle: on enemyHp<=0 or playerHp<=0, shows "Победа!"/"Поражение" text for
    1.5s, then calls `onBattleEnd({ won, damageTaken })` where damageTaken = maxHp -
    playerHp (full maxHp if player died). No manual close button — battle only ends
    via win/loss.
  - All battle state (playerHp, enemyHp, timers) lives in plain JS variables/refs inside
    the PixiJS `useEffect`, NOT React state — this is a ticker-driven scene, not a
    React-rendered UI; mixing the two would cause stale-closure bugs.

### Render deploy config
- Service: right-place-game | Region: Frankfurt (EU Central) | Instance: Free
- Root Directory: `server`
- Build Command: `npm install && npm run build`
- Start Command: `npm start`

### Prisma — Character model (server/prisma/schema.prisma)
`id, userId, level(1), energy(100), lastEnergyUpdate(now), endurance(10), strength(0),`
`agility(0), luck(0), totalDamageReceived(0), totalDamageDealt(0), totalSkillUses(0),`
`gold(0), trophies(0), crystals(0), potionCharges(3), currentRun(Json?), createdAt, updatedAt`.
- `trophies` field added session 6 (migration `add_trophies`) — separate from gold,
  per design (lost on death, gold is not).
- `currentRun` shape: `{ rooms: string[]; index: number; hp: number } | null`.
- Energy is stored + regenerated from `lastEnergyUpdate` (never trust a raw `energy`
  value without running it through `getCurrentEnergy`).
- **Known gap:** `totalDamageDealt` is NOT yet updated anywhere on the server — battle
  results currently only update `totalDamageReceived`. Needed for Strength growth
  (see Next steps — stat progression is the current work-in-progress feature).

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

### ✅ Completed (session 6)
- Room completion: chest (gold), trap (damage to currentRun.hp, unavoidable per design).
- **Combat on PixiJS** (`src/Battle.tsx`) — full client-side battle system: movement,
  melee attack with range/cooldown, enemy AI (chase + windup-telegraphed attack),
  timing-based dodge (no RNG, per design's core philosophy). Fullscreen overlay.
  Built incrementally via Claude Code, each piece tested on phone before the next:
  empty scene → movement → attack → enemy AI → dodge → server integration.
- Server: `POST /run/battle-result` — client reports battle outcome, server sanity-checks
  damage (clamped to maxHp) and advances the run. Added `trophies` field to Character
  (Prisma migration `add_trophies`).
- **Fixed bug:** Battle.tsx used to hardcode playerHp=80 every fight, ignoring damage
  carried over from earlier rooms in the same run. Now takes `initialHp`/`maxHp` as
  props; App.tsx tracks `runHp`/`runMaxHp` state threaded through start→room→battle→
  battle-result, so damage persists correctly across the whole run (as designed —
  this is the core risk/reward loop, was previously broken).
  - Verified on phone: take damage in a Trap room, then enter an Enemy room — battle
    now correctly starts with the reduced HP instead of resetting to max.
- Dev tooling: switched local server dev runner from `ts-node --esm` to `tsx` (unrelated
  bug investigated and fixed mid-session — see Environment/Gotchas).
- Incident: a Prisma migration (`add_trophies`) triggered a database reset prompt that
  was accidentally confirmed, wiping test character progress (gold/level back to
  defaults). No real user data was affected (pre-launch, test data only). Added a
  standing rule in Environment/Gotchas to never auto-confirm this in the future.
- Decided combat authority model for MVP (was an open question in the design doc):
  **client plays the full battle, server does a lightweight sanity check** (damage
  clamped to maxHp) rather than full server-side replay validation. Documented as
  a known limitation, not full anti-cheat — acceptable for PvE-only MVP, must be
  revisited before PvP is built.
- Worked out concrete starting numbers for Endurance/Strength growth formulas (see
  Growth Formulas section below) — was previously a TODO in the design doc
  ("exact progression curve should prevent players from progressing too quickly").
  NOT YET IMPLEMENTED IN CODE — this is the next task.

### 🔜 Next steps (in order)
1. **Stat progression: Endurance + Strength (IN PROGRESS, current focus)**
   - Update `/run/battle-result` (and/or `/run/room` for trap damage) to also
     increment `totalDamageDealt` on the Character — currently NOT tracked anywhere
     server-side, only `totalDamageReceived` is updated. Needed before Strength growth
     can work at all.
   - Implement the Growth Formulas (see below) to convert accumulated
     totalDamageDealt/totalDamageReceived into actual Strength/Endurance stat values.
   - Implement Leveling Method 1 (stat progression) — see Leveling section. NOTE:
     since Agility doesn't exist yet, temporarily use "Strength +6" as the leveling
     threshold instead of "Strength+Agility +6" combined (revisit once Agility/skills
     exist).
   - When Endurance increases, character's effective maxHp (endurance*8) must increase
     too — make sure this doesn't silently desync from what `currentRun.hp` was
     calculated against mid-run.
   - Agility is explicitly DEFERRED until skills exist (see item 5) — no temporary
     proxy metric for it, by design choice (avoid building a throwaway system).
2. **Boss / Smuggler / Puzzle rooms** — still stubs ("not implemented yet" message).
   - Boss: bigger enemy stats (1.5x normal), instant level-up + permanent stat choice
     on kill (no auto stat gain, per design's Method 2 leveling).
   - Smuggler: trophy exchange UI (×1.5 multiplier, 20% chance of losing 50% of
     carried trophies instead — design says player doesn't know in advance which
     outcome they'll get). Steal-chance logic not yet coded anywhere.
   - Puzzle: mechanic still UNDEFINED in the design doc — needs a spec from Andrey
     before any code can be written here.
3. **Battle visuals** — currently flat colored rectangles (green/red squares), no
   sprites or animations. Dodge currently has NO visual feedback on the player square
   BY DESIGN CHOICE — a real dodge/uklonenie animation is deferred until character art
   exists, to avoid building throwaway animation code twice.
4. **Trophies on frontend** — server tracks `character.trophies` and returns it from
   `/run/battle-result`, but `App.tsx` doesn't display or update `player.trophies`
   anywhere yet (only gold is shown in the player info card).
5. **Skills system** — none of the 5 designed skills (Dash Strike, Fireball, Slash,
   Heal, Ice Ball) exist in code yet. Needed before Agility growth can be implemented
   (Agility grows from skill USES — see Growth Formulas).
6. Equipment, potions shop, etc.

---

## GAME DESIGN DOCUMENT

### Overview
- Genre: Roguelike with Souls-like combat
- Platform: Telegram Mini App (mobile first)
- Camera: 2D Side View
- Initial Mode: PvE only. Future: PvP.
- MVP Goal: Player reaches Level 20

### Core Game Loop
Start Run → select equipment → spend Energy (RUN_COST, dev value 3, release value 10) →
get 3 random rooms → complete rooms → get rewards → return to menu → upgrade → repeat.

### Energy System
- Max 100. Regen 1/min (SERVER TIME — not client clock). Run costs RUN_COST
  (currently 3 for dev/testing — MUST restore to 10 before release).

### Room System (each run = 3 random rooms)
Probabilities: Normal Enemy 60%, Chest 15%, Trap 10%, Puzzle 10%, Smuggler 3%, Boss 2%.
- Enemy: full PixiJS combat (see Combat section / ARCHITECTURE above) — IMPLEMENTED.
- Chest: random gold (10-50) — IMPLEMENTED.
- Trap: damage on entry (20% of maxHp, dev value), unavoidable, no combat, proceed —
  IMPLEMENTED.
- Puzzle: mechanic TBD, not implemented.
- Boss: not implemented. 1.5× normal enemy stats, AoE + Ranged. Kill = instant Level Up
  + permanent stat reward choice.
- Smuggler: not implemented. Exchange all trophies ×1.5, OR 20% chance steals 50% of
  trophies (player doesn't know in advance).
- Exit mid-run = ALL trophies lost. Cannot exit during active combat.

### Combat (IMPLEMENTED for normal Enemy rooms — see ARCHITECTURE/Battle.tsx above)
Actions: Move, Attack (single hit), Dodge, Skills (2 active — NOT YET BUILT), Potions
(NOT YET BUILT).
No block/parry/combos. Philosophy: Attack → Dodge → Reposition → Attack.
Dodge = skill-based timing, NOT RNG. ✅ Implemented exactly this way — timing window
during enemy windup, no random roll involved.
Combat authority model (resolved session 6): client computes the full battle, server
does a sanity-check clamp on reported damage. NOT full anti-cheat — see Anti-Exploit
Rules below. Acceptable for PvE MVP, revisit before PvP.

### Skills (NOT YET IMPLEMENTED — equip 2 of 5; all 5s cooldown, no mana; upgradable
w/ diminishing returns)
- Dash Strike: dash; damage if passes through enemy
- Fireball: ranged projectile
- Slash: damage + bleeding (DoT)
- Heal: restores 10% HP (no damage skill, so equal value)
- Ice Ball: damage + slow
Each skill has its own Agility scaling.

### Potions (NOT YET IMPLEMENTED)
3 charges, 2s cooldown, heal 50% of max HP. Usable in combat & between rooms.
Buy with gold at shop. Carry over to next run.

### Character Stats
- Endurance base 10; 1 Endurance = 8 HP (so 80 HP start). Grows from damage RECEIVED.
- Strength: grows from damage DEALT. 2 Strength = 1 Damage.
- Agility: grows from skill uses. Per-skill scaling. (Deferred — no skills exist yet.)
- Crit Damage 1.5× start. Movement speed: equipment only, max 1.5×.
- Luck: affects gold/loot, NOT dodge.

### Growth Formulas (tuned session 6 — based on observed combat numbers: ~100 total
damage dealt to kill one normal enemy at 15 dmg/hit, ~20-40 damage taken per fight
if played reasonably well)
- **Endurance: +1 per 30 cumulative damage received; after Endurance 30 → 100/point.**
- **Strength: +1 per 100 cumulative damage dealt; after Strength 20 → 200/point.**
- Agility: NOT YET IMPLEMENTED — no skills exist yet to generate totalSkillUses.
  Deferred until skills are built (see Next steps item 5). No temporary proxy metric,
  by deliberate choice.
- These numbers target roughly 1 stat point every ~1 fight early on (fast, satisfying
  early growth), naturally slowing down past the thresholds above. First levelup via
  Method 1 (stats) lands around ~6 fights at these rates (Strength +6 is the binding
  constraint, since Endurance +3 completes faster). STILL STARTING VALUES — tune after
  Andrey playtests; these were hand-calculated from combat numbers, not yet validated
  by real play.
- NOT YET IMPLEMENTED IN CODE as of end of session 6 — this is the immediate next task.

### Leveling
- Method 1 (stats): Endurance +3 AND (Strength+Agility) +6 since last level.
  TEMPORARY (until Agility exists): use Endurance +3 AND Strength +6 alone.
- Method 2 (boss): instant level up, no auto stat gain, choose permanent stat reward.
- Enemy scaling: each player level → enemy HP +10%, enemy Damage +8%.
  (Players who level only via bosses without stat growth will struggle.)
- NOT YET IMPLEMENTED IN CODE — next task after growth formulas.

### Equipment Slots (NOT YET IMPLEMENTED)
Weapon (dmg + crit + atkspeed + armorpen), Helmet (def+stats), Armor (def),
Boots (move speed), Gloves (+% Strength OR Agility gain, scales by tier),
Amulet (+Luck, scales by tier). New tier every 5 levels up to 50. Items drop at player
level or below. No rarity at launch.

### Currencies
- Gold: upgrades/shop/potions. From chests, events, selling, trophy exchange. NOT lost
  on death. IMPLEMENTED (chest rooms only so far; shop/selling not built).
- Trophies: main loot, from enemy kills. Exchange for gold (smuggler — not implemented).
  LOST on death OR exit. IMPLEMENTED server-side (`character.trophies`, granted on
  battle win, zeroed on death) — NOT YET shown on frontend (see Next steps item 4).
- Crystals: premium, from daily quests / real money. Not needed for MVP. Field exists
  in DB, unused.

### Death
Lost: all carried trophies. Kept: level, stats, equipment, gold, progression.

### Enemies (faction: Undead)
- Melee Fighter: moves to player, AoE attacks. (Battle.tsx's current enemy AI is a
  simplified version of this — chases + single-target windup attack, no AoE yet since
  there's only one player position to hit anyway in the current 1D-movement setup.)
- Ranged Fighter: keeps distance, attacks often. NOT YET IMPLEMENTED (only melee-style
  enemy exists in Battle.tsx so far).
- Boss (MVP): enhanced normal enemy, 1.5× stats, AoE + Ranged. NOT YET IMPLEMENTED.

### Anti-Exploit Rules
1. Energy spent on run start (server-side); rooms fixed after deduction.
2. Cannot exit active combat (prevents trophy-free Endurance farming).
3. All trophies lost on exit OR death.
4. Energy regen server-side only.
5. Smuggler steal chance (20%) — designed, NOT YET implemented in code.
6. **Battle results are client-computed but server-clamped:** `damageTaken` reported
   by the client can't exceed character maxHp. This is NOT full anti-cheat — a modified
   client could still report a fake win with minimal/zero damage taken. Accepted as a
   known limitation for the PvE-only MVP per the design doc's originally-open "Combat
   Authority" question (resolved session 6 — see session 6 notes above). MUST be
   revisited with proper server-side validation (or server-authoritative combat) before
   PvP mode is built.