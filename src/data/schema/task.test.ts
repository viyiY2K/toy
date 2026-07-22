import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION } from '../schemaVersion';
import { makeTask } from './task';

const NOW = '2026-06-05T14:37:12+08:00';

const ALL_TASK_KEYS = [
  // 同步预留基字段（§2.3）
  'id',
  'createdAt',
  'updatedAt',
  'schemaVersion',
  'deletedAt',
  'deviceId',
  'syncedAt',
  // Task 专属（§3.1）
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
].sort();

describe('makeTask (S5b, §3.1)', () => {
  it('产出含 Task 全部字段键（含同步预留）', () => {
    const t = makeTask({ now: NOW, title: '写计划' });
    expect(Object.keys(t).sort()).toEqual(ALL_TASK_KEYS);
  });

  it('Task 不带 timezone / localDate（§3.1 字段表无此两行）', () => {
    const t = makeTask({ now: NOW, title: 'x' });
    expect('timezone' in t).toBe(false);
    expect('localDate' in t).toBe(false);
  });

  it('默认值逐项对齐 v4', () => {
    const t = makeTask({ now: NOW, title: 'x' });
    expect(t.status).toBe('active');
    expect(t.estimatedPomodoros).toBe(1);
    expect(t.sortIndex).toBe(1000);
    expect(t.splitIndex).toBe(0);
    expect(t.metadata).toEqual({});
    expect(t.parentId).toBeNull();
    expect(t.outcome).toBeNull();
    expect(t.completionSource).toBeNull();
    expect(t.completedAt).toBeNull();
    expect(t.archivedAt).toBeNull();
    expect(t.deletedReason).toBeNull();
    expect(t.note).toBeNull();
    expect(t.actualWorkNote).toBeNull();
    expect(t.splitFromTaskId).toBeNull();
    // 同步预留（§2.3）
    expect(t.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(t.deletedAt).toBeNull();
    expect(t.deviceId).toBeNull();
    expect(t.syncedAt).toBeNull();
    expect(t.createdAt).toBe(NOW);
    expect(t.updatedAt).toBe(NOW);
  });

  it('lineageId 默认等于自身 id（§3.1 新建时 = task.id）', () => {
    const t = makeTask({ now: NOW, title: 'x' });
    expect(t.lineageId).toBe(t.id);
  });

  it('estimateRounds 默认写入首轮 index=1（§3.1 规则 9/11）', () => {
    const t = makeTask({ now: NOW, title: 'x', estimatedPomodoros: 3 });
    expect(t.estimateRounds).toEqual([{ index: 1, pomodoros: 3, occurredAt: NOW }]);
  });

  it('estimateRounds 默认轮次 pomodoros 跟随 estimatedPomodoros（默认 1）', () => {
    const t = makeTask({ now: NOW, title: 'x' });
    expect(t.estimateRounds).toEqual([{ index: 1, pomodoros: 1, occurredAt: NOW }]);
  });

  it('覆盖入口生效：id / lineageId / estimateRounds', () => {
    const rounds = [
      { index: 1 as const, pomodoros: 2, occurredAt: NOW },
      { index: 2 as const, pomodoros: 4, occurredAt: NOW },
    ];
    const t = makeTask({
      id: 'fixed-id',
      now: NOW,
      title: 'x',
      lineageId: 'lineage-1',
      estimateRounds: rounds,
    });
    expect(t.id).toBe('fixed-id');
    expect(t.lineageId).toBe('lineage-1');
    expect(t.estimateRounds).toEqual(rounds);
  });
});
