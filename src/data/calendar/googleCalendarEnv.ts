/** 网页 OAuth 客户端 ID。未配置时日历功能保持关闭，不影响本地使用。 */

export interface GoogleCalendarEnvSource {
  VITE_GOOGLE_CALENDAR_CLIENT_ID?: string;
}

function defaultEnv(): GoogleCalendarEnvSource {
  return (import.meta as unknown as { env?: GoogleCalendarEnvSource }).env ?? {};
}

function nonEmpty(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function getGoogleCalendarClientId(
  env: GoogleCalendarEnvSource = defaultEnv(),
): string | null {
  return nonEmpty(env.VITE_GOOGLE_CALENDAR_CLIENT_ID) ?? null;
}

export function isGoogleCalendarConfigured(
  env: GoogleCalendarEnvSource = defaultEnv(),
): boolean {
  return getGoogleCalendarClientId(env) !== null;
}
