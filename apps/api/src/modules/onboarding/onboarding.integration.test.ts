import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';
import { AnimalWriteService } from '../herd/animal-write.service';
import { HerdService } from '../herd/herd.service';
import { LotsService } from '../herd/lots.service';
import { BillingService } from '../billing/billing.service';
import { OnboardingService } from './onboarding.service';
import { SAMPLE_HERD, SAMPLE_TAG_PREFIX } from './sample-herd';

/**
 * Datos de ejemplo (O-3). Lo que se prueba acá no es que se carguen: es que se puedan SACAR.
 *
 * Un hato de muestra que no se puede quitar del todo es peor que no tenerlo. Un animal inventado
 * que sobrevive al borrado entra en el conteo del hato, en los KPIs, en los reportes y en la
 * contabilidad de la finca, y se descubre tarde — cuando ya nadie se acuerda de dónde salió y hay
 * meses de datos reales encima.
 */
describe('los datos de ejemplo se pueden sacar', () => {
  let db: DbService;
  let onboarding: OnboardingService;
  let herd: HerdService;
  let lots: LotsService;
  let originalCwd: string;
  let tmp: string;

  /** Todo lo que tiene que volver a su lugar después de quitar el ejemplo. */
  const foto = async () => ({
    animales: (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM animals WHERE tenant_id=$1 AND deleted_at IS NULL`, [db.tenant]))!.n,
    lotes: (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM lots WHERE tenant_id=$1 AND deleted_at IS NULL`, [db.tenant]))!.n,
    pesajes: (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM weighings WHERE tenant_id=$1 AND deleted_at IS NULL`, [db.tenant]))!.n,
    eventos: (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM animal_events WHERE tenant_id=$1 AND deleted_at IS NULL`, [db.tenant]))!.n,
    identificadores: (await db.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM animal_identifiers WHERE tenant_id=$1 AND deleted_at IS NULL`,
      [db.tenant],
    ))!.n,
  });

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'onboarding-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    const writer = new AnimalWriteService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db));
    herd = new HerdService(db, writer, new BillingService(db));
    lots = new LotsService(db);
    onboarding = new OnboardingService(db, herd, lots);
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('QUITAR EL EJEMPLO DEJA LA FINCA EXACTAMENTE COMO ESTABA', async () => {
    // La promesa entera de esta función, en un test. No alcanza con que se borren los animales:
    // si quedaran los pesajes, los eventos o los identificadores, la finca arrastraría datos de un
    // hato que ya no existe.
    const antes = await foto();
    await onboarding.loadSample();

    const conEjemplo = await foto();
    expect(conEjemplo.animales).toBe(antes.animales + SAMPLE_HERD.length);
    expect(conEjemplo.pesajes).toBe(antes.pesajes + SAMPLE_HERD.length * 2); // dos por animal → hay GDP

    await onboarding.removeSample();
    expect(await foto()).toEqual(antes);
  }, 120_000);

  it('EL BORRADO SE GUÍA POR LO ANOTADO, NO POR LA CARAVANA', async () => {
    // La diferencia entre una garantía y una heurística. Un animal del productor que por casualidad
    // se llame como los de ejemplo —o que él mismo haya numerado así— NO se toca, porque no está
    // anotado. Si el borrado buscara por prefijo, este animal desaparecería sin explicación.
    const impostor: any = await herd.createAnimal({
      tag: `${SAMPLE_TAG_PREFIX}999`,
      sex: 'F',
      category_code: 'vaca',
    });

    await onboarding.loadSample();
    await onboarding.removeSample();

    const vive = await db.one<{ id: string }>(`SELECT id FROM animals WHERE id=$1 AND deleted_at IS NULL`, [impostor.id]);
    expect(vive, 'se borró un animal del productor por parecerse a los de ejemplo').toBeTruthy();

    await db.query(`UPDATE animals SET deleted_at = now() WHERE id = $1`, [impostor.id]); // limpieza
  }, 120_000);

  it('lo que el productor cargó ANTES no se toca', async () => {
    const mio: any = await herd.createAnimal({ tag: 'MIA-001', sex: 'F', category_code: 'vaca' });
    await herd.registerEvent(mio.id, { type: 'weighing', weight_kg: 400, occurred_at: '2026-07-01' });
    const miLote: any = await lots.createLot({ name: 'Mi rodeo' });

    await onboarding.loadSample();
    await onboarding.removeSample();

    expect(await db.one(`SELECT id FROM animals WHERE id=$1 AND deleted_at IS NULL`, [mio.id])).toBeTruthy();
    expect(await db.one(`SELECT id FROM lots WHERE id=$1 AND deleted_at IS NULL`, [miLote.id])).toBeTruthy();
    const pesaje = await db.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM weighings WHERE animal_id=$1 AND deleted_at IS NULL`,
      [mio.id],
    );
    expect(pesaje!.n, 'se borró un pesaje del productor').toBe(1);

    await db.query(`UPDATE animals SET deleted_at = now() WHERE id = $1`, [mio.id]);
    await db.query(`UPDATE lots SET deleted_at = now() WHERE id = $1`, [miLote.id]);
  }, 120_000);

  it('UN LOTE DE EJEMPLO CON UN ANIMAL DEL PRODUCTOR ADENTRO SE CONSERVA', async () => {
    // El caso que deja al productor sin grupo: si movió un animal suyo a un lote de ejemplo,
    // borrarlo lo dejaría sin lote. Se prefiere devolverle un lote de más que un animal suelto.
    const mio: any = await herd.createAnimal({ tag: 'MIA-002', sex: 'F', category_code: 'vaca' });
    await onboarding.loadSample();

    const loteEjemplo = await db.one<{ id: string }>(
      `SELECT row_id AS id FROM onboarding_sample_rows WHERE tenant_id=$1 AND kind='lot' LIMIT 1`,
      [db.tenant],
    );
    await db.query(`UPDATE animals SET current_lot_id=$1 WHERE id=$2`, [loteEjemplo!.id, mio.id]);

    const r = await onboarding.removeSample();
    expect(r.lots_kept).toBe(1);
    expect(await db.one(`SELECT id FROM lots WHERE id=$1 AND deleted_at IS NULL`, [loteEjemplo!.id])).toBeTruthy();
    expect(await db.one(`SELECT id FROM animals WHERE id=$1 AND deleted_at IS NULL`, [mio.id])).toBeTruthy();

    await db.query(`UPDATE animals SET deleted_at = now() WHERE id = $1`, [mio.id]);
    await db.query(`UPDATE lots SET deleted_at = now() WHERE id = $1`, [loteEjemplo!.id]);
  }, 120_000);

  it('no se carga dos veces ni se quita lo que no está', async () => {
    // Dos hatos de ejemplo encima no le sirven a nadie y hacen el borrado más difícil de explicar.
    await onboarding.loadSample();
    await expect(onboarding.loadSample()).rejects.toMatchObject({ status: 409 });
    await onboarding.removeSample();
    await expect(onboarding.removeSample()).rejects.toMatchObject({ status: 409 });
  }, 120_000);

  it('el estado dice si hay ejemplo cargado', async () => {
    expect(await onboarding.sampleStatus()).toMatchObject({ loaded: false, animals: 0 });
    await onboarding.loadSample();
    expect(await onboarding.sampleStatus()).toMatchObject({ loaded: true, animals: SAMPLE_HERD.length });
    await onboarding.removeSample();
    expect(await onboarding.sampleStatus()).toMatchObject({ loaded: false });
  }, 120_000);

  it('el hato de ejemplo se distingue a simple vista', async () => {
    // Si algún día el borrado fallara, la diferencia tiene que verse en cualquier listado en vez de
    // descubrirse cuando no cierra el conteo del hato.
    for (const a of SAMPLE_HERD) expect(a.tag.startsWith(SAMPLE_TAG_PREFIX)).toBe(true);
  });

  it('trae hembras y machos: si no, no hay reproducción que mostrar', async () => {
    // El ejemplo existe para que el productor VEA la app funcionando. Un hato de un solo sexo deja
    // apagada media aplicación justo cuando la está evaluando.
    expect(SAMPLE_HERD.some((a) => a.sex === 'F')).toBe(true);
    expect(SAMPLE_HERD.some((a) => a.sex === 'M')).toBe(true);
  });
});
