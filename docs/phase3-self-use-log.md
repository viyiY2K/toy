# Phase 3 自用验收与长期观察日志

## 状态

- Candidate: Phase 3 两个授权产品域已实现并完成跨域生产入口回归。
- Ready gate: 本文与 `docs/phase3-checklist.md` 的 S5 closeout commit 仍须独立 Reviewer `PASS`，随后以 review-log-only commit 记录最终结果并独立核对。
- Next mode: 全部 gate 关闭后进入长期个人使用与 bug / 流畅度收集；不自动扩大到其他 P3/P4/P5+ 功能。

## 基线与环境

- Branch: `data-layer-refactor`。
- Phase 2 implementation tip: `29aea35c80ca77b31c83e520acf04dbdb11f35f4`。
- Phase 2 bookkeeping tip: `16b702216fb272c5a86bc16ab7a502fb5336eb3b`。
- S5 fresh origin: `http://127.0.0.1:4191/`。
- Retained origin: `http://127.0.0.1:4174/`。
- App date observed: `2026-07-22`，timezone `Asia/Shanghai`。
- 受保护工作区：53 个 `docs/Draft/`、`docs/ai-context/` 历史文档删除始终未恢复、修改、暂存或提交。

## 可重复生产入口流程

1. 在 fresh origin 打开清单；创建父任务、两个子任务和多个顶层任务。
2. 在父任务详情写 note；使用上下箭头交换同母子任务顺序。
3. 把一个顶层任务设为该父任务的子任务，再升级回顶层；确认最多两层且活动清单顺序恢复稳定。
4. 对独立顶层任务执行单后继 split；在历史中确认 source→successor lineage；给 archived source 写 actualWorkNote，再从 archived 恢复。
5. 选择两个顶层任务执行“批量加入今日”，再执行“批量移回活动清单”；逐项结果均显示完成。
6. 手动完成这两个任务，执行“批量归档已完成”；给其中一个写 actualWorkNote 并从 archived 恢复，另一个留在历史。
7. 进入计时，主动记录能量，开始标准 focus；各记录一次 internal/external interrupt，并快速捕获三个待分流 Task。
8. 在清单分别执行“加入今日”“移到活动清单”“放弃”；回到计时确认 focus 继续且待分流归零。
9. reload 触发 recovery；明确将原 focus 记为 completed、实际时长填入事实包络并忽略剩余未知段；开始 shortBreak，reload 后明确记为 completed 并选择实际休息项目。
10. 打开统计，核对 day/week/month 的有效番茄、完整循环、focus/rest 时长、任务完成、能量、interrupt、Task 明细与预算；reload 后再次核对。
11. 回清单核对父子、split 两端、triage 两个保留结果、dismissed 缺席、completed restore、archived history、note 与 actualWorkNote 均持久化。
12. 打开 retained origin，确认既有未收尾 Session 仍进入 recovery，统计页可读且没有触发事实改写。

## 2026-07-22 · S5 fresh-origin 执行证据

### 任务管理

- 创建 `S5 父任务`、`S5 子任务甲/乙`；子任务顺序真实从“甲、乙”变为“乙、甲”。
- `S5 层级候选` 顶层→`S5 父任务` 子任务→顶层往返成功；父任务保留两个原子任务。
- `S5 父任务` 的 `S5 长期备注` 在 reload 后仍存在。
- `S5 拆分源` 归档为 split 并创建 `S5 拆分后续`；历史显示后继、split index 与 id hint；source 的 `S5 拆分归档工作记录` 可编辑，archived restore 后 source/successor 均在活动清单。
- `S5 批量一/二`：批量加入今日 `2/2`、批量移回 `2/2`、手动完成后批量归档 `2/2`；`S5 批量一` 恢复为 completed 且 `S5 完成后工作记录` 保留，`S5 批量二` 继续留在 archived history。
- active focus 中捕获 `S5 分流今日/清单/放弃`；三种出口均成功，focus 继续、pending 归零；reload 后前两者分别位于今日/活动清单，dismissed Task 不在用户视图。

### 真实统计事实

- 标准 focus：recovery 明确 completed，`actualDuration=50s`。
- shortBreak：recovery 明确 completed，`actualDuration=9s`，actualRest 选择“梳头皮”。
- EnergyRecord：1 条 `dayStart`，energy level 6；day 曲线以 local HH:mm 显示。
- Interrupt Event：internal 1、external 1；总数 2、每有效番茄 2、四小时分布落在 `00–03`。
- day：有效标准番茄 1、完整循环 1、shortBreak `1/1`、标准休息完成率 100%、任务完成 2 且均为 manual、预估样本为 null/0。
- week：范围 `2026-07-20 – 2026-07-26`，上述 appDate 事实出现在 `2026-07-22` 日桶。
- month：范围 `2026-07`，与 day/week 的事实总数一致；缺 DayPlan 的日期不伪造预算值。
- reload 后有效番茄、完整循环、shortBreak、energy、interrupt 与 Task 明细一致。

### Retained 与 Console

- retained `4174` 的未收尾 focus 仍显示“需要恢复处理”；进入统计没有改写该事实。
- fresh `4191` 在任务 reload、day/week/month、统计 reload 后页面 Console error 均为 0。
- retained `4174` 页面 Console error 为 0。
- 浏览器控制服务自身曾出现一次 Statsig 外部遥测 POST timeout；它不是应用页面 Console、没有影响本地命令或持久化，未计为产品错误。

## 最终自动验证

- Full Vitest: 50 files / 373 tests `PASS`。
- TypeScript: `PASS`。
- Production build: 82 modules `PASS`。
- Lint: 仓库没有 lint script，未伪造 lint 结果。
- `git diff --check`: `PASS`。
- External dependency: 未新增。
- Push: 未执行。

## Bug / 流畅度观察入口

长期使用阶段新增记录时，使用以下最小格式；问题修复仍按独立范围、测试、原子 commit 与 Reviewer 流程处理。

```text
日期 / appDate：
场景：计时 | 任务 | 分流 | 历史恢复 | 批量 | 统计
复现步骤：
期望：
实际：
是否 reload 后仍存在：
Console：
影响：阻断 | 明显不顺 | 轻微
关联 Task/Session/Event（若可见）：
```

### Closeout 时残余观察

- recoveryDelta 在前后 EnergyRecord 链不完整时明确显示“样本缺失”；这是 v4 规定的空态，不补 0。长期使用中待自然形成完整前后样本后继续观察数值可读性。
- 受控浏览器不把拖拽作为最终证据；顶层排序已有直接测试与既有回归，子任务排序使用普通按钮完整验证。普通桌面浏览器长期使用时继续观察拖拽手感。
- 当前无阻断或未关闭的 Phase 3 correctness finding；未来发现的 bug 不自动扩大到通知、prompt 分析、数据管理、同步或其他排除范围。
