# Right Place — Telegram Roguelike Game

## Project Info
- **Bot:** @RightPlaceGame_bot
- **Mini App:** t.me/RightPlaceGame_bot/game
- **GitHub:** https://github.com/Ruchapov/right-place-game (public)
- **Production URL (frontend):** https://ruchapov.github.io/right-place-game/
- **Developer:** Andrey Rychapov (solo, GitHub username: Ruchapov)
- **Working directory:** D:\dev\telegram-game

## How to mentor Andrey (IMPORTANT — read this)
- Andrey is a beginner solo developer. Work as a step-by-step mentor.
- ONE action at a time. Explain WHAT we do and WHY, then HOW to verify.
- Do NOT jump ahead. Wait for confirmation before the next step.
- Write commands for **cmd** (not PowerShell — ExecutionPolicy issues).
- Use simple language. Russian is fine for explanations.
- When something breaks, ask to see the actual error (screenshot/paste) before guessing.

---

## Tech Stack
- Frontend: React 18 + TypeScript + Vite (deployed to GitHub Pages)
- Game Engine: PixiJS (planned, not added yet)
- Telegram SDK: @telegram-apps/sdk-react
- Backend: Node.js + Fastify + TypeScript
- Database: PostgreSQL (Neon, Frankfurt region) + Prisma ORM v5
- Auth: Telegram initData verification + JWT
- Package manager: npm

## Key Commands
- Frontend dev: `npm run dev -- --host` (in root, port 5173)
- Server dev: `cd server && npm run dev` (port 3000)
- Deploy frontend: `npm run deploy` (live in 1-2 min on GitHub Pages)
- Check server alive: open http://localhost:3000/health

## Environment / Gotchas (these caused real bugs)
- server/.env contains: DATABASE_URL (Neon), JWT_SECRET, BOT_TOKEN — NEVER commit
- BOT_TOKEN value lives only in server/.env (gitignored)
- server/tsconfig.json: "module": "ES2022", "moduleResolution": "Bundler"
- - Server imports MUST include the .js extension: `from '../auth.js'` NOT `from '../auth'`
  (ESM requires it at runtime: `node dist/index.js` won't resolve extensionless imports.
   ts-node in dev tolerated it, the production build does not. Changed during cloud-deploy prep.)
- Files for the SERVER go in server/src/ — NOT the root src/ (root src is frontend!)
  - This mistake caused "Cannot find module" errors for a whole session.
- Windows: use cmd, not PowerShell (or set PowerShell ExecutionPolicy RemoteSigned)
- VPN blocks localhost access — disable VPN during local dev
- Vite config has `allowedHosts: true` and `host: true` for tunnel/Telegram testing
- Claude Code plugins installed: frontend-design, typescript-lsp

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
- Auth: Telegram initData verification (server/src/auth.ts, Web Crypto API),
  JWT tokens, POST /auth/login endpoint (server/src/routes/auth.ts)
  - /auth/login: verifies initData → finds/creates User+Character → returns JWT

### 🔜 Next steps (in order)
1. **Deploy server to cloud** (Railway or Render) — phone can't reach localhost:3000.
   Need a permanent server URL so the Mini App on phone can call the API.
2. Connect frontend to server: on Mini App open, send initData to /auth/login,
   store JWT, fetch player data.
3. Player profile screen: show real level / energy / gold / stats from DB
   (replace current "✓ SDK initialized" placeholder).
4. Test full chain on phone — data persists after closing & reopening.
5. Run system endpoint: spend 10 energy, generate 3 random rooms.
6. Combat on PixiJS (movement, attack, dodge).

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
