import type { Session } from '../schema';

function isSessionLike(value: unknown): value is Session {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string'
    && typeof record.type === 'string'
    && typeof record.status === 'string'
    && Array.isArray(record.taskIds)
    && typeof record.startedAt === 'string'
    && typeof record.timezone === 'string';
}

/**
 * 从命令返回值里抽出可能刚结束的 Session。
 * 覆盖 completeFocus / discardFocus 的 `{ value }`，以及恢复流程的 source/extra session。
 */
export function collectSessionsFromCommandResult(result: unknown): Session[] {
  if (result == null || typeof result !== 'object') return [];
  const record = result as Record<string, unknown>;
  const found: Session[] = [];
  for (const candidate of [record, record.value, record.sourceSession, record.extraSession]) {
    if (!isSessionLike(candidate)) continue;
    if (found.some((session) => session.id === candidate.id)) continue;
    found.push(candidate);
  }
  return found;
}
