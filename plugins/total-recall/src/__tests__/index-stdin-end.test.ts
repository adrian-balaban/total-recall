// Regression test for the session-end memory-loss bug.
//
// What this pins
// ──────────────
// On session end, Claude Code closes the MCP child's stdio streams — it does
// NOT send SIGTERM. Before the fix, only SIGTERM/SIGINT/beforeExit triggered
// `flushPending()`. `beforeExit` doesn't fire while stdin is held open (the
// readable stream keeps the event loop alive); SIGTERM/SIGINT are not what
// Claude Code delivers on session end. So the 1-second `scheduleSave` debounce
// was killed mid-flight, the in-memory `memIndex` mutations from the last
// `store_memory` never reached `index.json`, and the user saw "memories not
// saved at session end" on the next boot's reconcile.
//
// The fix added `process.stdin.on('end', shutdown)` and
// `process.stdin.on('close', shutdown)` in src/index.ts. This test asserts
// both listeners are registered in the BUILT production entry
// (dist/index.js) and in the source — so a future refactor that drops them
// (e.g. "simplify the exit handlers") is caught at npm test, not after
// another silent-drop session.
//
// Why a static source-level test (not a spawned subprocess)
// ─────────────────────────────────────────────────────────
// A subprocess test would need to spin up the real MCP server, drive a
// JSON-RPC initialize + tools/call, close stdin, and assert the index was
// flushed. That works (verified in ad-hoc dev) but takes ~3s per test and
// needs a working MCP SDK init in a non-TTY context. The CONTRACT we care
// about is: "stdin end → flushPending → saveNow → index.json on disk."
// That contract decomposes into two sub-claims: (1) the listener is wired,
// (2) the listener body does the right thing. (1) is fast and deterministic
// to assert statically. (2) is covered by the existing flushPending unit
// tests in persistence.test.ts / persistence-readonly-flush.test.ts (the
// SIGTERM/SIGINT path that shutdown() reuses). The two together pin the fix.

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPO = path.resolve(__dirname, '..', '..');
const SRC = path.join(REPO, 'src', 'index.ts');
const DIST = path.join(REPO, 'dist', 'index.js');

describe('session-end flush wiring (regression for the silent-drop bug)', () => {
  it('src/index.ts wires process.stdin end + close to shutdown()', () => {
    // The src is the canonical source; dist is what production runs. Both
    // must contain the four handlers. A refactor that drops the stdin
    // listeners is caught here.
    const src = fs.readFileSync(SRC, 'utf8');
    expect(src).toMatch(/process\.stdin\.on\(\s*['"]end['"]\s*,\s*shutdown\s*\)/);
    expect(src).toMatch(/process\.stdin\.on\(\s*['"]close['"]\s*,\s*shutdown\s*\)/);
    // The SIGTERM/SIGINT path must still exist (regression guard for
    // "simplify the exit handlers" removing the wrong handler).
    expect(src).toMatch(/process\.once\(\s*['"]SIGTERM['"]\s*,\s*shutdown\s*\)/);
    expect(src).toMatch(/process\.once\(\s*['"]SIGINT['"]\s*,\s*shutdown\s*\)/);
  });

  it('dist/index.js (the built production entry) wires process.stdin end + close to shutdown()', () => {
    // dist must include the listeners too — esbuild's tree-shaking won't
    // strip top-level side effects, but a future build config change could.
    // Pin the build output explicitly.
    expect(fs.existsSync(DIST)).toBe(true);
    const dist = fs.readFileSync(DIST, 'utf8');
    expect(dist).toMatch(/process\.stdin\.on\(\s*["']end["']\s*,\s*shutdown\s*\)/);
    expect(dist).toMatch(/process\.stdin\.on\(\s*["']close["']\s*,\s*shutdown\s*\)/);
  });

  it('shutdown() reuses the flushPending → flushEmbeddings → process.exit(0) path', () => {
    // The stdin-end handler must do the same thing as SIGTERM/SIGINT: call
    // flushPending (sync write of index.json), then await flushEmbeddings
    // (drain in-flight embed→upsert promises), then process.exit(0). If a
    // future refactor makes the stdin path a no-op (only flushPending, no
    // flushEmbeddings), in-flight vector writes from the last store_memory
    // would be killed mid-write — closing one hole and reopening the hybrid
    // search silent-drop path that the original flushEmbeddings fix closed.
    const src = fs.readFileSync(SRC, 'utf8');
    const shutdownMatch = src.match(/async function shutdown\([\s\S]*?\n\}/);
    expect(shutdownMatch).toBeDefined();
    const body = shutdownMatch![0];
    expect(body).toMatch(/flushPending\(\)/);
    expect(body).toMatch(/await flushEmbeddings\(\)/);
    expect(body).toMatch(/process\.exit\(0\)/);
  });
});
