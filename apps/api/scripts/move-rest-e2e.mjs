/**
 * E2E del endpoint REST de movimiento (P3 M-1.d.2). Verifica POST /movements para
 * movimiento individual y grupal: estado actualizado, evento de timeline, propagación
 * server-origin por pull, incoherencia lote–potrero → 400, e idempotencia
 * (Idempotency-Key + diff-aware). Requiere la API corriendo.
 */
const API = process.env.API_URL ?? 'http://localhost:3001/v1';

let TOKEN = null;
async function api(method, path, body, extraHeaders = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}), ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

const newAnimal = async () => (await api('POST', '/animals', { tag: `MR-${Date.now() % 1_000_000}-${Math.floor(Math.random() * 1000)}`, sex: 'F', category_code: 'vaca' })).json?.id;

async function main() {
  console.log('── E2E movimiento por REST (POST /movements) ──');
  TOKEN = (await api('POST', '/auth/login', { email: 'cowinance@gmail.com', password: 'cowinance' })).json?.access_token;
  check('login', !!TOKEN);

  const devB = (await api('POST', '/sync/devices', { platform: 'ios', device_name: 'move-rest-B' })).json;
  const paddocks = (await api('GET', '/paddocks')).json ?? [];
  const target = paddocks.find((p) => (p.lots ?? []).length > 0);
  check('hay lote destino con potrero', !!target, target && `${target.lots[0].name} @ ${target.name}`);
  const targetLot = target.lots[0].id;
  const targetPaddock = target.id;
  const otherPaddock = paddocks.find((p) => p.id !== targetPaddock);

  const a1 = await newAnimal();
  const a2 = await newAnimal();
  const a3 = await newAnimal();
  check('animales creados', !!a1 && !!a2 && !!a3);
  const baseCursor = (await api('GET', '/sync/state')).json?.server_cursor;

  // 1) Individual.
  const ind = await api('POST', '/movements', { animal_ids: [a1], lot_id: targetLot, reason: 'compra' });
  check('individual → 2xx + {moved:1, movement_id}', (ind.status === 200 || ind.status === 201) && ind.json?.moved === 1 && !!ind.json?.movement_id, JSON.stringify(ind.json));
  const a1full = (await api('GET', `/animals/${a1}`)).json;
  check('a1 en el potrero derivado del lote', a1full?.current_paddock_id === targetPaddock, `${a1full?.current_paddock_id}`);
  const tl = (await api('GET', `/animals/${a1}/timeline`)).json ?? [];
  check('un evento movement en el timeline', tl.filter((e) => e.event_type === 'movement').length === 1);

  // 2) Grupal.
  const grp = await api('POST', '/movements', { animal_ids: [a2, a3], lot_id: targetLot });
  check('grupal → moved:2', grp.json?.moved === 2, JSON.stringify(grp.json));
  const a2p = (await api('GET', `/animals/${a2}`)).json?.current_paddock_id;
  const a3p = (await api('GET', `/animals/${a3}`)).json?.current_paddock_id;
  check('a2 y a3 en el potrero destino', a2p === targetPaddock && a3p === targetPaddock);

  // 3) Propagación server-origin por pull.
  const pull = (await api('GET', `/sync/pull?device_id=${devB.id}&cursor=${baseCursor}`)).json;
  const propagated = (pull.changesets ?? [])
    .filter((c) => c.device_id === null)
    .flatMap((c) => c.ops ?? [])
    .some((o) => o.table === 'animals' && o.rowId === a1 && o.fields?.current_paddock_id === targetPaddock);
  check('el movimiento REST se propaga por server-origin (pull)', propagated);

  // 4) Incoherencia lote–potrero → 400.
  if (otherPaddock) {
    const bad = await api('POST', '/movements', { animal_ids: [a1], lot_id: targetLot, paddock_id: otherPaddock.id });
    check('incoherencia → 400 movement.lot_paddock_mismatch', bad.status === 400 && bad.json?.code === 'movement.lot_paddock_mismatch', `${bad.status} ${bad.json?.code}`);
  }

  // 5) Idempotencia por Idempotency-Key.
  const a4 = await newAnimal();
  const key = crypto.randomUUID();
  const first = await api('POST', '/movements', { animal_ids: [a4], lot_id: targetLot }, { 'Idempotency-Key': key });
  const second = await api('POST', '/movements', { animal_ids: [a4], lot_id: targetLot }, { 'Idempotency-Key': key });
  check('mismo Idempotency-Key → segundo moved:0', first.json?.moved === 1 && second.json?.moved === 0, `${first.json?.moved}/${second.json?.moved}`);
  check('mismo Idempotency-Key → mismo movement_id', first.json?.movement_id === key && second.json?.movement_id === key);

  // 6) Diff-aware: mover a1 a un lote donde ya está → moved:0.
  const noop = await api('POST', '/movements', { animal_ids: [a1], lot_id: targetLot });
  check('diff-aware: reintento idéntico (id fresco) → moved:0', noop.json?.moved === 0, JSON.stringify(noop.json));

  // 7) Sin animal_ids → 400.
  const empty = await api('POST', '/movements', { animal_ids: [] });
  check('sin animal_ids → 400 movement.no_animals', empty.status === 400 && empty.json?.code === 'movement.no_animals', `${empty.status} ${empty.json?.code}`);

  console.log(failures === 0 ? '\nE2E movimiento por REST: TODO OK ✓' : `\nE2E movimiento por REST: ${failures} fallas ✗`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E error:', e.message);
  process.exit(1);
});
