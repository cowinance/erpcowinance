import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  FiscalDocumentError,
  assertIssuable,
  assertNoteReference,
  assertVoidable,
  computeVatBreakdown,
  isNote,
  isVatTreatment,
  type FiscalDocumentType,
  type FiscalDocumentStanding,
  type VatLineInput,
} from '@cowinance/domain';
import { DbService, Q } from '../../db/db.service';
import { NumberingService } from './numbering.service';
import { VatService } from './vat.service';

/**
 * Emisión de comprobantes fiscales (G4-4). Acá convergen las tres etapas anteriores —identidad
 * (G4-1), los dos correlativos (G4-2) y el desglose de IVA (G4-3)— **dentro de una sola
 * transacción**, que es lo que hace que un comprobante que falla no queme un número.
 *
 * El orden dentro de la transacción no es casual:
 *   1. Validar identidad y líneas. **Antes** de tocar la numeración: un comprobante rechazado por
 *      falta de RIF no tiene por qué haber pedido un número, aunque el rollback se lo devuelva.
 *   2. Congelar el desglose con las alícuotas de HOY.
 *   3. Recién ahí, tomar los dos números.
 *   4. Insertar.
 *
 * Todo en USD: por decisión del productor no hay bolívares ni conversión.
 */
@Injectable()
export class IssuanceService {
  constructor(
    private readonly db: DbService,
    private readonly numbering: NumberingService,
    private readonly vat: VatService,
  ) {}

  private mapDomainError(e: unknown): never {
    if (e instanceof FiscalDocumentError) throw new BadRequestException({ code: `tax.${e.code}`, title: e.message });
    throw e as Error;
  }

  private standingOf(row: { voided_at: string | null }): FiscalDocumentStanding {
    return row.voided_at ? 'voided' : 'issued';
  }

  /**
   * Emite un comprobante desde una venta. Una venta puede tener su factura y después notas que la
   * modifican, así que el tipo es explícito y no se deduce.
   */
  async issueFromSale(body: any) {
    const saleId = body?.sale_id;
    const type: FiscalDocumentType = body?.document_type ?? 'invoice';
    if (!saleId) throw new BadRequestException({ code: 'tax.missing_sale', title: 'sale_id es obligatorio' });

    const t = this.db.tenant;
    const sale = await this.db.one<any>(
      `SELECT s.id, s.company_id, s.customer_partner_id, s.currency, s.sale_date
         FROM sales s WHERE s.id=$1 AND s.tenant_id=$2 AND s.deleted_at IS NULL`,
      [saleId, t],
    );
    if (!sale) throw new NotFoundException({ code: 'tax.sale_not_found', title: 'Venta no encontrada' });

    const [emisor, cliente, lineas, rates] = await Promise.all([
      this.db.one<any>(
        `SELECT tax_id, name, legal_name, taxpayer_condition, fiscal_address FROM companies WHERE id=$1 AND tenant_id=$2`,
        [sale.company_id, t],
      ),
      this.db.one<any>(
        `SELECT tax_id, name, legal_name, taxpayer_condition, fiscal_address FROM business_partners WHERE id=$1 AND tenant_id=$2`,
        [sale.customer_partner_id, t],
      ),
      this.db.query<any>(
        `SELECT description, quantity::float AS quantity, unit_price::float AS unit_price,
                line_total::float AS line_total, vat_treatment
           FROM sale_lines WHERE sale_id=$1 AND tenant_id=$2 AND deleted_at IS NULL ORDER BY created_at`,
        [saleId, t],
      ),
      this.vat.rates(),
    ]);

    try {
      assertIssuable({ type, issuer: emisor ?? { tax_id: null }, customer: cliente ?? { tax_id: null }, lineCount: lineas.length });
    } catch (e) {
      this.mapDomainError(e);
    }

    // Referencia de la nota: se resuelve y valida ANTES de la transacción, por lo mismo.
    //
    // Se carga sea cual sea el tipo, y NO solo cuando es nota: si se mirara únicamente en las notas,
    // mandar `references_invoice_id` en una factura se ignoraría EN SILENCIO y quien la emitió
    // creería que quedó vinculada. Un dato que se descarta sin avisar es peor que un rechazo.
    let referenced: any = null;
    const refId = body?.references_invoice_id;
    if (refId) {
      referenced = await this.db.one<any>(
        `SELECT id, document_type, voided_at FROM invoices WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
        [refId, t],
      );
      if (!referenced) throw new NotFoundException({ code: 'tax.reference_not_found', title: 'El comprobante referenciado no existe' });
    }
    try {
      assertNoteReference(
        type,
        referenced ? { document_type: referenced.document_type, standing: this.standingOf(referenced) } : null,
      );
    } catch (e) {
      this.mapDomainError(e);
    }

    // Desglose con las alícuotas de HOY. Se congela: un comprobante emitido es un hecho, no una
    // consulta — si mañana cambia la alícuota, esta factura no puede cambiar de monto sola.
    const vatLines: VatLineInput[] = lineas.map((l: any) => ({
      line_total: Number(l.line_total),
      // Sin tratamiento declarado se asume la alícuota general, que es el caso corriente. Se asume
      // el gravado y no el exento a propósito: equivocarse hacia gravado se corrige con una nota;
      // equivocarse hacia exento es IVA no cobrado que igual hay que enterar.
      treatment: isVatTreatment(l.vat_treatment) ? l.vat_treatment : 'general',
    }));
    const breakdown = computeVatBreakdown(vatLines, rates);

    try {
      return await this.db.tx(async (q) => {
        const nums = await this.numbering.allocateForDocumentInTx(q, type, sale.company_id);
        const snapshot = {
          breakdown,
          rates,
          issuer: { tax_id: emisor.tax_id, name: emisor.legal_name ?? emisor.name, taxpayer_condition: emisor.taxpayer_condition, fiscal_address: emisor.fiscal_address },
          customer: { tax_id: cliente.tax_id, name: cliente.legal_name ?? cliente.name, taxpayer_condition: cliente.taxpayer_condition, fiscal_address: cliente.fiscal_address },
          lines: lineas.map((l: any, i: number) => ({ ...l, treatment: vatLines[i].treatment })),
          currency: 'USD',
        };

        const inv = await q.one<{ id: string }>(
          `INSERT INTO invoices (tenant_id, company_id, direction, sale_id, partner_id, invoice_number, control_number,
                                 document_type, document_series_id, control_series_id, issue_date, currency, total,
                                 fiscal_snapshot, references_invoice_id, status, created_by)
           VALUES ($1,$2,'issued',$3,$4,$5,$6,$7,$8,$9,$10,'USD',$11,$12,$13,'issued',$14) RETURNING id`,
          [
            t, sale.company_id, saleId, sale.customer_partner_id, nums.document_number.formatted, nums.control_number.formatted,
            type, nums.document_number.series_id, nums.control_number.series_id, body?.issue_date ?? sale.sale_date,
            breakdown.total, JSON.stringify(snapshot), referenced?.id ?? null, this.db.user,
          ],
        );
        return this.get(inv!.id, q);
      });
    } catch (e) {
      if (String((e as any)?.message ?? '').includes('ux_invoices_control_number'))
        throw new ConflictException({ code: 'tax.duplicate_control_number', title: 'Ese número de control ya fue usado' });
      throw e;
    }
  }

  async get(id: string, q?: Pick<Q, 'one'>) {
    const runner = q ?? this.db;
    const inv = await runner.one<any>(
      `SELECT i.id, i.document_type, i.invoice_number, i.control_number, i.issue_date, i.currency,
              i.total::float AS total, i.status, i.voided_at, i.void_reason, i.references_invoice_id,
              i.fiscal_snapshot, i.sale_id, p.name AS partner_name
         FROM invoices i JOIN business_partners p ON p.id = i.partner_id
        WHERE i.id=$1 AND i.tenant_id=$2 AND i.deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!inv) throw new NotFoundException({ code: 'tax.document_not_found', title: 'Comprobante no encontrado' });
    // El estado se DERIVA de `voided_at`; una columna aparte se desincronizaría.
    return { ...inv, standing: this.standingOf(inv) };
  }

  /** Comprobantes fiscales emitidos, del más nuevo al más viejo. */
  async list(params: { from?: string; to?: string } = {}) {
    const args: unknown[] = [this.db.tenant];
    let filtro = '';
    if (params.from) {
      args.push(params.from);
      filtro += ` AND i.issue_date >= $${args.length}`;
    }
    if (params.to) {
      args.push(params.to);
      filtro += ` AND i.issue_date <= $${args.length}`;
    }
    const rows = await this.db.query<any>(
      `SELECT i.id, i.document_type, i.invoice_number, i.control_number, i.issue_date,
              i.total::float AS total, i.voided_at, p.name AS partner_name, p.tax_id AS partner_tax_id
         FROM invoices i JOIN business_partners p ON p.id = i.partner_id
        WHERE i.tenant_id=$1 AND i.document_type IS NOT NULL AND i.deleted_at IS NULL${filtro}
        ORDER BY i.issue_date DESC, i.control_number DESC`,
      args,
    );
    return rows.map((r) => ({ ...r, standing: this.standingOf(r) }));
  }

  /**
   * Anula un comprobante. **No libera el número**: el comprobante sigue existiendo y sigue ocupando
   * su lugar en el correlativo. Devolverlo dejaría el hueco que hay que justificar ante el SENIAT.
   */
  async voidDocument(id: string, body: any) {
    const inv = await this.get(id);
    try {
      assertVoidable(inv.standing);
    } catch (e) {
      this.mapDomainError(e);
    }
    const reason = String(body?.reason ?? '').trim();
    if (!reason)
      throw new BadRequestException({ code: 'tax.void_needs_reason', title: 'La anulación tiene que decir por qué: queda en el libro de ventas' });

    await this.db.query(
      `UPDATE invoices SET voided_at=now(), void_reason=$1, status='void', updated_at=now() WHERE id=$2 AND tenant_id=$3`,
      [reason, id, this.db.tenant],
    );
    return this.get(id);
  }
}
