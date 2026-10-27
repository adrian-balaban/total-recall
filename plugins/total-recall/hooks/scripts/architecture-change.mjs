#!/usr/bin/env node
// See architecture-change.sh. Reads the hook's stdin JSON and prints the hook
// response: additionalContext for an edited ADL/CALM file, else {"continue":true}.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseSpecConfig, isArchitectureFile } from '../../dist/spec-config.mjs';

export function respond(input, cfg) {
  const none = { continue: true };
  if (!cfg.captureChanges) return none;
  const file = input?.tool_input?.file_path ?? input?.tool_input?.path ?? input?.tool_input?.absolute_path;
  if (typeof file !== 'string' || !isArchitectureFile(path.basename(file), cfg)) return none;
  const dir = path.dirname(file);
  const event = typeof input.hook_event_name === 'string' ? input.hook_event_name : 'PostToolUse';
  const text = [
    `Architecture file changed: ${file}.`,
    `1. Run index_architecture(path="${input.cwd ?? dir}") to refresh the architecture index; it returns the added and removed elements.`,
    '2. Then store_memory with category "architecture-changes": what changed, WHY, and the requirement or decision behind it; set system, elements (the IDs from step 1) and requirements.',
    '3. Run validate_architecture on the same path to check the CALM document and ADL test coverage.',
  ].join('\n');
  return { continue: true, hookSpecificOutput: { hookEventName: event, additionalContext: text } };
}

// Run as a script (not when imported by the tests).
const isMain = (() => { try { return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]); } catch { return false; } })();
if (isMain) {
  let raw = '';
  process.stdin.on('data', (d) => { raw += d; });
  process.stdin.on('end', () => {
    let out = { continue: true };
    try {
      let cfgRaw;
      try { cfgRaw = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.total-recall', 'config.json'), 'utf8')).specDriven; } catch { /* defaults */ }
      out = respond(JSON.parse(raw), parseSpecConfig(cfgRaw));
    } catch { /* malformed input: no-op */ }
    process.stdout.write(JSON.stringify(out));
  });
}
