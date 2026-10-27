// Tolerant reader for the ADL notation used in the "Architecture as Code" course:
// header directives (DESCRIPTION, CATEGORY, NAMESPACE, TYPE, CAPABILITY), DEFINE
// <KIND> <Name> AS <id> nested by indentation, value definitions (DEFINE CAPABILITY
// <Name> AS <text or { block }> FOR <element>, DEFINE CONTRACT <name> BETWEEN {A, B} AS …), DEFINE CONST, DEFINE COMMUNICATION, FOREACH … DO … END
// blocks and ASSERT(…) with an optional trailing `# [ID]` tag. An unknown line is
// kept as text, never fatal. Leaf module: no local imports.

export interface AdlElement {
  kind: string;          // SYSTEM, DOMAIN, COMPONENT, SERVICE, DATABASE, LIBRARY, SAGA, …
  name: string;
  id: string;            // the AS id, or a slug of the name when there is none
  elementId: string;     // `adl:<parent>.<id>` for nested elements, `adl:<id>` at top level
  parent?: string;       // elementId of the enclosing element
  properties?: Record<string, string>; // e.g. COORDINATION / CONSISTENCY of a SAGA
  line: number;
}

export interface AdlAssertion {
  id: string;            // the `# [ID]` tag, or `A-<hash of the text>` when untagged
  tagged: boolean;
  text: string;
  scope?: string;        // enclosing FOREACH headers, outermost first
  comment?: string;      // the `#` comment block right above it
  line: number;
}

export interface AdlCommunication { from: string; to: string; style: string; line: number }

// A DEFINE whose value is text rather than an id: capabilities, contracts, styles, …
export interface AdlDefinition {
  kind: string;
  name: string;
  value: string;
  targets: string[];     // elementIds named by FOR / BETWEEN {…}
  line: number;
}

export interface AdlDocument {
  description?: string;
  category?: string;
  namespace?: string;
  type?: string;
  capability?: string;
  constants: Record<string, string>;
  definitions: AdlDefinition[];
  elements: AdlElement[];
  communications: AdlCommunication[];
  assertions: AdlAssertion[];
  other: { line: number; text: string }[];
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}

// FNV-1a, 32-bit: a stable ID for an untagged assertion, independent of its line.
export function textHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const HEADER_RE = /^(DESCRIPTION|CATEGORY|NAMESPACE|TYPE|CAPABILITY)\s+(.+)$/;
const CONST_RE = /^DEFINE\s+CONST\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/;
const COMM_RE = /^DEFINE\s+COMMUNICATION\s+(.+?)\s+TO\s+(.+?)\s+AS\s+(\S+)\s*$/;
const DEFINE_RE = /^DEFINE\s+([A-Z][A-Z_-]*)\s+(.+?)(?:\s+AS(?:\s+(\S+))?)?\s*$/;
const ASSERT_RE = /^ASSERT\s*\((.*)\)\s*(?:#\s*(.*))?$/;
const TAG_RE = /\[([A-Za-z][A-Za-z0-9_.-]*)\]/;
// DEFINE kinds that are properties of the enclosing block, not elements.
const PROPERTY_KINDS = new Set(['COORDINATION', 'CONSISTENCY']);
// DEFINE kinds whose AS part is a value, never an element id.
const VALUE_KINDS = new Set(['CAPABILITY', 'CONTRACT', 'CONTRACTS', 'STYLE', 'PROTOCOLS', 'API', 'MAIN']);
const VALUE_RE = /^DEFINE\s+([A-Z][A-Z_-]*)\s+(.+?)(?:\s+BETWEEN\s+\{([^}]*)\})?\s+AS\s+(.+)$/;
const ID_RE = /^[A-Za-z0-9._-]+$/;

export function parseAdl(text: string): AdlDocument {
  const doc: AdlDocument = { constants: {}, definitions: [], elements: [], communications: [], assertions: [], other: [] };
  const pendingTargets: { def: AdlDefinition; names: string[] }[] = [];
  // The definition the previous statement opened: indented continuation lines
  // (`including {…}`) and `ASSIGN <KIND> <ref>` lines belong to it.
  let lastDef: AdlDefinition | null = null;
  // Likewise the element the previous statement defined (`DEFINE PERSON … / ASSIGN ROLE …`).
  let lastEl: AdlElement | null = null;
  // Open DEFINE blocks: indentation and elementId. A line closes every block
  // indented at or deeper than itself.
  const stack: { indent: number; elementId: string }[] = [];
  const loops: string[] = [];
  let comment: string[] = [];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const lineNo = i + 1;
    const t = raw.trim();
    if (!t) { comment = []; continue; }
    if (t.startsWith('#')) { comment.push(t.replace(/^#\s?/, '')); continue; }
    const indent = raw.length - raw.trimStart().length;
    const pending = comment;
    comment = [];

    const assign = t.match(/^ASSIGN\s+([A-Z]+)\s+(.+)$/);
    if (lastDef && (assign || (indent > 0 && /^[a-z]/.test(t)))) {
      lastDef.value = `${lastDef.value}; ${t}`;
      // ASSIGN DOMAIN TestingNS.Testing → the element named by the last segment.
      if (assign) pendingTargets.push({ def: lastDef, names: [assign[2]!.split('.').pop()!.trim()] });
      continue;
    }
    if (lastEl && assign) {
      const prev = lastEl.properties?.[`ASSIGN ${assign[1]}`];
      lastEl.properties = { ...lastEl.properties, [`ASSIGN ${assign[1]}`]: prev ? `${prev}; ${assign[2]!.trim()}` : assign[2]!.trim() };
      continue;
    }
    lastDef = null;
    lastEl = null;

    let m: RegExpMatchArray | null;
    if ((m = t.match(HEADER_RE))) {
      const key = m[1]!.toLowerCase() as 'description' | 'category' | 'namespace' | 'type' | 'capability';
      doc[key] = m[2]!.trim();
      continue;
    }
    if ((m = t.match(CONST_RE))) { doc.constants[m[1]!] = m[2]!.trim(); continue; }
    if ((m = t.match(COMM_RE))) {
      doc.communications.push({ from: m[1]!.trim(), to: m[2]!.trim(), style: m[3]!, line: lineNo });
      continue;
    }
    if (/^FOREACH\b.*\bDO$/.test(t)) { loops.push(t.replace(/\s+DO$/, '')); continue; }
    if (t === 'END') { loops.pop(); continue; }
    if ((m = t.match(ASSERT_RE))) {
      const body = m[1]!.trim();
      const tag = m[2] ? m[2].match(TAG_RE) : null;
      const a: AdlAssertion = {
        id: tag ? tag[1]! : `A-${textHash(body)}`,
        tagged: !!tag,
        text: body,
        line: lineNo,
      };
      if (loops.length) a.scope = loops.join(' / ');
      if (pending.length) a.comment = pending.join(' ');
      doc.assertions.push(a);
      continue;
    }
    const v = t.match(VALUE_RE);
    if (v && !PROPERTY_KINDS.has(v[1]!) && (VALUE_KINDS.has(v[1]!) || /\s|^\{/.test(v[4]!.trim()))) {
      let value = v[4]!.trim();
      // `AS {` opens a block that runs to the line holding the closing brace.
      if (value.startsWith('{') && !value.includes('}')) {
        const body = [value.slice(1)];
        while (i + 1 < lines.length) {
          const next = lines[++i]!.trim();
          body.push(next);
          if (next.includes('}')) break;
        }
        value = body.join(' ');
      }
      value = value.replace(/^\{|\}\s*$/g, '').replace(/\s+/g, ' ').trim();
      const names: string[] = v[3] ? v[3].split(',').map((s) => s.trim()).filter(Boolean) : [];
      const forM = value.match(/^(.*?)\s+FOR\s+(.+)$/);
      if (forM) { value = forM[1]!; names.push(forM[2]!.trim()); }
      const def: AdlDefinition = { kind: v[1]!, name: v[2]!.trim(), value, targets: [], line: lineNo };
      doc.definitions.push(def);
      if (names.length) pendingTargets.push({ def, names });
      lastDef = def;
      continue;
    }
    if ((m = t.match(DEFINE_RE)) && PROPERTY_KINDS.has(m[1]!)) {
      while (stack.length && stack[stack.length - 1]!.indent >= indent) stack.pop();
      const owner = doc.elements.find((e) => e.elementId === stack[stack.length - 1]?.elementId);
      if (owner) {
        owner.properties = { ...owner.properties, [m[1]!]: m[2]!.trim() };
        continue;
      }
    }
    if ((m = t.match(DEFINE_RE)) && !PROPERTY_KINDS.has(m[1]!)) {
      while (stack.length && stack[stack.length - 1]!.indent >= indent) stack.pop();
      const name = m[2]!.trim();
      const id = m[3] && ID_RE.test(m[3]) ? m[3] : slug(m[3] ?? name);
      const parent = stack[stack.length - 1]?.elementId;
      // Systems are the namespace, not part of the path: `adl:<domain>.<component>`.
      const kind = m[1]!;
      const parentPath = parent && !doc.elements.find((e) => e.elementId === parent && e.kind === 'SYSTEM')
        ? parent.slice('adl:'.length) + '.'
        : '';
      const el: AdlElement = { kind, name, id, elementId: `adl:${parentPath}${id}`, line: lineNo };
      if (parent) el.parent = parent;
      doc.elements.push(el);
      stack.push({ indent, elementId: el.elementId });
      lastEl = el;
      continue;
    }
    doc.other.push({ line: lineNo, text: t });
  }
  // FOR / BETWEEN name elements by display name (or id); resolve once all are known.
  for (const { def, names } of pendingTargets) {
    for (const n of names) {
      const el = doc.elements.find((e) => e.name.toLowerCase() === n.toLowerCase() || e.id === n);
      if (el && !def.targets.includes(el.elementId)) def.targets.push(el.elementId);
    }
  }
  return doc;
}

// Elements an assertion is about: those whose name or id appears in its text
// (whole words, case-insensitive). FOREACH-scoped assertions apply to every
// element of the iterated kind as well.
export function assertionTargets(a: AdlAssertion, elements: AdlElement[]): string[] {
  const text = a.text.toLowerCase();
  const out = new Set<string>();
  for (const e of elements) {
    if (e.kind === 'SYSTEM') continue;
    const words = [e.name.toLowerCase(), e.id.toLowerCase()];
    if (words.some((w) => w.length > 2 && new RegExp(`(^|[^a-z0-9-])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9-]|$)`).test(text))) {
      out.add(e.elementId);
    }
  }
  if (a.scope) {
    const kinds = [...a.scope.matchAll(/FOREACH\s+([A-Z]+)/g)].map((m) => m[1]!);
    for (const e of elements) if (kinds.includes(e.kind)) out.add(e.elementId);
  }
  return [...out];
}
