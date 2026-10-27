// The five spec-driven tools (SPEC-DRIVEN-PLAN phases 2–4). register() adds only
// the tools listed in specDriven.tools. Like bulk.ts, this module reuses the
// single-item write paths (storeMemory / updateMemory) instead of writing files.
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { wrapHandler } from './registry.js';
import { storeMemory } from './store.js';
import { updateMemory } from './mutate.js';
import { memIndex } from '../state.js';
import { loadConfig } from '../paths.js';
import { readMemoryContent } from '../vault-scan.js';
import { parseSpecConfig, type SpecConfig } from '../spec/config.js';
import { buildModels, renderModel, modelElementIds, type ArchModel } from '../spec/indexer.js';
import { slug } from '../spec/adl-parse.js';
import { gitInfo } from '../spec/exec.js';
import { INDEX_TAG, indexKey, loadModel, architectureContext, trace, architectureHistory } from '../spec/context.js';
import { resolveCalm, validateCalmFile, adlCoverage, type CheckResult } from '../spec/validate.js';

const cfg = (): SpecConfig => parseSpecConfig(loadConfig().specDriven);

function projectDir(p: unknown): string {
  if (typeof p !== 'string' || !p.trim()) throw new Error('path is required: the project directory that holds the ADL / CALM files.');
  const dir = path.resolve(p);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`Not a directory: ${p}`);
  return dir;
}

function locate(dir: string) {
  const git = gitInfo(dir);
  const root = git?.root ?? dir;
  const rel = (p: string) => path.relative(root, p).split(path.sep).join('/') || '.';
  return { git, rel, sourcePath: rel(dir) };
}

// ─── index_architecture ─────────────────────────────────────────────────────

export function indexArchitecture(args: any): any {
  const dir = projectDir(args.path);
  const c = cfg();
  const { git, rel, sourcePath } = locate(dir);
  const models = buildModels(dir, c, rel, typeof args.system === 'string' && args.system.trim() ? args.system : undefined);
  if (!models.length) return { systems: [], message: `No ADL (${c.adlExtensions.join(', ')}) or CALM (${c.calmExtensions.join(', ')}) files under ${sourcePath}.` };

  const systems = models.map((m) => {
    const key = indexKey(m.system);
    const old = memIndex[key] ? loadModel(m.system) : null;
    if (old && old.fingerprint === m.fingerprint) return { system: m.system, key, status: 'unchanged' };
    const ids = new Set(modelElementIds(m));
    const oldIds = new Set(old ? modelElementIds(old as ArchModel) : []);
    storeMemory({
      key,
      title: `Architecture index: ${m.system}`,
      content: renderModel(m, { sourcePath, ...(git?.head ? { sourceRev: git.head } : {}) }),
      category: 'architecture',
      tags: [INDEX_TAG],
      importanceScore: 0.7,
      force: !!memIndex[key],
      system: m.system,
      artifact: m.files.some((f) => f.kind === 'adl') ? 'adl' : 'calm',
      elements: [...ids],
      sourcePath,
      sourceRev: git?.head,
    });
    return {
      system: m.system,
      key,
      status: old ? 'updated' : 'created',
      files: m.files.length,
      elements: m.elements.length,
      assertions: m.assertions.length,
      added: [...ids].filter((i) => !oldIds.has(i)),
      removed: [...oldIds].filter((i) => !ids.has(i)),
      problems: m.files.filter((f) => f.error).map((f) => `${f.path}: ${f.error}`),
    };
  });
  const changed = systems.some((s) => s.status !== 'unchanged');
  return {
    systems,
    ...(changed ? { next: 'Record why the architecture changed: store_memory(category "architecture-changes", system, elements, the reason).' } : {}),
  };
}

// ─── validate_architecture ──────────────────────────────────────────────────

function fitnessKey(system: string, check: string): string {
  return `troubleshooting/fitness-${slug(system)}-${slug(check)}`.slice(0, 160);
}

function record(system: string, r: CheckResult, meta: { sourcePath: string; sourceRev?: string; resolvedBy?: string }) {
  const key = fitnessKey(system, r.check);
  const existing = memIndex[key];
  const at = new Date().toISOString();
  const rev = meta.sourceRev ? ` at ${meta.sourceRev.slice(0, 12)}` : '';
  if (!r.ok) {
    if (existing && existing.status === 'failed') {
      const body = readMemoryContent(existing.filePath, key) ?? '';
      updateMemory({ key, content: `${body.trimEnd()}\n- Failed again ${at}${rev}: ${r.message}\n`, sourceRev: meta.sourceRev });
      return { check: r.check, key, recorded: 'failed-again' };
    }
    const content = `Fitness check \`${r.check}\` failed for system ${system}${rev}.\n\n${r.message}\n\n## Occurrences\n- Failed ${at}${rev}\n`;
    if (existing) {
      const body = readMemoryContent(existing.filePath, key) ?? '';
      updateMemory({ key, content: `${body.trimEnd()}\n- Failed again ${at}${rev} (after being resolved): ${r.message}\n`, status: 'failed', sourceRev: meta.sourceRev });
      return { check: r.check, key, recorded: 'reopened' };
    }
    storeMemory({
      key, title: `Fitness failure: ${r.check} (${system})`, content, category: 'troubleshooting',
      tags: ['fitness-result'], importanceScore: 0.6, system, artifact: 'fitness-result', status: 'failed',
      elements: r.elements, sourcePath: meta.sourcePath, sourceRev: meta.sourceRev,
    });
    return { check: r.check, key, recorded: 'failed' };
  }
  if (existing && existing.status === 'failed') {
    const body = readMemoryContent(existing.filePath, key) ?? '';
    const by = meta.resolvedBy ? ` Resolved by decision \`${meta.resolvedBy}\`.` : ' Record the decision that fixed it and pass its key as resolvedBy next time.';
    updateMemory({ key, content: `${body.trimEnd()}\n- Passed ${at}${rev}.${by}\n`, status: 'resolved', sourceRev: meta.sourceRev });
    return { check: r.check, key, recorded: 'resolved' };
  }
  return null;
}

export function validateArchitecture(args: any): any {
  const dir = projectDir(args.path);
  const c = cfg();
  const { git, rel, sourcePath } = locate(dir);
  const models = buildModels(dir, c, rel, typeof args.system === 'string' && args.system.trim() ? args.system : undefined);
  if (!models.length) return { ok: true, checks: [], message: `No ADL or CALM files under ${sourcePath}.` };
  const runner = resolveCalm(c);
  const resolvedBy = typeof args.resolvedBy === 'string' ? args.resolvedBy : undefined;
  const meta = { sourcePath, ...(git?.head ? { sourceRev: git.head } : {}), ...(resolvedBy ? { resolvedBy } : {}) };

  const out = models.map((m) => {
    const checks: CheckResult[] = [...adlCoverage(m)];
    const calmFiles = m.files.filter((f) => f.kind === 'calm');
    if (calmFiles.length && runner) {
      const root = git?.root ?? dir;
      for (const f of calmFiles) checks.push(validateCalmFile(path.join(root, f.path), f.path, runner, c));
    }
    const recorded = args.record === false ? [] : checks.map((r) => record(m.system, r, meta)).filter(Boolean);
    return {
      system: m.system,
      ok: checks.every((r) => r.ok),
      failed: checks.filter((r) => !r.ok),
      passed: checks.filter((r) => r.ok).length,
      recorded,
    };
  });
  const calmFound = models.some((m) => m.files.some((f) => f.kind === 'calm'));
  return {
    ok: out.every((s) => s.ok),
    systems: out,
    calm: !calmFound ? 'no CALM files' : runner
      ? `validated with ${runner.via === 'path' ? runner.cmd : `npx @finos/calm-cli@${c.calm.cliVersion}`}`
      : `CALM CLI not available: install it with "npm install -g @finos/calm-cli@${c.calm.cliVersion}", or set specDriven.calm.allowNpx to true in ~/.total-recall/config.json. ADL coverage was still checked.`,
  };
}

// ─── Registration ───────────────────────────────────────────────────────────

const elementDesc = 'An element: "adl:<domain>.<component>", "calm:<node>", "assert:<ID>" (or a bare assertion ID).';

export function register(server: McpServer, spec: SpecConfig) {
  const on = new Set(spec.tools);
  if (on.has('index_architecture')) server.registerTool('index_architecture', {
    description: 'Index the ADL (*.adl) and CALM (*.calm.json) files of a project: stores or updates one architecture-index memory per system with its elements, assertions, controls and the tests tagged with each assertion ID. Records the repo-relative path and commit, never the files. Re-running on unchanged files writes nothing.',
    inputSchema: {
      path: z.string().describe('Project directory to scan (absolute, or relative to the server working directory).'),
      system: z.string().optional().describe('System name to file everything under. Default: the ADL DEFINE SYSTEM id, else the directory name.'),
    },
  }, wrapHandler('index_architecture', indexArchitecture));

  if (on.has('get_architecture_context')) server.registerTool('get_architecture_context', {
    description: 'Architecture context from the index: without element, the system summary (domains, components, CALM nodes, untested assertions, open failures, recent decisions and changes); with element, its ADL rules, CALM controls, linked decisions, failures and open questions, newest first.',
    inputSchema: {
      system: z.string(),
      element: z.string().optional().describe(elementDesc),
      limit: z.number().default(10),
    },
  }, wrapHandler('get_architecture_context', (a: any) => architectureContext(a, { guardrails: cfg().guardrails })));

  if (on.has('trace')) server.registerTool('trace', {
    description: 'Trace a requirement (REQ-7), assertion (TR-S2) or element (calm:org-vault) through ADL assertions and CALM controls to the tests that carry the assertion ID, recorded fitness results and decisions.',
    inputSchema: {
      id: z.string(),
      system: z.string().optional(),
    },
  }, wrapHandler('trace', trace));

  if (on.has('get_architecture_history')) server.registerTool('get_architecture_history', {
    description: 'architecture-changes memories for a system (optionally one element) in time order: what changed and why, plus when the architecture index was rebuilt.',
    inputSchema: {
      system: z.string(),
      element: z.string().optional().describe(elementDesc),
      limit: z.number().default(50),
    },
  }, wrapHandler('get_architecture_history', architectureHistory));

  if (on.has('validate_architecture')) server.registerTool('validate_architecture', {
    description: 'Run the architecture checks on a project: CALM schema validation (calm CLI on PATH, or a pinned npx when specDriven.calm.allowNpx is on) and ADL coverage (every tagged assertion has a test carrying its ID). Each failure is stored as a fitness-result memory linked to its element; a later pass marks it resolved. CI stays the authority.',
    inputSchema: {
      path: z.string(),
      system: z.string().optional(),
      resolvedBy: z.string().optional().describe('Key of the decision memory that fixed a previously failing check.'),
      record: z.boolean().default(true).describe('Store failures and resolutions as memories.'),
    },
  }, wrapHandler('validate_architecture', validateArchitecture));
}
