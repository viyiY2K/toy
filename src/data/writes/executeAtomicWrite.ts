import {
  buildSoftDeleteTombstone,
  internalDataStore,
  EVENT_STORE,
  STORE,
  STORE_NAMES,
  type AtomicDataTransaction,
  type StoreName,
  type SyncableEntityMap,
  type SyncableStoreName,
  type TaskSoftDeleteOptions,
} from '../dataStore';
import { EVENT_TYPES, type EventType } from '../events';
import {
  makeEvent,
  type Event,
  type IsoDateTime,
  type Session,
} from '../schema';
import {
  EntityValidationError,
  validateDayPlan,
  validateEnergyRecord,
  validateEvent,
  validateSession,
  validateSettings,
  validateTask,
  validateUnresolvedInterval,
  type ValidationContext,
} from '../validation';

export type WriteOperation = 'create' | 'update' | 'softDelete' | 'appendEvent';
export type AttemptedWriteType = 'insertRecord' | 'updateField';
export type WriteEntityType =
  | 'Task'
  | 'DayPlan'
  | 'Session'
  | 'Event'
  | 'EnergyRecord'
  | 'UnresolvedInterval'
  | 'Settings'
  | 'AtomicWrite';

/** S12 error Event 允许写入 context 的封闭字段集；不接受标题、备注或实体快照。 */
export interface WriteDiagnosticContext {
  entityType?: WriteEntityType;
  entityId?: string;
  operation?: WriteOperation;
  storageEngine?: 'indexedDB';
  objectStore?: StoreName;
  attemptedWriteType?: AttemptedWriteType;
  schemaVersion?: number;
  invariant?: string;
  detectedBy?: 'writeValidation';
  sourceEventType?: EventType;
  sourceAction?: 'write';
}

export interface ExecuteAtomicWriteOptions {
  storeNames: readonly StoreName[];
  now: IsoDateTime;
  timezone: string;
  /** 可选补充诊断元信息；运行时仍会经过白名单，未知字段一律丢弃。 */
  diagnosticContext?: WriteDiagnosticContext;
}

export interface ValidatedAtomicWriteTransaction {
  readonly correlationId: string;
  get<T>(store: StoreName, id: string): Promise<T | undefined>;
  getAll<T>(store: StoreName): Promise<T[]>;
  getIncludingDeleted<T>(store: SyncableStoreName, id: string): Promise<T | undefined>;
  getAllIncludingDeleted<T>(store: SyncableStoreName): Promise<T[]>;
  put<S extends SyncableStoreName>(store: S, value: SyncableEntityMap[S]): Promise<void>;
  appendEvent(event: Event): Promise<void>;
  softDelete<S extends SyncableStoreName>(
    store: S,
    id: string,
    deletedAt: IsoDateTime,
    ...options: S extends typeof STORE.tasks ? [options?: TaskSoftDeleteOptions] : []
  ): Promise<SyncableEntityMap[S]>;
}

export interface InMemoryWriteDiagnostic {
  readonly eventType: 'error.dataWriteFailed' | 'error.unexpectedState';
  readonly errorCode: string;
  readonly context: Readonly<WriteDiagnosticContext>;
}

interface FailureMetadata {
  context: WriteDiagnosticContext;
  original: unknown;
}

class AtomicWriteFailure extends Error {
  constructor(
    readonly kind: 'validation' | 'storage',
    readonly metadata: FailureMetadata,
  ) {
    super(kind === 'validation' ? 'atomic write validation failed' : 'atomic storage write failed', {
      cause: metadata.original,
    });
    this.name = 'AtomicWriteFailure';
  }
}

class AtomicWorkCallbackFailure extends Error {
  constructor(readonly original: unknown) {
    super('atomic write callback failed', { cause: original });
    this.name = 'AtomicWorkCallbackFailure';
  }
}

const ENTITY_TYPE: Record<SyncableStoreName, WriteEntityType> = {
  tasks: 'Task',
  dayPlans: 'DayPlan',
  sessions: 'Session',
  energyRecords: 'EnergyRecord',
  unresolvedIntervals: 'UnresolvedInterval',
  settings: 'Settings',
};

const WRITE_CONTEXT_KEYS = [
  'entityType',
  'entityId',
  'operation',
  'storageEngine',
  'objectStore',
  'attemptedWriteType',
  'schemaVersion',
  'invariant',
  'detectedBy',
  'sourceEventType',
  'sourceAction',
] as const satisfies readonly (keyof WriteDiagnosticContext)[];

const inMemoryDiagnostics: InMemoryWriteDiagnostic[] = [];
const MAX_IN_MEMORY_DIAGNOSTICS = 50;
const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MACHINE_TOKEN = /^[A-Za-z0-9._-]{1,120}$/;
const ENTITY_TYPES = new Set<WriteEntityType>([
  'Task',
  'DayPlan',
  'Session',
  'Event',
  'EnergyRecord',
  'UnresolvedInterval',
  'Settings',
  'AtomicWrite',
]);

export function getInMemoryWriteDiagnostics(): readonly InMemoryWriteDiagnostic[] {
  return inMemoryDiagnostics.map((item) => ({ ...item, context: { ...item.context } }));
}

function sanitizeContext(value: unknown): WriteDiagnosticContext {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of WRITE_CONTEXT_KEYS) {
    const item = source[key];
    switch (key) {
      case 'entityType':
        if (typeof item === 'string' && ENTITY_TYPES.has(item as WriteEntityType)) result[key] = item;
        break;
      case 'entityId':
        if (typeof item === 'string' && UUID_V7.test(item)) result[key] = item;
        break;
      case 'operation':
        if (item === 'create' || item === 'update' || item === 'softDelete' || item === 'appendEvent') {
          result[key] = item;
        }
        break;
      case 'storageEngine':
        if (item === 'indexedDB') result[key] = item;
        break;
      case 'objectStore':
        if (typeof item === 'string' && (STORE_NAMES as readonly string[]).includes(item)) {
          result[key] = item;
        }
        break;
      case 'attemptedWriteType':
        if (item === 'insertRecord' || item === 'updateField') result[key] = item;
        break;
      case 'schemaVersion':
        if (Number.isInteger(item) && Number(item) >= 1) result[key] = item;
        break;
      case 'invariant':
        if (typeof item === 'string' && MACHINE_TOKEN.test(item)) result[key] = item;
        break;
      case 'detectedBy':
        if (item === 'writeValidation') result[key] = item;
        break;
      case 'sourceEventType':
        if (typeof item === 'string' && (EVENT_TYPES as readonly string[]).includes(item)) {
          result[key] = item;
        }
        break;
      case 'sourceAction':
        if (item === 'write') result[key] = item;
    }
  }
  return result as WriteDiagnosticContext;
}

function isStorageError(error: unknown): boolean {
  return (
    error instanceof DOMException ||
    (error instanceof Error &&
      ['AbortError', 'ConstraintError', 'DataError', 'QuotaExceededError', 'TransactionInactiveError'].includes(
        error.name,
      ))
  );
}

function recordFallback(diagnostic: InMemoryWriteDiagnostic): void {
  inMemoryDiagnostics.push({ ...diagnostic, context: { ...diagnostic.context } });
  if (inMemoryDiagnostics.length > MAX_IN_MEMORY_DIAGNOSTICS) inMemoryDiagnostics.shift();
  // 只输出已脱敏的机器字段；不输出原始 Error、实体或 payload。
  console.error('Phase 1 write diagnostic fallback', diagnostic);
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function metadataForEntity(
  store: SyncableStoreName,
  value: unknown,
  operation: WriteOperation,
  attemptedWriteType: AttemptedWriteType,
): WriteDiagnosticContext {
  const record = recordOf(value);
  return sanitizeContext({
    entityType: ENTITY_TYPE[store],
    entityId: typeof record?.id === 'string' ? record.id : undefined,
    operation,
    storageEngine: 'indexedDB',
    objectStore: store,
    attemptedWriteType,
    schemaVersion: Number.isInteger(record?.schemaVersion) ? record?.schemaVersion : undefined,
    sourceAction: 'write',
  });
}

function metadataForEvent(event: unknown): WriteDiagnosticContext {
  const record = recordOf(event);
  const type = record?.type;
  return sanitizeContext({
    entityType: 'Event',
    entityId: typeof record?.id === 'string' ? record.id : undefined,
    operation: 'appendEvent',
    storageEngine: 'indexedDB',
    objectStore: EVENT_STORE,
    attemptedWriteType: 'insertRecord',
    schemaVersion: Number.isInteger(record?.schemaVersion) ? record?.schemaVersion : undefined,
    sourceEventType:
      typeof type === 'string' && (EVENT_TYPES as readonly string[]).includes(type) ? type : undefined,
    sourceAction: 'write',
  });
}

function makeValidationContext(transaction: AtomicDataTransaction): ValidationContext {
  return {
    getTask: (id) => transaction.getIncludingDeleted(STORE.tasks, id),
    hasTaskChildren: async (id) =>
      (await transaction.getAll<{ parentId: string | null }>(STORE.tasks)).some(
        (task) => task.parentId === id,
      ),
    getDayPlan: (id) => transaction.getIncludingDeleted(STORE.dayPlans, id),
    getActiveDayPlanByAppDate: async (appDate) =>
      (await transaction.getAll<SyncableEntityMap['dayPlans']>(STORE.dayPlans)).find(
        (dayPlan) => dayPlan.appDate === appDate,
      ),
    getSession: (id) => transaction.getIncludingDeleted(STORE.sessions, id),
    getEnergyRecord: (id) => transaction.getIncludingDeleted(STORE.energyRecords, id),
    getEvent: (id) => transaction.get(EVENT_STORE, id),
    getUnresolvedInterval: (id) =>
      transaction.getIncludingDeleted(STORE.unresolvedIntervals, id),
    getSettings: (id) => transaction.getIncludingDeleted(STORE.settings, id),
    getActiveSettings: async () =>
      (await transaction.getAll<SyncableEntityMap['settings']>(STORE.settings))[0],
    isRestSuggestionReferenced: async (key) =>
      (
        await transaction.getAllIncludingDeleted<Session>(STORE.sessions)
      ).some((session) => session.suggestedRest === key || session.actualRest === key),
  };
}

async function validateEntity<S extends SyncableStoreName>(
  store: S,
  value: SyncableEntityMap[S],
  context: ValidationContext,
): Promise<void> {
  switch (store) {
    case STORE.tasks:
      await validateTask(value, context);
      return;
    case STORE.dayPlans:
      await validateDayPlan(value, context);
      return;
    case STORE.sessions:
      await validateSession(value, context);
      return;
    case STORE.energyRecords:
      await validateEnergyRecord(value, context);
      return;
    case STORE.unresolvedIntervals:
      await validateUnresolvedInterval(value, context);
      return;
    case STORE.settings:
      await validateSettings(value, context);
  }
}

function validationFailure(error: EntityValidationError, base: WriteDiagnosticContext): AtomicWriteFailure {
  return new AtomicWriteFailure('validation', {
    original: error,
    context: sanitizeContext({
      ...base,
      invariant: error.issues[0]?.code ?? 'write.validation.failed',
      detectedBy: 'writeValidation',
    }),
  });
}

function storageFailure(error: unknown, base: WriteDiagnosticContext): AtomicWriteFailure {
  return new AtomicWriteFailure('storage', { original: error, context: sanitizeContext(base) });
}

async function appendErrorEvent(
  eventType: InMemoryWriteDiagnostic['eventType'],
  errorCode: string,
  context: WriteDiagnosticContext,
  options: ExecuteAtomicWriteOptions,
): Promise<void> {
  const safeContext = sanitizeContext(context);
  try {
    await internalDataStore.runAtomic(STORE_NAMES, async (transaction) => {
      const event = makeEvent({
        now: options.now,
        timezone: options.timezone,
        type: eventType,
        payload: {
          errorCode,
          errorMessage: null,
          context: safeContext as Record<string, unknown>,
        },
        correlationId: transaction.correlationId,
      });
      await validateEvent(event, makeValidationContext(transaction));
      await transaction.appendEvent(event);
    });
  } catch {
    recordFallback({ eventType, errorCode, context: safeContext });
  }
}

/**
 * S12 唯一业务写入口：事务内所有 create/update/softDelete/appendEvent 先校验后写；
 * 校验失败和存储失败在原事务回滚后，分别尽力追加脱敏 error Event。
 */
export async function executeAtomicWrite<T>(
  options: ExecuteAtomicWriteOptions,
  work: (transaction: ValidatedAtomicWriteTransaction) => Promise<T>,
): Promise<T> {
  const declaredStores = new Set(options.storeNames);
  if (declaredStores.size === 0) throw new Error('executeAtomicWrite 至少需要声明一个 store');
  let poisonedFailure: AtomicWriteFailure | undefined;
  const poison = (failure: AtomicWriteFailure): never => {
    poisonedFailure ??= failure;
    throw failure;
  };

  try {
    return await internalDataStore.runAtomic(STORE_NAMES, async (raw) => {
      const assertDeclared = (store: StoreName): void => {
        if (!declaredStores.has(store)) throw new Error(`store ${store} 未在本次写操作中声明`);
      };
      const validationContext = makeValidationContext(raw);
      const transaction: ValidatedAtomicWriteTransaction = {
        correlationId: raw.correlationId,
        get<Value>(store: StoreName, id: string): Promise<Value | undefined> {
          assertDeclared(store);
          return raw.get<Value>(store, id);
        },
        getAll<Value>(store: StoreName): Promise<Value[]> {
          assertDeclared(store);
          return raw.getAll<Value>(store);
        },
        getIncludingDeleted<Value>(
          store: SyncableStoreName,
          id: string,
        ): Promise<Value | undefined> {
          assertDeclared(store);
          return raw.getIncludingDeleted<Value>(store, id);
        },
        getAllIncludingDeleted<Value>(store: SyncableStoreName): Promise<Value[]> {
          assertDeclared(store);
          return raw.getAllIncludingDeleted<Value>(store);
        },
        async put<S extends SyncableStoreName>(
          store: S,
          value: SyncableEntityMap[S],
        ): Promise<void> {
          assertDeclared(store);
          let existing: SyncableEntityMap[S] | undefined;
          try {
            existing = await raw.getIncludingDeleted<SyncableEntityMap[S]>(store, value.id);
          } catch (error) {
            return poison(
              storageFailure(error, metadataForEntity(store, value, 'update', 'updateField')),
            );
          }
          const metadata = metadataForEntity(
            store,
            value,
            existing === undefined ? 'create' : 'update',
            existing === undefined ? 'insertRecord' : 'updateField',
          );
          try {
            await validateEntity(store, value, validationContext);
          } catch (error) {
            if (error instanceof EntityValidationError) poison(validationFailure(error, metadata));
            if (isStorageError(error)) poison(storageFailure(error, metadata));
            throw error;
          }
          try {
            await raw.put(store, value);
          } catch (error) {
            return poison(storageFailure(error, metadata));
          }
        },
        async appendEvent(event: Event): Promise<void> {
          assertDeclared(EVENT_STORE);
          const metadata = metadataForEvent(event);
          try {
            await validateEvent(event, validationContext);
          } catch (error) {
            if (error instanceof EntityValidationError) poison(validationFailure(error, metadata));
            if (isStorageError(error)) poison(storageFailure(error, metadata));
            throw error;
          }
          try {
            await raw.appendEvent(event);
          } catch (error) {
            return poison(storageFailure(error, metadata));
          }
        },
        async softDelete<S extends SyncableStoreName>(
          store: S,
          id: string,
          deletedAt: IsoDateTime,
          ...softDeleteOptions: S extends typeof STORE.tasks
            ? [options?: TaskSoftDeleteOptions]
            : []
        ): Promise<SyncableEntityMap[S]> {
          assertDeclared(store);
          let existing: SyncableEntityMap[S] | undefined;
          try {
            existing = await raw.getIncludingDeleted<SyncableEntityMap[S]>(store, id);
          } catch (error) {
            return poison(
              storageFailure(
                error,
                metadataForEntity(store, { id }, 'softDelete', 'updateField'),
              ),
            );
          }
          const metadata = metadataForEntity(store, existing ?? { id }, 'softDelete', 'updateField');
          if (!existing) throw new Error(`无法软删除不存在的 ${store} 记录 ${id}`);
          let tombstone: SyncableEntityMap[S];
          try {
            tombstone = buildSoftDeleteTombstone(
              store,
              existing,
              deletedAt,
              ...softDeleteOptions,
            );
            await validateEntity(store, tombstone, validationContext);
          } catch (error) {
            if (error instanceof EntityValidationError) poison(validationFailure(error, metadata));
            if (isStorageError(error)) poison(storageFailure(error, metadata));
            throw error;
          }
          try {
            await raw.put(store, tombstone);
            return tombstone;
          } catch (error) {
            return poison(storageFailure(error, metadata));
          }
        },
      };

      let result: T;
      try {
        result = await work(transaction);
      } catch (error) {
        if (error instanceof AtomicWriteFailure) throw error;
        throw new AtomicWorkCallbackFailure(error);
      }
      if (poisonedFailure) throw poisonedFailure;
      return result;
    });
  } catch (error) {
    if (error instanceof AtomicWorkCallbackFailure) throw error.original;
    if (error instanceof AtomicWriteFailure) {
      const baseContext = sanitizeContext({
        ...options.diagnosticContext,
        ...error.metadata.context,
      });
      if (error.kind === 'validation') {
        await appendErrorEvent(
          'error.unexpectedState',
          'ERR_WRITE_VALIDATION',
          baseContext,
          options,
        );
      } else {
        await appendErrorEvent(
          'error.dataWriteFailed',
          'ERR_DATA_WRITE_FAILED',
          baseContext,
          options,
        );
      }
      throw error.metadata.original;
    }
    await appendErrorEvent(
      'error.dataWriteFailed',
      'ERR_DATA_WRITE_FAILED',
      sanitizeContext({
        entityType: 'AtomicWrite',
        storageEngine: 'indexedDB',
        sourceAction: 'write',
        ...options.diagnosticContext,
      }),
      options,
    );
    throw error;
  }
}
