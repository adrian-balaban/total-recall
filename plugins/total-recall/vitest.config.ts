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
    // `.stryker-tmp/**`: Stryker copies the whole project into sandbox dirs, so
    // a leftover sandbox (an interrupted mutation run does not clean up) puts
    // 4-5 stale COPIES of every test file back on vitest's collection path —
    // `npm test` then reports thousands of tests, runs stale source, and takes
    // minutes longer. Gitignored is not enough; vitest needs it excluded too.
    exclude: [
      ...configDefaults.exclude,
      'src/__tests__/integration/**',
      '**/.stryker-tmp/**',
    ],
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
