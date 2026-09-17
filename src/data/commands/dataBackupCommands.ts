import {
  createLocalBackupSnapshot,
  parseLocalBackup,
  type LocalBackupFile,
} from '../backup/localBackup';
import { EVENT_STORE, STORE, STORE_NAMES, dataStore, internalDataStore } from '../dataStore';
import { newId } from '../id';
import {
  ensureCurrentAppDateInitialized,
  type InitializationClock,
} from '../initialization/currentAppDate';
import { makeEvent, type Event, type Session } from '../schema';
import { CURRENT_SCHEMA_VERSION } from '../schemaVersion';
import { validateEvent } from '../validation';
import { executeAtomicWrite } from '../writes/executeAtomicWrite';
import type { TaskCommandResult } from './taskCommands';

export { createLocalBackupSnapshot, parseLocalBackup, serializeLocalBackup } from '../backup/localBackup';
export type { LocalBackupFile } from '../backup/localBackup';

export async function exportLocalBackup(input: InitializationClock): Promise<LocalBackupFile> {
  await ensureCurrentAppDateInitialized(input);
  return createLocalBackupSnapshot(input.now);
}

export async function recordLocalBackupExported(
  input: InitializationClock & { totalRecords: number },
): Promise<TaskCommandResult<Event<'data.exported'>>> {
  return executeAtomicWrite(
    {
      storeNames: [EVENT_STORE],
      now: input.now,
      timezone: input.timezone,
      diagnosticContext: {
        entityType: 'Event',
        operation: 'appendEvent',
        sourceEventType: 'data.exported',
      },
    },
    async (transaction) => {
      const event = makeEvent({
        now: input.now,
        timezone: input.timezone,
        type: 'data.exported',
        correlationId: transaction.correlationId,
        payload: {
          format: 'json',
          schemaVersion: String(CURRENT_SCHEMA_VERSION),
          totalRecords: input.totalRecords,
        },
      });
      await transaction.appendEvent(event);
      return { value: event, correlationId: transaction.correlationId };
    },
  );
}

export async function importLocalBackup(
  input: InitializationClock & { jsonText: string },
): Promise<TaskCommandResult<{ totalRecords: number }>> {
  const backup = parseLocalBackup(input.jsonText);
  const activeSession = (await dataStore.getAll<Session>(STORE.sessions)).find(
    (session) => session.status === 'active',
  );
  if (activeSession) {
    throw new Error('请先结束当前计时，再恢复备份');
  }

  const correlationId = newId();
  const importedEvent = makeEvent({
    now: input.now,
    timezone: input.timezone,
    type: 'data.imported',
    correlationId,
    payload: {
      format: 'json',
      sourceSchemaVersion: backup.schemaVersion,
      totalRecords: backup.totalRecords,
    },
  });
  await validateEvent(importedEvent);

  const records = {} as Record<(typeof STORE_NAMES)[number], unknown[]>;
  for (const store of STORE_NAMES) {
    records[store] = [...backup.records[store]];
  }
  records[EVENT_STORE] = [...records[EVENT_STORE], importedEvent];

  await internalDataStore.replaceAllForImport(records);
  return { value: { totalRecords: backup.totalRecords }, correlationId };
}
