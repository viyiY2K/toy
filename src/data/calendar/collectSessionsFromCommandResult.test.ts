import { describe, expect, it } from 'vitest';
import { makeSession } from '../schema';
import { collectSessionsFromCommandResult } from './collectSessionsFromCommandResult';

const NOW = '2026-05-24T10:25:00+08:00';

function session(id: string) {
  return makeSession({
    id,
    now: NOW,
    startedAt: '2026-05-24T10:00:00+08:00',
    timezone: 'Asia/Shanghai',
    type: 'focus',
    status: 'completed',
    taskIds: ['task-1'],
    endedAt: NOW,
    plannedDuration: 1500,
    actualDuration: 1500,
  });
}

describe('collectSessionsFromCommandResult', () => {
  it('reads completeFocus-style { value } and recovery source/extra sessions', () => {
    const completed = session('s1');
    expect(collectSessionsFromCommandResult({ value: completed, correlationId: 'c1' }).map((item) => item.id))
      .toEqual(['s1']);

    const source = session('s2');
    const extra = makeSession({
      id: 's3',
      now: NOW,
      startedAt: NOW,
      timezone: 'Asia/Shanghai',
      type: 'extraFocus',
      status: 'completed',
      taskIds: ['task-1'],
      endedAt: NOW,
      actualDuration: 120,
      originIntervalId: 'interval-1',
    });
    expect(collectSessionsFromCommandResult({
      sourceSession: source,
      extraSession: extra,
      correlationId: 'c2',
    }).map((item) => item.id)).toEqual(['s2', 's3']);
  });

  it('ignores unrelated command results', () => {
    expect(collectSessionsFromCommandResult(undefined)).toEqual([]);
    expect(collectSessionsFromCommandResult({ value: { id: 'task-1', title: '写周报' } })).toEqual([]);
  });
});
