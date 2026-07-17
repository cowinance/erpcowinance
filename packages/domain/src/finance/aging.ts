/**
 * Antigüedad de saldos (aging) de cuentas por cobrar/pagar (G3 · tesorería) — regla única. Clasifica
 * cada saldo pendiente por sus días de atraso (hoy − vencimiento) en tramos estándar y suma por tramo.
 * El saldo pendiente de cada factura (total − Σ imputaciones) lo deriva quien llama (misma regla que
 * `invoices.service`); acá solo se bucketea y agrega. Puro, sin fechas ni IO.
 *
 * Tramos: `not_due` (aún no vencida, atraso ≤ 0), `d1_30`, `d31_60`, `d61_90`, `d90_plus`.
 */
export type AgingBucketKey = 'not_due' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus';

export interface AgingItem {
  outstanding: number;
  daysPastDue: number;
}

export interface AgingSummary {
  total: number;
  buckets: Record<AgingBucketKey, number>;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export function agingBucketOf(daysPastDue: number): AgingBucketKey {
  const d = Number(daysPastDue);
  if (!(d > 0)) return 'not_due';
  if (d <= 30) return 'd1_30';
  if (d <= 60) return 'd31_60';
  if (d <= 90) return 'd61_90';
  return 'd90_plus';
}

export function computeAging(items: AgingItem[]): AgingSummary {
  const buckets: Record<AgingBucketKey, number> = { not_due: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  let total = 0;
  for (const it of items) {
    const amount = Number(it.outstanding);
    if (!Number.isFinite(amount) || amount === 0) continue;
    buckets[agingBucketOf(it.daysPastDue)] += amount;
    total += amount;
  }
  for (const k of Object.keys(buckets) as AgingBucketKey[]) buckets[k] = round2(buckets[k]);
  return { total: round2(total), buckets };
}
