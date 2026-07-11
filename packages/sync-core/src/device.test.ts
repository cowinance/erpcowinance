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
