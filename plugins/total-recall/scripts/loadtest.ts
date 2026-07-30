/**
 * Load test for the total-recall memory engine: ADD → SEARCH → DELETE of
 * 10k personal + 10k org memories (20k total), then verify clean removal.
 *
 * SAFETY: run with a throwaway HOME so the real ~/.total-recall is never
 * touched. paths.ts derives TOTAL_RECALL_DIR from os.homedir(), which on Linux
 * reads $HOME. So:
 *
 *   HOME=/tmp/tr-loadtest npx tsx scripts/loadtest.ts
 *
 * imports src/tools/* directly → the MCP server and the Claude Code
 * PostToolUse org-sync hook (which would git push every org/ write to GitHub)
 * are never involved. The throwaway org vault has no .git anyway.
 *
 * Scale: override with `LT_N=5000` (default 10000 per vault).
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { storeMemory } from '../src/tools/store.js';
import { deleteMemories } from '../src/tools/bulk.js';
import { searchIndex, recallMemory } from '../src/tools/recall.js';
import { listMemories, getStats } from '../src/tools/query.js';
import { loadIndexes, flushPending, recalcIdfNow } from '../src/persistence.js';
import { memIndex, invertedIndex } from '../src/state.js';

const N = Math.max(1, Math.floor(Number(process.env.LT_N ?? 10000)));
const TAG = 'loadtest';

// ─── helpers ──────────────────────────────────────────────────────────────────
const ms = () => {
  const t = process.hrtime.bigint();
  return Number(t) / 1e6;
};
const fmt = (n: number) => n.toLocaleString('en-US');
const pct = (sorted: number[], p: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;

/** Innocuous, varied body with a searchable canary token. No secret-shaped
 *  runs (no 40+ base64 chars, no key/password/token literals). */
function body(kind: 'personal' | 'org', i: number): string {
  const canary = `loadtestcanary-${i % 50}`;
  const words = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta'];
  const w1 = words[i % words.length];
  const w2 = words[(i * 7 + 3) % words.length];
  const w3 = words[(i * 13 + 5) % words.length];
  return [
    `Load-test ${kind} memory number ${i}.`,
    `Canary token ${canary} — used to verify search recall at scale.`,
    `Topic cluster ${w1}-${w2}-${w3}. This is synthetic filler prose generated to`,
    `exercise the TF-IDF indexer and persistence path with realistic-size bodies.`,
    `Sentence ${i % 9}: the ${w1} ${w2} over the lazy ${w3}. Repeat for length.`,
    `No secrets, no identifiers, no URLs — purely benchmark content. Index ${i}.`,
  ].join('\n');
}

// ─── setup throwaway HOME ──────────────────────────────────────────────────────
const home = process.env.HOME!;
const trDir = path.join(home, '.total-recall');
const personalVault = path.join(trDir, 'personal-vault');
const orgVault = path.join(trDir, 'org', 'org-vault');

fs.mkdirSync(personalVault, { recursive: true });
fs.mkdirSync(orgVault, { recursive: true });
fs.writeFileSync(
  path.join(trDir, 'config.json'),
  JSON.stringify(
    {
      orgRepo: 'https://github.com/example/throwaway.git',
      orgBranch: 'knowledge',
      embeddingModel: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
      enableMultilingualSearch: true,
    },
    null,
    2,
  ),
);
// memIndex starts empty on a fresh HOME; loadIndexes() is a no-op read but
// matches the real boot sequence.
loadIndexes();

console.log(`\n=== total-recall load test ===`);
console.log(`HOME (throwaway): ${home}`);
console.log(`N per vault: ${fmt(N)}  (total ${fmt(2 * N)})`);
console.log(`vector deps: ${'absent → TF-IDF only'}\n`);

let errors = 0;
const summary: Array<[string, string]> = [];

// ─── Phase 1: ADD ──────────────────────────────────────────────────────────────
{
  console.log(`--- Phase 1: ADD ---`);
  const t0 = ms();
  let storeErrors = 0;
  for (let i = 0; i < N; i++) {
    try {
      storeMemory({
        key: `loadtest/personal/${i}`,
        title: `LT personal ${i}`,
        content: body('personal', i),
        category: 'knowledge',
        tags: [TAG, 'personal'],
        importanceScore: 0.5,
      });
      storeMemory({
        key: `org/loadtest/org/${i}`,
        title: `LT org ${i}`,
        content: body('org', i),
        category: 'knowledge',
        tags: [TAG, 'org'],
        importanceScore: 0.5,
      });
    } catch (e) {
      storeErrors++;
      if (storeErrors <= 3) console.error(`store error @${i}:`, (e as Error).message);
    }
    if ((i + 1) % 2000 === 0) {
      const rate = ((i + 1) * 2) / ((ms() - t0) / 1000);
      console.log(`  added ${fmt((i + 1) * 2)} (${rate.toFixed(0)}/s)`);
    }
  }
  flushPending(); // durably persist index.json + invertedIndex.json
  const dur = (ms() - t0) / 1000;
  const added = 2 * N - storeErrors;
  console.log(`  ADD done: ${fmt(added)} in ${dur.toFixed(1)}s (${(added / dur).toFixed(0)}/s), errors=${storeErrors}`);
  summary.push(['ADD stores', fmt(added)]);
  summary.push(['ADD seconds', dur.toFixed(1)]);
  summary.push(['ADD /sec', (added / dur).toFixed(0)]);
  errors += storeErrors;
}

// ─── Phase 2: SEARCH ───────────────────────────────────────────────────────────
{
  console.log(`\n--- Phase 2: SEARCH (in-memory) ---`);
  const stats0 = await getStats();
  console.log(`  memIndex total: ${fmt(stats0.total)} (expect ${fmt(2 * N)})`);

  const queries = [
    'loadtestcanary-7',
    'loadtestcanary-25',
    'loadtestcanary-0',
    'alpha beta gamma',
    'synthetic filler prose',
    'lazy theta',
  ];
  const lat: number[] = [];
  for (const q of queries) {
    const t = ms();
    const res = searchIndex({ query: q, limit: 20, excludeJournal: false });
    lat.push(ms() - t);
    console.log(`  search_index "${q}": ${res.length} hits (top score ${res[0]?.score?.toFixed(3) ?? '-'})`);
  }
  lat.sort((a, b) => a - b);
  console.log(`  search_index latency p50=${pct(lat, 0.5).toFixed(2)}ms p95=${pct(lat, 0.95).toFixed(2)}ms`);

  // recall_memory with hybrid:false → pure TF-IDF. (hybrid:true would lazy-load
  // the MiniLM model on first embed() — fine when transformers is installed, but
  // a multi-second model load that's irrelevant to this TF-IDF load test, so we
  // force the TF-IDF path to keep the run reproducible and fast.)
  const t1 = ms();
  const rec = await recallMemory({ query: 'loadtestcanary-7', limit: 10, hybrid: false, excludeJournal: false });
  console.log(`  recall_memory "loadtestcanary-7" (tfidf): ${rec.length} hits in ${(ms() - t1).toFixed(2)}ms`);

  summary.push(['SEARCH p50 ms', pct(lat, 0.5).toFixed(2)]);
  summary.push(['SEARCH p95 ms', pct(lat, 0.95).toFixed(2)]);
  summary.push(['recall hits', String(rec.length)]);

  // persisted-search check: clear in-memory state, reload purely from disk.
  console.log(`\n--- Phase 2b: SEARCH (persisted, reloaded from disk) ---`);
  for (const k of Object.keys(memIndex)) delete memIndex[k];
  for (const t of Object.keys(invertedIndex)) delete invertedIndex[t];
  loadIndexes();      // reload memIndex from index.json
  recalcIdfNow();     // rebuild inverted index from the reloaded memIndex
  const stats1 = await getStats();
  console.log(`  reloaded memIndex total: ${fmt(stats1.total)} (expect ${fmt(2 * N)})`);
  const t2 = ms();
  const res2 = searchIndex({ query: 'loadtestcanary-7', limit: 20, excludeJournal: false });
  console.log(`  persisted search "loadtestcanary-7": ${res2.length} hits in ${(ms() - t2).toFixed(2)}ms`);
  if (res2.length === 0) {
    console.error(`  !! persisted search returned 0 — index reload failed`);
    errors++;
  }
  summary.push(['persisted hits', String(res2.length)]);
}

// ─── Phase 3: DELETE ───────────────────────────────────────────────────────────
{
  console.log(`\n--- Phase 3: DELETE ---`);
  // enumerate every loadtest key via the tag filter, paginating (limit cap 1000).
  const keys: string[] = [];
  let offset = 0;
  const t0 = ms();
  while (true) {
    const page = listMemories({ tag: TAG, limit: 1000, offset });
    for (const it of page.items) keys.push(it.key);
    if (!page.hasMore) break;
    offset += page.items.length;
  }
  console.log(`  enumerated ${fmt(keys.length)} loadtest keys`);

  let deleted = 0;
  let delErrors = 0;
  const BATCH = 500;
  for (let i = 0; i < keys.length; i += BATCH) {
    const slice = keys.slice(i, i + BATCH);
    try {
      const r = deleteMemories({ keys: slice, confirm: true });
      deleted += r.deleted;
      delErrors += r.errors;
    } catch (e) {
      delErrors += slice.length;
      if (delErrors <= 3) console.error(`  delete batch error:`, (e as Error).message);
    }
  }
  flushPending();
  const dur = (ms() - t0) / 1000;
  console.log(`  DELETE done: ${fmt(deleted)} in ${dur.toFixed(1)}s (${(deleted / dur).toFixed(0)}/s), errors=${delErrors}`);
  summary.push(['DELETE count', fmt(deleted)]);
  summary.push(['DELETE seconds', dur.toFixed(1)]);
  summary.push(['DELETE /sec', (deleted / dur).toFixed(0)]);
  errors += delErrors;
}

// ─── Phase 4: VERIFY ───────────────────────────────────────────────────────────
{
  console.log(`\n--- Phase 4: VERIFY ---`);
  const remaining = listMemories({ tag: TAG, limit: 1000, offset: 0 });
  const stats = await getStats();
  const personalLeft = countFiles(personalVault);
  const orgLeft = countFiles(orgVault);
  console.log(`  residual loadtest memories (by tag): ${remaining.total}`);
  console.log(`  throwaway vault total (get_stats): ${fmt(stats.total)}`);
  console.log(`  .md files left: personal=${personalLeft} org=${orgLeft}`);
  const ok = remaining.total === 0 && stats.total === 0 && personalLeft === 0 && orgLeft === 0;
  summary.push(['residual', String(remaining.total)]);
  summary.push(['VERIFY', ok ? 'PASS' : 'FAIL']);
  if (!ok) errors++;
}

// ─── summary ───────────────────────────────────────────────────────────────────
console.log(`\n=== SUMMARY ===`);
for (const [k, v] of summary) console.log(`  ${k.padEnd(16)} ${v}`);
console.log(`  ${'errors'.padEnd(16)} ${errors}`);
console.log(`  ${'overall'.padEnd(16)} ${errors === 0 ? 'PASS' : 'FAIL'}\n`);

// Filesystem sanity helper.
function countFiles(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countFiles(path.join(dir, e.name));
    else if (e.isFile() && e.name.endsWith('.md')) n++;
  }
  return n;
}

// Keep the exit explicit so flushPending's timers can't strand the process.
if (errors > 0) process.exitCode = 1;
// (Avoid leaving the throwaway HOME around if run in a one-shot mode.)
if (process.env.LT_CLEANUP === '1') {
  spawnSync('rm', ['-rf', home], { stdio: 'ignore' });
}