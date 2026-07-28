# Total Recall — Prezentare Generală

## Într-o singură frază
Un instrument care dă asistentului AI o memorie persistentă — memoriile se salvează pe computer și supraviețuiesc între sesiuni, așa că nu trebuie să reexplici aceleași lucruri de fiecare dată.

## Ce este
Total Recall este o extensie (versiunea 1.0.135) care se conectează la Claude Code și Gemini CLI. Memoriile sunt fișiere Markdown stocate local pe computer (în `~/.total-recall/`), organizate în două locuri:
- **Vault personal** — memoriile tale private
- **Vault de echipă** — memoriile partajate cu colegii (opțional, sincronizate via git)

Când cauți o memorie, sistemul o găsește folosind o metodă rapidă de căutare și o rangează după importanță și frecvență de utilizare.

## Ce face
- **Salvează** memoriile ca fișiere Markdown cu informații structurate (titlu, etichete, categorie, importanță).
- **Caută** memoriile rapid atunci când ai nevoie.
- **Rangează** rezultatele după relevanță și cât de recent ai accesat acea memorie.
- **Separă** memoriile personale (doar pentru tine) de cele de echipă (partajate cu alții).
- **Protejează** datele sensibile (carduri de credit, email-uri personale, parole) înainte de a le sincroniza cu echipa.
- **Arhivează** versiunile vechi ale memoriilor, nu le șterge pur și simplu.
- **Injectează** automaticamente index-ul memoriilor în contextul Claude la fiecare sesiune nouă — aștea e cea mai importantă caracteristică.
- **Extrage** automat 0-3 lecții din conversație la sfârșitul sesiunii și le salvează.
- **Sincronizează** memoriile de echipă în git, deci toți colegii au acces.

## Cele 17 instrumente
Sunt grupate în categorii:
- **Salvare:** `store_memory`
- **Căutare:** `recall_memory`, `search_index`
- **Citire:** `list_memories`, `get_memories_by_keys`, `get_stats`, `get_timeline`, `get_related_memories`, `prune_memories`
- **Modificare:** `update_memory`, `delete_memory`, `confirm_memory`, `rebuild_index`
- **Reordanare:** `rerank_memories`
- **Operații în masă:** `export_memories`, `import_memories`, `delete_memories`

## Cum funcționează, în termeni simpli
Fiecare memorie e un fișier Markdown obișnuit cu informații structurate în capul fișierului (titlu, etichete, etc.). La pornire, sistemul citește toate fișierele, le indexează (pentru căutare rapidă) și apoi e gata să răspundă la întrebări. Când cauți ceva, căutarea folosește două metode:
1. **Căutare text** — caută cuvintele din memoria ta
2. **Căutare vectorială** (opțional) — înțelege sensul, nu doar cuvintele

Dacă a doua metodă nu e disponibilă, sistemul se reîntoarce la prima metodă în mod automat. Memoriile se salvează pe disk automat, iar dacă cineva din echipă adaugă o memorie nouă în git, aceasta apare automat în sesiunea ta fără să trebuie să restarezi.

## Cum se instalează și unde se folosește
- **Pentru Claude Code:** se instalează ca plugin din meniu
- **Pentru Gemini CLI:** se instalează ca extensie
- **Pentru comenzi manuale:** scriptul `install.sh` setează totul — alegi între o versiune simplă (doar căutare text) sau una completă (cu căutare inteligentă)
- **Compatibilitate:** funcționează pe orice Linux/Mac + Git Bash pe Windows; necesită Node.js 18+

## Calitatea și fiabilitate
- **Teste:** peste 12,000 linii de cod de test în 41 fișiere
- **Acoperire:** 95% din cod e testat
- **Versiune:** 1.0.135 — stabil și în producție
- **Fără CI:** întrucât pluginul se distribuie direct din git (nu prin npm), fiecare commit e testat local înainte de a fi trimis
- **Backup:** `install.sh` poate genera o copie de siguranță a tuturor memoriilor

## Dependințe
- **Esențiale:** 2 pachete mici (MCP SDK și Zod pentru validare)
- **Opționale:** 3 pachete pentru căutarea inteligentă (descărcate doar dacă le ceri)
  - Modelul de AI pentru înteles semantic (~200MB)
  - Bază de date locală pentru vectori
- **Dimensiune totală:** ~1-2MB pentru plugin; ~200MB opțional dacă vrei căutare inteligentă

## Principii de design
- **Local-first:** toate memoriile sunt pe computerul tău, nu în cloud
- **Citibil:** fiecare memorie e un fișier Markdown pe care îl poți edita cu orice editor
- **Versionabil:** fișierele se pot pune în git și se pot urmări modificările
- **Imparțial:** nu folosește o bază de date magic; totul e clar și transparent
- **Rezistent la eșecuri:** dacă ceva se întâmplă, datele nu se pierd
