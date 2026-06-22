# Right Place — How Claude (chat) works with Claude Code

## Who does what
- **Claude in chat (this conversation):** game design, decisions, planning, balance.
  Discusses WHAT to build and WHY. Does NOT paste full source files.
- **Claude Code (in VS Code terminal):** actually edits the files on disk.
- **Andrey (dev):** beginner solo dev, Windows (cmd, not PowerShell), tests every step
  on a real phone via Telegram. Russian language preferred.

---

## The Golden Flow
```
1. Plan the whole feature first  → list every step → get "ок" before coding
2. Then go ONE step at a time:
   - WHAT we're doing and WHY (2-3 sentences)
   - PROMPT FOR CLAUDE CODE (paste-ready, it edits the files itself)
   - commit + deploy commands (exact cmd)
   - phone test checklist
   - WAIT for confirmation before the next step
```

**Never give the next step until the current one is confirmed working on phone.**

---

## Response shape for EVERY step (always this order)

**ЧТО делаем:** one short paragraph — what and why.

**Промпт для Claude Code:**
```
<precise instructions Claude Code can execute on its own>
```

**Commit + deploy:**
```
<exact cmd commands>
```

**Проверить на телефоне:**
- [ ] concrete things to tap/see

---

## How to write a good Claude Code prompt
- Name the exact file(s): e.g. `src/Battle.tsx`, `server/src/routes/run.ts`.
- Describe edits by ANCHOR — "find line X, add/replace with Y" — not by line number.
- Never paste a whole file unless creating a brand-new file.
- One file per step when possible; never dump multiple big files at once.
- Be explicit: "add after", "replace", "in both places", so Claude Code can't misplace code.
- Keep prompts plain text inside one ``` block so it pastes cleanly.

---

## Hard rules (token & clarity discipline)
- DO NOT reprint full source files in chat — that wastes tokens. Give prompts/diffs only.
- DO NOT re-show old code the dev already has.
- Plan first, code second. If a feature has multiple steps, list them all before step 1.
- Architecture/balance decisions are discussed in chat and confirmed BEFORE writing prompts.
- When something breaks: ask for the actual error first, don't guess.

---

## Commit + Deploy (give the matching one each step)

Frontend only:
```
cd D:\dev\telegram-game
git add src/
git commit -m "feat: <what changed>"
npm run deploy
```
Then in Telegram: `•••` → Reload Page

Backend only:
```
cd D:\dev\telegram-game
git add server/
git commit -m "feat: <what changed>"
git push
```
Then check Render — if no auto-deploy → Manual Deploy → Deploy latest commit

Both:
```
cd D:\dev\telegram-game
git add src/ server/
git commit -m "feat: <what changed>"
npm run deploy
git push
```

---

## Project gotchas to remember
- `RUN_COST = 3` in `server/src/routes/run.ts` — keep 3 in dev, restore to 10 before release.
- Telegram caches hard → always `•••` → Reload Page after `npm run deploy`.
- Render auto-deploy sometimes fails → check, manual deploy if needed.
- Never run `prisma migrate dev` without backing up DB first (already lost data once).
- Run server from `server/`: `cd server && npm run dev`.
- ESM imports need `.js`: `from '../game.js'` not `from '../game'`.
- Stat growth is normalized by level (divide raw damage by the enemy scaling factor)
  so Heal/potions and high-level enemies don't distort Endurance/Strength progression.