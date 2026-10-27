import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.hoisted(() => {
  process.env.HOME = '/tmp/tr-spec-fields-' + process.pid;
});

import { storeMemory } from '../tools/store.js';
import { updateMemory } from '../tools/mutate.js';
import { exportMemories, importMemories } from '../tools/bulk.js';
import { indexFile } from '../vault-scan.js';
import { memIndex } from '../state.js';
import { parseFrontmatter } from '../frontmatter.js';
import { pickSpecFields } from '../spec/fields.js';

const TR = path.join(process.env.HOME!, '.total-recall');
const PERSONAL = path.join(TR, 'personal-vault');

function reset() {
  for (const k of Object.keys(memIndex)) delete memIndex[k];
  fs.rmSync(TR, { recursive: true, force: true });
  fs.mkdirSync(PERSONAL, { recursive: true });
}

const SPEC = {
  system: 'make-the-grade',
  artifact: 'adr',
  elements: ['adl:testing.answercapture', 'assert:TR-S2', 'calm:org-vault'],
  requirements: ['REQ-7'],
  sourcePath: 'docs/adl/structure.adl',
  sourceRev: 'abc1234',
  status: 'accepted',
  supersedes: 'decisions/old-queue',
};

describe('spec-driven frontmatter fields', () => {
  beforeEach(reset);
  afterEach(() => fs.rmSync(TR, { recursive: true, force: true }));

  it('store_memory writes the fields and a schemaVersion, and they round-trip through the frontmatter', () => {
    const { filePath, key } = storeMemory({ title: 'Answer queue', content: 'Use a broker.', category: 'decisions', ...SPEC });
    const { data } = parseFrontmatter(fs.readFileSync(filePath, 'utf8'));
    expect(pickSpecFields(data)).toEqual(SPEC);
    expect(data.schemaVersion).toBe(2);
    expect(memIndex[key]).toMatchObject(SPEC);
  });

  it('a memory without spec fields is written exactly as before (no schemaVersion)', () => {
    const { filePath } = storeMemory({ title: 'Plain', content: 'x', category: 'knowledge' });
    const { data } = parseFrontmatter(fs.readFileSync(filePath, 'utf8'));
    expect(data.schemaVersion).toBeUndefined();
    expect(Object.keys(data).sort()).toEqual(['author', 'created', 'importanceScore', 'sessions', 'tags', 'title', 'updated']);
  });

  it('indexFile picks the fields up from a file, and an old file without them still parses', () => {
    const f1 = path.join(PERSONAL, 'decisions', 'hand.md');
    const f2 = path.join(PERSONAL, 'knowledge', 'old.md');
    fs.mkdirSync(path.dirname(f1), { recursive: true });
    fs.mkdirSync(path.dirname(f2), { recursive: true });
    fs.writeFileSync(f1, '---\ntitle: "Hand"\ntags: []\nsystem: mtg\nelements: ["calm:org-vault"]\nstatus: accepted\n---\nbody\n');
    fs.writeFileSync(f2, '---\ntitle: "Old"\ntags: [a]\n---\nbody\n');
    indexFile(f1, false);
    indexFile(f2, false);
    expect(memIndex['decisions/hand']).toMatchObject({ system: 'mtg', elements: ['calm:org-vault'], status: 'accepted' });
    expect(memIndex['knowledge/old']!.title).toBe('Old');
    expect(memIndex['knowledge/old']!.elements).toBeUndefined();
  });

  it('drops invalid values instead of storing them', () => {
    const picked = pickSpecFields({
      artifact: 'blueprint', status: 'maybe', sourcePath: '/etc/passwd', sourceRev: 'not a sha',
      elements: ['ok:1', 'bad element', 42], system: 'line\nbreak',
    });
    expect(picked).toEqual({ elements: ['ok:1'] });
    expect(pickSpecFields({ sourcePath: '../../secret' })).toEqual({});
    expect(pickSpecFields({ sourcePath: 'a\\b.adl' })).toEqual({ sourcePath: 'a/b.adl' });
  });

  it('update_memory patches only the fields it is given', () => {
    const { key, filePath } = storeMemory({ title: 'Patch me', content: 'x', category: 'decisions', ...SPEC });
    updateMemory({ key, status: 'superseded', elements: ['calm:mcp-server'] });
    const { data } = parseFrontmatter(fs.readFileSync(filePath, 'utf8'));
    expect(data.status).toBe('superseded');
    expect(data.elements).toEqual(['calm:mcp-server']);
    expect(data.system).toBe('make-the-grade');
    expect(memIndex[key]).toMatchObject({ status: 'superseded', system: 'make-the-grade' });
  });

  it('export and import preserve the fields', () => {
    storeMemory({ title: 'Exported', content: 'x', category: 'decisions', ...SPEC });
    const archive = exportMemories({});
    expect(archive.memories[0]).toMatchObject(SPEC);
    reset();
    const res = importMemories({ memories: archive.memories });
    expect(res.imported).toBe(1);
    expect(memIndex['decisions/exported']).toMatchObject(SPEC);
  });
});
