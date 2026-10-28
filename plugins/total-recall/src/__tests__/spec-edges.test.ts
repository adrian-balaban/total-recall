import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.hoisted(() => {
  process.env.HOME = '/tmp/tr-spec-edges-' + process.pid;
});

import { indexArchitecture } from '../tools/architecture.js';
import { storeMemory } from '../tools/store.js';
import { architectureContext, trace, architectureHistory } from '../spec/context.js';
import { scanProject, buildModels, renderModel, parseModelFromBody } from '../spec/indexer.js';
import { parseSpecConfig } from '../spec/config.js';
import { memIndex } from '../state.js';

const TR = path.join(process.env.HOME!, '.total-recall');
const cfg = parseSpecConfig(undefined);
const dirs: string[] = [];
const tmp = (p: string) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); dirs.push(d); return d; };
function write(root: string, rel: string, text: string) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

beforeAll(() => {
  for (const k of Object.keys(memIndex)) delete memIndex[k];
  fs.rmSync(TR, { recursive: true, force: true });
  fs.mkdirSync(path.join(TR, 'personal-vault'), { recursive: true });
});
afterAll(() => {
  fs.rmSync(TR, { recursive: true, force: true });
  for (const d of dirs) { try { fs.chmodSync(path.join(d, 'locked'), 0o755); } catch { /* may not exist */ } fs.rmSync(d, { recursive: true, force: true }); }
});

describe('scanProject / buildModels edge cases', () => {
  it('skips a subdirectory it cannot read', { skip: isRoot }, () => {
    const d = tmp('tr-scan-lock-');
    write(d, 'ok/a.adl', 'DEFINE SYSTEM A AS a\n');
    write(d, 'locked/b.adl', 'DEFINE SYSTEM B AS b\n');
    fs.chmodSync(path.join(d, 'locked'), 0o000);
    const res = scanProject(d, cfg);
    expect(res.adl.map((p) => path.basename(p))).toEqual(['a.adl']);
    expect(res.truncated).toBe(false);
  });

  it('stops at 5000 entries and flags the scan as truncated', () => {
    const d = tmp('tr-scan-many-');
    fs.mkdirSync(path.join(d, 'files'));
    for (let i = 0; i < 5001; i++) fs.writeFileSync(path.join(d, 'files', `f${i}.txt`), '');
    const res = scanProject(d, cfg);
    expect(res.truncated).toBe(true);
  });

  it('records an ADL file over 1 MB as unreadable instead of parsing it', () => {
    const d = tmp('tr-big-adl-');
    write(d, 'big.adl', 'DEFINE SYSTEM Big AS big\n' + '# pad\n'.repeat(200_000));
    write(d, 'ok.adl', 'DEFINE SYSTEM Big AS big\n    DEFINE COMPONENT Api AS api\n');
    const models = buildModels(d, cfg, (p) => path.relative(d, p));
    // The unreadable file can't name its system, so it lands in a fallback model
    // (the directory's slug); the readable one forms the real "big" system.
    const files = models.flatMap((m) => m.files);
    expect(files.find((f) => f.path === 'big.adl')!.error).toMatch(/unreadable or larger than 1 MB/);
    expect(files.find((f) => f.path === 'ok.adl')!.error).toBeUndefined();
    expect(models.find((m) => m.system === 'big')!.elements.map((e) => e.id)).toEqual(['adl:api']);
  });

  it('ignores an empty test file and a test ID that no assertion carries', () => {
    const d = tmp('tr-empty-test-');
    write(d, 'a.adl', 'DEFINE SYSTEM A AS a\nASSERT(x holds) # [A-1]\n');
    write(d, 'src/empty.test.ts', '');
    write(d, 'src/other.test.ts', "it('[ZZ-9] unrelated', () => {});\n");
    const m = buildModels(d, cfg, (p) => path.relative(d, p))[0]!;
    expect(m.assertions[0]!.tests).toEqual([]);
  });

  it('parseModelFromBody returns null for a missing, malformed or non-model block', () => {
    expect(parseModelFromBody('no marker here')).toBeNull();
    const marker = renderModel({ system: 's', elements: [], assertions: [], relationships: [], communications: [], files: [], constants: {}, fingerprint: '' } as never, { sourcePath: '.' });
    const start = marker.indexOf('```json');
    const head = marker.slice(0, start);
    expect(parseModelFromBody(head + '```json\n{not json\n```')).toBeNull();
    expect(parseModelFromBody(head + '```json\n{"elements":"nope"}\n```')).toBeNull();
    expect(parseModelFromBody(head + '```json\nnull\n```')).toBeNull();
    expect(parseModelFromBody(head)).toBeNull(); // marker but no fenced block
  });
});

describe('definitions, trace and history', () => {
  const PROJECT = tmp('tr-spec-defs-');
  beforeAll(() => {
    write(PROJECT, 'arch/shop.adl', `DEFINE SYSTEM Shop AS shop
    DEFINE DOMAIN Orders AS orders
        DEFINE COMPONENT Order Api AS api
    DEFINE DATABASE Order Store AS order-store

DEFINE CAPABILITY Responsiveness AS p95 < 300ms FOR Order Api
DEFINE COMMUNICATION Order Api TO Order Store AS jdbc
ASSERT(Order Api is the only writer of Order Store) # [SHOP-1]
`);
    write(PROJECT, 'src/order.test.ts', "it('[SHOP-1] only the api writes the store', () => {});\n");
    indexArchitecture({ path: PROJECT });
    storeMemory({ title: 'Newer change', content: 'b', category: 'architecture-changes', system: 'shop', elements: ['assert:SHOP-1'], created: '2026-02-02T00:00:00.000Z' } as never);
    storeMemory({ title: 'Older change', content: 'a', category: 'architecture-changes', system: 'shop', elements: ['assert:SHOP-1'], created: '2026-01-01T00:00:00.000Z' } as never);
    storeMemory({ title: 'SHOP-1 passed', content: 'ok', category: 'knowledge', system: 'shop', artifact: 'fitness-result', status: 'resolved', elements: ['assert:SHOP-1'] });
  });

  it('the system summary and the element view both list the ADL definitions', () => {
    const sum: any = architectureContext({ system: 'shop' }, { guardrails: false });
    expect(sum.definitions).toEqual([{ kind: 'CAPABILITY', name: 'Responsiveness', value: 'p95 < 300ms', targets: ['adl:orders.api'] }]);
    const el: any = architectureContext({ system: 'shop', element: 'adl:orders.api' }, { guardrails: false });
    expect(el.definitions).toEqual([{ kind: 'CAPABILITY', name: 'Responsiveness', value: 'p95 < 300ms' }]);
    const other: any = architectureContext({ system: 'shop', element: 'adl:order-store' }, { guardrails: false });
    expect(other.definitions).toEqual([]);
  });

  it('the stored index memory mentions the definitions', () => {
    const meta = Object.values(memIndex).find((m) => m.tags.includes('architecture-index'))!;
    expect(fs.readFileSync(meta.filePath, 'utf8')).toContain('Definitions (1): Responsiveness (capability)');
  });

  it('trace rejects an empty id', () => {
    expect(() => trace({ id: '' })).toThrow(/trace needs an id/);
    expect(() => trace({ id: '   ' })).toThrow(/trace needs an id/);
  });

  it('trace of an assertion returns its fitness results', () => {
    const t: any = trace({ id: 'SHOP-1' });
    expect(t.results.map((r: any) => r.title)).toEqual(['SHOP-1 passed']);
    expect(t.other.map((r: any) => r.title).sort()).toEqual(['Newer change', 'Older change']);
  });

  it('trace skips a system whose index body cannot be parsed', () => {
    const meta = Object.values(memIndex).find((m) => m.tags.includes('architecture-index'))!;
    const good = fs.readFileSync(meta.filePath, 'utf8');
    fs.writeFileSync(meta.filePath, good.slice(0, good.indexOf('```json')));
    try {
      expect((trace({ id: 'SHOP-1', system: 'shop' }) as any).assertions).toEqual([]);
    } finally {
      fs.writeFileSync(meta.filePath, good);
    }
  });

  it('history is oldest-first', () => {
    const h: any = architectureHistory({ system: 'shop' });
    expect(h.changes.map((c: any) => c.title)).toEqual(['Older change', 'Newer change']);
  });
});
