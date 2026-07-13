import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { computeDocumentTotals, DocumentLineInput } from '@cowinance/domain';
import { DbService, Q } from '../../db/db.service';
import { InventoryService } from '../inventory/inventory.service';

const STATUSES = ['draft', 'confirmed', 'received', 'paid', 'canceled'];
/** Transiciones permitidas de la máquina de estados de una compra. */
const TRANSITIONS: Record<string, string[]> = {
  draft: ['confirmed', 'received', 'canceled'],
  confirmed: ['received', 'canceled'],
  received: ['paid'],
  paid: [],
  canceled: [],
};

interface LineInput extends DocumentLineInput {
  item_id?: string | null;
  animal_id?: string | null;
  description?: string | null;
  warehouse_id?: string | null;
}

/**
 * Compras (C-2): cabecera + líneas con totales DERIVADOS (regla única en @cowinance/domain), máquina
 * de estados y gancho idempotente a stock: al pasar a `received`, cada línea de ítem genera un
 * movimiento `in` reusando InventoryService.recordMovementInTx (regla única applyToLevel), atómico.
 */
@Injectable()
export class PurchasesService {
  constructor(
    private readonly db: DbService,
    private readonly inventory: InventoryService,
  ) {}

  private async defaultCurrency(): Promise<string> {
    const c = await this.db.one<{ currency: string }>(`SELECT functional_currency AS currency FROM companies WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1`, [this.db.tenant]);
    if (!c) throw new BadRequestException({ code: 'commerce.no_company', title: 'El tenant no tiene una empresa configurada' });
    return c.currency;
  }

  private async resolveCompany(): Promise<string> {
    const c = await this.db.one<{ id: string }>(`SELECT id FROM companies WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1`, [this.db.tenant]);
    if (!c) throw new BadRequestException({ code: 'commerce.no_company', title: 'El tenant no tiene una empresa configurada' });
    return c.id;
  }

  private async requireSupplier(partnerId: string): Promise<void> {
    const p = await this.db.one<{ id: string }>(
      `SELECT p.id FROM business_partners p JOIN suppliers s ON s.partner_id = p.id AND s.deleted_at IS NULL
       WHERE p.id=$1 AND p.tenant_id=$2 AND p.deleted_at IS NULL AND p.type IN ('supplier','both')`,
      [partnerId, this.db.tenant],
    );
    if (!p) throw new BadRequestException({ code: 'commerce.not_a_supplier', title: 'El socio no es un proveedor vigente' });
  }

  /** Valida y normaliza las líneas de entrada; calcula sus totales con la regla única del dominio. */
  private parseLines(raw: any): { lines: LineInput[]; totals: ReturnType<typeof computeDocumentTotals> } {
    if (!Array.isArray(raw) || raw.length === 0) throw new BadRequestException({ code: 'commerce.no_lines', title: 'La compra necesita al menos una línea' });
    const lines: LineInput[] = raw.map((l: any) => {
      const quantity = Number(l?.quantity);
      const unit_price = Number(l?.unit_price);
      const tax_rate = l?.tax_rate != null ? Number(l.tax_rate) : 0;
      if (!Number.isFinite(quantity) || quantity <= 0) throw new BadRequestException({ code: 'commerce.invalid_quantity', title: 'quantity debe ser positiva' });
      if (!Number.isFinite(unit_price) || unit_price < 0) throw new BadRequestException({ code: 'commerce.invalid_unit_price', title: 'unit_price debe ser ≥ 0' });
      if (!Number.isFinite(tax_rate) || tax_rate < 0) throw new BadRequestException({ code: 'commerce.invalid_tax_rate', title: 'tax_rate debe ser ≥ 0 (fracción)' });
      if (!l?.item_id && !l?.animal_id) throw new BadRequestException({ code: 'commerce.line_target', title: 'Cada línea requiere item_id o animal_id' });
      return { quantity, unit_price, tax_rate, item_id: l.item_id ?? null, animal_id: l.animal_id ?? null, description: l.description ?? null, warehouse_id: l.warehouse_id ?? null };
    });
    return { lines, totals: computeDocumentTotals(lines) };
  }

  async create(body: any) {
    const supplierId = body?.supplier_partner_id;
    if (!supplierId) throw new BadRequestException({ code: 'commerce.missing_supplier', title: 'supplier_partner_id es obligatorio' });
    await this.requireSupplier(supplierId);
    const { lines, totals } = this.parseLines(body?.lines);
    const currency = (body?.currency ?? (await this.defaultCurrency())) as string;
    const companyId = await this.resolveCompany();
    const purchaseDate = body?.purchase_date ?? new Date().toISOString().slice(0, 10);
    const t = this.db.tenant;

    return this.db.tx(async (q) => {
      const purchase = await q.one<{ id: string }>(
        `INSERT INTO purchases (tenant_id, company_id, supplier_partner_id, document_number, purchase_date, currency, subtotal, tax_total, total, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10) RETURNING id`,
        [t, companyId, supplierId, body?.document_number ?? null, purchaseDate, currency, totals.subtotal, totals.tax_total, totals.total, this.db.user],
      );
      await this.insertLines(q, purchase!.id, lines, totals);
      return this.getInTx(q, purchase!.id);
    });
  }

  private async insertLines(q: Q, purchaseId: string, lines: LineInput[], totals: ReturnType<typeof computeDocumentTotals>) {
    const t = this.db.tenant;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      await q.query(
        `INSERT INTO purchase_lines (tenant_id, purchase_id, item_id, animal_id, description, quantity, unit_price, tax_rate, line_total, warehouse_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [t, purchaseId, l.item_id ?? null, l.animal_id ?? null, l.description ?? null, l.quantity, l.unit_price, l.tax_rate ?? 0, totals.lines[i].line_total, l.warehouse_id ?? null, this.db.user],
      );
    }
  }

  async updateStatus(id: string, next: string) {
    if (!STATUSES.includes(next)) throw new BadRequestException({ code: 'commerce.invalid_status', title: `status inválido (${STATUSES.join('|')})` });
    const t = this.db.tenant;
    return this.db.tx(async (q) => {
      const p = await q.one<{ id: string; status: string }>(`SELECT id, status FROM purchases WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, t]);
      if (!p) throw new NotFoundException({ code: 'commerce.purchase_not_found', title: 'Compra no encontrada' });
      if (p.status === next) return this.getInTx(q, id); // idempotente: sin cambios
      if (!TRANSITIONS[p.status]?.includes(next)) {
        throw new ConflictException({ code: 'commerce.invalid_transition', title: `No se puede pasar de '${p.status}' a '${next}'` });
      }
      if (next === 'received') await this.receiveStock(q, id);
      await q.query(`UPDATE purchases SET status=$1, updated_at=now() WHERE id=$2 AND tenant_id=$3`, [next, id, t]);
      return this.getInTx(q, id);
    });
  }

  /**
   * Genera los movimientos de stock `in` de las líneas de ítem (idempotente: no regenera si ya existen
   * para esta compra). Requiere warehouse_id en cada línea de ítem. El costo entra al promedio
   * ponderado (unit_cost = unit_price). Las líneas de animal se difieren (alta en Herd = otro vertical).
   */
  private async receiveStock(q: Q, purchaseId: string) {
    const t = this.db.tenant;
    const already = await q.one<{ n: number }>(`SELECT count(*)::int AS n FROM stock_movements WHERE tenant_id=$1 AND reference_type='purchase' AND reference_id=$2`, [t, purchaseId]);
    if ((already?.n ?? 0) > 0) return; // ya recibida: no duplicar
    const lines = await q.query<{ item_id: string | null; quantity: number; unit_price: number; warehouse_id: string | null }>(
      `SELECT item_id, quantity::float AS quantity, unit_price::float AS unit_price, warehouse_id FROM purchase_lines WHERE purchase_id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [purchaseId, t],
    );
    for (const l of lines) {
      if (!l.item_id) continue; // línea de animal: sin efecto de stock en C-2
      if (!l.warehouse_id) throw new BadRequestException({ code: 'commerce.line_no_warehouse', title: 'Cada línea de ítem necesita warehouse_id para recibir stock' });
      await this.inventory.recordMovementInTx(q, {
        item_id: l.item_id,
        warehouse_id: l.warehouse_id,
        movement_type: 'in',
        quantity: l.quantity,
        unit_cost: l.unit_price,
        reference_type: 'purchase',
        reference_id: purchaseId,
      });
    }
  }

  // ── Lectura ──────────────────────────────────────────────────────────────
  async list(status?: string) {
    const params: unknown[] = [this.db.tenant];
    let filter = '';
    if (status && STATUSES.includes(status)) {
      params.push(status);
      filter = ` AND pu.status = $${params.length}`;
    }
    return this.db.query(
      `SELECT pu.id, pu.document_number, pu.purchase_date, pu.currency, pu.total::float AS total, pu.status, p.name AS supplier_name
       FROM purchases pu JOIN business_partners p ON p.id = pu.supplier_partner_id
       WHERE pu.tenant_id = $1 AND pu.deleted_at IS NULL${filter}
       ORDER BY pu.purchase_date DESC, pu.created_at DESC LIMIT 200`,
      params,
    );
  }

  async get(id: string) {
    return this.getInTx(this.db, id);
  }

  /** Sella el asiento generado (F-2) en la compra, dentro de la tx del posteo. */
  async attachJournalEntry(q: Q, id: string, entryId: string) {
    await q.query(`UPDATE purchases SET journal_entry_id=$1, updated_at=now() WHERE id=$2 AND tenant_id=$3`, [entryId, id, this.db.tenant]);
  }

  private async getInTx(e: Q, id: string) {
    const purchase = await e.one(
      `SELECT pu.id, pu.document_number, pu.purchase_date, pu.currency, pu.subtotal::float AS subtotal, pu.tax_total::float AS tax_total,
              pu.total::float AS total, pu.status, pu.journal_entry_id, pu.supplier_partner_id, p.name AS supplier_name
       FROM purchases pu JOIN business_partners p ON p.id = pu.supplier_partner_id
       WHERE pu.id=$1 AND pu.tenant_id=$2 AND pu.deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!purchase) throw new NotFoundException({ code: 'commerce.purchase_not_found', title: 'Compra no encontrada' });
    const lines = await e.query(
      `SELECT id, item_id, animal_id, description, quantity::float AS quantity, unit_price::float AS unit_price, tax_rate::float AS tax_rate, line_total::float AS line_total, warehouse_id
       FROM purchase_lines WHERE purchase_id=$1 AND tenant_id=$2 AND deleted_at IS NULL ORDER BY created_at`,
      [id, this.db.tenant],
    );
    return { ...purchase, lines };
  }
}
