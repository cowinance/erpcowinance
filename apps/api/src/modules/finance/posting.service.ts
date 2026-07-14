import { BadRequestException, Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { AccountsService } from './accounts.service';
import { LedgerService } from './ledger.service';
import { PurchasesService } from '../commerce/purchases.service';
import { SalesService } from '../commerce/sales.service';

const SETTINGS_KEY = 'finance.posting_accounts';
/** Roles requeridos del mapa según el tipo de documento. */
const REQUIRED_ROLES = {
  sale: ['receivable', 'sales_income', 'vat_debit'] as const,
  purchase: ['purchases', 'vat_credit', 'payable'] as const,
};
const ALL_ROLES = ['receivable', 'sales_income', 'vat_debit', 'purchases', 'vat_credit', 'payable', 'cash', 'salary_expense', 'salaries_payable', 'payroll_withholdings'] as const;
type Role = (typeof ALL_ROLES)[number];
export type AccountMap = Partial<Record<Role, string>>;

/**
 * Asientos automáticos desde documentos comerciales (F-2). Lee el documento, arma un asiento
 * balanceado según el mapa rol→cuenta de la company (system_settings) y lo postea reusando
 * LedgerService.createEntryInTx. Idempotente por `journal_entry_id` del documento; posteo + sellado
 * en una sola tx. NO toca la máquina de estados de Commerce (disparo explícito).
 */
@Injectable()
export class PostingService {
  constructor(
    private readonly db: DbService,
    private readonly accounts: AccountsService,
    private readonly ledger: LedgerService,
    private readonly purchases: PurchasesService,
    private readonly sales: SalesService,
  ) {}

  // ── Mapa de cuentas de posteo (por company) ─────────────────────────────────
  async getPostingAccounts(): Promise<AccountMap> {
    const companyId = await this.accounts.companyId();
    const row = await this.db.one<{ value: AccountMap }>(
      `SELECT value FROM system_settings WHERE tenant_id=$1 AND key=$2 AND scope='company' AND scope_id=$3 AND deleted_at IS NULL`,
      [this.db.tenant, SETTINGS_KEY, companyId],
    );
    return row?.value ?? {};
  }

  async setPostingAccounts(map: any): Promise<AccountMap> {
    if (!map || typeof map !== 'object') throw new BadRequestException({ code: 'finance.invalid_map', title: 'El mapa de cuentas es inválido' });
    const companyId = await this.accounts.companyId();
    const clean: AccountMap = {};
    for (const role of ALL_ROLES) {
      const accountId = map[role];
      if (accountId == null) continue;
      const a = await this.db.one<{ id: string; is_postable: boolean }>(`SELECT id, is_postable FROM chart_of_accounts WHERE id=$1 AND tenant_id=$2 AND company_id=$3 AND deleted_at IS NULL`, [accountId, this.db.tenant, companyId]);
      if (!a) throw new BadRequestException({ code: 'finance.account_not_found', title: `La cuenta del rol '${role}' no existe` });
      if (!a.is_postable) throw new BadRequestException({ code: 'finance.account_not_postable', title: `La cuenta del rol '${role}' no es imputable` });
      clean[role] = accountId;
    }
    await this.db.query(
      `INSERT INTO system_settings (tenant_id, key, value, scope, scope_id, created_by) VALUES ($1,$2,$3,'company',$4,$5)
       ON CONFLICT (tenant_id, key, scope, scope_id) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
      [this.db.tenant, SETTINGS_KEY, JSON.stringify(clean), companyId, this.db.user],
    );
    return clean;
  }

  // ── Posteo de un documento ──────────────────────────────────────────────────
  async postDocument(kind: string, documentId: string) {
    if (kind !== 'sale' && kind !== 'purchase') throw new BadRequestException({ code: 'finance.invalid_kind', title: "kind debe ser 'sale' o 'purchase'" });
    if (!documentId) throw new BadRequestException({ code: 'finance.missing_document', title: 'document_id es obligatorio' });

    const doc: any = kind === 'sale' ? await this.sales.get(documentId) : await this.purchases.get(documentId);
    if (doc.journal_entry_id) return { already_posted: true, journal_entry_id: doc.journal_entry_id }; // idempotente

    const map = await this.getPostingAccounts();
    const hasTax = Number(doc.tax_total) > 0;
    const lines = kind === 'sale' ? this.saleLines(map, doc, hasTax) : this.purchaseLines(map, doc, hasTax);
    const entryDate = kind === 'sale' ? doc.sale_date : doc.purchase_date;

    return this.db.tx(async (q) => {
      const entry: any = await this.ledger.createEntryInTx(q, {
        entry_date: entryDate,
        reference: `${kind === 'sale' ? 'Venta' : 'Compra'} ${doc.document_number ?? documentId}`,
        source_type: kind,
        source_id: documentId,
        lines,
      });
      if (kind === 'sale') await this.sales.attachJournalEntry(q, documentId, entry.id);
      else await this.purchases.attachJournalEntry(q, documentId, entry.id);
      return { already_posted: false, journal_entry_id: entry.id, entry };
    });
  }

  /** Venta: D clientes = total · H ventas = subtotal · H IVA débito = tax_total (si hay). */
  private saleLines(map: AccountMap, doc: any, hasTax: boolean) {
    this.requireRoles(map, hasTax ? REQUIRED_ROLES.sale : (['receivable', 'sales_income'] as const));
    const lines: any[] = [
      { account_id: map.receivable, debit: Number(doc.total), description: 'Deudores por ventas' },
      { account_id: map.sales_income, credit: Number(doc.subtotal), description: 'Ventas' },
    ];
    if (hasTax) lines.push({ account_id: map.vat_debit, credit: Number(doc.tax_total), description: 'IVA débito fiscal' });
    return lines;
  }

  /** Compra: D compras = subtotal · D IVA crédito = tax_total (si hay) · H proveedores = total. */
  private purchaseLines(map: AccountMap, doc: any, hasTax: boolean) {
    this.requireRoles(map, hasTax ? REQUIRED_ROLES.purchase : (['purchases', 'payable'] as const));
    const lines: any[] = [{ account_id: map.purchases, debit: Number(doc.subtotal), description: 'Compras' }];
    if (hasTax) lines.push({ account_id: map.vat_credit, debit: Number(doc.tax_total), description: 'IVA crédito fiscal' });
    lines.push({ account_id: map.payable, credit: Number(doc.total), description: 'Proveedores' });
    return lines;
  }

  private requireRoles(map: AccountMap, roles: readonly Role[]) {
    const missing = roles.filter((r) => !map[r]);
    if (missing.length) throw new BadRequestException({ code: 'finance.missing_roles', title: `Faltan cuentas para los roles: ${missing.join(', ')}. Configurá el mapa de posteo.` });
  }
}
