// Idempotently registers the total-recall MCP server in a VS Code user mcp.json
// (schema: top-level "servers"), pointing at the node-resolving launcher
// scripts/start-server.sh by absolute path. Used by `install.sh --vscode` as the
// fallback when VS Code agent plugins are off.
// Usage: node register-vscode-mcp.mjs <mcp.json path> <plugin root>
// Foreign servers are kept. A file that is not strict JSON (VS Code allows
// comments) is left untouched: exit 2, and the caller prints the snippet instead.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function mergeServer(existing, pluginRoot) {
  const cfg = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  const servers = cfg.servers && typeof cfg.servers === 'object' ? cfg.servers : {};
  return {
    ...cfg,
    servers: {
      ...servers,
      'total-recall': { type: 'stdio', command: path.join(pluginRoot, 'scripts', 'start-server.sh') },
    },
  };
}

export function register(file, pluginRoot) {
  let existing = {};
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8');
    if (raw.trim()) {
      try { existing = JSON.parse(raw); } catch { return 'unparseable'; }
    }
  }
  const next = JSON.stringify(mergeServer(existing, pluginRoot), null, 2) + '\n';
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === next) return 'unchanged';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, next);
  fs.renameSync(tmp, file);
  return 'written';
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [file, root] = process.argv.slice(2);
  if (!file || !root) { console.error('usage: register-vscode-mcp.mjs <mcp.json> <plugin root>'); process.exit(64); }
  const r = register(file, root);
  console.log(r);
  process.exit(r === 'unparseable' ? 2 : 0);
}
