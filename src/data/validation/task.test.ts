import { describe, expect, it } from 'vitest';
import { makeTask, type Task } from '../schema';
import { newId } from '../id';
import { collectTaskValidationIssues, validateTask } from './task';

const NOW = '2026-06-05T14:37:12+08:00';

function validTask(overrides: Partial<Task> = {}): Task {
  return { ...makeTask({ now: NOW, title: '写计划' }), ...overrides };
}

async function expectCode(value: unknown, code: string): Promise<void> {
  const issues = await collectTaskValidationIssues(value);
  expect(issues.map((issue) => issue.code)).toContain(code);
}

describe('validateTask (S6a, v4 §3.1)', () => {
  it('accepts active, completed, completed-archive, split-archive, and deleted states', async () => {
    const completed = validTask({ status: 'completed', completedAt: NOW, completionSource: 'manual' });
    const completedArchive = validTask({
      status: 'archived',
      outcome: 'completed',
      archivedAt: NOW,
      completedAt: NOW,
      completionSource: 'pomodoro',
    });
    const splitArchive = validTask({ status: 'archived', outcome: 'split', archivedAt: NOW });
    const deleted = validTask({ status: 'deleted', deletedAt: NOW, deletedReason: 'userDeleted' });
    for (const task of [validTask(), completed, completedArchive, splitArchive, deleted]) {
      await expect(validateTask(task)).resolves.toBe(task);
    }
  });

  it('accepts optional metadata fields without requiring absent optional keys', async () => {
    await expect(
      validateTask(validTask({ metadata: { triageStatus: 'pending', tags: ['work'], source: 'manual' } })),
    ).resolves.toBeDefined();
    await expect(validateTask(validTask({ metadata: {} }))).resolves.toBeDefined();
  });

  it.each([
    [{ status: 'completed', completedAt: null, completionSource: 'manual' }, 'task.completedAt.required'],
    [{ status: 'completed', completedAt: NOW, completionSource: null }, 'task.completionSource.required'],
    [{ status: 'archived', archivedAt: null, outcome: 'completed' }, 'task.archivedAt.required'],
    [{ status: 'archived', archivedAt: NOW, outcome: null }, 'task.outcome.required'],
    [{ status: 'deleted', deletedAt: null }, 'task.deletedAt.required'],
    [{ status: 'active', completionSource: 'manual' }, 'task.completionSource.state'],
    [{ status: 'active', completedAt: NOW }, 'task.completedAt.state'],
    [{ status: 'active', outcome: 'completed' }, 'task.outcome.state'],
    [{ status: 'active', archivedAt: NOW }, 'task.archivedAt.state'],
    [{ status: 'archived', outcome: 'split', archivedAt: NOW, completionSource: 'manual' }, 'task.completionSource.state'],
    [{ status: 'archived', outcome: 'completed', archivedAt: NOW }, 'task.completedAt.required'],
    [{ status: 'active', deletedAt: NOW }, 'task.deletedAt.state'],
    [{ status: 'active', deletedReason: 'userDeleted' }, 'task.deletedReason.state'],
  ] as const)('rejects inconsistent Task state %#', async (overrides, code) => {
    await expectCode(validTask(overrides as Partial<Task>), code);
  });

  it.each([
    [0, 'number.min'],
    [8, 'number.max'],
    [1.5, 'number.integer'],
  ] as const)('rejects estimatedPomodoros=%s outside integer 1–7', async (estimatedPomodoros, code) => {
    await expectCode(validTask({ estimatedPomodoros }), code);
  });

  it('accepts estimate values 5–7 and rejects invalid round shape/range/sequence', async () => {
    for (const estimate of [5, 6, 7]) {
      await expect(
        validateTask(
          validTask({
            estimatedPomodoros: estimate,
            estimateRounds: [{ index: 1, pomodoros: estimate, occurredAt: NOW }],
          }),
        ),
      ).resolves.toBeDefined();
    }
    await expectCode(validTask({ estimateRounds: [] }), 'task.estimateRounds.count');
    await expectCode(
      validTask({ estimateRounds: [{ index: 2, pomodoros: 8, occurredAt: NOW }] }),
      'task.estimateRounds.sequence',
    );
    await expectCode(
      validTask({
        estimateRounds: [
          { index: 1, pomodoros: 1, occurredAt: NOW },
          { index: 1, pomodoros: 2, occurredAt: NOW },
        ],
      }),
      'task.estimateRounds.duplicateIndex',
    );
    await expectCode(validTask({ estimatedPomodoros: 2 }), 'task.estimate.current');
  });

  it('enforces splitFromTaskId × splitIndex', async () => {
    await expectCode(validTask({ splitIndex: 1 }), 'task.splitIndex.original');
    await expectCode(validTask({ splitFromTaskId: newId(), splitIndex: 0 }), 'task.splitIndex.child');
    const source = validTask();
    await expect(
      validateTask(
        validTask({
          lineageId: source.lineageId,
          splitFromTaskId: source.id,
          splitIndex: 1,
        }),
        { getTask: async (id) => (id === source.id ? source : undefined) },
      ),
    ).resolves.toBeDefined();
    await expectCodeWithContext(
      validTask({ splitFromTaskId: newId(), splitIndex: 1 }),
      'task.splitFrom.missing',
      { getTask: async () => undefined },
    );
    await expectCode(validTask({ lineageId: newId() }), 'task.lineage.original');
    await expectCodeWithContext(
      validTask({ lineageId: newId(), splitFromTaskId: source.id, splitIndex: 1 }),
      'task.lineage.source',
      { getTask: async () => source },
    );
  });

  it('enforces the two-level Task hierarchy using the transaction context', async () => {
    const parent = validTask();
    const child = validTask({ parentId: parent.id });
    await expect(
      validateTask(child, {
        getTask: async (id) => (id === parent.id ? parent : undefined),
        hasTaskChildren: async () => false,
      }),
    ).resolves.toBe(child);
    await expectCodeWithContext(child, 'task.parent.missing', { getTask: async () => undefined });

    const nestedParent = validTask({ parentId: newId() });
    await expectCodeWithContext(child, 'task.parent.depth', { getTask: async () => nestedParent });
    await expectCodeWithContext(child, 'task.child.depth', {
      getTask: async () => parent,
      hasTaskChildren: async () => true,
    });
  });

  it('rejects malformed UUID links, invalid metadata, and unconstrained legacy fields', async () => {
    await expectCode(validTask({ parentId: 'parent' }), 'id.uuidV7');
    await expectCode(validTask({ metadata: { triageStatus: 'pending', unknown: true } as never }), 'field.extra');
    await expectCode(validTask({ title: ' '.repeat(3) }), 'task.title');
    await expectCode(validTask({ sortIndex: -1 }), 'number.min');
  });
});

async function expectCodeWithContext(
  value: unknown,
  code: string,
  context: Parameters<typeof collectTaskValidationIssues>[1],
): Promise<void> {
  const issues = await collectTaskValidationIssues(value, context);
  expect(issues.map((issue) => issue.code)).toContain(code);
}
