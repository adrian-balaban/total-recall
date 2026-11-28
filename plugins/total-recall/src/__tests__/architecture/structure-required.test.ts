import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { COMPONENT_FILES } from './components.js';

// Positive (required) dependency rules of structure.adl (P8 of the follow-ups plan).
// dependency-existence checks: at least the named files depend on the registry — NOT
// "every file must depend on it" (checklist §9.5). Implemented by reading import
// specifiers, so the form matches the intent without ArchUnitTS's every-file semantics.

const ROOT = path.resolve(__dirname, '..', '..', '..'); // plugins/total-recall
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8');

function importSpecifiers(src: string): string[] {
  return [...src.matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]!);
}

function dependsOnRegistry(src: string): boolean {
  return importSpecifiers(src).some((s) => /(?:^|\/)registry(?:\.js)?$/.test(s));
}

// The files of one ADL component, from the single-source COMPONENT_FILES map.
function componentFiles(name: string): string[] {
  const re = COMPONENT_FILES[name];
  if (!re) throw new Error(`unknown component: ${name}`);
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== '__tests__') walk(p); continue; }
      const rel = path.relative(ROOT, p).split(path.sep).join('/');
      if (rel.endsWith('.ts') && !rel.endsWith('.d.ts') && re.test(rel)) out.push(rel);
    }
  };
  walk(path.join(ROOT, 'src'));
  return out;
}

describe('structure.adl required dependencies', () => {
  const CORE_TOOLS = ['store', 'mutate', 'query', 'recall', 'rerank'];

  it('[TR-S16] each of the five core tools depends on the registry', () => {
    const missing = CORE_TOOLS.filter((t) => !dependsOnRegistry(read(path.join('src', 'tools', `${t}.ts`))));
    expect(missing).toEqual([]);
  });

  it('[TR-S17] at least one server file depends on the registry', () => {
    const files = componentFiles('server');
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => dependsOnRegistry(read(f)))).toBe(true);
  });

  // Known-fail case: a tool whose registry import was removed fails the rule.
  it('detects a tool file whose registry import was removed (known-fail)', () => {
    const without = "import { wrapHandler } from './other.js';\nexport function register() {}";
    expect(dependsOnRegistry(without)).toBe(false);
    const withRegistry = "import { wrapHandler } from './registry.js';\nexport function register() {}";
    expect(dependsOnRegistry(withRegistry)).toBe(true);
  });
});