import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseAdl } from '../../spec/adl-parse.js';

// Structural checks on architecture/adl/*.adl that the coverage test does not
// make: element IDs are unique per system, and every DEFINE COMMUNICATION names
// elements that are defined (this replaces the cross-checks of the former CALM
// document; there is no ADL schema validator, the tests keep the notation honest).

const ADL_DIR = path.resolve(__dirname, '..', '..', '..', 'architecture', 'adl');
const docs = fs.readdirSync(ADL_DIR)
  .filter((f) => f.endsWith('.adl'))
  .map((f) => ({ file: f, doc: parseAdl(fs.readFileSync(path.join(ADL_DIR, f), 'utf8')) }));
const elements = docs.flatMap(({ file, doc }) => doc.elements.filter((e) => e.kind !== 'SYSTEM').map((e) => ({ ...e, file })));

describe('ADL consistency', () => {
  it('parses every line of every file', () => {
    expect(docs.flatMap(({ file, doc }) => doc.other.map((o) => `${file}:${o.line} ${o.text}`))).toEqual([]);
  });

  it('an element is defined once per ADL file set, or repeated with the same name and kind', () => {
    const conflicts = elements.filter((e) => elements.some((x) => x.elementId === e.elementId && (x.name !== e.name || x.kind !== e.kind)));
    expect(conflicts.map((e) => `${e.elementId} in ${e.file}`)).toEqual([]);
  });

  it('every DEFINE COMMUNICATION endpoint names a defined element', () => {
    const names = new Set(elements.map((e) => e.name.toLowerCase()));
    const comms = docs.flatMap(({ file, doc }) => doc.communications.map((c) => ({ ...c, file })));
    expect(comms.length).toBeGreaterThan(0);
    const dangling = comms.flatMap((c) => [c.from, c.to].filter((n) => !names.has(n.toLowerCase())).map((n) => `${c.file}:${c.line} ${n}`));
    expect(dangling).toEqual([]);
  });

  it('system.adl defines each landscape element once', () => {
    const sys = docs.find((d) => d.file === 'system.adl')!;
    const ids = sys.doc.elements.filter((e) => e.kind !== 'SYSTEM').map((e) => e.elementId);
    expect(ids.sort()).toEqual(['adl:embedder', 'adl:hooks', 'adl:host-harness', 'adl:mcp-server', 'adl:org-remote'].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });
});
