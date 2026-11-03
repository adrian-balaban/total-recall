# PLAN — Signed releases: commits, tags and the built bundle

**Status:** proposed · **Date:** 2026-11-03 · **Branch:** `main`
**Goal:** let a consumer verify who produced what they install, and replace the README's "releases are **not signed**" caveat with a claim that is true and checkable.
**Out of scope:** changing the distribution channel (marketplace only, no zip, no npm package; see [PLAN-NPX-INSTALL-BOOTSTRAP.md](PLAN-NPX-INSTALL-BOOTSTRAP.md) for the one planned exception, a bootstrap launcher).

## §1 Current state (facts from the repo)

| Artifact | Who creates it | Signed today? | Evidence |
|---|---|---|---|
| Commits on `main` | maintainer, merged by squash through GitHub | **No** for the maintainer's own commits (no `commit.gpgsign`, no signing key configured). GitHub's squash-merge commit is signed by GitHub's key. | `git config --get commit.gpgsign` is empty; repo CLAUDE.md "Git Commit & Tag Signing Policy" |
| Branch protection on `main` | GitHub | Protected (PRs required). "Require signed commits" is **not** confirmed on. | `gh api repos/adrian-balaban/total-recall/branches/main --jq .protected` → `true` |
| `release` branch commit (`build: dist for vX (SHA)`) | `release.yml`, as `github-actions[bot]` via `git commit` + `git push --force` | **No** (plain `git commit`) | `.github/workflows/release.yml`, step "Publish built tree to the release branch" |
| Tag `vX.Y.Z` and GitHub Release | `release.yml`, `gh release create --target $SHA` | **No** (lightweight tag, created by GitHub) | step "Create tag and release" |
| `dist/` bundle consumers run | built in CI, committed to `release` | **No provenance** | no attestation step in the workflow |

What consumers install is the `release` branch (`marketplace.json` pins `"ref": "release"`). So the object that needs a trust story is that branch, not `main`.

## §2 What each option proves

| Option | Proves | Does not prove |
|---|---|---|
| **A. Signed maintainer commits** | A commit on `main` came from a holder of the maintainer's key | That the shipped `dist/` was built from it |
| **B. Branch protection "Require signed commits"** | Nothing unsigned reaches `main` (makes A enforced) | Anything about `release` or `dist/` |
| **C. Signed release tags** | A given version tag was cut by the maintainer | That the bundle matches the tag |
| **D. Build provenance attestation** (Sigstore, `actions/attest-build-provenance`) | The `dist/` files were built by *this* workflow from commit X | Who wrote commit X (that is A and B) |
| **E. Signed `release` commits** (CI creates the commit through the GitHub API so GitHub signs it) | The `release` branch commit came from the workflow, shown as "Verified" | Same as D; more complex, needs a spike |

A + B + D together cover the chain: *signed source commit → CI build → attested bundle*. C and E are optional polish.

## §3 Decision: staged plan

### Stage 1 — Signed source (maintainer, ~10 minutes, no repo change)

1. Use an SSH key as the signing key (GitHub verifies SSH signatures; no GPG needed):

   ```bash
   git config --global gpg.format ssh
   git config --global user.signingkey ~/.ssh/id_ed25519.pub
   git config --global commit.gpgsign true
   git config --global tag.gpgsign true
   ```

2. GitHub → Settings → SSH and GPG keys → **New SSH key**, *Key type: Signing Key*, same public key.
3. Make one commit and check it shows **Verified** on GitHub.
4. Only then enable *Require signed commits* in the `main` branch protection rule (turning it on first blocks your own pushes). Squash merges made in the GitHub UI are signed by GitHub and satisfy the rule.

Decision for the maintainer: which key to use, and whether to enable the rule (it blocks any contributor commit that is unsigned; for PRs merged by squash this does not matter).

### Stage 2 — Provenance for the built bundle (one PR, small)

Add to `.github/workflows/release.yml`:

```yaml
permissions:
  contents: write
  id-token: write       # new: Sigstore OIDC
  attestations: write   # new
...
      - name: Attest build provenance
        uses: actions/attest-build-provenance@v2
        with:
          subject-path: plugins/total-recall/dist/**
```

Placed after "Build plugin" and before "Publish built tree". This signs a statement binding the `dist/` file digests to the commit `$SHA` and the workflow run. Verification: `gh attestation verify <file> --repo adrian-balaban/total-recall`.

**Open design question (maintainer decides):** consumers install from a git branch, not a downloaded file, so they have no file to pass to `gh attestation verify` unless the same `dist/` is also attached to the GitHub Release as an archive. The repo's stated rule is "no zip artifact — one channel". Options:
- attach a `dist-vX.Y.Z.tar.gz` to the Release **for verification only** (the marketplace remains the install channel), and say so in INSTALL.md; or
- keep the attestation as a record only, verifiable by someone who rebuilds from the tag and compares digests.

The first is more useful; it slightly softens the "one channel" statement and needs a wording change in INSTALL.md §Install ("There is deliberately no zip download").

### Stage 3 — Optional polish

- **Signed tags (C):** the workflow creates the tag through `gh release create`, which GitHub does not sign with the maintainer's key. Either sign by hand (`git tag -s vX.Y.Z`, push before the workflow runs, so the workflow's `exists=true` check skips its own tag) or accept unsigned tags and rely on Stage 2.
- **Signed `release` commits (E):** investigate creating the commit through the Git Data API with `GITHUB_TOKEN` (GitHub signs those) instead of `git commit`. Needs a spike: confirm the commit shows "Verified" and that the force-push of a derived branch still works.

## §4 Doc changes after each stage

| After | Change |
|---|---|
| Stage 1 | `plugins/total-recall/CLAUDE.md` "Git Commit & Tag Signing Policy": update "NOT signed" to the real state; keep the honest statement of what is still unsigned |
| Stage 2 | README "At a glance" and Limits: replace "releases are **not signed**" with "the `dist/` bundle carries a build-provenance attestation; the `release` branch is rebuilt by CI" (only after the attestation verifies); INSTALL.md §Install: add the `gh attestation verify` command; `SECURITY.md`: one line on what is and is not attested |
| Stage 3 | Same files, per what shipped |

README / README-ro stay in sync (both carry the caveat today: README L22 and L190, and the RO equivalents).

## §5 Verification

1. **Stage 1:** `git log --show-signature -1` locally; "Verified" badge on the pushed commit; a test PR with an unsigned commit is blocked once the rule is on.
2. **Stage 2:** after a release run, `gh attestation verify plugins/total-recall/dist/index.js --repo adrian-balaban/total-recall` succeeds on a fresh clone of `release`; tamper test: edit one byte of a copy and confirm verification fails.
3. **Docs:** every claim in README, INSTALL.md and SECURITY.md about signing is reproducible with a command listed in INSTALL.md.

## §6 Risks

| Risk | Mitigation |
|---|---|
| Enabling "Require signed commits" locks the maintainer out | Do Stage 1 steps 1–3 first; keep the rule off until a signed commit shows Verified |
| Lost or rotated signing key | Add the new key before removing the old; old commits stay verified by GitHub's recorded state |
| Attestation covers only `dist/`, not the whole `release` tree | State exactly what is attested (the bundle), not "the release" |
| `permissions` widened (`id-token`, `attestations`) on a workflow that force-pushes | The workflow already has `contents: write`; limit new permissions to the job; the attestation step uses only the repo's own build output |
| Docs claim more than is proven | Wording rule: say "attested" only for `dist/`, "Verified" only for commits GitHub marks so; keep "tags are unsigned" until Stage 3 |
| Third-party action pinned by tag | Pin `actions/attest-build-provenance` to a commit SHA as the repo does for others, or accept the `@v2` tag and note it |

## §7 Decisions needed from the maintainer

1. Signing key to use (existing `id_ed25519` or a dedicated one).
2. Whether to enable *Require signed commits* on `main`.
3. Whether to attach a verification-only archive of `dist/` to each Release (Stage 2 design question).
4. Whether Stage 3 is wanted at all.
