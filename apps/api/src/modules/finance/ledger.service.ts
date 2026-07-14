import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { validateJournalBalance, UnbalancedJournalError, JournalLineInput } from '@cowinance/domain';
import { DbService, Q } from '../../db/db.service';

/**
 * REGLA ÚNICA de qué asientos cuentan para saldos y reportes (sumas y saldos, presupuesto vs real):
 * todos menos los borradores. Un asiento `reversed` **sigue contando**: su contra-asiento (posted) lo
 * cancela, así que el par neto es CERO. Excluirlo restaría la reversa dos veces (el original desaparece
 * Y el contra-asiento resta). El alias de `journal_entries` debe ser `je`.
 */
export const LEDGER_COUNTS = "je.status <> 'draft'";

/**
 * Finanzas — libro mayor (F-1): asientos de partida DOBLE. Regla única: el asiento balancea
 * (validateJournalBalance en @cowinance/domain). Se crea `posted` e INMUTABLE; corregir = reversa
 * (contra-asiento con débito/crédito invertidos + original a `reversed`). Postear exige un período
 * ABIERTO que contenga `entry_date`. Sumas y saldos derivan de journal_lines (fuente única).
 */
@Injectable()
export class LedgerService {
  constructor(private readonly db: DbService) {}

  /** Crea un asiento manual balanceado y posteado. `entry_date` debe caer en un período abierto. */
  async createEntry(body: any) {
    return this.db.tx((q) => this.createEntryInTx(q, body));
  }

  /**
   * Crea un asiento balanceado y posteado sobre la tx `q` recibida. Punto ÚNICO de creación de
   * asientos: los manuales (createEntry) y los automáticos desde documentos (F-2, PostingService)
   * lo reusan para postear + sellar en la misma tx. No abre transacción propia.
   */
  async createEntryInTx(q: Q, body: any) {
    let totals: { totalDebit: number; totalCredit: number };
    const rawLines: JournalLineInput[] = Array.isArray(body?.lines) ? body.lines : [];
    try {
      totals = validateJournalBalance(rawLines);
    } catch (e) {
      if (e instanceof UnbalancedJournalError) throw new BadRequestException({ code: 'finance.unbalanced', title: e.reason });
      throw e;
    }
    const entryDate = body?.entry_date;
    if (!entryDate) throw new BadRequestException({ code: 'finance.missing_date', title: 'entry_date es obligatorio' });
    const t = this.db.tenant;
    // Company + moneda vía `q` (no this.db): createEntryInTx corre dentro de tx propia o ajena.
    const company = await q.one<{ id: string; currency: string }>(`SELECT id, functional_currency AS currency FROM companies WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1`, [t]);
    if (!company) throw new BadRequestException({ code: 'finance.no_company', title: 'El tenant no tiene una empresa configurada' });
    const companyId = company.id;
    const currency = company.currency;

    const periodId = await this.requireOpenPeriod(q, companyId, entryDate);
    await this.requirePostableAccounts(q, companyId, rawLines);
    const entry = await q.one<{ id: string }>(
      `INSERT INTO journal_entries (tenant_id, company_id, period_id, entry_date, reference, source_type, source_id, currency, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'posted',$9) RETURNING id`,
      [t, companyId, periodId, entryDate, body?.reference ?? null, body?.source_type ?? null, body?.source_id ?? null, currency, this.db.user],
    );
    await this.insertLines(q, entry!.id, rawLines);
    return this.getInTx(q, entry!.id, totals);
  }

  /** Reversa: crea un contra-asiento (débito↔crédito) y marca el original `reversed`. Idempotente. */
  async reverseEntry(id: string, body: any) {
    const t = this.db.tenant;
    return this.db.tx(async (q) => {
      const entry = await q.one<{ id: string; status: string; company_id: string; currency: string }>(
        `SELECT id, status, company_id, currency FROM journal_entries WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`,
        [id, t],
      );
      if (!entry) throw new NotFoundException({ code: 'finance.entry_not_found', title: 'Asiento no encontrado' });
      if (entry.status === 'reversed') throw new ConflictException({ code: 'finance.already_reversed', title: 'El asiento ya fue reversado' });
      const entryDate = body?.entry_date ?? new Date().toISOString().slice(0, 10);
      const periodId = await this.requireOpenPeriod(q, entry.company_id, entryDate);
      const lines = await q.query<{ account_id: string; debit: number; credit: number; cost_center_id: string | null; description: string | null }>(
        `SELECT account_id, debit::float AS debit, credit::float AS credit, cost_center_id, description FROM journal_lines WHERE entry_id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
        [id, t],
      );
      const reversal = await q.one<{ id: string }>(
        `INSERT INTO journal_entries (tenant_id, company_id, period_id, entry_date, reference, source_type, source_id, currency, status, created_by)
         VALUES ($1,$2,$3,$4,$5,'reversal',$6,$7,'posted',$8) RETURNING id`,
        [t, entry.company_id, periodId, entryDate, `Reversa de ${id}`, id, entry.currency, this.db.user],
      );
      // Contra-asiento: débito↔crédito invertidos (sigue balanceando por construcción).
      const swapped: JournalLineInput[] = lines.map((l) => ({ account_id: l.account_id, debit: l.credit, credit: l.debit, cost_center_id: l.cost_center_id, description: l.description }));
      await this.insertLines(q, reversal!.id, swapped);
      await q.query(`UPDATE journal_entries SET status='reversed', updated_at=now() WHERE id=$1 AND tenant_id=$2`, [id, t]);
      return this.getInTx(q, reversal!.id);
    });
  }

  async list(status?: string) {
    const params: unknown[] = [this.db.tenant];
    let filter = '';
    if (status && ['draft', 'posted', 'reversed'].includes(status)) {
      params.push(status);
      filter = ` AND status = $${params.length}`;
    }
    return this.db.query(
      `SELECT id, entry_date, reference, source_type, source_id, status,
              (SELECT COALESCE(SUM(debit),0)::float FROM journal_lines jl WHERE jl.entry_id = je.id AND jl.deleted_at IS NULL) AS total
       FROM journal_entries je WHERE tenant_id=$1 AND deleted_at IS NULL${filter} ORDER BY entry_date DESC, created_at DESC LIMIT 200`,
      params,
    );
  }

  async get(id: string) {
    return this.getInTx(this.db, id);
  }

  /** Sumas y saldos: por cuenta postable, Σdébito/Σcrédito/saldo en un rango (opcional). Excluye reversados. */
  async trialBalance(from?: string, to?: string) {
    const params: unknown[] = [this.db.tenant];
    let dateFilter = '';
    if (from) {
      params.push(from);
      dateFilter += ` AND je.entry_date >= $${params.length}`;
    }
    if (to) {
      params.push(to);
      dateFilter += ` AND je.entry_date <= $${params.length}`;
    }
    return this.db.query(
      `SELECT a.id AS account_id, a.code, a.name, a.type,
              COALESCE(SUM(jl.debit),0)::float AS debit,
              COALESCE(SUM(jl.credit),0)::float AS credit,
              (COALESCE(SUM(jl.debit),0) - COALESCE(SUM(jl.credit),0))::float AS balance
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id AND je.deleted_at IS NULL AND ${LEDGER_COUNTS}${dateFilter}
       JOIN chart_of_accounts a ON a.id = jl.account_id
       WHERE jl.tenant_id = $1 AND jl.deleted_at IS NULL
       GROUP BY a.id, a.code, a.name, a.type
       HAVING COALESCE(SUM(jl.debit),0) <> 0 OR COALESCE(SUM(jl.credit),0) <> 0
       ORDER BY a.code`,
      params,
    );
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  /** Exige un período ABIERTO que contenga la fecha; devuelve su id. */
  private async requireOpenPeriod(q: Q, companyId: string, date: string): Promise<string> {
    const p = await q.one<{ id: string }>(
      `SELECT id FROM fiscal_periods WHERE tenant_id=$1 AND company_id=$2 AND deleted_at IS NULL AND status='open' AND $3 BETWEEN start_date AND end_date ORDER BY start_date LIMIT 1`,
      [this.db.tenant, companyId, date],
    );
    if (!p) throw new BadRequestException({ code: 'finance.no_open_period', title: `No hay un período fiscal abierto que contenga la fecha ${date}` });
    return p.id;
  }

  /** Cada cuenta debe existir, ser postable y pertenecer a la company. */
  private async requirePostableAccounts(q: Q, companyId: string, lines: JournalLineInput[]) {
    for (const l of lines) {
      const a = await q.one<{ id: string; is_postable: boolean }>(`SELECT id, is_postable FROM chart_of_accounts WHERE id=$1 AND tenant_id=$2 AND company_id=$3 AND deleted_at IS NULL`, [l.account_id, this.db.tenant, companyId]);
      if (!a) throw new BadRequestException({ code: 'finance.account_not_found', title: `Cuenta ${l.account_id} no encontrada` });
      if (!a.is_postable) throw new BadRequestException({ code: 'finance.account_not_postable', title: `La cuenta ${l.account_id} no es imputable` });
    }
  }

  private async insertLines(q: Q, entryId: string, lines: JournalLineInput[]) {
    const t = this.db.tenant;
    for (const l of lines) {
      await q.query(
        `INSERT INTO journal_lines (tenant_id, entry_id, account_id, cost_center_id, debit, credit, description, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [t, entryId, l.account_id, l.cost_center_id ?? null, l.debit ?? 0, l.credit ?? 0, l.description ?? null, this.db.user],
      );
    }
  }

  private async getInTx(e: Q, id: string, totals?: { totalDebit: number; totalCredit: number }) {
    const entry = await e.one(
      `SELECT id, entry_date, reference, source_type, source_id, currency, status FROM journal_entries WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!entry) throw new NotFoundException({ code: 'finance.entry_not_found', title: 'Asiento no encontrado' });
    const lines = await e.query(
      `SELECT jl.id, jl.account_id, a.code AS account_code, a.name AS account_name, jl.cost_center_id, jl.debit::float AS debit, jl.credit::float AS credit, jl.description
       FROM journal_lines jl JOIN chart_of_accounts a ON a.id = jl.account_id
       WHERE jl.entry_id=$1 AND jl.tenant_id=$2 AND jl.deleted_at IS NULL ORDER BY jl.created_at`,
      [id, this.db.tenant],
    );
    return { ...entry, lines, ...(totals ? { total_debit: totals.totalDebit, total_credit: totals.totalCredit } : {}) };
  }
}
