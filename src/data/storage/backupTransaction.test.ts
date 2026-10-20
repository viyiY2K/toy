import { describe, expect, it } from 'vitest';
import { internalDataStore as store, EVENT_STORE, STORE, STORE_NAMES } from '../dataStore';
import { newId } from '../id';

describe('backup transaction boundaries', () => {
  it('reads a coherent entity/Event snapshot while an atomic write is pending', async () => {
    const id = newId();
    const eventId = newId();
    const before = { id, title: 'before', deletedAt: null };
    await store.put(STORE.tasks, before);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const writing = store.runAtomic([STORE.tasks, EVENT_STORE], async (tx) => {
      await tx.put(STORE.tasks, { ...before, title: 'after', deletedAt: '2026-10-20T00:00:00Z' });
      started();
      await gate;
      await tx.appendEvent({ id: eventId, correlationId: tx.correlationId });
    });
    await ready;
    const reading = store.readAllForBackup();
    release();
    await writing;
    const snapshot = await reading;
    expect(Object.keys(snapshot).sort()).toEqual([...STORE_NAMES].sort());
    expect(snapshot.tasks).toContainEqual({ ...before, title: 'after', deletedAt: '2026-10-20T00:00:00Z' });
    expect(snapshot.events).toEqual(expect.arrayContaining([expect.objectContaining({ id: eventId })]));
  });

  it.each(['missing-id', 'uncloneable', 'duplicate-id'])(
    'rolls back all clears and writes if import has a %s record',
    async (failure) => {
      const original = await store.readAllForBackup();
      const id = newId();
      const bad = failure === 'missing-id' ? { title: 'no id' }
        : failure === 'uncloneable' ? { id, value: () => undefined }
          : { id };
      const incoming = { ...original, tasks: [{ id }, bad] };
      await expect(store.replaceAllForImport(incoming)).rejects.toThrow();
      expect(await store.readAllForBackup()).toEqual(original);
    },
  );

  it('checks active timer inside the import transaction and preserves local records', async () => {
    const original = await store.readAllForBackup();
    const id = newId();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const session = { id, status: 'active', deletedAt: null };
    const starting = store.runAtomic([STORE.sessions], async (tx) => {
      await tx.put(STORE.sessions, session);
      started();
      await gate;
    });
    await ready;
    // 模拟另一标签页正在开轮，导入必须等它提交后在自己的事务中阻断。
    const importing = expect(store.replaceAllForImport(original)).rejects.toThrow(/先结束当前计时/);
    release();
    await starting;
    await importing;
    expect(await store.readAllForBackup()).toEqual({
      ...original, sessions: [...original.sessions, session],
    });
    await store.put(STORE.sessions, { id, status: 'completed', deletedAt: null });
    await store.replaceAllForImport(original);
  });
});
