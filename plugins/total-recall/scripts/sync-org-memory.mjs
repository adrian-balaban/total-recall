#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync, spawnSync } from 'node:child_process';

import { parseFrontmatter, stringifyFrontmatter } from '../dist/frontmatter.mjs';
import { privacyCheck, sanitizeAllowedDomains } from '../dist/privacy-filter.mjs';
import { atomicWrite, cleanupInFlightTmp } from './atomic-write.mjs';

const TOTAL_RECALL_DIR = path.join(os.homedir(), '.total-recall');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(TOTAL_RECALL_DIR, 'config.json'), 'utf8'));
  } catch { return {}; }
}
const config = loadConfig();

const PERSONAL_VAULT = config.personalVault 
  ? path.resolve(config.personalVault.replace(/^~/, os.homedir()))
  : path.join(TOTAL_RECALL_DIR, 'personal-vault');

const ORG_VAULT = config.orgVault
  ? path.resolve(config.orgVault.replace(/^~/, os.homedir()))
  : path.join(TOTAL_RECALL_DIR, 'org', 'org-vault');

const ORG_VAULT_DIR = path.dirname(ORG_VAULT);
const BRANCH = 'org-vault';

const ORG_REPO = config.orgRepo;
if (!ORG_REPO) {
  console.error('Error: orgRepo is not set. Add {"orgRepo": "https://github.com/you/your-vault.git"} to ~/.total-recall/config.json');
  process.exit(1);
}

// Inject gh token so git push/pull authenticate without prompting
try {
  const token = execSync('gh auth token', { encoding: 'utf8', stdio: 'pipe' }).trim();
  if (token) process.env.GITHUB_TOKEN = token;
} catch {}

// Run a git command safely — args passed as array to avoid shell injection
function git(cwd, args, opts = {}) {
  const result = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: opts.quiet ? 'pipe' : 'inherit',
    // Defense-in-depth against a teammate-pushed .gitmodules with an ext:: submodule
    // URL (ext:: is literal command execution). orgRepo is the user's configured
    // https/git@ remote, so ext:: can't enter via the remote URL; this blocks it for
    // any submodule fetch. Applied via env so checkout/pull/add/commit/push all
    // inherit it uniformly. protocol.file is left at its default so local bare-remote
    // clones (incl. the e2e test) keep working — the file:// submodule vector is
    // closed by --no-recurse-submodules on the pull below, not by blocking file://.
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'protocol.ext.allow',
      GIT_CONFIG_VALUE_0: 'never',
    },
  });
  if (result.status !== 0 && !opts.allowFail) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr?.trim()}`);
  }
  return result.stdout ?? '';
}

// Atomic write for the org index.json is shared via scripts/atomic-write.mjs
// (write-`.tmp` + rename, with #28 throw/signal leak cleanup). See that module.
// A plain writeFileSync could leave a half-written index.json if the process is
// interrupted mid-write (the PostToolUse hook backgrounds this script, so a
// SIGTERM mid-write is a real risk); a corrupt index.json breaks the next
// SessionStart index injection.
//
// #28: if killed between writeFileSync and renameSync, unlink the in-flight
// .tmp before exiting so it can't leak (one `index.json.tmp.<hex>` per
// interrupted sync otherwise). Registered once at module load, before any
// atomicWrite call; cleanupInFlightTmp is a no-op when no write is in flight.
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sig, () => { cleanupInFlightTmp(); process.exit(1); });
}

// Allowed email domains — emails at these domains are treated as non-personal and may
// be pushed to the shared org vault. Configurable via `allowedEmailDomains` in
// ~/.total-recall/config.json (e.g. ["yourcompany.com"]). Default: empty → fail-closed,
// every email is flagged and blocked from org sync. sanitizeAllowedDomains (imported
// from dist/privacy-filter.mjs above) drops non-strings, empties, and bare TLDs — a
// "com" entry would otherwise allowlist all of *.com. The filter itself (secret + email
// checks) lives in src/privacy-filter.ts, built to dist/privacy-filter.mjs; the unit
// tests import the SAME source, so the old KEEP-IN-SYNC replica is gone.
const ALLOWED_DOMAINS = sanitizeAllowedDomains(config.allowedEmailDomains);

// Load the shared org index.json, bailing (throwing) when it EXISTS but is corrupt,
// rather than catch-wiping it. A teammate's interrupted atomicWrite, a bad manual edit,
// or a git-merge conflict marker left in index.json would parse to undefined → the old
// bare `catch {}` set `index = {}` and the function then wrote a one-entry (store) or
// empty (delete) index and commitAndPush committed it to the shared org-vault branch —
// every teammate's next pull replaced their full org index with the single-entry/empty
// one. Unlike the personal-vault loadMemIndex (self-healing via reconcileIndex from .md
// files), the org index.json IS the source of truth that gets committed, so a silent
// wipe propagates. The throw propagates to main().catch (logs to ~/.total-recall/org/
// .sync-errors.log, exit 0 — non-blocking for the hook); the file on disk is left
// untouched for manual recovery. Cold start (no index.json yet) returns {} — there is
// nothing to corrupt, and the first sync must be allowed to create it.
function loadOrgIndex(indexPath) {
  if (!fs.existsSync(indexPath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('org index.json is not a JSON object');
    }
    return parsed;
  } catch (e) {
    throw new Error(`refusing to rewrite org index (parse failed: ${e.message})`);
  }
}

function updateOrgIndex(key, data, content) {
  const indexPath = path.join(ORG_VAULT, 'index.json');
  const index = loadOrgIndex(indexPath);
  const now = new Date().toISOString();
  index[key] = {
    key,
    title: data.title ?? key,
    tags: Array.isArray(data.tags) ? data.tags : [],
    author: data.author ?? '',
    updated: data.updated ?? now,
    created: data.created ?? now,
    importanceScore: data.importanceScore ?? 0.5,
    contentPreview: content.slice(0, 500),
  };
  atomicWrite(indexPath, JSON.stringify(index, null, 2));
}

function removeFromOrgIndex(key) {
  const indexPath = path.join(ORG_VAULT, 'index.json');
  const index = loadOrgIndex(indexPath);
  delete index[key];
  atomicWrite(indexPath, JSON.stringify(index, null, 2));
}

// Symlink + realpath containment for an org-vault file (mirrors src/vault-scan.ts
// indexFile + src/tools/store.ts). The lexical path.resolve check in main() does NOT
// detect symlinks, and the org vault is a SHARED git repo: a teammate with push
// access can plant a symlink named `<relKey>.md` → any victim-readable file
// (`~/.ssh/id_rsa`, `/etc/passwd`); `git pull` preserves symlinks. Without this guard,
// readFileSync(orgFile) in store mode follows the link and reads the target into
// `raw`; if the target's first 500 chars contain no secret/email (e.g. /etc/passwd),
// privacyCheck passes and updateOrgIndex commits that content as `contentPreview`
// into the shared org index.json → a 500-char arbitrary-file leak to every teammate.
// The PostToolUse sync fires on tool invocation including errors, so this is
// reachable even when the originating store_memory threw on store.ts's own lstat
// guard. lstatSync stats the entry itself (not the target) → a symlink is rejected
// regardless of what it points at; realpathSync resolves through any link in the path
// and we re-check containment against the realpath'd org vault root. ENOENT
// (missing file) returns true: delete mode no-ops, store mode is gated by existsSync.
function orgFileIsSafe(p) {
  try {
    if (fs.lstatSync(p).isSymbolicLink()) return false;
  } catch (e) {
    if (e && e.code === 'ENOENT') return true; // missing = no link to follow
    throw e;
  }
  const realBase = fs.realpathSync(ORG_VAULT);
  const realFile = fs.realpathSync(p);
  return realFile === realBase || realFile.startsWith(realBase + path.sep);
}

// Stage, commit, and push the org-vault file + index. Returns true if a commit was
// made and pushed, false if nothing was staged (idempotent: a repeat on an unchanged
// or already-removed key is a no-op). On push failure the just-made commit is undone
// with `reset --soft HEAD~1` (keeps the change staged for a retry) so the branch stays
// clean for the next attempt; the error propagates to main()'s catch (logged to
// .sync-errors.log, exit 0 — non-blocking for the hook). Dedup of the store/delete
// commit-and-push dance.
function commitAndPush(relFile, relIndex, message) {
  git(ORG_VAULT_DIR, ['add', '--', relFile, relIndex], { quiet: true });
  // Only commit if something actually staged (the file change and/or the index change).
  // Idempotent: a repeat on an unchanged key (or an already-removed key in delete mode)
  // is a no-op.
  const staged = git(ORG_VAULT_DIR, ['diff', '--cached', '--name-only'], { quiet: true, allowFail: true }).trim();
  if (!staged) return false;
  git(ORG_VAULT_DIR, ['commit', '-m', message], { quiet: true });
  try {
    git(ORG_VAULT_DIR, ['push', 'origin', BRANCH], { quiet: true });
    return true;
  } catch (pushErr) {
    // Undo exactly our commit (soft keeps the change staged for a retry). Only safe
    // because we know HEAD advanced by one on the commit above; we never reach here if
    // commit itself failed (it would have thrown before push).
    git(ORG_VAULT_DIR, ['reset', '--soft', 'HEAD~1'], { quiet: true, allowFail: true });
    throw pushErr;
  }
}

async function main() {
  const key = process.argv[2];
  const deleteMode = process.argv.includes('--delete');
  const force = process.argv.includes('--force');

  if (!key) { console.error('Usage: sync-org-memory.mjs <key> [--delete]'); process.exit(1); }

  const relKey = key.replace(/^org\//, '');
  const orgFile = path.join(ORG_VAULT, relKey + '.md');
  // Path-traversal guard: `key` arrives from the hook (caller-supplied). A key like
  // `org/../../etc/passwd` or an absolute path would resolve `orgFile` outside the org
  // vault and let the script stage/commit/delete an arbitrary file. The realpath
  // containment check below subsumes the lexical `..` / isAbsolute arms (a `..` that
  // escapes, or an absolute path that path.join turns into a subpath, both fail the
  // startsWith containment), so they were redundant — kept only the explicit `\0`
  // rejection (path.join/resolve behave oddly on embedded nulls) plus the containment
  // check.
  if (relKey.includes('\0')) {
    console.error(`Rejecting suspicious org key: ${key}`);
    process.exit(0);
  }
  const resolvedOrgFile = path.resolve(orgFile);
  if (!resolvedOrgFile.startsWith(path.resolve(ORG_VAULT) + path.sep)) {
    console.error(`Org key escapes vault: ${key}`);
    process.exit(0);
  }
  const relFile = path.relative(ORG_VAULT_DIR, orgFile);     // e.g. org-vault/architecture/foo.md
  const relIndex = path.relative(ORG_VAULT_DIR, path.join(ORG_VAULT, 'index.json'));

  // store_memory writes org memories DIRECTLY into the org-vault working tree (which
  // lives on the `org-vault` branch after pull-org-vault.sh runs at session start). The
  // old code read from PERSONAL_VAULT here — where org files never live — so
  // existsSync was always false and every org sync silently exited 0 (a no-op). Sync
  // now commits the file that is already on disk, not a copy from personal.
  if (!deleteMode) {
    if (!fs.existsSync(orgFile)) {
      console.error(`Org file not found: ${orgFile}`);
      process.exit(0);
    }
    if (!orgFileIsSafe(orgFile)) {
      console.error(`Rejecting org key ${key}: file is a symlink or resolves outside the org vault (possible planted link in the shared repo).`);
      process.exit(0);
    }
  }

  // Keep the org-vault on the org-vault branch (its steady state). We deliberately do
  // NOT stash or restore the original branch: store_memory writes into this working
  // tree, so staying on org-vault means the next store lands in the right place and
  // the next sync commits it directly. Stashing would remove the very file we commit.
  try {
    git(ORG_VAULT_DIR, ['checkout', BRANCH], { quiet: true });
  } catch (e) {
    // checkout can refuse if an untracked org file clashes with a tracked one on
    // org-vault (rare, only if the working tree drifted off org-vault). Skip rather
    // than risk pushing from the wrong branch.
    console.error(`Cannot switch org vault to '${BRANCH}': ${e.message}`);
    return;
  }
  // Best-effort fast-forward. If it fails (e.g. an untracked-file clash with an
  // incoming path, or the remote advanced non-ff) we still try to commit locally; the
  // push will fail loudly if the remote has advanced, and we reset the local commit on
  // failure so the branch stays clean for the next attempt.
  git(ORG_VAULT_DIR, ['pull', '--ff-only', '--no-recurse-submodules', 'origin', BRANCH], { quiet: true, allowFail: true });

  if (deleteMode) {
    if (fs.existsSync(orgFile)) {
      if (!orgFileIsSafe(orgFile)) {
        console.error(`Refusing to delete org key ${key}: file is a symlink or resolves outside the org vault.`);
        process.exit(0);
      }
      // Immortal-memory guard (mirrors mutate.ts deleteMemory + store.ts store
      // force-guard). The PostToolUse sync fires on tool invocation INCLUDING
      // errors, so this runs even when the originating delete_memory threw on the
      // TS-side no-prune refusal — and the hook falls back to tool_input.key
      // (present on the request side) regardless of the error. Without this guard
      // that refused delete would unlink the org-vault file here and commitAndPush
      // the removal to the shared org-vault branch, defeating the no-prune
      // immortality contract AND propagating the deletion to every teammate on
      // their next pull. An explicit --force (forwarded by the hook when
      // tool_input.force was true) overrides, so a deliberate teardown still
      // syncs. The force=true path usually arrives with the file already unlinked
      // by the TS side, so existsSync is false and this check is skipped naturally
      // — the guard only ever fires for the refused (force=false) case.
      if (!force) {
        try {
          const { data } = parseFrontmatter(fs.readFileSync(orgFile, 'utf8'));
          const tags = Array.isArray(data.tags) ? data.tags : [];
          if (tags.includes('no-prune')) {
            console.error(`Refusing to delete org key ${key}: tagged 'no-prune' (immortal). Pass force=true to override.`);
            process.exit(0);
          }
        } catch {
          // Unreadable/unparseable frontmatter: we can't confirm the memory isn't
          // immortal. Fail safe by skipping the delete — the TS side guards the
          // canonical path; this is defense-in-depth for the shared-vault push.
          console.error(`Refusing to delete org key ${key}: frontmatter unreadable (cannot verify no-prune status).`);
          process.exit(0);
        }
      }
      try { fs.unlinkSync(orgFile); } catch {}
    }
    removeFromOrgIndex(relKey);
    const pushed = commitAndPush(relFile, relIndex, `chore(total-recall): remove ${key}`);
    if (!pushed) { console.log(`Nothing to delete for ${key}.`); return; }
    console.log(`Removed ${key} from org vault.`);
    return;
  }

  // Store mode: privacy + tag checks BEFORE staging anything (never stage a file that
  // fails — staging it would risk a later blind `git add -A` sweeping it up).
  const raw = fs.readFileSync(orgFile, 'utf8');
  const { data, content } = parseFrontmatter(raw);
  const tags = Array.isArray(data.tags) ? data.tags : [];

  if (!tags.includes('org')) {
    console.log(`Skipping ${key} — not tagged org`);
    return;
  }
  if (tags.includes('personal')) {
    console.error(`Rejecting ${key} — tagged both org and personal`);
    return;
  }

  const privacyIssue = privacyCheck(data, content, ALLOWED_DOMAINS);
  if (privacyIssue) {
    console.error(`Privacy filter blocked ${key}: ${privacyIssue}`);
    return;
  }

  updateOrgIndex(relKey, data, content);
  const pushed = commitAndPush(relFile, relIndex, `chore(total-recall): sync ${key}`);
  if (!pushed) { console.log(`Nothing to sync for ${key} (already up to date).`); return; }
  console.log(`Synced ${key} to org vault.`);
}

main().catch(e => {
  // Log to a persistent file so sync failures are discoverable — the PostToolUse hook
  // backgrounds this process, so stderr is otherwise lost. Exit 0 keeps the hook
  // non-blocking (see setup/SKILL.md "Hook output format" gotcha).
  const logPath = path.join(os.homedir(), '.total-recall', 'org', '.sync-errors.log');
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${e.message}\n`);
  } catch {}
  console.error(e.message);
  process.exit(0);
});