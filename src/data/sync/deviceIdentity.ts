/**
 * 本机设备身份（S1，多端同步地基）。
 *
 * deviceId 不是任何可同步实体的字段值，而是"这台设备本身"的本地环境标识——
 * 不进 IndexedDB（IndexedDB 存的是跨端共享的实体记录），只存本机 localStorage。
 * ID 生成复用全数据层单一入口 newId()（红线 1），不得自行 import uuid。
 */

import { newId } from '../id';

const DEVICE_ID_STORAGE_KEY = 'pomodoro:deviceId';

/** deviceIdentity 依赖的最小 storage 契约，便于测试注入内存实现替代真实 localStorage。 */
export interface DeviceIdentityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): DeviceIdentityStorage | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage;
}

/**
 * 读取本机 deviceId；不存在则生成一个新的 UUID v7 并持久化。
 * 同一台设备（同一浏览器 storage）重复调用恒返回同一个值。
 */
export function getOrCreateDeviceId(
  storage: DeviceIdentityStorage | undefined = defaultStorage(),
): string {
  if (!storage) throw new Error('deviceIdentity: 当前环境没有可用的本地 storage');
  const existing = storage.getItem(DEVICE_ID_STORAGE_KEY);
  if (existing !== null) return existing;
  const id = newId();
  storage.setItem(DEVICE_ID_STORAGE_KEY, id);
  return id;
}
