import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// С 24.11.2026 игра живёт на корне своего домена (https://rightplace-game.ru/),
// а не в подпапке GitHub Pages — поэтому base '/'. Все пути к картинкам идут
// через import.meta.env.BASE_URL и подстраиваются сами.
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    // карты исходников на сайт не выкладываем — по ним читается исходный код
    sourcemap: false,
  },
  server: {
    allowedHosts: true,
    host: true,
  },
})
