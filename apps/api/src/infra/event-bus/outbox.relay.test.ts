import { describe, it, expect, vi } from 'vitest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DbService } from '../../db/db.service';
import { OutboxRelay } from './outbox.relay';

/**
 * Prueba de cableado del Outbox relay (F5, ADR-0005): drena filas no
 * publicadas, las emite al bus, y marca published_at SOLO tras un emit
 * exitoso (at-least-once). Con mocks — sin DB ni timer reales.
 */
function makeRelay(rows: Array<{ id: string; type: string; payload: unknown }>, emitImpl?: () => Promise<unknown>) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      return sql.includes('SELECT') ? rows : [];
    }),
  } as unknown as DbService;
  const emitAsync = vi.fn(emitImpl ?? (async () => [true]));
  const emitter = { emitAsync } as unknown as EventEmitter2;
  return { relay: new OutboxRelay(db, emitter), queries, emitAsync };
}

describe('OutboxRelay · drena la outbox hacia el bus', () => {
  it('emite cada fila pendiente y la marca publicada', async () => {
    const { relay, queries, emitAsync } = makeRelay([
      { id: 'e1', type: 'treatment.applied.v1', payload: { eventId: 'e1' } },
    ]);

    await relay.drain();

    expect(emitAsync).toHaveBeenCalledWith('treatment.applied.v1', { eventId: 'e1' });
    const updates = queries.filter((q) => q.sql.includes('UPDATE event_outbox'));
    expect(updates).toHaveLength(1);
    expect(updates[0].params).toEqual(['e1']);
  });

  it('at-least-once: si el consumidor lanza, NO marca publicada (se reintenta)', async () => {
    const { relay, queries } = makeRelay(
      [{ id: 'e1', type: 'treatment.applied.v1', payload: {} }],
      async () => {
        throw new Error('consumidor falló');
      },
    );

    await relay.drain(); // no debe propagar

    const updates = queries.filter((q) => q.sql.includes('UPDATE event_outbox'));
    expect(updates).toHaveLength(0);
  });

  it('sin filas pendientes no emite nada', async () => {
    const { relay, emitAsync } = makeRelay([]);
    await relay.drain();
    expect(emitAsync).not.toHaveBeenCalled();
  });

  it('ticks superpuestos no se procesan en paralelo (guard de reentrada)', async () => {
    // emit lento para forzar solapamiento
    let resolveEmit: () => void = () => {};
    const slow = () => new Promise<unknown>((r) => (resolveEmit = () => r([true])));
    const { relay, emitAsync } = makeRelay([{ id: 'e1', type: 't', payload: {} }], slow);

    const first = relay.drain(); // toma el lock, queda esperando el emit
    await relay.drain(); // reentrada: debe retornar sin emitir de nuevo
    resolveEmit();
    await first;

    expect(emitAsync).toHaveBeenCalledTimes(1);
  });
});
