// Builds the architecture model of a project from its ADL and CALM files
// (index_architecture). One model per system; the memory written from it holds a
// readable summary plus a JSON block with the parsed elements, assertions,
// controls and the tests that carry each assertion ID. It never copies a file.
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { parseAdl, assertionTargets, slug } from './adl-parse.js';
import { parseCalm } from './calm-parse.js';
import { isArchitectureFile, type SpecConfig } from './config.js';

const MAX_FILES = 5000;
const MAX_FILE_BYTES = 1024 * 1024;
const TEST_FILE_RE = /(\.(test|spec)\.[cm]?[jt]sx?|Tests?\.(java|kt|cs)|_test\.(go|py)|(^|\/)test_[^/]+\.py)$/;

export interface ModelElement { id: string; kind: string; name: string; source: string }
export interface ModelAssertion { id: string; tagged: boolean; text: string; scope?: string; targets: string[]; source: string; tests: string[] }
export interface ModelControl { owner: string; name: string; description: string; source: string }
export interface ModelDefinition { kind: string; name: string; value: string; targets: string[]; source: string }
export interface ArchModel {
  system: string;
  files: { path: string; kind: 'adl' | 'calm'; hash: string; error?: string }[];
  elements: ModelElement[];
  assertions: ModelAssertion[];
  communications: { from: string; to: string; style: string; source: string }[];
  relationships: { id: string; kind: string; nodes: string[]; description: string; source: string }[];
  controls: ModelControl[];
  definitions?: ModelDefinition[];
  constants: Record<string, string>;
  fingerprint: string;
}

export interface ScanResult { adl: string[]; calm: string[]; tests: string[]; truncated: boolean }

export function scanProject(dir: string, cfg: SpecConfig): ScanResult {
  const res: ScanResult = { adl: [], calm: [], tests: [], truncated: false };
  const skip = new Set(cfg.excludeDirs);
  let seen = 0;
  const walk = (d: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (++seen > MAX_FILES) { res.truncated = true; return; }
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!skip.has(e.name) && !e.name.startsWith('.')) walk(p);
      } else if (e.isFile()) {
        const kind = isArchitectureFile(e.name, cfg);
        if (kind) res[kind].push(p);
        else if (TEST_FILE_RE.test(p.split(path.sep).join('/'))) res.tests.push(p);
      }
    }
  };
  walk(dir);
  return res;
}

function read(p: string): string | null {
  try {
    if (fs.statSync(p).size > MAX_FILE_BYTES) return null;
    return fs.readFileSync(p, 'utf8');
  } catch { return null; }
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

// `rel` turns an absolute path into the path stored in the model (relative to the
// repository root when there is one).
export function buildModels(dir: string, cfg: SpecConfig, rel: (p: string) => string, systemArg?: string): ArchModel[] {
  const scan = scanProject(dir, cfg);
  const models = new Map<string, ArchModel>();
  const model = (system: string): ArchModel => {
    let m = models.get(system);
    if (!m) {
      m = { system, files: [], elements: [], assertions: [], communications: [], relationships: [], controls: [], definitions: [], constants: {}, fingerprint: '' };
      models.set(system, m);
    }
    return m;
  };
  const fallback = systemArg ? slug(systemArg) : slug(path.basename(path.resolve(dir)));

  for (const f of scan.adl) {
    const text = read(f);
    const source = rel(f);
    if (text === null) { model(fallback).files.push({ path: source, kind: 'adl', hash: '', error: 'unreadable or larger than 1 MB' }); continue; }
    const doc = parseAdl(text);
    const sys = doc.elements.find((e) => e.kind === 'SYSTEM');
    const m = model(systemArg ? fallback : sys ? slug(sys.id) : fallback);
    m.files.push({ path: source, kind: 'adl', hash: sha(text) });
    for (const e of doc.elements) {
      if (e.kind === 'SYSTEM' || m.elements.some((x) => x.id === e.elementId)) continue;
      m.elements.push({ id: e.elementId, kind: e.kind, name: e.name, source });
    }
    Object.assign(m.constants, doc.constants);
    for (const c of doc.communications) m.communications.push({ ...c, source });
    for (const d of doc.definitions) m.definitions!.push({ kind: d.kind, name: d.name, value: d.value, targets: d.targets, source });
    for (const a of doc.assertions) {
      const ma: ModelAssertion = { id: a.id, tagged: a.tagged, text: a.text, targets: assertionTargets(a, doc.elements), source, tests: [] };
      if (a.scope) ma.scope = a.scope;
      m.assertions.push(ma);
    }
  }

  // CALM files belong to the named system, or to the only ADL system found.
  const calmSystem = systemArg ? fallback : models.size === 1 ? [...models.keys()][0]! : fallback;
  for (const f of scan.calm) {
    const text = read(f);
    const source = rel(f);
    const m = model(calmSystem);
    if (text === null) { m.files.push({ path: source, kind: 'calm', hash: '', error: 'unreadable or larger than 1 MB' }); continue; }
    try {
      const doc = parseCalm(text);
      m.files.push({ path: source, kind: 'calm', hash: sha(text) });
      for (const n of doc.nodes) {
        if (!m.elements.some((x) => x.id === `calm:${n.id}`)) m.elements.push({ id: `calm:${n.id}`, kind: `calm-${n.type || 'node'}`, name: n.name, source });
      }
      for (const r of doc.relationships) m.relationships.push({ id: `calm:${r.id}`, kind: r.kind, nodes: r.nodes.map((n) => `calm:${n}`), description: r.description, source });
      for (const c of doc.controls) m.controls.push({ ...c, source });
    } catch (e) {
      m.files.push({ path: source, kind: 'calm', hash: sha(text), error: `invalid JSON: ${(e as Error).message}` });
    }
  }

  // Tests that carry a tagged assertion ID in their text, e.g. it('[TR-S2] …').
  const tagged = new Set([...models.values()].flatMap((m) => m.assertions.filter((a) => a.tagged).map((a) => a.id)));
  if (tagged.size) {
    const idRe = /\[([A-Za-z][A-Za-z0-9_.-]*)\]/g;
    const byId = new Map<string, string[]>();
    for (const f of scan.tests) {
      const text = read(f);
      if (!text) continue;
      text.split(/\r?\n/).forEach((line, i) => {
        for (const mm of line.matchAll(idRe)) {
          if (!tagged.has(mm[1]!)) continue;
          const list = byId.get(mm[1]!) ?? [];
          list.push(`${rel(f)}:${i + 1} ${line.trim().slice(0, 120)}`);
          byId.set(mm[1]!, list);
        }
      });
    }
    for (const m of models.values()) for (const a of m.assertions) if (a.tagged) a.tests = byId.get(a.id) ?? [];
  }

  for (const m of models.values()) {
    m.files.sort((a, b) => a.path.localeCompare(b.path));
    const { fingerprint: _f, ...rest } = m;
    m.fingerprint = sha(JSON.stringify(rest));
  }
  return [...models.values()];
}

// IDs written to the memory's `elements` frontmatter field.
export function modelElementIds(m: ArchModel): string[] {
  return [...m.elements.map((e) => e.id), ...m.assertions.map((a) => `assert:${a.id}`)];
}

const JSON_START = '<!-- total-recall:architecture-model -->';

export function renderModel(m: ArchModel, meta: { sourcePath: string; sourceRev?: string }): string {
  const domains = m.elements.filter((e) => e.kind === 'DOMAIN');
  const parts = m.elements.filter((e) => !['DOMAIN', 'SAGA'].includes(e.kind) && !e.kind.startsWith('calm-'));
  const nodes = m.elements.filter((e) => e.kind.startsWith('calm-'));
  const untested = m.assertions.filter((a) => a.tagged && a.tests.length === 0);
  const lines = [
    `Architecture index for **${m.system}**, built by index_architecture from ${m.files.length} file(s) under \`${meta.sourcePath}\`${meta.sourceRev ? ` at ${meta.sourceRev.slice(0, 12)}` : ''}. The files in the repository are the source of truth; this is a summary.`,
    '',
    `- Domains (${domains.length}): ${domains.map((d) => d.name).join(', ') || '—'}`,
    `- Components (${parts.length}): ${parts.map((d) => `${d.name} (${d.kind.toLowerCase()})`).join(', ') || '—'}`,
    `- CALM nodes (${nodes.length}): ${nodes.map((d) => d.id.slice(5)).join(', ') || '—'}`,
    `- Assertions: ${m.assertions.length} (${m.assertions.filter((a) => a.tagged).length} tagged, ${untested.length} tagged without a test)`,
    `- CALM controls: ${m.controls.map((c) => `${c.owner.slice(5)}/${c.name}`).join(', ') || '—'}`,
  ];
  const defs = m.definitions ?? [];
  if (defs.length) lines.push(`- Definitions (${defs.length}): ${defs.map((d) => `${d.name} (${d.kind.toLowerCase()})`).join(', ')}`);
  const errors = m.files.filter((f) => f.error);
  if (errors.length) lines.push(`- Files with problems: ${errors.map((f) => `${f.path} (${f.error})`).join('; ')}`);
  lines.push('', '## Assertions', '', ...m.assertions.map((a) => `- \`${a.id}\` ${a.text}${a.scope ? ` _(for ${a.scope})_` : ''}`));
  lines.push('', JSON_START, '```json', JSON.stringify({ ...m, sourcePath: meta.sourcePath, sourceRev: meta.sourceRev }), '```');
  return lines.join('\n');
}

export function parseModelFromBody(body: string): (ArchModel & { sourcePath?: string; sourceRev?: string }) | null {
  const i = body.indexOf(JSON_START);
  if (i < 0) return null;
  const m = body.slice(i).match(/```json\n([\s\S]*?)\n```/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]!);
    return parsed && typeof parsed === 'object' && Array.isArray(parsed.elements) ? parsed : null;
  } catch { return null; }
}
