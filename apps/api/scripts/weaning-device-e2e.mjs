/**
 * E2E device→server del destete (P5-1.c).
 *
 *   device A (captura «Destete» offline) → servidor (regla única)
 *
 * A emite ÚNICAMENTE el event op de destete (event-only, con peso opcional). El servidor
 * materializa el hecho: una fila weanings (proxy: el conteo de destetes sube), el pesaje
 * asociado y UN evento 'weaning' de timeline. A diferencia de la mortalidad, el destete NO
 * modifica un campo autoritativo → NO hay changeset server-origin ni convergencia de put.
 * Reprocesar no duplica hecho/pesaje/timeline (exactly-once). Requiere la API corriendo.
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
const weaningCount = async () => (await api('GET', '/reproduction/kpis')).json?.weanings_12m?.n ?? 0;
const timelineCount = async (id, type) => ((await api('GET', `/animals/${id}/timeline`)).json ?? []).filter((e) => e.event_type === type).length;

async function main() {
  console.log('── E2E device→server del destete ──');
  TOKEN = (await api('POST', '/auth/login', { email: 'cowinance@gmail.com', password: 'cowinance' })).json?.access_token;
  check('login', !!TOKEN);

  const devA = (await api('POST', '/sync/devices', { platform: 'android', device_name: 'wean-dev-A' })).json;
  const devB = (await api('POST', '/sync/devices', { platform: 'ios', device_name: 'wean-dev-B' })).json;
  check('device A y B registrados', !!devA?.id && !!devB?.id);

  const animal = (await api('POST', '/animals', { tag: `WEAN-${Date.now() % 1_000_000}`, sex: 'M', category_code: 'ternero' })).json;
  const animalId = animal.id;
  check('animal creado (activo)', !!animalId);

  const before = (await api('GET', '/sync/state')).json;
  const baseCursor = before.server_cursor;
  const conflictsBefore = before.open_conflicts;
  const countBefore = await weaningCount();

  // A emite ÚNICAMENTE el event op de destete con peso (offline → push).
  const now = Date.now();
  const weaningId = crypto.randomUUID();
  const changesetA = {
    device_id: devA.id,
    changesets: [
      {
        id: 'csWean1', deviceId: devA.id, seq: 1, hlc: hlc(now, devA.id, 1), schemaVersion: 1,
        ops: [
          { kind: 'event', table: 'weanings', rowId: weaningId, hlc: hlc(now, devA.id, 0),
            row: { animal_id: animalId, weight_kg: 185, weaning_date: new Date(now).toISOString() } },
        ],
      },
    ],
  };
  check('A emite exactamente UNA op, y es el event de destete',
    changesetA.changesets[0].ops.length === 1 && changesetA.changesets[0].ops[0].kind === 'event' && changesetA.changesets[0].ops[0].table === 'weanings');

  const pushA = await api('POST', '/sync/push', changesetA);
  check('push A aceptado, sin conflictos', pushA.json?.accepted === 1 && (pushA.json?.conflicts ?? []).length === 0, JSON.stringify(pushA.json));

  // Servidor: hecho materializado (conteo +1) + exactamente un evento 'weaning'.
  check('servidor: conteo de destetes +1', (await weaningCount()) === countBefore + 1, `${countBefore} → ${await weaningCount()}`);
  check('servidor: exactamente un evento weaning en el timeline', (await timelineCount(animalId, 'weaning')) === 1);

  // Fact-only: el pull de B NO trae ningún changeset server-origin del destete.
  const pullB = (await api('GET', `/sync/pull?device_id=${devB.id}&cursor=${baseCursor}`)).json;
  const weaningServerOrigin = (pullB.changesets ?? []).filter(
    (c) => c.device_id === null && (c.ops ?? []).some((o) => o.table === 'weanings' || (o.table === 'animals' && o.rowId === animalId && o.kind === 'put')),
  );
  check('sin changeset server-origin para el destete (fact-only)', weaningServerOrigin.length === 0);

  // Sin conflictos nuevos.
  const afterState = (await api('GET', '/sync/state')).json;
  check('sin conflictos nuevos', afterState.open_conflicts === conflictsBefore, `antes=${conflictsBefore} después=${afterState.open_conflicts}`);

  // Reprocesar/re-sincronizar no duplica hecho, pesaje ni timeline.
  const retry = await api('POST', '/sync/push', changesetA);
  check('reproceso deduplicado (exactly-once)', retry.json?.accepted === 0 && retry.json?.deduped === 1, JSON.stringify(retry.json));
  check('tras reproceso: conteo de destetes sin cambios', (await weaningCount()) === countBefore + 1);
  check('tras reproceso: sigue un solo evento weaning', (await timelineCount(animalId, 'weaning')) === 1);

  console.log(failures === 0 ? '\nE2E device→server (destete): TODO OK ✓' : `\nE2E device→server (destete): ${failures} fallas ✗`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E error:', e.message);
  process.exit(1);
});
