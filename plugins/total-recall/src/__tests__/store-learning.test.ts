import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';

// Drives the REAL hooks/scripts/store-learning.mjs directly (PreCompact helper that
// writes extracted learnings straight to the personal vault — no MCP round-trip, so
// it bypasses store.ts's clampImportanceScore). Pins that the direct-write path
// clamps importanceScore to [0, 1] itself, mirroring src/ebbinghaus.ts
// clampImportanceScore: a model-hallucinated 5 / -1 / "high" / omitted must not
// persist unclamped to disk. Spawns node with a redirected HOME so the vault lands
// in a temp dir; reads the written .md back and parses the importanceScore line.

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'hooks', 'scripts', 'store-learning.mjs');

function has(bin: string): boolean {
  return spawnSync(bin, ['--version'], { stdio: 'ignore' }).status === 0;
}
const OK = has('node');

let tmpHome: string;
let vault: string;
let prevHome: string | undefined;

function runMjs(lines: string[]): { stdout: string; stderr: string; status: number | null } {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: tmpHome };
  const r = spawnSync('node', [SCRIPT], { encoding: 'utf8', input: lines.join('\n'), env, stdio: ['pipe', 'pipe', 'pipe'] });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status };
}

// Each line is a unique learning so existsSync never skips (store-learning.mjs never
// overwrites). Reads the persisted frontmatter `importanceScore` back as a number.
function readImportance(slug: string, category = 'knowledge'): number {
  const file = path.join(vault, category, `${slug}.md`);
  const raw = fs.readFileSync(file, 'utf8');
  const m = raw.match(/^importanceScore:\s*(.+)$/m);
  if (!m) throw new Error(`no importanceScore in ${file}:\n${raw}`);
  return Number(m[1]);
}

function line(slug: string, importanceScore: unknown): string {
  return JSON.stringify({
    title: slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    content: '## Executive Summary\n\nClamp probe.\n',
    tags: ['clamp-probe'],
    category: 'knowledge',
    importanceScore,
  });
}

const suite = OK ? describe : describe.skip;

suite('store-learning.mjs clamps importanceScore to [0, 1] on write', () => {
  beforeAll(() => {
    prevHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-storelearn-'));
    vault = path.join(tmpHome, '.total-recall', 'personal-vault');
  }, 30000);

  afterAll(() => {
    process.env.HOME = prevHome;
    if (tmpHome) fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('clamps an out-of-range-high value (5) down to 1', () => {
    runMjs([line('clamp-high', 5)]);
    expect(readImportance('clamp-high')).toBe(1);
  });

  it('clamps a negative value (-1) up to 0', () => {
    runMjs([line('clamp-low', -1)]);
    expect(readImportance('clamp-low')).toBe(0);
  });

  it('falls back to 0.5 for a non-numeric value ("high") — NaN must not propagate', () => {
    // Number("high") is NaN; Math.min(1, NaN) is NaN, so the Number.isFinite guard
    // must catch it and fall back to 0.5 (not 0, which Math.max(0, NaN)=NaN would
    // leave if the guard were missing and 0 were the floor's naive result).
    runMjs([line('clamp-str', 'high')]);
    expect(readImportance('clamp-str')).toBe(0.5);
  });

  it('falls back to 0.5 when importanceScore is omitted', () => {
    runMjs([JSON.stringify({
      title: 'Clamp Omitted',
      content: '## Executive Summary\n\nOmitted probe.\n',
      tags: ['clamp-probe'],
      category: 'knowledge',
    })]);
    expect(readImportance('clamp-omitted')).toBe(0.5);
  });

  it('preserves a normal in-range value (0.7)', () => {
    runMjs([line('clamp-normal', 0.7)]);
    expect(readImportance('clamp-normal')).toBeCloseTo(0.7);
  });
}, 60000);