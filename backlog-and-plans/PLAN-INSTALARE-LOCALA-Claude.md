# PLAN — Instalare directă cu build local după `git clone`

**Status:** draft, nepornit · **Data:** 2026-11-09 · **Branch:** `main` · **Autor:** Claude (Opus 5.5)
**Deliverabil:** după `git clone`, o singură comandă (`./install.sh` în rădăcina repo-ului) construiește pluginul local și îl instalează ca plugin Claude Code complet, cu hooks și MCP. Dacă `claude` lipsește, îl instalează ca server MCP standalone. Fără marketplace-ul de pe GitHub și fără branch-ul `release`.

> Documentul e în română pentru autor. Codul, mesajele CLI și documentația repo-ului rămân în engleză.

---

## 1. Rezumat

Ideea centrală este un **„release local"**: reproducem pe mașina utilizatorului ce face `release.yml` (arbore curat + `dist/` construit) și îl expunem printr-un **marketplace local de tip director**. Claude Code instalează din el exact ca din marketplace-ul de producție. `install.sh` rulează apoi pe copia din cache, ca în fluxul npx de azi.

```bash
git clone https://github.com/adrian-balaban/total-recall.git
cd total-recall
./install.sh -y            # = node bin/cli.mjs --local . -y
```

---

## 2. Fapte verificate (spike real, 2026-11-09)

Spike-ul a rulat pe Claude Code **2.1.220**, cu `HOME` temporar (instalarea reală a utilizatorului nu a fost atinsă). Faptele de cod au fost citite în repo.

| # | Fapt | Consecință |
|---|---|---|
| F1 | `claude plugin install <cale>` **eșuează**: `Plugin "<cale>" not found in any configured marketplace`. `install` acceptă doar `plugin` sau `plugin@marketplace`. | `INSTALL.md` § „Developing from a clone" (`claude plugin install "$(pwd)"`) și `plugins/total-recall/CLAUDE.md` § Install sunt **greșite**. Orice plan construit pe această comandă nu funcționează. |
| F2 | `claude plugin marketplace add <dir>` cere `<dir>/.claude-plugin/marketplace.json`. Funcționează cu sursa `"./"` sau `"./plugins/total-recall"`. ID-ul rezultat este `total-recall@<nume-marketplace>`, iar `known_marketplaces.json` înregistrează `{"source":"directory","path":…}`. Re-adăugarea e idempotentă („already on disk"). | Mecanismul corect pentru un build local este un marketplace local. |
| F3 | La instalare, directorul se **copiază** în `~/.claude/plugins/cache/<mkt>/total-recall/<versiune>/` **cu tot cu** `dist/` și `node_modules/` (`.gitignore` nu filtrează copia). Într-un clone de dev, `node_modules` din plugin are **1.9 GB**. | Nu înregistrăm clone-ul direct: copiem un arbore curat, fără `node_modules`. |
| F4 | La aceeași versiune, `claude plugin install` răspunde „already installed" (no-op), iar `claude plugin update` răspunde „already at the latest version". Doar `uninstall` + `install` reîmprospătează conținutul. Un bump de versiune urmat de `update` creează un director nou, iar cel vechi rămâne. | Pe `main` versiunea e fixă între release-uri, deci după `git pull` reîmprospătarea cere `uninstall` + `install`. |
| F5 | `claude plugin uninstall` golește intrarea din `installed_plugins.json`, dar **lasă directorul în cache**. | `installState()` din `bin/cli.mjs:113` se uită doar la cache, deci raportează `'ours'` și după un uninstall (**bug latent existent**). `PLUGIN_MANAGED` din `install.sh:332-338` citește `installed_plugins.json` și e corect. |
| F6 | `.claude-plugin/marketplace.json` din rădăcina repo-ului se numește `my-claude-plugins` și are sursa `git-subdir` GitHub `ref: release`. | Rădăcina clone-ului **nu** poate fi marketplace-ul local: ar intra în coliziune cu numele marketplace-ului de producție și ar aduce tot codul de pe GitHub `release`, nu build-ul local. |
| F7 | `claude --plugin-dir <cale>` încarcă un plugin doar pentru sesiunea curentă. | Aceasta e bucla corectă pentru dezvoltare (live din clone), separată de instalare. |
| F8 | Pasul 7 din `install.sh` (`npm install --no-save <vector deps> && npm run build`) rulează în `PLUGIN_ROOT`. | Pentru o instalare gestionată de plugin, `install.sh` trebuie să ruleze pe **copia din cache** (unde rulează serverul), nu pe clone. Altfel dependențele vector ajung în clone, iar serverul degradează silențios la TF-IDF. |
| F9 | `--gemini` cu `-y` sau fără tty **nu** rulează `agy plugin install` (promptul de trust nu poate fi ocolit). Doar afișează comanda (`install.sh:565-595`). | `agy` nu poate fi automatizat complet. |
| F10 | `agy plugin install <dir>` copiază directorul în `~/.gemini/extensions/total-recall/`. | Dacă `<dir>` e clone-ul de dev, s-ar copia și cei 1.9 GB. Folosim tot arborele curat. |
| F11 | `test/pack-guard.mjs` permite `bin/*.mjs`. | Un modul nou `bin/local.mjs` nu încalcă garda tarball-ului. |
| F12 | `plugins/total-recall/install.sh` e urmărit cu modul `100755`. | Nu e nevoie de `chmod` în wrapper. |
| F13 | `dist/index.js` e un bundle self-contained: MCP SDK și zod sunt incluse, iar ca externe rămân doar dependențele opționale native. | Arborele curat (fără `node_modules`) rulează fără `npm install`, exact ca branch-ul `release`. |

---

## 3. Decizii de design

- **C1 — Punct de intrare unic, în clone: `./install.sh` din rădăcină.** E un wrapper bash de ~15 linii: `exec node "$ROOT/bin/cli.mjs" --local "$ROOT" "$@"`. Toată logica stă în Node (`bin/local.mjs`), testabilă cu `deps` injectate, ca restul launcherului. Nu folosim `npx @adrian-balaban/total-recall --local` ca primă comandă: ar aduce launcherul **publicat**, care poate fi mai vechi decât clone-ul și cere registry. Varianta npx funcționează după ce o versiune cu `--local` e publicată, ca alternativă documentată.
- **C2 — „Release local" în `~/.total-recall/local-marketplace/`.** Conținut:
  ```
  ~/.total-recall/local-marketplace/
    .claude-plugin/marketplace.json   # name: total-recall-local, source: ./plugins/total-recall
    plugins/total-recall/             # arbore curat + dist/, fără node_modules
    .local-build.json                 # sursa, git sha, dirty, fingerprint, builtAt
  ```
  De ce în afara clone-ului: rădăcina clone-ului e ocupată (F6), excludem `node_modules` (F3), calea înregistrată în `known_marketplaces.json` rămâne validă dacă clone-ul e mutat sau șters, iar același arbore servește și `agy` sau VS Code (F10).
- **C3 — Selecția fișierelor:** `git -C <pluginDir> ls-files -co --exclude-standard`, adică fișierele urmărite plus cele noi neignorate. Astfel intră și modificările necomise ale unui fork sau dev, iar `node_modules`, `dist`, `coverage` și `reports` rămân afară. După copiere se adaugă `dist/`. Fără git (de exemplu dintr-un zip), parcurgem directorul și excludem `node_modules`, `dist`, `coverage`, `reports` și `.stryker-tmp`. Staging-ul se face într-un director temporar alăturat, apoi se înlocuiește atomic prin `rename`.
- **C4 — Build: `npm run build` întotdeauna, `npm ci` doar la nevoie.** `npm ci --no-audit --no-fund` rulează doar dacă `node_modules/.package-lock.json` lipsește sau e mai vechi decât `package-lock.json`. `npm run build` (esbuild, secunde) rulează la fiecare `--local`, ceea ce elimină problema de `dist/` vechi după `git pull` fără euristici. După build se verifică **toate** cele 6 artefacte: `index.js`, `frontmatter.mjs`, `build-index-cache.mjs`, `privacy-filter.mjs`, `spec-config.mjs`, `spec-fields.mjs`. **Fără** fallback `npm ci || npm install`: `npm install` ar rescrie `package-lock.json` și ar ascunde o desincronizare pe care gate-ul CI oricum o respinge. La eșec afișăm un mesaj acționabil.
- **C5 — Cu `claude` disponibil:**
  1. `claude plugin marketplace add <staging>`, idempotent (F2).
  2. Dacă `total-recall@total-recall-local` **nu** apare în `installed_plugins.json`, rulează `claude plugin install total-recall@total-recall-local`. Dacă apare și fingerprint-ul arborelui s-a schimbat, rulează `uninstall` + `install` (F4). Dacă fingerprint-ul e neschimbat, nu reinstalează.
  3. `installPath` se citește din `installed_plugins.json`, nu din globbing în cache (F5).
  4. Rulează `bash <installPath>/install.sh --plugin-root <installPath> <forward>` (F8). `PLUGIN_MANAGED=1` face ca pasul 3 să sară peste MCP-ul user-scope și să șteargă un duplicat existent (comportament deja existent).
- **C6 — Fără `claude`:** rulează `install.sh --plugin-root <staging>/plugins/total-recall <forward>`. Pentru `--vscode`, `--gemini` și `scripts/start-server.sh` calea rămâne stabilă și curată. Sub `--local`, `claude` **nu** e cerință obligatorie.
- **C7 — `installState` se bazează pe `installed_plugins.json`** (cu fallback pe cache doar dacă fișierul lipsește) și întoarce `'ours' | 'local' | 'foreign' | 'none'`. Asta repară și bug-ul din F5 pentru fluxul marketplace.
- **C8 — Politica de coliziune, simetrică și deterministă:**

  | Mod \ stare | `none` | `local` | `ours` (marketplace) | `foreign` |
  |---|---|---|---|---|
  | `--local` | instalează | refresh dacă s-a schimbat | **stop**: „run `claude plugin uninstall total-recall@my-claude-plugins`, then re-run" | stop (mesajul existent) |
  | marketplace (implicit) | flux actual | **stop**: „run `claude plugin uninstall total-recall@total-recall-local`" | flux actual | stop (existent) |

  `--force` trece peste stop, cu warning explicit despre hook-uri și MCP duplicate. Memoriile din `~/.total-recall/` nu sunt afectate de schimbarea canalului.
- **C9 — `install.sh` (plugin) primește modificări mici:** flag-ul `--rebuild` (forțează `npm ci && npm run build`, util în varianta manuală), verificarea tuturor celor 6 artefacte `dist/` (nu doar `index.js`) și un mesaj specific când `PLUGIN_ROOT` e în `cache/total-recall-local/` („local build — re-run `./install.sh` in your clone after `git pull`") în locul warning-ului generic despre cache.
- **C10 — Trust:** canalul local înseamnă „commit-ul clonat + toolchain-ul local + registry npm la build". Asta se documentează în `SECURITY.md`. Marketplace-ul rămâne canalul recomandat, iar `marketplace.json`, `release.yml` și publicarea npm nu se ating.
- **C11 — Bucla de dezvoltare rămâne separată:** `npm run build && claude --plugin-dir "$(pwd)"` (F7) încarcă live din clone, fără instalare. Documentată în INSTALL.md în locul comenzii greșite.

---

## 4. Pași de implementare

### Pasul 0 — Bază
- Lucrează pe branch-ul `feat/local-install`, cu Node 20 (`mise`). `npm test` la root trebuie să fie verde înainte de orice modificare.

### Pasul 1 — `bin/local.mjs` (nou) + `bin/cli.mjs`
- `parseArgs`: own flag `--local [cale]`, cu valoare opțională (următorul token, dacă nu începe cu `-`). Bucla devine indexată. `own.local` ia valorile `false | true | '<cale>'`. Restul argumentelor se transmit neschimbate, în aceeași ordine.
- `resolveLocalPluginRoot({ given, cwd, fsImpl })`: o cale către directorul plugin sau către rădăcina repo-ului (`plugins/total-recall`). Fără cale, urcă din `cwd`. Marker-ul este `.claude-plugin/plugin.json` + `package.json`.
- `ensureBuilt({ pluginDir, run, fsImpl, platform })`: aplică C4. Pe `win32` rulează `npm.cmd` cu **`shell: true`**, pentru că Node ≥18.20.2 / 20.12.2 refuză spawn pe `.cmd` fără shell (CVE-2024-27980, `EINVAL`).
- `stageLocalRelease({ pluginDir, home, run, fsImpl })`: aplică C2 și C3. Fingerprint = sha256 peste lista sortată de căi + conținut. Întoarce `{ stagingDir, pluginStageDir, changed }`.
- `installLocal(...)`: aplică C5, C6 și C8.
- `run` implicit primește opțiunile `cwd` și `capture` (pentru `git ls-files`).
- `main`: ramura `--local` vine după `--help`/`--version` și gate-ul Node ≥18, **înainte** de `resolveClaude` (care rămâne obligatoriu doar în modul marketplace).
- `installState` aplică C7, iar fluxul marketplace tratează starea `'local'` conform C8.
- `USAGE`: adaugă `--local [path]` și exemplul de după clone.

### Pasul 2 — `install.sh` în rădăcină (nou)
```bash
#!/usr/bin/env bash
# Build and install total-recall from this clone (local release). See INSTALL.md.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
command -v node >/dev/null 2>&1 || { echo "install.sh: Node.js 18+ is required." >&2; exit 1; }
exec node "$ROOT/bin/cli.mjs" --local "$ROOT" "$@"
```
- Se commit-uiește cu mod `100755` (`git update-index --chmod=+x`).

### Pasul 3 — `plugins/total-recall/install.sh`
- Implementează C9: `REBUILD=0` lângă celelalte valori implicite, `--rebuild)` în parsare, condiția de build extinsă la „lipsește oricare din cele 6 artefacte sau `REBUILD=1`", mesajul de cache specific și o intrare în help.
- `bash -n` trebuie să treacă. Nu se schimbă nimic altceva.

### Pasul 4 — `package.json` din rădăcină (opțional, convenție)
- Adaugă `"build": "npm --prefix plugins/total-recall run build"` și `"install:local": "node bin/cli.mjs --local ."`.
- `test` devine `node --test test/*.test.mjs`.
- `files: ["bin"]` rămâne neschimbat, deci `pack-guard` trece.

### Pasul 5 — Teste (offline, fără spawn real)
- `test/cli.test.mjs`:
  - parsarea `--local` (cu și fără cale, înainte de `--gemini`, la final);
  - `installState` pe `installed_plugins.json` (cele 4 stări, plus cazul F5: cache prezent dar neinstalat ⇒ `'none'`);
  - matricea C8 în ambele moduri, cu și fără `--force`.
- `test/local.test.mjs` (nou, pe directoare temporare reale):
  - `resolveLocalPluginRoot` pe 5 cazuri;
  - `ensureBuilt`: secvența de apeluri `run` (`ci` doar când trebuie, `build` mereu, `npm.cmd` + shell pe win32, eșec ⇒ cod 1);
  - `stageLocalRelease`: fără `node_modules`, cu `dist/`, `marketplace.json` corect, fingerprint stabil și `changed` corect după o modificare;
  - fluxul C5 (ordinea `marketplace add` → `install` / `uninstall+install` / nimic → `install.sh --plugin-root <installPath>`);
  - fluxul C6 fără `claude`;
  - Windows fără Git Bash ⇒ `EX_UNAVAILABLE`.
- **Test de consistență:** lista celor 6 artefacte din `bin/local.mjs` coincide cu `--outfile=dist/…` din `plugins/total-recall/package.json`.

### Pasul 6 — Documentație
- `plugins/total-recall/INSTALL.md`:
  - secțiune nouă „Install from a local clone (build it yourself)": cerințe (Node ≥18, npm cu acces la registry la build, git), `./install.sh [-y] [flags]`, ce face, upgrade (`git pull && ./install.sh -y`), dezinstalare (`claude plugin uninstall total-recall@total-recall-local && claude plugin marketplace remove total-recall-local && rm -rf ~/.total-recall/local-marketplace`), comutarea de canal, nota de trust;
  - **corectează** „Developing from a clone" (F1): înlocuiește `claude plugin install "$(pwd)"` cu `claude --plugin-dir "$(pwd)"` pentru dev, sau `./install.sh` pentru instalare.
- `plugins/total-recall/CLAUDE.md` § Install: aceeași corecție (F1).
- `README.md` și `README-ro.md`: un paragraf „From source / fork".
- `SECURITY.md`: C10.
- `RELEASE-SMOKE-TEST.md`: scenariul de la Pasul 7.
- `backlog-and-plans/BACKLOG.md`: o intrare cu link la acest plan.

### Pasul 7 — Smoke (sandbox, `HOME=$(mktemp -d)`; spike-ul a confirmat că `claude plugin …` merge fără auth)
1. Clone curat ⇒ `./install.sh -y --no-vector` ⇒ exit 0.
2. `claude plugin list` arată `total-recall@total-recall-local` enabled.
3. În cache există cele 6 artefacte și **nu** există `node_modules`.
4. `claude mcp list` nu are `total-recall` user-scope.
5. Re-run ⇒ „unchanged" (fără uninstall).
6. O modificare în `src/` ⇒ re-run ⇒ rebuild + refresh, iar codul nou apare în cache.
7. Marketplace instalat + `--local` ⇒ stop. `--force` ⇒ trece, cu warning.
8. Fără `claude` pe `PATH` ⇒ MCP standalone din staging.

---

## 5. Criterii de acceptanță

1. Pe un clone curat de `main`, `./install.sh -y` se termină cu exit 0 și pluginul `total-recall@total-recall-local` este enabled, cu hooks și MCP din `.mcp.json` al pluginului.
2. Copia din cache conține toate cele 6 artefacte `dist/` și nu conține `node_modules` din clone. Dependențele vector, dacă există, sunt instalate de pasul 7 **în cache**.
3. Re-rularea fără modificări nu reinstalează și nu atinge `~/.total-recall/personal-vault/`. După `git pull` cu modificări de cod, re-rularea livrează codul nou.
4. Fără `claude`, nu apare nicio eroare și MCP-ul standalone este configurat din staging.
5. Coliziunile din C8 sunt tratate determinist, în ambele direcții. Bug-ul F5 e reparat.
6. `npm test` la root e verde, offline. `prepublishOnly`/`pack-guard` trec. `bash -n` trece pe ambele `install.sh`.
7. `git diff main` nu atinge `.claude-plugin/marketplace.json`, `.github/workflows/*`, `plugins/total-recall/package.json` și niciun `package-lock.json`.
8. Nicio documentație nu mai conține `claude plugin install "$(pwd)"`.

## 6. Riscuri

| Risc | Mitigare |
|---|---|
| Comportamentul `claude plugin` se schimbă între versiuni | Faptele sunt fixate pe 2.1.220 în acest plan. Smoke-ul din Pasul 7 intră în `RELEASE-SMOKE-TEST.md`. Mesajele de eroare afișează comanda manuală echivalentă. |
| `uninstall` + `install` șterge din cache dependențele vector, care se reinstalează (minute, rețea) | Se face doar când fingerprint-ul s-a schimbat. Durata e documentată. |
| `~/.total-recall/local-marketplace/` coexistă cu vault-urile | `paths.ts` folosește doar subcăi explicite. La implementare se verifică (grep) că nimic nu parcurge rădăcina `~/.total-recall/`. |
| Launcherul crește („tiny bootstrap") | Logica stă în `bin/local.mjs`, fără dependențe și fără cod de plugin în tarball. `pack-guard` rămâne valid. |
| Windows | `npm.cmd` + `shell:true`, Git Bash prin `resolveBash`. Smoke-ul real pe Windows rămâne la maintainer. |

## 7. Out of scope
Publicarea pluginului pe npm sau ca zip, modul symlink/watch, semnarea, modificarea `release.yml` sau a branch-ului `release`. Tot aici intră ordinea pas 5c (`agy`) față de pas 7 (dependențe vector) din `install.sh`: extensia Gemini e copiată înainte de instalarea dependențelor vector, în toate canalele. Problema e preexistentă și va fi înregistrată separat în BACKLOG.

---

## Anexa A — Review: `PLAN-INSTALARE-LOCALA-GEMINI3.8.md`

**Verdict: nu se poate implementa ca atare.** Ideile de UX sunt bune, dar mecanismul central nu funcționează și există mai multe afirmații neverificate.

| # | Constatare | Severitate |
|---|---|---|
| G1 | §3.4 / §5.3 / Task 2.3 / diagrama: `claude plugin install "$PLUGIN_ROOT"` eșuează (F1). Criteriul de acceptanță 4 (hook-uri active) nu poate fi atins așa. | **Blocant** |
| G2 | §3.3 / §5.3.2: fallback-ul `npm ci \|\| npm install` modifică `package-lock.json` și maschează desincronizarea pe care CI o respinge. | Mare |
| G3 | §3.5: afirmă că `--gemini` „execută `agy plugin install`". Sub `-y` sau fără tty scriptul doar afișează comanda (F9), deci criteriul 1 („fără intervenție manuală") e fals pentru Gemini. | Medie |
| G4 | Nu tratează `dist/` vechi după `git pull` (build-ul rulează doar când lipsește). | Medie |
| G5 | Ignoră copierea în cache (F3, 1.9 GB `node_modules`) și locul dependențelor vector (F8). | Mare |
| G6 | Nu are o politică de coliziune cu o instalare marketplace existentă. `--no-plugin` e inventat, fără specificație. | Medie |
| G7 | §3.4 („curăță înregistrarea user-scope") prezintă ca nou un comportament care există deja (`PLUGIN_MANAGED`, `install.sh:415-426`). | Mică |
| G8 | `chmod +x` în wrapper e inutil (F12). Criteriul 6 („identic pe Linux/macOS/Windows") nu e verificabil. Nu sunt prevăzute teste pentru wrapper sau pentru `--local`. | Mică |
| G9 | Statusul „Gata de implementare" e supraevaluat. | Mică |
| ✔ | **Preluate:** `./install.sh` în rădăcină ca punct de intrare (C1), verificarea tuturor artefactelor `dist/` (C4), scripturile npm din root (Pasul 4), diagrama de flux ca idee. | — |

## Anexa B — Review: `backlog-and-plans/PLAN-INSTALARE-LOCALA-DEEPSEEK.md`

**Verdict: cel mai riguros dintre cele două, structură bună (fapte → decizii → pași → teste → criterii), dar pasul critic pentru Claude Code e greșit.** Liniile citate (`bin/cli.mjs` 13–16, 39–49, 125–186; `install.sh` 283, 305–315, 329–338) au fost verificate și sunt corecte.

| # | Constatare | Severitate |
|---|---|---|
| D-1 | Pasul 1.4 / D3 / criteriul 2: `claude plugin install <pluginDir>` eșuează (F1). §2.5 marca doar „ID-ul" ca necunoscut, dar comanda în sine nu există în această formă. | **Blocant** |
| D-2 | Pasul 1.6: `install.sh --plugin-root <clone>` după instalarea pluginului face ca dependențele vector să ajungă în clone, nu în cache (F8). Serverul plugin-managed ar degrada silențios la TF-IDF. | Mare |
| D-3 | Copierea `node_modules` (1.9 GB) din clone în cache (F3) nu e luată în calcul, nici riscul ABI care decurge de aici. | Mare |
| D-4 | `npx @adrian-balaban/total-recall --local` ca variantă principală aduce launcherul publicat, nu pe cel din clone. Nu funcționează până la un release npm cu `--local`. | Medie |
| D-5 | Refresh-ul după `git pull` depinde de `--rebuild`, pe care utilizatorul trebuie să-l știe. În plus, la aceeași versiune, `claude plugin install` sau `update` nu reîmprospătează cache-ul (F4). | Medie |
| D-6 | `npm.cmd` pe win32 nu e suficient: e nevoie de `shell: true` (CVE-2024-27980). | Mică |
| D-7 | Bug-ul F5 din `installState` nu e observat. Politica D4 se sprijină pe această funcție. | Medie |
| ✔ | **Preluate:** D3 (build înainte de instalare, confirmat de F3), D4 (politica de coliziune, extinsă simetric în C8), D5 (`--rebuild`), D6 (trust), D7 (fără clone din bootstrap), `claude` opțional sub `--local`, `resolveLocalPluginRoot`, parsarea indexată, planul de teste cu `deps` injectate, criteriul 8 (fișiere neatinse), lista de documentație. | — |
