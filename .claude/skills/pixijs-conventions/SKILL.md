---
name: pixijs-conventions
description: PixiJS v8 combat-scene conventions for the Right Place Telegram roguelike. Use this skill WHENEVER editing, adding to, or debugging the combat code (Battle.tsx, any PixiJS code, the game loop, sprites, animations, dodge/attack timing, enemy or boss behaviour). Also use it for any task that touches PixiJS, the ticker, AnimatedSprite, spritesheets, hitboxes, or mobile/touch combat controls, even if the user does not say "PixiJS" by name. Do NOT use it for React menu/UI screens (App, Smuggler, Puzzle dialogs) or for server code.
---

# PixiJS Conventions — Right Place

This skill captures HOW combat is built in this project so the code stays consistent
and beginner-safe. It only governs the **combat layer**. Menus, dialogs, energy,
inventory etc. are plain React and are out of scope.

## Golden rules (read first)
- **PixiJS is for combat only.** Anything real-time with timing (movement, enemy
  windups, dodge windows, projectiles) lives in PixiJS. Everything else is React.
- **Combat state lives in JS refs, not React state.** The fight runs inside the
  PixiJS `ticker` (one function called every frame). Never drive per-frame combat
  values through `useState` — re-renders every frame will stutter on a phone.
  Use `useRef` for hp, positions, cooldown timers, attack/dodge flags, etc.
- **One source of truth per fight = `onBattleEnd`.** When the fight finishes, call
  `onBattleEnd({ won, damageTaken, damageDealt })`. The server re-checks these
  numbers, so the values must be honest and accumulated during the fight.
- **This is PixiJS v8.** Its API differs from v7. If unsure which version an example
  uses, assume v7 examples are wrong here and adapt to v8 (see below).

## Version: PixiJS v8 API cheatsheet
v8 changed several things that older tutorials get wrong:
- App init is **async**:
  ```ts
  const app = new Application();
  await app.init({ background: '#1a1a1a', resizeTo: containerEl /* or width/height */ });
  containerEl.appendChild(app.canvas); // v8: app.canvas (NOT app.view)
  ```
- Load textures/spritesheets with the **Assets** API:
  ```ts
  const sheet = await Assets.load('/sprites/player.json'); // spritesheet (.json + .png)
  ```
- Animated sprites come from spritesheet animations:
  ```ts
  const walk = new AnimatedSprite(sheet.animations['walk']);
  walk.animationSpeed = 0.15;
  walk.play();
  app.stage.addChild(walk);
  ```
- Run logic each frame with the ticker (delta-aware):
  ```ts
  app.ticker.add((ticker) => {
    const dt = ticker.deltaTime; // scale movement by dt, don't assume 60fps
    // move, check ranges, advance timers...
  });
  ```

## Battle.tsx contract (do not break)
- Props in: `{ initialHp, maxHp, isBoss?, onBattleEnd }`.
- Callback out: `onBattleEnd({ won, damageTaken, damageDealt })` exactly once per fight.
- HP persists across the whole run — `Battle` starts from `initialHp`, not full HP.

## Combat tuning currently in code (keep numbers in one place)
Player:
- Move ◀ / ▶ at ~3 px/frame.
- Attack ⚔: 15 damage, only lands when enemy is within ~70 px, 0.5 s cooldown.
- Dodge 🔄: skill-based, only valid during an enemy windup (timing, not RNG).

Normal enemy:
- Chases at ~1 px/frame.
- Windup attack every ~2 s; sprite scales to ~1.3× as the telegraph; dodgeable.

Boss:
- 150 HP, 15 damage, attacks every ~1.5 s, picks a random attack type:
  - **MELEE** — like the normal enemy, requires player within ~70 px.
  - **AOE** — red full-screen overlay during windup, hits anywhere, dodge with the button.
  - **RANGED** — orange projectile at ~4 px/frame, dodge by **moving away** (not the button).

When changing balance, change the constant — don't scatter magic numbers across the file.

## Enemy scaling (planned — apply consistently when built)
Enemies scale with player level: per level → enemy HP +10%, damage +8%. Apply the
scaling factor in ONE place when the enemy is created, so the rest of the loop reads
already-scaled values. Stat growth on the server is normalized by this factor, so do
NOT double-apply it inside the combat loop.

## Mobile / Telegram constraints
- The game runs inside Telegram's in-app browser (WebView), often on weak phones.
  Keep the ticker loop lean: no per-frame object allocation, reuse sprites/textures,
  avoid creating Graphics every frame.
- Controls are **touch**. Buttons must be large and thumb-reachable; combat is fullscreen.
- React 19 can mount components twice in dev (Strict Mode). Always **clean up** in the
  effect's return: stop the ticker, `app.destroy()`, remove the canvas — otherwise you
  leak a second running game loop. Guard init so it runs once.

## How to deliver changes (project workflow)
- Frontend uses Vite — imports are normal (NO `.js` extension; that `.js` rule is
  server-only ESM, not the frontend).
- This is a solo beginner dev on Windows. Prefer **full-file replacements** for
  `Battle.tsx` over partial diffs, and explain what changed in plain language.
- After a frontend change: `npm run deploy`, then in Telegram `•••` → Reload Page
  (caching is aggressive).

## When NOT to use this skill
- React menu/UI work (App.tsx, Smuggler.tsx, Puzzle.tsx, energy, inventory) → use the
  design skill / normal React, not this.
- Anything in `server/` → out of scope.
