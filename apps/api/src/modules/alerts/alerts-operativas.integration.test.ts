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
 * Fase 1.1 — las tres fuentes que el motor ignoraba: stock, cobranzas y comprobantes.
 *
 * Lo que se fija acá NO es que la alerta aparezca: es que **aparezca y se APAGUE SOLA**. El motor es
 * un reconciliador —calcula qué debería existir y resuelve la diferencia—, así que una alerta que
 * se crea y no se limpia cuando el problema desaparece es peor que no tenerla: entrena al usuario a
 * ignorar la lista. Por eso cada caso se prueba en los dos sentidos.
 */
describe('alertas operativas — stock, cobranzas y comprobantes', () => {
  let db: DbService;
  let svc: AlertsService;
  let originalCwd: string;
  let tmp: string;
  let companyId: string;
  let farmId: string;

  /** Alertas abiertas de un código, por entidad. */
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

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'alertas-op-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    svc = new AlertsService(db, { statusAlerts: async () => [] } as any, new WeatherService(db), new NitrogenService(db, new InventoryService(db)));
    companyId = (await db.query<{ id: string }>(`SELECT id FROM companies WHERE tenant_id=$1 LIMIT 1`, [db.tenant]))[0].id;
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [db.tenant]))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  describe('insumo bajo el punto de reposición', () => {
    let itemId: string;

    beforeAll(async () => {
      itemId = (
        await db.query<{ id: string }>(
          `INSERT INTO inventory_items (tenant_id, name, unit, reorder_point) VALUES ($1,'Ivermectina 1%','l',10) RETURNING id`,
          [db.tenant],
        )
      )[0].id;
    });

    it('sin stock cargado avisa: cero está bajo cualquier mínimo', async () => {
      await svc.evaluate();
      expect(await abiertas('stock_below_reorder', itemId)).toBe(1);
    });

    it('sin stock la severidad es CRÍTICA: ya frenó el trabajo, no está por frenarlo', async () => {
      const [a] = await db.query<any>(
        `SELECT severity FROM alerts WHERE tenant_id=$1 AND related_id=$2 AND status='open'`,
        [db.tenant, itemId],
      );
      expect(a.severity).toBe('critical');
    });

    it('reponer por encima del mínimo la APAGA SOLA', async () => {
      const wh = (
        await db.query<{ id: string }>(`INSERT INTO warehouses (tenant_id, farm_id, name) VALUES ($1,$2,'Depósito') RETURNING id`, [db.tenant, farmId])
      )[0].id;
      await db.query(`INSERT INTO stock_levels (tenant_id, item_id, warehouse_id, quantity) VALUES ($1,$2,$3,25)`, [db.tenant, itemId, wh]);
      await svc.evaluate();
      expect(await abiertas('stock_below_reorder', itemId)).toBe(0);
    });

    it('sin mínimo cargado Y SIN consumo no alerta: no hay ritmo que proyectar', async () => {
      // Un artículo que nadie usa no está por acabarse. Avisar por el catálogo entero sería ruido.
      const sinMin = (
        await db.query<{ id: string }>(`INSERT INTO inventory_items (tenant_id, name, unit) VALUES ($1,'Sin mínimo','un') RETURNING id`, [db.tenant])
      )[0].id;
      await svc.evaluate();
      expect(await abiertas('stock_below_reorder', sinMin)).toBe(0);
    });

    /**
     * El falso negativo caro: durante mucho tiempo la regla miraba SOLO `reorder_point`, así que el
     * artículo al que nadie le cargó mínimo NUNCA avisaba — justo el caso normal en una finca que
     * recién empieza a usar el sistema. Ahora, si hay consumo, el mínimo se DERIVA.
     */
    describe('sin mínimo cargado, el consumo real lo deriva', () => {
      /** Artículo con saldo y consumo en la ventana, sin `reorder_point`. */
      const conConsumo = async (nombre: string, saldo: number, consumoDiario: number) => {
        const id = (
          await db.query<{ id: string }>(`INSERT INTO inventory_items (tenant_id, name, unit) VALUES ($1,$2,'l') RETURNING id`, [db.tenant, nombre])
        )[0].id;
        const wh = (await db.query<{ id: string }>(`INSERT INTO warehouses (tenant_id, farm_id, name) VALUES ($1,$2,$3) RETURNING id`, [db.tenant, farmId, `Dep ${nombre}`]))[0].id;
        await db.query(`INSERT INTO stock_levels (tenant_id, item_id, warehouse_id, quantity) VALUES ($1,$2,$3,$4)`, [db.tenant, id, wh, saldo]);
        // 90 días de consumo dentro de la ventana de 180.
        await db.query(
          `INSERT INTO stock_movements (tenant_id, item_id, warehouse_id, movement_type, quantity, occurred_at)
           VALUES ($1,$2,$3,'consumption',$4, now() - interval '45 days')`,
          [db.tenant, id, wh, -(consumoDiario * 90)],
        );
        return id;
      };

      it('AVISA CUANDO EL SALDO NO LLEGA A CUBRIR LA REPOSICIÓN', async () => {
        // 5 litros con 0,5/día = 10 días de cobertura, contra 30 de reposición: se termina antes de
        // que llegue lo que se pida hoy. Antes, este artículo estaba mudo.
        const item = await conConsumo('Antiparasitario justo', 5, 0.5);
        await svc.evaluate();
        expect(await abiertas('stock_below_reorder', item)).toBe(1);
      });

      it('el aviso EXPLICA que el mínimo salió del consumo, no de una configuración', async () => {
        // Un aviso sobre algo que el productor nunca configuró se lee como error del sistema si no
        // dice de dónde salió el número.
        const item = await conConsumo('Explicación', 5, 0.5);
        await svc.evaluate();
        const [a] = await db.query<{ message: string }>(
          `SELECT a.message FROM alerts a JOIN alert_rules r ON r.id=a.rule_id
            WHERE a.tenant_id=$1 AND r.condition->>'code'='stock_below_reorder' AND a.related_id=$2 AND a.status='open'`,
          [db.tenant, item],
        );
        expect(a.message).toMatch(/al ritmo de uso/i);
      });

      it('con saldo de sobra no avisa: la cobertura supera la reposición', async () => {
        // 100 litros con 0,5/día = 200 días. Avisar acá entrenaría a ignorar la lista.
        const item = await conConsumo('De sobra', 100, 0.5);
        await svc.evaluate();
        expect(await abiertas('stock_below_reorder', item)).toBe(0);
      });

      it('EL MÍNIMO CARGADO MANDA sobre el derivado', async () => {
        // Es una decisión explícita del productor y el sistema no la pisa en silencio. Con 200
        // litros el derivado no avisaría; el mínimo de 500 sí.
        const item = await conConsumo('Con mínimo propio', 200, 0.5);
        await db.query(`UPDATE inventory_items SET reorder_point=500 WHERE id=$1`, [item]);
        await svc.evaluate();
        expect(await abiertas('stock_below_reorder', item)).toBe(1);
        const [a] = await db.query<{ message: string }>(
          `SELECT a.message FROM alerts a JOIN alert_rules r ON r.id=a.rule_id
            WHERE a.tenant_id=$1 AND r.condition->>'code'='stock_below_reorder' AND a.related_id=$2 AND a.status='open'`,
          [db.tenant, item],
        );
        expect(a.message).toMatch(/el mínimo es 500/i);
      });

      it('se apaga sola cuando se repone: sigue siendo un reconciliador', async () => {
        const item = await conConsumo('Se repone', 5, 0.5);
        await svc.evaluate();
        expect(await abiertas('stock_below_reorder', item)).toBe(1);
        await db.query(`UPDATE stock_levels SET quantity=400 WHERE item_id=$1`, [item]);
        await svc.evaluate();
        expect(await abiertas('stock_below_reorder', item)).toBe(0);
      });
    });

    it('el stock repartido en dos depósitos NO es faltante', async () => {
      const item = (
        await db.query<{ id: string }>(
          `INSERT INTO inventory_items (tenant_id, name, unit, reorder_point) VALUES ($1,'Repartido','un',10) RETURNING id`,
          [db.tenant],
        )
      )[0].id;
      const w1 = (await db.query<{ id: string }>(`INSERT INTO warehouses (tenant_id, farm_id, name) VALUES ($1,$2,'Galpón A') RETURNING id`, [db.tenant, farmId]))[0].id;
      const w2 = (await db.query<{ id: string }>(`INSERT INTO warehouses (tenant_id, farm_id, name) VALUES ($1,$2,'Galpón B') RETURNING id`, [db.tenant, farmId]))[0].id;
      // 6 + 6 = 12, por encima del mínimo de 10. Alertar por depósito daría dos avisos falsos.
      await db.query(`INSERT INTO stock_levels (tenant_id, item_id, warehouse_id, quantity) VALUES ($1,$2,$3,6),($1,$2,$4,6)`, [db.tenant, item, w1, w2]);
      await svc.evaluate();
      expect(await abiertas('stock_below_reorder', item)).toBe(0);
    });
  });

  describe('factura vencida sin cobrar', () => {
    let invId: string;
    let partnerId: string;

    beforeAll(async () => {
      partnerId = (
        await db.query<{ id: string }>(
          `INSERT INTO business_partners (tenant_id, company_id, type, name) VALUES ($1,$2,'customer','Frigorífico Norte') RETURNING id`,
          [db.tenant, companyId],
        )
      )[0].id;
      invId = (
        await db.query<{ id: string }>(
          `INSERT INTO invoices (tenant_id, company_id, direction, partner_id, invoice_number, issue_date, due_date, currency, total, status)
           VALUES ($1,$2,'issued',$3,'A-0001', CURRENT_DATE - 40, CURRENT_DATE - 10,'USD',1000,'issued') RETURNING id`,
          [db.tenant, companyId, partnerId],
        )
      )[0].id;
    });

    it('avisa con el atraso y el saldo', async () => {
      await svc.evaluate();
      expect(await abiertas('invoice_overdue', invId)).toBe(1);
      const [a] = await db.query<any>(`SELECT title FROM alerts WHERE tenant_id=$1 AND related_id=$2 AND status='open'`, [db.tenant, invId]);
      expect(a.title).toContain('vencida hace 10 días');
    });

    it('cobrarla la APAGA SOLA — el saldo es derivado, no una columna', async () => {
      const pay = (
        await db.query<{ id: string }>(
          `INSERT INTO payments (tenant_id, company_id, direction, partner_id, payment_date, currency, amount)
           VALUES ($1,$2,'inbound',$3, CURRENT_DATE,'USD',1000) RETURNING id`,
          [db.tenant, companyId, partnerId],
        )
      )[0].id;
      await db.query(`INSERT INTO payment_allocations (tenant_id, payment_id, invoice_id, amount) VALUES ($1,$2,$3,1000)`, [db.tenant, pay, invId]);
      await svc.evaluate();
      expect(await abiertas('invoice_overdue', invId)).toBe(0);
    });

    it('una factura RECIBIDA vencida no entra por acá', async () => {
      // Es deuda propia: merece otra alerta, con otro texto y otra urgencia. Mezclarlas haría que
      // «facturas vencidas» signifique dos cosas opuestas.
      const recibida = (
        await db.query<{ id: string }>(
          `INSERT INTO invoices (tenant_id, company_id, direction, partner_id, invoice_number, issue_date, due_date, currency, total, status)
           VALUES ($1,$2,'received',$3,'P-0001', CURRENT_DATE - 40, CURRENT_DATE - 15,'USD',500,'issued') RETURNING id`,
          [db.tenant, companyId, partnerId],
        )
      )[0].id;
      await svc.evaluate();
      expect(await abiertas('invoice_overdue', recibida)).toBe(0);
    });
  });

  describe('lote de comprobantes por agotarse', () => {
    let serieId: string;

    beforeAll(async () => {
      // Lote chico y casi consumido: quedan 3 de 100.
      serieId = (
        await db.query<{ id: string }>(
          `INSERT INTO fiscal_series (tenant_id, company_id, purpose, prefix, padding, next_number, range_from, range_to)
           VALUES ($1,$2,'control','00',8,98,1,100) RETURNING id`,
          [db.tenant, companyId],
        )
      )[0].id;
    });

    it('avisa cuántos quedan antes de que se acaben', async () => {
      await svc.evaluate();
      expect(await abiertas('fiscal_series_low', serieId)).toBe(1);
      const [a] = await db.query<any>(`SELECT title, severity FROM alerts WHERE tenant_id=$1 AND related_id=$2 AND status='open'`, [db.tenant, serieId]);
      expect(a.title).toContain('Quedan 3');
      expect(a.severity).toBe('warning');
    });

    it('agotado es CRÍTICO: no se puede facturar', async () => {
      await db.query(`UPDATE fiscal_series SET next_number=101 WHERE id=$1`, [serieId]);
      await svc.evaluate();
      const [a] = await db.query<any>(`SELECT title, severity FROM alerts WHERE tenant_id=$1 AND related_id=$2 AND status='open'`, [db.tenant, serieId]);
      expect(a.severity).toBe('critical');
      expect(a.title).toContain('no se puede facturar');
    });

    it('cargar el lote nuevo la APAGA SOLA', async () => {
      await db.query(`UPDATE fiscal_series SET range_to=5000 WHERE id=$1`, [serieId]);
      await svc.evaluate();
      expect(await abiertas('fiscal_series_low', serieId)).toBe(0);
    });

    it('una serie SIN tope no se agota nunca', async () => {
      // Es el correlativo propio del emisor: `remaining` es null, que NO es cero.
      const sinTope = (
        await db.query<{ id: string }>(
          `INSERT INTO fiscal_series (tenant_id, company_id, purpose, document_type, padding, next_number)
           VALUES ($1,$2,'document','invoice',8,999999) RETURNING id`,
          [db.tenant, companyId],
        )
      )[0].id;
      await svc.evaluate();
      expect(await abiertas('fiscal_series_low', sinTope)).toBe(0);
    });
  });

  describe('las reglas nuevas se pueden apagar como las viejas', () => {
    it('apagar la regla resuelve sus alertas', async () => {
      await svc.evaluate();
      const antes = await abiertas('stock_below_reorder');
      expect(antes).toBeGreaterThanOrEqual(0);
      await db.query(`UPDATE alert_rules SET is_active=false WHERE tenant_id=$1 AND condition->>'code'='stock_below_reorder'`, [db.tenant]);
      await svc.evaluate();
      expect(await abiertas('stock_below_reorder')).toBe(0);
      await db.query(`UPDATE alert_rules SET is_active=true WHERE tenant_id=$1 AND condition->>'code'='stock_below_reorder'`, [db.tenant]);
    });
  });
});
