#!/usr/bin/env node
// SessionStart helper (called by load-memory-index.sh): when the session's working
// directory holds ADL files, print a short architecture summary for the
// systems found there, within specDriven.sessionSummaryMaxChars. Prints nothing
// when the feature is off or there are no architecture files, so a project
// without ADL sees exactly the old SessionStart output.
//
// Reads ~/.total-recall/index.json (no MCP round-trip). Input: the hook's stdin
// JSON, for `cwd`. Never fails the hook: any error prints nothing.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseSpecConfig, isArchitectureFile } from '../../dist/spec-config.mjs';

const TR = path.join(os.homedir(), '.total-recall');
const MAX_DEPTH = 4;
const MAX_ENTRIES = 3000;

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}

function scan(dir, cfg) {
  const found = [];
  const skip = new Set(cfg.excludeDirs);
  let seen = 0;
  const walk = (d, depth) => {
    if (depth > MAX_DEPTH) return;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (++seen > MAX_ENTRIES) return;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!skip.has(e.name) && !e.name.startsWith('.')) walk(p, depth + 1); }
      else if (e.isFile()) { if (isArchitectureFile(e.name, cfg)) found.push(p); }
    }
  };
  walk(dir, 0);
  return found;
}

export function summary(cwd, cfg, entries) {
  if (!cfg.sessionSummary) return '';
  const found = scan(cwd, cfg);
  if (!found.length) return '';
  const systems = new Set();
  for (const f of found) {
    try {
      const m = fs.readFileSync(f, 'utf8').match(/^\s*DEFINE\s+SYSTEM\s+.+?\s+AS\s+(\S+)/m);
      if (m) systems.add(slug(m[1]));
    } catch { /* unreadable file: skip */ }
  }
  const all = Object.values(entries ?? {});
  const indexed = all.filter((m) => Array.isArray(m.tags) && m.tags.includes('architecture-index') && m.system);
  // ADL without a DEFINE SYSTEM: fall back to the indexed systems whose sourcePath ends with this directory name.
  if (!systems.size) for (const m of indexed) if (String(m.sourcePath ?? '').split('/').pop() === path.basename(cwd)) systems.add(slug(m.system));
  const lines = [`### Architecture (spec-driven)`, `${found.length} ADL file(s) in this project.`];
  for (const sys of systems.size ? systems : ['(unnamed)']) {
    const idx = indexed.find((m) => slug(m.system) === sys);
    if (!idx) {
      lines.push(`- **${sys}**: not indexed yet. Run index_architecture(path="${cwd}") to index it.`);
      continue;
    }
    const mine = all.filter((m) => m.system && slug(m.system) === sys);
    const failures = mine.filter((m) => m.artifact === 'fitness-result' && m.status === 'failed').map((m) => m.title);
    const decisions = mine.filter((m) => m.artifact === 'adr' || m.category === 'decisions')
      .sort((a, b) => String(b.updated).localeCompare(String(a.updated))).slice(0, 3).map((m) => m.title);
    const bullets = String(idx.contentPreview ?? '').split('\n').filter((l) => l.startsWith('- ')).join(' ');
    lines.push(`- **${sys}** (index \`${idx.key}\`, rev ${String(idx.sourceRev ?? '?').slice(0, 12)}): ${bullets}`);
    if (failures.length) lines.push(`  - Open fitness failures: ${failures.join('; ')}`);
    if (decisions.length) lines.push(`  - Recent decisions: ${decisions.join('; ')}`);
  }
  lines.push('Before changing a component: get_architecture_context(system, element). After a failing check: trace(id).');
  const text = lines.join('\n');
  return text.length > cfg.sessionSummaryMaxChars ? `${text.slice(0, cfg.sessionSummaryMaxChars - 1)}…` : text;
}

// Run as a script (not when imported by the tests).
const isMain = (() => { try { return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]); } catch { return false; } })();
if (isMain) {
  let input = '';
  process.stdin.on('data', (d) => { input += d; });
  process.stdin.on('end', () => {
    try {
      let cwd = process.cwd();
      try { const j = JSON.parse(input); if (typeof j.cwd === 'string' && j.cwd) cwd = j.cwd; } catch { /* no JSON on stdin */ }
      const cfg = parseSpecConfig(readJson(path.join(TR, 'config.json'))?.specDriven);
      const idx = readJson(path.join(TR, 'index.json'));
      const entries = idx && typeof idx.v === 'number' ? idx.entries : idx;
      process.stdout.write(summary(cwd, cfg, entries));
    } catch { /* never break SessionStart */ }
  });
}
