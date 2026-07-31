import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Regression guard for the org-sync PostToolUse hook matcher.
//
// Claude Code evaluates a PostToolUse `matcher` two ways:
//   - If it contains ONLY [a-zA-Z0-9_- ,|] it is an EXACT string, or a list of
//     exact strings separated by `|` or `,`, compared verbatim against the full
//     tool name.
//   - If it contains any other character (e.g. `(`, `)`, `*`, `.`), it is an
//     UNANCHORED regex tested against the full tool name.
// Plugin-bundled MCP tools are named `mcp__plugin_<plugin>_<server>__<tool>`
// (here `mcp__plugin_total-recall_total-recall__<tool>`). A bare
// `store_memory|update_memory|delete_memory` matcher falls on the exact-match
// path and never equals the full tool name, so the org-sync hook silently never
// fired — org memories sat untracked and were never pushed. The matcher MUST
// stay a regex that matches the full plugin tool name.

const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');
const HOOKS_JSON = path.join(PLUGIN_ROOT, 'hooks', 'hooks.json');

// Reproduce Claude Code's matcher evaluation. Returns true if `matcher` should
// match `toolName` under Claude Code's documented semantics.
function matches(matcher: string, toolName: string): boolean {
  if (/^[a-zA-Z0-9_\- ,|]*$/.test(matcher)) {
    // Exact-match path: split on `|` and `,`, trim, compare verbatim.
    const literals = matcher
      .split(/[|,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    return literals.includes(toolName);
  }
  // Regex path: unanchored.
  return new RegExp(matcher).test(toolName);
}

function readPostToolUseMatcher(jsonFile: string): string {
  const hooks = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  const groups = hooks?.hooks?.PostToolUse;
  expect(Array.isArray(groups)).toBe(true);
  for (const g of groups) {
    const cmds = (g.hooks ?? []).filter(
      (h: any) => typeof h?.command === 'string' && h.command.includes('sync-org-memory.sh'),
    );
    if (cmds.length > 0) {
      const matcher = g.matcher;
      expect(typeof matcher).toBe('string');
      return matcher as string;
    }
  }
  throw new Error('no PostToolUse group wires sync-org-memory.sh');
}

const WRITE_TOOLS = [
  'mcp__plugin_total-recall_total-recall__store_memory',
  'mcp__plugin_total-recall_total-recall__update_memory',
  'mcp__plugin_total-recall_total-recall__delete_memory',
];
// Reads must NOT trigger the org-sync git push — only writes do.
const READ_TOOLS = [
  'mcp__plugin_total-recall_total-recall__recall_memory',
  'mcp__plugin_total-recall_total-recall__search_index',
  'mcp__plugin_total-recall_total-recall__get_memories_by_keys',
];

describe.each([
  ['hooks.json', readPostToolUseMatcher(HOOKS_JSON)],
])('org-sync PostToolUse matcher (%s)', (_label, matcher) => {
  it('is a regex, not a bare exact-match list (contains a non-exact-match char)', () => {
    // A bare `store_memory|update_memory|delete_memory` would be exact-match-only
    // and silently never fire. Parens (or any regex meta char) force the regex path.
    expect(/^[a-zA-Z0-9_\- ,|]*$/.test(matcher)).toBe(false);
  });

  it('matches all three write tools by their full plugin MCP name', () => {
    for (const tool of WRITE_TOOLS) {
      expect(matches(matcher, tool)).toBe(true);
    }
  });

  it('does NOT match read-only tools (sync must fire on writes only)', () => {
    for (const tool of READ_TOOLS) {
      expect(matches(matcher, tool)).toBe(false);
    }
  });

  it('does NOT match unrelated MCP tools that happen to end in a write suffix', () => {
    // Guard against an over-broad `.*` matcher that would fire org-sync on every
    // server's store/update/delete tool.
    expect(matches(matcher, 'mcp__plugin_other-plugin_other__store_memory')).toBe(false);
  });
});