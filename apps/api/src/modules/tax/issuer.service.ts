import { BadRequestException, Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { resolveFiscalId, resolveTaxpayerCondition } from '../../common/fiscal-identity';

/**
 * Identidad fiscal de la EMPRESA que emite (G4-4). Existía la del socio de negocio (G4-1) y faltaba
 * ésta: sin RIF propio no se puede emitir un solo comprobante, y no había por dónde cargarlo.
 *
 * Misma regla que la del socio —`resolveFiscalId`, condicional por país—, para que el RIF propio y
 * el del cliente se validen igual. Dos validaciones distintas para el mismo dato terminan aceptando
 * en una punta lo que la otra rechaza.
 */
@Injectable()
export class IssuerService {
  constructor(private readonly db: DbService) {}

  private async company() {
    const c = await this.db.one<any>(
      `SELECT id, name, legal_name, tax_id, tax_id_normalized, taxpayer_condition, fiscal_address, country_code
         FROM companies WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1`,
      [this.db.tenant],
    );
    if (!c) throw new BadRequestException({ code: 'tax.no_company', title: 'El tenant no tiene una empresa configurada' });
    return c;
  }

  async get() {
    const c = await this.company();
    return {
      ...c,
      // DERIVADO: la UI necesita saber si ya se puede facturar, y la respuesta es «tiene RIF».
      can_issue: !!c.tax_id,
    };
  }

  async update(body: any) {
    const c = await this.company();
    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, val: unknown) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };

    if (body?.tax_id !== undefined) {
      const fiscal = resolveFiscalId(c.country_code, body.tax_id);
      // Las dos columnas SIEMPRE juntas: dejar una vieja y la otra nueva es tener dos verdades del
      // mismo dato.
      set('tax_id', fiscal.tax_id);
      set('tax_id_normalized', fiscal.tax_id_normalized);
    }
    if (body?.taxpayer_condition !== undefined) set('taxpayer_condition', resolveTaxpayerCondition(body.taxpayer_condition));
    for (const f of ['legal_name', 'fiscal_address'] as const) if (body?.[f] !== undefined) set(f, body[f] ?? null);

    if (sets.length) {
      params.push(c.id, this.db.tenant);
      await this.db.query(
        `UPDATE companies SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.length - 1} AND tenant_id=$${params.length}`,
        params,
      );
    }
    return this.get();
  }
}
