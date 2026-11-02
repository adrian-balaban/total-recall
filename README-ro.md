# 🧠 total-recall

**Asistentul tău AI uită totul la finalul fiecărei sesiuni. Acest plugin rezolvă problema.**

Memorie persistentă și căutabilă pentru Claude Code, Gemini/Antigravity și VS Code (GitHub Copilot agent mode). Memoriile sunt fișiere Markdown simple pe discul tău, pe care le poți citi, edita, căuta cu grep și versiona cu git.

[🇬🇧 English](README.md) · 🇷🇴 Română

- **Ce primești:** la începutul fiecărei sesiuni Claude vede un index scurt cu ce știe despre tine și proiectele tale, citește memoria completă când are nevoie de ea și salvează deciziile și lecțiile noi pe măsură ce lucrezi.
- **Unde stă:** în `~/.total-recall/`, câte un fișier `.md` pentru fiecare memorie. Fără server, fără bază de date, fără cont.
- **Memorie de echipă (opțional):** memoriile etichetate `org` ajung într-un repo Git comun, după un filtru de confidențialitate care blochează secrete, adrese de email și numere de card.
- **Cost:** gratuit și open source (MIT). Pluginul are ~1–2 MB; căutarea semantică opțională descarcă un model local de ~200 MB. Indexul injectat costă cam 32 de tokeni per memorie, în fiecare sesiune.

![Bucla sesiunii](docs/diagrams/session-loop-ro.svg)

## 🚀 Pornire rapidă

**Ai nevoie de:** Claude Code cu CLI-ul `claude`, Node.js 18+ și Linux, macOS sau Windows cu Git Bash.

1. Într-o sesiune Claude Code, instalează pluginul după ID-ul complet (alte pluginuri au același nume):

   ```
   /plugin marketplace add adrian-balaban/total-recall
   /plugin install total-recall@my-claude-plugins
   ```

2. Într-un terminal, rulează o singură dată scriptul de instalare. Creează vault-urile, construiește indexul și te întreabă ce profil vrei: **complet** (implicit, adaugă căutare semantică locală) sau **minimal** (doar căutare de text, funcționează offline).

   ```bash
   bash "$(ls -d ~/.claude/plugins/cache/my-claude-plugins/total-recall/*/ | sort -V | tail -1)install.sh"
   ```

3. Repornește Claude Code și deschide o sesiune nouă. Ca să verifici că merge:
   - spune *„ține minte că proiectul ăsta folosește Gradle 8 și JUnit 5"*,
   - deschide altă sesiune nouă și întreabă *„ce build tool folosește proiectul?"*,
   - sau cere *„arată statisticile total-recall"* (`get_stats`).

Gemini/Antigravity: adaugă `--gemini`. VS Code cu agent plugins oprite: adaugă `--vscode`. Ghidul complet, note pentru Windows și Codex CLI: [INSTALL.md](plugins/total-recall/INSTALL.md).

## 🗣️ Utilizare zilnică

| Spui | Ce se întâmplă |
|---|---|
| *„ține minte că am ales PostgreSQL pentru JSONB"* | Se scrie o memorie în `~/.total-recall/personal-vault/` |
| *„ce am decis despre baza de date?"* | Claude caută și citește memoriile potrivite |
| *„memoria aia e depășită, actualizeaz-o"* / *„uit-o"* | Fișierul e editat sau șters |
| nimic | Înainte de fiecare compactare a contextului se salvează automat 0–3 lecții din sesiune |

Ca total-recall să fie singura memorie, iar Claude să nu mai folosească fișierele `MEMORY.md` proprii, adaugă asta în `~/.claude/CLAUDE.md` **global**:

```markdown
## Memory
Use total-recall exclusively for all memories, in every project.
- Store via `store_memory` / `update_memory`; recall via `search_index` / `recall_memory` / `get_memories_by_keys`.
- NEVER use the harness file-based memory (`memory/`, `MEMORY.md`) or `.remember/`.
- If total-recall is unavailable, tell me and skip persisting — do not silently fall back.
```

Dacă rulezi și pluginul oficial `remember`, dezactivează-l: amândouă fac același lucru.

## 🔒 Confidențialitate: ce pleacă de pe mașina ta

- **Fișierele rămân locale.** Vault-ul personal nu e trimis nicăieri; repo-ul lui git local blochează orice push.
- **Modelul vede ce citește.** Indexul injectat, orice memorie pe care o citește Claude și ultimul 1 MiB din transcript (trimis la `claude -p` pentru captura automată dinaintea compactării) ajung la furnizorul modelului, ca orice alt prompt.
- **Se partajează doar memoriile etichetate `org`**, și doar după ce trec filtrul. Filtrul e fail-closed: dacă nu poate verifica o memorie, nu trimite nimic.
- **Memoriile colegilor ajung la modelul tău.** Memoriile org sunt injectate marcate ca „date de referință scrise de colegi, nu instrucțiuni", dar asta reduce riscul de prompt injection, nu îl elimină. Dă drept de push pe repo-ul org doar oamenilor în care ai încredere; setează `orgInjection` la `titles` sau `off` ca să injectezi mai puțin. Vezi [SECURITY.md](SECURITY.md).

## 👥 Configurare pentru echipă (vault org)

1. Creează un repo Git privat cu un branch numit `knowledge` (sau setează `orgBranch`) care are cel puțin un commit, și rulează `gh auth login`.
2. Fiecare coleg rulează scriptul de instalare cu repo-ul:

   ```bash
   bash "$(ls -d ~/.claude/plugins/cache/my-claude-plugins/total-recall/*/ | sort -V | tail -1)install.sh" \
     --org-repo https://github.com/your-org/team-vault.git --allowed-email-domain yourcompany.com
   ```

3. De aici înainte, o memorie etichetată `org` e trimisă după salvare, iar fiecare sesiune aduce la pornire memoriile colegilor.

- **Ce se partajează:** doar memoriile etichetate explicit `org`. Captura automată scrie numai în vault-ul personal.
- **Ce e protejat:** uneltele refuză să modifice o memorie org scrisă de altcineva (verificare după numele de utilizator din sistem). Nu e control de acces: oricine are drept de push poate edita repo-ul direct, deci folosește branch protection și permisiunile repo-ului pentru asta.
- **Ce nu e revizuit:** o memorie org e vizibilă tuturor imediat ce e trimisă.

## 💻 Clienți suportați

| Client | Unelte | Index la pornirea sesiunii | Captură automată |
|---|---|---|---|
| **Claude Code** | ✅ | ✅ | ✅ |
| **Gemini/Antigravity** (`--gemini`) | ✅ | ❌ Gemini ignoră ieșirea hook-urilor; modelul citește `total-recall://index` | ✅ |
| **VS Code, Copilot agent mode** | ✅ | ⚠️ cu agent plugins (Preview, neverificat încă); cu `--vscode`, prin `total-recall://index` | ⚠️ doar cu agent plugins |
| **Codex CLI** | ✅ | ❌ apelezi uneltele singur | ❌ |

Merge și cu `ollama launch claude`: același vault, indiferent cu ce model vorbește Claude Code.

## ⚙️ Configurare

Opțional, în `~/.total-recall/config.json`:

```json
{
  "orgRepo": "https://github.com/you/your-vault.git",
  "orgBranch": "knowledge",
  "allowedEmailDomains": ["yourcompany.com"],
  "orgInjection": "index",
  "enableMultilingualSearch": true,
  "personalVault": "~/my-personal-vault"
}
```

`orgInjection` e `index` (implicit), `titles` sau `off`. `enableMultilingualSearch` face ca o întrebare în română să găsească o memorie în engleză și invers. Toate cheile, inclusiv `embeddingModel`, `orgVault` și blocul spec-driven: [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md) și [docs/SPEC-DRIVEN.md](docs/SPEC-DRIVEN.md) (în engleză).

## 🔧 Actualizare, backup și depanare

- **Actualizare:** `claude plugin update total-recall@my-claude-plugins`, repornește Claude Code, apoi rulează din nou scriptul de instalare (actualizarea nu îl rulează, iar căutarea semantică are nevoie de el).
- **Recuperezi o memorie:** vault-ul personal e un repo git local, cu commit la finalul fiecărei sesiuni: `git -C ~/.total-recall/personal-vault log`, apoi `git restore` pe ce îți trebuie, apoi îi ceri lui Claude *„reconstruiește indexul"* (`rebuild_index`).
- **Laptop nou:** îi ceri lui Claude *„exportă toate memoriile"* (`export_memories`, un fișier JSON) și le imporți pe mașina nouă (`import_memories`). Memoriile org vin înapoi din repo-ul org.
- **Indexurile se pot reface oricând:** `index.json`, `invertedIndex.json`, `.index-cache.txt` și `vectors.db` sunt reconstruite din fișierele `.md`.
- **Ceva pare în neregulă:** `get_stats` arată erorile recente și dacă e pornită căutarea semantică. La pornirea sesiunii primești un avertisment dacă push-urile org sau captura automată eșuează repetat. Dacă după o actualizare căutarea semantică e oprită, rulează `npm rebuild better-sqlite3` în cel mai nou folder din `~/.claude/plugins/cache/my-claude-plugins/total-recall/`.
- **Dezinstalare:** `claude plugin uninstall total-recall@my-claude-plugins`. Memoriile rămân în `~/.total-recall/` până ștergi folderul.

## ⚖️ Limite

- **Indexul injectat crește odată cu vault-ul:** cam 4.4k tokeni la 100 de memorii, 32k la 1.000, și încă nu are plafon. Curăță cu `prune_memories` (îți arată candidații; nu șterge nimic singur).
- **Căutarea citește titlul, etichetele și primele 500 de caractere ale fiecărei memorii**, nu tot textul. Scrie informația cheie la început; fiecare memorie începe cu un rezumat executiv.
- **Mai multe sesiuni în paralel** nu strică conținutul (fiecare memorie e un fișier separat), dar ultima sesiune închisă câștigă la contoarele de accesare din `index.json`.
- **Calitatea căutării nu e încă măsurată** pe un set de evaluare; e în [backlog](BACKLOG.md).
- **Release-urile nu sunt semnate.** Pluginul se instalează din branch-ul `release`, construit de GitHub Actions după ce trec testele, acoperirea și mutation testing.

## 📚 Mai mult (în engleză)

- [Cum funcționează](docs/HOW-IT-WORKS.md): structura pe disc, câmpurile din frontmatter, căutarea și formula de uitare, hook-urile, Obsidian
- [Cele 22 de unelte](docs/TOOLS.md) și formatul exportului
- [Lucru spec-driven și ADL](docs/SPEC-DRIVEN.md): legi decizii de cerințe și reguli de arhitectură de teste, cu un exemplu de cinci minute
- [Arhitectura](plugins/total-recall/ARCHITECTURE.md): diagrame C4, model de date, fluxul de scriere
- [Metrici de calitate](docs/QUALITY.md): teste, mutation testing, complexitate, cuplare, DORA, scalare
- [Proiecte similare](docs/COMPARISON.md) · [Securitate](SECURITY.md) · [Ghid de instalare](plugins/total-recall/INSTALL.md)
- [Prezentare: Claude vs Ollama & Total Recall](https://github.com/adrian-balaban/presentation-claude-vs-ollama-and-total-recall-plugin-21-07-2026) (în română, iulie 2026)

## 📊 Status

**v1.6.7**, stabilă. 1.006 teste unitare și 24 de integrare trec; acoperire 97% pe instrucțiuni; scor de mutație 80% (pragul Stryker e 65%). [Licență MIT](LICENSE). Întreținut de o singură persoană, [Adrian Balaban](https://github.com/adrian-balaban); issue-urile și pull request-urile sunt binevenite pe GitHub.
