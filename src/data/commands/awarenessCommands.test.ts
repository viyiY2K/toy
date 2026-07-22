import { describe, expect, it } from 'vitest';
import { dataStore, EVENT_STORE, STORE } from '../dataStore';
import type { EnergyRecord, Event, Session } from '../schema';
import { createManualTask } from './taskCommands';
import { completeBreak, completeFocus, startBreak, startFocus } from './timerCommands';
import { recordEnergy, recordInterrupt } from './awarenessCommands';

const TIMEZONE = 'Asia/Shanghai';
const at = (minute: number) => `2026-12-01T08:${String(minute).padStart(2, '0')}:00+08:00`;

async function eventsFor(correlationId: string): Promise<Event[]> {
  return (await dataStore.getAll<Event>(EVENT_STORE)).filter(
    (event) => event.correlationId === correlationId,
  );
}

describe('S13a-3 awareness commands', () => {
  it('atomically records all standalone Phase 1 energy sources with mood fixed to null', async () => {
    const sources = ['dayStart', 'beforeFocus', 'onReturn'] as const;
    for (const [index, source] of sources.entries()) {
      const result = await recordEnergy({
        now: at(index), timezone: TIMEZONE, source, energyLevel: 6 + index,
        note: source === 'dayStart' ? '准备开始' : null,
      });
      expect(result.value).toMatchObject({
        source, energyLevel: 6 + index, mood: null, sessionId: null,
      });
      expect((await eventsFor(result.correlationId))[0]).toMatchObject({
        type: 'energy.recorded', energyRecordId: result.value.id, sessionId: null, taskId: null,
        payload: { source, energyLevel: 6 + index, mood: null },
      });
    }
  });

  it('records afterFocus/afterShortBreak against matching completed Sessions and stable context', async () => {
    const task = await createManualTask({
      now: at(1), timezone: TIMEZONE, title: '觉察关联任务', destination: 'today',
    });
    const focus = await startFocus({ now: at(2), timezone: TIMEZONE, taskId: task.value.id });
    await completeFocus({
      now: at(3), timezone: TIMEZONE, sessionId: focus.value.id, actualDuration: 60,
    });
    const afterFocus = await recordEnergy({
      now: at(4), timezone: TIMEZONE, source: 'afterFocus', sessionId: focus.value.id,
      energyLevel: 4,
    });
    expect(afterFocus.value.sessionId).toBe(focus.value.id);
    expect((await eventsFor(afterFocus.correlationId))[0]).toMatchObject({
      type: 'energy.recorded', sessionId: focus.value.id, taskId: task.value.id,
      dayPlanId: focus.value.dayPlanId,
    });

    const breakSession = await startBreak({
      now: at(5), timezone: TIMEZONE, sourceFocusSessionId: focus.value.id,
    });
    await completeBreak({
      now: at(6), timezone: TIMEZONE, sessionId: breakSession.value.id,
      actualDuration: 30, actualRest: null,
    });
    const afterBreak = await recordEnergy({
      now: at(7), timezone: TIMEZONE, source: 'afterShortBreak',
      sessionId: breakSession.value.id, energyLevel: 7,
    });
    expect(afterBreak.value).toMatchObject({
      source: 'afterShortBreak', sessionId: breakSession.value.id, energyLevel: 7,
    });
    expect((await eventsFor(afterBreak.correlationId))[0]).toMatchObject({
      type: 'energy.recorded', sessionId: breakSession.value.id,
      taskId: task.value.id, dayPlanId: breakSession.value.dayPlanId,
    });

    let longBreak: Session | undefined;
    for (let index = 0; index < 3; index += 1) {
      const focusIndex = await startFocus({
        now: at(8 + index * 4), timezone: TIMEZONE, taskId: task.value.id,
      });
      await completeFocus({
        now: at(9 + index * 4), timezone: TIMEZONE,
        sessionId: focusIndex.value.id, actualDuration: 60,
      });
      const nextBreak = await startBreak({
        now: at(10 + index * 4), timezone: TIMEZONE,
        sourceFocusSessionId: focusIndex.value.id,
      });
      await completeBreak({
        now: at(11 + index * 4), timezone: TIMEZONE,
        sessionId: nextBreak.value.id, actualDuration: 30, actualRest: null,
      });
      if (nextBreak.value.type === 'longBreak') longBreak = nextBreak.value;
    }
    expect(longBreak?.type).toBe('longBreak');
    const afterLongBreak = await recordEnergy({
      now: at(21), timezone: TIMEZONE, source: 'afterLongBreak',
      sessionId: longBreak!.id, energyLevel: 8,
    });
    expect(afterLongBreak.value).toMatchObject({
      source: 'afterLongBreak', sessionId: longBreak!.id, energyLevel: 8,
    });

    const beforeCounts = {
      records: (await dataStore.getAll<EnergyRecord>(STORE.energyRecords)).length,
      events: (await dataStore.getAll<Event>(EVENT_STORE)).length,
    };
    await expect(recordEnergy({
      now: at(22), timezone: TIMEZONE, source: 'afterLongBreak',
      sessionId: breakSession.value.id, energyLevel: 5,
    })).rejects.toThrow(/对应的 completed Session/);
    expect(await dataStore.getAll<EnergyRecord>(STORE.energyRecords)).toHaveLength(beforeCounts.records);
    expect(await dataStore.getAll<Event>(EVENT_STORE)).toHaveLength(beforeCounts.events);
  });

  it('appends internal/external interrupts only during active focus without mutating Session', async () => {
    const task = await createManualTask({
      now: at(30), timezone: TIMEZONE, title: '打扰任务', destination: 'list',
    });
    const focus = await startFocus({ now: at(31), timezone: TIMEZONE, taskId: task.value.id });
    const before = await dataStore.get<Session>(STORE.sessions, focus.value.id);
    const internal = await recordInterrupt({
      now: at(32), timezone: TIMEZONE, sessionId: focus.value.id,
      kind: 'internal', offsetSeconds: 17, note: '走神',
    });
    const external = await recordInterrupt({
      now: at(33), timezone: TIMEZONE, sessionId: focus.value.id,
      kind: 'external', offsetSeconds: 23, note: null,
    });
    expect(internal.value).toMatchObject({
      type: 'interrupt.internal', taskId: task.value.id, sessionId: focus.value.id,
      payload: { offsetSeconds: 17, note: '走神' },
    });
    expect(external.value).toMatchObject({
      type: 'interrupt.external', payload: { offsetSeconds: 23, note: null },
    });
    expect(await dataStore.get<Session>(STORE.sessions, focus.value.id)).toEqual(before);
    expect(
      (await dataStore.getAll<Event>(EVENT_STORE)).filter(
        (event) => event.sessionId === focus.value.id && event.type.startsWith('interrupt.'),
      ),
    ).toHaveLength(2);

    await completeFocus({
      now: at(34), timezone: TIMEZONE, sessionId: focus.value.id, actualDuration: 60,
    });
    const eventCount = (await dataStore.getAll<Event>(EVENT_STORE)).length;
    await expect(recordInterrupt({
      now: at(35), timezone: TIMEZONE, sessionId: focus.value.id,
      kind: 'internal', offsetSeconds: 30,
    })).rejects.toThrow(/active focus/);
    expect(await dataStore.getAll<Event>(EVENT_STORE)).toHaveLength(eventCount);
  });
});

if (false) {
  // @ts-expect-error Phase 1 产品入口不开放 manual energy source。
  void recordEnergy({ now: at(0), timezone: TIMEZONE, source: 'manual', energyLevel: 5 });
  // @ts-expect-error Phase 1 产品入口不开放 afterExtraFocus。
  void recordEnergy({ now: at(0), timezone: TIMEZONE, source: 'afterExtraFocus', sessionId: 'x', energyLevel: 5 });
}
