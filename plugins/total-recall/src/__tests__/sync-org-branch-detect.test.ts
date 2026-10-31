import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// BACKLOG "Org-sync branch-default divergence on detached HEAD": with orgBranch
// unset and a detached HEAD, sync must target the branch pull refreshes
// (origin/HEAD), not the literal fallback.
// @ts-expect-error — .mjs sibling script, no types
import { detectOrgBranch } from '../../scripts/sync-org-memory.mjs';

const ENV = {
  ...process.env,
  GIT_CONFIG_COUNT: '3',
  GIT_CONFIG_KEY_0: 'user.email', GIT_CONFIG_VALUE_0: 't@example.com',
  GIT_CONFIG_KEY_1: 'user.name', GIT_CONFIG_VALUE_1: 'T',
  GIT_CONFIG_KEY_2: 'init.defaultBranch', GIT_CONFIG_VALUE_2: 'knowledge',
} as NodeJS.ProcessEnv;
function git(cwd: string, ...args: string[]) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: ENV });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

const suite = spawnSync('git', ['--version']).status === 0 ? describe : describe.skip;

suite('detectOrgBranch', () => {
  let tmp: string;
  let clone: string;
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-branch-'));
    const origin = path.join(tmp, 'origin');
    fs.mkdirSync(origin);
    git(origin, 'init', '-q');
    fs.writeFileSync(path.join(origin, 'a.md'), 'x');
    git(origin, 'add', '-A');
    git(origin, 'commit', '-q', '-m', 'init');
    clone = path.join(tmp, 'clone');
    spawnSync('git', ['clone', '-q', '--branch', 'knowledge', origin, clone], { env: ENV });
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('returns the current branch when attached', () => {
    expect(detectOrgBranch(clone)).toBe('knowledge');
  });

  it('on a detached HEAD falls back to origin/HEAD instead of the literal fallback', () => {
    git(clone, 'checkout', '-q', '--detach');
    expect(detectOrgBranch(clone)).toBe('knowledge');
  });

  it('returns empty when detached and origin/HEAD is unset', () => {
    git(clone, 'remote', 'set-head', 'origin', '-d');
    expect(detectOrgBranch(clone)).toBe('');
  });
});
