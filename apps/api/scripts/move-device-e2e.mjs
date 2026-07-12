/**
 * E2E CANÓNICO del círculo device↔device del movimiento (P3 M-3.4).
 *
 *   device A (captura «Mover» offline) → servidor (regla única) → device A y device B
 *
 * A emite ÚNICAMENTE el event op de movimiento. El servidor crea exactamente un hecho
 * (proxy: un evento 'movement' en el timeline) y emite exactamente UN changeset
 * server-origin con el put de current_lot_id/current_paddock_id; A (emisor) y B
 * convergen ambos campos. Sin conflictos. Reprocesar no duplica hecho/timeline/changeset.
 * La resolución del nombre desde el catálogo local (sync.lots()) la cubre el unit de
 * M-3.2.b; aquí se verifican los DATOS que la habilitan (put trae current_lot_id +
 * bootstrap trae el lote con su nombre). Requiere la API corriendo.
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

// Cuenta CHANGESETS server-origin (device_id=null) que llevan el put de movimiento del animal.
const serverOriginMoveChangesets = (pull, animalId) =>
  (pull.changesets ?? []).filter(
    (c) => c.device_id === null && (c.ops ?? []).some((o) => o.table === 'animals' && o.rowId === animalId && o.kind === 'put' && o.fields && 'current_lot_id' in o.fields),
  );
const movePut = (pull, animalId) =>
  serverOriginMoveChangesets(pull, animalId).flatMap((c) => c.ops).find((o) => o.rowId === animalId && o.fields && 'current_lot_id' in o.fields);

async function main() {
  console.log('── E2E canónico device↔device del movimiento ──');
  TOKEN = (await api('POST', '/auth/login', { email: 'cowinance@gmail.com', password: 'cowinance' })).json?.access_token;
  check('login', !!TOKEN);

  const devA = (await api('POST', '/sync/devices', { platform: 'android', device_name: 'move-dev-A' })).json;
  const devB = (await api('POST', '/sync/devices', { platform: 'ios', device_name: 'move-dev-B' })).json;
  check('device A y B registrados', !!devA?.id && !!devB?.id);

  const paddocks = (await api('GET', '/paddocks')).json ?? [];
  const target = paddocks.find((p) => (p.lots ?? []).length > 0);
  const targetLot = target.lots[0].id;
  const targetPaddock = target.id;
  const targetLotName = target.lots[0].name;
  check('lote destino con potrero', !!targetLot && !!targetPaddock, `${targetLotName} @ ${target.name}`);

  const animal = (await api('POST', '/animals', { tag: `DEV-${Date.now() % 1_000_000}`, sex: 'F', category_code: 'vaca' })).json;
  const animalId = animal.id;
  check('animal creado (sin lote)', !!animalId);

  const before = (await api('GET', '/sync/state')).json;
  const baseCursor = before.server_cursor;
  const conflictsBefore = before.open_conflicts;

  // A emite ÚNICAMENTE el event op de movimiento (offline → push).
  const now = Date.now();
  const movementId = crypto.randomUUID();
  const changesetA = {
    device_id: devA.id,
    changesets: [
      {
        id: 'csDev1', deviceId: devA.id, seq: 1, hlc: hlc(now, devA.id, 1), schemaVersion: 1,
        ops: [
          { kind: 'event', table: 'animal_movements', rowId: movementId, hlc: hlc(now, devA.id, 0),
            row: { animal_id: animalId, to_lot_id: targetLot, reason: 'rotación', moved_at: new Date(now).toISOString() } },
        ],
      },
    ],
  };
  check('A emite exactamente UNA op, y es el event de movimiento',
    changesetA.changesets[0].ops.length === 1 && changesetA.changesets[0].ops[0].kind === 'event' && changesetA.changesets[0].ops[0].table === 'animal_movements');

  const pushA = await api('POST', '/sync/push', changesetA);
  check('push A aceptado, sin conflictos', pushA.json?.accepted === 1 && (pushA.json?.conflicts ?? []).length === 0, JSON.stringify(pushA.json));

  // Servidor: estado + exactamente un evento 'movement' (proxy del hecho único).
  const after = (await api('GET', `/animals/${animalId}`)).json;
  check('servidor: animal en el potrero destino', after?.current_paddock_id === targetPaddock, `${after?.current_paddock_id}`);
  const timeline = (await api('GET', `/animals/${animalId}/timeline`)).json ?? [];
  check('servidor: exactamente un evento movement en el timeline', timeline.filter((e) => e.event_type === 'movement').length === 1);

  // Exactamente UN changeset server-origin; A y B convergen lote + potrero.
  const pullB = (await api('GET', `/sync/pull?device_id=${devB.id}&cursor=${baseCursor}`)).json;
  const pullA = (await api('GET', `/sync/pull?device_id=${devA.id}&cursor=${baseCursor}`)).json;
  check('exactamente un changeset server-origin del movimiento (B)', serverOriginMoveChangesets(pullB, animalId).length === 1);
  const putB = movePut(pullB, animalId);
  const putA = movePut(pullA, animalId);
  check('B converge current_lot_id y current_paddock_id', putB?.fields?.current_lot_id === targetLot && putB?.fields?.current_paddock_id === targetPaddock, JSON.stringify(putB?.fields));
  check('A (emisor) converge current_lot_id y current_paddock_id', putA?.fields?.current_lot_id === targetLot && putA?.fields?.current_paddock_id === targetPaddock, JSON.stringify(putA?.fields));
  check('A no recibe su propio changeset de device', (pullA.changesets ?? []).every((c) => c.device_id !== devA.id));

  // Sin conflictos nuevos.
  const afterState = (await api('GET', '/sync/state')).json;
  check('sin conflictos nuevos', afterState.open_conflicts === conflictsBefore, `antes=${conflictsBefore} después=${afterState.open_conflicts}`);

  // Datos para la resolución del nombre desde el catálogo local (móvil, M-3.2.b).
  const boot = (await api('GET', `/sync/bootstrap?device_id=${devB.id}`)).json;
  const lotRow = (boot.rows ?? []).find((r) => r.table === 'lots' && r.rowId === targetLot);
  check('bootstrap incluye el lote destino con su nombre (para resolver current_lot_id → nombre)', lotRow?.state?.fields?.name === targetLotName, JSON.stringify(lotRow?.state?.fields));

  // Reprocesar/re-sincronizar no duplica hecho, timeline ni changeset.
  const retry = await api('POST', '/sync/push', changesetA);
  check('reproceso deduplicado (exactly-once)', retry.json?.accepted === 0 && retry.json?.deduped === 1, JSON.stringify(retry.json));
  const timeline2 = (await api('GET', `/animals/${animalId}/timeline`)).json ?? [];
  check('tras reproceso: sigue un solo evento movement', timeline2.filter((e) => e.event_type === 'movement').length === 1);
  const pullB2 = (await api('GET', `/sync/pull?device_id=${devB.id}&cursor=${baseCursor}`)).json;
  check('tras reproceso: sigue exactamente un changeset server-origin', serverOriginMoveChangesets(pullB2, animalId).length === 1);

  console.log(failures === 0 ? '\nE2E canónico device↔device: TODO OK ✓' : `\nE2E canónico device↔device: ${failures} fallas ✗`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E error:', e.message);
  process.exit(1);
});
