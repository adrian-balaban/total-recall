import { memIndex } from '../state.js';
import { readMemoryContent, isReservedKey } from '../vault-scan.js';
import { storeMemory } from './store.js';
import { deleteMemory } from './mutate.js';
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

  const memories = metas.map((m) => {
    const content = readMemoryContent(m.filePath, m.key);
    return {
      key: m.key,
      title: m.title,
      content: content ?? '',
      category: m.category,
      tags: m.tags,
      importanceScore: m.importanceScore,
      author: m.author,
      sessions: m.sessions,
      created: m.created,
      updated: m.updated,
      isOrg: m.isOrg,
    };
  });

  return { count: memories.length, memories };
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
      if (/already exists/.test(e.message)) {
        skipped++;
        results.push({ status: 'skipped', error: e.message });
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
  if (keys.some(isReservedKey)) {
    throw new Error('One or more keys contain a reserved key segment.');
  }
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
