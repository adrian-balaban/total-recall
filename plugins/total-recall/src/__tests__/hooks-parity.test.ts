import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// hooks.json (Claude Code / VS Code agent plugins) and hooks.gemini.json must wire the
// same scripts under the same lifecycle slots, so a hook added for one host is not
// silently missing on the other. Event names differ per host; the scripts must not.
const HOOKS = path.resolve(__dirname, '..', '..', 'hooks');

function scriptsByEvent(file: string): Record<string, string[]> {
  const j = JSON.parse(fs.readFileSync(path.join(HOOKS, file), 'utf8'));
  const out: Record<string, string[]> = {};
  for (const [ev, groups] of Object.entries<any[]>(j.hooks)) {
    out[ev] = groups.flatMap((g) => g.hooks.map((h: any) => path.basename(h.command)));
  }
  return out;
}

const EVENT_MAP: Record<string, string> = {
  SessionStart: 'SessionStart', PostToolUse: 'AfterTool', PreCompact: 'PreCompress', SessionEnd: 'SessionEnd',
};

describe('hooks.json / hooks.gemini.json parity', () => {
  const claude = scriptsByEvent('hooks.json');
  const gemini = scriptsByEvent('hooks.gemini.json');

  it('lists the same lifecycle events (modulo host event names)', () => {
    expect(Object.keys(claude).sort()).toEqual(Object.keys(EVENT_MAP).sort());
    expect(Object.keys(gemini).sort()).toEqual(Object.values(EVENT_MAP).sort());
  });

  it('wires the same scripts per event', () => {
    for (const [c, g] of Object.entries(EVENT_MAP)) {
      expect([...(gemini[g] ?? [])].sort()).toEqual([...(claude[c] ?? [])].sort());
    }
  });
});
