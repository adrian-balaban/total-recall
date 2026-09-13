# 🧠 total-recall

**Asistentul tău AI (Claude, Gemini, Antigravity) uită totul la finalul fiecărei sesiuni. Acest plugin rezolvă problema.**

O memorie persistentă și căutabilă pentru Claude Code și Gemini/Antigravity. Memoriile sunt fișiere Markdown simple pe discul tău — pot fi căutate cu grep, versionate cu git, citibile în [Obsidian](https://obsidian.md/). Nimic nu părăsește mașina ta decât dacă îl etichetezi `org`.

## ⚡ TL;DR

- **Ce este** — un plugin de memorie persistentă pentru Claude Code și Gemini/Antigravity: 17 unelte MCP peste un vault de fișiere Markdown din `~/.total-recall`.
- **Ce face pentru tine** — injectează memoriile relevante la începutul fiecărei sesiuni și capturează automat deciziile și preferințele pe măsură ce lucrezi și înainte de fiecare compactare a contextului, ca să nu repeți același context.
- **Cum caută** — hibrid: TF-IDF × curba uitării Ebbinghaus, plus căutare semantică opțională; degradează curat la căutare de text dacă căutarea semantică nu e activată.
- **Confidențialitate** — local-first. Vault-ul personal nu părăsește mașina; doar ce etichetezi `org` trece printr-un filtru fail-closed spre un repo Git comun.
- **Instalare** — `/plugin marketplace add adrian-balaban/total-recall`, `/plugin install total-recall`, apoi `./install.sh` o singură dată. Node.js 18+, Linux · macOS · Windows (Git Bash).
- **Amprentă** — ~1–2 MB, două dependențe de producție (SDK-ul MCP și Zod). Modelul semantic de ~200 MB se descarcă doar dacă activezi căutarea semantică.
- **Status** — v1.1.22, stabilă: 798 teste trec, Test Coverage 93.6% statements, Mutation tests ≈68%. Vezi [Probleme cunoscute](#️-probleme-cunoscute) pentru pragurile de Test Coverage pe care CI le ratează încă.

```mermaid
flowchart LR
    A[Sesiunea începe] --> B[Memoriile relevante<br/>injectate în context]
    B --> C[Lucrezi]
    C --> D[Deciziile & preferințele<br/>capturate automat]
    D --> E[(~/.total-recall<br/>vault Markdown)]
    E -.-> A
```

## ⚙️ Cum funcționează

| | |
|---|---|
| **17 unelte MCP** | stocare, recuperare, căutare hibridă, reranking semantic, export/import în masă |
| **Căutare hibridă** | TF-IDF × curba uitării Ebbinghaus, combinată opțional cu embeddings vectoriale |
| **Hook-uri de ciclu de viață** | context injectat la începutul sesiunii, memorii capturate pe măsură ce lucrezi |
| **Două vault-uri** | cel personal rămâne local; cel etichetat `org` se sincronizează cu un repo Git comun |

```mermaid
flowchart TD
    S[store_memory] --> F{etichetat org?}
    F -->|nu| P[Vault personal<br/>doar local]
    F -->|da| PF[Filtru de confidențialitate<br/>fail-closed]
    PF --> O[Vault org → Git]
```

Diagramele C4 (context → containere → componente → cod), harta modulelor, modelul de date,
secvența de pornire, pipeline-ul de căutare și ciclul de viață al hook-urilor sunt documentate în
**[ARCHITECTURE.md](plugins/total-recall/ARCHITECTURE.md)**.

## 💡 Ce se salvează automat

Observații de lucru · un prompt de sfârșit de sesiune
„ceva demn de reținut?".

Nu se salvează: fragmente de cod, căi de fișiere, istoric git — toate derivabile din spațiul de lucru.

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
| **Versiune** | 1.1.22 — stabilă |
| **Teste** | 778 unitare + 20 de integrare, toate trec · 47 fișiere · ~13k linii de cod de test |
| **Test Coverage** | 93.6% statements · 88.2% branches · 95.3% lines |
| **Mutation tests** | ≈68% (Stryker, 16 module de bază) · variază ~±1 pt de la o rulare la alta · poarta eșuează sub 65% |
| **CI** | [`mutation.yml`](.github/workflows/mutation.yml) — audit + typecheck + build + suitele complete unitare și de integrare + Stryker la fiecare push/PR pe `main`. Singurul pipeline de build; nimic nu este verificat local |
| **Release-uri** | [`release.yml`](.github/workflows/release.yml) — construiește `dist/` și publică branch-ul `release` de pe care instalează marketplace-ul; taguri + note când versiunea se schimbă |
| **Audit** | 0 critice în dependențele de producție |

Reproducere: `npm test` · `npm run test:coverage` · `npm run test:integration` · `npm run mutation`
(din `plugins/total-recall/`)

### ⚠️ Probleme cunoscute

- **Test Coverage ratează trei din patru praguri** setate în `vitest.config.ts`: statements
  93.6% (necesar 95), functions 93.5% (necesar 95), branches 88.2% (necesar 90). Lines trece la
  95.3%. `npm run test:coverage` iese deci cu cod non-zero. Cele mai mari lacune sunt
  `vectorStore.ts` (72.5%) și `embeddings.ts` (88.6%).
- **Trei module au teste care ating codul, dar nu îi verifică logica.** Scorul de mutație pe
  modul divergă puternic de acoperire: `embeddings.ts` 49.4%, `vectorStore.ts` 54.0% și
  `persistence.ts` 56.2%. Cazul instructiv e `persistence.ts` — 86.1% acoperire la doar 56.2%
  mutație, cu 112 mutanți supraviețuitori: testele execută codul, dar nu ar observa dacă
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

📄 **[Prezentare executivă](EXECUTIVE-OVERVIEW.md)** — rezumat non-tehnic, inventar de
unelte și cum se mapează design-ul pe Thoughtworks Technology Radar Vol. 34
([🇷🇴 Română](EXECUTIVE-OVERVIEW-RO.md))

📖 **[Documentație completă](plugins/total-recall/README.md)** ·
🏗️ **[Arhitectură](plugins/total-recall/ARCHITECTURE.md)** ·
📦 **[Ghid de instalare](plugins/total-recall/INSTALL.md)** ·
🎤 **[Prezentare: Claude vs Ollama & Total Recall](https://github.com/adrian-balaban/presentation-claude-vs-ollama-and-total-recall-plugin-21-07-2026)** (Română, Iul 2026)
