import type { SerializedDevice, SyncDevice } from '@cowinance/sync-core';

export interface PersistedMeta {
  serverDeviceId: string;
  farmName?: string;
  lastSyncAt?: string;
}

/**
 * Persistencia local del dispositivo. La implementación nativa (iOS/Android)
 * usa SQLite con escrituras incrementales por mutación; la web usa
 * AsyncStorage con snapshot (solo como harness de verificación).
 */
export interface DeviceStorage {
  /** Nombre visible en el Menú (diagnóstico). */
  readonly engine: string;
  init(): Promise<void>;
  loadMeta(): Promise<PersistedMeta | null>;
  saveMeta(meta: PersistedMeta): Promise<void>;
  loadDevice(): Promise<SerializedDevice | null>;
  /** Suscribe el listener de mutaciones del dispositivo para persistir cambios. */
  attach(device: SyncDevice): void;
  reset(): Promise<void>;
}
