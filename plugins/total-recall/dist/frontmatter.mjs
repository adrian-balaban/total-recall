// src/frontmatter.ts
var FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function parseFrontmatter(raw) {
  const match = raw.match(FM_RE);
  if (!match) return { data: {}, content: raw };
  const data = parseYamlish(match[1]);
  const content = raw.slice(match.index + match[0].length);
  return { data, content };
}
function stringifyFrontmatter(content, data) {
  const lines = [];
  for (const [k, v] of Object.entries(data)) {
    if (v === void 0 || v === null) continue;
    lines.push(`${k}: ${serializeValue(v)}`);
  }
  return `---
${lines.join("\n")}
---
${content}`;
}
function withExecutiveSummary(content) {
  return content.trimStart().startsWith("## Executive Summary") ? `
${content.trimStart()}` : `
## Executive Summary

${content}`;
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
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    if (val === "") {
      data[key] = [];
      continue;
    }
    if (val.startsWith("[") && val.endsWith("]")) {
      data[key] = parseInlineArray(val.slice(1, -1));
      continue;
    }
    data[key] = coerceScalar(val);
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
function serializeValue(v) {
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    return `[${v.map(serializeArrayItem).join(", ")}]`;
  }
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return serializeString(String(v));
}
function serializeArrayItem(s) {
  if (typeof s === "number") return String(s);
  if (typeof s === "boolean") return s ? "true" : "false";
  const str = String(s);
  if (/[\r\n]/.test(str)) throw new Error("Frontmatter array item contains a newline \u2014 refusing to emit.");
  return needsQuotes(str) ? `'${str.replace(/'/g, "''")}'` : str;
}
function serializeString(s) {
  if (/[\r\n]/.test(s)) throw new Error("Frontmatter value contains a newline \u2014 refusing to emit.");
  return needsQuotes(s) ? `'${s.replace(/'/g, "''")}'` : s;
}
function needsQuotes(s) {
  if (s === "") return true;
  if (/^\s|\s$/.test(s)) return true;
  if (/^[!&*?|>%@`"'#,[\]{}-]/.test(s)) return true;
  if (/:/.test(s)) return true;
  if (/,/.test(s)) return true;
  if (/#/.test(s)) return true;
  if (/^(true|false|null|~|yes|no)$/i.test(s)) return true;
  if (/^-?\d+(\.\d+)?$/.test(s)) return true;
  return false;
}
export {
  parseFrontmatter,
  stringifyFrontmatter,
  withExecutiveSummary
};
