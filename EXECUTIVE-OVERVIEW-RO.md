# 🧠 Total Recall — Prezentare Generală

## 💬 Într-o singură frază
Un instrument care dă asistentului AI o memorie persistentă — memoriile se salvează pe computer și supraviețuiesc între sesiuni, așa că nu trebuie să reexplici aceleași lucruri de fiecare dată.

## 📦 Ce este
Total Recall este o extensie (versiunea 1.1.21) care se conectează la Claude Code și Gemini CLI. Memoriile sunt fișiere Markdown stocate local pe computer (în `~/.total-recall/`), organizate în două locuri:
- **Vault personal** — memoriile tale private
- **Vault de echipă** — memoriile partajate cu colegii (opțional, sincronizate via git)

Când cauți o memorie, sistemul o găsește folosind o metodă rapidă de căutare și o „rangează” după importanță și frecvență de utilizare.

## ⚙️ Ce face
- **Salvează** memoriile ca fișiere Markdown cu informații structurate (titlu, etichete, categorie, importanță).
- **Caută** memoriile rapid atunci când ai nevoie.
- **Rangează** rezultatele după relevanță și cât de recent ai accesat acea memorie.
- **Separă** memoriile personale (doar pentru tine) de cele de echipă (partajate cu alții).
- **Protejează** datele sensibile (carduri de credit, email-uri personale, parole) înainte de a le sincroniza cu echipa.
- **Arhivează** versiunile vechi ale memoriilor, nu le șterge pur și simplu.
- **Injectează** automat index-ul memoriilor în contextul Claude la fiecare sesiune nouă — e cea mai importantă caracteristică.
- **Extrage** automat 0-3 lecții din conversație înainte de compactarea contextului (hook `PreCompact`) și le salvează.
- **Sincronizează** memoriile de echipă în git, deci toți colegii au acces.

## 🛠️ Cele 17 instrumente
Sunt grupate în categorii:
- **Salvare:** `store_memory`
- **Căutare:** `recall_memory`, `search_index`
- **Citire:** `list_memories`, `get_memories_by_keys`, `get_stats`, `get_timeline`, `get_related_memories`
- **Modificare:** `update_memory`, `delete_memory`, `confirm_memory`, `rebuild_index`, `prune_memories`
- **Reordonare:** `rerank_memories`
- **Operații în masă:** `export_memories`, `import_memories`, `delete_memories`

## 🔍 Cum funcționează, în termeni simpli
Fiecare memorie e un fișier Markdown obișnuit cu informații structurate în capul fișierului (titlu, etichete, etc.). La pornire, sistemul citește toate fișierele, le indexează (pentru căutare rapidă) și apoi e gata să răspundă la întrebări. Când cauți ceva, căutarea folosește două metode:
1. **Căutare text** — caută cuvintele din memoria ta
2. **Căutare vectorială (semantică)** (activată implicit la instalare) — înțelege sensul, nu doar cuvintele

Dacă a doua metodă nu e disponibilă, sistemul se reîntoarce la prima metodă în mod automat. Memoriile se salvează pe disc automat, iar dacă cineva din echipă adaugă o memorie nouă în git, aceasta apare automat în sesiunea ta fără să trebuiască să restartezi.

## 🚀 Cum se instalează și unde se folosește
- **Pentru Claude Code:** se instalează ca plugin din meniu
- **Pentru Gemini CLI:** se instalează ca extensie
- **Pentru comenzi manuale:** scriptul `install.sh` setează totul — alegi între o versiune simplă (doar căutare text) sau una completă, implicită (cu căutare după sens/semantică)
- **Compatibilitate:** funcționează pe orice Linux/Mac + Git Bash pe Windows; necesită Node.js 18+

## ✅ Calitate și fiabilitate
- **Teste:** 744 unitare + 20 de integrare, toate verzi · 45 de fișiere · ~13.000 de linii de cod de test
- **Acoperire:** 93,6% instrucțiuni · 88,2% ramuri · 95,3% linii (pragul configurat cere 95% peste tot, deci `npm run test:coverage` iese încă non-zero — vezi secțiunea Status din README)
- **Mutation testing:** o metodă ca să verific dacă testele sunt într-adevăr bune. Iau codul și schimb deliberat lucruri mici (de ex. `>` devine `<`, `true` devine `false`). Dacă testele nu observă schimbarea și nu eșuează, înseamnă că nu sunt suficient de stricte. Folosesc o unealtă numită Stryker care face asta automat.
  - Scor curent: 65,39% pe 16 module de bază, măsurat în CI (testele capturează 65,39% din erorile introduse deliberat; pragul care pică build-ul e 65%, deci marja e una subțire, de 0,39 puncte)
  - Marja peste prag e de doar 0,9 puncte, deci o singură ramură nouă netestată poate face CI-ul roșu
- **Versiune:** 1.1.21 — stabil
- **CI:** workflow-ul GitHub Actions `.github/workflows/mutation.yml` este singurul gate de verificare — audit de dependențe, typecheck, build și gate-ul de mutation testing Stryker (pică sub 65%) — la fiecare push/PR pe `main`. Începând cu v1.1.19 nu mai există niciun pipeline local: bundle-ul compilat este în `.gitignore`, GitHub Actions îl construiește, iar `.github/workflows/release.yml` îl publică pe branch-ul `release` din care instalează marketplace-ul. Pluginul are exact un canal de distribuție (marketplace-ul) și un singur lucru care poate produce un artefact livrat (CI)

## 🔗 Dependințe
- **Esențiale:** 2 pachete mici (MCP SDK și Zod pentru validare)
- **Opționale:** 3 pachete pentru căutarea inteligentă (descărcate doar dacă le ceri)
  - Modelul de AI pentru înțeles semantic (~200MB)
  - Bază de date locală pentru vectori
- **Dimensiune totală:** ~1-2MB pentru plugin; ~200MB opțional dacă vrei căutare semantică

## 🧭 Principii de design
- **Local-first:** toate memoriile sunt pe computerul tău, nu în cloud
- **Citibil:** fiecare memorie e un fișier Markdown pe care îl poți edita cu orice editor
- **Versionabil:** fișierele se pot pune în git și se pot urmări modificările (vault-ul de echipă chiar asta face; cel personal rămâne doar local)
- **Fără infrastructură:** nu depinde de niciun server sau bază de date externă — sursa de adevăr sunt fișierele Markdown (indexul vectorial e doar un SQLite local, regenerabil oricând)
- **Rezistent la erori:** dacă ceva se întâmplă, datele nu se pierd

## 📡 Raportare la [Thoughtworks Technology Radar Vol. 34 (2026)](https://www.thoughtworks.com/content/dam/thoughtworks/documents/radar/2026/04/tr_technology_radar_vol_34_en_1.pdf)

Radarul Thoughtworks grupează tehnici și unelte pe patru inele (Adopt = folosește acum, Trial = merită încercat, Assess = urmărește, Caution = atenție). Vol. 34 e dominat de maturizarea ingineriei de agenți AI. Mai multe tehnici recomandate sunt **deja implementate** în Total Recall, ca decizii de design luate independent:

- **Progressive context disclosure** (Trial) + **Context engineering** (Adopt): nu arunci tot contextul deodată (duce la „context rot"), ci pornești cu un index ușor și încarci detaliul la cerere. Exact ce face pluginul — la SessionStart injectează doar indexul memoriilor, iar conținutul complet se citește prin `get_memories_by_keys` doar când e nevoie.
- **Mutation testing** (Trial): „cel mai onest semnal" pentru calitatea testelor în era codului generat de AI. Pluginul folosește deja Stryker (vezi *Calitate și fiabilitate*).
- **Claude Code plugin marketplace** (Trial): distribuție bazată pe git, fără „drift de versiune" — exact modelul pluginului (git-subdir, nu npm) și, din v1.1.19, singurul său canal, alimentat de un branch construit în CI.
- **Structured output from LLMs** (Adopt): hook-ul de captură cere modelului linii JSON, nu text liber.
- **MCP by default** (Caution): radarul avertizează să nu folosești reflex MCP — pluginul ține operațiile de sistem (git, indexare) în scripturi simple, nu în unelte MCP.

**Trei direcții viitoare** reținute din radar (în BACKLOG.md, cu declanșator clar): (1) **graf de context / relații temporale** (*Context graph* + *Graphiti*) — lanțul `supersededAt` stochează deja muchii temporale, dar lipsește un strat de interogare a relațiilor; (2) **extracție ancorată în sursă** (*LangExtract*) — captura produce JSON, dar fără trasabilitate la conversație; (3) **set de evaluare** (*DeepEval*) — nicio măsură obiectivă azi că `recall_memory` întoarce memoria potrivită.

> Sinteza completă (toate elementele Adopt/Trial din cele patru cadrane) e în memoria de echipă `org/knowledge/thoughtworks-technology-radar-vol-34-2026-adopt-trial-synthesis`.
