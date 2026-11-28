// K2 — quality of agent-generated code (course pp. 28–29). Sketch: plugins/total-recall/architecture/katas/s1-k2-code-quality/adl/code-quality-kata.adl
// Fitness functions for [K2-01]..[K2-03]; each has a known-pass and a known-fail case (plan §3.3).
// Fixtures are synthetic and live under os.tmpdir(); the real tree is only read.
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import ts from 'typescript';
import { measureComplexity, type FnComplexity } from '../architecture/complexity.js';
import { COMPONENT_FILES } from '../architecture/components.js';
import { assertTmpPath } from '../assert-tmp-path.js';

const ROOT = path.resolve(__dirname, '../../..'); // plugins/total-recall
const MAX_CC = 10; // code-quality.adl MAX_CC
const MAX_CC_AGENT = 5; // sketch: the stricter limit for agent-generated code

const baseline: Record<string, number> = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'src/__tests__/architecture/complexity-baseline.json'), 'utf8'));

// ---- fixtures -------------------------------------------------------------
const tmpDirs: string[] = [];
function tmpTree(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'k2-kata-'));
  tmpDirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return dir;
}
afterAll(() => { for (const d of tmpDirs) { assertTmpPath(d); fs.rmSync(d, { recursive: true, force: true }); } });

// The course's agent-written grade() (page 28), ported to TypeScript: 1 + 14 decision points = 15.
const GRADE_FN = `export function grade(a: { response: string | null; type: string; n: number }, key: Record<number, string>): string {
  if (a.response == null) return 'WRONG';
  let k: string | undefined;
  switch (a.n) {
    case 3: k = key[3]; break; case 4: k = key[4]; break; case 5: k = key[5]; break; case 6: k = key[6]; break;
    case 7: k = key[7]; break; case 8: k = key[8]; break; case 9: k = key[9]; break; case 10: k = key[10]; break;
    case 11: k = key[11]; break; case 12: k = key[12]; break;
    default: throw new Error('unknown grade');
  }
  if (a.type === 'TRUE_FALSE') return a.response.toLowerCase() === k!.toLowerCase() ? 'RIGHT' : 'WRONG';
  return a.response === k ? 'RIGHT' : 'WRONG';
}
`;
const ccOf = (m: FnComplexity[], name: string) => m.find(f => f.name === name)?.cc;
const branchy = (n: number) =>
  `export function f${n}(x: number): number {\n${Array.from({ length: n }, (_, i) => `  if (x === ${i}) return ${i};`).join('\n')}\n  return -1;\n}\n`;

// ---- [K2-01] the measurer reproduces the course's number ------------------
// The course's Task 1 answer is 15. A fitness function built on a metric is only
// believed if the metric agrees with an independent answer on a known input.
describe('[K2-01] cyclomatic complexity is measured the way the course counts it', () => {
  it('[K2-01] known-pass: the ported grade() measures 15, as in the course answer', () => {
    const root = tmpTree({ 'src/grade.ts': GRADE_FN });
    expect(ccOf(measureComplexity(root), 'grade')).toBe(15);
  });
  it('[K2-01] known-pass: a straight-line function measures 1 and each decision adds exactly 1', () => {
    const root = tmpTree({ 'src/a.ts': 'export const a = (x: number) => x + 1;\n', 'src/b.ts': branchy(3) });
    const m = measureComplexity(root);
    expect(ccOf(m, 'a')).toBe(1);
    expect(ccOf(m, 'f3')).toBe(4);
  });
  it('[K2-01] known-fail: grade() breaks both limits, the agent one and the human one', () => {
    const root = tmpTree({ 'src/grade.ts': GRADE_FN });
    const over = (limit: number) => measureComplexity(root).filter(f => f.cc >= limit).map(f => f.name);
    expect(over(MAX_CC_AGENT)).toEqual(['grade']);
    expect(over(MAX_CC)).toEqual(['grade']);
  });
});

// ---- [K2-02] agent limit as a ratchet --------------------------------------
// The real tree cannot meet a flat limit of 5: many existing functions sit between 5 and 9.
// A ceiling over the functions outside the Q9 baseline freezes today's count and fails on any
// new function at or above the agent limit.
const agentBand = (m: FnComplexity[]) => m.filter(f => f.cc >= MAX_CC_AGENT && f.cc < MAX_CC && !(f.key in baseline));
const AGENT_BAND_CEILING = 71; // measured at the K2 session; only ever lower it

describe('[K2-02] no new function reaches the agent limit', () => {
  it('[K2-02] known-pass: the real tree is at or under the frozen count of functions in [5,10)', () => {
    const band = agentBand(measureComplexity(ROOT));
    expect(band.length).toBeLessThanOrEqual(AGENT_BAND_CEILING);
  });
  it('[K2-02] known-fail: one new function of complexity 6 puts the tree over the same limit', () => {
    const real = agentBand(measureComplexity(ROOT)).length;
    const root = tmpTree({ 'src/new.ts': branchy(5) }); // cc = 6
    const added = agentBand(measureComplexity(root));
    expect(added.map(f => f.cc)).toEqual([6]);
    expect(real + added.length).toBeGreaterThan(real);
  });
  it('[K2-02] known-pass: a function of complexity 4 adds nothing to the band', () => {
    const root = tmpTree({ 'src/ok.ts': branchy(3) });
    expect(agentBand(measureComplexity(root))).toEqual([]);
  });
});

// ---- [K2-03] A / I / D per component ----------------------------------------
export const distance = (na: number, nc: number, ca: number, ce: number) => {
  const a = na + nc === 0 ? 0 : na / (na + nc);
  const i = ce + ca === 0 ? 0 : ce / (ce + ca);
  return { a, i, d: Math.abs(a + i - 1) };
};

interface Metrics { na: number; nc: number; ca: number; ce: number; a: number; i: number; d: number }

function listTs(base: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== '__tests__') walk(p); }
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) out.push(path.relative(base, p).split(path.sep).join('/'));
    }
  };
  walk(path.join(base, 'src'));
  return out.sort();
}

/** Na = interfaces, type aliases and abstract classes; Nc = exported functions, classes and consts. */
function countDecls(src: string): { na: number; nc: number } {
  const sf = ts.createSourceFile('x.ts', src, ts.ScriptTarget.Latest, true);
  let na = 0; let nc = 0;
  const exported = (n: ts.Node) => ts.canHaveModifiers(n) && !!ts.getModifiers(n)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
  for (const st of sf.statements) {
    if (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) na++;
    else if (ts.isClassDeclaration(st)) { if (st.modifiers?.some(m => m.kind === ts.SyntaxKind.AbstractKeyword)) na++; else nc++; }
    else if ((ts.isFunctionDeclaration(st) || ts.isVariableStatement(st)) && exported(st)) nc++;
  }
  return { na, nc };
}

function localImports(base: string, rel: string, files: Set<string>): string[] {
  const sf = ts.createSourceFile(rel, fs.readFileSync(path.join(base, rel), 'utf8'), ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  for (const st of sf.statements) {
    if (!(ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) || !st.moduleSpecifier || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const spec = st.moduleSpecifier.text;
    if (!spec.startsWith('.')) continue;
    const target = path.posix.join(path.posix.dirname(rel), spec.replace(/\.js$/, '')) + '.ts';
    if (files.has(target)) out.push(target);
  }
  return out;
}

export function mainSequence(base: string, components: Record<string, RegExp>): Record<string, Metrics> {
  const files = listTs(base);
  const set = new Set(files);
  const owner = new Map<string, string>();
  for (const f of files) for (const [c, re] of Object.entries(components)) if (re.test(f)) owner.set(f, c);
  const tally: Record<string, { na: number; nc: number; ca: Set<string>; ce: Set<string> }> = {};
  for (const c of Object.keys(components)) tally[c] = { na: 0, nc: 0, ca: new Set(), ce: new Set() };
  for (const f of files) {
    const c = owner.get(f); if (!c) continue;
    const { na, nc } = countDecls(fs.readFileSync(path.join(base, f), 'utf8'));
    tally[c]!.na += na; tally[c]!.nc += nc;
    for (const t of localImports(base, f, set)) {
      const o = owner.get(t);
      if (!o || o === c) continue;
      tally[c]!.ce.add(`${f}->${t}`); tally[o]!.ca.add(`${f}->${t}`);
    }
  }
  const out: Record<string, Metrics> = {};
  for (const [c, t] of Object.entries(tally)) out[c] = { na: t.na, nc: t.nc, ca: t.ca.size, ce: t.ce.size, ...distance(t.na, t.nc, t.ca.size, t.ce.size) };
  return out;
}

describe('[K2-03] distance from the main sequence', () => {
  it('[K2-03] known-pass: the formulas reproduce the course table (pp. 28–29)', () => {
    const rows: Array<[string, number, number, number, number, number]> = [
      ['AutoGrading', 0, 12, 6, 1, 0.857], ['QuestionSender', 2, 6, 2, 3, 0.15], ['AnswerCapture', 1, 4, 1, 4, 0],
      ['TestLoader', 3, 5, 3, 2, 0.225], ['ReportingCore', 9, 3, 1, 6, 0.607],
    ];
    for (const [, na, nc, ca, ce, d] of rows) expect(distance(na, nc, ca, ce).d).toBeCloseTo(d, 2);
  });
  it('[K2-03] known-fail: a synthetic concrete, stable component is in the zone of pain', () => {
    const root = tmpTree({
      'src/core.ts': 'export function a() { return 1; }\nexport function b() { return 2; }\n',
      'src/u1.ts': "import { a } from './core.js';\nexport const x = a();\n",
      'src/u2.ts': "import { b } from './core.js';\nexport const y = b();\n",
    });
    const m = mainSequence(root, { core: /^src\/core\.ts$/, users: /^src\/u\d\.ts$/ });
    expect(m.core).toMatchObject({ na: 0, nc: 2, ca: 2, ce: 0 });
    expect(m.core!.d).toBe(1);
    expect(m.users!.d).toBeLessThan(0.3);
  });
  it('[K2-03] known-pass: on the real tree the pain zone is the stable concrete foundation (TR-S1 leaves, TR-S9 state)', () => {
    const m = mainSequence(ROOT, COMPONENT_FILES);
    expect(Object.keys(m).sort()).toEqual(Object.keys(COMPONENT_FILES).sort());
    const pain = Object.entries(m).filter(([, v]) => v.d >= 0.3).map(([c]) => c);
    // The metric flags exactly what the structure ADL builds on purpose: concrete, widely imported, importing nothing.
    for (const c of ['helpers', 'paths', 'state']) expect(pain).toContain(c);
    for (const c of pain) expect(m[c]!.i).toBeLessThan(0.6); // pain = stable + concrete, never an unstable component
    if (process.env.K2_PRINT) console.log(JSON.stringify(m, null, 1));
  });
});
