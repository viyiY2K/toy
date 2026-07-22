import { describe, expect, it } from 'vitest';
import { newId } from '../id';
import {
  dataStore as publicDataStore,
  internalDataStore as dataStore,
  EVENT_STORE,
  STORE_NAMES,
  SYNCABLE_STORE_NAMES,
} from '../dataStore';

describe('dataStore over IndexedDB (S1 skeleton)', () => {
  it('恰好 7 个 store，且与 §3 七实体一一对应', () => {
    expect(STORE_NAMES).toHaveLength(7);
    expect([...STORE_NAMES].sort()).toEqual(
      [
        'dayPlans',
        'energyRecords',
        'events',
        'sessions',
        'settings',
        'tasks',
        'unresolvedIntervals',
      ].sort(),
    );
  });

  it('可同步实体 store（6 个，剔除 events）能 put → get → put 覆盖更新 → getAll', async () => {
    expect(SYNCABLE_STORE_NAMES).toHaveLength(6);
    expect(SYNCABLE_STORE_NAMES).not.toContain(EVENT_STORE);

    for (const store of SYNCABLE_STORE_NAMES) {
      const id = newId();
      const record = { id, store, marker: 'S1', deletedAt: null };

      // Create
      await dataStore.put(store, record);
      expect(await dataStore.get<typeof record>(store, id)).toEqual(record);

      // Update（put 覆盖同主键，对可同步实体合法）
      const updated = { ...record, marker: 'S1-updated' };
      await dataStore.put(store, updated);
      expect(await dataStore.get<typeof record>(store, id)).toEqual(updated);

      // Read all
      const all = await dataStore.getAll<typeof record>(store);
      expect(all.some((r) => r.id === id)).toBe(true);
    }
  });

  it('events 为 append-only：appendEvent 可写入且可读，同 id 重复 append 失败、原记录不被改', async () => {
    const id = newId();
    const event = { id, type: 'demo.smoke', occurredAt: new Date().toISOString() };

    await dataStore.appendEvent(event);
    expect(await dataStore.get<typeof event>(EVENT_STORE, id)).toEqual(event);
    expect(
      (await dataStore.getAll<typeof event>(EVENT_STORE)).some((e) => e.id === id),
    ).toBe(true);

    // 同 id 第二次 append 必须失败（不可覆盖）
    await expect(dataStore.appendEvent({ ...event, type: 'demo.changed' })).rejects.toThrow();

    // 确认原 Event 未被改动
    expect(await dataStore.get<typeof event>(EVENT_STORE, id)).toEqual(event);
  });

  it('运行时守卫：绕过类型对 events 调用 put 应被拒绝（§3.4、红线 8）', async () => {
    const putAny = dataStore.put as unknown as (store: string, value: unknown) => Promise<void>;
    await expect(putAny(EVENT_STORE, { id: newId() })).rejects.toThrow(/append-only/);
  });

  it('回归守卫：dataStore 公开面不含任何物理删除入口（§2.4、红线 12）', () => {
    const surface = publicDataStore as unknown as Record<string, unknown>;
    expect(surface.delete).toBeUndefined();
    expect(surface.clear).toBeUndefined();
    expect(surface.remove).toBeUndefined();
  });
});
