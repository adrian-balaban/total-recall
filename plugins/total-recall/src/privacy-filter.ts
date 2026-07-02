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
// Personal pronouns and phone numbers were intentionally removed: both had false-
// positive rates high enough to block legitimate org memories (pronoun titles like
// "We are migrating…"; any 10-digit run such as unix timestamps, AWS account ids, or
// git SHA fragments tripped the phone regex). The real "this is personal" guard is the
// mutual-exclusion of the `personal` and `org` tags enforced in the sync script.

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
  if (findSuspiciousEmail(text, allowedDomains)) return 'suspicious email address detected';
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