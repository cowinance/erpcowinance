/**
 * E2E de identidad y aislamiento multi-tenant:
 *  1. Sin token → 401 en toda la API
 *  2. Login de Jose (Grupo La Esperanza) y María (El Ombú)
 *  3. Cada tenant ve SOLO sus animales (RLS + contexto por request)
 *  4. Acceso cruzado por id → 404 (la RLS oculta la fila)
 *  5. Rotación de refresh: usar dos veces el mismo refresh revoca la sesión
 *  6. /auth/me devuelve el actor y su organización
 */
const API = process.env.API_URL ?? 'http://localhost:3001/v1';

async function api(method, path, body, token) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
  console.log('── E2E identidad + RLS ──');

  // 1. Sin token
  const noAuth = await api('GET', '/animals');
  check('sin token → 401', noAuth.status === 401);
  const badToken = await api('GET', '/dashboard/kpis', undefined, 'token-falso');
  check('token inválido → 401', badToken.status === 401);

  // 2. Logins
  const jose = (await api('POST', '/auth/login', { email: 'cowinance@gmail.com', password: 'cowinance' })).json;
  check('login Jose', !!jose?.access_token, jose?.user?.name);
  const maria = (await api('POST', '/auth/login', { email: 'maria@elombu.com', password: 'ombu1234' })).json;
  check('login María', !!maria?.access_token, maria?.user?.name);
  const wrong = await api('POST', '/auth/login', { email: 'cowinance@gmail.com', password: 'incorrecta' });
  check('password incorrecta → 401', wrong.status === 401);

  // 3. Aislamiento por tenant
  const herdA = (await api('GET', '/animals?limit=200', undefined, jose.access_token)).json;
  const herdB = (await api('GET', '/animals?limit=200', undefined, maria.access_token)).json;
  check('Jose ve su hato (~60)', herdA.data.length > 50, `${herdA.data.length} animales`);
  check('María ve SOLO El Ombú (5)', herdB.data.length === 5, `${herdB.data.length} animales`);
  const tagsB = herdB.data.map((a) => a.tag).sort();
  check('los animales de María son los 501-505', tagsB.join(',') === '501,502,503,504,505', tagsB.join(','));

  // 4. Acceso cruzado
  const animalDeJose = herdA.data[0];
  const cross = await api('GET', `/animals/${animalDeJose.id}`, undefined, maria.access_token);
  check('María pide un animal de Jose por id → 404', cross.status === 404);
  const crossKpis = (await api('GET', '/dashboard/kpis', undefined, maria.access_token)).json;
  check('KPIs de María solo cuentan su tenant', crossKpis.active_animals === 5, `activos=${crossKpis.active_animals}`);

  // 5. Refresh con rotación y detección de reuso
  const r1 = await api('POST', '/auth/refresh', { refresh_token: jose.refresh_token });
  check('refresh válido emite nuevos tokens', r1.status === 201 || r1.status === 200, `status=${r1.status}`);
  const reuse = await api('POST', '/auth/refresh', { refresh_token: jose.refresh_token });
  check('reuso del refresh viejo → 401 (rotación)', reuse.status === 401);
  const afterReuse = await api('POST', '/auth/refresh', { refresh_token: r1.json?.refresh_token });
  check('la sesión completa quedó revocada tras el reuso', afterReuse.status === 401);

  // 6. /auth/me
  const me = (await api('GET', '/auth/me', undefined, maria.access_token)).json;
  check('/auth/me devuelve actor y organización', me?.email === 'maria@elombu.com' && me?.organization?.name === 'Agropecuaria El Ombú');
  check('/auth/me expone email_verified (demo sin verificar → false)', me?.email_verified === false, `email_verified=${me?.email_verified}`);

  // 7. El access de Jose sigue vivo (la revocación afecta refresh, no access vigentes)
  const stillValid = await api('GET', '/organizations/current', undefined, jose.access_token);
  check('access token vigente sigue funcionando', stillValid.status === 200, stillValid.json?.name);

  console.log(failures === 0 ? '\nE2E identidad: TODO OK ✓' : `\nE2E identidad: ${failures} fallas ✗`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E error:', e.message);
  process.exit(1);
});
