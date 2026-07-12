import { Logger } from '@nestjs/common';
import { PushTransportRequestError, type PushError, type PushMessage, type PushSendResult, type PushTransport } from './push-transport.port';

/**
 * Adapter real de Expo Push (P7-3.c.1). ÚNICA responsabilidad: recibir `PushMessage[]`,
 * dividir en sublotes ≤100, hacer los `fetch`, y traducir cada ticket a `PushSendResult`
 * conservando el `ref` (asociación por posición interna: ticket i ↔ mensaje i, expuesta como
 * ref). Clasifica permanente/temporal. LANZA `PushTransportRequestError` SOLO cuando falla el
 * request completo (sin resultado individual confiable). NO toca DB/deliveries/tokens/
 * reintentos/tenants/notificaciones/receipts (eso es del PushProcessor).
 *
 * Semántica: ticket `status='ok'` → `ok=true` = ACEPTADO por Expo, NO entregado al dispositivo
 * (la delivery pasará a `sent`, nunca a `delivered`). Los receipts (errores tardíos de entrega)
 * quedan fuera de alcance.
 *
 * No lee `process.env` (la config/wiring es de P7-3.c.2). `Host`/`Accept-Encoding` los maneja el
 * runtime HTTP: no se fijan a mano.
 */

const DEFAULT_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const MAX_BATCH = 100;
const MAX_PAYLOAD_BYTES = 4096;
const DEFAULT_TIMEOUT_MS = 20_000;
const EXPO_TOKEN_RE = /^Expo(nent)?PushToken\[[^\]]+\]$/;

export interface ExpoPushTransportOptions {
  accessToken?: string;
  /** Solo para inyección en tests. Por defecto, el endpoint oficial de Expo. */
  endpoint?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Traduce el `details.error` de un ticket a la clasificación neutral cerrada. */
function normalizeTicketError(code: string): { error: PushError; providerCode?: string; transient: boolean } {
  switch (code) {
    case 'DeviceNotRegistered':
      return { error: 'DeviceNotRegistered', transient: false };
    case 'MessageTooBig':
      return { error: 'MessageTooBig', transient: false };
    case 'MismatchSenderId':
      return { error: 'MismatchSenderId', transient: false };
    case 'InvalidCredentials':
      return { error: 'InvalidCredentials', transient: false };
    case 'MessageRateExceeded':
      return { error: 'MessageRateExceeded', transient: true };
    default:
      // Desconocido → conservador: temporal, conservando el código original para diagnóstico.
      return { error: 'ProviderError', providerCode: code, transient: true };
  }
}

export class ExpoPushTransport implements PushTransport {
  private readonly logger = new Logger(ExpoPushTransport.name);
  private readonly endpoint: string;
  private readonly accessToken?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ExpoPushTransportOptions = {}) {
    this.endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
    this.accessToken = opts.accessToken;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  async send(messages: PushMessage[]): Promise<PushSendResult[]> {
    const results: PushSendResult[] = [];
    const toSend: PushMessage[] = [];
    // Prevalidación LOCAL (restricciones objetivas del contrato; sin llamar a Expo).
    for (const m of messages) {
      const pre = this.prevalidate(m);
      if (pre) results.push(pre);
      else toSend.push(m);
    }
    // Sublotes secuenciales ≤100 (sin concurrencia). Cada sublote AÍSLA su resultado: un fallo
    // de request (HTTP/timeout/red/JSON) se normaliza a resultados individuales SOLO de ese
    // sublote — nunca pierde éxitos de otros sublotes ni cambia de semántica por posición.
    for (let i = 0; i < toSend.length; i += MAX_BATCH) {
      const batch = toSend.slice(i, i + MAX_BATCH);
      try {
        results.push(...(await this.sendBatch(batch)));
      } catch (e) {
        if (e instanceof PushTransportRequestError) {
          for (const m of batch) results.push({ ref: m.ref, ok: false, error: 'ProviderError', providerCode: e.code, transient: e.transient });
        } else {
          throw e; // fallo inesperado no normalizado (excepción interna): sin resultados confiables
        }
      }
    }
    return results;
  }

  /** Fallo individual permanente sin enviar, o null si el mensaje es válido para enviar. */
  private prevalidate(m: PushMessage): PushSendResult | null {
    if (!m.token || !EXPO_TOKEN_RE.test(m.token))
      return { ref: m.ref, ok: false, error: 'DeviceNotRegistered', providerCode: 'invalid_token_format', transient: false };
    // Tamaño del payload en BYTES UTF-8 (no string.length).
    const bytes = Buffer.byteLength(JSON.stringify(this.toExpoMessage(m)), 'utf8');
    if (bytes > MAX_PAYLOAD_BYTES) return { ref: m.ref, ok: false, error: 'MessageTooBig', providerCode: 'payload_too_big', transient: false };
    return null;
  }

  private toExpoMessage(m: PushMessage): Record<string, unknown> {
    return { to: m.token, title: m.title, body: m.body ?? undefined, data: m.data };
  }

  private async sendBatch(batch: PushMessage[]): Promise<PushSendResult[]> {
    if (!batch.length) return [];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
        },
        body: JSON.stringify(batch.map((m) => this.toExpoMessage(m))),
        signal: controller.signal,
      });
    } catch (e) {
      throw new PushTransportRequestError('network_or_timeout', true, String((e as Error).message)); // abort/timeout/red → temporal
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const transient = res.status === 429 || res.status >= 500; // 400 (payload/credenciales) → permanente
      throw new PushTransportRequestError(`http_${res.status}`, transient);
    }

    let json: { data?: unknown } | null;
    try {
      json = (await res.json()) as { data?: unknown };
    } catch {
      throw new PushTransportRequestError('invalid_json', true);
    }
    if (!json || !Array.isArray(json.data)) throw new PushTransportRequestError('no_tickets', true); // errors[] sin tickets confiables

    const tickets = json.data as Array<{ status?: string; details?: { error?: string } }>;
    const out: PushSendResult[] = [];
    for (let i = 0; i < batch.length; i++) {
      const t = tickets[i];
      if (!t) {
        // Falta ticket → temporal EXPLÍCITO (un resultado por cada mensaje recibido).
        out.push({ ref: batch[i].ref, ok: false, error: 'ProviderError', providerCode: 'provider_missing_result', transient: true });
      } else if (t.status === 'ok') {
        out.push({ ref: batch[i].ref, ok: true, transient: false });
      } else {
        const n = normalizeTicketError(t.details?.error ?? 'ProviderError');
        out.push({ ref: batch[i].ref, ok: false, error: n.error, providerCode: n.providerCode, transient: n.transient });
      }
    }
    if (tickets.length > batch.length) this.logger.warn(`Expo devolvió ${tickets.length} tickets para ${batch.length} mensajes (sobrantes ignorados)`);
    return out;
  }
}
