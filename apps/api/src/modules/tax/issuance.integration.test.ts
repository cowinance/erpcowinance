import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { NumberingService } from './numbering.service';
import { VatService } from './vat.service';
import { IssuanceService } from './issuance.service';
import { BooksService } from './books.service';

/**
 * Emisión de comprobantes (G4-4) y libro de ventas (G4-5) sobre la base real. Es donde convergen
 * las tres etapas anteriores, así que lo que se prueba acá es que converjan de verdad: que el
 * comprobante salga con identidad, dos números y desglose, y que un fallo no deje nada a medias.
 */
describe('tax — comprobantes y libro de ventas', () => {
  let db: DbService;
  let numbering: NumberingService;
  let vat: VatService;
  let svc: IssuanceService;
  let books: BooksService;
  let originalCwd: string;
  let tmp: string;
  let companyId: string;
  let clienteId: string;

  /** Crea una venta confirmada con sus líneas y devuelve su id. */
  const nuevaVenta = async (lineas: { total: number; treatment?: string }[], fecha = '2026-07-10') => {
    const s = await db.one<{ id: string }>(
      `INSERT INTO sales (tenant_id, company_id, customer_partner_id, sale_date, type, currency, subtotal, tax_total, total)
       VALUES ($1,$2,$3,$4::date,'livestock','USD',0,0,0) RETURNING id`,
      [db.tenant, companyId, clienteId, fecha],
    );
    for (const l of lineas)
      await db.query(
        `INSERT INTO sale_lines (tenant_id, sale_id, description, quantity, unit_price, line_total, vat_treatment)
         VALUES ($1,$2,'Novillos',1,$3,$3,$4)`,
        [db.tenant, s!.id, l.total, l.treatment ?? null],
      );
    return s!.id;
  };

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'issuance-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    numbering = new NumberingService(db);
    vat = new VatService(db);
    svc = new IssuanceService(db, numbering, vat);
    books = new BooksService(db);

    const c = await db.one<{ id: string }>(`SELECT id FROM companies WHERE tenant_id=$1 ORDER BY created_at LIMIT 1`, [db.tenant]);
    companyId = c!.id;
    // Emisor con RIF: sin él no se puede emitir nada.
    await db.query(`UPDATE companies SET tax_id='J-00123072-6', taxpayer_condition='ordinario' WHERE id=$1`, [companyId]);
    const p = await db.one<{ id: string }>(
      `INSERT INTO business_partners (tenant_id, company_id, type, name, legal_name, tax_id, taxpayer_condition)
       VALUES ($1,$2,'customer','Matadero del Llano','MATADERO DEL LLANO, C.A.','J-30123456-1','especial') RETURNING id`,
      [db.tenant, companyId],
    );
    clienteId = p!.id;

    await vat.setRates({ rates: { general: 0.16, reduced: 0.08 } });
    await numbering.create({ purpose: 'document', document_type: 'invoice' });
    await numbering.create({ purpose: 'document', document_type: 'credit_note' });
    await numbering.create({ purpose: 'control', prefix: '00', range_from: 1, range_to: 5000 });
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  describe('emisión', () => {
    it('el comprobante sale con los dos números y el IVA desglosado', async () => {
      const venta = await nuevaVenta([{ total: 1000, treatment: 'general' }, { total: 500, treatment: 'exempt' }]);
      const doc: any = await svc.issueFromSale({ sale_id: venta });

      expect(doc.invoice_number).toBe('00000001');
      expect(doc.control_number).toBe('00-00000001');
      expect(doc.document_type).toBe('invoice');
      expect(doc.standing).toBe('issued');
      expect(doc.total).toBe(1660); // 1000 + 500 exento + 160 de IVA
      expect(doc.fiscal_snapshot.breakdown.taxable_base).toBe(1000);
      expect(doc.fiscal_snapshot.breakdown.exempt_base).toBe(500);
      expect(doc.fiscal_snapshot.breakdown.vat_total).toBe(160);
    });

    it('congela los datos fiscales de las DOS puntas', async () => {
      // Si el cliente corrige su RIF mañana, el comprobante ya impreso no puede reescribirse.
      const doc: any = await svc.get((await svc.list())[0].id);
      expect(doc.fiscal_snapshot.issuer.tax_id).toBe('J-00123072-6');
      expect(doc.fiscal_snapshot.customer.tax_id).toBe('J-30123456-1');
      expect(doc.fiscal_snapshot.customer.name).toBe('MATADERO DEL LLANO, C.A.'); // la razón social, no el nombre de uso
      expect(doc.fiscal_snapshot.customer.taxpayer_condition).toBe('especial');
    });

    it('el desglose queda congelado: cambiar la alícuota NO reescribe lo emitido', async () => {
      // Un comprobante emitido es un hecho, no una consulta.
      const antes: any = await svc.get((await svc.list())[0].id);
      await vat.setRates({ rates: { general: 0.2, reduced: 0.08 } });
      const despues: any = await svc.get(antes.id);
      expect(despues.fiscal_snapshot.breakdown.vat_total).toBe(antes.fiscal_snapshot.breakdown.vat_total);
      expect(despues.total).toBe(antes.total);
      await vat.setRates({ rates: { general: 0.16, reduced: 0.08 } }); // se restaura para el resto
    });

    it('la línea sin tratamiento declarado se grava, no se exime', async () => {
      // Equivocarse hacia gravado se corrige con una nota; hacia exento es IVA no cobrado que igual
      // hay que enterar.
      const venta = await nuevaVenta([{ total: 100 }]);
      const doc: any = await svc.issueFromSale({ sale_id: venta });
      expect(doc.fiscal_snapshot.breakdown.taxable_base).toBe(100);
      expect(doc.fiscal_snapshot.breakdown.vat_total).toBe(16);
    });

    it('los correlativos avanzan de a uno', async () => {
      const venta = await nuevaVenta([{ total: 200, treatment: 'general' }]);
      const doc: any = await svc.issueFromSale({ sale_id: venta });
      expect(doc.invoice_number).toBe('00000003');
      expect(doc.control_number).toBe('00-00000003');
    });
  });

  describe('lo que impide emitir', () => {
    it('sin RIF del cliente no hay comprobante', async () => {
      const sinRif = await db.one<{ id: string }>(
        `INSERT INTO business_partners (tenant_id, company_id, type, name) VALUES ($1,$2,'customer','Sin RIF') RETURNING id`,
        [db.tenant, companyId],
      );
      const s = await db.one<{ id: string }>(
        `INSERT INTO sales (tenant_id, company_id, customer_partner_id, sale_date, type, currency, subtotal, tax_total, total)
         VALUES ($1,$2,$3,'2026-07-10'::date,'livestock','USD',0,0,0) RETURNING id`,
        [db.tenant, companyId, sinRif!.id],
      );
      await db.query(
        `INSERT INTO sale_lines (tenant_id, sale_id, description, quantity, unit_price, line_total) VALUES ($1,$2,'x',1,100,100)`,
        [db.tenant, s!.id],
      );
      await expect(svc.issueFromSale({ sale_id: s!.id })).rejects.toMatchObject({
        status: 400,
        response: { code: 'tax.missing_customer_tax_id' },
      });
    });

    it('una venta sin líneas no se factura', async () => {
      const venta = await nuevaVenta([]);
      await expect(svc.issueFromSale({ sale_id: venta })).rejects.toMatchObject({ response: { code: 'tax.no_lines' } });
    });

    it('un comprobante rechazado NO consume número', async () => {
      // Es la propiedad que justifica validar ANTES de tocar la numeración.
      const antes: any = (await numbering.list()).find((s: any) => s.document_type === 'invoice');
      const venta = await nuevaVenta([]);
      await expect(svc.issueFromSale({ sale_id: venta })).rejects.toThrow();
      const despues: any = (await numbering.list()).find((s: any) => s.document_type === 'invoice');
      expect(despues.next_number).toBe(antes.next_number);
    });
  });

  describe('notas de crédito', () => {
    it('tienen que decir qué comprobante modifican', async () => {
      const venta = await nuevaVenta([{ total: 100, treatment: 'general' }]);
      await expect(svc.issueFromSale({ sale_id: venta, document_type: 'credit_note' })).rejects.toMatchObject({
        response: { code: 'tax.note_needs_reference' },
      });
    });

    it('se emiten contra una factura, con su propio correlativo', async () => {
      const original: any = (await svc.list()).find((d: any) => d.document_type === 'invoice');
      const venta = await nuevaVenta([{ total: 100, treatment: 'general' }]);
      const nc: any = await svc.issueFromSale({ sale_id: venta, document_type: 'credit_note', references_invoice_id: original.id });
      expect(nc.document_type).toBe('credit_note');
      expect(nc.invoice_number).toBe('00000001'); // correlativo propio: no hereda el de la factura
      expect(nc.references_invoice_id).toBe(original.id);
    });

    it('una nota no puede modificar otra nota', async () => {
      const nc: any = (await svc.list()).find((d: any) => d.document_type === 'credit_note');
      const venta = await nuevaVenta([{ total: 50, treatment: 'general' }]);
      await expect(
        svc.issueFromSale({ sale_id: venta, document_type: 'credit_note', references_invoice_id: nc.id }),
      ).rejects.toMatchObject({ response: { code: 'tax.reference_must_be_invoice' } });
    });

    it('una factura no referencia nada', async () => {
      const original: any = (await svc.list()).find((d: any) => d.document_type === 'invoice');
      const venta = await nuevaVenta([{ total: 50, treatment: 'general' }]);
      await expect(
        svc.issueFromSale({ sale_id: venta, document_type: 'invoice', references_invoice_id: original.id }),
      ).rejects.toMatchObject({ response: { code: 'tax.reference_not_allowed' } });
    });
  });

  describe('anulación', () => {
    it('exige un motivo: queda en el libro', async () => {
      const doc: any = (await svc.list()).find((d: any) => d.document_type === 'invoice');
      await expect(svc.voidDocument(doc.id, {})).rejects.toMatchObject({ response: { code: 'tax.void_needs_reason' } });
    });

    it('anula una sola vez y NO libera el número', async () => {
      const doc: any = (await svc.list()).find((d: any) => d.document_type === 'invoice' && !d.voided_at);
      const serieAntes: any = (await numbering.list()).find((s: any) => s.document_type === 'invoice');

      const anulado: any = await svc.voidDocument(doc.id, { reason: 'error en el peso facturado' });
      expect(anulado.standing).toBe('voided');
      expect(anulado.invoice_number).toBe(doc.invoice_number); // conserva su número

      const serieDespues: any = (await numbering.list()).find((s: any) => s.document_type === 'invoice');
      expect(serieDespues.next_number).toBe(serieAntes.next_number); // el número no vuelve al pozo

      await expect(svc.voidDocument(doc.id, { reason: 'otra vez' })).rejects.toMatchObject({
        response: { code: 'tax.already_voided' },
      });
    });
  });

  describe('libro de ventas', () => {
    it('exige un período', async () => {
      await expect(books.salesBook({})).rejects.toMatchObject({ response: { code: 'tax.period_required' } });
    });

    it('lista los comprobantes del período con sus bases separadas', async () => {
      const libro: any = await books.salesBook({ from: '2026-07-01', to: '2026-07-31' });
      expect(libro.lines.length).toBeGreaterThan(0);
      expect(libro.totals.taxable_base).toBeGreaterThan(0);
      expect(libro.totals.exempt_base).toBeGreaterThan(0); // la venta con línea exenta
      expect(libro.currency).toBe('USD');
    });

    it('los ANULADOS aparecen, en cero', async () => {
      // Sacarlos dejaría un salto en el correlativo dentro del libro, que es justo lo que hay que
      // poder no tener.
      const libro: any = await books.salesBook({ from: '2026-07-01', to: '2026-07-31' });
      const anulados = libro.lines.filter((l: any) => l.voided);
      expect(anulados.length).toBeGreaterThan(0);
      for (const a of anulados) {
        expect(a.control_number).toBeTruthy(); // conserva su número
        expect(a.total).toBe(0);
        expect(a.vat_total).toBe(0);
      }
      expect(libro.totals.voided).toBe(anulados.length);
    });

    it('el correlativo del libro se puede recorrer entero, sin saltos', async () => {
      const libro: any = await books.salesBook({ from: '2026-07-01', to: '2026-07-31' });
      const nums = libro.lines.map((l: any) => Number(l.control_number.split('-')[1]));
      expect(nums).toEqual(Array.from({ length: nums.length }, (_, i) => i + 1));
    });

    it('totaliza por alícuota, que es lo que va a la declaración', async () => {
      const libro: any = await books.salesBook({ from: '2026-07-01', to: '2026-07-31' });
      const general = libro.by_rate.find((r: any) => r.treatment === 'general');
      expect(general).toBeTruthy();
      expect(general.base).toBeGreaterThan(0);
      expect(general.tax).toBe(Math.round(general.base * general.rate * 100) / 100);
    });

    it('un período sin comprobantes da un libro vacío, no un error', async () => {
      const libro: any = await books.salesBook({ from: '2020-01-01', to: '2020-01-31' });
      expect(libro.lines).toEqual([]);
      expect(libro.totals).toMatchObject({ documents: 0, vat_total: 0, total: 0 });
    });
  });
});
