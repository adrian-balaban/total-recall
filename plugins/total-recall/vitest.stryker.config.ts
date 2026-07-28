import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config.ts';

// Stryker-only vitest config. The mutation audit targets unit logic across all
// source modules. Server-boot tests (index.test.ts, index-stdin-end.test.ts)
// and env-sensitive e2e / flush / load-error tests that rely on import-order +
// HOME-isolation are excluded — Stryker's instrumented runner perturbs module
// init order (e.g. the A3 org-vault guard test reads a stale loadConfig mtime
// cache). integration/** and sync-org-memory.e2e.test.ts are also excluded.
// coverageAnalysis: perTest ensures only tests covering a mutated line are
// re-run for that mutant, so excluded tests add zero coverage to their targets.
export default defineConfig({
  ...baseConfig,
  test: {
    ...(baseConfig.test as object),
    // Explicit allow-list of unit test files covering the mutated source files.
    // Server-boot / e2e / integration tests are excluded to keep the dry-run
    // stable under Stryker's instrumented runner.
    include: [
      'src/__tests__/ebbinghaus.test.ts',
      'src/__tests__/tfidf-search.test.ts',
      'src/__tests__/rrf.test.ts',
      'src/__tests__/recall.test.ts',
      'src/__tests__/persistence.test.ts',
      'src/__tests__/persistence-readonly-flush.test.ts',
      'src/__tests__/persistence-loadmemindex-error.test.ts',
      'src/__tests__/atomic-write.test.ts',
      'src/__tests__/vectorStore.test.ts',
      'src/__tests__/vectorStore-getVectors.test.ts',
      'src/__tests__/vectorStore-selfheal.test.ts',
      'src/__tests__/dates.test.ts',
      'src/__tests__/frontmatter.test.ts',
      'src/__tests__/frontmatter.property.test.ts',
      'src/__tests__/paths.test.ts',
      'src/__tests__/auto-reconcile.test.ts',
      'src/__tests__/journal.test.ts',
      'src/__tests__/vault-scan.test.ts',
      'src/__tests__/vault-scan-reconcile.test.ts',
      'src/__tests__/state.test.ts',
      'src/__tests__/embeddings.test.ts',
    ],
    // Coverage analysis is driven by Stryker (perTest); disable vitest's own
    // coverage thresholds so the dry-run doesn't fail on the reduced file set.
    coverage: { enabled: false },
  },
});