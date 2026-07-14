import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, Q } from '../../db/db.service';
import { LedgerService } from './ledger.service';
import { PostingService } from './posting.service';

const DIRECTIONS = ['inbound', 'outbound'];
const METHODS = ['cash', 'transfer', 'check', 'card', 'other'];
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

interface Allocation {
  invoice_id: string;
  amount: number;
}

/**
 * Pagos + imputaciones + asiento de CAJA (F-3b). Un pago cobra (inbound) o paga (outbound) y se imputa
 * a facturas; en una sola tx: inserta el pago, las imputaciones, marca `paid` las facturas saldadas y
 * postea el asiento de caja reusando LedgerService.createEntryInTx (regla única de asientos).
 *
 * Devengado ya asentado por F-2 (documento). Acá solo se mueve la CAJA:
 *  - cobro (inbound):  D banco/caja = monto · H clientes (receivable) = monto
 *  - pago  (outbound): D proveedores (payable) = monto · H banco/caja = monto
 * La cuenta de caja: `bank_accounts.ledger_account_id` si hay `account_id`, si no el rol `cash` del mapa.
 *
 * Regla de topes: cada imputación ≤ saldo de su factura, y Σ imputaciones == monto del pago (sin
 * anticipos «a cuenta» en F-3b). Anular/revertir un pago queda diferido.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly db: DbService,
    private readonly ledger: LedgerService,
    private readonly posting: PostingService,
  ) {}

  async createPayment(body: any) {
    const direction = body?.direction;
    if (!DIRECTIONS.includes(direction)) throw new BadRequestException({ code: 'finance.invalid_direction', title: `direction inválida (${DIRECTIONS.join('|')})` });
    const method = body?.method;
    if (method != null && !METHODS.includes(method)) throw new BadRequestException({ code: 'finance.invalid_method', title: `method inválido (${METHODS.join('|')})` });
    const amount = round2(Number(body?.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException({ code: 'finance.invalid_amount', title: 'amount debe ser positivo' });
    const rawAllocs = Array.isArray(body?.allocations) ? body.allocations : [];
    if (rawAllocs.length === 0) throw new BadRequestException({ code: 'finance.no_allocations', title: 'El pago necesita al menos una imputación' });
    const allocations: Allocation[] = rawAllocs.map((a: any) => ({ invoice_id: a?.invoice_id, amount: round2(Number(a?.amount)) }));
    for (const a of allocations) {
      if (!a.invoice_id) throw new BadRequestException({ code: 'finance.alloc_no_invoice', title: 'Cada imputación necesita invoice_id' });
      if (!Number.isFinite(a.amount) || a.amount <= 0) throw new BadRequestException({ code: 'finance.alloc_invalid_amount', title: 'El monto de la imputación debe ser positivo' });
    }
    const allocated = round2(allocations.reduce((s, a) => s + a.amount, 0));
    if (allocated !== amount) throw new BadRequestException({ code: 'finance.alloc_mismatch', title: `La suma de imputaciones (${allocated}) debe igualar el monto del pago (${amount})` });

    const map = await this.posting.getPostingAccounts();
    const counterRole = direction === 'inbound' ? 'receivable' : 'payable';
    const counterAccount = map[counterRole];
    if (!counterAccount) throw new BadRequestException({ code: 'finance.missing_roles', title: `Falta la cuenta del rol '${counterRole}'. Configurá el mapa de posteo.` });
    // Cuenta de tesorería (chart_of_accounts): la del banco elegido o el rol `cash`. Va en payments.account_id.
    const cashAccount = await this.resolveCashAccount(body?.bank_account_id, map);
    const wantDirection = direction === 'inbound' ? 'issued' : 'received';
    const t = this.db.tenant;
    const companyId = await this.companyId();
    const currency = await this.currency(companyId);
    const paymentDate = body?.payment_date ?? new Date().toISOString().slice(0, 10);

    return this.db.tx(async (q) => {
      const payment = await q.one<{ id: string }>(
        `INSERT INTO payments (tenant_id, company_id, direction, partner_id, payment_date, amount, currency, method, account_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [t, companyId, direction, body?.partner_id ?? null, paymentDate, amount, currency, method ?? null, cashAccount, this.db.user],
      );
      for (const a of allocations) {
        await this.applyAllocation(q, payment!.id, a, wantDirection, body?.partner_id ?? null);
      }
      // Asiento de caja (reusa la regla única de asientos): entry_date en período abierto.
      const lines =
        direction === 'inbound'
          ? [{ account_id: cashAccount, debit: amount, description: 'Cobro' }, { account_id: counterAccount, credit: amount, description: 'Clientes' }]
          : [{ account_id: counterAccount, debit: amount, description: 'Proveedores' }, { account_id: cashAccount, credit: amount, description: 'Pago' }];
      const entry: any = await this.ledger.createEntryInTx(q, { entry_date: paymentDate, reference: `Pago ${payment!.id}`, source_type: 'payment', source_id: payment!.id, lines });
      await q.query(`UPDATE payments SET journal_entry_id=$1, updated_at=now() WHERE id=$2 AND tenant_id=$3`, [entry.id, payment!.id, t]);
      return this.getInTx(q, payment!.id);
    });
  }

  /** Imputa a UNA factura: valida dirección, saldo pendiente y partner; inserta y marca `paid` si salda. */
  private async applyAllocation(q: Q, paymentId: string, alloc: Allocation, wantDirection: string, partnerId: string | null) {
    const t = this.db.tenant;
    const inv = await q.one<{ id: string; direction: string; status: string; total: number; partner_id: string }>(
      `SELECT id, direction, status, total::float AS total, partner_id FROM invoices WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`,
      [alloc.invoice_id, t],
    );
    if (!inv) throw new NotFoundException({ code: 'finance.invoice_not_found', title: 'Factura no encontrada' });
    if (inv.status === 'void') throw new ConflictException({ code: 'finance.invoice_void', title: 'La factura está anulada' });
    if (inv.direction !== wantDirection) throw new BadRequestException({ code: 'finance.direction_mismatch', title: `La factura ${inv.id} no es del tipo esperado (${wantDirection})` });
    if (partnerId && inv.partner_id !== partnerId) throw new BadRequestException({ code: 'finance.partner_mismatch', title: 'La factura pertenece a otro socio' });
    const prev = await q.one<{ s: number }>(`SELECT COALESCE(SUM(amount),0)::float AS s FROM payment_allocations WHERE invoice_id=$1 AND deleted_at IS NULL`, [alloc.invoice_id]);
    const outstanding = round2(inv.total - (prev?.s ?? 0));
    if (alloc.amount > outstanding) throw new BadRequestException({ code: 'finance.over_allocation', title: `La imputación (${alloc.amount}) supera el saldo de la factura (${outstanding})` });
    await q.query(`INSERT INTO payment_allocations (tenant_id, payment_id, invoice_id, amount, created_by) VALUES ($1,$2,$3,$4,$5)`, [t, paymentId, alloc.invoice_id, alloc.amount, this.db.user]);
    if (round2(outstanding - alloc.amount) === 0) {
      await q.query(`UPDATE invoices SET status='paid', updated_at=now() WHERE id=$1 AND tenant_id=$2`, [alloc.invoice_id, t]);
    }
  }

  /** Cuenta contable de tesorería: la del banco elegido (su ledger) o el rol `cash` del mapa. */
  private async resolveCashAccount(bankAccountId: string | undefined, map: Record<string, string | undefined>): Promise<string> {
    if (bankAccountId) {
      const bank = await this.db.one<{ ledger_account_id: string | null }>(`SELECT ledger_account_id FROM bank_accounts WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [bankAccountId, this.db.tenant]);
      if (!bank) throw new NotFoundException({ code: 'finance.bank_not_found', title: 'Cuenta bancaria no encontrada' });
      if (!bank.ledger_account_id) throw new BadRequestException({ code: 'finance.bank_no_ledger', title: 'La cuenta bancaria no tiene cuenta contable asociada' });
      return bank.ledger_account_id;
    }
    if (!map.cash) throw new BadRequestException({ code: 'finance.missing_roles', title: "Falta la cuenta del rol 'cash' (o indicá una cuenta bancaria)." });
    return map.cash;
  }

  private async companyId(): Promise<string> {
    const c = await this.db.one<{ id: string }>(`SELECT id FROM companies WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1`, [this.db.tenant]);
    if (!c) throw new BadRequestException({ code: 'finance.no_company', title: 'El tenant no tiene una empresa configurada' });
    return c.id;
  }

  private async currency(companyId: string): Promise<string> {
    const c = await this.db.one<{ currency: string }>(`SELECT functional_currency AS currency FROM companies WHERE id=$1`, [companyId]);
    return c?.currency ?? 'USD';
  }

  async list(direction?: string) {
    const params: unknown[] = [this.db.tenant];
    let filter = '';
    if (DIRECTIONS.includes(direction ?? '')) {
      params.push(direction);
      filter = ` AND pm.direction = $${params.length}`;
    }
    return this.db.query(
      `SELECT pm.id, pm.direction, pm.payment_date, pm.amount::float AS amount, pm.currency, pm.method, pm.partner_id, p.name AS partner_name
       FROM payments pm LEFT JOIN business_partners p ON p.id = pm.partner_id
       WHERE pm.tenant_id=$1 AND pm.deleted_at IS NULL${filter} ORDER BY pm.payment_date DESC, pm.created_at DESC LIMIT 200`,
      params,
    );
  }

  async get(id: string) {
    return this.getInTx(this.db, id);
  }

  private async getInTx(e: Q, id: string) {
    const payment = await e.one(
      `SELECT id, direction, payment_date, amount::float AS amount, currency, method, partner_id, account_id, journal_entry_id
       FROM payments WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!payment) throw new NotFoundException({ code: 'finance.payment_not_found', title: 'Pago no encontrado' });
    const allocations = await e.query(
      `SELECT pa.id, pa.invoice_id, pa.amount::float AS amount, i.invoice_number, i.status AS invoice_status
       FROM payment_allocations pa JOIN invoices i ON i.id = pa.invoice_id
       WHERE pa.payment_id=$1 AND pa.tenant_id=$2 AND pa.deleted_at IS NULL ORDER BY pa.created_at`,
      [id, this.db.tenant],
    );
    return { ...payment, allocations };
  }
}
