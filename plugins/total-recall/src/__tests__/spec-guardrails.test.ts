import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.hoisted(() => {
  process.env.HOME = '/tmp/tr-spec-guardrails-' + process.pid;
});

import { storeMemory } from '../tools/store.js';
import { memIndex } from '../state.js';
import { architectureContext, indexKey } from '../spec/context.js';
import { renderModel, type ArchModel } from '../spec/indexer.js';

const TR = path.join(process.env.HOME!, '.total-recall');
const ORG = path.join(TR, 'org', 'org-vault');

function reset(specDriven?: unknown) {
  for (const k of Object.keys(memIndex)) delete memIndex[k];
  fs.rmSync(TR, { recursive: true, force: true });
  fs.mkdirSync(path.join(TR, 'personal-vault'), { recursive: true });
  fs.mkdirSync(ORG, { recursive: true });
  fs.writeFileSync(path.join(TR, 'config.json'), JSON.stringify({ orgRepo: 'git@example.com:org/memories.git', ...(specDriven ? { specDriven } : {}) }));
}

// A minimal architecture index, as index_architecture would write it.
function seedIndex() {
  const model: ArchModel = {
    system: 'shop', files: [{ path: 'a.adl', kind: 'adl', hash: 'x' }],
    elements: [{ id: 'adl:orders.api', kind: 'COMPONENT', name: 'Order Api', source: 'a.adl' }],
    assertions: [], communications: [], relationships: [], constants: {}, fingerprint: 'f',
  };
  storeMemory({ key: indexKey('shop'), title: 'Architecture index: shop', content: renderModel(model, { sourcePath: '.' }),
    category: 'architecture', tags: ['architecture-index'], system: 'shop', elements: ['adl:orders.api'] });
}

afterAll(() => fs.rmSync(TR, { recursive: true, force: true }));

describe('org vault rules for spec memories (phase 6)', () => {
  beforeEach(() => reset({ orgBlockedTerms: ['Acme Bank'] }));

  it('[TR-D5] rejects an org spec that names a host, a credential or a blocked client term, before writing anything', () => {
    const spec = { tags: ['org'], category: 'specs', artifact: 'spec' };
    expect(() => storeMemory({ ...spec, title: 'Spec A', content: 'Calls https://api.acme.internal/v1' })).toThrow(/names a host/);
    expect(() => storeMemory({ ...spec, title: 'Spec B', content: 'DB at 10.1.2.3' })).toThrow(/names a host/);
    expect(() => storeMemory({ ...spec, title: 'Spec C', content: 'Built for Acme bank tellers' })).toThrow(/blocked term/);
    expect(() => storeMemory({ ...spec, title: 'Spec D', content: 'token sk-abcdefghijklmnopqrstuvwxyz0123' })).toThrow(/secret/);
    expect(fs.readdirSync(ORG)).toEqual([]);
  });

  it('accepts a clean org spec, and keeps a personal spec as it is', () => {
    storeMemory({ title: 'Spec E', content: 'Students answer questions; answers are graded later.', tags: ['org'], category: 'specs', artifact: 'spec' });
    storeMemory({ title: 'Spec F', content: 'Calls https://api.acme.internal/v1', tags: [], category: 'specs', artifact: 'spec' });
    expect(memIndex['org/specs/spec-e']).toBeDefined();
    expect(memIndex['specs/spec-f']).toBeDefined();
  });

  it('does not apply to guardrails or other artifacts', () => {
    storeMemory({ title: 'No shared database', content: 'Each quantum owns its database (see acme.com outage).', tags: ['org', 'guardrail'], category: 'architecture' });
    expect(memIndex['org/architecture/no-shared-database']).toBeDefined();
  });
});

describe('guardrails and superseded decisions in the architecture context', () => {
  beforeEach(() => { reset(); seedIndex(); });

  it('returns org guardrails: general ones always, element-specific ones only for their element', () => {
    storeMemory({ title: 'Every connection is authenticated', content: 'x', tags: ['org', 'guardrail'], category: 'architecture' });
    storeMemory({ title: 'Order Api owns order data', content: 'x', tags: ['org', 'guardrail'], category: 'architecture', elements: ['adl:orders.api'] });
    storeMemory({ title: 'Payments are PCI scoped', content: 'x', tags: ['org', 'guardrail'], category: 'architecture', elements: ['adl:payments'] });
    const ctx: any = architectureContext({ system: 'shop', element: 'adl:orders.api' }, { guardrails: true });
    expect(ctx.guardrails.map((g: any) => g.title).sort()).toEqual(['Every connection is authenticated', 'Order Api owns order data']);
    const summary: any = architectureContext({ system: 'shop' }, { guardrails: true });
    expect(summary.guardrails).toHaveLength(3);
    expect(architectureContext({ system: 'shop' }, { guardrails: false })).not.toHaveProperty('guardrails');
  });

  it('a superseded decision is not returned as current, whether by status or by a later supersedes link', () => {
    const base = { category: 'decisions', system: 'shop', artifact: 'adr', elements: ['adl:orders.api'] };
    storeMemory({ ...base, title: 'Use REST', content: 'v1', status: 'superseded' });
    storeMemory({ ...base, title: 'Use gRPC', content: 'v2', status: 'accepted' });
    storeMemory({ ...base, title: 'Use events', content: 'v3', status: 'accepted', supersedes: 'decisions/use-grpc' });
    const ctx: any = architectureContext({ system: 'shop', element: 'adl:orders.api' }, { guardrails: false });
    expect(ctx.decisions.map((d: any) => d.title)).toEqual(['Use events']);
    expect(ctx.superseded.map((d: any) => d.title).sort()).toEqual(['Use REST', 'Use gRPC']);
    const summary: any = architectureContext({ system: 'shop' }, { guardrails: false });
    expect(summary.recentDecisions.map((d: any) => d.title)).toEqual(['Use events']);
  });
});
