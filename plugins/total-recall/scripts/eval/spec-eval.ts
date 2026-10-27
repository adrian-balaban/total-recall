// Spec-driven evaluation (SPEC-DRIVEN-PLAN phase 7). Indexes every project folder
// of a corpus, seeds decision and requirement memories linked to its elements,
// and measures whether the architecture tools give them back:
//   - decision@1: get_architecture_context(system, element) returns the decision
//     seeded for that element first;
//   - rules: every assertion that targets the element is in its `rules`;
//   - trace: trace(<requirement>) reaches the assertion the requirement links to;
//   - stale: a superseded decision is never returned among the current decisions.
//
// Usage: npx tsx scripts/eval/spec-eval.ts <corpus-dir> [--json]
// A corpus is a directory whose subfolders each hold one project's .adl / .calm.json
// files (a single project directory works too). Runs against a throwaway HOME, so
// your own vault is never touched.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface EvalReport {
  systems: number;
  elements: number;
  decisionAt1: number;
  ruleRecall: number;
  traceHit: number;
  staleReturned: number;
  misses: string[];
}

export async function runSpecEval(corpus: string): Promise<EvalReport> {
  const { indexArchitecture } = await import('../../src/tools/architecture.js');
  const { storeMemory } = await import('../../src/tools/store.js');
  const { architectureContext, trace, loadModel } = await import('../../src/spec/context.js');
  const { scanProject } = await import('../../src/spec/indexer.js');
  const { parseSpecConfig } = await import('../../src/spec/config.js');
  const { slug } = await import('../../src/spec/adl-parse.js');

  const cfg = parseSpecConfig({});
  const root = path.resolve(corpus);
  const subdirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(root, d.name));
  const hasArch = (d: string) => { const s = scanProject(d, cfg); return s.adl.length + s.calm.length > 0; };
  // Each subfolder with architecture files is one project; otherwise the directory itself is.
  const withArch = subdirs.filter(hasArch);
  const projects = withArch.length ? withArch : hasArch(root) ? [root] : [];

  const r = { systems: 0, elements: 0, decisionHits: 0, ruleChecks: 0, ruleHits: 0, traces: 0, traceHits: 0, stale: 0, misses: [] as string[] };
  let req = 0;
  for (const dir of projects) {
    const system = slug(path.basename(dir));
    indexArchitecture({ path: dir, system });
    const model = loadModel(system);
    if (!model) continue;
    r.systems++;
    for (const el of model.elements) {
      const targeting = model.assertions.filter((a) => a.targets.includes(el.id));
      if (!targeting.length) continue;
      r.elements++;
      const n = r.elements;
      const old = storeMemory({ title: `Old decision ${n}`, content: `Earlier choice for ${el.name}.`, category: 'decisions', system, artifact: 'adr', status: 'accepted', elements: [el.id] });
      const cur = storeMemory({ title: `Decision ${n}`, content: `Current choice for ${el.name}.`, category: 'decisions', system, artifact: 'adr', status: 'accepted', elements: [el.id], supersedes: old.key });
      const ctx: any = architectureContext({ system, element: el.id, limit: 50 }, { guardrails: false });
      const keys = ctx.decisions.map((d: any) => d.key);
      if (keys[0] === cur.key) r.decisionHits++; else r.misses.push(`decision@1 ${system} ${el.id}`);
      if (keys.includes(old.key)) { r.stale++; r.misses.push(`stale ${system} ${el.id}`); }
      const ruleIds = new Set(ctx.rules.map((x: any) => x.id));
      for (const a of targeting) {
        r.ruleChecks++;
        if (ruleIds.has(a.id)) r.ruleHits++; else r.misses.push(`rule ${system} ${el.id} ${a.id}`);
      }
    }
    for (const a of model.assertions) {
      const id = `REQ-${++req}`;
      storeMemory({ title: `Requirement ${id}`, content: `Needs ${a.text}`, category: 'specs', system, artifact: 'spec', requirements: [id], elements: [`assert:${a.id}`] });
      r.traces++;
      const t: any = trace({ id, system });
      if (t.assertions.some((x: any) => x.id === a.id)) r.traceHits++; else r.misses.push(`trace ${system} ${id} → ${a.id}`);
    }
  }
  const ratio = (a: number, b: number) => (b ? a / b : 1);
  return {
    systems: r.systems,
    elements: r.elements,
    decisionAt1: ratio(r.decisionHits, r.elements),
    ruleRecall: ratio(r.ruleHits, r.ruleChecks),
    traceHit: ratio(r.traceHits, r.traces),
    staleReturned: r.stale,
    misses: r.misses,
  };
}

const isMain = (() => { try { return fs.realpathSync(process.argv[1] ?? '') === fs.realpathSync(new URL(import.meta.url).pathname); } catch { return false; } })();
if (isMain) {
  const corpus = process.argv[2];
  if (!corpus) { console.error('usage: npx tsx scripts/eval/spec-eval.ts <corpus-dir> [--json]'); process.exit(2); }
  // Throwaway vault: set HOME before the src modules resolve their paths.
  process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-spec-eval-'));
  runSpecEval(corpus).then((rep) => {
    if (process.argv.includes('--json')) { process.stdout.write(JSON.stringify(rep, null, 2) + '\n'); return; }
    const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
    process.stdout.write([
      `systems indexed     ${rep.systems}`,
      `elements evaluated  ${rep.elements}`,
      `decision@1          ${pct(rep.decisionAt1)}`,
      `rule recall         ${pct(rep.ruleRecall)}`,
      `trace hit rate      ${pct(rep.traceHit)}`,
      `stale decisions     ${rep.staleReturned}`,
      ...(rep.misses.length ? ['misses:', ...rep.misses.slice(0, 20).map((m) => `  ${m}`)] : []),
    ].join('\n') + '\n');
    fs.rmSync(process.env.HOME!, { recursive: true, force: true });
  });
}
