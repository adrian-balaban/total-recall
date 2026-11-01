import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { projectFiles } from 'archunit';
import {
  PROD, TOOLS, ENTRY, TESTS, LEAVES, NON_LEAVES, OPTIONAL_DEP_OWNERS, OPTIONAL_DEP_IMPORT,
  CORE, NOT_ENTRY, REGISTRY, TOOL_NAMES, MAX_LINES_PER_FILE, PROCESS_OWNERS, PROCESS_IMPORT, SPEC,
  SEARCH, VECTORS_AND_PERSISTENCE, REUSING_TOOLS, COMPONENT_FILES,
} from './components.js';
import { measureComplexity } from './complexity.js';

// Architecture fitness functions (ArchUnitTS) enforcing architecture/adl/*.adl.
// Each test name starts with the ID of the ADL assertion it checks ([TR-S1] …);
// adl-coverage.test.ts fails when an assertion has no test. File sets come from
// ./components. They also encode the C3 diagram (architecture/diagrams/c3-components.puml),
// so a drifting import fails `npm test` instead of surfacing in review.
// Production code only: `src/__tests__/**` is excluded from every subject and target set.
//
// ArchUnitTS reports a file that sits in BOTH the subject and the target set as
// depending on itself, so every `shouldNot().dependOnFiles()` rule below keeps
// the two sets disjoint.

describe('architecture fitness functions', () => {
  describe('dependency structure', () => {
    it('[TR-S7] has no circular dependencies', async () => {
      const rule = projectFiles().inPath(PROD).should().haveNoCycles();
      await expect(rule).toPassAsync();
      // Cycle detection walks the whole import graph (~8 s under v8 coverage),
      // well past vitest's 5 s default.
    }, 60_000);

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

    it('[TR-S6] the registry depends on nothing but state and paths', async () => {
      const rule = projectFiles()
        .inPath(REGISTRY)
        .shouldNot()
        .dependOnFiles()
        .inPath(/^src\/(?!__tests__\/|state\.ts$|paths\.ts$|tools\/registry\.ts$)/);
      await expect(rule).toPassAsync();
    });

    it('[TR-S9] state.ts has no runtime imports (type-only types.ts is fine)', async () => {
      const rule = projectFiles()
        .inPath(/^src\/state\.ts$/)
        .shouldNot()
        .dependOnFiles()
        .inPath(/^src\/(?!__tests__\/|state\.ts$|types\.ts$)/);
      await expect(rule).toPassAsync();
    });

    it('[TR-S8] spec modules never depend on the tools layer', async () => {
      const rule = projectFiles().inPath(SPEC).shouldNot().dependOnFiles().inPath(TOOLS);
      await expect(rule).toPassAsync();
    });
  });

  describe('search and tool reuse', () => {
    it('[TR-S10] lexical search never depends on vectors or persistence', async () => {
      const rule = projectFiles().inPath(SEARCH).shouldNot().dependOnFiles().inPath(VECTORS_AND_PERSISTENCE);
      await expect(rule).toPassAsync();
    });

    it.each<string>(REUSING_TOOLS)(
      '[TR-S11] tools/%s.ts depends on no tool other than store, mutate and the registry',
      async (tool: string) => {
        const rule = projectFiles()
          .inPath(new RegExp(`^src/tools/${tool}\\.ts$`))
          .shouldNot()
          .dependOnFiles()
          .inPath(new RegExp(`^src/tools/(?!registry\\.ts$|store\\.ts$|mutate\\.ts$|${tool}\\.ts$)`));
        await expect(rule).toPassAsync();
      },
    );
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
  describe('partition', () => {
    it('[TR-S12] every production file belongs to exactly one component', () => {
      const root = path.resolve(__dirname, '..', '..', '..');
      const files: string[] = [];
      const walk = (dir: string): void => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) { if (e.name !== '__tests__') walk(p); }
          else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) files.push(path.relative(root, p).split(path.sep).join('/'));
        }
      };
      walk(path.join(root, 'src'));
      const bad = files
        .map((f) => ({ f, owners: Object.entries(COMPONENT_FILES).filter(([, re]) => re.test(f)).map(([n]) => n) }))
        .filter((x) => x.owners.length !== 1)
        .map((x) => `${x.f}: ${x.owners.length === 0 ? 'no component' : x.owners.join(' + ')}`);
      expect(bad).toEqual([]);
    });
  });

  describe('engineering practices', () => {
    const ROOT = path.resolve(__dirname, '..', '..', '..');
    const MAX_CC = 10;
    const MAX_DUP_LINES = 10;
    const MAX_SHARED_CHANGES = 2;

    // Ratchet: the functions at or above MAX_CC are frozen in complexity-baseline.json.
    // A new function reaching MAX_CC, or a listed one getting worse, fails; a listed
    // function that dropped below MAX_CC (or was deleted) must leave the list, so the
    // list only ever shrinks.
    it(`[TR-Q9] no function has cyclomatic complexity of ${MAX_CC} or more, except the shrinking baseline`, () => {
      const baseline: Record<string, number> = JSON.parse(
        fs.readFileSync(path.join(__dirname, 'complexity-baseline.json'), 'utf8'));
      const now = new Map(measureComplexity(ROOT).map((f) => [f.key, f.cc]));
      const problems: string[] = [];
      for (const [key, cc] of now) {
        if (cc < MAX_CC) continue;
        if (!(key in baseline)) problems.push(`${key}: complexity ${cc} is new (limit ${MAX_CC})`);
        else if (cc > baseline[key]!) problems.push(`${key}: complexity rose from ${baseline[key]} to ${cc}`);
      }
      for (const key of Object.keys(baseline)) {
        const cc = now.get(key);
        if (cc === undefined || cc < MAX_CC) problems.push(`${key}: now ${cc ?? 'gone'}, remove it from complexity-baseline.json`);
        else if (cc < baseline[key]!) problems.push(`${key}: improved to ${cc}, lower its baseline entry from ${baseline[key]}`);
      }
      expect(problems).toEqual([]);
    });

    // CPD-style: the longest run of identical significant lines shared by two files.
    it(`[TR-Q10] no two production files share more than ${MAX_DUP_LINES} identical lines in a row`, () => {
      const files: { name: string; lines: string[] }[] = [];
      const walk = (dir: string): void => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) { if (e.name !== '__tests__') walk(p); }
          else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) {
            const lines = fs.readFileSync(p, 'utf8').split('\n').map((l) => l.trim())
              .filter((l) => l && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*') && !/^[})\]{[;,]*$/.test(l));
            files.push({ name: path.relative(ROOT, p), lines });
          }
        }
      };
      walk(path.join(ROOT, 'src'));
      const index = new Map<string, [number, number][]>();
      files.forEach((f, fi) => f.lines.forEach((l, li) => { (index.get(l) ?? index.set(l, []).get(l)!).push([fi, li]); }));
      let worst = { run: 0, a: '', b: '' };
      files.forEach((fa, a) => fa.lines.forEach((l, i) => {
        for (const [b, j] of index.get(l) ?? []) {
          if (b <= a) continue;
          const fb = files[b]!;
          if (i > 0 && j > 0 && fa.lines[i - 1] === fb.lines[j - 1]) continue; // not the start of the run
          let run = 0;
          while (fa.lines[i + run] !== undefined && fa.lines[i + run] === fb.lines[j + run]) run++;
          if (run > worst.run) worst = { run, a: fa.name, b: fb.name };
        }
      }));
      expect(worst.run, `${worst.a} and ${worst.b} share ${worst.run} identical lines`).toBeLessThanOrEqual(MAX_DUP_LINES);
    });

    // A warning, not a gate: a trailing-window git metric must not block a legitimate burst.
    it(`[TR-Q11] helpers change at most ${MAX_SHARED_CHANGES} times per month (warning only)`, () => {
      const helpers = ['dates', 'lru-cache', 'frontmatter', 'errors', 'types', 'privacy-filter', 'spec/config', 'spec/fields', 'spec/elements', 'spec/adl-parse']
        .map((m) => `src/${m}.ts`);
      let changes: number | null = null;
      try {
        const out = execFileSync('git', ['log', '--no-merges', '--since=30 days ago', '--format=%H', '--', ...helpers],
          { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        changes = out.split('\n').filter(Boolean).length;
      } catch { /* no git history in this checkout (shallow clone, release zip): nothing to measure */ }
      if (changes !== null && changes > MAX_SHARED_CHANGES) {
        console.error(`[TR-Q11] warning: helpers changed ${changes} times in the last 30 days (MAX_SHARED_CHANGES ${MAX_SHARED_CHANGES})`);
      }
      expect(changes === null || Number.isInteger(changes)).toBe(true);
    });
  });
});
