import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// [advisory] — a generated fitness function must ship with a known-pass and a known-fail case
// that prove it can both pass and fail (GOVERNANCE §2, checklist §9.4). This meta-test looks
// for a known-fail marker in the architecture test directory and warns (never fails) for new
// files that lack one. It becomes a gate once the spec-driven tools generate checks in bulk
// (P10 of PLAN-ARCHITECTURE-AS-CODE-COMPLIANCE-FOLLOWUPS.md).

const REPO = path.resolve(__dirname, '..', '..', '..', '..', '..'); // repo root
const ARCH = path.resolve(__dirname); // src/__tests__/architecture
// Files first committed after this follow-up must carry a marker; the pre-existing
// hand-written tests predate the marker convention and are exempt.
const BASELINE = '2026-11-27';
const MARKER = /(known-fail|known failing|\(negative\))/i;

const hasMarker = (src: string): boolean => MARKER.test(src);

function firstCommitDate(file: string): string | null {
  try {
    const out = execFileSync('git', ['log', '--reverse', '--format=%cs', '--', file], {
      cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\n').map((s) => s.trim()).filter(Boolean)[0] ?? null;
  } catch { return null; } // no git history (shallow clone / release zip)
}

describe('fixture pairing (advisory)', () => {
  it('detects a known-fail marker and its absence', () => {
    expect(hasMarker('flags a broken rule (known-fail)')).toBe(true);
    expect(hasMarker('a happy-path-only rule with no marker')).toBe(false);
  });

  it('warns for fitness tests added after the baseline without a known-fail case', () => {
    const files = fs.readdirSync(ARCH).filter((f) => f.endsWith('.test.ts'));
    const late = files
      .map((f) => ({ f, d: firstCommitDate(path.join(ARCH, f)) }))
      .filter(({ d }) => d !== null && d > BASELINE)
      .map(({ f }) => f);
    const missing = late.filter((f) => !hasMarker(fs.readFileSync(path.join(ARCH, f), 'utf8')));
    if (missing.length) console.error(`[advisory] new architecture tests without a known-fail case: ${missing.join(', ')}`);
    expect(Array.isArray(missing)).toBe(true); // advisory — never a gate (yet)
  });
});