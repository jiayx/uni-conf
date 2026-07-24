import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    maxWorkers: 4,
    testTimeout: 20000,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/{app,components,core,lib,pages,store}/**/*.{ts,tsx}'],
      exclude: ['src/**/__tests__/**', 'src/**/*.test.{ts,tsx}'],
      thresholds: {
        statements: 55,
        lines: 55,
        functions: 45,
        branches: 45,
        'src/app/**': { statements: 85, lines: 85, functions: 80, branches: 70 },
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
