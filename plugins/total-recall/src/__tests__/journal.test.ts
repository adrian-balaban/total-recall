import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// appendJournal writes to PERSONAL_VAULT/journal/<today>.md, a fixed path under
// the user's real ~/.total-recall. Redirect HOME to a tmp dir BEFORE any module
// import — paths.ts captures os.homedir() exactly once at module load (same
// vi.hoisted pattern as index.test.ts).
vi.hoisted(() => {
  process.env.HOME = '/tmp/tr-journal-' + process.pid;
});

// appendFileSync is a PASS-THROUGH spy, not an always-throwing stub. The
// failure-path test below opts into throwing for a single call via
// mockImplementationOnce; everything else performs the real append so the happy
// path (filename, entry format, append-vs-overwrite) is observable.
//
// Why one file and not two: Stryker's vitest runner disables isolation, so the
// module registry is SHARED across test files. A sibling file that imported
// journal.js with the real fs would win the cache, this file's vi.mock('fs')
// would never apply to it, and the spy assertion below would see 0 calls — the
// dry run then fails and no mutation score can be produced at all. Keep every
// journal case here. Spread the real fs so ensureDir (mkdirSync) and
// assertRegularFile (lstatSync) keep working.
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, appendFileSync: vi.fn(actual.appendFileSync) };
});

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { appendJournal } from '../journal.js';
import { PERSONAL_VAULT } from '../paths.js';

const JOURNAL_DIR = path.join(PERSONAL_VAULT, 'journal');
const journalFile = () =>
  path.join(JOURNAL_DIR, `${new Date().toISOString().slice(0, 10)}.md`);

// Plant nothing across cases: the symlink/directory cases below would otherwise
// make a later append return early at assertRegularFile.
beforeEach(() => { fs.rmSync(JOURNAL_DIR, { recursive: true, force: true }); });
afterEach(() => {
  fs.rmSync(JOURNAL_DIR, { recursive: true, force: true });
  vi.mocked(fs.appendFileSync).mockClear();
});

describe('appendJournal', () => {
  // The journal append is the LAST step of store_memory, AFTER the .md file,
  // memIndex update, and scheduleSave() have already succeeded — so the memory
  // is already durable when we get here. assertRegularFile guards the symlink/dir
  // case, but a TOCTOU between lstat and append, ENOSPC (disk full), or EACCES
  // must NOT throw into store_memory: the dispatch catch in server.ts would
  // surface it as isError and the agent would retry — creating a DUPLICATE memory
  // at the same key (store_memory throws on duplicate without force). The
  // appendFileSync try/catch swallows; a missed journal line is cosmetic.
  it('does not throw when fs.appendFileSync fails (best-effort journal)', () => {
    vi.mocked(fs.appendFileSync).mockImplementationOnce(() => {
      throw new Error('ENOSPC: no space left on device');
    });
    expect(() => appendJournal('store', 'knowledge/foo', 'Title')).not.toThrow();
    expect(fs.appendFileSync).toHaveBeenCalledTimes(1);
  });

  describe('real write path', () => {
    it('writes to journal/<today>.md, named by the UTC date', () => {
      appendJournal('store', 'knowledge/foo', 'A Title');
      expect(fs.existsSync(journalFile())).toBe(true);
      // Pins the `.slice(0, 10)` arguments: a YYYY-MM-DD basename, nothing
      // longer (a full ISO timestamp) or shorter (a truncated year).
      expect(path.basename(journalFile())).toMatch(/^\d{4}-\d{2}-\d{2}\.md$/);
    });

    it('records the action, title and key in the entry', () => {
      appendJournal('store', 'knowledge/foo', 'A Title');
      const body = fs.readFileSync(journalFile(), 'utf8');
      expect(body).toContain('[store]');
      expect(body).toContain('**A Title**');
      expect(body).toContain('`knowledge/foo`');
      expect(body).toMatch(/- \d{4}-\d{2}-\d{2}T[\d:.]+Z \[store\]/);
    });

    it('appends rather than overwriting, preserving earlier entries', () => {
      appendJournal('store', 'knowledge/one', 'First');
      appendJournal('update', 'knowledge/two', 'Second');
      const body = fs.readFileSync(journalFile(), 'utf8');
      expect(body).toContain('**First**');
      expect(body).toContain('**Second**');
      expect(body).toContain('[update]');
      expect(body.trim().split('\n').filter(Boolean)).toHaveLength(2);
    });

    it('creates the journal directory when it does not yet exist', () => {
      expect(fs.existsSync(JOURNAL_DIR)).toBe(false);
      appendJournal('store', 'knowledge/foo', 'Title');
      expect(fs.statSync(JOURNAL_DIR).isDirectory()).toBe(true);
    });
  });

  // assertRegularFile guards: a symlink or directory planted at the journal path
  // must make appendJournal return early — silently, and without ever reaching
  // the append. Kills removal of the try/catch-return around assertRegularFile.
  describe('assertRegularFile guard', () => {
    it('skips silently when a symlink is planted at the journal path', () => {
      fs.mkdirSync(JOURNAL_DIR, { recursive: true });
      const target = path.join(os.tmpdir(), `tr-journal-target-${process.pid}.md`);
      fs.writeFileSync(target, 'pre-existing\n');
      fs.symlinkSync(target, journalFile());

      expect(() => appendJournal('store', 'knowledge/foo', 'Title')).not.toThrow();
      expect(fs.appendFileSync).not.toHaveBeenCalled();
      // The symlink target must be untouched — the write was skipped, not followed.
      expect(fs.readFileSync(target, 'utf8')).toBe('pre-existing\n');
      fs.rmSync(target, { force: true });
    });

    it('skips silently when a directory is planted at the journal path', () => {
      fs.mkdirSync(journalFile(), { recursive: true });
      expect(() => appendJournal('store', 'knowledge/foo', 'Title')).not.toThrow();
      expect(fs.appendFileSync).not.toHaveBeenCalled();
      expect(fs.statSync(journalFile()).isDirectory()).toBe(true);
    });
  });
});
