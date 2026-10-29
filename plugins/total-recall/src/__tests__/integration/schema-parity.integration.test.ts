/**
 * Schema-parity gate for the 6.1-6.3 McpServer migration.
 *
 * The plugin migrated its MCP server from the deprecated low-level
 * `Server` + `setRequestHandler(ListTools/CallTool)` to the high-level
 * `McpServer` + `registerTool(name, {description, inputSchema: <Zod raw shape>}, cb)`.
 * The risk the plan flags: "Zod->JSON-Schema can subtly shift
 * default/minimum/maximum rendering." This test is the gate that proves the
 * migration did NOT change the schema consumers see.
 *
 * It spawns the built dist/index.js over stdio with the real MCP Client,
 * calls client.listTools(), and diff-compares every tool's rendered schema
 * against the pre-migration hand-written golden snapshot at
 * src/__tests__/integration/__fixtures__/tools-list-golden.json (17 tools,
 * the "before").
 *
 * Two cosmetic, semantically-equivalent Zod-rendering quirks are normalized
 * away before comparing:
 *  (a) `$schema: "http://json-schema.org/draft-07/schema#"` is added to every
 *      tool's inputSchema by the SDK's `toJsonSchemaCompat` converter. The
 *      hand-written golden omitted it. This is a meta-key declaring the draft;
 *      it has NO validation effect.
 *  (b) `import_memories.memories` array: the golden is
 *      `{type:'array', description:...}` (no `items`); the Zod-rendered is
 *      `{type:'array', items:{}, description:...}`. In JSON-Schema, omitted
 *      `items` AND `items:{}` both mean "any item allowed" - semantically
 *      identical.
 *
 * The golden describes the server with the spec-driven features OFF
 * (`specDriven.enabled: false`), which must be exactly the pre-spec tool list.
 * A second block starts the server with the defaults (features ON) and pins the
 * documented additive delta: five more tools, and optional spec fields on
 * store_memory / update_memory / recall_memory / search_index.
 *
 * Any OTHER diff (dropped `default`, shifted `minimum`/`maximum`, added
 * `additionalProperties`, changed `required`, added/removed properties) is a
 * REAL regression that this test catches and fails on. An explicit guard
 * below also walks every rendered inputSchema and asserts none contains
 * `additionalProperties` (the most dangerous regression - it would reject
 * extra args at the client).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import golden from './__fixtures__/tools-list-golden.json';

const DIST = path.resolve(__dirname, '../../../dist/index.js');
const TEST_HOME = path.join(os.tmpdir(), `tr-integration-${process.pid}-${Date.now()}`);
const VAULT = path.join(TEST_HOME, '.total-recall');

let client: Client;
let transport: StdioClientTransport;
let childPid: number | undefined;

// No text()/json() helpers here (unlike server.integration.test.ts): the parity
// test reads `client.listTools().tools` directly, not a CallToolResult content
// array, so the content-parsing helpers from the template would be dead code.

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
  // The golden is the pre-spec tool list: start this server with the spec-driven features off.
  fs.writeFileSync(path.join(VAULT, 'config.json'), JSON.stringify({ specDriven: { enabled: false } }));

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

  client = new Client({ name: 'tr-schema-parity-test', version: '0.0.1' }, {});
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

// Deep-normalize a JSON-Schema value for key-order-independent comparison.
// Recursively sorts object keys (so JSON-Schema property order doesn't matter)
// and applies the two documented semantically-equivalent Zod-rendering quirks:
//   (a) delete any `$schema` key — the SDK's toJsonSchemaCompat adds the
//       draft-07 meta-key; it declares the schema dialect and has zero
//       validation effect, so stripping it is lossless.
//   (b) delete an `items` key whose value is the empty object `{}` — in
//       JSON-Schema, omitted `items` and `items: {}` both mean "any item
//       allowed", so the two forms are interchangeable.
function normalize(node: any): any {
  if (Array.isArray(node)) {
    return node.map(normalize);
  }
  if (node && typeof node === 'object') {
    const out: Record<string, any> = {};
    for (const key of Object.keys(node).sort()) {
      // (a) $schema meta-key has no validation effect; golden omits it.
      if (key === '$schema') continue;
      const v = node[key];
      // (b) items:{} ≡ omitted items (both = "any item allowed").
      if (key === 'items' && v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) {
        continue;
      }
      out[key] = normalize(v);
    }
    return out;
  }
  return node;
}

// Walk a rendered inputSchema and return true if any node carries an
// `additionalProperties` key. The migration must NOT introduce one: the
// hand-written golden never set it, and adding `additionalProperties: false`
// would make clients reject extra args — a behavioral change, not cosmetic.
function containsAdditionalProperties(node: any): boolean {
  if (Array.isArray(node)) {
    return node.some(containsAdditionalProperties);
  }
  if (node && typeof node === 'object') {
    if ('additionalProperties' in node) return true;
    return Object.values(node).some(containsAdditionalProperties);
  }
  return false;
}

describe('schema parity: McpServer migration (6.1-6.3) vs pre-migration golden', () => {
  it('[TR-C1] renders all 17 tool schemas identical to the golden after normalization', async () => {
    const { tools } = await client.listTools();

    // Sanity guard independent of per-tool equality: the exact 17-name set.
    const afterNames = tools.map((t: any) => t.name).sort();
    const goldenNames = (golden.tools as Array<{ name: string }>).map((t) => t.name).sort();
    expect(afterNames).toEqual(goldenNames);

    const afterMap = new Map<string, any>(tools.map((t: any) => [t.name, t]));
    const goldenMap = new Map<string, any>(
      (golden.tools as Array<{ name: string; description: string; inputSchema: any }>).map((t) => [
        t.name,
        t,
      ]),
    );

    // Per-tool equality, loop keyed by name so a failure reports WHICH tool.
    for (const name of goldenNames) {
      const g = goldenMap.get(name);
      const a = afterMap.get(name);
      expect(a, `tool ${name} present in listTools output`).toBeDefined();
      expect(a.description, `tool ${name} description`).toBe(g.description);
      expect(
        normalize(a.inputSchema),
        `tool ${name} inputSchema (after normalization)`,
      ).toEqual(normalize(g.inputSchema));
    }
  });

  it('does NOT introduce additionalProperties on any rendered inputSchema', async () => {
    const { tools } = await client.listTools();
    for (const t of tools as Array<{ name: string; inputSchema: any }>) {
      expect(
        containsAdditionalProperties(t.inputSchema),
        `tool ${t.name} must not render additionalProperties`,
      ).toBe(false);
    }
  });
});

// ─── Spec-driven features ON (the default config) ─────────────────────────────

const SPEC_TOOLS = ['index_architecture', 'get_architecture_context', 'trace', 'get_architecture_history', 'validate_architecture'];
const SPEC_FIELDS = ['system', 'artifact', 'elements', 'requirements', 'sourcePath', 'sourceRev', 'status', 'supersedes'];
const ADDITIVE: Record<string, string[]> = {
  store_memory: SPEC_FIELDS,
  update_memory: SPEC_FIELDS,
  recall_memory: ['elements'],
  search_index: ['elements'],
};

describe('schema parity with specDriven on (default config): only the documented additive delta', () => {
  const home = path.join(os.tmpdir(), `tr-integration-spec-${process.pid}-${Date.now()}`);
  let specClient: Client;
  let specTransport: StdioClientTransport;

  beforeAll(async () => {
    fs.mkdirSync(path.join(home, '.total-recall', 'personal-vault'), { recursive: true });
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') env[k] = v;
    env.HOME = home;
    specTransport = new StdioClientTransport({ command: 'node', args: [DIST], env, stderr: 'inherit' });
    specClient = new Client({ name: 'tr-schema-parity-spec', version: '0.0.1' }, {});
    await specClient.connect(specTransport);
  }, 30_000);

  afterAll(async () => {
    try { await specClient?.close(); } catch { /* already gone */ }
    fs.rmSync(home, { recursive: true, force: true });
  }, 30_000);

  it('lists the 17 golden tools plus the five spec-driven tools', async () => {
    const { tools } = await specClient.listTools();
    const goldenNames = (golden.tools as Array<{ name: string }>).map((t) => t.name);
    expect(tools.map((t: any) => t.name).sort()).toEqual([...goldenNames, ...SPEC_TOOLS].sort());
  });

  it('[TR-C1] core tool schemas equal the golden once the optional spec fields are removed, and those fields are optional', async () => {
    const { tools } = await specClient.listTools();
    for (const g of golden.tools as Array<{ name: string; description: string; inputSchema: any }>) {
      const a: any = tools.find((t: any) => t.name === g.name);
      const extra = ADDITIVE[g.name] ?? [];
      const props = { ...a.inputSchema.properties };
      for (const f of extra) {
        expect(props[f], `${g.name}.${f} advertised`).toBeDefined();
        expect(a.inputSchema.required ?? [], `${g.name}.${f} optional`).not.toContain(f);
        delete props[f];
      }
      expect(normalize({ ...a.inputSchema, properties: props }), `tool ${g.name}`).toEqual(normalize(g.inputSchema));
      expect(containsAdditionalProperties(a.inputSchema)).toBe(false);
    }
  });

  it('the server instructions count 22 tools', () => {
    expect(specClient.getInstructions()).toMatch(/\(22 tools\)/);
  });
});
