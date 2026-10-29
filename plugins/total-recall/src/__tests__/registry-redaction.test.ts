import { describe, it, expect, vi } from 'vitest';

// A tool error that carries a filesystem path (EACCES, ENOENT, ...) must not hand
// the user's home layout back to the caller: get_stats already redacts
// recentErrors, and wrapHandler now does the same for the error text it returns.
vi.hoisted(() => {
  process.env.HOME = '/tmp/tr-registry-redact-' + process.pid;
});

import { wrapHandler } from '../tools/registry.js';
import { errors } from '../state.js';

describe('wrapHandler error redaction', () => {
  it('[TR-C3] redacts the home directory in the returned error text, keeps the raw text in the error sink', async () => {
    const home = process.env.HOME!;
    const run = wrapHandler('probe_tool', async () => {
      throw new Error(`EACCES: permission denied, open '${home}/.total-recall/index.json'`);
    });
    const res: any = await run({}, undefined);
    expect(res.isError).toBe(true);
    const text = res.content[0].text as string;
    expect(text).toContain('~/.total-recall/index.json');
    expect(text).not.toContain(home);
    expect(errors[errors.length - 1]!.msg).toContain(home); // local debugging keeps the full path
  });

  it('leaves a path-free message untouched', async () => {
    const run = wrapHandler('probe_tool', async () => { throw new Error('Memory not found: knowledge/x'); });
    const res: any = await run({}, undefined);
    expect(res.content[0].text).toBe('Error: Memory not found: knowledge/x');
  });

  it('survives a non-Error throw', async () => {
    const run = wrapHandler('probe_tool', async () => { throw 'plain string'; });
    const res: any = await run({}, undefined);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe('Error: plain string');
  });
});
