/**
 * Integration tests pinning the 6.2 boundary-enforcement contract of the
 * 6.1-6.3 McpServer migration.
 *
 * What this pins
 * ──────────────
 * The plugin migrated its MCP server from the deprecated low-level
 * `Server` + `setRequestHandler(CallTool)` to the high-level `McpServer` +
 * `registerTool(name, {description, inputSchema: <Zod raw shape>}, cb)`.
 * The key win (6.2): `McpServer.registerTool` runs `Zod.safeParse` on the
 * caller's `arguments` BEFORE the registered handler runs, so a malformed
 * call (wrong type for a declared field) is rejected at the dispatch
 * boundary with a parse-error `CallToolResult` (isError: true, content text
 * beginning `"MCP error -32602: Input validation error: Invalid arguments
 * for tool <name>:"` + a JSON-encoded Zod issue array). The handler is
 * never reached for such a call.
 *
 * This closes the "T3 scalar-tags class" at the dispatch boundary, NOT
 * inside the handler. The `update_memory` handler still carries DEFENSIVE
 * lenient coercion for a scalar `tags` arg (a non-array `tags` is ignored
 * and the existing tags are kept, instead of being wiped to `[]`), because
 * the handler is also called directly by `import_memories`'s round-trip
 * and by unit tests — neither of which routes through the Zod boundary.
 * That leniency must be UNREACHABLE via real MCP: over the stdio wire, a
 * scalar `tags` must be REJECTED by safeParse before the handler runs.
 * This file pins that contract end-to-end over the real stdio transport.
 *
 * Ground truth for the response shape was captured by spawning dist/index.js
 * over stdio and sending malformed calls — see the per-case comments below.
 *
 * Requires a prior `npm run build` (dist/index.js must exist). Run via
 * `npx vitest run --config vitest.integration.config.ts
 *   src/__tests__/integration/boundary-enforcement.integration.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const DIST = path.resolve(__dirname, '../../../dist/index.js');
const TEST_HOME = path.join(os.tmpdir(), `tr-boundary-${process.pid}-${Date.now()}`);
const VAULT = path.join(TEST_HOME, '.total-recall');

let client: Client;
let transport: StdioClientTransport;
let childPid: number | undefined;

function text(res: any): string {
  return (res.content as Array<{ type: string; text?: string }>)
    .map((c) => c.text ?? '')
    .join('');
}

function json(res: any): any {
  return JSON.parse(text(res));
}

beforeAll(async () => {
  // Sanity: the build must have produced dist/index.js.
  if (!fs.existsSync(DIST)) {
    throw new Error(
      `dist/index.js not found at ${DIST}. Run "npm run build" before the integration suite.`,
    );
  }
  fs.mkdirSync(path.join(VAULT, 'personal-vault', 'knowledge'), { recursive: true });
  fs.mkdirSync(path.join(VAULT, 'org', 'org-vault'), { recursive: true });
  // Org-config guard (store.ts orgVaultConfigured): an org-tagged store is refused
  // unless EITHER ~/.total-recall/config.json has orgRepo OR ~/.total-recall/org/.git
  // exists (a cloned org vault). The integration transport must exercise the org
  // route end-to-end, so provision a stub `.git` dir — the guard only checks
  // existence, and store_memory itself does no git/network work (the PostToolUse
  // sync hook does, and isn't in scope here). Without this the org-store test
  // fails with "Org vault is not configured" before the route is even taken.
  fs.mkdirSync(path.join(VAULT, 'org', '.git'), { recursive: true });

  // StdioClientParameters.env is Record<string, string>; strip undefined values.
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') env[k] = v;
  }
  env.HOME = TEST_HOME;

  transport = new StdioClientTransport({
    command: 'node',
    args: [DIST],
    env,
    stderr: 'inherit', // startup crashes visible in test output; avoids pipe-buffer deadlock
  });

  client = new Client({ name: 'tr-boundary-test', version: '0.0.1' }, {});
  await client.connect(transport);
  childPid = transport.pid ?? undefined;
}, 30_000);

afterAll(async () => {
  try {
    await client?.close();
  } catch {
    /* ignore — process may already be gone */
  }
  if (childPid) {
    try {
      process.kill(childPid, 'SIGKILL');
    } catch {
      /* already dead */
    }
  }
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
}, 30_000);

// Helper: assert a callTool result is a Zod-boundary rejection with the
// expected field name in the error text. The MCP SDK returns a CallToolResult
// with isError: true and content[0].text = "MCP error -32602: Input
// validation error: Invalid arguments for tool <name>: ..." — it does NOT
// throw. The Zod issue array embedded in the text contains `"path": ["<field>"]`
// and `"expected": "<type>"`, so a substring check on the field name is a
// faithful proxy for "the rejection was about this field."
function assertBoundaryRejection(res: any, field: string): void {
  expect(res.isError).toBe(true);
  expect(text(res)).toContain('Input validation error');
  expect(text(res)).toContain(field);
}

describe('6.2 boundary enforcement: safeParse rejects malformed arguments before the handler runs', () => {
  // Seed one memory so update_memory has a target key to target. The exact
  // content doesn't matter — only that the key exists, so the scalar-tags
  // rejection is provably about the type mismatch, not a missing-key error.
  let seededKey: string;

  it('seeds a memory for the update_memory target', async () => {
    const stored = json(
      await client.callTool({
        name: 'store_memory',
        arguments: {
          title: 'Boundary Target',
          content: 'Seeded so update_memory has a key to target.',
          tags: ['boundary'],
          category: 'knowledge',
        },
      }),
    );
    expect(stored.key).toMatch(/^knowledge\//);
    seededKey = stored.key;
  });

  // The update_memory handler has DEFENSIVE lenient coercion for a scalar
  // `tags` arg: it keeps the existing tags instead of wiping to `[]`. That
  // leniency exists for the INTERNAL path (import_memories round-trip +
  // unit tests) and must NOT be reachable via MCP — over the real stdio
  // wire, safeParse rejects a scalar `tags` before the handler runs, so the
  // lenient branch is unreachable here. This test pins that rejection.
  it('update_memory rejects a scalar tags arg at the Zod boundary (handler leniency unreachable via MCP)', async () => {
    const res = await client.callTool({
      name: 'update_memory',
      arguments: { key: seededKey, tags: 'not-an-array' },
    });
    assertBoundaryRejection(res, 'tags');
    // The Zod issue for an array-expected field reports expected "array".
    expect(text(res)).toContain('"expected": "array"');
  });

  // store_memory also declares `tags` as an array in its Zod raw shape, so
  // a scalar tags arg is rejected at the boundary before store.ts runs.
  it('store_memory rejects a scalar tags arg at the Zod boundary', async () => {
    const res = await client.callTool({
      name: 'store_memory',
      arguments: { title: 'T', content: 'c', tags: 'scalar' },
    });
    assertBoundaryRejection(res, 'tags');
    expect(text(res)).toContain('"expected": "array"');
  });

  // recall_memory declares `limit` as a number; a string is rejected at the
  // boundary before recall.ts runs.
  it('recall_memory rejects a non-numeric limit arg at the Zod boundary', async () => {
    const res = await client.callTool({
      name: 'recall_memory',
      arguments: { query: 'x', limit: 'abc' },
    });
    assertBoundaryRejection(res, 'limit');
    expect(text(res)).toContain('"expected": "number"');
  });

  // get_memories_by_keys declares `keys` as an array; a scalar is rejected
  // at the boundary before query.ts runs.
  it('get_memories_by_keys rejects a scalar keys arg at the Zod boundary', async () => {
    const res = await client.callTool({
      name: 'get_memories_by_keys',
      arguments: { keys: 'not-an-array' },
    });
    assertBoundaryRejection(res, 'keys');
    expect(text(res)).toContain('"expected": "array"');
  });

  // NEGATIVE CASE — a negative numeric limit must NOT be rejected.
  // The Zod raw shape for `limit` is `z.number().optional()` with NO `.min(0)`,
  // so a negative number PASSES safeParse and the handler clamps it (recall.ts
  // treats a non-positive limit as "return everything"/no cap). The hand-written
  // golden schema that predated the migration also had no minimum on `limit`,
  // so this is NOT a boundary rejection — and asserting otherwise would be a
  // false test pinning a contract the code does not uphold. We assert the call
  // succeeds (isError falsy) and returns an array, which is the real behavior.
  it('recall_memory does NOT reject a negative numeric limit (no .min(0) on the Zod shape; handler clamps)', async () => {
    const res = await client.callTool({
      name: 'recall_memory',
      arguments: { query: 'x', limit: -5 },
    });
    expect(res.isError).toBeFalsy();
    // The handler returns an array of results (possibly empty for a no-match
    // query) — the point is it returned normally, not via a boundary rejection.
    expect(Array.isArray(json(res))).toBe(true);
  });
});