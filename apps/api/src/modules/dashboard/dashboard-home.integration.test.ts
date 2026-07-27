import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { requestContext } from '../../common/request-context';
import { DashboardService } from './dashboard.service';
import { DashboardHomeService } from './dashboard-home.service';
import { TaskService } from '../tasks/task.service';
import { WeatherService } from '../weather/weather.service';
import { AlertsService } from '../alerts/alerts.service';
import { HealthService } from '../health/health.service';
import { ReproService } from '../repro/repro.service';
import { ServicePlanService } from '../repro/service-plan.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';
import { StrawsService } from '../genetics/straws.service';
import { NitrogenService } from '../genetics/nitrogen.service';
import { InventoryService } from '../inventory/inventory.service';

/**
 * Inicio E1 — endpoint agregado `/dashboard/home`. Verifica que COMPONE los servicios reales
 * (dashboard/tasks/alerts/health/repro) sin duplicar reglas: KPIs integrados, atención prioritaria
 * ordenada por severidad, estado general y agenda combinada ordenada por urgencia.
 */
describe('DashboardHomeService · home agregado (E1)', () => {
  let db: DbService;
  let home: DashboardHomeService;
  let tasks: TaskService;
  let userId: string;
  let farmId: string;
  let originalCwd: string;
  let tmp: string;
  const ctx = () => ({ origin: 'rest' as const, emitServerOrigin: true, actorUserId: userId });

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'home-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    tasks = new TaskService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db));
    const repro = new ReproService(db, {} as any, tasks as any, {} as any, {} as any, new StrawsService(db), new ServicePlanService(db, new StrawsService(db)));
    const alerts = new AlertsService(db, repro as any, new WeatherService(db), new NitrogenService(db, new InventoryService(db)));
    const health = new HealthService(db, {} as any, {} as any, {} as any, {} as any);
    home = new DashboardHomeService(db, new DashboardService(db), tasks, alerts, health, repro);
    userId = (await db.query<{ id: string }>(`SELECT id FROM users WHERE email = 'cowinance@gmail.com'`))[0].id;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [db.tenant]))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('compone KPIs de varios módulos + estado general + agenda combinada', async () => {
    const h: any = await home.home();
    // KPIs integrados (dashboard + tasks + alerts + health + repro).
    expect(h.kpis).toHaveProperty('active_animals');
    expect(h.kpis).toHaveProperty('overdue_tasks');
    expect(h.kpis).toHaveProperty('critical_alerts');
    expect(h.kpis).toHaveProperty('in_treatment');
    expect(h.kpis).toHaveProperty('diagnosis_pending');
    expect(h.kpis).toHaveProperty('no_recent_weighing');
    // Estado general.
    expect(h.farm_status).toHaveProperty('operation');
    expect(['ok', 'late', 'critical']).toContain(h.farm_status.operation);
    expect(['stable', 'attention']).toContain(h.farm_status.health);
    // Agenda combinada y actividad reciente presentes.
    expect(Array.isArray(h.agenda)).toBe(true);
    expect(Array.isArray(h.recent_activity)).toBe(true);
    expect(Array.isArray(h.priority)).toBe(true);
  }, 60_000);

  it('la atención prioritaria solo trae ítems con volumen, ordenados por severidad', async () => {
    // Tarea vencida crítica → debe aparecer arriba de todo en prioridad.
    await db.query(
      `INSERT INTO tasks (tenant_id, farm_id, title, type, due_date, priority, status, created_by)
       VALUES ($1,$2,'Cerrar tranquera rota','maintenance', CURRENT_DATE - 3, 'urgent','pending',$3)`,
      [db.tenant, farmId, userId],
    );
    const h: any = await home.home();
    expect(h.kpis.overdue_tasks).toBeGreaterThanOrEqual(1);
    expect(h.priority.every((p: any) => p.count > 0)).toBe(true);
    // Ordenado: severidad critical antes que warning/info.
    const rank: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    for (let i = 1; i < h.priority.length; i++) {
      expect(rank[h.priority[i - 1].severity]).toBeLessThanOrEqual(rank[h.priority[i].severity]);
    }
    // Tareas vencidas está presente y con href a la vista filtrada.
    const overdue = h.priority.find((p: any) => p.code === 'tasks_overdue');
    expect(overdue).toBeTruthy();
    expect(overdue.href).toContain('/tareas');
    // Estado operativo refleja la crítica.
    expect(['late', 'critical']).toContain(h.farm_status.operation);
  }, 60_000);

  // Cada `home()` compone ~9 servicios (incluido el computeDesired caro), así que se limita a DOS
  // roles —suficiente para probar que el dato SALE del contexto y no está fijo— y se le da margen
  // explícito: con la suite completa en paralelo, dos composiciones se pasan del default de 5 s.
  it(
    'expone el ROL del usuario de la request (base de la personalización del Inicio)',
    async () => {
      const tenantId = db.tenant;
      const asRole = (role: string) =>
        requestContext.run({ userId, tenantId, role }, () => home.home() as Promise<any>);

      expect((await asRole('veterinarian')).role).toBe('veterinarian');
      expect((await asRole('owner')).role).toBe('owner');
    },
    60_000,
  );

  it('no duplica una tarea que el motor de alertas ya expone (regresión: agenda doble)', async () => {
    // El motor ya publica las tareas SANITARIAS pendientes (regla health_task_due, related_type
    // 'task' con el id de la tarea). Al combinar la agenda hay que evitar sumarlas otra vez: una
    // tarea de sanidad vencida aparecía DOS VECES en «Atención hoy» (lo detectó el e2e 10-agenda).
    await db.query(
      `INSERT INTO tasks (tenant_id, farm_id, title, type, due_date, priority, status, created_by)
       VALUES ($1,$2,'Revisión sanitaria — regresión','health', CURRENT_DATE - 1, 'normal','pending',$3)`,
      [db.tenant, farmId, userId],
    );
    const h: any = await home.home();
    const taskIds = h.agenda.filter((a: any) => a.related_type === 'task' && a.related_id).map((a: any) => a.related_id);
    expect(taskIds.length).toBe(new Set(taskIds).size); // sin ids repetidos
    // Y la tarea sanitaria sigue estando (no se perdió al deduplicar).
    expect(h.agenda.some((a: any) => String(a.title).includes('Revisión sanitaria — regresión'))).toBe(true);
  }, 60_000);

  it('la agenda combinada ordena por fecha (vencidas primero)', async () => {
    const h: any = await home.home();
    const dues = h.agenda.map((a: any) => a.due_at ?? '9999-12-31');
    for (let i = 1; i < dues.length; i++) expect(dues[i - 1] <= dues[i]).toBe(true);
    // Incluye la tarea vencida (category 'task').
    expect(h.agenda.some((a: any) => a.category === 'task')).toBe(true);
  }, 60_000);

  /**
   * «Sin pesar hace 90 días»: el número y su costo.
   *
   * Este conteo iba contra `v_weighings` —la vista que deriva la GDP con un `LAG`— desde un
   * `NOT EXISTS` correlacionado, así que por cada animal se pagaba el cálculo de la ventana entera.
   * Con los 66 animales del demo no se notaba; con 3.000 el Inicio tardaba SIETE SEGUNDOS.
   *
   * El test fija las dos mitades del arreglo: que el número siga siendo el correcto (velocidad sin
   * corrección no sirve de nada) y que se lo pida a la tabla y no a la vista.
   */
  describe('animales sin pesaje reciente', () => {
    it('CUENTA IGUAL QUE LA VISTA, que es lo que hacía antes', async () => {
      const t = db.tenant;
      // Un animal con pesaje viejo (cuenta), otro con pesaje reciente (no cuenta), y un tercero con
      // el pesaje reciente BORRADO lógicamente (cuenta: un pesaje borrado no es un pesaje).
      const [{ id: species }] = await db.query<any>(`SELECT id FROM species WHERE code='bovine'`);
      const [{ id: farm }] = await db.query<any>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [t]);
      const nuevo = async () =>
        (await db.query<any>(
          `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, origin) VALUES ($1,$2,$3,'M','active','born') RETURNING id`,
          [t, farm, species],
        ))[0].id as string;
      const pesar = (a: string, diasAtras: number, borrado = false) =>
        db.query(
          `INSERT INTO weighings (tenant_id, animal_id, weighed_at, weight_kg, method, deleted_at)
           VALUES ($1,$2, now() - ($3::int || ' days')::interval, 300, 'scale', $4)`,
          [t, a, diasAtras, borrado ? new Date().toISOString() : null],
        );

      await pesar(await nuevo(), 200);
      await pesar(await nuevo(), 10);
      await pesar(await nuevo(), 10, true);

      const porLaTabla = (
        await db.query<any>(
          `SELECT count(*)::int AS n FROM animals a WHERE a.tenant_id=$1 AND a.status='active' AND a.deleted_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM weighings w WHERE w.animal_id=a.id AND w.tenant_id=a.tenant_id AND w.deleted_at IS NULL
                               AND w.weighed_at >= now() - interval '90 days')`,
          [t],
        )
      )[0].n;
      const porLaVista = (
        await db.query<any>(
          `SELECT count(*)::int AS n FROM animals a WHERE a.tenant_id=$1 AND a.status='active' AND a.deleted_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM v_weighings w WHERE w.animal_id=a.id AND w.deleted_at IS NULL
                               AND w.weighed_at >= now() - interval '90 days')`,
          [t],
        )
      )[0].n;

      expect(porLaTabla).toBe(porLaVista);
      expect(porLaTabla).toBeGreaterThan(0); // si diera 0, la igualdad de arriba no probaría nada
      expect((await home.home()).kpis.no_recent_weighing).toBe(porLaTabla);
    }, 60_000);

    it('NO consulta la vista de GDP: es lo que lo volvía cuadrático', async () => {
      // Se mira el código porque el costo no se ve en un test con datos de demo — se vio con el hato
      // inflado a 3.000, donde el Inicio pasaba de 49 ms a 7.156.
      const src = readFileSync(join(originalCwd, 'apps/api/src/modules/dashboard/dashboard-home.service.ts'), 'utf8');
      const fn = src.slice(src.indexOf('private async noRecentWeighing'));
      expect(fn.slice(0, 900)).not.toContain('v_weighings');
    });
  });
});
