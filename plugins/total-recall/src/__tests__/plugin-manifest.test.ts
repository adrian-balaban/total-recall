import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Regression guard for the plugin's MCP server declaration.
//
// For a plugin-managed install the ONLY thing that starts the MCP server is the
// plugin's own `.mcp.json` (install.sh deliberately skips user-scope
// registration). An empty `{ "mcpServers": {} }` therefore removes all 22 tools
// while the hooks keep firing, which looks like "memories load but store, delete
// and org sync don't work". It was emptied by unrelated commits twice
// (7c1407c, restored in 1.1.16; 7ab8545, shipped in 1.2.0-1.3.1). Nothing
// checked it, so this test pins the declaration and ties it to the PostToolUse
// matcher: the matcher names tools `mcp__plugin_<plugin>_<server>__<tool>`, so
// the plugin name, the server key and the matcher can no longer drift apart.

const ROOT = path.resolve(__dirname, '..', '..');
const readJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

const mcp = readJson('.mcp.json');
const plugin = readJson('.claude-plugin/plugin.json');
const pkg = readJson('package.json');
const hooks = readJson('hooks/hooks.json');

describe('.mcp.json', () => {
  it('declares the total-recall stdio server', () => {
    expect(Object.keys(mcp.mcpServers ?? {})).toEqual(['total-recall']);
    const s = mcp.mcpServers['total-recall'];
    expect(s.type).toBe('stdio');
    expect(s.command).toBe('node');
  });

  it('launches the built bundle from the plugin root', () => {
    expect(mcp.mcpServers['total-recall'].args).toEqual(['${CLAUDE_PLUGIN_ROOT}/dist/index.js']);
    // the build script must actually produce that path
    expect(pkg.scripts.build).toContain('build:esbuild');
    expect(pkg.scripts['build:esbuild']).toMatch(/dist\/index\.js/);
  });
});

describe('plugin name, server key and org-sync matcher agree', () => {
  const syncGroup = (hooks.hooks.PostToolUse as any[]).find((g) =>
    (g.hooks ?? []).some((h: any) => String(h.command).includes('sync-org-memory.sh')),
  );

  it('the plugin is named total-recall', () => {
    expect(plugin.name).toBe('total-recall');
  });

  it('the matcher targets mcp__plugin_<plugin>_<server>__ for the declared server', () => {
    const server = Object.keys(mcp.mcpServers)[0];
    const prefix = `mcp__plugin_${plugin.name}_${server}__`;
    expect(syncGroup.matcher.startsWith(prefix)).toBe(true);
    for (const tool of ['store_memory', 'update_memory', 'delete_memory']) {
      expect(new RegExp(syncGroup.matcher).test(prefix + tool)).toBe(true);
    }
  });
});
