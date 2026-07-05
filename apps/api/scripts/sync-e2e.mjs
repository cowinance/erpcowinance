/**
 * E2E del motor de sincronización contra la API real (http://localhost:3001/v1).
 * Simula dos dispositivos de campo que editan offline y luego convergen:
 *  1. dev A y dev B se registran
 *  2. A crea un animal offline (con pesaje); B crea otro con LA MISMA caravana → conflicto duplicate
 *  3. A y B editan el nombre del mismo animal existente → LWW por campo (gana el HLC mayor)
 *  4. A lo marca muerto y B lo marca vendido → conflicto semántico + LWW determinista
 *  5. A reenvía su push (ack perdido) → dedupe exactly-once
 *  6. Ambos hacen pull y quedan al día; se verifica el estado del servidor
 */
const API = process.env.API_URL ?? 'http://localhost:3001/v1';

const hlc = (ms, node, count = 0) =>
  `${String(ms).padStart(14, '0')}:${count.toString(16).padStart(6, '0')}:${node}`;

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
}

async function main() {
  console.log('── E2E sincronización offline (HTTP) ──');

  // 1. Registro de dispositivos
  const devA = await api('POST', '/sync/devices', { platform: 'android', device_name: 'Tablet Manga Norte', app_version: '0.1.0' });
  const devB = await api('POST', '/sync/devices', { platform: 'ios', device_name: 'iPhone Capataz', app_version: '0.1.0' });
  check('registro de dispositivos', !!devA.id && !!devB.id);

  // Animal dedicado a la prueba, editado concurrentemente por ambos dispositivos
  const shared = await api('POST', '/animals', { tag: `T${Date.now() % 100000}`, sex: 'M', category_code: 'novillo' });
  shared.tag = shared.identifiers?.[0]?.value;
  check('animal compartido creado', !!shared?.id, `caravana ${shared?.tag}`);

  const now = Date.now();
  const newA = crypto.randomUUID();
  const newB = crypto.randomUUID();
  const weighingId = crypto.randomUUID();
  const eventId = crypto.randomUUID();

  // 2-4. Changesets offline de A (dos, con seq 1 y 2)
  const pushA = {
    device_id: devA.id,
    changesets: [
      {
        id: 'csA1', deviceId: devA.id, seq: 1, hlc: hlc(now - 5000, devA.id, 2), schemaVersion: 1,
        ops: [
          { kind: 'put', table: 'animals', rowId: newA, hlc: hlc(now - 5000, devA.id, 0),
            fields: { visual_tag: '900', name: 'Nueva de A', status: 'active', sex: 'F' } },
          { kind: 'event', table: 'weighings', rowId: weighingId, hlc: hlc(now - 5000, devA.id, 1),
            row: { animal_id: newA, weight_kg: 380, weighed_at: new Date(now - 5000).toISOString() } },
          { kind: 'event', table: 'animal_events', rowId: eventId, hlc: hlc(now - 5000, devA.id, 2),
            row: { animal_id: newA, event_type: 'weighing', payload: { weight_kg: 380 }, occurred_at: new Date(now - 5000).toISOString() } },
        ],
      },
      {
        id: 'csA2', deviceId: devA.id, seq: 2, hlc: hlc(now - 3000, devA.id, 1), schemaVersion: 1,
        ops: [
          { kind: 'put', table: 'animals', rowId: shared.id, hlc: hlc(now - 3000, devA.id, 0),
            fields: { name: 'Nombre de A' } },
          { kind: 'put', table: 'animals', rowId: shared.id, hlc: hlc(now - 3000, devA.id, 1),
            fields: { status: 'dead' } },
        ],
      },
    ],
  };

  // Changesets offline de B: caravana duplicada + edición del mismo campo con HLC MAYOR
  const pushB = {
    device_id: devB.id,
    changesets: [
      {
        id: 'csB1', deviceId: devB.id, seq: 1, hlc: hlc(now - 1000, devB.id, 2), schemaVersion: 1,
        ops: [
          { kind: 'put', table: 'animals', rowId: newB, hlc: hlc(now - 1000, devB.id, 0),
            fields: { visual_tag: '900', name: 'Nueva de B', status: 'active', sex: 'F' } },
          { kind: 'put', table: 'animals', rowId: shared.id, hlc: hlc(now - 1000, devB.id, 1),
            fields: { name: 'Nombre de B' } },
          { kind: 'put', table: 'animals', rowId: shared.id, hlc: hlc(now - 1000, devB.id, 2),
            fields: { status: 'sold' } },
        ],
      },
    ],
  };

  const resA = await api('POST', '/sync/push', pushA);
  check('push A aceptado', resA.accepted === 2 && resA.deduped === 0, JSON.stringify(resA));

  const resB = await api('POST', '/sync/push', pushB);
  check('push B aceptado', resB.accepted === 1, JSON.stringify({ accepted: resB.accepted }));
  check('conflicto duplicate detectado (caravana 900 en dos dispositivos)',
    resB.conflicts.some((c) => c.type === 'duplicate'));
  check('conflicto semántico detectado (dead vs sold)',
    resB.conflicts.some((c) => c.type === 'semantic'));

  // 5. Reintento de A (ack perdido) → dedupe
  const retryA = await api('POST', '/sync/push', pushA);
  check('reintento deduplicado exactly-once', retryA.accepted === 0 && retryA.deduped === 2, JSON.stringify(retryA));

  // LWW: B escribió name y status con HLC mayor → debe ganar B
  const sharedAfter = await api('GET', `/animals/${shared.id}`);
  check('LWW por campo: name gana el HLC mayor (B)', sharedAfter.name === 'Nombre de B', `name=${sharedAfter.name}`);
  check('LWW determinista en estado terminal (sold, HLC mayor)', sharedAfter.status === 'sold', `status=${sharedAfter.status}`);

  // El animal nuevo de A existe con su pesaje y su evento
  const newAnimal = await api('GET', `/animals/${newA}`);
  check('animal creado offline visible en el servidor', newAnimal.identifiers?.some((i) => i.value === '900'));
  check('pesaje offline aplicado (hecho inmutable)', Number(newAnimal.last_weighing?.weight_kg) === 380);

  // 6. Pull de ambos: cada uno recibe los changesets del otro
  const pullA = await api('GET', `/sync/pull?device_id=${devA.id}&cursor=0`);
  const pullB = await api('GET', `/sync/pull?device_id=${devB.id}&cursor=0`);
  check('pull A recibe changesets de B', pullA.changesets.filter((c) => c.device_id === devB.id).length === 1);
  check('pull A no recibe sus propios changesets', pullA.changesets.every((c) => c.device_id !== devA.id));
  check('pull B recibe changesets de A', pullB.changesets.filter((c) => c.device_id === devA.id).length === 2);
  check('cursores convergen', pullA.cursor === pullB.cursor && pullA.cursor >= 3, `cursor=${pullA.cursor}`);

  // Pull incremental: nada nuevo
  const pullA2 = await api('GET', `/sync/pull?device_id=${devA.id}&cursor=${pullA.cursor}`);
  check('pull incremental vacío tras convergencia', pullA2.changesets.length === 0);

  // Panel de flota
  const state = await api('GET', '/sync/state');
  const fleetA = state.devices.find((d) => d.id === devA.id);
  const fleetB = state.devices.find((d) => d.id === devB.id);
  check('panel de flota: ambos dispositivos con last_sync', !!fleetA?.last_sync_at && !!fleetB?.last_sync_at);
  check('panel de flota: conflictos abiertos visibles', state.open_conflicts >= 2, `abiertos=${state.open_conflicts}`);

  console.log(failures === 0 ? '\nE2E: TODO OK ✓' : `\nE2E: ${failures} fallas ✗`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E error:', e.message);
  process.exit(1);
});
