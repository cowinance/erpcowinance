import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { MachineryService } from './machinery.service';

/**
 * Integración de maquinaria (MQ-1): CRUD, validaciones y máquina de estados. `db.tenant` cae al demo.
 */
describe('machinery — maestro', () => {
  let db: DbService;
  let svc: MachineryService;
  let originalCwd: string;
  let tmp: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'machinery-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    svc = new MachineryService(db);
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('crea una máquina (valida nombre y type) con finca por defecto', async () => {
    const m: any = await svc.create({ name: '  John Deere 5075  ', type: 'tractor', make: 'John Deere', year: 2019, engine_hours: 1200 });
    expect(m.name).toBe('John Deere 5075');
    expect(m.type).toBe('tractor');
    expect(m.status).toBe('active');
    await expect(svc.create({ name: '  ' })).rejects.toMatchObject({ status: 400 });
    await expect(svc.create({ name: 'X', type: 'no-existe' })).rejects.toMatchObject({ status: 400 });
  });

  it('máquina de estados: active→maintenance→active; →retired terminal', async () => {
    const m: any = await svc.create({ name: 'Cosechadora', type: 'harvester' });
    const mnt: any = await svc.updateStatus(m.id, 'maintenance');
    expect(mnt.status).toBe('maintenance');
    const back: any = await svc.updateStatus(m.id, 'active');
    expect(back.status).toBe('active');
    const ret: any = await svc.updateStatus(m.id, 'retired');
    expect(ret.status).toBe('retired');
    await expect(svc.updateStatus(m.id, 'active')).rejects.toMatchObject({ status: 409 }); // retired terminal
  });

  it('lista por estado; edita horas/km; archiva', async () => {
    const m: any = await svc.create({ name: 'Camioneta', type: 'truck' });
    const upd: any = await svc.update(m.id, { odometer_km: 85000, plate: 'AB123CD' });
    expect(upd.odometer_km).toBe(85000);
    expect(upd.plate).toBe('AB123CD');
    expect((await svc.list('active')).some((x: any) => x.id === m.id)).toBe(true);
    await svc.remove(m.id);
    await expect(svc.get(m.id)).rejects.toMatchObject({ status: 404 });
  });

  /**
   * Lo que cuesta usar cada máquina (Fase 4).
   *
   * Lo que se fija acá es que el USO se derive de las lecturas del período. El bug fácil sería usar
   * `machinery.engine_hours` —el valor de HOY—: mezclaría horas trabajadas fuera del rango y el
   * costo por hora saldría más barato de lo que es, sin que nada se vea roto.
   */
  describe('costo de uso (Fase 4)', () => {
    const R = { from: '2034-01-01', to: '2034-12-31' };
    let tractor: string;
    let camioneta: string;
    let sinMedidor: string;

    const cargar = (maq: string, fecha: string, litros: number, costo: number, horas: number | null, km: number | null) =>
      db.query(
        `INSERT INTO fuel_logs (tenant_id, machinery_id, fueled_at, liters, engine_hours, odometer_km, total_cost) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [db.tenant, maq, `${fecha}T10:00:00Z`, litros, horas, km, costo],
      );
    const service = (maq: string, fecha: string, tipo: string, costo: number, horas: number | null) =>
      db.query(
        `INSERT INTO maintenance_records (tenant_id, machinery_id, type, performed_at, cost, engine_hours) VALUES ($1,$2,$3,$4,$5,$6)`,
        [db.tenant, maq, tipo, `${fecha}T10:00:00Z`, costo, horas],
      );

    beforeAll(async () => {
      tractor = ((await svc.create({ name: 'Tractor 4.1', type: 'tractor' })) as any).id;
      camioneta = ((await svc.create({ name: 'Camioneta 4.1', type: 'truck' })) as any).id;
      sinMedidor = ((await svc.create({ name: 'Mixer 4.1', type: 'mixer' })) as any).id;

      await cargar(tractor, '2034-02-01', 100, 300, 1000, null);
      await cargar(tractor, '2034-06-01', 100, 300, 1500, null); // 500 h de uso
      await service(tractor, '2034-04-01', 'corrective', 400, 1200);

      await cargar(camioneta, '2034-02-01', 60, 180, null, 50000);
      await cargar(camioneta, '2034-07-01', 60, 180, null, 60000); // 10.000 km

      // Con gasto y una sola lectura: no hay uso que dividir.
      await cargar(sinMedidor, '2034-03-01', 200, 500, null, null);

      // Y una máquina que ya venía con muchas horas cargadas en el maestro: si el cálculo tomara
      // ese valor en vez de las lecturas, el uso saldría enorme y el costo por hora, ridículo.
      await db.query(`UPDATE machinery SET engine_hours = 9000 WHERE id = $1`, [tractor]);
    });

    it('el uso sale de las lecturas del período, no del horómetro de hoy', async () => {
      const r: any = await svc.costs(R);
      const t = r.by_hours.find((m: any) => m.id === tractor);
      expect(t.cost.usage).toBe(500); // 1500 − 1000, no 9000
      expect(t.cost.totalCost).toBe(1000); // 600 de gasoil + 400 del arreglo
      expect(t.cost.costPerUnit).toBe(2);
    });

    it('NO MEZCLA HORAS CON KILÓMETROS EN EL MISMO RANKING', async () => {
      const r: any = await svc.costs(R);
      expect(r.by_hours.map((m: any) => m.id)).toContain(tractor);
      expect(r.by_hours.map((m: any) => m.id)).not.toContain(camioneta);
      expect(r.by_km.map((m: any) => m.id)).toContain(camioneta);
      expect(r.by_km.find((m: any) => m.id === camioneta).cost.costPerUnit).toBe(0.04); // 400 / 10.000 km
    });

    it('con una sola lectura informa el gasto pero NO un costo por hora', async () => {
      const r: any = await svc.costs(R);
      const m = r.unmeasured.find((x: any) => x.id === sinMedidor);
      expect(m.cost.totalCost).toBe(500);
      expect(m.cost.costPerUnit).toBeNull();
      expect(m.cost.caveat).toMatch(/anotar el medidor/i);
    });

    it('separa el correctivo del preventivo: es la señal que el costo total esconde', async () => {
      const r: any = await svc.costs(R);
      expect(r.by_hours.find((m: any) => m.id === tractor).cost.correctiveSharePct).toBe(100);
    });

    it('el gasto de otro período no entra', async () => {
      await cargar(tractor, '2035-02-01', 999, 9999, 5000, null);
      const r: any = await svc.costs(R);
      expect(r.by_hours.find((m: any) => m.id === tractor).cost.totalCost).toBe(1000);
    });
  });
});
