# 🧠 total-recall

[![CI](https://github.com/adrian-balaban/total-recall/actions/workflows/mutation.yml/badge.svg?branch=main)](https://github.com/adrian-balaban/total-recall/actions/workflows/mutation.yml) [![License: MIT](https://img.shields.io/github/license/adrian-balaban/total-recall)](LICENSE)

**Asistentul tău AI uită totul la finalul fiecărei sesiuni. Acest plugin rezolvă problema.**

Memorie persistentă și căutabilă pentru asistenții AI de programare: Claude Code, Gemini/Antigravity, VS Code (GitHub Copilot agent mode), Codex CLI, Cursor și Windsurf (ambele netestate încă), Claude Desktop sau orice alt client care respectă Model Context Protocol (MCP). Memoriile sunt fișiere Markdown simple pe discul tău, pe care le poți citi, edita, căuta cu grep și versiona cu git, sau le poți deschide ca vault [Obsidian](docs/HOW-IT-WORKS.md#-obsidian) (în engleză).

[🇬🇧 English](README.md) · 🇷🇴 Română

- **Ce primești:** asistentul poate salva ce îi spui („ține minte că…”), regăsi informația în orice sesiune ulterioară și o poate actualiza sau șterge. În Claude Code vede în plus, la începutul fiecărei sesiuni, un index al memoriilor și salvează singur 0–3 lecții înainte de compactarea contextului.
- **Unde se păstrează:** în `~/.total-recall/`, câte un fișier `.md` pentru fiecare memorie, un singur vault pentru toate proiectele. Nu ai nevoie de un server separat sau de un cont. Memoriile etichetate `org` pot ajunge (opțional) într-un repo Git comun, după un filtru de confidențialitate care blochează secrete și identificatori personali uzuali (doar tipare: vezi [Confidențialitate](#confidențialitate-ce-pleacă-de-pe-mașina-ta)).
- **Cost:** free și open source (MIT). Pluginul are ~1–2 MB; profilul implicit descarcă la prima utilizare un model local multilingv (449 MB; 87 MB pentru cel doar în engleză; `--no-vector` îl omite).

![Bucla sesiunii](docs/diagrams/session-loop-ro.svg)

## Dintr-o privire

- **Licență:** MIT, free. **Întreținător:** o singură persoană, [Adrian Balaban](https://github.com/adrian-balaban), după posibilități — issue-urile și pull request-urile sunt binevenite, dar nu există SLA.
- **Maturitate:** v1.8.1, release-uri cu tag din august 2026 (~10/lună). Ultima bază de măsură (v1.7.1): 1.046 de teste, acoperire 97%, scor de mutație 81%. Release-urile se construiesc pe GitHub Actions din branch-ul `release`, dar **nu sunt semnate**.
- **Fișierele rămân locale** implicit. Furnizorul modelului vede ce citește asistentul, iar Claude Code trimite ultimul 1 MiB din istoricul sesiunii (transcript) la `claude -p` pentru captura automată (nu poate fi oprită deocamdată). Singurul alt trafic spre exterior sunt descărcările de pachete și de model la instalare (profilul Complete) și, dacă optezi pentru asta, repo-ul git al propriei echipe.
- **Riscul vault-ului de echipă:** oricine are drept de push pe repo-ul echipei poate edita orice memorie, iar nimic nu e revizuit înainte să devină activ pentru toată echipa ([detalii](#configurare-pentru-echipă-vault-org)). Sincronizarea echipei e automată în Claude Code și Gemini/Antigravity; la ceilalți asistenți setează `"orgSync": "server"` ca serverul să facă push, iar memoriile colegilor le aduci manual.
- **Indexul are plafon implicit:** `indexMaxEntries` are valoarea implicită 300 (circa 10k tokeni); `0` elimină plafonul. O memorie costă 30–40 de tokeni (exemple fără plafon: circa 4,4k la 105 memorii, 32–40k la 1.000 și 162–200k la 5.000), iar intrările dincolo de plafon rămân accesibile prin căutare.
- **Unelte spec-driven (pentru arhitecți și lideri de testare, active implicit):** leagă deciziile de ID-urile cerințelor și verifică dacă fiecare regulă cu ID din fișierele ADL are un test care conține acel ID (doar acoperirea; testele nu sunt rulate). Cinci din cele 22 de unelte. Nu folosești fișiere ADL? Ignoră-le sau setează `"specDriven": {"enabled": false}` în `~/.total-recall/config.json`. [Lucru spec-driven și ADL](docs/SPEC-DRIVEN.md) (în engleză).

Cifre complete: [Metrici de calitate](docs/QUALITY.md) · [Limite](#limite) mai jos.

## Pornire rapidă

**Ai nevoie de:** Node.js 18+, git, pe Linux, macOS sau Windows cu Git Bash (plus un `node.exe` de Windows în PATH; Node instalat doar în WSL nu contează).

### Din sursă / fork

`git clone https://github.com/adrian-balaban/total-recall.git && cd total-recall && ./install.sh` construiește pluginul din clona ta și îl instalează, în loc să aducă build-ul `release` din marketplace. Pentru forkuri și cod de pe `main` nelansat încă: [INSTALL.md § Install from a local clone](plugins/total-recall/INSTALL.md#-install-from-a-local-clone-build-it-yourself) (în engleză).

### Claude Code

**O singură comandă în loc de pașii 1 și 2:** `npx @adrian-balaban/total-recall` adaugă marketplace-ul, instalează pluginul și rulează scriptul de instalare; acceptă aceleași opțiuni ca `install.sh` (`-y`, `--strict`, `--no-vector`, `--vscode`, `--org-repo …`). Folosește numele cu scope: `total-recall` fără scope de pe npm este o unealtă fără legătură. Pachetul npm conține doar acest lansator; pluginul vine în continuare din branch-ul `release` al acestui repo. Apoi continuă cu pasul 3.

1. Scrie comenzile astea în chatul Claude Code (sau rulează `claude plugin …` într-un terminal). Folosește ID-ul complet, fiindcă alte pluginuri au același nume:

   ```
   /plugin marketplace add adrian-balaban/total-recall
   /plugin install total-recall@my-claude-plugins
   ```

2. Într-un terminal (pe Windows: Git Bash), rulează o singură dată scriptul de instalare. Creează vault-urile, înregistrează serverul MCP și construiește indexul, și întreabă profilul (**Complete**, implicit, adaugă căutare semantică locală; **Minimal**, sau `--no-vector`, doar căutare de text) și dacă adaugi un vault de echipă (implicit nu). `-y` acceptă ambele valori implicite; pune-l după ghilimeaua de închidere. Comanda găsește cea mai recentă versiune din cache:

   ```bash
   bash "$(ls -d ~/.claude/plugins/cache/my-claude-plugins/total-recall/*/ | sort -V | tail -1)install.sh"
   ```

3. Spune-i lui Claude să folosească total-recall în locul fișierelor `MEMORY.md` integrate. Adaugă asta în `~/.claude/CLAUDE.md` (creează fișierul dacă nu există; pe Windows `~` este `C:\Users\<tu>`):

   ```markdown
   ## Memory

   Use total-recall exclusively for all memories, in every project.

   - Store via `store_memory` / `update_memory`; recall via `search_index` / `recall_memory` / `get_memories_by_keys`.
   - NEVER use the harness file-based memory (`memory/`, `MEMORY.md`) or `.remember/`.
   - If total-recall is unavailable, tell me and skip persisting — do not silently fall back.
   ```

   Acest pas e necesar: fără el, Claude Code continuă să-și folosească propria memorie bazată pe fișiere alături de total-recall; ca să anulezi, șterge blocul. Dacă folosești și pluginul oficial `remember`, dezactivează-l: amândouă fac același lucru.

4. Repornește Claude Code (`/exit`, apoi `claude`; aprobă uneltele total-recall când ți se cere) și verifică: spune _„ține minte că proiectul ăsta folosește Gradle 8 și JUnit 5”_. Apare un fișier nou într-un subfolder din `~/.total-recall/personal-vault/`. Într-o sesiune nouă, întreabă _„ce build tool folosește proiectul?”_. Apoi cere asistentului să apeleze `get_stats`: îți arată totalurile, erorile recente și dacă căutarea semantică e pornită. Dacă lipsesc uneltele, rulează `/mcp` și caută `total-recall`.

### Alți asistenți

Gemini/Antigravity, VS Code, Codex, Cursor, Windsurf, Claude Desktop. INSTALL.md are pași pentru Gemini/Antigravity, VS Code și Codex, plus notele pentru Windows și toate opțiunile: [INSTALL.md](plugins/total-recall/INSTALL.md) (în engleză). Pentru ceilalți clienți, folosește blocul de mai jos.

<details>
<summary>Orice client MCP: varianta scurtă</summary>

```bash
git clone --depth 1 -b release https://github.com/adrian-balaban/total-recall.git ~/total-recall-plugin
cd ~/total-recall-plugin/plugins/total-recall && ./install.sh -y
```

Fără CLI-ul `claude`, scriptul avertizează că a sărit peste înregistrarea MCP: e normal (pentru VS Code, adaugă `--vscode`). Apoi înregistrează serverul în configurarea MCP a clientului (comanda `bash`, cu argumentul: calea absolută către `scripts/start-server.sh`), de exemplu în formatul `mcpServers`:

```json
{
  "mcpServers": {
    "total-recall": {
      "command": "bash",
      "args": [
        "/home/you/total-recall-plugin/plugins/total-recall/scripts/start-server.sh"
      ]
    }
  }
}
```

Pentru Codex, aceeași comandă și același argument merg în `~/.codex/config.toml`. Adaugă blocul `## Memory` de la pasul 3 în fișierul de instrucțiuni al asistentului. Fără hook-uri, asistentul citește resursa `total-recall://index` și promptul `memory-workflow` în loc de un index injectat. Ca să verifici că merge, cere asistentului să apeleze `get_stats`.

</details>

## Utilizare zilnică

| Spui                                                         | Ce se întâmplă                                           | Unealtă                          |
| ------------------------------------------------------------ | -------------------------------------------------------- | -------------------------------- |
| _„ține minte că am ales PostgreSQL pentru JSONB”_            | Se scrie o memorie în `~/.total-recall/personal-vault/`  | `store_memory`                   |
| _„ține minte pentru echipă că facem deploy în eu-central-1”_ | Etichetată `org`, filtrată și trimisă în repo-ul echipei | `store_memory`                   |
| _„ce am decis despre baza de date?”_                         | Asistentul caută și citește memoriile potrivite          | `search_index`, `recall_memory`  |
| _„memoria asta e depășită, actualizeaz-o”_ / _„șterge-o”_    | Fișierul e editat sau șters                              | `update_memory`, `delete_memory` |
| nimic (Claude Code)                                          | Înainte de compactare se salvează 0–3 lecții din sesiune | hook-ul `PreCompact`             |

Toate proiectele folosesc același vault. Numește proiectul în memorie („în serviciul de billing, …”) ca să le ții separate în rezultatele căutării.

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

`## Executive Summary` este partea pe care asistentul o citește prima; spune de ce contează memoria.

| Tip          | Fișiere                                                              | Dacă se pierd                                                                                                                                                                                                           |
| ------------ | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sursă**    | fișierele `.md` din `~/.total-recall/personal-vault/`                | pierdute definitiv, dacă nu le restaurezi din repo-ul git local al vault-ului                                                                                                                                           |
| **Derivate** | `index.json`, `invertedIndex.json`, `.index-cache.txt`, `vectors.db` | se reconstruiesc din fișierele `.md` (contoarele de accesare se resetează; `.index-cache.txt` doar la pornirea sesiunii, în Claude Code și Gemini). `index.json`-ul org din repo-ul echipei nu se reface: nu-l modifica |

Exportul e JSON simplu (`export_memories`). Vine în răspunsul asistentului, deci trece prin contextul modelului, și lasă deoparte contoarele de accesare, confirmările, marcajele și versiunile arhivate ([Formatul exportului](docs/TOOLS.md#export-format), în engleză). Pentru backup, copiază `personal-vault/` și `config.json` din `~/.total-recall/`; repo-ul git local al vault-ului e pe același disc, deci nu e un backup în sine. Pentru mutare pe altă mașină: instalează, copiază cele două în `~/.total-recall/`, rulează din nou scriptul de instalare, apoi cere _„reconstruiește indexul”_. Memoriile org revin din repo-ul echipei.

## Limbi

Căutarea de text merge în orice limbă scrisă cu alfabet latin, ignorând majoritatea diacriticelor, atâta timp cât întrebarea și memoria folosesc aceleași cuvinte; nu vede alte alfabete. Căutarea semantică opțională (activă implicit în profilul „Complete”) suportă potrivire între limbile acoperite de modelul implicit (50+ limbi), inclusiv chirilică, greacă, arabă, chineză și japoneză: din 1.6.8 e multilingv.

Lucrezi doar în engleză? Un model mai mic (87 MB față de 449 MB) se setează dintr-o linie de configurare: [Cum funcționează → Limbi](docs/HOW-IT-WORKS.md#languages) (în engleză).

## Asistenți suportați

| Asistent                                                      | Unelte | Index la pornirea sesiunii                                           | Captură automată                                                           | Sincronizare echipă                         | Testat |
| ------------------------------------------------------------- | ------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------- | ------ |
| **Claude Code**                                               | ✅     | ✅                                                                   | ✅                                                                         | ✅ automată                                 | ✅     |
| **Gemini/Antigravity** (`--gemini`, necesită CLI-ul `agy`)    | ✅     | ⚠️ prin fișierul de instrucțiuni (Gemini ignoră ieșirea hook-urilor) | ⚠️ doar dacă e instalat CLI-ul `claude` (captura rulează atunci pe Claude) | ✅ automată                                 | ✅     |
| **VS Code, Copilot** (`--vscode`)                             | ✅     | ⚠️ prin fișierul de instrucțiuni                                     | ❌ folosește promptul `extract-session-learnings`                          | ⚠️ push cu `orgSync: "server"`, pull manual | ❌     |
| **Codex, Cursor, Windsurf, Claude Desktop, alți clienți MCP** | ✅     | ⚠️ prin fișierul de instrucțiuni                                     | ❌ folosește promptul `extract-session-learnings`                          | ⚠️ push cu `orgSync: "server"`, pull manual | ❌     |

Toate cele 22 de unelte funcționează în toți clienții. „Prin fișierul de instrucțiuni” înseamnă că adaugi blocul `## Memory` de la pasul 3 în fișierul de instrucțiuni al asistentului tău, iar asistentul citește `total-recall://index` sau apelează `search_index`, așa cum îi spune blocul. **Testat** înseamnă că instalarea a fost rulată de la cap la coadă. Autorul nu a avut la dispoziție Cursor, Windsurf, Claude Desktop, VS Code/Copilot sau o mașină Windows, deci aceste rânduri sunt netestate: serverul a fost verificat prin stdio (`initialize`, `tools/list`, `get_stats`), iar configurația clientului este forma standard `mcpServers`. Rapoartele sunt binevenite.

## Cum e construit

- Fișierele Markdown simple sunt sursa de adevăr; toate indexurile sunt derivate din ele și se reconstruiesc.
- Un server MCP stdio (TypeScript) plus hook-uri de ciclu de viață; pornește în aproximativ 0,1 s (mediană 99 ms, [Calitate](docs/QUALITY.md), în engleză).
- Căutarea e TF-IDF cu o curbă a uitării, opțional combinată cu vectori locali. Căutarea nu face niciun apel la un LLM.
- Filtrul de confidențialitate blochează în caz de dubiu, înainte de orice push.
- Diagrame C4 și invarianți: [Arhitectura](plugins/total-recall/ARCHITECTURE.md).

## Confidențialitate: ce pleacă de pe mașina ta

- **Fișierele rămân locale.** Vault-ul personal nu e trimis nicăieri; repo-ul git local blochează orice push. Fișierele nu sunt criptate.
- **Captura automată citește ce a citit sesiunea** (pagini web, rezultatele uneltelor) și salvează lecțiile fără revizuire. Ele apar în sesiunile următoare, în toate proiectele, așa că verifică-le din când în când cu _„listează memoriile recente”_.
- **Modelul vede ce citește:** indexul, memoriile regăsite și, în Claude Code, ultimul 1 MiB din istoricul sesiunii (transcript, trimis la `claude -p` pentru captura automată, care nu poate fi oprită deocamdată).
- **Alte conexiuni la rețea:** modelul semantic se descarcă o dată de pe Hugging Face; vault-ul de echipă folosește git. Fără telemetrie.
- **Se partajează doar memoriile etichetate `org`**, și doar după ce trec filtrul. Asistentul alege eticheta, iar o memorie etichetată e trimisă fără să te întrebe. Filtrul blochează în caz de dubiu: dacă nu poate verifica o memorie, nu trimite nimic. Filtrul recunoaște tipare, nu sens: nume de servere interne, nume de clienți sau informații de business trec de el, deci nu le eticheta `org`.
- **Memoriile colegilor ajung la modelul tău.** Intrările lor din index sunt marcate ca date de referință, nu ca instrucțiuni; memoriile complete pe care le regăsești nu sunt, iar `orgInjection` nu le acoperă. Asta reduce riscul de prompt injection, dar nu îl elimină: dă drept de push doar oamenilor în care ai încredere sau setează `orgInjection` la `titles` ori `off`. Un titlu ales de un coleg poate în prezent să iasă din blocul de delimitare ([V2](VULNERABILITIES.md#v2--org-index-framing-can-be-escaped-from-a-memory-title)), deci `off` e singura setare care oprește complet textul org din a ajunge la model. Vezi [SECURITY.md](SECURITY.md) și [vulnerabilitățile cunoscute](VULNERABILITIES.md) (în engleză).
- **Poți renunța fără pierderi.** Memoriile rămân ca fișiere `.md` pe care le păstrezi, iar `export_memories` îți dă și JSON, cu mai puține câmpuri. Dezinstalare în Claude Code: `claude plugin uninstall total-recall@my-claude-plugins` (memoriile rămân în `~/.total-recall/`). Șterge și blocul `## Memory` din `~/.claude/CLAUDE.md`; șterge `~/.total-recall/` ca să elimini toate datele.

## Configurare pentru echipă (vault org)

**Controlul accesului e slab: oricine are drept de push pe repo-ul echipei poate edita orice memorie sau o poate publica în numele altcuiva, și nimic nu e revizuit înainte să devină activ pentru toată echipa.** Tratează-l ca pe un wiki comun.

Pe scurt: creează un repo Git privat cu un branch `knowledge` (fără pull request-uri obligatorii), apoi fiecare coleg rulează din nou scriptul de instalare cu `--org-repo <url> --allowed-email-domain <domeniu>`. De aici înainte, memoriile etichetate `org` se sincronizează automat în Claude Code și Gemini/Antigravity; la ceilalți asistenți setează `"orgSync": "server"` ca serverul să le trimită, iar pull-ul îl faci manual. Pașii, verificarea și lista de verificare pentru introducerea în echipă: [INSTALL.md → Vault org](plugins/total-recall/INSTALL.md#-org-vault-team-memory) (în engleză).

Începe singur și adaugă echipa mai târziu: `install.sh` poate fi rulat din nou fără probleme. Setările (`orgBranch`, `orgSync`, `allowedEmailDomains`, `orgInjection`, căile vault-urilor): [Cum funcționează → Configurare](docs/HOW-IT-WORKS.md#configuration) (în engleză).

## Actualizare, backup și depanare

- **Actualizare (Claude Code):** `claude plugin update total-recall@my-claude-plugins`, repornește, apoi rulează din nou scriptul de instalare (actualizarea nu îl rulează).
- **Alți asistenți:** pașii de actualizare și dezinstalare sunt în [INSTALL.md → Install without Claude Code](plugins/total-recall/INSTALL.md#-install-without-claude-code) (în engleză).
- **Recuperezi o memorie:** în Claude Code și Gemini, vault-ul personal primește un commit în repo-ul git local la finalul fiecărei sesiuni: `git -C ~/.total-recall/personal-vault log`, `git restore` pe ce îți trebuie, apoi ceri _„reconstruiește indexul”_ (`rebuild_index`). Cu alți asistenți, fă tu commit-ul. Versiunile arhivate (`.superseded/`) și `vectors.db` nu sunt în acel repo.
- **Ceva pare în neregulă:** `get_stats` arată erorile recente și dacă e pornită căutarea semantică. În Claude Code, pornirea sesiunii te avertizează când push-urile de echipă sau captura automată eșuează repetat. Dacă după o actualizare căutarea semantică e oprită, rulează `npm rebuild better-sqlite3` în folderul pluginului.

## Limite

- **Indexul injectat are plafonul `indexMaxEntries`** (implicit 300; `0` = fără plafon; costul e în [Dintr-o privire](#dintr-o-privire)). Curăță cu `prune_memories`: îți arată candidații și nu șterge nimic.
- **Căutarea de text citește titlul, etichetele și primele 500 de caractere** ale fiecărei memorii, nu tot textul. Pune informația-cheie la început.
- **Mai multe sesiuni în paralel** scriu fișiere separate (câte unul pe memorie), dar o memorie salvată într-una poate lipsi din căutările alteia până când aceasta repornește ([detalii](docs/HOW-IT-WORKS.md), în engleză).
- **Nimic nu se șterge automat.** Curba uitării doar ordonează rezultatele. O memorie ștearsă rămâne în istoricul git local al vault-ului și în `.superseded/`.
- **Captura automată** rulează doar unde e instalat CLI-ul `claude` și nu poate fi oprită deocamdată.
- **Calitatea căutării nu e încă măsurată** pe un set de evaluare; e în [backlog](backlog-and-plans/BACKLOG.md) (în engleză).

## Mai mult (în engleză)

- [Cum funcționează](docs/HOW-IT-WORKS.md): stocarea, câmpurile din frontmatter, configurarea, căutarea și curba uitării, hook-urile, Obsidian
- [Cele 22 de unelte](docs/TOOLS.md) și formatul exportului
- [Lucru spec-driven și ADL](docs/SPEC-DRIVEN.md): leagă deciziile de cerințe și regulile de arhitectură de teste, cu un exemplu de cinci minute
- [Arhitectura](plugins/total-recall/ARCHITECTURE.md): diagrame C4, model de date, fluxul de scriere
- [Metrici de calitate](docs/QUALITY.md): teste, scor de mutație, complexitate, cuplare, livrare, scalare
- [Proiecte similare](docs/COMPARISON.md) · [Securitate](SECURITY.md) · [Vulnerabilități cunoscute](VULNERABILITIES.md) · [Model de amenințări](docs/THREAT-MODEL.md) · [Ghid de instalare](plugins/total-recall/INSTALL.md)
