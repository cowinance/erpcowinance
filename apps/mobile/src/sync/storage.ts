/**
 * Adaptador WEB (react-native-web): AsyncStorage con snapshot debounced.
 * Es el harness de verificación en navegador; los dispositivos reales usan
 * el adaptador SQLite (storage.native.ts), que Metro resuelve automáticamente.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SerializedDevice, SyncDevice } from '@cowinance/sync-core';
import type { DeviceStorage, PersistedMeta } from './storage.types';

const DEVICE_KEY = 'cowinance.device.v1';
const META_KEY = 'cowinance.meta.v1';

export function createStorage(): DeviceStorage {
  let device: SyncDevice | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (!device) return;
    AsyncStorage.setItem(DEVICE_KEY, JSON.stringify(device.serialize())).catch(() => {});
  };

  return {
    engine: 'AsyncStorage (web)',
    async init() {},
    async loadMeta() {
      const raw = await AsyncStorage.getItem(META_KEY);
      return raw ? (JSON.parse(raw) as PersistedMeta) : null;
    },
    async saveMeta(meta) {
      await AsyncStorage.setItem(META_KEY, JSON.stringify(meta));
    },
    async loadDevice() {
      const raw = await AsyncStorage.getItem(DEVICE_KEY);
      return raw ? (JSON.parse(raw) as SerializedDevice) : null;
    },
    attach(d) {
      device = d;
      d.listener = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(flush, 400);
      };
    },
    async reset() {
      device = null;
      await AsyncStorage.multiRemove([DEVICE_KEY, META_KEY]);
    },
  };
}
