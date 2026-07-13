import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/{app,components,core,lib,pages,store}/**/*.{ts,tsx}'],
      exclude: ['src/**/__tests__/**', 'src/**/*.test.{ts,tsx}'],
      thresholds: {
        statements: 50,
        lines: 50,
        functions: 40,
        branches: 40,
        'src/core/**': { statements: 65, lines: 70, functions: 70, branches: 65 },
        'src/lib/**': { statements: 85, lines: 85, functions: 85, branches: 65 },
        'src/store/**': { statements: 85, lines: 85, functions: 85, branches: 55 },
        'src/pages/**': { statements: 20, lines: 20, functions: 5, branches: 5 },
      },
    },
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
})
