#!/usr/bin/env python3
"""
DeepEval-style recall harness for total-recall — drives the REAL MCP tool
surface (spawns dist/index.js, speaks JSON-RPC over stdio) and measures
ranking quality (recall@k, MRR, NDCG@k) on a labeled query set.

Purpose: prove the Phase 5 TF-IDF quality fixes (5.1 substring->token boost,
5.2 sublinear-TF + length normalization) actually improve ranking rather than
guess. It compares two scorers over the SAME adversarial corpus:

  A) "current"  — the live server's recall_memory(hybrid=false) ranking,
                   which applies 5.1 (exact-token title/tag boost) + 5.2
                   ((1+log tf) * idf / sqrt(totalTokens) * decay).
  B) "baseline" — a local shadow scorer reproducing the PRE-fix TF-IDF:
                   raw tf * idf * decay, with substring (.includes) title
                   boost (the pre-5.1 behavior) and NO length norm (pre-5.2).
                   This is the ranking the fixes replaced.

The corpus is intentionally adversarial so the fixes change the ranking:
  - "cat"   : relevant = "Cat" (1 'cat'); trap = "Catalogue" (5 'cat' in the
               body). Pre-fix: substring title boost ("cat" in "catalogue")
               + raw tf lets Catalogue outrank Cat. Post-fix: Catalogue loses
               the exact-token title boost AND is penalized by the length norm
               for repeating the term -> Cat wins.
  - "flink" : relevant = "Flink CDC" (1 'flink'); trap = "General notes"
               (8 'flink', no 'flink' in title). Pre-fix raw tf: 8 > 1 ->
               trap wins. Post-fix: sublinear tf (1+log 8 ~= 3.1) / sqrt(8)
               loses to (1+log 1)=1 * title-boost(2) / sqrt(1) -> Flink CDC wins.
  - "kafka", "decizie": sanity (non-adversarial) queries so the harness also
               exercises a normal ranking path; both scorers should tie here.

store_memory derives the key from the title slug, so the harness captures the
actual returned key per seeded memory and maps gold/trap to it by title — it
never assumes a key.

DeepEval evaluates MCP servers directly; this mimics that pattern but is
stdlib-only Python (no `deepeval` dependency) so it stays an offline audit in
scripts/eval/, not a runtime dependency of the plugin.

Run:   python3 scripts/eval/recall_harness.py
Exit:  0 if current NDCG@5 >= baseline NDCG@5 averaged AND every adversarial
      query ranks the gold key first under current (NDCG@5 == 1.0) while the
      trap outranks gold under baseline; 1 otherwise.
"""
from __future__ import annotations

import json
import math
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

# (title, tags, content) — content is short; the server indexes title + tags +
# contentPreview (first ~chars), which for these short contents equals the
# full content. The shadow baseline scores the same text.
CORPUS = [
    # adversarial: substring-title-boost + raw-tf trap for "cat"
    ("Cat", ["pet"], "cat"),
    ("Catalogue", ["catalog"], "cat cat cat cat cat"),
    # adversarial: raw-tf (no length norm) trap for "flink"
    ("Flink CDC", ["flink", "cdc"], "flink"),
    ("General notes", ["misc"],
     "flink flink flink flink flink flink flink flink"),
    # sanity: non-adversarial
    ("Kafka connect", ["kafka"], "kafka connect connector notes"),
    ("Decizie arhitectura", ["arhitectura"],
     "notita despre o decizie de arhitectura"),
]

# (query, gold_title, trap_title). trap_title is None for sanity queries.
QUERIES = [
    ("cat", "Cat", "Catalogue"),
    ("flink", "Flink CDC", "General notes"),
    ("kafka", "Kafka connect", None),
    ("decizie", "Decizie arhitectura", None),
]

K = 5


# ─── MCP stdio client ─────────────────────────────────────────────────────
class MCPClient:
    """Minimal NDJSON JSON-RPC client over a server subprocess's stdio."""

    def __init__(self, home: str):
        env = dict(os.environ)
        env["HOME"] = home
        self.proc = subprocess.Popen(
            ["node", "dist/index.js"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, env=env,
            cwd=str(Path(__file__).resolve().parents[2]),
            text=True, bufsize=1,
        )
        self._id = 0

    def _send(self, msg: dict) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps(msg) + "\n")
        self.proc.stdin.flush()

    def _recv(self) -> dict:
        assert self.proc.stdout is not None
        line = self.proc.stdout.readline()
        if not line:
            raise RuntimeError("server closed stdout before responding")
        return json.loads(line)

    def call(self, method: str, params: dict | None = None) -> dict:
        self._id += 1
        msg = {"jsonrpc": "2.0", "id": self._id, "method": method}
        if params is not None:
            msg["params"] = params
        self._send(msg)
        # Skip server notifications/logs until we see our response id.
        while True:
            resp = self._recv()
            if resp.get("id") == self._id and "result" in resp:
                return resp["result"]
            if resp.get("id") == self._id and "error" in resp:
                raise RuntimeError(f"RPC error on {method}: {resp['error']}")

    def notify(self, method: str) -> None:
        self._send({"jsonrpc": "2.0", "method": method})

    def initialize(self) -> None:
        self.call("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "eval-harness", "version": "1.0"},
        })
        self.notify("notifications/initialized")
        time.sleep(0.3)  # let reconcileIndex finish

    def tool(self, name: str, args: dict) -> dict:
        res = self.call("tools/call", {"name": name, "arguments": args})
        if res.get("isError"):
            raise RuntimeError(f"tool {name} error: {res['content'][0]['text']}")
        return json.loads(res["content"][0]["text"])

    def close(self) -> None:
        try:
            if self.proc.stdin:
                self.proc.stdin.close()
        finally:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.proc.kill()


# ─── shadow baseline scorer (pre-5.1 / pre-5.2 TF-IDF) ───────────────────
def _tokens(text: str) -> list[str]:
    out: list[str] = []
    cur = ""
    for ch in text.lower():
        if ch.isalnum():
            cur += ch
        else:
            if cur:
                out.append(cur)
                cur = ""
    if cur:
        out.append(cur)
    return out


def _baseline_rank(query: str, corpus: list[tuple[str, str]]) -> list[str]:
    """Pre-fix TF-IDF: raw tf * idf, substring (.includes) title boost, NO
    length norm. decay is constant (corpus has no access/importance variation)
    so the comparison isolates the TF-IDF changes."""
    qtoks = _tokens(query)
    df: dict[str, int] = {}
    docs: list[tuple[str, dict[str, int], list[str]]] = []
    for key, indexed_text in corpus:
        toks = _tokens(indexed_text)
        tf: dict[str, int] = {}
        for t in toks:
            tf[t] = tf.get(t, 0) + 1
        for t in tf:
            df[t] = df.get(t, 0) + 1
        title_toks = _tokens(indexed_text.split(" ", 1)[0])  # first token ~= title
        docs.append((key, tf, title_toks))
    N = len(corpus)
    scores: dict[str, float] = {}
    for key, tf, title_toks in docs:
        s = 0.0
        for q in qtoks:
            if q not in tf:
                continue
            idf = math.log((N + 1) / (df[q] + 1)) + 1
            # pre-5.1: substring title boost — "cat" matches inside "catalogue"
            title_boost = 2.0 if any(q in tt for tt in title_toks) else 1.0
            s += tf[q] * idf * title_boost  # raw tf, NO length norm
        if s > 0:
            scores[key] = s
    return [k for k, _ in sorted(scores.items(), key=lambda kv: -kv[1])]


# ─── metrics ─────────────────────────────────────────────────────────────
def recall_at_k(ranked: list[str], gold: list[str], k: int = K) -> float:
    if not gold:
        return 1.0
    return len(set(ranked[:k]) & set(gold)) / len(set(gold))


def mrr(ranked: list[str], gold: list[str]) -> float:
    gs = set(gold)
    for i, k in enumerate(ranked, 1):
        if k in gs:
            return 1.0 / i
    return 0.0


def ndcg_at_k(ranked: list[str], gold: list[str], k: int = K) -> float:
    ideal = [1.0] * min(len(gold), k)
    dcg = sum(1.0 / math.log2(i + 2)
              for i, k_name in enumerate(ranked[:k]) if k_name in set(gold))
    idcg = sum(1.0 / math.log2(i + 2) for i in range(len(ideal)))
    return dcg / idcg if idcg else 0.0


# ─── harness ─────────────────────────────────────────────────────────────
def main() -> int:
    with tempfile.TemporaryDirectory(prefix="tr-eval-") as home:
        client = MCPClient(home)
        try:
            client.initialize()
            # Seed corpus; capture the actual key store_memory returns (it
            # derives the key from the title slug, so we never assume one).
            title_to_key: dict[str, str] = {}
            indexed: list[tuple[str, str]] = []  # (actualKey, indexed_text)
            for title, tags, content in CORPUS:
                res = client.tool("store_memory", {
                    "title": title, "content": content,
                    "tags": tags, "category": "knowledge", "force": True,
                })
                key = res["key"]
                title_to_key[title] = key
                indexed.append((key, f"{title} {' '.join(tags)} {content}"))
            client.tool("rebuild_index", {})

            cur_rows = []  # (query, gold_key, trap_key, live_ranked, base_ranked)
            cur_m = {"recall@5": [], "mrr": [], "ndcg@5": []}
            base_m = {"recall@5": [], "mrr": [], "ndcg@5": []}

            for query, gold_title, trap_title in QUERIES:
                gold_key = title_to_key[gold_title]
                trap_key = title_to_key[trap_title] if trap_title else None
                live = client.tool("recall_memory", {"query": query, "hybrid": False})
                live_ranked = [r["key"] for r in live] if isinstance(live, list) else []
                base_ranked = _baseline_rank(query, indexed)

                cm = {"recall@5": recall_at_k(live_ranked, [gold_key]),
                      "mrr": mrr(live_ranked, [gold_key]),
                      "ndcg@5": ndcg_at_k(live_ranked, [gold_key])}
                bm = {"recall@5": recall_at_k(base_ranked, [gold_key]),
                      "mrr": mrr(base_ranked, [gold_key]),
                      "ndcg@5": ndcg_at_k(base_ranked, [gold_key])}
                for m in cur_m:
                    cur_m[m].append(cm[m])
                    base_m[m].append(bm[m])
                cur_rows.append((query, gold_key, trap_key, live_ranked, base_ranked))

                print(f"  q={query!r:10} gold={gold_key:34} "
                      f"live_top={live_ranked[0] if live_ranked else '-':34} "
                      f"base_top={base_ranked[0] if base_ranked else '-'}")
        finally:
            client.close()

    print("\n=== ranking quality: current (with 5.1+5.2) vs baseline (pre-fix) ===")
    print(f"{'metric':10} {'current':>10} {'baseline':>10} {'delta':>10}")
    avg_c = {m: sum(v) / len(v) for m, v in cur_m.items()}
    avg_b = {m: sum(v) / len(v) for m, v in base_m.items()}
    for m in ("recall@5", "mrr", "ndcg@5"):
        c, b = avg_c[m], avg_b[m]
        print(f"{m:10} {c:>10.3f} {b:>10.3f} {c - b:>+10.3f}")

    print("\n=== adversarial query check (the proof 5.1/5.2 have teeth) ===")
    ok = avg_c["ndcg@5"] >= avg_b["ndcg@5"]
    for query, gold_key, trap_key, live_ranked, base_ranked in cur_rows:
        if trap_key is None:
            continue
        live_first = live_ranked[0] if live_ranked else None
        base_first = base_ranked[0] if base_ranked else None
        current_correct = live_first == gold_key
        baseline_promoted_trap = base_first == trap_key
        verdict = "PASS" if (current_correct and baseline_promoted_trap) else "FAIL"
        ok = ok and (verdict == "PASS")
        print(f"  q={query!r:10} trap={trap_key:22} "
              f"live_top={live_first:22} base_top={base_first:22} -> {verdict}")

    print(f"\nOVERALL: {'PASS' if ok else 'FAIL'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())