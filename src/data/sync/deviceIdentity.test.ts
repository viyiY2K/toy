import { describe, expect, it } from 'vitest';
import { getOrCreateDeviceId, type DeviceIdentityStorage } from './deviceIdentity';

const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function memoryStorage(): DeviceIdentityStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe('getOrCreateDeviceId (S1 device identity)', () => {
  it('首次调用生成合法 UUID v7 并持久化', () => {
    const storage = memoryStorage();
    const id = getOrCreateDeviceId(storage);
    expect(UUID_V7_RE.test(id)).toBe(true);
    expect(storage.getItem('pomodoro:deviceId')).toBe(id);
  });

  it('同一 storage 重复调用恒返回同一个值', () => {
    const storage = memoryStorage();
    const first = getOrCreateDeviceId(storage);
    const second = getOrCreateDeviceId(storage);
    expect(second).toBe(first);
  });

  it('不同 storage（模拟不同设备）各自生成不同的 deviceId', () => {
    const a = getOrCreateDeviceId(memoryStorage());
    const b = getOrCreateDeviceId(memoryStorage());
    expect(a).not.toBe(b);
  });

  it('已存在的值即使不是合法 UUID 也原样返回，不覆盖既有内容', () => {
    const storage = memoryStorage();
    storage.setItem('pomodoro:deviceId', 'legacy-value');
    expect(getOrCreateDeviceId(storage)).toBe('legacy-value');
  });

  it('没有可用 storage 时抛出明确错误，而不是静默生成一次性 id', () => {
    expect(() => getOrCreateDeviceId(undefined)).toThrow(/storage/);
  });
});
