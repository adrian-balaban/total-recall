// Phase 6 privacy rule: a spec memory (artifact "spec") may go to the shared org
// vault only when it names no hosts, no credentials and none of the configured
// client terms (specDriven.orgBlockedTerms). Checked at store time, before the
// file is written; the fail-closed sync filter still runs afterwards as for any
// org memory. Guardrails and other artifacts are not affected here.
import { privacyCheck } from '../privacy-filter.js';

// IPv4 addresses, URLs and dotted host names with a common or internal TLD.
const HOST_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b|\b[a-z][a-z0-9+.-]*:\/\/[^\s/]+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|dev|cloud|internal|local|lan|corp|intra|ro|de|uk|eu)\b/i;

export function orgSpecIssue(text: string, blockedTerms: string[]): string | null {
  const host = text.match(HOST_RE);
  if (host) return `names a host (${host[0]})`;
  const lower = text.toLowerCase();
  const term = blockedTerms.find((t) => lower.includes(t.toLowerCase()));
  if (term) return `mentions a blocked term ("${term}", specDriven.orgBlockedTerms)`;
  const priv = privacyCheck({}, text);
  return priv ? priv : null;
}
