import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { ReproService } from './repro.service';
import { SemenService } from '../genetics/semen.service';
import { StrawsService } from '../genetics/straws.service';
import { EmbryosService } from '../genetics/embryos.service';
import type { WeaningService } from './weaning.service';
import type { TaskService } from '../tasks/task.service';

/**
 * Integración del CRUD de protocolos reproductivos (R-2.a): alta con validación de dominio,
 * listado, edición (pasos + archivar), baja lógica y errores. `db.tenant` cae al tenant demo.
 */
describe('repro protocolos — CRUD', () => {
  let db: DbService;
  let repro: ReproService;
  let originalCwd: string;
  let tmp: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'repro-proto-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    repro = new ReproService(db, {} as WeaningService, {} as TaskService, new SemenService(db, new StrawsService(db)), new EmbryosService(db, new StrawsService(db)), new StrawsService(db));
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('crea, valida, lista, edita, archiva y maneja errores', async () => {
    // Alta: pasos normalizados (action recortada), is_active por defecto.
    const created = await repro.createProtocol({ name: '  IATF 10 días  ', steps: [{ day: 0, action: ' Implante ' }, { day: 8, action: 'Retiro + PGF' }, { day: 10, action: 'IATF' }] });
    expect(created.name).toBe('IATF 10 días');
    expect(created.is_active).toBe(true);
    expect(created.steps).toEqual([{ day: 0, action: 'Implante' }, { day: 8, action: 'Retiro + PGF' }, { day: 10, action: 'IATF' }]);

    // Validación: pasos inválidos y nombre vacío → BadRequest.
    await expect(repro.createProtocol({ name: 'x', steps: [{ day: -1, action: 'x' }] })).rejects.toMatchObject({ status: 400 });
    await expect(repro.createProtocol({ name: '   ', steps: [] })).rejects.toMatchObject({ status: 400 });

    // Listado incluye el creado.
    const list = await repro.listProtocols();
    expect(list.find((p: any) => p.id === created.id)).toBeTruthy();

    // Edición: renombra, cambia pasos y archiva (is_active=false).
    const updated = await repro.updateProtocol(created.id, { name: 'IATF 9 días', steps: [{ day: 0, action: 'A' }], is_active: false });
    expect(updated.name).toBe('IATF 9 días');
    expect(updated.is_active).toBe(false);
    expect(updated.steps).toEqual([{ day: 0, action: 'A' }]);

    // Baja lógica: desaparece del listado.
    await repro.deleteProtocol(created.id);
    const after = await repro.listProtocols();
    expect(after.find((p: any) => p.id === created.id)).toBeFalsy();

    // Errores sobre inexistente / eliminado.
    await expect(repro.updateProtocol(created.id, { name: 'z' })).rejects.toMatchObject({ status: 404 });
    await expect(repro.deleteProtocol(created.id)).rejects.toMatchObject({ status: 404 });
  });
});
