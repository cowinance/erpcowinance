import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, Q } from '../../db/db.service';
import { AccountsService } from './accounts.service';

const STATUSES = ['draft', 'approved', 'closed'];
/** Transiciones permitidas del ciclo de un presupuesto. */
const TRANSITIONS: Record<string, string[]> = {
  draft: ['approved'],
  approved: ['closed'],
  closed: [],
};

/**
 * Finanzas — presupuestos (BG-1): `budgets` (año fiscal, estados) + `budget_lines` (monto por CUENTA ×
 * MES, con centro de costo opcional). Las líneas se cargan EN BLOQUE (reemplazo atómico) y solo mientras
 * el presupuesto está en `draft`. El comparativo contra el real (journal_lines) llega en BG-2.
 *
 * El signo de `amount` no define ingreso/gasto: eso lo da el TIPO de la cuenta imputada.
 */
@Injectable()
export class BudgetsService {
  constructor(
    private readonly db: DbService,
    private readonly accounts: AccountsService,
  ) {}

  async list(status?: string) {
    const params: unknown[] = [this.db.tenant];
    let filter = '';
    if (STATUSES.includes(status ?? '')) {
      params.push(status);
      filter = ` AND b.status = $${params.length}`;
    }
    return this.db.query(
      `SELECT b.id, b.name, b.fiscal_year, b.status,
              (SELECT COALESCE(SUM(l.amount),0)::float FROM budget_lines l WHERE l.budget_id = b.id AND l.deleted_at IS NULL) AS total
       FROM budgets b WHERE b.tenant_id=$1 AND b.deleted_at IS NULL${filter} ORDER BY b.fiscal_year DESC, b.created_at DESC LIMIT 200`,
      params,
    );
  }

  async get(id: string) {
    return this.getInTx(this.db, id);
  }

  async create(body: any) {
    const name = String(body?.name ?? '').trim();
    if (!name) throw new BadRequestException({ code: 'finance.missing_name', title: 'name es obligatorio' });
    const year = Number(body?.fiscal_year);
    if (!Number.isInteger(year) || year < 1900 || year > 9999) throw new BadRequestException({ code: 'finance.invalid_year', title: 'fiscal_year debe ser un año válido' });
    return this.db.one(
      `INSERT INTO budgets (tenant_id, company_id, name, fiscal_year, status, created_by)
       VALUES ($1,$2,$3,$4,'draft',$5) RETURNING id, name, fiscal_year, status`,
      [this.db.tenant, await this.accounts.companyId(), name, year, this.db.user],
    );
  }

  /**
   * Reemplaza EN BLOQUE las líneas del presupuesto (atómico). Solo en `draft`: un presupuesto aprobado
   * o cerrado no se edita (409). Valida cuenta imputable/de la company, centro de costo y mes 1..12.
   */
  async setLines(id: string, body: any) {
    const raw = Array.isArray(body?.lines) ? body.lines : null;
    if (!raw) throw new BadRequestException({ code: 'finance.missing_lines', title: 'lines debe ser un array' });
    const t = this.db.tenant;
    const budget = await this.db.one<{ id: string; status: string }>(`SELECT id, status FROM budgets WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, t]);
    if (!budget) throw new NotFoundException({ code: 'finance.budget_not_found', title: 'Presupuesto no encontrado' });
    if (budget.status !== 'draft') throw new ConflictException({ code: 'finance.budget_not_draft', title: `Solo se editan las líneas de un presupuesto en borrador (estado: ${budget.status})` });

    const companyId = await this.accounts.companyId();
    const lines: { account_id: string; cost_center_id: string | null; month: number; amount: number }[] = [];
    for (const l of raw) {
      const month = Number(l?.month);
      if (!Number.isInteger(month) || month < 1 || month > 12) throw new BadRequestException({ code: 'finance.invalid_month', title: 'month debe estar entre 1 y 12' });
      const amount = Number(l?.amount);
      if (!Number.isFinite(amount)) throw new BadRequestException({ code: 'finance.invalid_amount', title: 'amount debe ser un número' });
      const acc = await this.db.one<{ id: string; is_postable: boolean }>(`SELECT id, is_postable FROM chart_of_accounts WHERE id=$1 AND tenant_id=$2 AND company_id=$3 AND deleted_at IS NULL`, [l?.account_id, t, companyId]);
      if (!acc) throw new NotFoundException({ code: 'finance.account_not_found', title: `Cuenta ${l?.account_id} no encontrada` });
      if (!acc.is_postable) throw new BadRequestException({ code: 'finance.account_not_postable', title: `La cuenta ${l?.account_id} no es imputable` });
      if (l?.cost_center_id) {
        const cc = await this.db.one<{ id: string }>(`SELECT id FROM cost_centers WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [l.cost_center_id, t]);
        if (!cc) throw new NotFoundException({ code: 'finance.cost_center_not_found', title: 'Centro de costo no encontrado' });
      }
      lines.push({ account_id: l.account_id, cost_center_id: l.cost_center_id ?? null, month, amount });
    }

    return this.db.tx(async (q) => {
      await q.query(`UPDATE budget_lines SET deleted_at=now() WHERE budget_id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, t]);
      for (const l of lines) {
        await q.query(
          `INSERT INTO budget_lines (tenant_id, budget_id, account_id, cost_center_id, month, amount, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [t, id, l.account_id, l.cost_center_id, l.month, l.amount, this.db.user],
        );
      }
      return this.getInTx(q, id);
    });
  }

  async updateStatus(id: string, next: string) {
    if (!STATUSES.includes(next)) throw new BadRequestException({ code: 'finance.invalid_status', title: `status inválido (${STATUSES.join('|')})` });
    const t = this.db.tenant;
    const b = await this.db.one<{ id: string; status: string }>(`SELECT id, status FROM budgets WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, t]);
    if (!b) throw new NotFoundException({ code: 'finance.budget_not_found', title: 'Presupuesto no encontrado' });
    if (b.status === next) return this.get(id); // idempotente
    if (!TRANSITIONS[b.status]?.includes(next)) throw new ConflictException({ code: 'finance.invalid_transition', title: `No se puede pasar de '${b.status}' a '${next}'` });
    await this.db.query(`UPDATE budgets SET status=$1, updated_at=now() WHERE id=$2 AND tenant_id=$3`, [next, id, t]);
    return this.get(id);
  }

  async remove(id: string) {
    const row = await this.db.one<{ id: string }>(`UPDATE budgets SET deleted_at=now(), updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL RETURNING id`, [id, this.db.tenant]);
    if (!row) throw new NotFoundException({ code: 'finance.budget_not_found', title: 'Presupuesto no encontrado' });
    return { id, deleted: true };
  }

  private async getInTx(e: Q, id: string) {
    const budget = await e.one(`SELECT id, name, fiscal_year, status FROM budgets WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, this.db.tenant]);
    if (!budget) throw new NotFoundException({ code: 'finance.budget_not_found', title: 'Presupuesto no encontrado' });
    const lines = await e.query(
      `SELECT l.id, l.account_id, a.code AS account_code, a.name AS account_name, l.cost_center_id, l.month, l.amount::float AS amount
       FROM budget_lines l JOIN chart_of_accounts a ON a.id = l.account_id
       WHERE l.budget_id=$1 AND l.tenant_id=$2 AND l.deleted_at IS NULL ORDER BY a.code, l.month`,
      [id, this.db.tenant],
    );
    return { ...budget, lines };
  }
}
