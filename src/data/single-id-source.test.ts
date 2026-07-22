import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** 本测试文件所在目录即数据层根 `src/data`。 */
const DATA_DIR = dirname(fileURLToPath(import.meta.url));

/** 递归收集 src/data 下的非测试 `.ts` 源文件（排除 *.test.ts；.md/.json 等天然不含）。 */
function sourceFiles(): string[] {
  return readdirSync(DATA_DIR, { recursive: true, encoding: 'utf8' })
    .filter((p) => p.endsWith('.ts') && !p.endsWith('.test.ts'))
    .map((p) => join(DATA_DIR, p));
}

const IMPORTS_UUID = /\bfrom\s+['"]uuid['"]|require\(\s*['"]uuid['"]\s*\)/;

/** 禁止出现的第二套 / 错误 ID 生成方式（红线 1：禁自增 / nanoid / UUID v4）。 */
const FORBIDDEN: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'nanoid', re: /\bfrom\s+['"]nanoid['"]|\bnanoid\s*\(/ },
  { name: 'crypto.randomUUID', re: /crypto\.randomUUID\s*\(/ },
  {
    name: 'node:crypto randomUUID named import',
    re: /import\s*\{[^}]*\brandomUUID\b[^}]*\}\s*from\s*['"](?:node:)?crypto['"]/s,
  },
  {
    name: 'node:crypto randomUUID destructured require',
    re: /(?:const|let|var)\s*\{[^}]*\brandomUUID\b[^}]*\}\s*=\s*require\(\s*['"](?:node:)?crypto['"]\s*\)/s,
  },
  { name: 'bare randomUUID', re: /(?<![.\w])randomUUID\s*\(/ },
  { name: 'UUID v4', re: /\buuidv4\b/ },
];

describe('single UUID v7 id source (S2 guard)', () => {
  const files = sourceFiles();

  it('src/data 内只有 id.ts 引入 uuid', () => {
    const importers = files
      .filter((f) => IMPORTS_UUID.test(readFileSync(f, 'utf8')))
      .map((f) => relative(DATA_DIR, f))
      .sort();
    expect(importers).toEqual(['id.ts']);
  });

  it('src/data 非测试源文件不含 nanoid / crypto.randomUUID / UUID v4', () => {
    for (const f of files) {
      const code = readFileSync(f, 'utf8');
      for (const { name, re } of FORBIDDEN) {
        expect(re.test(code), `${relative(DATA_DIR, f)} 不应使用 ${name}`).toBe(false);
      }
    }
  });

  it('id.ts 的 uuid 导入只用 v7（不用 v4）', () => {
    const idTs = readFileSync(join(DATA_DIR, 'id.ts'), 'utf8');
    // 只检查从 'uuid' 导入的具名绑定，避免注释里出现的 "v4"/"v7" 字样误报。
    const m = /import\s*\{([^}]*)\}\s*from\s*['"]uuid['"]/.exec(idTs);
    expect(m).not.toBeNull();
    const imported = m![1] ?? '';
    expect(/\bv7\b/.test(imported)).toBe(true);
    expect(/\bv4\b/.test(imported)).toBe(false);
  });

  it('守卫覆盖 node:crypto 具名/解构导入和 randomUUID 裸调用', () => {
    const samples = [
      `import { randomUUID } from 'node:crypto';\nrandomUUID();`,
      `import { randomUUID as makeId } from 'crypto';\nmakeId();`,
      `const { randomUUID: makeId } = require('node:crypto');\nmakeId();`,
      `randomUUID();`,
    ];
    for (const sample of samples) {
      expect(
        FORBIDDEN.some(({ re }) => re.test(sample)),
        `守卫应拒绝: ${sample}`,
      ).toBe(true);
    }
  });
});
