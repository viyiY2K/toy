# Claude Code 中断任务恢复索引

> 整理日期：2026-08-15
> 用途：恢复 Claude Code 被封前几个任务的上下文，供后续对话直接接手。
> 本目录是交接材料，不替代数据规范；涉及数据真值时，以当前 `docs/data-layer-spec-v4.3.md` 为最高权威。

## 1. 本次恢复了哪些任务

| 序号 | 任务 | 原 Claude 会话 | 原分支 / 关键提交 | 当前结论 |
|---|---|---|---|---|
| 01 | 合并番茄钟 v4.3 数据层收口与 v4.3.2 整合 | `f903d7b7-8d60-4891-8da5-91bf1c43d94f` | `claude/pomodoro-spec-data-layer-f89a02`，实现锚点 `f2a2c9c`，交接提交 `1ce98fe` | 数据层主体已完成；当前 `codex/v43-2-reconcile` 工作树正在做 v4.3.2 最终整合，但尚未提交；新 UI 尚未重接 |
| 02 | Goal（中长期主线目标）与 v4.3 规范 | `d907ea96-8721-4793-bd2b-be4f3b15d206` | `claude/mainline-task-discussion-692f08`，最终提交 `3c9db61` | 产品语义和规范已定；实现尚未开始 |
| 03 | 任务分类、自动打标与批量分类 | `6ba8cfa6-cf98-4e7d-bc0d-a29fdb6491b0` | `claude/task-category-plan-3a4e6a`，最终提交 `b39c0dd` | 旧基线上已完整实现并测试，但未合入 main；需按 v4.3.2 重新移植，不能整分支直接合并 |
| 04 | v0.1.4 合并番茄钟发布与同步适配 | `5877d444-d9cd-400c-b753-f42ca1217608` | `claude/pomodoro-merge-improvement-7473b5`，发布提交 `c7e0d75` | 已合入本地与远端 main，并发布 `v0.1.4`；它是历史基线，部分语义已被 v4.3 推翻 |

对应详细交接：

- [01-merge-pomodoro-v43-data-layer.md](./01-merge-pomodoro-v43-data-layer.md)
- [02-goal-mainline-task.md](./02-goal-mainline-task.md)
- [03-task-category.md](./03-task-category.md)
- [04-v014-release-and-sync.md](./04-v014-release-and-sync.md)

## 2. 如何判断“哪个说法才是最终决定”

原 Claude 会话发生过多次 `Try again`，同一问题在不同重试分支里出现过互相冲突的答复。后续接手时按以下顺序判断：

1. 当前 `docs/data-layer-spec-v4.3.md` 的正式文本；
2. 用户最后明确拍板、且已进入最终提交或当前整合工作树的结论；
3. 本目录交接文档中的“最终已确认”部分；
4. 原始会话中的中间讨论；
5. v4.2 / v4.1、旧交接文档和旧代码注释。

因此，不要因为旧会话里出现过某句话，就覆盖当前 v4.3。尤其要注意：

- v4.1 / v4.2 的“合并成员每人各得一个完整番茄、每人各算整段时间”已经废除；
- `docs/mainline-task-notes.md` 仍把 `parentId` 当作主线机制，已经过时；
- 当前工作树里的 `docs/task-category-plan.md` 仍允许手动清空分类，已经被用户后续的“只能批量选择四类、不能选未分类”决定推翻；
- 当前工作树里的 `docs/merge-pomodoro-plan.md` 同时残留新旧两套统计和续轮表述，不能单独作为实现依据。

## 3. 2026-08-15 的仓库现场

- 当前分支：`codex/v43-2-reconcile`
- 当前分支的数据层实现基线：`f2a2c9c`；本恢复目录以一个独立的 docs-only commit 叠在其上，不改变代码基线
- main / origin/main：`c7e0d75`（v0.1.4）
- 当前工作树存在一批**尚未提交**的 v4.3.2 整合修改，覆盖规范、MergeGroup 命令、Event 契约、跨实体校验和测试。
- 2026-08-15 本次恢复整理对该现场运行了全量检查：65 个测试文件 / 531 个测试通过，typecheck 与 build 通过；仍需完成 diff review 和原子提交。
- 当前工作树另有用户原先的未跟踪文件 `docs/ui-handoff-empty-states-and-beyond.md`。
- 本恢复任务没有修改上述文件，也没有切换分支或合并旧分支。

后续操作前不要执行会丢工作树的命令。应先完成或妥善保存 `codex/v43-2-reconcile` 当前改动。

## 4. 推荐的依赖顺序

这不是产品优先级，只是减少返工的工程依赖顺序：

1. 完成并提交当前 v4.3.2 合并番茄数据层整合，跑全量测试、typecheck、build。
2. 以 v4.3.2 为新基线，重接合并番茄 UI；v0.1.4 的 UI 只能作为交互原型参考。
3. 先把“任务分类不允许清空、采用批量分类”的最终决定写回 v4.3，再从 `b39c0dd` 移植分类功能。
4. 实现 Goal 与废除旧 `parentId` 子任务机制；Goal 和任务分类都依赖当前 v4.3 数据结构，不能从旧分支整包合并。
5. 最后做 Supabase 增量结构升级和真实多端同步验收。

Goal 与任务分类谁先做属于产品排期选择；但两者都应建立在已收口的 v4.3.2 数据层上。

## 5. 原始上下文仍在哪里

原始会话没有丢失，位于：

```text
~/.claude/projects/
```

本次确认本地仍有 20 份主会话、7 份子代理记录、57 条已完成任务记录、文件历史和备份。需要追溯措辞时，可按上表的会话 ID 找对应 `.jsonl`。
