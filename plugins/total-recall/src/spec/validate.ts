// validate_architecture checks (SPEC-DRIVEN-PLAN phase 4): CALM schema validation
// through the CALM CLI, and ADL coverage (every tagged assertion has a test that
// carries its ID). The CLI is an external tool, resolved as decision 4 says:
// `calm` on PATH, then a pinned `npx` when specDriven.calm.allowNpx is on,
// otherwise "not available". CI stays the authority; this is the agent's fast loop.
import * as fs from 'fs';
import * as path from 'path';
import type { SpecConfig } from './config.js';
import type { ArchModel } from './indexer.js';
import { onPath, run } from './exec.js';

export interface CheckResult {
  check: string;          // stable ID: `calm:<file>` or `adl-coverage:<assertion ID>`
  ok: boolean;
  elements: string[];
  message: string;
}

export interface CalmRunner { cmd: string; prefix: string[]; via: 'path' | 'npx' }

export function resolveCalm(cfg: SpecConfig): CalmRunner | null {
  const bin = onPath('calm');
  if (bin) return { cmd: bin, prefix: [], via: 'path' };
  if (cfg.calm.allowNpx && onPath('npx')) {
    return { cmd: 'npx', prefix: ['--yes', `@finos/calm-cli@${cfg.calm.cliVersion}`], via: 'npx' };
  }
  return null;
}

interface CalmIssue { severity?: string; message?: string; path?: string; code?: string }

function calmIssues(stdout: string): { errors: CalmIssue[]; warnings: number } | null {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    const out = JSON.parse(stdout.slice(start, end + 1));
    const all: CalmIssue[] = [
      ...(Array.isArray(out.jsonSchemaValidationOutputs) ? out.jsonSchemaValidationOutputs : []),
      ...(Array.isArray(out.spectralSchemaValidationOutputs) ? out.spectralSchemaValidationOutputs : []),
    ];
    return { errors: all.filter((i) => i.severity === 'error'), warnings: all.filter((i) => i.severity === 'warning').length };
  } catch { return null; }
}

// Node or relationship IDs named in an issue path, e.g. /relationships/<id>/…
function issueElements(issue: CalmIssue): string[] {
  const m = String(issue.path ?? '').match(/^\/(nodes|relationships)\/([^/]+)/);
  return m ? [`calm:${m[2]}`] : [];
}

export function validateCalmFile(abs: string, label: string, runner: CalmRunner, cfg: SpecConfig): CheckResult {
  const args = [...runner.prefix, 'validate', '-a', abs, '-f', 'json'];
  // Convention: a url-mapping.json next to the document resolves control requirement URLs offline.
  const mapping = path.join(path.dirname(abs), 'url-mapping.json');
  if (fs.existsSync(mapping)) args.push('-u', mapping);
  const r = run(runner.cmd, args, { cwd: path.dirname(abs), timeoutMs: cfg.calm.timeoutMs });
  const issues = calmIssues(r.stdout);
  if (!issues) {
    return { check: `calm:${label}`, ok: false, elements: [], message: `CALM CLI gave no JSON result (exit ${r.status ?? 'none'}${r.error ? `, ${r.error}` : ''}): ${r.stderr.trim().slice(-300)}` };
  }
  if (!issues.errors.length) {
    return { check: `calm:${label}`, ok: true, elements: [], message: `valid${issues.warnings ? ` (${issues.warnings} warning(s))` : ''}` };
  }
  return {
    check: `calm:${label}`,
    ok: false,
    elements: [...new Set(issues.errors.flatMap(issueElements))],
    message: issues.errors.slice(0, 10).map((e) => `${e.message ?? e.code} (${e.path ?? ''})`).join('; '),
  };
}

export function adlCoverage(model: ArchModel): CheckResult[] {
  return model.assertions.filter((a) => a.tagged).map((a) => ({
    check: `adl-coverage:${a.id}`,
    ok: a.tests.length > 0,
    elements: [`assert:${a.id}`],
    message: a.tests.length ? `tested by ${a.tests.length} test line(s)` : `no test carries [${a.id}] (${a.source}: ${a.text})`,
  }));
}
