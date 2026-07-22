import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';

const DATA_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(DATA_DIR, '../..');
const UI_DIR = resolve(ROOT_DIR, 'src/ui');
const ENTRY_FILE = resolve(UI_DIR, 'main.jsx');
const DATA_PUBLIC_ENTRY = resolve(ROOT_DIR, 'src/data/index.ts');

const LEGACY_ROOT_FILES = [
  'data.jsx',
  'components.jsx',
  'timer.jsx',
  'activities.jsx',
  'stats.jsx',
  'app.jsx',
] as const;

interface ModuleReference {
  readonly kind: 'static' | 'dynamic';
  readonly specifier: string;
}

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.ts')) return ts.ScriptKind.TS;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

function staticStringValue(expression: ts.Expression | undefined): string | undefined {
  let current = expression;
  while (
    current
    && (
      ts.isParenthesizedExpression(current)
      || ts.isAsExpression(current)
      || ts.isTypeAssertionExpression(current)
      || ts.isNonNullExpression(current)
      || ts.isSatisfiesExpression(current)
    )
  ) {
    current = current.expression;
  }
  return current && ts.isStringLiteralLike(current) ? current.text : undefined;
}

function moduleReferencesFromSource(code: string, file: string): ModuleReference[] {
  const source = ts.createSourceFile(
    file,
    code,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
  const references: ModuleReference[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      references.push({ kind: 'static', specifier: node.moduleSpecifier.text });
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const specifier = node.arguments.length === 1
        ? staticStringValue(node.arguments[0])
        : undefined;
      if (specifier === undefined) {
        throw new Error(`${relative(ROOT_DIR, file)} contains a non-static dynamic import`);
      }
      references.push({ kind: 'dynamic', specifier });
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
      throw new Error(`${relative(ROOT_DIR, file)} contains CommonJS require()`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return references;
}

function moduleReferences(file: string): ModuleReference[] {
  return moduleReferencesFromSource(readFileSync(file, 'utf8'), file);
}

function isWithin(directory: string, file: string): boolean {
  const path = relative(directory, file);
  return path === '' || (!path.startsWith('..') && !path.startsWith('/'));
}

function localImportBase(importer: string, specifier: string): string | null {
  if (specifier.startsWith('.')) return resolve(dirname(importer), specifier);
  if (specifier.startsWith('/')) return resolve(ROOT_DIR, specifier.slice(1));
  if (specifier.startsWith('src/')) return resolve(ROOT_DIR, specifier);
  return null;
}

function resolveLocalImport(importer: string, specifier: string): string | null {
  const base = localImportBase(importer, specifier);
  if (base === null) return null;
  const candidates = [
    base,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.ts`,
    `${base}.tsx`,
    resolve(base, 'index.js'),
    resolve(base, 'index.jsx'),
    resolve(base, 'index.ts'),
    resolve(base, 'index.tsx'),
  ];
  const file = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
  if (!file) {
    throw new Error(`${relative(ROOT_DIR, importer)} has unresolved project-local import ${specifier}`);
  }
  if (!isWithin(ROOT_DIR, file)) {
    throw new Error(`${relative(ROOT_DIR, importer)} imports outside the project root: ${specifier}`);
  }
  return file;
}

function nextProductionUiFile(importer: string, reference: ModuleReference): string | null {
  const resolved = resolveLocalImport(importer, reference.specifier);
  if (resolved === null) {
    if (reference.kind === 'dynamic') {
      throw new Error(
        `${relative(ROOT_DIR, importer)} has an uninspectable external dynamic import ${reference.specifier}`,
      );
    }
    return null;
  }
  if (resolved === DATA_PUBLIC_ENTRY) return null;
  if (!isWithin(UI_DIR, resolved)) {
    throw new Error(
      `${relative(ROOT_DIR, importer)} may leave src/ui only through src/data/index; got ${relative(ROOT_DIR, resolved)}`,
    );
  }
  return resolved;
}

function reachableProductionUiFiles(): string[] {
  const pending = [ENTRY_FILE];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    for (const reference of moduleReferences(file)) {
      const nextFile = nextProductionUiFile(file, reference);
      if (nextFile) pending.push(nextFile);
    }
  }
  return [...visited].sort();
}

const FORBIDDEN_UI_TRUTH: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'legacy sessionStorage', re: /\bsessionStorage\b/ },
  { name: 'legacy pomo-state key', re: /pomo-state/ },
  { name: 'legacy INITIAL fixture', re: /\bINITIAL\b/ },
  { name: 'formal break.skipped trigger', re: /\bbreak\.skipped\b/ },
  { name: 'legacy/dev skipToEnd', re: /\bskipToEnd\b/ },
];

const LEGACY_PROPERTY_NAMES = new Set([
  'bucket',
  'completed',
  'cancelledPomos',
  'pomoEvents',
  'interrupts',
  'subtasks',
]);
const REAL_STATS_VIEW = resolve(UI_DIR, 'StatsView.jsx');

function staticPropertyName(name: ts.PropertyName | undefined): string | undefined {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  if (ts.isComputedPropertyName(name)) return staticStringValue(name.expression);
  return undefined;
}

function legacyPropertyUsesFromSource(code: string, file: string): string[] {
  const source = ts.createSourceFile(
    file,
    code,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    let name: string | undefined;
    if (ts.isPropertyAccessExpression(node)) name = node.name.text;
    if (ts.isElementAccessExpression(node)) name = staticStringValue(node.argumentExpression);
    if (ts.isPropertyAssignment(node)) name = staticPropertyName(node.name);
    if (ts.isShorthandPropertyAssignment(node)) name = node.name.text;
    if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) {
      name = node.propertyName ? staticPropertyName(node.propertyName) : node.name.text;
    }
    if (name && LEGACY_PROPERTY_NAMES.has(name)) found.add(name);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...found].sort();
}

function legacyPropertyUses(file: string): string[] {
  return legacyPropertyUsesFromSource(readFileSync(file, 'utf8'), file);
}

describe('S14 production entry and legacy isolation guard', () => {
  const html = readFileSync(resolve(ROOT_DIR, 'index.html'), 'utf8');
  const uiFiles = reachableProductionUiFiles();

  it('production HTML has one ESM UI entry and no legacy Babel/global JSX scripts', () => {
    const scriptTags = [...html.matchAll(/<script\b[^>]*>/g)].map(([tag]) => tag);
    const moduleSources = scriptTags
      .filter((tag) => /\btype=['"]module['"]/.test(tag))
      .map((tag) => /\bsrc=['"]([^'"]+)['"]/.exec(tag)?.[1])
      .filter((source): source is string => source !== undefined);
    expect(moduleSources).toEqual(['/src/ui/main.jsx']);
    expect(html).not.toMatch(/@babel\/standalone|type=['"]text\/babel['"]/);
    for (const legacyFile of LEGACY_ROOT_FILES) expect(html).not.toContain(legacyFile);
  });

  it('reachable production UI cannot read legacy state or promote old aggregate fields to truth', () => {
    expect(uiFiles.map((file) => relative(ROOT_DIR, file))).toContain('src/ui/main.jsx');
    for (const file of uiFiles) {
      const code = readFileSync(file, 'utf8');
      for (const { name, re } of FORBIDDEN_UI_TRUTH) {
        expect(re.test(code), `${relative(ROOT_DIR, file)} 不应包含 ${name}`).toBe(false);
      }
      const permittedRealStatsFields = file === REAL_STATS_VIEW ? new Set(['interrupts']) : new Set();
      expect(
        legacyPropertyUses(file).filter((name) => !permittedRealStatsFields.has(name)),
        `${relative(ROOT_DIR, file)} 不应访问旧聚合字段`,
      ).toEqual([]);
      if (file === REAL_STATS_VIEW) {
        expect(code, 'StatsView 的 interrupts 只能来自公共真实统计查询').toMatch(
          /import\s*\{\s*loadStatsDashboard\s*\}\s*from\s*['"]\.\.\/data\/index['"]/,
        );
      }
      expect(code, `${relative(ROOT_DIR, file)} 不得直接访问浏览器存储`).not.toMatch(
        /\b(?:indexedDB|IDBDatabase|dataStore|localStorage)\b/,
      );
      expect(code, `${relative(ROOT_DIR, file)} 不得生成第二套 ID`).not.toMatch(
        /crypto\.randomUUID\s*\(|(?<![.\w])randomUUID\s*\(|\bnanoid\s*\(|\buuidv4\s*\(/,
      );
      for (const { specifier } of moduleReferences(file)) {
        expect(['uuid', 'nanoid', 'crypto', 'node:crypto']).not.toContain(specifier);
        const importedName = specifier.split('/').at(-1)?.replace(/\.jsx$/, '');
        expect(
          LEGACY_ROOT_FILES.map((legacyFile) => legacyFile.replace(/\.jsx$/, '')),
          `${relative(ROOT_DIR, file)} 不得导入旧根 JSX`,
        ).not.toContain(importedName);
      }
      for (const legacyFile of LEGACY_ROOT_FILES) expect(code).not.toContain(legacyFile);
    }
  });

  it('retained prototype files are unreachable references, not a production or automatic demo path', () => {
    const reachable = new Set(uiFiles.map((file) => resolve(file)));
    for (const legacyFile of LEGACY_ROOT_FILES) {
      const legacyPath = resolve(ROOT_DIR, legacyFile);
      if (existsSync(legacyPath)) expect(reachable.has(legacyPath)).toBe(false);
    }
    for (const file of uiFiles) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/\bdemo\.(?:loaded|cleared)\b/);
    }
  });

  it('parses string dynamic imports and rejects computed dynamic or CommonJS module loading', () => {
    expect(moduleReferencesFromSource(
      "import './static'; export * from './exported'; void import(`./lazy`);",
      resolve(UI_DIR, 'fixture.jsx'),
    )).toEqual([
      { kind: 'static', specifier: './static' },
      { kind: 'static', specifier: './exported' },
      { kind: 'dynamic', specifier: './lazy' },
    ]);
    expect(() => moduleReferencesFromSource(
      'void import(nextModule);',
      resolve(UI_DIR, 'fixture.jsx'),
    )).toThrow(/non-static dynamic import/);
    expect(() => moduleReferencesFromSource(
      "require('./legacy');",
      resolve(UI_DIR, 'fixture.jsx'),
    )).toThrow(/CommonJS require/);
  });

  it('allows only UI modules and the exact public data entry as project-local dependencies', () => {
    expect(nextProductionUiFile(ENTRY_FILE, { kind: 'static', specifier: './App' }))
      .toBe(resolve(UI_DIR, 'App.jsx'));
    expect(nextProductionUiFile(ENTRY_FILE, { kind: 'static', specifier: '../data/index' }))
      .toBeNull();
    expect(() => nextProductionUiFile(
      ENTRY_FILE,
      { kind: 'static', specifier: '../../app' },
    )).toThrow(/may leave src\/ui only through src\/data\/index/);
    expect(() => nextProductionUiFile(
      ENTRY_FILE,
      { kind: 'dynamic', specifier: 'uninspectable-package' },
    )).toThrow(/uninspectable external dynamic import/);
    expect(nextProductionUiFile(
      ENTRY_FILE,
      { kind: 'static', specifier: 'external-package' },
    )).toBeNull();
  });

  it.each([
    ['dot access', 'void task.bucket;', ['bucket']],
    ['string element access', "void task['completed'];", ['completed']],
    ['template element access', 'void task[`bucket`];', ['bucket']],
    ['computed object property', "const value = { ['cancelledPomos']: oldValue };", ['cancelledPomos']],
    ['computed destructure', "const { ['interrupts']: alias } = task;", ['interrupts']],
    ['shorthand property', 'const subtasks = []; const value = { subtasks };', ['subtasks']],
  ])('detects legacy properties in the %s fixture', (_label, code, expected) => {
    expect(legacyPropertyUsesFromSource(code, resolve(UI_DIR, 'fixture.jsx'))).toEqual(expected);
  });

  it.each([
    ["task.status === 'completed'"],
    ["const completed = task.status === 'completed';"],
    ["const value = { status: 'completed', completedTasks: [] };"],
  ])('does not confuse valid completed status in fixture %s with a legacy property', (code) => {
    expect(legacyPropertyUsesFromSource(code, resolve(UI_DIR, 'fixture.jsx'))).toEqual([]);
  });
});
