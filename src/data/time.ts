/**
 * 时间 / 时区 / appDate 派生工具（v4 §2.5、红线 3/4/5）。
 *
 * 全部为纯函数：派生只依赖「记录自带的 IANA timezone」与「调用方传入的 offset」，
 * **绝不**读取"当前设备时区"回算历史记录（§2.5 规则 1/4）。
 * offset（`appDayStartOffsetMinutes`）由调用方注入（P1 恒为 0，来源 Settings，见 §3.7）；本模块不读 Settings。
 */

/** 形如 'YYYY-MM-DD' 的日期串。 */
export type IsoDate = string;

/**
 * 业务时间入参：Date（绝对时刻），或带 UTC 偏移（`Z` / `±HH:MM`）的 ISO 8601 instant 字符串。
 * 无时区字符串会被拒绝（见 toInstant）。
 */
export type Instant = Date | string;

/**
 * 写入时取设备当前 IANA 时区（如 'Asia/Shanghai'）。
 * 仅用于写入侧采集 `timezone` 字段；派生历史一律用记录自带 timezone，不用本函数。
 */
export function getDeviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * 带 UTC 偏移的 ISO 8601 instant：`YYYY-MM-DDTHH:MM`（秒/小数秒可选），结尾必须是 `Z` 或 `±HH:MM`。
 * 自然拒绝 date-only（如 `2026-06-04`）与无时区 datetime（如 `2026-06-04T02:00:00`）。
 */
const ISO_INSTANT_WITH_TZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * 把业务时间入参归一为绝对时刻 Date。
 *
 * string 必须是带 UTC 偏移（`Z` 或 `±HH:MM`）的 ISO 8601；无时区字符串会被运行环境隐式解释，
 * 违反 v4 §2.5「业务时间戳必须携带 UTC 偏移量」与红线 5（不隐式依赖当前设备环境），故在此拒绝。
 */
function toInstant(instant: Instant): Date {
  if (instant instanceof Date) {
    if (Number.isNaN(instant.getTime())) {
      throw new Error('无效的业务时间: Invalid Date');
    }
    return instant;
  }
  if (!ISO_INSTANT_WITH_TZ.test(instant)) {
    throw new Error(`业务时间字符串必须是带 UTC 偏移（Z 或 ±HH:MM）的 ISO 8601: ${instant}`);
  }
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`无效的业务时间: ${instant}`);
  }
  return date;
}

/** 取某 instant 在指定 IANA 时区下的墙钟年/月/日/时/分/秒。 */
function wallClockParts(instant: Instant, timezone: string): WallClock {
  const date = toInstant(instant);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const num = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    if (!part) {
      throw new Error(`时区 ${timezone} 无法派生 ${type}`);
    }
    return Number(part.value);
  };

  let hour = num('hour');
  // 某些实现午夜返回 '24'，归一为 0。
  if (hour === 24) {
    hour = 0;
  }
  return {
    year: num('year'),
    month: num('month'),
    day: num('day'),
    hour,
    minute: num('minute'),
    second: num('second'),
  };
}

function formatDate(year: number, month: number, day: number): IsoDate {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * 由（业务时间 + 该记录的 IANA timezone）派生事实自然日 `localDate`（'YYYY-MM-DD'）。
 * 反映事件发生时用户的本地日历日，不取 UTC 日期（§2.5）。不受 offset 影响。
 */
export function deriveLocalDate(businessTime: Instant, timezone: string): IsoDate {
  const { year, month, day } = wallClockParts(businessTime, timezone);
  return formatDate(year, month, day);
}

/**
 * 由（业务时间 + timezone + appDayStartOffsetMinutes）派生产品日 `appDate`（'YYYY-MM-DD'）。
 * 等价于 `appDate = local date of (本地墙钟时间 − offset 分钟)`；offset=0 时 == localDate（§2.5 规则 3）。
 */
export function deriveAppDate(
  businessTime: Instant,
  timezone: string,
  appDayStartOffsetMinutes: number,
): IsoDate {
  const { year, month, day, hour, minute, second } = wallClockParts(businessTime, timezone);
  // 把墙钟当作"裸时间"放进 UTC 轴做日历进位，再减 offset 分钟，仅取日期（正确处理跨月/跨年）。
  const shifted = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second) - appDayStartOffsetMinutes * 60_000,
  );
  return formatDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}
