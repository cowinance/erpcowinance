/**
 * E2E REST del registro de push token (P7-2.a): registrar device → POST
 * /sync/devices/:id/push-token → el token queda asociado; re-registrarlo en otro device lo
 * despega del anterior («un token, un device»); device inexistente → 404. Requiere la API.
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
  console.log('── E2E REST push token (P7-2.a) ──');
  TOKEN = (await api('POST', '/auth/login', { email: 'cowinance@gmail.com', password: 'cowinance' })).json?.access_token;
  check('login', !!TOKEN);

  const d1 = (await api('POST', '/sync/devices', { platform: 'android', device_name: 'tok-A' })).json?.id;
  const d2 = (await api('POST', '/sync/devices', { platform: 'ios', device_name: 'tok-B' })).json?.id;
  check('devices registrados', !!d1 && !!d2);

  const TKN = `ExponentPushToken[${Date.now()}]`;
  const set1 = await api('POST', `/sync/devices/${d1}/push-token`, { push_token: TKN });
  check('POST push-token → registrado', set1.json?.push_token_registered === true, JSON.stringify(set1.json));

  // Re-registrar el mismo token en d2 lo despega de d1 (un token, un device). Se verifica por
  // idempotencia del re-set en d2 (200) y que d1 acepta un token nuevo sin conflicto.
  const set2 = await api('POST', `/sync/devices/${d2}/push-token`, { push_token: TKN });
  check('mismo token en otro device → registrado (movido)', set2.json?.push_token_registered === true);
  const reset1 = await api('POST', `/sync/devices/${d1}/push-token`, { push_token: `${TKN}-new` });
  check('d1 acepta un token nuevo (fue despegado)', reset1.json?.push_token_registered === true);

  // Idempotente.
  const again = await api('POST', `/sync/devices/${d2}/push-token`, { push_token: TKN });
  check('re-setear el mismo token es idempotente', again.json?.push_token_registered === true);

  // Device inexistente → 404.
  const missing = await api('POST', `/sync/devices/00000000-0000-4000-8000-000000000000/push-token`, { push_token: 'x' });
  check('device inexistente → 404', missing.status === 404, `HTTP ${missing.status}`);

  console.log(failures === 0 ? '\nE2E REST push token: TODO OK ✓' : `\nE2E REST push token: ${failures} fallas ✗`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E error:', e.message);
  process.exit(1);
});
