/**
 * E2E de provisioning self-service de tenant (P1.1, ADR-0010).
 *
 * Verifica el flujo completo SIN datos demo, tal como lo vive una finca nueva:
 *  1. Validación de entrada (campos faltantes, email inválido, contraseña
 *     débil, país no soportado) → 400
 *  2. Registro de Tenant A → 201 (crea org + finca + rol owner)
 *  3. Email duplicado (case-insensitive) → 409
 *  4. Login de A → rol owner + tenant correcto; /auth/me consistente
 *  5. A arranca con 0 animales y exactamente 1 finca (sin datos demo)
 *  6. A crea su primer animal → aparece en su hato
 *  7. Registro + login de Tenant B; aislamiento bidireccional:
 *     - B no ve el animal de A (y viceversa)
 *     - la misma caravana "001" es válida en ambos (tenants distintos)
 *     - GET cruzado por id → 404 (RLS oculta la fila)
 *
 * Requiere una api corriendo. No depende de seed demo, pero es seguro correrlo
 * contra una base con demo: usa emails únicos por corrida.
 *
 *   API_URL=http://localhost:3099/v1 node apps/api/scripts/account-e2e.mjs
 */
const API = process.env.API_URL ?? 'http://localhost:3001/v1';
const RUN = Date.now().toString(36); // sufijo único → re-ejecutable sin colisión de email

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

const emailA = `ana+${RUN}@fincaverde.test`;
const emailB = `beto+${RUN}@ranchosol.test`;

async function main() {
  console.log('── E2E provisioning self-service (P1.1) ──');

  // 1. Validación de entrada
  const missing = await api('POST', '/register', { email: emailA });
  check('campos faltantes → 400', missing.status === 400, missing.json?.code);
  const badEmail = await api('POST', '/register', {
    email: 'no-es-email', password: 'pasto1234', full_name: 'X',
    organization_name: 'O', farm_name: 'F', country_code: 'AR',
  });
  check('email inválido → 400', badEmail.status === 400, badEmail.json?.code);
  const weak = await api('POST', '/register', {
    email: emailA, password: '123', full_name: 'X',
    organization_name: 'O', farm_name: 'F', country_code: 'AR',
  });
  check('contraseña débil → 400', weak.status === 400, weak.json?.code);
  const badCountry = await api('POST', '/register', {
    email: emailA, password: 'pasto1234', full_name: 'X',
    organization_name: 'O', farm_name: 'F', country_code: 'ZZ',
  });
  check('país no soportado → 400', badCountry.status === 400, badCountry.json?.code);

  // 2. Registro de Tenant A
  const regA = await api('POST', '/register', {
    email: emailA.toUpperCase(), password: 'pasto1234', full_name: 'Ana Ruiz',
    organization_name: 'Finca Verde', farm_name: 'La Primera', country_code: 'ar',
  });
  check('registro Tenant A → 201', regA.status === 201, regA.json?.organization_id);
  check('devuelve org, finca, user y email normalizado',
    !!regA.json?.organization_id && !!regA.json?.farm_id && !!regA.json?.user_id && regA.json?.email === emailA);

  // 3. Email duplicado
  const dup = await api('POST', '/register', {
    email: emailA, password: 'pasto1234', full_name: 'Otra',
    organization_name: 'Otra Org', farm_name: 'Otra Finca', country_code: 'AR',
  });
  check('email duplicado (case-insensitive) → 409', dup.status === 409, dup.json?.code);

  // 4. Login de A + /auth/me
  const loginA = (await api('POST', '/auth/login', { email: emailA, password: 'pasto1234' })).json;
  check('login A emite tokens', !!loginA?.access_token);
  check('A recibe rol owner', loginA?.user?.role === 'owner', loginA?.user?.role);
  check('tenant del token == org registrada', loginA?.user?.tenant_id === regA.json?.organization_id);
  const meA = (await api('GET', '/auth/me', undefined, loginA.access_token)).json;
  check('/auth/me consistente', meA?.email === emailA && meA?.organization?.name === 'Finca Verde', meA?.organization?.name);

  // 5. Estado inicial sin datos demo
  const herdA0 = (await api('GET', '/animals?limit=200', undefined, loginA.access_token)).json;
  check('A arranca con 0 animales (sin demo)', (herdA0?.data?.length ?? -1) === 0, `${herdA0?.data?.length}`);
  const farmsA = (await api('GET', '/farms', undefined, loginA.access_token)).json;
  check('A tiene exactamente 1 finca (La Primera)',
    Array.isArray(farmsA) && farmsA.length === 1 && farmsA[0].name === 'La Primera', farmsA?.[0]?.name);

  // 6. Primer animal de A
  const createA = await api('POST', '/animals',
    { tag: '001', sex: 'F', category_code: 'vaca', name: 'Aurora' }, loginA.access_token);
  check('A crea su primer animal → 201', createA.status === 201, createA.json?.id);
  const herdA1 = (await api('GET', '/animals?limit=200', undefined, loginA.access_token)).json;
  check('el hato de A ahora tiene 1 animal (001/Aurora)',
    herdA1?.data?.length === 1 && herdA1.data[0].tag === '001', herdA1?.data?.map((a) => a.tag).join(','));

  // 7. Tenant B + aislamiento bidireccional
  const regB = await api('POST', '/register', {
    email: emailB, password: 'solsol12', full_name: 'Beto Díaz',
    organization_name: 'Rancho Sol', farm_name: 'El Sol', country_code: 'MX',
  });
  check('registro Tenant B → 201', regB.status === 201);
  check('org de B distinta de la de A', regB.json?.organization_id !== regA.json?.organization_id);
  const loginB = (await api('POST', '/auth/login', { email: emailB, password: 'solsol12' })).json;

  const herdB0 = (await api('GET', '/animals?limit=200', undefined, loginB.access_token)).json;
  check('B no ve el animal de A (arranca en 0)', (herdB0?.data?.length ?? -1) === 0, `${herdB0?.data?.length}`);
  const createB = await api('POST', '/animals',
    { tag: '001', sex: 'M', category_code: 'toro', name: 'Sol' }, loginB.access_token);
  check('B reutiliza la caravana 001 (tenant distinto) → 201', createB.status === 201, createB.json?.id);

  const herdBfinal = (await api('GET', '/animals?limit=200', undefined, loginB.access_token)).json;
  check('B ve SOLO su animal (Sol)',
    herdBfinal?.data?.length === 1 && herdBfinal.data[0].name === 'Sol', herdBfinal?.data?.[0]?.name);
  const herdAfinal = (await api('GET', '/animals?limit=200', undefined, loginA.access_token)).json;
  check('A sigue viendo SOLO su animal (Aurora)',
    herdAfinal?.data?.length === 1 && herdAfinal.data[0].name === 'Aurora', herdAfinal?.data?.[0]?.name);

  const crossAB = await api('GET', `/animals/${createB.json.id}`, undefined, loginA.access_token);
  check('A pide el animal de B por id → 404 (RLS)', crossAB.status === 404, `status=${crossAB.status}`);
  const crossBA = await api('GET', `/animals/${createA.json.id}`, undefined, loginB.access_token);
  check('B pide el animal de A por id → 404 (RLS)', crossBA.status === 404, `status=${crossBA.status}`);

  console.log(failures === 0 ? '\nE2E provisioning: TODO OK ✓' : `\nE2E provisioning: ${failures} fallas ✗`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E error:', e.message);
  process.exit(1);
});
