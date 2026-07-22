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
- Design decisions in chat; Claude Code applies edits in terminal.
- Never give full file replacements — give precise prompts for Claude Code (anchored edits).
- Always: plan full feature first → confirm → one step at a time → commit → deploy → test on phone → wait for confirmation.

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
git push                  # triggers Render auto-deploy (sometimes needs Manual Deploy)
```

## Critical Gotchas
- **Server dev runner is `tsx`** — `ts-node --esm` had Windows ERR_MODULE_NOT_FOUND bug.
- **Server imports need .js extension**: `from '../auth.js'` not `from '../auth'` (ESM)
- **Two auth.ts files**: `server/src/auth.ts` (Telegram verify) vs `server/src/routes/auth.ts` (login route)
- **Run server from server/**: prompt must read `...\telegram-game\server>`
- **After `npm run deploy`**: `•••` → Reload Page in Telegram (aggressive caching)
- **Render auto-deploy sometimes doesn't fire** → Manual Deploy → Deploy latest commit
- **Prisma `migrate dev` reset prompt**: NEVER auto-confirm — already wiped test data once.
- **Open as Mini App** (t.me/RightPlaceGame_bot/game) — initData only works in Telegram, NOT in browser
- **VPN blocks localhost** — disable during local dev
- **Port 3000 busy?** → `taskkill /F /IM node.exe` then restart server
- **RUN_COST = 3** in `server/src/routes/run.ts` — keep 3 in dev, restore to 10 before release
- **Render sometimes deploys old commit** → always check Events tab after push

## Security TODO (before real users)
- Rotate JWT_SECRET (weak placeholder) and Neon DB password

---

## Architecture

### Server (server/src/)

| Endpoint | Body | Description |
|---|---|---|
| `POST /run/start` | — | Spend energy, generate 3 rooms, save currentRun |
| `POST /run/room` | — | Process chest/trap |
| `POST /run/battle-result` | `{won, damageTaken, damageDealt, skillUses, actualHpLost, potionsUsed}` | After fight |
| `POST /run/smuggler-result` | `{exchange: bool}` | Smuggler choice |
| `POST /run/puzzle` | — | Get puzzle question |
| `POST /run/puzzle-result` | `{selectedIndex}` | Submit puzzle answer |
| `POST /character/skills` | `{skills: string[]}` | Save equipped skills (max 2) |
| `POST /character/buy-potion` | — | Buy 1 potion for 20 gold |

**Prisma Character fields:**
`level, energy, endurance, strength, agility, luck, gold, trophies, crystals, potionCharges, totalDamageReceived, totalDamageDealt, totalSkillUses, strengthAtLevelUp, enduranceAtLevelUp, equippedSkills([]), currentRun(Json?)`

**`currentRun` shape:** `{ rooms, index, hp, potions, puzzleId? }`

### Frontend (src/)

**`Battle.tsx`** — PixiJS v8 fullscreen combat.
Props: `{initialHp, maxHp, isBoss?, level?, equippedSkills?, potionCharges?, strength?, onBattleEnd}`

**Спрайты игрока (public/assets/):**
- Walk.png — 8 кадров, 128×128px, горизонтальный ряд
- Attack_1.png — 6 кадров, 128×128px, горизонтальный ряд
- Idle.png — 8 кадров, 128×128px, горизонтальный ряд
- Hurt.png — в папке, ещё не подключён
- Все спрайты смотрят влево → в коде scale.x = -1 чтобы смотрел вправо

**Координаты в Battle.tsx:**
- FLOOR_Y = height - 200
- player.y = FLOOR_Y (anchor = 0.5, 1 — ногами на полу)
- enemy.y = FLOOR_Y - ENEMY_H + 40
- WORLD_WIDTH = 3000, камера следует за игроком

**Анимации игрока (реализовано):**
- idle: idleFrames, speed 0.15, когда стоит
- walk: walkFrames, speed 0.3, когда движется
- attack: attackFrames, speed 0.4, один раз при нажатии ⚔, потом возврат к idle/walk
- Флип: scale.x отрицательный = смотрит влево, положительный = вправо

**Параллакс в ticker:**
- bgSky.tilePosition.x = -cameraX * 0.1
- bgRuins.tilePosition.x = -cameraX * 0.3
- platform.tilePosition.x = -cameraX

**`App.tsx`** — Main state.
PlayerData: `{id, firstName, level, gold, trophies, strength, endurance, agility, equippedSkills, potionCharges}`
- Navigation: 5-tab bottom nav (Персонаж / Магазин / Исследовать / Снаряжение / Друзья)
- Run flow: Start → showRoomIntro(2s) → enterCurrentRoomDirect → auto-next → results screen

---

## Stat & Leveling System

### Growth (IMPLEMENTED)
- **Endurance**: normalized dmg received / (1+0.12×(lvl-1)). +1 per 80 (until End=30), then +1 per 250
- **Strength**: normalized dmg dealt / (1+0.18×(lvl-1)). +1 per 150 (until Str=20), then +1 per 350
- **Agility**: from totalSkillUses. Threshold = 10 + agility×5
- Attack damage = 15 + Math.floor(strength / 2)

### Leveling
- **Method 1**: +3 Endurance OR +6 Strength since last level-up
- **Method 2**: boss kill → instant +1 level

---

## Room System

| Room | Chance | Reward |
|---|---|---|
| Enemy | 60% | Trophies 10-15 |
| Chest | 15% | Gold 10-50 |
| Trap | 10% | −20% maxHP |
| Puzzle | 10% | +15-60 gold OR −20% maxHP |
| Smuggler | 3% | Trophies ×1.5 OR ×0.5 |
| Boss | 2% | Trophies 15-22, level-up |

---

## Maps System — Рендер карты
- Красивый рендер (как "mapA final") делает НЕ `render_lib.py` (он процедурный, даёт рябь), а модуль `src/mapRenderer.ts` — перенесён из редактора карт `_ref/map_editor.html` (Canvas2D).
- Ключ красоты: `drawSolid` берёт КУСОК текстуры masonry под каждый тайл (`drawImage` с обрезкой sx,sy,tp), а не ужимает весь PNG; обводка — только по краям, смотрящим в воздух (air-проверки); `=` платформы берут нижние 45% текстуры.
- `renderMapToCanvas({grid, decor, tileSize}) -> HTMLCanvasElement`, в `Explore.tsx` оборачивается в `Texture.from(canvas)` и показывается как фоновый Sprite. Коллизия — отдельно, из .txt сетки.
- Текстура masonry и декор-спрайты вшиты в `mapRenderer.ts` как base64 (взяты из `_ref/map_editor.html`). Папка `_ref/` в `.gitignore`.

---

## Economy
- Trophies = risky currency, lost on death/abandon
- Gold = stable, used for potions (20 gold each)
- Trophies ≈ Gold 1:1 (exchange planned)
- Potions: max 3 per run, tracked in currentRun.potions

---

## Skills (реализовано частично)
- Игрок экипирует 2 скилла из 5: heal, dash, fireball, slash, iceball
- heal — РЕАЛИЗОВАН: восстанавливает 10% maxHp, кулдаун 5с
- dash, fireball, slash, iceball — кнопки есть в UI, логика НЕ реализована
- Все скиллы: кулдаун 5с, инкрементируют skillUses

## Next Steps (приоритет)
1. **Skills** — реализовать dash, fireball, slash, iceball в бою
2. **Equipment** — 6 слотов, тиры каждые 5 уровней
3. **Boss reward** — UI выбора стат-награды
4. **RUN_COST** — вернуть 10 перед релизом

---

## Design Decisions
- Leveling OR not AND (Method 1: +3 End OR +6 Str+Agi combined)
- Puzzle = game-mechanics quiz
- Stat normalization by level factor
- Heal/potions don't affect Endurance growth (totalDamageTaken tracked separately)
- actualHpLost sent to server for correct HP carry between rooms
- Enemy base stats: normal 120HP/14dmg, boss 200HP/18dmg
- Wide arena (3000px) with camera follow
- Sprites face left by default → flipped with scale.x = -1 in code
