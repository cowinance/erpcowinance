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

export type PushError = 'DeviceNotRegistered' | 'MessageTooBig' | 'MessageRateExceeded' | 'ProviderError' | 'Unknown';

export interface PushSendResult {
  ref: string;
  ok: boolean;
  error?: PushError;
  /** true → reintentar con backoff; false → permanente (o éxito). */
  transient: boolean;
}

export interface PushTransport {
  send(messages: PushMessage[]): Promise<PushSendResult[]>;
}

/** Token DI del puerto (el módulo lo liga a un adapter: Fake en tests, Expo en prod). */
export const PUSH_TRANSPORT = Symbol('PUSH_TRANSPORT');
