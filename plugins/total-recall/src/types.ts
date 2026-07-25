// ─── Types ───────────────────────────────────────────────────────────────────

export interface MemoryFrontmatter {
  title: string;
  tags: string[];
  author?: string;
  sessions?: string[];
  created: string;
  updated: string;
  importanceScore?: number;
  // Feedback counters from confirm_memory: positive confirmations boost retention,
  // flags (wrong/useless signals) reduce it.
  confirmations?: number;
  flags?: number;
  // Graphiti-style "supersede, don't overwrite" provenance (Tech Radar vol.34,
  // blip #45). On a store_memory(force=true) overwrite, the prior version of the
  // fact is NOT silently dropped: its body is archived to
  // `<vault>/.superseded/<category>/<slug>.<ts>.md` (excluded from indexing via
  // EXCLUDED_DIRS) and the supersession moment is recorded here as an ISO
  // timestamp. The array is chronological: supersededAt[i] is the moment version
  // i was replaced by version i+1. The current version has been believed since
  // the last entry (or since `created` if empty). To reconstruct "what did I
  // believe and when": pair supersededAt[i] with the archived body whose
  // filename embeds that same timestamp. Incremental — a full bi-temporal
  // validity-window / relation layer is a later assess-level experiment, not
  // this change.
  supersededAt?: string[];
}

export interface MemoryMetadata extends MemoryFrontmatter {
  key: string;
  filePath: string;
  category: string;
  contentPreview: string;
  accessCount: number;
  lastAccessed: string;
  tokenEstimate: number;
  importanceScore: number;
  isOrg: boolean;
  // #19: filesystem identity of the last-indexed file body, captured via
  // lstatSync in indexFile. reconcileIndex compares these against the current
  // stat to skip the readFileSync + parseFrontmatter when the file is unchanged
  // since the last scan (the dominant boot cost at personal scale). mtime is
  // filesystem-local, so the skip only helps same-machine session-to-session
  // boots — a git pull changes mtime and forces a re-read (correct: pulled
  // content must be re-indexed). coerceMemEntry defaults missing values to 0,
  // so a pre-#19 index.json re-reads once on the first reconcile after upgrade
  // and backfills real values. Mutated by indexFile only; never used at search
  // time. `0` is the "no stat recorded" sentinel — it never matches a real
  // file's mtimeMs/size, so a missing stat always forces a full read.
  mtimeMs: number;
  size: number;
}

export type Index = Record<string, MemoryMetadata>;
// `docs` stores the per-document term frequency (tf) alongside the key so
// tfidfSearch reads it directly instead of re-tokenizing every (token × doc)
// pair on each query — O(Q·D) rather than O(Q·D·L). Built once in
// rebuildInvertedIndex; never mutated at search time.
export type InvertedIndex = Record<string, { docs: Array<{ key: string; tf: number }>; idf: number }>;