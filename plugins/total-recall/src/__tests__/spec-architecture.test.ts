import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';

vi.hoisted(() => {
  process.env.HOME = '/tmp/tr-spec-arch-' + process.pid;
});

import { indexArchitecture, validateArchitecture, register } from '../tools/architecture.js';
import { storeMemory } from '../tools/store.js';
import { recallMemory, searchIndex } from '../tools/recall.js';
import { getRelatedMemories } from '../tools/query.js';
import { architectureContext, trace, architectureHistory, indexKey } from '../spec/context.js';
import { parseSpecConfig } from '../spec/config.js';
import { memIndex } from '../state.js';
import { rebuildInvertedIndex } from '../tfidf.js';

const TR = path.join(process.env.HOME!, '.total-recall');
const PROJECT = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-spec-project-'));
const BIN = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-spec-bin-'));
const HAS_GIT = spawnSync('git', ['--version']).status === 0;

const ADL = `DEFINE SYSTEM Shop AS shop
    DEFINE DOMAIN Orders AS orders
        DEFINE COMPONENT Order Api AS api
    DEFINE DATABASE Order Store AS order-store

ASSERT(Order Api is the only writer of Order Store) # [SHOP-1]
ASSERT(Order Api has no dependency on Payments) # [SHOP-2]
`;
const CALM = {
  nodes: [
    { 'unique-id': 'order-api', 'node-type': 'service', name: 'Order API', description: 'd' },
    { 'unique-id': 'order-db', 'node-type': 'database', name: 'Order DB', description: 'd',
      controls: { encryption: { description: 'Encrypted at rest', requirements: [] } } },
  ],
  relationships: [
    { 'unique-id': 'api-db', 'relationship-type': { connects: { source: { node: 'order-api' }, destination: { node: 'order-db' } } } },
  ],
};

function write(rel: string, text: string) {
  const p = path.join(PROJECT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}

function git(...args: string[]) {
  spawnSync('git', args, { cwd: PROJECT, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } });
}

// A stand-in `calm` CLI: valid unless the document mentions "ghost".
function fakeCalm() {
  const p = path.join(BIN, 'calm');
  fs.writeFileSync(p, `#!/usr/bin/env node
const fs = require('fs');
const doc = fs.readFileSync(process.argv[process.argv.indexOf('-a') + 1], 'utf8');
const bad = doc.includes('ghost');
console.log(JSON.stringify({ jsonSchemaValidationOutputs: [], spectralSchemaValidationOutputs: bad
  ? [{ severity: 'error', message: "'ghost' does not refer to an existing node", path: '/relationships/api-db/relationship-type' }] : [],
  hasErrors: bad }));
process.exit(bad ? 1 : 0);
`);
  fs.chmodSync(p, 0o755);
}

beforeAll(() => {
  write('arch/shop.adl', ADL);
  write('arch/shop.calm.json', JSON.stringify(CALM));
  write('src/order.test.ts', "it('[SHOP-1] only the api writes the store', () => {});\n");
  write('node_modules/x/ignored.adl', 'DEFINE SYSTEM Ignored AS ignored\n');
  if (HAS_GIT) { git('init', '-q'); git('add', '.'); git('commit', '-q', '-m', 'init'); }
  fakeCalm();
  process.env.PATH = `${BIN}${path.delimiter}${process.env.PATH}`;
  for (const k of Object.keys(memIndex)) delete memIndex[k];
  fs.rmSync(TR, { recursive: true, force: true });
  fs.mkdirSync(path.join(TR, 'personal-vault'), { recursive: true });
});

afterAll(() => {
  fs.rmSync(TR, { recursive: true, force: true });
  fs.rmSync(PROJECT, { recursive: true, force: true });
  fs.rmSync(BIN, { recursive: true, force: true });
});

describe('index_architecture', () => {
  it('stores one index memory per system with elements, assertions, controls and linked tests', () => {
    const res = indexArchitecture({ path: PROJECT });
    expect(res.systems).toHaveLength(1);
    expect(res.systems[0]).toMatchObject({ system: 'shop', status: 'created', files: 2 });
    const meta = memIndex[indexKey('shop')]!;
    expect(meta.system).toBe('shop');
    expect(meta.elements).toEqual(expect.arrayContaining(['adl:orders.api', 'adl:order-store', 'calm:order-db', 'assert:SHOP-1']));
    expect(meta.sourcePath).toBe('.');
    if (HAS_GIT) expect(meta.sourceRev).toMatch(/^[0-9a-f]{40}$/);
    const body = fs.readFileSync(meta.filePath, 'utf8');
    expect(body).not.toContain('Order Api is the only writer of Order Store) # [SHOP-1]'); // a summary, not a copy
    expect(body).not.toContain('Ignored');                                               // node_modules skipped
  });

  it('re-indexing an unchanged project writes nothing', () => {
    const file = memIndex[indexKey('shop')]!.filePath;
    const before = fs.statSync(file).mtimeMs;
    const res = indexArchitecture({ path: PROJECT });
    expect(res.systems[0].status).toBe('unchanged');
    expect(res.next).toBeUndefined();
    expect(fs.statSync(file).mtimeMs).toBe(before);
  });

  it('reports what was added and removed when a file changes, and asks for the reason', () => {
    write('arch/shop.adl', ADL.replace('# [SHOP-2]', '# [SHOP-3]'));
    const res = indexArchitecture({ path: PROJECT });
    expect(res.systems[0]).toMatchObject({ status: 'updated', added: ['assert:SHOP-3'], removed: ['assert:SHOP-2'] });
    expect(res.next).toMatch(/architecture-changes/);
    write('arch/shop.adl', ADL);
    indexArchitecture({ path: PROJECT });
  });

  it('rejects a path that is not a directory', () => {
    expect(() => indexArchitecture({ path: path.join(PROJECT, 'nope') })).toThrow(/Not a directory/);
  });
});

describe('architecture retrieval', () => {
  beforeAll(() => {
    storeMemory({
      title: 'Encrypt the order database', content: 'Chose disk encryption because of PCI.', category: 'decisions',
      system: 'shop', artifact: 'adr', status: 'accepted', elements: ['calm:order-db'], requirements: ['REQ-7'],
    });
    storeMemory({
      title: 'Why order store moved', content: 'Split the store out of the API.', category: 'architecture-changes',
      system: 'shop', elements: ['adl:order-store'],
    });
  });

  it('get_architecture_context for a CALM node returns its control, decision and relationships', () => {
    const ctx: any = architectureContext({ system: 'shop', element: 'calm:order-db' }, { guardrails: true });
    expect(ctx.found).toBe(true);
    expect(ctx.controls).toEqual([{ owner: 'calm:order-db', name: 'encryption', description: 'Encrypted at rest' }]);
    expect(ctx.relationships.map((r: any) => r.id)).toEqual(['calm:api-db']);
    expect(ctx.decisions.map((d: any) => d.title)).toEqual(['Encrypt the order database']);
    expect(ctx.guardrails).toEqual([]);
  });

  it('get_architecture_context for an ADL component returns the rules about it, with their tests', () => {
    const ctx: any = architectureContext({ system: 'shop', element: 'adl:orders.api' }, { guardrails: false });
    expect(ctx.rules.map((r: any) => r.id)).toEqual(['SHOP-1', 'SHOP-2']);
    expect(ctx.rules[0].tests[0]).toMatch(/^src\/order\.test\.ts:1 /);
    expect(ctx.guardrails).toBeUndefined();
  });

  it('the system summary lists untested assertions and recent decisions and changes', () => {
    const ctx: any = architectureContext({ system: 'shop' }, { guardrails: false });
    expect(ctx.assertionsWithoutTests).toEqual(['SHOP-2']);
    expect(ctx.recentDecisions).toHaveLength(1);
    expect(ctx.recentChanges.map((c: any) => c.title)).toEqual(['Why order store moved']);
  });

  it('an unknown system names the indexed ones', () => {
    expect(() => architectureContext({ system: 'nope' }, { guardrails: false })).toThrow(/Indexed systems: shop/);
  });

  it('trace follows a requirement to its element, controls and decisions; and an assertion to its tests', () => {
    const t: any = trace({ id: 'REQ-7' });
    expect(t.requirements.map((r: any) => r.title)).toEqual(['Encrypt the order database']);
    expect(t.controls.map((c: any) => c.name)).toEqual(['encryption']);
    const a: any = trace({ id: 'SHOP-1' });
    expect(a.assertions[0].tests).toHaveLength(1);
    expect(trace({ id: 'SHOP-2' }).untested).toEqual(['SHOP-2']);
  });

  it('get_architecture_history lists changes in time order, filtered by element', () => {
    const h: any = architectureHistory({ system: 'shop', element: 'adl:order-store' });
    expect(h.changes.map((c: any) => c.title)).toEqual(['Why order store moved']);
    expect(architectureHistory({ system: 'shop', element: 'calm:order-api' }).changes).toEqual([]);
    expect(h.indexRebuilds.length).toBeGreaterThanOrEqual(1);
  });

  it('recall_memory and search_index filter by element; related memories share elements', async () => {
    rebuildInvertedIndex();
    const hits = await recallMemory({ query: 'order', hybrid: false, elements: ['calm:order-db'] });
    // the architecture index carries every element, so it matches as well
    expect(hits.map((h: any) => h.title).sort()).toEqual(['Architecture index: shop', 'Encrypt the order database']);
    const idx = searchIndex({ query: 'order', elements: ['adl:order-store'] });
    expect(idx.map((h: any) => h.title)).toContain('Why order store moved');
    expect(idx.map((h: any) => h.title)).not.toContain('Encrypt the order database');
    const other = storeMemory({ title: 'Order DB backups', content: 'Nightly.', category: 'knowledge', elements: ['calm:order-db'] });
    const rel = getRelatedMemories({ key: other.key });
    expect(rel.map((r: any) => r.title)).toContain('Encrypt the order database');
  });
});

describe('validate_architecture', () => {
  it('stores a failure for an untested assertion and a broken CALM file, then resolves them when they pass', () => {
    write('arch/shop.calm.json', JSON.stringify(CALM).replace('"order-db"}}', '"ghost"}}'));
    const first: any = validateArchitecture({ path: PROJECT });
    expect(first.ok).toBe(false);
    expect(first.calm).toMatch(/validated with .*calm/);
    const failed = first.systems[0].failed.map((f: any) => f.check).sort();
    expect(failed).toEqual(['adl-coverage:SHOP-2', 'calm:arch/shop.calm.json']);
    const calmFail = Object.values(memIndex).find((m) => m.artifact === 'fitness-result' && m.elements?.includes('calm:api-db'))!;
    expect(calmFail.status).toBe('failed');

    const again: any = validateArchitecture({ path: PROJECT });
    expect(again.systems[0].recorded.map((r: any) => r.recorded)).toEqual(['failed-again', 'failed-again']);

    write('arch/shop.calm.json', JSON.stringify(CALM));
    write('src/payments.test.ts', "it('[SHOP-2] api does not import payments', () => {});\n");
    const fixed: any = validateArchitecture({ path: PROJECT, resolvedBy: 'decisions/encrypt-the-order-database' });
    expect(fixed.ok).toBe(true);
    expect(fixed.systems[0].recorded.map((r: any) => r.recorded)).toEqual(['resolved', 'resolved']);
    const body = fs.readFileSync(calmFail.filePath, 'utf8');
    expect(body).toMatch(/status: resolved/);
    expect(body).toContain('Resolved by decision `decisions/encrypt-the-order-database`');
  });

  it('without a calm binary and without allowNpx, reports the CLI as unavailable and still checks ADL coverage', () => {
    const saved = process.env.PATH;
    process.env.PATH = path.dirname(process.execPath);
    try {
      const res: any = validateArchitecture({ path: PROJECT, record: false });
      expect(res.calm).toMatch(/CALM CLI not available.*npm install -g @finos\/calm-cli@1\.66\.0/);
      expect(res.systems[0].passed).toBe(2);
    } finally { process.env.PATH = saved; }
  });
});

describe('tool registration follows specDriven.tools', () => {
  function names(spec: unknown): string[] {
    const got: string[] = [];
    register({ registerTool: (n: string) => got.push(n) } as never, parseSpecConfig(spec));
    return got;
  }
  it('registers all five by default, the listed ones, or none', () => {
    expect(names(undefined)).toEqual(['index_architecture', 'get_architecture_context', 'trace', 'get_architecture_history', 'validate_architecture']);
    expect(names({ tools: ['trace'] })).toEqual(['trace']);
    expect(names({ enabled: false })).toEqual([]);
  });
});
