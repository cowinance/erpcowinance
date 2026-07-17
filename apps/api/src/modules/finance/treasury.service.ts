import { Injectable } from '@nestjs/common';
import { computeAging, AgingItem } from '@cowinance/domain';
import { DbService } from '../../db/db.service';

/**
 * Tesorería y bancos (G3) — capa de ANÁLISIS sobre Finanzas, sin tablas propias. Compone pagos
 * (`payments`), imputaciones (`payment_allocations`), cuentas bancarias (`bank_accounts`) y facturas
 * (`invoices`) para derivar: posición de liquidez por cuenta, flujo de caja del período, antigüedad de
 * saldos (aging) de CxC/CxP y días de cobro/pago. Reusa reglas ya existentes: saldo de factura =
 * total − Σ imputaciones (invoices.service); cuenta de tesorería = bank_accounts.ledger_account_id
 * (payments.service). El bucketing de aging es la regla única de dominio `computeAging`.
 */
@Injectable()
export class TreasuryService {
  constructor(private readonly db: DbService) {}

  async summary(fromRaw?: string, toRaw?: string) {
    const to = toRaw ?? new Date().toISOString().slice(0, 10);
    const from = fromRaw ?? new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    const t = this.db.tenant;

    // 1. Posición de liquidez: saldo por cuenta bancaria (entradas − salidas de sus pagos).
    const accounts = await this.db.query<any>(
      `SELECT ba.id, ba.name, ba.bank_name, ba.account_number, ba.currency,
              COALESCE((SELECT SUM(CASE WHEN p.direction='inbound' THEN p.amount ELSE -p.amount END)
                        FROM payments p WHERE p.tenant_id=$1 AND p.deleted_at IS NULL AND p.account_id = ba.ledger_account_id),0)::float AS balance
       FROM bank_accounts ba WHERE ba.tenant_id=$1 AND ba.deleted_at IS NULL ORDER BY ba.name`,
      [t],
    );
    const liquidity = { accounts, total: round2(accounts.reduce((s, a) => s + a.balance, 0)) };

    // 2. Flujo de caja del período: cobros (inbound) vs pagos (outbound), total y serie mensual.
    const [flow] = await this.db.query<{ inflow: number; outflow: number }>(
      `SELECT COALESCE(SUM(CASE WHEN direction='inbound' THEN amount ELSE 0 END),0)::float AS inflow,
              COALESCE(SUM(CASE WHEN direction='outbound' THEN amount ELSE 0 END),0)::float AS outflow
       FROM payments WHERE tenant_id=$1 AND deleted_at IS NULL AND payment_date BETWEEN $2::date AND $3::date`,
      [t, from, to],
    );
    const series = await this.db.query<any>(
      `SELECT to_char(date_trunc('month', payment_date),'YYYY-MM') AS month,
              SUM(CASE WHEN direction='inbound' THEN amount ELSE 0 END)::float AS inflow,
              SUM(CASE WHEN direction='outbound' THEN amount ELSE 0 END)::float AS outflow
       FROM payments WHERE tenant_id=$1 AND deleted_at IS NULL AND payment_date BETWEEN $2::date AND $3::date
       GROUP BY 1 ORDER BY 1`,
      [t, from, to],
    );
    const cashflow = { inflow: flow.inflow, outflow: flow.outflow, net: round2(flow.inflow - flow.outflow), series };

    // 3. Aging de saldos abiertos: saldo = total − Σ imputaciones; atraso = hoy − (vencimiento ?? emisión).
    const open = await this.db.query<{ direction: string; outstanding: number; days_past_due: number }>(
      `SELECT i.direction,
              (i.total - COALESCE((SELECT SUM(amount) FROM payment_allocations pa WHERE pa.invoice_id=i.id AND pa.deleted_at IS NULL),0))::float AS outstanding,
              (CURRENT_DATE - COALESCE(i.due_date, i.issue_date))::int AS days_past_due
       FROM invoices i WHERE i.tenant_id=$1 AND i.deleted_at IS NULL AND i.status NOT IN ('paid','void')`,
      [t],
    );
    const toItems = (dir: string): AgingItem[] =>
      open.filter((o) => o.direction === dir && o.outstanding > 0).map((o) => ({ outstanding: o.outstanding, daysPastDue: o.days_past_due }));
    const aging = { receivable: computeAging(toItems('issued')), payable: computeAging(toItems('received')) };

    // 4. Días de cobro/pago (proxy DSO/DPO): promedio de (fecha de pago − emisión) de las imputaciones.
    const days = await this.db.query<{ direction: string; avg_days: number }>(
      `SELECT i.direction, AVG(p.payment_date - i.issue_date)::float AS avg_days
       FROM payment_allocations pa
       JOIN payments p ON p.id=pa.payment_id AND p.deleted_at IS NULL
       JOIN invoices i ON i.id=pa.invoice_id AND i.deleted_at IS NULL
       WHERE pa.tenant_id=$1 AND pa.deleted_at IS NULL GROUP BY i.direction`,
      [t],
    );
    const dayOf = (dir: string): number | null => {
      const r = days.find((d) => d.direction === dir);
      return r ? Math.round(r.avg_days * 10) / 10 : null;
    };
    const collectionDays = { receivable: dayOf('issued'), payable: dayOf('received') };

    return { period: { from, to }, liquidity, cashflow, aging, collection_days: collectionDays };
  }
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
