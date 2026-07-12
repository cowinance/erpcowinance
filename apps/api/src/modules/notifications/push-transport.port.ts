/**
 * Puerto NEUTRAL de transporte push (P7-3). Desacopla el motor/procesador del SDK o API de
 * Expo: trabaja sobre mensajes INDIVIDUALES (uno por entrega), aunque el adapter los agrupe
 * en lotes internamente. `ref` = `notification_deliveries.id` → `PushSendResult.ref` debe
 * corresponder EXACTAMENTE al `ref` para persistir cada resultado sin depender del orden del
 * proveedor.
 *
 * `sent` (fase de tickets, P7-3): el proveedor ACEPTÓ el mensaje y devolvió un ticket
 * exitoso — NO significa entrega confirmada al dispositivo (eso lo dará el receipt checking,
 * diferido). Los códigos permanentes (p. ej. DeviceNotRegistered) no se reintentan; los
 * transitorios sí, con backoff.
 */

export interface PushMessage {
  /** notification_deliveries.id — identidad estable de la entrega. */
  ref: string;
  token: string;
  title: string;
  body: string | null;
  data?: Record<string, unknown>;
}

/**
 * Clasificación NEUTRAL y CERRADA del error por mensaje: no se filtra el detalle arbitrario
 * de Expo al contrato interno. El código original del proveedor va aparte en `providerCode`
 * (diagnóstico), sin debilitar el tipado. El `PushProcessor` solo especial-casa
 * `DeviceNotRegistered`; el resto se decide por `transient`.
 */
export type PushError = 'DeviceNotRegistered' | 'MessageTooBig' | 'MismatchSenderId' | 'InvalidCredentials' | 'MessageRateExceeded' | 'ProviderError';

export interface PushSendResult {
  ref: string;
  ok: boolean;
  error?: PushError;
  /** Código original del proveedor (Expo) cuando `error='ProviderError'` o para trazabilidad. */
  providerCode?: string;
  /** true → reintentar con backoff; false → permanente (o éxito). */
  transient: boolean;
}

/**
 * Fallo del REQUEST COMPLETO (no de un mensaje individual): HTTP 4xx/5xx, timeout/red, JSON
 * inválido o `errors[]` sin tickets confiables. No se fabrican resultados por posición. El
 * `PushProcessor` (P7-3.c.2) respetará `transient`: temporal → backoff del sublote; permanente
 * → las deliveries del sublote a `failed`.
 */
export class PushTransportRequestError extends Error {
  constructor(
    readonly code: string,
    readonly transient: boolean,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'PushTransportRequestError';
  }
}

export interface PushTransport {
  send(messages: PushMessage[]): Promise<PushSendResult[]>;
}

/** Token DI del puerto (el módulo lo liga a un adapter: Fake en tests, Expo en prod). */
export const PUSH_TRANSPORT = Symbol('PUSH_TRANSPORT');
