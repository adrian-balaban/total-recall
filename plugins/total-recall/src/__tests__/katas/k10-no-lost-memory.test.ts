// K10 — "no memory may be lost" (course pp. 35–36: no-lost-answer reconciliation).
// Sketch: katas/s3-k10-no-lost-memory/adl/no-lost-memory-kata.adl. Fitness functions for [K10-01]..[K10-03];
// each has a known-pass and a known-fail. Fixtures are synthetic strings (source and backlog text).
// The .md files are the only copy of a memory's content (plugins/total-recall/CLAUDE.md), so these
// are the paths where content can be lost: a half-written file, an archive that failed silently, and
// an extract nobody can tell from a deliberate memory.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const PLUGIN = path.resolve(__dirname, '../../..'); // plugins/total-recall
const REPO = path.resolve(PLUGIN, '../..');
const read = (base: string, rel: string) => fs.readFileSync(path.join(base, rel), 'utf8');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ---- [K10-01] a non-atomic memory write is a recorded exemption, not a silent default -----------
// The hook writer (store-learning.mjs) writes tmp + rename. The server writers (store.ts, mutate.ts)
// use a plain writeFileSync, so a crash mid-write can truncate the only copy. That is a documented
// decision (BACKLOG, "Atomic writes for memory .md files"); the check pins the pairing so the decision
// cannot go stale in either direction: raw writes with no entry, or an entry once the writes are gone.
const RAW_WRITE = /\bfs\.writeFileSync\(/g;
function rawMemoryWriteSites(files: Record<string, string>): number {
  return Object.values(files).reduce((n, src) => n + (code(src).match(RAW_WRITE)?.length ?? 0), 0);
}
function atomicityExemptionProblems(sites: number, backlog: string): string[] {
  const entry = backlog.split(/\n(?=### )/).find(e => /^### Atomic writes for memory `\.md` files/.test(e));
  const hasTrigger = !!entry && /\*\*Trigger:\*\*/.test(entry);
  if (sites > 0 && !hasTrigger) return [`${sites} raw memory-file write site(s) and no backlog entry with a trigger`];
  if (sites === 0 && entry) return ['the backlog entry is stale: no raw memory-file write remains'];
  return [];
}
const BL_ENTRY = '### Atomic writes for memory `.md` files\n- **Trigger:** a truncated memory file after a crash.\n';

describe('[K10-01] raw memory-file writes are a recorded, expiring exemption', () => {
  it('[K10-01] known-pass: raw writes with a backlog entry and a trigger', () => {
    expect(atomicityExemptionProblems(2, BL_ENTRY)).toEqual([]);
  });
  it('[K10-01] known-fail: raw writes with no entry, or an entry once the writes are gone, are named', () => {
    expect(atomicityExemptionProblems(3, '### Something else\n- **Trigger:** x\n')).toHaveLength(1);
    expect(atomicityExemptionProblems(0, BL_ENTRY)).toEqual(['the backlog entry is stale: no raw memory-file write remains']);
  });
  it('[K10-01] known-pass: comments do not count as write sites', () => {
    expect(rawMemoryWriteSites({ 'a.ts': '// fs.writeFileSync(x, y)\n/* fs.writeFileSync(z) */\nfs.writeFileSync(real, 1);\n' })).toBe(1);
  });
  it('[K10-01] on the real tree: the server writes are raw, the hook writer is atomic, and the exemption exists', () => {
    const server = rawMemoryWriteSites({ store: read(PLUGIN, 'src/tools/store.ts'), mutate: read(PLUGIN, 'src/tools/mutate.ts') });
    expect(server).toBe(4); // pinned: store (file + archive) and mutate (update + confirm); lower it as writes move to atomicWrite
    expect(code(read(PLUGIN, 'hooks/scripts/store-learning.mjs'))).toMatch(/\batomicWrite\(/);
    expect(atomicityExemptionProblems(server, read(REPO, 'backlog-and-plans/BACKLOG.md'))).toEqual([]);
  });
});

// ---- [K10-02] provenance: every memory writer says where a memory came from -----------------------
// A memory the PreCompact hook extracted and one an agent stored on purpose are different in trust and
// in how to prune them. The server stamps the session. The hook writes `sessions: []` and no marker.
function emptyProvenanceWriters(files: Record<string, string>): string[] {
  return Object.entries(files)
    .filter(([, src]) => /(?<![.\w])sessions\s*:\s*\[\s*\]/.test(code(src)) && !/\b(source|origin|provenance)\s*:|precompact-extract/i.test(code(src)))
    .map(([name]) => name);
}

describe('[K10-02] no memory writer leaves provenance empty', () => {
  it('[K10-02] known-pass: a writer that stamps the session, or an origin, is fine', () => {
    expect(emptyProvenanceWriters({ 'a.ts': 'const fm = { sessions: [sessionId] };\n', 'b.mjs': "const fm = { sessions: [], source: 'precompact' };\n" })).toEqual([]);
  });
  it('[K10-02] known-fail: a writer with empty sessions and no origin is named', () => {
    expect(emptyProvenanceWriters({ 'hook.mjs': 'const fm = { title, sessions: [], created: now };\n' })).toEqual(['hook.mjs']);
  });
  it('[K10-02] the real writers: the PreCompact extractor leaves provenance empty (finding, pinned)', () => {
    const files = { 'src/tools/store.ts': read(PLUGIN, 'src/tools/store.ts'), 'hooks/scripts/store-learning.mjs': read(PLUGIN, 'hooks/scripts/store-learning.mjs') };
    // Disposition: BACKLOG entry (answers.md). When the extractor stamps an origin, this becomes [].
    expect(emptyProvenanceWriters(files)).toEqual(['hooks/scripts/store-learning.mjs']);
  });
});

// ---- [K10-03] a data-preserving step that fails must say so --------------------------------------
// A force-overwrite archives the prior body under .superseded before it overwrites. The archive is
// best-effort, so a failed archive does not block the overwrite, and the prior body is gone. That is a
// defensible choice only if the failure is recorded. The check: the archive block has a catch that
// calls recordError (or rethrows).
function silentArchiveCatch(storeSrc: string): boolean {
  const start = storeSrc.indexOf("'.superseded'");
  if (start < 0) return false;
  const block = storeSrc.slice(start, storeSrc.indexOf('supersededAt = [', start));
  return /\bcatch\b/.test(block) && !/recordError\(|\bthrow\b/.test(code(block).slice(code(block).indexOf('catch')));
}

describe('[K10-03] a failed supersede archive is recorded', () => {
  it('[K10-03] known-pass: an archive catch that records the error is fine', () => {
    expect(silentArchiveCatch("path.join(root, '.superseded', c);\n} catch (e) { recordError(String(e)); }\nsupersededAt = [];\n")).toBe(false);
  });
  it('[K10-03] known-fail: an archive catch that swallows the error is named', () => {
    expect(silentArchiveCatch("path.join(root, '.superseded', c);\n} catch { /* best-effort */ }\nsupersededAt = [];\n")).toBe(true);
  });
  it('[K10-03] the real store.ts: the archive failure is swallowed (finding, pinned)', () => {
    // Disposition: BACKLOG entry (answers.md). When the catch records the error, flip this to false.
    expect(silentArchiveCatch(read(PLUGIN, 'src/tools/store.ts'))).toBe(true);
  });
});
