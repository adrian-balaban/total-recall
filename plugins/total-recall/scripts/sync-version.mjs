#!/usr/bin/env node
// Single-source the plugin version. `package.json` is authoritative; this script
// copies its `version` into every manifest that ships alongside it (currently
// `.claude-plugin/plugin.json` for Claude Code and `gemini-extension.json` for
// the Gemini CLI), so the three can never drift.
//
// Idempotent and surgical: it rewrites ONLY the version value — the rest of the
// manifest is left byte-for-byte unchanged (no JSON reformatting) — and it skips
// writing when the value already matches. Safe to run on every build with no dirty
// working tree when the versions are already in sync.
//
// Adding a new manifest: drop it into MANIFESTS and ensure its top-level
// `"version": "x.y.z"` line is the first `version` key (the regex matches the
// FIRST occurrence in each file, which is what we want — any nested `version`
// fields inside mcpServers etc. are left alone).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = path.join(root, 'package.json');
const MANIFESTS = [
  path.join(root, '.claude-plugin', 'plugin.json'),
  path.join(root, 'gemini-extension.json'),
];

const pkgVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
if (typeof pkgVersion !== 'string' || !pkgVersion) {
  console.error('sync-version: package.json has no usable "version" field');
  process.exit(1);
}

const versionRe = /^(\s*"version"\s*:\s*")([^"]*)(")/m;
let changed = 0;
let skipped = 0;

for (const manifestPath of MANIFESTS) {
  if (!fs.existsSync(manifestPath)) {
    // gemini-extension.json is optional for Claude-Code-only consumers; don't
    // fail the build just because it's not present in older checkouts.
    console.log(`sync-version: skip (missing) ${path.relative(root, manifestPath)}`);
    continue;
  }
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const match = versionRe.exec(raw);
  if (!match) {
    console.error(`sync-version: ${path.relative(root, manifestPath)} has no "version" field to sync`);
    process.exit(1);
  }
  if (match[2] === pkgVersion) {
    console.log(`sync-version: ${path.relative(root, manifestPath)} already at ${pkgVersion}`);
    skipped += 1;
    continue;
  }
  fs.writeFileSync(
    manifestPath,
    raw.replace(versionRe, (_m, p1, _p2, p3) => `${p1}${pkgVersion}${p3}`),
  );
  console.log(`sync-version: ${path.relative(root, manifestPath)} → ${pkgVersion}`);
  changed += 1;
}

if (changed === 0 && skipped === 0) {
  // All listed manifests were missing (e.g. partial checkout). Per-file skips
  // were already logged above, so nothing more to say.
}