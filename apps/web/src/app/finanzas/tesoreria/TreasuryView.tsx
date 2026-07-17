'use client';

import { useState } from 'react';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle, KpiCard, EmptyState } from '@/components/ui';
import { Input } from '@/components/Input';

interface AgingBuckets {
  not_due: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
}
interface Summary {
  liquidity: { accounts: { id: string; name: string; bank_name: string | null; account_number: string | null; currency: string; balance: number }[]; total: number };
  cashflow: { inflow: number; outflow: number; net: number; series: { month: string; inflow: number; outflow: number }[] };
  aging: { receivable: { total: number; buckets: AgingBuckets }; payable: { total: number; buckets: AgingBuckets } };
  collection_days: { receivable: number | null; payable: number | null };
}

const money = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 0 });
const days = (n: number | null) => (n == null ? '—' : String(n));
const BUCKETS: [keyof AgingBuckets, string][] = [
  ['not_due', 'Por vencer'],
  ['d1_30', '1–30 d'],
  ['d31_60', '31–60 d'],
  ['d61_90', '61–90 d'],
  ['d90_plus', '+90 d'],
];

export function TreasuryView({ initial, from: from0, to: to0 }: { initial: Summary; from: string; to: string }) {
  const [data, setData] = useState<Summary>(initial);
  const [from, setFrom] = useState(from0);
  const [to, setTo] = useState(to0);

  async function reload(f: string, t: string) {
    const res = await fetch(`${API_URL}/treasury/summary?from=${f}&to=${t}`, { headers: authHeaders() });
    if (res.ok) setData(await res.json());
  }

  const cf = data.cashflow;
  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-label text-ink-2">Desde<div className="mt-1 w-40"><Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); reload(e.target.value, to); }} /></div></label>
          <label className="text-label text-ink-2">Hasta<div className="mt-1 w-40"><Input type="date" value={to} onChange={(e) => { setTo(e.target.value); reload(from, e.target.value); }} /></div></label>
        </div>
      </Card>

      <div className="grid grid-cols-4 gap-4 max-lg:grid-cols-2 max-sm:grid-cols-1">
        <KpiCard label="Liquidez total" value={money(data.liquidity.total)} hint="Saldo de cuentas de tesorería" />
        <KpiCard label="Flujo neto del período" value={money(cf.net)} tone={cf.net >= 0 ? 'success' : 'danger'} hint={`Cobros ${money(cf.inflow)} · Pagos ${money(cf.outflow)}`} />
        <KpiCard label="Días de cobro" value={days(data.collection_days.receivable)} unit="días" hint="Promedio emisión → cobro" />
        <KpiCard label="Días de pago" value={days(data.collection_days.payable)} unit="días" hint="Promedio emisión → pago" />
      </div>

      <Card>
        <CardTitle>Liquidez por cuenta</CardTitle>
        {data.liquidity.accounts.length === 0 ? (
          <EmptyState title="Sin cuentas de tesorería" body="Registrá una cuenta bancaria en Finanzas para ver su saldo." />
        ) : (
          <table className="w-full text-body">
            <thead>
              <tr className="border-b border-subtle text-label text-ink-3">
                <th className="py-1.5 text-left font-medium">Cuenta</th>
                <th className="py-1.5 text-left font-medium">Banco</th>
                <th className="py-1.5 text-right font-medium">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {data.liquidity.accounts.map((a) => (
                <tr key={a.id} className="border-b border-subtle/60">
                  <td className="py-1.5">{a.name}</td>
                  <td className="py-1.5 text-ink-3">{a.bank_name ?? '—'}</td>
                  <td className="tnum py-1.5 text-right font-medium">{money(a.balance)} <span className="text-caption text-ink-3">{a.currency}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        <AgingTable title="Cuentas por cobrar" data={data.aging.receivable} />
        <AgingTable title="Cuentas por pagar" data={data.aging.payable} />
      </div>
    </div>
  );
}

function AgingTable({ title, data }: { title: string; data: { total: number; buckets: AgingBuckets } }) {
  return (
    <Card>
      <CardTitle action={<span className="tnum text-body font-semibold">{money(data.total)}</span>}>{title}</CardTitle>
      <table className="w-full text-body">
        <tbody>
          {BUCKETS.map(([key, label]) => (
            <tr key={key} className="border-b border-subtle/60">
              <td className="py-1.5 text-ink-2">{label}</td>
              <td className="tnum py-1.5 text-right font-medium">{money(data.buckets[key])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
