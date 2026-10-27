// Optional spec-driven frontmatter fields (SPEC-DRIVEN-PLAN phase 1). Leaf module.
// Every field is optional, so files and exports written before these fields
// existed stay valid. `pickSpecFields` is the single sanitiser used on every path
// a value can come in by: store/update arguments, parsed frontmatter, index.json
// and import archives.

export const ARTIFACT_KINDS = ['spec', 'adl', 'calm', 'adr', 'fitness-result'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
export const SPEC_STATUSES = ['proposed', 'accepted', 'superseded', 'failed', 'resolved'] as const;
export type SpecStatus = (typeof SPEC_STATUSES)[number];

export interface SpecFields {
  system?: string;
  artifact?: ArtifactKind;
  elements?: string[];
  requirements?: string[];
  sourcePath?: string;
  sourceRev?: string;
  status?: SpecStatus;
  supersedes?: string;
}

export const SPEC_FIELD_NAMES = [
  'system', 'artifact', 'elements', 'requirements', 'sourcePath', 'sourceRev', 'status', 'supersedes',
] as const;

// Frontmatter format version. Absent means 1 (everything written before the spec
// fields). A memory that carries any spec field is written with version 2, so a
// later breaking change has a marker to migrate from.
export const FRONTMATTER_SCHEMA_VERSION = 2;

const MAX = 200;
const MAX_ITEMS = 500;
// Single-line, no control characters: these values land in YAML frontmatter.
const SAFE = /^[^\u0000-\u001f\u007f]+$/;
// Element IDs: `adl:<component>`, `assert:<ID>`, `calm:<node>` or a bare ID.
const ELEMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t && t.length <= MAX && SAFE.test(t) ? t : undefined;
}

function list(v: unknown, re: RegExp): string[] | undefined {
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? [v] : undefined;
  if (!arr) return undefined;
  const out = [...new Set(arr.map(str).filter((s): s is string => s !== undefined && re.test(s)))].slice(0, MAX_ITEMS);
  return out.length ? out : undefined;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

// A repo-relative path: no absolute paths, no `..` segments, forward slashes.
function relPath(v: unknown): string | undefined {
  const s = str(v)?.replace(/\\/g, '/');
  if (!s || s.startsWith('/') || /^[A-Za-z]:/.test(s) || s.split('/').includes('..')) return undefined;
  return s;
}

export function pickSpecFields(src: Record<string, unknown> | null | undefined): SpecFields {
  if (!src) return {};
  const out: SpecFields = {};
  const system = str(src.system);
  if (system) out.system = system;
  const artifact = oneOf(src.artifact, ARTIFACT_KINDS);
  if (artifact) out.artifact = artifact;
  const elements = list(src.elements, ELEMENT_RE);
  if (elements) out.elements = elements;
  const requirements = list(src.requirements, ELEMENT_RE);
  if (requirements) out.requirements = requirements;
  const sourcePath = relPath(src.sourcePath);
  if (sourcePath) out.sourcePath = sourcePath;
  const sourceRev = str(src.sourceRev);
  if (sourceRev && /^[0-9a-f]{4,64}$/i.test(sourceRev)) out.sourceRev = sourceRev;
  const status = oneOf(src.status, SPEC_STATUSES);
  if (status) out.status = status;
  const supersedes = str(src.supersedes);
  if (supersedes) out.supersedes = supersedes;
  return out;
}

export function hasSpecFields(f: SpecFields): boolean {
  return Object.keys(f).length > 0;
}

// Replace every spec field on `target` with its sanitised value (or remove it),
// so a raw spread of untrusted data never leaves an unsanitised field behind.
export function applySpecFields<T extends object>(target: T, src: Record<string, unknown> | null | undefined): T {
  const t = target as Record<string, unknown>;
  for (const k of SPEC_FIELD_NAMES) delete t[k];
  Object.assign(t, pickSpecFields(src));
  return target;
}
