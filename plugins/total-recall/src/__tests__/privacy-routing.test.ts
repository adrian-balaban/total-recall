import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Behavioural checks for architecture/adl/data-governance.adl.
// Note where the filter sits: store_memory writes an org-tagged file to the org
// vault locally; the fail-closed privacy filter gates the git sync
// (scripts/sync-org-memory.mjs), not the local write.

vi.hoisted(() => {
  process.env.HOME = '/tmp/tr-privacy-routing-' + process.pid;
});

import { storeMemory } from '../tools/store.js';
import { memIndex } from '../state.js';
import { privacyCheck } from '../privacy-filter.js';

const TEST_HOME = process.env.HOME!;
const TR_DIR = path.join(TEST_HOME, '.total-recall');
const PERSONAL = path.join(TR_DIR, 'personal-vault');
const ORG_VAULT = path.join(TR_DIR, 'org', 'org-vault');
const ME = os.userInfo().username;

function files(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : [p];
  }).filter((f) => f.endsWith('.md'));
}

function reset() {
  for (const k of Object.keys(memIndex)) delete memIndex[k];
  fs.rmSync(TR_DIR, { recursive: true, force: true });
  fs.mkdirSync(PERSONAL, { recursive: true });
  fs.mkdirSync(ORG_VAULT, { recursive: true });
  fs.writeFileSync(path.join(TR_DIR, 'config.json'), JSON.stringify({ orgRepo: 'git@example.com:org/memories.git' }));
}

describe('data governance', () => {
  beforeEach(reset);
  afterEach(() => fs.rmSync(TR_DIR, { recursive: true, force: true }));

  it('[TR-D1] a memory tagged org is written to the org vault only', () => {
    storeMemory({ title: 'Shared decision', content: 'Use Postgres for the ledger.', tags: ['org'], category: 'decisions' });
    expect(files(ORG_VAULT).map((f) => path.basename(f))).toEqual(['shared-decision.md']);
    expect(files(PERSONAL)).toEqual([]);
  });

  it('[TR-D2] a memory without the org tag is written to the personal vault only', () => {
    storeMemory({ title: 'My note', content: 'Prefer short answers.', tags: ['prefs'], category: 'knowledge' });
    expect(files(PERSONAL).map((f) => path.basename(f))).toContain('my-note.md');
    expect(files(ORG_VAULT)).toEqual([]);
  });

  it('[TR-D3] the privacy filter fails closed: a secret, a stray email or a card number blocks the sync', () => {
    const fm = { title: 'Shared decision', tags: ['org'], author: ME };
    expect(privacyCheck(fm, 'key: sk-abcdefghijklmnopqrstuvwxyz0123')).toMatch(/secret/);
    expect(privacyCheck(fm, 'ask me at someone@personal-mail.example')).toMatch(/email/);
    expect(privacyCheck(fm, 'card 4111 1111 1111 1111')).toMatch(/credit card/);
    // a hidden secret in a custom frontmatter key is scanned too
    expect(privacyCheck({ ...fm, apikey: 'ghp_' + 'a'.repeat(36) } as never, 'clean body')).toMatch(/secret/);
    expect(privacyCheck(fm, 'Use Postgres for the ledger.')).toBeNull();
  });

  it('[TR-D4] an org memory authored by someone else cannot be overwritten, even with force', () => {
    const file = path.join(ORG_VAULT, 'decisions', 'foreign.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '---\ntitle: "Foreign"\ntags: [org]\nauthor: "someone-else"\n---\n\nbody\n');
    expect(() =>
      storeMemory({ title: 'Foreign', content: 'hijack', tags: ['org'], category: 'decisions', force: true }),
    ).toThrow(/someone-else/);
    expect(fs.readFileSync(file, 'utf8')).toContain('body');
  });
});
