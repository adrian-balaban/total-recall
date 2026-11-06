// Org sync in "server" mode (orgSync: "server" in ~/.total-recall/config.json).
//
// By default (orgSync "hook") the PostToolUse hook pushes org memories. Hosts without
// hooks (Visual Studio, a manual mcp.json) never run it, so an `org` memory stayed local.
// In "server" mode this module does the hook's job: after a successful store/update/delete
// of an `org/` key it starts hooks/scripts/sync-org-memory.sh with the payload the hook would
// have received. That script owns the queue, the lock ([TR-W5]) and sync-org-memory.mjs
// with the privacy filter ([TR-D3]); nothing is duplicated here. The hook script does
// nothing for org keys in this mode, so exactly one of the two pushes ([TR-R4], ADR orgSync).
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from './paths.js';
import { recordError } from './state.js';

export type OrgSyncMode = 'hook' | 'server';

export function orgSyncMode(): OrgSyncMode {
  return loadConfig().orgSync === 'server' ? 'server' : 'hook';
}

const WRITE_TOOLS = new Set(['store_memory', 'update_memory', 'delete_memory']);

type Starter = (script: string, payload: string) => void;

function startHookScript(script: string, payload: string): void {
  const child = spawn('bash', [script], { stdio: ['pipe', 'ignore', 'ignore'], detached: true, env: { ...process.env, ORG_SYNC_FROM_SERVER: '1' } });
  child.on('error', (e) => recordError(`org sync (server mode): could not start ${path.basename(script)}: ${e.message}`));
  child.stdin.on('error', () => { /* the script exited before reading; its own log has the reason */ });
  child.stdin.end(payload);
  child.unref();
}

let starter: Starter = startHookScript;
/** Test seam: replace the process starter. */
export function __testSetStarter(s: Starter | null): void { starter = s ?? startHookScript; }

function hookScript(): string {
  // dist/index.js (bundle) and src/org-sync.ts (tsx) both sit one level under the plugin root.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, '..', 'hooks', 'scripts', 'sync-org-memory.sh');
}

/** Called after a tool returned successfully. Never throws: sync problems must not fail the tool. */
export function afterToolResult(tool: string, args: any, result: any): void {
  try {
    if (!WRITE_TOOLS.has(tool) || orgSyncMode() !== 'server') return;
    const key = String(result?.key ?? args?.key ?? '');
    if (!key.startsWith('org/')) return;
    const script = hookScript();
    if (!fs.existsSync(script)) {
      recordError(`org sync (server mode): ${script} not found; the memory stays local`);
      return;
    }
    const payload = JSON.stringify({
      tool_name: tool,
      tool_input: { key, force: args?.force === true },
      tool_response: { key },
    });
    starter(script, payload);
  } catch (e: any) {
    recordError(`org sync (server mode): ${e?.message ?? e}`);
  }
}
