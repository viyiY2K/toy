# ADR-0033: Phase 3 S4 真实统计页面

- Status: Accepted
- Date: 2026-07-22
- Scope: `docs/phase3-plan.md` S4

## Context

S3a/S3b 已提供从 Task、Session、Event、EnergyRecord、DayPlan 与 Settings 动态派生的统一只读 `loadStatsDashboard`。生产导航中的统计入口此前仍被禁用；根目录旧 `stats.jsx` 依赖旧原型真值，不能复用。

## Decision

1. 生产 `StatsView` 只调用 `loadStatsDashboard({ kind, anchorAppDate })`，不读取旧原型状态，不预存、缓存或写回统计结果。
2. 范围只支持 day/week/month。日期导航使用 ISO `appDate` 做 UTC 日历运算；查询层继续负责 v4 定义的业务时刻到 appDate 归属。
3. 默认进入当前产品日。切换范围或日期后重新执行完整只读查询；快速切换以 effect 生命周期丢弃过期结果。
4. 图形只使用现有 CSS 与内联 SVG：有效番茄/完整循环日柱、能量折线、打扰四小时分布。缺样本显示空态，不补零成事实值。
5. 页面明确拆分 standard/extra/discarded focus、三类休息、四类 skip、missing 与 workEnded 豁免、internal/external interrupt、manual/pomodoro completion、严格预估样本及动态 recoveryDelta。
6. lifetimePomodoroBaseline 仅呈现在累计完整番茄，并与工具内循环拆开；累计专注仍完全来自 Session.actualDuration。
7. 生产入口旧真值守卫仍禁止所有 UI 使用旧 `interrupts` 聚合；唯一例外严格限定为直接导入公共 `loadStatsDashboard` 的 `StatsView`，因为这里的同名字段是 v4 Event 派生结果而非旧原型状态。
8. 区间与 Task 的“总专注时长”均包含 standard、extra 与 discarded；有效标准番茄仍只计 completed standard focus，三类时长在明细中分别展示。
9. day 能量曲线展示当天全部 EnergyRecord，并按 occurredAt 排序、以 local HH:mm 标注；week/month 才使用逐日平均值与 sampleCount。UI 不截断日内记录。

## Verification boundary

- view-model 直接测试覆盖日/周/月锚点移动、月底闰年收敛、范围/时长/null 比例格式、SVG 缺口、范围空态，以及超过 6 条且输入乱序的日内 EnergyRecord 完整排序。
- S3a/S3b 聚合直接测试继续承担 appDate、Session.actualDuration、软删除、manual/discarded/extraFocus/skipped/ignored 等事实口径边界。
- 浏览器分别覆盖 fresh origin 空态、isolated 真实 focus/break/energy/interrupt 数据、retained IndexedDB、day/week/month、reload 与 clean Console。

## Out of scope

不接入根目录旧 `stats.jsx`，不增加图表依赖、统计缓存、year 视图、schema/command/write path，也不改变导航结构或视觉体系。
