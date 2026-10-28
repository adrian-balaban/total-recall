// validate_architecture check: ADL coverage (every tagged assertion has a test
// that carries its ID). Pure function, no external tool; the ADL has no runtime,
// so this is what keeps the notation honest.
import type { ArchModel } from './indexer.js';

export interface CheckResult {
  check: string;          // stable ID: `adl-coverage:<assertion ID>`
  ok: boolean;
  elements: string[];
  message: string;
}

export function adlCoverage(model: ArchModel): CheckResult[] {
  return model.assertions.filter((a) => a.tagged).map((a) => ({
    check: `adl-coverage:${a.id}`,
    ok: a.tests.length > 0,
    elements: [`assert:${a.id}`],
    message: a.tests.length ? `tested by ${a.tests.length} test line(s)` : `no test carries [${a.id}] (${a.source}: ${a.text})`,
  }));
}
