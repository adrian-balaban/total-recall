// Total-recall MCP server entry point.
//
// Server setup (schemas + dispatch) and main() live in ./server.js; the 12 tool
// implementations live under ./tools/*.js; shared in-memory state lives in
// ./state.js. This file just boots the server and flushes pending writes on exit.
//
// Importing ./server.js is load-bearing: its module body constructs the Server,
// registers the ListTools/CallTool handlers, and exports main(). The test suite
// drives the server by importing this file and invoking the captured handlers.

import { main } from './server.js';
import { flushPending } from './persistence.js';
import { flushEmbeddings } from './embeddings.js';

// Exit handler. flushPending() runs FIRST and synchronously (it writes index.json
// + invertedIndex.json to disk before the first await), so the memIndex state
// always lands even if the flushEmbeddings await or the bounded timeout delays
// the exit. flushEmbeddings then drains in-flight embed→upsert promises (#3) so a
// store_memory whose fire-and-forget vector hadn't landed yet is not killed by
// process.exit — closing the silent-drop path that left a memory findable via
// TF-IDF but invisible to hybrid search. The remaining holes (an embed that
// exceeds the 2s timeout, or pre-existed this boot) are closed by
// reconcileIndex's backfill on the next start.
async function shutdown(): Promise<void> {
  flushPending();
  try { await flushEmbeddings(); } catch {}
  process.exit(0);
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
// Claude Code closes the MCP child's stdio streams on session end (it does NOT
// send SIGTERM). The 'end' and 'close' events on process.stdin are what we
// actually see; SIGTERM/SIGINT only fire on a manual kill. beforeExit does
// NOT fire while stdin is held open (the readable stream keeps the event loop
// alive), so without these two listeners the 1s scheduleSave debounce + the
// 2s scheduleIdfRecalc debounce are killed mid-flight and the in-memory
// memIndex mutations from the last store_memory are lost until the next boot
// reconciles. Reuse the SIGTERM/SIGINT path so flushPending → flushEmbeddings
// → process.exit(0) all run.
process.stdin.on('end', shutdown);
process.stdin.on('close', shutdown);
process.on('beforeExit', flushPending);

main().catch(e => { console.error(e); process.exit(1); });