# Plan — Architecture Katas pe repo-ul `total-recall`

**Data:** 2026-11-25 · **Stare:** ACTIVE · **Owner:** Adrian Balaban
**Repo sursă:** `/home/adrianb/_/in-progress/total-recall` — branch `main` @ `2ea8d53`
**Înlocuiește:** `PLAN-ARCHITECTURE-KATAS-TOTAL-RECALL.md` din `cursuri/masterclassNealFord2026/` (șters la pivot; draft-urile orfane `sysops-squad/` și `monitor-me/` rămân ca material brut, neatinse).
**Motiv pivot:** katas-urile cursului (Make the Grade, Sysops Squad, Monitor Me) devin exerciții pe repo-ul real `total-recall`, nu în repo-uri separate. Repo-ul are deja un sistem AaC matur: 9 fișiere ADL de producție în `plugins/total-recall/architecture/adl/`, gate-ul `src/__tests__/architecture/adl-coverage.test.ts`, fitness functions ArchUnitTS (`fitness.test.ts`), mutation gate, `capabilities.adl` + budget-benchmark, `GOVERNANCE.md`/`REVIEW.md`. Katas-urile nu se mai construiesc separat — se rulează chiar pe total-recall, cu fixture-uri sintetice în `tmp/` și prin gate-urile existente.

## 0. Executive summary

`total-recall` devine „terenul de joacă” pentru architecture katas:

- **3 serii (4+4+3) + K12 final — 12 kata-uri în total (K1–K12)**, aplicate direct pe repo-ul real: S1 = K1–K4, S2 = K5–K8, S3 = K9–K11, K12 = finala de decizie.
- Aserțiunile `TR-*` din cele 9 fișiere ADL (ex: `TR-S1`, `TR-D5`, `TR-Q3`, `TR-P2`) apar deja în `plugins/total-recall/architecture/adl/` și sunt validate de `adl-coverage.test.ts` — katas-urile nu inventează un sistem paralel, exersează pe cel existent.
- Fiecare rundă = o sesiune (~1–1.5 h) = branch `feat/katas-kX` + PR prin gate-urile existente (typecheck → build → coverage → integration → Stryker ≥ 65 → launcher tests).
- **Load-bearing, nu wallpaper:** orice fitness function nouă protejează integritatea datelor, privacy (`privacy-filter`), atomicitatea scrierilor, crash safety — nu cosmetic.
- **Fail = feedback, nu bug:** fiecare aserțiune care pică primește o dispoziție explicită (fix implementation / revise ADL / exemțiune cu expiry — formatul din `architecture/GOVERNANCE.md`).
- **ADL sandbox până la K12:** schițele stau în `katas/**/adl/*.adl` la rădăcina repo-ului — în afara scanului gate-ului `adl-coverage` (el scanează doar `plugins/total-recall/architecture/adl/`) și ne-ship-uite (pachetul npm root publică doar `bin`; plugin-ul se package-uiește din `plugins/total-recall/`). Promovarea se decide abia la K12, pe criteriile din `architecture/REVIEW.md` + checklist §1–12.
- **Două manifestări:** orice fitness function generat din ADL se verifică pe un caz care trece și unul care pică, înainte de a fi crezut.
- **Integrarea dogfood:** fiecare kata rulează chiar plugin-ul pe materialele lui (`index_architecture`, `validate_architecture record:false`, `trace(id=...)`, `store_memory` cu `elements: ["assert:TR-*"]`). Constatările care nu se promovează acum intră în `backlog-and-plans/BACKLOG.md` cu trigger, ca la trecerea de compliance.

## 1. Structura programului

Livrabilul fiecărui kata, în formatul folderelor din curs (`make-the-grade-pages-*` — `answers.md` + `adl/*.adl`):

```
katas/
  s1-k1-structura/       ├─ answers.md   (scenariu, răspunsuri, dispoziții)
  s1-k2-calitate-cod/    └─ adl/*.adl   (schița ADL — sandbox, în afara gate-ului)
  ...
  s3-k11-echipa/         (la fel pentru K1–K11; K12 fără adl/ — doar bilanț și decizii)
```

| Serie | Kata | Ce se exersează pe total-recall | Reper ADL / fișierul real |
|---|---|---|---|
| **S1 — structură, cod, contracte** | **K1** | Entity Trap vs structura reală: singleton-urile din `state.ts`, junk drawers, versus partiția și dependențele interzise | `structure.adl`, `src/state.ts` |
| | **K2** | Calitatea codului generat de agenți: complexitate ciclică + A/I/D, praguri agent vs uman | `code-quality.adl`, `__tests__/architecture/complexity.ts` |
| | **K3** | 3 canale de instalare (`npx` bootstrap / marketplace-release / `--local`) + contracte STRICT/PERMISSIVE (tool schema, hook envelope, frontmatter, index.json) | `contracts.adl`, `hooks-parity.test.ts` |
| | **K4** | Repo-topologie & cod partajat: `install.sh`, copia Gemini (`agy`), release branch — tabelul share-vs-duplicate | `adl-repo-rules.test.ts`, `plugin-manifest.test.ts` |
| **S2 — vault-ul ca bază de date** | **K5** | Matricea de scriere (index.json / sqlite / org vault / `.md`-uri) + privacy — „only written by" în ADL | `data-governance.adl`, `privacy-filter.ts` |
| | **K6** | Org-sync ca saga: failure modes + reconcilierea „nicio memorie pierdută sau duplicată" după queue drain | `workflows.adl`, `org-sync.ts` |
| | **K7** | Quanta & cuplaj: server MCP vs procesele hook vs CLI — marker files, polling de 10 s, convenția `# edge:` | `system.adl`, `auto-reconcile.ts` |
| | **K8** | Stressor × componentă (Claude CLI change, ABI sqlite, versiune Node, 20k scale, config fără restart) + reziduuri | `capabilities.adl`, `runtime-safety.adl` |
| **S3 — capabilități, agenți, echipe** | **K9** | Fitness functions înaintea arhitecturii: calitatea recall-ului e declarată nemăsurată în README; eval harness = DEFERRED în BACKLOG | `capabilities.adl`, `scripts/eval/spec-eval.ts` |
| | **K10** | „No memory may be lost": supersede chain, extracția PreCompact fără proveniență, `.md`-uri neatomice, index fără lock | `workflows.adl`, `hooks/scripts/` |
| | **K11** | Echipa om + agenți: team ADL, istoria commits-urilor ca governance — modul interactive | `architecture/GOVERNANCE.md`, `CLAUDE.md` |
| | **K12 FINAL** | Bilanț: fiecare ASSERT de schiță → (a) promovat în `plugins/total-recall/architecture/adl/` + test cu ID `TR-*`, (b) scenariu interactive în `architecture/REVIEW.md`, (c) respins cu motiv; checklist §1–12 reînnoit; §12 minimum release gate = accepțiune | toate ADL-urile + `REVIEW.md` |

## 2. Surse și hartă

| Material (în `cursuri/masterclassNealFord2026/`) | Folosit la |
|---|---|
| `AaC-2day_ex.pdf/txt`, pp. 21–31 (structură vs implementare, calitatea codului, in-flight change) | S1 (K1–K4) |
| `AaC-2day_ex.pdf/txt`, pp. 33–45 (data topology, guvernarea datelor, quanta, cuplaj, saga) | S2 (K5–K8) |
| `AaC-2day_ex.pdf/txt`, pp. 47–74 (governance, fitness-driven, capabilities, schimbare constantă, echipe) | S3 (K9–K11) |
| `AaC-2day_ex.pdf/txt`, pp. 75–123 (ghidul ADL: directive, catalog de aserțiuni, pitfalls) | notația din toate rundele |
| `HTTAA-2day_ex_solutions.pdf/txt` — soluțiile oficiale | comparație după fiecare kata |
| `CC-AA-REF.pdf/txt` — referința ADL, scrisă pe exemple Sysops Squad | S2 |
| `ARCHITECTURE_AS_CODE_CHECKLIST.md` — 12 secțiuni + §12 minimum release gate + template review | K12 și accepținea fiecărui kata |
| `TeamTopologies.pdf/txt` | K11 |
| `CALM.md` (FINOS CALM) | K12 — non-adoptarea revizuită, sau nu |
| `make-the-grade-pages-*` — cele 21 de foldere model (`answers.md` + `adl/`) | formatul livrabilelor |
| `workshop2024/` — originea formatului de katas | fundal, doar citire |

## 3. Regulile programului (igiena repo-ului)

1. **Fără date reale.** Orice check nou se scrie exclusiv pe fixture-uri sintetice în directoare temporare (convenția `assert-tmp-path.ts`); nimic din vault-ul real nu intră în diff.
2. **Zero dependențe noi.** Orice test promovat folosește doar dependențele existente (vitest, ArchUnitTS, tsx) — filosofia one-hard-dependency a repo-ului rămâne neatinsă.
3. **Două manifestări.** Orice fitness function generat din ADL se verifică pe un caz care trece și unul care pică, înainte de a fi crezut.
4. **Load-bearing walls, not wallpaper.** Se protejează integritatea datelor, privacy, atomicitatea scrierilor, crash safety — nu cosmetic.
5. **Fail = feedback, nu bug.** Fiecare aserțiune care pică primește o dispoziție explicită: fix implementation / revise ADL / exemțiune cu dată de expirare.
6. **ADL sandbox până la K12.** Schițele stau în `katas/**/adl/*.adl`; nu intră în `plugins/total-recall/architecture/adl/` (acolo gate-ul ar pune roșu imediat), în `dist/` sau în pachetele npm.
7. **Notația ADL** e cea din ghidul pp. 75–123: `DEFINE SYSTEM X AS dir`, `ASSERT(...)`, indentarea = contenție, `IS DEPENDENT ON` = „cel puțin o clasă" (existență), niciodată forma exclusivistă `IS ONLY DEPENDENT ON`.
8. **Materialele externe rămân read-only.** Folderele `make-the-grade-pages-*`, `workshop2024/` și draft-urile orfane (`sysops-squad/`, `monitor-me/`) din masterclass nu se modifică — doar citire.

## 4. Mecanica unei runde de kata (per sesiune)

1. Citește scenariul și task-urile din materialul cursului (rândul corespunzător din §1 + sursele din §2).
2. Scrie sau actualizează schița `katas/sX-kY-*/adl/*.adl` — aserțiuni fără ID-uri `TR-*` (sandbox).
3. Scrie fitness function-ul (ArchUnitTS pe codul real sau check pe fixture sintetic), verificat known-pass + known-fail.
4. Bucla dogfood: `index_architecture` pe folderul kata → `validate_architecture record:false` → `trace(id=...)` → `get_architecture_context(...)` înainte de orice generare de cod; deciziile de kata se salvează prin `store_memory` cu `elements: ["assert:<ID-schiță>"]`.
5. `answers.md` pentru rundă: întrebare → răspuns → dovezi (link către ADL/test).
6. Fiecare item nerezolvat primește una din cele 3 dispoziții — nicio lacună fără dispoziție.
7. PR `feat/katas-kX` → gate-uri → merge; constatările de produs care nu se promovează intră în `BACKLOG.md` cu trigger.

## 5. Cadență & validare

- **Un kata = o sesiune** (~1–1.5 h) = branch `feat/katas-kX` în total-recall.
- Comenzi de validare:

```bash
npm --prefix plugins/total-recall run typecheck
npm --prefix plugins/total-recall run test              # unit + adl-coverage + fitness
npm --prefix plugins/total-recall run test:integration  # pe bundle-ul real
npm --prefix plugins/total-recall run mutation          # Stryker ≥ 65, la promovări de teste noi
```

- **Exit-checklist per rundă:** `git status` curat — working tree gol, zero artefacte de debugging; fiecare dispoziție are expiry precizat.
- **Promovare:** abia la K12, cu ID-uri `TR-*` reale; decizia se ia în `architecture/REVIEW.md`, pe baza dovezilor acumulate pe toate rundele.

## 6. Non-goals (explicit)

- Fără repo-uri/katas separate în `cursuri/masterclassNealFord2026/` — toate rundele se rulează pe total-recall.
- Fără import de cerințe din katas în produs (200k de studenți, brokeri, dispozitive medicale — doar surse de metodă; lecția §1.3 din `PLAN-ARCHITECTURE-AS-CODE-COMPLIANCE.md`).
- Fără microservices/broker/mesh — monolitul local-first rămâne non-negociabil.
- Fără CALM obligatoriu — rămâne doar stretch opțional la K12 (suportul a fost scos în 1.3.0, consemnat în `docs/SPEC-DRIVEN.md`); dacă e reîncercat, dependența stă la tooling/CI, nu la runtime.

---

*Planul e conceput să fie rulatabil în sesiuni de kata (~1–1.5 h/rundă), pe gate-urile existente; orice fitness function nouă trebuie să aibă known-pass + known-fail + dispoziție explicită.*