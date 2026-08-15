import { describe, expect, it } from 'vitest';
import {
  completeTaskFromPomodoro,
  createManualTask,
  createMergeGroup,
  detectRecoveryInterval,
  loadCurrentTimerViews,
  resolveRecoveryInterval,
  startFocus,
  startMergeGroupFocus,
} from '../index';
import { loadCurrentRecoveryView } from './currentRecoveryView';

const TIMEZONE = 'Asia/Shanghai';

describe('Phase 2 S2a current recovery view', () => {
  it('joins a pending interval to its detection Event, active Session, Task, and timer view', async () => {
    const task = await createManualTask({
      now: '2027-03-09T08:00:00+08:00', timezone: TIMEZONE,
      title: '恢复查询任务', destination: 'today',
    });
    const focus = await startFocus({
      now: '2027-03-09T08:01:00+08:00', timezone: TIMEZONE, taskId: task.value.id,
    });
    const detected = await detectRecoveryInterval({
      now: '2027-03-09T08:06:00+08:00', timezone: TIMEZONE, source: 'appReopened',
    });
    expect(await loadCurrentRecoveryView()).toMatchObject({
      interval: { id: detected.interval!.id, status: 'pending' },
      detectionEvent: { type: 'interval.detected', sessionId: focus.value.id },
      sourceSession: { id: focus.value.id, status: 'active' },
      sourceTask: { id: task.value.id },
      envelopeDurationSeconds: 300,
    });
    expect(await loadCurrentTimerViews({
      now: '2027-03-09T08:07:00+08:00', timezone: TIMEZONE,
    })).toMatchObject({
      activeSession: { id: focus.value.id },
      pendingRecovery: {
        interval: { id: detected.interval!.id },
        sourceSession: { id: focus.value.id },
      },
    });

    await resolveRecoveryInterval({
      now: '2027-03-09T08:08:00+08:00', timezone: TIMEZONE,
      intervalId: detected.interval!.id,
      original: { resolvedAs: 'discarded', actualDuration: 10 },
      remainder: { kind: 'ignore' },
    });
    expect(await loadCurrentRecoveryView()).toBeNull();
    expect((await loadCurrentTimerViews({
      now: '2027-03-09T08:09:00+08:00', timezone: TIMEZONE,
    })).pendingRecovery).toBeNull();
  });

  it('uses the current unfinished merge member as sourceTask, not taskIds[0]', async () => {
    const [a, b] = [
      await createManualTask({
        now: '2027-03-09T09:00:00+08:00', timezone: TIMEZONE,
        title: '恢复合并A', destination: 'today',
      }),
      await createManualTask({
        now: '2027-03-09T09:01:00+08:00', timezone: TIMEZONE,
        title: '恢复合并B', destination: 'today',
      }),
    ];
    const group = (await createMergeGroup({
      now: '2027-03-09T09:02:00+08:00', timezone: TIMEZONE,
      taskIds: [a.value.id, b.value.id],
    })).value;
    const focus = await startMergeGroupFocus({
      now: '2027-03-09T09:03:00+08:00', timezone: TIMEZONE, mergeGroupId: group.id,
    });
    await completeTaskFromPomodoro({
      now: '2027-03-09T09:04:00+08:00', timezone: TIMEZONE,
      sessionId: focus.value.id, taskId: a.value.id,
    });
    await detectRecoveryInterval({
      now: '2027-03-09T09:08:00+08:00', timezone: TIMEZONE, source: 'appReopened',
    });
    expect(await loadCurrentRecoveryView()).toMatchObject({
      sourceSession: { id: focus.value.id, taskIds: [a.value.id, b.value.id] },
      sourceTask: { id: b.value.id },
    });
  });
});
