import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.hoisted(() => {
  process.env.HOME = '/tmp/tr-reserved-' + process.pid;
});

import { deriveFilePathFromKey } from '../persistence.js';
import { isReservedKey, indexFile } from '../vault-scan.js';
import { storeMemory } from '../tools/store.js';
import { memIndex } from '../state.js';

const TEST_HOME = process.env.HOME!;
const PERSONAL = path.join(TEST_HOME, '.total-recall', 'personal-vault');

function reset() {
  for (const k of Object.keys(memIndex)) delete memIndex[k];
  try { fs.rmSync(path.join(TEST_HOME, '.total-recall'), { recursive: true, force: true }); } catch {}
  fs.mkdirSync(PERSONAL, { recursive: true });
}

describe('reserved key guard', () => {
  beforeEach(reset);
  afterEach(reset);

  it('deriveFilePathFromKey rejects reserved top-level keys', () => {
    expect(deriveFilePathFromKey('__proto__')).toBeNull();
    expect(deriveFilePathFromKey('constructor')).toBeNull();
    expect(deriveFilePathFromKey('prototype')).toBeNull();
  });

  it('deriveFilePathFromKey rejects reserved path segments', () => {
    expect(deriveFilePathFromKey('knowledge/__proto__/note')).toBeNull();
    expect(deriveFilePathFromKey('knowledge/constructor/note')).toBeNull();
    expect(deriveFilePathFromKey('knowledge/prototype/note')).toBeNull();
  });

  it('deriveFilePathFromKey rejects reserved org segments', () => {
    expect(deriveFilePathFromKey('org/knowledge/__proto__/note')).toBeNull();
    expect(deriveFilePathFromKey('org/__proto__')).toBeNull();
  });

  it('isReservedKey matches expected names and allows normal keys', () => {
    expect(isReservedKey('__proto__')).toBe(true);
    expect(isReservedKey('constructor')).toBe(true);
    expect(isReservedKey('prototype')).toBe(true);
    expect(isReservedKey('')).toBe(true);
    expect(isReservedKey('knowledge/foo')).toBe(false);
    expect(isReservedKey('org/architecture/adr')).toBe(false);
  });

  it('storeMemory rejects an explicit reserved key', () => {
    expect(() =>
      storeMemory({ key: '__proto__', title: 'Bad', content: 'body', tags: [], category: 'knowledge', importanceScore: 0.5 })
    ).toThrow(/reserved|Invalid key/);
  });

  it('storeMemory rejects an explicit reserved org segment', () => {
    expect(() =>
      storeMemory({ key: 'org/knowledge/__proto__/note', title: 'Bad', content: 'body', tags: [], category: 'knowledge', importanceScore: 0.5 })
    ).toThrow(/reserved|Invalid key/);
  });

  it('indexFile skips a file whose key would be reserved', () => {
    const badFile = path.join(PERSONAL, 'knowledge', '__proto__.md');
    fs.mkdirSync(path.dirname(badFile), { recursive: true });
    fs.writeFileSync(badFile, '---\ntitle: "Bad"\ntags: []\n---\n\nbody\n');
    indexFile(badFile, false);
    // The reserved key must never enter memIndex as an OWN property. Accessing
    // memIndex['__proto__'] always resolves to Object.prototype, so we must test
    // with Object.prototype.hasOwnProperty.call to avoid a false negative.
    expect(Object.prototype.hasOwnProperty.call(memIndex, '__proto__')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(memIndex, 'knowledge/__proto__')).toBe(false);
  });

  it('indexFile skips a file under a reserved directory segment', () => {
    const badDir = path.join(PERSONAL, 'knowledge', 'constructor');
    const badFile = path.join(badDir, 'note.md');
    fs.mkdirSync(badDir, { recursive: true });
    fs.writeFileSync(badFile, '---\ntitle: "Bad"\ntags: []\n---\n\nbody\n');
    indexFile(badFile, false);
    expect(Object.prototype.hasOwnProperty.call(memIndex, 'knowledge/constructor/note')).toBe(false);
  });
});
