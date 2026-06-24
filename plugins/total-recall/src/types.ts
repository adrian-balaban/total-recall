// ─── Types ───────────────────────────────────────────────────────────────────

export interface MemoryFrontmatter {
  title: string;
  tags: string[];
  author?: string;
  sessions?: string[];
  created: string;
  updated: string;
  importanceScore?: number;
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
}

export type Index = Record<string, MemoryMetadata>;
// `docs` stores the per-document term frequency (tf) alongside the key so
// tfidfSearch reads it directly instead of re-tokenizing every (token × doc)
// pair on each query — O(Q·D) rather than O(Q·D·L). Built once in
// rebuildInvertedIndex; never mutated at search time.
export type InvertedIndex = Record<string, { docs: Array<{ key: string; tf: number }>; idf: number }>;