import { memIndex } from '../state.js';
import { readMemoryContent } from '../vault-scan.js';
import { storeMemory } from './store.js';
import { deleteMemory } from './mutate.js';
import { MemoryExistsError } from '../errors.js';
import type { MemoryMetadata } from '../types.js';

// ─── export_memories ─────────────────────────────────────────────────────────

export function exportMemories(args: any): any {
  const keysArg = args.keys;
  let keySet: Set<string> | undefined;
  if (keysArg !== undefined) {
    const raw = Array.isArray(keysArg) ? keysArg : [keysArg];
    keySet = new Set(raw.map((k: unknown) => (typeof k === 'string' ? k : String(k))));
  }

  const category = args.category;
  const tag = args.tag;

  const metas = Object.values(memIndex).filter((m: MemoryMetadata) => {
    if (keySet && !keySet.has(m.key)) return false;
    if (category !== undefined && m.category !== category) return false;
    if (tag !== undefined && !m.tags.includes(tag)) return false;
    return true;
  });

  // 6.8: readMemoryContent returns null when the file is missing/unreadable
  // or its frontmatter is unparseable. The pre-fix code coerced that null to
  // `content: ''`, so a later `import_memories(force=true)` on the archive
  // would OVERWRITE real on-disk content with an empty string — silent data
  // loss. Now an unreadable memory is emitted as an error entry
  // `{ key, error }` (no content) and counted in `errors`; `count` stays the
  // number of successfully-exported memories. import_memories skips any entry
  // carrying an `error` field, so a force=true re-import can never clobber
  // real content with '' derived from a failed export read.
  let errors = 0;
  const memories: any[] = [];
  for (const m of metas) {
    const content = readMemoryContent(m.filePath, m.key);
    if (content === null) {
      errors++;
      memories.push({ key: m.key, error: 'unreadable or missing memory file' });
      continue;
    }
    memories.push({
      key: m.key,
      title: m.title,
      content,
      category: m.category,
      tags: m.tags,
      importanceScore: m.importanceScore,
      author: m.author,
      sessions: m.sessions,
      created: m.created,
      updated: m.updated,
      isOrg: m.isOrg,
    });
  }

  return { count: memories.length - errors, memories, errors };
}

// ─── import_memories ─────────────────────────────────────────────────────────

export function importMemories(args: any): any {
  const raw = Array.isArray(args.memories) ? args.memories : [];
  const force = args.force === true;

  const results: any[] = [];
  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const item of raw) {
    const m = item || {};
    // 6.8: skip entries that carry an `error` field (produced by export_memories
    // when the source file was unreadable/missing). Without this guard, a
    // force=true re-import of such an archive would call storeMemory with
    // content derived from the error entry (undefined → 'Missing content'
    // throw, or worse, an empty-string content slipping through) and could
    // clobber the real on-disk memory. Skipping keeps the on-disk content
    // untouched and surfaces the skip in the result.
    if (m.error) {
      skipped++;
      results.push({ key: m.key, status: 'skipped', error: 'export carried an error: ' + m.error });
      continue;
    }
    try {
      const title = String(m.title ?? '');
      const content = m.content !== undefined ? String(m.content) : undefined;
      const category = m.category !== undefined ? String(m.category) : 'knowledge';
      const tags = Array.isArray(m.tags)
        ? m.tags.map((t: unknown) => (t === null || t === undefined ? '' : String(t))).filter(Boolean)
        : [];
      const importanceScore = typeof m.importanceScore === 'number' ? m.importanceScore : undefined;
      const author = m.author !== undefined ? String(m.author) : undefined;

      if (!title) throw new Error('Missing title');
      if (content === undefined) throw new Error('Missing content');

      const res = storeMemory({
        title, content, category, tags, importanceScore, author, force,
        key: m.key,
        created: m.created,
        updated: m.updated,
        sessions: Array.isArray(m.sessions) ? m.sessions : undefined,
      });
      imported++;
      results.push({ key: res.key, status: 'imported' });
    } catch (e: any) {
      // 6.4: branch on the typed error, not on `/already exists/.test(message)`.
      // The typed path also carries the colliding key so the caller can see
      // WHICH memory skipped, not just that one did.
      if (e instanceof MemoryExistsError) {
        skipped++;
        results.push({ key: e.key, status: 'skipped', error: e.message });
      } else {
        errors++;
        results.push({ status: 'error', error: e.message });
      }
    }
  }

  return { imported, skipped, errors, count: raw.length, results };
}

// ─── delete_memories ─────────────────────────────────────────────────────────

export function deleteMemories(args: any): any {
  const rawKeys = Array.isArray(args.keys)
    ? args.keys
    : typeof args.keys === 'string'
      ? [args.keys]
      : [];
  const keys = rawKeys.map((k: unknown) => (typeof k === 'string' ? k : String(k)));
  // 6.9: no up-front batch reject on reserved keys. The per-key loop below
  // calls deleteMemory, which throws on a reserved key (mutate.ts:140-142),
  // and the existing catch records it as {key, status:'error', error}. A
  // batch with one reserved key plus valid keys deletes the valid ones and
  // records the reserved key as a per-key error, instead of aborting the
  // whole batch (the old up-front `keys.some(isReservedKey)` throw was
  // batch-hostile and redundant with deleteMemory's own guard).
  const force = args.force === true;
  const confirm = args.confirm === true;

  if (keys.length === 0) throw new Error('No keys provided.');
  if (!confirm) {
    throw new Error(
      `Explicit confirmation required: you are about to delete ${keys.length} memory(s). Pass confirm=true to proceed.`
    );
  }

  const results: any[] = [];
  let deleted = 0;
  let errors = 0;

  for (const key of keys) {
    try {
      deleteMemory({ key, force });
      deleted++;
      results.push({ key, status: 'deleted' });
    } catch (e: any) {
      errors++;
      results.push({ key, status: 'error', error: e.message });
    }
  }

  return { deleted, errors, count: keys.length, results };
}
