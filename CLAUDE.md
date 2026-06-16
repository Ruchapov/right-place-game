# Right Place — Telegram Roguelike Game

## Project Info
- **Bot:** @RightPlaceGame_bot
- **Mini App:** t.me/RightPlaceGame_bot/game
- **GitHub:** https://github.com/Ruchapov/right-place-game
- **Developer:** Andrey Rychapov (solo)

## Tech Stack
- Frontend: React 18 + TypeScript + Vite
- Telegram SDK: @telegram-apps/sdk-react
- Styling: CSS (inline styles for now)
- Package manager: npm

## Local Development
- Vite dev server: `npm run dev -- --host` (port 5173)
- ngrok tunnel: `ngrok http 5173`
- Both must be running simultaneously for Telegram testing
- ngrok URL changes every restart — update BotFather when it changes

## Project Structure
src/
  App.tsx        — Main app component
  main.tsx       — Entry point with Telegram SDK init
  App.css        — Global styles
  index.css      — Base styles

## Coding Rules
- Always use TypeScript (no plain .js files in src/)
- Use functional React components with hooks
- No class components
- Keep components small and focused
- All game logic must be separate from UI components

## Game: Right Place (Roguelike)
- Genre: Roguelike / Dungeon crawler
- Platform: Telegram Mini App (mobile first)
- Detailed game mechanics: TBD (will be added soon)

## Important Notes
- NEVER commit .env file
- Bot token is in .env (VITE_BOT_TOKEN)
- Test on real phone via t.me/RightPlaceGame_bot/game