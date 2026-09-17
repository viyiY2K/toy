import { describe, expect, it } from 'vitest';
import { dataStore, EVENT_STORE, STORE } from '../dataStore';
import { serializeLocalBackup } from '../backup/localBackup';
import type { Event, Task } from '../schema';
import { CURRENT_SCHEMA_VERSION } from '../schemaVersion';
import { createManualTask, deleteActiveTask } from './taskCommands';
import {
  exportLocalBackup,
  importLocalBackup,
  recordLocalBackupExported,
} from './dataBackupCommands';

const TIMEZONE = 'Asia/Shanghai';
const at = (minute: number) =>
  `2027-03-01T09:${String(minute).padStart(2, '0')}:00+08:00`;

describe('local backup export / import', () => {
  it('exports every store including tombstones, then records data.exported', async () => {
    const created = await createManualTask({
      now: at(0),
      timezone: TIMEZONE,
      title: '备份保留任务',
      destination: 'list',
    });
    await deleteActiveTask({ now: at(1), timezone: TIMEZONE, taskId: created.value.id });

    const snapshot = await exportLocalBackup({ now: at(2), timezone: TIMEZONE });
    expect(snapshot.schemaVersion).toBe(String(CURRENT_SCHEMA_VERSION));
    expect(snapshot.records.tasks.some((task) => (task as Task).id === created.value.id)).toBe(true);
    expect(
      snapshot.records.tasks.some(
        (task) => (task as Task).id === created.value.id && (task as Task).deletedAt !== null,
      ),
    ).toBe(true);

    const recorded = await recordLocalBackupExported({
      now: at(3),
      timezone: TIMEZONE,
      totalRecords: snapshot.totalRecords,
    });
    expect(recorded.value).toMatchObject({
      type: 'data.exported',
      payload: {
        format: 'json',
        schemaVersion: String(CURRENT_SCHEMA_VERSION),
        totalRecords: snapshot.totalRecords,
      },
    });
  });

  it('import replaces local records and appends data.imported', async () => {
    const kept = await createManualTask({
      now: at(4),
      timezone: TIMEZONE,
      title: '应被恢复',
      destination: 'list',
    });
    const snapshot = await exportLocalBackup({ now: at(5), timezone: TIMEZONE });
    const dropped = await createManualTask({
      now: at(6),
      timezone: TIMEZONE,
      title: '不应留下',
      destination: 'list',
    });

    const result = await importLocalBackup({
      now: at(7),
      timezone: TIMEZONE,
      jsonText: serializeLocalBackup(snapshot),
    });
    expect(result.value.totalRecords).toBe(snapshot.totalRecords);

    expect(await dataStore.get<Task>(STORE.tasks, kept.value.id)).toMatchObject({
      id: kept.value.id,
      title: '应被恢复',
    });
    expect(await dataStore.get<Task>(STORE.tasks, dropped.value.id)).toBeUndefined();
    expect(await dataStore.getIncludingDeleted<Task>(STORE.tasks, dropped.value.id)).toBeUndefined();

    const imported = (await dataStore.getAll<Event>(EVENT_STORE)).filter(
      (event) => event.type === 'data.imported' && event.correlationId === result.correlationId,
    );
    expect(imported).toMatchObject([
      {
        type: 'data.imported',
        payload: {
          format: 'json',
          sourceSchemaVersion: String(CURRENT_SCHEMA_VERSION),
          totalRecords: snapshot.totalRecords,
        },
      },
    ]);
  });

  it('rejects import while a session is still active', async () => {
    const snapshot = await exportLocalBackup({ now: at(8), timezone: TIMEZONE });
    const { internalDataStore } = await import('../dataStore');
    await internalDataStore.put(STORE.sessions, {
      id: '01900000-0000-7000-8000-00000000ace1',
      status: 'active',
      deletedAt: null,
    });

    await expect(
      importLocalBackup({
        now: at(9),
        timezone: TIMEZONE,
        jsonText: serializeLocalBackup(snapshot),
      }),
    ).rejects.toThrow(/先结束当前计时/);

    await internalDataStore.replaceAllForImport(snapshot.records);
  });
});
