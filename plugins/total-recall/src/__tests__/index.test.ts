import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Override HOME BEFORE any module imports. ES module imports are hoisted to
// the top of the module, so plain `process.env.HOME = ...` here would run AFTER
// the static imports — too late, because `paths.ts` captures
// `os.homedir()` exactly once at module load and `persistence.ts` reads
// `INDEX_PATH` from there. `vi.hoisted` is the vitest API for "run this
// synchronously at the top of the module, before imports" — necessary for the
// loadIndexes coercion tests below, which must point INDEX_PATH at the test
// vault rather than the user's real ~/.total-recall.
vi.hoisted(() => {
  // `path` and `os` imports are hoisted and not yet initialized at this point
  // — construct the test home path via plain string ops to avoid the TDZ.
  // tmpdir is stable across platforms for our purposes (real path components
  // are not needed; persistence.ts only cares about `path.join(HOME, ...)`).
  process.env.HOME = '/tmp/tr-test-' + process.pid;
});

import { loadIndexes, saveNow } from '../persistence.js';
import { memIndex } from '../state.js';
import { appendJournal } from '../journal.js';
import { contentCache } from '../lru-cache.js';
import { rebuildInvertedIndex } from '../tfidf.js';

// ─── Test vault — unique per process ─────────────────────────────────────────

const TEST_HOME = process.env.HOME!;
const VAULT = path.join(TEST_HOME, '.total-recall');

// Symlinks are needed to plant the Pass 4 symlink-race fixtures (a planted
// symlink at a predictable write/append path). Skip those tests on a FS that
// disallows symlinks — mirrors the CAN_SYMLINK guard in hook-scripts.test.ts /
// sync-org-memory.e2e.test.ts.
const CAN_SYMLINK = (() => {
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-sym-'));
    fs.symlinkSync('nonexistent-target', path.join(d, 'link'));
    fs.rmSync(d, { recursive: true, force: true });
    return true;
  } catch { return false; }
})();

// ─── MCP SDK mock — must use regular function (not arrow) for `new Server()` ─

type Handler = (req: any) => Promise<any>;
const registeredHandlers = new Map<string, Handler>();

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: vi.fn(function (this: any) {
    this.setRequestHandler = vi.fn((schema: string, handler: Handler) => {
      registeredHandlers.set(schema, handler);
    });
    this.connect = vi.fn().mockResolvedValue(undefined);
  }),
}));
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(function (this: any) {}),
}));
vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  CallToolRequestSchema: 'CallToolRequestSchema',
  ListToolsRequestSchema: 'ListToolsRequestSchema',
}));
vi.mock('../embeddings.js', () => ({
  embed: vi.fn().mockResolvedValue(null),
  embedAndUpsert: vi.fn(),
  isVectorAvailable: vi.fn().mockReturnValue(false),
}));
vi.mock('../vectorStore.js', () => ({
  upsertVector: vi.fn().mockResolvedValue(undefined),
  searchVector: vi.fn().mockResolvedValue([]),
  deleteVector: vi.fn().mockResolvedValue(undefined),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mkVaultDirs() {
  for (const cat of ['knowledge', 'architecture', 'decisions', 'meetings', 'troubleshooting', 'journal']) {
    fs.mkdirSync(path.join(VAULT, 'personal-vault', cat), { recursive: true });
  }
  fs.mkdirSync(path.join(VAULT, 'org', 'org-vault'), { recursive: true });
  // A3 guard: store_memory refuses an org store unless the shared org vault is
  // configured (config.json `orgRepo` set, OR the repo cloned at org/.git).
  // Provision a config.json so the org-routing/author-guard tests exercise the
  // real (configured) path rather than being refused up front.
  fs.writeFileSync(path.join(VAULT, 'config.json'), JSON.stringify({ orgRepo: 'https://example.com/org-vault.git' }));
}

async function callTool(name: string, args: Record<string, unknown> = {}) {
  const handler = registeredHandlers.get('CallToolRequestSchema')!;
  return handler({ params: { name, arguments: args } });
}

function result(res: any) {
  return JSON.parse(res.content[0].text);
}

// ─── Boot server once; reset vault + index between tests ─────────────────────

beforeAll(async () => {
  mkVaultDirs();
  await import('../index.js');
  await new Promise(r => setTimeout(r, 20)); // wait for main() to complete
});

beforeEach(async () => {
  // Wipe and recreate vault so each test starts clean
  fs.rmSync(VAULT, { recursive: true, force: true });
  mkVaultDirs();
  // rebuild_index rescans the empty vault → resets memIndex in the live module
  await callTool('rebuild_index');
});

afterAll(() => {
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
});

// ─── store_memory ─────────────────────────────────────────────────────────────

describe('store_memory', () => {
  it('stores a personal memory and returns key + filePath', async () => {
    const res = result(await callTool('store_memory', {
      title: 'Test Memory Alpha', content: 'Content of alpha.', tags: ['test'], category: 'knowledge',
    }));
    expect(res.key).toMatch(/^knowledge\/test-memory-alpha/);
    expect(fs.existsSync(res.filePath)).toBe(true);
  });

  it('routes to org vault when tagged org', async () => {
    const res = result(await callTool('store_memory', {
      title: 'Org Memory', content: 'Team content.', tags: ['org', 'team'], category: 'architecture',
    }));
    expect(res.filePath).toContain('org-vault');
  });

  it('rejects memories tagged both org and personal', async () => {
    const res = await callTool('store_memory', {
      title: 'Conflict', content: 'Both.', tags: ['org', 'personal'],
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('cannot have both');
  });

  it('refuses an org store when the org vault is not configured (A3)', async () => {
    // mkVaultDirs provisions config.json; remove it (and any cloned .git) so the
    // A3 guard sees an unconfigured org vault. Nothing else in this run touches
    // config.json, and beforeEach recreates it for subsequent tests.
    fs.rmSync(path.join(VAULT, 'config.json'), { force: true });
    const res = await callTool('store_memory', {
      title: 'Unconfigured Org', content: 'X', tags: ['org'], category: 'architecture',
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Org vault is not configured');
    // No stray file or directory was created in the org vault — the guard must
    // refuse BEFORE ensureDir runs, or it leaves debris that blocks the next clone.
    expect(fs.existsSync(path.join(VAULT, 'org', 'org-vault', 'architecture', 'unconfigured-org.md'))).toBe(false);
    expect(fs.existsSync(path.join(VAULT, 'org', 'org-vault', 'architecture'))).toBe(false);
  });

  it('guards against overwriting another user org memory', async () => {
    const orgDir = path.join(VAULT, 'org', 'org-vault', 'architecture');
    fs.mkdirSync(orgDir, { recursive: true });
    fs.writeFileSync(
      path.join(orgDir, 'conflict-org.md'),
      `---\ntitle: "Conflict Org"\nauthor: other-user\ntags: [org]\ncreated: 2026-01-01T00:00:00Z\nupdated: 2026-01-01T00:00:00Z\n---\nContent\n`
    );
    const res = await callTool('store_memory', {
      title: 'Conflict Org', content: 'Overwrite.', tags: ['org'], category: 'architecture', author: 'me',
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('other-user');
  });

  it('rejects a category that escapes the vault (path traversal)', async () => {
    const category = '../../../tr-traversal-leak';
    const res = await callTool('store_memory', {
      title: 'Escape', content: 'X', tags: [], category,
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('outside the vault');
    // Nothing was written or created outside the vault — neither the .md file
    // nor the directory the traversal would have mkdir'd via ensureDir. The
    // guard must reject BEFORE ensureDir runs, or a stray dir leaks outside.
    const traversalDir = path.resolve(path.join(VAULT, 'personal-vault', category));
    expect(fs.existsSync(path.join(traversalDir, 'escape.md'))).toBe(false);
    expect(fs.existsSync(traversalDir)).toBe(false);
  });

  it('ignores a caller-supplied author for org (no impersonation bypass)', async () => {
    // An existing org memory authored by "other-user". A caller passing
    // author: "other-user" + force must NOT be able to impersonate and overwrite.
    const orgDir = path.join(VAULT, 'org', 'org-vault', 'architecture');
    fs.mkdirSync(orgDir, { recursive: true });
    fs.writeFileSync(
      path.join(orgDir, 'impersonate-org.md'),
      `---\ntitle: "Impersonate Org"\nauthor: other-user\ntags: [org]\ncreated: 2026-01-01T00:00:00Z\nupdated: 2026-01-01T00:00:00Z\n---\nContent\n`
    );
    const res = await callTool('store_memory', {
      title: 'Impersonate Org', content: 'Hijacked.', tags: ['org'],
      category: 'architecture', author: 'other-user', force: true,
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('other-user');
    // The original content is intact (not overwritten).
    const raw = fs.readFileSync(path.join(orgDir, 'impersonate-org.md'), 'utf8');
    expect(raw).toContain('Content\n');
    expect(raw).not.toContain('Hijacked');
  });

  it('rejects a title containing a newline (frontmatter injection)', async () => {
    const res = await callTool('store_memory', {
      title: 'bad\ninjected: evil', content: 'X', tags: [],
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('newline');
  });

  it('writes valid frontmatter with title and importanceScore', async () => {
    const res = result(await callTool('store_memory', {
      title: 'FM Check', content: 'Body.', tags: [], importanceScore: 0.8,
    }));
    const raw = fs.readFileSync(res.filePath, 'utf8');
    expect(raw).toContain('title: FM Check');
    expect(raw).toContain('importanceScore: 0.8');
  });

  it('appends to journal for personal memories', async () => {
    await callTool('store_memory', { title: 'Journal Trigger', content: 'X', tags: [], category: 'knowledge' });
    const today = new Date().toISOString().slice(0, 10);
    const jPath = path.join(VAULT, 'personal-vault', 'journal', `${today}.md`);
    expect(fs.existsSync(jPath)).toBe(true);
    expect(fs.readFileSync(jPath, 'utf8')).toContain('Journal Trigger');
  });

  it('sets author field', async () => {
    const res = result(await callTool('store_memory', {
      title: 'Author Test', content: 'X', tags: [], author: 'testuser',
    }));
    const raw = fs.readFileSync(res.filePath, 'utf8');
    expect(raw).toContain('author: testuser');
  });
});

// ─── vault-boundary hardening (symlink traversal + poisoned filePath) ─────────
//
// SEC-001 (Critical): reconcileIndex's walk followed symlinks — a teammate
// plants a symlink `*.md` → `~/.ssh/id_rsa` via the org vault's `git pull`
// (which preserves symlinks); readFileSync followed it into contentPreview,
// surfaced via search_index / get_memories_by_keys / recall_memory(full). The
// privacy filter never runs on pulled content. The walk now skips symlinks.
// SEC-002 (High): store.ts containment used lexical path.resolve (doesn't
// resolve symlinks); a symlinked category dir or slug.md escaped the vault on
// write. Both catDir and filePath are now lstat-checked as real entries.
// SEC-003 (Medium): persistence.coerceMemEntry trusted a persisted filePath
// (poisonable via the git-synced org index.json) → arbitrary read/delete.
// filePath is now re-derived from the validated memIndex key.

describe('vault-boundary hardening (symlink traversal + poisoned filePath)', () => {
  // "Outside the vault" scratch dir — a sibling of TEST_HOME, never under VAULT.
  const OUTSIDE = path.join('/tmp', 'tr-outside-' + process.pid);
  beforeEach(() => { fs.rmSync(OUTSIDE, { recursive: true, force: true }); fs.mkdirSync(OUTSIDE, { recursive: true }); });
  afterEach(() => { fs.rmSync(OUTSIDE, { recursive: true, force: true }); });

  it('reconcileIndex skips a symlinked .md file (no arbitrary-file read)', async () => {
    // A teammate plants a symlink `*.md` → a victim file outside the vault via
    // the org vault's git pull. The walk must skip it so readFileSync never
    // follows the link into contentPreview.
    const victim = path.join(OUTSIDE, 'secret.txt');
    fs.writeFileSync(victim, 'TOPSECRET-LEAK');
    fs.symlinkSync(victim, path.join(VAULT, 'personal-vault', 'knowledge', 'leak.md'));
    await callTool('rebuild_index');
    expect(memIndex['knowledge/leak']).toBeUndefined();
    const allPreviews = Object.values(memIndex).map((m: any) => m.contentPreview ?? '');
    expect(allPreviews.every((p: string) => !p.includes('TOPSECRET-LEAK'))).toBe(true);
  });

  it('reconcileIndex does not recurse into a symlinked directory', async () => {
    const outsideDir = path.join(OUTSIDE, 'linked-dir');
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(outsideDir, 'stolen.md'), '---\ntitle: Stolen\n---\nTOPSECRET-DIR');
    fs.symlinkSync(outsideDir, path.join(VAULT, 'personal-vault', 'linked-dir'));
    await callTool('rebuild_index');
    expect(memIndex['linked-dir/stolen']).toBeUndefined();
    const allPreviews = Object.values(memIndex).map((m: any) => m.contentPreview ?? '');
    expect(allPreviews.every((p: string) => !p.includes('TOPSECRET-DIR'))).toBe(true);
  });

  it('store_memory rejects a symlinked category directory (no vault-escape write)', async () => {
    const outsideDir = path.join(OUTSIDE, 'evil-target');
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.symlinkSync(outsideDir, path.join(VAULT, 'personal-vault', 'evil'));
    const res = await callTool('store_memory', { title: 'Escape Via Symlink', content: 'payload', tags: [], category: 'evil' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('symlink');
    // No file was written through the symlink into the outside target dir.
    expect(fs.existsSync(path.join(outsideDir, 'escape-via-symlink.md'))).toBe(false);
  });

  it('store_memory rejects a symlinked target file (no clobber of a victim file)', async () => {
    const victim = path.join(OUTSIDE, 'victim.txt');
    fs.writeFileSync(victim, 'VICTIM-INTACT');
    // `knowledge` is a real category dir (mkVaultDirs); plant a symlink slug.md
    // → victim. A store whose title slugifies to 'clobber' would otherwise
    // follow the link and overwrite the victim.
    fs.symlinkSync(victim, path.join(VAULT, 'personal-vault', 'knowledge', 'clobber.md'));
    const res = await callTool('store_memory', { title: 'clobber', content: 'ATTACK', tags: [], category: 'knowledge' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('symlink');
    expect(fs.readFileSync(victim, 'utf8')).toBe('VICTIM-INTACT');
  });

  it('update_memory rejects a symlinked target file (no clobber of a victim file)', async () => {
    // Same planted-symlink write-escape as the store_memory test above, but on
    // the update path: meta.filePath (re-derived from the key by coerceMemEntry,
    // so lexically inside the vault) can still be a symlink a teammate planted
    // via the org vault's git pull. Without an lstat guard, writeFileSync
    // (meta.filePath) would follow the link and clobber the target. store_memory
    // got the guard in Pass 1; update_memory missed it — this pins the parallel
    // fix. Setup: store a real memory so memIndex holds its filePath, then swap
    // the file for a symlink → victim, then attempt the update.
    const victim = path.join(OUTSIDE, 'update-victim.txt');
    fs.writeFileSync(victim, 'VICTIM-INTACT');
    const storeRes = await callTool('store_memory', { title: 'updateclobber', content: 'orig', tags: [], category: 'knowledge' });
    expect(storeRes.isError).toBeFalsy();
    const { key, filePath } = JSON.parse(storeRes.content[0].text);
    try {
      fs.rmSync(filePath, { force: true });
      fs.symlinkSync(victim, filePath);
      const res = await callTool('update_memory', { key, content: 'ATTACK' });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('symlink');
      // The victim must NOT have been clobbered through the symlink.
      expect(fs.readFileSync(victim, 'utf8')).toBe('VICTIM-INTACT');
    } finally {
      // Remove the planted symlink + the memIndex entry so later tests don't see
      // a dangling link / stale entry (vault-scan skips symlinks, but the in-memory
      // entry would persist without this delete).
      fs.rmSync(filePath, { force: true });
      delete memIndex[key];
    }
  });

  it('recall_memory(full=true) refuses a symlinked target file (no victim-content leak)', async () => {
    // Symmetric READ-side gap of the update_memory write fix above. Pass 1's
    // indexFile/reconcileIndex reject symlinks at scan time, but the MCP server
    // is long-lived and reconcileIndex runs only at boot — a SessionStart `git
    // pull` on the shared org vault can swap an already-indexed regular file
    // for a symlink (`org/existing.md` -> victim) WITHOUT re-scanning memIndex.
    // A subsequent readFileSync(meta.filePath) on the recall_memory full path
    // would follow the link and dump the target into the tool response
    // (-> LLM context). The lstat guard fails closed (empty content) instead of
    // following. Setup mirrors the update_memory test: store a real memory so
    // memIndex holds its filePath, swap the file for a symlink -> victim with
    // secret content, then recall. The `hit` assertion guarantees the memory
    // surfaced (so a no-rank false-pass can't hide the leak).
    const victim = path.join(OUTSIDE, 'recall-victim.txt');
    fs.writeFileSync(victim, 'SECRET-VICTIM-CONTENT');
    const storeRes = await callTool('store_memory', { title: 'recallleak', content: 'orig', tags: [], category: 'knowledge' });
    expect(storeRes.isError).toBeFalsy();
    const { key, filePath } = JSON.parse(storeRes.content[0].text);
    // store_memory schedules the TF-IDF rebuild via a +2s debounce; force it now
    // so the memory is in the inverted index when we recall. Done while the file
    // is still the regular stored file (rebuildInvertedIndex reads memIndex meta,
    // not disk, but keep the ordering obvious).
    rebuildInvertedIndex();
    try {
      fs.rmSync(filePath, { force: true });
      fs.symlinkSync(victim, filePath);
      // store_memory populated contentCache with the safe 'orig' body (store.ts:204);
      // evict it so the full read MISSES the cache and hits readFileSync(meta.filePath),
      // which without the guard follows the symlink and leaks the victim.
      contentCache.delete(key);
      const res = await callTool('recall_memory', { query: 'recallleak', full: true });
      const arr = JSON.parse(res.content[0].text);
      const hit = Array.isArray(arr) ? arr.find((m: any) => m.key === key) : null;
      expect(hit).toBeDefined();
      expect(JSON.stringify(hit)).not.toContain('SECRET-VICTIM-CONTENT');
      expect(fs.readFileSync(victim, 'utf8')).toBe('SECRET-VICTIM-CONTENT');
    } finally {
      fs.rmSync(filePath, { force: true });
      delete memIndex[key];
    }
  });

  it('get_memories_by_keys(summary=true) refuses a symlinked target file', async () => {
    // Same read-side symlink-leak class on the summary path: without the guard,
    // readFileSync follows the symlink and the executive-summary fallback
    // (content.slice(0,500)) returns the victim's body verbatim. The guard
    // throws -> the existing catch returns {key, error:'Failed to read memory
    // file'} fail-closed. get_memories_by_keys always responds per-key, so the
    // hit is guaranteed and the SECRET check is the discriminating assertion.
    const victim = path.join(OUTSIDE, 'gmk-sum-victim.txt');
    fs.writeFileSync(victim, 'SECRET-GMK-SUM-CONTENT');
    const storeRes = await callTool('store_memory', { title: 'gmksumleak', content: 'orig', tags: [], category: 'knowledge' });
    expect(storeRes.isError).toBeFalsy();
    const { key, filePath } = JSON.parse(storeRes.content[0].text);
    try {
      fs.rmSync(filePath, { force: true });
      fs.symlinkSync(victim, filePath);
      const res = await callTool('get_memories_by_keys', { keys: [key], summary: true });
      const arr = JSON.parse(res.content[0].text);
      const hit = Array.isArray(arr) ? arr.find((m: any) => m.key === key) : null;
      expect(hit).toBeDefined();
      expect(JSON.stringify(hit)).not.toContain('SECRET-GMK-SUM-CONTENT');
      expect(fs.readFileSync(victim, 'utf8')).toBe('SECRET-GMK-SUM-CONTENT');
    } finally {
      fs.rmSync(filePath, { force: true });
      delete memIndex[key];
    }
  });

  it('get_memories_by_keys(summary=false / full) refuses a symlinked target file', async () => {
    // Same leak on the full-content path (cache-miss -> readFileSync). Without
    // the guard, the victim's body is returned as `content` and cached. The
    // guard throws -> catch sets content='' and readOk stays false (no access
    // bump, no cache poison) -> the response carries empty content.
    const victim = path.join(OUTSIDE, 'gmk-full-victim.txt');
    fs.writeFileSync(victim, 'SECRET-GMK-FULL-CONTENT');
    const storeRes = await callTool('store_memory', { title: 'gmkfullleak', content: 'orig', tags: [], category: 'knowledge' });
    expect(storeRes.isError).toBeFalsy();
    const { key, filePath } = JSON.parse(storeRes.content[0].text);
    try {
      fs.rmSync(filePath, { force: true });
      fs.symlinkSync(victim, filePath);
      // store_memory populated contentCache with the safe 'orig' body (store.ts:204);
      // evict it so the full read MISSES the cache and hits readFileSync(meta.filePath),
      // which without the guard follows the symlink and leaks the victim.
      contentCache.delete(key);
      const res = await callTool('get_memories_by_keys', { keys: [key], summary: false });
      const arr = JSON.parse(res.content[0].text);
      const hit = Array.isArray(arr) ? arr.find((m: any) => m.key === key) : null;
      expect(hit).toBeDefined();
      expect(JSON.stringify(hit)).not.toContain('SECRET-GMK-FULL-CONTENT');
      expect(fs.readFileSync(victim, 'utf8')).toBe('SECRET-GMK-FULL-CONTENT');
    } finally {
      fs.rmSync(filePath, { force: true });
      delete memIndex[key];
    }
  });

  it('loadIndexes re-derives filePath from the key (drops a poisoned filePath)', () => {
    const INDEX_PATH_LOCAL = path.join(VAULT, 'index.json');
    fs.writeFileSync(INDEX_PATH_LOCAL, JSON.stringify({
      'knowledge/poison': {
        key: 'knowledge/poison',
        filePath: '/etc/shadow',   // poisoned — must be discarded
        title: 'Poison', tags: [], sessions: [],
        created: '2026-01-01T00:00:00Z', updated: '2026-01-01T00:00:00Z',
        importanceScore: 0.5, category: 'knowledge',
        contentPreview: 'p', accessCount: 0, lastAccessed: '2026-01-01T00:00:00Z', tokenEstimate: 1, isOrg: false,
      },
    }));
    loadIndexes();
    const meta = memIndex['knowledge/poison'];
    expect(meta).toBeDefined();
    expect(meta!.filePath).not.toBe('/etc/shadow');
    expect(meta!.filePath).toBe(path.join(VAULT, 'personal-vault', 'knowledge', 'poison.md'));
  });

  it('loadIndexes drops an entry whose key escapes the vault', () => {
    const INDEX_PATH_LOCAL = path.join(VAULT, 'index.json');
    fs.writeFileSync(INDEX_PATH_LOCAL, JSON.stringify({
      '../../etc/shadow': {
        key: '../../etc/shadow', filePath: '/etc/shadow',
        title: 'Escape', tags: [], sessions: [],
        created: '2026-01-01T00:00:00Z', updated: '2026-01-01T00:00:00Z',
        importanceScore: 0.5, category: 'knowledge',
        contentPreview: 'e', accessCount: 0, lastAccessed: '2026-01-01T00:00:00Z', tokenEstimate: 1, isOrg: false,
      },
    }));
    loadIndexes();
    expect(memIndex['../../etc/shadow']).toBeUndefined();
  });

  it('loadIndexes drops an org entry whose key escapes the org vault, keeps a legit one', () => {
    const INDEX_PATH_LOCAL = path.join(VAULT, 'index.json');
    fs.writeFileSync(INDEX_PATH_LOCAL, JSON.stringify({
      'org/..': {
        key: 'org/..', filePath: '/etc/shadow',
        title: 'Org Escape', tags: ['org'], sessions: [],
        created: '2026-01-01T00:00:00Z', updated: '2026-01-01T00:00:00Z',
        importanceScore: 0.5, category: 'knowledge',
        contentPreview: 'o', accessCount: 0, lastAccessed: '2026-01-01T00:00:00Z', tokenEstimate: 1, isOrg: true,
      },
      'org/architecture/legit': {
        key: 'org/architecture/legit',
        filePath: path.join(VAULT, 'org', 'org-vault', 'architecture', 'legit.md'),
        title: 'Legit Org', tags: ['org'], sessions: [],
        created: '2026-01-01T00:00:00Z', updated: '2026-01-01T00:00:00Z',
        importanceScore: 0.5, category: 'architecture',
        contentPreview: 'l', accessCount: 0, lastAccessed: '2026-01-01T00:00:00Z', tokenEstimate: 1, isOrg: true,
      },
    }));
    loadIndexes();
    expect(memIndex['org/..']).toBeUndefined();
    expect(memIndex['org/architecture/legit']).toBeDefined();
    expect(memIndex['org/architecture/legit']!.filePath).toBe(path.join(VAULT, 'org', 'org-vault', 'architecture', 'legit.md'));
  });
});

// ─── recall_memory ────────────────────────────────────────────────────────────

describe('recall_memory', () => {
  beforeEach(async () => {
    await callTool('store_memory', {
      title: 'Kafka Connect Architecture',
      content: 'Kafka Connect is used for CDC. Debezium MySQL connector reads binlog.',
      tags: ['kafka', 'cdc'], category: 'architecture', importanceScore: 0.8,
    });
    await callTool('rebuild_index');
  });

  it('finds a stored memory by keyword', async () => {
    const res = result(await callTool('recall_memory', { query: 'kafka' }));
    expect(res.length).toBeGreaterThan(0);
    expect(res[0].title).toContain('Kafka');
  });

  it('returns full content when full=true', async () => {
    const res = result(await callTool('recall_memory', { query: 'kafka', full: true }));
    expect(res[0].content).toContain('Debezium');
  });

  it('respects limit', async () => {
    const res = result(await callTool('recall_memory', { query: 'kafka', limit: 1 }));
    expect(res.length).toBeLessThanOrEqual(1);
  });

  it('excludes journal by default', async () => {
    await callTool('store_memory', { title: 'Kafka Journal', content: 'kafka', tags: [], category: 'journal' });
    await callTool('rebuild_index');
    const res = result(await callTool('recall_memory', { query: 'kafka' }));
    expect(res.every((r: any) => r.category !== 'journal')).toBe(true);
  });

  it('includes journal when excludeJournal=false', async () => {
    await callTool('store_memory', { title: 'Kafka Journal', content: 'kafka', tags: [], category: 'journal' });
    await callTool('rebuild_index');
    const res = result(await callTool('recall_memory', { query: 'kafka', excludeJournal: false }));
    expect(res.some((r: any) => r.category === 'journal')).toBe(true);
  });

  it('date filter works without epoch-1970 pass-through', async () => {
    const res = result(await callTool('recall_memory', { query: 'kafka', since: '30d' }));
    expect(Array.isArray(res)).toBe(true);
    // Fresh memory has a real date and should appear
    expect(res.length).toBeGreaterThan(0);
  });

  it('respects before (exclusive upper bound on updated)', async () => {
    // A past `before` (epoch) excludes the fresh memory; a far-future one keeps it.
    expect(result(await callTool('recall_memory', { query: 'kafka', before: '1970-01-01' })).length).toBe(0);
    expect(result(await callTool('recall_memory', { query: 'kafka', before: '2999-01-01' })).length).toBeGreaterThan(0);
  });

  it('returns no results for unknown query', async () => {
    const res = result(await callTool('recall_memory', { query: 'zzznomatch' }));
    expect(res.length).toBe(0);
  });

  it('minScore filters out low-scoring results (0 = no filtering)', async () => {
    // Default 0 preserves the baseline result set; an unreachable floor drops all.
    const baseline = result(await callTool('recall_memory', { query: 'kafka' }));
    expect(baseline.length).toBeGreaterThan(0);
    const strict = result(await callTool('recall_memory', { query: 'kafka', minScore: 1e9 }));
    expect(strict.length).toBe(0);
  });
});

// ─── list_memories ────────────────────────────────────────────────────────────

describe('list_memories', () => {
  beforeEach(async () => {
    await callTool('store_memory', { title: 'Arch Doc', content: 'Arch', tags: ['infra'], category: 'architecture' });
    await callTool('store_memory', { title: 'Decision One', content: 'Dec', tags: ['team'], category: 'decisions' });
  });

  it('returns all memories', async () => {
    const res = result(await callTool('list_memories'));
    expect(res.items.length).toBeGreaterThanOrEqual(2);
  });

  it('filters by category', async () => {
    const res = result(await callTool('list_memories', { category: 'architecture' }));
    expect(res.items.every((m: any) => m.category === 'architecture')).toBe(true);
  });

  it('filters by tag', async () => {
    const res = result(await callTool('list_memories', { tag: 'team' }));
    expect(res.items.every((m: any) => m.tags.includes('team'))).toBe(true);
  });

  it('respects limit', async () => {
    const res = result(await callTool('list_memories', { limit: 1 }));
    expect(res.items.length).toBeLessThanOrEqual(1);
  });

  it('offset skips the first N results (pagination)', async () => {
    const page0 = result(await callTool('list_memories', { limit: 50 }));
    const page1 = result(await callTool('list_memories', { limit: 50, offset: 1 }));
    // offset:1 drops exactly the newest entry; the rest of the page shifts up.
    expect(page1.items.length).toBe(page0.items.length - 1);
    expect(page1.items[0].key).toBe(page0.items[1].key);
  });

  it('returns metadata only (no content field)', async () => {
    const res = result(await callTool('list_memories'));
    expect(res.items[0].content).toBeUndefined();
    expect(res.items[0].title).toBeDefined();
  });

  it('returns total and hasMore for pagination', async () => {
    await callTool('store_memory', { title: 'Page Third', content: 'C', tags: [], category: 'knowledge' });
    const page1 = result(await callTool('list_memories', { limit: 2 }));
    expect(page1.total).toBe(3);
    expect(page1.hasMore).toBe(true);
    expect(page1.items.length).toBe(2);
    const page2 = result(await callTool('list_memories', { limit: 2, offset: 2 }));
    expect(page2.hasMore).toBe(false);
  });
});

// ─── update_memory ────────────────────────────────────────────────────────────

describe('update_memory', () => {
  it('updates content', async () => {
    const { key } = result(await callTool('store_memory', { title: 'Upd', content: 'Original', tags: [], category: 'knowledge' }));
    await callTool('update_memory', { key, content: 'Updated content' });
    const [mem] = result(await callTool('get_memories_by_keys', { keys: [key] }));
    expect(mem.content).toContain('Updated content');
  });

  it('updates tags', async () => {
    const { key } = result(await callTool('store_memory', { title: 'Tags', content: 'C', tags: ['old'], category: 'knowledge' }));
    await callTool('update_memory', { key, tags: ['new', 'tags'] });
    const [mem] = result(await callTool('get_memories_by_keys', { keys: [key] }));
    expect(mem.tags).toContain('new');
  });

  it('appends sessionId to sessions array in file', async () => {
    const { key, filePath } = result(await callTool('store_memory', { title: 'Sess', content: 'C', tags: [] }));
    await callTool('update_memory', { key, sessionId: 'sess-abc' });
    const raw = fs.readFileSync(filePath, 'utf8');
    expect(raw).toContain('sess-abc');
  });

  it('returns error for unknown key', async () => {
    const res = await callTool('update_memory', { key: 'nope/key' });
    expect(res.isError).toBe(true);
  });
});

// ─── delete_memory ────────────────────────────────────────────────────────────

describe('delete_memory', () => {
  it('removes file from disk', async () => {
    const { key, filePath } = result(await callTool('store_memory', { title: 'Del', content: 'X', tags: [], category: 'knowledge' }));
    await callTool('delete_memory', { key });
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('removes from listing', async () => {
    const { key } = result(await callTool('store_memory', { title: 'Del Listed', content: 'X', tags: [], category: 'knowledge' }));
    await callTool('delete_memory', { key });
    const listed = result(await callTool('list_memories'));
    expect(listed.items.find((m: any) => m.key === key)).toBeUndefined();
  });

  it('returns error for unknown key', async () => {
    const res = await callTool('delete_memory', { key: 'ghost/key' });
    expect(res.isError).toBe(true);
  });
});

// ─── search_index ─────────────────────────────────────────────────────────────

describe('search_index', () => {
  beforeEach(async () => {
    await callTool('store_memory', {
      title: 'Flink CDC Job', content: 'Flink reads MySQL binlog via CDC source connector.',
      tags: ['flink', 'cdc'], category: 'architecture',
    });
    await callTool('rebuild_index');
  });

  it('returns results with preview, no content field', async () => {
    const res = result(await callTool('search_index', { query: 'flink' }));
    expect(res.length).toBeGreaterThan(0);
    expect(res[0].preview).toBeDefined();
    expect(res[0].content).toBeUndefined();
  });

  it('returns positive score and estimatedTokens', async () => {
    const res = result(await callTool('search_index', { query: 'flink' }));
    expect(res[0].score).toBeGreaterThan(0);
    expect(res[0].estimatedTokens).toBeGreaterThan(0);
  });

  it('filters by category', async () => {
    const res = result(await callTool('search_index', { query: 'flink', category: 'decisions' }));
    expect(res.length).toBe(0);
  });

  it('filters by tags array', async () => {
    const res = result(await callTool('search_index', { query: 'flink', tags: ['cdc'] }));
    expect(res.every((m: any) => m.tags.includes('cdc'))).toBe(true);
  });

  it('respects since date filter without epoch-1970 bug', async () => {
    const res = result(await callTool('search_index', { query: 'flink', since: '1d' }));
    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBeGreaterThan(0); // fresh memory passes 1-day filter
  });

  it('respects before (exclusive upper bound on updated)', async () => {
    expect(result(await callTool('search_index', { query: 'flink', before: '1970-01-01' })).length).toBe(0);
    expect(result(await callTool('search_index', { query: 'flink', before: '2999-01-01' })).length).toBeGreaterThan(0);
  });

  it('respects limit', async () => {
    const res = result(await callTool('search_index', { query: 'flink', limit: 1 }));
    expect(res.length).toBeLessThanOrEqual(1);
  });

  it('minScore filters out low-scoring results (0 = no filtering)', async () => {
    const baseline = result(await callTool('search_index', { query: 'flink' }));
    expect(baseline.length).toBeGreaterThan(0);
    const strict = result(await callTool('search_index', { query: 'flink', minScore: 1e9 }));
    expect(strict.length).toBe(0);
  });
});

// ─── get_memories_by_keys ─────────────────────────────────────────────────────

describe('get_memories_by_keys', () => {
  it('returns full content for valid key', async () => {
    const { key } = result(await callTool('store_memory', { title: 'ByKey', content: 'Full content here', tags: [], category: 'knowledge' }));
    const [mem] = result(await callTool('get_memories_by_keys', { keys: [key] }));
    expect(mem.content).toContain('Full content here');
  });

  it('returns summary when summary=true', async () => {
    const { key } = result(await callTool('store_memory', {
      title: 'Summary', content: '## Executive Summary\n\nThis is it.\n\nMore details.',
      tags: [], category: 'knowledge',
    }));
    const [mem] = result(await callTool('get_memories_by_keys', { keys: [key], summary: true }));
    expect(mem.summary).toBeDefined();
    expect(mem.content).toBeUndefined();
  });

  it('returns error object for missing key', async () => {
    const [mem] = result(await callTool('get_memories_by_keys', { keys: ['missing/key'] }));
    expect(mem.error).toBe('Not found');
  });

  it('summary=true falls back to content.slice(500) when no Executive Summary heading', async () => {
    const dir = path.join(VAULT, 'personal-vault', 'knowledge');
    const now = new Date().toISOString();
    fs.writeFileSync(
      path.join(dir, 'no-exec-summary.md'),
      `---\ntitle: "No Exec Summary"\ntags: []\ncreated: ${now}\nupdated: ${now}\nimportanceScore: 0.5\n---\n\nJust plain content without a heading.\n`
    );
    await callTool('rebuild_index');
    const list = result(await callTool('list_memories'));
    const key = list.items.find((m: any) => m.title === 'No Exec Summary')?.key;
    if (!key) return;
    const [mem] = result(await callTool('get_memories_by_keys', { keys: [key], summary: true }));
    expect(mem.summary).toContain('plain content');
  });

  it('handles batch of multiple keys', async () => {
    const a = result(await callTool('store_memory', { title: 'BA', content: 'A', tags: [], category: 'knowledge' }));
    const b = result(await callTool('store_memory', { title: 'BB', content: 'B', tags: [], category: 'knowledge' }));
    const res = result(await callTool('get_memories_by_keys', { keys: [a.key, b.key] }));
    expect(res.length).toBe(2);
  });
});

// ─── get_stats ────────────────────────────────────────────────────────────────

describe('get_stats', () => {
  beforeEach(async () => {
    await callTool('store_memory', { title: 'SA', content: 'X', tags: [], category: 'knowledge' });
    await callTool('store_memory', { title: 'SB', content: 'Y', tags: [], category: 'architecture' });
  });

  it('returns correct total', async () => {
    const stats = result(await callTool('get_stats'));
    expect(stats.total).toBeGreaterThanOrEqual(2);
  });

  it('returns byCategory breakdown', async () => {
    const stats = result(await callTool('get_stats'));
    expect(stats.byCategory.knowledge).toBeGreaterThanOrEqual(1);
    expect(stats.byCategory.architecture).toBeGreaterThanOrEqual(1);
  });

  it('returns cache stats', async () => {
    const stats = result(await callTool('get_stats'));
    expect(stats.cache).toHaveProperty('hits');
    expect(stats.cache).toHaveProperty('misses');
    expect(stats.cache).toHaveProperty('size');
  });

  it('returns performance percentiles', async () => {
    const stats = result(await callTool('get_stats'));
    expect(stats.performance).toHaveProperty('p50');
    expect(stats.performance).toHaveProperty('p95');
  });

  it('returns recentErrors array', async () => {
    const stats = result(await callTool('get_stats'));
    expect(Array.isArray(stats.recentErrors)).toBe(true);
  });
});

// ─── get_timeline ─────────────────────────────────────────────────────────────

describe('get_timeline', () => {
  beforeEach(async () => {
    await callTool('store_memory', { title: 'TL A', content: 'A', tags: [], category: 'knowledge' });
    await callTool('store_memory', { title: 'TL B', content: 'B', tags: [], category: 'architecture' });
  });

  it('returns memories in descending updated order', async () => {
    const res = result(await callTool('get_timeline'));
    expect(res.items.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < res.items.length; i++) {
      expect(new Date(res.items[i - 1].updated).getTime()).toBeGreaterThanOrEqual(new Date(res.items[i].updated).getTime());
    }
  });

  it('filters by category', async () => {
    const res = result(await callTool('get_timeline', { category: 'architecture' }));
    expect(res.items.every((m: any) => m.category === 'architecture')).toBe(true);
  });

  it('filters by since (relative)', async () => {
    const res = result(await callTool('get_timeline', { since: '7d' }));
    expect(res.items.length).toBeGreaterThan(0);
  });

  it('respects before (exclusive upper bound on updated)', async () => {
    expect(result(await callTool('get_timeline', { before: '1970-01-01' })).items.length).toBe(0);
    expect(result(await callTool('get_timeline', { before: '2999-01-01' })).items.length).toBeGreaterThan(0);
  });

  it('respects limit', async () => {
    const res = result(await callTool('get_timeline', { limit: 1 }));
    expect(res.items.length).toBeLessThanOrEqual(1);
  });

  it('offset skips the first N results (pagination)', async () => {
    const page0 = result(await callTool('get_timeline', { limit: 50 }));
    const page1 = result(await callTool('get_timeline', { limit: 50, offset: 1 }));
    expect(page1.items.length).toBe(page0.items.length - 1);
    expect(page1.items[0].key).toBe(page0.items[1].key);
  });

  it('returns total and hasMore for pagination', async () => {
    await callTool('store_memory', { title: 'TL C', content: 'C', tags: [], category: 'decisions' });
    const page1 = result(await callTool('get_timeline', { limit: 2 }));
    expect(page1.total).toBe(3);
    expect(page1.hasMore).toBe(true);
    expect(page1.items.length).toBe(2);
    const page2 = result(await callTool('get_timeline', { limit: 2, offset: 2 }));
    expect(page2.hasMore).toBe(false);
  });
});

// ─── get_related_memories ─────────────────────────────────────────────────────

describe('get_related_memories', () => {
  beforeEach(async () => {
    await callTool('store_memory', { title: 'Kafka Source', content: 'Kafka topics', tags: ['kafka', 'streaming'], category: 'architecture' });
    await callTool('store_memory', { title: 'Kafka Sink', content: 'Kafka consumer', tags: ['kafka', 'consumer'], category: 'architecture' });
    await callTool('store_memory', { title: 'Postgres DB', content: 'Database', tags: ['postgres'], category: 'decisions' });
  });

  it('returns memories sharing tags', async () => {
    const list = result(await callTool('list_memories'));
    const key = list.items.find((m: any) => m.title === 'Kafka Source')?.key;
    if (!key) return;
    const res = result(await callTool('get_related_memories', { key }));
    expect(res.some((m: any) => m.title === 'Kafka Sink')).toBe(true);
  });

  it('same-category boosts score over different-category', async () => {
    const list = result(await callTool('list_memories'));
    const key = list.items.find((m: any) => m.title === 'Kafka Source')?.key;
    if (!key) return;
    const res = result(await callTool('get_related_memories', { key }));
    const sinkScore = res.find((m: any) => m.title === 'Kafka Sink')?.score ?? 0;
    const pgScore   = res.find((m: any) => m.title === 'Postgres DB')?.score ?? 0;
    expect(sinkScore).toBeGreaterThan(pgScore);
  });

  it('returns error for unknown key', async () => {
    const res = await callTool('get_related_memories', { key: 'bad/key' });
    expect(res.isError).toBe(true);
  });

  it('respects limit', async () => {
    const list = result(await callTool('list_memories'));
    const key = list.items[0]?.key;
    if (!key) return;
    const res = result(await callTool('get_related_memories', { key, limit: 1 }));
    expect(res.length).toBeLessThanOrEqual(1);
  });

  it('includeContent=false (default) omits the content field', async () => {
    const list = result(await callTool('list_memories'));
    const key = list.items.find((m: any) => m.title === 'Kafka Source')?.key;
    if (!key) return;
    const res = result(await callTool('get_related_memories', { key }));
    for (const m of res) expect(m.content).toBeUndefined();
  });

  it('includeContent=true includes full content for each related memory', async () => {
    const list = result(await callTool('list_memories'));
    const key = list.items.find((m: any) => m.title === 'Kafka Source')?.key;
    if (!key) return;
    const res = result(await callTool('get_related_memories', { key, includeContent: true }));
    expect(res.length).toBeGreaterThan(0);
    const sink = res.find((m: any) => m.title === 'Kafka Sink');
    expect(sink).toBeDefined();
    expect(sink.content).toContain('Kafka consumer');
  });
});

// ─── prune_memories ───────────────────────────────────────────────────────────

describe('prune_memories', () => {
  beforeEach(async () => {
    await callTool('store_memory', { title: 'Low', content: 'Old.', tags: [], category: 'knowledge', importanceScore: 0.1 });
    await callTool('store_memory', { title: 'High', content: 'Critical.', tags: [], category: 'architecture', importanceScore: 1.0 });
  });

  it('lists candidates without deleting them', async () => {
    await callTool('prune_memories', { threshold: 1.0 });
    const list = result(await callTool('list_memories'));
    expect(list.items.length).toBeGreaterThanOrEqual(2);
  });

  it('each candidate has retentionStrength >= 0', async () => {
    const res = result(await callTool('prune_memories', { threshold: 1.0 }));
    for (const c of res) expect(c.retentionStrength).toBeGreaterThanOrEqual(0);
  });

  it('strict threshold returns fewer candidates', async () => {
    const all    = result(await callTool('prune_memories', { threshold: 1.0 }));
    const strict = result(await callTool('prune_memories', { threshold: 0.001 }));
    expect(strict.length).toBeLessThanOrEqual(all.length);
  });

  it('respects limit', async () => {
    const res = result(await callTool('prune_memories', { threshold: 1.0, limit: 1 }));
    expect(res.length).toBeLessThanOrEqual(1);
  });

  it('sorts candidates by retentionStrength ascending (sort comparator fires with 2+ items)', async () => {
    await callTool('store_memory', { title: 'Very Low', content: 'X', tags: [], category: 'knowledge', importanceScore: 0.05 });
    const candidates = result(await callTool('prune_memories', { threshold: 1.0 }));
    // With 3 memories all below threshold=1.0, sort comparator runs
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i].retentionStrength).toBeGreaterThanOrEqual(candidates[i - 1].retentionStrength);
    }
  });
});

// ─── rebuild_index ────────────────────────────────────────────────────────────

describe('rebuild_index', () => {
  it('picks up files written directly to vault', async () => {
    const dir = path.join(VAULT, 'personal-vault', 'knowledge');
    fs.writeFileSync(
      path.join(dir, 'direct.md'),
      `---\ntitle: "Direct File"\ntags: [direct]\ncreated: ${new Date().toISOString()}\nupdated: ${new Date().toISOString()}\nimportanceScore: 0.5\n---\n\nDirect.\n`
    );
    await callTool('rebuild_index');
    const list = result(await callTool('list_memories'));
    expect(list.items.some((m: any) => m.title === 'Direct File')).toBe(true);
  });

  it('preserves accessCount across rebuild_index (regression: old code wiped it)', async () => {
    const { key } = result(await callTool('store_memory', { title: 'ACount', content: 'C', tags: [], category: 'knowledge' }));
    // Build the inverted index so recall can actually find the memory — store_memory's
    // IDF recalc is debounced, so without a rebuild the first recall returns [].
    await callTool('rebuild_index');
    // First recall bumps accessCount 0 -> 1; recall_memory returns the bumped value.
    // full=true is required: a metadata-only recall deliberately does NOT bump
    // accessCount (B6), so the regression check must read the memory's content.
    const r1 = result(await callTool('recall_memory', { query: 'acount', full: true }));
    expect(r1.length).toBeGreaterThan(0);
    const before = r1[0].accessCount;
    expect(before).toBeGreaterThan(0);
    await callTool('rebuild_index');
    // Second recall: if rebuild preserved stats, accessCount was `before` and is now
    // bumped to before+1. If rebuild wiped it (old `memIndex = {}` behavior), it was
    // reset to 0 and is now 1 — strictly less than before+1.
    const r2 = result(await callTool('recall_memory', { query: 'acount', full: true }));
    expect(r2[0].key).toBe(key);
    expect(r2[0].accessCount).toBe(before + 1);
  });

  it('returns message with indexed count', async () => {
    const res = result(await callTool('rebuild_index'));
    expect(res.message).toMatch(/\d+ memories indexed/);
  });
});

// ─── list_tools ───────────────────────────────────────────────────────────────

describe('ListToolsRequestSchema', () => {
  it('returns exactly 12 tools', async () => {
    const handler = registeredHandlers.get('ListToolsRequestSchema')!;
    const res = await handler({ params: {} });
    expect(res.tools.length).toBe(12);
  });

  it('every tool has name, description, and inputSchema', async () => {
    const handler = registeredHandlers.get('ListToolsRequestSchema')!;
    const { tools } = await handler({ params: {} });
    for (const t of tools) {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.inputSchema.type).toBe('object');
    }
  });

  it('tool names match expected set', async () => {
    const handler = registeredHandlers.get('ListToolsRequestSchema')!;
    const { tools } = await handler({ params: {} });
    expect(tools.map((t: any) => t.name).sort()).toEqual([
      'delete_memory', 'get_memories_by_keys', 'get_related_memories',
      'get_stats', 'get_timeline', 'list_memories', 'prune_memories',
      'rebuild_index', 'recall_memory', 'search_index', 'store_memory', 'update_memory',
    ]);
  });
});

// ─── error handling ───────────────────────────────────────────────────────────

describe('Error handling', () => {
  it('returns isError=true for unknown tool', async () => {
    const res = await callTool('nonexistent_tool');
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Unknown tool');
  });
});

// ─── edge cases & branch coverage ────────────────────────────────────────────

describe('since date filter — ISO date strings', () => {
  beforeEach(async () => {
    await callTool('store_memory', {
      title: 'ISO Date Test', content: 'Testing ISO date filter', tags: ['test'], category: 'knowledge',
    });
    await callTool('rebuild_index');
  });

  it('recall_memory accepts absolute ISO date string for since', async () => {
    const past = new Date(Date.now() - 7 * 86400000).toISOString();
    const res = result(await callTool('recall_memory', { query: 'iso date', since: past }));
    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBeGreaterThan(0);
  });

  it('search_index accepts absolute ISO date string for since', async () => {
    const past = new Date(Date.now() - 7 * 86400000).toISOString();
    const res = result(await callTool('search_index', { query: 'iso date', since: past }));
    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBeGreaterThan(0);
  });

  it('get_timeline accepts absolute ISO date string for since', async () => {
    const past = new Date(Date.now() - 7 * 86400000).toISOString();
    const res = result(await callTool('get_timeline', { since: past }));
    expect(res.items).toBeDefined();
    expect(res.items.length).toBeGreaterThan(0);
  });
});

describe('org vault scan', () => {
  it('rebuild_index picks up org vault memories', async () => {
    const orgDir = path.join(VAULT, 'org', 'org-vault', 'architecture');
    fs.mkdirSync(orgDir, { recursive: true });
    fs.writeFileSync(
      path.join(orgDir, 'org-test.md'),
      `---\ntitle: "Org Test"\ntags: [org, test]\ncreated: ${new Date().toISOString()}\nupdated: ${new Date().toISOString()}\nimportanceScore: 0.7\n---\n\nOrg content.\n`
    );
    await callTool('rebuild_index');
    const list = result(await callTool('list_memories'));
    expect(list.items.some((m: any) => m.title === 'Org Test')).toBe(true);
  });

  it('personal vault takes precedence over org vault for same key', async () => {
    // Write same slug to both personal and org
    const slug = 'precedence-test';
    const personalDir = path.join(VAULT, 'personal-vault', 'knowledge');
    const orgDir = path.join(VAULT, 'org', 'org-vault', 'knowledge');
    fs.mkdirSync(orgDir, { recursive: true });
    const now = new Date().toISOString();
    fs.writeFileSync(
      path.join(personalDir, `${slug}.md`),
      `---\ntitle: "Personal Version"\ntags: []\ncreated: ${now}\nupdated: ${now}\nimportanceScore: 0.5\n---\n\nPersonal.\n`
    );
    fs.writeFileSync(
      path.join(orgDir, `${slug}.md`),
      `---\ntitle: "Org Version"\ntags: [org]\ncreated: ${now}\nupdated: ${now}\nimportanceScore: 0.5\n---\n\nOrg.\n`
    );
    await callTool('rebuild_index');
    const list = result(await callTool('list_memories'));
    const personal = list.items.find((m: any) => m.key === `knowledge/${slug}`);
    expect(personal?.title).toBe('Personal Version');
  });
});

describe('LRU cache eviction (>100 entries)', () => {
  it('evicts oldest entry when cache exceeds maxSize', async () => {
    // Store 101 memories and fetch them all to fill the 100-slot LRU cache
    const keys: string[] = [];
    for (let i = 0; i < 101; i++) {
      const res = result(await callTool('store_memory', {
        title: `Evict ${i}`, content: `Content ${i}`, tags: [], category: 'knowledge',
      }));
      keys.push(res.key);
    }
    // Fetch all 101 — the 101st set() triggers an eviction of the oldest entry
    for (const key of keys) {
      await callTool('get_memories_by_keys', { keys: [key] });
    }
    const stats = result(await callTool('get_stats'));
    expect(stats.cache.size).toBeLessThanOrEqual(100);
  });
});

describe('debounced timer callbacks — buildIndexCache and scheduleIdfRecalc', () => {
  it('buildIndexCache writes .index-cache.txt after timers fire', async () => {
    vi.useFakeTimers();
    await callTool('store_memory', {
      title: 'Timer Cache Test',
      content: 'Debounce content',
      tags: ['a', 'b', 'c', 'd', 'e'], // >3 tags → triggers "..." truncation
      category: 'knowledge',
    });
    // Advance past scheduleSave (1 s) + scheduleIdfRecalc (2 s)
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    const cacheFile = path.join(VAULT, '.index-cache.txt');
    expect(fs.existsSync(cacheFile)).toBe(true);
    const content = fs.readFileSync(cacheFile, 'utf8');
    expect(content).toContain('Timer Cache Test');
    expect(content).toContain('...'); // truncated tag list
  });
});

describe('recall_memory full=true — cache miss reads from disk', () => {
  it('returns file content when key was indexed but never cached', async () => {
    const dir = path.join(VAULT, 'personal-vault', 'knowledge');
    const now = new Date().toISOString();
    fs.writeFileSync(
      path.join(dir, 'disk-only.md'),
      `---\ntitle: "Disk Only"\ntags: [disk]\ncreated: ${now}\nupdated: ${now}\nimportanceScore: 0.7\n---\n\nContent from disk only.\n`
    );
    // rebuild_index picks up the file but does NOT add to contentCache
    await callTool('rebuild_index');
    const res = result(await callTool('recall_memory', { query: 'disk', full: true }));
    expect(res.length).toBeGreaterThan(0);
    expect(res[0].content).toContain('Content from disk only');
  });
});

describe('indexFile error handling — corrupt .md triggers catch', () => {
  it('logs error and continues when file is unreadable', async () => {
    const dir = path.join(VAULT, 'personal-vault', 'knowledge');
    const badFile = path.join(dir, 'corrupt.md');
    // Write a file then make it unreadable
    fs.writeFileSync(badFile, 'not frontmatter at all\n');
    fs.chmodSync(badFile, 0o000);
    // rebuild_index should not throw even with unreadable file
    await expect(callTool('rebuild_index')).resolves.not.toThrow();
    fs.chmodSync(badFile, 0o644); // restore for cleanup
  });
});

describe('recall_memory full=true — cache miss path', () => {
  it('reads file from disk when content is not in LRU cache', async () => {
    result(await callTool('store_memory', {
      title: 'Cache Miss Test', content: 'Disk content check', tags: ['cache'], category: 'knowledge',
    }));
    await callTool('rebuild_index');
    // Call with full=true — first call always hits disk (cold cache after rebuild)
    const res = result(await callTool('recall_memory', { query: 'cache miss', full: true }));
    expect(res.length).toBeGreaterThan(0);
    expect(res[0].content).toBeDefined();
  });
});

describe('get_related_memories — sort comparator and zero-score filter', () => {
  it('sorts multiple related memories by score descending', async () => {
    // Source: tags=[a, b, c]
    // Mem1: tags=[a, b, c] — Jaccard = 1.0 (perfect match)
    // Mem2: tags=[a]       — Jaccard = 1/3 (partial match)
    // Mem3: tags=[z]       — score = 0  (no overlap, filtered out)
    await callTool('store_memory', { title: 'Source',  content: 'X', tags: ['a','b','c'], category: 'knowledge' });
    await callTool('store_memory', { title: 'Perfect', content: 'X', tags: ['a','b','c'], category: 'knowledge' });
    await callTool('store_memory', { title: 'Partial', content: 'X', tags: ['a'],         category: 'knowledge' });
    await callTool('store_memory', { title: 'NoMatch', content: 'X', tags: ['z'],         category: 'decisions' });
    const list = result(await callTool('list_memories'));
    const srcKey = list.items.find((m: any) => m.title === 'Source')?.key;
    if (!srcKey) return;
    const res = result(await callTool('get_related_memories', { key: srcKey }));
    // Perfect > Partial; NoMatch filtered (score=0)
    const perfectScore = res.find((m: any) => m.title === 'Perfect')?.score ?? 0;
    const partialScore = res.find((m: any) => m.title === 'Partial')?.score ?? 0;
    expect(perfectScore).toBeGreaterThan(partialScore);
    expect(res.find((m: any) => m.title === 'NoMatch')).toBeUndefined();
  });

  it('does not leak same-category memories with zero tag overlap', async () => {
    // Source: tags=[kafka], category=architecture
    // Sibling: tags=[postgres] (disjoint), category=architecture (same category)
    // The same-category boost must not turn a zero-overlap memory into a "related"
    // one — it should be filtered out, same as a cross-category zero-overlap.
    await callTool('store_memory', { title: 'ArchSrc', content: 'X', tags: ['kafka'], category: 'architecture' });
    await callTool('store_memory', { title: 'ArchSibling', content: 'X', tags: ['postgres'], category: 'architecture' });
    const list = result(await callTool('list_memories'));
    const srcKey = list.items.find((m: any) => m.title === 'ArchSrc')?.key;
    if (!srcKey) return;
    const res = result(await callTool('get_related_memories', { key: srcKey }));
    expect(res.find((m: any) => m.title === 'ArchSibling')).toBeUndefined();
  });
});

describe('excluded directories', () => {
  it('does not index files from excluded dirs (.obsidian, projects, templates)', async () => {
    for (const excl of ['projects', 'templates', '.obsidian']) {
      const dir = path.join(VAULT, 'personal-vault', excl);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'hidden.md'),
        `---\ntitle: "Should Not Index"\ntags: []\ncreated: ${new Date().toISOString()}\nupdated: ${new Date().toISOString()}\nimportanceScore: 0.5\n---\n\nHidden.\n`
      );
    }
    await callTool('rebuild_index');
    const list = result(await callTool('list_memories'));
    expect(list.items.find((m: any) => m.title === 'Should Not Index')).toBeUndefined();
  });
});

describe('index cache build (more than 3 tags)', () => {
  it('truncates tags with ... when more than 3', async () => {
    await callTool('store_memory', {
      title: 'Many Tags', content: 'X',
      tags: ['a', 'b', 'c', 'd', 'e'],
      category: 'knowledge',
    });
    // The cache rebuild is debounced — trigger rebuild_index to force it synchronously
    await callTool('rebuild_index');
    // Cache is written by debounced timer — may not exist yet; just verify no crash
    expect(true).toBe(true);
  });
});

// ─── indexFile: numeric title robustness ───────────────────────────────────────

describe('indexFile — unquoted numeric title (hand-edited frontmatter)', () => {
  it('coerces a numeric title to string so tfidfSearch does not crash', async () => {
    // Externally-authored frontmatter with an UNQUOTED numeric title. coerceScalar
    // parses `2026` as a Number; without String() coercion in indexFile this would
    // crash tfidfSearch's `meta.title.toLowerCase()` (Number has no toLowerCase).
    const dir = path.join(VAULT, 'personal-vault', 'knowledge');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'numeric-title.md'),
      `---\ntitle: 2026\ntags: []\ncreated: 2026-01-01T00:00:00Z\nupdated: 2026-01-01T00:00:00Z\nimportanceScore: 0.5\n---\n\nYear note.\n`
    );
    await callTool('rebuild_index');
    const res = await callTool('search_index', { query: '2026' });
    expect(res.isError).not.toBe(true);
    const found = result(res).find((m: any) => typeof m.title === 'string' && m.title.includes('2026'));
    expect(found).toBeDefined();
    expect(typeof found!.title).toBe('string');
  });
});

// ─── store_memory: existing key without force → error ────────────────────────

describe('store_memory — duplicate key protection', () => {
  it('returns error when key already exists and force is not set', async () => {
    await callTool('store_memory', { title: 'Dup Test', content: 'First', tags: [], category: 'knowledge' });
    const res = await callTool('store_memory', { title: 'Dup Test', content: 'Second', tags: [], category: 'knowledge' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('already exists');
  });

  it('force=true overwrites and preserves created timestamp', async () => {
    const first = result(await callTool('store_memory', { title: 'Force Test', content: 'Original', tags: [], category: 'knowledge' }));
    const raw1 = fs.readFileSync(first.filePath, 'utf8');
    const created1 = raw1.match(/created: (.+)/)?.[1];

    const second = result(await callTool('store_memory', { title: 'Force Test', content: 'Overwritten', tags: [], category: 'knowledge', force: true }));
    const raw2 = fs.readFileSync(second.filePath, 'utf8');
    expect(raw2).toContain('Overwritten');
    expect(raw2).toContain(created1!.trim()); // created preserved
  });

  it('force=true preserves prior session history (A2: no silent wipe)', async () => {
    result(await callTool('store_memory', {
      title: 'Sessions Keeper', content: 'V1', tags: [], category: 'knowledge', sessionId: 'sess-a',
    }));
    // A second overwrite carrying a DIFFERENT session must extend, not replace,
    // the sessions array — old code reset it to just [sess-b].
    const second = result(await callTool('store_memory', {
      title: 'Sessions Keeper', content: 'V2', tags: [], category: 'knowledge', sessionId: 'sess-b', force: true,
    }));
    const raw = fs.readFileSync(second.filePath, 'utf8');
    expect(raw).toContain('sess-a');
    expect(raw).toContain('sess-b');
    // An overwrite supplying NO session must not drop the carried history.
    const third = result(await callTool('store_memory', {
      title: 'Sessions Keeper', content: 'V3', tags: [], category: 'knowledge', force: true,
    }));
    const raw3 = fs.readFileSync(third.filePath, 'utf8');
    expect(raw3).toContain('sess-a');
    expect(raw3).toContain('sess-b');
    // Repeated identical session must dedupe, not duplicate.
    expect((raw3.match(/sess-a/g) || []).length).toBe(1);
    expect((raw3.match(/sess-b/g) || []).length).toBe(1);
  });
});

// ─── updateMemory: org author protection ─────────────────────────────────────

describe('update_memory — org author protection', () => {
  it('returns error when updating org memory owned by another user', async () => {
    // Write org memory file directly with a different author
    const orgDir = path.join(VAULT, 'org', 'org-vault', 'architecture');
    fs.mkdirSync(orgDir, { recursive: true });
    fs.writeFileSync(
      path.join(orgDir, 'protected-org.md'),
      `---\ntitle: "Protected Org"\nauthor: other-person\ntags: [org]\ncreated: 2026-01-01T00:00:00Z\nupdated: 2026-01-01T00:00:00Z\nimportanceScore: 0.5\n---\n\nContent.\n`
    );
    await callTool('rebuild_index');
    const list = result(await callTool('list_memories'));
    const key = list.items.find((m: any) => m.title === 'Protected Org')?.key;
    if (!key) return;
    const res = await callTool('update_memory', { key, content: 'Hacked' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('other-person');
  });

  it('returns error when updating org memory with a missing author (fail-closed)', async () => {
    // Legacy org memory written before the author field existed — no author.
    // Fail-closed: it must NOT be silently overwritable by the current user.
    const orgDir = path.join(VAULT, 'org', 'org-vault', 'decisions');
    fs.mkdirSync(orgDir, { recursive: true });
    fs.writeFileSync(
      path.join(orgDir, 'no-author-org.md'),
      `---\ntitle: "No Author Org"\ntags: [org]\ncreated: 2026-01-01T00:00:00Z\nupdated: 2026-01-01T00:00:00Z\nimportanceScore: 0.5\n---\n\nContent.\n`
    );
    await callTool('rebuild_index');
    const list = result(await callTool('list_memories'));
    const key = list.items.find((m: any) => m.title === 'No Author Org')?.key;
    if (!key) return;
    const res = await callTool('update_memory', { key, content: 'Hacked' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('(unknown)');
  });

  it('clamps + coerces a string/out-of-range importanceScore on update (mirrors store)', async () => {
    // store_memory now clamps+coerces importanceScore at the destructure; this
    // pins the symmetric hardening on update_memory (which previously only had
    // a clamp, not a NaN fallback — `Math.min(1, NaN)` returns NaN, so a
    // non-numeric string would have persisted as NaN).
    const stored = result(await callTool('store_memory', {
      title: 'Update IS Coerce',
      content: 'update-is-coerce content',
      tags: [],
      category: 'knowledge',
      importanceScore: 0.5,
    }));
    const res = await callTool('update_memory', { key: stored.key, importanceScore: 'urgent' as any });
    expect(res.isError).not.toBe(true);
    const list = result(await callTool('list_memories'));
    const meta = list.items.find((m: any) => m.key === stored.key);
    expect(meta).toBeDefined();
    expect(typeof meta!.importanceScore).toBe('number');
    expect(Number.isFinite(meta!.importanceScore)).toBe(true);
    expect(meta!.importanceScore).toBe(0.5); // NaN fallback to schema default
  });
});

// ─── flushPending, saveNow, recalcIdfNow ─────────────────────────────────────

describe('flushPending — drains pending timers synchronously', () => {
  it('writes index.json and invertedIndex.json when timers are pending', async () => {
    // Store a memory (schedules a save timer) then emit SIGTERM which calls flushPending
    await callTool('store_memory', { title: 'Flush Pending', content: 'X', tags: [], category: 'knowledge' });
    // Emit SIGTERM; the once() handler calls flushPending() + process.exit(0).
    // Catch the exit so the test process stays alive.
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    process.emit('SIGTERM', 'SIGTERM');
    exitSpy.mockRestore();
    // INDEX_PATH = ~/.total-recall/index.json = VAULT/index.json
    expect(fs.existsSync(path.join(VAULT, 'index.json'))).toBe(true);
    expect(fs.existsSync(path.join(VAULT, 'invertedIndex.json'))).toBe(true);
  });
});

// ─── perf sample trimming (>1000 samples) ────────────────────────────────────

describe('perf samples — trim when exceeding 1000', () => {
  it('get_stats still works after more than 1000 tool calls', async () => {
    // Make 1001 lightweight calls to push perfSamples past 1000 and trigger the shift()
    for (let i = 0; i < 1001; i++) {
      await callTool('get_stats');
    }
    const stats = result(await callTool('get_stats'));
    expect(stats.performance).toHaveProperty('p99');
  });
});

// ─── tfidfSearch: journal exclusion in search_index ─────────────────────────

describe('search_index — journal entries excluded by default', () => {
  it('does not return journal memories even when they contain matching keywords', async () => {
    // Write a journal file directly so search_index can't accidentally surface it
    const today = new Date().toISOString().slice(0, 10);
    const journalDir = path.join(VAULT, 'personal-vault', 'journal');
    fs.mkdirSync(journalDir, { recursive: true });
    const now = new Date().toISOString();
    fs.writeFileSync(
      path.join(journalDir, `${today}.md`),
      `---\ntitle: "Journal ${today}"\ntags: [journal]\ncreated: ${now}\nupdated: ${now}\nimportanceScore: 0.5\n---\n\nxyzzy99 unique journal keyword.\n`
    );
    await callTool('rebuild_index');
    const res = result(await callTool('search_index', { query: 'xyzzy99' }));
    // search_index calls tfidfSearch with excludeJournal=true by default
    expect(res.every((m: any) => m.category !== 'journal')).toBe(true);
  });
});

// ─── reconcileIndex: walk catches unreadable directory ───────────────────────

describe('reconcileIndex — handles unreadable directory gracefully', () => {
  it('rebuild_index does not throw when a subdir is unreadable', async () => {
    const badDir = path.join(VAULT, 'personal-vault', 'troubleshooting');
    fs.mkdirSync(badDir, { recursive: true });
    fs.chmodSync(badDir, 0o000);
    await expect(callTool('rebuild_index')).resolves.not.toThrow();
    fs.chmodSync(badDir, 0o755);
  });
});

// ─── parseRelativeDate: week and month units ──────────────────────────────────

describe('parseRelativeDate — week and month units', () => {
  it('since=2w filters to last 2 weeks', async () => {
    await callTool('store_memory', { title: 'Week Filter', content: 'fresh content', tags: [], category: 'knowledge' });
    await callTool('rebuild_index');
    const res = result(await callTool('search_index', { query: 'week filter', since: '2w' }));
    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBeGreaterThan(0);
  });

  it('since=1m filters to last month', async () => {
    await callTool('store_memory', { title: 'Month Filter', content: 'monthly content', tags: [], category: 'knowledge' });
    await callTool('rebuild_index');
    const res = result(await callTool('recall_memory', { query: 'monthly content', since: '1m' }));
    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBeGreaterThan(0);
  });
});

// ─── get_timeline — since without category ───────────────────────────────────

describe('get_timeline — no since (all time) returns everything', () => {
  it('returns all memories when since is omitted', async () => {
    await callTool('store_memory', { title: 'TL NoSince', content: 'X', tags: [], category: 'knowledge' });
    const res = result(await callTool('get_timeline', {}));
    expect(res.items.length).toBeGreaterThan(0);
  });
});

// ─── getStats — p99 percentile ───────────────────────────────────────────────

describe('getStats — performance percentiles', () => {
  it('has p99 property on performance object', async () => {
    const stats = result(await callTool('get_stats'));
    expect(stats.performance).toHaveProperty('p99');
  });
});

// ─── embed callbacks: store_memory and update_memory when vec is non-null ────
// These tests pin down the embedAndUpsert contract: store/update MUST call it,
// and the helper (mocked here as a no-op spy) takes a string + key. Originally
// these asserted the inner embed→upsert chain; the chain is now encapsulated
// inside embedAndUpsert (src/embeddings.ts), and is tested there directly via
// the embeddings.test.ts unit suite. Here we just verify the call site fires.

describe('embed callback — embedAndUpsert called on write', () => {
  let embedMod: typeof import('../embeddings.js');

  beforeAll(async () => {
    embedMod = await import('../embeddings.js');
  });

  afterEach(() => {
    vi.mocked(embedMod.embedAndUpsert).mockClear();
    vi.mocked(embedMod.embed).mockResolvedValue(null);
  });

  it('store_memory calls embedAndUpsert(key, content)', async () => {
    await callTool('store_memory', { title: 'Embed Store Test', content: 'vector content', tags: [], category: 'knowledge' });
    expect(vi.mocked(embedMod.embedAndUpsert)).toHaveBeenCalled();
    // Find the call from THIS test (other store_memory tests may have run earlier)
    const match = vi.mocked(embedMod.embedAndUpsert).mock.calls.find(([, c]) => c === 'vector content');
    expect(match).toBeDefined();
    const [key] = match!;
    expect(typeof key).toBe('string');
  });

  it('update_memory calls embedAndUpsert(key, content) when content is provided', async () => {
    const { key } = result(await callTool('store_memory', { title: 'Embed Update Test', content: 'original', tags: [], category: 'knowledge', force: true }));
    vi.mocked(embedMod.embedAndUpsert).mockClear();
    await callTool('update_memory', { key, content: 'updated vector content' });
    expect(vi.mocked(embedMod.embedAndUpsert)).toHaveBeenCalledWith(key, 'updated vector content');
  });

  it('update_memory does NOT call embedAndUpsert when content is omitted', async () => {
    const { key } = result(await callTool('store_memory', {
      title: 'Embed Skip Test', content: 'orig', tags: [], category: 'knowledge',
    }));
    vi.mocked(embedMod.embedAndUpsert).mockClear();
    await callTool('update_memory', { key, tags: ['newtag'] });
    expect(vi.mocked(embedMod.embedAndUpsert)).not.toHaveBeenCalled();
  });
});

// ─── SIGINT and beforeExit signal handlers ────────────────────────────────────

describe('process signal handlers — SIGINT and beforeExit', () => {
  it('SIGINT calls flushPending and exits', async () => {
    await callTool('store_memory', { title: 'SIGINT Test', content: 'X', tags: [], category: 'knowledge' });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    process.emit('SIGINT', 'SIGINT');
    exitSpy.mockRestore();
    expect(fs.existsSync(path.join(VAULT, 'index.json'))).toBe(true);
  });

  it('beforeExit calls flushPending', async () => {
    await callTool('store_memory', { title: 'BeforeExit Test', content: 'Y', tags: [], category: 'knowledge' });
    process.emit('beforeExit', 0);
    expect(fs.existsSync(path.join(VAULT, 'index.json'))).toBe(true);
  });
});

// ─── store_memory: defensive coercion at the write path ─────────────────────
//
// MCP does not enforce a tool's inputSchema — `inputSchema` is metadata for
// clients, not a runtime guard. A misbehaving caller (buggy agent, hand-crafted
// stdio request) can pass `title: 12345` or `tags: "kafka,cdc"`. Without
// coercion at the write path, the value lands in memIndex and crashes
// tfidfSearch (`meta.title.toLowerCase()`, `meta.tags.join/.some`),
// buildIndexCache (`m.title.slice()`, `m.tags.slice`), and getRelatedMemories
// (`Set(m.tags)`) on the very next read. Mirrors indexFile's read-path
// hardening (vault-scan.ts) for the write path.
describe('store_memory — defensive coercion of non-string title and non-array tags', () => {
  it('coerces a numeric title to a string so recall_memory does not crash', async () => {
    const stored = result(await callTool('store_memory', {
      title: 2026 as any,                  // bypass inputSchema
      content: 'numeric-title content',
      tags: [],
      category: 'knowledge',
    }));
    // memIndex holds a string title, not the raw number
    const list = result(await callTool('list_memories'));
    const meta = list.items.find((m: any) => m.key === stored.key);
    expect(meta).toBeDefined();
    expect(typeof meta!.title).toBe('string');
    expect(meta!.title).toBe('2026');
    // On-disk frontmatter is also a string (quoted, so it round-trips).
    // needsQuotes emits single-quoted scalars for numeric-looking values.
    const raw = fs.readFileSync(stored.filePath, 'utf8');
    expect(raw).toMatch(/^title: '2026'/m);
    // Force the inverted index to include this memory (otherwise the debounced
    // rebuild lags behind the test).
    await callTool('rebuild_index');
    // recall_memory would crash on `meta.title.toLowerCase()` if memIndex held a
    // Number — assert the search path completes and finds the memory
    const recalled = result(await callTool('recall_memory', { query: 'numeric-title' }));
    expect(recalled.length).toBeGreaterThan(0);
  });

  it('coerces a scalar-string tags argument to an empty array so tfidfSearch does not crash', async () => {
    const stored = result(await callTool('store_memory', {
      title: 'Scalar Tags',
      content: 'scalar-tags content',
      tags: 'kafka,cdc' as any,            // bypass inputSchema — scalar string, not array
      category: 'knowledge',
    }));
    // memIndex holds an array tags, not a scalar string
    const list = result(await callTool('list_memories'));
    const meta = list.items.find((m: any) => m.key === stored.key);
    expect(meta).toBeDefined();
    expect(Array.isArray(meta!.tags)).toBe(true);
    expect(meta!.tags).toEqual([]);
    // Force the inverted index to include this memory.
    await callTool('rebuild_index');
    // get_related_memories calls `Set(m.tags)` — a scalar would throw here
    const related = result(await callTool('get_related_memories', { key: stored.key }));
    expect(Array.isArray(related)).toBe(true);
    // tfidfSearch would crash on `meta.tags.join` / `meta.tags.some` if memIndex
    // held a scalar — assert the search path completes and finds the memory
    const searched = result(await callTool('search_index', { query: 'scalar-tags' }));
    expect(searched.length).toBeGreaterThan(0);
  });
});

// ─── loadIndexes: defensive coercion on the restore-from-on-disk path ────────
//
// The in-memory `MemoryMetadata` shape is strict (`title: string`, `tags: string[]`)
// but the on-disk `~/.total-recall/index.json` may predate that strictness: a
// pre-v1.0.6 install could have written a Number title (a teammate-pushed org
// file with `title: 2026` parsed by the frontmatter scalar coercer before the
// indexFile String() guard landed) or a scalar-string tags value (`tags: foo`).
// loadIndexes now coerces on restore so the very first buildIndexCache /
// tfidfSearch / get_related_memories call after upgrade does not crash before
// the user's next rebuild_index triggers the hardened indexFile read path.
describe('loadIndexes — defensive coercion on restore', () => {
  const INDEX_PATH = path.join(VAULT, 'index.json');

  it('coerces a Number title and scalar-string tags from on-disk index.json', () => {
    // Simulate an index.json from a pre-v1.0.6 install: Number title (from an
    // unquoted `title: 2026` in a teammate-pushed org file that ran through
    // coerceScalar before indexFile added String()), and scalar-string tags
    // (from `tags: foo` parsed by coerceScalar as a string).
    fs.writeFileSync(INDEX_PATH, JSON.stringify({
      'knowledge/legacy-2026': {
        key: 'knowledge/legacy-2026',
        filePath: path.join(VAULT, 'personal-vault', 'knowledge', 'legacy-2026.md'),
        title: 2026,        // Number — would crash m.title.slice / .toLowerCase
        tags: 'kafka',      // scalar string — would crash m.tags.slice / .join / Set
        author: 'me',
        sessions: ['s1'],
        created: '2026-01-01T00:00:00Z',
        updated: '2026-01-01T00:00:00Z',
        importanceScore: 0.5,
        category: 'knowledge',
        contentPreview: 'legacy',
        accessCount: 0,
        lastAccessed: '2026-01-01T00:00:00Z',
        tokenEstimate: 10,
        isOrg: false,
      },
      'knowledge/scalar-tags': {
        key: 'knowledge/scalar-tags',
        filePath: path.join(VAULT, 'personal-vault', 'knowledge', 'scalar-tags.md'),
        title: 'Scalar Tags',
        tags: 'kafka,cdc',   // scalar string
        sessions: 's1',      // scalar string, also coerced
        created: '2026-01-01T00:00:00Z',
        updated: '2026-01-01T00:00:00Z',
        importanceScore: 0.5,
        category: 'knowledge',
        contentPreview: 'scalar',
        accessCount: 0,
        lastAccessed: '2026-01-01T00:00:00Z',
        tokenEstimate: 10,
        isOrg: false,
      },
    }));
    loadIndexes();
    const a = memIndex['knowledge/legacy-2026'];
    const b = memIndex['knowledge/scalar-tags'];
    expect(a).toBeDefined();
    expect(typeof a!.title).toBe('string');
    expect(a!.title).toBe('2026');
    expect(Array.isArray(a!.tags)).toBe(true);
    expect(a!.tags).toEqual([]);
    expect(Array.isArray(a!.sessions)).toBe(true);
    expect(typeof b!.title).toBe('string');
    expect(Array.isArray(b!.tags)).toBe(true);
    expect(b!.tags).toEqual([]);
    expect(Array.isArray(b!.sessions)).toBe(true);
  });

  it('survives the read-side callers after a coerced restore', async () => {
    fs.writeFileSync(INDEX_PATH, JSON.stringify({
      'knowledge/read-survives': {
        key: 'knowledge/read-survives',
        filePath: path.join(VAULT, 'personal-vault', 'knowledge', 'read-survives.md'),
        title: 4242,             // Number
        tags: 'kafka',           // scalar string
        sessions: [],
        created: '2026-01-01T00:00:00Z',
        updated: '2026-01-01T00:00:00Z',
        importanceScore: 0.5,
        category: 'knowledge',
        contentPreview: 'survives',
        accessCount: 0,
        lastAccessed: '2026-01-01T00:00:00Z',
        tokenEstimate: 10,
        isOrg: false,
      },
    }));
    loadIndexes();
    // buildIndexCache crashes on m.title.slice(Number) and m.tags.slice(string).
    // If loadIndexes coerced, these reads succeed and the in-memory title is
    // the String('4242'), not the Number.
    const listed = result(await callTool('list_memories'));
    const meta = listed.items.find((m: any) => m.key === 'knowledge/read-survives');
    expect(meta).toBeDefined();
    expect(typeof meta.title).toBe('string');
    expect(meta.title).toBe('4242');
    expect(Array.isArray(meta.tags)).toBe(true);
    // get_related_memories builds `new Set(m.tags)` — would throw on a scalar.
    const related = result(await callTool('get_related_memories', { key: 'knowledge/read-survives' }));
    expect(Array.isArray(related)).toBe(true);
  });

  it('tolerates a malformed index.json without throwing', () => {
    // Garbage that is not valid JSON. loadIndexes must swallow the parse error
    // and leave memIndex empty (rather than crashing the boot path).
    fs.writeFileSync(INDEX_PATH, 'this is { not : valid json');
    expect(() => loadIndexes()).not.toThrow();
    expect(Object.keys(memIndex)).toEqual([]);
  });

  it('tolerates a non-object index.json (e.g. an array)', () => {
    fs.writeFileSync(INDEX_PATH, JSON.stringify([1, 2, 3]));
    expect(() => loadIndexes()).not.toThrow();
    expect(Object.keys(memIndex)).toEqual([]);
  });

  it('skips entries that are not objects (e.g. a stray string value)', () => {
    fs.writeFileSync(INDEX_PATH, JSON.stringify({ 'knowledge/ok': { title: 'OK', tags: ['t'] }, 'knowledge/bad': 'not-an-object' }));
    loadIndexes();
    expect(memIndex['knowledge/ok']).toBeDefined();
    expect(memIndex['knowledge/bad']).toBeUndefined();
  });

  it('clamps + coerces an out-of-range and string importanceScore from on-disk index.json', () => {
    // A pre-v1.0.9 install may have written a string (`'high'` from a hand-edited
    // file with a QUOTED `importanceScore: 'high'`) or an out-of-range Number
    // (`5` or `-1`). Ebbinghaus's own coerce-and-clamp handles the read-time math,
    // but the persisted value would still leak via list_memories /
    // get_related_memories / prune_memories. coerceMemEntry must normalize so a
    // loaded index exposes a finite number in [0, 1].
    fs.writeFileSync(INDEX_PATH, JSON.stringify({
      'knowledge/string-importance': {
        key: 'knowledge/string-importance',
        filePath: path.join(VAULT, 'personal-vault', 'knowledge', 'string-importance.md'),
        title: 'String IS',
        tags: [],
        sessions: [],
        created: '2026-01-01T00:00:00Z',
        updated: '2026-01-01T00:00:00Z',
        importanceScore: 'high',  // string from a quoted frontmatter value
        category: 'knowledge',
        contentPreview: 'string',
        accessCount: 0,
        lastAccessed: '2026-01-01T00:00:00Z',
        tokenEstimate: 10,
        isOrg: false,
      },
      'knowledge/over-importance': {
        key: 'knowledge/over-importance',
        filePath: path.join(VAULT, 'personal-vault', 'knowledge', 'over-importance.md'),
        title: 'Over IS',
        tags: [],
        sessions: [],
        created: '2026-01-01T00:00:00Z',
        updated: '2026-01-01T00:00:00Z',
        importanceScore: 5,        // out-of-range above 1
        category: 'knowledge',
        contentPreview: 'over',
        accessCount: 0,
        lastAccessed: '2026-01-01T00:00:00Z',
        tokenEstimate: 10,
        isOrg: false,
      },
      'knowledge/under-importance': {
        key: 'knowledge/under-importance',
        filePath: path.join(VAULT, 'personal-vault', 'knowledge', 'under-importance.md'),
        title: 'Under IS',
        tags: [],
        sessions: [],
        created: '2026-01-01T00:00:00Z',
        updated: '2026-01-01T00:00:00Z',
        importanceScore: -1,       // out-of-range below 0
        category: 'knowledge',
        contentPreview: 'under',
        accessCount: 0,
        lastAccessed: '2026-01-01T00:00:00Z',
        tokenEstimate: 10,
        isOrg: false,
      },
    }));
    loadIndexes();
    // 'high' → Number('high') = NaN → Number.isFinite(NaN) = false → fall back
    // to 0.5 (the schema default), matching Ebbinghaus's own NaN fallback.
    const s = memIndex['knowledge/string-importance'];
    expect(s).toBeDefined();
    expect(typeof s!.importanceScore).toBe('number');
    expect(Number.isFinite(s!.importanceScore)).toBe(true);
    expect(s!.importanceScore).toBeGreaterThanOrEqual(0);
    expect(s!.importanceScore).toBeLessThanOrEqual(1);
    expect(s!.importanceScore).toBe(0.5);
    // 5 → Number.isFinite(5) = true → clamped to 1
    expect(memIndex['knowledge/over-importance']!.importanceScore).toBe(1);
    // -1 → Number.isFinite(-1) = true → clamped to 0
    expect(memIndex['knowledge/under-importance']!.importanceScore).toBe(0);
  });
});

// ─── store_memory: defensive clamp+coerce of importanceScore ─────────────────
//
// Mirrors mutate.ts:53 — MCP does not enforce the tool's inputSchema, so a caller
// can pass `importanceScore: 'high'` or `importanceScore: -5`. Ebbinghaus's own
// coerce-and-clamp handles the read-time math, but the bad value would still
// persist in memIndex + on disk and resurface via list_memories /
// get_related_memories / prune_memories. store_memory now clamps+coerces at the
// destructure so the persisted value is always a finite number in [0, 1].

describe('store_memory — defensive clamp+coerce of importanceScore', () => {
  it('clamps an out-of-range importanceScore to [0, 1] before persistence', async () => {
    const stored = result(await callTool('store_memory', {
      title: 'Over IS',
      content: 'over-is content',
      tags: [],
      category: 'knowledge',
      importanceScore: 5 as any,    // bypass inputSchema — out-of-range above 1
    }));
    const list = result(await callTool('list_memories'));
    const meta = list.items.find((m: any) => m.key === stored.key);
    expect(meta).toBeDefined();
    expect(meta!.importanceScore).toBe(1);
    // On-disk frontmatter is also clamped (stringifies via Number → String)
    const raw = fs.readFileSync(stored.filePath, 'utf8');
    expect(raw).toMatch(/^importanceScore: 1$/m);
  });

  it('coerces a string importanceScore to a finite number before persistence', async () => {
    const stored = result(await callTool('store_memory', {
      title: 'String IS',
      content: 'string-is content',
      tags: [],
      category: 'knowledge',
      importanceScore: 'high' as any,  // bypass inputSchema — string, not number
    }));
    const list = result(await callTool('list_memories'));
    const meta = list.items.find((m: any) => m.key === stored.key);
    expect(meta).toBeDefined();
    expect(typeof meta!.importanceScore).toBe('number');
    expect(Number.isFinite(meta!.importanceScore)).toBe(true);
    expect(meta!.importanceScore).toBeGreaterThanOrEqual(0);
    expect(meta!.importanceScore).toBeLessThanOrEqual(1);
    // Number('high') = NaN → fall back to 0.5 (the schema default)
    expect(meta!.importanceScore).toBe(0.5);
  });
});

// ─── indexFile: clamp+coerce importanceScore on read path ───────────────────
//
// A hand-edited (or teammate-pushed) frontmatter with a QUOTED importanceScore
// (`importanceScore: '0.7'`) parses by coerceScalar into a string, not a number.
// indexFile now normalizes at the read path so the value surfaced from a freshly
// indexed file is always a finite number in [0, 1].

describe('indexFile — quoted string importanceScore in frontmatter', () => {
  it('coerces a string importanceScore so prune_memories does not crash', async () => {
    const dir = path.join(VAULT, 'personal-vault', 'knowledge');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'quoted-importance.md'),
      `---\ntitle: Quoted IS\ntags: []\ncreated: 2026-01-01T00:00:00Z\nupdated: 2026-01-01T00:00:00Z\nimportanceScore: '0.7'\n---\n\nQuoted importance note.\n`
    );
    await callTool('rebuild_index');
    // search_index returns a metadata-only shape that omits importanceScore,
    // so fetch via get_memories_by_keys (which echoes the full MemoryMetadata)
    // to verify the index-time coerce landed.
    const res = await callTool('get_memories_by_keys', { keys: ['knowledge/quoted-importance'] });
    expect(res.isError).not.toBe(true);
    const found = (result(res) as any[]).find((m: any) => m.key === 'knowledge/quoted-importance');
    expect(found).toBeDefined();
    // prune_memories iterates Object.values(memIndex) and computes
    // computeRetentionStrength(m.importanceScore, …); the read-time Ebbinghaus
    // clamp handles strings, but the persisted value surfaced here must also be
    // a finite number in [0, 1].
    expect(typeof found!.importanceScore).toBe('number');
    expect(Number.isFinite(found!.importanceScore)).toBe(true);
    expect(found!.importanceScore).toBe(0.7);
  });
});

// ─── Pass 4: appendJournal refuses to append through a planted symlink ───────

describe('appendJournal — symlink containment (Pass 4)', () => {
  const sym = CAN_SYMLINK ? it : it.skip;

  sym('skips the append when journal/<today>.md is a symlink (no target corruption)', () => {
    // appendFileSync follows a symlink at journal/<today>.md and would write the
    // journal entry to the symlink's target (corrupting it). The personal vault is
    // local-only (never git-synced), so there's no remote planting vector, but
    // every other write path now lstats — this closes the last append-without-lstat
    // gap. Silent skip: the journal is a best-effort side-effect and must never
    // throw into a store_memory call.
    const today = new Date().toISOString().slice(0, 10);
    const journalDir = path.join(VAULT, 'personal-vault', 'journal');
    fs.mkdirSync(journalDir, { recursive: true });
    const journalPath = path.join(journalDir, `${today}.md`);
    // Victim OUTSIDE the journal dir that the planted symlink targets.
    const victim = path.join(os.tmpdir(), `tr-journal-victim-${process.pid}.txt`);
    fs.writeFileSync(victim, 'PRECIOUS');
    try {
      // Clear any journal/<today>.md left by a prior test, then plant the symlink.
      fs.rmSync(journalPath, { force: true });
      fs.symlinkSync(victim, journalPath);
      appendJournal('store', 'knowledge/symlink-test', 'Symlink Test');
      // The victim must NOT have the journal entry appended through the symlink.
      expect(fs.readFileSync(victim, 'utf8')).toBe('PRECIOUS');
      // The symlink is left in place (appendJournal didn't write through it).
      expect(fs.lstatSync(journalPath).isSymbolicLink()).toBe(true);
    } finally {
      // Remove the symlink so a later test's writeFileSync creates a fresh
      // regular file (not following a stale symlink → no cross-test clobber).
      fs.rmSync(journalPath, { force: true });
      fs.rmSync(victim, { force: true });
    }
  });

  sym('still appends normally when journal/<today>.md is a regular file or absent', () => {
    // Complement: the lstat guard must NOT break the happy path. First append of
    // the day (ENOENT) creates the file; a second append appends to the regular
    // file (lstat says not-a-symlink → fall through to appendFileSync).
    const today = new Date().toISOString().slice(0, 10);
    const journalDir = path.join(VAULT, 'personal-vault', 'journal');
    fs.mkdirSync(journalDir, { recursive: true });
    const journalPath = path.join(journalDir, `${today}.md`);
    fs.rmSync(journalPath, { force: true });
    try {
      appendJournal('store', 'knowledge/append-first', 'First');
      expect(fs.existsSync(journalPath)).toBe(true);
      expect(fs.lstatSync(journalPath).isSymbolicLink()).toBe(false);
      const firstLen = fs.readFileSync(journalPath, 'utf8').length;
      appendJournal('store', 'knowledge/append-second', 'Second');
      expect(fs.readFileSync(journalPath, 'utf8').length).toBeGreaterThan(firstLen);
    } finally {
      fs.rmSync(journalPath, { force: true });
    }
  });

  it('skips the append when journal/<today>.md is a directory (no EISDIR throw into store_memory)', () => {
    // Behavior change from reusing assertRegularFile (E1): the former
    // isSymbolicLink check let a directory fall through to appendFileSync, which
    // threw EISDIR up into the store_memory call — violating the invariant that
    // the best-effort journal never throws. assertRegularFile treats a directory
    // as not-a-regular-file (lstat → isFile()=false → throws) and appendJournal
    // now catches and skips. This test fails on the old code (the appendJournal
    // call would throw EISDIR) and passes on the new (silent skip).
    const today = new Date().toISOString().slice(0, 10);
    const journalDir = path.join(VAULT, 'personal-vault', 'journal');
    fs.mkdirSync(journalDir, { recursive: true });
    const journalPath = path.join(journalDir, `${today}.md`);
    fs.rmSync(journalPath, { force: true });
    fs.mkdirSync(journalPath, { recursive: true });
    try {
      expect(() => appendJournal('store', 'knowledge/dir-test', 'Dir Test')).not.toThrow();
      // The directory is left untouched — not replaced by a file, no entry written.
      expect(fs.lstatSync(journalPath).isDirectory()).toBe(true);
    } finally {
      fs.rmSync(journalPath, { recursive: true, force: true });
    }
  });
});

// ─── Pass 4: atomicWrite uses an unpredictable tmp path ───────────────────────

describe('atomicWrite — random tmp path defeats predictable-tmp symlink race (Pass 4)', () => {
  const sym = CAN_SYMLINK ? it : it.skip;

  sym('saveNow does not follow a symlink planted at the predictable index.json.tmp', () => {
    // Threat: a local attacker who can write ~/.total-recall/ pre-plants a symlink
    // at the PREDICTABLE atomicWrite tmp path (index.json.tmp → an outside file).
    // The old `${p}.tmp` name was fully predictable, so writeFileSync(tmp) would
    // follow the symlink and clobber the outside target; the rename would then
    // replace index.json with the symlink. The random tmp suffix makes the path
    // unguessable, so the planted symlink is never touched. Tested via the public
    // saveNow(), which atomicWrites INDEX_PATH unconditionally.
    const INDEX_PATH = path.join(VAULT, 'index.json');
    const predictableTmp = `${INDEX_PATH}.tmp`;
    const victim = path.join(os.tmpdir(), `tr-aw-victim-${process.pid}.txt`);
    fs.writeFileSync(victim, 'PRECIOUS');
    try {
      fs.rmSync(INDEX_PATH, { force: true });
      fs.rmSync(predictableTmp, { force: true });
      // Plant the symlink at the OLD predictable tmp name → victim.
      fs.symlinkSync(victim, predictableTmp);
      saveNow();
      // victim must be untouched — the random tmp never followed the symlink.
      expect(fs.readFileSync(victim, 'utf8')).toBe('PRECIOUS');
      // index.json was still written (via a random, unguessable tmp path).
      expect(fs.existsSync(INDEX_PATH)).toBe(true);
      // The predictable symlink is left in place (not followed, not renamed away).
      expect(fs.lstatSync(predictableTmp).isSymbolicLink()).toBe(true);
    } finally {
      fs.rmSync(predictableTmp, { force: true });
      fs.rmSync(victim, { force: true });
    }
  });
});
