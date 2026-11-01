// Cyclomatic complexity of every production function, for the [TR-Q9] ratchet.
// V(G) = decision points + 1 (equal to E - N + 2 for one connected control-flow
// graph). Decision points: if, ?:, case, loops, catch, &&, ||, ?? and their
// assignment forms. A nested function is measured on its own.
import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';

const DECISIONS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.IfStatement, ts.SyntaxKind.ConditionalExpression, ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement, ts.SyntaxKind.ForOfStatement, ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement, ts.SyntaxKind.CatchClause, ts.SyntaxKind.CaseClause,
]);
const LOGICAL = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken, ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

const isFn = (n: ts.Node): n is ts.FunctionLikeDeclaration =>
  ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isArrowFunction(n) ||
  ts.isFunctionExpression(n) || ts.isConstructorDeclaration(n) ||
  ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n);

function nameOf(n: ts.FunctionLikeDeclaration, sf: ts.SourceFile): string {
  if (n.name) return n.name.getText(sf);
  const p = n.parent;
  if (p && (ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p))) return p.name.getText(sf);
  return `<anonymous>`;
}

function complexity(fn: ts.Node): number {
  let d = 0;
  const visit = (n: ts.Node): void => {
    if (n !== fn && isFn(n)) return;
    if (DECISIONS.has(n.kind)) d++;
    if (ts.isBinaryExpression(n) && LOGICAL.has(n.operatorToken.kind)) d++;
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(fn, visit);
  return d + 1;
}

export interface FnComplexity { key: string; file: string; name: string; cc: number }

function listProdFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== '__tests__') walk(p); }
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) out.push(p);
    }
  };
  walk(path.join(root, 'src'));
  return out.sort();
}

/** Every function in src/** (tests excluded). `key` is `<file>::<name>`, `#2`, `#3`… for repeats. */
export function measureComplexity(root: string): FnComplexity[] {
  const result: FnComplexity[] = [];
  for (const abs of listProdFiles(root)) {
    const file = path.relative(root, abs).split(path.sep).join('/');
    const sf = ts.createSourceFile(file, fs.readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true);
    const seen = new Map<string, number>();
    const visit = (n: ts.Node): void => {
      if (isFn(n)) {
        const name = nameOf(n, sf);
        const count = (seen.get(name) ?? 0) + 1;
        seen.set(name, count);
        result.push({ key: `${file}::${name}${count > 1 ? `#${count}` : ''}`, file, name, cc: complexity(n) });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return result;
}
