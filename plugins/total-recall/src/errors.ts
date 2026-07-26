// Typed errors for tool handlers, so callers (import_memories) can branch on
// type instead of regex-matching the (English, mutable) error message text.
// Adding a new case: throw a typed subclass here and branch on `instanceof` at
// the call site — never on `/substring/.test(e.message)`.

// Thrown by store_memory when a memory with the derived key already exists and
// force=false. import_memories catches this to classify the item as "skipped"
// (a normal, recoverable round-trip collision) rather than "error".
export class MemoryExistsError extends Error {
  readonly key: string;
  constructor(key: string, message: string) {
    super(message);
    this.name = 'MemoryExistsError';
    // Preserve the prototype chain across transpilation targets (ES5 down-level
    // breaks `instanceof` without this).
    Object.setPrototypeOf(this, MemoryExistsError.prototype);
    this.key = key;
  }
}