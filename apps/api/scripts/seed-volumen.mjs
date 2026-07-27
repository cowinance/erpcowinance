/**
 * Infla el demo a N animales CON SU HISTORIA, para medir cómo escala el sistema.
 *
 * Uso:
 *   pkill -f 'nest start'                       # la base es de un solo proceso
 *   node apps/api/scripts/seed-volumen.mjs 3000
 *   npm run api                                 # y medir los endpoints
 *
 * NO se ejecuta solo ni forma parte del arranque: es una herramienta para una sesión de medición.
 * Después conviene borrar `apps/api/.data/pglite` para volver al demo normal.
 *
 * Por qué CON HISTORIA y no solo animales: el motor de alertas, la agenda y el Inicio trabajan
 * sobre los HECHOS (vacunas, tratamientos, servicios, preñeces, tareas, movimientos). Un hato de
 * 3.000 animales sin eventos sale rápido y no prueba nada — la primera medición de esta serie dio
 * un falso aprobado exactamente por eso.
 *
 * La medición anterior agregaba animales y pesajes: el motor de alertas salía rápido porque esos
 * animales no tenían nada que evaluar. Una finca real tiene entre 10 y 50 hechos por animal, y son
 * esos hechos los que hacen trabajar a `computeDesired`, a la agenda y al Inicio.
 *
 * Inserta por lotes (VALUES multi-fila): de a una fila, sembrar 3.000 animales con historia tarda
 * minutos y no se puede iterar.
 */
import { PGlite } from '/Users/josemontilla/Proyectos/app ganadera/node_modules/@electric-sql/pglite/dist/index.js';

const N = Number(process.argv[2] ?? 1000);
const db = new PGlite('/Users/josemontilla/Proyectos/app ganadera/apps/api/.data/pglite');
await db.waitReady;
const q = async (s, p) => (await db.query(s, p)).rows;

const [{ id: org }] = await q(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`);
await q(`SELECT set_config('app.tenant_id', $1, false)`, [org]);
const [{ id: farm }] = await q(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [org]);
const [{ id: species }] = await q(`SELECT id FROM species WHERE code='bovine'`);
const cats = await q(`SELECT id, code FROM animal_categories WHERE species_id=$1`, [species]);
const lots = await q(`SELECT id FROM lots WHERE tenant_id=$1 AND deleted_at IS NULL`, [org]);
const paddocks = await q(`SELECT id FROM paddocks WHERE tenant_id=$1 AND deleted_at IS NULL`, [org]);
const [{ id: user }] = await q(`SELECT id FROM users ORDER BY created_at LIMIT 1`);
const prods = await q(`SELECT id, type FROM products_veterinary WHERE tenant_id=$1`, [org]);
const vacuna = prods.find((p) => p.type === 'vaccine')?.id ?? prods[0].id;
const antip = prods.find((p) => p.type !== 'vaccine')?.id ?? prods[0].id;
const diags = await q(`SELECT id FROM diagnoses WHERE tenant_id IS NULL LIMIT 5`);

/** INSERT por lotes: filas = [[v1,v2,...], ...] */
const bulk = async (tabla, cols, filas) => {
  if (!filas.length) return;
  const TANDA = 400;
  for (let i = 0; i < filas.length; i += TANDA) {
    const parte = filas.slice(i, i + TANDA);
    const args = [];
    const vals = parte.map((f) => `(${f.map((v) => `$${args.push(v)}`).join(',')})`);
    await q(`INSERT INTO ${tabla} (${cols.join(',')}) VALUES ${vals.join(',')}`, args);
  }
};

const t0 = Date.now();
console.log(`Sembrando ${N} animales con historia…`);

const animales = [];
{
  const filas = [];
  for (let i = 0; i < N; i++) {
    const cat = cats[i % cats.length];
    filas.push([org, farm, species, cat.id, lots[i % lots.length].id, i % 2 ? 'F' : 'M', 'active', 'born', user, 200 + (i % 900)]);
  }
  for (let i = 0; i < filas.length; i += 400) {
    const parte = filas.slice(i, i + 400);
    const args = [];
    const vals = parte.map((f) => {
      const p = f.slice(0, 9).map((v) => `$${args.push(v)}`);
      const d = `$${args.push(f[9])}`;
      return `(${p.join(',')}, CURRENT_DATE - ${d}::int)`;
    });
    const r = await q(
      `INSERT INTO animals (tenant_id, farm_id, species_id, category_id, current_lot_id, sex, status, origin, created_by, birth_date)
       VALUES ${vals.join(',')} RETURNING id, sex`, args);
    animales.push(...r);
  }
}
console.log(`  animales: ${animales.length} (${Date.now() - t0} ms)`);

// Identificadores + pesajes
await bulk('animal_identifiers', ['tenant_id', 'animal_id', 'type', 'value'],
  animales.map((a, i) => [org, a.id, 'visual', `V${20000 + i}`]));
{
  const filas = [];
  animales.forEach((a, i) => { for (let w = 0; w < 6; w++) filas.push([org, a.id, 180 - w * 30, 200 + w * 25 + (i % 40)]); });
  for (let i = 0; i < filas.length; i += 400) {
    const parte = filas.slice(i, i + 400); const args = [];
    const vals = parte.map((f) => `($${args.push(f[0])},$${args.push(f[1])}, now() - ($${args.push(f[2])}::int || ' days')::interval, $${args.push(f[3])}, 'scale')`);
    await q(`INSERT INTO weighings (tenant_id, animal_id, weighed_at, weight_kg, method) VALUES ${vals.join(',')}`, args);
  }
}
console.log(`  pesajes: ${animales.length * 6} (${Date.now() - t0} ms)`);

// ── LA HISTORIA: lo que hace trabajar al motor de alertas ────────────────────
// Vacunas con refuerzo próximo (regla vaccination_due), tratamientos con retiro activo
// (withdrawal_active), servicios y preñeces (todo el bloque de reproducción), tareas y movimientos.
{
  const vac = [], tra = [], mov = [], ev = [];
  animales.forEach((a, i) => {
    // 2 vacunas por animal; 1 de cada 8 con refuerzo dentro de la ventana de aviso
    vac.push([org, a.id, vacuna, 300, i % 8 === 0 ? 15 : 400]);
    vac.push([org, a.id, vacuna, 120, i % 8 === 0 ? 25 : 500]);
    // 1 tratamiento cada 3 animales; 1 de cada 10 con retiro ACTIVO
    if (i % 3 === 0) tra.push([org, a.id, antip, 40, i % 10 === 0 ? 20 : -30, diags[i % diags.length].id]);
    // movimientos entre lotes: alimentan la resolución as-of de pastoreo
    mov.push([org, a.id, 150, lots[i % lots.length].id, lots[(i + 1) % lots.length].id, paddocks[i % paddocks.length].id]);
    ev.push([org, a.id, 'weighing', 30]);
  });
  for (const [tabla, filas, sql] of [
    ['vaccinations', vac, (f, args) => `($${args.push(f[0])},$${args.push(f[1])},$${args.push(f[2])}, now() - ($${args.push(f[3])}::int || ' days')::interval, CURRENT_DATE + $${args.push(f[4])}::int)`],
  ]) {
    for (let i = 0; i < filas.length; i += 400) {
      const parte = filas.slice(i, i + 400); const args = [];
      const vals = parte.map((f) => sql(f, args));
      await q(`INSERT INTO ${tabla} (tenant_id, animal_id, product_id, applied_at, next_due_date) VALUES ${vals.join(',')}`, args);
    }
  }
  for (let i = 0; i < tra.length; i += 400) {
    const parte = tra.slice(i, i + 400); const args = [];
    const vals = parte.map((f) => `($${args.push(f[0])},$${args.push(f[1])},$${args.push(f[2])}, now() - ($${args.push(f[3])}::int || ' days')::interval, CURRENT_DATE + $${args.push(f[4])}::int, $${args.push(f[5])}, 'im')`);
    await q(`INSERT INTO treatments (tenant_id, animal_id, product_id, applied_at, meat_withdrawal_until, diagnosis_id, route) VALUES ${vals.join(',')}`, args);
  }
  for (let i = 0; i < mov.length; i += 400) {
    const parte = mov.slice(i, i + 400); const args = [];
    const vals = parte.map((f) => `($${args.push(f[0])},$${args.push(f[1])}, now() - ($${args.push(f[2])}::int || ' days')::interval, $${args.push(f[3])},$${args.push(f[4])},$${args.push(f[5])})`);
    await q(`INSERT INTO animal_movements (tenant_id, animal_id, moved_at, from_lot_id, to_lot_id, to_paddock_id) VALUES ${vals.join(',')}`, args);
  }
  for (let i = 0; i < ev.length; i += 400) {
    const parte = ev.slice(i, i + 400); const args = [];
    const vals = parte.map((f) => `($${args.push(f[0])},$${args.push(f[1])},$${args.push(f[2])},'{}'::jsonb, now() - ($${args.push(f[3])}::int || ' days')::interval, now(), 'manual')`);
    await q(`INSERT INTO animal_events (tenant_id, animal_id, event_type, payload, occurred_at, recorded_at, source) VALUES ${vals.join(',')}`, args);
  }
  console.log(`  sanidad+movimientos (${Date.now() - t0} ms)`);
}

// Reproducción: servicios y preñeces sobre las hembras (el bloque más caro de computeDesired)
{
  const hembras = animales.filter((a) => a.sex === 'F');
  const be = [];
  for (let i = 0; i < hembras.length; i += 400) {
    const parte = hembras.slice(i, i + 400); const args = [];
    const vals = parte.map((h, j) => `($${args.push(org)},$${args.push(h.id)},'service_ai', now() - ($${args.push(60 + ((i + j) % 120))}::int || ' days')::interval)`);
    const r = await q(`INSERT INTO breeding_events (tenant_id, animal_id, type, occurred_at) VALUES ${vals.join(',')} RETURNING id, animal_id`, args);
    be.push(...r);
  }
  // 65% preñadas; 1 de cada 12 con parto próximo (regla calving_soon)
  const pren = be.filter((_, i) => i % 100 < 65);
  for (let i = 0; i < pren.length; i += 400) {
    const parte = pren.slice(i, i + 400); const args = [];
    const vals = parte.map((p, j) => `($${args.push(org)},$${args.push(p.animal_id)},$${args.push(p.id)}, CURRENT_DATE - 40, 'ultrasound', CURRENT_DATE + $${args.push((i + j) % 12 === 0 ? 10 : 200)}::int, 'open')`);
    await q(`INSERT INTO pregnancies (tenant_id, animal_id, breeding_event_id, diagnosis_date, method, expected_due_date, status) VALUES ${vals.join(',')}`, args);
  }
  console.log(`  reproducción: ${be.length} servicios, ${pren.length} preñeces (${Date.now() - t0} ms)`);
}

// Tareas pendientes (agenda + task_overdue/due_today)
{
  const filas = animales.filter((_, i) => i % 5 === 0);
  for (let i = 0; i < filas.length; i += 400) {
    const parte = filas.slice(i, i + 400); const args = [];
    const vals = parte.map((a, j) => `($${args.push(org)},$${args.push(farm)},$${args.push('Revisión — ' + (i + j))},'health', now() + ($${args.push(((i + j) % 30) - 10)}::int || ' days')::interval,'pending','animal',$${args.push(a.id)})`);
    await q(`INSERT INTO tasks (tenant_id, farm_id, title, type, due_date, status, related_type, related_id) VALUES ${vals.join(',')}`, args);
  }
  console.log(`  tareas: ${filas.length} (${Date.now() - t0} ms)`);
}

const cuentas = await q(`SELECT
  (SELECT count(*)::int FROM animals WHERE tenant_id=$1 AND status='active') AS animales,
  (SELECT count(*)::int FROM weighings WHERE tenant_id=$1) AS pesajes,
  (SELECT count(*)::int FROM vaccinations WHERE tenant_id=$1) AS vacunas,
  (SELECT count(*)::int FROM treatments WHERE tenant_id=$1) AS tratamientos,
  (SELECT count(*)::int FROM breeding_events WHERE tenant_id=$1) AS servicios,
  (SELECT count(*)::int FROM pregnancies WHERE tenant_id=$1) AS prenieces,
  (SELECT count(*)::int FROM tasks WHERE tenant_id=$1) AS tareas,
  (SELECT count(*)::int FROM animal_movements WHERE tenant_id=$1) AS movimientos,
  (SELECT count(*)::int FROM animal_events WHERE tenant_id=$1) AS eventos`, [org]);
console.log(`\nListo en ${Math.round((Date.now() - t0) / 1000)}s:`, JSON.stringify(cuentas[0]));
await db.close();
