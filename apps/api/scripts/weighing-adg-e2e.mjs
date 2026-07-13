/**
 * E2E P8-1: GDP derivado desde v_weighings contra la API real.
 *
 * Cubre:
 *  1. Pesajes capturados offline por sync movil -> ficha/dashboard/reportes ven GDP.
 *  2. Llegada desordenada: un pesaje retro-fechado recalcula el posterior.
 *  3. Regresion REST: mismos numeros observables sin escribir adg_since_last.
 */
const API = process.env.API_URL ?? 'http://localhost:3001/v1';

const hlc = (ms, node, count = 0) =>
  `${String(ms).padStart(14, '0')}:${count.toString(16).padStart(6, '0')}:${node}`;

let ACCESS_TOKEN = null;

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(ACCESS_TOKEN ? { Authorization: `Bearer ${ACCESS_TOKEN}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function login() {
  const session = await api('POST', '/auth/login', { email: 'cowinance@gmail.com', password: 'cowinance' });
  ACCESS_TOKEN = session.access_token;
}

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? '  ok' : '  FAIL'} ${name}${extra ? ` - ${extra}` : ''}`);
  if (!cond) failures++;
}

function iso(daysFromNow) {
  return new Date(Date.now() + daysFromNow * 86400000).toISOString();
}

function ymd(s) {
  return s.slice(0, 10);
}

async function pushWeighing(deviceId, seq, animalId, weighedAt, kg) {
  const rowId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  const ms = new Date(weighedAt).getTime();
  return api('POST', '/sync/push', {
    device_id: deviceId,
    changesets: [
      {
        id: crypto.randomUUID(),
        deviceId,
        seq,
        hlc: hlc(ms, deviceId, 2),
        schemaVersion: 1,
        ops: [
          {
            kind: 'event',
            table: 'weighings',
            rowId,
            hlc: hlc(ms, deviceId, 0),
            row: { animal_id: animalId, weight_kg: kg, weighed_at: weighedAt },
          },
          {
            kind: 'event',
            table: 'animal_events',
            rowId: eventId,
            hlc: hlc(ms, deviceId, 1),
            row: { animal_id: animalId, event_type: 'weighing', payload: { weight_kg: kg }, occurred_at: weighedAt },
          },
        ],
      },
    ],
  });
}

async function main() {
  console.log('-- E2E P8-1 GDP derivado --');
  await login();

  const lots = await api('GET', '/lots');
  const lot = lots[0];
  check('lote disponible para aislar reportes', !!lot?.id, lot?.name ?? '');

  const dev = await api('POST', '/sync/devices', {
    platform: 'android',
    device_name: 'Manga P8-1',
    app_version: '0.1.0',
  });
  check('device sync registrado', !!dev.id);

  const tag = `P8-${Date.now() % 100000}`;
  const animal = await api('POST', '/animals', { tag, sex: 'M', category_code: 'novillo', lot_id: lot.id });
  check('animal creado para sync', !!animal.id, tag);

  const firstAt = iso(160);
  const secondAt = iso(170);
  await pushWeighing(dev.id, 1, animal.id, firstAt, 400);
  await pushWeighing(dev.id, 2, animal.id, secondAt, 430);

  const synced = await api('GET', `/animals/${animal.id}`);
  check('ficha: GDP sync movil calculado', synced.last_weighing?.adg === 3, `adg=${synced.last_weighing?.adg}`);

  const kpis = await api('GET', '/dashboard/kpis');
  check('dashboard: KPI GDP toma la vista', typeof kpis.avg_adg_kg_day === 'number' && kpis.avg_adg_kg_day > 0, `avg=${kpis.avg_adg_kg_day}`);

  const production = await api('GET', `/reports/production?from=${ymd(firstAt)}&to=${ymd(secondAt)}`);
  const productionLot = production.rows.find((r) => r.lote === lot.name);
  check('reportes: GDP por lote toma la vista', productionLot?.gdp_promedio === 3, `gdp=${productionLot?.gdp_promedio}`);

  const disorderTag = `P8D-${Date.now() % 100000}`;
  const disorder = await api('POST', '/animals', { tag: disorderTag, sex: 'M', category_code: 'novillo', lot_id: lot.id });
  const laterAt = iso(190);
  const middleAt = iso(185);
  await pushWeighing(dev.id, 3, disorder.id, laterAt, 460);
  await pushWeighing(dev.id, 4, disorder.id, middleAt, 440);
  const disorderAfter = await api('GET', `/animals/${disorder.id}`);
  check('llegada desordenada recalcula el ultimo GDP', disorderAfter.last_weighing?.adg === 4, `adg=${disorderAfter.last_weighing?.adg}`);

  const timeline = await api('GET', `/animals/${disorder.id}/timeline`);
  const middleEvent = timeline.find((e) => e.event_type === 'weighing' && Number(e.payload?.weight_kg) === 440);
  const laterEvent = timeline.find((e) => e.event_type === 'weighing' && Number(e.payload?.weight_kg) === 460);
  check('timeline: primer pesaje por orden real queda sin GDP', middleEvent?.payload?.adg_since_last == null);
  check('timeline: pesaje posterior muestra GDP derivado', laterEvent?.payload?.adg_since_last === 4, `adg=${laterEvent?.payload?.adg_since_last}`);

  const restTag = `P8R-${Date.now() % 100000}`;
  const rest = await api('POST', '/animals', { tag: restTag, sex: 'M', category_code: 'novillo', lot_id: lot.id });
  const restFirstAt = iso(210);
  const restSecondAt = iso(220);
  await api('POST', `/animals/${rest.id}/events`, { type: 'weighing', weight_kg: 300, occurred_at: restFirstAt });
  const restSecond = await api('POST', `/animals/${rest.id}/events`, { type: 'weighing', weight_kg: 325, occurred_at: restSecondAt });
  const restAfter = await api('GET', `/animals/${rest.id}`);
  check('REST devuelve GDP derivado', restSecond.adg_since_last === 2.5, `adg=${restSecond.adg_since_last}`);
  check('REST mantiene numeros observables en ficha', restAfter.last_weighing?.adg === 2.5, `adg=${restAfter.last_weighing?.adg}`);

  console.log(failures === 0 ? '\nE2E P8-1: TODO OK' : `\nE2E P8-1: ${failures} fallas`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E P8-1 error:', e.message);
  process.exit(1);
});
