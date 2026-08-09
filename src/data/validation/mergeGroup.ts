import type { MergeGroup } from '../schema';
import type { ValidationContext } from './context';
import {
  EntityValidationError,
  SYNCABLE_BASE_KEYS,
  ValidationCollector,
  isRecord,
  requireRecord,
  validateExactKeys,
  validateInteger,
  validateIsoDateTime,
  validateSyncableBase,
  validateUuidV7,
  type SyncWriteMode,
  type ValidationIssue,
} from './primitives';

const MERGE_GROUP_KEYS = [
  ...SYNCABLE_BASE_KEYS,
  'taskIds',
  'estimatedPomodoros',
  'estimateRounds',
  'status',
  'dissolvedAt',
  'dissolvedReason',
] as const;

const STATUSES = new Set(['active', 'limitReached', 'dissolved']);
const DISSOLVED_REASONS = new Set(['membersBelowMinimum', 'manualDissolved']);

/**
 * 成员列表校验（§3.8 字段表 + 字段一致性约束 6）。
 * 长度下限按 status 分流：active / limitReached 必须 ≥ 2，dissolved 不作下限要求
 * （解散那一刻成员归属已清空，历史记录保留即可）。
 */
function validateTaskIds(value: unknown, collector: ValidationCollector): void {
  if (!Array.isArray(value)) {
    collector.add('type.array', 'taskIds', '必须为数组');
    return;
  }
  value.forEach((taskId, index) => validateUuidV7(taskId, `taskIds[${index}]`, collector));
  collector.check(
    new Set(value).size === value.length,
    'mergeGroup.taskIds.duplicate',
    'taskIds',
    '成员不得重复',
  );
}

/**
 * 预估轮次校验（§3.8 字段一致性约束 5，结构与 §3.1 Task.estimateRounds 完全一致）。
 * 返回最新一轮的总预估，供与 `estimatedPomodoros` 对齐。
 */
function validateEstimateRounds(value: unknown, collector: ValidationCollector): number | undefined {
  if (!Array.isArray(value)) {
    collector.add('type.array', 'estimateRounds', '必须为数组');
    return undefined;
  }
  collector.check(
    value.length >= 1 && value.length <= 3,
    'mergeGroup.estimateRounds.count',
    'estimateRounds',
    '必须含 1–3 轮',
  );
  value.forEach((item, index) => {
    const path = `estimateRounds[${index}]`;
    const round = requireRecord(item, path, collector);
    if (!round) return;
    validateExactKeys(round, ['index', 'pomodoros', 'occurredAt'], path, collector);
    if (validateInteger(round.index, `${path}.index`, collector, 1, 3)) {
      collector.check(
        round.index === index + 1,
        'mergeGroup.estimateRounds.sequence',
        `${path}.index`,
        '轮次必须从 1 连续递增',
      );
    }
    validateInteger(round.pomodoros, `${path}.pomodoros`, collector, 1, 7);
    validateIsoDateTime(round.occurredAt, `${path}.occurredAt`, collector);
  });
  const latest = value.at(-1);
  return isRecord(latest) && typeof latest.pomodoros === 'number' ? latest.pomodoros : undefined;
}

/**
 * 成员引用校验：taskIds 里每个 id 必须能查到 Task，且该 Task 的 `mergeGroupId`
 * 必须回指本组（§3.1 mergeGroupId 取值约束的另一半，双向一致）。
 * 唯一的例外是 `dissolved`：解散时成员归属已清空，此时不要求回指。
 */
async function validateMemberReferences(
  group: Record<string, unknown>,
  context: ValidationContext | undefined,
  collector: ValidationCollector,
): Promise<void> {
  if (!Array.isArray(group.taskIds) || group.taskIds.length === 0) return;
  if (!context?.getTask) {
    collector.add('validation.context.required', 'taskIds', '校验成员 Task 引用需要事务查询上下文');
    return;
  }
  for (const [index, taskId] of group.taskIds.entries()) {
    if (typeof taskId !== 'string') continue;
    const task = await context.getTask(taskId);
    collector.check(
      task !== undefined,
      'mergeGroup.task.missing',
      `taskIds[${index}]`,
      '引用的成员 Task 不存在',
    );
  }
}

export async function collectMergeGroupValidationIssues(
  value: unknown,
  context?: ValidationContext,
  mode: SyncWriteMode = 'local',
): Promise<readonly ValidationIssue[]> {
  const collector = new ValidationCollector();
  const group = requireRecord(value, 'MergeGroup', collector);
  if (!group) return collector.issues;
  validateExactKeys(group, MERGE_GROUP_KEYS, 'MergeGroup', collector);
  validateSyncableBase(group, collector, mode);

  validateTaskIds(group.taskIds, collector);
  validateInteger(group.estimatedPomodoros, 'estimatedPomodoros', collector, 1, 7);
  const latestEstimate = validateEstimateRounds(group.estimateRounds, collector);
  if (latestEstimate !== undefined && typeof group.estimatedPomodoros === 'number') {
    collector.check(
      group.estimatedPomodoros === latestEstimate,
      'mergeGroup.estimate.current',
      'estimatedPomodoros',
      '必须等于 estimateRounds 最新一轮的总预估',
    );
  }
  collector.check(
    typeof group.status === 'string' && STATUSES.has(group.status),
    'mergeGroup.status',
    'status',
    '非法合并组状态',
  );
  validateIsoDateTime(group.dissolvedAt, 'dissolvedAt', collector, true);
  collector.check(
    group.dissolvedReason === null ||
      (typeof group.dissolvedReason === 'string' && DISSOLVED_REASONS.has(group.dissolvedReason)),
    'mergeGroup.dissolvedReason',
    'dissolvedReason',
    '非法解散原因',
  );

  // §3.8 字段一致性约束 1/2：解散态与在用态的字段组合互斥。
  if (group.status === 'dissolved') {
    collector.check(
      group.dissolvedAt !== null,
      'mergeGroup.dissolvedAt.required',
      'dissolvedAt',
      'dissolved 必须记录解散时间',
    );
    collector.check(
      group.dissolvedReason !== null,
      'mergeGroup.dissolvedReason.required',
      'dissolvedReason',
      'dissolved 必须记录解散原因',
    );
  } else {
    collector.check(
      Array.isArray(group.taskIds) && group.taskIds.length >= 2,
      'mergeGroup.taskIds.minimum',
      'taskIds',
      '在用的合并组至少要有 2 个成员',
    );
    collector.check(
      group.dissolvedAt === null,
      'mergeGroup.dissolvedAt.state',
      'dissolvedAt',
      '未解散时必须为 null',
    );
    collector.check(
      group.dissolvedReason === null,
      'mergeGroup.dissolvedReason.state',
      'dissolvedReason',
      '未解散时必须为 null',
    );
  }

  await validateMemberReferences(group, context, collector);
  return collector.issues;
}

export async function validateMergeGroup(
  value: unknown,
  context?: ValidationContext,
  mode: SyncWriteMode = 'local',
): Promise<MergeGroup> {
  const issues = await collectMergeGroupValidationIssues(value, context, mode);
  if (issues.length > 0) throw new EntityValidationError('MergeGroup', issues);
  return value as MergeGroup;
}
