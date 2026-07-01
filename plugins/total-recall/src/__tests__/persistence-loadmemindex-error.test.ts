import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Redirect HOME to a tmp dir BEFORE any module import (paths.ts captures
// os.homedir() once at load; same vi.hoisted pattern as index.test.ts /
// persistence.test.ts). No fs mock here — we need a REAL corrupt index.json
// on disk that readFileSync genuinely reads and JSON.parse genuinely rejects.
vi.hoisted(() => {
  process.env.HOME = '/tmp/tr-loadmemindex-' + process.pid;
});

import { INDEX_PATH } from '../paths.js';
import { loadIndexes } from '../persistence.js';
import { errors, memIndex } from '../state.js';

const INDEX_DIR = path.dirname(INDEX_PATH);

beforeAll(() => {
  fs.mkdirSync(INDEX_DIR, { recursive: true });
});

afterEach(() => {
  errors.length = 0;
  for (const k of Object.keys(memIndex)) delete (memIndex as any)[k];
  fs.rmSync(INDEX_PATH, { force: true });
});

// #13: loadMemIndex's bare `catch { return; }` silently swallowed a corrupt
// personal index.json (interrupted atomicWrite, bad manual edit) with no
// recordError — the personal index is self-healing (reconcileIndex rebuilds
// from .md files), so it isn't data loss, but the user had NO signal that
// their index.json was corrupt and that the rebuild discarded the
// runtime-only accessCount/lastAccessed fields. The fix records the failure
// via recordError (surfaced in get_stats.recentErrors), while ENOENT (the
// expected cold start — no index.json yet) stays silent.
describe('loadMemIndex records a corrupt index.json parse failure (#13)', () => {
  it('records a non-ENOENT parse error and does not throw', () => {
    fs.writeFileSync(INDEX_PATH, '{ "knowledge/broken": { "title": "unterminated'); // invalid JSON
    const before = errors.length;
    expect(() => loadIndexes()).not.toThrow();
    expect(errors.length).toBeGreaterThan(before);
    expect(errors[errors.length - 1]!.msg).toMatch(/loadMemIndex parse failed/);
  });

  it('records an EACCES read failure (non-ENOENT) and does not throw', () => {
    // A real chmod 000 on index.json makes readFileSync throw EACCES (the test
    // process is the non-root vault owner). The ENOENT branch must stay silent,
    // but a non-ENOENT read failure must surface — same observable as the parse
    // failure. Restore perms in finally so afterEach's rmSync can remove it.
    fs.writeFileSync(INDEX_PATH, '{}');
    fs.chmodSync(INDEX_PATH, 0o000);
    try {
      const before = errors.length;
      expect(() => loadIndexes()).not.toThrow();
      expect(errors.length).toBeGreaterThan(before);
      expect(errors[errors.length - 1]!.msg).toMatch(/loadMemIndex parse failed/);
    } finally {
      fs.chmodSync(INDEX_PATH, 0o600);
    }
  });

  it('stays silent on ENOENT (cold start — no index.json yet)', () => {
    // The expected cold start: index.json does not exist. This must NOT record
    // an error (a fresh install would otherwise log a spurious failure), and
    // must not throw.
    fs.rmSync(INDEX_PATH, { force: true });
    const before = errors.length;
    expect(() => loadIndexes()).not.toThrow();
    expect(errors.length).toBe(before);
  });
});