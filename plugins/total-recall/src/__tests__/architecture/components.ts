// Single source for the ADL component → file mapping used by the fitness tests
// (architecture/adl/*.adl names the components; this file says which files they are).
// Production code only: src/__tests__/** is excluded from every set.

export const PROD = /^src\/(?!__tests__\/)/;
export const TOOLS = /^src\/tools\//;
export const ENTRY = /^src\/(index|server)\.ts$/;
export const TESTS = /^src\/__tests__\//;

// ADL component `helpers`: pure leaf modules with no local imports.
export const LEAF_NAMES = [
  'ebbinghaus', 'dates', 'rrf', 'lru-cache', 'frontmatter', 'errors', 'types', 'privacy-filter',
  'spec/config', 'spec/fields', 'spec/elements', 'spec/adl-parse',
];
export const LEAVES = new RegExp(`^src/(${LEAF_NAMES.join('|')})\\.ts$`);
// Everything in production that is NOT a leaf.
export const NON_LEAVES = new RegExp(`^src/(?!__tests__/)(?!(?:${LEAF_NAMES.join('|')})\\.ts$)`);

// ADL component `vectors`: the only files allowed to load the optional native/ML deps.
export const OPTIONAL_DEP_OWNERS = /^src\/(embeddings|vectorStore)\.ts$/;
export const OPTIONAL_DEP_IMPORT =
  /(?:from\s+|import\s*\(\s*)['"](?:@huggingface\/transformers|better-sqlite3|sqlite-vec)['"]/;

// Everything that is not tools, server or entry point (ADL: State, Persistence, Search, Vectors, helpers).
export const CORE = /^src\/(?!__tests__\/|tools\/|index\.ts$|server\.ts$)/;
export const NOT_ENTRY = /^src\/(?!__tests__\/|index\.ts$|server\.ts$)/;

// ADL component `registry` and the tools that may depend on it.
export const REGISTRY = /^src\/tools\/registry\.ts$/;
export const TOOL_NAMES: string[] = ['store', 'mutate', 'query', 'recall', 'rerank'];

// ADL [TR-R4]: the only files allowed to start external processes.
export const PROCESS_OWNERS = /^src\/(vectorStore|spec\/exec)\.ts$/;
export const PROCESS_IMPORT = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](?:node:)?child_process['"]/;

// ADL component `spec`: src/spec/** (leaves and core modules).
export const SPEC = /^src\/spec\//;

export const MAX_LINES_PER_FILE = 600; // code-quality.adl: MAX_LINES_PER_FILE

// ADL [TR-S10]: lexical search (tfidf, ebbinghaus, rrf) and the optional vector / persistence stack.
export const SEARCH = /^src\/(tfidf|ebbinghaus|rrf)\.ts$/;
export const VECTORS_AND_PERSISTENCE = /^src\/(embeddings|vectorStore|persistence)\.ts$/;

// ADL [TR-S11]: the tools that reuse store/mutate on purpose.
export const REUSING_TOOLS = ['bulk', 'architecture'];
