import * as fs from 'fs';
import * as path from 'path';
import { PERSONAL_VAULT, ORG_VAULT, EXCLUDED_DIRS } from './paths.js';

// The one definition of "which files in a vault are memories, and what are their keys".
// reconcileIndex (the server) and the SessionStart index-cache bundle both walk through
// here, so the two can never disagree about which files exist. May import only paths and
// Node built-ins — never state, vectorStore, embeddings or persistence ([TR-S13]) — so
// the hook bundle stays small and starts fast.

// Prototype-pollution guard: memory keys are used as plain-object property names in
// memIndex and the org index.json. A key like `__proto__`, `constructor`, or `prototype`
// (or any path segment equal to one) would set the object's prototype/constructor or,
// on delete, mutate the prototype chain of every object. Reject these segments
// everywhere keys are accepted.
export const RESERVED_KEY_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

export function isReservedKey(key: string): boolean {
  if (typeof key !== 'string' || !key) return true;
  const isOrg = key.startsWith('org/');
  const rel = isOrg ? key.slice('org/'.length) : key;
  if (!rel) return true;
  return rel.split('/').some((s) => RESERVED_KEY_SEGMENTS.has(s));
}

// Keys always use `/` separators regardless of platform: on Windows path.relative
// returns `\`-separated segments, which would produce keys like `architecture\foo`
// that deriveFilePathFromKey rejects as a path-escape attempt.
export function keyUnder(base: string, filePath: string, isOrg: boolean): string {
  const rel = path
    .relative(base, filePath)
    .split(path.sep)
    .join('/')
    .replace(/\.md$/, '');
  return isOrg ? `org/${rel}` : rel;
}

export function categoryUnder(base: string, filePath: string): string {
  const parts = path.relative(base, filePath).split(path.sep);
  return parts.length > 1 ? (parts[0] ?? 'knowledge') : 'knowledge';
}

export function keyFromPath(filePath: string, isOrg: boolean): string {
  return keyUnder(isOrg ? ORG_VAULT : PERSONAL_VAULT, filePath, isOrg);
}

export function deriveCategory(filePath: string, isOrg: boolean): string {
  return categoryUnder(isOrg ? ORG_VAULT : PERSONAL_VAULT, filePath);
}

// Whether the walk enters a directory. EXCLUDED_DIRS match in any casing; a personal-vault
// subdirectory literally named `org` is reserved for the org vault's key prefix.
function descends(name: string, isOrg: boolean): boolean {
  if (EXCLUDED_DIRS.has(name.toLowerCase())) return false;
  return isOrg || name !== 'org';
}

// Every memory `.md` under `base`, in readdir order. Skips:
//  - symlinks (files and directories): `git pull` preserves them, so a teammate with
//    push access to the shared org vault could plant `x.md -> ~/.ssh/id_rsa` or a
//    symlinked directory pointing outside the vault, and a reader that follows it would
//    dump the target into the index;
//  - EXCLUDED_DIRS, compared case-insensitively;
//  - a personal-vault subdirectory literally named `org`: the `org/` key prefix is
//    reserved for the org vault, so indexing it would shadow org keys.
// `onError` receives a non-ENOENT readdir failure (EACCES, EMFILE); the subtree is
// skipped either way. ENOENT (the dir vanished since the walk scheduled it) is silent.
export function listVaultFiles(
  base: string,
  isOrg: boolean,
  onError: (message: string) => void = () => {},
): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      if (e && (e as NodeJS.ErrnoException).code !== 'ENOENT') {
        onError(`reconcile readdirSync(${dir}): ${(e as Error).message}`);
      }
      return;
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      // `e.name` is a filesystem-discovered entry from readdirSync (excludes `.`/`..`;
      // filenames can't contain `/`), and `dir` is vault-rooted by the walk.
      const fp = path.join(dir, e.name); // nosemgrep: path-join-resolve-traversal — filesystem-discovered name, vault-rooted walk.
      if (e.isDirectory()) {
        if (descends(e.name, isOrg)) walk(fp);
      } else if (e.name.endsWith('.md')) {
        out.push(fp);
      }
    }
  };
  walk(base);
  return out;
}
