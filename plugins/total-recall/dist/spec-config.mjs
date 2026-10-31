// src/spec/config.ts
var SPEC_TOOL_NAMES = [
  "index_architecture",
  "get_architecture_context",
  "trace",
  "get_architecture_history",
  "validate_architecture"
];
var SPEC_DEFAULTS = {
  enabled: true,
  tools: [...SPEC_TOOL_NAMES],
  categories: ["specs", "architecture-changes"],
  adlExtensions: [".adl"],
  excludeDirs: ["node_modules", ".git", "dist", "build", "coverage"],
  sessionSummary: true,
  sessionSummaryMaxChars: 1500,
  captureChanges: true,
  extractDecisions: true,
  guardrails: true,
  orgBlockedTerms: []
};
var CATEGORY_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
function bool(v, d) {
  return typeof v === "boolean" ? v : d;
}
function strings(v, d, ok = (s) => s.length > 0) {
  if (!Array.isArray(v)) return d;
  return [...new Set(v.filter((s) => typeof s === "string" && ok(s)))];
}
function int(v, d, min, max) {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : d;
}
function parseSpecConfig(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const enabled = bool(r.enabled, SPEC_DEFAULTS.enabled);
  const cfg = {
    enabled,
    tools: strings(r.tools, SPEC_DEFAULTS.tools, (s) => SPEC_TOOL_NAMES.includes(s)),
    categories: strings(r.categories, SPEC_DEFAULTS.categories, (s) => CATEGORY_RE.test(s)),
    adlExtensions: strings(r.adlExtensions, SPEC_DEFAULTS.adlExtensions, (s) => s.startsWith(".")),
    excludeDirs: strings(r.excludeDirs, SPEC_DEFAULTS.excludeDirs, (s) => !s.includes("/")),
    sessionSummary: bool(r.sessionSummary, SPEC_DEFAULTS.sessionSummary),
    sessionSummaryMaxChars: int(r.sessionSummaryMaxChars, SPEC_DEFAULTS.sessionSummaryMaxChars, 100, 2e4),
    captureChanges: bool(r.captureChanges, SPEC_DEFAULTS.captureChanges),
    extractDecisions: bool(r.extractDecisions, SPEC_DEFAULTS.extractDecisions),
    guardrails: bool(r.guardrails, SPEC_DEFAULTS.guardrails),
    orgBlockedTerms: strings(r.orgBlockedTerms, SPEC_DEFAULTS.orgBlockedTerms, (s) => s.trim().length >= 2).map((s) => s.trim())
  };
  if (!enabled) {
    return { ...cfg, tools: [], categories: [], sessionSummary: false, captureChanges: false, extractDecisions: false, guardrails: false };
  }
  return cfg;
}
function isArchitectureFile(name, cfg) {
  if (cfg.adlExtensions.some((e) => name.endsWith(e))) return "adl";
  return null;
}
export {
  SPEC_DEFAULTS,
  SPEC_TOOL_NAMES,
  isArchitectureFile,
  parseSpecConfig
};
