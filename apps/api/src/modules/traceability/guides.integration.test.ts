import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { CommerceService } from '../commerce/commerce.service';
import { GuidesService } from './guides.service';

/**
 * Integración de guías de traslado (T-1): CRUD, validación de finca/socio y máquina de estados.
 * `db.tenant` cae al demo.
 */
describe('traceability — guías de traslado', () => {
  let db: DbService;
  let commerce: CommerceService;
  let guides: GuidesService;
  let originalCwd: string;
  let tmp: string;
  let partnerId: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'guides-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    commerce = new CommerceService(db);
    guides = new GuidesService(db);
    const p: any = await commerce.createPartner({ type: 'customer', name: 'Frigorífico Norte', customer_segment: 'slaughterhouse' });
    partnerId = p.id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('crea una guía (finca por defecto + socio destino) y valida guide_number', async () => {
    const g: any = await guides.create({ guide_number: '  DTe-0001  ', to_partner_id: partnerId, animal_count: 42 });
    expect(g.guide_number).toBe('DTe-0001');
    expect(g.status).toBe('issued');
    expect(g.animal_count).toBe(42);
    expect(g.from_farm_id).toBeTruthy(); // finca por defecto
    await expect(guides.create({ guide_number: '  ' })).rejects.toMatchObject({ status: 400 });
    await expect(guides.create({ guide_number: 'X', to_partner_id: '00000000-0000-0000-0000-000000000000' })).rejects.toMatchObject({ status: 404 });
    await expect(guides.create({ guide_number: 'X', animal_count: -1 })).rejects.toMatchObject({ status: 400 });
  });

  it('máquina de estados: issued→in_transit→completed; transición inválida → 409', async () => {
    const g: any = await guides.create({ guide_number: 'DTe-0002' });
    await expect(guides.updateStatus(g.id, 'completed')).rejects.toMatchObject({ status: 409 }); // issued→completed no permitido
    const t: any = await guides.updateStatus(g.id, 'in_transit');
    expect(t.status).toBe('in_transit');
    const c: any = await guides.updateStatus(g.id, 'completed');
    expect(c.status).toBe('completed');
    await expect(guides.updateStatus(g.id, 'canceled')).rejects.toMatchObject({ status: 409 }); // completed terminal
  });

  it('cancelar desde issued; listar por estado; archivar', async () => {
    const g: any = await guides.create({ guide_number: 'DTe-0003' });
    const x: any = await guides.updateStatus(g.id, 'canceled');
    expect(x.status).toBe('canceled');
    expect((await guides.list('canceled')).some((y: any) => y.id === g.id)).toBe(true);
    await guides.remove(g.id);
    await expect(guides.get(g.id)).rejects.toMatchObject({ status: 404 });
  });
});
