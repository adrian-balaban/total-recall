/**
 * Integration tests — the "real process over real transport" layer.
 *
 * Unlike src/__tests__/index.test.ts (which mocks the MCP SDK transport and
 * calls the tool handlers in-process), these tests spawn the *built*
 * dist/index.js as a child process and talk to it over stdio using the real
 * MCP client. This verifies the JSON-RPC wire format, process startup, and
 * the full stack end-to-end.
 *
 * Requires a prior `npm run build` (dist/index.js must exist). Run via
 * `npm run test:integration`, which builds first.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const DIST = path.resolve(__dirname, '../../../dist/index.js');
const TEST_HOME = path.join(os.tmpdir(), `tr-integration-${process.pid}-${Date.now()}`);
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

  client = new Client({ name: 'tr-integration-test', version: '0.0.1' }, {});
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

describe('total-recall over real stdio', () => {
  it('exposes the 17 documented tools via list_tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t: any) => t.name).sort()).toEqual([
      'confirm_memory', 'delete_memories', 'delete_memory', 'export_memories',
      'get_memories_by_keys', 'get_related_memories', 'get_stats', 'get_timeline',
      'import_memories', 'list_memories', 'prune_memories', 'rebuild_index',
      'recall_memory', 'rerank_memories', 'search_index', 'store_memory', 'update_memory',
    ]);
  });

  it('stores a memory and recalls it back', async () => {
    const stored = json(
      await client.callTool({
        name: 'store_memory',
        arguments: {
          title: 'Integration Alpha',
          content: 'Round-tripped over real stdio transport.',
          tags: ['integration', 'test'],
          category: 'knowledge',
        },
      }),
    );
    expect(stored.key).toMatch(/^knowledge\//);
    expect(fs.existsSync(stored.filePath)).toBe(true);

    // TF-IDF inverted index is rebuilt on a debounce after store; force it so the
    // just-stored memory is searchable immediately (mirrors the component tests).
    await client.callTool({ name: 'rebuild_index', arguments: {} });

    const recalled = json(
      await client.callTool({
        name: 'recall_memory',
        arguments: { query: 'round-tripped stdio' },
      }),
    );
    expect(Array.isArray(recalled)).toBe(true);
    expect(recalled.length).toBeGreaterThan(0);
    expect(recalled[0].key).toBe(stored.key);
  });

  it('routes an org-tagged memory to the org vault path', async () => {
    const stored = json(
      await client.callTool({
        name: 'store_memory',
        arguments: {
          title: 'Org Decision',
          content: 'Team-wide decision via integration transport.',
          tags: ['org', 'team'],
          category: 'architecture',
        },
      }),
    );
    expect(stored.filePath).toContain(path.join('org', 'org-vault'));
  });

  it('search_index reflects newly stored memories', async () => {
    await client.callTool({
      name: 'store_memory',
      arguments: {
        title: 'Search Target Unique',
        content: 'A memory that should be discoverable via search_index.',
        tags: ['searchable'],
        category: 'knowledge',
      },
    });
    await client.callTool({ name: 'rebuild_index', arguments: {} });

    const found = json(
      await client.callTool({
        name: 'search_index',
        arguments: { query: 'search target unique' },
      }),
    );
    expect(Array.isArray(found)).toBe(true);
    expect(found.some((r: any) => /search-target-unique/.test(r.key))).toBe(true);
  });

  it('rejects a duplicate key when force is not set', async () => {
    const args = {
      title: 'Dup Memory',
      content: 'First write.',
      tags: ['dup'],
      category: 'knowledge',
    };
    const first = await client.callTool({ name: 'store_memory', arguments: args });
    expect(first.isError).toBeFalsy();
    const second = await client.callTool({ name: 'store_memory', arguments: args });
    expect(second.isError).toBe(true);
    expect(text(second)).toContain('already exists');
  });

  it('get_stats reports a non-empty vault', async () => {
    const stats = json(await client.callTool({ name: 'get_stats', arguments: {} }));
    expect(stats.total).toBeGreaterThan(0);
  });

  it('list_memories returns the stored entries', async () => {
    // list_memories returns { items, total, hasMore } (src/tools/query.ts), NOT a
    // bare array — a stale `Array.isArray(listed)` assertion documented the wrong
    // shape and has been failing since the handler moved to the paginated object.
    const listed = json(await client.callTool({ name: 'list_memories', arguments: {} }));
    expect(listed.total).toBeGreaterThan(0);
    expect(Array.isArray(listed.items)).toBe(true);
    expect(listed.items.length).toBeGreaterThan(0);
  });

  // #26: the security guards (org author protection, path-traversal category
  // rejection, mutual-exclusion of personal/org tags) were only exercised in the
  // mocked-transport index.test.ts, never over the real stdio wire. A dispatch
  // regression specific to the real server path (e.g. the CallTool catch swallowing
  // the throw shape, or isError not propagating over stdio) would slip past those
  // mocked tests. These three cases exercise each guard end-to-end through the
  // real MCP client → server → handler → thrown Error → isError response path.

  it('org author guard: store_memory(force) on another author\'s org memory is rejected over stdio', async () => {
    // Pre-seed an org memory authored by a foreign user. The guard compares
    // existingFm.author against os.userInfo().username (the real OS user running
    // this test), which is not 'other-user', so force=true must still be refused.
    const orgArch = path.join(VAULT, 'org', 'org-vault', 'architecture');
    fs.mkdirSync(orgArch, { recursive: true });
    fs.writeFileSync(
      path.join(orgArch, 'guarded-org.md'),
      '---\ntitle: "Guarded Org"\nauthor: other-user\ntags: [org]\n' +
      'created: 2026-01-01T00:00:00Z\nupdated: 2026-01-01T00:00:00Z\nimportanceScore: 0.5\n---\n\nBody.\n',
    );
    const res = await client.callTool({
      name: 'store_memory',
      arguments: {
        title: 'Guarded Org',
        content: 'Attempted takeover.',
        tags: ['org'],
        category: 'architecture',
        force: true,
      },
    });
    expect(res.isError).toBe(true);
    // The error surfaces the foreign author so the caller knows whose memory it is.
    expect(text(res)).toContain('other-user');
    // And the original body was NOT overwritten.
    expect(fs.readFileSync(path.join(orgArch, 'guarded-org.md'), 'utf8')).toContain('Body.');
  });

  it('path-traversal category is rejected over stdio', async () => {
    const res = await client.callTool({
      name: 'store_memory',
      arguments: {
        title: 'Traversal',
        content: 'Should not escape the vault.',
        tags: ['traversal'],
        category: '../../../tmp',
      },
    });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('resolves outside the vault');
  });

  it('mutually-exclusive org+personal tags are rejected over stdio', async () => {
    const res = await client.callTool({
      name: 'store_memory',
      arguments: {
        title: 'MutEx Tags',
        content: 'A memory cannot be both org and personal.',
        tags: ['org', 'personal'],
        category: 'knowledge',
      },
    });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("both 'org' and 'personal'");
  });
});