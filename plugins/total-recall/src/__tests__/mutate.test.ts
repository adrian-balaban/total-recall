import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.hoisted(() => {
  process.env.HOME = '/tmp/tr-mutate-' + process.pid;
});

import { deleteMemory } from '../tools/mutate.js';
import { indexFile } from '../vault-scan.js';
import { memIndex } from '../state.js';

const TEST_HOME = process.env.HOME!;
const PERSONAL = path.join(TEST_HOME, '.total-recall', 'personal-vault');
const ORG_VAULT = path.join(TEST_HOME, '.total-recall', 'org', 'org-vault');
const CURRENT_USER = os.userInfo().username;

function reset() {
  for (const k of Object.keys(memIndex)) delete memIndex[k];
  try { fs.rmSync(path.join(TEST_HOME, '.total-recall'), { recursive: true, force: true }); } catch {}
  fs.mkdirSync(PERSONAL, { recursive: true });
  fs.mkdirSync(ORG_VAULT, { recursive: true });
}

function writeFile(fp: string, body: string) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, body);
}

describe('delete_memory', () => {
  beforeEach(reset);
  afterEach(reset);

  it('refuses to delete an org memory authored by another user', () => {
    const key = 'org/knowledge/foreign';
    const file = path.join(ORG_VAULT, 'knowledge', 'foreign.md');
    writeFile(file, `---\ntitle: "Foreign"\ntags: [org]\nauthor: "someone-else"\n---\n\nbody\n`);
    indexFile(file, true);
    expect(memIndex[key]).toBeDefined();

    expect(() => deleteMemory({ key })).toThrow(/authored by someone-else/);
    expect(memIndex[key]).toBeDefined();
    expect(fs.existsSync(file)).toBe(true);
  });

  it('refuses to delete another author’s org memory even with force=true', () => {
    const key = 'org/knowledge/foreign-force';
    const file = path.join(ORG_VAULT, 'knowledge', 'foreign-force.md');
    writeFile(file, `---\ntitle: "Foreign Force"\ntags: [org, no-prune]\nauthor: "someone-else"\n---\n\nbody\n`);
    indexFile(file, true);

    // force=true must override no-prune, but it must NOT override authorship.
    expect(() => deleteMemory({ key, force: true })).toThrow(/authored by someone-else/);
    expect(memIndex[key]).toBeDefined();
  });

  it('allows the org author to delete their own org memory', () => {
    const key = 'org/knowledge/own';
    const file = path.join(ORG_VAULT, 'knowledge', 'own.md');
    writeFile(file, `---\ntitle: "Own"\ntags: [org]\nauthor: "${CURRENT_USER}"\n---\n\nbody\n`);
    indexFile(file, true);
    expect(memIndex[key]).toBeDefined();

    deleteMemory({ key });
    expect(memIndex[key]).toBeUndefined();
    expect(fs.existsSync(file)).toBe(false);
  });

  it('allows deleting a personal memory regardless of its author field', () => {
    const key = 'knowledge/personal';
    const file = path.join(PERSONAL, 'knowledge', 'personal.md');
    writeFile(file, `---\ntitle: "Personal"\ntags: []\nauthor: "someone-else"\n---\n\nbody\n`);
    indexFile(file, false);
    expect(memIndex[key]).toBeDefined();

    deleteMemory({ key });
    expect(memIndex[key]).toBeUndefined();
    expect(fs.existsSync(file)).toBe(false);
  });

  it('deletes an org memory from the index even when the file is already gone', () => {
    // Index has an org entry, but the backing file was removed externally.
    // The ENOENT branch must still drop the in-memory key.
    const key = 'org/knowledge/orphaned';
    const file = path.join(ORG_VAULT, 'knowledge', 'orphaned.md');
    writeFile(file, `---\ntitle: "Orphaned"\ntags: [org]\nauthor: "${CURRENT_USER}"\n---\n\nbody\n`);
    indexFile(file, true);
    expect(memIndex[key]).toBeDefined();

    fs.unlinkSync(file);
    deleteMemory({ key });
    expect(memIndex[key]).toBeUndefined();
  });
});
