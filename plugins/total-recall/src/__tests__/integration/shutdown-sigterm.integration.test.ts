/**
 * Dynamic integration coverage for the SIGTERM shutdown path — REVIEW 11.2
 * (GLM 7.2/7.3 flagged src/index.ts shutdown/SIGTERM handlers as untested at
 * the integration level: 50% fn cov on the static pin).
 *
 * What this pins
 * ──────────────
 * Phase 6.10 (commit 1ad5661) added the `shuttingDown` latch to `shutdown()`
 * in src/index.ts, making it idempotent across the four triggers (SIGTERM,
 * SIGINT, stdin 'end', stdin 'close'). The STATIC pin landed in
 * index-stdin-end.test.ts — it asserts the source text wires the four
 * handlers and that shutdown() calls flushPending → flushEmbeddings →
 * process.exit(0). This file is the DYNAMIC pairing: it spawns the real
 * built dist/index.js, drives a real MCP session over stdio, SIGTERMs the
 * child while a scheduleSave debounce is still pending, and asserts
 * flushPending completed (index.json landed on disk with the just-stored
 * memory) before exit. This is the "test pins the latch's correctness"
 * pairing the user asked for.
 *
 * Why a spawned-subprocess test (in addition to the static pin)
 * ─────────────────────────────────────────────────────────────────────────
 * The static pin only checks the source text — that the four handlers are
 * wired and that shutdown() calls flushPending. It does NOT verify the
 * real end-to-end contract: that a SIGTERM arriving mid-session actually
 * triggers flushPending → saveNow → atomicWrite of index.json BEFORE
 * process.exit(0). Only a subprocess test can prove the synchronous
 * flushPending write lands on disk before the process is gone. The two
 * together (static structural pin + dynamic contract pin) close the
 * silent-drop regression that REVIEW 11.2 flagged.
 *
 * Wire-protocol choice — Option A (SDK Client + StdioClientTransport)
 * ─────────────────────────────────────────────────────────────────────────
 * The MCP stdio framing is newline-delimited JSON (verified in
 * @modelcontextprotocol/sdk shared/stdio.js: `JSON.stringify(message) +
 * '\n'` on send, `\n`-delimited on read). The SDK handles the framing and
 * the initialize handshake, so we use the SDK Client to drive the session
 * (initialize + tools/call store_memory). To observe exit and send SIGTERM
 * we grab the underlying ChildProcess via `(transport as any)._process`
 * (the field is private but populated after start()) and `transport.pid`.
 * The SDK's own `_process` 'close' listener nulls its field, but our
 * listener on the same ChildProcess object still fires (EventEmitter
 * allows multiple listeners). This avoids the child-lifecycle
 * entanglement of re-implementing JSON-RPC framing (Option B) while
 * giving us the ChildProcess handle we need.
 *
 * Latch-test signal choice — SIGTERM + SIGINT (not double-SIGTERM)
 * ─────────────────────────────────────────────────────────────────────────
 * `process.once('SIGTERM', shutdown)` removes the SIGTERM listener on the
 * FIRST fire, so a second SIGTERM has NO listener and falls through to
 * Node's default action (terminate with signal SIGTERM) — that is a race
 * against process.exit(0), not a latch test. SIGINT has its OWN separate
 * `process.once('SIGINT', shutdown)` registration, which stays registered
 * after SIGTERM fires. So SIGTERM-then-SIGINT deterministically exercises
 * the latch: SIGTERM fires shutdown (latch set, flushPending runs),
 * SIGINT fires shutdown (latch returns early — the no-op the latch
 * guarantees). Without the latch, the SIGINT would start a SECOND
 * concurrent shutdown (double flushEmbeddings await, double
 * process.exit(0)). The observable pin is "clean exit 0 + index.json
 * intact despite a cross-source double signal." The structural assertion
 * (that the latch is what makes this work) is carried by the static pin
 * in index-stdin-end.test.ts; this test pins the runtime invariant.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type * as cp from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

const DIST = path.resolve(__dirname, '../../../dist/index.js');

interface SpawnedChild {
  client: Client;
  transport: StdioClientTransport;
  child: cp.ChildProcess;
  pid: number;
  testHome: string;
}

async function spawnChild(testHome: string): Promise<SpawnedChild> {
  if (!fs.existsSync(DIST)) {
    throw new Error(
      `dist/index.js not found at ${DIST}. Run "npm run build" before the integration suite.`,
    );
  }
  // Isolated empty vault: only personal-vault/knowledge is needed for a
  // personal store_memory. The org-config guard (store.ts orgVaultConfigured)
  // is not exercised here — no `org` tag is sent.
  fs.mkdirSync(
    path.join(testHome, '.total-recall', 'personal-vault', 'knowledge'),
    { recursive: true },
  );

  // StdioClientParameters.env is Record<string, string>; strip undefined values.
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') env[k] = v;
  }
  env.HOME = testHome;

  const transport = new StdioClientTransport({
    command: 'node',
    args: [DIST],
    env,
    stderr: 'inherit', // startup crashes visible in test output; avoids pipe-buffer deadlock
  });

  const client = new Client({ name: 'tr-sigterm-test', version: '0.0.1' }, {});
  await client.connect(transport);

  // StdioClientTransport._process is private but populated after start().
  // Grab the underlying ChildProcess so we can listen to 'exit' directly.
  const child = (transport as unknown as { _process?: cp.ChildProcess })._process;
  if (!child || typeof child.pid !== 'number') {
    throw new Error('StdioClientTransport did not expose a usable _process ChildProcess');
  }

  return { client, transport, child, pid: child.pid, testHome };
}

function text(res: { content?: Array<{ type: string; text?: string }> }): string {
  return (res.content ?? []).map((c) => c.text ?? '').join('');
}

function json(res: unknown): any {
  return JSON.parse(text(res as any));
}

async function storeMemory(
  s: SpawnedChild,
  title: string,
  content: string,
  tags: string[],
): Promise<{ key: string }> {
  return json(
    await s.client.callTool({
      name: 'store_memory',
      arguments: { title, content, tags, category: 'knowledge' },
    }),
  );
}

/**
 * Race the child 'exit' event against a timeout. 'exit' fires when the
 * process exits (before stdio 'close'); 'close' is the backstop if 'exit'
 * never fires (stdio held open). If the child is already dead when this is
 * called, resolve immediately from the recorded exitCode/signalCode.
 */
function waitForExit(
  s: SpawnedChild,
  timeoutMs = 10_000,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    // Already dead? Resolve from the recorded codes (event won't fire again).
    if (s.child.exitCode !== null || s.child.signalCode !== null) {
      resolve({ code: s.child.exitCode, signal: s.child.signalCode });
      return;
    }
    const timer = setTimeout(() => {
      reject(new Error(`child (pid ${s.pid}) did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    const done = (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timer);
      resolve({ code, signal });
    };
    s.child.once('exit', done);
    s.child.once('close', done);
  });
}

/**
 * Read the personal index.json from disk and return its entries map.
 * Per commit c649bb7 the on-disk shape is wrapped `{ v, entries }`. Handle
 * both the wrapped form and a bare (legacy) object defensively.
 */
function readIndexEntries(testHome: string): Record<string, unknown> {
  const indexPath = path.join(testHome, '.total-recall', 'index.json');
  expect(fs.existsSync(indexPath), `index.json must exist at ${indexPath}`).toBe(true);
  const raw = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    if (
      raw.entries &&
      typeof raw.entries === 'object' &&
      !Array.isArray(raw.entries)
    ) {
      return raw.entries as Record<string, unknown>;
    }
    // Legacy bare-object shape: the whole object is the entries map.
    return raw as Record<string, unknown>;
  }
  throw new Error(`index.json at ${indexPath} is not a memory-index object`);
}

describe('SIGTERM shutdown flushes pending writes (REVIEW 11.2)', () => {
  const homes: string[] = [];

  afterEach(() => {
    for (const h of homes.splice(0)) {
      try {
        fs.rmSync(h, { recursive: true, force: true });
      } catch {
        /* ignore — best-effort cleanup */
      }
    }
  });

  it('SIGTERM mid-session triggers flushPending → index.json lands on disk before exit (11.2)', async () => {
    const testHome = path.join(
      os.tmpdir(),
      `tr-sigterm-${process.pid}-${Date.now()}-single`,
    );
    homes.push(testHome);
    const s = await spawnChild(testHome);

    try {
      const stored = await storeMemory(
        s,
        'Sigterm Flush Witness',
        'must land on disk before exit',
        ['sigterm'],
      );
      expect(stored.key).toMatch(/^knowledge\//);
      const key = stored.key as string;

      // Send SIGTERM IMMEDIATELY — before the 1s scheduleSave debounce fires.
      // store_memory writes the .md synchronously, but index.json is NOT yet
      // updated (the debounce is pending). The ONLY way index.json gets the
      // new memory is if shutdown()→flushPending() writes it synchronously
      // before process.exit(0). Waiting >1s would let the debounce land
      // index.json and make the test non-discriminating.
      process.kill(s.pid, 'SIGTERM');

      const { code, signal } = await waitForExit(s);
      // Clean exit 0 — shutdown() ran process.exit(0), not the signal default.
      expect(code).toBe(0);
      expect(signal).toBeNull();

      // The flushPending synchronous write landed on disk before exit.
      const entries = readIndexEntries(testHome);
      expect(Object.keys(entries)).toContain(key);
    } finally {
      // SIGKILL only if the child is somehow still alive (exit assertion
      // already failed via timeout). Never SIGKILL before asserting.
      try {
        process.kill(s.pid, 'SIGKILL');
      } catch {
        /* already dead — expected path */
      }
    }
  });

  it('SIGTERM + SIGINT (rapid) still exits 0 cleanly with index.json intact — pins 6.10 latch (11.2)', async () => {
    const testHome = path.join(
      os.tmpdir(),
      `tr-sigterm-${process.pid}-${Date.now()}-double`,
    );
    homes.push(testHome);
    const s = await spawnChild(testHome);

    try {
      const stored = await storeMemory(
        s,
        'Double Signal Latch Witness',
        'must land on disk despite a cross-source double signal',
        ['sigterm', 'latch'],
      );
      expect(stored.key).toMatch(/^knowledge\//);
      const key = stored.key as string;

      // Fire SIGTERM then SIGINT in rapid succession with no await between.
      // SIGTERM fires shutdown (latch set, SIGTERM listener removed,
      // flushPending runs). SIGINT has its OWN process.once registration,
      // which is still present, so it calls shutdown — the latch makes it a
      // no-op. Without the latch, the SIGINT would start a SECOND concurrent
      // shutdown (double flushEmbeddings await, double process.exit(0)).
      // (Double-SIGTERM is NOT used: once removes the SIGTERM listener on the
      // first fire, so a second SIGTERM falls through to Node's default-kill
      // — a race, not a latch test. SIGTERM+SIGINT deterministically
      // exercises the latch.)
      process.kill(s.pid, 'SIGTERM');
      process.kill(s.pid, 'SIGINT');

      const { code, signal } = await waitForExit(s);
      expect(code).toBe(0);
      expect(signal).toBeNull();

      const entries = readIndexEntries(testHome);
      expect(Object.keys(entries)).toContain(key);
    } finally {
      try {
        process.kill(s.pid, 'SIGKILL');
      } catch {
        /* already dead — expected path */
      }
    }
  });
});