import { describe, it, expect, vi, afterEach } from 'vitest';

// appendJournal writes to PERSONAL_VAULT/journal/<today>.md, a fixed path under
// the user's real ~/.total-recall. Redirect HOME to a tmp dir BEFORE any module
// import — paths.ts captures os.homedir() exactly once at module load (same
// vi.hoisted pattern as index.test.ts).
vi.hoisted(() => {
  process.env.HOME = '/tmp/tr-journal-' + process.pid;
});

// Force fs.appendFileSync to throw: the fix under test is the try/catch in
// appendJournal that swallows an ENOSPC / EACCES / TOCTOU failure so it never
// surfaces as isError on a store_memory call (which would trigger a duplicate-
// key retry). Spread the real fs so ensureDir (mkdirSync) and assertRegularFile
// (lstatSync) keep working — only the append is forced to fail.
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    appendFileSync: vi.fn(() => {
      throw new Error('ENOSPC: no space left on device');
    }),
  };
});

import * as fs from 'fs';
import { appendJournal } from '../journal.js';

afterEach(() => vi.mocked(fs.appendFileSync).mockClear());

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
    expect(() => appendJournal('store', 'knowledge/foo', 'Title')).not.toThrow();
    expect(fs.appendFileSync).toHaveBeenCalledTimes(1);
  });
});