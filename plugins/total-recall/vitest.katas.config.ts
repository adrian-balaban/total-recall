import { defineConfig, configDefaults } from 'vitest/config';

// Dedicated config for the architecture-kata fitness functions
// (src/__tests__/katas/**; see backlog-and-plans/PLAN-ARCHITECTURE-KATAS.md).
// They are excluded from the default suite (vitest.config.ts) and from Stryker,
// and run via `npm run test:katas` / .github/workflows/katas.yml instead.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks',
    maxWorkers: 1,
    include: ['src/__tests__/katas/**/*.test.ts'],
    exclude: [...configDefaults.exclude, '**/.stryker-tmp/**'],
    // No kata has landed yet at the start of the programme; an empty folder is
    // not a failure.
    passWithNoTests: true,
  },
});
