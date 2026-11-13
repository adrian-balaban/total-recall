// src/spec/fields.ts
var ARTIFACT_KINDS = ["spec", "adl", "adr", "fitness-result"];
var SPEC_STATUSES = ["proposed", "accepted", "superseded", "failed", "resolved"];
var SPEC_FIELD_NAMES = [
  "system",
  "artifact",
  "elements",
  "requirements",
  "sourcePath",
  "sourceRev",
  "status",
  "supersedes"
];
var FRONTMATTER_SCHEMA_VERSION = 2;
var MAX = 200;
var MAX_ITEMS = 500;
var SAFE = /^[^\u0000-\u001f\u007f]+$/;
var ELEMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
function str(v) {
  if (typeof v !== "string") return void 0;
  const t = v.trim();
  return t && t.length <= MAX && SAFE.test(t) ? t : void 0;
}
function list(v, re) {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? [v] : void 0;
  if (!arr) return void 0;
  const out = [...new Set(arr.map(str).filter((s) => s !== void 0 && re.test(s)))].slice(0, MAX_ITEMS);
  return out.length ? out : void 0;
}
function oneOf(v, allowed) {
  return typeof v === "string" && allowed.includes(v) ? v : void 0;
}
function relPath(v) {
  const s = str(v)?.replace(/\\/g, "/");
  if (!s || s.startsWith("/") || /^[A-Za-z]:/.test(s) || s.split("/").includes("..")) return void 0;
  return s;
}
function pickSpecFields(src) {
  if (!src) return {};
  const out = {};
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
function hasSpecFields(f) {
  return Object.keys(f).length > 0;
}
function applySpecFields(target, src) {
  const t = target;
  for (const k of SPEC_FIELD_NAMES) delete t[k];
  Object.assign(t, pickSpecFields(src));
  return target;
}
export {
  ARTIFACT_KINDS,
  FRONTMATTER_SCHEMA_VERSION,
  SPEC_FIELD_NAMES,
  SPEC_STATUSES,
  applySpecFields,
  hasSpecFields,
  pickSpecFields
};
