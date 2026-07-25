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
var SECRET_TOKEN_RE = /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{20,}|sk_live_[A-Za-z0-9]{24,}|rk_live_[A-Za-z0-9]{24,}|(?:AKIA|ASIA)[0-9A-Z]{16}|gh[oprsu]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|glpat-[A-Za-z0-9_-]{20}|xapp-[A-Za-z0-9_-]{36,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b|aws_secret_access_key["'\s:=]+[A-Za-z0-9\/+=]{40}(?![A-Za-z0-9\/+=])/i;
var LABELED_GENERIC_RE = /\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|secret|password|passwd|bearer|auth(?:orization)?)\b\s*["':=]?\s*["']?[A-Za-z0-9_\-+/=]{16,}["']?/i;
var HIGH_ENTROPY_RUN_RE = /[A-Za-z0-9+/_=\-]{40,}/g;
function shannonEntropy(s) {
  if (!s.length) return 0;
  const counts = {};
  for (const ch of s) counts[ch] = (counts[ch] ?? 0) + 1;
  let h = 0;
  for (const n of Object.values(counts)) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}
function findHighEntropySecret(text) {
  HIGH_ENTROPY_RUN_RE.lastIndex = 0;
  let m;
  while ((m = HIGH_ENTROPY_RUN_RE.exec(text)) !== null) {
    const s = m[0];
    if (!/[A-Z]/.test(s) || !/[a-z]/.test(s) || !/[0-9]/.test(s)) continue;
    if (shannonEntropy(s) < 4.3) continue;
    return s;
  }
  return null;
}
var CC_CANDIDATE_RE = /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{1,7}\b/g;
function luhnValid(digits) {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}
function findCreditCard(text) {
  CC_CANDIDATE_RE.lastIndex = 0;
  let m;
  while ((m = CC_CANDIDATE_RE.exec(text)) !== null) {
    const digits = m[0].replace(/[- ]/g, "");
    if (digits.length < 13 || digits.length > 19) continue;
    if (luhnValid(digits)) return m[0];
  }
  return null;
}
var IBAN_CANDIDATE_RE = /\b([A-Z]{2})(\d{2})([A-Z0-9]{10,30})\b/g;
function findIBAN(text) {
  IBAN_CANDIDATE_RE.lastIndex = 0;
  let m;
  while ((m = IBAN_CANDIDATE_RE.exec(text)) !== null) {
    const full = m[0];
    const rearranged = full.slice(4) + full.slice(0, 4);
    let num = "";
    for (const ch of rearranged) {
      if (ch >= "A" && ch <= "Z") num += String(ch.charCodeAt(0) - 55);
      else num += ch;
    }
    let rem = 0;
    for (const ch of num) rem = (rem * 10 + (ch.charCodeAt(0) - 48)) % 97;
    if (rem === 1) return full;
  }
  return null;
}
var PHONE_RE = /(?:\+\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}|\(\d{3}\)\s?\d{3,4}[-.]\d{4})/g;
function findPhoneNumber(text) {
  PHONE_RE.lastIndex = 0;
  return PHONE_RE.exec(text)?.[0] ?? null;
}
function privacyCheck(data, content, allowedDomains = []) {
  const tagText = Array.isArray(data.tags) ? data.tags.join(" ") : String(data.tags ?? "");
  const sessionText = Array.isArray(data.sessions) ? data.sessions.join(" ") : String(data.sessions ?? "");
  const title = String(data.title ?? "");
  const author = String(data.author ?? "");
  const allValues = safeStringify(data);
  const text = `${title} ${author} ${tagText} ${sessionText} ${allValues} ${content}`;
  if (SECRET_TOKEN_RE.test(text)) return "secret token or API key detected";
  if (LABELED_GENERIC_RE.test(text)) return "labeled secret (api_key/token/secret/password) detected";
  if (findHighEntropySecret(text)) return "high-entropy secret-like token detected";
  if (findSuspiciousEmail(text, allowedDomains)) return "suspicious email address detected";
  if (findCreditCard(text)) return "credit card number detected";
  if (findIBAN(text)) return "IBAN detected";
  if (findPhoneNumber(text)) return "phone number detected";
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
  LABELED_GENERIC_RE,
  PHONE_RE,
  SECRET_TOKEN_RE,
  findCreditCard,
  findHighEntropySecret,
  findIBAN,
  findPhoneNumber,
  findSuspiciousEmail,
  isAllowedEmail,
  privacyCheck,
  sanitizeAllowedDomains
};
