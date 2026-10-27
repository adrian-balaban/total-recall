import { describe, it, expect } from 'vitest';
import { projectFiles } from 'archunit';
import {
  PROD, TOOLS, ENTRY, TESTS, LEAVES, NON_LEAVES, OPTIONAL_DEP_OWNERS, OPTIONAL_DEP_IMPORT,
  CORE, NOT_ENTRY, REGISTRY, TOOL_NAMES, MAX_LINES_PER_FILE, PROCESS_OWNERS, PROCESS_IMPORT, SPEC,
} from './components.js';

// Architecture fitness functions (ArchUnitTS) enforcing architecture/adl/*.adl.
// Each test name starts with the ID of the ADL assertion it checks ([TR-S1] …);
// adl-coverage.test.ts fails when an assertion has no test. File sets come from
// ./components. They also encode the module map and C3 diagram in ARCHITECTURE.md,
// so a drifting import fails `npm test` instead of surfacing in review.
// Production code only: `src/__tests__/**` is excluded from every subject and target set.
//
// ArchUnitTS reports a file that sits in BOTH the subject and the target set as
// depending on itself, so every `shouldNot().dependOnFiles()` rule below keeps
// the two sets disjoint.

describe('architecture fitness functions', () => {
  describe('dependency structure', () => {
    // KNOWN VIOLATION — `it.fails` keeps CI green while the debt exists and turns
    // red the moment it is paid, forcing this marker to be flipped to `it`.
    // All six cycles share one back-edge: state.ts → persistence.ts
    // (bumpAccess() calls scheduleAccessSave()), and persistence.ts reaches
    // state.ts again via tfidf, vault-scan, vectorStore and embeddings.
    // Fix: have state.ts expose a registerAccessSaveHook() that persistence.ts
    // sets at load, so the dependency points one way (persistence → state).
    it.fails('[TR-S7] has no circular dependencies', async () => {
      const rule = projectFiles().inPath(PROD).should().haveNoCycles();
      await expect(rule).toPassAsync();
    });

    it('[TR-S2] core modules never depend on the tools layer', async () => {
      const rule = projectFiles()
        .inPath(CORE)
        .shouldNot()
        .dependOnFiles()
        .inPath(TOOLS);
      await expect(rule).toPassAsync();
    });

    it('[TR-S3] nothing depends on the server or entry point', async () => {
      const rule = projectFiles()
        .inPath(NOT_ENTRY)
        .shouldNot()
        .dependOnFiles()
        .inPath(ENTRY);
      await expect(rule).toPassAsync();
    });

    it('[TR-S4] production code never depends on test code', async () => {
      const rule = projectFiles()
        .inPath(PROD)
        .shouldNot()
        .dependOnFiles()
        .inPath(TESTS);
      await expect(rule).toPassAsync();
    });

    it('[TR-S1] leaf modules have no local dependencies', async () => {
      const rule = projectFiles()
        .inPath(LEAVES)
        .shouldNot()
        .dependOnFiles()
        .inPath(NON_LEAVES);
      await expect(rule).toPassAsync();
    });

    // Each tool owns its schema + handler + register(). The only sanctioned
    // cross-tool imports are bulk.ts → store/mutate (import/delete reuse the
    // single-item paths) and every tool → registry.ts.
    it.each<string>(TOOL_NAMES)(
      '[TR-S5] tools/%s.ts depends on no other tool except the registry',
      async (tool: string) => {
        const rule = projectFiles()
          .inPath(new RegExp(`^src/tools/${tool}\\.ts$`))
          .shouldNot()
          .dependOnFiles()
          .inPath(new RegExp(`^src/tools/(?!registry\\.ts$|${tool}\\.ts$)`));
        await expect(rule).toPassAsync();
      },
    );

    it('[TR-S6] the registry depends on nothing but state', async () => {
      const rule = projectFiles()
        .inPath(REGISTRY)
        .shouldNot()
        .dependOnFiles()
        .inPath(/^src\/(?!__tests__\/|state\.ts$|tools\/registry\.ts$)/);
      await expect(rule).toPassAsync();
    });

    it('[TR-S8] spec modules never depend on the tools layer', async () => {
      const rule = projectFiles().inPath(SPEC).shouldNot().dependOnFiles().inPath(TOOLS);
      await expect(rule).toPassAsync();
    });
  });

  describe('runtime safety', () => {
    it('[TR-R4] only vectorStore.ts and spec/exec.ts start external processes', async () => {
      const rule = projectFiles()
        .inPath(/^src\/(?!__tests__\/|vectorStore\.ts$|spec\/exec\.ts$)/)
        .should()
        .adhereTo((file) => !PROCESS_IMPORT.test(file.content), 'must not import child_process (use spec/exec.ts)');
      await expect(rule).toPassAsync();
      expect(PROCESS_OWNERS.test('src/spec/exec.ts')).toBe(true);
    });

    it('[TR-R1] only embeddings.ts and vectorStore.ts load optional native/ML deps', async () => {
      const rule = projectFiles()
        .inPath(/^src\/(?!__tests__\/|embeddings\.ts$|vectorStore\.ts$)/)
        .should()
        .adhereTo(
          (file) => !OPTIONAL_DEP_IMPORT.test(file.content),
          'must not import @huggingface/transformers, better-sqlite3 or sqlite-vec directly',
        );
      await expect(rule).toPassAsync();
      expect(OPTIONAL_DEP_OWNERS.test('src/embeddings.ts')).toBe(true);
    });

    // stdout IS the MCP transport (stdio JSON-RPC): one stray console.log in the
    // server corrupts the protocol stream. Diagnostics go to stderr.
    it('[TR-R2] the MCP server never writes to stdout', async () => {
      const rule = projectFiles()
        .inPath(PROD)
        .should()
        .adhereTo(
          (file) => !/\bconsole\.(log|info|debug)\s*\(|\bprocess\.stdout\.write\s*\(/.test(file.content),
          'must not write to stdout (use console.error)',
        );
      await expect(rule).toPassAsync();
    });
  });

  describe('size', () => {
    it(`[TR-Q1] no production file exceeds ${MAX_LINES_PER_FILE} lines of code`, async () => {
      const rule = projectFiles()
        .inPath(PROD)
        .should()
        .adhereTo(
          (file) => file.linesOfCode <= MAX_LINES_PER_FILE,
          `must stay at or below ${MAX_LINES_PER_FILE} lines of code`,
        );
      await expect(rule).toPassAsync();
    });
  });
});
