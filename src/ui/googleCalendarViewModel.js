export function formatGoogleCalendarClock(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function formatGoogleCalendarStatus(prefs, { configured } = { configured: true }) {
  if (!configured) {
    return '还没配置网页用的 Google 客户端。需要的是「Web application」客户端 ID，不是桌面应用那份 JSON。';
  }
  if (!prefs.connected) return '还没连接 Google 日历';
  const target = '写入专用日历「番茄专注」，不会改你的主日历';
  if (!prefs.enabled) return `已连接，结束后写入已暂停。${target}`;
  if (prefs.lastError) return `已连接。上次写入失败：${prefs.lastError}`;
  if (prefs.lastSuccessAt) return `已连接。上次写入：${formatGoogleCalendarClock(prefs.lastSuccessAt)}`;
  return `已连接。专注结束或作废后会自动${target}`;
}

export function formatGoogleCalendarQueue(queueLength) {
  if (!Number.isInteger(queueLength) || queueLength <= 0) return null;
  return `还有 ${queueLength} 条没写出`;
}
