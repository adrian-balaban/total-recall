// The one place spec-driven code starts external processes (git, the CALM CLI).
// ADL [TR-R4] holds this to a single module next to the vectors self-heal. No
// shell: arguments are passed as an array, so nothing in them is interpreted.
import { spawnSync } from 'node:child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface RunResult { ok: boolean; status: number | null; stdout: string; stderr: string; error?: string }

export function run(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): RunResult {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    encoding: 'utf8',
    timeout: opts.timeoutMs ?? 30000,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  const out: RunResult = { ok: r.status === 0, status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  if (r.error) out.error = r.error.message;
  return out;
}

// Absolute path of `bin` on PATH, or null. Looked up by hand so no `which` is needed.
export function onPath(bin: string): string | null {
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', ''] : [''];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = path.join(dir, bin + ext);
      try {
        if (fs.statSync(p).isFile()) return p;
      } catch { /* not here */ }
    }
  }
  return null;
}

// Repository root and HEAD commit for `dir`, or null outside a git work tree.
export function gitInfo(dir: string): { root: string; head?: string } | null {
  const top = run('git', ['rev-parse', '--show-toplevel'], { cwd: dir, timeoutMs: 5000 });
  if (!top.ok) return null;
  const head = run('git', ['rev-parse', 'HEAD'], { cwd: dir, timeoutMs: 5000 });
  const info: { root: string; head?: string } = { root: top.stdout.trim() };
  if (head.ok) info.head = head.stdout.trim();
  return info;
}
