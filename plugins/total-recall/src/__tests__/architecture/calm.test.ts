import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Cross-checks between the CALM document and the ADL, with no CLI needed
// (schema validation itself runs in CI: `calm validate`, see mutation.yml).

const ROOT = path.resolve(__dirname, '..', '..', '..');
const CALM_DIR = path.join(ROOT, 'architecture', 'calm');
const calm = JSON.parse(fs.readFileSync(path.join(CALM_DIR, 'total-recall.calm.json'), 'utf8'));
const mapping: Record<string, string> = JSON.parse(fs.readFileSync(path.join(CALM_DIR, 'url-mapping.json'), 'utf8'));

const adlText = fs.readdirSync(path.join(ROOT, 'architecture', 'adl'))
  .filter((f) => f.endsWith('.adl'))
  .map((f) => fs.readFileSync(path.join(ROOT, 'architecture', 'adl', f), 'utf8'))
  .join('\n');
const adlIds = new Set([...adlText.matchAll(/\[(TR-[A-Z][0-9]+)\]/g)].map((m) => m[1]));

const nodeIds = new Set<string>(calm.nodes.map((n: { 'unique-id': string }) => n['unique-id']));

const adlRefs: string[] = [];
const requirementUrls: string[] = [];
for (const n of calm.nodes) {
  for (const c of Object.values<{ requirements: { 'requirement-url': string; config: Record<string, string> }[] }>(n.controls ?? {})) {
    for (const r of c.requirements) {
      requirementUrls.push(r['requirement-url']);
      if (r.config['adl-assertion']) adlRefs.push(r.config['adl-assertion']);
    }
  }
}
for (const r of calm.relationships) if (r.metadata?.['adl-assertion']) adlRefs.push(r.metadata['adl-assertion']);

describe('CALM document', () => {
  it('has unique node and relationship IDs', () => {
    const all = [...calm.nodes, ...calm.relationships].map((x: { 'unique-id': string }) => x['unique-id']);
    expect(all.filter((id: string, i: number) => all.indexOf(id) !== i)).toEqual([]);
  });

  it('every relationship connects existing nodes', () => {
    const ends = calm.relationships.flatMap((r: { 'relationship-type': { connects: { source: { node: string }; destination: { node: string } } } }) => {
      const c = r['relationship-type'].connects;
      return [c.source.node, c.destination.node];
    });
    expect(ends.filter((id: string) => !nodeIds.has(id))).toEqual([]);
  });

  it('every adl-assertion it references exists in architecture/adl', () => {
    expect(adlRefs.length).toBeGreaterThan(0);
    expect(adlRefs.filter((id) => !adlIds.has(id))).toEqual([]);
  });

  it('every control requirement URL maps to a local file', () => {
    for (const url of requirementUrls) {
      expect(mapping[url], url).toBeDefined();
      expect(fs.existsSync(path.join(CALM_DIR, mapping[url]!)), mapping[url]).toBe(true);
    }
  });
});
