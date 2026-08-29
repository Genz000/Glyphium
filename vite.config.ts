import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import path from 'path'

// Deployed as a GitHub Pages project site at /Glyphium/.
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/Glyphium/' : '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
