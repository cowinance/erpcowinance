/**
 * E2E del upload de importación (P2 oleada 3.3b) — POST /v1/imports (multipart).
 * Verifica el contrato de la carga y la traducción de errores a códigos de dominio.
 * (La lectura de filas y el aislamiento multi-tenant completo se cierran en 3.3c
 * con los GET.) Requiere la API corriendo (npm run api). Mismo harness HTTP.
 */
const API = process.env.API_URL ?? 'http://localhost:3001/v1';

async function login(email, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return (await res.json()).access_token;
}

/** Request JSON (GET/PUT/…) con token y body opcional. */
async function api(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

/** POST multipart: partes opcionales file (Blob) y entity_type (texto). */
async function upload(token, { csv, filename = 'hato.csv', entityType = 'animal', withFile = true, withEntity = true }) {
  const fd = new FormData();
  if (withFile) fd.append('file', new Blob([csv ?? ''], { type: 'text/csv' }), filename);
  if (withEntity) fd.append('entity_type', entityType);
  const res = await fetch(`${API}/imports`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
  return { status: res.status, json: await res.json().catch(() => null) };
}

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('── E2E upload de importación (POST /v1/imports) ──');
  const token = await login('cowinance@gmail.com', 'cowinance');
  check('login Jose', !!token);

  // 1. Alta exitosa
  const csv = 'Caravana,Sexo,Categoría,Nombre\n7001,F,vaca,Lola\n7002,M,toro,Fierro\n7003,F,vaca,';
  const ok = await upload(token, { csv });
  check('upload válido → 201', ok.status === 201, `status=${ok.status} ${JSON.stringify(ok.json)}`);
  check('estado inicial uploaded', ok.json?.status === 'uploaded');
  check('total_rows = 3', ok.json?.total_rows === 3, `total=${ok.json?.total_rows}`);
  check('source_filename = hato.csv', ok.json?.source_filename === 'hato.csv');
  const map = ok.json?.mapping ?? {};
  const expected = { tag: 'Caravana', sex: 'Sexo', category_code: 'Categoría', name: 'Nombre' };
  check(
    'mapping sugerido correcto (por campo, orden-independiente)',
    Object.keys(expected).every((k) => map[k] === expected[k]) && Object.keys(map).length === 4,
    JSON.stringify(map),
  );
  check('contadores en 0', ok.json?.created_count === 0 && ok.json?.error_count === 0 && ok.json?.invalid_count === 0);

  // 2. Sin parte de archivo
  const noFile = await upload(token, { withFile: false });
  check('sin file → 400 import.file_required', noFile.status === 400 && noFile.json?.code === 'import.file_required', noFile.json?.code);

  // 3. Archivo vacío
  const empty = await upload(token, { csv: '' });
  check('archivo vacío → 400 import.empty_file', empty.status === 400 && empty.json?.code === 'import.empty_file', empty.json?.code);

  // 4. entity_type inválido
  const badEntity = await upload(token, { csv, entityType: 'finanzas' });
  check('entity_type=finanzas → 400 import.invalid_entity_type', badEntity.status === 400 && badEntity.json?.code === 'import.invalid_entity_type', badEntity.json?.code);

  // 5. CSV inválido (comilla sin cerrar)
  const badCsv = await upload(token, { csv: 'a,b\n1,"x' });
  check('CSV malformado → 400 import.csv_parse_error', badCsv.status === 400 && badCsv.json?.code === 'import.csv_parse_error', `${badCsv.status} ${badCsv.json?.code}`);

  // 6. Fila irregular (más columnas que el encabezado)
  const irregular = await upload(token, { csv: 'Caravana,Sexo\n7001,F\n7002,M,sobra' });
  check('fila con exceso de columnas → 400 import.irregular_row', irregular.status === 400 && irregular.json?.code === 'import.irregular_row', `${irregular.status} ${irregular.json?.code}`);

  // 7. Solo encabezados (0 filas de datos)
  const headersOnly = await upload(token, { csv: 'Caravana,Sexo' });
  check('solo encabezados → 400 import.empty_file', headersOnly.status === 400 && headersOnly.json?.code === 'import.empty_file', headersOnly.json?.code);

  // 8. GET batch (3.3c)
  const batchId = ok.json?.id;
  const got = await api(token, 'GET', `/imports/${batchId}`);
  check('GET /imports/:id → 200 con el batch', got.status === 200 && got.json?.id === batchId && got.json?.status === 'uploaded');

  // 9. GET rows: las 3 filas persistieron con row_number y raw correctos
  const rows = await api(token, 'GET', `/imports/${batchId}/rows`);
  check('GET /imports/:id/rows → 3 filas persistidas', (rows.json?.data ?? []).length === 3, `n=${rows.json?.data?.length}`);
  const r1 = (rows.json?.data ?? []).find((r) => r.row_number === 1);
  check('fila 1: row_number y raw correctos', r1?.raw?.Caravana === '7001' && r1?.raw?.Sexo === 'F' && r1?.status === 'pending', JSON.stringify(r1?.raw));
  check('sin next_cursor cuando entran todas', rows.json?.next_cursor === null);

  // 10. Paginación por cursor (limit=2 → 2 + cursor → 1)
  const p1 = await api(token, 'GET', `/imports/${batchId}/rows?limit=2`);
  check('página 1: 2 filas + next_cursor', (p1.json?.data ?? []).length === 2 && !!p1.json?.next_cursor);
  const p2 = await api(token, 'GET', `/imports/${batchId}/rows?limit=2&cursor=${encodeURIComponent(p1.json.next_cursor)}`);
  check('página 2: 1 fila + sin next_cursor', (p2.json?.data ?? []).length === 1 && p2.json?.next_cursor === null, `n=${p2.json?.data?.length}`);

  // 11. Multi-tenant: María (El Ombú) no ve el batch ni las filas de Jose
  const mToken = await login('maria@elombu.com', 'ombu1234');
  check('login María', !!mToken);
  const mGet = await api(mToken, 'GET', `/imports/${batchId}`);
  check('María GET batch de Jose → 404', mGet.status === 404, `status=${mGet.status}`);
  const mRows = await api(mToken, 'GET', `/imports/${batchId}/rows`);
  check('María GET rows de Jose → 404', mRows.status === 404, `status=${mRows.status}`);

  // 12. PUT mapping (3.4) — edición del mapping + validaciones
  const putOk = await api(token, 'PUT', `/imports/${batchId}/mapping`, {
    mapping: { tag: 'Caravana', sex: 'Sexo', category_code: 'Categoría' },
  });
  check('PUT mapping válido → 200 y status mapped', putOk.status === 200 && putOk.json?.status === 'mapped', `${putOk.status} ${putOk.json?.status}`);
  check(
    'mapping persistido (3 campos)',
    putOk.json?.mapping?.tag === 'Caravana' && putOk.json?.mapping?.sex === 'Sexo' && putOk.json?.mapping?.category_code === 'Categoría' && Object.keys(putOk.json?.mapping ?? {}).length === 3,
    JSON.stringify(putOk.json?.mapping),
  );
  const putMissing = await api(token, 'PUT', `/imports/${batchId}/mapping`, { mapping: { tag: 'Caravana' } });
  check('PUT sin obligatorios → 400 import.mapping_missing_required', putMissing.status === 400 && putMissing.json?.code === 'import.mapping_missing_required', putMissing.json?.code);
  const putUnknown = await api(token, 'PUT', `/imports/${batchId}/mapping`, { mapping: { tag: 'Caravana', sex: 'Sexo', category_code: 'Categoría', zzz: 'X' } });
  check('PUT con campo desconocido → 400 import.invalid_mapping', putUnknown.status === 400 && putUnknown.json?.code === 'import.invalid_mapping', putUnknown.json?.code);
  const mPut = await api(mToken, 'PUT', `/imports/${batchId}/mapping`, { mapping: { tag: 'Caravana', sex: 'Sexo', category_code: 'Categoría' } });
  check('María PUT mapping en batch de Jose → 404', mPut.status === 404, `status=${mPut.status}`);

  // 13. Preview (3.5) — validación por fila sin escribir, con caravana activa existente
  const ts = Date.now();
  const dupTag = `PRV-${ts}`;
  const createdDup = await api(token, 'POST', '/animals', { tag: dupTag, sex: 'F', category_code: 'vaca' });
  check('animal con caravana existente creado', createdDup.status === 201 || createdDup.status === 200, `status=${createdDup.status}`);
  const mixed = [
    'Caravana,Sexo,Categoría',
    `${dupTag},F,vaca`, // duplicado: caravana activa existente
    `N1-${ts},F,vaca`, // válida
    `N2-${ts},X,vaca`, // inválida: sexo
    `N1-${ts},M,toro`, // duplicado intra-archivo (N1 repetida)
    `N3-${ts},F,nope`, // inválida: categoría inexistente
  ].join('\n');
  const pvUp = await upload(token, { csv: mixed, filename: 'mixto.csv' });
  check('upload mixto → 201', pvUp.status === 201, `status=${pvUp.status}`);
  const pvId = pvUp.json?.id;
  const prev = await api(token, 'POST', `/imports/${pvId}/preview`);
  check('preview → 200/201', prev.status === 200 || prev.status === 201, `${prev.status}`);
  check(
    'counts: total 5, valid 1, invalid 2, duplicate 2',
    prev.json?.counts?.total === 5 && prev.json?.counts?.valid === 1 && prev.json?.counts?.invalid === 2 && prev.json?.counts?.duplicate === 2,
    JSON.stringify(prev.json?.counts),
  );
  check('sample con 5 veredictos', Array.isArray(prev.json?.sample) && prev.json.sample.length === 5);
  const afterPrev = await api(token, 'GET', `/imports/${pvId}`);
  check('batch queda en previewed', afterPrev.json?.status === 'previewed', afterPrev.json?.status);
  const pvRows = await api(token, 'GET', `/imports/${pvId}/rows`);
  check('preview no escribe: filas siguen pending', (pvRows.json?.data ?? []).every((r) => r.status === 'pending'));
  const mPrev = await api(mToken, 'POST', `/imports/${pvId}/preview`);
  check('María preview en batch de Jose → 404', mPrev.status === 404, `status=${mPrev.status}`);

  // 14. Commit + procesamiento end-to-end (P-c.3): upload → preview → commit → poller → animales → pull
  const cts = Date.now();
  const cdup = `IMPDUP-${cts}`;
  await api(token, 'POST', '/animals', { tag: cdup, sex: 'F', category_code: 'vaca' }); // animal existente → skipped
  const cdev = (await api(token, 'POST', '/sync/devices', { platform: 'web', device_name: 'commit-e2e' })).json;
  const cBase = (await api(token, 'GET', '/sync/state')).json.server_cursor; // cursor tras crear el dup
  const ccsv = ['Caravana,Sexo,Categoría', `IMPNEW-${cts},F,vaca`, `${cdup},F,vaca`, `IMPBAD-${cts},X,vaca`].join('\n');
  const cup = await upload(token, { csv: ccsv, filename: 'commit.csv' });
  check('commit-flow: upload → 201', cup.status === 201, `status=${cup.status}`);
  const ccid = cup.json?.id;
  const cprev = await api(token, 'POST', `/imports/${ccid}/preview`);
  check('commit-flow: preview ok', cprev.status === 200 || cprev.status === 201, `status=${cprev.status}`);
  const ccommit = await api(token, 'POST', `/imports/${ccid}/commit`);
  check('commit → queued', (ccommit.status === 200 || ccommit.status === 201) && ccommit.json?.status === 'queued', `${ccommit.status} ${ccommit.json?.status}`);

  let cfinal = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const g = (await api(token, 'GET', `/imports/${ccid}`)).json;
    if (['completed', 'completed_with_errors', 'failed'].includes(g?.status)) { cfinal = g; break; }
  }
  check('commit-flow: procesado a estado terminal', !!cfinal, cfinal?.status);
  check('commit-flow: counts created 1 / skipped 1 / invalid 1',
    cfinal?.created_count === 1 && cfinal?.skipped_count === 1 && cfinal?.invalid_count === 1,
    JSON.stringify({ c: cfinal?.created_count, s: cfinal?.skipped_count, i: cfinal?.invalid_count }));
  check('commit-flow: status completed_with_errors', cfinal?.status === 'completed_with_errors', cfinal?.status);

  const cpull = (await api(token, 'GET', `/sync/pull?device_id=${cdev.id}&cursor=${cBase}`)).json;
  const cgot = (cpull.changesets ?? []).some((c) => c.device_id === null && (c.ops ?? []).some((op) => op.table === 'animals' && op.fields?.visual_tag === `IMPNEW-${cts}`));
  check('commit-flow: device pull recibe el animal importado (server-origin)', cgot);

  const crecommit = await api(token, 'POST', `/imports/${ccid}/commit`);
  check('commit-flow: re-commit rechazado (no previewed) → 400', crecommit.status === 400 && crecommit.json?.code === 'import.not_previewed', `${crecommit.status} ${crecommit.json?.code}`);

  // 15. Genealogía end-to-end (P-d.2): CSV con Madre → vínculo dam intra-import
  const gts = Date.now();
  const gdam = `GDAM-${gts}`;
  const gchild = `GCHILD-${gts}`;
  const gcsv = ['Caravana,Sexo,Categoría,Madre', `${gdam},F,vaca,`, `${gchild},F,vaca,${gdam}`].join('\n');
  const gup = await upload(token, { csv: gcsv, filename: 'genealogy.csv' });
  check('genealogía: mapping sugiere dam_tag=Madre', gup.json?.mapping?.dam_tag === 'Madre', JSON.stringify(gup.json?.mapping));
  const gcid = gup.json?.id;
  await api(token, 'POST', `/imports/${gcid}/preview`);
  await api(token, 'POST', `/imports/${gcid}/commit`);
  let gfinal = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const g = (await api(token, 'GET', `/imports/${gcid}`)).json;
    if (['completed', 'completed_with_errors', 'failed'].includes(g?.status)) { gfinal = g; break; }
  }
  check('genealogía: procesado (created 2)', gfinal?.status === 'completed' && gfinal?.created_count === 2, `${gfinal?.status} created=${gfinal?.created_count}`);
  // el hijo quedó vinculado a la madre
  const childLookup = await api(token, 'POST', '/animals/lookup', { identifier: gchild });
  const childFull = (await api(token, 'GET', `/animals/${childLookup.json?.id}`)).json;
  check('genealogía: el hijo tiene dam_tag = la madre', childFull?.genealogy?.dam_tag === gdam, JSON.stringify(childFull?.genealogy));

  console.log(failures === 0 ? '\nE2E upload de importación: TODO OK ✓' : `\nE2E upload de importación: ${failures} fallas ✗`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E error:', e.message);
  process.exit(1);
});
