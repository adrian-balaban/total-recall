import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';

// Tests the REAL hooks/scripts/extract-and-store-memories.sh (PreCompact hook) end to
// end: stdin JSON parsing (transcript_path), the claude-CLI guard, the pipe into the
// REAL store-learning.mjs (files land in a HOME-redirected vault), the .extract.log
// observability contract, and the never-overwrite guarantee across repeated
// compactions. `claude` itself is a PATH-prepended stub so no real LLM runs; the rest
// of the pipeline (node, store-learning.mjs, dist/frontmatter.mjs) is the real thing.

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const REAL_SH = path.join(REPO_ROOT, 'hooks', 'scripts', 'extract-and-store-memories.sh');

function has(bin: string): boolean {
  return spawnSync(bin, ['--version'], { stdio: 'ignore' }).status === 0;
}
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout?.trim() || '/bin/bash';
// The pipeline needs the built dist/frontmatter.mjs (store-learning.mjs imports it);
// skip rather than fail when the repo has not been built.
const OK = has('bash') && has('node') && fs.existsSync(path.join(REPO_ROOT, 'dist', 'frontmatter.mjs'));

let tmpHome: string;
let stubBin: string;     // dir prepended to PATH, holds the fake `claude`
let minimalBin: string;  // PATH for the "claude not installed" case
let transcript: string;
let claudeMarker: string;

const vault = () => path.join(tmpHome, '.total-recall', 'personal-vault');
const extractLog = () => path.join(tmpHome, '.total-recall', '.extract.log');

// Fake `claude`: consumes stdin (the transcript), touches a marker file so tests can
// assert whether the hook reached the extract step at all, then emits the canned
// output from $TR_CLAUDE_LINES_FILE (if set) and exits with $TR_CLAUDE_EXIT (default 0).
const CLAUDE_STUB = `#!/usr/bin/env bash
cat > /dev/null
[ -n "\${TR_CLAUDE_MARKER:-}" ] && touch "$TR_CLAUDE_MARKER"
[ -n "\${TR_CLAUDE_LINES_FILE:-}" ] && [ -f "$TR_CLAUDE_LINES_FILE" ] && cat "$TR_CLAUDE_LINES_FILE"
exit "\${TR_CLAUDE_EXIT:-0}"
`;

function runHook(stdinJson: string, opts: {
  claudeLines?: string;   // canned stdout for the claude stub
  claudeExit?: number;    // exit code for the claude stub
  noClaude?: boolean;     // run with a PATH that has no `claude` at all
} = {}): { stdout: string; stderr: string; status: number | null } {
  fs.rmSync(claudeMarker, { force: true });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: tmpHome,
    NODE_BIN: process.execPath,
    TR_CLAUDE_MARKER: claudeMarker,
  };
  if (opts.claudeLines !== undefined) {
    const f = path.join(tmpHome, 'claude-lines.txt');
    fs.writeFileSync(f, opts.claudeLines);
    env.TR_CLAUDE_LINES_FILE = f;
  }
  if (opts.claudeExit !== undefined) env.TR_CLAUDE_EXIT = String(opts.claudeExit);
  env.PATH = opts.noClaude ? minimalBin : `${stubBin}:${process.env.PATH}`;
  const r = spawnSync(BASH, [REAL_SH], { encoding: 'utf8', input: stdinJson, env, stdio: ['pipe', 'pipe', 'pipe'] });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status };
}

function learningLine(title: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    title,
    content: '## Executive Summary\n\nExtracted during PreCompact.\n',
    tags: ['precompact-test'],
    category: 'knowledge',
    importanceScore: 0.6,
    ...extra,
  });
}

const suite = OK ? describe : describe.skip;

suite('extract-and-store-memories.sh (PreCompact hook, end to end)', () => {
  beforeAll(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-extract-'));
    claudeMarker = path.join(tmpHome, 'claude-invoked');

    stubBin = path.join(tmpHome, 'stub-bin');
    fs.mkdirSync(stubBin, { recursive: true });
    fs.writeFileSync(path.join(stubBin, 'claude'), CLAUDE_STUB);
    fs.chmodSync(path.join(stubBin, 'claude'), 0o755);

    // Minimal PATH for the "claude missing" case: only the coreutils the hook needs
    // (cat, dirname; ls/sort/tail are only hit when NODE_BIN is unset, and we preset
    // it). Symlinks into the real system binaries — everything else, including
    // claude, is invisible.
    minimalBin = path.join(tmpHome, 'minimal-bin');
    fs.mkdirSync(minimalBin, { recursive: true });
    for (const tool of ['cat', 'dirname', 'ls', 'sort', 'tail']) {
      const real = spawnSync('bash', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout?.trim();
      if (real) fs.symlinkSync(real, path.join(minimalBin, tool));
    }

    transcript = path.join(tmpHome, 'transcript.jsonl');
    fs.writeFileSync(transcript, '{"role":"user","content":"we chose PostgreSQL over MySQL for JSONB"}\n');
  }, 15000);

  afterAll(() => {
    if (tmpHome) fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  beforeEach(() => {
    fs.rmSync(vault(), { recursive: true, force: true });
    fs.rmSync(extractLog(), { force: true });
    // install.sh / SessionStart guarantee ~/.total-recall exists in real life; the
    // hook appends to .extract.log inside it without mkdir -p, so mirror that here.
    fs.mkdirSync(path.join(tmpHome, '.total-recall'), { recursive: true });
  });

  it('A1: stdin without transcript_path → clean {"continue":true}, claude never invoked', () => {
    const r = runHook('{}');
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('{"continue":true}');
    expect(fs.existsSync(claudeMarker)).toBe(false);
  });

  it('A2: transcript_path points at a missing file → clean skip, claude never invoked', () => {
    const r = runHook(JSON.stringify({ transcript_path: path.join(tmpHome, 'no-such-file.jsonl') }));
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('{"continue":true}');
    expect(fs.existsSync(claudeMarker)).toBe(false);
  });

  it('A3: non-JSON stdin → parse fails silently, clean skip', () => {
    const r = runHook('this is not json at all');
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('{"continue":true}');
    expect(fs.existsSync(claudeMarker)).toBe(false);
  });

  it('A4: claude CLI absent from PATH → skips with a stderr note, does not crash under set -e', () => {
    const r = runHook(JSON.stringify({ transcript_path: transcript }), { noClaude: true });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('{"continue":true}');
    expect(r.stderr).toContain('claude CLI not found');
  });

  it('A5: extraction yields zero learnings → nothing written, still continue', () => {
    const r = runHook(JSON.stringify({ transcript_path: transcript }), { claudeLines: '' });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('{"continue":true}');
    expect(fs.existsSync(claudeMarker)).toBe(true);
    expect(fs.existsSync(vault())).toBe(false);
  });

  it('A6+A10: extracted JSON lines land as .md files in the personal vault; stdout stays pure hook JSON', () => {
    const lines = [learningLine('Postgres Decision'), learningLine('Flink Checkpointing Tip')].join('\n') + '\n';
    const r = runHook(JSON.stringify({ transcript_path: transcript }), { claudeLines: lines });
    expect(r.status).toBe(0);
    // Contract: the hook's stdout is EXACTLY the continue JSON — nothing from
    // claude or store-learning may leak onto it (Claude Code parses this stream).
    expect(r.stdout.trim()).toBe('{"continue":true}');
    expect(fs.existsSync(path.join(vault(), 'knowledge', 'postgres-decision.md'))).toBe(true);
    expect(fs.existsSync(path.join(vault(), 'knowledge', 'flink-checkpointing-tip.md'))).toBe(true);
  });

  it('A7: claude crashes (non-zero exit) → hook still exits 0 with continue', () => {
    const r = runHook(JSON.stringify({ transcript_path: transcript }), { claudeExit: 1 });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('{"continue":true}');
  });

  it('A8: the store-learning summary is persisted to ~/.total-recall/.extract.log (observability)', () => {
    runHook(JSON.stringify({ transcript_path: transcript }), { claudeLines: learningLine('Log Probe') + '\n' });
    expect(fs.existsSync(extractLog())).toBe(true);
    const log = fs.readFileSync(extractLog(), 'utf8');
    expect(log).toMatch(/store-learning: \d+ written, \d+ skipped \(existing\), \d+ errors/);
  });

  it('A9: repeated compaction never overwrites — second run skips the existing memory', () => {
    const line = learningLine('Idempotent Learning') + '\n';
    runHook(JSON.stringify({ transcript_path: transcript }), { claudeLines: line });
    const file = path.join(vault(), 'knowledge', 'idempotent-learning.md');
    const first = fs.readFileSync(file, 'utf8');

    runHook(JSON.stringify({ transcript_path: transcript }), { claudeLines: line });
    expect(fs.readFileSync(file, 'utf8')).toBe(first);
    const log = fs.readFileSync(extractLog(), 'utf8');
    expect(log).toContain('1 skipped (existing)');
  });
}, 60000);
