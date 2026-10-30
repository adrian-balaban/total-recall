# 🧠 total-recall

**Asistentul tău AI (Claude, Gemini, Antigravity) uită totul la finalul fiecărei sesiuni. Acest plugin rezolvă problema.**

O memorie persistentă și căutabilă pentru Claude Code și Gemini/Antigravity. Memoriile sunt fișiere Markdown simple pe discul tău — pot fi căutate cu grep, versionate cu git, citibile în [Obsidian](https://obsidian.md/). Nimic nu părăsește mașina ta decât dacă îl etichetezi `org`.

[🇬🇧 English](README.md) · 🇷🇴 Română

## ⚡ TL;DR

- **Ce este** — un plugin care dă asistentului AI o memorie persistentă: memoriile se salvează pe computerul tău și supraviețuiesc între sesiuni, deci nu mai reexplici aceleași lucruri. Pentru Claude Code și Gemini/Antigravity: 22 de unelte MCP (17 pentru memorie, 5 pentru lucrul spec-driven cu arhitectura) peste un vault de fișiere Markdown din `~/.total-recall`.
- **Ce face pentru tine** — injectează memoriile relevante la începutul fiecărei sesiuni și capturează automat deciziile și preferințele pe măsură ce lucrezi și înainte de fiecare compactare a contextului, ca să nu repeți același context.
- **Și spec-driven** — memoriile pot fi legate de o specificație: etichetezi orice decizie, cerință sau eșec cu un `system`, `elements` la care se referă și un ID în `requirements`, apoi cauți după element sau urmărești o cerință până la deciziile ei. Pentru asta nu ai nevoie de ADL. Dacă proiectul își ține și arhitectura ca cod (ADL), uneltele leagă în plus fiecare regulă de testele care o impun. Vezi [Lucru spec-driven](#-lucru-spec-driven-cu-adl).
- **Cum caută** — hibrid: TF-IDF × curba uitării Ebbinghaus, plus căutare semantică opțională; degradează curat la căutare de text dacă căutarea semantică nu e activată.
- **Confidențialitate** — local-first. Vault-ul personal nu părăsește mașina; doar ce etichetezi `org` trece printr-un filtru fail-closed spre un repo Git comun.
- **Instalare** — `/plugin marketplace add adrian-balaban/total-recall`, `/plugin install total-recall`, apoi `./install.sh` o singură dată. Node.js 18+, Linux · macOS · Windows (Git Bash).
- **Amprentă** — ~1–2 MB, două dependențe de producție (SDK-ul MCP și Zod). Modelul semantic de ~200 MB se descarcă doar dacă activezi căutarea semantică.
- **Status** — v1.3.3, stabilă: 894 teste trec, Test Coverage 96.3% statements, Mutation tests ≈78%.

![Bucla sesiunii](docs/diagrams/session-loop-ro.svg)

## 📡 Thoughtworks Technology Radar Vol. 34

Mai multe tehnici din [Thoughtworks Technology Radar](https://www.thoughtworks.com/radar)
([Vol. 34, 2026 — PDF](https://www.thoughtworks.com/content/dam/thoughtworks/documents/radar/2026/04/tr_technology_radar_vol_34_en_1.pdf)) sunt deja implementate aici, ca decizii de design luate independent:

| Tehnică | Inel | Cum o face Total Recall |
|---|---|---|
| Progressive context disclosure + Context engineering | Trial + Adopt | SessionStart injectează doar indexul memoriilor; conținutul complet se citește la cerere |
| Mutation testing | Trial | Poartă Stryker în CI (vezi [Status](#-status)) |
| Claude Code plugin marketplace | Trial | distribuție bazată pe git, fără drift de versiune; singurul canal din v1.1.19, alimentat de un branch construit în CI |
| Structured output from LLMs | Adopt | hook-ul de captură cere modelului linii JSON, nu text liber |
| MCP by default | Hold | operațiile de sistem (git, indexare) rămân în scripturi simple, nu în unelte MCP |

**Trei direcții viitoare**, fiecare în [BACKLOG.md](BACKLOG.md) cu declanșator:
un graf de context peste memorii (lanțul `supersededAt` stochează deja muchii temporale);
extracție ancorată în sursă pentru hook-ul de captură; un set de evaluare pentru `recall_memory`.

## ⚙️ Cum funcționează

| | |
|---|---|
| **22 de unelte MCP** | stocare, recuperare, căutare hibridă, reranking semantic, export/import în masă și 5 unelte de arhitectură pentru proiecte cu ADL |
| **Căutare hibridă** | TF-IDF × curba uitării Ebbinghaus, combinată opțional cu embeddings vectoriale |
| **Hook-uri de ciclu de viață** | context injectat la începutul sesiunii, memorii capturate pe măsură ce lucrezi |
| **Două vault-uri** | cel personal rămâne local; cel etichetat `org` se sincronizează cu un repo Git comun |

- **Caracteristica principală:** la SessionStart se injectează doar indexul memoriilor; memoriile complete se citesc la cerere prin `get_memories_by_keys`.
- **Captură PreCompact:** 0–3 lecții sunt extrase din conversație înainte de compactarea contextului și salvate.
- **Reîncărcare live:** memoriile pe care un coleg le trimite în vault-ul org apar în sesiunea ta fără restart.
- **Arhivare, nu ștergere:** versiunile înlocuite ale unei memorii sunt păstrate.

![Rutarea store_memory](docs/diagrams/store-routing-ro.svg)

Diagramele C4 (context → containere → componente → cod), harta modulelor, modelul de date,
secvența de pornire, pipeline-ul de căutare și ciclul de viață al hook-urilor sunt documentate în
**[ARCHITECTURE.md](plugins/total-recall/ARCHITECTURE.md)**.

## 🛠️ Cele 22 de unelte

| Grup | Unelte |
|---|---|
| **Salvare** | `store_memory` |
| **Căutare** | `recall_memory`, `search_index` |
| **Citire** | `list_memories`, `get_memories_by_keys`, `get_stats`, `get_timeline`, `get_related_memories` |
| **Modificare** | `update_memory`, `delete_memory`, `confirm_memory`, `rebuild_index`, `prune_memories` |
| **Reordonare** | `rerank_memories` |
| **Operații în masă** | `export_memories`, `import_memories`, `delete_memories` |
| **Arhitectură** (spec-driven, se poate dezactiva) | `index_architecture`, `get_architecture_context`, `trace`, `get_architecture_history`, `validate_architecture` |

### 📐 Lucru spec-driven cu ADL

Total Recall reține ce nu spune o specificație: de ce există fiecare regulă, ce variante au fost respinse, ce verificări au picat și cum au fost reparate. Funcționează la două niveluri:

- **Doar cu memorii.** Orice memorie poate purta `system`, `artifact` (`spec`, `adr`, `fitness-result`, …), `elements`, `requirements` și `status`. `recall_memory` și `search_index` filtrează după `elements`, `get_related_memories` urmărește elementele comune, iar un ID de cerință leagă între ele deciziile ei. Nu e nevoie de fișiere ADL și nici de index.
- **Cu ADL în plus.** Când proiectul își ține arhitectura ca cod, cele cinci unelte de arhitectură de mai jos se sprijină pe aceleași memorii. Fișierele rămân în repository, ca sursă de adevăr.

- `index_architecture` citește fișierele `*.adl` ale proiectului într-o memorie de rezumat pentru fiecare sistem (elemente, aserțiuni și conexiunile declarate cu `DEFINE COMMUNICATION`) și leagă fiecare aserțiune ADL de testele care îi poartă ID-ul.
- `get_architecture_context`, `trace` și `get_architecture_history` întorc regulile, relațiile, deciziile, eșecurile și schimbările pentru un element, o cerință sau o aserțiune.
- `validate_architecture` rulează verificarea acoperirii ADL cu teste și înregistrează fiecare eșec și rezolvarea lui.
- Memoriile pot avea `system`, `elements`, `requirements` și alte câteva câmpuri opționale. `recall_memory` și `search_index` filtrează după `elements`.
- Hook-urile adaugă un scurt rezumat al arhitecturii la începutul sesiunii și cer înregistrarea schimbării când se editează un fișier `.adl`.
- Skill-ul `spec-driven-workflow` descrie întregul ciclu și are șabloane de pornire.

Totul se configurează în blocul `specDriven` din `~/.total-recall/config.json`, iar `"specDriven": {"enabled": false}` readuce exact comportamentul cu 17 unelte. Cheile sunt descrise în [README-ul pluginului](plugins/total-recall/README.md#-spec-driven-architecture-adl).

## 📐 Arhitectura ca cod: ADL

Total Recall își descrie propria arhitectură în ADL, atât la nivelul de cod (module, dependențe, reguli de date), cât și la nivelul de sistem (cine cu cine comunică). Build-ul pică atunci când codul se abate de la ea. [Uneltele spec-driven](#-lucru-spec-driven-cu-adl) lucrează cu aceeași notație și în proiectele tale.

### ADL: Architecture Definition Language

ADL este notația folosită la masterclass-ul [**„How to Teach Your Agents About Architecture"**](https://codecamp.ro/masterclasses/how-to-teach-your-agents-about-architecture-iasi-2026/), ținut de Neal Ford la Codecamp Iași (27–28 octombrie 2026).

- **Ce este.** Un mod ușor, apropiat de pseudocod, de a scrie o arhitectură, fără gramatică formală. Liniile `DEFINE` numesc sistemul, domeniile și componentele lui. Liniile `ASSERT(…)` enunță regulile pe care codul trebuie să le respecte, în engleză simplă acolo unde e mai clar așa.
- **Cine îl citește.** Oamenii îl citesc ca documentație scurtă, care se învechește mai greu decât o diagramă. Agenții AI îl citesc drept context când scriu cod și drept specificație după care verifică codul.
- **Cum se impune.** Un fișier ADL nu se execută niciodată. Fiecare aserțiune e verificată de un test scris pentru ea (o fitness function), de exemplu cu ArchUnitTS în acest repository.

Exemplul de mai jos vine din fișierul [structure.adl](plugins/total-recall/architecture/adl/structure.adl) al acestui repository, nu din curs:

```
DEFINE SYSTEM Total Recall AS tr
    DEFINE COMPONENT Pure Helpers AS helpers
    DEFINE COMPONENT Tools AS tools
ASSERT(Pure Helpers have no dependency on any other component) # [TR-S1]
```

Eticheta `# [TR-S1]` este o convenție Total Recall, nu face parte din ADL. Testul care impune regula are aceeași etichetă în nume, iar `adl-coverage.test.ts` pică atunci când o aserțiune nu are test.

> Materialul cursului nu este publicat aici: nici slide-uri, nici exerciții, nici ghidul de referință, nici soluții. Secțiunea descrie ideea cu propriile noastre cuvinte, iar toate exemplele sunt din acest repository.

Nivelul de sistem este în [system.adl](plugins/total-recall/architecture/adl/system.adl): host-ul, serverul MCP, hook-urile, embedder-ul local și remote-ul git al organizației, plus liniile `DEFINE COMMUNICATION` care le leagă de cele două vault-uri. `adl-consistency.test.ts` pică atunci când o conexiune numește un element nedefinit.

> **Notă.** Versiunile anterioare descriau nivelul de sistem și într-un document [CALM](https://calm.finos.org/), validat în CI cu `@finos/calm-cli`. Suportul CALM a fost eliminat în 1.3.0; fișierele `.calm.json` nu mai sunt indexate.

Detalii: [ARCHITECTURE.md → Architecture as code](plugins/total-recall/ARCHITECTURE.md#-architecture-as-code).

## 💡 Ce se salvează automat

Observații de lucru (ce a mers, ce nu) · context de proiect neevident (motivații, constrângeri,
decizii non-triviale) · un prompt de sfârșit de sesiune „ceva demn de reținut?".

Nu se salvează: fragmente de cod, căi de fișiere, istoric git — toate derivabile din spațiul de lucru. (Singura excepție e intenționată: o memorie de specificație sau de arhitectură poate reține calea relativă în repo și commit-ul fișierului pe care îl rezumă, ca pointer în frontmatter, niciodată în text.)

## 🥇 Folosește-l ca unic sistem de memorie

Claude Code vine cu propria memorie bazată pe fișiere (un director `memory/` cu un index
`MEMORY.md`), iar unele configurații adaugă un istoric `.remember/`. Dacă vrei ca Total Recall
să fie singura sursă de adevăr, spune-o în `~/.claude/CLAUDE.md` **global**:

```markdown
## Memory
Use total-recall exclusively for all memories, in every project.
- Store via `store_memory` / `update_memory`; recall via `recall_memory` / `search_index`.
- NEVER use the harness file-based memory (`memory/`, `MEMORY.md`) or `.remember/`.
- If total-recall is unavailable, tell me and skip persisting — do not silently fall back.
```

**De ce funcționează:** prioritatea instrucțiunilor este `CLAUDE.md`-ul tău > skill-uri >
valorile implicite ale harness-ului, deci instrucțiunea ta bate hook-urile și prompturile
implicite care încurajează memoria încorporată.

**Ordinea de recuperare, de la cel mai ieftin:** indexul injectat (deja în context) →
`get_memories_by_keys` → `search_index` → `recall_memory`.

Skill-ul `total-recall:memory-workflow` (ordinea de recuperare, deduplicare, `importanceScore`,
etichetare org) este material de referință opțional, nu o dependență.

## 🚀 Instalare

Dintr-o sesiune Claude Code:

```
/plugin marketplace add adrian-balaban/total-recall
/plugin install total-recall
```

apoi rulează `./install.sh` o singură dată, din directorul plugin-ului instalat, pentru a crea
vault-urile și a înregistra serverul MCP.

Linux · macOS · Windows (Git Bash) · Node.js 18+. Gemini/Antigravity, clone locale și profilul
minimal (fără vectori): **[INSTALL.md](plugins/total-recall/INSTALL.md)**

**Marketplace-ul este singurul canal de distribuție** — fără zip, fără pachet npm. Se
instalează branch-ul `release`, al cărui bundle este construit de GitHub Actions după ce poarta CI devine verde; `dist/` este ignorat pe `main`, deci niciun artefact construit manual nu poate fi livrat.

### 🔗 Amprentă

Două dependențe de producție — SDK-ul MCP și Zod. Trei opționale alimentează
căutarea semantică (`@huggingface/transformers`, `better-sqlite3`, `sqlite-vec`)
și sunt aduse doar dacă o activezi.

| | |
|---|---|
| **Plugin** | ~1–2 MB |
| **Model opțional pentru căutare semantică „multi-language"** | ~200 MB, descărcat la prima utilizare |

## 📦 Ce se livrează vs. ce e doar pentru contributori

<details>
<summary>Fișiere de runtime, doar pentru vault-ul org, doar pentru contributori</summary>

- **Runtime (întotdeauna):** manifestele (`plugin.json`, `.mcp.json`, `package.json`), `dist/index.js`, `dist/frontmatter.mjs`, `hooks/hooks.json` și scripturile de index de la SessionStart.
- **Runtime doar pentru utilizatorii vault-ului org:** `sync-org-memory.*`, `pull-org-vault.sh`, `check-sync-errors.sh`, `dist/privacy-filter.mjs`, `atomic-write.mjs`.
- **Doar pentru contributori:** `src/`, teste, configurații vitest/stryker, `tsconfig.json`, `CLAUDE.md`, `ARCHITECTURE.md`.

Ieșirea generată (`node_modules/`, `coverage/`, `reports/`, `.remember/`) este ignorată de git și poate fi ștearsă fără grijă. `dist/` este construit de CI, nu este comis.

</details>

## 🧭 Principii de design

- **Local-first** — memoriile sunt pe mașina ta, nu în cloud.
- **Lizibil** — fiecare memorie este un fișier Markdown pe care îl poți edita în orice editor.
- **Versionabil** — vault-ul de echipă este susținut de git; vault-ul personal rămâne local.
- **Fără infrastructură** — niciun server sau bază de date externă. Fișierele Markdown sunt
  sursa adevărului.
- **Tolerant la erori** — degradează la căutare de text dacă căutarea semantică nu este disponibilă.

## 📊 Status

| | |
|---|---|
| **Versiune** | 1.3.3 — stabilă |
| **Teste** | 894 unitare + 24 de integrare, toate trec · 64 fișiere · ~15k linii de cod de test |
| **Test Coverage** | 96.3% statements · 90.3% branches · 97.9% lines |
| **Mutation tests** | ≈78% (Stryker, 15 module de bază) · variază ~±1 pt de la o rulare la alta · poarta eșuează sub 65% |
| **CI** | [`mutation.yml`](.github/workflows/mutation.yml) — audit + typecheck + build + suitele complete unitare și de integrare + Stryker la fiecare push/PR pe `main`. Singurul pipeline de build; nimic nu este verificat local |
| **Release-uri** | [`release.yml`](.github/workflows/release.yml) — construiește `dist/` și publică branch-ul `release` de pe care instalează marketplace-ul; taguri + note când versiunea se schimbă |
| **Audit** | 0 critice în dependențele de producție |

Mutation testing verifică dacă testele sunt într-adevăr bune: Stryker schimbă deliberat lucruri mici în cod (`>` devine `<`, `true` devine `false`), iar o suită de teste care nu pică atunci nu este suficient de strictă.

Reproducere: `npm test` · `npm run test:coverage` · `npm run test:integration` · `npm run mutation`
(din `plugins/total-recall/`)

### ⚠️ Probleme cunoscute

- **Conținutul vault-ului org este injectat nefiltrat în contextul fiecărui coleg.** La
  SessionStart vault-ul org este adus cu `git pull`, iar indexul lui de memorii ajunge direct
  în contextul modelului. Oricine are drept de push în repo-ul comun poate deci plasa text,
  inclusiv text cu formă de instrucțiuni, în sesiunea fiecărui coleg. Filtrul de
  confidențialitate protejează doar push-ul spre exterior; nimic nu izolează conținutul care
  intră. Până la remediere, dă drept de push în vault-ul org doar persoanelor de încredere și
  protejează-i branch-ul. Vezi [SECURITY.md](SECURITY.md).
- **Două module au teste care ating codul, dar nu îi verifică logica.** Scorul de mutație pe
  modul divergă puternic de acoperire: `embeddings.ts` 50.6% și
  `persistence.ts` 55.1%. Cazul instructiv e `persistence.ts` — 86.3% acoperire la doar 55.1%
  mutație, cu 120 mutanți supraviețuitori: testele execută codul, dar nu ar observa dacă
  s-ar strica. Acoperirea singură ar fi ratat asta; de aceea poarta se uită la mutație.
- **Scorul de Mutation tests nu este reproductibil de la o rulare la alta.** Două rulări CI fără nicio
  modificare la vreun fișier sursă mutat au raportat 65.39% și 66.39% — aproximativ ±1 punct
  de variație, cel mai probabil din mutanți care expiră (timeout) sub încărcare variabilă a runner-ului. Nu
  citi o singură cifră zecimală ca fiind precisă. Marja peste pragul de 65% a fost
  extinsă la aproximativ 3 puncte în v1.1.22 (cinci module aduse de la
  0–75% la 93–100%, +34 mutanți uciși), astfel încât variația obișnuită nu mai riscă o
  poartă CI roșie — ceea ce contează pentru că o poartă roșie reține în tăcere branch-ul `release`
  în loc să livreze ceva stricat.

---

📖 **[Documentație completă](plugins/total-recall/README.md)** ·
🏗️ **[Arhitectură](plugins/total-recall/ARCHITECTURE.md)** ·
📦 **[Ghid de instalare](plugins/total-recall/INSTALL.md)** ·
🎤 **[Prezentare: Claude vs Ollama & Total Recall](https://github.com/adrian-balaban/presentation-claude-vs-ollama-and-total-recall-plugin-21-07-2026)** (Română, Iul 2026)
