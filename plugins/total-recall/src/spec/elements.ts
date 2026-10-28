// Element-ID matching shared by the recall filter, get_related_memories and the
// architecture tools. Leaf module.
//
// IDs are `adl:<domain>.<component>`, `assert:<ID>` or a requirement
// ID such as `REQ-7`. A bare assertion ID matches its `assert:` form, and a filter
// on a parent (`adl:testing`) matches its children (`adl:testing.answercapture`).

export function normalizeElementId(id: string): string {
  const t = id.trim();
  return /^[A-Za-z]+:/.test(t) ? t : `assert:${t}`;
}

export function elementMatches(have: string, want: string): boolean {
  const h = normalizeElementId(have);
  const w = normalizeElementId(want);
  return h === w || h.startsWith(`${w}.`) || h.startsWith(`${w}/`);
}

// True when the memory carries at least one of the wanted elements (or a child of one).
// Requirement IDs are matched against the memory's `requirements` as well.
export function memoryMatches(meta: { elements?: string[]; requirements?: string[] } | undefined, wanted: string[]): boolean {
  if (!meta) return false;
  const els = meta.elements ?? [];
  const reqs = meta.requirements ?? [];
  return wanted.some((w) => els.some((e) => elementMatches(e, w)) || reqs.includes(w.trim()));
}

// Coerce an `elements` argument (array or single string) to a clean list.
export function elementsArg(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
  return arr.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim());
}

// Number of element IDs two memories share (after normalisation).
export function sharedElements(a: string[] | undefined, b: string[] | undefined): { shared: number; union: number } {
  const sa = new Set((a ?? []).map(normalizeElementId));
  const sb = new Set((b ?? []).map(normalizeElementId));
  let shared = 0;
  for (const x of sa) if (sb.has(x)) shared++;
  return { shared, union: sa.size + sb.size - shared };
}
