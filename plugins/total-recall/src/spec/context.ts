// Architecture-aware retrieval (SPEC-DRIVEN-PLAN phase 3): the system summary,
// the context of one element, requirement → assertion → test traces and the
// change history. Reads the in-memory index; only the architecture-index memory
// body (the parsed model) is read from disk.
import { memIndex } from '../state.js';
import { readMemoryContent } from '../vault-scan.js';
import type { MemoryMetadata } from '../types.js';
import { parseModelFromBody, type ArchModel } from './indexer.js';
import { elementMatches, memoryMatches, normalizeElementId } from './elements.js';
import { slug } from './adl-parse.js';

export const INDEX_TAG = 'architecture-index';
export const GUARDRAIL_TAG = 'guardrail';
export const CHANGES_CATEGORY = 'architecture-changes';

export function indexKey(system: string): string {
  return `architecture/arch-index-${slug(system)}`;
}

export function listSystems(): string[] {
  return Object.values(memIndex)
    .filter((m) => m.tags.includes(INDEX_TAG) && m.system)
    .map((m) => m.system!)
    .sort();
}

export function loadModel(system: string): (ArchModel & { sourcePath?: string; sourceRev?: string }) | null {
  const meta = memIndex[indexKey(system)];
  if (!meta) return null;
  const body = readMemoryContent(meta.filePath, meta.key);
  return body ? parseModelFromBody(body) : null;
}

function requireModel(system: string) {
  const model = loadModel(system);
  if (!model) {
    const known = listSystems();
    throw new Error(`No architecture index for "${system}". Run index_architecture on the project first.${known.length ? ` Indexed systems: ${known.join(', ')}.` : ''}`);
  }
  return model;
}

export interface Brief { key: string; title: string; category: string; artifact?: string; status?: string; elements?: string[]; updated: string; preview: string }

export function brief(m: MemoryMetadata): Brief {
  const b: Brief = { key: m.key, title: m.title, category: m.category, updated: m.updated, preview: m.contentPreview.slice(0, 240) };
  if (m.artifact) b.artifact = m.artifact;
  if (m.status) b.status = m.status;
  if (m.elements?.length) b.elements = m.elements.slice(0, 20);
  return b;
}

const newestFirst = (a: MemoryMetadata, b: MemoryMetadata) => b.updated.localeCompare(a.updated);
const isIndex = (m: MemoryMetadata) => m.tags.includes(INDEX_TAG);
const inSystem = (m: MemoryMetadata, system?: string) => !system || !m.system || slug(m.system) === slug(system);
const isDecision = (m: MemoryMetadata) => m.artifact === 'adr' || m.category === 'decisions';

// A decision is no longer current when its status says so, or when another memory
// names it in `supersedes` (even if nobody updated its status).
function supersededKeys(): Set<string> {
  const out = new Set<string>();
  for (const m of Object.values(memIndex)) {
    if (m.status === 'superseded') out.add(m.key);
    if (m.supersedes) out.add(m.supersedes);
  }
  return out;
}
const isFailure = (m: MemoryMetadata) => m.artifact === 'fitness-result' && m.status === 'failed';

// Memories linked to any of `ids`, newest first (the element index: a scan of the
// in-memory index, never of the vault).
export function linkedMemories(ids: string[], system?: string): MemoryMetadata[] {
  return Object.values(memIndex)
    .filter((m) => !isIndex(m) && inSystem(m, system) && memoryMatches(m, ids))
    .sort(newestFirst);
}

function guardrailsFor(ids: string[]): Brief[] {
  return Object.values(memIndex)
    .filter((m) => m.tags.includes(GUARDRAIL_TAG) && (!m.elements?.length || !ids.length || memoryMatches(m, ids)))
    .sort(newestFirst)
    .slice(0, 10)
    .map(brief);
}

function systemSummary(system: string, model: ArchModel & { sourcePath?: string; sourceRev?: string }, guardrails: boolean, limit: number) {
  const mine = Object.values(memIndex).filter((m) => !isIndex(m) && m.system && slug(m.system) === slug(system)).sort(newestFirst);
  const old = supersededKeys();
  const out: Record<string, unknown> = {
    system,
    sourcePath: model.sourcePath,
    sourceRev: model.sourceRev,
    files: model.files.map((f) => (f.error ? `${f.path} (${f.error})` : f.path)),
    domains: model.elements.filter((e) => e.kind === 'DOMAIN').map((e) => ({ id: e.id, name: e.name })),
    components: model.elements.filter((e) => e.kind !== 'DOMAIN' && !e.kind.startsWith('calm-')).map((e) => ({ id: e.id, name: e.name, kind: e.kind })),
    calmNodes: model.elements.filter((e) => e.kind.startsWith('calm-')).map((e) => ({ id: e.id, name: e.name })),
    assertions: model.assertions.length,
    assertionsWithoutTests: model.assertions.filter((a) => a.tagged && a.tests.length === 0).map((a) => a.id),
    controls: model.controls.map((c) => `${c.owner}/${c.name}`),
    definitions: (model.definitions ?? []).map((d) => ({ kind: d.kind, name: d.name, value: d.value, targets: d.targets })),
    openFailures: mine.filter(isFailure).slice(0, limit).map(brief),
    recentDecisions: mine.filter((m) => isDecision(m) && !old.has(m.key)).slice(0, limit).map(brief),
    recentChanges: mine.filter((m) => m.category === CHANGES_CATEGORY).slice(0, limit).map(brief),
  };
  if (guardrails) out.guardrails = guardrailsFor([]);
  return out;
}

export function architectureContext(args: { system: string; element?: string; limit?: number }, opts: { guardrails: boolean }) {
  const limit = Math.max(1, Math.min(50, Math.floor(Number(args.limit)) || 10));
  const model = requireModel(args.system);
  if (!args.element) return systemSummary(args.system, model, opts.guardrails, limit);

  const id = normalizeElementId(args.element);
  const elements = model.elements.filter((e) => elementMatches(e.id, id));
  const ids = [id, ...elements.map((e) => e.id)];
  const assertions = model.assertions.filter(
    (a) => elementMatches(`assert:${a.id}`, id) || a.targets.some((t) => elementMatches(t, id)),
  );
  const relationships = model.relationships.filter((r) => elementMatches(r.id, id) || r.nodes.some((n) => elementMatches(n, id)));
  const owners = new Set([...ids, ...relationships.map((r) => r.id)]);
  const controls = model.controls.filter((c) => [...owners].some((o) => elementMatches(c.owner, o)));
  const linked = linkedMemories([...ids, ...assertions.map((a) => `assert:${a.id}`)], args.system);
  const old = supersededKeys();

  const out: Record<string, unknown> = {
    system: args.system,
    element: id,
    found: elements.length > 0 || assertions.length > 0,
    elements: elements.map((e) => ({ id: e.id, name: e.name, kind: e.kind, source: e.source })),
    rules: assertions.map((a) => ({ id: a.id, text: a.text, scope: a.scope, source: a.source, tests: a.tests })),
    controls: controls.map((c) => ({ owner: c.owner, name: c.name, description: c.description })),
    definitions: (model.definitions ?? []).filter((d) => d.targets.some((t) => elementMatches(t, id))).map((d) => ({ kind: d.kind, name: d.name, value: d.value })),
    relationships: relationships.map((r) => ({ id: r.id, kind: r.kind, nodes: r.nodes, description: r.description })),
    decisions: linked.filter((m) => isDecision(m) && !old.has(m.key) && m.status !== 'proposed').slice(0, limit).map(brief),
    superseded: linked.filter((m) => isDecision(m) && old.has(m.key)).slice(0, limit).map(brief),
    failures: linked.filter(isFailure).slice(0, limit).map(brief),
    resolved: linked.filter((m) => m.artifact === 'fitness-result' && m.status === 'resolved').slice(0, limit).map(brief),
    openQuestions: linked.filter((m) => m.status === 'proposed').slice(0, limit).map(brief),
    other: linked.filter((m) => !isDecision(m) && m.artifact !== 'fitness-result' && m.status !== 'proposed').slice(0, limit).map(brief),
  };
  if (opts.guardrails) out.guardrails = guardrailsFor(ids);
  return out;
}

// requirement / assertion / CALM element → assertions and controls → tests → results and decisions.
export function trace(args: { id: string; system?: string }) {
  const raw = String(args.id ?? '').trim();
  if (!raw) throw new Error('trace needs an id: a requirement (REQ-7), an assertion (TR-S2 or assert:TR-S2) or an element (calm:org-vault, adl:testing).');
  const systems = args.system ? [args.system] : listSystems();
  const requirementMemories = Object.values(memIndex).filter((m) => m.requirements?.includes(raw) && inSystem(m, args.system)).sort(newestFirst);
  const start = new Set<string>([normalizeElementId(raw), ...requirementMemories.flatMap((m) => m.elements ?? [])]);

  const assertions: Record<string, unknown>[] = [];
  const controls: Record<string, unknown>[] = [];
  for (const system of systems) {
    const model = loadModel(system);
    if (!model) continue;
    for (const a of model.assertions) {
      const hit = [...start].some((s) => elementMatches(`assert:${a.id}`, s) || a.targets.some((t) => elementMatches(t, s)));
      if (hit) assertions.push({ system, id: a.id, text: a.text, source: a.source, tests: a.tests, targets: a.targets });
    }
    for (const c of model.controls) {
      if ([...start].some((s) => elementMatches(c.owner, s))) controls.push({ system, owner: c.owner, name: c.name, description: c.description });
    }
  }
  const followed = [...start, ...assertions.map((a) => `assert:${a.id as string}`)];
  const linked = linkedMemories(followed, args.system).filter((m) => !requirementMemories.includes(m));
  return {
    id: raw,
    requirements: requirementMemories.map(brief),
    assertions,
    controls,
    untested: assertions.filter((a) => (a.tests as string[]).length === 0).map((a) => a.id),
    results: linked.filter((m) => m.artifact === 'fitness-result').map(brief),
    decisions: linked.filter((m) => isDecision(m) && !supersededKeys().has(m.key)).map(brief),
    other: linked.filter((m) => m.artifact !== 'fitness-result' && !isDecision(m)).map(brief),
  };
}

// Architecture changes in time order (oldest first), plus each rebuild of the index.
export function architectureHistory(args: { system: string; element?: string; limit?: number }) {
  const limit = Math.max(1, Math.min(200, Math.floor(Number(args.limit)) || 50));
  const want = args.element ? [normalizeElementId(args.element)] : null;
  const changes = Object.values(memIndex)
    .filter((m) => m.category === CHANGES_CATEGORY && inSystem(m, args.system) && (!want || memoryMatches(m, want)))
    .sort((a, b) => a.created.localeCompare(b.created));
  const index = memIndex[indexKey(args.system)];
  return {
    system: args.system,
    element: want?.[0],
    changes: changes.slice(-limit).map((m) => ({ ...brief(m), created: m.created, supersedes: m.supersedes })),
    indexRebuilds: index ? [...(index.supersededAt ?? []), index.updated] : [],
  };
}
