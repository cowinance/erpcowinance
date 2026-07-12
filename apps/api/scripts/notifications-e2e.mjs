/**
 * E2E REST del motor de notificaciones (P7-1). Verifica: GET /notifications genera
 * read-through notificaciones in_app `delivered` desde las alertas del hato y las lista;
 * GET /notifications/unread-count refleja las no leídas; POST /notifications/:id/read marca
 * `read` (y el conteo baja); una 2da lectura NO duplica (dedup). Requiere la API corriendo.
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

async function main() {
  console.log('── E2E REST notificaciones (P7-1) ──');
  TOKEN = (await api('POST', '/auth/login', { email: 'cowinance@gmail.com', password: 'cowinance' })).json?.access_token;
  check('login', !!TOKEN);

  const feed1 = (await api('GET', '/notifications')).json ?? [];
  check('GET /notifications genera y lista notificaciones', Array.isArray(feed1) && feed1.length > 0, `${feed1.length} ítems`);
  check('todas in_app delivered, sin read_at', feed1.every((n) => n.status === 'delivered' && n.read_at === null));

  const count1 = (await api('GET', '/notifications/unread-count')).json?.count ?? 0;
  check('unread-count = tamaño del feed no leído', count1 === feed1.length, `${count1}`);

  // 2da lectura: dedup (no crea nuevas).
  const feed2 = (await api('GET', '/notifications')).json ?? [];
  check('2da lectura no duplica (dedup)', feed2.length === feed1.length, `${feed1.length} → ${feed2.length}`);

  // Marcar una como leída.
  const target = feed1[0];
  const read = await api('POST', `/notifications/${target.id}/read`);
  check('POST /:id/read → status read', read.json?.status === 'read', JSON.stringify(read.json));
  const count2 = (await api('GET', '/notifications/unread-count')).json?.count ?? 0;
  check('unread-count baja en 1', count2 === count1 - 1, `${count1} → ${count2}`);

  // read→read idempotente.
  const readAgain = await api('POST', `/notifications/${target.id}/read`);
  check('re-marcar leída es no-op (read)', readAgain.json?.status === 'read');

  console.log(failures === 0 ? '\nE2E REST notificaciones: TODO OK ✓' : `\nE2E REST notificaciones: ${failures} fallas ✗`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E error:', e.message);
  process.exit(1);
});
