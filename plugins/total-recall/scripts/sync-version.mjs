#!/usr/bin/env node
// Single-source the plugin version. `package.json` is authoritative; this script
// copies its `version` into `.claude-plugin/plugin.json` (what Claude Code displays
// and what `claude plugin update` keys off), so the two files can never drift.
//
// Idempotent and surgical: it rewrites ONLY the version value — the rest of the
// manifest is left byte-for-byte unchanged (no JSON reformatting) — and it skips
// writing when the value already matches. Safe to run on every build with no dirty
// working tree when the versions are already in sync.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = path.join(root, 'package.json');
const manifestPath = path.join(root, '.claude-plugin', 'plugin.json');

const pkgVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
if (typeof pkgVersion !== 'string' || !pkgVersion) {
  console.error('sync-version: package.json has no usable "version" field');
  process.exit(1);
}

const raw = fs.readFileSync(manifestPath, 'utf8');
const versionRe = /^(\s*"version"\s*:\s*")([^"]*)(")/m;
const match = versionRe.exec(raw);
if (!match) {
  console.error('sync-version: .claude-plugin/plugin.json has no "version" field to sync');
  process.exit(1);
}

if (match[2] === pkgVersion) {
  console.log(`sync-version: plugin.json already at ${pkgVersion}`);
  process.exit(0);
}

fs.writeFileSync(
  manifestPath,
  raw.replace(versionRe, (_m, p1, _p2, p3) => `${p1}${pkgVersion}${p3}`),
);
console.log(`sync-version: plugin.json → ${pkgVersion}`);