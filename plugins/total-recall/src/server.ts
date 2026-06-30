import * as path from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { PERSONAL_VAULT, ORG_VAULT, DEFAULT_CATEGORIES, ensureDir } from './paths.js';
import { loadIndexes, scheduleSave, recalcIdfNow, markIndexFresh } from './persistence.js';
import { reconcileIndex } from './vault-scan.js';
import { perfSamples, recordError } from './state.js';
import { storeMemory } from './tools/store.js';
import { recallMemory, searchIndex } from './tools/recall.js';
import {
  listMemories,
  getMemoriesByKeys,
  getStats,
  getTimeline,
  getRelatedMemories,
  pruneMemories,
} from './tools/query.js';
import { updateMemory, deleteMemory, rebuildIndex } from './tools/mutate.js';

// ─── Plugin metadata ─────────────────────────────────────────────────────────

// Injected at build time from package.json via esbuild --define. Falls back to
// reading package.json at runtime under `npm run dev` (tsx), where no define is set.
declare const __PLUGIN_VERSION__: string | undefined;
const PLUGIN_VERSION: string =
  typeof __PLUGIN_VERSION__ === 'string'
    ? __PLUGIN_VERSION__
    : require('../package.json').version;

// ─── Server setup ─────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'total-recall', version: PLUGIN_VERSION },
  {
    capabilities: { tools: {} },
    instructions:
      `total-recall v${PLUGIN_VERSION} — persistent memory MCP server (12 tools). ` +
      `Retrieval order: search_index → recall_memory → get_memories_by_keys.`,
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'store_memory',
      description: 'Store a new memory in the vault. Routes to org vault if tagged "org". Errors if a memory with the same key already exists — use update_memory, or pass force=true to overwrite (preserves created/accessCount).',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          content: { type: 'string', description: 'Full markdown content including executive summary.' },
          tags: { type: 'array', items: { type: 'string' } },
          category: { type: 'string', default: 'knowledge' },
          importanceScore: { type: 'number', minimum: 0, maximum: 1, default: 0.5 },
          sessionId: { type: 'string' },
          author: { type: 'string' },
          force: { type: 'boolean', default: false, description: 'Overwrite an existing memory with the same key (preserves created/accessCount).' },
        },
        required: ['title', 'content'],
      },
    },
    {
      name: 'recall_memory',
      description: 'Full-text TF-IDF search with Ebbinghaus decay. Fuses with vector search via Reciprocal Rank Fusion when the optional embedding deps are installed (set hybrid=false to force TF-IDF only).',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          full: { type: 'boolean', default: false },
          since: { type: 'string', description: 'Relative (7d, 2w, 1m) or ISO date. Lower bound on updated.' },
          before: { type: 'string', description: 'Relative (7d, 2w, 1m) or ISO date. Upper bound on updated (exclusive); combine with since for a date range.' },
          minScore: { type: 'number', default: 0, description: 'Minimum score; drop results below this. Default 0 = no filtering. Scores are NOT comparable across hybrid modes (RRF-fused scores are tiny; use hybrid=false for predictable TF-IDF thresholds).' },
          limit: { type: 'number', default: 10 },
          excludeJournal: { type: 'boolean', default: true },
          hybrid: { type: 'boolean', default: true, description: 'Fuse TF-IDF with vector search (RRF) when available.' },
        },
        required: ['query'],
      },
    },
    {
      name: 'list_memories',
      description: 'Metadata-only listing with optional category/tag filter.',
      inputSchema: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          tag: { type: 'string' },
          limit: { type: 'number', default: 50 },
          offset: { type: 'number', default: 0, description: 'Skip the first N results (for pagination; combine with limit).' },
        },
      },
    },
    {
      name: 'update_memory',
      description: 'Update content, tags, or importanceScore of an existing memory.',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          content: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          importanceScore: { type: 'number', minimum: 0, maximum: 1 },
          sessionId: { type: 'string' },
        },
        required: ['key'],
      },
    },
    {
      name: 'delete_memory',
      description: 'Delete a memory from the vault and index.',
      inputSchema: {
        type: 'object',
        properties: { key: { type: 'string' } },
        required: ['key'],
      },
    },
    {
      name: 'rebuild_index',
      description: 'Full re-scan of both vaults. Rebuilds inverted index.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'search_index',
      description: 'Lightweight metadata-only search (no file reads). Returns key, title, preview, score.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number', default: 20 },
          since: { type: 'string', description: 'Relative or ISO date. Lower bound on updated.' },
          before: { type: 'string', description: 'Relative or ISO date. Upper bound on updated (exclusive); combine with since for a date range.' },
          minScore: { type: 'number', default: 0, description: 'Minimum TF-IDF score; drop results below this. Default 0 = no filtering.' },
          excludeJournal: { type: 'boolean', default: true, description: 'Drop journal entries (auto-appended daily logs). Default true.' },
          category: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_memories_by_keys',
      description: 'Batch fetch by keys. Use summary=true for executive summary only (~500 chars).',
      inputSchema: {
        type: 'object',
        properties: {
          keys: { type: 'array', items: { type: 'string' } },
          summary: { type: 'boolean', default: false },
        },
        required: ['keys'],
      },
    },
    {
      name: 'get_stats',
      description: 'Total memories, by-category breakdown, cache stats, performance percentiles.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_timeline',
      description: 'Chronological view with date grouping and optional filtering.',
      inputSchema: {
        type: 'object',
        properties: {
          since: { type: 'string', description: 'Relative or ISO date. Lower bound on updated.' },
          before: { type: 'string', description: 'Relative or ISO date. Upper bound on updated (exclusive); combine with since for a date range.' },
          limit: { type: 'number', default: 50 },
          offset: { type: 'number', default: 0, description: 'Skip the first N results (for pagination; combine with limit).' },
          category: { type: 'string' },
        },
      },
    },
    {
      name: 'get_related_memories',
      description: 'Jaccard similarity on tags with same-category boost.',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          limit: { type: 'number', default: 10 },
          includeContent: { type: 'boolean', default: false },
        },
        required: ['key'],
      },
    },
    {
      name: 'prune_memories',
      description: 'List low-retention candidates using Ebbinghaus model. Does NOT auto-delete.',
      inputSchema: {
        type: 'object',
        properties: {
          threshold: { type: 'number', default: 0.1 },
          limit: { type: 'number', default: 20 },
        },
      },
    },
  ],
}));

// Tool dispatch table — replaces the 12-case switch with a lookup so adding a
// tool is a one-line import + one entry below. All handlers return `any`; the
// async/sync mix (recall_memory returns a Promise, the rest are synchronous)
// is folded into a uniform await on the caller side below.
const TOOL_HANDLERS: Record<string, (args: any) => any> = {
  store_memory: storeMemory,
  recall_memory: recallMemory,
  list_memories: listMemories,
  update_memory: updateMemory,
  delete_memory: deleteMemory,
  rebuild_index: rebuildIndex,
  search_index: searchIndex,
  get_memories_by_keys: getMemoriesByKeys,
  get_stats: getStats,
  get_timeline: getTimeline,
  get_related_memories: getRelatedMemories,
  prune_memories: pruneMemories,
};

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const start = Date.now();
  const { name, arguments: args } = request.params;
  try {
    const handler = TOOL_HANDLERS[name];
    if (!handler) throw new Error(`Unknown tool: ${name}`);
    // `args` is request.params.arguments, which the MCP SDK types as
    // ZodOptional and a client is permitted to omit entirely (e.g. a bare
    // `list_memories` call with no params object). The tool handlers are typed
    // `(args: ParsedArgs) => …` and several (listMemories, getStats, prune) read
    // optional fields via `args?.field` but the function parameter itself is
    // non-optional, so passing `undefined` through throws a TypeError at the
    // first `args.x` access — caught here and returned as isError, surfacing as
    // a spurious tool failure on a valid no-arg call. Default to `{}`.
    const result = await handler(args ?? {});
    perfSamples.push(Date.now() - start);
    if (perfSamples.length > 1000) perfSamples.shift();
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (e: any) {
    recordError(`${name}: ${e.message}`);
    return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
  }
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

export async function main() {
  process.stderr.write(`total-recall v${PLUGIN_VERSION} starting\n`);
  ensureDir(PERSONAL_VAULT);
  ensureDir(ORG_VAULT);
  for (const cat of DEFAULT_CATEGORIES) ensureDir(path.join(PERSONAL_VAULT, cat));
  loadIndexes();
  // Always reconcile against disk so orphaned files (from a missed flush on a
  // previous exit) and newly pulled org memories surface. Preserves access stats.
  reconcileIndex();
  // #18: synchronously rebuild + persist the inverted index + cache at boot.
  // loadIndexes no longer reads invertedIndex.json (a dead load — JSON.parse +
  // populate that the immediately-following rebuild discards), so this is the
  // single source that materializes the inverted index from the reconciled
  // memIndex. Persists invertedIndex.json + .index-cache.txt now, before any
  // tool call can arrive.
  recalcIdfNow();
  // Flush the reconciled memIndex to index.json (debounced 1s). The +2s
  // scheduleIdfRecalc chain is gated on dirtyTokens; markIndexFresh clears it
  // so the boot timer writes index.json only and skips the now-redundant
  // inverted-index rebuild (recalcIdfNow just did it synchronously).
  scheduleSave();
  markIndexFresh();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}