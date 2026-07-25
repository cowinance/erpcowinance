import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { VatService } from './vat.service';

/**
 * IVA (G4-3) sobre la base real: que las alícuotas se guarden, se validen y se apliquen.
 * Todo en USD — el módulo no conoce otra moneda a propósito.
 */
describe('tax — alícuotas de IVA', () => {
  let db: DbService;
  let svc: VatService;
  let originalCwd: string;
  let tmp: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'vat-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    svc = new VatService(db);
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('sin configurar devuelve vacío, no unas tasas inventadas', async () => {
    // Un default con la alícuota de hoy afirmaría cuál es la vigente en el momento en que alguien
    // corrió la migración, y esa afirmación envejece sola.
    expect(await svc.rates()).toEqual({});
  });

  it('guarda y devuelve las alícuotas', async () => {
    const r = await svc.setRates({ rates: { general: 0.16, reduced: 0.08 } });
    expect(r).toEqual({ general: 0.16, reduced: 0.08 });
    expect(await svc.rates()).toEqual({ general: 0.16, reduced: 0.08 });
  });

  it('atrapa el porcentaje cargado como entero ANTES de que salga un comprobante', async () => {
    // `16` en vez de `0.16` no falla: factura 1600% de IVA.
    await expect(svc.setRates({ rates: { general: 16 } })).rejects.toMatchObject({
      status: 400,
      response: { code: 'tax.invalid_vat_rate' },
    });
    // Y no pisó lo que ya estaba.
    expect(await svc.rates()).toEqual({ general: 0.16, reduced: 0.08 });
  });

  it('no acepta alícuota para lo que no se grava', async () => {
    await expect(svc.setRates({ rates: { exempt: 0.16 } })).rejects.toMatchObject({
      response: { code: 'tax.treatment_has_no_rate' },
    });
  });

  it('rechaza un tratamiento que no existe', async () => {
    await expect(svc.setRates({ rates: { inventado: 0.16 } })).rejects.toMatchObject({
      response: { code: 'tax.invalid_treatment' },
    });
  });

  it('desglosa con las alícuotas vigentes de la empresa', async () => {
    const b = await svc.breakdown([
      { line_total: 1000, treatment: 'general' },
      { line_total: 500, treatment: 'exempt' },
    ]);
    expect(b.taxable_base).toBe(1000);
    expect(b.exempt_base).toBe(500);
    expect(b.vat_total).toBe(160);
    expect(b.total).toBe(1660);
  });

  it('la previsualización usa la MISMA regla que el comprobante', async () => {
    // Si la UI hiciera su propia cuenta, el número de la pantalla y el del papel podrían diferir.
    const p = await svc.preview({ lines: [{ line_total: 1000, treatment: 'general' }] });
    const b = await svc.breakdown([{ line_total: 1000, treatment: 'general' }]);
    expect(p).toEqual(b);
  });

  it('la previsualización rechaza un tratamiento inválido en vez de asumir uno', async () => {
    await expect(svc.preview({ lines: [{ line_total: 100, treatment: 'x' }] })).rejects.toMatchObject({
      response: { code: 'tax.invalid_treatment' },
    });
  });

  it('cambiar la alícuota cambia el desglose sin tocar código', async () => {
    // Es el punto de que viva en configuración: en Venezuela cambia por providencia.
    await svc.setRates({ rates: { general: 0.2 } });
    const b = await svc.breakdown([{ line_total: 1000, treatment: 'general' }]);
    expect(b.vat_total).toBe(200);
  });
});
