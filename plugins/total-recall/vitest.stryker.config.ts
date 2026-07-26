import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config.ts';

// Stryker-only vitest config. The mutation audit targets the unit logic in
// ebbinghaus/tfidf/rrf/persistence/vectorStore; the broad integration smoke
// tests (index.test.ts, index-stdin-end.test.ts) and the env-sensitive e2e /
// flush / load-error tests boot the full server and rely on import-order +
// HOME-isolation that Stryker's instrumented runner perturbs (e.g. the A3
// org-vault guard test reads a stale loadConfig mtime cache when Stryker
// reorders module init). Excluding them loses no unit coverage of the five
// mutated files — each has a dedicated unit test file kept below — and keeps
// the dry-run green so the mutation run can actually score mutants.
export default defineConfig({
  ...baseConfig,
  test: {
    ...(baseConfig.test as object),
    // Explicit allow-list of the unit test files that actually exercise the 5
    // mutated source files (ebbinghaus/tfidf/rrf/persistence/vectorStore).
    // coverageAnalysis: perTest means only tests covering a mutated line are
    // re-run for that mutant, so the broad smoke tests (reserved-keys,
    // auto-reconcile, bulk, journal, mutate, query, frontmatter, paths, state,
    // vault-scan, embeddings, hook-scripts, dates, store-learning*,
    // extract-and-store-hook, confirm) add zero coverage to the targets and
    // only risk dry-run flakiness from shared memIndex state under Stryker's
    // instrumented runner. integration/** + the server-boot/e2e files are
    // excluded for the same reason.
    include: [
      'src/__tests__/ebbinghaus.test.ts',
      'src/__tests__/tfidf-search.test.ts',
      'src/__tests__/rrf.test.ts',
      'src/__tests__/recall.test.ts',
      'src/__tests__/persistence.test.ts',
      'src/__tests__/atomic-write.test.ts',
      'src/__tests__/vectorStore.test.ts',
    ],
    // Coverage analysis is driven by Stryker (perTest); disable vitest's own
    // coverage thresholds so the dry-run doesn't fail on the reduced file set.
    coverage: { enabled: false },
  },
});