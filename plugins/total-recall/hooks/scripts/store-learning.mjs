#!/usr/bin/env node
// PreCompact helper: writes extracted learnings directly to the personal vault as
// frontmatter .md files. Reads one JSON object per line on stdin (fields: title,
// content, tags, category, importanceScore) and writes each to
// ~/.total-recall/personal-vault/<category>/<slug>.md.
//
// This replaces the old `claude -p ... --mcp` storage path (the --mcp flag does not
// exist, so storage was a silent no-op). Direct writes avoid any nested Claude
// process and any MCP round-trip; the file is picked up by the next boot's
// reconcile_index or an explicit rebuild_index.
//
// Existing memories are NEVER overwritten — if a slug already exists, the line is
// skipped (the extract prompt may re-surface similar learnings across sessions).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { stringifyFrontmatter } from '../../dist/frontmatter.mjs';
import { atomicWrite, cleanupInFlightTmp } from '../../scripts/atomic-write.mjs';

const CONFIG_FILE = path.join(os.homedir(), '.total-recall', 'config.json');
let VAULT = path.join(os.homedir(), '.total-recall', 'personal-vault');
try {
  if (fs.existsSync(CONFIG_FILE)) {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (config.personalVault) {
      VAULT = path.resolve(config.personalVault.replace(/^~/, os.homedir()));
    }
  }
} catch {}

// Atomic write (write-`.tmp` + rename) for the memory .md is shared via
// scripts/atomic-write.mjs. A partial write would leave a corrupt frontmatter
// on disk; the existsSync guard below would then treat the partial file as
// "existing" and skip re-extraction forever — so a crashed extract silently
// blocks future captures of the same learning. Atomic rename guarantees the
// file only appears once it's fully written.
//
// #28: if killed between writeFileSync and renameSync, unlink the in-flight
// .tmp before exiting so a partial .md can't leak AND can't be mistaken for a
// finished memory by the next run's existsSync guard (which would permanently
// block that learning from re-extraction). Registered once at module load,
// before any atomicWrite call; cleanupInFlightTmp is a no-op when no write is
// in flight. Mirrors the `trap cleanup EXIT` pattern in build-memory-index.sh.
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sig, () => { cleanupInFlightTmp(); process.exit(1); });
}

function slugify(s) {
  return String(s || 'untitled')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'untitled';
}

// yamlScalar/fmStringify removed — now using shared stringifyFrontmatter from dist/frontmatter.mjs

// Clamp importanceScore to a finite [0, 1] number — mirrors src/ebbinghaus.ts
// `clampImportanceScore` (used by the TS store_memory path) so this direct-vault
// write can't persist a value the MCP path would have rejected. The extract prompt
// asks the model for 0.0–1.0, but the model can drift (5, -1, "high"), and this hook
// writes straight to disk with no MCP round-trip, so an unclamped value would land in
// the stored metadata and survive until something re-clamps it on read. The
// Number.isFinite guard is critical: Math.min(1, NaN) returns NaN (NaN propagates
// through Math.min/max), so a non-numeric or NaN input must fall back to 0.5, not 0
// (Math.max(0, NaN) is also NaN).
function clampImportance(v, fallback = 0.5) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
}

let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  const now = new Date().toISOString();
  let written = 0, skipped = 0, errors = 0;
  for (const line of input.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj;
    try { obj = JSON.parse(trimmed); } catch { errors++; continue; }
    if (!obj || !obj.title || !obj.content) { errors++; continue; }

    // A newline in a frontmatter scalar (title/tag) would spill onto the next
    // line and inject a spurious key on re-parse. Skip malformed/malicious lines
    // rather than risk frontmatter injection into the personal vault.
    if (/[\r\n]/.test(obj.title) ||
        (Array.isArray(obj.tags) && obj.tags.some(t => /[\r\n]/.test(String(t))))) {
      errors++; continue;
    }

    // The `org` namespace is reserved for the git-synced org vault. PreCompact
    // extracts must never land there or claim the org tag — they would be silently
    // ignored by reconcileIndex (which skips a personal-vault `org/` subtree) and
    // would pollute the org/personal mutual-exclusion checks. Block the exact string
    // AND any `org/`-prefixed value (e.g. `org/architecture` from a drifting model):
    // the reconcileIndex personal-vault walk skips the ENTIRE `org/` subtree, so a
    // `category: 'org/architecture'` write silently orphans the file. Mirrors the
    // prefix guard in src/tools/store.ts:100 (`category === 'org' || startsWith('org/')`).
    const catLower = String(obj.category ?? '').toLowerCase();
    if (catLower === 'org' || catLower.startsWith('org/')) { errors++; continue; }
    if (Array.isArray(obj.tags) && obj.tags.some(t => String(t).toLowerCase() === 'org')) { errors++; continue; }

    const category = obj.category && /^[a-z0-9_-]+$/i.test(obj.category) ? obj.category : 'knowledge';
    const dir = path.join(VAULT, category);
    try { fs.mkdirSync(dir, { recursive: true }); } catch { errors++; continue; }

    // A symlinked category dir (planted by a teammate or a bad config) would let
    // an extract escape the personal vault. lstat + isDirectory + !isSymbolicLink
    // keeps writes inside the real vault only.
    let dirStat;
    try { dirStat = fs.lstatSync(dir); } catch { errors++; continue; }
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) { errors++; continue; }

    const slug = slugify(obj.title);
    const filePath = path.join(dir, `${slug}.md`);
    if (fs.existsSync(filePath)) { skipped++; continue; } // never overwrite from extract

    const fm = {
      title: obj.title,
      tags: Array.isArray(obj.tags) ? obj.tags : [],
      author: os.userInfo().username,
      sessions: [],
      created: now,
      updated: now,
      importanceScore: clampImportance(obj.importanceScore),
    };
    const body = `\n${obj.content}`;
    try {
      atomicWrite(filePath, stringifyFrontmatter(body, fm));
      written++;
    } catch { errors++; }
  }
  // Keep stdout clean (hooks must not spam it). Summary goes to stderr for debugging.
  process.stderr.write(`store-learning: ${written} written, ${skipped} skipped (existing), ${errors} errors\n`);
});