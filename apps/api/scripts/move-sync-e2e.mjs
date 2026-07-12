/**
 * E2E del canal sync ENTRANTE de movimientos (P3 M-1.c.2). Un dispositivo A pushea
 * un changeset con UN `event` op de `animal_movements`; el servidor lo aplica por la
 * regla única (recordMovement, origin='sync') y el movimiento se propaga por pull al
 * dispositivo B — sin changeset server-origin adicional. Verifica también idempotencia
 * en el reintento y que una intención incoherente genera un conflicto sin escritura
 * parcial. Requiere la API corriendo.
 *
 * Nota: aquí solo se verifica que B RECIBE el event op; la aplicación en el store
 * local del cliente (converger lote/potrero) pertenece a M-3, no se afirma todavía.
 * La exactitud a nivel DB (una fila animal_movements, HLC almacenado = HLC del op) la
 * cubre el test de integración de M-1.c.1; aquí se cubre el contrato HTTP push/pull.
 */
const API = process.env.API_URL ?? 'http://localhost:3001/v1';
const hlc = (ms, node, count = 0) => `${String(ms).padStart(14, '0')}:${count.toString(16).padStart(6, '0')}:${node}`;

let TOKEN = null;
async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

async function main() {
  console.log('── E2E movimiento por sync (device A push → server → pull B) ──');
  TOKEN = (await api('POST', '/auth/login', { email: 'cowinance@gmail.com', password: 'cowinance' })).json?.access_token;
  check('login', !!TOKEN);

  const devA = (await api('POST', '/sync/devices', { platform: 'android', device_name: 'move-sync-A' })).json;
  const devB = (await api('POST', '/sync/devices', { platform: 'ios', device_name: 'move-sync-B' })).json;
  check('dispositivos registrados', !!devA?.id && !!devB?.id);

  // Destino: un lote ubicado en un potrero (el potrero se deriva del lote) + otro potrero distinto.
  const paddocks = (await api('GET', '/paddocks', undefined)).json ?? [];
  const target = paddocks.find((p) => (p.lots ?? []).length > 0);
  check('hay un lote destino con potrero', !!target, target && `${target.lots[0].name} @ ${target.name}`);
  const otherPaddock = paddocks.find((p) => p.id !== target?.id);
  const targetLot = target.lots[0].id;
  const targetPaddock = target.id;

  // Animal fresco (sin lote/potrero) para mover de forma controlada.
  const animal = (await api('POST', '/animals', { tag: `MS-${Date.now() % 1_000_000}`, sex: 'F', category_code: 'vaca' })).json;
  check('animal creado (sin lote)', !!animal?.id);
  const animalId = animal.id;

  const now = Date.now();
  const movementId = crypto.randomUUID();
  const opHlc = hlc(now, devA.id, 0);
  const changesetA = {
    device_id: devA.id,
    changesets: [
      {
        id: 'csMove1', deviceId: devA.id, seq: 1, hlc: hlc(now, devA.id, 1), schemaVersion: 1,
        ops: [
          { kind: 'event', table: 'animal_movements', rowId: movementId, hlc: opHlc,
            row: { animal_id: animalId, to_lot_id: targetLot, reason: 'destete', moved_at: new Date(now).toISOString() } },
        ],
      },
    ],
  };

  // 1) Push de A: el servidor aplica el movimiento por la regla única.
  const pushA = await api('POST', '/sync/push', changesetA);
  check('push A aceptado, sin conflictos', pushA.json?.accepted === 1 && (pushA.json?.conflicts ?? []).length === 0, JSON.stringify(pushA.json));

  // 2) El estado actual del animal quedó actualizado (potrero derivado del lote).
  const after = (await api('GET', `/animals/${animalId}`)).json;
  check('el animal quedó en el potrero destino', after?.current_paddock_id === targetPaddock, `${after?.current_paddock_id}`);

  // 3) Exactamente un evento 'movement' en el timeline (proxy HTTP del hecho único).
  const timeline = (await api('GET', `/animals/${animalId}/timeline`)).json ?? [];
  const movEvents = timeline.filter((e) => e.event_type === 'movement');
  check('exactamente un evento movement en el timeline', movEvents.length === 1, `n=${movEvents.length}`);

  // 4) Pull de B: recibe el changeset ORIGINAL de A con el event op.
  const pullB = (await api('GET', `/sync/pull?device_id=${devB.id}&cursor=0`)).json;
  const fromA = (pullB.changesets ?? []).find(
    (c) => c.device_id === devA.id && (c.ops ?? []).some((o) => o.table === 'animal_movements' && o.rowId === movementId),
  );
  check('B recibe el event op de movimiento de A', !!fromA, `changesets=${pullB.changesets?.length}`);

  // 5) NO se emitió un changeset server-origin para el movimiento (device_id=null con el nuevo potrero).
  const serverOriginMove = (pullB.changesets ?? [])
    .filter((c) => c.device_id === null)
    .flatMap((c) => c.ops ?? [])
    .some((o) => o.table === 'animals' && o.rowId === animalId && o.fields?.current_paddock_id === targetPaddock);
  check('sin changeset server-origin para el movimiento (origin=sync)', !serverOriginMove);

  // 6) A no recibe su propio changeset.
  const pullA = (await api('GET', `/sync/pull?device_id=${devA.id}&cursor=0`)).json;
  check('A no recibe sus propios changesets', (pullA.changesets ?? []).every((c) => c.device_id !== devA.id));

  // 7) Reintento del mismo changeset → dedupe exactly-once; el timeline no se duplica.
  const retry = await api('POST', '/sync/push', changesetA);
  check('reintento deduplicado', retry.json?.accepted === 0 && retry.json?.deduped === 1, JSON.stringify(retry.json));
  const timeline2 = (await api('GET', `/animals/${animalId}/timeline`)).json ?? [];
  check('el timeline sigue con un solo movement (idempotente)', timeline2.filter((e) => e.event_type === 'movement').length === 1);

  // 8) Intención incoherente (lote destino + OTRO potrero) → conflicto semántico, sin escritura parcial.
  if (otherPaddock) {
    const badChangeset = {
      device_id: devA.id,
      changesets: [
        {
          id: 'csMoveBad', deviceId: devA.id, seq: 2, hlc: hlc(now + 1000, devA.id, 1), schemaVersion: 1,
          ops: [
            { kind: 'event', table: 'animal_movements', rowId: crypto.randomUUID(), hlc: hlc(now + 1000, devA.id, 0),
              row: { animal_id: animalId, to_lot_id: targetLot, to_paddock_id: otherPaddock.id, reason: 'x' } },
          ],
        },
      ],
    };
    const bad = await api('POST', '/sync/push', badChangeset);
    check('incoherencia → conflicto semántico', (bad.json?.conflicts ?? []).some((c) => c.type === 'semantic'), JSON.stringify(bad.json?.conflicts));
    const afterBad = (await api('GET', `/animals/${animalId}`)).json;
    check('sin escritura parcial: el animal sigue en el potrero destino', afterBad?.current_paddock_id === targetPaddock, `${afterBad?.current_paddock_id}`);
  }

  console.log(failures === 0 ? '\nE2E movimiento por sync: TODO OK ✓' : `\nE2E movimiento por sync: ${failures} fallas ✗`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E error:', e.message);
  process.exit(1);
});
