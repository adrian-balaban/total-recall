// ─── Tool registration helper (Phase 6.1-6.3) ───────────────────────────────
//
// Co-locating each tool's Zod schema + handler in its own tools/*.ts module
// (6.3) means server.ts no longer owns a monolithic schema block or a
// CallTool dispatch table. Each module exports a `register(server)` that
// calls `server.registerTool(name, { description, inputSchema }, cb)`.
//
// `registerTool` (the high-level McpServer API, 6.1) validates the caller's
// arguments against the Zod `inputSchema` BEFORE invoking the callback
// (McpServer.validateToolInput → safeParseAsync), so malformed calls are
// rejected uniformly at the dispatch boundary (6.2) with a parse-error
// CallToolResult — the root cause of the T3 scalar-tags class is closed:
// a scalar `tags` no longer reaches the handler via MCP.
//
// `wrapHandler` preserves the exact CallToolResult shape the old
// setRequestHandler(CallTool) produced: a successful handler return is
// JSON.stringify(result, null, 2) into a single text content block; a throw
// becomes an `isError: true` text block and is recorded via recordError.
// `recordPerfSample` is taken on the same (start, end) window as before.
//
// The handler defensive coercion (e.g. `String(args.title ?? '')` in
// store.ts) is INTENTIONALLY kept: handlers are also called directly by
// import_memories' round-trip and by unit tests, neither of which routes
// through the Zod boundary. The coercion is now belt-and-suspenders for the
// MCP path and the sole guard for the internal path — never remove it.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { recordError, recordPerfSample } from '../state.js';

// The 17 tool handlers all share this shape: take a plain args object, return
// a JSON-serializable result, throw on failure. `any` is deliberate — the
// handlers pre-date the Zod boundary and coerce defensively (see above).
export type ToolHandler = (args: any) => any;

// A register function exported by each tools/*.ts module. server.ts calls
// these in order to wire the 17 tools onto the McpServer.
export type RegisterFn = (server: McpServer) => void;

// Wrap a tool handler in the CallToolResult envelope + the perf/error
// instrumentation that the old CallTool setRequestHandler owned. The
// returned callback is what `server.registerTool` receives as its third arg.
export function wrapHandler(name: string, handler: ToolHandler) {
  return async (args: any, _extra: unknown) => {
    const start = Date.now();
    try {
      // `args` is the Zod-parsed shape from McpServer.validateToolInput
      // (always an object in the real path; at minimum `{}` for the no-arg
      // tools). `args ?? {}` is a safety net for the unit-test mock path,
      // which invokes the callback directly without validation.
      const result = await handler(args ?? {});
      // #21: route through the shared bounded-append helper (amortized-O(1)
      // trim) — perfSamples is read only by getStats for the percentile calc.
      recordPerfSample(Date.now() - start);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e: any) {
      recordError(`${name}: ${e.message}`);
      return {
        content: [{ type: 'text' as const, text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  };
}