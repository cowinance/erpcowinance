/**
 * E2E de la agenda diaria (P4-1). GET /agenda devuelve los hechos accionables del hato
 * estructurados (severidad, due_at, acción semántica, caravana), reutilizando el motor
 * de alertas, ordenados por vencimiento, y SIN los ítems de sistema (sync). Requiere la
 * API corriendo (con datos demo).
 */
const API = process.env.API_URL ?? 'http://localhost:3001/v1';

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

const ACTIONS = new Set(['vaccinate', 'review_pregnancy', 'view_animal', 'complete_task']);
const CATS = new Set(['health', 'reproduction']);

async function main() {
  console.log('── E2E agenda diaria (GET /agenda) ──');
  TOKEN = (await api('POST', '/auth/login', { email: 'cowinance@gmail.com', password: 'cowinance' })).json?.access_token;
  check('login', !!TOKEN);

  const res = await api('GET', '/agenda');
  check('GET /agenda → 200', res.status === 200, `status=${res.status}`);
  const items = res.json ?? [];
  check('devuelve un array', Array.isArray(items), `n=${items.length}`);
  check('hay ítems de agenda (datos demo)', items.length > 0, `n=${items.length}`);

  // Forma de cada ítem.
  const shapeOk = items.every(
    (i) =>
      typeof i.code === 'string' &&
      CATS.has(i.category) &&
      ['info', 'warning', 'critical'].includes(i.severity) &&
      (i.due_at === null || typeof i.due_at === 'string') &&
      typeof i.title === 'string' &&
      ACTIONS.has(i.action) &&
      ('related_id' in i) &&
      ('tag' in i),
  );
  check('cada ítem tiene la forma estructurada (severidad, due_at, action, tag)', shapeOk, JSON.stringify(items[0]));

  // Sin ítems de sistema (sync).
  check('sin ítems de sistema (sync)', items.every((i) => i.category !== 'task' && !i.code.startsWith('sync_')));

  // Al menos un ítem con vencimiento y con acción de captura, si aplica.
  check('hay al menos un ítem con due_at', items.some((i) => i.due_at), '');

  // Orden por due_at ascendente (null al final).
  const keys = items.map((i) => i.due_at ?? '9999-12-31');
  let ordered = true;
  for (let n = 1; n < keys.length; n++) if (keys[n - 1] > keys[n]) ordered = false;
  check('ordenado por vencimiento (asc, null al final)', ordered);

  console.log(failures === 0 ? '\nE2E agenda: TODO OK ✓' : `\nE2E agenda: ${failures} fallas ✗`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E error:', e.message);
  process.exit(1);
});
