import { Injectable } from '@nestjs/common';
import type { PushMessage, PushSendResult, PushTransport } from './push-transport.port';

/**
 * Transporte push FALSO para verificación headless (P7-3): sin red, sin credenciales de Expo.
 * Programable por `token` (o `ref`); por defecto todo `ok`. Registra los mensajes enviados
 * para aserciones (p. ej. «el reintento solo envía la entrega fallida»). El adapter real
 * (ExpoPushTransport) llega en P7-3.c; el procesador (P7-3.b) depende del PUERTO, no de éste.
 */
type Outcome = { ok: true } | { ok: false; error: PushSendResult['error']; transient: boolean };

@Injectable()
export class FakePushTransport implements PushTransport {
  /** Resultados programados por token; si no hay, se usa el default. */
  private readonly byToken = new Map<string, Outcome>();
  private defaultOutcome: Outcome = { ok: true };
  /** Historial de lo enviado (aplanado), para aserciones en tests. */
  readonly sent: PushMessage[] = [];

  program(token: string, outcome: Outcome): void {
    this.byToken.set(token, outcome);
  }
  setDefault(outcome: Outcome): void {
    this.defaultOutcome = outcome;
  }
  reset(): void {
    this.byToken.clear();
    this.defaultOutcome = { ok: true };
    this.sent.length = 0;
  }

  async send(messages: PushMessage[]): Promise<PushSendResult[]> {
    return messages.map((m) => {
      this.sent.push(m);
      const o = this.byToken.get(m.token) ?? this.defaultOutcome;
      return o.ok ? { ref: m.ref, ok: true, transient: false } : { ref: m.ref, ok: false, error: o.error, transient: o.transient };
    });
  }
}
