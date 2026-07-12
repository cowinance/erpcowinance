/**
 * E2E de convergencia CROSS-CANAL de tareas (P6-4.a): round-trip web(REST) ↔ móvil(device).
 *
 *   1. web→móvil:  REST crea T1 → el pull del device la trae (server-origin).
 *   2. móvil→web:  el device completa T1 (put) → GET /tasks la muestra `done` con el instante del device.
 *   3. móvil→web:  el device crea T2 (put) → GET /tasks la muestra `pending` (saneada a general).
 *   4. web→móvil:  REST cancela T2 → el pull del device la trae `canceled` (server-origin: el móvil
 *                  RECIBE una cancelación que no puede iniciar, D2).
 *   5. sin conflictos nuevos; exactly-once en reproceso.
 *
 * Complementa task-device-e2e (device↔device) verificando los dos canales de USUARIO. Requiere la API corriendo.
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

const findTaskPut = (pull, taskId, pred) =>
  (pull.changesets ?? [])
    .flatMap((c) => (c.ops ?? []).map((o) => ({ o, device_id: c.device_id })))
    .find((x) => x.o.table === 'tasks' && x.o.rowId === taskId && x.o.kind === 'put' && pred(x.o));
const listTask = async (taskId) => ((await api('GET', '/tasks')).json ?? []).find((t) => t.id === taskId);

async function main() {
  console.log('── E2E convergencia cross-canal de tareas (web ↔ móvil) ──');
  TOKEN = (await api('POST', '/auth/login', { email: 'cowinance@gmail.com', password: 'cowinance' })).json?.access_token;
  check('login', !!TOKEN);

  const devA = (await api('POST', '/sync/devices', { platform: 'android', device_name: 'xchan-dev-A' })).json;
  check('device A registrado', !!devA?.id);
  const baseCursor = (await api('GET', '/sync/state')).json.server_cursor;
  const conflictsBefore = (await api('GET', '/sync/state')).json.open_conflicts;

  // 1. web→móvil: REST crea T1 → el device la recibe por pull (server-origin).
  const t1 = (await api('POST', '/tasks', { title: 'Desde la web', priority: 'high' })).json?.id;
  check('REST crea T1', !!t1);
  const pull1 = (await api('GET', `/sync/pull?device_id=${devA.id}&cursor=${baseCursor}`)).json;
  const t1OnDevice = findTaskPut(pull1, t1, (o) => o.fields.status === 'pending');
  check('web→móvil: el device recibe T1 (server-origin, device_id=null)', !!t1OnDevice && t1OnDevice.device_id === null);

  // 2. móvil→web: el device completa T1 (put) → GET /tasks la muestra done con el instante del device.
  const at = new Date().toISOString();
  const completeT1 = {
    device_id: devA.id,
    changesets: [
      { id: 'csX1', deviceId: devA.id, seq: 1, hlc: hlc(Date.now(), devA.id, 1), schemaVersion: 1,
        ops: [{ kind: 'put', table: 'tasks', rowId: t1, hlc: hlc(Date.now(), devA.id, 0), fields: { status: 'done', completed_at: at } }] },
    ],
  };
  check('push complete T1 aceptado, sin conflictos', (await api('POST', '/sync/push', completeT1)).json?.accepted === 1);
  const t1Web = await listTask(t1);
  check('móvil→web: GET /tasks muestra T1 done con el completed_at del device', t1Web?.status === 'done' && new Date(t1Web?.completed_at).toISOString() === at, JSON.stringify({ status: t1Web?.status, completed_at: t1Web?.completed_at }));

  // 3. móvil→web: el device crea T2 (put) → GET /tasks la muestra pending (saneada a general).
  const t2 = crypto.randomUUID();
  const createT2 = {
    device_id: devA.id,
    changesets: [
      { id: 'csX2', deviceId: devA.id, seq: 2, hlc: hlc(Date.now(), devA.id, 3), schemaVersion: 1,
        ops: [{ kind: 'put', table: 'tasks', rowId: t2, hlc: hlc(Date.now(), devA.id, 2), fields: { title: 'Desde el campo', type: 'general', status: 'pending', priority: 'normal' } }] },
    ],
  };
  check('push create T2 aceptado, sin conflictos', (await api('POST', '/sync/push', createT2)).json?.accepted === 1);
  const t2Web = await listTask(t2);
  check('móvil→web: GET /tasks muestra T2 pending/general', t2Web?.status === 'pending' && t2Web?.type === 'general' && t2Web?.title === 'Desde el campo', JSON.stringify({ status: t2Web?.status, type: t2Web?.type }));

  // 4. web→móvil: REST cancela T2 → el device la recibe canceled (server-origin).
  check('REST cancela T2', (await api('POST', `/tasks/${t2}/cancel`)).json?.status === 'canceled');
  const pull4 = (await api('GET', `/sync/pull?device_id=${devA.id}&cursor=${baseCursor}`)).json;
  const t2Cancel = findTaskPut(pull4, t2, (o) => o.fields.status === 'canceled');
  check('web→móvil: el device recibe la cancelación de T2 (server-origin)', !!t2Cancel && t2Cancel.device_id === null);

  // 5. sin conflictos nuevos + exactly-once.
  check('sin conflictos nuevos', (await api('GET', '/sync/state')).json.open_conflicts === conflictsBefore);
  const retry = await api('POST', '/sync/push', createT2);
  check('reproceso del push del device deduplicado (exactly-once)', retry.json?.accepted === 0 && retry.json?.deduped === 1, JSON.stringify(retry.json));

  console.log(failures === 0 ? '\nE2E cross-canal (tareas): TODO OK ✓' : `\nE2E cross-canal (tareas): ${failures} fallas ✗`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E error:', e.message);
  process.exit(1);
});
