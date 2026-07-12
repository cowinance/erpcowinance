import { Injectable } from '@nestjs/common';
import type { PushMessage, PushSendResult, PushTransport } from './push-transport.port';

/**
 * Transporte push DESHABILITADO en runtime (P7-3.b). Liga `PUSH_TRANSPORT` en el módulo
 * mientras no exista un adapter real (Expo llega en P7-3.c). NO simula envío ni marca nada
 * como `sent`: si alguien invoca el procesador con `PUSH_ENABLED=false`, `send()` LANZA
 * `push_transport_disabled` (el fallo total libera las entregas con backoff, no las pierde).
 * El poller no arranca con push deshabilitado; los tests inyectan `FakePushTransport` explícito.
 */
@Injectable()
export class DisabledPushTransport implements PushTransport {
  async send(_messages: PushMessage[]): Promise<PushSendResult[]> {
    throw new Error('push_transport_disabled');
  }
}
