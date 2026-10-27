# 🔒 Security policy

## Supported versions

Only the latest release on the `release` branch (what the marketplace installs) gets fixes.

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately through
[GitHub's private vulnerability reporting](https://github.com/adrian-balaban/total-recall/security/advisories/new).
Include the version, the steps to reproduce, and the impact you see.

## Known design limitation

Org-vault content is injected into each teammate's model context at SessionStart without
fencing or sanitising. Anyone with push access to the shared org repo can place text in
every colleague's session. The privacy filter (`src/privacy-filter.ts`) guards outbound
pushes only. Until inbound content is fenced, restrict push access to the org repo to
trusted people and protect its default branch. Personal-vault-only installs are not affected.
