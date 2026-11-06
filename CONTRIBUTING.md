# Contributing

Thanks for helping. This page is the short human version of the rules; the longer, assistant-facing notes are in [plugins/total-recall/CLAUDE.md](plugins/total-recall/CLAUDE.md).

## Branches

- Work on a branch from `main` and open a pull request into `main`.
- Never push to `release`. It is rebuilt by GitHub Actions after the gate goes green, and it is what the marketplace installs. Do not commit `dist/`.

## Build and test

Run everything from `plugins/total-recall/`:

```bash
npm ci
npm run build                       # needed once for dist/ (integration tests use it)
npm run typecheck
HOME=$(mktemp -d) npm test         # a clean HOME: your own ~/.total-recall/config.json changes results
npm run test:integration
```

From the repository root, `npm test` runs the npx launcher's tests (plain `node:test`, no install needed) and `node test/pack-guard.mjs` checks that its npm tarball holds only the launcher.

If a native test fails with `NODE_MODULE_VERSION` in the message, you switched Node versions: run `npm rebuild better-sqlite3`.

## The gates

CI (`.github/workflows/mutation.yml`) must be green before a merge:

- tests, typecheck and the coverage thresholds (95 / 90 / 95 / 95);
- the mutation score, at least 65%;
- the architecture gate: every `ASSERT` tagged `[TR-…]` in `plugins/total-recall/architecture/adl/*.adl` needs a test with that ID in its name, and every new source file belongs to exactly one component (see [Adding a module or rule here](docs/SPEC-DRIVEN.md#adding-a-module-or-rule-here)).

When a gate fails, the message names the file or ID. Fix the cause; do not lower a threshold.

## Commits and versions

- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `test:`, `chore:`.
- A change that should reach users bumps the version in `plugins/total-recall/package.json` only (`npm run build` copies it to the plugin manifests and to the root `package.json` of the npx launcher). The release workflow tags and publishes when the version changes. A docs-only change does not need a bump.
- Commits are not signed yet ([PLAN-SIGNED-RELEASES.md](PLAN-SIGNED-RELEASES.md)).

## Reporting problems

Bugs and ideas: open an issue. Security problems: follow [SECURITY.md](SECURITY.md) and do not open a public issue.
