// src/privacy-filter.ts
function sanitizeAllowedDomains(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(
    (d) => typeof d === "string" && d.length > 0 && d.includes(".") && !d.startsWith(".") && !d.endsWith(".")
  );
}
var EMAIL_RE = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.\u00A0-\uFFFF-]+\.[A-Za-z0-9\u00A0-\uFFFF-]{2,})/g;
function isAllowedEmail(host, allowedDomains) {
  if (!allowedDomains.length) return false;
  const h = host.toLowerCase();
  return allowedDomains.some((d) => {
    const dl = d.toLowerCase();
    return h === dl || h.endsWith("." + dl);
  });
}
function findSuspiciousEmail(text, allowedDomains) {
  EMAIL_RE.lastIndex = 0;
  let m;
  while ((m = EMAIL_RE.exec(text)) !== null) {
    const host = m[1];
    if (!isAllowedEmail(host, allowedDomains)) return m[0];
  }
  return null;
}
var SECRET_TOKEN_RE = /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{20,}|sk_live_[A-Za-z0-9]{24,}|rk_live_[A-Za-z0-9]{24,}|(?:AKIA|ASIA)[0-9A-Z]{16}|gh[opsu]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|glpat-[A-Za-z0-9_-]{20}|xapp-[A-Za-z0-9_-]{36,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b|aws_secret_access_key["'\s:=]+[A-Za-z0-9\/+=]{40}(?![A-Za-z0-9\/+=])/i;
function privacyCheck(data, content, allowedDomains = []) {
  const tagText = Array.isArray(data.tags) ? data.tags.join(" ") : String(data.tags ?? "");
  const sessionText = Array.isArray(data.sessions) ? data.sessions.join(" ") : String(data.sessions ?? "");
  const title = String(data.title ?? "");
  const author = String(data.author ?? "");
  const allValues = safeStringify(data);
  const text = `${title} ${author} ${tagText} ${sessionText} ${allValues} ${content}`;
  if (SECRET_TOKEN_RE.test(text)) return "secret token or API key detected";
  if (findSuspiciousEmail(text, allowedDomains)) return "suspicious email address detected";
  return null;
}
function safeStringify(value) {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}
export {
  EMAIL_RE,
  SECRET_TOKEN_RE,
  findSuspiciousEmail,
  isAllowedEmail,
  privacyCheck,
  sanitizeAllowedDomains
};
