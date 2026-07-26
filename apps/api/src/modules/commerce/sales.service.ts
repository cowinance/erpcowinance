import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { assessSaleCertifications, computeDocumentTotals, DocumentLineInput } from '@cowinance/domain';
import { DbService, Q } from '../../db/db.service';
import { InventoryService } from '../inventory/inventory.service';
import { AnimalStatusService } from '../herd/animal-status.service';

const STATUSES = ['draft', 'confirmed', 'delivered', 'invoiced', 'paid', 'canceled'];
/**
 * Qué venta CUENTA como ingreso — regla única, análoga a `LEDGER_COUNTS` del libro mayor. Un
 * borrador todavía no es una operación y una anulada dejó de serlo; el resto sí, desde que se
 * confirma (no desde que se cobra: el ingreso se devenga con la entrega, no con la caja).
 * Cualquier reporte que sume ventas debe usar esta constante, no repetir el filtro.
 * Prefija con `sa.`, el alias de `sales` en las consultas.
 */
export const SALE_COUNTS = "sa.status NOT IN ('draft','canceled')";
const SALE_TYPES = ['livestock', 'milk', 'crop', 'product', 'service', 'other'];
/** Transiciones permitidas de la máquina de estados de una venta. */
const TRANSITIONS: Record<string, string[]> = {
  draft: ['confirmed', 'delivered', 'canceled'],
  confirmed: ['delivered', 'canceled'],
  delivered: ['invoiced', 'paid'],
  invoiced: ['paid'],
  paid: [],
  canceled: [],
};

interface LineInput extends DocumentLineInput {
  item_id?: string | null;
  animal_id?: string | null;
  description?: string | null;
  weight_kg?: number | null;
}

/**
 * Ventas (C-3): cabecera + líneas con totales DERIVADOS (misma regla única que compras), máquina de
 * estados y doble gancho al pasar a `delivered`: líneas de ítem → movimiento `out` de stock
 * (InventoryService.recordMovementInTx); líneas de animal → transición a `sold` que CONVERGE en
 * devices (AnimalStatusService, regla única). Todo atómico e idempotente.
 */
@Injectable()
export class SalesService {
  constructor(
    private readonly db: DbService,
    private readonly inventory: InventoryService,
    private readonly animalStatus: AnimalStatusService,
  ) {}

  private async resolveCompany(): Promise<{ id: string; currency: string }> {
    const c = await this.db.one<{ id: string; currency: string }>(`SELECT id, functional_currency AS currency FROM companies WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1`, [this.db.tenant]);
    if (!c) throw new BadRequestException({ code: 'commerce.no_company', title: 'El tenant no tiene una empresa configurada' });
    return c;
  }

  private async requireCustomer(partnerId: string): Promise<void> {
    const p = await this.db.one<{ id: string }>(
      `SELECT p.id FROM business_partners p JOIN customers c ON c.partner_id = p.id AND c.deleted_at IS NULL
       WHERE p.id=$1 AND p.tenant_id=$2 AND p.deleted_at IS NULL AND p.type IN ('customer','both')`,
      [partnerId, this.db.tenant],
    );
    if (!p) throw new BadRequestException({ code: 'commerce.not_a_customer', title: 'El socio no es un cliente vigente' });
  }

  private parseLines(raw: any): { lines: LineInput[]; totals: ReturnType<typeof computeDocumentTotals> } {
    if (!Array.isArray(raw) || raw.length === 0) throw new BadRequestException({ code: 'commerce.no_lines', title: 'La venta necesita al menos una línea' });
    const lines: LineInput[] = raw.map((l: any) => {
      const quantity = Number(l?.quantity);
      const unit_price = Number(l?.unit_price);
      const tax_rate = l?.tax_rate != null ? Number(l.tax_rate) : 0;
      if (!Number.isFinite(quantity) || quantity <= 0) throw new BadRequestException({ code: 'commerce.invalid_quantity', title: 'quantity debe ser positiva' });
      if (!Number.isFinite(unit_price) || unit_price < 0) throw new BadRequestException({ code: 'commerce.invalid_unit_price', title: 'unit_price debe ser ≥ 0' });
      if (!Number.isFinite(tax_rate) || tax_rate < 0) throw new BadRequestException({ code: 'commerce.invalid_tax_rate', title: 'tax_rate debe ser ≥ 0 (fracción)' });
      if (!l?.item_id && !l?.animal_id) throw new BadRequestException({ code: 'commerce.line_target', title: 'Cada línea requiere item_id o animal_id' });
      return { quantity, unit_price, tax_rate, item_id: l.item_id ?? null, animal_id: l.animal_id ?? null, description: l.description ?? null, weight_kg: l.weight_kg ?? null };
    });
    return { lines, totals: computeDocumentTotals(lines) };
  }

  async create(body: any) {
    const customerId = body?.customer_partner_id;
    if (!customerId) throw new BadRequestException({ code: 'commerce.missing_customer', title: 'customer_partner_id es obligatorio' });
    await this.requireCustomer(customerId);
    const type = body?.type;
    if (!SALE_TYPES.includes(type)) throw new BadRequestException({ code: 'commerce.invalid_sale_type', title: `type inválido (${SALE_TYPES.join('|')})` });
    const { lines, totals } = this.parseLines(body?.lines);
    const company = await this.resolveCompany();
    const currency = (body?.currency ?? company.currency) as string;
    const saleDate = body?.sale_date ?? await this.db.today();
    const t = this.db.tenant;

    return this.db.tx(async (q) => {
      const sale = await q.one<{ id: string }>(
        `INSERT INTO sales (tenant_id, company_id, customer_partner_id, document_number, sale_date, type, currency, subtotal, tax_total, total, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',$11) RETURNING id`,
        [t, company.id, customerId, body?.document_number ?? null, saleDate, type, currency, totals.subtotal, totals.tax_total, totals.total, this.db.user],
      );
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        await q.query(
          `INSERT INTO sale_lines (tenant_id, sale_id, item_id, animal_id, description, quantity, unit_price, weight_kg, tax_rate, line_total, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [t, sale!.id, l.item_id ?? null, l.animal_id ?? null, l.description ?? null, l.quantity, l.unit_price, l.weight_kg ?? null, l.tax_rate ?? 0, totals.lines[i].line_total, this.db.user],
        );
      }
      return this.getInTx(q, sale!.id);
    });
  }

  async updateStatus(id: string, next: string) {
    if (!STATUSES.includes(next)) throw new BadRequestException({ code: 'commerce.invalid_status', title: `status inválido (${STATUSES.join('|')})` });
    const t = this.db.tenant;
    return this.db.tx(async (q) => {
      const s = await q.one<{ id: string; status: string }>(`SELECT id, status FROM sales WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, t]);
      if (!s) throw new NotFoundException({ code: 'commerce.sale_not_found', title: 'Venta no encontrada' });
      if (s.status === next) return this.getInTx(q, id); // idempotente: sin cambios
      if (!TRANSITIONS[s.status]?.includes(next)) {
        throw new ConflictException({ code: 'commerce.invalid_transition', title: `No se puede pasar de '${s.status}' a '${next}'` });
      }
      if (next === 'delivered') await this.deliver(q, id);
      await q.query(`UPDATE sales SET status=$1, updated_at=now() WHERE id=$2 AND tenant_id=$3`, [next, id, t]);
      return this.getInTx(q, id);
    });
  }

  /**
   * Efectos de la entrega (idempotente): líneas de ítem → `out` de stock (sin saldo → 403); líneas de
   * animal → transición a `sold` (converge en devices). El guard de stock ya existente y el de
   * `active` de AnimalStatusService protegen; si algo falla, la tx revierte y el estado no cambia.
   */
  private async deliver(q: Q, saleId: string) {
    const t = this.db.tenant;
    const already = await q.one<{ n: number }>(`SELECT count(*)::int AS n FROM stock_movements WHERE tenant_id=$1 AND reference_type='sale' AND reference_id=$2`, [t, saleId]);
    const stockDone = (already?.n ?? 0) > 0;
    const lines = await q.query<{ item_id: string | null; animal_id: string | null; quantity: number }>(
      `SELECT item_id, animal_id, quantity::float AS quantity FROM sale_lines WHERE sale_id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [saleId, t],
    );
    for (const l of lines) {
      if (l.item_id) {
        if (stockDone) continue; // ya entregada: no duplicar el out de stock
        // Sin warehouse por línea en ventas: se descuenta del depósito por defecto del tenant.
        const wh = await q.one<{ id: string }>(`SELECT id FROM warehouses WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1`, [t]);
        if (!wh) throw new BadRequestException({ code: 'commerce.no_warehouse', title: 'No hay depósito para descontar el stock' });
        await this.inventory.recordMovementInTx(q, {
          item_id: l.item_id,
          warehouse_id: wh.id,
          movement_type: 'out',
          quantity: -Math.abs(l.quantity),
          reference_type: 'sale',
          reference_id: saleId,
        });
      } else if (l.animal_id) {
        // Transición a `sold`; el guard de AnimalStatusService (status='active') hace idempotente/seguro
        // el reintento: un animal ya sold lanzaría 409, pero la re-entrega es no-op antes de llegar acá.
        await this.animalStatus.transition(q, {
          animalId: l.animal_id,
          toStatus: 'sold',
          timelineEventType: 'sale',
          payload: { sale_id: saleId },
          originRef: `sale:${saleId}`,
          emitServerOrigin: true,
        });
      }
    }
  }

  /**
   * Certificaciones de la venta (Fase 3.3): avisa ANTES de cerrarla, no en el control.
   *
   * Hoy el problema aparece tarde — la venta se cierra, los animales salen, y recién ahí se descubre
   * que la certificación estaba vencida o que ese lote nunca estuvo cubierto. El dato estaba cargado
   * en el sistema desde hacía meses; lo único que faltaba era mirarlo en el momento correcto.
   *
   * La cobertura es POLIMÓRFICA y se expande acá: una certificación de finca ampara a todos sus
   * animales, una de lote a los del lote, y una de animal a ése. Resolverlo en la consulta y no en
   * el dominio es deliberado — es una pregunta sobre cómo están guardados los datos, no una regla
   * de negocio.
   *
   * NUNCA bloquea. El sistema no sabe qué le exige el comprador; sabe qué esquemas mantiene la
   * finca y cuáles no cubren esta venta. La decisión sigue siendo del productor.
   */
  async certifications(saleId: string) {
    const t = this.db.tenant;
    const sale = await this.db.one<{ id: string; sale_date: string }>(
      `SELECT id, sale_date::text AS sale_date FROM sales WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [saleId, t],
    );
    if (!sale) throw new NotFoundException({ code: 'commerce.sale_not_found', title: 'Venta no encontrada' });

    const animales = await this.db.query<{ animal_id: string; tag: string | null }>(
      `SELECT DISTINCT sl.animal_id, ai.value AS tag
         FROM sale_lines sl
         LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = sl.animal_id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) ai ON true
        WHERE sl.sale_id=$1 AND sl.tenant_id=$2 AND sl.deleted_at IS NULL AND sl.animal_id IS NOT NULL`,
      [saleId, t],
    );
    // Una venta de insumos o de leche no tiene animales que certificar: contestar «sin cobertura»
    // sería un aviso sobre algo que no existe.
    if (animales.length === 0) return { sale_id: saleId, sale_date: sale.sale_date, animals: 0, hasWarnings: false, schemes: [] };

    const ids = animales.map((a) => a.animal_id);
    const [esquemas, cobertura] = await Promise.all([
      this.db.query<{ scheme: string }>(
        `SELECT DISTINCT scheme FROM certifications WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY scheme`,
        [t],
      ),
      this.db.query<any>(
        `SELECT c.scheme, a.id AS animal_id, c.entity_type AS scope, c.status, c.valid_until::text AS valid_until
           FROM certifications c
           JOIN animals a ON a.tenant_id = c.tenant_id AND a.deleted_at IS NULL AND a.id = ANY($2::uuid[])
            AND ( (c.entity_type = 'animal' AND c.entity_id = a.id)
               OR (c.entity_type = 'lot'    AND c.entity_id = a.current_lot_id)
               OR (c.entity_type = 'farm'   AND c.entity_id = a.farm_id) )
          WHERE c.tenant_id = $1 AND c.deleted_at IS NULL`,
        [t, ids],
      ),
    ]);

    const check = assessSaleCertifications({
      saleDate: sale.sale_date,
      animalIds: ids,
      schemes: esquemas.map((e) => e.scheme),
      coverage: cobertura.map((c) => ({ scheme: c.scheme, animalId: c.animal_id, scope: c.scope, status: c.status, validUntil: c.valid_until })),
    });

    // Las caravanas y no los uuid: el aviso lo lee alguien que tiene que ir a buscar esos animales.
    const caravana = new Map(animales.map((a) => [a.animal_id, a.tag]));
    return {
      sale_id: saleId,
      sale_date: sale.sale_date,
      animals: ids.length,
      hasWarnings: check.hasWarnings,
      schemes: check.schemes.map((s) => ({ ...s, uncoveredTags: s.uncoveredAnimalIds.map((id) => caravana.get(id) ?? '—') })),
    };
  }

  // ── Lectura ──────────────────────────────────────────────────────────────
  async list(status?: string) {
    const params: unknown[] = [this.db.tenant];
    let filter = '';
    if (status && STATUSES.includes(status)) {
      params.push(status);
      filter = ` AND sa.status = $${params.length}`;
    }
    return this.db.query(
      `SELECT sa.id, sa.document_number, sa.sale_date, sa.type, sa.currency, sa.total::float AS total, sa.status, p.name AS customer_name
       FROM sales sa JOIN business_partners p ON p.id = sa.customer_partner_id
       WHERE sa.tenant_id = $1 AND sa.deleted_at IS NULL${filter}
       ORDER BY sa.sale_date DESC, sa.created_at DESC LIMIT 200`,
      params,
    );
  }

  async get(id: string) {
    return this.getInTx(this.db, id);
  }

  /** Sella el asiento generado (F-2) en la venta, dentro de la tx del posteo. */
  async attachJournalEntry(q: Q, id: string, entryId: string) {
    await q.query(`UPDATE sales SET journal_entry_id=$1, updated_at=now() WHERE id=$2 AND tenant_id=$3`, [entryId, id, this.db.tenant]);
  }

  private async getInTx(e: Q, id: string) {
    const sale = await e.one(
      `SELECT sa.id, sa.document_number, sa.sale_date, sa.type, sa.currency, sa.subtotal::float AS subtotal, sa.tax_total::float AS tax_total,
              sa.total::float AS total, sa.status, sa.journal_entry_id, sa.customer_partner_id, p.name AS customer_name
       FROM sales sa JOIN business_partners p ON p.id = sa.customer_partner_id
       WHERE sa.id=$1 AND sa.tenant_id=$2 AND sa.deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!sale) throw new NotFoundException({ code: 'commerce.sale_not_found', title: 'Venta no encontrada' });
    const lines = await e.query(
      `SELECT id, item_id, animal_id, description, quantity::float AS quantity, unit_price::float AS unit_price, weight_kg::float AS weight_kg, tax_rate::float AS tax_rate, line_total::float AS line_total
       FROM sale_lines WHERE sale_id=$1 AND tenant_id=$2 AND deleted_at IS NULL ORDER BY created_at`,
      [id, this.db.tenant],
    );
    return { ...sale, lines };
  }
}
