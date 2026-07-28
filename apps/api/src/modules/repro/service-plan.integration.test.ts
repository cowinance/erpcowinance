import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { CryoStorageService } from '../genetics/cryo-storage.service';
import { SemenService } from '../genetics/semen.service';
import { EmbryosService } from '../genetics/embryos.service';
import { StrawsService } from '../genetics/straws.service';
import { ServicePlanService } from './service-plan.service';
import { ReproService } from './repro.service';
import { WeaningService } from './weaning.service';
import { TaskService } from '../tasks/task.service';
import { InbreedingService } from '../genetics/inbreeding.service';

/**
 * Plan de servicio por animal (GT-3).
 *
 * Lo que se comprueba no es el CRUD del plan sino las tres reglas que hacen que la jornada sea
 * ejecutable: que reservar SAQUE la pajuela del stock libre, que descartar un vientre la devuelva
 * sola, y que la lista de retiro se pueda recorrer sin abrir el termo de más.
 */
describe('plan de servicio — reserva, liberación y lista de retiro', () => {
  let db: DbService;
  let cryo: CryoStorageService;
  let semen: SemenService;
  let embryos: EmbryosService;
  let straws: StrawsService;
  let plans: ServicePlanService;
  let tmp: string;
  let originalCwd: string;

  let repro: ReproService;
  let assignmentId: string;
  let animales: string[] = [];
  let lote: any;
  let gobA: string;
  let gobB: string;

  /**
   * Campaña mínima: una asignación de protocolo con N vientres.
   *
   * Se excluyen las que ya tienen una preñez abierta —el seed demo trae varias— porque
   * diagnosticarlas preñadas de nuevo es justamente lo que el servicio rechaza. `offset` permite
   * que dos campañas del mismo archivo no compitan por los mismos vientres.
   */
  const armarCampaña = async (n: number, offset = 0) => {
    const protocolo = await db.one<any>(
      `INSERT INTO repro_protocols (tenant_id, name, species_id, steps)
       VALUES ($1,'IATF test',(SELECT id FROM species LIMIT 1),'[]'::jsonb) RETURNING id`,
      [db.tenant],
    );
    const a = await db.one<any>(
      `INSERT INTO repro_protocol_assignments (tenant_id, protocol_id, start_date, animal_count, created_by)
       VALUES ($1,$2,CURRENT_DATE,$3,$4) RETURNING id`,
      [db.tenant, protocolo!.id, n, db.user],
    );
    const vientres = await db.query<{ id: string }>(
      `SELECT a.id FROM animals a
       WHERE a.tenant_id=$1 AND a.sex='F' AND a.deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM pregnancies p WHERE p.animal_id=a.id AND p.status='open' AND p.deleted_at IS NULL)
       ORDER BY a.created_at, a.id
       LIMIT $2 OFFSET $3`,
      [db.tenant, n, offset],
    );
    for (const v of vientres)
      await db.query(
        `INSERT INTO repro_protocol_assignment_animals (tenant_id, assignment_id, animal_id) VALUES ($1,$2,$3)`,
        [db.tenant, a!.id, v.id],
      );
    return { assignmentId: a!.id, animales: vientres.map((v) => v.id) };
  };

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'plan-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    await db.defaultFarm();
    cryo = new CryoStorageService(db);
    straws = new StrawsService(db);
    semen = new SemenService(db, straws);
    embryos = new EmbryosService(db, straws);
    plans = new ServicePlanService(db, straws);
    // El diagnóstico agenda tareas (recontrol / nuevo servicio); acá se stubean porque lo que se
    // prueba es el cierre de la campaña, no la agenda —que ya tiene sus propios tests—.
    const tareas = { createTask: async () => ({ id: 'stub' }) } as unknown as TaskService;
    repro = new ReproService(db, {} as WeaningService, tareas, semen, embryos, straws, plans, new InbreedingService(db));

    const t: any = await cryo.createTank({ code: '207' });
    const c1: any = await cryo.createCanister(t.id, { code: '1', color: 'azul' });
    const c2: any = await cryo.createCanister(t.id, { code: '2', color: 'rojo' });
    gobA = ((await cryo.createGoblet(c1.id, { code: '1' })) as any).id;
    gobB = ((await cryo.createGoblet(c2.id, { code: '5' })) as any).id;

    lote = await semen.create({ batch_code: 'SANSAO', straws_available: 4 });
    const campaña = await armarCampaña(3);
    assignmentId = campaña.assignmentId;
    animales = campaña.animales;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  /**
   * La regla que sostiene todo GT-3: si reservado contara como libre, se podrían planificar 30
   * servicios sobre 20 pajuelas y el problema aparecería en el corral, con los animales ya
   * sincronizados y sin vuelta atrás.
   */
  it('reservar saca la pajuela del stock LIBRE sin sacarla del termo', async () => {
    const unidades = await straws.listFor({ semen_batch_id: lote.id });
    await plans.plan(assignmentId, { animal_id: animales[0], method: 'ai', semen_batch_id: lote.id, straw_id: unidades[0].id });

    const releido: any = await semen.get(lote.id);
    expect(releido.straws_available).toBe(3); // libre
    expect(releido.straws_reserved).toBe(1); // comprometida, pero sigue adentro
  });

  it('la misma pajuela no se puede reservar para dos vientres', async () => {
    const unidades = await straws.listFor({ semen_batch_id: lote.id });
    const libre = unidades.find((u: any) => u.status === 'stored');
    await plans.plan(assignmentId, { animal_id: animales[1], method: 'ai', semen_batch_id: lote.id, straw_id: libre.id });
    await expect(
      plans.plan(assignmentId, { animal_id: animales[2], method: 'ai', semen_batch_id: lote.id, straw_id: libre.id }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('replanificar un vientre suelta la pajuela anterior', async () => {
    const antes = await plans.planFor(assignmentId, animales[1]);
    const otra = (await straws.listFor({ semen_batch_id: lote.id })).find((u: any) => u.status === 'stored');
    await plans.plan(assignmentId, { animal_id: animales[1], method: 'ai', semen_batch_id: lote.id, straw_id: otra.id });

    const vieja = (await straws.listFor({ semen_batch_id: lote.id })).find((u: any) => u.id === antes.straw_id);
    expect(vieja.status).toBe('stored'); // volvió a estar libre
  });

  /**
   * Sin liberación automática, cada campaña dejaría reservas de vientres que nunca se sirvieron, y
   * en tres campañas el «libre» del termo no significaría nada.
   */
  it('marcar «no apta» suelta la pajuela en el mismo movimiento', async () => {
    const plan = await plans.planFor(assignmentId, animales[0]);
    const r: any = await plans.setEligibility(assignmentId, animales[0], 'not_eligible', 'sin cuerpo lúteo');
    expect(r.reservation_released).toBe(true);

    const unidad = (await straws.listFor({ semen_batch_id: lote.id })).find((u: any) => u.id === plan.straw_id);
    expect(unidad.status).toBe('stored');
    expect(await plans.planFor(assignmentId, animales[0])).toBeUndefined(); // ya no está planificado
  });

  it('un vientre descartado no se puede volver a planificar', async () => {
    await expect(
      plans.plan(assignmentId, { animal_id: animales[0], method: 'ai', semen_batch_id: lote.id }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('marcar apta no suelta nada', async () => {
    const plan = await plans.planFor(assignmentId, animales[1]);
    const r: any = await plans.setEligibility(assignmentId, animales[1], 'eligible');
    expect(r.reservation_released).toBe(false);
    const unidad = (await straws.listFor({ semen_batch_id: lote.id })).find((u: any) => u.id === plan.straw_id);
    expect(unidad.status).toBe('reserved');
  });

  it('el método y el origen tienen que concordar', async () => {
    const colecta: any = await embryos.create({ stage: 'blastocisto', straws_available: 1 });
    await expect(
      plans.plan(assignmentId, { animal_id: animales[2], method: 'ai', embryo_id: colecta.id }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      plans.plan(assignmentId, { animal_id: animales[2], method: 'embryo_transfer', semen_batch_id: lote.id }),
    ).rejects.toMatchObject({ status: 400 });
    // Bien armado, sí — y se puede mezclar semen y embriones en la misma campaña.
    await expect(
      plans.plan(assignmentId, { animal_id: animales[2], method: 'embryo_transfer', embryo_id: colecta.id }),
    ).resolves.toMatchObject({ method: 'embryo_transfer' });
  });

  it('la campaña resume lo que falta hacer', async () => {
    const c: any = await plans.campaign(assignmentId);
    expect(c.summary.total).toBe(3);
    expect(c.summary.not_eligible).toBe(1);
    expect(c.summary.planned).toBe(2);
    // La entrada de embrión se planificó sin pajuela: es lo único accionable antes de la jornada.
    expect(c.summary.without_straw).toBe(1);
    // Una reservada TODAVÍA sin ubicar sale con la etiqueta vacía, y eso es lo correcto: no se
    // puede ir a buscar algo cuya posición nadie cargó. La ubicación aparece en el test siguiente,
    // después de ubicarla.
    const fila = c.animals.find((a: any) => a.animal_id === animales[1]);
    expect(fila.location_label).toBe('');
    expect(fila.origin_label).toBeTruthy();
  });

  /**
   * Se agrupa por posición porque cada apertura del termo evapora nitrógeno: conviene abrir una vez
   * por gobelete y llevarse todo junto, no ir y volver por cada vaca.
   */
  it('la lista de retiro agrupa por posición y excluye a los descartados', async () => {
    // Se ubican las pajuelas en dos gobeletes distintos para que el agrupado tenga qué agrupar.
    const unidades = await straws.listFor({ semen_batch_id: lote.id });
    const reservada = unidades.find((u: any) => u.status === 'reserved');
    await db.query(`UPDATE cryo_straws SET goblet_id=$1 WHERE id=$2 AND tenant_id=$3`, [gobA, reservada.id, db.tenant]);

    const { lines }: any = await plans.pickingList(assignmentId);
    // Solo la reservada del vientre apto: el descartado no obliga a abrir el termo, y la entrada de
    // embrión todavía no tiene unidad elegida.
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ tank_code: '207', canister_code: '1', goblet_code: '1' });
    expect(lines[0].straws).toHaveLength(1);
    expect(lines[0].straws[0].straw_id).toBe(reservada.id);
  });

  it('sacar del plan devuelve la pajuela al stock libre', async () => {
    const antes: any = await semen.get(lote.id);
    const plan = await plans.planFor(assignmentId, animales[1]);
    await plans.unplan(assignmentId, animales[1]);

    const despues: any = await semen.get(lote.id);
    expect(despues.straws_available).toBe(antes.straws_available + 1);
    const unidad = (await straws.listFor({ semen_batch_id: lote.id })).find((u: any) => u.id === plan.straw_id);
    expect(unidad.status).toBe('stored');
  });

  /**
   * GT-3b: la IATF no termina al inseminar sino a los ~28 días. Lo que se comprueba acá es que el
   * resultado sea DERIVADO —no hay columna que lo guarde— y que la tasa se calcule sobre lo
   * diagnosticado y no sobre lo servido.
   */
  it('el cierre de la campaña sale de los diagnósticos, sin guardar nada', async () => {
    const { assignmentId: camp, animales: vientres } = await armarCampaña(2, 3);
    const unidades = (await straws.listFor({ semen_batch_id: lote.id })).filter((u: any) => u.status === 'stored');
    for (const [i, v] of vientres.entries()) {
      await plans.setEligibility(camp, v, 'eligible');
      await plans.plan(camp, { animal_id: v, method: 'ai', semen_batch_id: lote.id, straw_id: unidades[i].id });
    }

    // La jornada: se sirve a las dos.
    for (const v of vientres) {
      const evento: any = await repro.service(v, { method: 'ai', semen_batch_id: lote.id, force: true });
      await plans.markServed(camp, v, evento.id, evento.straw_ids?.[0] ?? null);
    }

    // Antes de ecografiar: la tasa es NULA, no cero. Cero diría «ninguna quedó preñada», que es una
    // afirmación distinta de «todavía no sé».
    let r: any = await plans.outcome(camp);
    expect(r.outcome).toMatchObject({ served: 2, pending_diagnosis: 2, conception_rate: null, closed: false });

    // Una preñada, una vacía.
    await repro.diagnose({ animal_id: vientres[0], result: 'pregnant' });
    r = await plans.outcome(camp);
    // 1 de 1 diagnosticada = 100 %, no 1 de 2 servidas = 50 %.
    expect(r.outcome).toMatchObject({ pregnant: 1, pending_diagnosis: 1, conception_rate: 100, closed: false });

    await repro.diagnose({ animal_id: vientres[1], result: 'empty' });
    r = await plans.outcome(camp);
    expect(r.outcome).toMatchObject({ pregnant: 1, empty: 1, pending_diagnosis: 0, conception_rate: 50, closed: true });
  });

  /** El lazo de vuelta a genética: qué toro funcionó es lo que decide qué semen se vuelve a comprar. */
  it('la tasa por toro suma los servicios de todas las campañas', async () => {
    const porToro: any[] = await plans.conceptionBySire();
    const sansao = porToro.find((t) => t.sire_label === 'SANSAO' || t.sire_label?.includes('SANSAO'));
    expect(sansao).toBeTruthy();
    expect(sansao.pregnant).toBeGreaterThanOrEqual(1);
    // Con tan pocos servicios la tasa existe pero NO es comparable, y el dato lo dice.
    expect(sansao.reliable).toBe(false);
  });

  it('no se puede planificar un animal que no está en la campaña', async () => {
    const ajeno = await db.one<{ id: string }>(
      `SELECT id FROM animals WHERE tenant_id=$1 AND id <> ALL($2::uuid[]) AND deleted_at IS NULL LIMIT 1`,
      [db.tenant, animales],
    );
    await expect(
      plans.plan(assignmentId, { animal_id: ajeno!.id, method: 'ai', semen_batch_id: lote.id }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
