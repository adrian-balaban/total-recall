import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';

// Behavioral tests for hooks/scripts/store-learning.mjs beyond the importanceScore
// clamp suite (store-learning.test.ts): malformed input handling, the never-overwrite
// guarantee, frontmatter-injection rejection, category fallback/validation, mixed-batch
// accounting, in-batch slug collisions, and the config.json personalVault override.
// Drives the REAL script via spawnSync with a redirected HOME.

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'hooks', 'scripts', 'store-learning.mjs');

function has(bin: string): boolean {
  return spawnSync(bin, ['--version'], { stdio: 'ignore' }).status === 0;
}
const OK = has('node') && fs.existsSync(path.join(REPO_ROOT, 'dist', 'frontmatter.mjs'));

let tmpHome: string;
const vault = () => path.join(tmpHome, '.total-recall', 'personal-vault');
const configFile = () => path.join(tmpHome, '.total-recall', 'config.json');

function runMjs(input: string): { stderr: string; stdout: string; status: number | null } {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: tmpHome };
  const r = spawnSync('node', [SCRIPT], { encoding: 'utf8', input, env, stdio: ['pipe', 'pipe', 'pipe'] });
  return { stderr: r.stderr ?? '', stdout: r.stdout ?? '', status: r.status };
}

// Parses the "store-learning: X written, Y skipped (existing), Z errors" stderr summary.
function counts(stderr: string): { written: number; skipped: number; errors: number } {
  const m = stderr.match(/store-learning: (\d+) written, (\d+) skipped \(existing\), (\d+) errors/);
  if (!m) throw new Error(`no summary in stderr:\n${stderr}`);
  return { written: Number(m[1]), skipped: Number(m[2]), errors: Number(m[3]) };
}

function line(title: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    title,
    content: '## Executive Summary\n\nBehavior probe.\n',
    tags: ['behavior-probe'],
    category: 'knowledge',
    importanceScore: 0.5,
    ...extra,
  });
}

const suite = OK ? describe : describe.skip;

suite('store-learning.mjs behavior (input validation, never-overwrite, batches)', () => {
  beforeAll(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-slbehav-'));
  }, 15000);

  afterAll(() => {
    if (tmpHome) fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  beforeEach(() => {
    fs.rmSync(path.join(tmpHome, '.total-recall'), { recursive: true, force: true });
  });

  it('B1: a malformed JSON line is counted as an error; later lines still process', () => {
    const r = runMjs(['{"title": "trunc', line('Survivor')].join('\n'));
    expect(counts(r.stderr)).toEqual({ written: 1, skipped: 0, errors: 1 });
    expect(fs.existsSync(path.join(vault(), 'knowledge', 'survivor.md'))).toBe(true);
  });

  it('B2: an object missing title or content is rejected', () => {
    const noTitle = JSON.stringify({ content: 'x', tags: [], category: 'knowledge' });
    const noContent = JSON.stringify({ title: 'No Content', tags: [], category: 'knowledge' });
    const r = runMjs([noTitle, noContent].join('\n'));
    expect(counts(r.stderr)).toEqual({ written: 0, skipped: 0, errors: 2 });
  });

  it('B3: blank / whitespace-only lines are ignored silently — not errors', () => {
    const r = runMjs(['', '   ', line('After Blanks'), ''].join('\n'));
    expect(counts(r.stderr)).toEqual({ written: 1, skipped: 0, errors: 0 });
  });

  it('B4: never-overwrite — an existing memory file is left byte-identical', () => {
    runMjs(line('Precious Memory', { content: '## Executive Summary\n\nOriginal.\n' }));
    const file = path.join(vault(), 'knowledge', 'precious-memory.md');
    const original = fs.readFileSync(file, 'utf8');

    const r = runMjs(line('Precious Memory', { content: '## Executive Summary\n\nOVERWRITE ATTEMPT.\n' }));
    expect(counts(r.stderr)).toEqual({ written: 0, skipped: 1, errors: 0 });
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
  });

  it('B5: a newline in title is rejected (frontmatter injection)', () => {
    const r = runMjs(line('Injected\ntitle: pwned'));
    expect(counts(r.stderr).errors).toBe(1);
    expect(fs.existsSync(vault())).toBe(false);
  });

  it('B6: a newline in a tag is rejected (frontmatter injection)', () => {
    const r = runMjs(line('Tag Injection', { tags: ['ok', 'bad\ntag: pwned'] }));
    expect(counts(r.stderr).errors).toBe(1);
    expect(fs.existsSync(path.join(vault(), 'knowledge', 'tag-injection.md'))).toBe(false);
  });

  it('B7: missing category falls back to knowledge/', () => {
    const obj = JSON.parse(line('No Category'));
    delete obj.category;
    runMjs(JSON.stringify(obj));
    expect(fs.existsSync(path.join(vault(), 'knowledge', 'no-category.md'))).toBe(true);
  });

  it('B8: a category with invalid characters falls back to knowledge/', () => {
    runMjs(line('Weird Category', { category: 'my category!/../escape' }));
    expect(fs.existsSync(path.join(vault(), 'knowledge', 'weird-category.md'))).toBe(true);
  });

  it('B9: a category path that exists as a plain FILE is an error, not a crash', () => {
    fs.mkdirSync(vault(), { recursive: true });
    fs.writeFileSync(path.join(vault(), 'filecat'), 'i am a file, not a directory');
    const r = runMjs(line('Blocked By File', { category: 'filecat' }));
    expect(r.status).toBe(0);
    expect(counts(r.stderr).errors).toBe(1);
  });

  it('B10: mixed batch accounting — 1 written, 1 skipped, 1 error; stdout stays empty', () => {
    runMjs(line('Already There'));
    const r = runMjs([line('Fresh One'), line('Already There'), 'not-json'].join('\n'));
    expect(counts(r.stderr)).toEqual({ written: 1, skipped: 1, errors: 1 });
    // Hooks must not spam stdout — the summary goes to stderr only.
    expect(r.stdout).toBe('');
  });

  it('B14: two titles slugifying identically within one batch — second is skipped', () => {
    const r = runMjs([line('Prefer Postgres!'), line('prefer postgres')].join('\n'));
    expect(counts(r.stderr)).toEqual({ written: 1, skipped: 1, errors: 0 });
  });

  it('B15: config.json personalVault override redirects writes to the custom vault', () => {
    const customVault = path.join(tmpHome, 'custom-vault');
    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    fs.writeFileSync(configFile(), JSON.stringify({ personalVault: customVault }));

    runMjs(line('Custom Vault Memory'));
    expect(fs.existsSync(path.join(customVault, 'knowledge', 'custom-vault-memory.md'))).toBe(true);
    expect(fs.existsSync(path.join(vault(), 'knowledge', 'custom-vault-memory.md'))).toBe(false);
  });
}, 60000);
