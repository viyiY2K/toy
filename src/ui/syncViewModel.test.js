import { describe, expect, it } from 'vitest';
import { formatSyncStatusText } from './syncViewModel';

function syncResult({ configured = true, uploadError = null, downloadError = null } = {}) {
  return {
    configured,
    upload: {
      configured,
      entities: uploadError ? [{ store: 'tasks', error: uploadError }] : [{ store: 'tasks' }],
      events: { attempted: 0, succeeded: 0 },
    },
    download: {
      configured,
      entities: downloadError ? [{ store: 'tasks', error: downloadError }] : [{ store: 'tasks' }],
      events: { fetched: 0, applied: 0 },
    },
  };
}

describe('formatSyncStatusText (S7 sync view model)', () => {
  it('未配置同步时返回 null，完全不显示这一行', () => {
    expect(formatSyncStatusText('unconfigured', null)).toBeNull();
    expect(formatSyncStatusText('unconfigured', syncResult())).toBeNull();
  });

  it('已配置但未登录时提示数据只在本机', () => {
    expect(formatSyncStatusText('unauthenticated', null)).toBe('未登录，数据只存在本机');
  });

  it('已登录但还没跑过同步时提示等待首次同步', () => {
    expect(formatSyncStatusText('authenticated', null)).toBe('已登录，等待首次同步…');
  });

  it('同步结果 configured:false 时提示同步未生效', () => {
    expect(formatSyncStatusText('authenticated', syncResult({ configured: false }))).toBe('同步未生效');
  });

  it('上传或下载任一实体带 error 时提示遇到问题', () => {
    expect(formatSyncStatusText('authenticated', syncResult({ uploadError: 'boom' }))).toBe(
      '同步时遇到问题，稍后自动重试',
    );
    expect(formatSyncStatusText('authenticated', syncResult({ downloadError: 'boom' }))).toBe(
      '同步时遇到问题，稍后自动重试',
    );
  });

  it('一切正常时显示已同步', () => {
    expect(formatSyncStatusText('authenticated', syncResult())).toBe('已同步');
  });
});
