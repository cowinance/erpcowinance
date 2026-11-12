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
  /** Último token Expo confirmado con el servidor (P7 F2.a): optimización local de idempotencia,
   *  NO la fuente de verdad (el server puede reconciliarse en boot). */
  lastPushToken?: string;
  // Propiedad del store local (P1.3.6a): identidad dueña de los datos operativos
  // en este dispositivo. Se compara al iniciar sesión para no exponer/sincronizar
  // el store de un usuario/tenant bajo otra cuenta (aislamiento multi-tenant local).
  userId?: string;
  tenantId?: string;
  /**
   * Las organizaciones de esta persona, con su rol en cada una. Vienen en la respuesta del login.
   *
   * Se PERSISTEN —y no se piden al abrir el menú— porque el móvil trabaja sin señal: si la lista
   * dependiera de la red, el selector desaparecería justo en el potrero, que es donde se usa la
   * app. Es el mismo criterio que la zona horaria de la finca y las capacidades del rol.
   */
  organizations?: { tenant_id: string; name: string; role: string }[];
  farmId?: string;
  /**
   * La zona horaria de la finca (`organizations.timezone`), traída por el bootstrap.
   *
   * Se PERSISTE a propósito: sin eso habría que pedirla por red, y este dispositivo tiene que poder
   * fechar una carga parado en el potrero sin señal. Llega en el bootstrap, que es el momento en
   * que el teléfono adopta la finca, así que para cuando se puede capturar algo ya está.
   */
  farmTimeZone?: string;
  /**
   * Qué puede hacer este usuario, resuelto por el servidor y traído por el bootstrap.
   *
   * Se PERSISTE por el mismo motivo que `farmTimeZone`: el teléfono decide qué botones ofrecer
   * parado en el potrero, sin señal. Sin esto la app muestra las doce capturas a todo el mundo y un
   * operario que registra un servicio reproductivo se entera del 403 al volver la señal, con el
   * trabajo del día ya hecho.
   *
   * Es la matriz RESUELTA (capacidad → nivel), no el rol: traducir rol → permisos acá sería una
   * segunda copia de la matriz del servidor, y las dos copias se separan.
   *
   * **No es un control de seguridad.** Lo que impide escribir es el servidor, que revalida cada
   * push contra la misma matriz. Esto existe para no ofrecer lo que va a fallar.
   */
  capabilities?: Record<string, 'read' | 'write'>;
}

/**
 * Persistencia local del dispositivo. La implementación nativa (iOS/Android)
 * usa SQLite con escrituras incrementales por mutación; la web usa
 * AsyncStorage con snapshot (solo como harness de verificación).
 */
export interface DeviceStorage {
  /** Nombre visible en el Menú (diagnóstico). */
  readonly engine: string;
  /**
   * Cuántas mutaciones NO se pudieron escribir en disco desde que arrancó la app.
   *
   * La premisa entera de esta app es que lo capturado sobrevive en el dispositivo hasta que haya
   * señal. Las escrituras son asíncronas y nadie las espera —así es como la captura es instantánea
   * aunque la base esté ocupada—, de modo que un fallo (disco lleno, base bloqueada o corrupta) no
   * tiene a dónde llegar: la fila quedaba aplicada en memoria, visible en la pantalla, y moría al
   * cerrar la app sin que nada lo dijera.
   *
   * Un teléfono de campo con la memoria llena es lo normal, no lo excepcional. Si la premisa no se
   * puede cumplir, lo mínimo es decirlo.
   */
  readonly fallosDeEscritura: number;
  /**
   * Suscribe el aviso de fallo de escritura; devuelve la función de baja.
   *
   * Es un método y no una propiedad asignable a propósito: el almacenamiento vive en un
   * `useState` del provider y asignarle campos desde un efecto es mutar un valor de estado —
   * el compilador de React lo rechaza, y con razón.
   */
  alFallarEscritura(aviso: (fallos: number, detalle: string) => void): () => void;
  init(): Promise<void>;
  loadMeta(): Promise<PersistedMeta | null>;
  saveMeta(meta: PersistedMeta): Promise<void>;
  loadDevice(): Promise<SerializedDevice | null>;
  /** Suscribe el listener de mutaciones del dispositivo para persistir cambios. */
  attach(device: SyncDevice): void;
  reset(): Promise<void>;
}
