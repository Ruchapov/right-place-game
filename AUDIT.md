# Server Audit — Right Place

Read-only audit. No source files were modified. Scope: `server/` (backend) and `src/` (frontend, only to identify callers of server endpoints).

---

## 1. Server file tree

Entry point: `server/src/index.ts` (per `server/package.json:7` dev script: `tsx src/index.ts`; `server/package.json:9` prod: `node dist/index.js`, built from `dist` via `tsc`).

| File | Description |
|---|---|
| `server/src/index.ts` | Fastify app bootstrap: loads `.env`, registers CORS, registers `authRoutes` and `runRoutes`, defines `GET /health`, starts HTTP listener on `PORT` (default 3000). |
| `server/src/auth.ts` | Two pure functions: `verifyTelegramInitData` (HMAC-SHA256 verification of Telegram `initData` against `BOT_TOKEN`) and `parseTelegramUser` (extracts user JSON from `initData`). No DB access. |
| `server/src/game.ts` | Pure game-logic functions, no DB/HTTP: `getCurrentEnergy` (energy regen calc), `pickRoom`/`generateRooms` (weighted random room list), `applyStatProgress` (stat threshold accumulation), `checkStatLevelUp` (unused-by-routes standalone level-up check), `normalizeDealtDamage`, `normalizeReceivedDamage`. |
| `server/src/puzzles.ts` | Static array `PUZZLES` (6 hardcoded quiz questions with correct answers) + `pickRandomPuzzle()`. |
| `server/src/routes/auth.ts` | Registers `POST /auth/login`. Verifies Telegram initData, finds-or-creates `User`+`Character`, issues JWT, returns character snapshot. |
| `server/src/routes/run.ts` | Registers all `/run/*` and `/character/*` gameplay endpoints (692 lines) — the bulk of server logic: run start/room/battle/smuggler/puzzle flow, stat growth, item rolling/granting, skills, potions, inventory, equip. |
| `server/prisma/schema.prisma` | Prisma schema: models `User`, `Character`, `Item`, `InventoryItem`. |
| `server/prisma/seed-items.ts` | One-off/manual script: wipes `Item` table and re-seeds the fixed 36-item catalog (weapons/armor/helmets/boots/gloves/amulets). Not imported by server runtime. |
| `server/prisma/reset-stats.ts` | One-off/manual script: resets `strength`/`endurance`/`agility` (and their `*Progress` fields) to 10/10/10/0/0/0 for all characters. Not imported by server runtime. |
| `server/prisma/fix-level-snapshots.ts` | One-off/manual script: clamps `level` to ≥1 and resets `strengthAtLevelUp`/`enduranceAtLevelUp` to 10 for all characters. Not imported by server runtime. |
| `server/prisma/debug-give-all-items.ts` | One-off/manual script, takes a `characterId` CLI arg, grants that character every `Item` in the catalog not already owned. Not imported by server runtime. |
| `server/src/maps/*.txt`, `*.json` (14 files) | Map grid/slot data files — see §2 for import-graph verdict. |
| `server/dist/*.js` | Compiled build output (`auth.js`, `game.js`, `index.js` present; `puzzles.js`, `routes/` not present in the listing seen — build artifact, not source, out of scope for import-graph analysis). |
| `server/.env` | Environment config (not read as code). |
| `server/tsconfig.json` | TypeScript compiler config. |

---

## 2. Import graph from `server/src/index.ts`

```
index.ts
 ├─ routes/auth.ts
 │   ├─ auth.ts            (verifyTelegramInitData, parseTelegramUser)
 │   └─ game.ts             (getCurrentEnergy)
 └─ routes/run.ts
     ├─ game.ts             (getCurrentEnergy, generateRooms, applyStatProgress via applyStatGrowth, normalizeDealtDamage, normalizeReceivedDamage)
     └─ puzzles.ts           (PUZZLES, pickRandomPuzzle)
```
Sources: `server/src/index.ts:4-5` (imports of `./routes/auth.js`, `./routes/run.js`), `server/src/routes/auth.ts:4-5` (imports of `../auth.js`, `../game.js`), `server/src/routes/run.ts:4-5` (imports of `../game.js`, `../puzzles.js`).

**Not reached by any import chain from `index.ts`:**
- `server/src/game.ts`'s exported `checkStatLevelUp` (`server/src/game.ts:77`) — the function is exported but no `import` statement anywhere under `server/src/routes/` references the name `checkStatLevelUp`. Level-up logic actually used in `run.ts` is inlined in `applyStatGrowth` (`server/src/routes/run.ts:48-87`), not this function.
- `server/prisma/*.ts` (4 scripts) — none are imported from `index.ts` or its chain; each is a standalone `main()` script meant to be run directly (e.g. `npx tsx prisma/reset-stats.ts`), confirmed by each file's own `main().catch(...).finally(...)` invocation at its bottom.
- `server/src/maps/` (14 files, confirmed count via `find`) — **confirmed not read by any server code**. `grep`-equivalent search of `server/src/routes/run.ts` (the only file with gameplay logic) shows no `fs.readFile`, `fs.readdir`, `import`, `readFileSync`, or any string literal referencing `maps/` or the specific filenames (`map_A_serpentine.txt`, etc.) anywhere in `server/src/*.ts`. Room generation in `/run/start` (`server/src/routes/run.ts:124`, `generateRooms(3)` from `game.ts`) produces abstract room-type strings (`'enemy' | 'chest' | ...`), not map geometry — it has no dependency on grid/slot files at all.
  - Note: the frontend's own map loading (`src/explore/assets.ts:442-443`) fetches map files from `public/assets/maps/` via HTTP `fetch`, a **separate directory** from `server/src/maps/` (see CLAUDE.md's "Maps System" section for the `public/assets/maps/*.txt`/`*_slots.json` set used by `Explore.tsx`). The two map file sets are not the same files and not cross-referenced in code.

---

## 3. Endpoint table

| Method | Path | What it does | Character fields read | Character fields written |
|---|---|---|---|---|
| POST | `/auth/login` (`server/src/routes/auth.ts:13`) | Verifies Telegram `initData`, finds-or-creates `User`+`Character`, issues 7-day JWT, returns character snapshot. | All fields (via `user.character` full record, spread at `auth.ts:76`) | None directly; on new user, `Character.create({})` (`auth.ts:51`) sets all schema defaults. |
| POST | `/run/start` (`run.ts:111`) | Spends `RUN_COST` (3) energy, generates 3 random rooms, computes `maxHp`, initializes `currentRun`. | `energy`, `lastEnergyUpdate`, `endurance`, `currentRun`, `potionCharges`, `id` (for equipped-items lookup) | `energy`, `lastEnergyUpdate`, `currentRun` |
| POST | `/run/room` (`run.ts:148`) | Processes current room if `chest`/`trap` (gold/damage), applies stat growth, advances/ends run. | `currentRun`, `endurance`, `level`, `gold`, `strength`, `strengthProgress`, `enduranceProgress`, `agility`, `agilityProgress`, `enduranceAtLevelUp`, `strengthAtLevelUp`, `id` | `gold`, `strength`, `strengthProgress`, `endurance`, `enduranceProgress`, `agility`, `agilityProgress`, `level`, `enduranceAtLevelUp`, `strengthAtLevelUp`, `currentRun` |
| POST | `/run/battle-result` (`run.ts:245`) | Applies client-reported battle outcome (damage/heal/skill use), rolls item drop, applies stat growth/level-up, updates trophies. | `currentRun`, `potionCharges`, `endurance`, `level`, `strength`, `strengthProgress`, `enduranceProgress`, `agility`, `agilityProgress`, `enduranceAtLevelUp`, `strengthAtLevelUp`, `trophies`, `id` | `trophies`, `strength`, `strengthProgress`, `endurance`, `enduranceProgress`, `agility`, `agilityProgress`, `level`, `enduranceAtLevelUp`, `strengthAtLevelUp`, `potionCharges`, `currentRun` |
| POST | `/run/smuggler-result` (`run.ts:371`) | Applies smuggler exchange (×1.5 trophies or 50% steal), advances run. | `currentRun`, `trophies` | `trophies`, `currentRun` |
| POST | `/run/puzzle` (`run.ts:438`) | Returns (and if needed, generates+persists) the puzzle question for the current room. | `currentRun` | `currentRun` (only `puzzleId` added, via `{...run, puzzleId}` at `run.ts:460`) |
| POST | `/run/puzzle-result` (`run.ts:468`) | Checks answer, applies gold/damage, stat growth, advances/ends run. | `currentRun`, `endurance`, `level`, `gold`, `strength`, `strengthProgress`, `enduranceProgress`, `agility`, `agilityProgress`, `enduranceAtLevelUp`, `strengthAtLevelUp` | `gold`, `strength`, `strengthProgress`, `endurance`, `enduranceProgress`, `agility`, `agilityProgress`, `level`, `enduranceAtLevelUp`, `strengthAtLevelUp`, `currentRun` |
| POST | `/character/skills` (`run.ts:564`) | Validates ≤2 skills from a whitelist, saves equipped skills. | none | `equippedSkills` |
| POST | `/character/buy-potion` (`run.ts:584`) | Spends 20 gold for +1 `potionCharges`. | `gold` | `gold`, `potionCharges` |
| GET | `/character/inventory` (`run.ts:607`) | Lists the character's `InventoryItem`s with joined `Item` data. | `id` | none |
| POST | `/character/equip` (`run.ts:640`) | Equips/unequips an `InventoryItem`, unequipping any other item in the same slot. | `id`, `level` | none (writes are to `InventoryItem`, not `Character`) |
| GET | `/health` (`index.ts:28`) | Static status/timestamp payload. | none | none |

12 endpoints total (11 in `run.ts`/`auth.ts` route registrations + `/health` in `index.ts`).

---

## 4. Frontend callers per endpoint

All endpoint wrapper functions live in `src/api.ts`, each doing a `fetch` to `https://right-place-game.onrender.com` (`src/api.ts:1`).

| Endpoint | `src/api.ts` wrapper | Called from |
|---|---|---|
| `POST /auth/login` | `loginWithTelegram` (`api.ts:20`) | `src/App.tsx:208` — inside the app-init `useEffect`. |
| `POST /run/start` | `startRun` (`api.ts:43`) | `src/App.tsx:238` — inside `handleStartRun()`. |
| `POST /run/room` | `enterRoom` (`api.ts:74`) | `src/App.tsx:284` — inside `enterCurrentRoomDirect()`. |
| `POST /run/battle-result` | `submitBattleResult` (`api.ts:105`) | `src/App.tsx:305` — inside `handleBattleEnd()`. |
| `POST /run/smuggler-result` | `submitSmugglerResult` (`api.ts:144`) | `src/App.tsx:327` — inside `handleSmugglerChoice()`. |
| `POST /run/puzzle` | `getPuzzle` (`api.ts:164`) | `src/App.tsx:275` — inside `enterCurrentRoomDirect()`. |
| `POST /run/puzzle-result` | `submitPuzzleResult` (`api.ts:194`) | `src/App.tsx:346` — inside `handlePuzzleAnswer()`. |
| `POST /character/skills` | `saveEquippedSkills` (`api.ts:210`) | `src/App.tsx:386` — inside `handleSkillToggle()`. |
| `POST /character/buy-potion` | `buyPotion` (`api.ts:231`) | `src/App.tsx:400` — inside `handleBuyPotion()`. **Note:** `handleBuyPotion` itself has no JSX event handler wired to it anywhere in `App.tsx`; the only other references to the function name are the comment at `App.tsx:406-408` ("Новая витрина «Магазин» пока не вызывает handleBuyPotion...") and the line `void handleBuyPotion` at `App.tsx:409`, added per that comment solely to satisfy the `noUnusedLocals` TypeScript check. |
| `GET /character/inventory` | `fetchInventory` (`api.ts:264`) | `src/App.tsx:416` — inside `loadInventory()`, itself called from two `useEffect`s at `App.tsx:223` (`gearTab === 'equipment'`) and `App.tsx:227` (`slotFilter !== null`). |
| `POST /character/equip` | `equipItem` (`api.ts:280`) | `src/App.tsx:430` — inside `handleEquipItem()`. |
| `GET /health` | — | No wrapper in `src/api.ts`; no reference to `/health` found anywhere under `src/` (searched, zero matches). |

`src/Explore.tsx` and its `src/explore/` modules do not call any `/run/*` or `/character/*` endpoint — confirmed by grep for `fetch(`/`/run/`/`/character/` across `src/Explore.tsx` (only match is a comment at `Explore.tsx:361` explaining that Explore does not yet call the server) and `src/explore/assets.ts` (its two `fetch()` calls at lines 442-443 target `public/assets/maps/...`, unrelated to the backend).

---

## 5. `currentRun` (Character.currentRun, Prisma `Json?`)

**Type as used in code** (`server/src/routes/run.ts:93`):
```ts
type ActiveRun = { rooms: string[]; index: number; hp: number; potions: number; puzzleId?: string }
```

**Created:** `POST /run/start` (`run.ts:140`) — `currentRun: { rooms, index: 0, hp: maxHp, potions }`. `rooms` is a 3-element array of room-type strings from `generateRooms(3)` (`run.ts:124`). Note: if a `currentRun` already existed at this point, `run.ts:127` reads `existingRun.potions` to carry the potion count forward, but the old `rooms`/`index`/`hp` are not otherwise inspected — the whole object is unconditionally overwritten at `run.ts:140`. There is no check in `/run/start` that rejects starting a new run while one is already active.

**Read:**
- `run.ts:126` (`/run/start`, only for `.potions`)
- `run.ts:155` (`/run/room`)
- `run.ts:252` (`/run/battle-result`)
- `run.ts:378` (`/run/smuggler-result`)
- `run.ts:445` (`/run/puzzle`)
- `run.ts:475` (`/run/puzzle-result`)

Each of `/run/room`, `/run/battle-result`, `/run/smuggler-result`, `/run/puzzle`, `/run/puzzle-result` returns `400 { error: 'No active run' }` if `currentRun` is `null` at that point (e.g. `run.ts:156`, `run.ts:253`, `run.ts:379`, `run.ts:446`, `run.ts:476`).

**Cleared** (set to `Prisma.DbNull`) when the run ends — either the player died (`hp <= 0`) or reached the end of the 3-room list:
- `run.ts:210` (`/run/room`): `runEnds ? Prisma.DbNull : {...}`
- `run.ts:338` (`/run/battle-result`): same pattern
- `run.ts:407` (`/run/smuggler-result`): `done ? Prisma.DbNull : {...}` (smuggler room can't itself kill the player, so only `done`, not `died`, is checked)
- `run.ts:535` (`/run/puzzle-result`): same pattern as `/run/room`

`/run/puzzle` (`run.ts:460`) does not clear `currentRun`; it only ever adds a `puzzleId` field via `{...run, puzzleId: puzzle.id}`.

**What happens if a player opens the app while `currentRun` is non-null:** `POST /auth/login` (`server/src/routes/auth.ts:69-77`) returns the full `Character` row spread (`...char`, `auth.ts:76`), which includes `currentRun` as a JSON field in the HTTP response body — but:
- `src/api.ts`'s `LoginResponse.character` type (`api.ts:6-17`) does not declare a `currentRun` field, so it is not read into the typed response.
- `grep` across `src/` for `currentRun` (excluding `server/`) finds only two comments in `src/Explore.tsx:167` and `src/explore/constants.ts:538` noting that Explore does *not* use `currentRun` — no code in `src/App.tsx` (the only file that calls `loginWithTelegram`) reads `data.character.currentRun` after login.
- Consequently, the app's UI does not detect or resume a stale/open run on login. The stale `currentRun` object sits in the DB until the next `POST /run/start` call, at which point (per the "Created" section above) it is silently overwritten — its `rooms`/`index`/`hp` are discarded, only `.potions` is carried forward.

---

## 6. `Character` model — per-field read/write audit

Fields as declared in `server/prisma/schema.prisma:20-45`.

| Field | Written at | Read at |
|---|---|---|
| `id` | Set by Prisma (`@id @default(autoincrement())`), not manually assigned in app code. | `run.ts:170` (`grantItem(character.id, item)`), `run.ts:297+299`, `run.ts:129-132` (`equippedItems` query `characterId: character.id`), `run.ts:615` (`characterId: character.id`), `run.ts:653` (`inventoryItem.characterId !== character.id`), `run.ts:663` (`characterId: character.id`) |
| `userId` | Set at `Character.create` via relation (`auth.ts:50-53`, implicit from `User.create` nested write). | Every route's `prisma.character.findUnique({ where: { userId } })` call (e.g. `run.ts:115`, `run.ts:152`, etc.) and every `prisma.character.update({ where: { userId } })` call. |
| `user` (relation) | N/A (relation field). | `auth.ts:40` (`include: { character: true }` on `User`, inverse direction). |
| `level` | `auth.ts:51` (default on create); `run.ts:207` (`/run/room`), `run.ts:334` (`/run/battle-result`, plus `+1` on boss win via `bossLevelUp` at `run.ts:312`), `run.ts:532` (`/run/puzzle-result`) | `run.ts:168` (`rollRandomItem(character.level)`), `run.ts:270` (`SCALED_ENEMY_HP` level scaling), `run.ts:280-282` (damage normalization), `run.ts:297`, `run.ts:658` (`/character/equip` level-gate check), `auth.ts:76` (returned to client) |
| `energy` | `auth.ts:51` (default); `run.ts:138` (`/run/start`, after spending `RUN_COST`) | `run.ts:118` (`getCurrentEnergy(character.energy, ...)`), `auth.ts:76` (`getCurrentEnergy(char.energy, ...)`) |
| `lastEnergyUpdate` | `auth.ts:51` (default `now()`); `run.ts:139` (`/run/start`) | `run.ts:118`, `auth.ts:76` (both via `getCurrentEnergy`) |
| `endurance` | `auth.ts:51` (default 10); `run.ts:203` (`/run/room`), `run.ts:330` (`/run/battle-result`), `run.ts:529` (`/run/puzzle-result`) | `run.ts:125,159,269,490` (`maxHp = character.endurance * 8`, in each of the 4 stat-growth routes), passed as `currentEndurance` into `applyStatGrowth` in all 4 routes |
| `strength` | `auth.ts:51` (default 10); `run.ts:201` (`/run/room`), `run.ts:328` (`/run/battle-result`), `run.ts:526` (`/run/puzzle-result`) | Passed as `currentStrength` into `applyStatGrowth` in all 4 stat-growth routes; `auth.ts:76` (returned to client) |
| `strengthAtLevelUp` | `auth.ts:51` (default 0); `run.ts:209,336,533` (all 3 routes calling `applyStatGrowth` and persisting `growth.strengthAtLevelUp`) — **not** written in `/run/room` for damage-only reasons besides growth call (it is written, since `/run/room` also calls `applyStatGrowth`) | Passed as `strengthAtLevelUp` param into `applyStatGrowth` in `run.ts:189,314,514` |
| `agility` | `auth.ts:51` (default 10); `run.ts:205,332,531` (via `growth.agility`) | Passed as `currentAgility` into `applyStatGrowth`; `auth.ts:76` returns it (`char.agility` via spread), but **not** explicitly destructured in the `auth.ts:76` response object — only present because of `...char` spread |
| `enduranceAtLevelUp` | `auth.ts:51` (default 10); `run.ts:208,335,533` (via `growth.enduranceAtLevelUp`) | Passed as `enduranceAtLevelUp` param into `applyStatGrowth` in `run.ts:188,313,513` |
| `luck` | `auth.ts:51` (default 0) only. | `auth.ts:76` via `...char` spread only (present in the raw HTTP JSON response, but `src/api.ts`'s `LoginResponse.character` type at `api.ts:6-17` declares a `luck: number` field yet **no code under `src/` reads `data.character.luck`** — `PlayerData` type in `src/App.tsx:11` has no `luck` field, and `App.tsx:210`'s `setPlayer({...})` call does not include it). No route ever writes a non-default value — no `luck:` key appears in any `prisma.character.update` call across `server/src/routes/run.ts`. |
| `strengthProgress` | `auth.ts:51` (default 0); `run.ts:202,329,527` (via `growth.strengthProgress`) | Passed as `currentStrengthProgress` into `applyStatGrowth` in `run.ts:181,307,507`; also present in raw `/auth/login` JSON via spread but not typed/read in `src/api.ts`'s `LoginResponse` |
| `enduranceProgress` | `auth.ts:51` (default 0); `run.ts:204,331,529` | Passed as `currentEnduranceProgress` into `applyStatGrowth`; same spread-only exposure via login as above |
| `agilityProgress` | `auth.ts:51` (default 0); `run.ts:206,333,530` | Passed as `currentAgilityProgress` into `applyStatGrowth`; same spread-only exposure via login |
| `gold` | `auth.ts:51` (default 0); `run.ts:200` (`/run/room`, `newGold`), `run.ts:525` (`/run/puzzle-result`), `run.ts:599` (`/character/buy-potion`, spend) | `run.ts:178,503` (`newGold = character.gold + goldGained`), `run.ts:592` (`character.gold < POTION_COST` check), `auth.ts:76` (returned via spread) |
| `trophies` | `auth.ts:51` (default 0); `run.ts:327` (`/run/battle-result`, `died ? 0 : newTrophies`), `run.ts:406` (`/run/smuggler-result`) | `run.ts:322` (`newTrophies = character.trophies + trophyGained`), `run.ts:387-397` (smuggler exchange math), `run.ts:414` (message-building comparison), `auth.ts:76` (returned via spread) |
| `crystals` | `auth.ts:51` (default 0) only. | **No reads or writes found anywhere in `server/src/*.ts`** beyond the implicit `...char` spread at `auth.ts:76` (present in raw JSON, not typed in `LoginResponse`, not read by any file under `src/`). Search for the literal `crystals` under `src/` matches only `src/Explore.tsx` and `src/explore/types.ts`, both of which are Explore's own in-memory game objects unrelated to the `Character.crystals` Prisma field. |
| `potionCharges` | `auth.ts:51` (default 3); `run.ts:337` (`/run/battle-result`, `newPotionCharges`), `run.ts:600` (`/character/buy-potion`, `+1`) | `run.ts:127` (`Math.min(character.potionCharges, 3)`), `run.ts:267-268` (potions-used math), `run.ts:592-600` (buy-potion gold/charge logic), `auth.ts:76` (returned via spread, explicitly named `potionCharges: char.potionCharges`) |
| `equippedSkills` | `auth.ts:51` (default `[]`); `run.ts:578` (`/character/skills`) | `auth.ts:76` (explicitly named `equippedSkills: char.equippedSkills`) |
| `currentRun` | See §5 in full. | See §5 in full. |
| `createdAt` | Set by Prisma (`@default(now())`) at creation. | No explicit read found in `server/src/*.ts` (not selected/used in any route logic or response payload construction beyond whatever Prisma includes by default in a full-row fetch/spread). |
| `updatedAt` | Set by Prisma (`@updatedAt`, auto-managed on every write). | No explicit read found in `server/src/*.ts`. |
| `inventoryItems` (relation) | Rows created via `grantItem()` (`run.ts:18-26`, called from `run.ts:170` and `run.ts:299`); rows updated via `/character/equip` (`run.ts:668-677`, `run.ts:685-688`). Not a scalar field on `Character` itself — writes are to the `InventoryItem` table. | `run.ts:614-618` (`/character/inventory`, `prisma.inventoryItem.findMany({ where: { characterId: ... } })`), `run.ts:19-21` (`grantItem`'s duplicate-check), `run.ts:129-132` (`/run/start` armor sum), `run.ts:649-655,662-665` (`/character/equip`) |

**Fields with no read found anywhere in `server/src/*.ts` outside the blanket `...char` spread in `/auth/login`, and no corresponding read in `src/` either:** `luck`, `crystals`, `createdAt`, `updatedAt` (the latter two are Prisma-internal bookkeeping fields, never explicitly selected/used by name in any route). `strengthProgress`/`enduranceProgress`/`agilityProgress` are read server-side (feed `applyStatGrowth`) but, like `luck`, are only exposed to the frontend incidentally via the `/auth/login` spread and are not read by any file under `src/`.

---

## 7. Сравнение карт: `server/src/maps/` vs `public/assets/maps/`

Сопоставление содержимого. `public/assets/maps/` — только `.txt` и `*_slots.json` в самой директории (без `backgrounds/`, `textures/`).

### 7.1 Список файлов с размером (байт)

**A) `server/src/maps/`** (14 файлов)

| Файл | Байт |
|---|---|
| `map_A_serpentine.txt` | 1175 |
| `map_A_slots.json` | 1668 |
| `map_B_razlom.txt` | 1175 |
| `map_B_slots.json` | 1754 |
| `map_C_boss_descent.txt` | 1299 |
| `map_C_slots.json` | 1479 |
| `map_D_slots.json` | 1937 |
| `map_D_tainik.txt` | 1399 |
| `map_D_tainik_OPEN.txt` | 1399 |
| `map_D_tainik_SEALED.txt` | 1399 |
| `map_E_slots.json` | 1740 |
| `map_E_towers.txt` | 1175 |
| `map_F_sanctuary.txt` | 1077 |
| `map_F_slots.json` | 2597 |

**B) `public/assets/maps/`** (14 файлов, top-level `.txt`/`.json` only)

| Файл | Байт |
|---|---|
| `map_A_serpentine.txt` | 1175 |
| `map_A_slots.json` | 3569 |
| `map_B_razlom.txt` | 1175 |
| `map_B_slots.json` | 1747 |
| `map_C_boss_descent.txt` | 1299 |
| `map_C_slots.json` | 1479 |
| `map_D_OPEN.txt` | 1399 |
| `map_D_OPEN_slots.json` | 1772 |
| `map_D_SEALED.txt` | 1399 |
| `map_D_SEALED_slots.json` | 1731 |
| `map_E_slots.json` | 1740 |
| `map_E_towers.txt` | 1175 |
| `map_F_sanctuary.txt` | 1077 |
| `map_F_slots.json` | 2154 |

### 7.2 Сопоставление по именам

| Карта A | B, файл | Присутствие |
|---|---|---|
| `map_A_serpentine.txt` | `map_A_serpentine.txt` | в обеих, имя совпадает |
| `map_A_slots.json` | `map_A_slots.json` | в обеих, имя совпадает |
| `map_B_razlom.txt` | `map_B_razlom.txt` | в обеих, имя совпадает |
| `map_B_slots.json` | `map_B_slots.json` | в обеих, имя совпадает |
| `map_C_boss_descent.txt` | `map_C_boss_descent.txt` | в обеих, имя совпадает |
| `map_C_slots.json` | `map_C_slots.json` | в обеих, имя совпадает |
| `map_E_towers.txt` | `map_E_towers.txt` | в обеих, имя совпадает |
| `map_E_slots.json` | `map_E_slots.json` | в обеих, имя совпадает |
| `map_F_sanctuary.txt` | `map_F_sanctuary.txt` | в обеих, имя совпадает |
| `map_F_slots.json` | `map_F_slots.json` | в обеих, имя совпадает |
| `map_D_tainik.txt` | — | только в A, аналога по имени в B нет |
| `map_D_slots.json` | — | только в A, аналога по имени в B нет |
| `map_D_tainik_OPEN.txt` | `map_D_OPEN.txt` | разные имена, вероятный аналог по смыслу (см. 7.3) |
| `map_D_tainik_SEALED.txt` | `map_D_SEALED.txt` | разные имена, вероятный аналог по смыслу |
| — | `map_D_OPEN_slots.json` | только в B, аналога по имени в A нет |
| — | `map_D_SEALED_slots.json` | только в B, аналога по имени в A нет |

Карта D в A хранится как единый набор старых имён (`map_D_tainik*`, один `map_D_slots.json`); в B — как раздельные `map_D_OPEN`/`map_D_SEALED` (два `.txt` + два `_slots.json`), что соответствует описанной в CLAUDE.md схеме "Особая механика: тайник карты D" (переименование `map_D_tainik*.txt`/`map_D_slots.json` → `map_D_OPEN.txt`/`map_D_OPEN_slots.json`/`map_D_SEALED.txt`/`map_D_SEALED_slots.json`).

### 7.3 Побайтовое сравнение одноимённых/сопоставленных пар (MD5)

| Пара | Совпадает | Характер расхождения |
|---|---|---|
| `map_A_serpentine.txt` | Нет (`f8b436ee...` vs `696b2973...`) | Та же сетка 23 строки × 48 символов в обеих; `diff` даёт 8 несовпадающих строк — точечные правки тайлов, не другой размер карты. |
| `map_A_slots.json` | Нет (`73943ecf...` vs `a598def7...`), размер 1668 vs 3569 байт | Верхнеуровневые поля различаются, см. 7.4: серверная версия не содержит `decor`. |
| `map_B_razlom.txt` | Нет (`42c3f732...` vs `f7584d79...`) | Та же сетка 23×48; 14 несовпадающих строк. |
| `map_B_slots.json` | Нет (`eb2d64a7...` vs `4e07254d...`), размер 1754 vs 1747 байт | См. 7.4: серверная версия без `obelisk`/`decor`. |
| `map_C_boss_descent.txt` | Нет (`37879d50...` vs `03765df5...`) | Та же сетка 25×49; 4 несовпадающих строки. |
| `map_C_slots.json` | **Да** (`6ebbbbd25318b96137693253d2051800` совпадает в обеих, 1479 байт) | Идентичны побайтово. |
| `map_D_tainik_OPEN.txt` ↔ `map_D_OPEN.txt` | Нет (`db5ab943...` vs `7761fdb7...`), размер одинаковый 1399 байт | Та же сетка 27×49; 8 несовпадающих строк. |
| `map_D_tainik_SEALED.txt` ↔ `map_D_SEALED.txt` | Нет (`06365b81...` vs `d998b8c5...`), размер одинаковый 1399 байт | Та же сетка 27×49; 12 несовпадающих строк. |
| `map_D_tainik.txt` | нет аналога в B | — |
| `map_D_slots.json` ↔ (`map_D_OPEN_slots.json` / `map_D_SEALED_slots.json`) | Нет, разный формат (см. 7.4) | Серверная версия — один файл со старым полем `mechanic` вместо `obelisk`/`decor`; в JSON: `"mechanic": "tainik_seal: пустой ролл Смуглера -> R [1,21],[2,22] становятся # и заваливают спуск"`. Это текстовое описание МЕХАНИКИ, отличной от той, что описана в CLAUDE.md как актуальная (текущая механика: бросок 50/50 при заходе на карту, не "пустой ролл Смуглера"). |
| `map_E_towers.txt` | **Да** (`3eb7ed72b0eb247b5db9a94dd848a744` совпадает, 1175 байт) | Идентичны побайтово. |
| `map_E_slots.json` | **Да** (`6b8b6d21d76fa4febd367744c584b8b4` совпадает, 1740 байт) | Идентичны побайтово. |
| `map_F_sanctuary.txt` | Нет (`b3b00556...` vs `27cc664c...`) | Та же сетка 21×48; 22 несовпадающих строки — наибольшее расхождение среди `.txt`. |
| `map_F_slots.json` | Нет (`dad2ad46...` vs `c1e54276...`), размер 2597 vs 2154 байт | См. 7.4: серверная версия без `decor`. |

Координата `start` в JSON (там, где сопоставление по имени возможно) совпадает во всех пяти проверенных парах: A `[0,20]`, B `[0,20]`, C `[1,6]`, E `[2,10]`, F `[0,19]`. У карты D `start` тоже совпадает во всех трёх версиях: server `map_D_slots.json` `[2,13]`, public `map_D_OPEN_slots.json` `[2,13]`, public `map_D_SEALED_slots.json` `[2,13]`.

### 7.4 Верхнеуровневые поля JSON-файлов слотов

| Файл | Поля верхнего уровня |
|---|---|
| `server/src/maps/map_A_slots.json` | `mapId, name, start, enemyClusters, reward, hazard, npc, boss` |
| `public/assets/maps/map_A_slots.json` | `mapId, name, start, enemyClusters, reward, hazard, npc, boss, decor` |
| `server/src/maps/map_B_slots.json` | `mapId, name, tiers, enemyClusters, reward, hazard, start, npc, boss` |
| `public/assets/maps/map_B_slots.json` | `mapId, name, start, enemyClusters, reward, hazard, npc, boss, obelisk, decor` |
| `server/src/maps/map_C_slots.json` | `mapId, name, tiers, enemyClusters, reward, hazard, boss, start, npc` |
| `public/assets/maps/map_C_slots.json` | `mapId, name, tiers, enemyClusters, reward, hazard, boss, start, npc` (идентичен) |
| `server/src/maps/map_D_slots.json` | `mapId, name, tiers, start, enemyClusters, reward, hazard, npc, boss, mechanic` |
| `public/assets/maps/map_D_OPEN_slots.json` | `mapId, name, start, enemyClusters, reward, hazard, npc, boss, obelisk, decor` |
| `public/assets/maps/map_D_SEALED_slots.json` | `mapId, name, start, enemyClusters, reward, hazard, npc, boss, obelisk, decor` |
| `server/src/maps/map_E_slots.json` | `mapId, name, tiers, start, enemyClusters, reward, hazard, npc, boss` |
| `public/assets/maps/map_E_slots.json` | `mapId, name, tiers, start, enemyClusters, reward, hazard, npc, boss` (идентичен) |
| `server/src/maps/map_F_slots.json` | `mapId, name, start, enemyClusters, reward, hazard, npc, boss, obelisk` |
| `public/assets/maps/map_F_slots.json` | `mapId, name, start, enemyClusters, reward, hazard, npc, boss, obelisk, decor` |

Наблюдения по запрошенным полям:
- `decor` — отсутствует во ВСЕХ файлах `server/src/maps/` (A, B, C, D, E, F). Присутствует в `public/assets/maps/` для A, B, D_OPEN, D_SEALED, F. Отсутствует в обеих версиях для C и E.
- `obelisk` — в `server/src/maps/` присутствует только у F (`map_F_slots.json`). В `public/assets/maps/` присутствует у B, D_OPEN, D_SEALED, F — отсутствует у A, C, E в обеих версиях.
- `npc` — присутствует во всех проверенных файлах с обеих сторон (A, B, C, D/D_OPEN/D_SEALED, E, F).
- `boss` — присутствует во всех проверенных файлах с обеих сторон.
- `mechanic` — присутствует только в `server/src/maps/map_D_slots.json` (значение — текстовое описание правила `tainik_seal`), ни в одном файле `public/assets/maps/` такого поля нет.
- `tiers` — присутствует в server- и public-версиях B/C/D/E не одинаково: server B/C/D/E все имеют `tiers`; public — только C и E имеют `tiers` (у public B и у обеих D-версий поля `tiers` нет).

### 7.5 Итог фактов

- Полностью идентичны (побайтово, MD5): `map_C_boss_descent.txt`↔`map_C_slots.json` (только `.json`, `.txt` этой пары различается), `map_E_towers.txt`, `map_E_slots.json` — то есть карта E полностью совпадает между копиями (оба файла), у карты C совпадает только `map_C_slots.json`, а `map_C_boss_descent.txt` отличается на 4 строки.
- Все остальные `.txt`-сетки (A, B, D_OPEN, D_SEALED, F) сохраняют тот же размер сетки (число строк и максимальную ширину строки), но отличаются по содержимому на 4–22 строк — судя по размеру расхождения, точечные правки тайлов, а не другая карта.
- Все проверенные `.json`-файлы слотов, где сопоставление по имени/смыслу возможно (A, B, D, F), отличаются по набору полей верхнего уровня: серверные копии не содержат `decor` ни в одном файле, и не содержат `obelisk` для A/B/D (только F). Серверная версия карты D хранится в старом формате (единый `map_D_slots.json` с полем `mechanic`, тремя `.txt`-файлами под именами `map_D_tainik*`) вместо актуального формата `public/assets/maps/` (раздельные `map_D_OPEN`/`map_D_SEALED`, поля `obelisk`+`decor`, без `mechanic`).
- `start`-координаты совпадают везде, где возможно сравнение.

---

## 8. Выбор событий забега — как устроено во фронте

Только чтение, ничего не менялось. Разбор `src/explore/mapEvents.ts` (`buildEventCandidates`) и мест в `src/Explore.tsx`, где из пула строится тройка `chosenEvents`, применяются гарантии для карты C/D_OPEN и события спавнятся на карте.

### 8.1 `buildEventCandidates` — сигнатура и структура кандидата

Сигнатура (`src/explore/mapEvents.ts:38`): `buildEventCandidates(slots: unknown): EventCandidate[]`.

Тип `EventCandidate` (`src/explore/types.ts:12`):
```ts
type EventCandidate = { kind: EventKind; x: number; y: number; clusterPoints?: [number, number][] }
```
Тип `EventKind` (`src/explore/types.ts:8`): `'enemy' | 'chest' | 'smuggler' | 'puzzle' | 'boss' | 'obelisk'`.

Поля слот-файла, которые читает функция, и как каждое превращается в кандидата:

| Поле слот-файла | Строки | Во что превращается |
|---|---|---|
| `enemyClusters[].points` | `mapEvents.ts:48-52` | Для каждого элемента `enemyClusters` точки фильтруются `isPointXY` (`mapEvents.ts:49`); если после фильтра есть хотя бы одна точка, создаётся ОДИН кандидат `{kind:'enemy', x, y}` = координаты ПЕРВОЙ валидной точки кластера, но `clusterPoints` несёт ВСЕ валидные точки этого кластера (`mapEvents.ts:51`). Кластер без валидных точек кандидата не создаёт вообще (`if (first) candidates.push(...)`). |
| `reward[]` | `mapEvents.ts:53-55` | Каждая отдельная валидная точка массива `reward` даёт СВОЙ кандидат `{kind:'chest', x, y}` — один кандидат на точку, без агрегации (в отличие от `enemyClusters`). |
| `npc.smuggler` | `mapEvents.ts:56-58` | Каждая валидная точка массива `npc.smuggler` → отдельный кандидат `{kind:'smuggler', x, y}`. Если `npc.smuggler` не массив (например `null`) — цикл просто не выполняется (`Array.isArray(...) ? ... : []`). |
| `npc.puzzle` | `mapEvents.ts:59-61` | То же самое для `{kind:'puzzle', x, y}`. |
| `boss` | `mapEvents.ts:62` | Это НЕ массив точек, а одна пара `[x,y]` (плоское поле, см. §7 аудита выше). Если `isPointXY(s.boss)` истинно — ровно один кандидат `{kind:'boss', x, y}`. |
| `obelisk.points` | `mapEvents.ts:64-71` | См. §8.2 — особый случай, один кандидат на всё событие. |

Функция ничего не возвращает, кроме массива `EventCandidate[]` — порядок в массиве: сначала все `enemy`, затем все `chest`, затем `smuggler`, затем `puzzle`, затем (если есть) один `boss`, затем (если есть) один `obelisk` — порядок задан порядком блоков в коде (`mapEvents.ts:48-71`), не перемешивается внутри самой функции.

### 8.2 Особые случаи внутри пула

- **Обелиск — один кандидат на всё событие.** Комментарий в коде (`mapEvents.ts:64-68`) объясняет прямо: "не по одному на точку, иначе за забег могло бы выпасть несколько обелиск-событий сразу". Механически: все валидные точки `obelisk.points` фильтруются (`mapEvents.ts:69`), затем `pickRandom(obeliskPoints, 1)` (`mapEvents.ts:70`) выбирает ОДНУ точку случайно — это происходит ВНУТРИ `buildEventCandidates`, то есть точка старта обелиска фиксируется уже на этапе построения пула кандидатов, а не позже при выборе тройки. Полный пул точек обелиска для последующего доспавна ещё трёх (после первого удара) НЕ хранится в кандидате — он берётся заново и сохраняется отдельно в `obeliskCandidatesRef` (`Explore.tsx:872-875`), напрямую из `slots.obelisk.points`, независимо от того, какая точка была выбрана в кандидате.
- **enemyCluster — один кандидат несёт координаты первой точки, но содержит весь кластер.** Разобрано в §8.1. Следствие: если `pickRandom` при формировании тройки (см. §8.3) выберет этот кандидат, при спавне (`Explore.tsx:984-1002`) будут созданы враги по ВСЕМ `clusterPoints`, а не один враг в точке `x,y` кандидата.
- **`boss` — единственное поле, которое не является массивом точек**, а плоской парой `[x,y]` — соответственно, для него в принципе не может быть больше одного кандидата с карты, в отличие от `chest`/`smuggler`/`puzzle`, где каждая точка своя.
- **`chest` (поле `reward`) — единственный тип, где НЕТ агрегации и НЕТ спец-обработки** несмотря на то, что точек может быть несколько (несколько точек `reward` = несколько независимых кандидатов `chest`, каждый может попасть или не попасть в тройку по отдельности).

### 8.3 Формирование тройки

Константа `EVENTS_PER_RUN = 3` (`src/explore/constants.ts:763`).

Выбор без повторов — функция `pickRandom<T>(items: T[], count: number): T[]` (`src/explore/utils.ts:4-13`): копирует входной массив (`pool = [...items]`), в цикле `while (pool.length > 0 && picked.length < count)` берёт случайный индекс `Math.floor(Math.random() * pool.length)`, переносит элемент из `pool` в `picked` через `splice` (тем самым исключая повторный выбор того же элемента), и так до `count` элементов или до исчерпания пула. Если в пуле меньше `count` элементов — комментарий и код (`utils.ts:2-3,7`) подтверждают: функция просто отдаёт весь пул, без ошибки/паддинга.

### 8.4 Гарантии

**Босс на карте C** (`Explore.tsx:474-503`):
- Явной проверки `mapId === 'C'` в этом блоке НЕТ. Гейт полностью косвенный: `bossIndex = eventPool.findIndex((ev) => ev.kind === 'boss')` (`Explore.tsx:488`) — кандидат `boss` в пуле появляется только если поле `slots.boss` в JSON слот-файла карты — валидная пара `[x,y]` (см. §8.1). Проверено по факту данных (§7.4/новая копия в `server/src/maps/`): поле `boss` присутствует как ключ во ВСЕХ шести слот-файлах, но значение `[30,23]` (не `null`) есть только у карты C — у A, B, D_OPEN, E, F значение `null`. Поэтому на практике `bossIndex !== -1` истинно только на карте C, но это следствие данных, а не проверка кода.
- **Спавн босса НЕ гарантирован на 100%, вопреки формулировке в CLAUDE.md ("Спавнится на 100%")**: `const bossWillSpawn = bossIndex !== -1 && Math.random() < C.BOSS_SPAWN_CHANCE` (`Explore.tsx:492`), где `BOSS_SPAWN_CHANCE = 0.3` (`src/explore/constants.ts:767`) — то есть даже на карте C бросок случайности (30%) решает, появится ли босс в этом забеге вообще.
- Если `bossWillSpawn` истинно: кандидат `eventPool[bossIndex]` вынимается из пула (`restPool = eventPool.filter((_, i) => i !== bossIndex)`, `Explore.tsx:499`) и ставится ПЕРВЫМ элементом `chosenEvents` (`Explore.tsx:500`: `[bossCandidate, ...pickRandom(restPool, C.EVENTS_PER_RUN - 1)]`) — то есть при успешном броске босс гарантированно оказывается на индексе `0` тройки (и, соответственно, в HUD — см. §8.5).
- Если `bossWillSpawn` ложно (бросок не выпал ИЛИ `bossIndex === -1`): кандидат `boss` исключается из пула целиком (`poolWithoutBoss`, `Explore.tsx:502`) ПЕРЕД вызовом `pickRandom(poolWithoutBoss, C.EVENTS_PER_RUN)` (`Explore.tsx:503`) — то есть даже при непрошедшем броске `pickRandom` физически не может вытащить `boss`-кандидата как рядовой равновероятный (в отличие от того, как это происходит с `smuggler`/`chest`/`puzzle`).
- Сам спавн спрайта босса на карте (`bossSystem!.spawn(...)`, `Explore.tsx:1113-1114`) читает `slots.boss` НАПРЯМУЮ, а не через `chosenEvents`, но гейтится ТЕМ ЖЕ `bossWillSpawn` (`if (bossWillSpawn && isPointXY(bossPoint))`) — комментарий (`Explore.tsx:1102-1111`) объясняет: без этого гейта при непрошедшем броске спрайт босса всё равно появился бы на карте, но без `eventIndex`, и закрыть событие/выдать награду было бы нечем.

**Контрабандист на `map_D_OPEN`** (`Explore.tsx:468-473, 485-487, 493-496`):
- Гейт — буквальная строковая проверка имени загруженного файла карты: `mapFile.startsWith('map_D_OPEN')` (`Explore.tsx:485`). Не проверяется `mapId`, не проверяется наличие полей в JSON — только префикс строки имени `.txt`-файла.
- `smugglerIndex = eventPool.findIndex((ev) => ev.kind === 'smuggler')` — вычисляется ТОЛЬКО если строковая проверка выше истинна; иначе `smugglerIndex = -1` безусловно (`Explore.tsx:485-487`, тернарник).
- Если `smugglerIndex !== -1`: кандидат вынимается из пула и ставится ПЕРВЫМ (`Explore.tsx:493-496`, та же схема, что у босса) — гарантированно на индексе `0` тройки.
- Эта проверка (`if (smugglerIndex !== -1)`, `Explore.tsx:493`) стоит ПЕРВОЙ в цепочке `if / else if / else` (`Explore.tsx:493-503`) — раньше проверки `bossWillSpawn` (`else if`, `Explore.tsx:497`). На практике карты C и D разные, так конфликта не бывает, но по структуре кода приоритет смуглера строго выше: если бы на одной карте одновременно был и гарантированный смуглер, и `bossWillSpawn`, сработала бы ТОЛЬКО ветка смуглера — гарантия босса и его пиннинг в тройку в этом случае не выполнились бы вовсе (ветка `else if` не достигается).
- Если гарантированного кандидата нет в пуле (`smugglerIndex === -1` — то есть либо карта не `map_D_OPEN*`, либо в JSON `npc.smuggler` пуст/`null`): просто переходит к следующей проверке (`else if (bossWillSpawn)`), для карты D это тоже ложно (`bossIndex === -1` там), и тройка собирается финальной веткой `pickRandom(poolWithoutBoss, C.EVENTS_PER_RUN)` (`Explore.tsx:501-503`) без какого-либо специального обращения со смуглером.

### 8.5 Что происходит с выбранной тройкой дальше

- `setEventClosed(Array(chosenEvents.length).fill(false))` и `setEventKinds(chosenEvents.map((ev) => ev.kind))` (`Explore.tsx:505-506`) — эти два React-состояния (`eventClosed: boolean[]`, `eventKinds: EventKind[]`) индексируются позицией в `chosenEvents` (0, 1, 2) и с этого момента больше НЕ пересобираются из `chosenEvents` — только точечно мутируются по индексу в `closeEvent()`.
- `eventsRef.current = chosenEvents.map((ev, eventIndex) => {...})` (`Explore.tsx:984-1100`) строит "живые" объекты событий (`MapEvent`, `src/explore/types.ts:281`) — здесь ТОТ ЖЕ индекс `eventIndex`, что и позиция в `chosenEvents`, используется как постоянный идентификатор события на весь забег: он передаётся в `enemySystem.spawn(ex, ey, eventIndex, trophyReward)` (`Explore.tsx:1000`), сохраняется на `Chest.eventIndex` (`Explore.tsx:1045`), на `Smuggler.eventIndex` (`Explore.tsx:1076`), в `obeliskEventIndexRef.current = eventIndex` (`Explore.tsx:1086`) и в `bossEventIndexRef.current = eventIndex` (`Explore.tsx:1096`).
- **Гнездо HUD и индекс события связаны напрямую, без дополнительного слоя.** `HudPlate` (`src/explore/ui/HudPlate.tsx:71-73`) перебирает 3 фиксированные позиции `C.SOCK_X.map((sockX, i) => ...)` и читает `eventClosed[i]`/`eventKinds[i]` — то есть гнездо №`i` на экране ВСЕГДА показывает событие, которое оказалось на позиции `i` в `chosenEvents` при формировании тройки. Никакого отдельного маппинга "тип события → гнездо" нет — порядок гнёзд полностью определяется порядком `chosenEvents`, а значит и порядком гарантий из §8.4 (гарантированный кандидат — всегда на позиции 0, то есть в ЛЕВОМ гнезде).
- `closeEvent(index)` (`Explore.tsx:1351-1364`) — единая точка закрытия: помечает `eventsRef.current[index].closed = true`, обновляет `eventClosed` по тому же индексу, и если ПОСЛЕ этого все элементы `eventsRef.current` закрыты — вызывает `onRunCompleteRef.current(...)` (конец забега).
- **Побочный факт про закрытие `boss`/`puzzle` касанием.** Общий цикл касания меток (`Explore.tsx:1846-1866`) пропускает (`continue`) только `kind === 'enemy' | 'chest' | 'smuggler' | 'obelisk'` (`Explore.tsx:1849-1854`) — `'boss'` и `'puzzle'` в этот список НЕ входят. Значит, если игрок физически коснётся хитбокса в точке `ev.x/ev.y` события `boss` (та же точка, что и точка спавна босса — см. §8.4), сработает `closeEvent(i)` из ЭТОГО общего цикла касания (`Explore.tsx:1865`), НЕЗАВИСИМО от того, жив босс или нет. `closeEvent` идемпотентен (`if (!ev || ev.closed) return`, `Explore.tsx:1353`), так что повторный вызов из `boss.ts:549` (после смерти босса) уже ничего не сделает — событие к этому моменту может быть уже закрыто одним касанием точки спавна, до того как босс убит.
- **Где хранится награда на момент спавна.** Только у `enemy`-события: `trophyTotal = rollTrophies(C.TROPHY_MULT_ENEMY)` считается ОДИН раз на весь кластер сразу при спавне (`Explore.tsx:996`), делится на доли (`Explore.tsx:997-999`) и передаётся в `enemySystem.spawn(..., trophyReward)` — то есть хранится на каждом созданном объекте `Enemy.trophyReward`, не на `MapEvent`. У `chest`, `obelisk`, `boss` награда НЕ считается на момент спавна вообще — `rollTrophies` для них вызывается позже, в момент фактического успеха: `chest` — внутри обработчика открытия сундука, только если не мимик (`Explore.tsx:2044`, `rollTrophies(C.TROPHY_MULT_CHEST)`), `obelisk` — в момент, когда сбиты все 4 (`Explore.tsx:1675`, `rollTrophies(C.TROPHY_MULT_OBELISK)`), `boss` — в обработчике конца death-анимации (`src/explore/entities/boss.ts:545`, `rollTrophies(C.TROPHY_MULT_BOSS)`). Для `smuggler` и `puzzle` в этой цепочке `rollTrophies` вообще не вызывается — множителя `TROPHY_MULT_PUZZLE` не существует в `constants.ts` (проверено — есть только `TROPHY_MULT_ENEMY/CHEST/OBELISK/BOSS`, `src/explore/constants.ts:457-460`), а обмен у смуглера — отдельная арифметика (`Explore.tsx:1199` и рядом), не через `rollTrophies`.

### 8.6 Все точки случайности в этой цепочке

| # | Файл:строка | Что выбирает | Как вызывается |
|---|---|---|---|
| 1 | `src/explore/mapEvents.ts:70` (внутри `pickRandom`, → `src/explore/utils.ts:8`) | Стартовая точка ОДНОГО обелиска из пула `obelisk.points` | `pickRandom(obeliskPoints, 1)[0]` |
| 2 | `src/Explore.tsx:455` (`chosenHazards = pickRandom(hazardPool, C.HAZARD_SPIKES_PER_RUN)`, → `utils.ts:8`) | 10 точек шипов из пула `hazard` — НЕ часть выбора событий по смыслу, но та же функция `pickRandom` и тот же проход `setup()`, что и тройка событий; упомянуто для полноты цепочки случайности этого куска кода | `pickRandom(hazardPool, C.HAZARD_SPIKES_PER_RUN)` |
| 3 | `src/Explore.tsx:492` | Бросок "заспавнится ли босс на карте C в этом забеге" (30%) | `Math.random() < C.BOSS_SPAWN_CHANCE` |
| 4 | `src/Explore.tsx:496` (→ `pickRandom` → `utils.ts:8`) | Оставшиеся `EVENTS_PER_RUN - 1` события тройки, когда сработала гарантия смуглера (map_D_OPEN) | `pickRandom(restPool, C.EVENTS_PER_RUN - 1)` |
| 5 | `src/Explore.tsx:500` (→ `pickRandom` → `utils.ts:8`) | Оставшиеся `EVENTS_PER_RUN - 1` события тройки, когда сработала гарантия босса (карта C) | `pickRandom(restPool, C.EVENTS_PER_RUN - 1)` |
| 6 | `src/Explore.tsx:503` (→ `pickRandom` → `utils.ts:8`) | Вся тройка целиком, когда НИ одна гарантия не сработала | `pickRandom(poolWithoutBoss, C.EVENTS_PER_RUN)` |
| 7 | `src/Explore.tsx:996` (→ `src/explore/rewards.ts:6`, `rollTrophies`) | Разброс ±20% награды трофеями за ВЕСЬ enemy-кластер, в момент спавна | `Math.random() * C.TROPHY_SPREAD` внутри `rollTrophies(C.TROPHY_MULT_ENEMY)` |
| 8 | `src/Explore.tsx:1675` (→ `rewards.ts:6`) | Разброс награды за обелиск, в момент успеха (все 4 сбиты) | `rollTrophies(C.TROPHY_MULT_OBELISK)` |
| 9 | `src/Explore.tsx:2044` (→ `rewards.ts:6`) | Разброс награды за сундук, в момент открытия (не мимик) | `rollTrophies(C.TROPHY_MULT_CHEST)` |
| 10 | `src/explore/entities/boss.ts:545` (→ `rewards.ts:6`) | Разброс награды за босса, в момент конца death-анимации | `rollTrophies(C.TROPHY_MULT_BOSS)` |

Прямых вызовов `Math.random()` внутри `mapEvents.ts` и в блоке формирования тройки (`Explore.tsx:462-506`) — 1 (обелиск, №1) + 3 (№3–6, включая косвенные через `pickRandom`, но `pickRandom` физически вызывается 3 раза в этом блоке — №4/№5/№6 взаимоисключающие, за один запуск `setup()` срабатывает только один из них). Награды (№7–10) считаются вне этого блока, в момент завершения соответствующего события, не при построении тройки.

---

*End of audit. No source files were modified in the course of this investigation.*
