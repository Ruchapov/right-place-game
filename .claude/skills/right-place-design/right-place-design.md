---
name: right-place-design
description: Visual design system for the Right Place Telegram roguelike (dark souls-like, undead faction, risk/reward mood). Use this skill WHENEVER building or restyling any UI — menu screens, buttons, dialogs (Smuggler, Puzzle), HUD, currency/reward displays, inventory, or the look of combat effects (hit flashes, damage numbers, enemy telegraphs). Also use it for any choice about colours, fonts, spacing, icons, layout, mobile touch sizing, or Telegram theme integration, even if the user just says "make it look better" without naming design. Do NOT use it for combat code logic/timing (use the pixijs-conventions skill) or for server code.
---

# Right Place — Visual Design System

Goal: a consistent, readable, dark-fantasy look that works on a phone inside Telegram.
The values below are **starting defaults** — adjust them, but keep everything in this
file as the single source of truth so menus and combat don't drift apart.

## Mood
Dark, gritty, souls-like. Undead enemies. Tension and risk/reward (hold trophies vs lose
them). The UI should feel a little dangerous and weighty, not cute or pastel.

## Colour palette (starting defaults — tweak the hex, keep the roles)
Background / structure:
- Base background: `#15131A` (near-black, slightly purple)
- Panel / card: `#221E2B`
- Border / divider: `#3A3344`
- Primary text: `#EDE7F2`
- Muted text: `#9C93AD`

Semantic / danger cues (these already exist in combat — reuse them everywhere):
- Danger / AoE windup / damage taken: red `#E0353B`
- Ranged projectile / warning: orange `#F08A24`
- Success / heal / safe: green `#4FB477`

Currencies (keep distinct and consistent across all screens):
- Gold: `#E8B23A`
- Trophies: `#C0653A` (warm bronze)
- Crystals (premium): `#46C4E8` (cyan)

## Typography
- Headings / titles: a display font with a dark-fantasy / blackletter-ish feel, used
  sparingly (titles, boss name, big numbers). Keep it legible at small sizes.
- Body / UI / numbers: a clean, highly readable sans (system UI stack is fine for MVP).
- Never put long text in the display font. Phones + WebView = readability first.

## Mobile-first rules (Telegram WebView)
- Touch targets: minimum ~44×44 px. Combat buttons larger.
- Keep primary actions in the thumb zone (bottom half of the screen).
- Respect safe areas; don't put tappable UI under the Telegram top bar or home indicator.
- Design for the smallest common phone width first, then let it breathe on bigger screens.

## Telegram theme integration
- Read Telegram `themeParams` and honour the user's light/dark setting where reasonable,
  but the game's core mood stays dark. At minimum use Telegram's `bg_color`,
  `button_color`, `text_color` as the baseline so the app feels native.
- Use the Telegram main button for the primary action on a screen when it fits
  (e.g. "Start Run") instead of a custom floating button.

## Component conventions
- **Buttons**: solid fill for the primary action (gold or the accent), outline/ghost for
  secondary. One primary action per screen.
- **Panels / dialogs** (Smuggler, Puzzle, rewards): dark panel, clear title, the risk
  spelled out. Smuggler especially must make the gamble obvious (×1.5 reward vs 20% theft).
- **Currency display**: icon + number, coloured per the currency. Same component reused
  everywhere so gold always looks like gold.
- **Numbers matter in this game** (trophies, HP, damage) — make them big and legible.

## Combat juice (visual feedback only — logic lives in pixijs-conventions)
- Telegraph enemy attacks clearly: AoE = red screen tint (already in code), ranged =
  orange projectile. Keep danger cues **not colour-only** — pair with motion/shape so
  it reads for colourblind players.
- Hit feedback: brief flash / shake on the target. Damage numbers float up and fade.
- Heal/safe events use the green accent.

## Accessibility
- Body text contrast at least ~4.5:1 against its background.
- Never rely on colour alone for danger — add an icon, outline, or animation.

## When NOT to use this skill
- Combat timing/logic, ticker, hitboxes, enemy AI → use **pixijs-conventions**.
- Server code → out of scope.
