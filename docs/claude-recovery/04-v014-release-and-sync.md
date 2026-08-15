# v0.1.4 合并番茄钟发布与同步交接

> 状态：已完成、已合入本地和远端 main、已发布标签 `v0.1.4`。
> 原会话：`5877d444-d9cd-400c-b753-f42ca1217608`
> 原分支：`claude/pomodoro-merge-improvement-7473b5`
> 发布提交：`c7e0d75`

## 1. 这项任务已经完成什么

v0.1.4 在当时的 v4.1 口径上实现了第一版可用的合并番茄钟：

- 清单页拖到另一行正中间创建合并组；
- 拖进合并卡片添加成员；
- 卡内排序、单独移出、整体解散；
- 已经计时过的 Task 禁止合并并给出反馈；
- 从合并卡片启动专注；
- 计时页展示本次合并成员；
- 到点提供结束 / 追加预估；
- 三轮或 7 个番茄到上限时强阻断；
- 今日预算按合并组占用一次；
- Session 从单数 `taskId` 升为 `taskIds`，新增 MergeGroup、`mergeGroupId` 和 IndexedDB v1→v2 迁移；
- 适配 v0.1.2 已存在的 Supabase 同步层；
- 保留旧远端行 `task_id` 向新 `task_ids` 的下载兼容。

## 2. 提交与验证

原功能分支包含 9 个原子提交：

| Commit | 内容 |
|---|---|
| `33ee561` | `mergeGroupLimitReached` 改为强阻断 |
| `93a6ad4` | MergeGroup、taskIds、mergeGroupId、事件和 DB 迁移 |
| `a577b2a` | 合并组生命周期命令 |
| `5559660` | 当时的单成员续轮规范；后续 v4.3.1 已推翻 |
| `f4facaf` | 合并番茄计时轮次 |
| `586880e` | 查询视图 |
| `62f1b61` | 清单页合并卡片与手势 |
| `46ca81f` | 计时页展示与收尾 |
| `614bf3c` | 标注旧统计口径，明确等待后续返工 |

最终合并 main 时还处理了 4 处冲突：`index.ts`、`executeAtomicWrite.ts`、`ActivitiesView.jsx`、`TimerView.jsx`，并保留 v0.1.2 / v0.1.3 的同步与 UI 改动。

当时最终验证：

- `npm run test:run`：494 tests 通过；
- `npm run typecheck` 通过；
- `npm run build` 通过；
- 浏览器实测创建、加入、排序、启动、Session taskIds / mergeGroupId / pomodoroIndex 和计时页成员展示。

`main`、`origin/main` 与标签 `v0.1.4` 都指向 `c7e0d75`。

## 3. 多端同步版本事实

用户当时追问是否在 v0.1.3 丢了同步，结论是没有：

| 版本 | 多端同步 |
|---|---|
| v0.1.1 | 无 |
| v0.1.2 | 首次引入完整 Supabase 同步层 |
| v0.1.3 | 继续包含同步，只把登录入口移到设置页 |
| v0.1.4 | 继续包含同步，并适配 MergeGroup / taskIds |

v0.1.4 发布时需要重新执行更新后的 Supabase schema，因为远端需要：

- `sessions.task_ids`；
- `sessions.merge_group_id`；
- `merge_groups` 表；
- 后续 v4.3 又追加了 `task_segments`、MergeGroup `title` / `completed_at` / completed 状态等结构。

当前无法从本地会话证明用户实际执行过哪一版 SQL。用户后来明确暂停真实云端多端同步测试，因此这仍是需要现场核对的运维事项。

## 4. 哪些内容已经被后续决定推翻

v0.1.4 是发布事实，但不是当前产品语义的最高权威。以下旧行为 / 假设已被 v4.3 推翻：

- 旧统计：合并成员每人各得一个完整有效番茄；
- 旧统计：每个成员各自完整计入整条 Session 时长；
- 旧假设：任务维度加总大于全局是可接受设计；
- 旧活动 Session 设计：成员名单可任意跟随组变化；
- 旧续轮结论：只剩 1 个未完成成员也可开下一轮合并 focus；
- 旧 MergeGroup 缺少 `title`、成员分段和正常 `completed` 终态；
- 旧 UI 没有进行中逐个勾选当前成员、分段推进、确认整组完成与改名入口。

当前正确口径见：

- `docs/data-layer-spec-v4.3.md`
- [01-merge-pomodoro-v43-data-layer.md](./01-merge-pomodoro-v43-data-layer.md)

## 5. 这条分支现在应该怎么用

- 不需要继续开发或再次合并 `claude/pomodoro-merge-improvement-7473b5`；它已与 main 同点。
- 它适合作为第一版 UI 交互骨架和历史发布记录。
- 后续 UI 重接应从当前 v4.3.2 数据层分支开始，选择性复用 v0.1.4 的拖拽、卡片和收尾组件。
- 不能以“v0.1.4 已发布”为理由保留被 v4.3 明确废除的统计 / 生命周期逻辑。

## 6. 仍需处理的发布后事项

- [ ] 完成 v4.3.2 数据层整合并建立新稳定基线
- [ ] 按 v4.3.2 重接合并番茄 UI
- [ ] 重新生成基于当前真实 schema 的 Supabase 幂等增量 SQL
- [ ] 确认远端当前表结构和已执行 migration
- [ ] 恢复真实多端同步测试
- [ ] 决定后续版本号并更新 CHANGELOG
- [ ] 验证今日预算“合并组按一次占用”的口径是否继续保留；它在 v0.1.4 中是 Claude 的实现判断，不是本轮恢复材料中找到的用户最终拍板
