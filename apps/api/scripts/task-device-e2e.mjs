/**
 * E2E CANÓNICO del círculo device↔servidor↔device de tareas (P6-1.b.2).
 *
 * La tarea es una entidad MUTABLE sincronizada por put+LWW. Verifica:
 *  - A crea una tarea offline (put create) → B la recibe por pull del changeset de A.
 *  - B la completa offline (put done + completed_at) → A ve `done`, conservando el instante;
 *    la convergencia llega por el changeset de DEVICE de B (NO server-origin: sin eco, D2).
 *  - REST crea/completa → server-origin (device_id=null) → A y B convergen.
 *  - El bootstrap entrega las tareas pendientes.
 *  - Reprocesar el push del device es exactly-once (deduped).
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

// Encuentra el put de una tarea en un pull, devolviendo {op, device_id} del changeset que lo trae.
const findTaskPut = (pull, taskId, pred) =>
  (pull.changesets ?? [])
    .flatMap((c) => (c.ops ?? []).map((o) => ({ o, device_id: c.device_id })))
    .find((x) => x.o.table === 'tasks' && x.o.rowId === taskId && x.o.kind === 'put' && pred(x.o));

async function main() {
  console.log('── E2E canónico device↔servidor↔device de tareas ──');
  TOKEN = (await api('POST', '/auth/login', { email: 'cowinance@gmail.com', password: 'cowinance' })).json?.access_token;
  check('login', !!TOKEN);

  const devA = (await api('POST', '/sync/devices', { platform: 'android', device_name: 'task-dev-A' })).json;
  const devB = (await api('POST', '/sync/devices', { platform: 'ios', device_name: 'task-dev-B' })).json;
  check('device A y B registrados', !!devA?.id && !!devB?.id);

  const before = (await api('GET', '/sync/state')).json;
  const baseCursor = before.server_cursor;
  const conflictsBefore = before.open_conflicts;

  // ── Parte 1: A crea una tarea offline (put create) ─────────────────────────────
  const now = Date.now();
  const taskId1 = crypto.randomUUID();
  const createA = {
    device_id: devA.id,
    changesets: [
      {
        id: 'csTaskA', deviceId: devA.id, seq: 1, hlc: hlc(now, devA.id, 1), schemaVersion: 1,
        ops: [{ kind: 'put', table: 'tasks', rowId: taskId1, hlc: hlc(now, devA.id, 0), fields: { title: 'Arreglar molino', priority: 'high' } }],
      },
    ],
  };
  const pushA = await api('POST', '/sync/push', createA);
  check('push A (create) aceptado, sin conflictos', pushA.json?.accepted === 1 && (pushA.json?.conflicts ?? []).length === 0, JSON.stringify(pushA.json));

  const pullB1 = (await api('GET', `/sync/pull?device_id=${devB.id}&cursor=${baseCursor}`)).json;
  const createOnB = findTaskPut(pullB1, taskId1, () => true);
  check('B recibe la tarea creada por A (put en el changeset de device de A)', !!createOnB && createOnB.o.fields.title === 'Arreglar molino' && createOnB.device_id === devA.id, JSON.stringify(createOnB?.o?.fields));

  const pullA1 = (await api('GET', `/sync/pull?device_id=${devA.id}&cursor=${baseCursor}`)).json;
  check('A no recibe su propio changeset de creación', !findTaskPut(pullA1, taskId1, () => true));

  // ── Parte 2: B completa la tarea offline (put done + completed_at) ──────────────
  const at = new Date(now + 60_000).toISOString();
  const completeB = {
    device_id: devB.id,
    changesets: [
      {
        id: 'csTaskB', deviceId: devB.id, seq: 1, hlc: hlc(now + 60_000, devB.id, 1), schemaVersion: 1,
        ops: [{ kind: 'put', table: 'tasks', rowId: taskId1, hlc: hlc(now + 60_000, devB.id, 0), fields: { status: 'done', completed_at: at } }],
      },
    ],
  };
  const pushB = await api('POST', '/sync/push', completeB);
  check('push B (complete) aceptado, sin conflictos', pushB.json?.accepted === 1 && (pushB.json?.conflicts ?? []).length === 0, JSON.stringify(pushB.json));

  const pullA2 = (await api('GET', `/sync/pull?device_id=${devA.id}&cursor=${baseCursor}`)).json;
  const doneOnA = findTaskPut(pullA2, taskId1, (o) => o.fields.status === 'done');
  check('A ve la tarea completada, conservando el instante del device', !!doneOnA && doneOnA.o.fields.completed_at === at, JSON.stringify(doneOnA?.o?.fields));
  check('convergencia por changeset de DEVICE de B, sin eco server-origin', doneOnA?.device_id === devB.id, `device_id=${doneOnA?.device_id}`);

  // ── Parte 3: REST crea/completa → server-origin → A y B ────────────────────────
  const taskId2 = (await api('POST', '/tasks', { title: 'Tarea desde la web', priority: 'normal' })).json?.id;
  check('REST crea tarea', !!taskId2);
  const pullB3 = (await api('GET', `/sync/pull?device_id=${devB.id}&cursor=${baseCursor}`)).json;
  const restCreateOnB = findTaskPut(pullB3, taskId2, (o) => o.fields.status === 'pending');
  check('B converge la tarea creada por REST (server-origin, device_id=null)', !!restCreateOnB && restCreateOnB.device_id === null, JSON.stringify(restCreateOnB?.o?.fields));

  await api('POST', `/tasks/${taskId2}/complete`);
  const pullA3 = (await api('GET', `/sync/pull?device_id=${devA.id}&cursor=${baseCursor}`)).json;
  const restDoneOnA = findTaskPut(pullA3, taskId2, (o) => o.fields.status === 'done');
  check('A converge el completar por REST (server-origin)', !!restDoneOnA && restDoneOnA.device_id === null);

  // ── Parte 4: bootstrap entrega las tareas pendientes ───────────────────────────
  const taskId3 = (await api('POST', '/tasks', { title: 'Pendiente para bootstrap' })).json?.id;
  const boot = (await api('GET', `/sync/bootstrap?device_id=${devB.id}`)).json;
  const bootTask = (boot.rows ?? []).find((r) => r.table === 'tasks' && r.rowId === taskId3);
  check('bootstrap incluye la tarea pendiente con sus campos', bootTask?.state?.fields?.title === 'Pendiente para bootstrap' && bootTask?.state?.fields?.status === 'pending', JSON.stringify(bootTask?.state?.fields));

  // ── Sin conflictos nuevos + exactly-once ───────────────────────────────────────
  const afterState = (await api('GET', '/sync/state')).json;
  check('sin conflictos nuevos', afterState.open_conflicts === conflictsBefore, `antes=${conflictsBefore} después=${afterState.open_conflicts}`);

  const retry = await api('POST', '/sync/push', createA);
  check('reproceso del push de A deduplicado (exactly-once)', retry.json?.accepted === 0 && retry.json?.deduped === 1, JSON.stringify(retry.json));

  console.log(failures === 0 ? '\nE2E canónico device↔servidor↔device (tareas): TODO OK ✓' : `\nE2E canónico device↔servidor↔device (tareas): ${failures} fallas ✗`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E error:', e.message);
  process.exit(1);
});
