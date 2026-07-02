import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks',
    maxWorkers: 1,   // run test files sequentially — index.ts has module-level state
    // Keep the default `npm test` suite as unit + component only. Integration
    // tests (src/__tests__/integration/**) spawn a real process and require a
    // build — run them separately via `npm run test:integration`.
    exclude: [...configDefaults.exclude, 'src/__tests__/integration/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/__tests__/**',
        'src/types.ts',
        'src/**/*.d.ts'
      ],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 90,
        statements: 95,
      },
    },
  },
});
