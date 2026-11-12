import { describe, it, expect } from 'vitest';
import { SyncDevice } from './device';
import type { PullResult, RemoteChangeset, PushResult } from './types';

/**
 * Apply de changesets de ORIGEN SERVIDOR en el cliente (P2 ola P-a, ADR-0016).
 * Un changeset server-origin viaja con `deviceId`/`seq` en null; el merge debe
 * aplicarlo por `ops`/`hlc` y avanzar el cursor, SIN exigir ni fabricar identidad
 * de dispositivo y sin lanzar.
 */

const noPush = async (): Promise<PushResult> => ({ accepted: 0, deduped: 0, conflicts: [], serverCursor: 0 });

describe('SyncDevice · apply de changeset de origen servidor (deviceId/seq null)', () => {
  it('aplica put y event, avanza el cursor, sin lanzar', async () => {
    const device = new SyncDevice('device-A');
    const serverCs: RemoteChangeset = {
      id: 'srv:1',
      deviceId: null,
      seq: null,
      hlc: '00000000000100:000000:server',
      schemaVersion: 1,
      ops: [
        { kind: 'put', table: 'animals', rowId: 'a1', fields: { visual_tag: '900', status: 'active' }, hlc: '00000000000100:000000:server' },
        { kind: 'event', table: 'weighings', rowId: 'w1', row: { weight_kg: 420 }, hlc: '00000000000100:000001:server' },
      ],
    };
    const transport = {
      push: noPush,
      pull: async (): Promise<PullResult> => ({ changesets: [{ serverSeq: 5, changeset: serverCs }], cursor: 5 }),
    };

    const result = await device.sync(transport);

    expect(result.pulled).toBe(1);
    expect(device.store.getRow('animals', 'a1')?.fields.visual_tag).toBe('900');
    expect(device.store.getRow('animals', 'a1')?.fields.status).toBe('active');
    expect(device.store.hasEvent('weighings', 'w1')).toBe(true);
    expect(device.serialize().cursor).toBe(5);
  });

  it('no fabrica identidad: un changeset server-origin vacío no lanza y avanza el cursor', async () => {
    const device = new SyncDevice('device-B');
    const cs: RemoteChangeset = { id: 'srv:2', deviceId: null, seq: null, hlc: '00000000000200:000000:server', schemaVersion: 1, ops: [] };
    const transport = {
      push: noPush,
      pull: async (): Promise<PullResult> => ({ changesets: [{ serverSeq: 9, changeset: cs }], cursor: 9 }),
    };
    await expect(device.sync(transport)).resolves.toEqual({ pushed: 0, pulled: 1 });
    expect(device.serialize().cursor).toBe(9);
  });
});

/**
 * Lo que NO se puede perder: la cola local.
 *
 * `sync()` vacía `pending` DESPUÉS de que el push resuelve. Esa línea de más abajo es toda la
 * garantía de que un servidor caído, un 500 o un teléfono sin señal no borran el trabajo del día,
 * y hasta acá no había nada que lo fijara: moverla unas líneas más arriba compila igual, pasa
 * todos los demás tests y hace desaparecer capturas en silencio.
 */
describe('SyncDevice · la cola sobrevive a un servidor que no responde', () => {
  const conCapturas = () => {
    const d = new SyncDevice('device-C');
    d.addEvent('weighings', 'w1', { animal_id: 'a1', weight_kg: 380 });
    d.commit();
    d.addEvent('treatments', 't1', { animal_id: 'a1' });
    d.commit();
    return d;
  };

  it('un push que falla deja la cola intacta', async () => {
    const d = conCapturas();
    expect(d.pendingCount).toBe(2);
    const transport = {
      push: async (): Promise<PushResult> => {
        throw new Error('push → 500');
      },
      pull: async (): Promise<PullResult> => ({ changesets: [], cursor: 0 }),
    };
    await expect(d.sync(transport)).rejects.toThrow('push → 500');
    expect(d.pendingCount).toBe(2);
  });

  it('lo que quedó sin confirmar también se preserva: sync lo cierra antes de intentar subir', async () => {
    const d = conCapturas();
    d.addEvent('vaccinations', 'v1', { animal_id: 'a1' }); // capturado y todavía sin commit
    const transport = {
      push: async (): Promise<PushResult> => {
        throw new Error('sin señal');
      },
      pull: async (): Promise<PullResult> => ({ changesets: [], cursor: 0 }),
    };
    await expect(d.sync(transport)).rejects.toThrow('sin señal');
    expect(d.pendingCount).toBe(3);
  });

  it('reintentar después del fallo sube exactamente lo mismo, sin duplicar ni perder', async () => {
    const d = conCapturas();
    const enviados: number[][] = [];
    let primeraVez = true;
    const transport = {
      push: async (changesets: { seq: number }[]): Promise<PushResult> => {
        enviados.push(changesets.map((c) => c.seq));
        if (primeraVez) {
          primeraVez = false;
          throw new Error('sin señal');
        }
        return { accepted: changesets.length, deduped: 0, conflicts: [], serverCursor: 1 };
      },
      pull: async (): Promise<PullResult> => ({ changesets: [], cursor: 1 }),
    };
    await expect(d.sync(transport)).rejects.toThrow('sin señal');
    await expect(d.sync(transport)).resolves.toEqual({ pushed: 2, pulled: 0 });
    expect(enviados).toEqual([
      [1, 2],
      [1, 2],
    ]);
    expect(d.pendingCount).toBe(0);
  });

  /** Un pull que falla llega después del push: lo aceptado ya está arriba y no debe reenviarse. */
  it('si falla el pull, no se reenvía lo que el servidor ya aceptó', async () => {
    const d = conCapturas();
    const transport = {
      push: async (changesets: { seq: number }[]): Promise<PushResult> => ({
        accepted: changesets.length,
        deduped: 0,
        conflicts: [],
        serverCursor: 1,
      }),
      pull: async (): Promise<PullResult> => {
        throw new Error('pull → 500');
      },
    };
    await expect(d.sync(transport)).rejects.toThrow('pull → 500');
    expect(d.pendingCount).toBe(0);
  });

  it('un restore desde disco conserva la cola, que es lo que sobrevive a cerrar la app', () => {
    const d = conCapturas();
    const revivido = SyncDevice.restore(d.serialize());
    expect(revivido.pendingCount).toBe(2);
    expect(revivido.pendingChangesets.map((c) => c.seq)).toEqual([1, 2]);
  });
});

/**
 * O-1 de la auditoría del ciclo sin señal (12-11-2026).
 *
 * `sync()` vaciaba la cola entera al volver del push, en vez de sacar lo que había enviado. Lo que
 * se capturaba mientras la radio subía lo anterior —el caso normal en un corral— desaparecía de la
 * cola sin haber viajado, y el contador pasaba a cero: la app decía «todo al día» sobre un registro
 * que el servidor nunca vio.
 */
describe('SyncDevice · capturar mientras la cola está subiendo', () => {
  const sinPull = async (): Promise<PullResult> => ({ changesets: [], cursor: 0 });

  it('lo capturado durante el push sigue en cola y sube en la siguiente vuelta', async () => {
    const d = new SyncDevice('dev-corral');
    const enviados: number[][] = [];
    let soltarLaRed!: () => void;
    const red = new Promise<void>((resolver) => (soltarLaRed = resolver));

    const transport = {
      push: async (changesets: { seq: number }[]): Promise<PushResult> => {
        // La foto del lote se toma acá, antes de esperar: es lo que realmente viaja.
        enviados.push(changesets.map((c) => c.seq));
        await red;
        return { accepted: changesets.length, deduped: 0, conflicts: [], serverCursor: 1 };
      },
      pull: sinPull,
    };

    d.addEvent('weighings', 'w1', { weight_kg: 400 });
    d.commit();

    const enVuelo = d.sync(transport);
    // El peón no espera a la radio: pesa el siguiente animal.
    d.addEvent('weighings', 'w2', { weight_kg: 410 });
    d.commit();
    soltarLaRed();
    await enVuelo;

    expect(enviados[0]).toEqual([1]); // la primera subida llevó solo la pesada que existía
    expect(d.pendingCount).toBe(1); // la segunda NO se borró
    expect(d.pendingChangesets.map((c) => c.seq)).toEqual([2]);

    const segunda = await d.sync(transport);
    expect(segunda.pushed).toBe(1);
    expect(enviados[1]).toEqual([2]);
    expect(d.pendingCount).toBe(0);
  });

  it('el aviso de descarte a disco nombra solo los changesets que viajaron', async () => {
    const d = new SyncDevice('dev-corral');
    const descartados: number[][] = [];
    let soltarLaRed!: () => void;
    const red = new Promise<void>((resolver) => (soltarLaRed = resolver));
    d.listener = (m) => {
      if (m.kind === 'flushed') descartados.push(m.seqs);
    };

    const transport = {
      push: async (changesets: { seq: number }[]): Promise<PushResult> => {
        await red;
        return { accepted: changesets.length, deduped: 0, conflicts: [], serverCursor: 1 };
      },
      pull: sinPull,
    };

    d.addEvent('weighings', 'w1', { weight_kg: 400 });
    d.commit();
    const enVuelo = d.sync(transport);
    d.addEvent('weighings', 'w2', { weight_kg: 410 });
    d.commit();
    soltarLaRed();
    await enVuelo;

    // Si el borrado en disco incluyera el 2, el registro moriría también al reiniciar la app.
    expect(descartados).toEqual([[1]]);
  });

  it('dos syncs concurrentes no dejan nada atrás', async () => {
    const d = new SyncDevice('dev-corral');
    const recibidos: number[] = [];
    const transport = {
      push: async (changesets: { seq: number }[]): Promise<PushResult> => {
        await new Promise((resolver) => setTimeout(resolver, 10));
        for (const c of changesets) recibidos.push(c.seq);
        return { accepted: changesets.length, deduped: 0, conflicts: [], serverCursor: 1 };
      },
      pull: sinPull,
    };

    d.addEvent('weighings', 'w1', { weight_kg: 400 });
    d.commit();
    const a = d.sync(transport);
    d.addEvent('weighings', 'w2', { weight_kg: 410 });
    d.commit();
    const b = d.sync(transport);
    await Promise.all([a, b]);

    expect(d.pendingCount).toBe(0);
    expect([...new Set(recibidos)].sort()).toEqual([1, 2]);
  });
});
