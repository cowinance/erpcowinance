import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { EmployeesService } from './employees.service';

/**
 * Integración de empleados (H-1): CRUD, validaciones, terminación/reactivación y user_id.
 * `db.tenant` cae al demo.
 */
describe('hr — empleados', () => {
  let db: DbService;
  let svc: EmployeesService;
  let originalCwd: string;
  let tmp: string;
  let demoUserId: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'employees-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    svc = new EmployeesService(db);
    demoUserId = (await db.query<{ id: string }>(`SELECT id FROM users WHERE email='cowinance@gmail.com'`))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('crea un empleado, valida nombre y employment_type', async () => {
    const e: any = await svc.create({ full_name: '  María López  ', role: 'Encargada', employment_type: 'permanent', hire_date: '2028-03-01' });
    expect(e.full_name).toBe('María López');
    expect(e.employment_type).toBe('permanent');
    expect(e.is_active).toBe(true);
    await expect(svc.create({ full_name: '  ' })).rejects.toMatchObject({ status: 400 });
    await expect(svc.create({ full_name: 'X', employment_type: 'no-existe' })).rejects.toMatchObject({ status: 400 });
  });

  it('user_id opcional: válido enlaza, inexistente → 404', async () => {
    const e: any = await svc.create({ full_name: 'Con usuario', user_id: demoUserId });
    expect(e.user_id).toBe(demoUserId);
    await expect(svc.create({ full_name: 'Y', user_id: '00000000-0000-0000-0000-000000000000' })).rejects.toMatchObject({ status: 404 });
  });

  it('terminar desactiva + fija fecha; reactivar limpia; el listado por activo filtra', async () => {
    const e: any = await svc.create({ full_name: 'Temporal', employment_type: 'temporary' });
    const term: any = await svc.terminate(e.id, { termination_date: '2030-06-30' });
    expect(term.is_active).toBe(false);
    expect(term.termination_date).toBeTruthy();
    expect((await svc.list('false') as any[]).some((x) => x.id === e.id)).toBe(true);
    expect((await svc.list('true') as any[]).some((x) => x.id === e.id)).toBe(false);

    const re: any = await svc.reactivate(e.id);
    expect(re.is_active).toBe(true);
    expect(re.termination_date).toBeNull();
  });

  it('edita y archiva (baja lógica distinta de la terminación)', async () => {
    const e: any = await svc.create({ full_name: 'Editable' });
    const upd: any = await svc.update(e.id, { role: 'Peón', employment_type: 'contractor' });
    expect(upd.role).toBe('Peón');
    expect(upd.employment_type).toBe('contractor');
    await svc.remove(e.id);
    await expect(svc.get(e.id)).rejects.toMatchObject({ status: 404 });
    await expect(svc.update(e.id, { role: 'z' })).rejects.toMatchObject({ status: 404 });
  });
});
