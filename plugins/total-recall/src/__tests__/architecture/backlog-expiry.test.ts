import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Governance that makes itself machine-checked (P2 of PLAN-ARCHITECTURE-AS-CODE-COMPLIANCE-FOLLOWUPS.md):
//   [TR-G1] a DEFERRED backlog entry past its Expiry is a Fail at the next REVIEW pass;
//   [TR-G2] an it.fails('[TR-…]') older than the latest release is stale.
// Both are GOVERNANCE.md §3 policy today; these tests make them load-bearing.

const ROOT = path.resolve(__dirname, '..', '..', '..'); // plugins/total-recall
const REPO = path.resolve(ROOT, '..', '..');            // total-recall
const BACKLOG = path.join(REPO, 'backlog-and-plans', 'BACKLOG.md');
const DEFAULT_EXPIRY = '2027-06-30'; // BACKLOG.md legend: the default when no Expiry line names one

// ── [TR-G1] backlog expiries ─────────────────────────────────────────────────

interface DeferredEntry { title: string; expiry: string }

// Split the DEFERRED section (## ⏸️ DEFERRED … ## ✅ DECIDED) into its `### ` entries and
// read each entry's `**Expiry:** <YYYY-MM-DD>` line, defaulting to DEFAULT_EXPIRY.
function deferredEntries(backlog: string): DeferredEntry[] {
  const lines = backlog.split('\n');
  const start = lines.findIndex((l) => l.startsWith('## ') && l.includes('DEFERRED'));
  if (start === -1) throw new Error('BACKLOG.md: DEFERRED section not found');
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  const body = lines.slice(start + 1, end === -1 ? undefined : end);
  const entries: DeferredEntry[] = [];
  let cur: DeferredEntry | null = null;
  for (const line of body) {
    if (line.startsWith('### ')) {
      if (cur) entries.push(cur);
      cur = { title: line.slice(4).trim(), expiry: DEFAULT_EXPIRY };
      continue;
    }
    if (cur) {
      const m = line.match(/\*\*Expiry:\*\*\s+(\d{4}-\d{2}-\d{2})/);
      if (m) cur.expiry = m[1]!;
    }
  }
  if (cur) entries.push(cur);
  return entries;
}

// An entry is expired once today is past its expiry (exclusive: the expiry date is still open).
function expired(entries: DeferredEntry[], today: string): DeferredEntry[] {
  return entries.filter((e) => e.expiry < today); // YYYY-MM-DD sorts lexicographically
}

// ── [TR-G2] stale it.fails ───────────────────────────────────────────────────

// A pre-code objective may start as it.fails('[TR-…] …'); one that survives past the latest
// release tag is a parked release-gating failure (GOVERNANCE §3, REVIEW §10).
function isStale(introduced: string, latestRelease: string): boolean {
  return introduced < latestRelease;
}

function findItFails(src: string): string[] {
  return src.split('\n').filter((l) => /it\.fails\s*\(/.test(l) && /\[TR-[A-Z]\d+\]/.test(l));
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

function latestReleaseDate(): string | null {
  try {
    const out = execFileSync('git', ['tag', '--sort=-creatordate', '--format=%(creatordate:short)'], {
      cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).split('\n').map((s) => s.trim()).filter(Boolean);
    return out[0] ?? null;
  } catch { return null; } // no git history (shallow clone / release zip)
}

function introducedDate(file: string, line: string): string | null {
  try {
    const out = execFileSync('git', ['log', '--reverse', '--format=%cs', '-S', line.trim(), '--', file], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\n').map((s) => s.trim()).filter(Boolean)[0] ?? null;
  } catch { return null; }
}

describe('governance gates (TR-G1, TR-G2)', () => {
  it('[TR-G1] no DEFERRED entry is past its Expiry date', () => {
    const entries = deferredEntries(fs.readFileSync(BACKLOG, 'utf8'));
    expect(entries.length).toBeGreaterThan(0);
    const today = new Date().toISOString().slice(0, 10);
    expect(expired(entries, today).map((e) => `${e.title} (expired ${e.expiry})`)).toEqual([]);
  });

  it('[TR-G2] no it.fails TR call is older than the latest release', () => {
    const files = walk(path.join(ROOT, 'src', '__tests__')).filter((f) => f.endsWith('.test.ts'));
    const calls = files.flatMap((f) =>
      findItFails(fs.readFileSync(f, 'utf8')).map((l) => ({ f, l })),
    );
    const release = latestReleaseDate();
    const stale: string[] = [];
    if (release) {
      for (const { f, l } of calls) {
        const introduced = introducedDate(path.relative(ROOT, f), l);
        if (introduced && isStale(introduced, release)) stale.push(`${path.relative(REPO, f)}: ${l.trim()}`);
      }
    }
    expect(stale).toEqual([]);
  });

  // Known-fail cases: prove each rule can fail.
  it('flags a DEFERRED entry whose Expiry is in the past (known-fail)', () => {
    const fixture = '## ⏸️ DEFERRED — waiting\n\n### Old work\n- **Expiry:** 2020-01-01.\n\n### Future work\n- **Expiry:** 2999-01-01.\n\n---\n\n## ✅ DECIDED\n';
    expect(expired(deferredEntries(fixture), '2026-11-28').map((e) => e.title)).toEqual(['Old work']);
  });

  it('defaults a DEFERRED entry without an Expiry line to 2027-06-30', () => {
    const fixture = '## ⏸️ DEFERRED — waiting\n\n### No expiry\n- What: something.\n';
    expect(deferredEntries(fixture)).toEqual([{ title: 'No expiry', expiry: '2027-06-30' }]);
  });

  it('detects an it.fails introduced before the latest release (known-fail)', () => {
    expect(isStale('2026-01-01', '2026-06-01')).toBe(true);
    expect(isStale('2026-08-01', '2026-06-01')).toBe(false);
    // findItFails only recognises a call when a TR id is part of its body:
    expect(findItFails("it.fails('a plain pre-code objective without an id')")).toEqual([]);
  });
});