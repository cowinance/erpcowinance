import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { NumberingService } from './numbering.service';

/**
 * Numeración fiscal (G4-2) sobre la base real.
 *
 * Lo que se fija acá es la propiedad que define la etapa: **el correlativo no tiene huecos**. Eso
 * incluye el caso que una `sequence` de PostgreSQL no cubre — que una emisión fallida DEVUELVA el
 * número en vez de quemarlo.
 *
 * LO QUE ESTE ARCHIVO NO PUEDE PROBAR: la concurrencia. PGlite es de una sola conexión, así que dos
 * emisiones simultáneas no existen acá y el `FOR UPDATE` nunca llega a bloquear nada. Esa mitad se
 * prueba contra PostgreSQL real en `scripts/verify-numbering-concurrency.mjs`.
 */
describe('tax — numeración fiscal', () => {
  let db: DbService;
  let svc: NumberingService;
  let originalCwd: string;
  let tmp: string;
  let companyId: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'numbering-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    svc = new NumberingService(db);
    const c = await db.one<{ id: string }>(`SELECT id FROM companies WHERE tenant_id=$1 ORDER BY created_at LIMIT 1`, [db.tenant]);
    companyId = c!.id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  describe('definición de la serie', () => {
    it('crea la serie de control con el lote de la imprenta', async () => {
      const s: any = await svc.create({
        purpose: 'control',
        prefix: '00',
        range_from: 1,
        range_to: 5000,
        printer_name: 'Litografía El Llano',
        authorization_code: 'SENIAT-2026-0042',
      });
      expect(s.next_number).toBe(1);
      expect(s.remaining).toBe(5000);
      expect(s.health).toBe('ok');
      expect(s.nextFormatted).toBe('00-00000001');
    });

    it('la serie de control NO lleva tipo de comprobante', async () => {
      // Aceptarlo dejaría creíble que hay una por tipo, cuando es una sola para todos: identifica
      // el papel, no el documento.
      await expect(svc.create({ purpose: 'control', document_type: 'invoice' })).rejects.toMatchObject({
        status: 400,
        response: { code: 'tax.control_has_no_type' },
      });
    });

    it('la serie de documento SÍ lo lleva, y es obligatorio', async () => {
      await expect(svc.create({ purpose: 'document' })).rejects.toMatchObject({
        response: { code: 'tax.invalid_document_type' },
      });
      const s: any = await svc.create({ purpose: 'document', document_type: 'invoice' });
      expect(s.document_type).toBe('invoice');
      // Sin tope: el correlativo propio no se agota. `null` NO es cero.
      expect(s.remaining).toBeNull();
      expect(s.health).toBe('ok');
    });

    it('no deja dos series activas para el mismo destino', async () => {
      // Dos correlativos avanzando en paralelo son números repetidos, y eso se descubre cuando el
      // cliente presenta dos facturas iguales.
      await expect(svc.create({ purpose: 'control', prefix: '01' })).rejects.toMatchObject({
        status: 409,
        response: { code: 'tax.series_already_active' },
      });
      await expect(svc.create({ purpose: 'document', document_type: 'invoice' })).rejects.toMatchObject({
        status: 409,
        response: { code: 'tax.series_already_active' },
      });
    });

    it('rechaza una definición inválida antes de guardarla', async () => {
      await expect(svc.create({ purpose: 'document', document_type: 'credit_note', prefix: '00-01' })).rejects.toMatchObject({
        response: { code: 'tax.invalid_series.bad_prefix' },
      });
      await expect(
        svc.create({ purpose: 'document', document_type: 'credit_note', range_from: 100, range_to: 500, next_number: 50 }),
      ).rejects.toMatchObject({ response: { code: 'tax.invalid_series.bad_start' } });
    });
  });

  describe('asignación', () => {
    it('entrega números consecutivos, sin saltos', async () => {
      const dados: number[] = [];
      for (let i = 0; i < 5; i++) {
        const r = await db.tx((q) => svc.allocateInTx(q, 'document', 'invoice', companyId));
        dados.push(r.number);
      }
      expect(dados).toEqual([1, 2, 3, 4, 5]);
    });

    it('los dos números del comprobante salen juntos y con su formato', async () => {
      const r = await db.tx((q) => svc.allocateForDocumentInTx(q, 'invoice', companyId));
      expect(r.document_number.number).toBe(6);
      expect(r.document_number.formatted).toBe('00000006');
      expect(r.control_number.formatted).toMatch(/^00-\d{8}$/);
    });

    it('cada tipo lleva SU correlativo: la nota de crédito no hereda el de la factura', async () => {
      await svc.create({ purpose: 'document', document_type: 'credit_note' });
      const nc = await db.tx((q) => svc.allocateInTx(q, 'document', 'credit_note', companyId));
      expect(nc.number).toBe(1); // arranca de cero, no del 7 de la factura
    });

    it('el número de control es UNO SOLO para todos los tipos', async () => {
      // Es el papel: dos comprobantes distintos en la misma forma serían el mismo control.
      const antes = await db.tx((q) => svc.allocateInTx(q, 'control', 'invoice', companyId));
      const despues = await db.tx((q) => svc.allocateInTx(q, 'control', 'credit_note', companyId));
      expect(despues.number).toBe(antes.number + 1);
    });

    it('SIN SERIE no inventa un número: avisa', async () => {
      await expect(db.tx((q) => svc.allocateInTx(q, 'document', 'debit_note', companyId))).rejects.toMatchObject({
        status: 400,
        response: { code: 'tax.no_series' },
      });
    });
  });

  describe('un comprobante que falla NO deja hueco', () => {
    it('el número vuelve a estar disponible si la transacción no se guarda', async () => {
      // ESTE es el test que justifica no haber usado una `sequence`: una secuencia no vuelve atrás,
      // así que acá dejaría el hueco igual — y un hueco en un correlativo fiscal hay que
      // justificarlo ante el SENIAT.
      const antes: any = await svc.get((await svc.list()).find((s: any) => s.document_type === 'credit_note')!.id);

      await expect(
        db.tx(async (q) => {
          await svc.allocateInTx(q, 'document', 'credit_note', companyId);
          throw new Error('el comprobante falló después de tomar el número');
        }),
      ).rejects.toThrow('el comprobante falló');

      const despues: any = await svc.get(antes.id);
      expect(despues.next_number).toBe(antes.next_number); // no avanzó

      // Y el número sigue siendo el mismo cuando la emisión sí funciona.
      const ok = await db.tx((q) => svc.allocateInTx(q, 'document', 'credit_note', companyId));
      expect(ok.number).toBe(antes.next_number);
    });
  });

  describe('lote agotado', () => {
    it('frena ANTES de emitir con una forma que la imprenta nunca imprimió', async () => {
      await svc.create({ purpose: 'document', document_type: 'delivery_note', range_from: 1, range_to: 2 });
      const a = await db.tx((q) => svc.allocateInTx(q, 'document', 'delivery_note', companyId));
      const b = await db.tx((q) => svc.allocateInTx(q, 'document', 'delivery_note', companyId));
      expect([a.number, b.number]).toEqual([1, 2]);

      await expect(db.tx((q) => svc.allocateInTx(q, 'document', 'delivery_note', companyId))).rejects.toMatchObject({
        status: 409,
        response: { code: 'tax.series_exhausted' },
      });
    });

    it('el estado avisa que se agotó, sin proponer un número que no existe', async () => {
      const s: any = (await svc.list()).find((x: any) => x.document_type === 'delivery_note');
      expect(s.health).toBe('exhausted');
      expect(s.remaining).toBe(0);
      expect(s.nextFormatted).toBeNull();
    });
  });

  describe('reemplazo del lote', () => {
    it('cierra la vieja y abre la nueva en un solo paso', async () => {
      // Si fueran dos llamados, entre uno y otro no habría serie activa y quien intentara facturar
      // ahí quedaría trabado; y si fallara el segundo, la finca se quedaría sin ninguna.
      const vieja: any = (await svc.list()).find((x: any) => x.document_type === 'delivery_note');
      const nueva: any = await svc.replace(vieja.id, { range_from: 3, range_to: 100, prefix: '01' });

      expect(nueva.id).not.toBe(vieja.id);
      expect(nueva.document_type).toBe('delivery_note');
      expect(nueva.next_number).toBe(3);
      expect(nueva.health).toBe('ok');

      // Y hay exactamente UNA activa para ese destino.
      const activas = (await svc.list()).filter((x: any) => x.document_type === 'delivery_note' && x.is_active);
      expect(activas).toHaveLength(1);

      // La emisión sigue, tomando de la serie nueva.
      const r = await db.tx((q) => svc.allocateInTx(q, 'document', 'delivery_note', companyId));
      expect(r.number).toBe(3);
      expect(r.formatted).toBe('01-00000003');
    });
  });
});
