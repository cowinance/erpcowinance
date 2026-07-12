/**
 * E2E de propagación del movimiento de LOTE (P3 ola M-1.b.2). Verifica end-to-end
 * que mover un lote a otro potrero (POST /paddocks/:id/move-lot) propaga el cambio
 * de `current_paddock_id` de sus animales por PULL a un dispositivo ya registrado,
 * como changeset de ORIGEN SERVIDOR (device_id/seq null) y SIN conflictos. También
 * verifica el guard `already_there` en el reintento. Requiere la API corriendo.
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
  console.log('── E2E propagación de movimiento de lote (move-lot → pull de device) ──');
  const jose = (await api('POST', '/auth/login', { email: 'cowinance@gmail.com', password: 'cowinance' })).json;
  check('login Jose', !!jose?.access_token);
  const token = jose.access_token;

  // Descubrir un lote con animales y un potrero destino distinto, desde el mapa real.
  const paddocks = (await api('GET', '/paddocks', undefined, token)).json ?? [];
  let source = null; // { paddock, lot }
  for (const p of paddocks) {
    const lot = (p.lots ?? []).find((l) => l.animal_count > 0);
    if (lot) {
      source = { paddockId: p.id, lot };
      break;
    }
  }
  check('hay un lote con animales para mover', !!source, source ? `lote=${source.lot.name} (${source.lot.animal_count})` : 'ninguno');
  if (!source) {
    console.log('\nE2E move-lot: sin escenario (lote con animales)'); process.exit(1);
  }
  const target = paddocks.find((p) => p.id !== source.paddockId);
  check('hay un potrero destino distinto', !!target, target?.name);

  // Dispositivo registrado y cursor/conflictos ANTES del movimiento.
  const dev = (await api('POST', '/sync/devices', { platform: 'web', device_name: 'move-e2e' }, token)).json;
  check('device registrado', !!dev?.id, dev?.id);
  const before = (await api('GET', '/sync/state', undefined, token)).json;
  const baseCursor = before.server_cursor;
  const conflictsBefore = before.open_conflicts;

  // Mover el lote al potrero destino.
  const moved = await api('POST', `/paddocks/${target.id}/move-lot`, { lot_id: source.lot.id }, token);
  check('move-lot → 200', moved.status === 200 || moved.status === 201, `status=${moved.status}`);
  check('respuesta {moved,lot,from,to}', moved.json?.moved > 0 && !!moved.json?.lot && !!moved.json?.to, JSON.stringify(moved.json));

  // El device pull recibe el cambio de potrero como changeset de ORIGEN SERVIDOR.
  const pull = (await api('GET', `/sync/pull?device_id=${dev.id}&cursor=${baseCursor}`, undefined, token)).json;
  const serverCs = (pull.changesets ?? []).filter((c) => c.device_id === null);
  const movingOp = serverCs
    .flatMap((c) => (c.ops ?? []).map((op) => ({ seq: c.seq, op })))
    .find((x) => x.op.table === 'animals' && x.op.kind === 'put' && x.op.fields?.current_paddock_id === target.id);
  check('pull entrega un changeset server-origin con el nuevo potrero', !!movingOp, `changesets server-origin=${serverCs.length}`);
  check('seq del changeset server-origin es null', movingOp?.seq === null, `seq=${movingOp?.seq}`);

  // El animal movido quedó en el potrero destino (verificación de estado).
  const rowId = movingOp?.op?.rowId;
  if (rowId) {
    const animal = (await api('GET', `/animals/${rowId}`, undefined, token)).json;
    // El DTO expone la ubicación bajo distintas formas según versión; validamos si está presente.
    const loc = animal?.current_paddock_id ?? animal?.location?.paddock_id ?? animal?.paddock_id;
    if (loc !== undefined) check('el animal movido está en el potrero destino', loc === target.id, `${loc}`);
  }

  // Sin conflictos nuevos.
  const after = (await api('GET', '/sync/state', undefined, token)).json;
  check('cero conflictos nuevos', after.open_conflicts === conflictsBefore, `antes=${conflictsBefore} después=${after.open_conflicts}`);
  check('cursor global avanzó', after.server_cursor > baseCursor, `${baseCursor} → ${after.server_cursor}`);

  // Reintento del mismo movimiento → already_there (idempotencia del endpoint).
  const retry = await api('POST', `/paddocks/${target.id}/move-lot`, { lot_id: source.lot.id }, token);
  check('reintento → move.already_there (400)', retry.status === 400 && retry.json?.code === 'move.already_there', `${retry.status} ${retry.json?.code}`);

  console.log(failures === 0 ? '\nE2E move-lot: TODO OK ✓' : `\nE2E move-lot: ${failures} fallas ✗`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E error:', e.message);
  process.exit(1);
});
