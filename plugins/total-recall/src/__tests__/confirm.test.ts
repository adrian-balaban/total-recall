import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.hoisted(() => {
  process.env.HOME = '/tmp/tr-confirm-' + process.pid;
});

import { confirmMemory, updateMemory } from '../tools/mutate.js';
import { storeMemory } from '../tools/store.js';
import { pruneMemories } from '../tools/query.js';
import { memIndex } from '../state.js';
import { parseFrontmatter } from '../frontmatter.js';
import { indexFile } from '../vault-scan.js';
import * as os from 'os';

const TEST_HOME = process.env.HOME!;
const VAULT = path.join(TEST_HOME, '.total-recall');
const PERSONAL = path.join(VAULT, 'personal-vault');

function reset() {
  for (const k of Object.keys(memIndex)) delete memIndex[k];
  try { fs.rmSync(VAULT, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(PERSONAL, { recursive: true });
}

describe('confirm_memory', () => {
  beforeEach(reset);
  afterEach(reset);

  it('increments confirmations and writes them to disk', () => {
    const stored = storeMemory({ title: 'T', content: 'body', category: 'knowledge', tags: [], importanceScore: 0.5 });
    const key = stored.key;

    const first = confirmMemory({ key });
    expect(first.confirmations).toBe(1);
    expect(first.useful).toBe(true);

    const second = confirmMemory({ key, useful: true });
    expect(second.confirmations).toBe(2);

    const raw = fs.readFileSync(stored.filePath, 'utf8');
    const parsed = parseFrontmatter(raw);
    expect(parsed.data.confirmations).toBe(2);
    expect(parsed.data.flags).toBeUndefined();
  });

  it('increments flags when useful=false', () => {
    const stored = storeMemory({ title: 'T', content: 'body', category: 'knowledge', tags: [], importanceScore: 0.5 });
    const res = confirmMemory({ key: stored.key, useful: false });
    expect(res.flags).toBe(1);
    expect(res.confirmations).toBeUndefined();

    expect(memIndex[stored.key]?.flags).toBe(1);
  });

  it('throws for an unknown key', () => {
    expect(() => confirmMemory({ key: 'knowledge/missing' })).toThrow(/not found/);
  });

  it('affects prune_memories retention ordering', () => {
    // Two identical memories; confirm one, flag the other. The flagged one should
    // rank lower ( weaker retention ) than the confirmed one.
    const a = storeMemory({ title: 'A', content: 'body a', category: 'knowledge', tags: [], importanceScore: 0.5 });
    const b = storeMemory({ title: 'B', content: 'body b', category: 'knowledge', tags: [], importanceScore: 0.5 });

    confirmMemory({ key: a.key, useful: true });
    confirmMemory({ key: b.key, useful: false });

    const candidates = pruneMemories({ threshold: 1, limit: 10 });
    const aEntry = candidates.find((c: any) => c.key === a.key);
    const bEntry = candidates.find((c: any) => c.key === b.key);
    if (!aEntry || !bEntry) throw new Error('Candidate missing from prune output');
    expect(aEntry.retentionStrength).toBeGreaterThan(bEntry.retentionStrength);
  });

  it('coerces useful="false" string to a flag, not a confirmation', () => {
    // The MCP schema declares `useful` as boolean, but a direct caller can pass
    // the string "false", which is truthy in JS. confirmMemory must only treat
    // the literal boolean `false` as not-useful.
    const stored = storeMemory({ title: 'T', content: 'body', category: 'knowledge', tags: [], importanceScore: 0.5 });
    const res = confirmMemory({ key: stored.key, useful: 'false' });
    expect(res.flags).toBe(1);
    expect(res.confirmations).toBeUndefined();
  });

  it('update_memory coerces non-string content to string', () => {
    const stored = storeMemory({ title: 'T', content: 'body', category: 'knowledge', tags: [], importanceScore: 0.5 });
    // A numeric content argument must be stringified, not throw inside
    // withExecutiveSummary.
    const res = updateMemory({ key: stored.key, content: 12345 });
    expect(res.message).toBe('Memory updated.');
    const raw = fs.readFileSync(stored.filePath, 'utf8');
    const parsed = parseFrontmatter(raw);
    expect(parsed.content).toContain('12345');
  });

  it('store_memory force-overwrite coerces a scalar sessions field to an array', () => {
    // Some persisted files may carry an invalid scalar `sessions` value. A
    // force-overwrite must not crash when merging; it should reset to [] and
    // still keep the file.
    const key = 'knowledge/scalar-sessions';
    const filePath = path.join(PERSONAL, key + '.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      '---\ntitle: "Scalar Sessions"\ntags: []\nsessions: not-an-array\n---\n\nbody\n',
    );

    const res = storeMemory({
      key,
      title: 'Scalar Sessions',
      content: 'new body',
      category: 'knowledge',
      tags: [],
      importanceScore: 0.5,
      force: true,
    });
    expect(res.key).toBe(key);
    expect(memIndex[key]?.sessions).toEqual([]);

    // The file must still exist and carry the new content.
    const raw = fs.readFileSync(filePath, 'utf8');
    expect(raw).toContain('new body');
  });

  it('store_memory coerces non-string content to string', () => {
    // A caller may pass a number (or any JSON-serializable value) as content;
    // store_memory must String() it before building the frontmatter body.
    const stored = storeMemory({ title: 'Number content', content: 42 as any, category: 'knowledge', tags: [], importanceScore: 0.5 });
    const raw = fs.readFileSync(stored.filePath, 'utf8');
    const parsed = parseFrontmatter(raw);
    expect(parsed.content).toContain('42');
  });

  it('store_memory normalizes non-string tags to strings', () => {
    const stored = storeMemory({
      title: 'Tag coercion', content: 'body', category: 'knowledge',
      tags: ['x', 123, null as any], importanceScore: 0.5,
    });
    expect(memIndex[stored.key]?.tags).toEqual(['x', '123']);
    // Search must not crash on the normalized tags.
    expect(() => storeMemory({
      title: 'Search probe', content: 'x 123', category: 'knowledge',
      tags: [], importanceScore: 0.5,
    })).not.toThrow();
  });

  it('update_memory normalizes non-string tags to strings', () => {
    const stored = storeMemory({ title: 'T', content: 'body', category: 'knowledge', tags: [], importanceScore: 0.5 });
    updateMemory({ key: stored.key, tags: ['a', 2, null as any] });
    expect(memIndex[stored.key]?.tags).toEqual(['a', '2']);
  });

  it('store_memory coerces a non-string sessionId and author to undefined', () => {
    const stored = storeMemory({
      title: 'Coerce', content: 'body', category: 'knowledge', tags: [], importanceScore: 0.5,
      sessionId: 12345 as any, author: true as any,
    });
    const raw = fs.readFileSync(stored.filePath, 'utf8');
    const parsed = parseFrontmatter(raw);
    expect(parsed.data.sessions).toEqual([]);
    expect(parsed.data.author).toBe(os.userInfo().username);
  });

  it('update_memory coerces a non-string sessionId to undefined', () => {
    const stored = storeMemory({ title: 'T', content: 'body', category: 'knowledge', tags: [], importanceScore: 0.5 });
    updateMemory({ key: stored.key, content: 'new', sessionId: 12345 as any });
    const raw = fs.readFileSync(stored.filePath, 'utf8');
    const parsed = parseFrontmatter(raw);
    expect(parsed.data.sessions).toEqual([]);
  });

  it('confirm_memory refuses to confirm an org memory authored by another user', () => {
    const orgVault = path.join(TEST_HOME, '.total-recall', 'org', 'org-vault');
    const key = 'org/knowledge/foreign';
    const file = path.join(orgVault, 'knowledge', 'foreign.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `---\ntitle: "Foreign"\ntags: [org]\nauthor: "someone-else"\n---\n\nbody\n`);
    indexFile(file, true);
    expect(memIndex[key]).toBeDefined();

    expect(() => confirmMemory({ key })).toThrow(/authored by someone-else/);
    expect(memIndex[key]?.confirmations).toBeUndefined();
  });

  it('confirm_memory allows the org author to confirm their own org memory', () => {
    const orgVault = path.join(TEST_HOME, '.total-recall', 'org', 'org-vault');
    const key = 'org/knowledge/own';
    const file = path.join(orgVault, 'knowledge', 'own.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `---\ntitle: "Own"\ntags: [org]\nauthor: "${os.userInfo().username}"\n---\n\nbody\n`);
    indexFile(file, true);

    const res = confirmMemory({ key });
    expect(res.confirmations).toBe(1);
  });
});
