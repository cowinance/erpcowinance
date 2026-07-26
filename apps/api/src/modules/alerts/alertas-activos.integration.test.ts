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
 * Fase 1.3 — activos y cumplimiento: mantenimiento programado y certificaciones por vencer.
 *
 * Las dos son «algo que vence» y las dos se avisan ANTES, porque tienen plazo de gestión: conseguir
 * el taller, renovar el certificado. Llegar tarde cuesta la cosecha o la venta.
 */
describe('alertas de activos y cumplimiento', () => {
  let db: DbService;
  let svc: AlertsService;
  let originalCwd: string;
  let tmp: string;
  let farmId: string;

  const abiertas = async (code: string, relatedId?: string) => {
    const extra = relatedId ? ` AND a.related_id='${relatedId}'` : '';
    return (
      await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM alerts a JOIN alert_rules r ON r.id=a.rule_id
          WHERE a.tenant_id=$1 AND r.condition->>'code'=$2 AND a.status='open' AND a.deleted_at IS NULL${extra}`,
        [db.tenant, code],
      )
    )[0].n;
  };

  const alerta = async (relatedId: string) =>
    (await db.query<any>(`SELECT severity, title, message FROM alerts WHERE tenant_id=$1 AND related_id=$2 AND status='open'`, [db.tenant, relatedId]))[0];

  const nuevaMaquina = async (name: string) =>
    (
      await db.query<{ id: string }>(
        `INSERT INTO machinery (tenant_id, farm_id, name, type) VALUES ($1,$2,$3,'tractor') RETURNING id`,
        [db.tenant, farmId, name],
      )
    )[0].id;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'alertas-act-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    svc = new AlertsService(db, { statusAlerts: async () => [] } as any, new WeatherService(db), new NitrogenService(db, new InventoryService(db)));
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [db.tenant]))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  describe('mantenimiento programado', () => {
    let maq: string;

    beforeAll(async () => {
      maq = await nuevaMaquina('Tractor John Deere');
      await db.query(
        `INSERT INTO maintenance_records (tenant_id, machinery_id, type, performed_at, next_due_date)
         VALUES ($1,$2,'preventive', now() - interval '80 days', CURRENT_DATE + 5)`,
        [db.tenant, maq],
      );
    });

    it('avisa antes de la fecha, con cuántos días faltan', async () => {
      await svc.evaluate();
      expect(await abiertas('maintenance_due', maq)).toBe(1);
      const a = await alerta(maq);
      expect(a.title).toContain('en 5 días');
      expect(a.severity).toBe('warning');
    });

    it('vencido es CRÍTICO: la máquina trabaja sin el service hecho', async () => {
      await db.query(`UPDATE maintenance_records SET next_due_date = CURRENT_DATE - 12 WHERE machinery_id=$1`, [maq]);
      await svc.evaluate();
      const a = await alerta(maq);
      expect(a.severity).toBe('critical');
      expect(a.title).toContain('vencido hace 12 días');
    });

    it('hacer el mantenimiento la APAGA SOLA — solo cuenta el último registro', async () => {
      await db.query(
        `INSERT INTO maintenance_records (tenant_id, machinery_id, type, performed_at, next_due_date)
         VALUES ($1,$2,'preventive', now(), CURRENT_DATE + 180)`,
        [db.tenant, maq],
      );
      await svc.evaluate();
      expect(await abiertas('maintenance_due', maq)).toBe(0);
    });

    it('no repite el aviso una vez por cada service histórico', async () => {
      // La máquina de arriba ya tiene dos registros; mirar todos daría dos alertas para una máquina.
      const otra = await nuevaMaquina('Cosechadora');
      for (const d of [200, 120, 40]) {
        await db.query(
          `INSERT INTO maintenance_records (tenant_id, machinery_id, type, performed_at, next_due_date)
           VALUES ($1,$2,'preventive', now() - ($3::int * interval '1 day'), CURRENT_DATE + 2)`,
          [db.tenant, otra, d],
        );
      }
      await svc.evaluate();
      expect(await abiertas('maintenance_due', otra)).toBe(1);
    });

    it('una máquina sin próxima fecha no alerta', async () => {
      const sinFecha = await nuevaMaquina('Rastra');
      await db.query(
        `INSERT INTO maintenance_records (tenant_id, machinery_id, type, performed_at) VALUES ($1,$2,'corrective', now())`,
        [db.tenant, sinFecha],
      );
      await svc.evaluate();
      expect(await abiertas('maintenance_due', sinFecha)).toBe(0);
    });
  });

  describe('certificación por vencer', () => {
    let cert: string;

    beforeAll(async () => {
      cert = (
        await db.query<{ id: string }>(
          `INSERT INTO certifications (tenant_id, entity_type, entity_id, scheme, issuer, valid_from, valid_until, status)
           VALUES ($1,'farm',$2,'Libre de Brucelosis','SENASA', CURRENT_DATE - 300, CURRENT_DATE + 20,'active') RETURNING id`,
          [db.tenant, farmId],
        )
      )[0].id;
    });

    it('avisa antes de que venza, para dar tiempo a renovar', async () => {
      await svc.evaluate();
      expect(await abiertas('certification_expiring', cert)).toBe(1);
      const a = await alerta(cert);
      expect(a.title).toContain('vence en 20 días');
      expect(a.message).toContain('SENASA');
    });

    it('vencida es CRÍTICA: ya bloquea la comercialización', async () => {
      await db.query(`UPDATE certifications SET valid_until = CURRENT_DATE - 3 WHERE id=$1`, [cert]);
      await svc.evaluate();
      const a = await alerta(cert);
      expect(a.severity).toBe('critical');
      expect(a.title).toContain('VENCIDA');
    });

    it('renovarla la APAGA SOLA', async () => {
      await db.query(`UPDATE certifications SET valid_until = CURRENT_DATE + 365 WHERE id=$1`, [cert]);
      await svc.evaluate();
      expect(await abiertas('certification_expiring', cert)).toBe(0);
    });

    it('las suspendidas y revocadas NO entran como «por vencer»', async () => {
      // No vencen: ya están fuera de juego por otra razón, y avisarlas acá confundiría el motivo.
      for (const st of ['suspended', 'revoked']) {
        const c = (
          await db.query<{ id: string }>(
            `INSERT INTO certifications (tenant_id, entity_type, entity_id, scheme, valid_until, status)
             VALUES ($1,'farm',$2,$3, CURRENT_DATE + 5, $4) RETURNING id`,
            [db.tenant, farmId, `Esquema ${st}`, st],
          )
        )[0].id;
        await svc.evaluate();
        expect(await abiertas('certification_expiring', c)).toBe(0);
      }
    });

    it('una certificación sin fecha de vencimiento no alerta', async () => {
      const perpetua = (
        await db.query<{ id: string }>(
          `INSERT INTO certifications (tenant_id, entity_type, entity_id, scheme, status) VALUES ($1,'farm',$2,'Sin vencimiento','active') RETURNING id`,
          [db.tenant, farmId],
        )
      )[0].id;
      await svc.evaluate();
      expect(await abiertas('certification_expiring', perpetua)).toBe(0);
    });
  });
});
