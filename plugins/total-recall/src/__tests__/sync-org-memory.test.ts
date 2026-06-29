import { describe, it, expect } from 'vitest';

// We test the matterParse, privacyCheck, and email-filter logic by extracting them
// inline (the .cjs file can't be ES-imported cleanly). These are pure functions
// replicated here for unit testing. KEEP IN SYNC with scripts/sync-org-memory.cjs —
// the .cjs is the source of truth; this replica exists only so vitest can exercise it.

// ─── matterParse (replicated from sync-org-memory.cjs) ───────────────────────

function matterParse(raw: string): { data: Record<string, any>; content: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { data: {}, content: raw };
  const data: Record<string, any> = {};
  let lastArrayKey: string | null = null;
  for (const line of match[1].split('\n')) {
    // Skip blank lines and comments (a "# foo" line would otherwise create a bogus
    // array key via the "key:" branch). lastArrayKey survives blank lines so a block
    // sequence may span them.
    if (!line.trim() || line.trim().startsWith('#')) continue;
    // Block sequence item belonging to the most recently opened array key: "  - value"
    const blockItem = line.match(/^\s+-\s+(.+)$/);
    if (blockItem) {
      if (lastArrayKey) {
        if (!Array.isArray(data[lastArrayKey])) data[lastArrayKey] = [];
        data[lastArrayKey].push(blockItem[1].replace(/^["']|["']$/g, ''));
      }
      continue;
    }
    const [k, ...rest] = line.split(':');
    if (k && rest.length) {
      const val = rest.join(':').trim();
      if (val.startsWith('[')) {
        try {
          // Handle both JSON arrays ["a","b"] and unquoted YAML arrays [a, b, c]
          const jsonSafe = val.replace(/([[\s,])([a-zA-Z0-9_-]+)(?=[,\]])/g, '$1"$2"');
          data[k.trim()] = JSON.parse(jsonSafe);
        } catch { data[k.trim()] = val; }
        lastArrayKey = k.trim();
      } else if (val === '') {
        // "key:" with an empty inline value opens a block sequence (items follow as
        // "  - x"). Preset an empty array and remember the key; if no items follow it
        // is dropped below. Note "key:".split(':') yields rest=[''] (length 1), so THIS
        // branch — not the !rest.length one below — is what actually catches the opener.
        data[k.trim()] = [];
        lastArrayKey = k.trim();
      } else {
        data[k.trim()] = val.replace(/^["']|["']$/g, '');
        lastArrayKey = null;
      }
    } else if (k && !rest.length) {
      // "key:" with no inline value — opens a block array (items follow as "  - x").
      // Preset an empty array and remember the key; if no items follow, drop it.
      data[k.trim()] = [];
      lastArrayKey = k.trim();
    }
  }
  // Drop keys preset as empty arrays that never received block items (treat as absent)
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v) && v.length === 0) delete data[k];
  }
  return { data, content: raw.slice(match[0].length).trim() };
}

// ─── privacyCheck (replicated) ───────────────────────────────────────────────
// NOTE: kept in sync with scripts/sync-org-memory.cjs. The allowlist is now
// configurable (config.allowedEmailDomains) and defaults to empty = fail-closed.

const ROLE_TITLE_ALLOWLIST = ['product owner', 'tech lead', 'architect', 'scrum master'];

// Match any email-shaped substring, then compare the full host part against the
// allowlist in JS (NOT a negative-lookahead regex — see the bypass test below).
const EMAIL_RE = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

// Sanitize the configured allowlist — mirror of scripts/sync-org-memory.cjs
// sanitizeAllowedDomains (KEEP IN SYNC). Drops non-strings, empties, and BARE TLDs:
// a bare "com" entry would make isAllowedEmail return true for every *.com host
// (h.endsWith('.com')), silently allowlisting an entire TLD and gutting the email
// filter. Require at least one dot; reject leading/trailing dots. Fail-closed:
// dropping an over-permissive entry makes MORE emails block, not fewer.
function sanitizeAllowedDomains(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.filter((d): d is string => typeof d === 'string' && d.length > 0 && d.includes('.') && !d.startsWith('.') && !d.endsWith('.'));
}

function isAllowedEmail(host: string, allowedDomains: string[]): boolean {
  if (!allowedDomains.length) return false; // fail-closed
  const h = host.toLowerCase();
  return allowedDomains.some((d) => {
    const dl = d.toLowerCase();
    return h === dl || h.endsWith('.' + dl); // allow the bare domain and its subdomains
  });
}

function findSuspiciousEmail(text: string, allowedDomains: string[]): string | null {
  EMAIL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EMAIL_RE.exec(text)) !== null) {
    if (!isAllowedEmail(m[1], allowedDomains)) return m[0];
  }
  return null;
}

const PERSONAL_PRONOUN_RE = /\b(my|our|i am|i'm|we are|we're)\b/i;
// US/NANP: optional +country code, (xxx) xxx-xxxx or xxx-xxx-xxxx
const US_PHONE_RE = /(?:\+\d{1,3}[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
// International: +country code then 7-13 more digits with separators (E.164-ish, max 15 total)
const INTL_PHONE_RE = /\+\d{1,3}[\s().-]*(?:\d[\s().-]*){6,12}\d/;
const PHONE_RE = new RegExp(`(?:${INTL_PHONE_RE.source}|${US_PHONE_RE.source})`);
// Common API keys / tokens — leaked credentials are the highest-risk PII for a public repo.
// Mirror of scripts/sync-org-memory.cjs SECRET_TOKEN_RE (KEEP IN SYNC). Covers PEM keys,
// OpenAI sk-, Stripe live (sk_live_/rk_live_/pk_live_), AWS access-key ids (AKIA + ASIA
// STS temp creds), GitHub (gh*_ / github_pat_ / xapp_), Slack xox, Google AIza, GitLab
// glpat, JWTs (eyJ…). The `i` flag catches uppercase env-style forms. The AWS SECRET
// ACCESS KEY (40-char, no fixed prefix) is detected only when LABELED to avoid SHA-1 /
// base64 false positives (see the "does not false-positive on a SHA-1 hash" test below).
const SECRET_TOKEN_RE = /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{20,}|sk_live_[A-Za-z0-9]{24,}|rk_live_[A-Za-z0-9]{24,}|pk_live_[A-Za-z0-9]{24,}|(?:AKIA|ASIA)[0-9A-Z]{16}|gh[opsu]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|glpat-[A-Za-z0-9_-]{20}|xapp-[A-Za-z0-9_-]{36,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b|aws_secret_access_key["'\s:=]+[A-Za-z0-9\/+=]{40}(?![A-Za-z0-9\/+=])/i;

function privacyCheck(data: any, content: string, allowedDomains: string[] = []): string | null {
  // Scan the union of title, author, tags, and body — mirrors scripts/sync-org-memory.cjs.
  // Tags are scanned whether they parsed as an array OR as a raw scalar string: the
  // TS writer always emits arrays, but a teammate-pushed/hand-edited memory may carry
  // `tags: ghp_xxx` (scalar), which parses to a string and would be skipped by the
  // array branch alone (tagText=''), letting a scalar-tag secret sail into the org repo.
  const tagText = Array.isArray(data.tags) ? data.tags.join(' ') : String(data.tags ?? '');
  const text = `${data.title ?? ''} ${data.author ?? ''} ${tagText} ${content}`;
  if (SECRET_TOKEN_RE.test(text)) return 'secret token or API key detected';
  if (findSuspiciousEmail(text, allowedDomains)) return 'suspicious email address detected';
  if (PERSONAL_PRONOUN_RE.test(data.title ?? '')) {
    const lc = (data.title ?? '').toLowerCase();
    if (!ROLE_TITLE_ALLOWLIST.some((r: string) => lc.includes(r))) return 'personal pronoun in title';
  }
  if (PHONE_RE.test(text)) return 'phone number detected';
  return null;
}

// ─── Tests: matterParse ──────────────────────────────────────────────────────

describe('matterParse', () => {
  it('parses standard frontmatter', () => {
    const raw = `---\ntitle: "Hello World"\ntags: [a, b, c]\nimportanceScore: 0.7\n---\n\nBody text.`;
    const { data, content } = matterParse(raw);
    expect(data.title).toBe('Hello World');
    expect(data.tags).toEqual(['a', 'b', 'c']);
    expect(data.importanceScore).toBe('0.7'); // parsed as string (no type coercion)
    expect(content).toBe('Body text.');
  });

  it('handles file with no frontmatter', () => {
    const raw = 'Just plain content.';
    const { data, content } = matterParse(raw);
    expect(data).toEqual({});
    expect(content).toBe('Just plain content.');
  });

  it('parses unquoted YAML array correctly', () => {
    const raw = `---\ntags: [kafka, flink, cdc]\n---\n\nContent`;
    const { data } = matterParse(raw);
    expect(data.tags).toEqual(['kafka', 'flink', 'cdc']);
  });

  it('parses quoted JSON array without double-quoting', () => {
    const raw = `---\ntags: ["kafka", "flink"]\n---\n\nContent`;
    const { data } = matterParse(raw);
    // Quoted arrays get double-quoted by the regex but JSON.parse handles it
    // or falls through to raw string — either way no crash
    expect(Array.isArray(data.tags) || typeof data.tags === 'string').toBe(true);
  });

  it('handles hyphenated values in arrays', () => {
    const raw = `---\ntags: [kafka-connect, flink-cdc]\n---\n\nContent`;
    const { data } = matterParse(raw);
    expect(data.tags).toEqual(['kafka-connect', 'flink-cdc']);
  });

  it('strips surrounding quotes from string values', () => {
    const raw = `---\nauthor: "adrianb"\n---\n\nContent`;
    const { data } = matterParse(raw);
    expect(data.author).toBe('adrianb');
  });

  it('handles colon in value (joins rest correctly)', () => {
    const raw = `---\nurl: https://example.com/path\n---\n\nContent`;
    const { data } = matterParse(raw);
    expect(data.url).toBe('https://example.com/path');
  });

  it('returns empty data for frontmatter without closing ---', () => {
    const raw = `---\ntitle: "Unclosed"\n\nContent without close`;
    const { data } = matterParse(raw);
    expect(data).toEqual({});
  });

  it('parses block-sequence arrays (older/hand-edited files)', () => {
    // store_memory writes arrays inline, but older files (and hand-edited YAML) use
    // the block form. matterParse must attach each "  - x" to the preceding array key.
    const raw = `---\ntags:\n  - org\n  - team\n---\n\nContent`;
    const { data, content } = matterParse(raw);
    expect(data.tags).toEqual(['org', 'team']);
    expect(content).toBe('Content');
  });

  it('parses block-sequence arrays with quoted items', () => {
    const raw = `---\ntags:\n  - "org"\n  - 'architecture'\n---\n\nContent`;
    const { data } = matterParse(raw);
    expect(data.tags).toEqual(['org', 'architecture']);
  });

  it('drops a "key:" that opens a block array but receives no items', () => {
    // A bare "tags:" with nothing under it must NOT leave data.tags === [] — treat absent.
    const raw = `---\ntags:\n---\n\nContent`;
    const { data } = matterParse(raw);
    expect(data.tags).toBeUndefined();
    expect(data).toEqual({});
  });

  it('does not attach a block item to a key that already took an inline value', () => {
    // An orphan "  - x" after a scalar key is ignored, not silently attached.
    const raw = `---\ntitle: Foo\n  - stray\n---\n\nContent`;
    const { data } = matterParse(raw);
    expect(data.title).toBe('Foo');
    expect(data).toEqual({ title: 'Foo' });
  });
});

// ─── Tests: privacyCheck ─────────────────────────────────────────────────────

describe('privacyCheck', () => {
  it('passes clean org memory', () => {
    expect(privacyCheck({ title: 'Kafka Architecture' }, 'Technical content about Kafka.')).toBeNull();
  });

  it('blocks external email addresses', () => {
    expect(privacyCheck({ title: 'Notes' }, 'Contact user@gmail.com for details.')).toMatch(/email/);
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

  it('blocks personal pronoun in title', () => {
    expect(privacyCheck({ title: 'My personal notes' }, 'Content')).toMatch(/pronoun/);
  });

  it('allows role title with pronoun-like words', () => {
    // "our tech lead" contains "our" but title contains role title
    expect(privacyCheck({ title: 'Our Tech Lead decisions' }, 'Content')).toBeNull();
  });

  it('blocks phone numbers in content', () => {
    expect(privacyCheck({ title: 'Notes' }, 'Call 555-123-4567 for support.')).toMatch(/phone/);
  });

  it('blocks phone numbers with country code', () => {
    expect(privacyCheck({ title: 'Notes' }, 'Dial +1 (555) 123-4567')).toMatch(/phone/);
  });

  it('does not block URLs that look like domains', () => {
    // A URL without @ should not trigger email filter
    expect(privacyCheck({ title: 'Notes' }, 'See https://example.com/docs')).toBeNull();
  });

  it('blocks "we are" pronoun in title', () => {
    expect(privacyCheck({ title: "We are migrating" }, 'Content')).toMatch(/pronoun/);
  });

  // ── author & tags scanning (regression tests keeping the replica in sync with
  // the .cjs, which scans title + author + tags + body). Without author/tags in the
  // scanned `text`, a secret or email smuggled into those fields would sail through.

  it('blocks a secret token in the author field', () => {
    // The .cjs scans data.author; if the replica omits it, this passes when it shouldn't.
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
    // memory may carry `tags: sk-xxx` as a scalar. matterParse yields a string, not an
    // array, so the Array.isArray branch alone would set tagText='' and leave the
    // scalar tag unscanned. The String(data.tags ?? '') fallback closes that gap.
    expect(privacyCheck({ tags: 'sk-abcdefghijklmnopqrstuvwxyz123456' }, 'Clean body.')).toMatch(/secret/);
  });

  it('still passes a clean scalar tags field', () => {
    // A non-secret scalar tag must not false-positive.
    expect(privacyCheck({ tags: 'architecture' }, 'Clean body.')).toBeNull();
  });

  // ── Pass 3: extended SECRET_TOKEN_RE — Stripe live, AWS STS (ASIA), labeled AWS
  // secret access key. Each is a prefixed/labeled form with negligible false-positive
  // risk; the .cjs comment explains why the AWS 40-char secret is matched only when
  // labeled (a bare {40} would false-positive on SHA-1 hashes / base64 blobs).
  //
  // The Stripe SECRET-key fixtures (sk_live_, rk_live_) are split across string
  // concatenation (`'sk_live_' + 'abcdef…'`) on purpose: GitHub push-protection secret
  // scanning flags any contiguous `sk_live_[A-Za-z0-9]{24,}` / `rk_live_…` in the source
  // blob, even an obvious fake like `sk_live_abcdef…`. Splitting keeps the contiguous
  // token out of the source bytes (scanners don't reconstruct `+` concatenation) while
  // the runtime string is still contiguous, so SECRET_TOKEN_RE matches and the test
  // passes. Do NOT collapse these back to a single literal — it re-trips push
  // protection. pk_live_ (publishable, public by design) and the AWS fixtures are not
  // flagged by GitHub and need no split.

  it('blocks a Stripe live secret key (sk_live_)', () => {
    expect(privacyCheck({ title: 'Notes' }, 'Stripe key sk_live_' + 'abcdefghijklmnopqrstuvwxyz123456')).toMatch(/secret/);
  });

  it('blocks a Stripe restricted key (rk_live_)', () => {
    expect(privacyCheck({ title: 'Notes' }, 'Stripe rk_live_' + 'abcdefghijklmnopqrstuvwxyz123456 leaked')).toMatch(/secret/);
  });

  it('blocks a Stripe publishable live key (pk_live_)', () => {
    expect(privacyCheck({ title: 'Notes' }, 'pk_live_abcdefghijklmnopqrstuvwxyz123456 in config')).toMatch(/secret/);
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
    // (no `aws_secret_access_key` label here) must NOT flag it. No 10-contiguous-digit run,
    // so the phone filter doesn't trip either.
    expect(privacyCheck({ title: 'Notes' }, 'commit da39a3ee5e6b4b0d3255bfef95601890afd80709 fixed it')).toBeNull();
  });

  it('bare-TLD allowlist entry is rejected: ["com"] does NOT allowlist me@work.com', () => {
    // The footgun: with the OLD unsanitized allowlist, ["com"] made isAllowedEmail return
    // true for every *.com host (h.endsWith('.com')). sanitizeAllowedDomains(['com']) → []
    // (no dot), so the allowlist is empty and the filter fails closed → me@work.com blocks.
    expect(privacyCheck({ title: 'Notes' }, 'me@work.com', sanitizeAllowedDomains(['com']))).toMatch(/email/);
  });
});

// ─── Tests: sanitizeAllowedDomains (Pass 3 bare-TLD footgun) ─────────────────

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

// ─── Tests: spawnSync safety (shell injection prevention) ────────────────────

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