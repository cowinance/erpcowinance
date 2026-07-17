import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { WorkLogsService } from './work-logs.service';

/**
 * Integración de partes de trabajo (WL-1): captura de horas con la invariante de dominio (finitas,
 * > 0, ≤ 24), imputación opcional a tarea/finca, y el resumen DERIVADO (horas y días por empleado).
 * `db.tenant` cae al demo.
 */
describe('hr — partes de trabajo (work_logs)', () => {
  let db: DbService;
  let svc: WorkLogsService;
  let originalCwd: string;
  let tmp: string;
  let tenantId: string;
  let companyId: string;
  let farmId: string;
  let emp1: string;
  let emp2: string;
  let taskId: string;

  const mkEmployee = async (name: string) =>
    (await db.query<{ id: string }>(`INSERT INTO employees (tenant_id, company_id, full_name) VALUES ($1,$2,$3) RETURNING id`, [tenantId, companyId, name]))[0].id;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'worklogs-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    svc = new WorkLogsService(db);
    tenantId = db.tenant;
    companyId = (await db.query<{ id: string }>(`SELECT id FROM companies WHERE tenant_id=$1 LIMIT 1`, [tenantId]))[0].id;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [tenantId]))[0].id;
    emp1 = await mkEmployee('Juan Pérez');
    emp2 = await mkEmployee('Ana Gómez');
    taskId = (await db.query<{ id: string }>(`INSERT INTO tasks (tenant_id, farm_id, title) VALUES ($1,$2,$3) RETURNING id`, [tenantId, farmId, 'Alambrado']))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('crea un parte con horas válidas e imputación a tarea/finca', async () => {
    const w: any = await svc.create({ employee_id: emp1, work_date: '2030-03-01', hours: 8, task_id: taskId, farm_id: farmId, notes: 'Reparación' });
    expect(w.hours).toBe(8);
    expect(w.employee_name).toBe('Juan Pérez');
    expect(w.task_title).toBe('Alambrado');
    expect(w.farm_name).toBeTruthy();
  });

  it('valida las horas (regla de dominio): 0, negativo y > 24 → 400', async () => {
    await expect(svc.create({ employee_id: emp1, hours: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(svc.create({ employee_id: emp1, hours: -3 })).rejects.toMatchObject({ status: 400 });
    await expect(svc.create({ employee_id: emp1, hours: 25 })).rejects.toMatchObject({ status: 400 });
  });

  it('empleado obligatorio/ inexistente → 400/404; tarea o finca inexistente → 404', async () => {
    await expect(svc.create({ hours: 4 })).rejects.toMatchObject({ status: 400 });
    await expect(svc.create({ employee_id: '00000000-0000-0000-0000-000000000000', hours: 4 })).rejects.toMatchObject({ status: 404 });
    await expect(svc.create({ employee_id: emp1, hours: 4, task_id: '00000000-0000-0000-0000-000000000000' })).rejects.toMatchObject({ status: 404 });
    await expect(svc.create({ employee_id: emp1, hours: 4, farm_id: '00000000-0000-0000-0000-000000000000' })).rejects.toMatchObject({ status: 404 });
  });

  it('lista con filtros por empleado y rango de fechas', async () => {
    await svc.create({ employee_id: emp2, work_date: '2030-03-02', hours: 6 });
    await svc.create({ employee_id: emp1, work_date: '2030-03-03', hours: 5 });
    const soloEmp1: any[] = await svc.list({ employee_id: emp1 });
    expect(soloEmp1.every((w) => w.employee_id === emp1)).toBe(true);
    const rango: any[] = await svc.list({ from: '2030-03-02', to: '2030-03-02' });
    expect(rango).toHaveLength(1);
    expect(rango[0].employee_id).toBe(emp2);
  });

  it('resumen derivado: horas totales y días trabajados por empleado', async () => {
    // emp1 en marzo: 8 (01) + 5 (03) = 13h en 2 días. Dos partes el mismo día cuentan un día.
    await svc.create({ employee_id: emp1, work_date: '2030-03-03', hours: 2 });
    const resumen: any[] = await svc.summary('2030-03-01', '2030-03-31');
    const r1 = resumen.find((r) => r.employee_id === emp1);
    expect(r1.total_hours).toBe(15); // 8 + 5 + 2
    expect(r1.days_worked).toBe(2); // 01 y 03
    expect(r1.entries).toBe(3);
  });

  it('actualiza horas y baja lógica', async () => {
    const w: any = await svc.create({ employee_id: emp2, work_date: '2030-04-01', hours: 4 });
    const upd: any = await svc.update(w.id, { hours: 7.5, notes: 'Corregido' });
    expect(upd.hours).toBe(7.5);
    expect(upd.notes).toBe('Corregido');
    await svc.remove(w.id);
    await expect(svc.get(w.id)).rejects.toMatchObject({ status: 404 });
  });
});
