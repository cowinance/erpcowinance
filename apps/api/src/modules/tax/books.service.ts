import { BadRequestException, Injectable } from '@nestjs/common';
import { TAXABLE_TREATMENTS, VAT_TREATMENTS, type VatTreatment } from '@cowinance/domain';
import { DbService } from '../../db/db.service';

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

interface BookRow {
  issue_date: string;
  document_type: string;
  document_number: string;
  control_number: string;
  partner_name: string;
  partner_tax_id: string | null;
  taxable_base: number;
  exempt_base: number;
  not_subject_base: number;
  vat_total: number;
  total: number;
  voided: boolean;
}

/**
 * Libro de Ventas (G4-5) — el reporte mensual de IVA, que es lo que realmente usa el contador.
 *
 * Se arma desde el `fiscal_snapshot` CONGELADO de cada comprobante, no recalculando: el libro tiene
 * que decir lo que decía el papel el día que se emitió. Recalcular con las alícuotas de hoy haría
 * que un libro de hace seis meses cambie de números cada vez que se lo mira.
 *
 * **Los anulados aparecen, en cero.** Es la parte que suele hacerse mal: sacarlos dejaría un salto
 * en el correlativo dentro del libro, que es exactamente lo que hay que poder no tener. Figuran con
 * su número y sus importes en cero, para que la numeración se pueda recorrer entera.
 */
@Injectable()
export class BooksService {
  constructor(private readonly db: DbService) {}

  /** Libro de ventas de un período. `from`/`to` en `YYYY-MM-DD`. */
  async salesBook(params: { from?: string; to?: string }) {
    const from = String(params?.from ?? '').trim();
    const to = String(params?.to ?? '').trim();
    if (!from || !to)
      throw new BadRequestException({ code: 'tax.period_required', title: 'El libro necesita un período: from y to (YYYY-MM-DD)' });

    const rows = await this.db.query<any>(
      `SELECT i.issue_date, i.document_type, i.invoice_number, i.control_number,
              i.fiscal_snapshot, i.voided_at, i.total::float AS total,
              p.name AS partner_name, p.tax_id AS partner_tax_id
         FROM invoices i JOIN business_partners p ON p.id = i.partner_id
        WHERE i.tenant_id=$1 AND i.direction='issued' AND i.document_type IS NOT NULL
          AND i.deleted_at IS NULL AND i.issue_date BETWEEN $2::date AND $3::date
        ORDER BY i.control_number`,
      [this.db.tenant, from, to],
    );

    const lines: BookRow[] = rows.map((r) => {
      const anulado = !!r.voided_at;
      const b = r.fiscal_snapshot?.breakdown ?? {};
      // Un comprobante anulado conserva su número y su fecha, pero no aporta importes: el IVA que
      // declaró dejó de deberse.
      const cero = { taxable_base: 0, exempt_base: 0, not_subject_base: 0, vat_total: 0, total: 0 };
      const importes = anulado
        ? cero
        : {
            taxable_base: Number(b.taxable_base ?? 0),
            exempt_base: Number(b.exempt_base ?? 0),
            not_subject_base: Number(b.not_subject_base ?? 0),
            vat_total: Number(b.vat_total ?? 0),
            total: Number(b.total ?? r.total ?? 0),
          };
      return {
        issue_date: r.issue_date,
        document_type: r.document_type,
        document_number: r.invoice_number,
        control_number: r.control_number,
        partner_name: r.partner_name,
        partner_tax_id: r.partner_tax_id,
        voided: anulado,
        ...importes,
      };
    });

    // Totales por alícuota, que es lo que se traslada a la declaración. Salen del snapshot de cada
    // comprobante, así que reflejan la tasa que tenía en su momento y no la de hoy.
    const porAlicuota: Record<string, { rate: number; base: number; tax: number }> = {};
    for (const r of rows) {
      if (r.voided_at) continue;
      for (const g of r.fiscal_snapshot?.breakdown?.groups ?? []) {
        if (!TAXABLE_TREATMENTS.includes(g.treatment as VatTreatment)) continue;
        // Se agrupa por tratamiento Y tasa: si la alícuota general cambió a mitad de mes, el libro
        // tiene que mostrar las dos por separado, no una suma que no corresponde a ninguna.
        const key = `${g.treatment}@${g.rate}`;
        const acc = (porAlicuota[key] ??= { rate: Number(g.rate), base: 0, tax: 0 });
        acc.base = round2(acc.base + Number(g.base));
        acc.tax = round2(acc.tax + Number(g.tax));
      }
    }

    const sum = (f: (l: BookRow) => number) => round2(lines.reduce((s, l) => s + f(l), 0));

    return {
      period: { from, to },
      currency: 'USD', // el módulo no maneja otra, por decisión del productor
      lines,
      by_rate: Object.entries(porAlicuota)
        .map(([key, v]) => ({ treatment: key.split('@')[0] as VatTreatment, ...v }))
        .sort((a, b) => VAT_TREATMENTS.indexOf(a.treatment) - VAT_TREATMENTS.indexOf(b.treatment) || a.rate - b.rate),
      totals: {
        documents: lines.length,
        voided: lines.filter((l) => l.voided).length,
        taxable_base: sum((l) => l.taxable_base),
        exempt_base: sum((l) => l.exempt_base),
        not_subject_base: sum((l) => l.not_subject_base),
        vat_total: sum((l) => l.vat_total),
        total: sum((l) => l.total),
      },
    };
  }
}
