import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// [TR-R6]: after an embedding-model change the stored vectors must not be mixed
// with the new model's. Both the old default (all-MiniLM-L6-v2) and the new one are
// 384-dim, so vectorStore's dim guard never fires; reconcileVectors compares the
// vec_meta fingerprint with the configured model instead.
vi.hoisted(() => {
  process.env.HOME = '/tmp/tr-model-switch-' + process.pid;
});

const mocks = vi.hoisted(() => ({
  getVecMeta: vi.fn(async (): Promise<{ model: string; dim: number | null } | null> => null),
  dropVectorTable: vi.fn(async () => {}),
  listVectorKeys: vi.fn(async (): Promise<string[] | null> => []),
  deleteVector: vi.fn(async () => {}),
  embedAndUpsert: vi.fn(),
}));

vi.mock('../vectorStore.js', () => ({
  getVecMeta: mocks.getVecMeta,
  dropVectorTable: mocks.dropVectorTable,
  listVectorKeys: mocks.listVectorKeys,
  deleteVector: mocks.deleteVector,
}));
vi.mock('../embeddings.js', () => ({ embedAndUpsert: mocks.embedAndUpsert }));

import { reconcileIndex } from '../vault-scan.js';
import { PERSONAL_VAULT, CONFIG_PATH, DEFAULT_EMBEDDING_MODEL, embeddingModel } from '../paths.js';
import { memIndex, errors } from '../state.js';

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

function put(rel: string, title: string) {
  const fp = path.join(PERSONAL_VAULT, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, `---\ntitle: ${title}\n---\n\n## Executive Summary\n\n${title} body\n`);
}

beforeEach(() => {
  for (const k of Object.keys(memIndex)) delete (memIndex as Record<string, unknown>)[k];
  fs.rmSync(CONFIG_PATH, { force: true });
  errors.length = 0;
  vi.clearAllMocks();
  put('knowledge/a.md', 'Alpha');
  put('decisions/b.md', 'Beta');
});

afterAll(() => {
  fs.rmSync(process.env.HOME as string, { recursive: true, force: true });
});

describe('embedding model default', () => {
  it('is the multilingual MiniLM, and config.json overrides it', () => {
    expect(DEFAULT_EMBEDDING_MODEL).toBe('Xenova/paraphrase-multilingual-MiniLM-L12-v2');
    expect(embeddingModel()).toBe(DEFAULT_EMBEDDING_MODEL);
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ embeddingModel: 'Xenova/all-MiniLM-L6-v2' }));
    expect(embeddingModel()).toBe('Xenova/all-MiniLM-L6-v2');
  });
});

describe('reconcileVectors on a model change', () => {
  it('[TR-R6] drops vectors made by another model and re-embeds every memory', async () => {
    mocks.getVecMeta.mockResolvedValueOnce({ model: 'Xenova/all-MiniLM-L6-v2', dim: 384 });
    // Before the drop both keys have vectors; after it, the table is empty.
    mocks.listVectorKeys.mockResolvedValueOnce([]);
    reconcileIndex();
    await settle();
    expect(mocks.dropVectorTable).toHaveBeenCalledTimes(1);
    expect(mocks.embedAndUpsert.mock.calls.map((c) => c[0]).sort()).toEqual(['decisions/b', 'knowledge/a']);
    expect(errors.map((e) => e.msg).join('\n')).toMatch(/stored vectors came from Xenova\/all-MiniLM-L6-v2/);
  });

  it('[TR-R6] keeps the vectors when they were made by the configured model', async () => {
    mocks.getVecMeta.mockResolvedValueOnce({ model: DEFAULT_EMBEDDING_MODEL, dim: 384 });
    mocks.listVectorKeys.mockResolvedValueOnce(['knowledge/a', 'decisions/b']);
    reconcileIndex();
    await settle();
    expect(mocks.dropVectorTable).not.toHaveBeenCalled();
    expect(mocks.embedAndUpsert).not.toHaveBeenCalled();
  });

  it('[TR-R6] respects a model set in config.json', async () => {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ embeddingModel: 'Xenova/all-MiniLM-L6-v2' }));
    mocks.getVecMeta.mockResolvedValueOnce({ model: 'Xenova/all-MiniLM-L6-v2', dim: 384 });
    mocks.listVectorKeys.mockResolvedValueOnce(['knowledge/a', 'decisions/b']);
    reconcileIndex();
    await settle();
    expect(mocks.dropVectorTable).not.toHaveBeenCalled();
  });

  it('[TR-R6] leaves the index alone when there is no fingerprint to compare', async () => {
    mocks.getVecMeta.mockResolvedValueOnce(null);
    mocks.listVectorKeys.mockResolvedValueOnce(['knowledge/a']);
    reconcileIndex();
    await settle();
    expect(mocks.dropVectorTable).not.toHaveBeenCalled();
    expect(mocks.embedAndUpsert.mock.calls.map((c) => c[0])).toEqual(['decisions/b']);
  });
});
