import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  isLegacySchemaVersion,
  LEGACY_SCHEMA_VERSION,
} from './schemaVersion';

const DATA_DIR = dirname(fileURLToPath(import.meta.url));

/** src/data 下的非测试 `.ts` 源文件（排除 *.test.ts）。 */
function sourceFiles(): string[] {
  return readdirSync(DATA_DIR, { recursive: true, encoding: 'utf8' })
    .filter((p) => p.endsWith('.ts') && !p.endsWith('.test.ts'))
    .map((p) => join(DATA_DIR, p));
}

describe('schemaVersion (S4, §2.3)', () => {
  it('CURRENT_SCHEMA_VERSION 为整数 1', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(1);
    expect(Number.isInteger(CURRENT_SCHEMA_VERSION)).toBe(true);
  });

  it('LEGACY_SCHEMA_VERSION 为 0', () => {
    expect(LEGACY_SCHEMA_VERSION).toBe(0);
  });

  it('isLegacySchemaVersion 分类（无版本/0/旧版 → legacy；≥当前 → 非 legacy）', () => {
    expect(isLegacySchemaVersion(undefined)).toBe(true);
    expect(isLegacySchemaVersion(null)).toBe(true);
    expect(isLegacySchemaVersion(0)).toBe(true);
    expect(isLegacySchemaVersion(1)).toBe(false);
    expect(isLegacySchemaVersion(2)).toBe(false);
  });

  describe('集中化守卫（§2.3：常量集中、无散落字面量、不写文档版本号）', () => {
    const files = sourceFiles();

    it('非测试源不出现文档版本 4.0.0 字面量', () => {
      for (const f of files) {
        const code = readFileSync(f, 'utf8');
        expect(code.includes('4.0.0'), `${relative(DATA_DIR, f)} 不应出现 4.0.0`).toBe(false);
      }
    });

    it('非测试源不出现 schemaVersion 数字字面量赋值（应引用 CURRENT_SCHEMA_VERSION）', () => {
      const re = /schemaVersion\s*[:=]\s*\d/;
      for (const f of files) {
        const code = readFileSync(f, 'utf8');
        expect(
          re.test(code),
          `${relative(DATA_DIR, f)} 的 schemaVersion 应引用常量而非数字字面量`,
        ).toBe(false);
      }
    });
  });
});
