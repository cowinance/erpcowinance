/**
 * Formas de datos del motor offline-first y contrato del contexto.
 *
 * Viven aparte de `SyncContext.tsx` por una razón práctica: las pantallas importan `AnimalRow`,
 * `TaskRow` y compañía, y antes eso obligaba a cargar el provider entero —con React, el store y
 * el transporte— para usar un tipo. Acá no hay nada ejecutable: solo interfaces.
 */
import type { Op } from '@cowinance/sync-core';
import type { AgendaItem } from './storage.types';
import type { CachedNotification } from './notification-cache';

/** Forma cruda de un changeset en la respuesta de pull (wire, snake_case). */
export interface PulledChangesetWire {
  server_seq: number;
  device_id: string | null;
  seq: number | null;
  hlc: string;
  id: string;
  schema_version: number;
  ops: Op[];
}

export interface AnimalRow {
  id: string;
  tag?: string;
  name?: string;
  status?: string;
  sex?: string;
  category?: string;
  /** Lote actual (sincronizable). El nombre se resuelve del catálogo por este id. */
  current_lot_id?: string | null;
  lot_name?: string;
  last_weight_kg?: number;
  last_weighed_at?: string;
  /**
   * Derivados de SOLO LECTURA que manda el servidor para la tarjeta de manga (retiro vigente y
   * casos clínicos abiertos). El dispositivo nunca los pone en un put: los recalcula el servidor.
   * Lo que el dispositivo capturó offline se combina aparte — ver `effectiveWithdrawal`.
   */
  meat_withdrawal_until?: string | null;
  milk_withdrawal_until?: string | null;
  open_cases?: number;
  case_severity?: string | null;
}

export interface VetProduct {
  id: string;
  name: string;
  type: string;
  withdrawal_meat_days?: number;
  withdrawal_milk_hours?: number;
  default_dose?: string;
}

/** Lote del catálogo local (P3 M-3.1): destino de movimientos, usable 100% offline. */
export interface LotRow {
  id: string;
  name: string;
  current_paddock_id: string | null;
  paddock_name: string | null;
}

export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  type: string;
  status: string;
  due_date: string | null;
  priority: string;
  related_type: string | null;
  related_id: string | null;
  /** Responsable (sincroniza vía TASK_SYNC_FIELDS). Permite filtrar «asignadas a mí» offline. */
  assigned_to: string | null;
}

export interface LocalPregnancy {
  id: string;
  animal_id: string;
  status: string;
  diagnosis_date?: string;
  expected_due_date?: string;
}

export interface PendingItem {
  seq: number;
  summary: string;
  tag?: string;
}

export interface ServerConflict {
  id: string;
  conflict_type: string;
  entity_type: string;
  detail: string;
  tag?: string;
  created_at: string;
  resolution?: string;
  resolved_at?: string;
}

export interface AnimalEventRow {
  id: string;
  type: string;
  at: string;
  data: Record<string, unknown>;
}

export interface SyncCtx {
  status: 'boot' | 'login' | 'ready' | 'error';
  errorMsg?: string;
  userName?: string;
  userEmail?: string;
  /** Id del usuario logueado: filtra «asignadas a mí» sin red. */
  userId?: string;
  /**
   * Fetch autenticado (Bearer + rotación de refresh + 401→login). Expuesto para
   * que la capa de cuenta (AccountContext) reutilice el MISMO mecanismo de auth
   * al leer /auth/me — sin un segundo flujo de refresh ni tocar el store de sync.
   */
  authFetch: (path: string, init?: RequestInit) => Promise<Response>;
  login: (email: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;
  /** Fincas de esta persona con su rol en cada una. Una sola (o ninguna) = no hay nada que elegir. */
  organizations: { tenant_id: string; name: string; role: string }[];
  /** Finca en la que está la sesión. La usa el selector para marcar cuál es la actual. */
  tenantId?: string;
  /** Cambia de finca: descarta el store local y vuelve a bootstrapear. `null` = salió bien. */
  switchOrganization: (tenantId: string) => Promise<string | null>;
  farmName?: string;
  /** Zona con la que se fecha en este dispositivo. `null` = todavía la del teléfono. */
  farmTimeZone: string | null;
  lastSyncAt?: string;
  lastSyncResult?: string;
  storageEngine: string;
  /**
   * Escrituras locales que no entraron al disco, con el motivo de la última. Null es lo normal.
   *
   * Mientras no sea null, lo capturado en esta sesión puede estar SOLO en memoria: se ve en la
   * pantalla y se puede sincronizar, pero no sobrevive a cerrar la app.
   */
  falloDePersistencia: { fallos: number; detalle: string } | null;
  pendingCount: number;
  offlineSim: boolean;
  syncing: boolean;
  version: number;
  animals: (query?: string) => AnimalRow[];
  animal: (id: string) => AnimalRow | null;
  animalEvents: (id: string) => AnimalEventRow[];
  findByTag: (tag: string) => AnimalRow | null;
  products: (type?: 'vaccine' | 'other') => VetProduct[];
  bulls: () => AnimalRow[];
  lots: () => LotRow[];
  /** Tareas locales (bootstrap pendientes + completadas en sesión), 100% offline (P6-3). */
  tasks: () => TaskRow[];
  /** Crea una tarea offline (put sobre tasks; el servidor sanea a general/pending). */
  captureTaskCreate: (title: string, opts?: { dueDate?: string | null; priority?: string }) => void;
  /** Completa una tarea offline (put status='done' + completed_at del device). */
  captureTaskComplete: (taskId: string) => void;
  /** Inicia una tarea offline (put status='in_progress'). */
  captureTaskStart: (taskId: string) => void;
  /** Cancela una tarea offline (put status='canceled'). */
  captureTaskCancel: (taskId: string) => void;
  /** Reprograma offline (put due_date, sin cambio de estado). `null` = sin fecha. */
  captureTaskReschedule: (taskId: string, dueDate: string | null) => void;
  /** Asigna/desasigna responsable offline (put assigned_to). `null` = desasignar. */
  captureTaskAssign: (taskId: string, assignedTo: string | null) => void;
  /** Agenda diaria cacheada (P4-2), usable offline; `agendaAt` = cuándo se refrescó. */
  agenda: () => AgendaItem[];
  agendaAt?: string;
  /** Feed in_app cacheado (P7-4.c), vista reconciliada (snapshot + read-set), usable offline. */
  notifications: () => CachedNotification[];
  /** Conteo de no leídas sobre la vista reconciliada (misma fuente que `notifications()`). */
  unreadNotifications: () => number;
  /** Cuándo se refrescó el snapshot del feed in_app. */
  notificationsAt?: string;
  /** Marca leída (optimista + persistente) y hace POST /read best-effort; no navega. */
  markNotificationRead: (id: string) => Promise<void>;
  /** Refresca el feed in_app (flush de reads pendientes + GET), reutilizable al enfocar la pantalla. */
  refreshNotifications: () => Promise<void>;
  /** Id del device registrado en el servidor (para asociar el token de push). */
  serverDeviceId?: string;
  /** Último token Expo confirmado con el servidor (optimización local de idempotencia). */
  pushLastToken?: string;
  /** Sincroniza el token Expo con el servidor (POST push-token + persiste lastPushToken). */
  syncPushToken: (token: string) => Promise<void>;
  /** Refresca el feed in_app con anti-ráfaga (debounce trailing); para pushes en foreground. */
  scheduleNotificationsRefresh: () => void;
  openPregnancy: (animalId: string) => LocalPregnancy | null;
  /**
   * ¿Este usuario puede hacerlo? Resuelto con la matriz que trajo el bootstrap, así que contesta
   * SIN SEÑAL — que es cuando la app tiene que decidir qué ofrecer.
   *
   * No es un control de seguridad: el servidor revalida cada push contra la misma matriz. Sirve
   * para no ofrecer un botón que guarda una captura offline destinada a ser rechazada.
   *
   * Sin capacidades conocidas (bootstrap viejo, guardado antes de que esto existiera) devuelve
   * `true`: es preferible ofrecer de más y que el servidor rechace, a dejar una app instalada sin
   * ningún botón después de actualizar.
   */
  puede: (cap: string, access?: 'read' | 'write') => boolean;
  /**
   * Fin de retiro EFECTIVO de un animal: lo que dijo el servidor combinado con los tratamientos
   * que este dispositivo capturó sin señal. Gana el más lejano — un tratamiento aplicado recién en
   * la manga extiende el retiro, y quedarse con el dato del servidor diría que el animal ya está
   * apto cuando no lo está.
   */
  withdrawalOf: (animalId: string) => { meat: string | null; milk: string | null };
  captureWeighing: (animalId: string, kg: number, cc?: number) => void;
  captureVaccination: (animalId: string, productId: string, dose?: number, batch?: string) => void;
  captureTreatment: (animalId: string, productId: string, dose?: number, route?: string) => { meatUntil: string | null };
  captureHeat: (animalId: string) => void;
  captureService: (animalId: string, method: 'ai' | 'natural', sireId?: string) => void;
  captureDiagnosis: (animalId: string, result: 'pregnant' | 'empty') => { expectedDue?: string };
  captureCalving: (damId: string, calf: { sex: 'F' | 'M'; tag?: string }) => { calfId: string };
  /** Alta rápida en el corral: put sobre `animals` con id del dispositivo, igual que la cría de un
   *  parto. El servidor (AnimalSyncHandler) resuelve category_code→category_id, inserta la caravana
   *  visual y marca conflicto si ya existía. Las categorías salen del rodeo bajado, no de una lista
   *  escrita en la app: son un catálogo editable por finca. */
  captureNewAnimal: (a: {
    tag: string;
    sex: 'F' | 'M';
    categoryCode: string;
    categoryLabel: string;
    origin: 'born' | 'purchased';
    lotId?: string | null;
  }) => { animalId: string };
  /** Las categorías que la finca usa de verdad, para el selector del alta. */
  categoriesInUse: () => { code: string; label: string }[];
  /** Mueve un animal a un lote (o lo saca: toLotId=null). Emite SOLO el event op de
   *  animal_movements (event-only, M-3.2.a); el servidor deriva el potrero y converge. */
  captureMovement: (animalId: string, toLotId: string | null, reason?: string) => void;
  /** Baja por muerte (P5-2): emite SOLO el event op de mortalities (event-only, Patrón B);
   *  el servidor autora hecho + status='dead' + timeline y converge por server-origin. */
  captureMortality: (animalId: string, notes?: string) => void;
  /** Destete (P5-2): emite SOLO el event op de weanings; el servidor materializa
   *  atómicamente el hecho, el pesaje determinista (si hay peso) y el timeline. */
  captureWeaning: (animalId: string, weightKg?: number) => void;
  /** Nota libre (P5-2): un event op sobre animal_events (event_type='note'); no emite vacías. */
  captureNote: (animalId: string, text: string) => void;
  pendingDetail: () => PendingItem[];
  fetchConflicts: () => Promise<ServerConflict[] | { error: string }>;
  resolveConflict: (conflictId: string) => Promise<boolean>;
  syncNow: () => Promise<{ pushed: number; pulled: number } | { error: string }>;
  setOfflineSim: (v: boolean) => void;
  resetLocal: () => Promise<void>;
}
