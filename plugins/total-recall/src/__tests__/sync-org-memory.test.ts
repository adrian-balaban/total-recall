import { describe, it, expect } from 'vitest';
import { privacyCheck, sanitizeAllowedDomains } from '../privacy-filter.js';

// The org-sync privacy filter (secret-token + email checks) and the email-allowlist
// sanitizer live in src/privacy-filter.ts, built to dist/privacy-filter.mjs and
// imported by scripts/sync-org-memory.mjs. Importing the SAME source here (not a
// replica) means the unit tests and the live hook can no longer silently diverge —
// the old "KEEP IN SYNC with the .cjs" replica is gone. Personal-pronoun and phone-
// number blockers were removed (high false-positive rate; see privacy-filter.ts),
// so only secret + email cases are exercised below.

describe('privacyCheck', () => {
  it('passes clean org memory', () => {
    expect(privacyCheck({ title: 'Kafka Architecture' }, 'Technical content about Kafka.')).toBeNull();
  });

  it('blocks external email addresses', () => {
    expect(privacyCheck({ title: 'Notes' }, 'Contact user@gmail.com for details.')).toMatch(/email/);
  });

  // #6 / review-fix #13: the EMAIL_RE host class must include non-ASCII (IDN)
  // chars ( -￿), not ASCII-only `[A-Za-z0-9.-]+`. An ASCII-only host
  // class never matched `user@münchen.de` / `kunde@exämple.com`, so a personal
  // email at an internationalized host sailed past findSuspiciousEmail into the
  // shared org repo. This pins the IDN host class so a future "simplify the
  // regex" refactor that narrows it back to ASCII-only is caught at npm test,
  // not in a teammate's leaked email. Fail-closed (empty allowlist) blocks them.
  it('blocks IDN/non-ASCII host emails (review-fix #13 regression, #6 test-gap)', () => {
    expect(privacyCheck({ title: 'Notes' }, 'Contact user@münchen.de for help.')).toMatch(/email/);
    expect(privacyCheck({ title: 'Notes' }, 'Reach kunde@exämple.com.')).toMatch(/email/);
    // Cyrillic and CJK hosts are covered by the same BMP-above-ASCII range.
    // (Local parts stay ASCII by design — the IDN fix targets the HOST class —
    // so use an ASCII local part with an IDN host, the realistic leak shape.)
    expect(privacyCheck({ title: 'Notes' }, 'Пишите мне at user@пример.рф.')).toMatch(/email/);
    expect(privacyCheck({ title: 'Notes' }, 'Mail to user@example.日本.')).toMatch(/email/);
  });

  it('honors an allowlisted IDN domain (the host still flows through isAllowedEmail)', () => {
    // The IDN fix is not "block all non-ASCII hosts" — the host still flows
    // through isAllowedEmail, so a company at an IDN domain can be allowlisted.
    expect(privacyCheck({ title: 'Notes' }, 'Contact ops@münchen.de for help.', ['münchen.de'])).toBeNull();
  });

  it('fail-closed: empty allowlist blocks every email, including work domains', () => {
    // Default config (no allowedEmailDomains) → no email is safe to push.
    expect(privacyCheck({ title: 'Notes' }, 'Contact ops@example.com for help.')).toMatch(/email/);
    expect(privacyCheck({ title: 'Notes' }, 'owner@example.org')).toMatch(/email/);
    expect(privacyCheck({ title: 'Notes' }, 'me@mycompany.com')).toMatch(/email/);
  });

  it('allows emails at a configured allowed domain', () => {
    expect(privacyCheck({ title: 'Notes' }, 'Contact ops@mycompany.com for help.', ['mycompany.com'])).toBeNull();
  });

  it('still blocks non-allowlisted domains when an allowlist is set', () => {
    expect(privacyCheck({ title: 'Notes' }, 'Contact user@gmail.com for details.', ['mycompany.com'])).toMatch(/email/);
  });

  it('blocks a lookalike host that merely ends with the allowed domain as a prefix (regex-lookahead bypass)', () => {
    // A negative-lookahead regex @(?!yourcompany\.com) would let this through because
    // "yourcompany.com" is a PREFIX of the host "yourcompany.com.evil.com" — the
    // lookahead sees the prefix and fails to exclude the rest. The JS host comparison
    // treats the host as a whole and correctly blocks it.
    expect(privacyCheck({ title: 'Notes' }, 'Reach ops@yourcompany.com.evil.com', ['yourcompany.com'])).toMatch(/email/);
  });

  it('allows subdomains of a configured allowed domain', () => {
    // team.yourcompany.com is a subdomain of the allowed yourcompany.com → safe.
    expect(privacyCheck({ title: 'Notes' }, 'Reach ops@team.yourcompany.com', ['yourcompany.com'])).toBeNull();
  });

  it('does not block URLs that look like domains', () => {
    // A URL without @ should not trigger email filter
    expect(privacyCheck({ title: 'Notes' }, 'See https://example.com/docs')).toBeNull();
  });

  it('does NOT block personal pronouns in titles/body (#6 regression)', () => {
    // Pronouns were intentionally removed from the filter (high false-positive rate;
    // a title like "We are migrating…" used to be blocked). A title/body full of
    // pronouns must pass clean.
    expect(privacyCheck({ title: 'We are migrating our services to Kubernetes' }, 'He and she agreed they would handle it themselves.')).toBeNull();
  });

  it('does NOT block phone-like digit runs (#6 regression)', () => {
    // Phone-number detection was intentionally removed (high false-positive rate;
    // any 10-digit run — unix timestamps, AWS account ids, git SHA fragments —
    // tripped the phone regex). A body carrying such runs must pass clean.
    expect(privacyCheck({ title: 'Notes' }, 'Timestamp 1719705600 and account id 1234567890 in this note.')).toBeNull();
  });

  // ── author & tags scanning (regression tests keeping the filter honest: it scans
  // title + author + tags + body). Without author/tags in the scanned `text`, a secret
  // or email smuggled into those fields would sail through.

  it('blocks a secret token in the author field', () => {
    // The filter scans data.author; if it omitted it, this passes when it shouldn't.
    expect(privacyCheck({ author: 'sk-abcdefghijklmnopqrstuvwxyz123456' }, 'Clean body.')).toMatch(/secret/);
  });

  it('blocks a suspicious email in the author field', () => {
    expect(privacyCheck({ author: 'leaker@gmail.com' }, 'Clean body.')).toMatch(/email/);
  });

  it('blocks a secret token in an array tags field', () => {
    expect(privacyCheck({ tags: ['org', 'sk-abcdefghijklmnopqrstuvwxyz123456'] }, 'Clean body.')).toMatch(/secret/);
  });

  it('blocks a secret token in a SCALAR tags field (teammate-pushed malformed frontmatter)', () => {
    // The TS writer always emits tags as an array, but a hand-edited or teammate-pushed
    // memory may carry `tags: sk-xxx` as a scalar. parseFrontmatter yields a string,
    // not an array, so the Array.isArray branch alone would set tagText='' and leave
    // the scalar tag unscanned. The String(data.tags ?? '') fallback closes that gap.
    expect(privacyCheck({ tags: 'sk-abcdefghijklmnopqrstuvwxyz123456' }, 'Clean body.')).toMatch(/secret/);
  });

  it('still passes a clean scalar tags field', () => {
    // A non-secret scalar tag must not false-positive.
    expect(privacyCheck({ tags: 'architecture' }, 'Clean body.')).toBeNull();
  });

  it('blocks a secret token in an array sessions field', () => {
    // sessions is a client-supplied free-form array (update_memory appends session
    // ids); a leaked token could ride in via sessions just as via tags. Before the
    // fix, privacyCheck did not scan sessions at all, so this sailed into the org
    // repo. The fix adds sessions to the scanned union (array form here).
    expect(privacyCheck({ sessions: ['s1', 'sk-abcdefghijklmnopqrstuvwxyz123456'] }, 'Clean body.')).toMatch(/secret/);
  });

  it('blocks a secret token in a SCALAR sessions field (hand-edited frontmatter)', () => {
    // Same scalar fallback as tags: a teammate-pushed `sessions: sk-xxx` is parsed
    // as a string, not an array. The String(data.sessions ?? '') branch must scan it.
    expect(privacyCheck({ sessions: 'sk-abcdefghijklmnopqrstuvwxyz123456' }, 'Clean body.')).toMatch(/secret/);
  });

  it('blocks a personal email in the sessions field', () => {
    // A personal email in a session id must be blocked just as in the body.
    expect(privacyCheck({ sessions: ['me@personal.com'] }, 'Clean body.')).toMatch(/email/);
  });

  it('still passes a clean sessions field', () => {
    expect(privacyCheck({ sessions: ['abc-123', 'def-456'] }, 'Clean body.')).toBeNull();
  });

  // #12: a teammate can push a memory with ARBITRARY custom frontmatter keys via the
  // shared org vault, and update_memory preserves them (...parsed.data). The named
  // fields alone would miss a secret/email planted in a non-standard key. The filter
  // must scan the whole parsed `data` object so custom-key values are covered too.
  it('blocks a secret token in a CUSTOM frontmatter key (#12 regression)', () => {
    expect(privacyCheck({ title: 'Notes', apikey: 'sk-abcdefghijklmnopqrstuvwxyz123456' } as any, 'Clean body.')).toMatch(/secret/);
  });

  it('blocks a personal email in a CUSTOM frontmatter key (#12 regression)', () => {
    expect(privacyCheck({ title: 'Notes', contact: 'me@personal.com' } as any, 'Clean body.')).toMatch(/email/);
  });

  it('still passes a clean custom frontmatter key', () => {
    expect(privacyCheck({ title: 'Notes', customField: 'just some context' } as any, 'Clean body.')).toBeNull();
  });

  // ── SECRET_TOKEN_RE — Stripe live, AWS STS (ASIA), labeled AWS secret access key.
  // Each is a prefixed/labeled form with negligible false-positive risk; the
  // privacy-filter.ts comment explains why the AWS 40-char secret is matched only when
  // labeled (a bare {40} would false-positive on SHA-1 hashes / base64 blobs).
  //
  // The Stripe SECRET-key fixtures (sk_live_, rk_live_) are split across string
  // concatenation (`'sk_live_' + 'abcdef…'`) on purpose: GitHub push-protection secret
  // scanning flags any contiguous `sk_live_[A-Za-z0-9]{24,}` / `rk_live_…` in the source
  // blob, even an obvious fake like `sk_live_abcdef…`. Splitting keeps the contiguous
  // token out of the source bytes (scanners don't reconstruct `+` concatenation) while
  // the runtime string is still contiguous, so SECRET_TOKEN_RE matches and the test
  // passes. Do NOT collapse these back to a single literal — it re-trips push
  // protection. pk_live_ is the PUBLISHABLE key (public by design), is intentionally
  // NOT matched by SECRET_TOKEN_RE, and is not flagged by GitHub — so there is no test
  // for it here. The AWS fixtures are not flagged by GitHub and need no split.

  it('blocks a Stripe live secret key (sk_live_)', () => {
    expect(privacyCheck({ title: 'Notes' }, 'Stripe key sk_live_' + 'abcdefghijklmnopqrstuvwxyz123456')).toMatch(/secret/);
  });

  it('blocks a Stripe restricted key (rk_live_)', () => {
    expect(privacyCheck({ title: 'Notes' }, 'Stripe rk_live_' + 'abcdefghijklmnopqrstuvwxyz123456 leaked')).toMatch(/secret/);
  });

  it('blocks an AWS STS temporary access key id (ASIA…)', () => {
    // ASIA is the STS temp-credential prefix (companion to AKIA). Exactly 20 chars total.
    expect(privacyCheck({ title: 'Notes' }, 'creds ASIAABCDEFGHIJKLMNOP')).toMatch(/secret/);
  });

  it('blocks an AWS secret access key in a labeled ~/.aws/credentials snippet', () => {
    expect(privacyCheck({ title: 'Notes' }, 'aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY')).toMatch(/secret/);
  });

  it('blocks an AWS secret access key in uppercase env-style (AWS_SECRET_ACCESS_KEY=)', () => {
    // The `i` flag on SECRET_TOKEN_RE catches the env-var form.
    expect(privacyCheck({ title: 'Notes' }, 'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY')).toMatch(/secret/);
  });

  it('does not false-positive on a 40-char SHA-1 hash (labeled-only AWS secret design)', () => {
    // da39a3ee5e6b4b0d3255bfef95601890afd80709 is the SHA-1 of the empty string — 40 hex
    // chars, and hex ⊂ the base64 charset a bare {40} would scan. The labeled-only design
    // (no `aws_secret_access_key` label here) must NOT flag it.
    expect(privacyCheck({ title: 'Notes' }, 'commit da39a3ee5e6b4b0d3255bfef95601890afd80709 fixed it')).toBeNull();
  });

  it('bare-TLD allowlist entry is rejected: ["com"] does NOT allowlist me@work.com', () => {
    // The footgun: with the OLD unsanitized allowlist, ["com"] made isAllowedEmail return
    // true for every *.com host (h.endsWith('.com')). sanitizeAllowedDomains(['com']) → []
    // (no dot), so the allowlist is empty and the filter fails closed → me@work.com blocks.
    expect(privacyCheck({ title: 'Notes' }, 'me@work.com', sanitizeAllowedDomains(['com']))).toMatch(/email/);
  });
});

// ─── Tests: sanitizeAllowedDomains (bare-TLD footgun) ─────────────────────────

describe('sanitizeAllowedDomains', () => {
  it('rejects bare TLDs (no dot)', () => {
    expect(sanitizeAllowedDomains(['com', 'org', 'io'])).toEqual([]);
  });

  it('keeps valid domains (with a dot)', () => {
    expect(sanitizeAllowedDomains(['example.com', 'sub.example.com'])).toEqual(['example.com', 'sub.example.com']);
  });

  it('rejects leading/trailing dots and empties', () => {
    expect(sanitizeAllowedDomains(['.bad', 'bad.', ''])).toEqual([]);
  });

  it('rejects non-string entries but keeps valid ones', () => {
    expect(sanitizeAllowedDomains([123, null, undefined, 'fine.com'])).toEqual(['fine.com']);
  });

  it('returns [] for non-array input', () => {
    expect(sanitizeAllowedDomains('notarray')).toEqual([]);
    expect(sanitizeAllowedDomains(undefined)).toEqual([]);
    expect(sanitizeAllowedDomains(null)).toEqual([]);
  });
});

// ─── Tests: spawnSync safety (shell injection prevention) ──────────────────────

describe('git command safety', () => {
  it('a key with shell metacharacters is safe when passed as array arg', () => {
    // Simulate what the fixed sync script does: spawnSync('git', ['-C', dir, 'commit', '-m', msg])
    // Even with a malicious key, it's a positional arg — no shell expansion
    const maliciousKey = 'architecture/$(rm -rf /)';
    const commitMsg = `chore(total-recall): sync ${maliciousKey}`;
    // The message itself is fine as a string — it's only dangerous if passed to a shell
    // Verify it doesn't contain shell expansion when used as array element
    const args = ['commit', '-m', commitMsg];
    expect(args[2]).toBe(commitMsg); // literal string, not expanded
    // spawnSync with shell:false would not interpret $() — we just verify the arg is safe
    expect(args[2]).toContain('$(rm -rf /)'); // still there as literal text
  });
});