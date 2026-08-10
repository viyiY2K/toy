/**
 * 成员分段切分（v4.3 §3.3 关键规则 13、红线 25）。
 *
 * 分段是纯函数，这里直接喂"谁在什么时候被勾完成"，不跑整条端到端计时流程——
 * 时间怎么切是本模块唯一的职责，值得单独钉死。
 */
import { describe, expect, it } from 'vitest';
import { computeTaskSegments } from './mergeSegments';

const A = 'task-a';
const B = 'task-b';
const C = 'task-c';

const START = '2026-11-02T09:00:00.000Z';
/** 25 分钟后到点。 */
const END = '2026-11-02T09:25:00.000Z';

const at = (minutes: number) =>
  new Date(Date.parse(START) + minutes * 60_000).toISOString();

const run = (
  taskIds: readonly string[],
  completions: Record<string, string>,
  { endedAt = END, actualDuration = 1500 } = {},
) =>
  computeTaskSegments({
    taskIds,
    startedAt: START,
    endedAt,
    actualDuration,
    completedAt: new Map(Object.entries(completions)),
  });

describe('computeTaskSegments（§3.3 关键规则 13）', () => {
  it('顺序切分：第一位从 Session 开始，后一位从前一位被勾完成的那刻接上', () => {
    // A 做了 10 分钟被勾完成，B 接着做到到点；C 始终没轮到。
    const segments = run([A, B, C], { [A]: at(10) });

    expect(segments.map(({ taskId }) => taskId)).toEqual([A, B, C]);
    expect(segments.map(({ actualDuration }) => actualDuration)).toEqual([600, 900, 0]);
    expect(segments[1]!.startedAt).toBe(segments[0]!.endedAt);
  });

  it('未轮到的成员耗时为 0，不分等待时间', () => {
    const segments = run([A, B, C], {});

    // 一个都没勾完成：整段归当前成员 A，后面两个都是显式 0 分段（不能删，总和要对上）。
    expect(segments.map(({ actualDuration }) => actualDuration)).toEqual([1500, 0, 0]);
    expect(segments[2]!.startedAt).toBe(segments[2]!.endedAt);
  });

  it('中途加入的成员不从加入时刻、也不从 Session 开始时刻倒算', () => {
    /*
     * C 是本轮中途才被拖进组的：它排在 B 后面，B 到点都没做完，所以 C 根本没轮到。
     * 无论它是什么时候加入的，本轮实际投入都必须是 0——加入 ≠ 开始计时。
     */
    const segments = run([A, B, C], { [A]: at(5) });

    expect(segments.find(({ taskId }) => taskId === C)!.actualDuration).toBe(0);
    expect(segments.find(({ taskId }) => taskId === B)!.actualDuration).toBe(1200);
  });

  it('执行顺序按真实勾完成时刻排，不按传入顺序——进行中重排过未来队列也算得对', () => {
    // 传入顺序是 [A, B]，但 B 先被勾完成（用户中途把 B 提到了前面）。
    const segments = run([A, B], { [B]: at(10) });

    expect(segments.map(({ taskId }) => taskId)).toEqual([B, A]);
    expect(segments.map(({ actualDuration }) => actualDuration)).toEqual([600, 900]);
  });

  it('各分段之和必须精确等于 actualDuration，取整余数并入最后一个正数分段', () => {
    /*
     * 墙钟 25 分钟，但 actualDuration 是 1499（倒计时漂移 / 后台节流，§3.3 关键规则 10
     * 明说两者可以不等）。等比切分必然产生余数，它一律并入最后一个正数分段，
     * 不做平均分摊——否则总和对不上，任务维度就没法与全局对账了。
     */
    const segments = run([A, B, C], { [A]: at(10) }, { actualDuration: 1499 });

    expect(segments.reduce((sum, { actualDuration }) => sum + actualDuration, 0)).toBe(1499);
    expect(segments[2]!.actualDuration).toBe(0);
  });

  it('作废时保留已发生的分段：当前成员止于作废时刻，未轮到的仍为 0', () => {
    // 开始 10 分钟后作废：A 已在第 4 分钟完成，B 吃掉剩下的 6 分钟，C 没轮到。
    const segments = run([A, B, C], { [A]: at(4) }, { endedAt: at(10), actualDuration: 600 });

    expect(segments.map(({ actualDuration }) => actualDuration)).toEqual([240, 360, 0]);
    expect(segments.reduce((sum, { actualDuration }) => sum + actualDuration, 0)).toBe(600);
  });

  it('瞬间作废（actualDuration 为 0）也要给每个成员留显式 0 分段', () => {
    const segments = run([A, B], {}, { endedAt: START, actualDuration: 0 });

    expect(segments).toHaveLength(2);
    expect(segments.every(({ actualDuration }) => actualDuration === 0)).toBe(true);
  });

  it('勾完成时刻越界时夹回合法区间，分段不倒挂', () => {
    /*
     * 时钟回拨 / 离线补录都可能产生"早于上一位结束"或"晚于 Session 终结"的时刻。
     * 这里 B 的完成时刻比 A 还早，且 A 的完成时刻晚于 Session 终结。
     */
    const segments = run([A, B], { [A]: at(99), [B]: at(-5) });

    expect(segments.every((s) => Date.parse(s.endedAt) >= Date.parse(s.startedAt))).toBe(true);
    expect(segments.reduce((sum, { actualDuration }) => sum + actualDuration, 0)).toBe(1500);
  });
});
