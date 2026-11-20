# Plan: README review fixes (`README.md` + `README-ro.md`)

- **Date:** 2026-11-20
- **Base:** `main` @ `1bcf15a`
- **Plugin version:** 1.10.0
- **Related:** [PLAN-README-PERSONA-OPTIMIZATION.md](PLAN-README-PERSONA-OPTIMIZATION.md), the repo's persona-review process (rounds 1–3b applied, round 4 not yet run)

## Sources

Three read-only reviews, with key facts re-checked by hand:

| Review   | Scope                                                                           |
| -------- | ------------------------------------------------------------------------------- |
| Accuracy | README claims vs code: version, tools, install flags, hooks, config keys, links |
| Parity   | EN ↔ RO drift, translation errors, Romanian language quality                    |
| Clarity  | README read as a first-time visitor: structure, jargon, gaps                    |

A second, independent review proposed running persona round 4 from `PLAN-README-PERSONA-OPTIMIZATION.md` §0. Its claims are checked in [Cross-check with the persona-review process](#cross-check-with-the-persona-review-process) below.

Both READMEs have the same structure line for line, so every English change needs the same change in Romanian. Line numbers below refer to both files unless marked EN or RO.

---

## Cross-check with the persona-review process

### Verified

| Claim                                                                                                                                              | Verdict                  | Evidence                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Round 4 protocol exists and has not been run                                                                                                       | Confirmed                | `PLAN-README-PERSONA-OPTIMIZATION.md` header: "rounds 1–3b applied …; round 4 not run yet"; protocol in §0 (15 personas, FILES OPENED, findings table)                                                                                                                              |
| E1, E2: line 7 regressions from `1bcf15a`                                                                                                          | Confirmed                | `git show 1bcf15a`; same as E1/E2 below                                                                                                                                                                                                                                             |
| E3: "v1.8.1" is stale                                                                                                                              | Confirmed                | 1.10.0 in `package.json`; tag `v1.10.0` (2026-11-13); 1.9.0 and 1.9.1 in between                                                                                                                                                                                                    |
| E4: "~10/month" release cadence is stale                                                                                                           | Confirmed                | 33 tags from 2026-08-20 (v1.1.18) to 2026-11-13 (v1.10.0), 85 days ≈ 11.6/month. Missed by our reviews; added as E8 below                                                                                                                                                           |
| E5: releases are not signed                                                                                                                        | Confirmed, still true    | `PLAN-SIGNED-RELEASES.md` is still a proposal; only the npx launcher has npm provenance                                                                                                                                                                                             |
| E6: "22 tools"                                                                                                                                     | Confirmed correct        | 17 core + 5 architecture (`src/tools/*.ts`, `docs/TOOLS.md`)                                                                                                                                                                                                                        |
| E7: naming drift at L7 ("Google Antigravity & Gemini" vs "Gemini/Antigravity" elsewhere)                                                           | Confirmed                | Covered by E1/E2 below                                                                                                                                                                                                                                                              |
| E8: new claim clusters since round 3b (npx launcher, local-clone install, `TR_SESSION_END_EXTRACT=0`, `VULNERABILITIES.md` links, capture sandbox) | Plausible                | README history `dd229c6…1bcf15a`; not checked commit by commit. These are new material for round 4                                                                                                                                                                                  |
| E9: word budget must be re-measured                                                                                                                | Confirmed, and well over | Prose words (fenced code and `<details>` excluded): **EN ≈ 2,539, RO ≈ 2,568**. Round 3 measured 2,088 / 2,144; the §7 target is ~2,050 / 2,075. That is about **+450 words (~22%) over target**. Figures come from a quick `awk` count; round 4 must re-measure with the §4 method |

### Rejected / not applicable

- **"No subagent tool, so 15 sequential passes."** That was a limit of the reviewing tool, not of this repo. Claude Code can run the 15 persona reviewers in parallel, as §0 asks.

### New findings from the cross-check

- **Stale header in the persona plan.** The header says B4 (#39), B5 (#40) and B7 (#42) are open, but all three issues are **closed**. Fix this in the round-4 write-up.
- **Our clarity review contradicts earlier decisions.** Several Phase 3 items re-open questions that earlier rounds already settled:
  - Shrinking "At a glance" and moving the trust/risk bullets down goes against round-2 **priority 2**: "honest trust/risk information on the first screen".
  - Moving the spec-driven/ADL line out of At a glance (L24) reverses **round-3b decision 6**. 12 of 15 reviewers chose "last bullet of At a glance", and it shipped that way.

  These items are removed from Phase 3 below. They come back only if the maintainer explicitly wants to reverse those decisions.

### Conclusions

1. **Phases 1 and 2 stand.** They fix regressions, stale facts and Romanian language errors. They are not design changes, so they don't need a persona round.
2. **Phase 3 is replaced by persona round 4.** Restructuring the page is exactly what that process decides. Hand the remaining Phase 3 items to the reviewers as candidates, not as adopted changes.
3. **Run round 4 after Phases 1 and 2 are merged,** not on `1bcf15a`. Otherwise the 15 reviewers spend their findings on E1–E8, which are already known.
4. **Drop the spec-driven A/B/C vote from the round-4 prompt.** Option B is decided and live. Each persona instead confirms whether the shipped wording works.
5. **Word budget is the main round-4 problem.** The README is ~450 words over target. Round 4 must name cuts that pay for that, and any additions, using the §4 rule: each cut fact must live in exactly one other file.

---

## Phase 1: Fix errors

One small docs PR, to do now.

| #   | Line(s)                 | Problem                                                                                                                               | Fix                                                                                                                                                           |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | EN L7                   | Broken English from `1bcf15a` ("Also, are implemented and not tested the changes…")                                                   | Use the two-tier wording below                                                                                                                                |
| E2  | RO L7                   | No diacritics ("facute", "si", "inca", "catre"); "Google" dropped                                                                     | Use the same structure in Romanian (below)                                                                                                                    |
| E3  | L20                     | Says "v1.8.1"; the actual version is 1.10.0                                                                                           | Drop the version from the prose and add a release badge                                                                                                       |
| E4  | L20                     | "Releases build … from the `release` branch" is wrong                                                                                 | Releases build from `main` after the mutation-test gate and are pushed to `release`. The npx launcher is published with provenance; the plugin is not signed. |
| E5  | L21, L167, L194 vs L108 | Says automatic capture "cannot be switched off yet", but L108 documents `TR_SESSION_END_EXTRACT=0`, which `session-end.sh:95` honours | State it once: session-end capture can be turned off (`TR_SESSION_END_EXTRACT=0`); pre-compaction capture can't yet. L11 should also mention session end.     |
| E6  | L23                     | "about 4.4k at 105" appears nowhere else; `docs/QUALITY.md:104` says ~4.3k at 114                                                     | Use the QUALITY.md figure, or link instead of quoting a number                                                                                                |
| E7  | RO L168                 | Leaves out "(kept in `~/.total-recall/models/`)"                                                                                      | Add "(se păstrează în `~/.total-recall/models/`)"                                                                                                             |
| E8  | L20                     | "~10/month" release cadence; actual ≈ 11.6/month (33 tags in 85 days)                                                                 | Drop the number, or link to GitHub Releases, so it can't go stale                                                                                             |

### Proposed text for E1 (EN L7)

> Persistent, searchable memory for AI coding assistants. **Supported and tested:** Claude Code and Google Antigravity/Gemini. **Implemented, not yet tested:** any other client that speaks the Model Context Protocol (MCP), such as GitHub Copilot agent mode. Memories are plain Markdown files on your disk that you can read, edit, grep and version with git, or open as an [Obsidian](docs/HOW-IT-WORKS.md#-obsidian) vault.

### Proposed text for E2 (RO L7)

> Memorie persistentă și căutabilă pentru asistenții AI de programare. **Suportați și testați:** Claude Code și Google Antigravity/Gemini. **Implementat, dar încă netestat:** orice alt client compatibil cu Model Context Protocol (MCP), precum GitHub Copilot agent mode. Memoriile sunt fișiere Markdown simple pe discul tău, pe care le poți citi, edita, căuta cu grep și versiona cu git, sau le poți deschide ca vault [Obsidian](docs/HOW-IT-WORKS.md#-obsidian) (în engleză).

Use one client name ("Google Antigravity/Gemini") everywhere in both files.

**Word budget:** Phase 1 should be net ≤ 0. E1 is about +5 words; E3, E6 and E8 remove numbers. Measure before and after with the §4 method.

---

## Phase 2: Romanian quality

Same PR as Phase 1, or a follow-up. RO lines only.

### Grammar and meaning

| Line     | Current                                                                       | Proposed                                                                                                                                                                 |
| -------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 140      | "…din 1.6.8 e multilingv"; "inclusiv chirilică, greacă…"; "suportă potrivire" | "din versiunea 1.6.8, modelul e multilingv"; "inclusiv limbi scrise cu alfabet chirilic, precum și greacă, arabă, chineză și japoneză"; "permite potrivirea între limbi" |
| 160, 169 | "blochează în caz de dubiu" ("fails closed")                                  | "dacă verificarea eșuează, blochează (fail-closed)"                                                                                                                      |
| 175      | "Tratează-l ca pe un wiki comun" (`-l` points at the wrong noun)              | "Tratează vault-ul de echipă ca pe un wiki comun"                                                                                                                        |
| 47       | "întreabă profilul"                                                           | "te întreabă ce profil vrei"                                                                                                                                             |

### Consistent terms

- "free" → "gratuit" (L13, L19)
- Maintainer: pick "Întreținătorul" or "Autorul" and use it in both L19 and L153
- Settings: "configurația" (L81); keep "Configurare" for the process/section (L179)
- Troubleshooting bullets: noun-style labels throughout, e.g. L185 "**Recuperarea unei memorii:** …"

### Smaller wording fixes

| Line | Proposed                                                            |
| ---- | ------------------------------------------------------------------- |
| 20   | "Ultima măsurătoare de referință (v1.7.1)"                          |
| 30   | "nu e suficient"                                                    |
| 40   | "aceste comenzi"                                                    |
| 177  | "Pașii, testul de funcționare și checklist-ul de lansare în echipă" |
| 195  | "Calitatea regăsirii"                                               |
| 201  | "un tutorial pas cu pas de cinci minute"                            |
| 203  | "scalabilitate"                                                     |

### Links

- Add "(în engleză)" to the links to English-only docs at L26 (`docs/QUALITY.md`) and L161 (`ARCHITECTURE.md`).

### Optional

- "mașină" → "calculator" (L136, L153, L163). Changing the L163 heading also changes the anchor used at L12.

---

## Phase 3: Persona review round 4

Replaces the earlier ad-hoc restructure. Run it after the Phase 1/2 PR is merged.

### How

- Use the §0 prompt in `PLAN-README-PERSONA-OPTIMIZATION.md`, with these changes:
  - Run the 15 personas **in parallel**, one subagent each, as §0 says.
  - **Remove the spec-driven A/B/C vote.** Each persona instead says whether the shipped At a glance line works for them.
  - Give each reviewer the already-found lists (§10.4, §10.7) **plus this plan's E1–E8 and Phase 2 items**, marked as fixed.
  - Point reviewers at the new material since round 3b (E8 in the cross-check): npx launcher, local-clone install, `TR_SESSION_END_EXTRACT=0`, `VULNERABILITIES.md`, capture sandbox.
- Coordinator duties are unchanged (§0 items 1–4): verify every claim, combine into change tables, report prose words before and after, and write it up as **§11 Round 4** in `PLAN-README-PERSONA-OPTIMIZATION.md`. Edit nothing else; don't commit.
- In the same write-up, fix the stale header (B4/B5/B7 are closed).

### Candidate items for the reviewers (from our clarity review)

These are inputs to round 4, not adopted changes:

- **Install order:** lead with the npx one-liner in a code block; manual `/plugin` steps in `<details>`; "From source" last or only in `INSTALL.md`.
- **Name collision:** a one-line warning about other `total-recall` plugins next to the install command.
- **Uninstall:** a visible entry (now at L171 inside Privacy), merged with upgrade and troubleshooting.
- **Supported assistants** moved before or right after install.
- **Requirements:** add disk space (~450 MB for the Complete profile).
- **Jargon** explained where it first appears: compaction, org vault, TF-IDF, `claude -p`, fail-closed.
- **Word-budget cuts:** move internal details to `docs/HOW-IT-WORKS.md`:
  - the derived-files table cell (L134)
  - "since 1.6.8" changelog wording (L141)
  - "median 99 ms" (L158)
  - the token maths in L23 (keep the cap, drop the examples)
- **Links:** replace the link to the internal `BACKLOG.md` (L195); label the CI badge to match `mutation.yml`.

### Removed (conflict with earlier decisions)

- Shrinking At a glance by moving the trust/risk bullets down (conflicts with round-2 priority 2).
- Moving the spec-driven/ADL line out of At a glance (conflicts with round-3b decision 6).

---

## Phase 4: Guard against regressions (optional)

A small CI step that would have caught E2 and E3:

- [ ] Fail if `README-ro.md` contains common Romanian words without diacritics (`si`, `inca`, `facute`, `catre`, …).
- [ ] Fail if `README.md` and `README-ro.md` have different line counts.
- [ ] Fail if either README quotes a version that doesn't match `plugins/total-recall/package.json`.
- [ ] Optional: report prose word count against the budget (warning only).

---

## Recommendation and order

1. **Phases 1 and 2:** one docs PR now. Low-risk accuracy and language fixes.
2. **Phase 3 (persona round 4):** after that PR merges, on the fixed `main`. Output goes to `PLAN-README-PERSONA-OPTIMIZATION.md` §11 for approval.
3. **Apply the approved round-4 changes:** a separate PR.
4. **Phase 4:** optional, any time after Phase 1.

## Decisions needed

1. Run round 4 **after** the Phase 1/2 fixes (recommended) or on `1bcf15a` as the other review proposed.
2. Record round 4 as §11 of the existing persona plan (recommended, matches the process) or in a new file.
3. Word budget: keep ~2,050 / 2,075 and cut ~450 words, or set a new N.
4. Phase 4 guard: yes or no.

## Notes

- **No version bump needed.** These changes are documentation only. A fix at the same version is invisible to `claude plugin update`, but that doesn't matter for README text, which GitHub shows straight from `main`.
- **Check the other docs.** Per `plugins/total-recall/CLAUDE.md`, client-support claims in README/INSTALL must match `install.sh`. Re-check `plugins/total-recall/INSTALL.md` whenever the "Supported assistants" text changes.

## Checklist

- [ ] E1–E8 applied in both files
- [ ] Phase 2 RO fixes applied
- [ ] Anchors re-checked (especially if the L163 heading changes)
- [ ] EN/RO line counts still match
- [ ] Prose word count measured before and after
- [ ] Phase 1/2 PR opened and merged
- [ ] Round 4 run and written up as §11
