import { describe, expect, it } from 'vitest';
import { makeMergeGroup, makeTask, type MergeGroup, type Task } from '../schema';
import type { ValidationContext } from './context';
import { collectMergeGroupValidationIssues, validateMergeGroup } from './mergeGroup';

const NOW = '2026-06-05T14:37:12+08:00';

const memberA = makeTask({ now: NOW, title: '回复 Slack 消息' });
const memberB = makeTask({ now: NOW, title: '订咖啡豆' });

function context(tasks: Task[] = [memberA, memberB]): ValidationContext {
  return { getTask: async (id) => tasks.find((task) => task.id === id) };
}

function group(overrides: Partial<MergeGroup> = {}): MergeGroup {
  return { ...makeMergeGroup({ now: NOW, taskIds: [memberA.id, memberB.id] }), ...overrides };
}

async function expectCode(value: unknown, code: string, ctx = context()): Promise<void> {
  const issues = await collectMergeGroupValidationIssues(value, ctx);
  expect(issues.map((issue) => issue.code)).toContain(code);
}

describe('validateMergeGroup（v4.1 §3.8）', () => {
  it('接受一个刚创建的合并组：2 个成员、预估 1、首轮 estimateRounds', async () => {
    const created = group();
    expect(created.estimateRounds).toEqual([{ index: 1, pomodoros: 1, occurredAt: NOW }]);
    await expect(validateMergeGroup(created, context())).resolves.toBe(created);
  });

  it('字段一致性约束 1：active / limitReached 至少 2 个成员', async () => {
    await expectCode(group({ taskIds: [memberA.id] }), 'mergeGroup.taskIds.minimum');
    await expectCode(
      group({ status: 'limitReached', taskIds: [memberA.id] }),
      'mergeGroup.taskIds.minimum',
    );
  });

  it('字段一致性约束 6：成员不得重复', async () => {
    await expectCode(group({ taskIds: [memberA.id, memberA.id] }), 'mergeGroup.taskIds.duplicate');
  });

  it('字段一致性约束 1/2：解散态与在用态的字段组合互斥', async () => {
    await expectCode(group({ status: 'dissolved' }), 'mergeGroup.dissolvedAt.required');
    await expectCode(group({ status: 'dissolved', dissolvedAt: NOW }), 'mergeGroup.dissolvedReason.required');
    await expectCode(group({ dissolvedAt: NOW }), 'mergeGroup.dissolvedAt.state');
    await expectCode(group({ dissolvedReason: 'manualDissolved' }), 'mergeGroup.dissolvedReason.state');

    const dissolved = group({
      status: 'dissolved',
      taskIds: [],
      dissolvedAt: NOW,
      dissolvedReason: 'membersBelowMinimum',
    });
    await expect(validateMergeGroup(dissolved, context())).resolves.toBe(dissolved);
  });

  it('字段一致性约束 4/5：预估 1–7、最多三轮，且必须等于最新一轮', async () => {
    await expectCode(
      group({ estimatedPomodoros: 8, estimateRounds: [{ index: 1, pomodoros: 8, occurredAt: NOW }] }),
      'number.max',
    );
    await expectCode(
      group({
        estimatedPomodoros: 2,
        estimateRounds: [
          { index: 1, pomodoros: 1, occurredAt: NOW },
          { index: 2, pomodoros: 2, occurredAt: NOW },
          { index: 3, pomodoros: 3, occurredAt: NOW },
          { index: 3, pomodoros: 4, occurredAt: NOW },
        ],
      }),
      'mergeGroup.estimateRounds.count',
    );
    await expectCode(group({ estimatedPomodoros: 3 }), 'mergeGroup.estimate.current');
  });

  it('status 与 dissolvedReason 只接受 §3.8 的枚举值', async () => {
    await expectCode(group({ status: 'paused' as MergeGroup['status'] }), 'mergeGroup.status');
    await expectCode(
      group({
        status: 'dissolved',
        dissolvedAt: NOW,
        dissolvedReason: 'expired' as MergeGroup['dissolvedReason'],
      }),
      'mergeGroup.dissolvedReason',
    );
  });

  it('成员必须能查到对应 Task；查不到即悬空引用', async () => {
    await expectCode(group(), 'mergeGroup.task.missing', context([memberA]));
  });

  it('拒绝 schema 未定义的额外字段', async () => {
    await expectCode({ ...group(), sortIndex: 1000 }, 'field.extra');
  });
});
