# PLAN — Instalare directă dintr-un `git clone` cu build local (`--local`)

**Status:** draft, nepornit · **Data:** 2026-11-09 · **Branch:** `main` · **Implementare:** agent de codare bazat pe DeepSeek
**Deliverabil:** un canal de instalare „din sursă" pe deplin suportat: după `git clone`, utilizatorul instalează total-recall cu **build local** — într-o singură comandă (`npx @adrian-balaban/total-recall --local [<cale>]`) sau manual (`./install.sh` din `plugins/total-recall/`), fără marketplace și fără branch-ul `release`.

> **Notă pentru agentul care implementează.** Faptele din §2 au fost verificate în repo la data redactării; liniile citate corespund stării actuale a `main`. Nu le re-deriva; dacă o linie citată nu se mai potrivește, re-verifică punctul respectiv înainte de a continua. Lucrează pe un branch feature (ex. `feat/local-install`), nu modifica `package-lock.json`, și rulează `npm test` la root înainte de fiecare commit. Limba codului și a documentației repo-ului rămâne engleza; acest document e în română doar pentru autor.

## 1. Scop și motivație

Astăzi un utilizator care vrea total-recall din codul sursă are două opțiuni nedorite:

1. **Clone de `release`** — dist prebuilt de CI, dar branch-ul e un artefact CI force-push-at (`git pull` poate eșua), iar utilizatorul nu poate folosi codul de pe `main` și nu poate instala un fork.
2. **Clone de `main`** — tratat în `INSTALL.md` doar ca „Developing from a clone" (dev-only), fără un flux orchestrat: utilizatorul trebuie să știe el ordinea corectă (`npm install && npm run build` **înainte** de `claude plugin install "$(pwd)"`), iar bootstrap-ul npx nu are nicio cale de a-i vorbi despre un clone local.

Scopul: să facem din „clone → build local → instalare" un canal first-class, cu aceeași calitate de UX ca marketplace-ul:

```bash
git clone https://github.com/adrian-balaban/total-recall.git
cd total-recall
npx @adrian-balaban/total-recall --local     # sau: node bin/cli.mjs --local [cale]
```

…plus varianta manuală documentată pentru fiecare host. Canalul rămâne secundar față de marketplace (vezi D2), dar e **documentat, testat și determinist**.

## 2. Fapte verificate în repo (nu le re-deriva)

### 2.1 Modelul de distribuție actual

- `plugins/total-recall/dist/` este gitignored pe `main` (`plugins/total-recall/.gitignore`, linia 17, comentariu explicit „Build output … Never committed"). Repo-ul urmărește 213 fișiere sub `plugins/total-recall`, dintre care **0** în `dist/`.
- Singura build pipeline este CI: `.github/workflows/release.yml` (comentariile de la liniile 1–13: „This is the ONLY build pipeline — there is no local release gate"). CI construiește `dist/` și force-pushă arborele + `dist/` pe branch-ul `release`; `.claude-plugin/marketplace.json` pin-uiește sursa plugin-ului la `{"source":"git-subdir", "path":"plugins/total-recall", "ref":"release"}`.
- `dist/index.js` este un bundle esbuild self-conținut (`build:esbuild` folosește `--bundle`; externalele sunt doar dependențele opționale native: `fsevents`, `@huggingface/transformers`, `sqlite-vec`, `better-sqlite3`). Consecințe: un clone de `release` rulează **fără** `npm install` (de asta e calea „air-gapped"-ish), dar un **build local de pe `main` cere acces la registry npm** la build-time (nu la runtime).
- `plugins/total-recall/package-lock.json` este comis → `npm ci` este reproductibil dintr-un clone curat. `node_modules/` e gitignored.

### 2.2 `plugins/total-recall/install.sh` — mecanica existentă pe care ne sprijinim

- Script *state-aware, safe to re-run*; `set -uo pipefail`, deliberat **fără** `set -e` (pasul 8 trebuie să colecteze toate verificările).
- Marker-ul plugin root este `.claude-plugin/plugin.json` (linia 283); detectare în ordine: `--plugin-root` → `$CLAUDE_PLUGIN_ROOT` → directorul propriu al scriptului → `claude mcp get total-recall` (grep `dist/index.js`) → prompt interactiv (liniile 284–299).
- **Construiește `dist/` dacă lipsește** (liniile 305–315): `cd "$PLUGIN_ROOT" && npm ci --no-audit --no-fund && npm run build`; `die` la eșec. Acesta este pasul care face un clone de `main` rulabil pentru instalarea MCP standalone.
- `PLUGIN_MANAGED` (liniile 329–338): citește `~/.claude/plugins/installed_plugins.json` și consideră orice cheie `total-recall@*` drept instalare gestionată de plugin system → pasul 3 sare peste înregistrarea MCP user-scope (evită două servere / dublă injecție de index). **Consecință importantă:** și un install local (`claude plugin install <cale>`) va fi detectat corect, fără dublu server.
- Dependențele vector (opționale) se instalează cu `npm install --no-save` + fallback `node-gyp rebuild` (liniile ~700–736); degradare grațioasă la TF-IDF.
- Opțiuni parsate în jurul liniei 208: `--complete/--default/--vector/--no-vector`, `--plugin-root`, `--statusline`, `--gemini`, `--vscode`, `--org-repo URL`, `--allowed-email-domain D`, `-y`, `--strict`, `--help`.

### 2.3 `bin/cli.mjs` — bootstrap-ul npx (punctul de extensie)

- Constante (liniile 13–16): `MARKETPLACE='adrian-balaban/total-recall'`, `MARKETPLACE_NAME='my-claude-plugins'`, `PLUGIN_ID='total-recall@my-claude-plugins'`, `EX_UNAVAILABLE=69`.
- `parseArgs(argv)` (liniile 39–49): own flags `--help/-h`, `--version`, `--force`; tot restul e forward-at verbatim către `install.sh`. Bucla actuală e `for (const a of argv)` — pentru un flag cu valoare opțională va trebui convertită la iterație indexată (vezi Pasul 1).
- `main(argv, deps)` (liniile 125–186): gate Node ≥18 → `resolveClaude` (hard requirement: return 1 dacă lipsește) → `installState` (`'none' | 'ours' | 'foreign'`, după conținutul `~/.claude/plugins/cache/`) → `'foreign'` fără `--force` → eroare; `'none'` → `claude plugin marketplace add` + `claude plugin install <PLUGIN_ID>` → rulează `install.sh` din cea mai nouă copie din cache cu `bash <…>/install.sh <forward>`, stdio inherit.
- `deps` injectabile (`run`, `out`, `err`, `home`, `fsImpl`, `platform`, `env`, `nodeVersion`, `version`) — testele nu spawn-ează nimic.
- Windows: `resolveBash` cere Git Bash, altfel exit `EX_UNAVAILABLE` cu mesaj activ.

### 2.4 Teste și gate-uri

- `test/cli.test.mjs`: `node:test` + `assert/strict`; helper `fakeFs(paths)`; `HOME='/home/u'`; testează `parseArgs`, `compareVersions`, `newestVersionDir`, `claudeCandidates`, `resolveClaude`, `resolveBash`, `installState`, `main`. Se rulează cu `npm test` la root.
- `test/pack-guard.mjs` (`prepublishOnly`) — gardă pe conținutul tarball-ului npm; nu-l atinge.
- `mutation.yml` rulează și `npm test` la root → orice modificare în `bin/cli.mjs` trebuie acoperită de teste care nu cer rețea.

### 2.5 Ce NU este încă verificat (agentul verifică la implementare)

- **ID-ul exact** sub care apare un install din cale locală în `claude plugin list` / `~/.claude/plugins/installed_plugins.json` (ex. `total-recall@local`?). `INSTALL.md` documentează că `claude plugin install "$(pwd)"` funcționează, dar nu și forma ID-ului.
- Dacă `claude plugin install <cale>` rulat **a doua oară** pe aceeași cale reîmprospătează copia din cache, sau e nevoie de `uninstall` + `install` (sau `claude plugin update`). Planul presupune re-run idempotent; agentul confirmă comportamentul real și îl documentează la „Upgrade" în INSTALL.md.

## 3. Decizii de design (cu motivație)

- **D1 — `--local [cale]` ca own-flag în bootstrap, nu subcomandă nouă.** CLI-ul are deja forma `total-recall [flags]` cu forward verbatim; un flag se potrivește natural în `parseArgs` și în testele existente. Fără valoare → autodetect din cwd (Pasul 1).
- **D2 — marketplace/`release` rămâne canalul recomandat.** Nu se ating `marketplace.json`, `release.yml` sau fluxul de publish npm. Canalul local e pentru power-users, forkuri, instalări de pe `main` înainte de release și medii fără acces la github.com (dar cu registry npm pentru build). `INSTALL.md` § „What you are installing" rămâne valid, cu o notă despre canalul local.
- **D3 — build-ul are loc ÎNAINTE de `claude plugin install <cale>`.** Instalarea din cale copiază arborele în cache-ul plugin system (`~/.claude/plugins/cache/...`); dovada ordinii corecte e chiar fluxul dev din INSTALL.md (build, apoi install). Dacă am lăsa `install.sh` să construiască *după* install, ar construi în sursă, dar copia din cache ar rămâne fără `dist/` → hooks/MCP plugin-managed defecte. De aceea bootstrap-ul face build-if-missing ca pas explicit, înainte de `claude plugin install`.
- **D4 — politică de coliziune pentru `--local` (deterministă, nu comodă):**
  - `installState === 'foreign'` → eroare identică cu cea actuală; `--force` trece peste (comportament existent, neschimbat).
  - `installState === 'ours'` (instalat din marketplace `my-claude-plugins`) → **stop** cu mesaj care recomandă comutarea explicită de canal: `claude plugin uninstall total-recall@my-claude-plugins`, apoi re-run `--local`; `--force` trece peste. Motivație: două instalări cu același nume de plugin pot produce hooks/MCP duplicate.
- **D5 — `install.sh --rebuild`.** Forțează `npm ci && npm run build` chiar dacă `dist/index.js` există. Rezolvă upgrade-ul din surse: după `git pull`, `dist/` vechi nu e reconstruit de scriptul actual (build-ul rulează doar la lipsă). Mic, aditiv, documentat la „Upgrade".
- **D6 — poziția de trust, scrisă explicit.** Canalul local schimbă modelul de încredere: de la „build de CI pe `release`" la „commit-ul pe care l-ai clonat + toolchain-ul tău local (Node/npm) + registry npm la build-time". `SECURITY.md` primește un paragraf care spune asta onest; marketplace rămâne recomandat pentru utilizatorul obișnuit.
- **D7 — fără `git clone` din bootstrap.** Bootstrap-ul nu clonează el însuși un repo (ar introduce o a doua sursă de cod în launcher). Utilizatorul clonează; `--local` consumă clone-ul existent („după git clone" — exact cerința).

## 4. Pași de implementare (checklist ordonat)

### Pasul 0 — mediu și bază

1. Node 20 prin mise (`.nvmrc`); `git status` curat.
2. `npm test` la root → verde la start (linia de bază înainte de orice modificare).

### Pasul 1 — `bin/cli.mjs`: flag-ul `--local [cale]`

**Parsing (`parseArgs`).** Adaugă `--local` la own flags, cu valoare *opțională*: dacă token-ul următor există și **nu** începe cu `-`, e calea și se consumă; altfel `--local` înseamnă „autodetect". De aceea bucla `for (const a of argv)` devine iterație indexată (`for (let i = 0; i < argv.length; i++)`). Reprezentare: `own.local = false | true (fără cale) | '<cale>'`. Restul token-urilor rămân forward-at verbatim, în ordine — testul existent „removes its own flags and forwards the rest verbatim" trebuie să rămână verde.

**Rezolvarea căii — funcție nouă `resolveLocalPluginRoot({ given, cwd, fsImpl })`** (exportată, ca restul helper-elor), returnează `path|null`:

1. Dacă `given` e dat (string): 
   - `<given>/.claude-plugin/plugin.json` **și** `<given>/package.json` există → plugin dir direct;
   - altfel `<given>/plugins/total-recall/.claude-plugin/plugin.json` există → repo root → returnează `<given>/plugins/total-recall`;
   - altfel `null` (agentul tipărește eroare cu ce a căutat).
2. Dacă `given` e `true`/absent: urcă din `cwd` spre rădăcină căutând `plugins/total-recall/.claude-plugin/plugin.json`, apoi `.claude-plugin/plugin.json` direct (cazul „cwd este chiar plugin dir"). `null` dacă nimic.
3. Normalizează rezultatul cu `path.resolve`. Primește `fsImpl` injectat (stilul fișierului).

**Fluxul în `main()`** — branch nou la început (după `--help`/`--version` și gate-ul Node ≥18), **înainte** de `resolveClaude`/`installState` marketplace:

1. `const pluginDir = resolveLocalPluginRoot({ given: own.local === true ? null : own.local, cwd: deps.cwd ?? process.cwd(), fsImpl })`; `null` → `err(...)` cu hint către USAGE și `return 1`.
2. `installState(home, fsImpl)`:
   - `'foreign'` → mesajul actual; `return 1` dacă nu e `--force`.
   - `'ours'` → `err(...)` cu mesajul de comutare de canal din D4; `return 1` dacă nu e `--force`.
3. **Build-if-missing în sursă** (D3): dacă `!fsImpl.existsSync(path.join(pluginDir, 'dist', 'index.js'))`:
   - `run(npm, ['ci', '--no-audit', '--no-fund'], { inherit: true, cwd: pluginDir })` apoi `run(npm, ['run', 'build'], { inherit: true, cwd: pluginDir })`;
   - pe win32 invoke `npm.cmd` (spec explicit — spawnSync nu rezolvă `.cmd` singur pe toate versiunile);
   - eșec → `err(...)` explicând că build-ul local cere Node ≥18 și acces la registry npm; `return 1`.
   - Notă: dacă `dist/index.js` există, NU se re-construiește (idempotent); staleness-ul după `git pull` se rezolvă cu `install.sh --rebuild` (Pasul 2) — documentat.
4. `const claude = resolveClaude(...)`; dacă există → `run(claude, ['plugin', 'install', pluginDir], { inherit: true })`; eșec → `err(...)` cu îndemnul de a rula comanda manual; `return 1`. Dacă `claude` lipsește → `out(...)` informativ („no `claude` CLI found — installing as a standalone MCP server") și continuă. **Sub `--local`, `claude` nu mai e hard requirement** (spre deosebire de fluxul marketplace).
5. `const bash = resolveBash(...)`; lipsă pe Windows → `EX_UNAVAILABLE` cu mesajul actual.
6. `run(bash, [path.join(pluginDir, 'install.sh'), '--plugin-root', pluginDir, ...forward], { inherit: true })` → `return r.status ?? 1`.

Nu se rulează `marketplace add`/`install` în acest branch. `USAGE` (help text) primește `--local [cale]` + exemplul din §1.

### Pasul 2 — `install.sh`: flag-ul `--rebuild`

1. Variabilă nouă `REBUILD=0` lângă celelalte defaults (linia ~147); parsing `--rebuild) REBUILD=1 ;;` lângă `--plugin-root` (linia ~208).
2. Condiția de build (linia 305) devine: `if [ ! -f "$PLUGIN_ROOT/dist/index.js" ] || [ "$REBUILD" -eq 1 ]`. Mesajul `info` diferențiază cazul: `dist/ not found — building …` vs `--rebuild given — rebuilding …`.
3. Help-ul din header (blocul „Options:") primește o intrare `--rebuild` + o propoziție în § Usage de sus.
4. Nimic altceva nu se schimbă în script; `bash -n plugins/total-recall/install.sh` trebuie să treacă.

### Pasul 3 — teste în `test/cli.test.mjs`

Grup nou `describe('--local', …)` (stil identic: fakeFs + deps injectate, fără spawn real):

1. Parsing: `--local /cale` → `own.local === '/cale'`; `--local --gemini` → `own.local === true` și `--gemini` rămâne în `forward`; `--local` la final → `true`; ordinea forward-ului neatinsă.
2. `resolveLocalPluginRoot`: (a) cale directă către plugin dir; (b) cale către repo root → `plugins/total-recall`; (c) autodetect din `cwd` imbricat (ex. `<repo>/docs`); (d) `cwd` = plugin dir; (e) `null` când nimic nu se potrivește.
3. `main` cu `--local`:
   - cale invalide → `1` + mesaj pe stderr;
   - `installState 'foreign'` fără `--force` → `1`; cu `--force` → continuă; `'ours'` fără `--force` → `1` (mesajul de comutare de canal);
   - `dist/index.js` absent → `run` primește `npm ci` apoi `npm run build` cu `cwd = pluginDir`, apoi (dacă `claude` există) `claude plugin install <pluginDir>`, apoi `bash <pluginDir>/install.sh --plugin-root <pluginDir> …`; ordinea exactă se verifică cu assert pe apelurile `run`;
   - `dist/index.js` prezent → fără apeluri npm;
   - `claude` absent → fără apel `claude plugin install`, install.sh tot rulează (fluxul standalone);
   - `run` npm eșuat → `1`;
   - Windows fără Git Bash → `EX_UNAVAILABLE`.
4. Toate testele vechi rămân verzi (canalul marketplace neatins). `npm test` la root, fără rețea.

### Pasul 4 — documentație

- **`plugins/total-recall/INSTALL.md`**: secțiune nouă **„Install from a local clone (build it yourself)"** imediat după „Install without Claude Code". Conținut obligatoriu:
  - cerințe: Node ≥18 pe PATH, npm cu acces la registry (doar la build), `git`; notă despre Node: *build-uiește cu același Node cu care rulezi hostul* (ABI `better-sqlite3`; vezi `mise.toml`/`.nvmrc` pentru pin-ul 20 folosit de maintainer);
  - varianta single-command: `npx @adrian-balaban/total-recall --local [<cale>]` — ce face pașii (build → `claude plugin install <cale>` dacă există `claude` → `install.sh --plugin-root`), că e safe to re-run, că pe Windows cere Git Bash (exit 69);
  - varianta manuală: `git clone … && cd plugins/total-recall && ./install.sh -y` (pentru orice host; build-ul e făcut de script) și, pentru Claude Code cu hooks, ordinea corectă build → `claude plugin install "$(pwd)"` → `./install.sh -y`;
  - **Upgrade**: `git pull` în clone → `./install.sh --rebuild -y` (sau re-run `npx … --local`); notă despre copia din cache a plugin system și verificarea cu `claude plugin list`;
  - nota de trust din D6 (o propoziție, cu link la `SECURITY.md`);
  - repoziționează § „Developing from a clone" ca pointer către secțiunea nouă (developerii folosesc același flux).
- **`README.md` + `README-ro.md`**: un paragraf scurt în zona Quick start / instalare: „from source / fork: `git clone` apoi `npx @adrian-balaban/total-recall --local` — vezi INSTALL.md".
- **`SECURITY.md`**: paragraful D6 — canalul local, modelul de trust, ce rămâne neschimbat (marketplace = build CI).
- **`RELEASE-SMOKE-TEST.md`**: scenariu nou „local clone install": clone curat → `--local` → verificări (plugin list, MCP registered, index built) → uninstall + re-verificare că marketplace-ul rămâne neatins.
- **`backlog-and-plans/BACKLOG.md`**: înregistrează feature-ul cu pointer la acest plan.

### Pasul 5 — verificări finale ale agentului

1. `npm test` la root (toate verzi, offline); `bash -n plugins/total-recall/install.sh`; `node --check bin/cli.mjs`.
2. Dacă `claude` CLI există pe mașina agentului: smoke end-to-end într-un tmpdir — clone curat (fără `node_modules`/`dist`) → `node <repo>/bin/cli.mjs --local <clone>` → exit 0 → `claude plugin list` arată pluginul → re-run idempotent. Dacă `claude` nu există: documentează smoke-ul ca de rulat de maintainer (§ RELEASE-SMOKE-TEST).
3. Verifică itemii din §2.5 (`claude plugin list` după un install local; comportamentul re-install) și scrie concluziile în INSTALL.md.
4. `git status` curat; commit-uri mici pe branch feature, mesaje în stilul repo-ului.

## 5. Criterii de acceptanță (verificabile)

1. `npm test` la root verde, offline, cu testele noi incluse (§ Pasul 3) și toate cele vechi neatinse.
2. Pe un clone curat de `main` (fără `node_modules`, fără `dist`): `node bin/cli.mjs --local <clone>` → rulează `npm ci` + `npm run build`, apoi `claude plugin install <clone>/plugins/total-recall` (dacă există `claude`), apoi `install.sh --plugin-root <…>`, exit 0; re-run → idempotent, fără build repetat.
3. `--local` pe mașină **fără** `claude` CLI → nu e eroare; `install.sh` înregistrează MCP-ul standalone `total-recall` (fluxul existent pentru hosturi non-Claude).
4. `--local` cu o instalare marketplace `ours` existentă → stop cu mesajul de comutare de canal; continuă doar cu `--force`. `'foreign'` → mesajul existent.
5. `install.sh --rebuild` reconstruiește `dist/` pe un tree care are deja `dist/`.
6. `USAGE`/`--help` documentează `--local`; mesajele de eroare sunt actionabile (spun ce lipsește și ce să rulezi).
7. Documentația: fiecare comandă din `INSTALL.md`/`README*` e copy-paste-abilă; upgrade-ul local e documentat; `SECURITY.md` descrie modelul de trust al canalului local; `RELEASE-SMOKE-TEST.md` are scenariul nou.
8. `git diff main` NU atinge: `.claude-plugin/marketplace.json`, `.github/workflows/*`, `plugins/total-recall/package.json`, `package-lock.json` (nici unul din cele două).

## 6. Riscuri & mitigări

| Risc | Mitigare |
|---|---|
| Comportamentul `claude plugin install <cale>` (ID în `plugin list`, refresh la re-install) nu e cunoscut exact | Item de verificare explicit (§2.5): agentul rulează comanda real și documentează ce observă; fallback-ul documentat: `uninstall` + re-install |
| Coexistență local + marketplace cu același nume → hooks/MCP duplicate | D4: stop determinist, comutare de canal explicită, `--force` ca evadare |
| `dist/` vechi după `git pull` (build-ul rulează doar la lipsă) | `--rebuild` (D5) + documentație la „Upgrade" |
| `npm ci` pe Windows din bootstrap (`spawnSync` + `.cmd`) | Spec explicit: `npm.cmd` pe `win32`; smoke Windows rămâne la maintainer (ca și astăzi, vezi INSTALL.md § Windows) |
| ABI `better-sqlite3` compilat cu alt Node decât cel al hostului | Docs: build cu același Node cu care rulezi hostul; degradează grațios la TF-IDF (comportament existent); pin Node 20 în `mise.toml`/`.nvmrc` |
| Registry npm indisponibil la build | Mesaj de eșec clar; alternativa documentată rămâne clone-ul de `release` (dist prebuilt, fără npm la runtime) |
| Regresie pe canalul marketplace | Toate schimbările sunt aditive în branch separat; testele existente trebuie să rămână verzi; `prepublishOnly`/`pack-guard` neatinse |
| Bootstrap-ul devine „a doua sursă de cod" (încălcarea stance-ului npm-bootstrap) | D7: `--local` nu descarcă nimic, doar orchestrează un tree pe care utilizatorul l-a clonat deja — tarball-ul npm rămâne fără cod de plugin |

## 7. Out of scope

- Publicarea pluginului propriu-zis pe npm, zip/tarball download, Homebrew (rămân la stance-ul din `PLAN-NPX-INSTALL-BOOTSTRAP.md` §10).
- Mod dev cu symlink/watch (`claude plugin` copiază în cache; un mod „live" ar cere alt mecanism).
- Semnarea commit-urilor/artefactelor.
- Demonstrarea end-to-end pe Windows reală (rămâne la maintainer, ca și astăzi).
- Orice modificare a fluxului de release CI sau a conținutului branch-ului `release`.

## 8. Referințe rapide pentru agent

- `bin/cli.mjs` — parseArgs (39–49), main (125–186), constante (13–16), USAGE (18–36)
- `plugins/total-recall/install.sh` — opțiuni (~208), detectare plugin root + build (279–315), PLUGIN_MANAGED (329–338), vector deps (~700–736), verify (741+)
- `test/cli.test.mjs` — harness fakeFs/deps; `test/pack-guard.mjs` — neatins
- `plugins/total-recall/INSTALL.md` — § Install without Claude Code, § Developing from a clone, § What you are installing
- `.github/workflows/release.yml` — modelul de distribuție (doar citit); `.claude-plugin/marketplace.json` — doar citit
- `mise.toml` / `.nvmrc` — pin Node 20 (ABI better-sqlite3)
