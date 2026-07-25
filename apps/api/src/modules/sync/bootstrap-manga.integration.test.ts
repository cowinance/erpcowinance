import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { mangaCardAlerts } from '@cowinance/domain';
import { DbService } from '../../db/db.service';
import { SyncService } from './sync.service';
import { SyncHandlerRegistry } from './registry/sync-handler.registry';
import { BillingService } from '../billing/billing.service';

/**
 * Paridad de la manga: el bootstrap tiene que bajar lo que la tarjeta OFFLINE necesita para avisar
 * lo mismo que la web.
 *
 * Sin retiro vigente ni casos clínicos abiertos, el operario en el campo —que es quien decide si el
 * animal sube al camión— vería una tarjeta más pobre que la de la oficina. Estas dos alertas son
 * las únicas con consecuencia sanitaria y regulatoria.
 */
describe('bootstrap — datos de la tarjeta de manga', () => {
  let db: DbService;
  let sync: SyncService;
  let tmp: string;
  let originalCwd: string;
  let deviceId: string;
  let animalId: string;

  const animalFields = async () => {
    const boot = await sync.bootstrap(deviceId);
    const row = (boot as any).rows.find((r: any) => r.table === 'animals' && r.rowId === animalId);
    return row?.state.fields as Record<string, unknown>;
  };

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'boot-manga-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    await db.defaultFarm();
    sync = new SyncService(db, new SyncHandlerRegistry(), new BillingService(db));

    const device: any = await sync.registerDevice({ platform: 'ios', device_name: 'Manga test' });
    deviceId = device.id ?? device.device_id;

    const a = await db.one<{ id: string }>(
      `SELECT id FROM animals WHERE tenant_id = $1 AND status = 'active' AND deleted_at IS NULL LIMIT 1`,
      [db.tenant],
    );
    animalId = a!.id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('un animal sin novedades viaja sin retiro ni casos', async () => {
    const f = await animalFields();
    expect(f).toBeDefined();
    expect(f.meat_withdrawal_until ?? null).toBeNull();
    expect(f.open_cases).toBe(0);
  });

  it('baja el retiro VIGENTE del animal', async () => {
    const producto = await db.one<{ id: string }>(
      `SELECT id FROM products_veterinary WHERE tenant_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [db.tenant],
    );
    await db.query(
      `INSERT INTO treatments (tenant_id, animal_id, product_id, applied_at, meat_withdrawal_until, created_by)
       VALUES ($1,$2,$3,now(),CURRENT_DATE + 15,$4)`,
      [db.tenant, animalId, producto!.id, db.user],
    );

    const f = await animalFields();
    expect(f.meat_withdrawal_until).toBeTruthy();

    // Y con ese dato, la regla compartida produce la alerta roja.
    const alerts = mangaCardAlerts({
      meatWithdrawalUntil: f.meat_withdrawal_until as string,
      lotId: 'x',
      daysSinceWeighing: 1,
    });
    expect(alerts[0]).toMatchObject({ code: 'withdrawal', tone: 'danger' });
  });

  // Un retiro que ya terminó no tiene por qué frenar al operario.
  it('NO baja un retiro ya vencido', async () => {
    const otro = await db.one<{ id: string }>(
      `SELECT id FROM animals WHERE tenant_id = $1 AND status='active' AND id <> $2 AND deleted_at IS NULL LIMIT 1`,
      [db.tenant, animalId],
    );
    const producto = await db.one<{ id: string }>(
      `SELECT id FROM products_veterinary WHERE tenant_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [db.tenant],
    );
    await db.query(
      `INSERT INTO treatments (tenant_id, animal_id, product_id, applied_at, meat_withdrawal_until, created_by)
       VALUES ($1,$2,$3,now() - interval '60 days',CURRENT_DATE - 10,$4)`,
      [db.tenant, otro!.id, producto!.id, db.user],
    );
    const boot = await sync.bootstrap(deviceId);
    const row = (boot as any).rows.find((r: any) => r.table === 'animals' && r.rowId === otro!.id);
    expect(row.state.fields.meat_withdrawal_until ?? null).toBeNull();
  });

  // La web cuenta como abierto tres estados, no uno: si acá contara solo 'open', el mismo animal
  // mostraría alerta en la oficina y no en el campo.
  it.each(['open', 'in_treatment', 'observation'])('cuenta como caso abierto el estado %s', async (status) => {
    await db.query(`DELETE FROM clinical_cases WHERE tenant_id = $1 AND animal_id = $2`, [db.tenant, animalId]);
    await db.query(
      `INSERT INTO clinical_cases (tenant_id, animal_id, status, severity, started_at, created_by)
       VALUES ($1,$2,$3,'severe',now(),$4)`,
      [db.tenant, animalId, status, db.user],
    );
    const f = await animalFields();
    expect(f.open_cases).toBe(1);
    expect(f.case_severity).toBe('severe');
  });

  it('un caso cerrado deja de contar', async () => {
    await db.query(`DELETE FROM clinical_cases WHERE tenant_id = $1 AND animal_id = $2`, [db.tenant, animalId]);
    await db.query(
      `INSERT INTO clinical_cases (tenant_id, animal_id, status, severity, started_at, closed_at, created_by)
       VALUES ($1,$2,'recovered','mild',now() - interval '10 days',now(),$3)`,
      [db.tenant, animalId, db.user],
    );
    expect((await animalFields()).open_cases).toBe(0);
  });

  // La preñez abierta ya viajaba; se comprueba que siga llegando, porque de ahí sale «parto próximo».
  it('sigue bajando las preñeces abiertas con su fecha probable', async () => {
    const boot = await sync.bootstrap(deviceId);
    const preñeces = (boot as any).rows.filter((r: any) => r.table === 'pregnancies');
    expect(preñeces.length).toBeGreaterThan(0);
    expect(preñeces[0].state.fields.expected_due_date).toBeTruthy();
  });
});
