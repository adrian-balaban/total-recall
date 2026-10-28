import * as os from 'os';
import * as path from 'path';

// Tripwire for tests that rmSync a vault: refuse unless the path is under the OS
// temp dir. Guards against HOME-redirect failures (see paths.ts HOME comment).
export function assertTmpPath(p: string): void {
  const tmp = path.resolve(os.tmpdir());
  const rel = path.relative(tmp, path.resolve(p));
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`refusing destructive test op outside ${tmp}: ${p}`);
  }
}
