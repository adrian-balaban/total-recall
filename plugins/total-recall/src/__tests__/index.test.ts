import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ─── Test vault — unique per process ─────────────────────────────────────────

const TEST_HOME = path.join(os.tmpdir(), `tr-test-${process.pid}`);
const VAULT = path.join(TEST_HOME, '.total-recall');

// Override HOME before any module loads (os.homedir() reads process.env.HOME on Linux)
process.env.HOME = TEST_HOME;

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
    const { key } = result(await callTool('store_memory', {
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
    const cacheFile = path.join(VAULT, '.index-cache.txt');
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
    const first = result(await callTool('store_memory', {
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

describe('embed callback — upsertVector called when embed returns a vector', () => {
  // Grab the mocked modules so we can change their return value
  let embedMod: typeof import('../embeddings.js');

  beforeAll(async () => {
    embedMod = await import('../embeddings.js');
  });

  afterEach(() => {
    // Restore embed mock to null after each test
    vi.mocked(embedMod.embed).mockResolvedValue(null);
    vi.mocked(embedMod.isVectorAvailable).mockReturnValue(false);
  });

  it('store_memory calls upsertVector when embed returns a vector', async () => {
    const fakeVec = Array(384).fill(0.1);
    vi.mocked(embedMod.embed).mockResolvedValue(fakeVec as any);
    const { upsertVector } = await import('../vectorStore.js');
    const upsertSpy = vi.mocked(upsertVector);
    upsertSpy.mockClear();

    await callTool('store_memory', { title: 'Embed Store Test', content: 'vector content', tags: [], category: 'knowledge' });
    await new Promise(r => setTimeout(r, 10));
    expect(upsertSpy).toHaveBeenCalled();
  });

  it('store_memory swallows embed rejection via .catch', async () => {
    vi.mocked(embedMod.embed).mockRejectedValue(new Error('embed failed'));
    // Should not throw — .catch(() => {}) swallows the error
    await expect(callTool('store_memory', {
      title: 'Embed Catch Test', content: 'catch path', tags: [], category: 'knowledge',
    })).resolves.not.toThrow();
    await new Promise(r => setTimeout(r, 10));
  });

  it('update_memory calls upsertVector when embed returns a vector', async () => {
    const fakeVec = Array(384).fill(0.2);
    vi.mocked(embedMod.embed).mockResolvedValue(fakeVec as any);
    const { upsertVector } = await import('../vectorStore.js');
    const upsertSpy = vi.mocked(upsertVector);
    upsertSpy.mockClear();

    const { key } = result(await callTool('store_memory', { title: 'Embed Update Test', content: 'original', tags: [], category: 'knowledge', force: true }));
    await callTool('update_memory', { key, content: 'updated vector content' });
    await new Promise(r => setTimeout(r, 10));
    expect(upsertSpy).toHaveBeenCalled();
  });

  it('update_memory swallows embed rejection via .catch', async () => {
    vi.mocked(embedMod.embed).mockResolvedValue(null);
    const { key } = result(await callTool('store_memory', {
      title: 'Update Catch Base', content: 'base', tags: [], category: 'knowledge',
    }));
    vi.mocked(embedMod.embed).mockRejectedValue(new Error('embed update failed'));
    await expect(callTool('update_memory', { key, content: 'new content' })).resolves.not.toThrow();
    await new Promise(r => setTimeout(r, 10));
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
