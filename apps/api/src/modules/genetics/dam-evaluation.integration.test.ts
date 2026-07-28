import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { DamEvaluationService } from './dam-evaluation.service';

/**
 * Evaluación de vientres: con qué vacas quedarse.
 *
 * Lo que se prueba acá no es que sume kilos, es que el número ORDENE bien — que la vaca que desteta
 * más pesado pero se saltea años quede debajo de la que no falla. Es la decisión que el productor
 * toma mal cuando mira el kilaje al destete suelto.
 */
describe('genética — evaluación de vientres', () => {
  let db: DbService;
  let svc: DamEvaluationService;
  let originalCwd: string;
  let tmp: string;
  let farmId: string;
  let speciesId: string;

  /** Una vaca con su historia: primer parto, partos y destetes. */
  const vaca = async (nombre: string, partos: { anio: string; kg: number }[]) => {
    const [{ id: dam }] = await db.query<any>(
      `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, name, birth_date)
       VALUES ($1,$2,$3,'F','active',$4,'2016-05-01') RETURNING id`,
      [db.tenant, farmId, speciesId, nombre],
    );
    for (const p of partos) {
      const [{ id: cria }] = await db.query<any>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, birth_date, dam_id)
         VALUES ($1,$2,$3,'M','active',$4::date,$5) RETURNING id`,
        [db.tenant, farmId, speciesId, `${p.anio}-03-01`, dam],
      );
      await db.query(`INSERT INTO calvings (tenant_id, dam_id, calving_date, offspring_count) VALUES ($1,$2,$3::date,1)`, [
        db.tenant,
        dam,
        `${p.anio}-03-01`,
      ]);
      await db.query(
        `INSERT INTO weanings (tenant_id, animal_id, weaning_date, weaning_weight_kg, dam_id) VALUES ($1,$2,$3::date,$4,$5)`,
        [db.tenant, cria, `${p.anio}-10-01`, p.kg, dam],
      );
    }
    return dam;
  };

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'dams-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    svc = new DamEvaluationService(db);
    farmId = (await db.query<any>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [db.tenant]))[0].id;
    speciesId = (await db.query<any>(`SELECT id FROM species LIMIT 1`))[0].id;

    // La que no falla contra la que desteta más pesado pero se saltea años.
    await vaca('REGULAR-T', [
      { anio: '2021', kg: 200 },
      { anio: '2022', kg: 200 },
      { anio: '2023', kg: 200 },
      { anio: '2024', kg: 200 },
      { anio: '2025', kg: 200 },
      { anio: '2026', kg: 200 },
    ]);
    await vaca('PESADA-T', [
      { anio: '2021', kg: 230 },
      { anio: '2023', kg: 230 },
      { anio: '2025', kg: 230 },
    ]);
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('LA QUE DESTETA MÁS PESADO PERO SE SALTEA AÑOS QUEDA DEBAJO', async () => {
    // El motivo del número. Mirando el kilaje al destete, PESADA-T gana por 30 kg; repartido entre
    // los años que lleva en el rodeo, produce casi la mitad. Es la decisión de reposición.
    const r: any = await svc.byDam();
    const regular = r.dams.find((d: any) => d.dam_name === 'REGULAR-T');
    const pesada = r.dams.find((d: any) => d.dam_name === 'PESADA-T');

    expect(pesada.avgWeaningKg, 'PESADA desteta más pesado por cría').toBeGreaterThan(regular.avgWeaningKg);
    expect(regular.kgPerYear, 'y sin embargo produce menos por año').toBeGreaterThan(pesada.kgPerYear);
    // La tabla se ordena por kg/año: REGULAR tiene que aparecer antes.
    expect(r.dams.findIndex((d: any) => d.dam_name === 'REGULAR-T')).toBeLessThan(
      r.dams.findIndex((d: any) => d.dam_name === 'PESADA-T'),
    );
  }, 120_000);

  it('cuenta las crías y los años desde el primer parto', async () => {
    const r: any = await svc.byDam();
    const regular = r.dams.find((d: any) => d.dam_name === 'REGULAR-T');
    expect(regular.calves).toBe(6);
    expect(regular.totalWeanedKg).toBe(1200);
    expect(regular.years).toBeGreaterThan(4); // desde 2021
    expect(regular.lastWeaningDate).toBe('2026-10-01');
  }, 120_000);

  it('la confianza usa umbrales de VACA, no de toro', async () => {
    // Una vaca deja una cría por año: pedirle diez destetes sería pedirle diez años, y no quedaría
    // ninguna evaluable.
    const r: any = await svc.byDam();
    expect(r.dams.find((d: any) => d.dam_name === 'REGULAR-T').confidence).toBe('alta'); // 6 crías
    expect(r.dams.find((d: any) => d.dam_name === 'PESADA-T').confidence).toBe('media'); // 3 crías
  }, 120_000);

  it('no evalúa vacas sin parto: no hay de qué', async () => {
    const antes: any = await svc.byDam();
    await db.query(
      `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, name) VALUES ($1,$2,$3,'F','active','VAQUILLONA-T')`,
      [db.tenant, farmId, speciesId],
    );
    const despues: any = await svc.byDam();
    expect(despues.total).toBe(antes.total);
    expect(despues.dams.some((d: any) => d.dam_name === 'VAQUILLONA-T')).toBe(false);
  }, 120_000);
});
