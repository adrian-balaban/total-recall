// Type declarations for scripts/atomic-write.mjs (the .mjs is JS, not in
// rootDir=src, and allowJs is off — NodeNext resolution pairs this .d.mts with
// the .mjs so the unit test in src/__tests__/atomic-write.test.ts typechecks.
export function atomicWrite(p: string, data: string): void;
export function cleanupInFlightTmp(): void;