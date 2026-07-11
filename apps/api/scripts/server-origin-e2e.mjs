/**
 * E2E de propagación server-origin (P2 ola P-b, ADR-0016). Verifica end-to-end
 * que un animal creado server-side (alta web, POST /animals) se propaga por PULL
 * a un dispositivo ya registrado — SIN dispositivo/secuencia sintéticos y SIN
 * generar conflictos. Requiere la API corriendo (npm run api).
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
  console.log('── E2E propagación server-origin (alta web → pull de device) ──');
  const jose = (await api('POST', '/auth/login', { email: 'cowinance@gmail.com', password: 'cowinance' })).json;
  check('login Jose', !!jose?.access_token);
  const token = jose.access_token;

  // Dispositivo registrado y cursor/conflictos ANTES del alta.
  const dev = (await api('POST', '/sync/devices', { platform: 'web', device_name: 'so-e2e' }, token)).json;
  check('device registrado', !!dev?.id, dev?.id);
  const before = (await api('GET', '/sync/state', undefined, token)).json;
  const baseCursor = before.server_cursor;
  const conflictsBefore = before.open_conflicts;

  // Alta web (server-side).
  const tag = `SO-${Date.now()}`;
  const created = await api('POST', '/animals', { tag, sex: 'F', category_code: 'vaca' }, token);
  check('alta web → 201', created.status === 201, `status=${created.status}`);
  const animalId = created.json?.id;

  // El device pull recibe el animal como changeset de ORIGEN SERVIDOR.
  const pull = (await api('GET', `/sync/pull?device_id=${dev.id}&cursor=${baseCursor}`, undefined, token)).json;
  const serverCs = (pull.changesets ?? []).find(
    (c) => c.device_id === null && (c.ops ?? []).some((op) => op.table === 'animals' && op.rowId === animalId),
  );
  check('pull entrega un changeset de origen servidor (device_id=null)', !!serverCs, `changesets=${pull.changesets?.length}`);
  check('seq del changeset server-origin es null', serverCs?.seq === null, `seq=${serverCs?.seq}`);
  const op = (serverCs?.ops ?? []).find((o) => o.table === 'animals' && o.rowId === animalId);
  check('op put sobre animals con visual_tag/sex/category_code correctos',
    op?.kind === 'put' && op?.fields?.visual_tag === tag && op?.fields?.sex === 'F' && op?.fields?.category_code === 'vaca' && op?.fields?.status === 'active',
    JSON.stringify(op?.fields),
  );

  // Sin conflictos nuevos (es una creación, no un conflicto).
  const after = (await api('GET', '/sync/state', undefined, token)).json;
  check('cero conflictos nuevos', after.open_conflicts === conflictsBefore, `antes=${conflictsBefore} después=${after.open_conflicts}`);

  // El cursor global avanzó (la fila server-origin tiene server_seq mayor).
  check('cursor global avanzó', after.server_cursor > baseCursor, `${baseCursor} → ${after.server_cursor}`);

  console.log(failures === 0 ? '\nE2E server-origin: TODO OK ✓' : `\nE2E server-origin: ${failures} fallas ✗`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E error:', e.message);
  process.exit(1);
});
