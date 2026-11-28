# PLAN — Complete journal and learning extraction at SessionEnd

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A work session that ends without compaction and without an explicit `store_memory` must still leave a trace in the vault: automatically extracted learnings, and journal lines for every change to personal memories.

**Architecture:** `session-end.sh` reads the stdin hook JSON (`session_id`, `transcript_path`) and logs the real `session_id` to `.session-end.log`. It then launches, detached (`setsid`/`nohup`, in the background), the same `extract-and-store-memories.sh` that PreCompact uses. The hook has a 5 s timeout and `claude -p` takes longer. An env guard (`TR_EXTRACT_RUNNING=1`) stops recursion, because the nested `claude -p` fires SessionEnd too. Separately, `update_memory` and `delete_memory` write to the journal, as `store_memory` already does.

**Tech Stack:** bash (hooks), TypeScript + vitest (MCP server), Node ≥ 20.

---

## 0. Context — why (verified 2026-11-13, do not re-derive)

On 2026-11-12, between 16:11 and 21:59 UTC, two sessions ran in the total-recall repo: `a382fe82…` and `b2bb06fb…`. The only journal for that day lists 6 smoke tests, which were deleted seconds after they were stored. Causes:

1. `appendJournal` is called only from `src/tools/store.ts:367` (`if (!isOrg) appendJournal('store', …)`). Updates and deletes never reach the journal, so it shows memories that no longer exist.
2. Automatic capture (`extract-and-store-memories.sh`) is wired only to `PreCompact`. Neither session compacted. The last `outcome=` line in `~/.total-recall/.extract.log` is from 2026-11-09.
3. `session-end.sh` only logs, sends SIGTERM to the MCP server and takes a git snapshot. It extracts nothing.
4. `session-end.sh` writes `claude_session_id=${CLAUDE_SESSION_ID:-unknown}`. That variable is never set, so all ~2290 lines of `.session-end.log` read `unknown`. The ID arrives on stdin as `session_id`, and `extract-and-store-memories.sh` already reads it from there.

**Out of scope:** isolating the smoke tests in `RELEASE-SMOKE-TEST.md` (they deliberately exercise the real installed plugin), and the agent's discipline in calling `store_memory`.

**Accepted risks:**
- Every session that ends with a transcript costs one `claude -p` call. Users can turn this off with `TR_SESSION_END_EXTRACT=0`.
- A session that compacted may be extracted twice. `store-learning.mjs` skips existing slugs (test A9), but differently worded titles can still produce duplicates.

## File structure

All paths are relative to `plugins/total-recall/`.

| File | Change |
|---|---|
| `src/tools/mutate.ts` | `appendJournal('update' \| 'delete', …)` for personal keys |
| `src/__tests__/index.test.ts` | Journal tests for update/delete (next to the existing test at ~line 406) |
| `hooks/scripts/extract-and-store-memories.sh` | exports `TR_EXTRACT_RUNNING=1` to `claude -p`; `trigger=` field on the `outcome=` line |
| `src/__tests__/extract-and-store-hook.test.ts` | Tests for the guard and `trigger=` |
| `hooks/scripts/session-end.sh` | reads stdin, logs `session_id`, launches the extraction detached |
| `src/__tests__/hook-scripts.test.ts` | New SessionEnd tests (after ~line 1005) |
| `ARCHITECTURE.md`, `../../README.md`, `../../README-ro.md`, `package.json` | docs and version |

`hooks/hooks.json` and `hooks/hooks.gemini.json` **do not change**: the same scripts run on the same events, so `hooks-parity.test.ts` stays green.

---

### Task 0: Branch

- [ ] **Step 1: Start from an up-to-date `origin/main`**

```bash
cd ~/_/in-progress/diverse/total-recall
git status --short          # must be empty; otherwise stop and ask
git fetch origin
git switch -c fix/journal-session-capture origin/main
cd plugins/total-recall && npm ci && npm run build
```

Expected: the build succeeds and `dist/frontmatter.mjs` exists. The hook tests need it.

---

### Task 1: Journal for `update_memory` and `delete_memory`

**Files:**
- Modify: `src/tools/mutate.ts` (`updateMemory` ~line 146, `deleteMemory` ~line 200)
- Test: `src/__tests__/index.test.ts` (after the test `'appends to journal for personal memories'`)

- [ ] **Step 1: Write the failing tests**

Insert right after the test `'appends to journal for personal memories'` in `src/__tests__/index.test.ts`:

```ts
  it('appends an [update] journal line for a personal update_memory', async () => {
    const res = result(await callTool('store_memory', { title: 'Journal Upd', content: 'X', tags: [], category: 'knowledge' }));
    await callTool('update_memory', { key: res.key, content: 'Y' });
    const today = new Date().toISOString().slice(0, 10);
    const body = fs.readFileSync(path.join(VAULT, 'personal-vault', 'journal', `${today}.md`), 'utf8');
    expect(body).toMatch(new RegExp(`\\[update\\] \\*\\*Journal Upd\\*\\* \\(\`${res.key}\`\\)`));
  });

  it('appends a [delete] journal line (with the pre-delete title) for a personal delete_memory', async () => {
    const res = result(await callTool('store_memory', { title: 'Journal Del', content: 'X', tags: [], category: 'knowledge' }));
    await callTool('delete_memory', { key: res.key });
    const today = new Date().toISOString().slice(0, 10);
    const body = fs.readFileSync(path.join(VAULT, 'personal-vault', 'journal', `${today}.md`), 'utf8');
    expect(body).toMatch(new RegExp(`\\[delete\\] \\*\\*Journal Del\\*\\* \\(\`${res.key}\`\\)`));
  });
```

`result`, `callTool` and `VAULT` already exist in the file; the neighbouring test uses them.

- [ ] **Step 2: Run them and confirm they fail**

Run: `HOME=$(mktemp -d) npx vitest run src/__tests__/index.test.ts -t "journal line"`
Expected: 2 FAIL (the regex finds no `[update]` / `[delete]`).

- [ ] **Step 3: Implement**

In `src/tools/mutate.ts`, add the import after `import { scheduleSave } from '../persistence.js';`:

```ts
import { appendJournal } from '../journal.js';
```

In `updateMemory`, replace `return { key, message: 'Memory updated.' };` with:

```ts
  // Journal personal updates too (store.ts journals only stores): a day's journal
  // that shows a memory as stored but never its later edits misleads recall.
  // Org memories stay out of the personal journal, mirroring store.ts.
  if (!meta.isOrg) appendJournal('update', key, meta.title);

  return { key, message: 'Memory updated.' };
```

In `deleteMemory`, replace the block from `try { fs.unlinkSync(meta.filePath); } catch {}` through `return { key, message: 'Memory deleted.' };` with:

```ts
  // Capture before `delete memIndex[key]` drops the metadata.
  const { title, isOrg } = meta;
  try { fs.unlinkSync(meta.filePath); } catch {}
  delete memIndex[key];
  deregisterDocument(key);
  contentCache.delete(key);
  deleteVector(VECTORS_DB, key).catch(() => {});
  scheduleSave();
  // Without this line a stored-then-deleted memory (e.g. a smoke test) looks
  // alive in the journal forever. appendJournal never throws (journal.ts).
  if (!isOrg) appendJournal('delete', key, title);

  return { key, message: 'Memory deleted.' };
```

First check that in `updateMemory` the variable is named `meta` and is reassigned after the update; the line `applySpecFields(meta, spec);` confirms it. If `meta` is a new object at that point, `meta.title` is the current title, which is correct.

- [ ] **Step 4: Run the tests**

Run: `HOME=$(mktemp -d) npx vitest run src/__tests__/index.test.ts src/__tests__/mutate.test.ts src/__tests__/journal.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/mutate.ts src/__tests__/index.test.ts
git commit -m "feat(journal): record personal update_memory and delete_memory, not only stores

A day's journal listed memories as stored that had been deleted seconds later
(2026-11-12 smoke tests), and never showed edits.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Recursion guard and `trigger=` in the extractor

**Files:**
- Modify: `hooks/scripts/extract-and-store-memories.sh`
- Test: `src/__tests__/extract-and-store-hook.test.ts`

- [ ] **Step 1: Extend the stub and write the failing tests**

In `CLAUDE_STUB`, add after the `TR_CLAUDE_ARGS_FILE` line:

```bash
[ -n "\${TR_CLAUDE_ENV_FILE:-}" ] && printf '%s' "\${TR_EXTRACT_RUNNING:-}" > "$TR_CLAUDE_ENV_FILE"
```

In `runHook`, add `TR_CLAUDE_ENV_FILE: path.join(tmpHome, 'claude-env.txt'),` to `env`, plus a new option:

```ts
  trigger?: string;       // TR_EXTRACT_TRIGGER for the hook run
```

with `if (opts.trigger !== undefined) env.TR_EXTRACT_TRIGGER = opts.trigger;` before `env.PATH = …`.

Add these tests at the end of the suite:

```ts
  it('G1: the nested `claude -p` runs with TR_EXTRACT_RUNNING=1 (SessionEnd recursion guard)', () => {
    runHook(JSON.stringify({ transcript_path: transcript }), { claudeLines: '' });
    expect(fs.readFileSync(path.join(tmpHome, 'claude-env.txt'), 'utf8')).toBe('1');
  });

  it('G2: the outcome line records trigger=precompact by default', () => {
    runHook(JSON.stringify({ transcript_path: transcript }), { claudeLines: '' });
    const line = fs.readFileSync(extractLog(), 'utf8').split('\n').filter((l) => / outcome=/.test(l)).pop()!;
    expect(line).toMatch(/ trigger=precompact$/);
  });

  it('G3: TR_EXTRACT_TRIGGER=session-end is recorded on the outcome line', () => {
    runHook(JSON.stringify({ transcript_path: transcript }), { claudeLines: '', trigger: 'session-end' });
    const line = fs.readFileSync(extractLog(), 'utf8').split('\n').filter((l) => / outcome=/.test(l)).pop()!;
    expect(line).toMatch(/ trigger=session-end$/);
  });
```

- [ ] **Step 2: Confirm they fail**

Run: `HOME=$(mktemp -d) npx vitest run src/__tests__/extract-and-store-hook.test.ts`
Expected: G1, G2 and G3 FAIL. The existing tests pass, including the E1 tests, which only check `outcome=…` prefixes.

- [ ] **Step 3: Implement**

In `extract-and-store-memories.sh`, after `EXTRACT_LOG="$HOME/.total-recall/.extract.log"`:

```bash
# Which lifecycle event ran this extraction: PreCompact (default) or SessionEnd,
# which re-runs this script detached (session-end.sh). Sanitised: it lands in a
# log line that check-extract-outcomes.sh greps.
TRIGGER=$(printf '%s' "${TR_EXTRACT_TRIGGER:-precompact}" | tr -cd 'a-z-')
TRIGGER=${TRIGGER:-precompact}
```

On the `claude -p` line, prefix the invocation with the env guard:

```bash
TR_EXTRACT_RUNNING=1 "$CLAUDE_BIN" -p "$EXTRACT_PROMPT" --tools "" --strict-mcp-config --disable-slash-commands --no-session-persistence \
```

Leave the rest of that line unchanged. Put this comment above it:

```bash
# TR_EXTRACT_RUNNING=1: the nested `claude -p` is itself a Claude Code session and
# fires SessionEnd; session-end.sh sees this flag and does not spawn another
# extraction (otherwise every extraction would recurse).
```

Extend the `printf` of the outcome line:

```bash
printf '%s v%s session=%s outcome=%s written=%s skipped=%s errors=%s dropped=%s claude_rc=%s trigger=%s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$VERSION" "${SESSION:-unknown}" "$OUTCOME" \
  "$N_WRITTEN" "$N_SKIPPED" "$N_ERRORS" "$N_DROPPED" "${CLAUDE_RC:-0}" "$TRIGGER" >>"$EXTRACT_LOG" 2>/dev/null || true
```

`check-extract-outcomes.sh` greps ` outcome=(cli-error|store-error|dropped) `, with a space after the value. That space is still there, so nothing changes in that script.

- [ ] **Step 4: Run**

Run: `HOME=$(mktemp -d) npx vitest run src/__tests__/extract-and-store-hook.test.ts src/__tests__/hook-scripts.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add hooks/scripts/extract-and-store-memories.sh src/__tests__/extract-and-store-hook.test.ts
git commit -m "feat(extract): recursion guard env and trigger= on the outcome line

Prepares SessionEnd extraction: the nested claude -p fires SessionEnd itself.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `session-end.sh` logs the real `session_id`

**Files:**
- Modify: `hooks/scripts/session-end.sh`
- Test: `src/__tests__/hook-scripts.test.ts`

- [ ] **Step 1: Write the failing test**

After the test `'session-end.sh: does NOT git-init a non-repo personal vault'`:

```ts
  it('session-end.sh: logs session_id from the stdin hook JSON, not the never-set env var', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-sessid-'));
    fs.mkdirSync(path.join(home, '.total-recall'), { recursive: true });
    const r = spawnSync('bash', [SESSION_END_SCRIPT], {
      encoding: 'utf8', stdio: 'pipe',
      input: JSON.stringify({ session_id: 'b2bb06fb-1e55-4d80', hook_event_name: 'SessionEnd', reason: 'other' }),
      env: { ...process.env, HOME: home, TR_SESSION_END_EXTRACT: '0' },
    });
    expect(r.status).toBe(0);
    const log = fs.readFileSync(path.join(home, '.total-recall', '.session-end.log'), 'utf8');
    expect(log).toMatch(/ claude_session_id=b2bb06fb-1e55-4d80$/m);
    fs.rmSync(home, { recursive: true, force: true });
  });
```

The existing test sends no `input` and still expects `claude_session_id=unknown`, so it stays valid.

- [ ] **Step 2: Confirm it fails**

Run: `HOME=$(mktemp -d) npx vitest run src/__tests__/hook-scripts.test.ts -t "session_id from the stdin"`
Expected: FAIL (`unknown`).

- [ ] **Step 3: Implement**

In `session-end.sh`, right after `LOG="$TOTAL_RECALL_DIR/.session-end.log"`:

```bash
# Claude Code passes the hook input as JSON on stdin (session_id, transcript_path,
# reason). CLAUDE_SESSION_ID is never set, so every marker used to read
# "claude_session_id=unknown". Never block on a terminal; bash-only parsing keeps
# this hook free of a node dependency (the values are UUIDs / plain paths).
HOOK_INPUT=""
if [ ! -t 0 ]; then HOOK_INPUT=$(cat 2>/dev/null || true); fi
json_str() {
  printf '%s' "$HOOK_INPUT" | sed -nE "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"([^\"]*)\".*/\1/p" | head -1
}
SESSION_ID=$(json_str session_id | tr -cd 'A-Za-z0-9_-')
SESSION_ID=${SESSION_ID:-${CLAUDE_SESSION_ID:-unknown}}
```

In the marker's `printf`, replace `"${CLAUDE_SESSION_ID:-unknown}"` with `"$SESSION_ID"`.

- [ ] **Step 4: Run**

Run: `HOME=$(mktemp -d) npx vitest run src/__tests__/hook-scripts.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add hooks/scripts/session-end.sh src/__tests__/hook-scripts.test.ts
git commit -m "fix(session-end): log the real session_id from stdin hook JSON

CLAUDE_SESSION_ID is never set; all ~2290 markers in .session-end.log read unknown.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Detached extraction at SessionEnd

**Files:**
- Modify: `hooks/scripts/session-end.sh`
- Test: `src/__tests__/hook-scripts.test.ts`

- [ ] **Step 1: Write the failing tests**

Add at the top of the test file, after the existing constants:

```ts
// Fake `claude` for the SessionEnd extraction tests: records that it ran and the
// recursion-guard env, optionally sleeps (to prove the hook does not wait), then
// prints nothing (outcome=nothing is enough to see the run completed).
const SE_CLAUDE_STUB = `#!/usr/bin/env bash
cat > /dev/null
printf '%s' "\${TR_EXTRACT_RUNNING:-}" > "$TR_SE_MARKER"
sleep "\${TR_SE_SLEEP:-0}"
exit 0
`;

function waitFor(pred: () => boolean, ms = 15000): boolean {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return true;
    spawnSync('sleep', ['0.2']);
  }
  return pred();
}

function seSetup(prefix: string) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(home, '.total-recall'), { recursive: true });
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'claude'), SE_CLAUDE_STUB);
  fs.chmodSync(path.join(bin, 'claude'), 0o755);
  const transcript = path.join(home, 't.jsonl');
  fs.writeFileSync(transcript, '{"role":"user","content":"hello"}\n');
  const marker = path.join(home, 'claude-ran');
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, NODE_BIN: process.execPath, TR_SE_MARKER: marker };
  const input = JSON.stringify({ session_id: 'sess-1', transcript_path: transcript, hook_event_name: 'SessionEnd' });
  const extractLog = path.join(home, '.total-recall', '.extract.log');
  return { home, env, input, marker, extractLog };
}

const HAS_DIST = fs.existsSync(path.join(REPO_ROOT, 'dist', 'frontmatter.mjs'));
```

Then, inside the `describe`, after the Task 3 test:

```ts
  (HAS_DIST ? it : it.skip)('session-end.sh: spawns a detached extraction (trigger=session-end) and returns without waiting', () => {
    const s = seSetup('tr-se-x-');
    const t0 = Date.now();
    const r = spawnSync('bash', [SESSION_END_SCRIPT], {
      encoding: 'utf8', stdio: 'pipe', input: s.input, env: { ...s.env, TR_SE_SLEEP: '4' },
    });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).continue).toBe(true);
    expect(Date.now() - t0).toBeLessThan(3000);           // did not wait for the 4 s claude
    expect(waitFor(() => fs.existsSync(s.extractLog) &&
      / outcome=\S+ .* trigger=session-end$/m.test(fs.readFileSync(s.extractLog, 'utf8')))).toBe(true);
    expect(fs.readFileSync(s.marker, 'utf8')).toBe('1');  // nested claude carries the guard
    fs.rmSync(s.home, { recursive: true, force: true });
  });

  it('session-end.sh: no extraction inside a nested extraction run (TR_EXTRACT_RUNNING=1)', () => {
    const s = seSetup('tr-se-g-');
    const r = spawnSync('bash', [SESSION_END_SCRIPT], {
      encoding: 'utf8', stdio: 'pipe', input: s.input, env: { ...s.env, TR_EXTRACT_RUNNING: '1' },
    });
    expect(r.status).toBe(0);
    expect(waitFor(() => fs.existsSync(s.marker), 2000)).toBe(false);
    fs.rmSync(s.home, { recursive: true, force: true });
  });

  it('session-end.sh: opt-out with TR_SESSION_END_EXTRACT=0', () => {
    const s = seSetup('tr-se-o-');
    const r = spawnSync('bash', [SESSION_END_SCRIPT], {
      encoding: 'utf8', stdio: 'pipe', input: s.input, env: { ...s.env, TR_SESSION_END_EXTRACT: '0' },
    });
    expect(r.status).toBe(0);
    expect(waitFor(() => fs.existsSync(s.marker), 2000)).toBe(false);
    fs.rmSync(s.home, { recursive: true, force: true });
  });

  it('session-end.sh: no transcript_path → no extraction', () => {
    const s = seSetup('tr-se-n-');
    const r = spawnSync('bash', [SESSION_END_SCRIPT], {
      encoding: 'utf8', stdio: 'pipe', input: JSON.stringify({ session_id: 'x' }), env: s.env,
    });
    expect(r.status).toBe(0);
    expect(waitFor(() => fs.existsSync(s.marker), 2000)).toBe(false);
    fs.rmSync(s.home, { recursive: true, force: true });
  });
```

- [ ] **Step 2: Confirm the failure**

Run: `HOME=$(mktemp -d) npx vitest run src/__tests__/hook-scripts.test.ts -t "session-end.sh"`
Expected: the "spawns a detached extraction" test fails after its 15 s timeout. The three negative tests already pass, since nothing is launched yet; they guard against regressions after Step 3.

- [ ] **Step 3: Implement**

In `session-end.sh`, after the SIGTERM block (the `fi` after `kill -TERM`) and before the `H1` block (git snapshot):

```bash
# Capture learnings from sessions that never compacted. Until 1.10 the only
# automatic capture was PreCompact, so a long session that ended without
# compaction (2026-11-12, repo total-recall, ~6 h of work) stored nothing.
# Re-use the PreCompact extractor with the same stdin JSON, DETACHED: this hook
# has a 5 s timeout and `claude -p` takes longer. Skipped when:
#   - TR_EXTRACT_RUNNING=1: we ARE the nested `claude -p` of an extraction
#     (it fires SessionEnd too) — without this, extraction recurses forever;
#   - TR_SESSION_END_EXTRACT=0: user opt-out (each run is one model call);
#   - no readable transcript_path.
# Duplicates with a PreCompact run of the same session are bounded by
# store-learning.mjs skipping existing slugs.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TRANSCRIPT_PATH=$(json_str transcript_path)
if [ "${TR_EXTRACT_RUNNING:-}" != "1" ] \
   && [ "${TR_SESSION_END_EXTRACT:-1}" != "0" ] \
   && [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ] \
   && [ -f "$SCRIPT_DIR/extract-and-store-memories.sh" ]; then
  DETACH=""
  command -v setsid >/dev/null 2>&1 && DETACH="setsid"
  # Own session (setsid) so Claude Code tearing down its process group does not
  # kill the run; all std streams detached so the hook's stdout stays pure JSON.
  printf '%s' "$HOOK_INPUT" \
    | TR_EXTRACT_TRIGGER=session-end $DETACH nohup bash "$SCRIPT_DIR/extract-and-store-memories.sh" \
      >/dev/null 2>&1 &
  disown 2>/dev/null || true
fi
```

Notes for the implementer:
- `json_str` and `HOOK_INPUT` are defined in Task 3.
- `set -u` is active, which is why every variable has a default.
- macOS has no `setsid`. There `DETACH` stays empty, and `nohup … &` is enough.

- [ ] **Step 4: Run**

Run: `HOME=$(mktemp -d) npx vitest run src/__tests__/hook-scripts.test.ts src/__tests__/hooks-parity.test.ts src/__tests__/extract-and-store-hook.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add hooks/scripts/session-end.sh src/__tests__/hook-scripts.test.ts
git commit -m "feat(session-end): extract learnings at session end, detached

Sessions that never compacted stored nothing: PreCompact was the only automatic
capture. Re-uses extract-and-store-memories.sh in the background (5 s hook
timeout), with a recursion guard and TR_SESSION_END_EXTRACT=0 opt-out.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Docs and version

**Files:**
- Modify: `ARCHITECTURE.md`, `../../README.md`, `../../README-ro.md`, `package.json`

- [ ] **Step 1: `ARCHITECTURE.md`, invariants table (~line 100)**

Replace the row `| Journal only on personal \`store_memory\` | \`store.ts\` |` with:

```markdown
| Journal only on personal `store_memory` / `update_memory` / `delete_memory` | `store.ts`, `mutate.ts` |
```

After the row `| PreCompact reads \`transcript_path\` from stdin JSON | …`, add:

```markdown
| SessionEnd extraction is detached and skipped under `TR_EXTRACT_RUNNING=1` | `session-end.sh` |
```

In the paragraph below the table, change "Five of these invariants" to "Six of these invariants". In the parenthesised list, replace "journal only on personal stores" with "journal only on personal writes", and append ", SessionEnd extraction is detached and recursion-guarded".

- [ ] **Step 2: READMEs, "Daily use" table (~line 108)**

`README.md`: replace the row `| nothing (Claude Code) | 0–3 lessons from the session are saved before compaction | \`PreCompact\` hook |` with:

```markdown
| nothing (Claude Code)                                    | 0–3 lessons from the session are saved before compaction and when the session ends (opt out: `TR_SESSION_END_EXTRACT=0`) | `PreCompact` / `SessionEnd` hooks |
```

`README-ro.md` is the Romanian README and stays in Romanian. Replace its matching row with:

```markdown
| nimic (Claude Code)                                          | Înainte de compactare și la închiderea sesiunii se salvează 0–3 lecții (dezactivare: `TR_SESSION_END_EXTRACT=0`) | hook-urile `PreCompact` / `SessionEnd` |
```

Keep each file's column alignment.

- [ ] **Step 3: Version**

In `package.json`, change `"version": "1.9.1"` to `"version": "1.10.0"`. Then run `npm run build`; `sync:version` updates the manifests.

Run: `git status --short`
Expected: modified `package.json`, `.claude-plugin/plugin.json`, `gemini-extension.json` and the root npx manifest. `dist/` does not appear (it is gitignored).

- [ ] **Step 4: Commit**

```bash
git add -A ':!dist'
git commit -m "docs: journal covers update/delete; SessionEnd extraction; bump 1.10.0

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Final verification

- [ ] **Step 1: Full suite on a clean `HOME`**

```bash
cd ~/_/in-progress/diverse/total-recall/plugins/total-recall
npm run typecheck
HOME=$(mktemp -d) npm test
HOME=$(mktemp -d) npm run test:integration
```

Expected: all green. If the coverage thresholds (95/90) fail on `mutate.ts`, add a test for the org branch of update/delete: an org memory does not write to the journal.

- [ ] **Step 2: Manual check in a sandbox**

```bash
H=$(mktemp -d); mkdir -p $H/.total-recall
printf '{"role":"user","content":"we chose X because Y"}\n' > $H/t.jsonl
printf '{"session_id":"manual-1","transcript_path":"%s"}' "$H/t.jsonl" \
  | HOME=$H bash hooks/scripts/session-end.sh
sleep 60; cat $H/.total-recall/.session-end.log; tail -3 $H/.total-recall/.extract.log
```

Expected:
- `claude_session_id=manual-1` in `.session-end.log`.
- An `outcome=… trigger=session-end` line in `.extract.log`.

This step runs the real `claude`, so it costs one model call.

- [ ] **Step 3: Push + PR, only with the user's approval**

```bash
git push -u origin fix/journal-session-capture
gh pr create --title "Journal update/delete + SessionEnd learning extraction (1.10.0)" --body "…

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

After the merge, check that the `mutation.yml` workflow is green. Otherwise `release` stays on 1.9.1 with no signal.
