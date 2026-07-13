/**
 * E2E P8-2.a: endpoints de Producción contra la API real (asserts por DELTA para aislar del
 * dato demo). Cubre:
 *  1. condition-distribution: bucketing (Flaca/Óptima/Gorda), ÚLTIMA CC por animal gana,
 *     animal sin CC se excluye, CC capturada por sync móvil también cuenta, filtro por lote aísla.
 *  2. production-weight-series: puntos mensuales, incluye pesaje por sync móvil, delta del mes.
 */
const API = process.env.API_URL ?? 'http://localhost:3001/v1';

const hlc = (ms, node, count = 0) => `${String(ms).padStart(14, '0')}:${count.toString(16).padStart(6, '0')}:${node}`;

let ACCESS_TOKEN = null;

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(ACCESS_TOKEN ? { Authorization: `Bearer ${ACCESS_TOKEN}` } : {}) },
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

const iso = (days) => new Date(Date.now() + days * 86400000).toISOString();
const ym = (s) => s.slice(0, 7);
const bucketN = (dist, label) => dist.buckets.find((b) => b.label === label)?.n ?? 0;

async function newAnimal(lotId) {
  const a = await api('POST', '/animals', { tag: `P82-${crypto.randomUUID().slice(0, 8)}`, sex: 'M', category_code: 'novillo', lot_id: lotId });
  return a.id;
}
const restWeighing = (id, kg, at, cc) => api('POST', `/animals/${id}/events`, { type: 'weighing', weight_kg: kg, occurred_at: at, ...(cc != null ? { body_condition: cc } : {}) });

async function pushWeighing(deviceId, seq, animalId, weighedAt, kg, cc) {
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
            rowId: crypto.randomUUID(),
            hlc: hlc(ms, deviceId, 0),
            row: { animal_id: animalId, weight_kg: kg, weighed_at: weighedAt, ...(cc != null ? { body_condition: cc } : {}) },
          },
        ],
      },
    ],
  });
}

async function main() {
  console.log('-- E2E P8-2.a Producción (serie + CC) --');
  await login();
  const lots = await api('GET', '/lots');
  const lot = lots[0];
  const otherLot = lots.find((l) => l.id !== lot.id);
  check('lote disponible', !!lot?.id, lot?.name ?? '');

  const dev = await api('POST', '/sync/devices', { platform: 'android', device_name: 'Manga P8-2', app_version: '0.1.0' });

  // ---- Distribución de CC (baseline → alta → delta) ----
  const distBefore = await api('GET', `/reports/condition-distribution?lot_id=${lot.id}`);
  check('distribución: 3 buckets con labels esperadas', distBefore.buckets.map((b) => b.label).join(',') === 'Flaca,Óptima,Gorda');

  // animal Óptima (REST, hoy, CC 3.0)
  const aOptima = await newAnimal(lot.id);
  await restWeighing(aOptima, 300, iso(0), 3.0);
  // animal Gorda: CC vieja 2.0 (Flaca) y CC nueva 4.0 (Gorda) → gana la última
  const aGorda = await newAnimal(lot.id);
  await restWeighing(aGorda, 320, iso(-45), 2.0);
  await restWeighing(aGorda, 360, iso(0), 4.0);
  // animal con CC por SYNC móvil (Óptima 3.2)
  const aSync = await newAnimal(lot.id);
  await pushWeighing(dev.id, 1, aSync, iso(0), 310, 3.2);
  // animal SIN CC → excluido de la distribución (pero cuenta en la serie)
  const aNoCc = await newAnimal(lot.id);
  await restWeighing(aNoCc, 280, iso(0), null);
  // animal en OTRO lote (control de aislamiento por lote)
  if (otherLot) {
    const aOther = await newAnimal(otherLot.id);
    await restWeighing(aOther, 300, iso(0), 4.5);
  }

  const distAfter = await api('GET', `/reports/condition-distribution?lot_id=${lot.id}`);
  check('CC: Óptima +2 (REST + sync móvil)', bucketN(distAfter, 'Óptima') - bucketN(distBefore, 'Óptima') === 2, `Δ=${bucketN(distAfter, 'Óptima') - bucketN(distBefore, 'Óptima')}`);
  check('CC: Gorda +1 (última CC gana sobre la vieja Flaca)', bucketN(distAfter, 'Gorda') - bucketN(distBefore, 'Gorda') === 1, `Δ=${bucketN(distAfter, 'Gorda') - bucketN(distBefore, 'Gorda')}`);
  check('CC: Flaca +0 (la CC vieja del Gorda no cuenta)', bucketN(distAfter, 'Flaca') - bucketN(distBefore, 'Flaca') === 0, `Δ=${bucketN(distAfter, 'Flaca') - bucketN(distBefore, 'Flaca')}`);
  check('CC: total +3 (animal sin CC excluido)', distAfter.total - distBefore.total === 3, `Δ=${distAfter.total - distBefore.total}`);
  if (otherLot) check('CC: filtro por lote aísla (otro lote no suma)', bucketN(distAfter, 'Gorda') - bucketN(distBefore, 'Gorda') === 1);

  // ---- Serie de peso (delta del mes actual, incluye sync móvil) ----
  const thisMonth = ym(iso(0));
  const monthN = (s) => s.rows.find((r) => r.month === thisMonth)?.n ?? 0;
  const seriesAfter = await api('GET', `/reports/production-weight-series?lot_id=${lot.id}`);
  const thisRow = seriesAfter.rows.find((r) => r.month === thisMonth);
  check('serie: mes actual presente con avg_kg y n', !!thisRow && typeof thisRow.avg_kg === 'number' && thisRow.n >= 4, `n=${thisRow?.n}`);
  // 4 pesajes de HOY en el lote: Óptima, Gorda(nuevo), Sync, SinCC (el Gorda viejo es de otro mes)
  const seriesNoLot = await api('GET', `/reports/production-weight-series`);
  check('serie: sin filtro de lote incluye ≥ que con lote', monthN(seriesNoLot) >= monthN(seriesAfter));
  check('serie: incluye el pesaje capturado por sync móvil', thisRow.n >= 4);

  console.log(failures === 0 ? '\nE2E P8-2.a: TODO OK' : `\nE2E P8-2.a: ${failures} fallas`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E P8-2.a error:', e.message);
  process.exit(1);
});
