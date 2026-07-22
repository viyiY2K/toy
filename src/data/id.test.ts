import { describe, expect, it } from 'vitest';
import { newId } from './id';

/**
 * UUID 通用格式：8-4-4-4-12 hex。
 * 第 3 段首位是版本号（捕获组 1），第 4 段首位是 variant（捕获组 2）。
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-([0-9a-f])[0-9a-f]{3}-([0-9a-f])[0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newId (S0 smoke)', () => {
  it('产出合法 UUID，版本位 = 7、variant ∈ {8,9,a,b}', () => {
    const id = newId();
    const m = UUID_RE.exec(id);
    expect(m).not.toBeNull();
    // 版本位必须为 7（红线 1：禁止 UUID v4 / nanoid / 自增）
    expect(m![1]).toBe('7');
    // variant 高位为 10xx → 第 4 段首字符 ∈ {8,9,a,b}
    expect(['8', '9', 'a', 'b']).toContain(m![2]);
  });

  it('多次调用产出互不相同的 id', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newId()));
    expect(ids.size).toBe(100);
  });

  it('连续生成按字典序单调递增且无重复（v7 时间序，S2 硬验收）', () => {
    const n = 1000;
    const ids = Array.from({ length: n }, () => newId());

    // 无重复
    expect(new Set(ids).size).toBe(n);

    // 字典序 == 生成顺序（v7 前 48 位为毫秒时间戳，字典序即时间序）
    expect(ids).toEqual([...ids].sort());

    // 相邻严格递增（不相等）
    for (let i = 1; i < n; i++) {
      expect(ids[i]! > ids[i - 1]!).toBe(true);
    }
  });
});
