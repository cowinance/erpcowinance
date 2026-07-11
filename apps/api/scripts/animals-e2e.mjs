/**
 * E2E del canal REST de alta de animal (POST /animals) — golden permanente del
 * refactor P2 oleada 1 (persistencia neutral `AnimalWriteService`; REST como
 * adaptador delgado). Su razón de ser: que un cambio futuro del canal de
 * importación NO pueda romper en silencio el canal REST.
 *
 * Cubre el camino completo por HTTP (misma infra que auth-e2e / sync-e2e):
 *   1. alta exitosa (201)
 *   2. fila de animals creada (GET /animals/:id)
 *   3. identificador visual creado (animal_identifiers)
 *   4. evento de timeline 'birth' con source='manual'
 *   5. caravana duplicada → 400 animal.duplicate_tag
 *   6. categoría inexistente → 400 animal.invalid_category
 *   7. campos obligatorios faltantes → 400 animal.missing_fields
 * Y las dos correcciones DELIBERADAS de la oleada (fallo accidental → dominio explícito):
 *   8. normalización de caravana (TagNumber recorta espacios) — observable en el identificador
 *   9. sexo inválido → 400 animal.invalid_sex controlado (antes: CHECK de DB → error interno)
 *
 * Requiere la API corriendo (npm run api).
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
  console.log('── E2E alta de animal (canal REST) ──');

  const jose = (await api('POST', '/auth/login', { email: 'cowinance@gmail.com', password: 'cowinance' })).json;
  check('login Jose', !!jose?.access_token, jose?.user?.name);
  const token = jose.access_token;

  const tag = `E2E-${Date.now()}`;

  // 1-3. Alta exitosa → fila de animals + identificador visual
  const created = await api('POST', '/animals', { tag, sex: 'F', category_code: 'vaca', name: 'Golden' }, token);
  check('alta exitosa → 201', created.status === 201, `status=${created.status}`);
  const id = created.json?.id;
  check('respuesta trae id del animal', !!id);
  check('DTO: categoría resuelta (Vaca)', created.json?.category === 'Vaca', created.json?.category);
  check('DTO: nombre persistido', created.json?.name === 'Golden');
  check(
    'animal_identifiers: caravana visual creada',
    (created.json?.identifiers ?? []).some((i) => i.type === 'visual' && i.value === tag),
    JSON.stringify(created.json?.identifiers ?? []),
  );

  // 2. Fila de animals recuperable por id (GET independiente del POST)
  const fetched = await api('GET', `/animals/${id}`, undefined, token);
  check('GET /animals/:id devuelve la fila creada', fetched.status === 200 && fetched.json?.id === id);
  check('animals: sexo persistido', fetched.json?.sex === 'F');

  // 4. Evento de timeline 'birth' con source='manual'
  const timeline = (await api('GET', `/animals/${id}/timeline`, undefined, token)).json;
  const birth = Array.isArray(timeline) ? timeline.find((e) => e.event_type === 'birth') : null;
  check("timeline: existe evento 'birth'", !!birth);
  check("timeline: evento 'birth' con source='manual'", birth?.source === 'manual', `source=${birth?.source}`);

  // 5. Caravana duplicada (misma caravana, animal activo) → 400 animal.duplicate_tag
  const dup = await api('POST', '/animals', { tag, sex: 'F', category_code: 'vaca' }, token);
  check('duplicado → 400', dup.status === 400, `status=${dup.status}`);
  check('duplicado → code animal.duplicate_tag', dup.json?.code === 'animal.duplicate_tag', dup.json?.code);

  // 6. Categoría inexistente → 400 animal.invalid_category
  const badCat = await api('POST', '/animals', { tag: `${tag}-C`, sex: 'F', category_code: 'no-existe' }, token);
  check('categoría inexistente → 400', badCat.status === 400, `status=${badCat.status}`);
  check('categoría inexistente → code animal.invalid_category', badCat.json?.code === 'animal.invalid_category', badCat.json?.code);

  // 7. Campos obligatorios faltantes → 400 animal.missing_fields
  const missing = await api('POST', '/animals', { sex: 'F' }, token);
  check('faltan campos → 400', missing.status === 400, `status=${missing.status}`);
  check('faltan campos → code animal.missing_fields', missing.json?.code === 'animal.missing_fields', missing.json?.code);

  // 8. MEJORA DELIBERADA: normalización de caravana (TagNumber recorta espacios)
  const trimmedTag = `E2E-TRIM-${Date.now()}`;
  const trimmed = await api('POST', '/animals', { tag: `   ${trimmedTag}   `, sex: 'M', category_code: 'toro' }, token);
  check('caravana con espacios → 201', trimmed.status === 201, `status=${trimmed.status}`);
  check(
    'MEJORA: la caravana se persiste normalizada (sin espacios)',
    (trimmed.json?.identifiers ?? []).some((i) => i.type === 'visual' && i.value === trimmedTag),
    JSON.stringify(trimmed.json?.identifiers ?? []),
  );

  // 9. MEJORA DELIBERADA: sexo inválido → 400 controlado (antes llegaba al CHECK de DB)
  const badSex = await api('POST', '/animals', { tag: `${tag}-S`, sex: 'X', category_code: 'vaca' }, token);
  check('sexo inválido → 400 (no error interno)', badSex.status === 400, `status=${badSex.status}`);
  check('MEJORA: sexo inválido → code animal.invalid_sex', badSex.json?.code === 'animal.invalid_sex', badSex.json?.code);

  console.log(failures === 0 ? '\nE2E alta de animal: TODO OK ✓' : `\nE2E alta de animal: ${failures} fallas ✗`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E error:', e.message);
  process.exit(1);
});
