import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { GrazingService } from './grazing.service';
import { WeatherService } from '../weather/weather.service';

/**
 * Integración de pastoreo (PG-1): entrada/salida con las reglas de rotación (un potrero ocupado y un
 * lote que ya pastorea rechazan la entrada) y los derivados (días, forraje). `db.tenant` cae al demo.
 */
describe('grazing — pastoreo', () => {
  let db: DbService;
  let svc: GrazingService;
  let originalCwd: string;
  let tmp: string;
  let tenantId: string;
  let farmId: string;
  let padA: string;
  let padB: string;
  let lot1: string;
  let lot2: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'grazing-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    svc = new GrazingService(db, new WeatherService(db));
    tenantId = db.tenant;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [tenantId]))[0].id;
    const mkPaddock = async (name: string) => (await db.query<{ id: string }>(`INSERT INTO paddocks (tenant_id, farm_id, name) VALUES ($1,$2,$3) RETURNING id`, [tenantId, farmId, name]))[0].id;
    const mkLot = async (name: string) => (await db.query<{ id: string }>(`INSERT INTO lots (tenant_id, farm_id, name) VALUES ($1,$2,$3) RETURNING id`, [tenantId, farmId, name]))[0].id;
    padA = await mkPaddock('Potrero A');
    padB = await mkPaddock('Potrero B');
    lot1 = await mkLot('Lote 1');
    lot2 = await mkLot('Lote 2');
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('entrada: nace abierto con forraje pre; días null mientras abierto', async () => {
    const g: any = await svc.enter({ paddock_id: padA, lot_id: lot1, entry_date: '2030-05-01', pre_grazing_kg_dm_ha: 3000 });
    expect(g.is_open).toBe(true);
    expect(g.grazing_days).toBeNull();
    expect(g.pre_grazing_kg_dm_ha).toBe(3000);
  });

  it('rotación: potrero ocupado → 409; lote que ya pastorea → 409', async () => {
    await expect(svc.enter({ paddock_id: padA, lot_id: lot2 })).rejects.toMatchObject({ status: 409 }); // A ocupado por lote 1
    await expect(svc.enter({ paddock_id: padB, lot_id: lot1 })).rejects.toMatchObject({ status: 409 }); // lote 1 ya pastorea
  });

  it('salida: cierra, calcula días y forraje consumido (derivados)', async () => {
    const [open]: any = await svc.list(padA, lot1);
    const closed: any = await svc.exit(open.id, { exit_date: '2030-05-08', post_grazing_kg_dm_ha: 1200 });
    expect(closed.is_open).toBe(false);
    expect(closed.grazing_days).toBe(7);
    expect(closed.forage_consumed_kg_dm_ha).toBe(1800); // 3000 − 1200
    // Cerrado el pastoreo, el potrero se libera: el lote 2 ya puede entrar.
    const g2: any = await svc.enter({ paddock_id: padA, lot_id: lot2, entry_date: '2030-05-09' });
    expect(g2.is_open).toBe(true);
  });

  it('salida inválida: exit < entry → 400; cerrar dos veces → 409', async () => {
    const g: any = await svc.enter({ paddock_id: padB, lot_id: lot1, entry_date: '2030-06-01' });
    await expect(svc.exit(g.id, { exit_date: '2030-05-01' })).rejects.toMatchObject({ status: 400 });
    await svc.exit(g.id, { exit_date: '2030-06-05' });
    await expect(svc.exit(g.id, { exit_date: '2030-06-06' })).rejects.toMatchObject({ status: 409 });
  });

  it('potrero/lote inexistente → 404', async () => {
    await expect(svc.enter({ paddock_id: '00000000-0000-0000-0000-000000000000', lot_id: lot1 })).rejects.toMatchObject({ status: 404 });
    await expect(svc.enter({ paddock_id: padB, lot_id: '00000000-0000-0000-0000-000000000000' })).rejects.toMatchObject({ status: 404 });
  });

  /**
   * Rendimiento del potrero (Fase 3.2). Lo que se fija acá es la ATRIBUCIÓN: que los kilos que se
   * le cuentan a un potrero se hayan ganado adentro de ese potrero. Un número que suma engordes de
   * otro lado se ve perfectamente razonable y lleva a rotar mal durante años.
   */
  describe('rendimiento por potrero', () => {
    let padP: string;
    let padQ: string;
    let lotP: string;
    const animales: string[] = [];

    /** Pesa a un animal en una fecha. */
    const pesar = async (animal: string, fecha: string, kg: number) => {
      await db.query(`INSERT INTO weighings (tenant_id, animal_id, weighed_at, weight_kg, method) VALUES ($1,$2,$3,$4,'scale')`, [tenantId, animal, `${fecha}T12:00:00Z`, kg]);
    };

    beforeAll(async () => {
      const speciesId = (await db.query<any>(`SELECT id FROM species WHERE code='bovine'`))[0].id;
      padP = (await db.query<any>(`INSERT INTO paddocks (tenant_id, farm_id, name, area_ha) VALUES ($1,$2,'Potrero P',10) RETURNING id`, [tenantId, farmId]))[0].id;
      padQ = (await db.query<any>(`INSERT INTO paddocks (tenant_id, farm_id, name, area_ha) VALUES ($1,$2,'Potrero Q',10) RETURNING id`, [tenantId, farmId]))[0].id;
      lotP = (await db.query<any>(`INSERT INTO lots (tenant_id, farm_id, name) VALUES ($1,$2,'Lote P') RETURNING id`, [tenantId, farmId]))[0].id;
      for (let i = 0; i < 3; i++) {
        const [{ id }] = await db.query<any>(
          `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, current_lot_id) VALUES ($1,$2,$3,'M','active',$4) RETURNING id`,
          [tenantId, farmId, speciesId, lotP],
        );
        animales.push(id);
      }
    });

    it('atribuye al potrero los kilos ganados DENTRO de su ventana', async () => {
      const g: any = await svc.enter({ paddock_id: padP, lot_id: lotP, entry_date: '2031-03-01' });
      for (const a of animales) {
        await pesar(a, '2031-03-01', 300);
        await pesar(a, '2031-03-31', 330); // +30 kg cada uno, adentro
      }
      await svc.exit(g.id, { exit_date: '2031-03-31' });

      const r: any = await svc.performance({ from: '2031-01-01', to: '2031-12-31' });
      const p = r.paddocks.find((x: any) => x.paddock_id === padP);
      expect(p.animalsMeasured).toBe(3);
      expect(p.gainKg).toBe(90); // 3 × 30
      expect(p.gainKgPerHa).toBe(9); // 90 / 10 ha
    });

    it('NO LE CUENTA A UN POTRERO LOS KILOS QUE EL ANIMAL GANÓ EN OTRO', async () => {
      // El bug que esta prueba impide: usar la GDP contra el pesaje anterior del animal, que pudo
      // ser en otro potrero. Acá el lote pasa a Q y solo se pesa UNA vez adentro; los 40 kg que
      // separan ese pesaje del último de P no son de Q.
      const g: any = await svc.enter({ paddock_id: padQ, lot_id: lotP, entry_date: '2031-05-01' });
      for (const a of animales) await pesar(a, '2031-05-20', 370); // un solo pesaje en la ventana
      await svc.exit(g.id, { exit_date: '2031-05-31' });

      const r: any = await svc.performance({ from: '2031-01-01', to: '2031-12-31' });
      const q = r.paddocks.find((x: any) => x.paddock_id === padQ);
      expect(q.animalsMeasured).toBe(0);
      expect(q.gainKg).toBeNull();
      expect(q.caveatKind).toBe('sin_datos');
    });

    it('un pastoreo abierto todavía no entra en la cuenta', async () => {
      // Sin fecha de salida no hay ventana cerrada: contarlo sería medir a mitad de camino.
      const abierto: any = await svc.enter({ paddock_id: padQ, lot_id: lotP, entry_date: '2031-08-01' });
      const r: any = await svc.performance({ from: '2031-01-01', to: '2031-12-31' });
      const q = r.paddocks.find((x: any) => x.paddock_id === padQ);
      expect(q.grazings.every((v: any) => v.exit_date != null)).toBe(true);
      await svc.exit(abierto.id, { exit_date: '2031-08-10' });
    });

    it('sin clima medido no se supone que llovió lo normal', async () => {
      // El demo no tiene estación en 2031: el balance tiene que venir null, no cero.
      const r: any = await svc.performance({ from: '2031-01-01', to: '2031-12-31' });
      const p = r.paddocks.find((x: any) => x.paddock_id === padP);
      expect(p.water).toBeNull();
      expect(p.days_without_weather).toBeGreaterThan(0);
    });

    it('ordena por kg/ha/día y manda al final a los que no se pudieron medir', async () => {
      const r: any = await svc.performance({ from: '2031-01-01', to: '2031-12-31' });
      const medidos = r.paddocks.filter((p: any) => p.gainKgPerHaPerDay != null);
      const sinMedir = r.paddocks.filter((p: any) => p.gainKgPerHaPerDay == null);
      for (let i = 1; i < medidos.length; i++) expect(medidos[i - 1].gainKgPerHaPerDay).toBeGreaterThanOrEqual(medidos[i].gainKgPerHaPerDay);
      if (sinMedir.length > 0) expect(r.paddocks.indexOf(sinMedir[0])).toBeGreaterThan(r.paddocks.indexOf(medidos[medidos.length - 1]));
    });
  });
});
