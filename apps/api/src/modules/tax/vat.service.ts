import { BadRequestException, Injectable } from '@nestjs/common';
import {
  InvalidVatRateError,
  TAXABLE_TREATMENTS,
  VAT_TREATMENTS,
  computeVatBreakdown,
  isVatTreatment,
  validateVatRates,
  type VatBreakdown,
  type VatLineInput,
  type VatRates,
} from '@cowinance/domain';
import { DbService } from '../../db/db.service';

/**
 * IVA (G4-3) — alícuotas configuradas por empresa y desglose del comprobante.
 *
 * El CÁLCULO vive en el dominio (`computeVatBreakdown`); acá solo se leen las alícuotas vigentes y
 * se validan al guardarlas. Todo en USD: por decisión del productor no hay bolívares ni conversión.
 */
@Injectable()
export class VatService {
  constructor(private readonly db: DbService) {}

  /** Alícuotas vigentes de la empresa. `{}` si nunca se configuraron. */
  async rates(): Promise<VatRates> {
    const c = await this.db.one<{ vat_rates: VatRates | null }>(
      `SELECT vat_rates FROM companies WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1`,
      [this.db.tenant],
    );
    return c?.vat_rates ?? {};
  }

  /**
   * Guarda las alícuotas. Se validan ACÁ y no al facturar: una alícuota cargada como `16` en vez de
   * `0.16` no falla, factura 1600% de IVA — y eso se descubre en el comprobante que ya salió.
   */
  async setRates(body: any): Promise<VatRates> {
    const entrada = body?.rates ?? body ?? {};
    const rates: VatRates = {};
    for (const [k, v] of Object.entries(entrada)) {
      if (!isVatTreatment(k))
        throw new BadRequestException({ code: 'tax.invalid_treatment', title: `Tratamiento de IVA inválido: ${k} (${VAT_TREATMENTS.join('|')})` });
      // Exento y no sujeto no llevan alícuota: aceptar una dejaría creíble que se puede gravar lo
      // que por definición no se grava.
      if (!TAXABLE_TREATMENTS.includes(k))
        throw new BadRequestException({ code: 'tax.treatment_has_no_rate', title: `${k} no lleva alícuota: no genera débito fiscal` });
      if (v === null || v === undefined || v === '') continue;
      rates[k] = Number(v);
    }

    try {
      validateVatRates(rates);
    } catch (e) {
      if (e instanceof InvalidVatRateError) throw new BadRequestException({ code: 'tax.invalid_vat_rate', title: e.message });
      throw e;
    }

    await this.db.query(
      `UPDATE companies SET vat_rates=$1, updated_at=now()
        WHERE id = (SELECT id FROM companies WHERE tenant_id=$2 AND deleted_at IS NULL ORDER BY created_at LIMIT 1)`,
      [JSON.stringify(rates), this.db.tenant],
    );
    return this.rates();
  }

  /** Desglosa un conjunto de líneas con las alícuotas vigentes de la empresa. */
  async breakdown(lines: VatLineInput[]): Promise<VatBreakdown> {
    return computeVatBreakdown(lines, await this.rates());
  }

  /**
   * Previsualización para la UI: mismo cálculo que va a llevar el comprobante, sin emitir nada.
   * Sirve para que el operador vea el IVA antes de confirmar, con la MISMA regla — no con una
   * cuenta aproximada del frontend que después no coincide.
   */
  async preview(body: any): Promise<VatBreakdown> {
    const raw = Array.isArray(body?.lines) ? body.lines : [];
    const lines: VatLineInput[] = raw.map((l: any) => {
      if (!isVatTreatment(l?.treatment))
        throw new BadRequestException({ code: 'tax.invalid_treatment', title: `Tratamiento de IVA inválido: ${l?.treatment}` });
      return { line_total: Number(l.line_total), treatment: l.treatment };
    });
    return this.breakdown(lines);
  }
}
