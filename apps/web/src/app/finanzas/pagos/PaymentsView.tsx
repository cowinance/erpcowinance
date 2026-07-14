'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

interface Invoice {
  id: string;
  direction: string;
  invoice_number: string;
  outstanding: number;
  status: string;
  partner_name: string;
}
interface Payment {
  id: string;
  direction: string;
  payment_date: string;
  amount: number;
  currency: string;
  method: string | null;
  partner_name: string | null;
}

const METHODS: [string, string][] = [
  ['cash', 'Efectivo'],
  ['transfer', 'Transferencia'],
  ['check', 'Cheque'],
  ['card', 'Tarjeta'],
  ['other', 'Otro'],
];
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function PaymentsView({ payments, invoices, banks }: { payments: Payment[]; invoices: Invoice[]; banks: { id: string; name: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [direction, setDirection] = useState<'inbound' | 'outbound'>('inbound');
  const [method, setMethod] = useState('cash');
  const [bankId, setBankId] = useState('');
  const [alloc, setAlloc] = useState<Record<string, string>>({}); // invoice_id → monto

  // Facturas candidatas: con saldo > 0 y dirección coherente (inbound→issued, outbound→received).
  const wantDir = direction === 'inbound' ? 'issued' : 'received';
  const candidates = invoices.filter((i) => i.status !== 'void' && i.status !== 'paid' && i.direction === wantDir && i.outstanding > 0);
  const total = round2(Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0));

  function toggle(inv: Invoice, on: boolean) {
    setAlloc((a) => {
      const next = { ...a };
      if (on) next[inv.id] = String(inv.outstanding);
      else delete next[inv.id];
      return next;
    });
  }

  async function submit() {
    if (busy) return;
    const allocations = Object.entries(alloc)
      .map(([invoice_id, v]) => ({ invoice_id, amount: Number(v) }))
      .filter((a) => a.amount > 0);
    if (allocations.length === 0) return setError('Tildá al menos una factura.');
    setBusy(true);
    setError('');
    try {
      const body: any = { direction, amount: total, method, allocations };
      if (bankId) body.bank_account_id = bankId;
      const res = await fetch(`${API_URL}/finance/payments`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body) });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.title ?? `Error ${res.status}`);
      }
      setAlloc({});
      router.refresh();
    } catch (e: any) {
      setError(e.message ?? 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
      <Card className="col-span-2 self-start max-lg:col-span-3">
        <CardTitle>Registrar {direction === 'inbound' ? 'cobro' : 'pago'}</CardTitle>
        {error && <p role="alert" className="mb-2 text-label text-danger">{error}</p>}
        <div className="mb-3 flex flex-wrap gap-2">
          <Select value={direction} onChange={(e) => { setDirection(e.target.value as 'inbound' | 'outbound'); setAlloc({}); }} controlSize="sm" aria-label="Tipo de movimiento">
            <option value="inbound">Cobro (cliente)</option>
            <option value="outbound">Pago (proveedor)</option>
          </Select>
          <Select value={method} onChange={(e) => setMethod(e.target.value)} controlSize="sm" aria-label="Medio de pago">
            {METHODS.map(([c, l]) => (
              <option key={c} value={c}>
                {l}
              </option>
            ))}
          </Select>
          <Select value={bankId} onChange={(e) => setBankId(e.target.value)} controlSize="sm" aria-label="Cuenta bancaria">
            <option value="">Efectivo (rol caja)</option>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>
        {candidates.length === 0 ? (
          <p className="py-3 text-center text-label text-ink-3">Sin facturas con saldo.</p>
        ) : (
          <ul className="space-y-1">
            {candidates.map((i) => (
              <li key={i.id} className="flex items-center gap-2 text-label">
                <input type="checkbox" checked={i.id in alloc} onChange={(e) => toggle(i, e.target.checked)} aria-label={`Imputar ${i.invoice_number}`} />
                <span className="flex-1">
                  {i.invoice_number} · {i.partner_name} · saldo <span className="tnum">{i.outstanding}</span>
                </span>
                {i.id in alloc && (
                  <Input type="number" value={alloc[i.id]} onChange={(e) => setAlloc((a) => ({ ...a, [i.id]: e.target.value }))} aria-label={`Monto ${i.invoice_number}`} fullWidth={false} />
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex items-center justify-between border-t border-subtle pt-2">
          <span className="text-label text-ink-3">
            Monto del {direction === 'inbound' ? 'cobro' : 'pago'} <span className="tnum font-medium text-ink-1">{total}</span>
          </span>
          <Button size="sm" loading={busy} disabled={busy || total <= 0} onClick={submit}>
            Registrar
          </Button>
        </div>
      </Card>

      <Card className="self-start">
        <CardTitle action={<span className="text-label text-ink-3">{payments.length}</span>}>Movimientos</CardTitle>
        {payments.length === 0 ? (
          <p className="py-3 text-center text-label text-ink-3">Sin movimientos.</p>
        ) : (
          <ul className="divide-y divide-subtle">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2 text-label">
                <span className="text-ink-2">
                  {p.direction === 'inbound' ? 'Cobro' : 'Pago'} · {p.payment_date}
                </span>
                <span className={`tnum font-medium ${p.direction === 'inbound' ? 'text-success' : 'text-warning'}`}>
                  {p.amount} {p.currency}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
