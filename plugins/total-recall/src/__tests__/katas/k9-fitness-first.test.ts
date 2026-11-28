// K9 — fitness functions before architecture claims (course pp. 52–53, 64–65).
// Sketch: plugins/total-recall/architecture/katas/s3-k9-fitness-first/adl/fitness-first-kata.adl. Fitness functions for [K9-01]..[K9-03];
// each has a known-pass and a known-fail. Fixtures are synthetic strings.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const PLUGIN = path.resolve(__dirname, '../../..'); // plugins/total-recall
const REPO = path.resolve(PLUGIN, '../..');

// Fixtures are strings (ADL, budget, README and backlog text), so nothing is written to disk.
const read = (base: string, rel: string) => fs.readFileSync(path.join(base, rel), 'utf8');

// ---- [K9-01] the numbers the ADL promises are the numbers the benchmark enforces ----------------
// capabilities.adl states targets in prose (writes per second, recall p95, memories). The budget file
// is what the benchmark job fails on. If they drift, the ADL promises more than anything checks.
interface Targets { rate: number | null; p95: number | null; memories: number | null }
function adlTargets(adl: string): Targets {
  const rate = /sustains at least (\d+)\s+writes per second/.exec(adl);
  const p95 = /p95 stays under (\d+)\s*ms/.exec(adl);
  const mem = /at (\d+)\s+memories/.exec(adl);
  return { rate: rate ? +rate[1]! : null, p95: p95 ? +p95[1]! : null, memories: mem ? +mem[1]! : null };
}
// The loadtest scale is per vault and it fills two vaults (personal and org), so the ADL's total is lt_n × 2.
function targetDrift(adl: string, budgetJson: string, vaults = 2): string[] {
  const t = adlTargets(adl);
  const full = JSON.parse(budgetJson).profiles.full as { lt_n: number; min_store_writes_per_sec: number; max_recall_p95_ms: number };
  const out: string[] = [];
  if (t.rate !== full.min_store_writes_per_sec) out.push(`writes/s: ADL ${t.rate}, budget ${full.min_store_writes_per_sec}`);
  if (t.p95 !== full.max_recall_p95_ms) out.push(`p95 ms: ADL ${t.p95}, budget ${full.max_recall_p95_ms}`);
  if (t.memories !== full.lt_n * vaults) out.push(`memories: ADL ${t.memories}, budget ${full.lt_n} x ${vaults}`);
  return out;
}
const ADL_PERF = 'ASSERT(store_memory sustains at least 1000 writes per second, flat up to 20000 memories)\nASSERT(recall_memory p95 stays under 150 ms at 20000 memories)\n';
const BUDGET = (n: number, rate: number, p95: number) => JSON.stringify({ profiles: { full: { lt_n: n, min_store_writes_per_sec: rate, max_recall_p95_ms: p95 } } });

describe('[K9-01] the ADL targets equal the enforced budget', () => {
  it('[K9-01] known-pass: matching numbers give no drift', () => {
    expect(targetDrift(ADL_PERF, BUDGET(10000, 1000, 150))).toEqual([]);
  });
  it('[K9-01] known-fail: a loosened budget is named per number', () => {
    expect(targetDrift(ADL_PERF, BUDGET(5000, 500, 300))).toEqual([
      'writes/s: ADL 1000, budget 500', 'p95 ms: ADL 150, budget 300', 'memories: ADL 20000, budget 5000 x 2']);
  });
  it('[K9-01] known-pass: on the real ADL and budget the numbers agree', () => {
    const adl = read(PLUGIN, 'architecture/adl/capabilities.adl');
    expect(adlTargets(adl)).toEqual({ rate: 1000, p95: 150, memories: 20000 }); // the prose was really read
    expect(targetDrift(adl, read(PLUGIN, 'scripts/loadtest-budget.json'))).toEqual([]);
  });
});

// ---- [K9-02] what the ADL says about CI matches the workflows ------------------------------------
// A comment that says a target is "not in CI" is a claim about the gate. If a workflow runs the
// benchmark against the budget, the comment is stale, and a reader concludes the target is unchecked.
function ciClaimMismatch(adl: string, workflows: string): string[] {
  const claimsNotInCi = /not in CI/i.test(adl);
  const benchmarkInCi = /LT_PROFILE=(smoke|full)/.test(workflows);
  return claimsNotInCi && benchmarkInCi ? ['the ADL says the benchmark is not in CI, but a workflow runs it against the budget'] : [];
}

describe('[K9-02] the ADL does not understate what CI enforces', () => {
  it('[K9-02] known-pass: a claim of "not in CI" with no benchmark in any workflow is accurate', () => {
    expect(ciClaimMismatch('# Measured by hand, not in CI\n', 'name: mutation\n')).toEqual([]);
  });
  it('[K9-02] known-pass: no claim, benchmark in CI, is accurate', () => {
    expect(ciClaimMismatch('# Measured with loadtest\n', 'LT_PROFILE=smoke npx tsx scripts/loadtest.ts\n')).toEqual([]);
  });
  it('[K9-02] known-fail: a "not in CI" claim while a workflow enforces the budget is named', () => {
    expect(ciClaimMismatch('# not in CI: untagged on purpose\n', 'LT_N=250 LT_PROFILE=smoke x\n')).toHaveLength(1);
  });
  it('[K9-02] the real tree: the capabilities comment no longer understates CI (finding closed)', () => {
    const adl = read(PLUGIN, 'architecture/adl/capabilities.adl');
    const wf = fs.readdirSync(path.join(REPO, '.github/workflows')).map(f => read(REPO, `.github/workflows/${f}`)).join('\n');
    expect(/LT_PROFILE=(smoke|full)/.test(wf)).toBe(true); // the benchmark really is in a workflow
    // Disposition (done): comment revised (smoke in the PR gate, full weekly). Tagging the two asserts waits for P4.
    expect(ciClaimMismatch(adl, wf)).toEqual([]);
  });
});

// ---- [K9-03] an unmeasured claim is declared, with an owner ---------------------------------------
// The README says retrieval quality is "not yet measured". That is honest only if the same gap is a
// backlog entry with a trigger, so it has a way to end. The check is the pairing, not the sentence.
function unmeasuredWithoutBacklog(readme: string, backlog: string): string[] {
  const claims = [...readme.matchAll(/([^\n.]*\bnot yet measured\b[^\n.]*)/gi)].map(m => m[1]!.trim());
  const entries = backlog.split(/\n(?=### )/).filter(e => /\*\*Trigger:\*\*/.test(e));
  return claims.filter(c => {
    const topic = (/\b(retrieval quality|recall quality|latency|throughput)\b/i.exec(c) ?? [])[1];
    const key = topic ? topic.split(' ').pop()! : null; // 'quality', 'latency', 'throughput'
    return !key || !entries.some(e => new RegExp(key, 'i').test(e));
  });
}
const BL = '### Evaluation harness for recall quality\n- **Trigger:** a scoring change needs a regression guard.\n';

describe('[K9-03] an unmeasured claim has a backlog entry with a trigger', () => {
  it('[K9-03] known-pass: the claim and a matching entry with a trigger', () => {
    expect(unmeasuredWithoutBacklog('- Retrieval quality is not yet measured against an evaluation set.\n', BL)).toEqual([]);
  });
  it('[K9-03] known-fail: a claim with no entry, or an entry with no trigger, is named', () => {
    expect(unmeasuredWithoutBacklog('- Retrieval quality is not yet measured.\n', '### Something else\n- **Trigger:** x\n')).toHaveLength(1);
    expect(unmeasuredWithoutBacklog('- Retrieval quality is not yet measured.\n', '### Evaluation harness for recall quality\n- no trigger line\n')).toHaveLength(1);
  });
  it('[K9-03] known-pass: on the real README and backlog every "not yet measured" claim is paired', () => {
    const readme = read(REPO, 'README.md');
    expect(/not yet measured/i.test(readme)).toBe(true); // the claim exists, so the check is not vacuous
    expect(unmeasuredWithoutBacklog(readme, read(REPO, 'backlog-and-plans/BACKLOG.md'))).toEqual([]);
  });
});
