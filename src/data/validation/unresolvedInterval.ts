import type { UnresolvedInterval } from '../schema';
import type { ValidationContext } from './context';
import {
  EntityValidationError,
  SYNCABLE_BASE_KEYS,
  ValidationCollector,
  requireRecord,
  validateExactKeys,
  validateIsoDateTime,
  validateStoredLocalDate,
  validateSyncableBase,
  type ValidationIssue,
} from './primitives';

const INTERVAL_KEYS = [
  ...SYNCABLE_BASE_KEYS,
  'timezone',
  'localDate',
  'source',
  'startedAt',
  'endedAt',
  'status',
  'classifiedAt',
  'ignoredAt',
  'ignoreReason',
] as const;
const SOURCES = new Set(['appReopened', 'systemRecovered', 'timerStateLost', 'userNoResponse']);
const STATUSES = new Set(['pending', 'classified', 'ignored']);

export async function collectUnresolvedIntervalValidationIssues(
  value: unknown,
  context?: ValidationContext,
): Promise<readonly ValidationIssue[]> {
  const collector = new ValidationCollector();
  const interval = requireRecord(value, 'UnresolvedInterval', collector);
  if (!interval) return collector.issues;
  validateExactKeys(interval, INTERVAL_KEYS, 'UnresolvedInterval', collector);
  validateSyncableBase(interval, collector);
  collector.check(typeof interval.source === 'string' && SOURCES.has(interval.source), 'interval.source', 'source', '非法 interval source');
  const validStart = validateIsoDateTime(interval.startedAt, 'startedAt', collector);
  const validEnd = validateIsoDateTime(interval.endedAt, 'endedAt', collector);
  collector.check(typeof interval.status === 'string' && STATUSES.has(interval.status), 'interval.status', 'status', '非法 interval status');
  validateIsoDateTime(interval.classifiedAt, 'classifiedAt', collector, true);
  validateIsoDateTime(interval.ignoredAt, 'ignoredAt', collector, true);
  collector.check(interval.ignoreReason === null || typeof interval.ignoreReason === 'string', 'type.stringOrNull', 'ignoreReason', '必须为 string 或 null');
  validateStoredLocalDate(interval.localDate, interval.startedAt, interval.timezone, collector);
  if (
    validStart &&
    validEnd &&
    typeof interval.startedAt === 'string' &&
    typeof interval.endedAt === 'string'
  ) {
    collector.check(
      Date.parse(interval.endedAt) > Date.parse(interval.startedAt),
      'interval.time.order',
      'endedAt',
      '必须晚于 startedAt',
    );
  }

  if (interval.status === 'classified') {
    collector.check(interval.classifiedAt !== null, 'interval.classifiedAt.required', 'classifiedAt', 'classified 必须非 null');
    collector.check(interval.ignoredAt === null, 'interval.ignoredAt.state', 'ignoredAt', 'classified 必须为 null');
    collector.check(interval.ignoreReason === null, 'interval.ignoreReason.state', 'ignoreReason', 'classified 必须为 null');
  } else if (interval.status === 'ignored') {
    collector.check(interval.ignoredAt !== null, 'interval.ignoredAt.required', 'ignoredAt', 'ignored 必须非 null');
    collector.check(interval.classifiedAt === null, 'interval.classifiedAt.state', 'classifiedAt', 'ignored 必须为 null');
    collector.check(interval.deletedAt === null, 'interval.ignored.audit', 'deletedAt', 'ignored 记录必须保留为有效审计记录');
  } else if (interval.status === 'pending') {
    collector.check(interval.classifiedAt === null, 'interval.classifiedAt.state', 'classifiedAt', 'pending 必须为 null');
    collector.check(interval.ignoredAt === null, 'interval.ignoredAt.state', 'ignoredAt', 'pending 必须为 null');
    collector.check(interval.ignoreReason === null, 'interval.ignoreReason.state', 'ignoreReason', 'pending 必须为 null');
  }

  if (typeof interval.id === 'string') {
    if (context?.getUnresolvedInterval) {
      const previous = await context.getUnresolvedInterval(interval.id);
      if (previous) {
        for (const field of ['source', 'startedAt', 'endedAt', 'timezone', 'localDate'] as const) {
          collector.check(interval[field] === previous[field], `interval.${field}.immutable`, field, '创建事实不可修改');
        }
      }
    } else {
      collector.add('validation.context.required', 'UnresolvedInterval.id', '校验创建事实需要事务查询上下文');
    }
  }
  return collector.issues;
}

export async function validateUnresolvedInterval(
  value: unknown,
  context?: ValidationContext,
): Promise<UnresolvedInterval> {
  const issues = await collectUnresolvedIntervalValidationIssues(value, context);
  if (issues.length > 0) throw new EntityValidationError('UnresolvedInterval', issues);
  return value as UnresolvedInterval;
}
