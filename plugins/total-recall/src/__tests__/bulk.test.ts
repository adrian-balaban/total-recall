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
});
