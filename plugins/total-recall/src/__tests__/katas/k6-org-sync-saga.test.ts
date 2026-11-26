// K6 — org-sync as a saga: failure modes (course pp. 44–45, saga: compensation per step).
// Sketch: katas/s2-k6-org-sync-saga/adl/saga-kata.adl. Fitness functions for [K6-01], [K6-02];
// each has a known-pass and a known-fail. Fixtures are synthetic strings.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const PLUGIN = path.resolve(__dirname, '../../..'); // plugins/total-recall

// Fixtures here are strings (script and test text), so nothing is written to disk.

// The compensation vocabulary of workflows.adl (Org Sync Saga): block, keep, record; plus skip (no effect).
type Compensation = 'block' | 'keep' | 'record' | 'skip';

// The saga's failure-mode matrix: every failure message in the script, with its compensation and the
// regex a test must contain to count as exercising it. Keyed by the literal that opens the message.
interface Mode { comp: Compensation; tested: RegExp }
const MATRIX: Record<string, Mode> = {
  'Usage: sync-org-memory.mjs': { comp: 'block', tested: /Usage:/ },
  'Error: orgRepo is not set.': { comp: 'block', tested: /orgRepo is not set|without (an )?orgRepo|no orgRepo/i },
  'Rejecting suspicious org key:': { comp: 'block', tested: /Rejecting suspicious org key|org\/[^'"`]*\\0/ },
  'Rejecting reserved org key:': { comp: 'block', tested: /reserved-key/ },
  'Org key escapes vault:': { comp: 'block', tested: /Org key escapes vault|org\/\.\.\/\.\./ },
  'Org file not found:': { comp: 'skip', tested: /file not found/i },
  'Cannot switch org vault to': { comp: 'skip', tested: /Cannot switch|switch fails|switch.*fail/i },
  'Refusing to delete org key': { comp: 'block', tested: /refuses to --delete/ },
  'Rejecting org key': { comp: 'block', tested: /both org and personal|tagged both|org\+personal/i },
  'Privacy filter blocked': { comp: 'block', tested: /blocks \(does not push\)/ },
  'refusing to rewrite org index (parse fai': { comp: 'block', tested: /refuses to rewrite a corrupt org index/ },
  'refusing to rewrite org index (forward-i': { comp: 'block', tested: /forward-incompatible org index/ },
  'org working-tree wipe detected on': { comp: 'record', tested: /guardTreeWipe/ },
  'org-sync: ABORT —': { comp: 'record', tested: /guardTreeWipe/ },
};

function failureSites(scriptSrc: string): string[] {
  const code = scriptSrc.replace(/^\s*\/\/.*$/gm, '');
  const re = /(?:console\.error|new Error)\(\s*[`'"]([^`'"$]{12,})/g;
  const out = new Set<string>();
  for (const m of code.matchAll(re)) out.add(m[1]!.trim().slice(0, 40));
  return [...out];
}
const undeclared = (sites: string[]) => sites.filter(s => !Object.keys(MATRIX).some(k => k.startsWith(s) || s.startsWith(k)));
const stale = (sites: string[]) => Object.keys(MATRIX).filter(k => !sites.some(s => k.startsWith(s) || s.startsWith(k)));

describe('[K6-01] every saga failure site has a declared compensation', () => {
  const synth = "console.error('Usage: sync-org-memory.mjs <key>');\nthrow new Error(`org-sync: ABORT — x`);\n";
  it('[K6-01] known-pass: sites read from the script are all in the matrix', () => {
    expect(undeclared(failureSites(synth))).toEqual([]);
  });
  it('[K6-01] known-fail: a new failure message nobody classified is named; a comment is not a site', () => {
    const src = synth + "console.error('Brand new failure mode here');\n// console.error('Commented out failure site');\n";
    expect(undeclared(failureSites(src))).toEqual(['Brand new failure mode here']);
  });
  it('[K6-01] known-fail: a matrix row whose message left the script is reported as stale', () => {
    expect(stale(failureSites(synth)).length).toBe(Object.keys(MATRIX).length - 2);
  });
  it('[K6-01] known-pass: on the real script nothing is undeclared and nothing is stale', () => {
    const sites = failureSites(fs.readFileSync(path.join(PLUGIN, 'scripts/sync-org-memory.mjs'), 'utf8'));
    expect(sites.length).toBeGreaterThanOrEqual(Object.keys(MATRIX).length - 1); // the extraction really found them
    expect(undeclared(sites)).toEqual([]);
    expect(stale(sites)).toEqual([]);
  });
});

// ---- [K6-02] every failure mode is exercised by a test ---------------------------------------------
function untested(testsText: string): string[] {
  return Object.entries(MATRIX).filter(([, m]) => !m.tested.test(testsText)).map(([k]) => k);
}
function testsOf(base: string): string {
  const dir = path.join(base, 'src/__tests__');
  return fs.readdirSync(dir).filter(f => f.endsWith('.test.ts') && /sync-org|org-sync|hook-scripts|privacy-routing/.test(f))
    .map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
}

describe('[K6-02] every saga failure mode is exercised by a test', () => {
  it('[K6-02] known-pass: a test text that names every mode leaves nothing untested', () => {
    const all = Object.values(MATRIX).map(m => m.tested.source.replace(/\\/g, '')).join(' ');
    expect(untested('Usage: orgRepo is not set Rejecting suspicious org key reserved-key Org key escapes vault file not found Cannot switch refuses to --delete both org and personal blocks (does not push) refuses to rewrite a corrupt org index forward-incompatible org index guardTreeWipe')).toEqual([]);
    expect(all.length).toBeGreaterThan(0);
  });
  it('[K6-02] known-fail: an empty test text leaves every mode untested', () => {
    expect(untested('').length).toBe(Object.keys(MATRIX).length);
  });
  it('[K6-02] on the real tests: the untested failure modes are the finding, pinned', () => {
    const found = untested(testsOf(PLUGIN));
    // Disposition (answers.md): add behavioural tests, or exempt with an expiry. When one is added, remove it here.
    expect(found).toEqual([
      'Usage: sync-org-memory.mjs',
      'Error: orgRepo is not set.',
      'Rejecting suspicious org key:',
      'Org key escapes vault:',
      'Org file not found:',
      'Cannot switch org vault to',
      'Rejecting org key',
    ]);
  });
});
