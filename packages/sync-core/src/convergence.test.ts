import { describe, it, expect } from 'vitest';
import { SyncDevice } from './device';
import { SyncServerCore } from './server';

/**
 * Gate rápido de convergencia (la simulación exhaustiva de 2000 escenarios
 * vive en `npm run sim`). Verifica que varios dispositivos editando offline
 * en simultáneo llegan todos al MISMO estado que el servidor.
 */
function connect(server: SyncServerCore) {
  return {
    push: (cs: Parameters<SyncServerCore['push']>[0]) => server.push(cs),
    pull: (after: number, exclude?: string) => server.pull(after, exclude),
  };
}

describe('convergencia', () => {
  it('dos dispositivos: LWW por campo + evento inmutable convergen', async () => {
    const server = new SyncServerCore();
    const t = connect(server);
    let logical = 0;
    const A = new SyncDevice('A', () => 1000 + ++logical);
    const B = new SyncDevice('B', () => 5000 + ++logical); // reloj adelantado

    A.setFields('animals', 'x', { visual_tag: '100', name: 'de A', status: 'active' });
    A.addEvent('weighings', 'w1', { animal_id: 'x', weight_kg: 400 });
    A.commit();
    B.setFields('animals', 'x', { name: 'de B' }); // gana B (HLC mayor por reloj adelantado)
    B.commit();

    await A.sync(t);
    await B.sync(t);
    await A.sync(t); // A recibe lo de B

    expect(A.store.fingerprint()).toBe(server.store.fingerprint());
    expect(B.store.fingerprint()).toBe(server.store.fingerprint());
    expect(A.store.getRow('animals', 'x')?.fields.name).toBe('de B');
  });

  it('reintento del mismo push se deduplica (exactly-once)', async () => {
    const server = new SyncServerCore();
    const A = new SyncDevice('A', (() => { let n = 0; return () => 1000 + ++n; })());
    A.setFields('animals', 'y', { visual_tag: '200', status: 'active' });
    const cs = A.commit()!;

    const r1 = server.push([cs]);
    const r2 = server.push([cs]); // reintento idéntico
    expect(r1.accepted).toBe(1);
    expect(r2.accepted).toBe(0);
    expect(r2.deduped).toBe(1);
  });

  it('tres dispositivos con estados terminales concurrentes: convergen y se registra el conflicto', async () => {
    const server = new SyncServerCore();
    const t = connect(server);
    let logical = 0;
    const devs = [new SyncDevice('A', () => 1000 + ++logical), new SyncDevice('B', () => 1000 + ++logical), new SyncDevice('C', () => 1000 + ++logical)];

    devs[0].setFields('animals', 'z', { visual_tag: '300', status: 'active' });
    devs[0].commit();
    await devs[0].sync(t);
    for (const d of devs) await d.sync(t);

    // dos muertes/ventas concurrentes de nodos distintos
    devs[0].setFields('animals', 'z', { status: 'dead' });
    devs[0].commit();
    devs[1].setFields('animals', 'z', { status: 'sold' });
    devs[1].commit();

    for (const d of devs) await d.sync(t);
    for (const d of devs) await d.sync(t);
    await devs[0].sync(t);

    const fp = server.store.fingerprint();
    for (const d of devs) expect(d.store.fingerprint()).toBe(fp);
    expect(server.conflicts.some((c) => c.type === 'semantic')).toBe(true);
  });
});
