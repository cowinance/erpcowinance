/**
 * E2E CANÓNICO del círculo device↔device de la nota (P5-4.a).
 *
 *   device A (captura «Nota» offline) → servidor → device A y device B
 *
 * A emite ÚNICAMENTE el event op de la nota (animal_events, event_type='note'). A
 * diferencia de mortalidad (server-origin) y destete (fact-only), la nota converge por el
 * CANAL CRDT NORMAL: el propio event op viaja en el changeset de device de A y el pull de
 * B lo entrega (es el timeline). El servidor lo materializa con AnimalEventSyncHandler
 * (idempotente por op.rowId). A no recibe su propio changeset. Reprocesar no duplica.
 * Requiere la API corriendo.
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

// Op de nota (animal_events event_type='note') dentro de un changeset de device de `deviceId`.
const notePut = (pull, deviceId, animalId) =>
  (pull.changesets ?? [])
    .filter((c) => c.device_id === deviceId)
    .flatMap((c) => c.ops ?? [])
    .find((o) => o.kind === 'event' && o.table === 'animal_events' && o.row?.animal_id === animalId && o.row?.event_type === 'note');

async function main() {
  console.log('── E2E canónico device↔device de la nota ──');
  TOKEN = (await api('POST', '/auth/login', { email: 'cowinance@gmail.com', password: 'cowinance' })).json?.access_token;
  check('login', !!TOKEN);

  const devA = (await api('POST', '/sync/devices', { platform: 'android', device_name: 'note-dev-A' })).json;
  const devB = (await api('POST', '/sync/devices', { platform: 'ios', device_name: 'note-dev-B' })).json;
  check('device A y B registrados', !!devA?.id && !!devB?.id);

  const animal = (await api('POST', '/animals', { tag: `NOTE-${Date.now() % 1_000_000}`, sex: 'F', category_code: 'vaca' })).json;
  const animalId = animal.id;
  check('animal creado (activo)', !!animalId);

  const before = (await api('GET', '/sync/state')).json;
  const baseCursor = before.server_cursor;
  const conflictsBefore = before.open_conflicts;

  // A emite ÚNICAMENTE el event op de la nota (offline → push).
  const now = Date.now();
  const noteId = crypto.randomUUID();
  const TEXT = 'revisar cojera pata trasera';
  const changesetA = {
    device_id: devA.id,
    changesets: [
      {
        id: 'csNote1', deviceId: devA.id, seq: 1, hlc: hlc(now, devA.id, 1), schemaVersion: 1,
        ops: [
          { kind: 'event', table: 'animal_events', rowId: noteId, hlc: hlc(now, devA.id, 0),
            row: { animal_id: animalId, event_type: 'note', payload: { text: TEXT }, occurred_at: new Date(now).toISOString() } },
        ],
      },
    ],
  };
  check('A emite exactamente UNA op, y es el event de nota',
    changesetA.changesets[0].ops.length === 1 && changesetA.changesets[0].ops[0].kind === 'event' &&
    changesetA.changesets[0].ops[0].table === 'animal_events' && changesetA.changesets[0].ops[0].row.event_type === 'note');

  const pushA = await api('POST', '/sync/push', changesetA);
  check('push A aceptado, sin conflictos', pushA.json?.accepted === 1 && (pushA.json?.conflicts ?? []).length === 0, JSON.stringify(pushA.json));

  // Servidor: exactamente un evento 'note' con el texto en el timeline.
  const timeline = (await api('GET', `/animals/${animalId}/timeline`)).json ?? [];
  const notes = timeline.filter((e) => e.event_type === 'note');
  check('servidor: exactamente un evento note en el timeline', notes.length === 1);
  check('servidor: el texto de la nota se conserva', notes[0]?.payload?.text === TEXT, JSON.stringify(notes[0]?.payload));

  // Convergencia por CRDT: B recibe el changeset de device de A con el op de la nota; A no.
  const pullB = (await api('GET', `/sync/pull?device_id=${devB.id}&cursor=${baseCursor}`)).json;
  const pullA = (await api('GET', `/sync/pull?device_id=${devA.id}&cursor=${baseCursor}`)).json;
  const noteB = notePut(pullB, devA.id, animalId);
  check('B converge la nota (event op en el changeset de device de A)', !!noteB && noteB.row.payload.text === TEXT, JSON.stringify(noteB?.row?.payload));
  check('A no recibe su propio changeset de device', (pullA.changesets ?? []).every((c) => c.device_id !== devA.id));

  // Sin conflictos nuevos.
  const afterState = (await api('GET', '/sync/state')).json;
  check('sin conflictos nuevos', afterState.open_conflicts === conflictsBefore, `antes=${conflictsBefore} después=${afterState.open_conflicts}`);

  // Reprocesar/re-sincronizar no duplica la nota.
  const retry = await api('POST', '/sync/push', changesetA);
  check('reproceso deduplicado (exactly-once)', retry.json?.accepted === 0 && retry.json?.deduped === 1, JSON.stringify(retry.json));
  const timeline2 = (await api('GET', `/animals/${animalId}/timeline`)).json ?? [];
  check('tras reproceso: sigue un solo evento note', timeline2.filter((e) => e.event_type === 'note').length === 1);

  console.log(failures === 0 ? '\nE2E canónico device↔device (nota): TODO OK ✓' : `\nE2E canónico device↔device (nota): ${failures} fallas ✗`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E error:', e.message);
  process.exit(1);
});
