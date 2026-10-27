import { describe, it, expect } from 'vitest';
import { parseSpecConfig, SPEC_DEFAULTS, SPEC_TOOL_NAMES, isArchitectureFile } from '../spec/config.js';

describe('specDriven config', () => {
  it('defaults turn everything on when the block is missing', () => {
    expect(parseSpecConfig(undefined)).toEqual(SPEC_DEFAULTS);
    expect(parseSpecConfig({}).tools).toEqual([...SPEC_TOOL_NAMES]);
  });

  it('enabled: false switches every feature off, whatever the other keys say', () => {
    const c = parseSpecConfig({ enabled: false, sessionSummary: true, tools: ['trace'] });
    expect(c.enabled).toBe(false);
    expect(c.tools).toEqual([]);
    expect(c.categories).toEqual([]);
    expect(c.sessionSummary || c.captureChanges || c.extractDecisions || c.guardrails).toBe(false);
  });

  it('tools keeps only known names, so a typo cannot register anything', () => {
    expect(parseSpecConfig({ tools: ['trace', 'bogus', 'trace'] }).tools).toEqual(['trace']);
    expect(parseSpecConfig({ tools: [] }).tools).toEqual([]);
  });

  it('a wrongly typed value falls back to its default', () => {
    const c = parseSpecConfig({ sessionSummary: 'yes', sessionSummaryMaxChars: -5, categories: 'specs', calm: 3 });
    expect(c.sessionSummary).toBe(true);
    expect(c.sessionSummaryMaxChars).toBe(1500);
    expect(c.categories).toEqual(SPEC_DEFAULTS.categories);
    expect(c.calm).toEqual(SPEC_DEFAULTS.calm);
  });

  it('rejects a category that is not a safe directory name and a cliVersion that could inject arguments', () => {
    expect(parseSpecConfig({ categories: ['../etc', 'ok-cat', 'Bad Name'] }).categories).toEqual(['ok-cat']);
    expect(parseSpecConfig({ calm: { cliVersion: '1.0 --registry=evil' } }).calm.cliVersion).toBe('1.66.0');
    expect(parseSpecConfig({ calm: { cliVersion: '1.70.2', allowNpx: true } }).calm).toMatchObject({ cliVersion: '1.70.2', allowNpx: true });
  });

  it('classifies architecture files by the configured extensions', () => {
    const c = parseSpecConfig({ adlExtensions: ['.adl', '.arch'] });
    expect(isArchitectureFile('a/structure.adl', c)).toBe('adl');
    expect(isArchitectureFile('x.arch', c)).toBe('adl');
    expect(isArchitectureFile('sys.calm.json', c)).toBe('calm');
    expect(isArchitectureFile('package.json', c)).toBeNull();
  });
});
