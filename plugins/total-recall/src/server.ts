import * as path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { PERSONAL_VAULT, ORG_VAULT, DEFAULT_CATEGORIES, ensureDir } from './paths.js';
import { loadIndexes, scheduleSave, recalcIdfNow, markIndexFresh } from './persistence.js';
import { reconcileIndex } from './vault-scan.js';
import { startAutoReconcile } from './auto-reconcile.js';
// Phase 6.1-6.3: each tools/*.ts module owns its Zod schema + handler + a
// `register(server)` that wires them onto the McpServer via registerTool.
// server.ts no longer holds a monolithic hand-written schema block (6.3) nor a
// CallTool dispatch table (6.1) — the schema is co-located with the handler it
// validates, and registerTool's Zod safeParse closes the T3 scalar-tags class
// at the dispatch boundary (6.2). The CallToolResult envelope + the
// perf/error instrumentation that the old setRequestHandler(CallTool) owned
// live in tools/registry.ts wrapHandler.
import { register as registerStore } from './tools/store.js';
import { register as registerRecall } from './tools/recall.js';
import { register as registerQuery } from './tools/query.js';
import { register as registerMutate } from './tools/mutate.js';
import { register as registerRerank } from './tools/rerank.js';
import { register as registerBulk } from './tools/bulk.js';

// ─── Plugin metadata ─────────────────────────────────────────────────────────

// Injected at build time from package.json via esbuild --define. Falls back to
// reading package.json at runtime under `npm run dev` (tsx), where no define is set.
declare const __PLUGIN_VERSION__: string | undefined;
const PLUGIN_VERSION: string =
  typeof __PLUGIN_VERSION__ === 'string'
    ? __PLUGIN_VERSION__
    : require('../package.json').version;

// ─── Server setup ─────────────────────────────────────────────────────────────

// 6.1: McpServer (the high-level API) replaces the deprecated low-level Server
// + setRequestHandler(ListTools/CallTool). registerTool validates the caller's
// arguments against the Zod inputSchema BEFORE invoking the callback
// (McpServer.validateToolInput → safeParseAsync), so malformed calls are
// rejected uniformly at the dispatch boundary (6.2) with a parse-error
// CallToolResult — a scalar `tags` no longer reaches the handler via MCP.
// `capabilities.tools` is advertised automatically by McpServer; only the
// `instructions` banner is passed here.
const server = new McpServer(
  { name: 'total-recall', version: PLUGIN_VERSION },
  {
    instructions:
      `total-recall v${PLUGIN_VERSION} — persistent memory MCP server (17 tools). ` +
      `Retrieval order: search_index → recall_memory → get_memories_by_keys. Rerank with rerank_memories. ` +
      `Bulk operations: export_memories / import_memories / delete_memories. Confirm with confirm_memory.`,
  }
);

// Wire the 17 tools. The order is stable (store → recall → query → mutate →
// rerank → bulk) but does not affect tools/list ordering — the SDK returns
// tools in registration order, matching the prior hand-written list.
registerStore(server);
registerRecall(server);
registerQuery(server);
registerMutate(server);
registerRerank(server);
registerBulk(server);

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
  // Polling reconcile trigger: SessionStart hooks drop a marker file when the
  // org vault changes (e.g. after a git pull); the server picks it up without
  // requiring a restart.
  startAutoReconcile();
}