import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  root: __dirname,
  cacheDir: '/private/tmp/nomi-vitest-cache',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./setup.ts'],
    css: true,
    include: ['unit/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    clearMocks: true,
  },
})
