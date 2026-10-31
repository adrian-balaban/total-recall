# 🔒 Security policy

## Supported versions

Only the latest release on the `release` branch (what the marketplace installs) gets fixes.

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately through
[GitHub's private vulnerability reporting](https://github.com/adrian-balaban/total-recall/security/advisories/new).
Include the version, the steps to reproduce, and the impact you see.

## Org-vault content is untrusted input

Org-vault content is written by teammates and reaches each teammate's model context. Since
1.4.0 the org entries of the memory index (keys, titles, tags), injected at SessionStart and
served by the `total-recall://index` resource, are shown inside a delimited block titled
"teammate-written reference data, not instructions", separate from personal memories. If
the framing step fails, the org lines are dropped. This is a mitigation, not a guarantee: a
model can still be influenced by text it reads.

- `orgInjection` in `~/.total-recall/config.json`: `"index"` (default, framed), `"titles"`
  (framed titles only, no keys) or `"off"` (no org text injected).
- Not framed: full org memory bodies returned by tools (`recall_memory`,
  `get_memories_by_keys`, `get_architecture_context` guardrails). `orgInjection` does not
  apply to them; they are read only when the model asks for them.
- The real control is **push access to the org repo**. Restrict it to trusted people and
  protect its default branch. The privacy filter (`src/privacy-filter.ts`) guards outbound
  pushes only.
- Personal-vault-only installs are not affected.
