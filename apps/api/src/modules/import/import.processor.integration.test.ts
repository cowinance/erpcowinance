import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';
import { AnimalWriteService } from '../herd/animal-write.service';
import { ImportClaimRepository } from './import-claim.repository';
import { ImportProcessor } from './import.processor';
import { MovementService } from '../land/movement.service';
import { ImportService } from './import.service';

/**
 * Prueba de INTEGRACIÓN real del procesador de importación (P2 P-c.2), sobre un
 * PGlite en un directorio TEMPORAL (aislado del dev — se cambia el cwd antes del
 * boot, sin tocar DbService). Los providers se instancian MANUALMENTE (no vía la
 * DI de Nest: vitest/esbuild no emite metadata de decoradores, lo que rompería la
 * DI; el wiring manual prueba el mismo código real). Se invoca `processBatch`
 * directo (no el poller). Cubre: válidas/inválidas/duplicadas, transición
 * exclusiva pending→terminal, contadores por delta, un changeset por chunk con
 * creaciones, ausencia de changeset sin creaciones, idempotencia, error SQL
 * inesperado que revierte el chunk, recuperación por heartbeat vencido, timeline
 * animal_imported y cero conflictos.
 */
describe('ImportProcessor · integración', () => {
  let db: DbService;
  let processor: ImportProcessor;
  let claims: ImportClaimRepository;
  let animalWrite: AnimalWriteService;
  let importService: ImportService;
  let tenantId: string;
  let userId: string;
  let originalCwd: string;
  let tmp: string;
  let tagSeq = 0;

  const uniqTag = (p: string) => `PC2-${p}-${Date.now()}-${tagSeq++}`;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'import-proc-'));
    process.chdir(tmp); // DbService usa join(process.cwd(),'.data','pglite') → PGlite aislado
    process.env.SEED_DEMO = 'on';

    db = new DbService();
    await db.onModuleInit(); // carga schema + catálogos + seed demo
    const versions = new SyncVersionStore(db);
    const serverOrigin = new ServerOriginChangesetWriter(db);
    animalWrite = new AnimalWriteService(db, versions, serverOrigin, new MovementService(db, versions, serverOrigin));
    claims = new ImportClaimRepository(db);
    processor = new ImportProcessor(db, claims, animalWrite); // sin onModuleInit → sin poller
    importService = new ImportService(db, animalWrite);

    tenantId = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
    userId = (await db.query<{ id: string }>(`SELECT id FROM users WHERE email = 'cowinance@gmail.com'`))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  beforeEach(() => vi.restoreAllMocks());

  const MAPPING = { tag: 'Caravana', sex: 'Sexo', category_code: 'Categoria' };
  const MAPPING_GEN = { ...MAPPING, dam_tag: 'Madre', sire_tag: 'Padre' };

  /**
   * Vence el heartbeat para simular el paso del tiempo.
   *
   * Un lote recién reclamado tiene el heartbeat fresco, así que `claimNext` no lo vuelve a tomar
   * hasta que se vence — en producción, dos minutos. Sin esto el test reclamaría una sola vez y no
   * ejercitaría el ciclo de reintento, que es justo lo que se quiere probar.
   */
  const vencerHeartbeat = () => db.query(`UPDATE import_batches SET heartbeat_at = now() - interval '1 hour'`);

  /**
   * Deja UN solo lote reclamable.
   *
   * `claimNext` toma el más viejo de la cola, así que sin esto agarra los lotes que dejaron los
   * tests anteriores de este archivo y el reintento se le aplica a otro. Es la diferencia entre
   * probar la política y probar el azar del orden de ejecución.
   */
  const soloReclamable = (id: string) =>
    db.query(`UPDATE import_batches SET status = 'completed' WHERE id <> $1 AND status IN ('queued','processing')`, [id]);

  const batchRow = async (id: string) =>
    (await db.query<{ status: string; attempts: number; last_error: string | null; finished_at: string | null }>(
      `SELECT status, attempts, last_error, finished_at FROM import_batches WHERE id = $1`, [id]))[0];

  async function seedBatch(rawRows: Record<string, string>[], status = 'queued', mapping = MAPPING): Promise<string> {
    const batch = (
      await db.query<{ id: string }>(
        `INSERT INTO import_batches (tenant_id, entity_type, mapping, status, total_rows, created_by)
         VALUES ($1,'animal',$2,$3,$4,$5) RETURNING id`,
        [tenantId, JSON.stringify(mapping), status, rawRows.length, userId],
      )
    )[0];
    for (let i = 0; i < rawRows.length; i++) {
      await db.query(
        `INSERT INTO import_rows (tenant_id, batch_id, row_number, raw, status) VALUES ($1,$2,$3,$4,'pending')`,
        [tenantId, batch.id, i + 1, JSON.stringify(rawRows[i])],
      );
    }
    return batch.id;
  }

  const getBatch = async (id: string) =>
    (await db.query<any>(`SELECT status, phase, created_count, skipped_count, invalid_count, error_count FROM import_batches WHERE id = $1`, [id]))[0];
  const getRows = async (id: string) =>
    db.query<any>(`SELECT row_number, status, resulting_entity_id FROM import_rows WHERE batch_id = $1 ORDER BY row_number`, [id]);
  const serverChangesets = async (id: string) =>
    db.query<any>(`SELECT operations FROM sync_changesets WHERE source = 'server' AND origin_ref LIKE $1`, [`import:${id}:create:%`]);
  const linkChangesets = async (id: string) =>
    db.query<any>(`SELECT operations FROM sync_changesets WHERE source = 'server' AND origin_ref LIKE $1`, [`import:${id}:link:%`]);

  it('procesa válidas/inválidas/duplicadas: contadores por delta, un changeset con las creadas, timeline y cero conflictos', async () => {
    const t1 = uniqTag('A');
    const batchId = await seedBatch([
      { Caravana: t1, Sexo: 'F', Categoria: 'vaca' }, // created
      { Caravana: uniqTag('B'), Sexo: 'X', Categoria: 'vaca' }, // invalid (sexo)
      { Caravana: t1, Sexo: 'M', Categoria: 'toro' }, // skipped (dup de la 1ª, misma tx)
      { Caravana: uniqTag('C'), Sexo: 'F', Categoria: 'nope' }, // invalid (categoría)
    ]);
    const claimed = await claims.claimNext();
    expect(claimed?.id).toBe(batchId);
    await processor.processBatch(batchId, tenantId);

    const b = await getBatch(batchId);
    expect({ created: b.created_count, skipped: b.skipped_count, invalid: b.invalid_count }).toEqual({ created: 1, skipped: 1, invalid: 2 });
    expect(b.status).toBe('completed_with_errors');
    expect(b.phase).toBeNull();

    const rows = await getRows(batchId);
    expect(rows.map((r: any) => r.status)).toEqual(['created', 'invalid', 'skipped', 'invalid']);
    const createdRow = rows[0];
    expect(createdRow.resulting_entity_id).toBeTruthy();

    const cs = await serverChangesets(batchId);
    expect(cs).toHaveLength(1);
    expect(cs[0].operations.ops).toHaveLength(1);
    expect(cs[0].operations.ops[0].fields.visual_tag).toBe(t1);

    const ev = await db.query<any>(
      `SELECT event_type, source FROM animal_events WHERE animal_id = $1 ORDER BY recorded_at`,
      [createdRow.resulting_entity_id],
    );
    expect(ev.some((e: any) => e.event_type === 'animal_imported' && e.source === 'import')).toBe(true);

    const conf = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM sync_conflicts WHERE entity_id = $1`, [createdRow.resulting_entity_id]);
    expect(conf[0].n).toBe(0);
  });

  it('chunk sin creaciones (solo inválidas/skipped) → NO emite changeset', async () => {
    const batchId = await seedBatch([
      { Caravana: uniqTag('D'), Sexo: 'X', Categoria: 'vaca' },
      { Caravana: uniqTag('E'), Sexo: 'F', Categoria: 'nope' },
    ]);
    await claims.claimNext();
    await processor.processBatch(batchId, tenantId);
    const b = await getBatch(batchId);
    expect({ created: b.created_count, invalid: b.invalid_count }).toEqual({ created: 0, invalid: 2 });
    expect(await serverChangesets(batchId)).toHaveLength(0);
  });

  it('reejecución idempotente: no re-cuenta ni re-emite', async () => {
    const batchId = await seedBatch([{ Caravana: uniqTag('F'), Sexo: 'F', Categoria: 'vaca' }]);
    await claims.claimNext();
    await processor.processBatch(batchId, tenantId);
    const b1 = await getBatch(batchId);
    await processor.processBatch(batchId, tenantId);
    const b2 = await getBatch(batchId);
    expect(b2.created_count).toBe(b1.created_count);
    expect(await serverChangesets(batchId)).toHaveLength(1);
  });

  it('error SQL inesperado revierte el chunk completo (filas pending, batch processing, sin changeset ni contadores)', async () => {
    const batchId = await seedBatch([
      { Caravana: uniqTag('G'), Sexo: 'F', Categoria: 'vaca' },
      { Caravana: uniqTag('H'), Sexo: 'F', Categoria: 'vaca' },
    ]);
    await claims.claimNext();
    vi.spyOn(animalWrite, 'persistNewAnimal').mockRejectedValueOnce(new Error('fallo SQL inesperado'));
    await expect(processor.processBatch(batchId, tenantId)).rejects.toThrow();

    const b = await getBatch(batchId);
    expect(b.status).toBe('processing'); // NO failed
    expect({ created: b.created_count, invalid: b.invalid_count, skipped: b.skipped_count }).toEqual({ created: 0, invalid: 0, skipped: 0 });
    const rows = await getRows(batchId);
    expect(rows.every((r: any) => r.status === 'pending')).toBe(true);
    expect(await serverChangesets(batchId)).toHaveLength(0);
  });

  it('recuperación: un batch processing con heartbeat vencido se re-reclama', async () => {
    const batchId = await seedBatch([{ Caravana: uniqTag('I'), Sexo: 'F', Categoria: 'vaca' }]);
    await db.query(
      `UPDATE import_batches SET status='processing', phase='create', heartbeat_at = now() - interval '5 minutes' WHERE id = $1`,
      [batchId],
    );
    const claimed = await claims.claimNext();
    expect(claimed?.id).toBe(batchId);
    await processor.processBatch(batchId, tenantId);
    expect((await getBatch(batchId)).status).toBe('completed');
  });

  it('link-pass: vincula dam intra-import, warnings de not_found/sex_incompatible, changeset de link e idempotencia', async () => {
    const dam = uniqTag('DAM');
    const child = uniqTag('CHILD');
    const noref = uniqTag('NOREF');
    const badsire = uniqTag('BADSIRE');
    const batchId = await seedBatch(
      [
        { Caravana: dam, Sexo: 'F', Categoria: 'vaca', Madre: '', Padre: '' }, // será la madre
        { Caravana: child, Sexo: 'F', Categoria: 'vaca', Madre: dam, Padre: '' }, // dam = intra-import
        { Caravana: noref, Sexo: 'F', Categoria: 'vaca', Madre: 'NO-EXISTE-XYZ', Padre: '' }, // dam not_found
        { Caravana: badsire, Sexo: 'F', Categoria: 'vaca', Madre: '', Padre: dam }, // sire = hembra → sex_incompatible
      ],
      'queued',
      MAPPING_GEN,
    );
    await claims.claimNext();
    await processor.processBatch(batchId, tenantId);

    const rows = await getRows(batchId);
    const damId = rows[0].resulting_entity_id;
    const childId = rows[1].resulting_entity_id;
    // vínculo dam escrito
    const childAnimal = (await db.query<{ dam_id: string | null }>(`SELECT dam_id FROM animals WHERE id = $1`, [childId]))[0];
    expect(childAnimal.dam_id).toBe(damId);
    // warnings SOLO no-exitosos
    const warns = await db.query<any>(`SELECT row_number, warnings FROM import_rows WHERE batch_id = $1 ORDER BY row_number`, [batchId]);
    expect(warns[0].warnings).toBeNull(); // la madre: sin refs
    expect(warns[1].warnings).toBeNull(); // el hijo: vinculado OK → sin warning
    expect(warns[2].warnings).toEqual([{ field: 'dam', outcome: 'not_found' }]);
    expect(warns[3].warnings).toEqual([{ field: 'sire', outcome: 'sex_incompatible' }]);
    // un changeset de link con la op del vínculo
    const lcs = await linkChangesets(batchId);
    expect(lcs).toHaveLength(1);
    expect(lcs[0].operations.ops.some((op: any) => op.rowId === childId && op.fields.dam_id === damId)).toBe(true);
    // idempotencia: reproceso no re-emite (diff-aware → sin cambios)
    await processor.processBatch(batchId, tenantId);
    expect(await linkChangesets(batchId)).toHaveLength(1);
  });

  it('el tope de reintentos es CHICO: reintentar mucho es esconder el fallo', async () => {
    // El test de abajo usa `MAX_ATTEMPTS` para armar su bucle, así que por sí solo no puede detectar
    // que el tope se vuelva enorme — pasaría igual con 999, que en la práctica es no tener tope.
    // Esta afirmación es la que fija la política: un error transitorio se resuelve en uno o dos
    // reintentos; más que eso es un error determinista, y repetirlo solo demora la mala noticia.
    expect(ImportClaimRepository.MAX_ATTEMPTS).toBeGreaterThanOrEqual(2);
    expect(ImportClaimRepository.MAX_ATTEMPTS).toBeLessThanOrEqual(5);
  });

  it('UN LOTE QUE FALLA SE CIERRA DICIENDO POR QUÉ, no reintenta para siempre', async () => {
    // El procesador contemplaba `failed` pero nunca lo usaba: su propio comentario decía «no hay
    // política de máximo de intentos todavía». Medido contra la app, una sola celda mala dejaba el
    // lote reintentando cada dos minutos —720 veces por día— con los contadores en cero, el estado
    // en «procesando» y el motivo únicamente en los logs del servidor. El productor veía
    // «procesando…» y nada más.
    const batchId = await seedBatch([{ caravana: 'RETRY-1', sexo: 'H', categoria: 'vaca' }]);
    await soloReclamable(batchId);

    // Los dos primeros fallos ANOTAN el motivo pero dejan el lote vivo: un error transitorio —una
    // caída, un bloqueo— se resuelve reintentando.
    for (let i = 1; i < ImportClaimRepository.MAX_ATTEMPTS; i++) {
      await vencerHeartbeat();
      await claims.claimNext();
      const r = await claims.noteFailure(batchId, 'error simulado');
      expect(r.gaveUp, `intento ${i} no debería rendirse`).toBe(false);
      expect((await batchRow(batchId)).status).toBe('processing');
    }

    // El último se rinde y cierra el lote.
    await vencerHeartbeat();
    await claims.claimNext();
    const ultimo = await claims.noteFailure(batchId, 'value too long for type character varying(255)');
    expect(ultimo.gaveUp).toBe(true);

    const b = await batchRow(batchId);
    expect(b.status).toBe('failed');
    expect(b.attempts).toBe(ImportClaimRepository.MAX_ATTEMPTS);
    expect(b.last_error, 'el motivo se GUARDA: sin esto vivía solo en los logs').toContain('character varying');
    expect(b.finished_at, 'y queda fechado el cierre').not.toBeNull();
  });

  it('un lote ya rendido NO se vuelve a reclamar', async () => {
    // Es lo que corta el bucle: sin esto, el heartbeat vencido lo levantaría de nuevo aunque el
    // estado dijera `failed`.
    const batchId = await seedBatch([{ caravana: 'RETRY-2', sexo: 'H', categoria: 'vaca' }]);
    await soloReclamable(batchId);
    for (let i = 0; i < ImportClaimRepository.MAX_ATTEMPTS; i++) {
      await vencerHeartbeat();
      await claims.claimNext();
      await claims.noteFailure(batchId, 'error simulado');
    }
    expect((await batchRow(batchId)).status).toBe('failed');

    // Se vencen los heartbeats de todo lo que quedó en curso: el reclamo mira eso para recuperar
    // huérfanos, y es la condición que antes revivía a este lote.
    await vencerHeartbeat();
    const reclamado = await claims.claimNext();
    expect(reclamado?.id, 'el lote rendido no vuelve a la cola').not.toBe(batchId);
  });

  it('LA VISTA PREVIA Y EL COMMIT CONTESTAN LO MISMO', async () => {
    // La previa es lo que el productor APRUEBA. Decía «4 de 4 válidas» sobre un archivo del que el
    // commit después rechazaba dos filas —raza y lote inexistentes, que la previa ni miraba— y una
    // previa que promete de más es peor que no tener previa: da confianza para seguir.
    //
    // Este test es el que impide que se vuelvan a separar: compara veredicto contra resultado fila
    // por fila. Si alguien agrega un chequeo al commit y se olvida de la previa, cae acá.
    const MAP = { tag: 'Caravana', sex: 'Sexo', category_code: 'Categoria', breed: 'Raza', lot: 'Lote' };
    const lote = (await db.query<{ name: string }>(`SELECT name FROM lots WHERE tenant_id = $1 LIMIT 1`, [tenantId]))[0].name;
    const raza = (await db.query<{ name: string }>(`SELECT name FROM breeds LIMIT 1`))[0].name;
    const tagExistente = (
      await db.query<{ value: string }>(
        `SELECT ai.value FROM animal_identifiers ai JOIN animals a ON a.id = ai.animal_id
          WHERE ai.tenant_id = $1 AND ai.type = 'visual' AND a.status = 'active' AND ai.deleted_at IS NULL LIMIT 1`,
        [tenantId],
      )
    )[0].value;

    const filas = [
      { Caravana: uniqTag('AG1'), Sexo: 'H', Categoria: 'vaca', Raza: '', Lote: '' },
      { Caravana: uniqTag('AG2'), Sexo: 'H', Categoria: 'vaca', Raza: 'Raza Que No Existe', Lote: '' },
      { Caravana: uniqTag('AG3'), Sexo: 'H', Categoria: 'vaca', Raza: '', Lote: 'Lote Que No Existe' },
      { Caravana: uniqTag('AG4'), Sexo: 'H', Categoria: 'vaca', Raza: raza, Lote: lote },
      { Caravana: uniqTag('AG5'), Sexo: 'H', Categoria: 'no-existe', Raza: '', Lote: '' },
      // Duplicada Y con la raza mal: es la fila donde el ORDEN decide el veredicto. El commit mira
      // la caravana antes que la raza, así que contesta «salteada»; si la previa mirara la raza
      // primero diría «inválida» y volveríamos a tener dos respuestas para la misma fila.
      { Caravana: tagExistente, Sexo: 'H', Categoria: 'vaca', Raza: 'Raza Que No Existe', Lote: '' },
    ];
    // El flujo real: se mapea, se mira la previa, y recién ahí se confirma. Sembrar en `queued`
    // saltearía la previa, que es justo lo que se quiere comparar.
    const batchId = await seedBatch(filas, 'mapped', MAP);
    const previa = await importService.preview(batchId);

    await db.query(`UPDATE import_batches SET status = 'queued' WHERE id = $1`, [batchId]);
    await processor.processBatch(batchId, tenantId);
    const rows = await getRows(batchId);

    // El veredicto de la previa y el resultado del commit son el mismo hecho dicho dos veces.
    const equivale: Record<string, string> = { valid: 'created', invalid: 'invalid', duplicate: 'skipped' };
    for (const v of previa.sample) {
      const fila = rows.find((r: any) => r.row_number === v.row_number);
      expect(equivale[v.verdict], `fila ${v.row_number}: la previa dijo «${v.verdict}»`).toBe(fila.status);
    }
    expect(previa.counts.valid, 'y los conteos también').toBe(rows.filter((r: any) => r.status === 'created').length);
    expect(previa.counts.invalid).toBe(rows.filter((r: any) => r.status === 'invalid').length);
    expect(previa.counts.duplicate, 'y las salteadas').toBe(rows.filter((r: any) => r.status === 'skipped').length);
  });
});
