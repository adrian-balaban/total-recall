import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// [TR-E1] — the residue rule of architecture-style.adl, made load-bearing. A
// residue that lives only in a comment is invisible to the next change (or the
// next agent), which will happily "simplify" it away; the course's answer is to
// write the residue as an ADL assertion. This test enforces the machine-checked
// format documented in architecture-style.adl:
//
//     # S<n> <stressor description>: residue <TR-ID>[, <TR-ID>]*
//
// every stressor names at least one tagged assertion as its residue, and every
// named ID exists. Renumbering or rewording a stressor line must keep the format.

const ADL_DIR = path.resolve(__dirname, '..', '..', '..', 'architecture', 'adl');
const STYLE = path.join(ADL_DIR, 'architecture-style.adl');

// The stressor lines: `# S<n> ...: residue ...`. Requiring the word "residue"
// keeps the incidence-matrix lines (`#   S1 → ...`, no residue segment) and the
// format-documentation line out of the parse.
const STRESSOR_RE = /^#\s*S(\d+)\b(.*)\bresidues?\b\s*:?\s*(.*)$/i;
const TAG_RE = /\[(TR-[A-Z]\d+)\]/g;

// Tagged assertion IDs across all ADL files — ASSERT lines only, mirroring
// adl-coverage.test.ts (an ID mentioned in a comment is not an assertion).
function taggedAssertionIds(): Set<string> {
  const ids = new Set<string>();
  for (const f of fs.readdirSync(ADL_DIR).filter((n) => n.endsWith('.adl'))) {
    for (const line of fs.readFileSync(path.join(ADL_DIR, f), 'utf8').split('\n')) {
      if (!line.startsWith('ASSERT(') && !line.startsWith('    ASSERT(')) continue;
      for (const m of line.matchAll(TAG_RE)) ids.add(m[1]!);
    }
  }
  return ids;
}

describe('stressor residues ([TR-E1])', () => {
  const lines = fs.readFileSync(STYLE, 'utf8').split('\n');
  const stressors = lines
    .map((line, i) => ({ line: i + 1, text: line }))
    .filter(({ text }) => STRESSOR_RE.test(text));

  it('finds the stressor list in architecture-style.adl', () => {
    expect(stressors.length).toBeGreaterThanOrEqual(5);
  });

  it('numbers the stressors contiguously from S1', () => {
    const nums = stressors.map(({ text }) => Number(STRESSOR_RE.exec(text)![1]));
    expect(nums).toEqual(nums.map((_, i) => i + 1));
  });

  it('[TR-E1] every stressor names at least one tagged assertion as its residue', () => {
    const tagged = taggedAssertionIds();
    const problems: string[] = [];
    for (const { line, text } of stressors) {
      const residue = STRESSOR_RE.exec(text)![3]!;
      const ids = [...residue.matchAll(/TR-[A-Z]\d+/g)].map((m) => m[0]);
      if (ids.length === 0) problems.push(`line ${line}: no residue ID (${text.trim().slice(0, 80)})`);
      for (const id of ids) {
        if (!tagged.has(id)) problems.push(`line ${line}: residue ${id} has no tagged ASSERT in architecture/adl/`);
      }
    }
    expect(problems).toEqual([]);
  });
});