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

const VAULT = path.join(os.homedir(), '.total-recall', 'personal-vault');

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

    const category = obj.category && /^[a-z0-9_-]+$/i.test(obj.category) ? obj.category : 'knowledge';
    const dir = path.join(VAULT, category);
    try { fs.mkdirSync(dir, { recursive: true }); } catch { errors++; continue; }

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
      importanceScore: typeof obj.importanceScore === 'number' ? obj.importanceScore : 0.5,
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