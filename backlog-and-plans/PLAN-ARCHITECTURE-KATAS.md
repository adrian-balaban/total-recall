# Plan — Architecture Katas pe repo-ul `total-recall`

**Data:** 2026-11-25 · **Stare:** ACTIVE · **Owner:** Adrian Balaban
**Repo sursă:** `/home/adrianb/_/in-progress/total-recall` — branch `main` @ `2ea8d53` (planul a fost verificat față de cod la acest commit)
**Înlocuiește:** `PLAN-ARCHITECTURE-KATAS-TOTAL-RECALL.md` din `cursuri/masterclassNealFord2026/` (șters la pivot; draft-urile orfane `sysops-squad/` și `monitor-me/` rămân ca material brut, neatinse).
**Motiv pivot:** katas-urile cursului (Make the Grade, Sysops Squad, Monitor Me) devin exerciții pe repo-ul real `total-recall`, nu în repo-uri separate. Repo-ul are deja un sistem AaC matur: 9 fișiere ADL de producție în `plugins/total-recall/architecture/adl/`, gate-ul `adl-coverage.test.ts` (plus `adl-consistency.test.ts`, `adl-repo-rules.test.ts`, `stressor-residues.test.ts`), fitness functions ArchUnitTS (`fitness.test.ts`), mutation gate, `capabilities.adl` + benchmark-ul cu buget (`scripts/loadtest.ts` + `scripts/loadtest-budget.json`), `GOVERNANCE.md`/`REVIEW.md`. Katas-urile nu se mai construiesc separat — se rulează chiar pe total-recall, cu fixture-uri sintetice în directoare temporare și prin gate-urile existente.

> **Convenție de căi:** căile din tabele fără prefix (`src/…`, `hooks/…`, `architecture/…`, `scripts/…`) sunt relative la `plugins/total-recall/`. Căile cu prefix (`katas/…`, `backlog-and-plans/…`, `.github/…`) sunt relative la rădăcina repo-ului.

## 0. Executive summary

`total-recall` devine „terenul de joacă” pentru architecture katas:

- **3 serii (4+4+3) + K12 final — 12 kata-uri în total (K1–K12)**, aplicate direct pe repo-ul real: S1 = K1–K4, S2 = K5–K8, S3 = K9–K11, K12 = finala de decizie.
- Aserțiunile `TR-*` din cele 9 fișiere ADL (ex: `TR-S1`, `TR-D5`, `TR-Q3`, `TR-P2`) sunt deja în `architecture/adl/` și sunt validate de `adl-coverage.test.ts` — katas-urile nu inventează un sistem paralel, exersează pe cel existent.
- Fiecare rundă = o sesiune (~1–1.5 h) = branch `feat/katas-kX` + PR prin gate-ul existent `.github/workflows/mutation.yml`: npm audit → typecheck → build (+ verificarea sincronizării versiunilor) → `test:coverage` (praguri 95/95/90/95) → `test:integration` → Stryker ≥ 65 → testele launcher-ului `npx` (`npm test` la rădăcină + `test/pack-guard.mjs`); în paralel, jobul `benchmark-smoke` (`LT_N=250`, buget impus). Testele de kata **nu** fac parte din acest gate: rulează în workflow-ul separat `.github/workflows/katas.yml` (§3.6), care nu blochează release-ul (`release.yml` pornește doar după `mutation`).
- **Load-bearing, nu wallpaper:** orice fitness function nouă protejează integritatea datelor, privacy (`privacy-filter`), atomicitatea scrierilor, crash safety — nu cosmetic.
- **Fail = feedback, nu bug:** fiecare aserțiune care pică primește o dispoziție explicită (fix implementation / revise ADL / exceptare cu expiry — formatul din `architecture/GOVERNANCE.md` §3).
- **ADL sandbox până la K12:** schițele stau în `katas/**/adl/*.adl` la rădăcina repo-ului — în afara scanului gate-urilor ADL (toate citesc doar `plugins/total-recall/architecture/adl/`) și ne-ship-uite (pachetul npm root publică doar `bin`; plugin-ul se distribuie din `plugins/total-recall/` prin branch-ul `release`). Promovarea se decide abia la K12, pe criteriile din `architecture/REVIEW.md` + checklist §1–12.
- **ID-uri de schiță, nu `TR-*`:** aserțiunile din sandbox poartă ID-uri `[K<n>-<nn>]` (ex: `# [K5-01]`). `validate_architecture` și `trace` le recunosc (acceptă orice tag `[A-Za-z][A-Za-z0-9_.-]*`), dar `adl-coverage` le ignoră (regex-ul lui e `TR-[A-Z][0-9]+`) — deci nici roșu în CI, nici ID-uri `TR-*` alocate prematur (vezi §3.6).
- **Două manifestări:** orice fitness function generat din ADL se verifică pe un caz care trece și unul care pică, înainte de a fi crezut (vezi §3.3 — „pică” înseamnă că testul demonstrează detecția, nu că CI-ul e roșu).
- **Integrarea dogfood:** fiecare kata rulează chiar plugin-ul pe materialele lui (`index_architecture`, `validate_architecture record:false`, `trace(id=...)`, `store_memory` cu `elements: ["assert:K*-*"]`). Constatările care nu se promovează acum intră în `backlog-and-plans/BACKLOG.md` cu trigger, ca la trecerea de compliance.

## 1. Structura programului

Livrabilul fiecărui kata, în formatul folderelor din curs (`make-the-grade-pages-28-29` … `73-74` — `answers.md` + `adl/*.adl`):

```
katas/                         (rădăcina repo-ului)
  s1-k1-structura/       ├─ answers.md   (scenariu, răspunsuri, dispoziții)
  s1-k2-calitate-cod/    └─ adl/*.adl   (schița ADL — sandbox, în afara gate-ului, ID-uri [K<n>-<nn>])
  ...
  s3-k11-echipa/         (la fel pentru K1–K11; K12 fără adl/ — doar bilanț și decizii)

plugins/total-recall/src/__tests__/katas/
  k1-*.test.ts …         (fitness functions de kata — workflow separat `katas.yml`, vezi §3.6)
```

| Serie | Kata | Ce se exersează pe total-recall | Reper ADL / fișierul real | Pagini curs (`AaC-2day_ex`) |
|---|---|---|---|---|
| **S1 — structură, cod, contracte** | **K1** | Entity Trap vs structura reală: singleton-urile din `state.ts`, junk drawers, versus partiția și dependențele interzise | `structure.adl` (`TR-S1..S15`), `src/state.ts`, `src/__tests__/architecture/components.ts` | 21–24 |
| | **K2** | Calitatea codului generat de agenți: complexitate ciclomatică + A/I/D, praguri agent vs uman | `code-quality.adl`, `src/__tests__/architecture/complexity.ts` + `complexity-baseline.json` | 28–29 |
| | **K3** | 3 canale de instalare (`npx` bootstrap / marketplace din branch-ul `release` / `--local`) + contracte STRICT/PERMISSIVE (tool schema, hook envelope `hooks.json` vs `hooks.gemini.json`, frontmatter, index.json) | `contracts.adl`, `src/__tests__/hooks-parity.test.ts` | 30–31 (canale cu cadențe de release diferite) + ghidul ADL (`AS STRICT`) |
| | **K4** | Repo-topologie & cod partajat: `install.sh` (root vs plugin), copia Gemini (`agy plugin install`, `--gemini`), branch-ul `release` (`.github/workflows/release.yml`) — tabelul share-vs-duplicate | `src/__tests__/architecture/adl-repo-rules.test.ts`, `src/__tests__/plugin-manifest.test.ts`, `TR-Q3` | 26–27 |
| **S2 — vault-ul ca bază de date** | **K5** | Matricea de scriere (index.json / sqlite / org vault / `.md`-uri) + privacy — „only written by” în ADL (modelul existent: `TR-W8`, un singur writer pentru `.index-cache.txt`; `TR-D1/D2` pentru vault-uri) | `data-governance.adl`, `src/privacy-filter.ts` | 33–38 |
| | **K6** | Org-sync ca saga: failure modes. Reconcilierea „nicio memorie pierdută sau duplicată după queue drain” **există deja** (`TR-W9`, `TR-W10`) — kata-ul o auditează față de saga din curs și caută failure modes neacoperite (`TR-W5`, `TR-W6`) | `workflows.adl`, `src/org-sync.ts` | 44–45 |
| | **K7** | Quanta & cuplaj: server MCP vs procesele hook vs CLI — marker files, polling-ul fix de 10 s (`DEFAULT_POLL_MS`), convenția `# edge: sync/async` (impusă de `adl-consistency.test.ts` pe `system.adl`) | `system.adl`, `src/auto-reconcile.ts` | 40–43 |
| | **K8** | Stressor × componentă: matricea **există deja** (`S1..S7` în `architecture-style.adl`, format impus de `TR-E1` / `stressor-residues.test.ts`). Kata-ul o confruntă cu stresorii lipsă (versiunea Node, config fără restart) și verifică reziduurile pentru Claude CLI change (S1), ABI sqlite (S2), 20k scale (S4) | `architecture-style.adl`, `capabilities.adl`, `runtime-safety.adl` | 66–67 (din blocul S3 — vezi §2) |
| **S3 — capabilități, agenți, echipe** | **K9** | Fitness functions înaintea arhitecturii: calitatea recall-ului e declarată nemăsurată în README („Retrieval quality is not yet measured”); eval harness = DEFERRED în BACKLOG | `capabilities.adl`, `scripts/eval/spec-eval.ts`, `scripts/loadtest.ts` | 52–53, 64–65 |
| | **K10** | „No memory may be lost”: supersede chain (`TR-D11`), ordinea `.md` → index (`TR-W3`), extracția PreCompact fără proveniență, `.md`-uri scrise neatomic (`fs.writeFileSync` în `src/tools/store.ts`, `src/tools/mutate.ts` — doar index-urile trec prin `atomicWrite`), index fără lock (decizie documentată în `src/persistence.ts`, `mergeRuntimeFieldsFromDisk`) | `workflows.adl`, `hooks/scripts/extract-and-store-memories.sh` | 35–36 (no-lost-answer reconciliation) |
| | **K11** | Echipa om + agenți: team ADL, istoria commit-urilor ca governance; verificările care nu pot fi deterministe rămân evaluări interactive (om/LLM), nu dovadă (checklist §9) | `architecture/GOVERNANCE.md`, `plugins/total-recall/CLAUDE.md` (rădăcina repo-ului nu are `CLAUDE.md`) | 47–50, 69–74 |
| | **K12 FINAL** | Bilanț: fiecare ASSERT de schiță → (a) promovat în `architecture/adl/` + test cu ID `TR-*` (procedura din §5), (b) verificare interactivă (om/LLM) consemnată în `architecture/REVIEW.md`, (c) respins cu motiv; checklist §1–12 reînnoit; §12 minimum release gate = acceptare | toate ADL-urile + `REVIEW.md` | 54–55, 62–63 + tot checklist-ul |

## 2. Surse și hartă

Toate în `/home/adrianb/_/in-progress/cursuri/masterclassNealFord2026/`. Paginile per kata sunt în coloana din §1; intervalele de mai jos sunt orientative — K8 (S2) folosește pp. 66–67, din blocul S3, iar K10 (S3) folosește pp. 35–36, din blocul S2.

| Material | Folosit la |
|---|---|
| `AaC-2day_ex.pdf/txt`, pp. 21–31 (structură vs implementare, repo-topologie, calitatea codului, in-flight change) | S1 (K1–K4) |
| `AaC-2day_ex.pdf/txt`, pp. 33–45 (data topology, guvernarea datelor, quanta, cuplaj, saga) | S2 (K5–K7), K10 |
| `AaC-2day_ex.pdf/txt`, pp. 47–74 (governance, fitness-driven, capabilities, schimbare constantă, echipe) | S3 (K9–K11), K8, K12 |
| `AaC-2day_ex.pdf/txt`, pp. 75–123 (ghidul ADL: directive, catalog de aserțiuni, pitfalls) | notația din toate rundele |
| `SECTIONS.md` — indexul pagini → folder → ce se produce | alegerea folderului-model per kata |
| `HTTAA-2day_ex_solutions.pdf/txt` — soluțiile oficiale | comparație după fiecare kata |
| `CC-AA-REF.pdf/txt` — referința ADL, scrisă pe exemple Sysops Squad | S2 |
| `ARCHITECTURE_AS_CODE_CHECKLIST.md` — 12 secțiuni + §12 minimum release gate + template review | K12 și acceptarea fiecărui kata |
| `TeamTopologies.pdf/txt` | K11 |
| `CALM.md` (FINOS CALM) | K12 — non-adoptarea revizuită, sau nu |
| `make-the-grade-pages-*` — 21 de foldere. Model de format = cele 18 de la pp. 28–74 (`answers.md` + `adl/`; 69–70 are doar `answers.md`). Cele de la pp. 21–27 folosesc o notație YAML ilustrativă (21–22 nu are nici `answers.md`) — doar conținut, nu format | formatul livrabilelor |
| `workshop2024/` — originea formatului de katas | fundal, doar citire |

## 3. Regulile programului (igiena repo-ului)

1. **Fără date reale.** Orice check nou se scrie exclusiv pe fixture-uri sintetice sub `os.tmpdir()` (convenția `src/__tests__/assert-tmp-path.ts`: orice operație distructivă în afara temp dir-ului aruncă eroare); nimic din vault-ul real nu intră în diff.
2. **Zero dependențe noi.** Orice test promovat folosește doar dependențele existente (vitest, ArchUnitTS, fast-check, tsx). Footprint-ul de runtime rămâne neatins: 2 dependențe hard (`@modelcontextprotocol/sdk`, `zod`) + 3 opționale (`@huggingface/transformers`, `better-sqlite3`, `sqlite-vec`).
3. **Două manifestări.** Orice fitness function generat din ADL se verifică pe un caz care trece și unul care pică, înainte de a fi crezut. Concret (`GOVERNANCE.md`: „a known-passing and a known-failing fixture”): două teste verzi — unul pe fixture-ul bun (check-ul nu raportează nimic), unul pe fixture-ul rău (check-ul raportează exact violarea așteptată). CI-ul nu se înroșește intenționat; `[TR-Q4]` (cel puțin o aserțiune) și `[TR-Q5]` (fără tautologii) se aplică și testelor de kata.
4. **Load-bearing walls, not wallpaper.** Se protejează integritatea datelor, privacy, atomicitatea scrierilor, crash safety — nu cosmetic.
5. **Fail = feedback, nu bug.** Fiecare aserțiune care pică primește o dispoziție explicită: fix implementation / revise ADL / exceptare temporară — intrare `DEFERRED` în `backlog-and-plans/BACKLOG.md` **cu dată de expirare** (`GOVERNANCE.md` §3; o exceptare expirată e Fail la următorul pas REVIEW).
6. **ADL sandbox până la K12.**
   - Schițele stau în `katas/**/adl/*.adl`; nu intră în `plugins/total-recall/architecture/adl/` (acolo gate-ul ar pune roșu imediat), în `dist/` sau în pachetele npm.
   - ID-urile de schiță au forma `[K<n>-<nn>]`, niciodată `[TR-…]`. Un test de kata poate cita un `[TR-xx]` **existent**, dar nu unul nou: `adl-coverage` pică pe orice `[TR-xx]` din numele unui test care nu are ASSERT în producție.
   - Testele de kata stau în `plugins/total-recall/src/__tests__/katas/` (vitest are rădăcina în `plugins/total-recall/`, deci un test pus în `katas/` la rădăcina repo-ului n-ar rula nicăieri și n-ar rezolva `archunit` din `node_modules`). Sunt excluse din suita implicită (`vitest.config.ts`, deci și din `test:coverage` din gate-ul `mutation`) și din Stryker (care rulează oricum doar allow-list-ul), și rulează prin `vitest.katas.config.ts` / `npm run test:katas` / `.github/workflows/katas.yml` (declanșat la schimbări în `katas/**`, `src/**`, `architecture/**`; `passWithNoTests` până apare primul kata). Regulile de igienă `[TR-Q4]`/`[TR-Q5]` și `adl-coverage` parcurg totuși directorul, deci se aplică și lor.
7. **Notația ADL** e cea din ghidul pp. 75–123: `DEFINE SYSTEM X AS id`, `ASSERT(...)`, indentarea = contenție. Se preferă `IS DEPENDENT ON` + `HAS NO DEPENDENCY ON` explicit în locul formei exclusiviste `IS ONLY DEPENDENT ON` (ghidul, „Prefer …”). `IS DEPENDENT ON` e o afirmație de existență: check-ul generat e „cel puțin o clasă”, nu o regulă per clasă. Observație: ADL-ul de producție scrie aserțiunile în limbaj natural, cu ID-ul ca sufix-comentariu (`ASSERT(Tool Registry depends only on State and Paths) # [TR-S6]`). Schițele pot folosi forma din ghid, dar la promovare (K12) se rescriu în stilul casei.
8. **Materialele externe rămân read-only.** Folderele `make-the-grade-pages-*`, `workshop2024/` și draft-urile orfane (`sysops-squad/`, `monitor-me/`) din masterclass nu se modifică — doar citire.

## 4. Mecanica unei runde de kata (per sesiune)

1. Citește scenariul și task-urile din materialul cursului (rândul corespunzător din §1 + sursele din §2; folderul-model din `SECTIONS.md`).
2. Scrie sau actualizează schița `katas/sX-kY-*/adl/*.adl` — aserțiuni cu ID-uri de schiță `# [KY-nn]`, fără `TR-*`.
3. Scrie fitness function-ul în `plugins/total-recall/src/__tests__/katas/kY-*.test.ts` (ArchUnitTS pe codul real sau check pe fixture sintetic sub `os.tmpdir()`), cu numele testelor purtând ID-ul de schiță (`it('[KY-nn] …')`), verificat known-pass + known-fail (§3.3).
4. Bucla dogfood:
   - `index_architecture` pe folderul kata, ca indexul să conțină doar schița.
   - `validate_architecture` cu `record:false` pe **rădăcina repo-ului** — doar acolo vede atât `katas/**/adl`, cât și testele din `plugins/total-recall/src/__tests__/katas/` (pe folderul kata, fiecare ID ar apărea fără test). `record:false` e obligatoriu: altfel fiecare eșec de schiță devine o memorie `troubleshooting/fitness-*` în vault-ul personal.
   - `trace(id=...)`, apoi `get_architecture_context(...)` înainte de orice generare de cod.
   - Deciziile de kata se salvează prin `store_memory` cu `elements: ["assert:KY-nn"]`.
   - Notă: hook-ul `architecture-change` se declanșează la orice editare de `.adl` (inclusiv în `katas/`) și propune `index_architecture` pe cwd — e de așteptat, nu e o eroare.
5. `answers.md` pentru rundă: întrebare → răspuns → dovezi (link către ADL/test).
6. Fiecare item nerezolvat primește una din cele 3 dispoziții — nicio lacună fără dispoziție.
7. PR `feat/katas-kX` → gate-uri → merge; constatările de produs care nu se promovează intră în `BACKLOG.md` cu trigger.

## 5. Cadență & validare

- **Un kata = o sesiune** (~1–1.5 h) = branch `feat/katas-kX` în total-recall.
- Comenzi de validare (aceleași ca în `mutation.yml`):

```bash
npm --prefix plugins/total-recall run typecheck
npm --prefix plugins/total-recall run test:coverage     # unit + adl-* + fitness, cu pragurile de coverage din CI (fără katas)
npm --prefix plugins/total-recall run test:katas        # fitness functions de kata (workflow `katas.yml`)
npm --prefix plugins/total-recall run test:integration  # face build și rulează pe bundle-ul real
npm --prefix plugins/total-recall run mutation          # Stryker ≥ 65 (break), la promovări de teste noi
npm test && node test/pack-guard.mjs                    # la rădăcină: launcher-ul npx + garda de pachet
```

- **Exit-checklist per rundă:** `git status` curat — working tree gol, zero artefacte de debugging (inclusiv `.stryker-tmp/`). Fiecare dispoziție are urma ei: fix implementation → commit în PR; revise ADL → diff-ul schiței; exceptare → intrare `DEFERRED` cu expiry în `BACKLOG.md`.
- **Promovare (doar la K12):** decizia se ia în `architecture/REVIEW.md`, pe baza dovezilor acumulate pe toate rundele. Pentru fiecare aserțiune promovată:
  1. Alocă următorul ID liber din seria potrivită. La `2ea8d53` acestea sunt `TR-S16`, `TR-D14`, `TR-W11`, `TR-R9`, `TR-P6`, `TR-Q12`, `TR-C10`, `TR-E2`.
  2. Mută ASSERT-ul în fișierul ADL de producție, în stilul casei (§3.7).
  3. Redenumește tag-ul testului din `[KY-nn]` în `[TR-xx]` și mută testul din `__tests__/katas/` lângă suita lui (de acolo intră în suita implicită și în gate-ul `mutation`).
  4. Dacă aserțiunea e reziduul unui stresor nou, adaugă linia `# S<n> …: residue TR-xx` în `architecture-style.adl` (formatul `TR-E1`).
  5. Șterge schița și testul de kata rămase.

## 6. Non-goals (explicit)

- Fără repo-uri/katas separate în `cursuri/masterclassNealFord2026/` — toate rundele se rulează pe total-recall.
- Fără import de cerințe din katas în produs (200k de studenți, brokeri, dispozitive medicale — doar surse de metodă; lecția §1.3 din `PLAN-ARCHITECTURE-AS-CODE-COMPLIANCE.md`).
- Fără microservices/broker/mesh — monolitul local-first rămâne non-negociabil.
- Fără CALM obligatoriu — rămâne doar stretch opțional la K12 (suportul a fost scos în 1.3.0, consemnat în `docs/SPEC-DRIVEN.md`); dacă e reîncercat, dependența stă la tooling/CI, nu la runtime.

---

_Planul e conceput să fie rulabil în sesiuni de kata (~1–1.5 h/rundă), pe gate-urile existente; orice fitness function nouă trebuie să aibă known-pass + known-fail + dispoziție explicită._
