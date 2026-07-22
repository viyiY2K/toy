import type { EnergyRecord } from '../schema';
import type { ValidationContext } from './context';
import {
  EntityValidationError,
  SYNCABLE_BASE_KEYS,
  ValidationCollector,
  requireRecord,
  validateExactKeys,
  validateInteger,
  validateIsoDateTime,
  validateStoredLocalDate,
  validateSyncableBase,
  validateUuidV7,
  type ValidationIssue,
} from './primitives';

const ENERGY_RECORD_KEYS = [
  ...SYNCABLE_BASE_KEYS,
  'timezone',
  'localDate',
  'energyLevel',
  'mood',
  'source',
  'sessionId',
  'note',
  'occurredAt',
] as const;

const SOURCE_SESSION_TYPE = {
  afterFocus: 'focus',
  afterShortBreak: 'shortBreak',
  afterLongBreak: 'longBreak',
  afterExtraFocus: 'extraFocus',
  afterExtraRest: 'extraRest',
} as const;
const STANDALONE_SOURCES = new Set(['dayStart', 'beforeFocus', 'onReturn', 'manual']);
const SOURCES = new Set([...STANDALONE_SOURCES, ...Object.keys(SOURCE_SESSION_TYPE)]);

export async function collectEnergyRecordValidationIssues(
  value: unknown,
  context?: ValidationContext,
): Promise<readonly ValidationIssue[]> {
  const collector = new ValidationCollector();
  const record = requireRecord(value, 'EnergyRecord', collector);
  if (!record) return collector.issues;
  validateExactKeys(record, ENERGY_RECORD_KEYS, 'EnergyRecord', collector);
  validateSyncableBase(record, collector);
  validateInteger(record.energyLevel, 'energyLevel', collector, 1, 10);
  if (record.mood !== null) validateInteger(record.mood, 'mood', collector, 1, 10);
  collector.check(typeof record.source === 'string' && SOURCES.has(record.source), 'energy.source', 'source', '非法 EnergyRecord source');
  validateUuidV7(record.sessionId, 'sessionId', collector, true);
  collector.check(record.note === null || typeof record.note === 'string', 'type.stringOrNull', 'note', '必须为 string 或 null');
  validateIsoDateTime(record.occurredAt, 'occurredAt', collector);
  validateStoredLocalDate(record.localDate, record.occurredAt, record.timezone, collector);

  if (typeof record.source === 'string' && STANDALONE_SOURCES.has(record.source)) {
    collector.check(record.sessionId === null, 'energy.session.notApplicable', 'sessionId', '该 source 必须为 null');
  } else if (typeof record.source === 'string' && record.source in SOURCE_SESSION_TYPE) {
    collector.check(record.sessionId !== null, 'energy.session.required', 'sessionId', '该 source 必须关联 Session');
    if (typeof record.sessionId === 'string') {
      if (context?.getSession) {
        const session = await context.getSession(record.sessionId);
        const expectedType = SOURCE_SESSION_TYPE[record.source as keyof typeof SOURCE_SESSION_TYPE];
        collector.check(session?.type === expectedType, 'energy.session.type', 'sessionId', `必须引用 ${expectedType} Session`);
      } else {
        collector.add('validation.context.required', 'sessionId', '校验 Session 引用需要事务查询上下文');
      }
    }
  }

  if (typeof record.id === 'string') {
    if (context?.getEnergyRecord) {
      const previous = await context.getEnergyRecord(record.id);
      if (previous) {
        for (const field of ['timezone', 'localDate', 'occurredAt'] as const) {
          collector.check(record[field] === previous[field], `energy.${field}.immutable`, field, '创建事实不可修改');
        }
      }
    } else {
      collector.add('validation.context.required', 'EnergyRecord.id', '校验创建事实需要事务查询上下文');
    }
  }
  return collector.issues;
}

export async function validateEnergyRecord(
  value: unknown,
  context?: ValidationContext,
): Promise<EnergyRecord> {
  const issues = await collectEnergyRecordValidationIssues(value, context);
  if (issues.length > 0) throw new EntityValidationError('EnergyRecord', issues);
  return value as EnergyRecord;
}
