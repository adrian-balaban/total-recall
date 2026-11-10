import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

// ─── Native-binding self-heal (getDb degrades at once, runs `npm rebuild` in the
// background on a missing better_sqlite3.node, and installs the db once the
// retry loads — or records an error if the rebuild did not restore it). The
// default __rebuildImpl is a no-op under NODE_ENV=test, so each test injects a
// fake to exercise the retry / latch / recordError paths without spawning npm.
//
// `errors` is imported dynamically per test (after vi.resetModules) so it is the
// SAME fresh state.js instance vectorStore records into — a static top-level
// import would be the pre-reset instance and never see the writes.

describe('vectorStore — native-binding self-heal', () => {
  const tmpDb = path.join(os.tmpdir(), `tr-vec-selfheal-${process.pid}.db`);

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try { fs.unlinkSync(tmpDb); } catch {}
  });

  it('degrades immediately, then serves the db once the background rebuild heals the binding', async () => {
    // better-sqlite3: constructor throws on the first call (missing .node), then
    // succeeds on the retry — mirrors the real "binding absent then rebuilt" flow.
    let ctorCalls = 0;
    vi.doMock('sqlite-vec', () => ({ load: vi.fn() }));
    vi.doMock('better-sqlite3', () => ({
      default: class {
        exec: any;
        prepare: any;
        constructor() {
          ctorCalls++;
          if (ctorCalls === 1) {
            throw new Error('Could not locate binding file build/Release/better_sqlite3.node');
          }
          this.exec = vi.fn();
          this.prepare = vi.fn().mockReturnValue({
            run: vi.fn(),
            all: vi.fn().mockReturnValue([]),
            get: vi.fn(),
          });
        }
      },
    }));

    const vs = await import('../vectorStore.js');
    const { errors } = await import('../state.js');
    let rebuildCalls = 0;
    vs.__testsSetRebuildImpl(async () => {
      rebuildCalls++;
      return { attempted: true, ok: true };
    });

    // The first call must NOT wait for the rebuild (it used to block the event
    // loop for minutes, timing out the MCP handshake).
    expect(await vs.__testsGetDb(tmpDb)).toBeNull();
    await vs.__testsAwaitRebuild();
    const db = await vs.__testsGetDb(tmpDb);
    expect(db).toBeTruthy();
    expect(ctorCalls).toBe(2); // 1st threw, background retry succeeded and was cached
    expect(rebuildCalls).toBe(1);
    expect(errors.length).toBe(0);
  });

  it('degrades to null + records a one-time error when rebuild fails', async () => {
    vi.doMock('sqlite-vec', () => ({ load: vi.fn() }));
    vi.doMock('better-sqlite3', () => ({
      default: class { constructor() { throw new Error('no binary'); } },
    }));

    const vs = await import('../vectorStore.js');
    const { errors } = await import('../state.js');
    let rebuildCalls = 0;
    vs.__testsSetRebuildImpl(async () => {
      rebuildCalls++;
      return { attempted: true, ok: false, detail: 'exit 1 (no build tools)' };
    });

    const db = await vs.__testsGetDb(tmpDb);
    expect(db).toBeNull();
    await vs.__testsAwaitRebuild();
    expect(rebuildCalls).toBe(1);
    expect(errors.some(e => /rebuild failed/i.test(e.msg))).toBe(true);
    expect(errors.some(e => /npm rebuild better-sqlite3/i.test(e.msg))).toBe(true);
  });

  it('attempts the rebuild only once per process (latch)', async () => {
    vi.doMock('sqlite-vec', () => ({ load: vi.fn() }));
    vi.doMock('better-sqlite3', () => ({
      default: class { constructor() { throw new Error('no binary'); } },
    }));

    const vs = await import('../vectorStore.js');
    let rebuildCalls = 0;
    vs.__testsSetRebuildImpl(async () => {
      rebuildCalls++;
      return { attempted: true, ok: false };
    });

    expect(await vs.__testsGetDb(tmpDb)).toBeNull();
    expect(await vs.__testsGetDb(tmpDb)).toBeNull(); // while in flight: no second rebuild
    await vs.__testsAwaitRebuild();
    expect(await vs.__testsGetDb(tmpDb)).toBeNull(); // after it failed: still latched
    expect(rebuildCalls).toBe(1);
  });

  it('records an HONEST error when npm reports success but the binding is still missing', async () => {
    // The real-world probe: `npm rebuild better-sqlite3` exits 0 ("rebuilt
    // dependencies successfully") but produces NO .node — prebuild-install
    // fails offline (ECONNREFUSED) and node-gyp isn't installed, so the source
    // fallback can't run. npm treats the failed install script as non-fatal.
    // The message must NOT claim the rebuild succeeded; the load-retry is the
    // ground truth, and the error must point at the manual fix.
    vi.doMock('sqlite-vec', () => ({ load: vi.fn() }));
    vi.doMock('better-sqlite3', () => ({
      default: class { constructor() { throw new Error('Could not locate binding file'); } },
    }));

    const vs = await import('../vectorStore.js');
    const { errors } = await import('../state.js');
    vs.__testsSetRebuildImpl(async () => ({ attempted: true, ok: true })); // npm exit 0

    const db = await vs.__testsGetDb(tmpDb);
    expect(db).toBeNull();
    await vs.__testsAwaitRebuild();
    const msg = errors[errors.length - 1]?.msg ?? '';
    expect(msg).toMatch(/reported success.*still absent/i); // honest: NOT "succeeded"
    expect(msg).toMatch(/npm rebuild better-sqlite3/i);      // actionable fix command
  });

  it('[TR-R3] degrades silently when no rebuild is attempted (optional-dep-absent / test default)', async () => {
    // Both optional deps absent → getDb catch runs, but the default test impl
    // returns { attempted: false }, so no recordError and a silent null (matches
    // the pre-self-heal degrade behavior pinned by vectorStore.test.ts).
    vi.doMock('sqlite-vec', () => { throw new Error('not installed'); });
    vi.doMock('better-sqlite3', () => { throw new Error('not installed'); });

    const vs = await import('../vectorStore.js');
    const { errors } = await import('../state.js');
    const db = await vs.__testsGetDb(tmpDb);
    expect(db).toBeNull();
    await vs.__testsAwaitRebuild();
    expect(errors.length).toBe(0);
  });

  it('does not block getDb while the rebuild is still running', async () => {
    vi.doMock('sqlite-vec', () => ({ load: vi.fn() }));
    vi.doMock('better-sqlite3', () => ({
      default: class { constructor() { throw new Error('no binary'); } },
    }));

    const vs = await import('../vectorStore.js');
    let release!: () => void;
    vs.__testsSetRebuildImpl(() => new Promise((resolve) => {
      release = () => resolve({ attempted: true, ok: false, detail: 'exit 1' });
    }));

    // The rebuild never settles until release(): getDb must still return.
    expect(await vs.__testsGetDb(tmpDb)).toBeNull();
    expect(await vs.__testsGetDb(tmpDb)).toBeNull();
    release();
    await vs.__testsAwaitRebuild();
  });
});