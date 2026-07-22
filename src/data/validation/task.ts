import type { Task } from '../schema';
import type { ValidationContext } from './context';
import {
  EntityValidationError,
  SYNCABLE_BASE_KEYS,
  ValidationCollector,
  isRecord,
  requireRecord,
  validateAllowedKeys,
  validateExactKeys,
  validateInteger,
  validateIsoDateTime,
  validateSyncableBase,
  validateUuidV7,
} from './primitives';

const TASK_KEYS = [
  ...SYNCABLE_BASE_KEYS,
  'parentId',
  'title',
  'status',
  'outcome',
  'completionSource',
  'estimatedPomodoros',
  'estimateRounds',
  'actualWorkNote',
  'note',
  'sortIndex',
  'completedAt',
  'archivedAt',
  'deletedReason',
  'metadata',
  'lineageId',
  'splitFromTaskId',
  'splitIndex',
] as const;

const TASK_STATUS = new Set(['active', 'completed', 'splitNeeded', 'archived', 'deleted']);
const OUTCOMES = new Set(['completed', 'split']);
const COMPLETION_SOURCES = new Set(['pomodoro', 'manual']);
const DELETED_REASONS = new Set(['userDeleted', 'triageDismissed', 'dataCleanup']);

function optionalStringOrNull(
  value: unknown,
  path: string,
  collector: ValidationCollector,
): void {
  collector.check(value === null || typeof value === 'string', 'type.stringOrNull', path, '必须为 string 或 null');
}

function validateMetadata(value: unknown, collector: ValidationCollector): void {
  const metadata = requireRecord(value, 'metadata', collector);
  if (!metadata) return;
  validateAllowedKeys(metadata, ['triageStatus', 'color', 'tags', 'templateKey', 'source'], 'metadata', collector);
  if ('triageStatus' in metadata) {
    collector.check(
      metadata.triageStatus === null || metadata.triageStatus === 'pending',
      'task.metadata.triageStatus',
      'metadata.triageStatus',
      "只允许 'pending' 或 null",
    );
  }
  for (const key of ['color', 'templateKey', 'source'] as const) {
    if (key in metadata) {
      collector.check(typeof metadata[key] === 'string', 'type.string', `metadata.${key}`, '必须为 string');
    }
  }
  if ('tags' in metadata) {
    collector.check(
      Array.isArray(metadata.tags) && metadata.tags.every((tag) => typeof tag === 'string'),
      'task.metadata.tags',
      'metadata.tags',
      '必须为 string[]',
    );
  }
}

function validateEstimateRounds(value: unknown, collector: ValidationCollector): number | undefined {
  if (!Array.isArray(value)) {
    collector.add('type.array', 'estimateRounds', '必须为数组');
    return undefined;
  }
  collector.check(value.length >= 1 && value.length <= 3, 'task.estimateRounds.count', 'estimateRounds', '新写入必须含 1–3 轮');
  const seen = new Set<number>();
  value.forEach((item, index) => {
    const path = `estimateRounds[${index}]`;
    const round = requireRecord(item, path, collector);
    if (!round) return;
    validateExactKeys(round, ['index', 'pomodoros', 'occurredAt'], path, collector);
    if (validateInteger(round.index, `${path}.index`, collector, 1, 3)) {
      collector.check(!seen.has(round.index), 'task.estimateRounds.duplicateIndex', `${path}.index`, '轮次不得重复');
      collector.check(round.index === index + 1, 'task.estimateRounds.sequence', `${path}.index`, '轮次必须从 1 连续递增');
      seen.add(round.index);
    }
    validateInteger(round.pomodoros, `${path}.pomodoros`, collector, 1, 7);
    validateIsoDateTime(round.occurredAt, `${path}.occurredAt`, collector);
  });
  const latest = value.at(-1);
  return isRecord(latest) && typeof latest.pomodoros === 'number' ? latest.pomodoros : undefined;
}

export async function collectTaskValidationIssues(
  value: unknown,
  context?: ValidationContext,
): Promise<readonly import('./primitives').ValidationIssue[]> {
  const collector = new ValidationCollector();
  const task = requireRecord(value, 'Task', collector);
  if (!task) return collector.issues;
  validateExactKeys(task, TASK_KEYS, 'Task', collector);
  validateSyncableBase(task, collector);

  validateUuidV7(task.parentId, 'parentId', collector, true);
  collector.check(
    typeof task.title === 'string' && task.title.trim().length > 0 && task.title.length <= 200,
    'task.title',
    'title',
    '必须为 1–200 字符的非空标题',
  );
  collector.check(typeof task.status === 'string' && TASK_STATUS.has(task.status), 'task.status', 'status', '非法任务状态');
  collector.check(task.outcome === null || (typeof task.outcome === 'string' && OUTCOMES.has(task.outcome)), 'task.outcome', 'outcome', '非法归档结果');
  collector.check(
    task.completionSource === null ||
      (typeof task.completionSource === 'string' && COMPLETION_SOURCES.has(task.completionSource)),
    'task.completionSource',
    'completionSource',
    '非法完成来源',
  );
  validateInteger(task.estimatedPomodoros, 'estimatedPomodoros', collector, 1, 7);
  const latestEstimate = validateEstimateRounds(task.estimateRounds, collector);
  if (latestEstimate !== undefined && typeof task.estimatedPomodoros === 'number') {
    collector.check(
      task.estimatedPomodoros === latestEstimate,
      'task.estimate.current',
      'estimatedPomodoros',
      '必须等于 estimateRounds 最新一轮的总预估',
    );
  }
  optionalStringOrNull(task.actualWorkNote, 'actualWorkNote', collector);
  optionalStringOrNull(task.note, 'note', collector);
  validateInteger(task.sortIndex, 'sortIndex', collector, 0);
  validateIsoDateTime(task.completedAt, 'completedAt', collector, true);
  validateIsoDateTime(task.archivedAt, 'archivedAt', collector, true);
  collector.check(
    task.deletedReason === null ||
      (typeof task.deletedReason === 'string' && DELETED_REASONS.has(task.deletedReason)),
    'task.deletedReason',
    'deletedReason',
    '非法删除原因',
  );
  validateMetadata(task.metadata, collector);
  validateUuidV7(task.lineageId, 'lineageId', collector);
  validateUuidV7(task.splitFromTaskId, 'splitFromTaskId', collector, true);
  validateInteger(task.splitIndex, 'splitIndex', collector, 0);

  const requiresCompletionFacts =
    task.status === 'completed' || (task.status === 'archived' && task.outcome === 'completed');
  if (requiresCompletionFacts) {
    collector.check(task.completedAt !== null, 'task.completedAt.required', 'completedAt', '完成状态必须保留完成时间');
    collector.check(task.completionSource !== null, 'task.completionSource.required', 'completionSource', '完成状态必须保留完成来源');
  } else {
    collector.check(task.completedAt === null, 'task.completedAt.state', 'completedAt', '非完成状态必须为 null');
    collector.check(task.completionSource === null, 'task.completionSource.state', 'completionSource', '非完成状态必须为 null');
  }
  if (task.status === 'archived') {
    collector.check(task.archivedAt !== null, 'task.archivedAt.required', 'archivedAt', 'archived 状态必须非 null');
    collector.check(task.outcome !== null, 'task.outcome.required', 'outcome', 'archived 状态必须非 null');
  } else {
    collector.check(task.archivedAt === null, 'task.archivedAt.state', 'archivedAt', '非 archived 状态必须为 null');
    collector.check(task.outcome === null, 'task.outcome.state', 'outcome', '非 archived 状态必须为 null');
  }
  if (task.status === 'deleted') {
    collector.check(task.deletedAt !== null, 'task.deletedAt.required', 'deletedAt', 'deleted 状态必须非 null');
  } else {
    collector.check(task.deletedAt === null, 'task.deletedAt.state', 'deletedAt', '非 deleted 状态必须为 null');
    collector.check(task.deletedReason === null, 'task.deletedReason.state', 'deletedReason', '非 deleted 状态必须为 null');
  }
  if (task.splitFromTaskId === null) {
    collector.check(task.splitIndex === 0, 'task.splitIndex.original', 'splitIndex', '原始任务必须为 0');
  } else {
    collector.check(typeof task.splitIndex === 'number' && task.splitIndex >= 1, 'task.splitIndex.child', 'splitIndex', '拆分子任务必须 ≥ 1');
  }

  if (typeof task.parentId === 'string' && context?.getTask) {
    const parent = await context.getTask(task.parentId);
    collector.check(parent !== undefined, 'task.parent.missing', 'parentId', '引用的父 Task 不存在');
    if (parent) {
      collector.check(parent.parentId === null, 'task.parent.depth', 'parentId', 'Task 层级不得超过两层');
    }
  }
  if (typeof task.parentId === 'string' && !context?.getTask) {
    collector.add('validation.context.required', 'parentId', '校验父 Task 引用需要事务查询上下文');
  }
  if (typeof task.id === 'string' && task.parentId !== null) {
    if (context?.hasTaskChildren) {
      collector.check(!(await context.hasTaskChildren(task.id)), 'task.child.depth', 'parentId', '已有子任务的 Task 不能再成为子任务');
    } else {
      collector.add('validation.context.required', 'parentId', '校验两层上限需要事务查询上下文');
    }
  }
  if (typeof task.splitFromTaskId === 'string') {
    if (context?.getTask) {
      const source = await context.getTask(task.splitFromTaskId);
      collector.check(source !== undefined, 'task.splitFrom.missing', 'splitFromTaskId', '引用的来源 Task 不存在');
      if (source) {
        collector.check(
          task.lineageId === source.lineageId,
          'task.lineage.source',
          'lineageId',
          '拆分任务必须继承来源 Task 的 lineageId',
        );
      }
    } else {
      collector.add('validation.context.required', 'splitFromTaskId', '校验来源 Task 引用需要事务查询上下文');
    }
  } else if (typeof task.id === 'string') {
    collector.check(task.lineageId === task.id, 'task.lineage.original', 'lineageId', '原始任务 lineageId 必须等于自身 id');
  }

  return collector.issues;
}

export async function validateTask(value: unknown, context?: ValidationContext): Promise<Task> {
  const issues = await collectTaskValidationIssues(value, context);
  if (issues.length > 0) throw new EntityValidationError('Task', issues);
  return value as Task;
}
