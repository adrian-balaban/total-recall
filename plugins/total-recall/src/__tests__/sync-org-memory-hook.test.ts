import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';

// Tests the REAL hooks/scripts/sync-org-memory.sh plumbing (#2 fix): it must read the
// PostToolUse JSON from STDIN (not argv), extract `key` from tool_response (handling the
// MCP envelope shape {content:[{type:"text",text:"<json>"}]} AND the unwrapped shape),
// fall back to tool_input.key when the response carries none, and pass --delete when the
// tool is delete_memory. We run the real .sh against a fake plugin tree with a stub .mjs
// that records its argv, isolating the hook's parsing logic from the real git sync.

const REAL_SH = path.resolve(__dirname, '..', '..', 'hooks', 'scripts', 'sync-org-memory.sh');
// sync-org-memory.sh now sources _resolve-node.sh (nvm/stripped-PATH-safe node resolver,
// mirroring statusline.sh) — the fake tree must mirror the real layout or `set -e` aborts
// the script on the missing source. See finding #1 in review-fix.tmp.
const REAL_HELPER = path.resolve(__dirname, '..', '..', 'hooks', 'scripts', '_resolve-node.sh');

// Stub .mjs: records process.argv.slice(2) (the key + optional --delete) to a file named
// by TR_HOOK_ARGS_FILE. Lets us assert exactly what the hook invoked without running git.
const STUB_MJS = `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const argsFile = process.env.TR_HOOK_ARGS_FILE;
if (argsFile) {
  fs.mkdirSync(path.dirname(argsFile), { recursive: true });
  fs.writeFileSync(argsFile, process.argv.slice(2).join('\\n'));
}
process.exit(0);
`;

function has(bin: string): boolean {
  return spawnSync(bin, ['--version'], { stdio: 'ignore' }).status === 0;
}
// The hook parses its stdin JSON via `node` (ported from python3), so the only
// runtime deps are bash + flock + node — NOT python3. Requiring python3 here
// would wrongly skip the test on python3-less systems, where the hook now works.
const OK = has('bash') && has('flock') && has('node');

let fakeRoot: string;
let tmpHome: string;
let prevHome: string | undefined;
let argsFile: string;
let shPath: string;

function runHook(json: string): { stdout: string; status: number | null } {
  // Wipe the args file first so a stale write from a prior test can't masquerade as this
  // run's output (the backgrounded node writes ~instantly, but the .sh exits before it
  // finishes, so waitForArgs polls for the FRESH write).
  fs.rmSync(argsFile, { force: true });
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: tmpHome, TR_HOOK_ARGS_FILE: argsFile };
  const r = spawnSync('bash', [shPath], { encoding: 'utf8', input: json, env, stdio: ['pipe', 'pipe', 'pipe'] });
  return { stdout: r.stdout ?? '', status: r.status };
}

async function waitForArgs(timeoutMs = 4000): Promise<{ key: string; delete: boolean; force: boolean } | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(argsFile)) {
      const raw = fs.readFileSync(argsFile, 'utf8').trim();
      if (raw) {
        const parts = raw.split('\n');
        return { key: parts[0] ?? '', delete: parts.includes('--delete'), force: parts.includes('--force') };
      }
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  return null;
}

const suite = OK ? describe : describe.skip;

suite('sync-org-memory.sh hook plumbing (#2: stdin parse + --delete routing)', () => {
  beforeAll(() => {
    prevHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-hook-'));
    fakeRoot = path.join(tmpHome, 'fake-plugin');
    argsFile = path.join(tmpHome, 'args.txt');
    shPath = path.join(fakeRoot, 'hooks', 'scripts', 'sync-org-memory.sh');

    // Fake plugin tree mirroring the layout the .sh resolves via BASH_SOURCE/../..
    fs.mkdirSync(path.join(fakeRoot, 'hooks', 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(fakeRoot, 'scripts'), { recursive: true });
    fs.copyFileSync(REAL_SH, shPath);
    fs.chmodSync(shPath, 0o755);
    // Mirror the real scripts/ layout: the .sh sources _resolve-node.sh from its own dir.
    const helperPath = path.join(fakeRoot, 'hooks', 'scripts', '_resolve-node.sh');
    fs.copyFileSync(REAL_HELPER, helperPath);
    fs.chmodSync(helperPath, 0o755);
    fs.writeFileSync(path.join(fakeRoot, 'scripts', 'sync-org-memory.mjs'), STUB_MJS);
    // The .sh backgrounds build-memory-index.sh; keep it a harmless no-op.
    const bmi = path.join(fakeRoot, 'hooks', 'scripts', 'build-memory-index.sh');
    fs.writeFileSync(bmi, '#!/usr/bin/env bash\nexit 0\n');
    fs.chmodSync(bmi, 0o755);
  }, 10000);

  afterAll(() => {
    process.env.HOME = prevHome;
    if (tmpHome) fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('extracts key from an MCP-envelope tool_response and syncs without --delete', async () => {
    const json = JSON.stringify({
      hook_event_name: 'PostToolUse',
      tool_name: 'mcp__total-recall__store_memory',
      tool_input: { title: 'X', content: '...', tags: ['org'] },
      tool_response: { content: [{ type: 'text', text: JSON.stringify({ key: 'org/architecture/foo', message: 'stored' }) }] },
    });
    const r = runHook(json);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('{"continue":true}');
    const args = await waitForArgs();
    expect(args).not.toBeNull();
    expect(args!.key).toBe('org/architecture/foo');
    expect(args!.delete).toBe(false);
  });

  it('passes --delete when the tool is delete_memory', async () => {
    const json = JSON.stringify({
      tool_name: 'mcp__total-recall__delete_memory',
      tool_input: { key: 'org/architecture/bar' },
      tool_response: { content: [{ type: 'text', text: JSON.stringify({ key: 'org/architecture/bar', message: 'Memory deleted.' }) }] },
    });
    runHook(json);
    const args = await waitForArgs();
    expect(args).not.toBeNull();
    expect(args!.key).toBe('org/architecture/bar');
    expect(args!.delete).toBe(true);
  });

  it('forwards --force when delete_memory was called with force=true (no-prune teardown)', async () => {
    // A deliberate no-prune teardown (delete_memory force=true) must reach the .mjs
    // WITH --force, or the .mjs delete guard would refuse the very delete the user
    // authorized. The hook serializes tool_input.force (boolean) onto the \x1f
    // third field and appends --force only when it is true.
    const json = JSON.stringify({
      tool_name: 'mcp__total-recall__delete_memory',
      tool_input: { key: 'org/decisions/adr-1', force: true },
      tool_response: { content: [{ type: 'text', text: JSON.stringify({ key: 'org/decisions/adr-1', message: 'Memory deleted.' }) }] },
    });
    runHook(json);
    const args = await waitForArgs();
    expect(args).not.toBeNull();
    expect(args!.key).toBe('org/decisions/adr-1');
    expect(args!.delete).toBe(true);
    expect(args!.force).toBe(true);
  });

  it('does NOT forward --force when force is absent (refused delete stays force-less)', async () => {
    // The bypass direction: a refused (force-less) delete_memory must reach the .mjs
    // WITHOUT --force, so the .mjs no-prune guard fires. If the hook ever defaulted
    // force on, immortal org memories would be silently removed + pushed.
    const json = JSON.stringify({
      tool_name: 'mcp__total-recall__delete_memory',
      tool_input: { key: 'org/decisions/adr-2' },
      tool_response: { content: [{ type: 'text', text: 'deleted' }] },
    });
    runHook(json);
    const args = await waitForArgs();
    expect(args).not.toBeNull();
    expect(args!.delete).toBe(true);
    expect(args!.force).toBe(false);
  });

  it('handles an unwrapped tool_response object (no MCP content envelope)', async () => {
    const json = JSON.stringify({
      tool_name: 'mcp__total-recall__update_memory',
      tool_response: { key: 'org/architecture/baz', message: 'updated' },
    });
    runHook(json);
    const args = await waitForArgs();
    expect(args).not.toBeNull();
    expect(args!.key).toBe('org/architecture/baz');
    expect(args!.delete).toBe(false);
  });

  it('falls back to tool_input.key when the response carries no key', async () => {
    const json = JSON.stringify({
      tool_name: 'mcp__total-recall__delete_memory',
      tool_input: { key: 'org/architecture/qux' },
      tool_response: { content: [{ type: 'text', text: 'deleted' }] },
    });
    runHook(json);
    const args = await waitForArgs();
    expect(args).not.toBeNull();
    expect(args!.key).toBe('org/architecture/qux');
    expect(args!.delete).toBe(true);
  });

  it('does not consult the old "tool_result" field (regression guard)', async () => {
    // The old hook read a nonexistent "tool_result" field. With no tool_response and no
    // tool_input.key, the new hook must find nothing and short-circuit — proving it
    // depends on stdin + tool_response/tool_input, not the old field name.
    const json = JSON.stringify({
      tool_name: 'mcp__total-recall__store_memory',
      tool_result: { key: 'org/architecture/phantom' },
    });
    const r = runHook(json);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('{"continue":true}');
    const args = await waitForArgs(1500);
    expect(args).toBeNull();
  });

  it('short-circuits and still returns continue when no key can be extracted', async () => {
    const json = JSON.stringify({
      tool_name: 'mcp__total-recall__store_memory',
      tool_input: { title: 'X' },
      tool_response: { content: [{ type: 'text', text: JSON.stringify({ message: 'stored' }) }] },
    });
    const r = runHook(json);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('{"continue":true}');
    const args = await waitForArgs(1500);
    expect(args).toBeNull();
  });

  it('does NOT spawn the cjs git sync for a personal (non-org/) key (C1)', async () => {
    // A personal store returns a key NOT prefixed with org/; the hook must skip the
    // cjs org-vault sync entirely (it still rebuilds the cache, but the stub args
    // file proves the cjs was never invoked for this key).
    const json = JSON.stringify({
      hook_event_name: 'PostToolUse',
      tool_name: 'mcp__total-recall__store_memory',
      tool_input: { title: 'Personal', content: '...', tags: [] },
      tool_response: { content: [{ type: 'text', text: JSON.stringify({ key: 'knowledge/personal-note', message: 'stored' }) }] },
    });
    const r = runHook(json);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('{"continue":true}');
    const args = await waitForArgs(1500);
    expect(args).toBeNull();
  });
}, 60000);