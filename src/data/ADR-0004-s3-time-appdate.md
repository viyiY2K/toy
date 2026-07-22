# ADR-0004 · 时间 / 时区 / appDate 派生工具（Phase 1 / S3）

- 状态：已采纳（2026-06-05）
- 范围：phase1-plan.md **S3**；落实 v4 **§2.5**（timezone / localDate / appDate 派生），红线 3/4/5。

## 背景

v4 区分「事实自然日 `localDate`」与「产品日归属 `appDate`」：localDate 是写入时按设备 IANA 时区从业务时间派生的日历日；appDate 是按 `appDayStartOffsetMinutes` 偏移后的产品日（P1 offset=0）。所有「今天/每日/当日/按日」必须走 appDate，且不得用当前设备时区回算历史。S3 提供这套纯函数地基，供后续 S5/S10/S11/S13 写入与查询统一调用。

## 决策

1. **三个纯函数（`src/data/time.ts`）**：
   - `getDeviceTimeZone()` —— 写入侧采集设备 IANA 时区（`Intl...resolvedOptions().timeZone`）。
   - `deriveLocalDate(businessTime, timezone)` —— 事实自然日 `'YYYY-MM-DD'`。
   - `deriveAppDate(businessTime, timezone, appDayStartOffsetMinutes)` —— `appDate = local date of (本地墙钟 − offset 分钟)`。
2. **不引日期库**：用平台 `Intl.DateTimeFormat.formatToParts` 取墙钟分量 + `Date.UTC` 做日历进位（跨月/跨年正确）。Node 23 全 ICU，IANA 时区可靠。符合"稳定最小"，零新依赖。
3. **派生只依赖记录自带 timezone + 传入 offset**：函数不读「当前设备时区」、不读 Settings——满足 §2.5 规则 1/4「不回算历史」。offset 由调用方注入（P1 传 0），故 S3 与 Settings（S5/S11）解耦。
4. **业务时间入参** `Date | string`（ISO 8601 instant），内部归一为绝对时刻；非法输入抛错。
5. **不在实体上落 appDate**：Session/Event/EnergyRecord/UnresolvedInterval 的 appDate 查询时派生、不存字段（§2.5 规则 5）；DayPlan 落 appDate 属 S5。本步只交付工具，不写任何实体字段。

## 不在 S3 做

S4（schemaVersion）、S5（实体 schema/字段、DayPlan.appDate 落库）、S6+ 及之后所有步；不建/读 Settings；不接 UI；不实现 P2 的 offset UI / 更新事件（红线 4/19）。
