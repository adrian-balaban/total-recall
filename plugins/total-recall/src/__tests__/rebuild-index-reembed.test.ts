import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// C-1 behavior fix: `rebuild_index { forceReembed: true }` drops vec_memories and
// re-embeds every memory at the current embedding model's dim. Pins both paths
// (default = no drop; force = drop + N re-embeds) and the refuse-early guard.
vi.hoisted(() => {
  process.env.HOME = '/tmp/tr-reembed-' + process.pid;
  process.env.NODE_ENV = 'test';
});

// Hoisted mock fns so the vi.mock factories (which run before imports) can share
// the same instances the test asserts against.
const mocks = vi.hoisted(() => ({
  embed: vi.fn(async (_text: string): Promise<number[] | null> => [0.1, 0.2, 0.3]),
  embedTextFor: vi.fn((t: string, b: string) => `${t || ''}\n\n${b || ''}`),
  flushEmbeddings: vi.fn(async () => {}),
  embedAndUpsert: vi.fn(),
  dropVectorTable: vi.fn(async () => {}),
  upsertVector: vi.fn(async () => {}),
  deleteVector: vi.fn(async () => {}),
  listVectorKeys: vi.fn(async () => null),
}));

vi.mock('../embeddings.js', () => ({
  embed: mocks.embed,
  embedTextFor: mocks.embedTextFor,
  flushEmbeddings: mocks.flushEmbeddings,
  embedAndUpsert: mocks.embedAndUpsert,
  isVectorAvailable: vi.fn(() => true),
  __testSetEmbedder: vi.fn(),
  __testResetVectorAvailability: vi.fn(),
}));

vi.mock('../vectorStore.js', () => ({
  dropVectorTable: mocks.dropVectorTable,
  upsertVector: mocks.upsertVector,
  deleteVector: mocks.deleteVector,
  listVectorKeys: mocks.listVectorKeys,
}));

import { rebuildIndex, reembedAll } from '../tools/mutate.js';
import { indexFile } from '../vault-scan.js';
import { memIndex, errors } from '../state.js';

const TEST_HOME = process.env.HOME!;
const PERSONAL = path.join(TEST_HOME, '.total-recall', 'personal-vault');

function reset() {
  for (const k of Object.keys(memIndex)) delete memIndex[k];
  errors.length = 0;
  try { fs.rmSync(path.join(TEST_HOME, '.total-recall'), { recursive: true, force: true }); } catch {}
  fs.mkdirSync(PERSONAL, { recursive: true });
  mocks.embed.mockReset();
  mocks.embed.mockResolvedValue([0.1, 0.2, 0.3]);
  mocks.embedTextFor.mockImplementation((t: string, b: string) => `${t || ''}\n\n${b || ''}`);
  mocks.flushEmbeddings.mockReset();
  mocks.flushEmbeddings.mockResolvedValue(undefined);
  mocks.dropVectorTable.mockReset();
  mocks.dropVectorTable.mockResolvedValue(undefined);
  mocks.upsertVector.mockReset();
  mocks.upsertVector.mockResolvedValue(undefined);
  mocks.deleteVector.mockReset();
  mocks.deleteVector.mockResolvedValue(undefined);
  mocks.listVectorKeys.mockReset();
  mocks.listVectorKeys.mockResolvedValue(null);
  mocks.embedAndUpsert.mockReset();
}

function writeFile(fp: string, body: string) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, body);
}

function seedMemory(name: string, body: string) {
  const fp = path.join(PERSONAL, 'knowledge', `${name}.md`);
  writeFile(fp, `---\ntitle: "${name}"\ntags: []\n---\n\n${body}\n`);
  indexFile(fp, false);
}

describe('rebuild_index forceReembed (C-1 behavior fix)', () => {
  beforeEach(reset);
  afterEach(reset);

  it('default (forceReembed absent): reconciles only — does NOT drop vec_memories or embed', async () => {
    seedMemory('a', 'body a');
    expect(Object.keys(memIndex).length).toBe(1);

    const res = await rebuildIndex({});
    expect(res.message).toMatch(/Index rebuilt\. 1 memories indexed\./);
    expect(res.dropped).toBeUndefined();
    expect(mocks.dropVectorTable).not.toHaveBeenCalled();
    expect(mocks.embed).not.toHaveBeenCalled();
    expect(mocks.upsertVector).not.toHaveBeenCalled();
  });

  it('forceReembed=true: drops vec_memories and re-embeds every memory at the new dim', async () => {
    seedMemory('a', 'body a');
    seedMemory('b', 'body b');
    expect(Object.keys(memIndex).length).toBe(2);

    const res = await rebuildIndex({ forceReembed: true });
    expect(res.dropped).toBe(true);
    expect(res.reembedded).toBe(2);
    expect(res.skipped).toBe(0);
    expect(res.message).toMatch(/Re-embedded 2\/2 memories/);
    expect(mocks.dropVectorTable).toHaveBeenCalledTimes(1);
    // probe (key a) + worker (key b) = 2 embeds; probe vector is re-used for a.
    expect(mocks.embed).toHaveBeenCalledTimes(2);
    expect(mocks.upsertVector).toHaveBeenCalledTimes(2);
    expect(mocks.flushEmbeddings).toHaveBeenCalled();
  });

  it('forceReembed=true refuses WITHOUT dropping when the embedder is unavailable', async () => {
    seedMemory('a', 'body a');
    mocks.embed.mockResolvedValue(null); // embedder unavailable (deps absent / load failed)

    const res = await rebuildIndex({ forceReembed: true });
    expect(res.dropped).toBe(false);
    expect(res.reembedded).toBe(0);
    expect(res.skipped).toBe(1);
    expect(res.message).toMatch(/Embedder unavailable — vec_memories left untouched/);
    expect(mocks.dropVectorTable).not.toHaveBeenCalled();
    expect(mocks.upsertVector).not.toHaveBeenCalled();
    expect(errors.some((e) => /reembedAll: embedder unavailable/.test(e.msg))).toBe(true);
  });

  it('reembedAll on an empty index is a no-op (no drop, no embed)', async () => {
    const res = await reembedAll();
    expect(res).toEqual({ dropped: false, reembedded: 0, skipped: 0 });
    expect(mocks.dropVectorTable).not.toHaveBeenCalled();
    expect(mocks.embed).not.toHaveBeenCalled();
  });

  it('a memory whose embed returns null is counted as skipped, not re-embedded', async () => {
    seedMemory('a', 'body a');
    seedMemory('b', 'body b');
    // probe (key a) succeeds → upserts; worker (key b) returns null → skipped.
    mocks.embed.mockResolvedValueOnce([0.4, 0.5, 0.6]).mockResolvedValueOnce(null);

    const res = await rebuildIndex({ forceReembed: true });
    expect(res.dropped).toBe(true);
    expect(res.reembedded).toBe(1);
    expect(res.skipped).toBe(1);
    expect(mocks.upsertVector).toHaveBeenCalledTimes(1); // only the probe vector landed
  });
});