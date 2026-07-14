'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardTitle } from '@/components/ui';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';

interface Row {
  account_id: string;
  code: string;
  name: string;
  debit: number;
  credit: number;
  balance: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function TrialBalanceView({ rows, from, to }: { rows: Row[]; from: string; to: string }) {
  const router = useRouter();
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);

  const totalDebit = round2(rows.reduce((s, r) => s + r.debit, 0));
  const totalCredit = round2(rows.reduce((s, r) => s + r.credit, 0));

  function apply() {
    const qs = new URLSearchParams();
    if (f) qs.set('from', f);
    if (t) qs.set('to', t);
    router.push(`/finanzas/sumas-y-saldos${qs.toString() ? `?${qs}` : ''}`);
  }

  return (
    <Card>
      <CardTitle
        action={
          <div className="flex items-end gap-2">
            <Input type="date" value={f} onChange={(e) => setF(e.target.value)} aria-label="Desde" fullWidth={false} />
            <Input type="date" value={t} onChange={(e) => setT(e.target.value)} aria-label="Hasta" fullWidth={false} />
            <Button size="sm" onClick={apply}>
              Aplicar
            </Button>
          </div>
        }
      >
        Sumas y saldos
      </CardTitle>
      {rows.length === 0 ? (
        <p className="py-3 text-center text-label text-ink-3">Sin movimientos en el rango.</p>
      ) : (
        <table className="w-full text-body">
          <thead>
            <tr className="h-8 border-b border-subtle text-left text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">
              <th>Cuenta</th>
              <th className="text-right">Debe</th>
              <th className="text-right">Haber</th>
              <th className="text-right">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.account_id} className="h-8 border-b border-subtle">
                <td>
                  <span className="tnum text-ink-3">{r.code}</span> {r.name}
                </td>
                <td className="tnum text-right">{r.debit}</td>
                <td className="tnum text-right">{r.credit}</td>
                <td className="tnum text-right font-medium">{r.balance}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="h-8 font-medium">
              <td>Totales</td>
              <td className="tnum text-right">{totalDebit}</td>
              <td className="tnum text-right">{totalCredit}</td>
              <td className="tnum text-right">{round2(totalDebit - totalCredit)}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </Card>
  );
}
