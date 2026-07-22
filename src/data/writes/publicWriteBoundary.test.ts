import { describe, expect, it } from 'vitest';
import * as publicData from '../index';

describe('S12 公共写边界', () => {
  it('公共 barrel 只给 dataStore 读取能力，raw store 本身不可取得', () => {
    const surface = publicData.dataStore as unknown as Record<string, unknown>;
    expect(Object.keys(surface).sort()).toEqual(
      ['get', 'getAll', 'getAllIncludingDeleted', 'getIncludingDeleted'].sort(),
    );
    expect(surface.put).toBeUndefined();
    expect(surface.appendEvent).toBeUndefined();
    expect(surface.runAtomic).toBeUndefined();
    expect(surface.softDelete).toBeUndefined();
    expect((publicData as unknown as Record<string, unknown>).internalDataStore).toBeUndefined();
    expect(publicData.executeAtomicWrite).toBeTypeOf('function');
  });

  it('类型层拒绝从公共 dataStore 调用未校验写方法', () => {
    if (false) {
      // @ts-expect-error S12: 公共 dataStore 没有 raw put。
      void publicData.dataStore.put('tasks', {});
      // @ts-expect-error S12: 公共 dataStore 没有 raw appendEvent。
      void publicData.dataStore.appendEvent({});
      // @ts-expect-error S12: 公共 dataStore 没有 raw runAtomic。
      void publicData.dataStore.runAtomic([], async () => undefined);
    }
    expect(true).toBe(true);
  });
});
