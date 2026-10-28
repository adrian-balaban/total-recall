// The `specDriven` block of ~/.total-recall/config.json, with its defaults.
// Leaf module (no local imports): it is also bundled standalone as
// dist/spec-config.mjs so the hook scripts read the same defaults as the server.
// Every key is optional; a missing or wrongly typed value falls back to the
// default, so a typo in config.json never breaks the server or a hook.

export const SPEC_TOOL_NAMES = [
  'index_architecture',
  'get_architecture_context',
  'trace',
  'get_architecture_history',
  'validate_architecture',
] as const;
export type SpecToolName = (typeof SPEC_TOOL_NAMES)[number];

export interface SpecConfig {
  enabled: boolean;
  tools: SpecToolName[];
  categories: string[];
  adlExtensions: string[];
  excludeDirs: string[];
  sessionSummary: boolean;
  sessionSummaryMaxChars: number;
  captureChanges: boolean;
  extractDecisions: boolean;
  guardrails: boolean;
  orgBlockedTerms: string[];
}

export const SPEC_DEFAULTS: SpecConfig = {
  enabled: true,
  tools: [...SPEC_TOOL_NAMES],
  categories: ['specs', 'architecture-changes'],
  adlExtensions: ['.adl'],
  excludeDirs: ['node_modules', '.git', 'dist', 'build', 'coverage'],
  sessionSummary: true,
  sessionSummaryMaxChars: 1500,
  captureChanges: true,
  extractDecisions: true,
  guardrails: true,
  orgBlockedTerms: [],
};

// A category becomes a directory name, so it is held to the same shape as a slug.
const CATEGORY_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function bool(v: unknown, d: boolean): boolean {
  return typeof v === 'boolean' ? v : d;
}

function strings(v: unknown, d: string[], ok: (s: string) => boolean = (s) => s.length > 0): string[] {
  if (!Array.isArray(v)) return d;
  return [...new Set(v.filter((s): s is string => typeof s === 'string' && ok(s)))];
}

function int(v: unknown, d: number, min: number, max: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : d;
}

export function parseSpecConfig(raw: unknown): SpecConfig {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const enabled = bool(r.enabled, SPEC_DEFAULTS.enabled);
  const cfg: SpecConfig = {
    enabled,
    tools: strings(r.tools, SPEC_DEFAULTS.tools, (s) => (SPEC_TOOL_NAMES as readonly string[]).includes(s)) as SpecToolName[],
    categories: strings(r.categories, SPEC_DEFAULTS.categories, (s) => CATEGORY_RE.test(s)),
    adlExtensions: strings(r.adlExtensions, SPEC_DEFAULTS.adlExtensions, (s) => s.startsWith('.')),
    excludeDirs: strings(r.excludeDirs, SPEC_DEFAULTS.excludeDirs, (s) => !s.includes('/')),
    sessionSummary: bool(r.sessionSummary, SPEC_DEFAULTS.sessionSummary),
    sessionSummaryMaxChars: int(r.sessionSummaryMaxChars, SPEC_DEFAULTS.sessionSummaryMaxChars, 100, 20000),
    captureChanges: bool(r.captureChanges, SPEC_DEFAULTS.captureChanges),
    extractDecisions: bool(r.extractDecisions, SPEC_DEFAULTS.extractDecisions),
    guardrails: bool(r.guardrails, SPEC_DEFAULTS.guardrails),
    orgBlockedTerms: strings(r.orgBlockedTerms, SPEC_DEFAULTS.orgBlockedTerms, (s) => s.trim().length >= 2).map((s) => s.trim()),
  };
  // The master switch: off means every feature is off, whatever the other keys say.
  if (!enabled) {
    return { ...cfg, tools: [], categories: [], sessionSummary: false, captureChanges: false, extractDecisions: false, guardrails: false };
  }
  return cfg;
}

// True when `name` is an ADL file under this config.
export function isArchitectureFile(name: string, cfg: SpecConfig): 'adl' | null {
  if (cfg.adlExtensions.some((e) => name.endsWith(e))) return 'adl';
  return null;
}
