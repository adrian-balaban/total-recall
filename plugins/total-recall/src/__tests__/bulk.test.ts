import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.hoisted(() => {
  process.env.HOME = '/tmp/tr-bulk-' + process.pid;
});

import { exportMemories, importMemories, deleteMemories } from '../tools/bulk.js';
import { storeMemory } from '../tools/store.js';
import { memIndex } from '../state.js';

const TEST_HOME = process.env.HOME!;
const VAULT = path.join(TEST_HOME, '.total-recall');
const PERSONAL = path.join(VAULT, 'personal-vault');

function reset() {
  for (const k of Object.keys(memIndex)) delete memIndex[k];
  try { fs.rmSync(VAULT, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(PERSONAL, { recursive: true });
}

describe('bulk tools', () => {
  beforeEach(reset);
  afterEach(reset);

  function seed() {
    storeMemory({ title: 'Alpha', content: 'Alpha body.', category: 'knowledge', tags: ['x'], importanceScore: 0.5 });
    storeMemory({ title: 'Beta', content: 'Beta body.', category: 'journal', tags: ['y'], importanceScore: 0.7 });
  }

  it('export_memories dumps all memories with full content', () => {
    seed();
    const res = exportMemories({});
    expect(res.count).toBe(2);
    const keys = res.memories.map((m: any) => m.key).sort();
    expect(keys).toEqual(['journal/beta', 'knowledge/alpha']);
    const alpha = res.memories.find((m: any) => m.key === 'knowledge/alpha');
    expect(alpha.content).toContain('Alpha body.');
    expect(alpha.title).toBe('Alpha');
    expect(alpha.tags).toEqual(['x']);
    expect(alpha.importanceScore).toBe(0.5);
  });

  it('export_memories filters by keys, category, and tag', () => {
    seed();
    expect(exportMemories({ keys: ['knowledge/alpha'] }).count).toBe(1);
    expect(exportMemories({ keys: 'knowledge/alpha' }).count).toBe(1);
    expect(exportMemories({ category: 'journal' }).count).toBe(1);
    expect(exportMemories({ tag: 'x' }).count).toBe(1);
    expect(exportMemories({ category: 'journal', tag: 'x' }).count).toBe(0);
  });

  it('import_memories restores an exported archive preserving key, timestamps, and sessions', () => {
    const original = storeMemory({
      title: 'Alpha', content: 'Alpha body.', category: 'knowledge', tags: ['x'],
      importanceScore: 0.5, sessionId: 'session-1',
    });
    const archive = exportMemories({ keys: [original.key] });
    const exported = archive.memories[0];
    expect(exported.sessions).toContain('session-1');

    // Wipe the original.
    deleteMemories({ keys: [original.key], confirm: true });
    expect(Object.keys(memIndex).length).toBe(0);

    // Import with a changed title: the original key must be preserved.
    exported.title = 'Alpha Renamed';
    const res = importMemories({ memories: [exported] });
    expect(res.imported).toBe(1);
    expect(res.errors).toBe(0);

    const restored = memIndex[original.key];
    expect(restored).toBeDefined();
    expect(restored!.title).toBe('Alpha Renamed');
    expect(restored!.created).toBe(exported.created);
    expect(restored!.updated).toBe(exported.updated);
    expect(restored!.sessions).toContain('session-1');
    // No duplicate under the new slug.
    expect(memIndex['knowledge/alpha-renamed']).toBeUndefined();
  });

  it('import_memories skips existing keys and overwrites with force=true', () => {
    storeMemory({ title: 'Alpha', content: 'Original.', category: 'knowledge', tags: ['x'], importanceScore: 0.5 });

    const first = importMemories({ memories: [{ title: 'Alpha', content: 'Updated.', category: 'knowledge', tags: ['x'], importanceScore: 0.9 }] });
    expect(first.skipped).toBe(1);
    expect(first.imported).toBe(0);

    const second = importMemories({
      memories: [{ title: 'Alpha', content: 'Updated.', category: 'knowledge', tags: ['x'], importanceScore: 0.9 }],
      force: true,
    });
    expect(second.imported).toBe(1);
    const re = exportMemories({ keys: ['knowledge/alpha'] });
    expect(re.memories[0].content).toContain('Updated.');
  });

  it('import_memories classifies already-exists via typed error and carries the colliding key (6.4)', () => {
    // 6.4: the skip must be classified by `instanceof MemoryExistsError`, NOT by
    // `/already exists/.test(e.message)`. The typed path also carries the key
    // in the result — the old regex path emitted only {status,error} with no
    // key, so asserting the key is present pins both the type check and the
    // richer result. A non-exists error (missing title) must still classify as
    // 'error', proving the branch isn't collapsing both into 'skipped'.
    storeMemory({ title: 'Alpha', content: 'Original.', category: 'knowledge', tags: ['x'], importanceScore: 0.5 });
    const res = importMemories({
      memories: [
        { title: 'Alpha', content: 'dup.', category: 'knowledge', tags: ['x'] }, // exists → skipped
        { content: 'no title' }, // missing title → error
      ],
    });
    expect(res.skipped).toBe(1);
    expect(res.errors).toBe(1);
    const skip = res.results.find((r: any) => r.status === 'skipped');
    expect(skip).toBeDefined();
    expect(skip!.key).toBe('knowledge/alpha'); // typed error carries the key
    const err = res.results.find((r: any) => r.status === 'error');
    expect(err).toBeDefined();
    expect(err!.key).toBeUndefined(); // non-exists error has no key
  });

  it('import_memories normalizes non-string tag elements', () => {
    const res = importMemories({
      memories: [{ title: 'Tags', content: 'body', category: 'knowledge', tags: ['x', 123, null] }],
    });
    expect(res.imported).toBe(1);
    const key = res.results[0].key;
    expect(memIndex[key]?.tags).toEqual(['x', '123']);
  });

  it('import_memories reports errors for invalid memories', () => {
    const noTitle = importMemories({ memories: [{ content: 'Missing title' }] });
    expect(noTitle.imported).toBe(0);
    expect(noTitle.errors).toBe(1);
    expect(noTitle.results[0].status).toBe('error');

    const noContent = importMemories({ memories: [{ title: 'No content' }] });
    expect(noContent.imported).toBe(0);
    expect(noContent.errors).toBe(1);
  });

  it('delete_memories refuses without explicit confirmation', () => {
    seed();
    expect(() => deleteMemories({ keys: ['knowledge/alpha'] })).toThrow(/confirm=true/);
    expect(memIndex['knowledge/alpha']).toBeDefined();
  });

  it('delete_memories rejects non-string, non-array keys', () => {
    expect(() => deleteMemories({ keys: 123, confirm: true })).toThrow(/No keys provided/);
  });

  it('delete_memories removes confirmed keys', () => {
    seed();
    const res = deleteMemories({ keys: ['knowledge/alpha'], confirm: true });
    expect(res.deleted).toBe(1);
    expect(res.errors).toBe(0);
    expect(memIndex['knowledge/alpha']).toBeUndefined();
    expect(fs.existsSync(path.join(PERSONAL, 'knowledge', 'alpha.md'))).toBe(false);
  });

  it('delete_memories refuses no-prune memories unless force=true', () => {
    storeMemory({ title: 'ADR', content: 'Important.', category: 'decisions', tags: ['no-prune'], importanceScore: 0.9 });
    const noForce = deleteMemories({ keys: ['decisions/adr'], confirm: true });
    expect(noForce.errors).toBe(1);
    expect(memIndex['decisions/adr']).toBeDefined();

    const forced = deleteMemories({ keys: ['decisions/adr'], confirm: true, force: true });
    expect(forced.deleted).toBe(1);
    expect(memIndex['decisions/adr']).toBeUndefined();
  });

  it('(6.8) export_memories emits an error entry and increments errors when the memory file is unreadable/missing', () => {
    seed();
    // Make Alpha's file disappear from disk while its memIndex entry persists,
    // so readMemoryContent returns null (ENOENT). Race-free and root-safe,
    // unlike chmod 000 which a root test process would bypass.
    const alphaPath = path.join(PERSONAL, 'knowledge', 'alpha.md');
    expect(fs.existsSync(alphaPath)).toBe(true);
    fs.rmSync(alphaPath);

    const res = exportMemories({});
    expect(res.errors).toBeGreaterThanOrEqual(1);
    expect(res.count).toBe(1); // only Beta was successfully exported
    const errEntry = res.memories.find((m: any) => m.key === 'knowledge/alpha');
    expect(errEntry).toBeDefined();
    expect(errEntry!.error).toMatch(/unreadable|missing/i);
    expect(errEntry!.content).toBeUndefined();
    // Successful entry is unchanged.
    const beta = res.memories.find((m: any) => m.key === 'journal/beta');
    expect(beta).toBeDefined();
    expect(beta!.content).toContain('Beta body.');
    expect(beta!.error).toBeUndefined();
  });

  it('(6.8) import_memories skips an archive entry carrying an error field and does NOT overwrite real content with force=true', () => {
    const original = storeMemory({
      title: 'Alpha', content: 'Real on-disk content.', category: 'knowledge', tags: ['x'],
      importanceScore: 0.5,
    });
    const alphaPath = path.join(PERSONAL, 'knowledge', 'alpha.md');
    const onDiskBefore = fs.readFileSync(alphaPath, 'utf8');
    expect(onDiskBefore).toContain('Real on-disk content.');

    // An archive entry carrying an error (as produced by 6.8 export_memories
    // when the source file was unreadable). It has no content.
    const errorEntry = { key: original.key, error: 'unreadable or missing memory file' };
    const res = importMemories({ memories: [errorEntry], force: true });

    // The entry was skipped, not imported.
    const skip = res.results.find((r: any) => r.key === original.key);
    expect(skip).toBeDefined();
    expect(skip!.status).toBe('skipped');
    expect(skip!.error).toMatch(/export carried an error/);
    expect(res.imported).toBe(0);
    expect(res.skipped).toBe(1);

    // The real on-disk memory is unchanged — the force=true import did NOT
    // overwrite it with empty content derived from the failed export read.
    const after = memIndex[original.key];
    expect(after).toBeDefined();
    const onDiskAfter = fs.readFileSync(alphaPath, 'utf8');
    expect(onDiskAfter).toContain('Real on-disk content.');
  });
});
