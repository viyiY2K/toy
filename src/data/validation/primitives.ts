import { CURRENT_SCHEMA_VERSION } from '../schemaVersion';
import { deriveLocalDate } from '../time';

export interface ValidationIssue {
  code: string;
  path: string;
  message: string;
}

export class EntityValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(entityType: string, issues: readonly ValidationIssue[]) {
    super(`${entityType} 写入校验失败: ${issues.map((issue) => issue.code).join(', ')}`);
    this.name = 'EntityValidationError';
    this.issues = issues;
  }
}

export class ValidationCollector {
  readonly issues: ValidationIssue[] = [];

  add(code: string, path: string, message: string): void {
    this.issues.push({ code, path, message });
  }

  check(condition: boolean, code: string, path: string, message: string): void {
    if (!condition) this.add(code, path, message);
  }

  throwIfAny(entityType: string): void {
    if (this.issues.length > 0) throw new EntityValidationError(entityType, this.issues);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requireRecord(
  value: unknown,
  path: string,
  collector: ValidationCollector,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    collector.add('type.object', path, '必须为非 null 对象');
    return undefined;
  }
  return value;
}

export function validateExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
  collector: ValidationCollector,
): void {
  const actual = Object.keys(value);
  const allowed = new Set(expected);
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) collector.add('field.missing', `${path}.${key}`, '缺少必填字段');
  }
  for (const key of actual) {
    if (!allowed.has(key)) collector.add('field.extra', `${path}.${key}`, '包含 schema 未定义字段');
  }
}

export function validateAllowedKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string,
  collector: ValidationCollector,
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) collector.add('field.extra', `${path}.${key}`, '包含 schema 未定义字段');
  }
}

const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_WITH_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(?:Z|([+-])(\d{2}):(\d{2}))$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function validateUuidV7(
  value: unknown,
  path: string,
  collector: ValidationCollector,
  nullable = false,
): value is string | null {
  if (nullable && value === null) return true;
  const ok = typeof value === 'string' && UUID_V7.test(value);
  collector.check(ok, 'id.uuidV7', path, '必须为 UUID v7');
  return ok;
}

export function validateIsoDateTime(
  value: unknown,
  path: string,
  collector: ValidationCollector,
  nullable = false,
): value is string | null {
  if (nullable && value === null) return true;
  const match = typeof value === 'string' ? ISO_WITH_OFFSET.exec(value) : null;
  let ok = match !== null;
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = match[6] === undefined ? 0 : Number(match[6]);
    const offsetHour = match[9] === undefined ? 0 : Number(match[9]);
    const offsetMinute = match[10] === undefined ? 0 : Number(match[10]);
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    ok =
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= (daysInMonth[month - 1] ?? 0) &&
      hour >= 0 &&
      hour <= 23 &&
      minute >= 0 &&
      minute <= 59 &&
      second >= 0 &&
      second <= 59 &&
      offsetHour >= 0 &&
      offsetHour <= 14 &&
      offsetMinute >= 0 &&
      offsetMinute <= 59 &&
      (offsetHour < 14 || offsetMinute === 0) &&
      !Number.isNaN(Date.parse(match.input));
  }
  collector.check(ok, 'time.isoWithOffset', path, '必须为带 UTC 偏移的有效 ISO 8601 时间');
  return ok;
}

export function validateIsoDate(
  value: unknown,
  path: string,
  collector: ValidationCollector,
): value is string {
  if (typeof value !== 'string') {
    collector.add('date.iso', path, '必须为 YYYY-MM-DD');
    return false;
  }
  const match = ISO_DATE.exec(value);
  if (!match) {
    collector.add('date.iso', path, '必须为 YYYY-MM-DD');
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  const ok =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  collector.check(ok, 'date.iso', path, '必须为有效日历日期');
  return ok;
}

export function validateIanaTimeZone(
  value: unknown,
  path: string,
  collector: ValidationCollector,
): value is string {
  if (typeof value !== 'string' || value.length === 0) {
    collector.add('timezone.iana', path, '必须为 IANA 时区名称');
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    collector.add('timezone.iana', path, '必须为有效 IANA 时区名称');
    return false;
  }
}

export function validateInteger(
  value: unknown,
  path: string,
  collector: ValidationCollector,
  min?: number,
  max?: number,
): value is number {
  const ok = typeof value === 'number' && Number.isInteger(value);
  collector.check(ok, 'number.integer', path, '必须为整数');
  if (!ok) return false;
  if (min !== undefined) collector.check(value >= min, 'number.min', path, `必须 ≥ ${min}`);
  if (max !== undefined) collector.check(value <= max, 'number.max', path, `必须 ≤ ${max}`);
  return true;
}

export function validateFiniteNumber(
  value: unknown,
  path: string,
  collector: ValidationCollector,
  minExclusive?: number,
): value is number {
  const ok = typeof value === 'number' && Number.isFinite(value);
  collector.check(ok, 'number.finite', path, '必须为有限数字');
  if (ok && minExclusive !== undefined) {
    collector.check(value > minExclusive, 'number.minExclusive', path, `必须 > ${minExclusive}`);
  }
  return ok;
}

export const SYNCABLE_BASE_KEYS = [
  'id',
  'createdAt',
  'updatedAt',
  'schemaVersion',
  'deletedAt',
  'deviceId',
  'syncedAt',
] as const;

/**
 * 写入来源模式：
 * - 'local'（默认）本地普通写入（含从未同步过的新建记录，以及编辑一条此前已同步过的既有记录）。
 *   deviceId/syncedAt 要么都是 null（从未同步过），要么都是此前 'sync' 写入落下的合法值——
 *   本地编辑命令一律靠展开既有实体对象带过这两个字段，不会主动清空它们，
 *   所以"编辑一条已同步过的记录"必须仍然通过校验，不能一刀切要求 null。
 * - 'sync' 同步写入（本地上传成功回写 syncedAt / 接收远端数据落地本地）。
 *   这类写入的本质就是"让这条记录此刻与远端同步"，故 deviceId/syncedAt 必须是合法非空值，
 *   且只有这类写入才允许把它们从 null 变成非空——本地写入路径本身不做这个转换。
 * 见 src/data/ADR-0034-sync-s1-device-identity-and-sync-write-mode.md、ADR-0035。
 */
export type SyncWriteMode = 'local' | 'sync';

/** 可同步实体公共字段校验；mode 默认 'local'。 */
export function validateSyncableBase(
  value: Record<string, unknown>,
  collector: ValidationCollector,
  mode: SyncWriteMode = 'local',
): void {
  validateUuidV7(value.id, 'id', collector);
  validateIsoDateTime(value.createdAt, 'createdAt', collector);
  validateIsoDateTime(value.updatedAt, 'updatedAt', collector);
  collector.check(
    value.schemaVersion === CURRENT_SCHEMA_VERSION,
    'schemaVersion.current',
    'schemaVersion',
    `Phase 1 普通写入必须为 ${CURRENT_SCHEMA_VERSION}`,
  );
  validateIsoDateTime(value.deletedAt, 'deletedAt', collector, true);
  if (mode === 'sync') {
    validateUuidV7(value.deviceId, 'deviceId', collector);
    validateIsoDateTime(value.syncedAt, 'syncedAt', collector);
  } else {
    const deviceIdIsNull = value.deviceId === null;
    const syncedAtIsNull = value.syncedAt === null;
    if (deviceIdIsNull && syncedAtIsNull) {
      // 从未同步过，Phase 1 原有口径：两者皆 null。
    } else {
      collector.check(
        !deviceIdIsNull,
        'sync.deviceId.pairing',
        'deviceId',
        'deviceId 与 syncedAt 必须同时为 null 或同时非空',
      );
      collector.check(
        !syncedAtIsNull,
        'sync.syncedAt.pairing',
        'syncedAt',
        'deviceId 与 syncedAt 必须同时为 null 或同时非空',
      );
      if (!deviceIdIsNull) validateUuidV7(value.deviceId, 'deviceId', collector);
      if (!syncedAtIsNull) validateIsoDateTime(value.syncedAt, 'syncedAt', collector);
    }
  }
}

export function validateStoredLocalDate(
  localDate: unknown,
  businessTime: unknown,
  timezone: unknown,
  collector: ValidationCollector,
): void {
  const validDate = validateIsoDate(localDate, 'localDate', collector);
  const validTime = validateIsoDateTime(businessTime, 'businessTime', collector);
  const validZone = validateIanaTimeZone(timezone, 'timezone', collector);
  if (
    validDate &&
    validTime &&
    validZone &&
    typeof businessTime === 'string' &&
    typeof timezone === 'string'
  ) {
    collector.check(
      localDate === deriveLocalDate(businessTime, timezone),
      'localDate.derived',
      'localDate',
      '必须由业务时间与记录 timezone 派生',
    );
  }
}
