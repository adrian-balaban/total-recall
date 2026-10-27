import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';

// Spec-driven hooks (SPEC-DRIVEN-PLAN phase 5), end to end through the real scripts
// with a redirected HOME: the SessionStart architecture summary, the
// PostToolUse/AfterTool change prompt, the PreCompact decision fields, and the
// wiring in both hooks.json (Claude Code) and hooks.gemini.json (Gemini).

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'hooks', 'scripts');
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout?.trim() || '/bin/bash';
const OK = fs.existsSync(path.join(ROOT, 'dist', 'spec-config.mjs')) && fs.existsSync(path.join(ROOT, 'dist', 'spec-fields.mjs'));

let home: string;
let project: string;
let stubBin: string;

function setConfig(specDriven?: unknown) {
  const p = path.join(home, '.total-recall', 'config.json');
  if (specDriven === undefined) fs.rmSync(p, { force: true });
  else fs.writeFileSync(p, JSON.stringify({ specDriven }));
}

function sh(script: string, input: string, env: NodeJS.ProcessEnv = {}) {
  const r = spawnSync(BASH, [path.join(SCRIPTS, script)], {
    encoding: 'utf8', input, cwd: project,
    env: { ...process.env, HOME: home, NODE_BIN: process.execPath, ...env },
  });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status };
}

const suite = OK ? describe : describe.skip;

suite('spec-driven hooks', () => {
  beforeAll(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-spec-hooks-home-'));
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-spec-hooks-proj-'));
    stubBin = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-spec-hooks-bin-'));
    fs.mkdirSync(path.join(home, '.total-recall', 'personal-vault'), { recursive: true });
    fs.mkdirSync(path.join(project, 'arch'));
    fs.writeFileSync(path.join(project, 'arch', 'shop.adl'), 'DEFINE SYSTEM Shop AS shop\n');
    fs.writeFileSync(path.join(home, '.total-recall', 'index.json'), JSON.stringify({ v: 1, entries: {
      'architecture/arch-index-shop': {
        key: 'architecture/arch-index-shop', title: 'Architecture index: shop', tags: ['architecture-index'], system: 'shop',
        sourceRev: 'abcdef1234567890', contentPreview: 'Architecture index for **shop**.\n\n- Domains (1): Orders\n- Assertions: 2',
      },
      'troubleshooting/fitness-shop-x': { key: 'troubleshooting/fitness-shop-x', title: 'Fitness failure: adl-coverage:SHOP-2 (shop)', tags: [], system: 'shop', artifact: 'fitness-result', status: 'failed' },
      'decisions/encrypt': { key: 'decisions/encrypt', title: 'Encrypt the order DB', tags: [], system: 'shop', artifact: 'adr', category: 'decisions', updated: '2026-10-01' },
    } }));
    fs.writeFileSync(path.join(home, '.total-recall', '.index-cache.txt'), '- knowledge/x: X');
  });

  afterAll(() => {
    for (const d of [home, project, stubBin]) fs.rmSync(d, { recursive: true, force: true });
  });

  describe('SessionStart architecture summary (load-memory-index.sh)', () => {
    const context = (cwd: string) => JSON.parse(sh('load-memory-index.sh', JSON.stringify({ cwd })).stdout).hookSpecificOutput.additionalContext as string;

    it('adds the summary, open failures and recent decisions in a project with ADL files', () => {
      setConfig(undefined);
      const ctx = context(project);
      expect(ctx).toContain('### Architecture (spec-driven)');
      expect(ctx).toContain('**shop** (index `architecture/arch-index-shop`, rev abcdef123456): - Domains (1): Orders - Assertions: 2');
      expect(ctx).toContain('Open fitness failures: Fitness failure: adl-coverage:SHOP-2 (shop)');
      expect(ctx).toContain('Recent decisions: Encrypt the order DB');
    });

    it('adds nothing in a project without ADL or CALM files', () => {
      expect(context(home)).not.toContain('Architecture (spec-driven)');
    });

    it('adds nothing when sessionSummary or the whole block is off, and respects the size budget', () => {
      setConfig({ sessionSummary: false });
      expect(context(project)).not.toContain('Architecture (spec-driven)');
      setConfig({ enabled: false });
      expect(context(project)).not.toContain('Architecture (spec-driven)');
      setConfig({ sessionSummaryMaxChars: 120 });
      const ctx = context(project);
      const part = ctx.slice(ctx.indexOf('### Architecture'));
      expect(part.length).toBeLessThanOrEqual(120);
      setConfig(undefined);
    });

    it('asks to index a system that has no index yet', () => {
      fs.writeFileSync(path.join(project, 'arch', 'other.adl'), 'DEFINE SYSTEM Billing AS billing\n');
      expect(context(project)).toContain('**billing**: not indexed yet. Run index_architecture');
      fs.rmSync(path.join(project, 'arch', 'other.adl'));
    });
  });

  describe('architecture change prompt (architecture-change.sh)', () => {
    const run = (input: unknown) => JSON.parse(sh('architecture-change.sh', JSON.stringify(input)).stdout);

    it('Claude Code PostToolUse on an .adl edit asks to re-index and record the change', () => {
      setConfig(undefined);
      const out = run({ hook_event_name: 'PostToolUse', cwd: project, tool_name: 'Edit', tool_input: { file_path: path.join(project, 'arch', 'shop.adl') } });
      expect(out.hookSpecificOutput.hookEventName).toBe('PostToolUse');
      expect(out.hookSpecificOutput.additionalContext).toMatch(/index_architecture\(path="[^"]+"\)[\s\S]*architecture-changes[\s\S]*validate_architecture/);
    });

    it('Gemini AfterTool on a .calm.json write answers with the AfterTool event name', () => {
      const out = run({ hook_event_name: 'AfterTool', tool_name: 'write_file', tool_input: { file_path: '/p/sys.calm.json' } });
      expect(out.hookSpecificOutput.hookEventName).toBe('AfterTool');
    });

    it('any other file, or captureChanges off, is a bare continue', () => {
      expect(run({ hook_event_name: 'PostToolUse', tool_input: { file_path: '/p/src/app.ts' } })).toEqual({ continue: true });
      setConfig({ captureChanges: false });
      expect(run({ hook_event_name: 'PostToolUse', tool_input: { file_path: '/p/a.adl' } })).toEqual({ continue: true });
      setConfig(undefined);
    });

    it('honours custom extensions from the config', () => {
      setConfig({ adlExtensions: ['.arch'] });
      expect(run({ hook_event_name: 'PostToolUse', tool_input: { file_path: '/p/x.arch' } }).hookSpecificOutput).toBeDefined();
      expect(run({ hook_event_name: 'PostToolUse', tool_input: { file_path: '/p/x.adl' } })).toEqual({ continue: true });
      setConfig(undefined);
    });
  });

  describe('PreCompact decision fields', () => {
    const transcript = () => {
      const t = path.join(home, 'transcript.jsonl');
      fs.writeFileSync(t, '{"type":"user","message":"we chose a broker"}\n');
      return t;
    };

    function runExtract(lines: string) {
      const promptFile = path.join(home, 'prompt.txt');
      fs.writeFileSync(path.join(stubBin, 'claude'), `#!/usr/bin/env bash\nprintf '%s' "$2" > "${promptFile}"\ncat > /dev/null\ncat "${path.join(home, 'lines.txt')}"\n`);
      fs.chmodSync(path.join(stubBin, 'claude'), 0o755);
      fs.writeFileSync(path.join(home, 'lines.txt'), lines);
      sh('extract-and-store-memories.sh', JSON.stringify({ transcript_path: transcript() }), { PATH: `${stubBin}:${process.env.PATH}` });
      return fs.readFileSync(promptFile, 'utf8');
    }

    it('asks for decisions with their elements, and stores the sanitised fields', () => {
      setConfig(undefined);
      const line = JSON.stringify({
        title: 'Use a broker for answers', content: 'Because tablets go offline.', category: 'decisions', tags: [],
        system: 'mtg', elements: ['adl:testing.answercapture', 'bad element'], artifact: 'adr', status: 'accepted', sourcePath: '/etc/passwd',
      });
      const prompt = runExtract(`${line}\n`);
      expect(prompt).toContain('"elements"');
      const file = fs.readFileSync(path.join(home, '.total-recall', 'personal-vault', 'decisions', 'use-a-broker-for-answers.md'), 'utf8');
      expect(file).toMatch(/^system: mtg$/m);
      expect(file).toMatch(/^elements: \[.*adl:testing\.answercapture.*\]$/m);
      expect(file).not.toContain('bad element');
      expect(file).not.toContain('/etc/passwd');
      expect(file).toMatch(/^schemaVersion: 2$/m);
    });

    it('leaves the prompt as before when extractDecisions is off', () => {
      setConfig({ extractDecisions: false });
      expect(runExtract('')).not.toContain('"elements"');
      setConfig(undefined);
    });
  });

  describe('wiring in both clients', () => {
    const hook = (file: string, event: string) => {
      const groups = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', file), 'utf8')).hooks[event] as any[];
      return groups.find((g) => g.hooks.some((h: any) => h.command.endsWith('/architecture-change.sh')));
    };
    it('hooks.json runs architecture-change.sh on Write, Edit and MultiEdit', () => {
      expect(hook('hooks.json', 'PostToolUse').matcher.split('|').sort()).toEqual(['Edit', 'MultiEdit', 'Write']);
    });
    it('hooks.gemini.json runs it on write_file and replace', () => {
      expect(hook('hooks.gemini.json', 'AfterTool').matcher.split('|').sort()).toEqual(['replace', 'write_file']);
    });
    it('the script is executable', () => {
      expect(fs.statSync(path.join(SCRIPTS, 'architecture-change.sh')).mode & 0o111).not.toBe(0);
    });
  });
});
