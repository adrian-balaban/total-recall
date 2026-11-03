# 🧠 total-recall

[![CI](https://github.com/adrian-balaban/total-recall/actions/workflows/mutation.yml/badge.svg?branch=main)](https://github.com/adrian-balaban/total-recall/actions/workflows/mutation.yml) [![License: MIT](https://img.shields.io/github/license/adrian-balaban/total-recall)](LICENSE)

**Asistentul tău AI uită totul la finalul fiecărei sesiuni. Acest plugin rezolvă problema.**

Memorie persistentă și căutabilă pentru asistenții AI de programare: Claude Code, Gemini/Antigravity, VS Code (GitHub Copilot agent mode), Codex CLI, Cursor, Windsurf, Claude Desktop sau orice alt client care vorbește Model Context Protocol (MCP). Memoriile sunt fișiere Markdown simple pe discul tău, pe care le poți citi, edita, căuta cu grep și versiona cu git.

[🇬🇧 English](README.md) · 🇷🇴 Română

- **Ce primești:** asistentul poate salva ce îi spui („ține minte că…"), regăsi informația în orice sesiune ulterioară și o poate actualiza sau șterge. În Claude Code vede în plus, la începutul fiecărei sesiuni, un index al memoriilor și salvează singur 0–3 lecții înainte de compactarea contextului.
- **Unde se păstrează:** în `~/.total-recall/`, câte un fișier `.md` pentru fiecare memorie, un singur vault pentru toate proiectele. Fără server de rulat, fără cont. Memoriile etichetate `org` pot ajunge (opțional) într-un repo Git comun, după un filtru de confidențialitate care blochează secrete, adrese de email din afara domeniilor tale permise, numere de card, IBAN-uri și numere de telefon. Alte trei pluginuri se numesc tot `total-recall`: [prin ce diferă acesta](docs/COMPARISON.md) (în engleză).
- **Cost:** gratuit și open source (MIT). Pluginul are ~1–2 MB; profilul implicit descarcă o singură dată un model local multilingv (449 MB; 87 MB pentru cel doar în engleză; `--no-vector` îl omite). Indexul afișat la pornirea sesiunii costă 30–40 de tokeni per memorie.

## Dintr-o privire

- **Licență:** MIT, gratuit. **Întreținător:** o singură persoană, [Adrian Balaban](https://github.com/adrian-balaban), după disponibilitate — issue-urile și pull request-urile sunt binevenite, dar nu există SLA.
- **Maturitate:** v1.6.8, release-uri cu tag din august 2026 (~10/lună). 1.036 de teste, acoperire 97%, scor de mutație 81%. Release-urile se construiesc pe GitHub Actions din branch-ul `release`, dar **nu sunt semnate**.
- **Fișierele rămân locale** implicit. Furnizorul modelului vede ce citește asistentul, iar Claude Code trimite ultimul 1 MiB din transcript la `claude -p` pentru captura automată. Singurul alt trafic spre exterior este o descărcare unică a modelului și, dacă optezi pentru asta, repo-ul git al propriei echipe.
- **Riscul vault-ului de echipă:** oricine are drept de push pe repo-ul echipei poate edita orice memorie, iar nimic nu e revizuit înainte să devină vizibil ([detalii](#configurare-pentru-echipă-vault-org)).
- **Indexul nu are plafon:** 30–40 de tokeni per memorie, cam 4.4k la 100 de memorii, 32k la 1.000 și 162k la 5.000.

Cifre complete: [Metrici de calitate](docs/QUALITY.md) · [Limite](#limite) mai jos.

## Pornire rapidă

**Ai nevoie de:** Node.js 18+, git și Linux, macOS sau Windows cu Git Bash (plus un `node.exe` de Windows în PATH; Node instalat doar în WSL nu contează).

### Claude Code

1. Instalează pluginul după ID-ul complet (alte pluginuri au același nume):

   ```
   /plugin marketplace add adrian-balaban/total-recall
   /plugin install total-recall@my-claude-plugins
   ```

2. Într-un terminal, rulează o singură dată scriptul de instalare. Creează vault-urile și construiește indexul. Pune două întrebări: profilul (**complet**, implicit, adaugă căutare semantică locală; **minimal**, sau `--no-vector`, doar căutare de text, funcționează offline) și dacă vrei un vault de echipă (implicit nu, sari peste pentru utilizare solo). Cu `-y` accepți valorile implicite și sari peste ambele întrebări. Comanda de mai jos găsește versiunea curentă a pluginului în cache (glob-ul alege pur și simplu cea mai recentă dacă sunt mai multe) și rulează `install.sh`-ul ei:

   ```bash
   bash "$(ls -d ~/.claude/plugins/cache/my-claude-plugins/total-recall/*/ | sort -V | tail -1)install.sh"
   ```

3. Spune-i lui Claude să folosească total-recall în locul fișierelor `MEMORY.md` proprii. Adaugă asta în `~/.claude/CLAUDE.md`:

   ```markdown
   ## Memory
   Use total-recall exclusively for all memories, in every project.
   - Store via `store_memory` / `update_memory`; recall via `search_index` / `recall_memory` / `get_memories_by_keys`.
   - NEVER use the harness file-based memory (`memory/`, `MEMORY.md`) or `.remember/`.
   - If total-recall is unavailable, tell me and skip persisting — do not silently fall back.
   ```

   Acest pas e necesar: fără el, Claude Code continuă să-și folosească propria memorie bazată pe fișiere în paralel cu total-recall; ca să anulezi, șterge blocul. Dacă folosești și pluginul oficial `remember`, dezactivează-l: amândouă fac același lucru.

4. Repornește Claude Code și verifică: spune *„ține minte că proiectul ăsta folosește Gradle 8 și JUnit 5"*. Apare un fișier nou în `~/.total-recall/personal-vault/`. Într-o sesiune nouă, întreabă *„ce build tool folosește proiectul?"*. Apoi cere asistentului să apeleze `get_stats`: îți arată totalurile, erorile recente și dacă căutarea semantică e pornită.

### Alți asistenți

Gemini/Antigravity, VS Code, Codex, Cursor, Windsurf, Claude Desktop. Pașii pentru fiecare asistent, notele pentru Windows și toate opțiunile: [INSTALL.md](plugins/total-recall/INSTALL.md) (în engleză).

<details>
<summary>Orice client MCP: varianta scurtă</summary>

```bash
git clone --depth 1 -b release https://github.com/adrian-balaban/total-recall.git ~/total-recall-plugin
cd ~/total-recall-plugin/plugins/total-recall && ./install.sh -y
```

Apoi înregistrează serverul în configurarea MCP a clientului (comanda `bash`, argument calea absolută către `scripts/start-server.sh`), de exemplu în formatul `mcpServers`:

```json
{
  "mcpServers": {
    "total-recall": {
      "command": "bash",
      "args": ["/home/you/total-recall-plugin/plugins/total-recall/scripts/start-server.sh"]
    }
  }
}
```

Pentru Codex, aceeași comandă și același argument merg în `~/.codex/config.toml`. Adaugă blocul `## Memory` de la pasul 3 în fișierul de instrucțiuni al asistentului. Fără hook-uri, asistentul citește resursa `total-recall://index` și promptul `memory-workflow` în loc de un index injectat. Ca să verifici că merge, cere asistentului să apeleze `get_stats`.

</details>

## Utilizare zilnică

| Spui | Ce se întâmplă | Unealtă |
|---|---|---|
| *„ține minte că am ales PostgreSQL pentru JSONB"* | Se scrie o memorie în `~/.total-recall/personal-vault/` | `store_memory` |
| *„ține minte pentru echipă că facem deploy în eu-central-1"* | Etichetată `org`, filtrată și trimisă în repo-ul echipei | `store_memory` |
| *„ce am decis despre baza de date?"* | Asistentul caută și citește memoriile potrivite | `search_index`, `recall_memory` |
| *„memoria asta e depășită, actualizeaz-o"* / *„șterge-o"* | Fișierul e editat sau șters | `update_memory`, `delete_memory` |
| nimic (Claude Code) | Înainte de compactare se salvează 0–3 lecții din sesiune | hook-ul `PreCompact` |

Toate proiectele folosesc același vault. Pomenește proiectul în memorie („în serviciul de facturare, …") ca să le poți deosebi la căutare.

## Datele tale

Fiecare memorie e un fișier Markdown cu un mic antet YAML:

```markdown
---
title: "Prefer PostgreSQL for relational data"
tags: [architecture, database]
importanceScore: 0.8
updated: 2026-06-15T14:30:00Z
---
## Executive Summary
Prefer PostgreSQL over MySQL for new projects because of JSONB support…
```

| Fel | Fișiere | Dacă se pierd |
|---|---|---|
| **Sursă** | fișierele `.md` din `~/.total-recall/personal-vault/` | dispar, dacă nu le restaurezi din repo-ul git local al vault-ului |
| **Derivate** | `index.json`, `invertedIndex.json`, `.index-cache.txt`, `vectors.db` | se reconstruiesc automat din fișierele `.md` (contoarele de accesare se resetează). `index.json`-ul org din repo-ul echipei nu se reface: nu-l modifica |

Exportul e JSON simplu (`export_memories`, întors în răspunsul asistentului), deci `jq` sau DuckDB merg pe el după ce îl salvezi. Pentru o mașină nouă, îl imporți cu `import_memories` (memoriile org revin din repo-ul echipei; pentru un vault mare e mai simplu să copiezi folderul vault-ului). Pentru un backup în afara mașinii, copiază `personal-vault/`: repo-ul lui git local e pe același disc: [Cele 22 de unelte → Export format](docs/TOOLS.md#export-format) (în engleză).

## Limbi

Căutarea de text merge în orice limbă scrisă cu alfabet latin, ignorând majoritatea diacriticelor, atâta timp cât întrebarea și memoria folosesc aceleași cuvinte; nu vede alte alfabete. Căutarea semantică opțională (activă implicit în profilul „complet") acoperă orice pereche de limbi, inclusiv chirilică, greacă, arabă, chineză și japoneză: din 1.6.8 modelul implicit e multilingv (50+ limbi).

Dacă lucrezi doar în engleză și vrei o descărcare mai mică (87 MB față de 449 MB), setează modelul doar pentru engleză în `~/.total-recall/config.json` și repornește asistentul:

```json
{ "embeddingModel": "Xenova/all-MiniLM-L6-v2" }
```

Mai mult: [Cum funcționează → Limbi](docs/HOW-IT-WORKS.md) (în engleză).

## Asistenți suportați

| Asistent | Unelte | Index la pornirea sesiunii | Captură automată | Sincronizare echipă | Testat |
|---|---|---|---|---|---|
| **Claude Code** | ✅ | ✅ | ✅ | ✅ automată | ✅ |
| **Gemini/Antigravity** (`--gemini`) | ✅ | ⚠️ prin fișierul de instrucțiuni (Gemini ignoră ieșirea hook-urilor) | ⚠️ doar dacă e instalat CLI-ul `claude` | ✅ automată | ✅ |
| **VS Code, Copilot** (`--vscode`) | ✅ | ⚠️ prin fișierul de instrucțiuni | ❌ folosește promptul | ❌ manuală | ❌ |
| **Codex, Cursor, Windsurf, Claude Desktop, alți clienți MCP** | ✅ | ⚠️ prin fișierul de instrucțiuni | ❌ folosește promptul | ❌ manuală | ❌ |

Toate cele 22 de unelte merg peste tot. „Prin fișierul de instrucțiuni" înseamnă că asistentul citește `total-recall://index` sau apelează `search_index` pentru că așa îi spune pasul 3. **Testat** înseamnă că instalarea a fost rulată cap-coadă.

## Cum e construit

Un server MCP stdio (TypeScript) plus hook-uri de ciclu de viață, peste fișiere Markdown simple; toate indexurile sunt derivate și se pot reconstrui. Diagrame C4 și invarianți: [Arhitectura](plugins/total-recall/ARCHITECTURE.md). Opțional, pentru arhitecți: legi memoriile de cerințe și regulile de arhitectură de teste (ADL), cu un exemplu de cinci minute în [lucrul spec-driven](docs/SPEC-DRIVEN.md) (în engleză).

## Confidențialitate: ce pleacă de pe mașina ta

- **Fișierele rămân locale.** Vault-ul personal nu e trimis nicăieri; repo-ul git local blochează orice push.
- **Modelul vede ce citește:** indexul, memoriile regăsite și, în Claude Code, ultimul 1 MiB din transcript (trimis la `claude -p` pentru captura automată, care nu poate fi oprită deocamdată).
- **Alte conexiuni la rețea:** modelul semantic se descarcă o dată de pe Hugging Face; vault-ul de echipă folosește git. Fără telemetrie.
- **Se partajează doar memoriile etichetate `org`**, și doar după ce trec filtrul. Dacă filtrul nu poate verifica o memorie, nu trimite nimic. Filtrul recunoaște tipare, nu sens: nume de servere interne, nume de clienți sau informații de business trec de el, deci nu le eticheta `org`.
- **Memoriile colegilor ajung la modelul tău**, marcate ca date de referință, nu ca instrucțiuni. Asta reduce riscul de prompt injection, dar nu îl elimină: dă drept de push doar oamenilor în care ai încredere sau setează `orgInjection` la `titles` ori `off`. Vezi [SECURITY.md](SECURITY.md).
- **Poți renunța fără pierderi.** Memoriile rămân ca fișiere `.md` pe care le păstrezi, iar `export_memories` îți dă JSON.

## Configurare pentru echipă (vault org)

**Controlul accesului e slab: oricine are drept de push pe repo-ul echipei poate edita sau se poate da drept autorul oricărei memorii, și nimic nu e revizuit înainte să devină vizibil întregii echipe.** Tratează-l ca pe un wiki partajat. Regulile și lista de pași pentru lansare: [INSTALL.md → Vault org](plugins/total-recall/INSTALL.md#-org-vault-team-memory) (în engleză).

1. Creează un repo Git privat pe orice platformă (GitHub, GitLab, Bitbucket, serverul vostru), cu un branch `knowledge` care are cel puțin un commit:

   ```bash
   git clone https://github.com/your-org/team-vault.git && cd team-vault
   git switch -c knowledge && git commit --allow-empty -m "init" && git push -u origin knowledge
   ```

2. Fiecare coleg rulează scriptul de instalare cu repo-ul (pentru GitHub, întâi `gh auth login`; pentru alte platforme, credențiale git care merg fără întrebări, de exemplu un credential helper sau o cheie SSH). `--allowed-email-domain` lasă domeniul email-urilor tale de serviciu să treacă de filtrul de confidențialitate:

   ```bash
   ./install.sh --org-repo https://github.com/your-org/team-vault.git --allowed-email-domain yourcompany.com
   ```

3. De aici înainte, în Claude Code și Gemini/Antigravity, o memorie etichetată `org` e trimisă după salvare, iar fiecare sesiune aduce la pornire memoriile colegilor. Ceilalți asistenți nu au hook-uri pentru asta: vezi [INSTALL.md → Vault org](plugins/total-recall/INSTALL.md#-org-vault-team-memory) (în engleză).

4. Verifică: pe o mașină spune *„ține minte pentru echipă că …"*; pe alta, pornește o sesiune nouă și întreabă despre asta. Dacă nu ajunge, cere `get_stats` (erori recente); în Claude Code, pornirea sesiunii te avertizează și când push-urile de echipă eșuează repetat.

Începe singur și adaugă echipa mai târziu: `install.sh` poate fi rulat din nou fără probleme. Setările (`orgBranch`, `allowedEmailDomains`, `orgInjection`, căile vault-urilor): [Cum funcționează → Configurare](docs/HOW-IT-WORKS.md#configuration) (în engleză).

## Actualizare, backup și depanare

- **Actualizare (Claude Code):** `claude plugin update total-recall@my-claude-plugins`, repornești, apoi rulezi din nou scriptul de instalare (actualizarea nu îl rulează).
- **Alți asistenți:** pașii de actualizare și dezinstalare sunt în [INSTALL.md → Install without Claude Code](plugins/total-recall/INSTALL.md#-install-without-claude-code) (în engleză).
- **Recuperezi o memorie:** în Claude Code și Gemini, vault-ul personal primește un commit în repo-ul git local la finalul fiecărei sesiuni: `git -C ~/.total-recall/personal-vault log`, `git restore` pe ce îți trebuie, apoi ceri *„reconstruiește indexul"* (`rebuild_index`). Cu alți asistenți, fă tu commit-ul. Versiunile arhivate (`.superseded/`) și `vectors.db` nu sunt în acel repo.
- **Ceva pare în neregulă:** `get_stats` arată erorile recente și dacă e pornită căutarea semantică. În Claude Code, pornirea sesiunii te avertizează când push-urile de echipă sau captura automată eșuează repetat. Dacă după o actualizare căutarea semantică e oprită, rulează `npm rebuild better-sqlite3` în folderul pluginului.
- **Dezinstalare (Claude Code):** `claude plugin uninstall total-recall@my-claude-plugins`. Memoriile rămân în `~/.total-recall/` până ștergi folderul.

## Limite

- **Indexul de la pornirea sesiunii nu are plafon** (costul e în [Dintr-o privire](#dintr-o-privire)). Curăță cu `prune_memories`: îți arată candidații și nu șterge nimic.
- **Căutarea de text citește titlul, etichetele și primele 500 de caractere** ale fiecărei memorii, nu tot textul. Pune informația cheie la început.
- **Mai multe sesiuni în paralel** nu pot strica fișierele, dar o memorie salvată într-una poate lipsi din căutările alteia până când aceasta repornește ([detalii](docs/HOW-IT-WORKS.md), în engleză).
- **Captura automată** rulează doar unde e instalat CLI-ul `claude` și nu poate fi oprită deocamdată.
- **Calitatea căutării nu e încă măsurată** pe un set de evaluare; e în [backlog](BACKLOG.md).

## Mai mult (în engleză)

- [Cum funcționează](docs/HOW-IT-WORKS.md): stocarea, câmpurile din frontmatter, configurarea, căutarea și curba uitării, hook-urile, Obsidian
- [Cele 22 de unelte](docs/TOOLS.md) și formatul exportului
- [Lucru spec-driven și ADL](docs/SPEC-DRIVEN.md): legi decizii de cerințe și reguli de arhitectură de teste, cu un exemplu de cinci minute
- [Arhitectura](plugins/total-recall/ARCHITECTURE.md): diagrame C4, model de date, fluxul de scriere
- [Metrici de calitate](docs/QUALITY.md): teste, scor de mutație, complexitate, cuplare, livrare, scalare
- [Proiecte similare](docs/COMPARISON.md) · [Securitate](SECURITY.md) · [Ghid de instalare](plugins/total-recall/INSTALL.md)

## Status

Vezi [Dintr-o privire](#dintr-o-privire) pentru licență, întreținător și maturitate. [Licență MIT](LICENSE) · [Metrici de calitate](docs/QUALITY.md).
