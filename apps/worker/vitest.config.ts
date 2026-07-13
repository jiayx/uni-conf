import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/integration/**'],
      thresholds: {
        statements: 80,
        lines: 80,
        functions: 90,
        branches: 65,
        'src/routes/**': { lines: 80 },
        'src/services/**': { lines: 85 },
        'src/generators/**': { lines: 80 },
      },
    },
  },
})
