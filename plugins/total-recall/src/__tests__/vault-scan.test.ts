import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// readMemoryContent is a pure file-IO helper (assertRegularFile + readFileSync +
// parseFrontmatter); it does not touch memIndex, contentCache, or vault paths.
// Override HOME before the transitive module loads anyway — paths.ts captures
// os.homedir() at load, and while readMemoryContent never uses it, the import
// graph pulls paths.ts in — keep the real ~/.total-recall untouched (mirrors
// index.test.ts's defensive hoist).
vi.hoisted(() => {
  process.env.HOME = '/tmp/tr-rmc-' + process.pid;
});

import { readMemoryContent, readCachedOrFresh } from '../vault-scan.js';
import { contentCache } from '../lru-cache.js';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-rmc-'));

// Symlinks are needed for the swapped-symlink / dangling-link / symlinked-dir
// fixtures. Skip those on a FS that disallows symlinks (mirrors the CAN_SYMLINK
// guard in index.test.ts / hook-scripts.test.ts).
const CAN_SYMLINK = (() => {
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-sym-'));
    fs.symlinkSync('nonexistent-target', path.join(d, 'link'));
    fs.rmSync(d, { recursive: true, force: true });
    return true;
  } catch { return false; }
})();

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe('readMemoryContent', () => {
  it('returns the body (frontmatter stripped) for a real .md file', () => {
    const fp = path.join(TMP, 'real.md');
    fs.writeFileSync(fp, '---\ntitle: "Real"\ntags: [a]\n---\n\nThe body text.\n');
    // parseFrontmatter leaves the leading \n after the closing --- in place — the
    // body is "\nThe body text.\n", exactly what callers cache and return.
    expect(readMemoryContent(fp, 'knowledge/real')).toBe('\nThe body text.\n');
  });

  it('returns a multi-line body verbatim', () => {
    const fp = path.join(TMP, 'multi.md');
    fs.writeFileSync(fp, '---\ntitle: "Multi"\n---\n\nLine one.\nLine two.\n\nLine four.\n');
    expect(readMemoryContent(fp, 'knowledge/multi')).toBe('\nLine one.\nLine two.\n\nLine four.\n');
  });

  it('returns "" for an empty-bodied memory (the null/"" split — empty body is a valid read, NOT a failure)', () => {
    // Frontmatter with no body. readMemoryContent must return "" (a present
    // string) so callers that cache on success cache the empty body and callers
    // that fail-closed on null do NOT mistake it for a read error. This is the
    // whole point of returning string | null rather than string | undefined with
    // a truthy check: "" is a hit, null is a miss.
    const fp = path.join(TMP, 'empty.md');
    fs.writeFileSync(fp, '---\ntitle: "Empty"\ntags: []\n---\n');
    expect(readMemoryContent(fp, 'knowledge/empty')).toBe('');
  });

  it('returns null for a missing file (ENOENT)', () => {
    // assertRegularFile's lstatSync throws ENOENT, which it lets through (file
    // removed since load is fine); readFileSync then also throws ENOENT and the
    // helper's catch returns null. Either way the caller sees null.
    const fp = path.join(TMP, 'nope.md');
    expect(readMemoryContent(fp, 'knowledge/nope')).toBeNull();
  });

  it('returns null for a directory path (not a regular file)', () => {
    const fp = path.join(TMP, 'adir');
    fs.mkdirSync(fp, { recursive: true });
    // assertRegularFile: lstatSync(dir).isFile() is false → throws → re-thrown
    // (no ENOENT code) → helper catch → null.
    expect(readMemoryContent(fp, 'knowledge/adir')).toBeNull();
  });

  it('returns null for a symlink swapped onto a victim file and does NOT leak the target body', () => {
    if (!CAN_SYMLINK) return; // FS disallows symlinks — skip
    // The Pass-6 read-path threat: a teammate swaps an already-indexed regular
    // file for a symlink → ~/.ssh/id_rsa (or any victim-readable file) via the
    // org vault's git pull, AFTER the boot-time reconcileIndex that rejects
    // symlinks at scan. readMemoryContent's assertRegularFile lstats the entry
    // itself (isFile()=false for a symlink) → rejects → null, never following the
    // link, so the victim body never reaches `content` (-> MCP response -> LLM).
    const victim = path.join(TMP, 'victim.txt');
    fs.writeFileSync(victim, 'TOPSECRET-LEAK');
    const link = path.join(TMP, 'leak.md');
    fs.symlinkSync(victim, link);
    const result = readMemoryContent(link, 'knowledge/leak');
    expect(result).toBeNull();
    // Defense-in-depth: even if the null contract held but a future change made
    // assertRegularFile's throw non-fatal, the TOPSECRET body must never surface.
    expect(result ?? '').not.toContain('TOPSECRET-LEAK');
  });

  it('returns null for a symlink to a directory', () => {
    if (!CAN_SYMLINK) return;
    const targetDir = path.join(TMP, 'target-dir');
    fs.mkdirSync(targetDir, { recursive: true });
    const link = path.join(TMP, 'dirlink.md');
    fs.symlinkSync(targetDir, link);
    expect(readMemoryContent(link, 'knowledge/dirlink')).toBeNull();
  });

  it('returns null for a dangling symlink (lstat succeeds, isFile()=false)', () => {
    if (!CAN_SYMLINK) return;
    const link = path.join(TMP, 'dangling.md');
    fs.symlinkSync(path.join(TMP, 'nonexistent-target'), link);
    // lstatSync on a dangling link stats the link itself (succeeds), isFile() is
    // false → assertRegularFile throws → re-thrown (no ENOENT code on the thrown
    // Error) → helper catch → null. The ENOENT-from-target readFileSync path is
    // never reached because assertRegularFile rejects first.
    expect(readMemoryContent(link, 'knowledge/dangling')).toBeNull();
  });
});

describe('readCachedOrFresh', () => {
  // Clear cache before each test so prior tests' entries don't bleed in.
  beforeEach(() => contentCache.delete('k-' + Math.random()));

  it("returns 'fresh' and caches a real read", () => {
    const key = 'k-fresh';
    const fp = path.join(TMP, 'fresh.md');
    fs.writeFileSync(fp, '---\ntitle: "Fresh"\n---\n\nhello\n');
    const r = readCachedOrFresh(key, fp);
    expect(r).toEqual({ status: 'fresh', content: '\nhello\n' });
    expect(contentCache.get(key)).toBe('\nhello\n');
  });

  it("returns 'hit' on a subsequent call without re-reading", () => {
    const key = 'k-hit';
    const fp = path.join(TMP, 'hit.md');
    fs.writeFileSync(fp, '---\ntitle: "Hit"\n---\n\nworld\n');
    readCachedOrFresh(key, fp); // prime the cache
    const r = readCachedOrFresh(key, fp);
    expect(r.status).toBe('hit');
    expect(r.content).toBe('\nworld\n');
  });

  it("returns 'failed' on a vanished file and does NOT cache", () => {
    const key = 'k-failed';
    const fp = path.join(TMP, 'vanished.md'); // never created
    const r = readCachedOrFresh(key, fp);
    expect(r).toEqual({ status: 'failed', content: '' });
    expect(contentCache.get(key)).toBeUndefined();
  });

  it("onEmpty='reread' re-reads a cached ''", () => {
    const key = 'k-reread';
    const fp = path.join(TMP, 'reread.md');
    // First, prime the cache with a real body so we can override it.
    fs.writeFileSync(fp, '---\ntitle: "R"\n---\n\nbody\n');
    readCachedOrFresh(key, fp); // status: fresh, caches '\nbody\n'
    contentCache.set(key, ''); // simulate a later empty body being cached
    const r = readCachedOrFresh(key, fp, 'reread');
    expect(r.status).toBe('fresh');
    expect(r.content).toBe('\nbody\n');
  });

  it("onEmpty='hit' returns a cached '' as a HIT (default policy)", () => {
    const key = 'k-hitempty';
    const fp = path.join(TMP, 'hitempty.md');
    contentCache.set(key, '');
    const r = readCachedOrFresh(key, fp);
    expect(r).toEqual({ status: 'hit', content: '' });
  });
});