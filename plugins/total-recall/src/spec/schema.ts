import { z } from 'zod';
import { ARTIFACT_KINDS, SPEC_STATUSES } from './fields.js';

// Optional spec-driven links, shared by store_memory and update_memory
// (kept out of tools/ so neither tool depends on the other).
export const specFieldsSchema = {
  system: z.string().optional().describe('System the memory belongs to, e.g. "make-the-grade".'),
  artifact: z.enum(ARTIFACT_KINDS).optional().describe('Kind of artifact the memory is about.'),
  elements: z.array(z.string()).optional().describe('Architecture elements it is about: "adl:<component>", "assert:<ID>", "calm:<node>".'),
  requirements: z.array(z.string()).optional().describe('Requirement IDs from the spec, e.g. "REQ-7".'),
  sourcePath: z.string().optional().describe('Repo-relative path of the spec/ADL/CALM file this memory summarises (a pointer, not a copy).'),
  sourceRev: z.string().optional().describe('Git commit of that file when the memory was written.'),
  status: z.enum(SPEC_STATUSES).optional().describe('Decision/spec status, or failed/resolved for a fitness result.'),
  supersedes: z.string().optional().describe('Key of the memory this one replaces.'),
};

