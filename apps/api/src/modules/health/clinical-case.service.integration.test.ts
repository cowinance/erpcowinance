import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { DbService } from '../../db/db.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';
import { ClinicalCaseService } from './clinical-case.service';
import { TreatmentService } from './treatment.service';
import { MortalityService } from './mortality.service';

/**
 * Sanidad E2 — casos clínicos + diagnósticos estructurados. Verifica el ciclo de vida del
 * caso (crear → seguimiento → cambio de estado → tratamiento vinculado → cierre), el timeline
 * compuesto, la validación de la máquina de estados, la idempotencia de creación, y que el
 * diagnóstico estructurado llega a la mortalidad (cause_diagnosis_id).
 */
describe('ClinicalCaseService · integración', () => {
  let db: DbService;
  let cases: ClinicalCaseService;
  let treatments: TreatmentService;
  let mortality: MortalityService;
  let tenantId: string;
  let farmId: string;
  let speciesId: string;
  let userId: string;
  let diagnosisId: string;
  let productId: string;
  let originalCwd: string;
  let tmp: string;
  let seq = 0;
  const uniq = (p: string) => `CC-${p}-${Date.now()}-${seq++}`;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'clinical-case-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    cases = new ClinicalCaseService(db);
    treatments = new TreatmentService(db);
    mortality = new MortalityService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db));
    tenantId = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id = $1 LIMIT 1`, [tenantId]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species WHERE code = 'bovine'`))[0].id;
    userId = (await db.query<{ id: string }>(`SELECT id FROM users WHERE email = 'cowinance@gmail.com'`))[0].id;
    diagnosisId = (await db.query<{ id: string }>(
      `INSERT INTO diagnoses (tenant_id, code, name, category, is_notifiable) VALUES ($1,'neumonia','Neumonía','respiratoria',false) RETURNING id`,
      [tenantId],
    ))[0].id;
    productId = (await db.query<{ id: string }>(
      `INSERT INTO products_veterinary (tenant_id, name, type, withdrawal_meat_days, created_by) VALUES ($1,'Antibiótico X','antibiotic',20,$2) RETURNING id`,
      [tenantId, userId],
    ))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  async function animal(status = 'active', tag?: string): Promise<string> {
    const id = (
      await db.query<{ id: string }>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, origin) VALUES ($1,$2,$3,'F',$4,'born') RETURNING id`,
        [tenantId, farmId, speciesId, status],
      )
    )[0].id;
    if (tag) await db.query(`INSERT INTO animal_identifiers (tenant_id, animal_id, type, value) VALUES ($1,$2,'visual',$3)`, [tenantId, id, tag]);
    return id;
  }

  it('ciclo de vida: crear → seguimiento → tratamiento vinculado → timeline → cierre', async () => {
    const a = await animal('active', uniq('T'));
    const c: any = await cases.create({ animal_id: a, diagnosis_id: diagnosisId, severity: 'moderate', notes: 'decaída' });
    expect(c.status).toBe('open');
    expect(c.diagnosis).toBeTruthy();

    // seguimiento (nota) + cambio de estado válido
    await cases.addFollowUp(c.id, { note: 'sin mejora' });
    const inTreat: any = await cases.addFollowUp(c.id, { status: 'in_treatment', note: 'inicio antibiótico' });
    expect(inTreat.status).toBe('in_treatment');

    // tratamiento vinculado al caso
    await db.tx((q) => treatments.recordTreatment(q, { animalId: a, productId, actorUserId: userId, origin: 'rest', treatmentId: randomUUID(), clinicalCaseId: c.id }));

    const detail: any = await cases.get(c.id);
    expect(detail.treatments).toHaveLength(1);
    // timeline compuesto: opened + note + status_change
    expect(detail.timeline.map((e: any) => e.kind)).toEqual(['opened', 'note', 'status_change']);

    // cierre con resultado
    const closed: any = await cases.close(c.id, { outcome: 'recovered', note: 'alta' });
    expect(closed.status).toBe('closed');
    expect(closed.outcome).toBe('recovered');
    expect(closed.closed_at).toBeTruthy();
  });

  it('UN CASO CERRADO NO ADMITE SEGUIMIENTOS, ni con nota ni con cambio de estado', async () => {
    // La máquina de estados ya decía que `closed` es terminal, pero solo la consultaba la rama del
    // cambio de estado: un seguimiento con únicamente una NOTA no miraba nada y se podía seguir
    // anotando sobre un caso cerrado para siempre.
    //
    // No quedaba en un rincón: cada nota escribe en la línea de tiempo del ANIMAL como «seguimiento
    // de caso clínico», así que la ficha mostraba movimiento de un caso que el productor había dado
    // por terminado, y el historial del caso listaba hechos posteriores a su cierre.
    const a = await animal();
    const c: any = await cases.create({ animal_id: a });
    await cases.close(c.id, { outcome: 'other' });

    await expect(cases.addFollowUp(c.id, { status: 'in_treatment' })).rejects.toMatchObject({
      status: 409,
      response: { code: 'clinical_case.closed' },
    });
    // Ésta es la que entraba.
    await expect(cases.addFollowUp(c.id, { note: 'una nota más' })).rejects.toMatchObject({
      status: 409,
      response: { code: 'clinical_case.closed' },
    });

    // Y no dejó rastro: ni evento del caso ni hecho en la ficha del animal.
    const evs = await db.query<any>(`SELECT id FROM clinical_case_events WHERE case_id = $1 AND kind = 'note'`, [c.id]);
    expect(evs, 'ninguna nota se coló').toHaveLength(0);
    const tl = await db.query<any>(
      `SELECT id FROM animal_events WHERE animal_id = $1 AND event_type = 'clinical_case_followup'`,
      [a],
    );
    expect(tl, 'la ficha del animal quedó limpia').toHaveLength(0);
  });

  it('un caso que NO terminó sigue aceptando seguimientos', async () => {
    // La otra mitad: la guarda no puede haberse comido el uso normal. Y `died` a propósito NO es
    // terminal —todavía puede cerrarse—, porque el resultado de una necropsia llega después de la
    // muerte y tiene que poder anotarse.
    const a = await animal();
    const c: any = await cases.create({ animal_id: a });
    await cases.addFollowUp(c.id, { note: 'sigue decaída' });
    await cases.addFollowUp(c.id, { status: 'in_treatment' });
    const muerto: any = await cases.create({ animal_id: await animal() });
    await cases.addFollowUp(muerto.id, { status: 'died' });
    const r: any = await cases.addFollowUp(muerto.id, { note: 'necropsia: neumonía' });
    expect(r.status).toBe('died');
  });

  it('creación idempotente por Idempotency-Key', async () => {
    const a = await animal();
    const key = randomUUID();
    const first: any = await cases.create({ animal_id: a, severity: 'mild' }, key);
    const second: any = await cases.create({ animal_id: a, severity: 'mild' }, key);
    expect(second.id).toBe(first.id);
    expect(second.already_created).toBe(true);
    const rows = await db.query(`SELECT id FROM clinical_cases WHERE animal_id = $1`, [a]);
    expect(rows).toHaveLength(1);
  });

  it('diagnóstico estructurado en mortalidad (cause_diagnosis_id)', async () => {
    const a = await animal();
    const mid = randomUUID();
    await db.tx((q) =>
      mortality.recordMortality(q, { animalId: a, causeDiagnosisId: diagnosisId, actorUserId: userId, origin: 'rest', mortalityId: mid, emitServerOrigin: true }),
    );
    const m = (await db.query<any>(`SELECT cause_diagnosis_id FROM mortalities WHERE id = $1`, [mid]))[0];
    expect(m.cause_diagnosis_id).toBe(diagnosisId);
  });

  it('severidad inválida → 400', async () => {
    const a = await animal();
    await expect(cases.create({ animal_id: a, severity: 'critical' })).rejects.toMatchObject({ response: { code: 'clinical_case.invalid_severity' } });
  });
});
