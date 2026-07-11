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

/** Request JSON simple (GET, etc.) con token. */
async function api(token, method, path) {
  const res = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${token}` } });
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

  console.log(failures === 0 ? '\nE2E upload de importación: TODO OK ✓' : `\nE2E upload de importación: ${failures} fallas ✗`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E error:', e.message);
  process.exit(1);
});
