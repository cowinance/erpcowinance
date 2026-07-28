import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { ReproService } from './repro.service';
import { ServicePlanService } from './service-plan.service';
import { SemenService } from '../genetics/semen.service';
import { StrawsService } from '../genetics/straws.service';
import { EmbryosService } from '../genetics/embryos.service';
import type { WeaningService } from './weaning.service';
import type { TaskService } from '../tasks/task.service';
import { InbreedingService } from '../genetics/inbreeding.service';

/**
 * Reproducción E6 — integración Lotes/Sanidad/Genética. Guardas del servicio: retiro sanitario activo
 * y caso clínico grave abierto (Sanidad) y consanguinidad (Genética) BLOQUEAN el servicio salvo
 * `force=true` (que devuelve las advertencias salteadas). Estado reproductivo agregado por lote.
 */
describe('repro — integración lotes/sanidad/genética (E6)', () => {
  let db: DbService;
  let repro: ReproService;
  let t: string;
  let farmId: string;
  let speciesId: string;
  let vaca: string;
  let toro: string;
  let lot: string;
  let originalCwd: string;
  let tmp: string;
  let seq = 0;
  const uniq = (p: string) => `${p}-${Date.now()}-${seq++}`;

  const mkAnimal = async (cat: string, sex: string, l: string | null, sireId: string | null = null): Promise<string> =>
    (await db.query<{ id: string }>(
      `INSERT INTO animals (tenant_id, farm_id, species_id, category_id, current_lot_id, sex, status, origin, sire_id) VALUES ($1,$2,$3,$4,$5,$6,'active','born',$7) RETURNING id`,
      [t, farmId, speciesId, cat, l, sex, sireId],
    ))[0].id;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'repro-e6-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    repro = new ReproService(db, {} as WeaningService, {} as TaskService, new SemenService(db, new StrawsService(db)), new EmbryosService(db, new StrawsService(db)), new StrawsService(db), new ServicePlanService(db, new StrawsService(db)), new InbreedingService(db));
    t = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id = $1 LIMIT 1`, [t]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species WHERE code = 'bovine'`))[0].id;
    vaca = (await db.query<{ id: string }>(`SELECT id FROM animal_categories WHERE code = 'vaca'`))[0].id;
    toro = (await db.query<{ id: string }>(`SELECT id FROM animal_categories WHERE code = 'toro'`))[0].id;
    lot = (await db.query<{ id: string }>(`INSERT INTO lots (tenant_id, farm_id, name) VALUES ($1,$2,$3) RETURNING id`, [t, farmId, uniq('LOT')]))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('retiro sanitario activo bloquea el servicio (Sanidad); force lo permite con advertencia', async () => {
    const a = await mkAnimal(vaca, 'F', lot);
    await db.query(`INSERT INTO treatments (tenant_id, animal_id, applied_at, meat_withdrawal_until, created_by) VALUES ($1,$2,now(),CURRENT_DATE + 10,NULL)`, [t, a]);
    await expect(repro.service(a, { method: 'ai' })).rejects.toMatchObject({ response: { code: 'service.blocked', reasons: ['withdrawal_active'] } });
    const forced: any = await repro.service(a, { method: 'ai', force: true });
    expect(forced.warnings).toContain('withdrawal_active');
  });

  it('caso clínico grave abierto bloquea el servicio (Sanidad)', async () => {
    const a = await mkAnimal(vaca, 'F', lot);
    await db.query(`INSERT INTO clinical_cases (tenant_id, animal_id, status, severity, started_at, created_by) VALUES ($1,$2,'in_treatment','severe',now(),NULL)`, [t, a]);
    await expect(repro.service(a, { method: 'ai' })).rejects.toMatchObject({ response: { code: 'service.blocked', reasons: ['open_severe_case'] } });
  });

  it('consanguinidad: servir a una vaca con su propio padre bloquea (Genética)', async () => {
    const bull = await mkAnimal(toro, 'M', lot);
    const daughter = await mkAnimal(vaca, 'F', lot, bull); // sire_id = bull
    await expect(repro.service(daughter, { method: 'natural', sire_id: bull })).rejects.toMatchObject({ response: { code: 'service.blocked', reasons: ['consanguinity'] } });
    const forced: any = await repro.service(daughter, { method: 'natural', sire_id: bull, force: true });
    expect(forced.warnings).toContain('consanguinity');
  });

  it('CONSANGUINIDAD: EL ABUELO CON SU NIETA BLOQUEA — el caso que el chequeo viejo no veía', async () => {
    // El motivo del cambio. El chequeo anterior miraba UNA generación (mismo padre, misma madre,
    // padre/hija), así que un toro que se queda tres años en el rodeo pasaba limpio cuando entraban
    // a servicio las hijas de sus hijas. Es cuando la consanguinidad empieza a cobrarse.
    const abuelo = await mkAnimal(toro, 'M', lot);
    const hijo = await mkAnimal(toro, 'M', lot, abuelo);
    const nieta = await mkAnimal(vaca, 'F', lot, hijo); // sire_id = hijo → abuelo es su abuelo

    await expect(repro.service(nieta, { method: 'natural', sire_id: abuelo })).rejects.toMatchObject({
      response: { code: 'service.blocked', reasons: ['consanguinity'] },
    });
  });

  it('el bloqueo dice CUÁNTO parentesco hay, no solo que lo hay', async () => {
    // Un aviso binario obliga a adivinar: padre/hija (25%) y primos lejanos (3%) decían lo mismo, y
    // uno hay que impedirlo mientras el otro es normal en cualquier rodeo cerrado.
    const bull = await mkAnimal(toro, 'M', lot);
    const daughter = await mkAnimal(vaca, 'F', lot, bull);
    await expect(repro.service(daughter, { method: 'natural', sire_id: bull })).rejects.toMatchObject({
      response: { details: { consanguinity: { f: 0.25, level: 'high' } } },
    });
  });

  it('un toro sin parentesco NO se bloquea', async () => {
    // La otra mitad: si bloqueara de más, el productor aprendería a apretar «forzar» siempre y el
    // aviso dejaría de servir para algo.
    const ajeno = await mkAnimal(toro, 'M', lot);
    const vaquilla = await mkAnimal(vaca, 'F', lot);
    const ok: any = await repro.service(vaquilla, { method: 'natural', sire_id: ajeno });
    expect(ok.warnings ?? []).not.toContain('consanguinity');
  });

  it('EL PADRE DE UN SERVICIO TIENE QUE SER MACHO, y `force` no lo saltea', async () => {
    // No es una guarda de riesgo sino de referencia equivocada: forzar existe para asumir un riesgo,
    // no para guardar un imposible. Con un `sire_id` femenino el ternero hereda esa paternidad al
    // parir, y después la evaluación de toros rankea a una vaca.
    const otraVaca = await mkAnimal(vaca, 'F', lot);
    const vaquilla = await mkAnimal(vaca, 'F', lot);
    await expect(repro.service(vaquilla, { method: 'natural', sire_id: otraVaca })).rejects.toMatchObject({
      response: { code: 'service.sire_not_male' },
    });
    await expect(repro.service(vaquilla, { method: 'natural', sire_id: otraVaca, force: true })).rejects.toMatchObject({
      response: { code: 'service.sire_not_male' },
    });
  });

  it('estado reproductivo agregado por lote', async () => {
    const l2 = (await db.query<{ id: string }>(`INSERT INTO lots (tenant_id, farm_id, name) VALUES ($1,$2,$3) RETURNING id`, [t, farmId, uniq('L2')]))[0].id;
    const v1 = await mkAnimal(vaca, 'F', l2);
    await db.query(`INSERT INTO pregnancies (tenant_id, animal_id, diagnosis_date, status, expected_due_date) VALUES ($1,$2,CURRENT_DATE - 30,'open',CURRENT_DATE + 200)`, [t, v1]);
    await mkAnimal(vaca, 'F', l2); // abierta/lista
    const res: any = await repro.reproByLot();
    const row = res.rows.find((r: any) => r.lot_id === l2);
    expect(row).toBeTruthy();
    expect(row.total).toBe(2);
    expect(row.pregnant).toBe(1);
    expect(row.pregnancy_rate_pct).toBe(50);
  });
});
