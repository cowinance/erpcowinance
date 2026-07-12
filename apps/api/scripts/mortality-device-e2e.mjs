/**
 * E2E CANÓNICO del círculo device↔device de la mortalidad (P5-1.b).
 *
 *   device A (captura «Baja» offline) → servidor (regla única) → device A y device B
 *
 * A emite ÚNICAMENTE el event op de mortalidad (event-only). El servidor escribe
 * atómicamente: la fila mortalities, status='dead', el timeline 'death' y UN changeset
 * server-origin con el put { status: 'dead' }; A (emisor) y B convergen el estado. Sin
 * conflictos. Reprocesar no duplica hecho/timeline/changeset. Requiere la API corriendo.
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

// Cuenta CHANGESETS server-origin (device_id=null) que llevan el put de mortalidad (status='dead') del animal.
const serverOriginDeathChangesets = (pull, animalId) =>
  (pull.changesets ?? []).filter(
    (c) => c.device_id === null && (c.ops ?? []).some((o) => o.table === 'animals' && o.rowId === animalId && o.kind === 'put' && o.fields && o.fields.status === 'dead'),
  );
const deathPut = (pull, animalId) =>
  serverOriginDeathChangesets(pull, animalId).flatMap((c) => c.ops).find((o) => o.rowId === animalId && o.fields && o.fields.status === 'dead');

async function main() {
  console.log('── E2E canónico device↔device de la mortalidad ──');
  TOKEN = (await api('POST', '/auth/login', { email: 'cowinance@gmail.com', password: 'cowinance' })).json?.access_token;
  check('login', !!TOKEN);

  const devA = (await api('POST', '/sync/devices', { platform: 'android', device_name: 'mort-dev-A' })).json;
  const devB = (await api('POST', '/sync/devices', { platform: 'ios', device_name: 'mort-dev-B' })).json;
  check('device A y B registrados', !!devA?.id && !!devB?.id);

  const animal = (await api('POST', '/animals', { tag: `MORT-${Date.now() % 1_000_000}`, sex: 'F', category_code: 'vaca' })).json;
  const animalId = animal.id;
  check('animal creado (activo)', !!animalId);

  const before = (await api('GET', '/sync/state')).json;
  const baseCursor = before.server_cursor;
  const conflictsBefore = before.open_conflicts;

  // A emite ÚNICAMENTE el event op de mortalidad (offline → push).
  const now = Date.now();
  const mortalityId = crypto.randomUUID();
  const changesetA = {
    device_id: devA.id,
    changesets: [
      {
        id: 'csDeath1', deviceId: devA.id, seq: 1, hlc: hlc(now, devA.id, 1), schemaVersion: 1,
        ops: [
          { kind: 'event', table: 'mortalities', rowId: mortalityId, hlc: hlc(now, devA.id, 0),
            row: { animal_id: animalId, died_at: new Date(now).toISOString(), necropsy: false, notes: 'campo' } },
        ],
      },
    ],
  };
  check('A emite exactamente UNA op, y es el event de mortalidad',
    changesetA.changesets[0].ops.length === 1 && changesetA.changesets[0].ops[0].kind === 'event' && changesetA.changesets[0].ops[0].table === 'mortalities');

  const pushA = await api('POST', '/sync/push', changesetA);
  check('push A aceptado, sin conflictos', pushA.json?.accepted === 1 && (pushA.json?.conflicts ?? []).length === 0, JSON.stringify(pushA.json));

  // Servidor: status='dead' + exactamente un evento 'death' (proxy del hecho único).
  const after = (await api('GET', `/animals/${animalId}`)).json;
  check('servidor: animal en status dead', after?.status === 'dead', `${after?.status}`);
  const timeline = (await api('GET', `/animals/${animalId}/timeline`)).json ?? [];
  check('servidor: exactamente un evento death en el timeline', timeline.filter((e) => e.event_type === 'death').length === 1);

  // Exactamente UN changeset server-origin; A y B convergen status='dead'.
  const pullB = (await api('GET', `/sync/pull?device_id=${devB.id}&cursor=${baseCursor}`)).json;
  const pullA = (await api('GET', `/sync/pull?device_id=${devA.id}&cursor=${baseCursor}`)).json;
  check('exactamente un changeset server-origin de la mortalidad (B)', serverOriginDeathChangesets(pullB, animalId).length === 1);
  const putB = deathPut(pullB, animalId);
  const putA = deathPut(pullA, animalId);
  check('B converge status=dead', putB?.fields?.status === 'dead', JSON.stringify(putB?.fields));
  check('A (emisor) converge status=dead', putA?.fields?.status === 'dead', JSON.stringify(putA?.fields));
  check('A no recibe su propio changeset de device', (pullA.changesets ?? []).every((c) => c.device_id !== devA.id));

  // Sin conflictos nuevos.
  const afterState = (await api('GET', '/sync/state')).json;
  check('sin conflictos nuevos', afterState.open_conflicts === conflictsBefore, `antes=${conflictsBefore} después=${afterState.open_conflicts}`);

  // Reprocesar/re-sincronizar no duplica hecho, timeline ni changeset.
  const retry = await api('POST', '/sync/push', changesetA);
  check('reproceso deduplicado (exactly-once)', retry.json?.accepted === 0 && retry.json?.deduped === 1, JSON.stringify(retry.json));
  const timeline2 = (await api('GET', `/animals/${animalId}/timeline`)).json ?? [];
  check('tras reproceso: sigue un solo evento death', timeline2.filter((e) => e.event_type === 'death').length === 1);
  const pullB2 = (await api('GET', `/sync/pull?device_id=${devB.id}&cursor=${baseCursor}`)).json;
  check('tras reproceso: sigue exactamente un changeset server-origin', serverOriginDeathChangesets(pullB2, animalId).length === 1);

  console.log(failures === 0 ? '\nE2E canónico device↔device (mortalidad): TODO OK ✓' : `\nE2E canónico device↔device (mortalidad): ${failures} fallas ✗`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E error:', e.message);
  process.exit(1);
});
