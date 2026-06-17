import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/right-place-game/',
  server: {
    allowedHosts: true,
    host: true,
  },
})