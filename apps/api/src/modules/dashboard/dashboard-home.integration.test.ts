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
import { InbreedingService } from '../genetics/inbreeding.service';
import { MovementService } from '../../modules/land/movement.service';

/**
 * Inicio E1 — endpoint agregado `/dashboard/home`. Verifica que COMPONE los servicios reales
 * (dashboard/tasks/alerts/health/repro) sin duplicar reglas: KPIs integrados, atención prioritaria
 * ordenada por severidad, estado general y agenda combinada ordenada por urgencia.
 */
describe('DashboardHomeService · home agregado (E1)', () => {
  let db: DbService;
  let home: DashboardHomeService;
  let tasks: TaskService;
  let alerts: AlertsService;
  let health: HealthService;
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
    const repro = new ReproService(db, {} as any, tasks as any, {} as any, {} as any, new StrawsService(db), new ServicePlanService(db, new StrawsService(db)), new InbreedingService(db), new MovementService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db)));
    alerts = new AlertsService(db, repro as any, new WeatherService(db), new NitrogenService(db, new InventoryService(db)));
    health = new HealthService(db, {} as any, {} as any, {} as any, {} as any);
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

    it('los primeros pasos SALEN DEL ESTADO REAL, no de un flag', async () => {
      // El demo tiene hato, lotes, pesajes y sanidad: los cuatro pasos tienen que estar dados. Si
      // alguna de las cuatro consultas mirara la tabla equivocada, acá se vería como un paso que no
      // se tilda nunca por más que el productor cargue el dato.
      const s: any = (await home.home()).setup;
      expect(s.total).toBe(4);
      expect(s.steps.map((x: any) => x.code)).toEqual(['herd', 'lots', 'weighing', 'health']);
      expect(s.steps.every((x: any) => x.done), `pendientes: ${s.steps.filter((x: any) => !x.done).map((x: any) => x.code)}`).toBe(true);
      expect(s.complete).toBe(true);
      expect(s.next).toBeNull();
    }, 60_000);

    it('CADA PASO TRAE TEXTO Y UN ENLACE: sin eso es una lista de reproches', async () => {
      // Un checklist que dice qué falta pero no adónde ir obliga a buscarlo en un menú de 30
      // módulos. Los enlaces se comprueban contra las rutas que existen en la web.
      const s: any = (await home.home()).setup;
      const rutas = ['/animales/nuevo', '/lotes', '/manga', '/sanidad'];
      for (const paso of s.steps) {
        expect(paso.title, `paso ${paso.code} sin título`).toBeTruthy();
        expect(paso.body, `paso ${paso.code} sin explicación`).toBeTruthy();
        expect(rutas, `el paso ${paso.code} apunta a ${paso.href}`).toContain(paso.href);
      }
    }, 60_000);

    it('NO cuenta filas para saber si hay al menos una', async () => {
      // `count(*)` recorre la tabla entera; `EXISTS` corta en la primera fila. Con miles de animales
      // eso son cuatro recorridos completos en CADA carga del Inicio, la pantalla que más se abre.
      const src = readFileSync(join(originalCwd, 'apps/api/src/modules/dashboard/dashboard-home.service.ts'), 'utf8');
      const fn = src.slice(src.indexOf('private async farmSetup'), src.indexOf('/** Actividad reciente'));
      expect(fn).toContain('EXISTS');
      expect(fn).not.toContain('count(');
    });

    it('LA AGENDA VIENE ACOTADA, y dice cuánto no está mostrando', async () => {
      // La agenda no tenía tope: con 65 animales del demo eran 62 ítems y 19 de los 24,6 KB de la
      // respuesta — casi un ítem por animal, así que escala con el hato. En una finca de miles son
      // cientos de KB en la pantalla que más se abre, sobre la conexión de un campo.
      //
      // El tope solo es aceptable si se DICE: recortar en silencio haría que el productor leyera la
      // lista, la viera terminar y creyera que ya vio todo lo del día. Por eso `agenda_total` no es
      // decoración — es lo que vuelve honesto al recorte, y por eso se prueba junto al tope.
      const h: any = await home.home();
      expect(h.agenda.length).toBeLessThanOrEqual(20);
      expect(h.agenda_total).toBeGreaterThanOrEqual(h.agenda.length);
      expect(h.agenda_overflow_tasks).toBeLessThanOrEqual(h.agenda_total - h.agenda.length);
    }, 60_000);

    it('lo que se recorta son los MENOS urgentes: primero ordena, después corta', async () => {
      // Cortar antes de ordenar daría veinte ítems cualesquiera —los primeros que devolvió la base—
      // y dejaría afuera un parto de mañana para mostrar una vacuna del mes que viene. El orden es
      // el que ya tenía la agenda: fecha de vencimiento y, a igual fecha, severidad.
      const h: any = await home.home();
      const fechas = h.agenda.map((a: any) => a.due_at ?? '9999-12-31');
      expect(fechas).toEqual([...fechas].sort());
    }, 60_000);

    it('UNA PIEZA ROTA NO TUMBA LA PANTALLA: se degrada de a una', async () => {
      // Con `Promise.all`, una sola de las nueve fuentes rechazando volvía 500 el endpoint entero, y
      // la web mostraba «La API no está disponible — iniciá el backend con npm run api»: un mensaje
      // para programadores, con el sistema andando y ocho piezas listas.
      const original = health.kpis.bind(health);
      (health as any).kpis = async () => {
        throw new Error('falla simulada del módulo sanidad');
      };
      try {
        const h: any = await home.home();
        expect(h.degraded).toEqual(['sanidad']);
        // El resto SIGUE: el hato, las tareas y la agenda no dependen de sanidad.
        expect(h.kpis.active_animals).toBeGreaterThan(0);
        expect(h.agenda.length).toBeGreaterThan(0);
      } finally {
        (health as any).kpis = original;
      }
    }, 60_000);

    it('lo que no se pudo leer va en NULL, nunca en cero — y el semáforo no dice «al día»', async () => {
      // Es la parte que de verdad importa. Un cero es una AFIRMACIÓN: «no hay vacunas vencidas», «no
      // hay casos abiertos». Afirmarla porque la consulta falló es peor que no mostrar nada, porque
      // el productor cierra la pantalla tranquilo. Lo mismo el estado general en verde.
      const original = health.kpis.bind(health);
      (health as any).kpis = async () => {
        throw new Error('falla simulada del módulo sanidad');
      };
      try {
        const h: any = await home.home();
        for (const kpi of ['vaccines_overdue', 'vaccines_due_45d', 'in_treatment', 'clinical_cases_open'])
          expect(h.kpis[kpi], `${kpi} debería ser null y no un número inventado`).toBeNull();
        expect(h.farm_status.health).toBe('unknown');
        // Y no se cuela en la atención prioritaria: de lo que no cargó no se sabe si hay.
        expect(h.priority.map((p: any) => p.code)).not.toContain('vaccines_overdue');
      } finally {
        (health as any).kpis = original;
      }
    }, 60_000);

    it('EL MOTOR DE ALERTAS CORRE UNA VEZ POR CARGA, no una por consulta', async () => {
      // El encabezado (badge de notificaciones) y el Inicio evaluaban las reglas por separado: dos
      // corridas completas de `computeDesired` —lo caro, O(vientres)— en cada carga del Inicio, y
      // una más en CADA otra pantalla, porque el encabezado vive en el layout. Medido: 40-60 ms por
      // corrida con 65 animales, y crece con el hato.
      const hoy = await db.today();
      const espia = alerts as any;
      const real = espia.computeDesiredFresh.bind(espia);
      let corridas = 0;
      espia.computeDesiredFresh = async () => {
        corridas++;
        return real();
      };
      try {
        // Se arranca desde una ESCRITURA para no medir sobre una caché que dejó tibia otro test: así
        // el primer `home()` es un fallo garantizado y lo que se cuenta es lo que pasa después.
        await db.tx((q) => tasks.createTask(q, { title: 'punto de partida', dueDate: hoy, farmId }, ctx()));

        await home.home();
        await alerts.kpis(); // lo que hace el badge del encabezado, en TODA pantalla
        await home.home();
        expect(corridas, 'tres consultas seguidas tienen que compartir UN cómputo').toBe(1);
      } finally {
        espia.computeDesiredFresh = real;
      }
    }, 60_000);

    it('PERO UNA ESCRITURA LA INVALIDA EN EL ACTO: no se espera al vencimiento', async () => {
      // Es lo que vuelve aceptable a la caché. Sin esto, completar una tarea y recargar mostraría la
      // alerta que el productor acaba de resolver — justo el momento en que mira. La invalidación no
      // es por tiempo: `db.writeGeneration()` sube cuando una transacción escribe, y quien dice si
      // escribió es PostgreSQL (`pg_current_xact_id_if_assigned`), no una heurística por método HTTP
      // — que habría fallado, porque en este sistema varios GET escriben.
      const hoy = await db.today();
      const espia = alerts as any;
      const real = espia.computeDesiredFresh.bind(espia);
      let corridas = 0;
      espia.computeDesiredFresh = async () => {
        corridas++;
        return real();
      };
      try {
        await db.tx((q) => tasks.createTask(q, { title: 'punto de partida 2', dueDate: hoy, farmId }, ctx()));

        await home.home();
        expect(corridas).toBe(1);
        await home.home();
        expect(corridas, 'sin escrituras en el medio, se reusa').toBe(1);

        await db.tx((q) => tasks.createTask(q, { title: 'tarea que invalida', dueDate: hoy, farmId }, ctx()));
        const h: any = await home.home();
        expect(corridas, 'después de escribir TIENE que recalcular').toBe(2);
        expect(h.agenda.some((a: any) => a.title === 'tarea que invalida')).toBe(true);
      } finally {
        espia.computeDesiredFresh = real;
      }
    }, 60_000);

    it('NO reescribe las alertas que no cambiaron', async () => {
      // El motor hacía `UPDATE alerts SET … updated_at = now()` sobre TODA alerta abierta en cada
      // evaluación: 65 escrituras por carga en el demo para dejar las filas como estaban. Y como una
      // transacción que escribe recibe xid, el motor invalidaba con sus PROPIAS salidas la caché que
      // acababa de llenar — la caché no acertaba nunca.
      await alerts.evaluate();
      const r: any = await alerts.evaluate();
      expect(r.updated, 'la segunda evaluación seguida no tiene nada que actualizar').toBe(0);
    }, 60_000);

    it('PIDE SOLO LAS TAREAS QUE MUESTRA, no todas las abiertas', async () => {
      // El Inicio pedía `board({status:'open'})` —hasta 500 filas, con los joins de responsable y de
      // entidad relacionada— y descartaba en memoria todo lo que no fuera vencido o de hoy. Medido
      // en el demo: 37 filas traídas para usar 1, y 17.777 bytes contra 425. Peor que el desperdicio
      // es de qué depende: crecía con las tareas abiertas de la finca, no con el trabajo del día.
      const espia = tasks as any;
      const real = espia.board.bind(espia);
      const pedidos: any[] = [];
      espia.board = async (f: any) => {
        pedidos.push(f);
        return real(f);
      };
      try {
        await home.home();
        expect(pedidos).toHaveLength(1);
        expect(pedidos[0].bucket, 'tiene que acotar por bucket en la consulta, no después').toEqual(['overdue', 'today']);
      } finally {
        espia.board = real;
      }
    }, 60_000);

    it('y las tareas de hoy SIGUEN llegando a la agenda', async () => {
      // La otra mitad: acotar la consulta no puede haberse llevado puesto lo que la pantalla muestra.
      // Sin esto, el ahorro se mediría en bytes y se pagaría en tareas que el productor no ve.
      const hoy = await db.today();
      await db.tx((q) => tasks.createTask(q, { title: 'llega a la agenda', dueDate: hoy, farmId }, ctx()));
      const h: any = await home.home();
      expect(h.agenda.some((a: any) => a.title === 'llega a la agenda' && a.related_type === 'task')).toBe(true);
    }, 60_000);

    it('dice CUÁNDO se armó la foto', async () => {
      // El Inicio se renderiza en el servidor y queda quieto: una pantalla abierta desde la mañana
      // muestra los números de la mañana sin nada que lo diga, y sobre una agenda del día eso engaña
      // —«tareas vencidas 0» a las tres de la tarde puede ser el 0 de las siete.
      //
      // Va el INSTANTE y no un texto ya armado: cuánto hace que fue solo lo puede seguir contando el
      // cliente, que es el que tiene la pantalla abierta. Un «hace un momento» calculado acá quedaría
      // congelado para siempre, que es la misma mentira con mejor letra.
      const antes = Date.now();
      const h: any = await home.home();
      const t = Date.parse(h.generated_at);
      expect(Number.isFinite(t)).toBe(true);
      expect(t).toBeGreaterThanOrEqual(antes - 1000);
      expect(t).toBeLessThanOrEqual(Date.now() + 1000);
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
