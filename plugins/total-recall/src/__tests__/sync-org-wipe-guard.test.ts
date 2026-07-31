import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// H2 wipe-tripwire unit tests. Import the helpers from the real sync script (it
// has a main-guard so importing does NOT run a sync). We exercise guardTreeWipe
// against a real temp git repo: HEAD has .md files, and the wrapped op empties
// the tree — the guard must restore from HEAD and throw.
// @ts-expect-error — .mjs sibling script, no types
import { countHeadMd, countDiskMd, guardTreeWipe } from '../../scripts/sync-org-memory.mjs';

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_COUNT: '3',
  GIT_CONFIG_KEY_0: 'user.email', GIT_CONFIG_VALUE_0: 'test@example.com',
  GIT_CONFIG_KEY_1: 'user.name', GIT_CONFIG_VALUE_1: 'Test',
  GIT_CONFIG_KEY_2: 'init.defaultBranch', GIT_CONFIG_VALUE_2: 'main',
} as NodeJS.ProcessEnv;

function git(cwd: string, args: string[]) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: GIT_ENV });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

const gitOk = spawnSync('git', ['--version']).status === 0;
const suite = gitOk ? describe : describe.skip;

let repo: string;
beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-wipe-'));
  git(repo, ['init', '-q']);
  fs.mkdirSync(path.join(repo, 'knowledge'), { recursive: true });
  for (const n of ['a', 'b', 'c']) {
    fs.writeFileSync(path.join(repo, 'knowledge', `${n}.md`), `# ${n}\n`);
  }
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-qm', 'seed']);
});
afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

suite('H2 org-vault wipe tripwire', () => {
  it('countHeadMd / countDiskMd see the seeded files', () => {
    expect(countHeadMd(repo)).toBe(3);
    expect(countDiskMd(repo)).toBe(3);
  });

  it('a benign op (no tree change) passes through and returns fn result', () => {
    const r = guardTreeWipe(repo, 'noop', () => 42);
    expect(r).toBe(42);
    expect(countDiskMd(repo)).toBe(3);
  });

  it('an op that empties the tree while HEAD has files is aborted AND the tree is restored', () => {
    expect(() =>
      guardTreeWipe(repo, 'simulated-wipe', () => {
        // Simulate the incident: working tree emptied of all .md files while HEAD
        // still references them (e.g. a pathspec-checkout against an empty index).
        fs.rmSync(path.join(repo, 'knowledge'), { recursive: true, force: true });
      }),
    ).toThrow(/wipe detected/i);
    // The guard must have restored the 3 files from HEAD.
    expect(countDiskMd(repo)).toBe(3);
  });

  it('does NOT trip when the tree was already empty (cold-clone case)', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-empty-'));
    git(empty, ['init', '-q']);
    // HEAD has nothing; an op that leaves it empty must not throw.
    const r = guardTreeWipe(empty, 'cold', () => 'ok');
    expect(r).toBe('ok');
    fs.rmSync(empty, { recursive: true, force: true });
  });
});
