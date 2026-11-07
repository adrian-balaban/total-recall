// src/hooks/build-index-cache.ts
import * as fs5 from "fs";
import * as path5 from "path";

// src/paths.ts
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
var HOME = process.env.HOME || os.homedir();
var TOTAL_RECALL_DIR = path.join(HOME, ".total-recall");
var CONFIG_PATH = path.join(TOTAL_RECALL_DIR, "config.json");
var cachedConfig = null;
var cachedMtime = -1;
function loadConfig() {
  let mtime;
  try {
    mtime = fs.statSync(CONFIG_PATH).mtimeMs;
  } catch {
    cachedConfig = null;
    cachedMtime = -1;
    return {};
  }
  if (cachedConfig !== null && mtime === cachedMtime) return cachedConfig;
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    cachedConfig = parsed;
    cachedMtime = mtime;
    return parsed;
  } catch {
    cachedConfig = null;
    cachedMtime = -1;
    return {};
  }
}
var config = loadConfig();
var PERSONAL_VAULT = config.personalVault ? path.resolve(config.personalVault.replace(/^~(?=\/|$)/, HOME)) : path.join(TOTAL_RECALL_DIR, "personal-vault");
var ORG_VAULT = config.orgVault ? path.resolve(config.orgVault.replace(/^~(?=\/|$)/, HOME)) : path.join(TOTAL_RECALL_DIR, "org", "org-vault");
var VECTORS_DB = path.join(PERSONAL_VAULT, "vectors.db");
var INDEX_PATH = path.join(TOTAL_RECALL_DIR, "index.json");
var INVERTED_INDEX_PATH = path.join(TOTAL_RECALL_DIR, "invertedIndex.json");
var INDEX_CACHE_PATH = path.join(TOTAL_RECALL_DIR, ".index-cache.txt");
var RECONCILE_REQUEST_FLAG = path.join(TOTAL_RECALL_DIR, ".reconcile-requested");
var EXCLUDED_DIRS = /* @__PURE__ */ new Set([
  "projects",
  "templates",
  ".obsidian",
  "reference-docs",
  "in-progress",
  "completed",
  // Graphiti "supersede, don't overwrite" archive (Tech Radar vol.34 #45): on a
  // store_memory(force=true) overwrite, the prior body is archived here. The
  // archive is a provenance sidecar — never re-indexed — so the superseded fact
  // stays recoverable ("what did I believe and when") without polluting search.
  ".superseded"
]);
var REDACT_PAIRS = [];
for (const p of [PERSONAL_VAULT, ORG_VAULT, HOME]) {
  if (p) REDACT_PAIRS.push([p, p === HOME ? "~" : `<${path.basename(p)}>`]);
}
var NO_PRUNE_TAG = "no-prune";

// src/index-cache.ts
import * as fs4 from "fs";
import * as path4 from "path";

// src/frontmatter.ts
var FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function trimTrailingComment(s) {
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === "\\" && s[i + 1] === '"' && quote === '"') {
        i++;
        continue;
      }
      if (ch === quote) {
        if (quote === "'" && s[i + 1] === "'") {
          i++;
          continue;
        }
        quote = null;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "#") {
      return s.slice(0, i).trimEnd();
    }
  }
  return s.trimEnd();
}
function parseFrontmatter(raw) {
  const bomless = raw.charCodeAt(0) === 65279 ? raw.slice(1) : raw;
  const match = bomless.match(FM_RE);
  if (!match) return { data: {}, content: bomless };
  const data = parseYamlish(match[1]);
  const content = bomless.slice(match.index + match[0].length);
  return { data, content };
}
function unquote(s) {
  const t = s.trim();
  if (t.startsWith("'") && t.endsWith("'") || t.startsWith('"') && t.endsWith('"')) {
    const inner = t.slice(1, -1);
    return t.startsWith("'") ? inner.replace(/''/g, "'") : inner.replace(/\\"/g, '"');
  }
  return t;
}
function coerceScalar(s) {
  const t = s.trim();
  if (t === "") return "";
  if (t.startsWith("'") && t.endsWith("'") || t.startsWith('"') && t.endsWith('"')) {
    return unquote(t);
  }
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t === "true" || t === "True" || t === "TRUE") return true;
  if (t === "false" || t === "False" || t === "FALSE") return false;
  if (t === "null" || t === "~") return null;
  return t;
}
function parseInlineArray(s) {
  const out = [];
  let cur = "";
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = null;
      cur += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      cur += ch;
    } else if (ch === ",") {
      const v = unquote(cur);
      if (v !== "") out.push(v);
      cur = "";
    } else {
      cur += ch;
    }
  }
  const last = unquote(cur);
  if (last !== "") out.push(last);
  return out;
}
function parseYamlish(body) {
  const data = {};
  const lines = body.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    i++;
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    const blockItem = line.match(/^\s+-\s+(.+)$/);
    if (blockItem) {
      let lastArrayKey = null;
      for (const [k, v] of Object.entries(data)) if (Array.isArray(v)) lastArrayKey = k;
      if (lastArrayKey) {
        data[lastArrayKey].push(unquote(blockItem[1]));
        continue;
      }
      continue;
    }
    const kv = line.match(/^([^:\s]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const val = kv[2] ?? "";
    const cleanVal = trimTrailingComment(val);
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    if (cleanVal === "") {
      data[key] = [];
      continue;
    }
    if (cleanVal.startsWith("[") && cleanVal.endsWith("]")) {
      data[key] = parseInlineArray(cleanVal.slice(1, -1));
      continue;
    }
    data[key] = coerceScalar(cleanVal);
  }
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v) && v.length === 0 && !hadBlockItems(body, k)) {
      if (!new RegExp(`^${escapeRegExp(k)}:\\s*\\[\\s*\\]\\s*$`, "m").test(body)) delete data[k];
    }
  }
  return data;
}
function hadBlockItems(body, key) {
  const re = new RegExp(`^${escapeRegExp(key)}:\\s*\\n(\\s+-\\s+.+\\n)+`, "m");
  return re.test(body);
}

// src/atomic-write.ts
import * as fs2 from "fs";
import * as path2 from "path";
import * as crypto from "crypto";
function fsyncDir(dir) {
  try {
    const fd = fs2.openSync(dir, "r");
    try {
      fs2.fsyncSync(fd);
    } finally {
      fs2.closeSync(fd);
    }
  } catch {
  }
}
function atomicWrite(p, data, onError = () => {
}) {
  fs2.mkdirSync(path2.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${crypto.randomBytes(6).toString("hex")}`;
  try {
    fs2.writeFileSync(tmp, data);
  } catch (e) {
    onError(`atomicWrite(${p}) tmp-write failed (last-good left intact): ${e.message}`);
    return;
  }
  try {
    const fd = fs2.openSync(tmp, "r");
    try {
      fs2.fsyncSync(fd);
    } finally {
      fs2.closeSync(fd);
    }
  } catch {
  }
  try {
    fs2.renameSync(tmp, p);
  } catch (renErr) {
    try {
      fs2.writeFileSync(p, data);
    } catch (e) {
      onError(`atomicWrite(${p}) rename-fallback: rename=${renErr.message}; write=${e.message}`);
    }
    try {
      fs2.unlinkSync(tmp);
    } catch {
    }
    return;
  }
  fsyncDir(path2.dirname(p));
}

// src/vault-walk.ts
import * as fs3 from "fs";
import * as path3 from "path";
var RESERVED_KEY_SEGMENTS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
function isReservedKey(key) {
  if (typeof key !== "string" || !key) return true;
  const isOrg = key.startsWith("org/");
  const rel = isOrg ? key.slice("org/".length) : key;
  if (!rel) return true;
  return rel.split("/").some((s) => RESERVED_KEY_SEGMENTS.has(s));
}
function keyUnder(base, filePath, isOrg) {
  const rel = path3.relative(base, filePath).split(path3.sep).join("/").replace(/\.md$/, "");
  return isOrg ? `org/${rel}` : rel;
}
function categoryUnder(base, filePath) {
  const parts = path3.relative(base, filePath).split(path3.sep);
  return parts.length > 1 ? parts[0] ?? "knowledge" : "knowledge";
}
function descends(name, isOrg) {
  if (EXCLUDED_DIRS.has(name.toLowerCase())) return false;
  return isOrg || name !== "org";
}
function listVaultFiles(base, isOrg, onError = () => {
}) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs3.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      if (e && e.code !== "ENOENT") {
        onError(`reconcile readdirSync(${dir}): ${e.message}`);
      }
      return;
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const fp = path3.join(dir, e.name);
      if (e.isDirectory()) {
        if (descends(e.name, isOrg)) walk(fp);
      } else if (e.name.endsWith(".md")) {
        out.push(fp);
      }
    }
  };
  walk(base);
  return out;
}

// src/index-cache.ts
var DEFAULT_MAX_ENTRIES = 300;
function maxIndexEntries() {
  const v = loadConfig().indexMaxEntries;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : DEFAULT_MAX_ENTRIES;
}
function keepTop(entries, max) {
  const rank = (e) => [e.tags.includes(NO_PRUNE_TAG) ? 1 : 0, e.importance ?? 0.5, e.updated ?? ""];
  const kept = [...entries].sort((a, b) => {
    const [pa, ia, ua] = rank(a), [pb, ib, ub] = rank(b);
    return pb - pa || ib - ia || (ua < ub ? 1 : ua > ub ? -1 : 0) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  }).slice(0, max);
  return kept.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}
function renderIndexCache(entries, max = maxIndexEntries()) {
  const total = entries.length;
  const listed = max > 0 && total > max ? keepTop(entries, max) : entries;
  const lines = [`${total}`];
  for (const m of listed) {
    const tags = m.tags.slice(0, 3).join(", ") + (m.tags.length > 3 ? ", ..." : "");
    lines.push(`- ${m.key}: ${m.title.slice(0, 40)} [${tags}] (${m.category})`);
  }
  if (listed.length < total) {
    lines.push(`(${total - listed.length} more memories are not listed here: use search_index or recall_memory to find them)`);
  }
  return lines.join("\n");
}
function rankFields(data) {
  const out = {};
  const imp = data.importanceScore;
  if (imp !== void 0 && Number.isFinite(Number(imp))) out.importance = Number(imp);
  if (data.updated !== void 0) out.updated = String(data.updated);
  return out;
}
function readCacheEntries(base, isOrg, onError = () => {
}) {
  const out = [];
  for (const fp of listVaultFiles(base, isOrg, onError)) {
    const key = keyUnder(base, fp, isOrg);
    if (isReservedKey(key)) continue;
    try {
      if (fs4.lstatSync(fp).isSymbolicLink()) continue;
      const { data } = parseFrontmatter(fs4.readFileSync(fp, "utf8"));
      out.push({
        key,
        title: String(data.title ?? path4.basename(fp, ".md")),
        tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
        category: categoryUnder(base, fp),
        ...rankFields(data)
      });
    } catch (e) {
      onError(`index-cache read ${fp}: ${e.message}`);
    }
  }
  return out.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}
function buildIndexCache(personalVault, orgVault, cachePath = INDEX_CACHE_PATH) {
  const errors = [];
  const onError = (m) => {
    errors.push(m);
  };
  const entries = [
    ...readCacheEntries(personalVault, false, onError),
    ...readCacheEntries(orgVault, true, onError)
  ];
  atomicWrite(cachePath, renderIndexCache(entries) + "\n", onError);
  return { count: entries.length, errors };
}

// src/hooks/build-index-cache.ts
var VERSION = true ? "1.8.1" : "dev";
var LOG_PATH = path5.join(TOTAL_RECALL_DIR, ".index-cache.log");
var LOG_MAX_LINES = 1e3;
function logFailure(message) {
  const line = `${(/* @__PURE__ */ new Date()).toISOString()} v${VERSION} index-cache error ${message.replace(/\s+/g, " ")}`;
  let prior = [];
  try {
    prior = fs5.readFileSync(LOG_PATH, "utf8").split("\n").filter(Boolean);
  } catch {
  }
  atomicWrite(LOG_PATH, [...prior, line].slice(-LOG_MAX_LINES).join("\n") + "\n");
}
try {
  const { errors } = buildIndexCache(PERSONAL_VAULT, ORG_VAULT, INDEX_CACHE_PATH);
  if (errors.length > 0) {
    logFailure(errors.join(" | "));
    process.exitCode = 1;
  }
} catch (e) {
  logFailure(e.message);
  process.exitCode = 1;
}
