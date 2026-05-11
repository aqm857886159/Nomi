import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import os from 'node:os'
import path from 'node:path'

export default defineConfig({
  root: __dirname,
  cacheDir: path.join(os.tmpdir(), 'nomi-vitest-cache'),
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
