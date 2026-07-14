import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, Q } from '../../db/db.service';

const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'];
const COST_CENTER_LEVELS = ['company', 'farm', 'paddock', 'lot', 'animal', 'crop', 'machinery'];

/**
 * Finanzas — maestro (F-1): plan de cuentas + períodos fiscales + centros de costo. Todo por tenant
 * (RLS) y por la company única del tenant; baja lógica por `deleted_at`. Sin asientos (LedgerService).
 */
@Injectable()
export class AccountsService {
  constructor(private readonly db: DbService) {}

  private companyCache = new Map<string, string>();
  /** Company única del tenant (cadena org→company→farm del registro). */
  async companyId(): Promise<string> {
    const t = this.db.tenant;
    const cached = this.companyCache.get(t);
    if (cached) return cached;
    const c = await this.db.one<{ id: string }>(`SELECT id FROM companies WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1`, [t]);
    if (!c) throw new BadRequestException({ code: 'finance.no_company', title: 'El tenant no tiene una empresa configurada' });
    this.companyCache.set(t, c.id);
    return c.id;
  }

  // ── Plan de cuentas ─────────────────────────────────────────────────────────
  async listAccounts() {
    return this.db.query(
      `SELECT id, code, name, type, parent_id, is_postable FROM chart_of_accounts WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY code`,
      [this.db.tenant],
    );
  }

  async createAccount(body: any) {
    const code = String(body?.code ?? '').trim();
    const name = String(body?.name ?? '').trim();
    if (!code || !name) throw new BadRequestException({ code: 'finance.missing_fields', title: 'code y name son obligatorios' });
    if (!ACCOUNT_TYPES.includes(body?.type)) throw new BadRequestException({ code: 'finance.invalid_account_type', title: `type inválido (${ACCOUNT_TYPES.join('|')})` });
    const t = this.db.tenant;
    const companyId = await this.companyId();
    if (body?.parent_id) {
      const parent = await this.db.one<{ id: string }>(`SELECT id FROM chart_of_accounts WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [body.parent_id, t]);
      if (!parent) throw new NotFoundException({ code: 'finance.parent_not_found', title: 'Cuenta padre no encontrada' });
    }
    const dup = await this.db.one<{ id: string }>(`SELECT id FROM chart_of_accounts WHERE company_id=$1 AND code=$2 AND deleted_at IS NULL`, [companyId, code]);
    if (dup) throw new BadRequestException({ code: 'finance.duplicate_code', title: `Ya existe una cuenta con el código ${code}` });
    return this.db.one(
      `INSERT INTO chart_of_accounts (tenant_id, company_id, code, name, type, parent_id, is_postable, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, code, name, type, parent_id, is_postable`,
      [t, companyId, code, name, body.type, body.parent_id ?? null, body.is_postable !== false, this.db.user],
    );
  }

  async updateAccount(id: string, body: any) {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (typeof body?.name === 'string' && body.name.trim()) {
      params.push(body.name.trim());
      sets.push(`name = $${params.length}`);
    }
    if (typeof body?.is_postable === 'boolean') {
      params.push(body.is_postable);
      sets.push(`is_postable = $${params.length}`);
    }
    if (!sets.length) throw new BadRequestException({ code: 'finance.no_changes', title: 'Nada para actualizar' });
    return this.softUpdate('chart_of_accounts', id, sets, params, `id, code, name, type, parent_id, is_postable`);
  }

  async deleteAccount(id: string) {
    return this.softDelete('chart_of_accounts', id);
  }

  // ── Períodos fiscales ───────────────────────────────────────────────────────
  async listPeriods() {
    return this.db.query(`SELECT id, name, start_date, end_date, status FROM fiscal_periods WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY start_date`, [this.db.tenant]);
  }

  async createPeriod(body: any) {
    const name = String(body?.name ?? '').trim();
    const start = body?.start_date;
    const end = body?.end_date;
    if (!name || !start || !end) throw new BadRequestException({ code: 'finance.missing_fields', title: 'name, start_date y end_date son obligatorios' });
    if (String(end) < String(start)) throw new BadRequestException({ code: 'finance.invalid_period', title: 'end_date no puede ser anterior a start_date' });
    return this.db.one(
      `INSERT INTO fiscal_periods (tenant_id, company_id, name, start_date, end_date, status, created_by)
       VALUES ($1,$2,$3,$4,$5,'open',$6) RETURNING id, name, start_date, end_date, status`,
      [this.db.tenant, await this.companyId(), name, start, end, this.db.user],
    );
  }

  /** Abre/cierra un período. Cerrar bloquea nuevos asientos con fecha dentro del rango (regla en Ledger). */
  async setPeriodStatus(id: string, status: string) {
    if (status !== 'open' && status !== 'closed') throw new BadRequestException({ code: 'finance.invalid_status', title: "status debe ser 'open' o 'closed'" });
    return this.softUpdate('fiscal_periods', id, ['status = $1'], [status], `id, name, start_date, end_date, status`);
  }

  // ── Centros de costo ──────────────────────────────────────────────────────
  async listCostCenters() {
    return this.db.query(`SELECT id, name, level, farm_id, reference_id FROM cost_centers WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY name`, [this.db.tenant]);
  }

  async createCostCenter(body: any) {
    const name = String(body?.name ?? '').trim();
    if (!name) throw new BadRequestException({ code: 'finance.missing_name', title: 'name es obligatorio' });
    if (!COST_CENTER_LEVELS.includes(body?.level)) throw new BadRequestException({ code: 'finance.invalid_level', title: `level inválido (${COST_CENTER_LEVELS.join('|')})` });
    return this.db.one(
      `INSERT INTO cost_centers (tenant_id, company_id, name, level, farm_id, reference_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, name, level, farm_id, reference_id`,
      [this.db.tenant, await this.companyId(), name, body.level, body.farm_id ?? null, body.reference_id ?? null, this.db.user],
    );
  }

  async deleteCostCenter(id: string) {
    return this.softDelete('cost_centers', id);
  }

  // ── Cuentas bancarias (F-3b) ────────────────────────────────────────────────
  async listBankAccounts() {
    return this.db.query(
      `SELECT b.id, b.name, b.bank_name, b.account_number, b.currency, b.ledger_account_id, a.code AS ledger_account_code
       FROM bank_accounts b LEFT JOIN chart_of_accounts a ON a.id = b.ledger_account_id
       WHERE b.tenant_id=$1 AND b.deleted_at IS NULL ORDER BY b.name`,
      [this.db.tenant],
    );
  }

  async createBankAccount(body: any) {
    const name = String(body?.name ?? '').trim();
    if (!name) throw new BadRequestException({ code: 'finance.missing_name', title: 'name es obligatorio' });
    const currency = String(body?.currency ?? '').trim();
    if (!currency) throw new BadRequestException({ code: 'finance.missing_currency', title: 'currency es obligatorio' });
    const t = this.db.tenant;
    const companyId = await this.companyId();
    const ledgerAccountId = body?.ledger_account_id ?? null;
    if (ledgerAccountId) {
      const a = await this.db.one<{ id: string; is_postable: boolean }>(`SELECT id, is_postable FROM chart_of_accounts WHERE id=$1 AND tenant_id=$2 AND company_id=$3 AND deleted_at IS NULL`, [ledgerAccountId, t, companyId]);
      if (!a) throw new NotFoundException({ code: 'finance.account_not_found', title: 'Cuenta contable no encontrada' });
      if (!a.is_postable) throw new BadRequestException({ code: 'finance.account_not_postable', title: 'La cuenta contable del banco debe ser imputable' });
    }
    return this.db.one(
      `INSERT INTO bank_accounts (tenant_id, company_id, name, bank_name, account_number, currency, ledger_account_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, name, bank_name, account_number, currency, ledger_account_id`,
      [t, companyId, name, body?.bank_name ?? null, body?.account_number ?? null, currency, ledgerAccountId, this.db.user],
    );
  }

  async deleteBankAccount(id: string) {
    return this.softDelete('bank_accounts', id);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  private async softUpdate(table: string, id: string, sets: string[], params: unknown[], returning: string) {
    params.push(id);
    const idIdx = params.length;
    params.push(this.db.tenant);
    const tIdx = params.length;
    const row = await this.db.one(`UPDATE ${table} SET ${sets.join(', ')}, updated_at = now() WHERE id = $${idIdx} AND tenant_id = $${tIdx} AND deleted_at IS NULL RETURNING ${returning}`, params);
    if (!row) throw new NotFoundException({ code: 'finance.not_found', title: 'Registro no encontrado' });
    return row;
  }

  private async softDelete(table: string, id: string) {
    const row = await this.db.one<{ id: string }>(`UPDATE ${table} SET deleted_at = now(), updated_at = now() WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL RETURNING id`, [id, this.db.tenant]);
    if (!row) throw new NotFoundException({ code: 'finance.not_found', title: 'Registro no encontrado' });
    return { id, deleted: true };
  }
}
