import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { ReproService } from './repro.service';
import { ReproStatusService } from './repro-status.service';
import { ServicePlanService } from './service-plan.service';
import { SemenService } from '../genetics/semen.service';
import { StrawsService } from '../genetics/straws.service';
import { EmbryosService } from '../genetics/embryos.service';
import type { WeaningService } from './weaning.service';
import type { TaskService } from '../tasks/task.service';
import { InbreedingService } from '../genetics/inbreeding.service';
import { ProtocolService } from './protocol.service';
import { ReproDashboardService } from './repro-dashboard.service';
import { MovementService } from '../../modules/land/movement.service';
import { SyncVersionStore } from '../../modules/sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../../modules/sync/registry/server-origin-changeset.writer';

/**
 * Integración del estado reproductivo RICO (Reproducción E1): `herdStatus` deriva el estado por
 * vientre con la regla única `computeReproStatus` desde eventos reales (parto, preñez, servicio,
 * diagnóstico), calculando días postparto/abiertos. Prueba también `toPrepare` (próximas a preparar)
 * y `statusAlerts` (alertas derivadas). Config por defecto (VWP 60, diag 45, abierta 90, repet. 3).
 */
describe('ReproStatusService.herdStatus — estado rico + días abiertos', () => {
  let db: DbService;
  let repro: ReproService;
  let status: ReproStatusService;
  let panel: ReproDashboardService;
  let t: string;
  let farmId: string;
  let speciesId: string;
  let vaca: string;
  let vaquillona: string;
  let novillo: string;
  let lot: string;
  let originalCwd: string;
  let tmp: string;

  const mkAnimal = async (catId: string, sex = 'F'): Promise<string> =>
    (await db.query<{ id: string }>(
      `INSERT INTO animals (tenant_id, farm_id, species_id, category_id, current_lot_id, sex, status, origin)
       VALUES ($1,$2,$3,$4,$5,$6,'active','born') RETURNING id`,
      [t, farmId, speciesId, catId, lot, sex],
    ))[0].id;
  const pregDue = (animal: string, dueInDays: number) =>
    db.query(`INSERT INTO pregnancies (tenant_id, animal_id, diagnosis_date, status, expected_due_date) VALUES ($1,$2,CURRENT_DATE - 30,'open',CURRENT_DATE + $3::int)`, [t, animal, dueInDays]);
  const calving = (animal: string, daysAgo: number) =>
    db.query(`INSERT INTO calvings (tenant_id, dam_id, calving_date, offspring_count) VALUES ($1,$2,CURRENT_DATE - $3::int,1)`, [t, animal, daysAgo]);
  const service = (animal: string, daysAgo: number) =>
    db.query(`INSERT INTO breeding_events (tenant_id, animal_id, type, occurred_at) VALUES ($1,$2,'service_ai',CURRENT_DATE - ($3 || ' days')::interval)`, [t, animal, daysAgo]);
  const negative = (animal: string, daysAgo: number) =>
    db.query(`INSERT INTO animal_events (tenant_id, animal_id, event_type, payload, occurred_at, recorded_at) VALUES ($1,$2,'pregnancy_negative','{}'::jsonb,CURRENT_DATE - ($3||' days')::interval,now())`, [t, animal, daysAgo]);

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'herd-status-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    status = new ReproStatusService(db);
    repro = new ReproService(db, {} as WeaningService, {} as TaskService, new SemenService(db, new StrawsService(db)), new EmbryosService(db, new StrawsService(db)), new StrawsService(db), new ServicePlanService(db, new StrawsService(db)), new InbreedingService(db), new MovementService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db)), status);
    panel = new ReproDashboardService(repro, status, new ProtocolService(db, {} as TaskService, new ServicePlanService(db, new StrawsService(db)), repro));
    t = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id = $1 LIMIT 1`, [t]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species WHERE code = 'bovine'`))[0].id;
    vaca = (await db.query<{ id: string }>(`SELECT id FROM animal_categories WHERE code = 'vaca'`))[0].id;
    vaquillona = (await db.query<{ id: string }>(`SELECT id FROM animal_categories WHERE code = 'vaquillona'`))[0].id;
    novillo = (await db.query<{ id: string }>(`SELECT id FROM animal_categories WHERE code = 'novillo'`))[0].id;
    lot = (await db.query<{ id: string }>(`INSERT INTO lots (tenant_id, farm_id, name) VALUES ($1,$2,$3) RETURNING id`, [t, farmId, `Rodeo R1-${Date.now()}`]))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('deriva estados desde eventos, calcula días y excluye no-vientres', async () => {
    const vPreg = await mkAnimal(vaca); await pregDue(vPreg, 200);
    const vDueSoon = await mkAnimal(vaca); await pregDue(vDueSoon, 10);
    const vServed = await mkAnimal(vaca); await service(vServed, 5);
    const vDiagPend = await mkAnimal(vaca); await service(vDiagPend, 50);
    const vRest = await mkAnimal(vaca); await calving(vRest, 20);
    const vReady = await mkAnimal(vaca); await calving(vReady, 77);
    const vOpen = await mkAnimal(vaca); await calving(vOpen, 138);
    const vHeifer = await mkAnimal(vaquillona);
    await mkAnimal(novillo, 'M'); // no-vientre → excluido

    const res = await status.herdStatus(lot);
    const by = new Map(res.rows.map((r: any) => [r.animal_id, r]));

    expect(by.get(vPreg).status).toBe('pregnant');
    expect(by.get(vDueSoon).status).toBe('due_soon');
    expect(by.get(vServed).status).toBe('served');
    expect(by.get(vDiagPend).status).toBe('diagnosis_pending');
    expect(by.get(vRest).status).toBe('postpartum_rest');
    expect(by.get(vReady).status).toBe('ready_for_service');
    expect(by.get(vOpen).status).toBe('open');
    expect(by.get(vHeifer).status).toBe('ready_for_service');

    expect(by.get(vRest).days_postpartum).toBe(20);
    expect(by.get(vOpen).days_open).toBe(138);
    expect(by.get(vDiagPend).days_since_service).toBe(50);
    expect(res.counts.total).toBe(8); // novillo excluido
  });

  it('repetidora: varios servicios sin preñez y último evento negativo', async () => {
    const v = await mkAnimal(vaca);
    await calving(v, 100);
    await service(v, 80); await service(v, 60); await service(v, 40);
    await negative(v, 30);
    const res = await status.herdStatus(lot);
    const row = res.rows.find((r: any) => r.animal_id === v)!;
    expect(row.status).toBe('repeat_breeder');
  });

  it('toPrepare lista las vacas próximas a cumplir el VWP', async () => {
    const v = await mkAnimal(vaca);
    await calving(v, 55); // VWP 60 → faltan 5 días (≤ 7)
    const res = await status.toPrepare(7);
    expect(res.vwp_days).toBe(60);
    expect(res.rows.some((r: any) => r.animal_id === v && r.days_to_vwp === 5)).toBe(true);
  });

  it('statusAlerts genera alertas derivadas (diagnóstico pendiente, abierta, listas)', async () => {
    const alerts = await status.statusAlerts();
    const codes = new Set(alerts.map((a: any) => a.code));
    expect(codes.has('diagnosis_due')).toBe(true);
    expect(codes.has('open_too_long')).toBe(true);
    expect(codes.has('vwp_ready')).toBe(true); // hay vacas ready_for_service por parto
  });

  it('dashboard compone buckets: diagnóstico pendiente + abiertas críticas + KPIs', async () => {
    const vDiag = await mkAnimal(vaca); await service(vDiag, 50); // diagnóstico pendiente
    const vOpen2 = await mkAnimal(vaca); await calving(vOpen2, 140); // abierta crítica
    const d: any = await panel.reproDashboard();
    expect(d.kpis).toBeTruthy();
    expect(d.counts.total).toBeGreaterThan(0);
    expect(d.diagnosis_pending.some((r: any) => r.animal_id === vDiag)).toBe(true);
    expect(d.critical_open.some((r: any) => r.animal_id === vOpen2)).toBe(true);
    expect(Array.isArray(d.upcoming_calvings)).toBe(true);
    expect(Array.isArray(d.active_protocols)).toBe(true);
  });
});
