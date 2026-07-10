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
    expect(exportMemories({ category: 'journal' }).count).toBe(1);
    expect(exportMemories({ tag: 'x' }).count).toBe(1);
    expect(exportMemories({ category: 'journal', tag: 'x' }).count).toBe(0);
  });

  it('import_memories restores an exported archive', () => {
    seed();
    const archive = exportMemories({});
    // Wipe the originals.
    deleteMemories({ keys: ['knowledge/alpha', 'journal/beta'], confirm: true });
    expect(Object.keys(memIndex).length).toBe(0);

    const res = importMemories({ memories: archive.memories });
    expect(res.imported).toBe(2);
    expect(res.errors).toBe(0);
    expect(Object.keys(memIndex).length).toBe(2);
    expect(fs.existsSync(path.join(PERSONAL, 'knowledge', 'alpha.md'))).toBe(true);
    expect(fs.existsSync(path.join(PERSONAL, 'journal', 'beta.md'))).toBe(true);
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

  it('delete_memories refuses without explicit confirmation', () => {
    seed();
    expect(() => deleteMemories({ keys: ['knowledge/alpha'] })).toThrow(/confirm=true/);
    expect(memIndex['knowledge/alpha']).toBeDefined();
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
