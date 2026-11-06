// prepublishOnly guard: the tarball may hold only the launcher, package.json, README and LICENSE.
// Plugin code must never ship through npm (PLAN-NPX-INSTALL-BOOTSTRAP.md, section 2).
import { execFileSync } from 'node:child_process';

const out = execFileSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8' });
const files = JSON.parse(out)[0].files.map((f) => f.path);
const allowed = (p) => p === 'package.json' || /^README(\.md)?$/i.test(p) || /^LICENSE(\.md)?$/i.test(p) || /^bin\/[^/]+\.mjs$/.test(p);
const extra = files.filter((p) => !allowed(p));
if (extra.length) {
  console.error('pack-guard: unexpected files in the npm tarball:\n  ' + extra.join('\n  '));
  process.exit(1);
}
console.log(`pack-guard: ${files.length} files, all allowed (${files.join(', ')})`);
