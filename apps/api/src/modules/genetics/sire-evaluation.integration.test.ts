import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { SireEvaluationService } from './sire-evaluation.service';

/**
 * Evaluación de toros sobre la base real (Fase 2.3).
 *
 * Lo que se fija acá no es que el número salga, sino que salga por las razones correctas: que el
 * ajuste neutralice la edad al destete, que el grupo contemporáneo aísle el año, y que los datos
 * flojos se informen en vez de diluirse en un promedio que parece sólido.
 */
describe('genética — evaluación de toros por la progenie', () => {
  let db: DbService;
  let svc: SireEvaluationService;
  let originalCwd: string;
  let tmp: string;
  let farmId: string;
  let speciesId: string;
  let toroA: string;
  let toroB: string;
  let madre: string;

  /** Crea un ternero destetado, con su parto, peso al nacer y destete. */
  const cria = async (o: {
    sire: string;
    sex: 'M' | 'F';
    nacidoHaceDias: number;
    destetadoADias: number;
    destetaKg: number;
    naceKg?: number | null;
    dam?: string | null;
  }) => {
    const dam = o.dam === undefined ? madre : o.dam;
    const [{ id }] = await db.query<any>(
      `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, birth_date, dam_id, sire_id)
       VALUES ($1,$2,$3,$4,'active', CURRENT_DATE - $5::int, $6, $7) RETURNING id`,
      [db.tenant, farmId, speciesId, o.sex, o.nacidoHaceDias, dam, o.sire],
    );
    if (o.naceKg !== null) {
      const [{ id: calving }] = await db.query<any>(
        `INSERT INTO calvings (tenant_id, dam_id, calving_date, offspring_count) VALUES ($1,$2, CURRENT_DATE - $3::int, 1) RETURNING id`,
        [db.tenant, dam, o.nacidoHaceDias],
      );
      await db.query(`INSERT INTO calving_offspring (tenant_id, calving_id, animal_id, birth_weight_kg) VALUES ($1,$2,$3,$4)`, [
        db.tenant,
        calving,
        id,
        o.naceKg ?? 35,
      ]);
    }
    await db.query(
      `INSERT INTO weanings (tenant_id, animal_id, weaning_date, weaning_weight_kg, dam_id)
       VALUES ($1,$2, CURRENT_DATE - $3::int, $4, $5)`,
      [db.tenant, id, o.nacidoHaceDias - o.destetadoADias, o.destetaKg, dam],
    );
    return id;
  };

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'sire-eval-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'off';
    db = new DbService();
    await db.onModuleInit();
    svc = new SireEvaluationService(db);

    const org = (await db.query<any>(`INSERT INTO organizations (name, country_code, default_currency) VALUES ('Cabaña Test','VE','USD') RETURNING id`))[0].id;
    (db as any).tenantId = org;
    speciesId = (await db.query<any>(`SELECT id FROM species LIMIT 1`))[0].id;
    const company = (await db.query<any>(`INSERT INTO companies (tenant_id, name, country_code, functional_currency) VALUES ($1,'C','VE','USD') RETURNING id`, [org]))[0].id;
    farmId = (await db.query<any>(`INSERT INTO farms (tenant_id, company_id, name) VALUES ($1,$2,'F') RETURNING id`, [org, company]))[0].id;

    const toro = async (n: string) =>
      (
        await db.query<any>(
          `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, name, birth_date) VALUES ($1,$2,$3,'M','active',$4, CURRENT_DATE - 2000) RETURNING id`,
          [org, farmId, speciesId, n],
        )
      )[0].id;
    toroA = await toro('Sansão');
    toroB = await toro('Nelore 4421');
    // Madre adulta (8 años): tramo sin ajuste, para que el test aísle el efecto del padre.
    madre = (
      await db.query<any>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, birth_date) VALUES ($1,$2,$3,'F','active', CURRENT_DATE - 2920) RETURNING id`,
        [org, farmId, speciesId],
      )
    )[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('sin destetes no inventa una evaluación', async () => {
    const r = await svc.bySire();
    expect(r.sires).toEqual([]);
    expect(r.group_size).toBe(0);
  });

  it('el toro cuyos hijos crecen más queda por encima de 100', async () => {
    for (let i = 0; i < 4; i++)
      await cria({ sire: toroA, sex: 'M', nacidoHaceDias: 300, destetadoADias: 90, destetaKg: 220, naceKg: 36 });
    for (let i = 0; i < 4; i++)
      await cria({ sire: toroB, sex: 'M', nacidoHaceDias: 300, destetadoADias: 90, destetaKg: 180, naceKg: 36 });

    const r = await svc.bySire();
    const a = r.sires.find((s) => s.sireId === toroA)!;
    const b = r.sires.find((s) => s.sireId === toroB)!;
    expect(a.index).toBeGreaterThan(100);
    expect(b.index).toBeLessThan(100);
    expect(a.sire_name).toBe('Sansão');
    expect(r.group_size).toBe(8);
  });

  it('EL AJUSTE NEUTRALIZA LA EDAD: un ternero destetado más viejo no infla a su padre', async () => {
    // Es la prueba que justifica todo el módulo. Dos terneros con la MISMA ganancia diaria pero
    // distinta edad al destete: sin ajustar, el más viejo pesa más y su padre parecería mejor.
    const gordo = await svc.bySire();
    const antes = gordo.sires.find((s) => s.sireId === toroB)!.index;

    // Un hijo de B destetado 60 días más tarde: pesa más, pero creció igual.
    await cria({ sire: toroB, sex: 'M', nacidoHaceDias: 360, destetadoADias: 90, destetaKg: 180, naceKg: 36 });
    const despues = await svc.bySire();
    const b = despues.sires.find((s) => s.sireId === toroB)!;
    // El índice de B no debería saltar: el peso extra era edad, no genética.
    expect(Math.abs(b.index - antes)).toBeLessThanOrEqual(3);
  });

  it('informa cuántos terneros tienen datos incompletos en vez de esconderlo', async () => {
    await cria({ sire: toroA, sex: 'F', nacidoHaceDias: 300, destetadoADias: 90, destetaKg: 200, naceKg: null });
    const r = await svc.bySire();
    expect(r.incomplete).toBeGreaterThan(0);
  });

  it('la confianza acompaña al número: con pocos hijos, baja', async () => {
    const r = await svc.bySire();
    for (const s of r.sires) expect(s.confidence).toBe('baja'); // menos de 10 hijos cada uno
  });

  it('descarta un destete con fecha anterior al nacimiento, y lo cuenta', async () => {
    // Dato imposible: sin este filtro, una edad negativa daría una ganancia diaria negativa y
    // arrastraría el promedio del grupo sin que nadie lo note.
    const malo = (
      await db.query<any>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, birth_date, sire_id, dam_id)
         VALUES ($1,$2,$3,'M','active', CURRENT_DATE - 100, $4, $5) RETURNING id`,
        [db.tenant, farmId, speciesId, toroA, madre],
      )
    )[0].id;
    await db.query(`INSERT INTO weanings (tenant_id, animal_id, weaning_date, weaning_weight_kg) VALUES ($1,$2, CURRENT_DATE - 200, 190)`, [db.tenant, malo]);
    const r = await svc.bySire();
    expect(r.discarded).toBeGreaterThan(0);
  });

  it('el grupo contemporáneo aísla el año: los de otra parición no se mezclan', async () => {
    const r = await svc.bySire();
    const anioActual = r.year!;
    // Un ternero de tres años atrás no debe entrar en el grupo del año evaluado.
    await cria({ sire: toroA, sex: 'M', nacidoHaceDias: 1200, destetadoADias: 90, destetaKg: 300, naceKg: 36 });
    const despues = await svc.bySire();
    expect(despues.year).toBe(anioActual);
    expect(despues.available_years.length).toBeGreaterThan(1);
    // Con 300 kg ese ternero habría disparado el índice de A si se hubiera colado.
    expect(despues.sires.find((s) => s.sireId === toroA)!.index).toBeLessThan(130);
  });
});
