# Plan: stabilizarea CI pe `main` și merge pentru PR #56, #57, #58, #60

Data: 2026-11-12. Starea e verificată cu `gh` pe commitul `9c7a912` de pe `main`.

## 1. Starea PR-urilor

| PR | Ce conține | Check `mutation` | Merge state | Observații |
|----|------------|------------------|-------------|------------|
| #56 `chore/npm-audit-fix` | doar `package-lock.json`: `@hono/node-server` 2.1.7, `qs`, `@vitest/mocker` (npm audit fix) | ❌ fail (integration) | BLOCKED | Include deja bump-ul din #58. |
| #57 dependabot `vitest` 4.1.8 → 4.1.11 | `package.json` și lockfile | ❌ fail (integration) | BLOCKED | O rulare anterioară a aceluiași branch a trecut (`43031786621`), deci eșecul e intermitent. |
| #58 dependabot `@hono/node-server` 2.0.12 → 2.1.7 | lockfile | ✅ pass | CLEAN | Redundant cu #56. |
| #60 `chore/transformers-4` | după merge-ul #59 a rămas **doar bump-ul de versiune la 1.9.1** (5 fișiere, ±6 linii) | ❌ fail (integration) | BLOCKED | `@huggingface/transformers ^4.3.2` e deja pe `main` prin #59. Titlul PR-ului nu mai corespunde conținutului. |

Toate patru ating `plugins/total-recall/package-lock.json`, deci după fiecare merge celelalte trebuie actualizate (rebase sau update branch).

## 2. Ce e roșu în Actions

### 2.1 `mutation` (gate-ul): același eșec intermitent peste tot
Pasul `npm run test:integration` pică pe #56, #57 și #60, iar pe `main` a picat la merge-ul #55 (`42914601966`, commit `025aaa1`). Testele unitare trec toate (1093/1093). Pică doar două teste de integrare, ambele cu `Test timed out in 30000ms`:

- `server.integration.test.ts` › „stores a memory and recalls it back”
- `boundary-enforcement.integration.test.ts` › „recall_memory does NOT reject a negative numeric limit”

**Cauza.** `recall_memory` are `hybrid = true` implicit (`src/tools/recall.ts:22`), deci primul apel încarcă modelul de embedding `Xenova/paraphrase-multilingual-MiniLM-L12-v2`. Testele de integrare pornesc serverul cu un `HOME` nou în `os.tmpdir()`, iar cache-ul modelului e `$HOME/.total-recall/models`. Prin urmare modelul (sute de MB) se descarcă de la Hugging Face la fiecare rulare. Testul trece sau pică după viteza descărcării: #58 și `main` @ `9c7a912` au trecut, iar #56, #57 și #60 au picat.

Alte lucruri verificate:
- Avertismentul `model id rejected by hub: 404` din log vine din testele unitare care folosesc intenționat un id greșit, nu din integrare. Modelul real răspunde 200 pe `config.json`, pe `onnx/model_quantized.onnx` și pe API.
- `testTimeout: 120_000`, schimbarea necomisă din `vitest.integration.config.ts`, **nu ajunge**. Clientul MCP SDK are propriul timeout de 60s pe request, iar descărcarea depinde tot de rețea.

### 2.2 `Dependabot Updates` pe `main`: rulări roșii
Sunt joburi de *security update* pentru `qs`, `minimatch` și `@vitest/mocker`. Joburile pentru `vitest`, `sharp` și `@hono/node-server` au reușit în același interval.

**Corecție (2026-11-12).** Prima ipoteză, eroarea `Failed to parse GITHUB_REGISTRIES_PROXY`, era greșită: variabila e goală și apare ca zgomot în log, în toate joburile. Cauza reală, citită din tabelul de erori al joburilor, e `security_update_not_possible`: fixul există, dar un părinte nu-l lasă să intre.

| Pachet | Versiune fixată | Blocat de | Cea mai nouă rezolvabilă |
|--------|-----------------|-----------|--------------------------|
| `minimatch` | 11.0.1 | `@stryker-mutator/core@9.6.1` cere `minimatch@~10.2.4` | 10.2.6 |
| `@vitest/mocker` | 4.1.12 | vine odată cu un `vitest` nou (`main` are 4.1.8, #57 are 4.1.11) | 4.1.8 |

`qs` s-a rezolvat prin #56. Alertele rămase sunt dev-only și de severitate medie: minimatch #12, @vitest/mocker #9 și #5, vitest #6.

### 2.3 `release`
Ultima rulare e verde (`43034928200`). Rulările `skipped` de pe 10–11 nov sunt efectul normal al gate-ului roșu.

## 3. Soluții

### 3.1 Stabilizarea `main` (PR nou, merge primul)
**Fix recomandat:** testele de integrare nu mai depind de rețea și de model.

1. În cele două teste de integrare, `recall_memory` primește `hybrid: false`:
   - `server.integration.test.ts`: `arguments: { query: 'round-tripped stdio', hybrid: false }`
   - `boundary-enforcement.integration.test.ts`: `arguments: { query: 'x', limit: -5, hybrid: false }`

   Ce verifică testele (round-trip prin stdio, limita Zod) nu ține de vectori. Calea hibridă și fallback-ul la TF-IDF sunt deja acoperite de testele unitare cu `testEmbedder`.
2. Revert la schimbarea locală necomisă din `plugins/total-recall/vitest.integration.config.ts`, cu `git checkout -- plugins/total-recall/vitest.integration.config.ts`.
3. Opțional, în același PR: `grep -rn "recall_memory\|rerank_memories" src/__tests__/integration/` și aplică `hybrid: false` oriunde mai e un apel care ar încărca modelul. `rerank_memories` încarcă mereu modelul și nu are opt-out.
4. Versiunea nu se schimbă (doar teste, `dist/` identic). Bump-ul vine prin #60.

**Alternative, de luat în calcul ulterior:**
- Un env var (de ex. `TOTAL_RECALL_VECTORS=off`) citit în `embeddings.ts`, setat în `env`-ul serverului din teste. E mai general, dar schimbă cod de producție și trece prin ratchet-urile ADL și de complexitate (`[TR-Q9]`, `[TR-S12]`).
- Un test separat de smoke pentru vectori, cu cache de model în CI (`actions/cache` pe `~/.total-recall/models`, cheie pe id-ul modelului, și `HOME` sau `cacheDir` al testului care să-l folosească), cu timeout mare și o singură instanță. Așa rămâne acoperirea end-to-end a căii vectoriale fără flakiness.

**Verificare:** rulează gate-ul de 2–3 ori pe PR-ul cu fix (re-run). Integrarea trebuie să treacă de fiecare dată, în câteva secunde, nu în ~30s.

### 3.2 Ordinea de merge după fix
1. **PR-ul cu fix** (3.1) → merge când e verde.
2. **#56** (npm audit fix): `gh pr update-branch 56`, apoi CI verde, apoi merge. Rezolvă `qs`, `@vitest/mocker` și `@hono/node-server` 2.1.7.
3. **#58**: după #56 devine redundant. Dependabot îl închide singur când vede versiunea pe `main`. Altfel `gh pr close 58 -c "Inclus în #56"`.
4. **#57** (vitest 4.1.11): comentează `@dependabot rebase`, așteaptă CI verde, apoi merge. Dacă lockfile-ul intră în conflict cu #56, Dependabot îl regenerează la rebase.
5. **#60**, ultimul, ca vehicul de release:
   - `gh pr update-branch 60` (sau rebase), iar `npm run build` local confirmă că manifestele sunt sincronizate la 1.9.1.
   - Redenumește-l, de ex. `chore: release 1.9.1 (transformers v4, sharp, audit fixes)`, și actualizează descrierea: transformers și sharp au intrat prin #59, iar #60 doar ridică versiunea.
   - Merge, apoi verifică `release.yml`: tag `v1.9.1`, branch-ul `release` și publicarea npx.

Comenzi utile:
```bash
gh pr checks <n> --watch
gh run rerun <run-id> --failed
gh pr merge <n> --squash --delete-branch   # sau --merge, după convenția repo-ului (#55 a fost merge commit)
```

### 3.3 Dependabot (PR #62)
Soluția: `.github/dependabot.yml` nou (nu exista), cu:
- `ignore` pentru `minimatch` și `@vitest/mocker`, fiecare cu un comentariu despre cine îl blochează și când se scoate;
- `open-pull-requests-limit: 0` pe ecosistemul npm din `/plugins/total-recall`: ține oprite *version updates* (altfel Dependabot ar fi început PR-uri zilnice pentru tot), iar security updates pentru restul pachetelor merg ca înainte.

Observații:
- `@vitest/mocker` ignorat înseamnă fără PR direct pentru el; fixul 4.1.12 vine prin `vitest`, care nu e ignorat.
- **Incert:** documentația GitHub nu spune clar dacă `ignore` din fișier oprește și joburile de *security update*, nu doar pe cele de versiune. Dacă joburile rămân roșii după merge-ul #62, soluția sigură e închiderea alertelor ca „tolerabile": `gh api -X PATCH repos/adrian-balaban/total-recall/dependabot/alerts/<n> -f state=dismissed -f dismissed_reason=tolerable_risk` pentru #12, #9, #5 și #6. Decizia de risc e a proprietarului repo-ului.
- **Când se scot ignorările:** `minimatch` când Stryker acceptă minimatch 11; `@vitest/mocker` când există un vitest cu mocker >= 4.1.12.
- Opțional, separat: `groups` în același fișier (un PR zilnic în loc de câte unul pe pachet) ar reduce conflictele de lockfile, dar necesită activarea version updates.

## 4. Checklist

- [ ] Revert la `vitest.integration.config.ts` (schimbare locală necomisă)
- [ ] Branch `fix/integration-no-model-download`: `hybrid: false` în cele 2 teste, PR, CI verde de 2–3 ori, merge
- [ ] #56: update branch, CI verde, merge
- [ ] #58: închis ca inclus în #56
- [ ] #57: `@dependabot rebase`, CI verde, merge
- [ ] #60: update branch, titlu și descriere noi, CI verde, merge, release 1.9.1 verificat
- [ ] #62: `.github/dependabot.yml` cu ignorare `minimatch` și `@vitest/mocker`, CI verde, merge
- [ ] După #62: joburile Dependabot nu mai sunt roșii; altfel alertele #12, #9, #5, #6 închise ca „tolerabile"
- [ ] (opțional) smoke test de vectori cu cache de model în CI
- [ ] (opțional) `.github/dependabot.yml` cu grupare
