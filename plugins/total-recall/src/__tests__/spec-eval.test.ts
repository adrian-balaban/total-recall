import { describe, it, expect, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Runs the phase-7 evaluation (scripts/eval/spec-eval.ts) on a small generated
// corpus, so the harness itself stays working in CI. The full run on the Make the
// Grade material is manual: npx tsx scripts/eval/spec-eval.ts <corpus-dir>.

vi.hoisted(() => {
  process.env.HOME = '/tmp/tr-spec-eval-test-' + process.pid;
});

// scripts/ is outside tsconfig's rootDir (dev-only, never bundled): load it by path.
const EVAL = path.resolve(__dirname, '..', '..', 'scripts', 'eval', 'spec-eval.ts');

const corpus = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-spec-eval-corpus-'));
function write(rel: string, text: string) {
  fs.mkdirSync(path.dirname(path.join(corpus, rel)), { recursive: true });
  fs.writeFileSync(path.join(corpus, rel), text);
}
write('shop/adl/structure.adl', `DEFINE SYSTEM Shop AS shop
    DEFINE DOMAIN Orders AS orders
        DEFINE COMPONENT Order Api AS api
    DEFINE DATABASE Order Store AS order-store
ASSERT(Order Api is the only writer of Order Store) # [SHOP-1]
FOREACH COMPONENT c IN shop DO
    ASSERT(c has at most 600 lines per file)
END
`);
write('library/adl/data.adl', `DEFINE SYSTEM Library AS library
    DEFINE SERVICE Loans AS loans
    DEFINE DATABASE Loan Database AS loan-db
ASSERT(Loan Database is only accessed by Loans)
`);
write('notes/readme.md', 'no architecture here');

afterAll(() => {
  fs.rmSync(corpus, { recursive: true, force: true });
  fs.rmSync(process.env.HOME!, { recursive: true, force: true });
});

describe('spec-driven evaluation harness', () => {
  it('indexes each project folder and finds the right decision, rules and traces, with no stale decisions', async () => {
    const { runSpecEval } = await import(EVAL);
    const rep = await runSpecEval(corpus);
    expect(rep.systems).toBe(2);
    expect(rep.elements).toBe(4); // api, order-store, loans, loan-db
    expect(rep).toMatchObject({ decisionAt1: 1, ruleRecall: 1, traceHit: 1, staleReturned: 0, misses: [] });
  });
});
