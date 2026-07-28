import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { SemenService } from '../genetics/semen.service';
import { StrawsService } from '../genetics/straws.service';
import { EmbryosService } from '../genetics/embryos.service';
import { WeaningService } from './weaning.service';
import { TaskService } from '../tasks/task.service';
import { ReproService } from './repro.service';
import { ServicePlanService } from './service-plan.service';
import { InbreedingService } from '../genetics/inbreeding.service';

/**
 * Integración del consumo de pajuela en inseminación (G-2a): un servicio AI con semen_batch_id
 * descuenta 1 pajuela reusando SemenService (regla única); sin saldo → 403 y sin evento. `db.tenant`
 * cae al demo.
 */
describe('repro — consumo de pajuela en inseminación', () => {
  let db: DbService;
  let semen: SemenService;
  let repro: ReproService;
  let originalCwd: string;
  let tmp: string;
  let hembraId: string;

  const eventsOf = (animalId: string, batchId: string) =>
    db.query<any>(`SELECT id, semen_batch_id FROM breeding_events WHERE animal_id=$1 AND semen_batch_id=$2 AND deleted_at IS NULL`, [animalId, batchId]);

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'service-semen-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    semen = new SemenService(db, new StrawsService(db));
    repro = new ReproService(db, {} as WeaningService, {} as TaskService, semen, new EmbryosService(db, new StrawsService(db)), new StrawsService(db), new ServicePlanService(db, new StrawsService(db)), new InbreedingService(db));
    hembraId = (await db.query<{ id: string }>(`SELECT id FROM animals WHERE tenant_id=$1 AND sex='F' AND status='active' AND deleted_at IS NULL LIMIT 1`, [db.tenant]))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('AI con partida descuenta 1 pajuela y guarda semen_batch_id en el evento', async () => {
    const batch: any = await semen.create({ batch_code: 'AI-1', sire_name_external: 'Toro X', straws_available: 3 });
    const ev: any = await repro.service(hembraId, { method: 'ai', semen_batch_id: batch.id });
    expect(ev.type).toBe('service_ai');
    expect((await semen.get(batch.id) as any).straws_available).toBe(2);
    expect((await eventsOf(hembraId, batch.id)).length).toBe(1);
  });

  it('EL PADRE DE UNA IA SALE DE LA PARTIDA, SIN QUE NADIE LO MANDE', async () => {
    // El agujero que esto cierra: en una IA nadie manda el toro —va implícito en la pajuela—, así
    // que `breeding_events.sire_id` quedaba NULL justo en los servicios donde la genética se compró
    // y se pagó. El ternero nacía sin padre, la evaluación de toros no veía esas crías, y la guarda
    // de consanguinidad no corría porque recibía null.
    const [{ id: toro }] = await db.query<any>(
      `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status) 
       SELECT $1, farm_id, species_id, 'M', 'active' FROM animals WHERE id=$2 RETURNING id`,
      [db.tenant, hembraId],
    );
    const batch: any = await semen.create({ batch_code: 'AI-SIRE', sire_id: toro, straws_available: 2 });
    const ev: any = await repro.service(hembraId, { method: 'ai', semen_batch_id: batch.id });

    const [fila] = await db.query<any>(`SELECT sire_id FROM breeding_events WHERE id=$1`, [ev.id]);
    expect(fila.sire_id, 'el servicio quedó sin padre').toBe(toro);
  });

  it('lo EXPLÍCITO manda: el técnico puede corregir el toro', async () => {
    // Derivar es una ayuda, no una imposición: si la partida está mal cargada, quien está en el
    // corral tiene que poder decir cuál fue.
    const [{ id: otro }] = await db.query<any>(
      `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status)
       SELECT $1, farm_id, species_id, 'M', 'active' FROM animals WHERE id=$2 RETURNING id`,
      [db.tenant, hembraId],
    );
    const batch: any = await semen.create({ batch_code: 'AI-EXPL', sire_name_external: 'Toro externo', straws_available: 2 });
    const ev: any = await repro.service(hembraId, { method: 'ai', semen_batch_id: batch.id, sire_id: otro });
    const [fila] = await db.query<any>(`SELECT sire_id FROM breeding_events WHERE id=$1`, [ev.id]);
    expect(fila.sire_id).toBe(otro);
  });

  it('UNA IA CON SEMEN DEL PROPIO PADRE SE BLOQUEA', async () => {
    // Antes no se chequeaba nada: el guard recibía `null` porque el toro nunca llegaba. Se podía
    // inseminar una vaca con semen de su padre y el sistema no decía una palabra.
    const [{ id: padre }] = await db.query<any>(
      `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status)
       SELECT $1, farm_id, species_id, 'M', 'active' FROM animals WHERE id=$2 RETURNING id`,
      [db.tenant, hembraId],
    );
    const [{ id: hija }] = await db.query<any>(
      `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, sire_id)
       SELECT $1, farm_id, species_id, 'F', 'active', $3 FROM animals WHERE id=$2 RETURNING id`,
      [db.tenant, hembraId, padre],
    );
    const batch: any = await semen.create({ batch_code: 'AI-PADRE', sire_id: padre, straws_available: 3 });

    await expect(repro.service(hija, { method: 'ai', semen_batch_id: batch.id })).rejects.toMatchObject({
      response: { code: 'service.blocked', reasons: ['consanguinity'] },
    });
    // Y no se consumió la pajuela de un servicio que no ocurrió.
    expect(((await semen.get(batch.id)) as any).straws_available).toBe(3);
  });

  it('UNA PARTIDA PROBADA Y DESCARTADA NO SE PUEDE USAR', async () => {
    // El caso que la prueba de calidad existe para evitar: el termo se quedó sin nitrógeno, la
    // partida se probó y dio 8% de motilidad, y aun así se usa en cincuenta vacas. El problema
    // aparece a los sesenta días, con todos los diagnósticos vacíos y la temporada perdida.
    const batch: any = await semen.create({ batch_code: 'AI-MALA', sire_name_external: 'Toro W', straws_available: 5 });
    await semen.recordQualityCheck(batch.id, { motility_pct: 8, notes: 'termo bajo en junio' });

    await expect(repro.service(hembraId, { method: 'ai', semen_batch_id: batch.id })).rejects.toMatchObject({
      response: { code: 'service.blocked', reasons: ['semen_quality'] },
    });
  });

  it('una partida probada y APTA se usa normal', async () => {
    // La otra mitad: si bloqueara de más, el productor aprendería a forzar siempre y la guarda
    // dejaría de servir para algo.
    const batch: any = await semen.create({ batch_code: 'AI-BUENA', sire_name_external: 'Toro V', straws_available: 5 });
    await semen.recordQualityCheck(batch.id, { motility_pct: 62 });
    const ev: any = await repro.service(hembraId, { method: 'ai', semen_batch_id: batch.id });
    expect(ev.type).toBe('service_ai');
  });

  it('LA PRUEBA CONSUME LA PAJUELA QUE SE DESCONGELÓ', async () => {
    // Para mirarla hay que descongelarla. Si no se descontara, el saldo diría que hay una pajuela
    // más de las que hay y el productor planificaría una inseminación que no puede hacer.
    const batch: any = await semen.create({ batch_code: 'AI-QC', sire_name_external: 'Toro U', straws_available: 4 });
    await semen.recordQualityCheck(batch.id, { motility_pct: 55 });
    expect(((await semen.get(batch.id)) as any).straws_available).toBe(3);
  });

  it('una partida SIN probar no molesta a nadie', async () => {
    // Lo normal: la mayoría del semen nunca se prueba y anda perfecto. Avisar por no haberlo probado
    // convertiría el aviso en ruido de fondo.
    const batch: any = await semen.create({ batch_code: 'AI-SINQC', sire_name_external: 'Toro T', straws_available: 3 });
    const b: any = await semen.get(batch.id);
    expect(b.usability.level).toBe('ok');
    expect(b.usability.blocks).toBe(false);
  });

  it('rechaza una motilidad que no es un porcentaje', async () => {
    const batch: any = await semen.create({ batch_code: 'AI-BAD', sire_name_external: 'Toro S', straws_available: 2 });
    await expect(semen.recordQualityCheck(batch.id, { motility_pct: 140 })).rejects.toMatchObject({ status: 400 });
    await expect(semen.recordQualityCheck(batch.id, { motility_pct: 'muy buena' })).rejects.toMatchObject({ status: 400 });
  });

  it('EL VENCIMIENTO SE PUEDE CARGAR Y BLOQUEA', async () => {
    // La columna existía, el dominio la evaluaba… y `create` no la escribía: la mitad de la función
    // era inalcanzable desde la app. Se descubrió auditando, no testeando — el test del dominio
    // pasaba porque le pasaban la fecha a mano.
    const batch: any = await semen.create({ batch_code: 'AI-VENC', sire_name_external: 'Toro R', straws_available: 3, expiry_date: '2020-01-01' });
    const b: any = await semen.get(batch.id);
    expect(b.expiry_date, 'el vencimiento no se guardó').toBe('2020-01-01');
    expect(b.usability.blocks).toBe(true);
    expect(b.usability.reasons[0]).toContain('sigue siendo buena'); // no dice que el semen esté malo

    await expect(repro.service(hembraId, { method: 'ai', semen_batch_id: batch.id })).rejects.toMatchObject({
      response: { code: 'service.blocked', reasons: ['semen_quality'] },
    });
  });

  it('el vencimiento también se puede corregir después', async () => {
    const batch: any = await semen.create({ batch_code: 'AI-VENC2', sire_name_external: 'Toro Q', straws_available: 1 });
    await semen.update(batch.id, { expiry_date: '2030-06-01' });
    expect(((await semen.get(batch.id)) as any).expiry_date).toBe('2030-06-01');
  });

  it('EL VEREDICTO SE DERIVA DE LA MOTILIDAD, no se guarda al lado', async () => {
    // Era una copia del número del que sale. Mientras el umbral fue constante coincidieron siempre,
    // así que nunca dio un resultado equivocado — pero el día que el umbral se haga configurable, el
    // historial mostraría veredictos de la época vieja contra un estado calculado con el nuevo.
    const batch: any = await semen.create({ batch_code: 'AI-DERIV', sire_name_external: 'Toro P', straws_available: 4 });
    const r: any = await semen.recordQualityCheck(batch.id, { motility_pct: 62 });
    expect(r.verdict).toBe('apta');

    const historial: any[] = await semen.qualityChecks(batch.id);
    expect(historial[0].verdict).toBe('apta');
    expect(historial[0].post_thaw_motility_pct).toBe(62);

    // La columna ya no existe: si volviera, habría dos fuentes otra vez.
    const cols = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'semen_quality_checks' AND column_name = 'verdict'`,
    );
    expect(cols, 'el veredicto volvió a guardarse en la base').toHaveLength(0);
  });

  it('el historial se relee con el criterio de HOY, no con el de la época', async () => {
    // Es lo que gana derivarlo: una prueba de 22% es «dudosa» hoy, y si mañana el umbral sube pasa a
    // «descartar» en todo el historial de una vez, sin migrar nada.
    const batch: any = await semen.create({ batch_code: 'AI-HIST', sire_name_external: 'Toro O', straws_available: 4 });
    await semen.recordQualityCheck(batch.id, { motility_pct: 22 });
    const historial: any[] = await semen.qualityChecks(batch.id);
    expect(historial[0].verdict).toBe('dudosa');
  });

  it('saldo insuficiente → 403 y NO queda el evento (rollback lógico: consumo antes del insert)', async () => {
    const batch: any = await semen.create({ batch_code: 'AI-0', sire_name_external: 'Toro Y', straws_available: 0 });
    await expect(repro.service(hembraId, { method: 'ai', semen_batch_id: batch.id })).rejects.toMatchObject({ status: 403 });
    expect((await eventsOf(hembraId, batch.id)).length).toBe(0);
  });

  it('monta natural con semen_batch_id NO consume (se ignora)', async () => {
    const batch: any = await semen.create({ batch_code: 'NAT-1', sire_name_external: 'Toro Z', straws_available: 5 });
    await repro.service(hembraId, { method: 'natural', semen_batch_id: batch.id });
    expect((await semen.get(batch.id) as any).straws_available).toBe(5);
    expect((await eventsOf(hembraId, batch.id)).length).toBe(0);
  });

  it('AI sin partida funciona normal (sin consumo)', async () => {
    const ev: any = await repro.service(hembraId, { method: 'ai' });
    expect(ev.type).toBe('service_ai');
  });
});
