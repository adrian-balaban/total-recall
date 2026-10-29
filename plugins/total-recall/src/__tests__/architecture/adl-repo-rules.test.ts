import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Repository-level rules from architecture/adl/*.adl that read files rather than import graphs:
// hook coupling [TR-R5], manifest versions [TR-Q3], test hygiene [TR-Q4, TR-Q5], and the CI gates [TR-Q6..Q8].

const ROOT = path.resolve(__dirname, '..', '..', '..');
const REPO = path.resolve(ROOT, '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(...p), 'utf8');
const SELF = path.basename(__filename);

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? (e.name === '__fixtures__' ? [] : walk(p)) : [p];
  });
}
const testFiles = walk(path.join(ROOT, 'src', '__tests__')).filter((f) => f.endsWith('.test.ts') && path.basename(f) !== SELF);

// The tests of one file, split at each it( / it.each( / it.fails( call.
function testBodies(src: string): string[] {
  return src.split(/\n\s*it(?:\.fails|\.each\([^\n]*?\))?\(/).slice(1);
}

describe('repository rules', () => {
  it('[TR-R5] only session-end.sh names dist/index.js among the hook scripts', () => {
    const dir = path.join(ROOT, 'hooks', 'scripts');
    const users = fs.readdirSync(dir).filter((f) => /dist\/index\.js/.test(read(dir, f)));
    expect(users).toEqual(['session-end.sh']);
  });

  it('[TR-Q3] the plugin manifest and the Gemini extension declare the package.json version', () => {
    const version = JSON.parse(read(ROOT, 'package.json')).version;
    expect(JSON.parse(read(ROOT, '.claude-plugin', 'plugin.json')).version).toBe(version);
    expect(JSON.parse(read(ROOT, 'gemini-extension.json')).version).toBe(version);
  });

  it('[TR-Q4] every test contains at least one assertion', () => {
    const empty = testFiles.flatMap((f) =>
      testBodies(read(f))
        .filter((body) => !/\b(expect|assert\w*|toPassAsync)\b/.test(body.split(/\n\s*(?:describe|it)\(/)[0]!))
        .map((body) => `${path.relative(ROOT, f)}: ${body.split('\n')[0]!.slice(0, 80)}`),
    );
    expect(empty).toEqual([]);
  });

  it('[TR-Q5] no test asserts a tautology', () => {
    const tautology = /expect\(\s*(true|false|null|1|0|'[^']*'|"[^"]*")\s*\)\s*\.(?:toBe|toEqual|toStrictEqual)\(\s*\1\s*\)/;
    const bad = testFiles.filter((f) => tautology.test(read(f))).map((f) => path.relative(ROOT, f));
    expect(bad).toEqual([]);
  });

  it('[TR-Q6] the Stryker break threshold is at least 65', () => {
    expect(JSON.parse(read(ROOT, 'stryker.conf.json')).thresholds.break).toBeGreaterThanOrEqual(65);
  });

  it('[TR-Q7] the mutation workflow audits dependencies before the build', () => {
    const wf = read(REPO, '.github', 'workflows', 'mutation.yml');
    const audit = wf.indexOf('npm audit');
    expect(audit).toBeGreaterThan(-1);
    expect(audit).toBeLessThan(wf.indexOf('npm run build'));
  });

  it('[TR-Q8] the release workflow publishes only after a successful mutation run', () => {
    const wf = read(REPO, '.github', 'workflows', 'release.yml');
    expect(wf).toMatch(/workflow_run:\s*\n\s*workflows:\s*\[mutation\]/);
    expect(wf).toContain("github.event.workflow_run.conclusion == 'success'");
  });

  it('[TR-W3] store_memory writes the .md file before it updates the index', () => {
    const src = read(ROOT, 'src', 'tools', 'store.ts');
    const file = src.indexOf('fs.writeFileSync(filePath, fileContent)');
    const index = src.indexOf('memIndex[key] = meta');
    expect(file).toBeGreaterThan(-1);
    expect(index).toBeGreaterThan(file);
  });
});
