import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { computePayrollTotals, InvalidPayrollError } from '@cowinance/domain';
import { DbService, Q } from '../../db/db.service';
import { LedgerService } from '../finance/ledger.service';
import { PostingService } from '../finance/posting.service';

const STATUSES = ['draft', 'approved', 'paid'];
const TRANSITIONS: Record<string, string[]> = { draft: ['approved'], approved: ['paid'], paid: [] };

/**
 * Liquidaciones de sueldos (H-2): payroll_runs + payroll_items. Al APROBAR postea el devengado (D
 * sueldos, H a pagar, H retenciones) reusando LedgerService.createEntryInTx + el mapa de roles; al
 * PAGAR postea la caja (D a pagar, H caja). Idempotente por transición. Balancea por construcción
 * (gross = net + deductions).
 */
@Injectable()
export class PayrollService {
  constructor(
    private readonly db: DbService,
    private readonly ledger: LedgerService,
    private readonly posting: PostingService,
  ) {}

  private async companyId(): Promise<string> {
    const c = await this.db.one<{ id: string }>(`SELECT id FROM companies WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1`, [this.db.tenant]);
    if (!c) throw new BadRequestException({ code: 'hr.no_company', title: 'El tenant no tiene una empresa configurada' });
    return c.id;
  }

  async create(body: any) {
    const period = body?.period;
    if (!period) throw new BadRequestException({ code: 'hr.missing_period', title: 'period es obligatorio' });
    const rawItems = Array.isArray(body?.items) ? body.items : [];
    let totals;
    try {
      totals = computePayrollTotals(rawItems.map((i: any) => ({ gross: Number(i?.gross), deductions: Number(i?.deductions ?? 0) })));
    } catch (e) {
      if (e instanceof InvalidPayrollError) throw new BadRequestException({ code: 'hr.invalid_payroll', title: e.reason });
      throw e;
    }
    const t = this.db.tenant;
    // Cada empleado debe existir, estar activo y ser del tenant.
    for (const it of rawItems) {
      const emp = await this.db.one<{ id: string }>(`SELECT id FROM employees WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL AND is_active`, [it?.employee_id, t]);
      if (!emp) throw new NotFoundException({ code: 'hr.employee_not_found', title: `Empleado no encontrado o inactivo: ${it?.employee_id}` });
    }
    const companyId = await this.companyId();

    return this.db.tx(async (q) => {
      const run = await q.one<{ id: string }>(
        `INSERT INTO payroll_runs (tenant_id, company_id, period, status, total_amount, created_by) VALUES ($1,$2,$3,'draft',$4,$5) RETURNING id`,
        [t, companyId, period, totals.totalGross, this.db.user],
      );
      for (let i = 0; i < rawItems.length; i++) {
        const it = rawItems[i];
        await q.query(
          `INSERT INTO payroll_items (tenant_id, payroll_run_id, employee_id, gross, deductions, net, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [t, run!.id, it.employee_id, Number(it.gross), Number(it.deductions ?? 0), totals.nets[i], this.db.user],
        );
      }
      return this.getInTx(q, run!.id);
    });
  }

  async updateStatus(id: string, next: string) {
    if (!STATUSES.includes(next)) throw new BadRequestException({ code: 'hr.invalid_status', title: `status inválido (${STATUSES.join('|')})` });
    const map = await this.posting.getPostingAccounts();
    const t = this.db.tenant;
    return this.db.tx(async (q) => {
      const run = await q.one<{ id: string; status: string; period: string }>(`SELECT id, status, period FROM payroll_runs WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, t]);
      if (!run) throw new NotFoundException({ code: 'hr.payroll_not_found', title: 'Liquidación no encontrada' });
      if (run.status === next) return this.getInTx(q, id); // idempotente
      if (!TRANSITIONS[run.status]?.includes(next)) throw new ConflictException({ code: 'hr.invalid_transition', title: `No se puede pasar de '${run.status}' a '${next}'` });

      const sums = await q.one<{ gross: number; net: number; ded: number }>(
        `SELECT COALESCE(SUM(gross),0)::float AS gross, COALESCE(SUM(net),0)::float AS net, COALESCE(SUM(deductions),0)::float AS ded
         FROM payroll_items WHERE payroll_run_id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
        [id, t],
      );
      if (next === 'approved') {
        const entry = await this.postAccrual(q, id, run.period, sums!, map);
        await q.query(`UPDATE payroll_runs SET journal_entry_id=$1 WHERE id=$2 AND tenant_id=$3`, [entry, id, t]);
      } else if (next === 'paid') {
        await this.postPayment(q, id, run.period, sums!.net, map);
      }
      await q.query(`UPDATE payroll_runs SET status=$1, updated_at=now() WHERE id=$2 AND tenant_id=$3`, [next, id, t]);
      return this.getInTx(q, id);
    });
  }

  /** Devengado: D sueldos=Σgross · H a pagar=Σnet · H retenciones=Σdeductions (si>0). Devuelve el asiento. */
  private async postAccrual(q: Q, runId: string, period: string, sums: { gross: number; net: number; ded: number }, map: Record<string, string | undefined>): Promise<string> {
    this.requireRoles(map, sums.ded > 0 ? ['salary_expense', 'salaries_payable', 'payroll_withholdings'] : ['salary_expense', 'salaries_payable']);
    const lines: any[] = [
      { account_id: map.salary_expense, debit: sums.gross, description: 'Sueldos y jornales' },
      { account_id: map.salaries_payable, credit: sums.net, description: 'Remuneraciones a pagar' },
    ];
    if (sums.ded > 0) lines.push({ account_id: map.payroll_withholdings, credit: sums.ded, description: 'Retenciones a pagar' });
    const entry: any = await this.ledger.createEntryInTx(q, { entry_date: period, reference: `Nómina ${period}`, source_type: 'payroll', source_id: runId, lines });
    return entry.id;
  }

  /** Pago: D a pagar=Σnet · H caja=Σnet. */
  private async postPayment(q: Q, runId: string, period: string, net: number, map: Record<string, string | undefined>) {
    this.requireRoles(map, ['salaries_payable', 'cash']);
    const lines = [
      { account_id: map.salaries_payable, debit: net, description: 'Cancelación remuneraciones' },
      { account_id: map.cash, credit: net, description: 'Pago de sueldos' },
    ];
    await this.ledger.createEntryInTx(q, { entry_date: period, reference: `Pago nómina ${period}`, source_type: 'payroll_payment', source_id: runId, lines });
  }

  private requireRoles(map: Record<string, string | undefined>, roles: string[]) {
    const missing = roles.filter((r) => !map[r]);
    if (missing.length) throw new BadRequestException({ code: 'hr.missing_roles', title: `Faltan cuentas para los roles: ${missing.join(', ')}. Configurá el mapa de posteo.` });
  }

  async list(status?: string) {
    const params: unknown[] = [this.db.tenant];
    let filter = '';
    if (STATUSES.includes(status ?? '')) {
      params.push(status);
      filter = ` AND status = $${params.length}`;
    }
    return this.db.query(
      `SELECT id, period, status, total_amount::float AS total_amount, journal_entry_id
       FROM payroll_runs WHERE tenant_id=$1 AND deleted_at IS NULL${filter} ORDER BY period DESC, created_at DESC LIMIT 200`,
      params,
    );
  }

  async get(id: string) {
    return this.getInTx(this.db, id);
  }

  private async getInTx(e: Q, id: string) {
    const run = await e.one(`SELECT id, period, status, total_amount::float AS total_amount, journal_entry_id FROM payroll_runs WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, this.db.tenant]);
    if (!run) throw new NotFoundException({ code: 'hr.payroll_not_found', title: 'Liquidación no encontrada' });
    const items = await e.query(
      `SELECT pi.id, pi.employee_id, em.full_name, pi.gross::float AS gross, pi.deductions::float AS deductions, pi.net::float AS net
       FROM payroll_items pi JOIN employees em ON em.id = pi.employee_id WHERE pi.payroll_run_id=$1 AND pi.tenant_id=$2 AND pi.deleted_at IS NULL ORDER BY em.full_name`,
      [id, this.db.tenant],
    );
    return { ...run, items };
  }
}
