import type { SerializedDevice, SyncDevice } from '@cowinance/sync-core';
import type { CachedNotification } from './notification-cache';

/** Ítem de la agenda diaria (P4-2), espejo del AgendaItemDto del servidor. Snapshot
 *  opaco cacheado localmente (cache-on-sync); la UI (P4-3) lo renderiza y mapea `action`. */
export interface AgendaItem {
  code: string;
  category: string;
  severity: 'info' | 'warning' | 'critical';
  due_at: string | null;
  title: string;
  message: string;
  related_type: string | null;
  related_id: string | null;
  tag: string | null;
  action: 'vaccinate' | 'review_pregnancy' | 'view_animal' | 'complete_task';
}

export interface PersistedMeta {
  serverDeviceId?: string;
  farmName?: string;
  lastSyncAt?: string;
  accessToken?: string;
  refreshToken?: string;
  userName?: string;
  userEmail?: string;
  /** Snapshot de agenda cacheado (P4-2), refrescado en cada sync exitoso. */
  agenda?: AgendaItem[];
  agendaAt?: string;
  /** Feed in_app cacheado (P7-4.c) + read-set pendiente reconciliado offline. Solo campos
   *  del feed (nunca deliveries/tokens/canal push); serializable (arreglo, no Set). */
  notifications?: CachedNotification[];
  notificationsAt?: string;
  notificationReadPending?: string[];
  // Propiedad del store local (P1.3.6a): identidad dueña de los datos operativos
  // en este dispositivo. Se compara al iniciar sesión para no exponer/sincronizar
  // el store de un usuario/tenant bajo otra cuenta (aislamiento multi-tenant local).
  userId?: string;
  tenantId?: string;
  farmId?: string;
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
