import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { WeatherService } from '../weather/weather.service';
import { AlertsService } from './alerts.service';
import { NitrogenService } from '../genetics/nitrogen.service';
import { InventoryService } from '../inventory/inventory.service';

/**
 * Fase 1.4 — agrupación de lo que es UN SOLO TRABAJO.
 *
 * El dato que originó esto, medido sobre el tenant demo: de 43 alertas abiertas, 24 eran
 * `health/info` y veinte de ellas eran dos tareas repetidas diez veces cada una. El operario va a
 * la manga UNA vez y desparasita a los diez terneros en la misma sesión.
 *
 * Lo que se fija acá tiene dos caras y la segunda importa más que la primera:
 *   1. La LISTA colapsa: una línea con el conteo.
 *   2. La AGENDA no se toca: sigue habiendo un ítem por animal, porque ahí se marca de a uno.
 * Agrupar en el motor en vez de en la lectura habría roto lo segundo sin que nadie lo notara.
 */
describe('alertas agrupadas — una línea por trabajo, sin perder el detalle', () => {
  let db: DbService;
  let svc: AlertsService;
  let originalCwd: string;
  let tmp: string;
  let farmId: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'alertas-grp-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    svc = new AlertsService(db, { statusAlerts: async () => [] } as any, new WeatherService(db), new NitrogenService(db, new InventoryService(db)));
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [db.tenant]))[0].id;

    // Seis tareas sanitarias iguales, misma fecha: un solo trabajo repartido en seis animales.
    for (let i = 0; i < 6; i++)
      await db.query(
        `INSERT INTO tasks (tenant_id, farm_id, title, type, status, due_date)
         VALUES ($1,$2,'Desparasitación de otoño','health','pending', CURRENT_DATE + 3)`,
        [db.tenant, farmId],
      );
    // Y una distinta, para comprobar que no se mezcla con las anteriores.
    await db.query(
      `INSERT INTO tasks (tenant_id, farm_id, title, type, status, due_date)
       VALUES ($1,$2,'Revisión de cascos','health','pending', CURRENT_DATE + 3)`,
      [db.tenant, farmId],
    );
    await svc.evaluate();
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('las seis iguales se muestran como UNA línea con el conteo', async () => {
    const lista: any[] = await svc.list();
    const grupo = lista.filter((a) => String(a.title).startsWith('Desparasitación de otoño'));
    expect(grupo).toHaveLength(1);
    expect(grupo[0].count).toBe(6);
    expect(grupo[0].title).toBe('Desparasitación de otoño · 6 animales');
  });

  it('el detalle NO se pierde: quedan las seis para desplegar', async () => {
    const lista: any[] = await svc.list();
    const grupo = lista.find((a) => String(a.title).startsWith('Desparasitación de otoño'));
    expect(grupo.items).toHaveLength(6);
    // Cada una conserva su propia entidad: se puede ir al animal concreto.
    expect(new Set(grupo.items.map((i: any) => i.related_id)).size).toBe(6);
  });

  it('una tarea distinta del mismo día NO se mezcla', async () => {
    const lista: any[] = await svc.list();
    const otra = lista.filter((a) => String(a.title).startsWith('Revisión de cascos'));
    expect(otra).toHaveLength(1);
    expect(otra[0].count).toBe(1);
    // Con una sola no se le agrega el conteo al título: «· 1 animales» sería absurdo.
    expect(otra[0].title).toBe('Revisión de cascos');
  });

  it('lo que es único por entidad NO se agrupa', async () => {
    // Una factura, un termo o una máquina no son «varios animales»: `group_key` va en NULL y cada
    // una es su propia línea.
    const lista: any[] = await svc.list();
    const sueltas = lista.filter((a) => a.group_key === null);
    expect(sueltas.length).toBeGreaterThan(0);
    for (const s of sueltas) expect(s.count).toBe(1);
  });

  it('LA AGENDA SIGUE POR ANIMAL: agrupar es de lectura, no del motor', async () => {
    // Es la mitad que importa. En la agenda se marca de a uno; si el agrupado hubiera vivido en
    // `computeDesired`, acá quedarían 1 ítem en vez de 6 y nadie lo habría notado hasta usar la app.
    const { agenda } = await svc.agendaAndKpis();
    const items = agenda.filter((i: any) => i.title === 'Desparasitación de otoño');
    expect(items).toHaveLength(6);
  });

  it('en la base siguen existiendo las seis, cada una con su entidad', async () => {
    const [{ n }] = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM alerts WHERE tenant_id=$1 AND title='Desparasitación de otoño' AND status='open'`,
      [db.tenant],
    );
    expect(n).toBe(6);
  });

  it('una alerta que YA ESTABA abierta sin clave se agrupa en la próxima evaluación', async () => {
    // El bug que esto fija: si `group_key` solo se fijara al INSERTAR, las alertas vivas al momento
    // de desplegar se quedarían sin agrupar para siempre —hasta que la condición desapareciera y
    // volviera a dispararse—. Se vería como que el agrupado «no funciona», y justo en la
    // instalación con más alertas acumuladas. Se detectó corriendo la app, no en los tests.
    await db.query(
      `UPDATE alerts SET group_key = NULL WHERE tenant_id=$1 AND title='Desparasitación de otoño'`,
      [db.tenant],
    );
    let lista: any[] = await svc.list();
    expect(lista.filter((a) => a.title === 'Desparasitación de otoño')).toHaveLength(6); // sin agrupar

    await svc.evaluate();
    lista = await svc.list();
    const grupo = lista.filter((a) => String(a.title).startsWith('Desparasitación de otoño'));
    expect(grupo).toHaveLength(1);
    expect(grupo[0].count).toBe(6);
  });

  it('completar una de las seis baja el conteo a cinco', async () => {
    const [t1] = await db.query<any>(
      `SELECT id FROM tasks WHERE tenant_id=$1 AND title='Desparasitación de otoño' AND status='pending' LIMIT 1`,
      [db.tenant],
    );
    await db.query(`UPDATE tasks SET status='done' WHERE id=$1`, [t1.id]);
    await svc.evaluate();
    const lista: any[] = await svc.list();
    const grupo = lista.find((a) => String(a.title).startsWith('Desparasitación de otoño'));
    expect(grupo.count).toBe(5);
  });
});
