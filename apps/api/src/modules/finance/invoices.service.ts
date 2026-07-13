import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { PurchasesService } from '../commerce/purchases.service';
import { SalesService } from '../commerce/sales.service';

/**
 * Facturas (F-3a): documento fiscal `issued` (desde una venta) / `received` (desde una compra),
 * ligado al documento comercial. El SALDO pendiente es DERIVADO (total − Σ imputaciones); la factura
 * pasa a `paid` cuando se cancela (lo materializa F-3b al imputar pagos).
 *
 * NO re-asienta el devengado: F-2 (PostingService) ya asentó clientes/ventas o compras/proveedores al
 * postear el documento. La factura es la capa documental + el ancla del saldo que los pagos cancelan.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly db: DbService,
    private readonly purchases: PurchasesService,
    private readonly sales: SalesService,
  ) {}

  private async companyId(): Promise<string> {
    const c = await this.db.one<{ id: string }>(`SELECT id FROM companies WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1`, [this.db.tenant]);
    if (!c) throw new BadRequestException({ code: 'finance.no_company', title: 'El tenant no tiene una empresa configurada' });
    return c.id;
  }

  /** Emite una factura desde una venta (issued) o compra (received). Una por documento/dirección. */
  async createFromDocument(body: any) {
    const kind = body?.kind;
    if (kind !== 'sale' && kind !== 'purchase') throw new BadRequestException({ code: 'finance.invalid_kind', title: "kind debe ser 'sale' o 'purchase'" });
    const documentId = body?.document_id;
    if (!documentId) throw new BadRequestException({ code: 'finance.missing_document', title: 'document_id es obligatorio' });
    const invoiceNumber = String(body?.invoice_number ?? '').trim();
    if (!invoiceNumber) throw new BadRequestException({ code: 'finance.missing_invoice_number', title: 'invoice_number es obligatorio' });

    const doc: any = kind === 'sale' ? await this.sales.get(documentId) : await this.purchases.get(documentId);
    const direction = kind === 'sale' ? 'issued' : 'received';
    const partnerId = kind === 'sale' ? doc.customer_partner_id : doc.supplier_partner_id;
    const t = this.db.tenant;
    const companyId = await this.companyId();
    const issueDate = body?.issue_date ?? new Date().toISOString().slice(0, 10);

    // D4: una sola factura vigente (no anulada) por documento y dirección.
    const col = kind === 'sale' ? 'sale_id' : 'purchase_id';
    const dup = await this.db.one<{ id: string }>(`SELECT id FROM invoices WHERE tenant_id=$1 AND ${col}=$2 AND direction=$3 AND status <> 'void' AND deleted_at IS NULL`, [t, documentId, direction]);
    if (dup) throw new ConflictException({ code: 'finance.invoice_exists', title: 'El documento ya tiene una factura vigente' });

    const inv = await this.db.one<{ id: string }>(
      `INSERT INTO invoices (tenant_id, company_id, direction, sale_id, purchase_id, partner_id, invoice_number, issue_date, due_date, currency, total, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'issued',$12) RETURNING id`,
      [t, companyId, direction, kind === 'sale' ? documentId : null, kind === 'purchase' ? documentId : null, partnerId, invoiceNumber, issueDate, body?.due_date ?? null, doc.currency, doc.total, this.db.user],
    );
    return this.get(inv!.id);
  }

  async list(direction?: string) {
    const params: unknown[] = [this.db.tenant];
    let filter = '';
    if (direction === 'issued' || direction === 'received') {
      params.push(direction);
      filter = ` AND i.direction = $${params.length}`;
    }
    return this.db.query(
      `SELECT i.id, i.direction, i.invoice_number, i.issue_date, i.due_date, i.currency, i.total::float AS total, i.status,
              p.name AS partner_name,
              (i.total - COALESCE((SELECT SUM(amount) FROM payment_allocations pa WHERE pa.invoice_id = i.id AND pa.deleted_at IS NULL), 0))::float AS outstanding
       FROM invoices i JOIN business_partners p ON p.id = i.partner_id
       WHERE i.tenant_id = $1 AND i.deleted_at IS NULL${filter}
       ORDER BY i.issue_date DESC, i.created_at DESC LIMIT 200`,
      params,
    );
  }

  async get(id: string) {
    const inv = await this.db.one(
      `SELECT i.id, i.direction, i.sale_id, i.purchase_id, i.partner_id, p.name AS partner_name, i.invoice_number,
              i.issue_date, i.due_date, i.currency, i.total::float AS total, i.status,
              (i.total - COALESCE((SELECT SUM(amount) FROM payment_allocations pa WHERE pa.invoice_id = i.id AND pa.deleted_at IS NULL), 0))::float AS outstanding
       FROM invoices i JOIN business_partners p ON p.id = i.partner_id
       WHERE i.id = $1 AND i.tenant_id = $2 AND i.deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!inv) throw new NotFoundException({ code: 'finance.invoice_not_found', title: 'Factura no encontrada' });
    return inv;
  }

  /** Anula una factura sin imputaciones (si tuviera cobros/pagos, no se puede: revertir primero). */
  async voidInvoice(id: string) {
    const t = this.db.tenant;
    const inv: any = await this.get(id);
    if (inv.status === 'void') return inv;
    const allocated = await this.db.one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM payment_allocations WHERE invoice_id=$1 AND deleted_at IS NULL`, [id]);
    if ((allocated?.n ?? 0) > 0) throw new ConflictException({ code: 'finance.invoice_allocated', title: 'La factura tiene pagos imputados: no se puede anular' });
    await this.db.query(`UPDATE invoices SET status='void', updated_at=now() WHERE id=$1 AND tenant_id=$2`, [id, t]);
    return this.get(id);
  }
}
