// Org-sync privacy filter — the gate that decides whether a memory may be pushed to
// the shared org vault. Pure functions, no I/O: the org-sync hook script
// (scripts/sync-org-memory.mjs) requires the esbuild bundle dist/privacy-filter.mjs,
// and the unit tests (src/__tests__/sync-org-memory.test.ts) import this source
// directly — the SAME code, eliminating the old "KEEP IN SYNC" replica that drifted.
//
// Threat model: the org vault is a SHARED git repo. A teammate with push access can
// plant content, and any leaked secret or personal email committed there reaches every
// member. The filter runs before `git add` and blocks two categories:
//   1. Secret tokens / API keys — the highest-risk leak in a shared repo.
//   2. Personal email addresses — fail-closed by default; allow your company domain.
// Personal pronouns were intentionally removed: the false-positive rate (pronoun
// titles like "We are migrating…") was high enough to block legitimate org memories.
// Phone numbers, credit cards, and IBANs were ALSO removed initially (any 10-digit
// run such as unix timestamps, AWS account ids, or git SHA fragments tripped a bare
// phone regex). 7.3 (REVIEW 7.5) re-adds them in a VALIDATED, low-FP shape:
//   - Credit cards: 13–19 digit runs are CANDIDATES, but a hit only fires when the
//     digits pass the Luhn checksum. Random digit strings (timestamps, account ids,
//     SHAs) almost never satisfy Luhn (~10% pass rate), so the FP rate is negligible.
//   - IBANs: the `XX\d{2}[\dA-Z]{10,30}` shape plus the ISO 13616 mod-97 check.
//     mod-97 validation rejects arbitrary alphanumeric runs; only a real IBAN passes.
//   - Phone numbers: scoped to FORMATTED shapes only (a leading `+` country code, or
//     `()`/`-`/`.` separators). A bare 10-digit run with no separators is NOT treated
//     as a phone (that's the timestamp/account-id FP the bare regex produced).
// The "this is personal" guard is still the mutual-exclusion of the `personal` and
// `org` tags enforced in the sync script; these detectors are defense-in-depth for
// content that slips in WITHOUT the personal tag.

export interface PrivacyData {
  title?: unknown;
  author?: unknown;
  tags?: unknown;
  // The `sessions` history array (update_memory appends session ids, capped at
  // 50). A session id is a free-form client-supplied string, so a leaked secret
  // or personal email could ride in via `sessions: ['ghp_xxx', 'me@personal.com']`
  // — and the writer persists it into the frontmatter of the org .md file. The
  // filter must scan it the same way it scans tags, or a session id leaks into
  // the shared org repo unscanned. Typed `unknown` (like tags) so the scalar-
  // fallback branch below still covers a hand-edited `sessions: ghp_xxx`.
  sessions?: unknown;
}

// Sanitize the configured email-domain allowlist: drop non-strings, empties, and BARE
// TLDs. A bare-TLD entry like "com" is a misconfiguration footgun: isAllowedEmail treats
// the entry as a domain suffix (h === d || h.endsWith('.' + d)), so "com" would match
// EVERY `*.com` host — silently allowlisting all of .com and gutting the email filter
// for an entire TLD. Require at least one dot and reject leading/trailing dots. Fail-
// closed: a dropped over-permissive entry makes MORE emails block, not fewer. (Bundling
// the PSL to reject public-suffix-only entries like "co.uk" is out of scope; if a user
// sets "co.uk" they mean it.)
export function sanitizeAllowedDomains(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.filter(
    (d): d is string =>
      typeof d === 'string' && d.length > 0 && d.includes('.') && !d.startsWith('.') && !d.endsWith('.')
  );
}

// Match any email-shaped substring, then compare the full host part against the
// allowlist in JS. A single negative-lookahead regex is unsafe here: a host like
// "yourcompany.com.evil.com" passes `@(?!yourcompany\.com)` because the lookahead sees
// "yourcompany.com" as a *prefix* of the host and fails to exclude it — a real bypass.
// Comparing the whole host (=== d || endsWith('.' + d)) closes it and is fail-closed
// when the allowlist is empty (every email is non-allowlisted → blocked).
//
// The host class includes non-ASCII (IDN) chars (` -￿`): an ASCII-only host
// class `[A-Za-z0-9.-]+` never matched `user@münchen.de` / `kunde@exämple.com`, so a
// personal email at an internationalized host sailed past findSuspiciousEmail and the
// filter didn't block it. The range is the BMP above ASCII — covers Latin-with-
// diacritics, Cyrillic, CJK, Arabic (the realistic IDN hosts); excludes ASCII
// punctuation (comma/quotes/brackets stay out, so `user@example.com,` does not drag
// the comma into the host). The local part stays ASCII (personal emails at IDN hosts
// are the realistic leak shape; quoted-unicode locals are not). The host still flows
// through isAllowedEmail, so an allowlisted IDN domain (e.g. `münchen.de`) is honored.
export const EMAIL_RE = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.\u00A0-\uFFFF-]+\.[A-Za-z0-9\u00A0-\uFFFF-]{2,})/g;

export function isAllowedEmail(host: string, allowedDomains: string[]): boolean {
  if (!allowedDomains.length) return false; // fail-closed
  const h = host.toLowerCase();
  return allowedDomains.some((d) => {
    const dl = d.toLowerCase();
    return h === dl || h.endsWith('.' + dl); // allow the bare domain and its subdomains
  });
}

export function findSuspiciousEmail(text: string, allowedDomains: string[]): string | null {
  EMAIL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EMAIL_RE.exec(text)) !== null) {
    // EMAIL_RE always captures group 1 (the host) on a match; assert non-undefined
    // so the rest of the function reads it as a plain string under
    // noUncheckedIndexedAccess.
    const host = m[1]!;
    if (!isAllowedEmail(host, allowedDomains)) return m[0];
  }
  return null;
}

// Common API keys / tokens — leaked credentials are the highest-risk PII for a public
// repo. PEM private-key headers are matched separately (no word boundary). Covers:
// PEM keys, OpenAI sk-, Stripe SECRET live keys (sk_live_/rk_live_ — NOTE: pk_live_ is
// the PUBLISHABLE key, public by design, and so is intentionally NOT matched), AWS
// access-key ids (AKIA + ASIA STS temp creds), GitHub (gh[o/p/s/u]_, github_pat_,
// xapp_), Slack xox, Google AIza, GitLab glpat, JWTs (eyJ…). The `i` flag also catches
// uppercase env-style forms (AWS_SECRET_ACCESS_KEY, etc.) — broadening detection is
// fail-closed for a secret gate. The AWS SECRET ACCESS KEY (the 40-char sensitive half)
// has no fixed prefix, so a bare {40} would false-positive on SHA-1 hashes (40 hex chars
// ⊂ base64 charset) and base64 blobs; instead detect it only when LABELED
// (`aws_secret_access_key = <40 base64 chars>`), which catches pasted ~/.aws/credentials
// snippets with negligible FP. The negative lookahead ensures the 40 chars aren't a
// prefix of a longer base64 run.
export const SECRET_TOKEN_RE = /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{20,}|sk_live_[A-Za-z0-9]{24,}|rk_live_[A-Za-z0-9]{24,}|(?:AKIA|ASIA)[0-9A-Z]{16}|gh[oprsu]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|glpat-[A-Za-z0-9_-]{20}|xapp-[A-Za-z0-9_-]{36,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b|aws_secret_access_key["'\s:=]+[A-Za-z0-9\/+=]{40}(?![A-Za-z0-9\/+=])/i;

// 7.2 (REVIEW 7.4 = GLM 6.1): labeled-generic secret pattern. SECRET_TOKEN_RE only
// matches KNOWN-PREFIX tokens (sk-, ghp_, AKIA…). A secret behind a generic label —
// `api_key: 9f8e7d6c5b4a3210fedcba9876543210`, `Authorization: Bearer ...`,
// `password = "S3cur3-P@ss!"` — sailed past the prefix filter into the shared org
// repo. This pattern gates on a generic secret LABEL (api[_-]?key, token, secret,
// password, passwd, client[_-]?secret, bearer, auth(?:orization)?) followed by a
// separator/assignment and a ≥16-char value run. The label gate keeps the FP rate
// low (the value must follow one of these keywords), and the match is fail-closed.
// Case-insensitive to catch AWS_SECRET_ACCESS_KEY / Api-Key / etc. The value run
// allows the chars a pasted credential realistically contains (alphanumeric + the
// base64 punctuation + the separators a `key=value` line uses).
export const LABELED_GENERIC_RE = /\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|secret|password|passwd|bearer|auth(?:orization)?)\b\s*["':=]?\s*["']?[A-Za-z0-9_\-+/=]{16,}["']?/i;

// 7.2: high-entropy second pass. Some secrets carry NO label and NO known prefix —
// a pasted `export FOO=Zm9vYmFyYmF6Cg==`-style base64 blob, or a custom-service API
// key that's just a 40-char random string in a config file. Scan for long (≥40)
// token-shaped runs (alphanumeric + base64 punctuation, NO spaces) and flag them
// only when they look like an actual secret: ALL THREE character classes present
// (uppercase + lowercase + digit — excludes lowercase-hex git SHAs, lowercase-hex
// UUIDs, and pure-digit account ids/timestamps, none of which have all three) AND
// Shannon entropy ≥ 4.3 bits/char (real secrets are dense; normal prose words and
// even base64-encoded short payloads rarely reach 4.3 over a 40-char window). The
// combination is fail-closed but low-FP: a 40+ char run that is mixed-class AND
// high-entropy is almost certainly an opaque credential, not a memory body. Used
// as a SECOND pass after LABELED_GENERIC_RE so a labeled secret doesn't double-
// count (the labeled hit fires first).
const HIGH_ENTROPY_RUN_RE = /[A-Za-z0-9+/_=\-]{40,}/g;
function shannonEntropy(s: string): number {
  if (!s.length) return 0;
  const counts: Record<string, number> = {};
  for (const ch of s) counts[ch] = (counts[ch] ?? 0) + 1;
  let h = 0;
  for (const n of Object.values(counts)) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}
export function findHighEntropySecret(text: string): string | null {
  HIGH_ENTROPY_RUN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HIGH_ENTROPY_RUN_RE.exec(text)) !== null) {
    const s = m[0]!;
    // Require all three classes (mixed-case base64 secret shape); this is the key
    // FP guard — lowercase-hex SHAs/UUIDs and pure-digit ids are excluded.
    if (!/[A-Z]/.test(s) || !/[a-z]/.test(s) || !/[0-9]/.test(s)) continue;
    if (shannonEntropy(s) < 4.3) continue;
    return s;
  }
  return null;
}

// 7.3 (REVIEW 7.5): credit-card detector with Luhn validation. A 13–19 digit run
// (with optional `-`/space separators between 4-digit groups) is a CANDIDATE; the
// hit only fires when the stripped digits pass the Luhn checksum. Luhn rejects ~90%
// of random digit strings, so unix timestamps (10 digits), AWS account ids (12),
// and git SHA fragments (7–40 hex — but those are hex, not all-digit, so the
// \d{13,19} anchor already excludes them) don't false-trigger. The separator shape
// `\d{4}[- ]?\d{4}…` matches both grouped (`4111-1111-1111-1111`) and ungrouped
// (`4111111111111111`) cards.
const CC_CANDIDATE_RE = /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{1,7}\b/g;
function luhnValid(digits: string): boolean {
  // Standard Luhn: from the rightmost digit, double every second digit (subtract 9
  // if the doubled value exceeds 9), sum, divisible by 10.
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}
export function findCreditCard(text: string): string | null {
  CC_CANDIDATE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CC_CANDIDATE_RE.exec(text)) !== null) {
    const digits = m[0]!.replace(/[- ]/g, '');
    // Re-check the stripped length is in the card range (separators could collapse
    // a 13-char run down to 13 — fine — but guard against a short tail).
    if (digits.length < 13 || digits.length > 19) continue;
    if (luhnValid(digits)) return m[0]!;
  }
  return null;
}

// 7.3: IBAN detector with ISO 13616 mod-97 validation. Shape: 2-letter country code,
// 2 check digits, 10–30 BBAN chars (alphanumeric). The hit only fires when the
// rearranged-mod-97 check passes — arbitrary `XX12…` alphanumeric runs almost never
// satisfy mod-97, so the FP rate is negligible. IBAN lengths are country-specific
// (15 Norway → 34 Iceland); the `\d{2}[A-Z0-9]{10,30}` bounds the total to 14–34.
const IBAN_CANDIDATE_RE = /\b([A-Z]{2})(\d{2})([A-Z0-9]{10,30})\b/g;
export function findIBAN(text: string): string | null {
  IBAN_CANDIDATE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IBAN_CANDIDATE_RE.exec(text)) !== null) {
    const full = m[0]!;
    // ISO 13616: move the first 4 chars (country+check) to the end, then mod-97 the
    // resulting numeric string (A=10, B=11, …, Z=35).
    const rearranged = full.slice(4) + full.slice(0, 4);
    let num = '';
    for (const ch of rearranged) {
      if (ch >= 'A' && ch <= 'Z') num += String(ch.charCodeAt(0) - 55);
      else num += ch;
    }
    // mod-97 on a long decimal string via incremental reduction (Number can't hold
    // a 30+ digit integer; BigInt is fine but the modular walk avoids it).
    let rem = 0;
    for (const ch of num) rem = (rem * 10 + (ch.charCodeAt(0) - 48)) % 97;
    if (rem === 1) return full;
  }
  return null;
}

// 7.3: scoped phone detector — FORMATTED shapes only. A bare 10-digit run (unix
// timestamp, AWS account id, git SHA fragment as digits) is NOT treated as a phone;
// the detector requires either a leading `+` country code or at least one of the
// `()`/`-`/`.` separators that humans use when writing a phone number. The shape:
//   `+<1-3 digits>[- .]?\(?<digits>?[- .]?<digits>…` (international, with +)
//   `(<3 digits>) <3-4 digits>-<4 digits>` (US-style with parens)
// Both require separators, so the bare-digit FP class that killed the original
// phone regex is excluded by construction.
export const PHONE_RE = /(?:\+\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}|\(\d{3}\)\s?\d{3,4}[-.]\d{4})/g;
export function findPhoneNumber(text: string): string | null {
  PHONE_RE.lastIndex = 0;
  return PHONE_RE.exec(text)?.[0] ?? null;
}

// Scan the union of title, author, tags, sessions, and body. Tags and sessions are
// scanned whether they parsed as an array OR as a raw scalar string: the TS writer
// always emits them as arrays, but a teammate-pushed / hand-edited memory may carry
// `tags: ghp_xxx` or `sessions: me@personal.com` as a scalar (parseFrontmatter yields
// a string, not an array), which the array branch alone would leave unscanned —
// letting a scalar secret sail into the shared org repo. sessions is client-supplied
// free-form text (a session id), so it is exactly as untrusted as tags and must not be
// the one field the filter skips. Scanning the raw string form is fail-closed: more
// text scanned, never less. Returns a human-readable block reason, or null if the
// memory is safe to sync.
export function privacyCheck(
  data: PrivacyData,
  content: string,
  allowedDomains: string[] = []
): string | null {
  const tagText = Array.isArray(data.tags) ? data.tags.join(' ') : String(data.tags ?? '');
  const sessionText = Array.isArray(data.sessions) ? data.sessions.join(' ') : String(data.sessions ?? '');
  const title = String(data.title ?? '');
  const author = String(data.author ?? '');
  // Scan the WHOLE parsed frontmatter object, not just the named fields above. The
  // named fields (title/author/tags/sessions) cover the TS writer's output, but a
  // teammate can push a memory with ARBITRARY custom frontmatter keys via the shared
  // org vault (`apikey: ghp_…`, `contact: me@personal.com`), and `update_memory`
  // spreads `...parsed.data` (mutate.ts), preserving those custom keys through the
  // PostToolUse re-sync. Without this scan, a secret/personal email planted in a non-
  // standard key passes the filter and lands in the shared repo. `JSON.stringify(data)`
  // captures every key's value (named ones are re-scanned, harmlessly), and survives
  // parseFrontmatter's round-trip — the ground truth is the parsed `data`, which is
  // exactly what gets re-committed. Scanning more text is fail-closed.
  const allValues = safeStringify(data);
  const text = `${title} ${author} ${tagText} ${sessionText} ${allValues} ${content}`;
  if (SECRET_TOKEN_RE.test(text)) return 'secret token or API key detected';
  // 7.2: labeled-generic then high-entropy — order so a labeled secret reports the
  // more specific "labeled secret" reason rather than the generic "high-entropy".
  if (LABELED_GENERIC_RE.test(text)) return 'labeled secret (api_key/token/secret/password) detected';
  if (findHighEntropySecret(text)) return 'high-entropy secret-like token detected';
  if (findSuspiciousEmail(text, allowedDomains)) return 'suspicious email address detected';
  // 7.3: validated financial / phone detectors. CC/IBAN only fire on a passed
  // checksum (Luhn / mod-97), so random digit/alphanumeric runs don't trigger.
  if (findCreditCard(text)) return 'credit card number detected';
  if (findIBAN(text)) return 'IBAN detected';
  if (findPhoneNumber(text)) return 'phone number detected';
  return null;
}

// JSON.stringify that can't throw on oddities a teammate might hand-edit into the
// shared org vault frontmatter (circular refs, BigInt). A thrown stringify here would
// let a secret-laden file sail through the filter by crashing it; fall back to empty
// (the named-field text already in `text` still covers the standard keys) — fail-
// closed means never crash-open.
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}