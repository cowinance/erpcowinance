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
  issue_date: string;
  currency: string;
  total: number;
  outstanding: number;
  status: string;
  partner_name: string;
}
interface Doc {
  id: string;
  document_number: string | null;
  total: number;
  supplier_name?: string;
  customer_name?: string;
}

const STATUS: Record<string, string> = { issued: 'Emitida', received: 'Recibida', paid: 'Pagada', void: 'Anulada', draft: 'Borrador' };

export function InvoicesView({ invoices, sales, purchases }: { invoices: Invoice[]; sales: Doc[]; purchases: Doc[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [kind, setKind] = useState<'sale' | 'purchase'>('sale');
  const [docId, setDocId] = useState('');
  const [number, setNumber] = useState('');

  const docs = kind === 'sale' ? sales : purchases;
  const docLabel = (d: Doc) => `${d.document_number ?? d.id.slice(0, 8)} · ${kind === 'sale' ? d.customer_name : d.supplier_name} · ${d.total}`;

  async function call(path: string, data: any, ok: () => void) {
    if (busy) return;
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const res = await fetch(`${API_URL}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(data) });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.title ?? `Error ${res.status}`);
      ok();
      return j;
    } catch (e: any) {
      setError(e.message ?? 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  }

  const contabilizar = () =>
    docId &&
    call('/finance/postings', { kind, document_id: docId }, () => {}).then((r: any) => {
      if (r) setInfo(r.already_posted ? 'El documento ya estaba contabilizado.' : 'Documento contabilizado.');
    });
  const emitir = () => docId && number.trim() && call('/finance/invoices', { kind, document_id: docId, invoice_number: number.trim() }, () => { setNumber(''); router.refresh(); });
  const anular = (id: string) => call(`/finance/invoices/${id}/void`, {}, () => router.refresh());

  return (
    <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
      <Card className="self-start">
        <CardTitle>Emitir factura</CardTitle>
        {error && <p role="alert" className="mb-2 text-label text-danger">{error}</p>}
        {info && <p className="mb-2 text-label text-success">{info}</p>}
        <div className="space-y-2">
          <Select value={kind} onChange={(e) => { setKind(e.target.value as 'sale' | 'purchase'); setDocId(''); }} aria-label="Tipo de documento">
            <option value="sale">Venta → factura emitida</option>
            <option value="purchase">Compra → factura recibida</option>
          </Select>
          <Select value={docId} onChange={(e) => setDocId(e.target.value)} aria-label="Documento">
            <option value="">Elegí documento…</option>
            {docs.map((d) => (
              <option key={d.id} value={d.id}>
                {docLabel(d)}
              </option>
            ))}
          </Select>
          <Button variant="secondary" size="sm" fullWidth loading={busy} disabled={busy || !docId} onClick={contabilizar}>
            Contabilizar documento
          </Button>
          <Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="N° de factura" aria-label="Número de factura" />
          <Button size="sm" fullWidth loading={busy} disabled={busy || !docId || !number.trim()} onClick={emitir}>
            Emitir factura
          </Button>
        </div>
      </Card>

      <Card className="col-span-2 self-start max-lg:col-span-3">
        <CardTitle action={<span className="text-label text-ink-3">{invoices.length}</span>}>Facturas</CardTitle>
        {invoices.length === 0 ? (
          <p className="py-3 text-center text-label text-ink-3">Sin facturas.</p>
        ) : (
          <ul className="divide-y divide-subtle">
            {invoices.map((i) => (
              <li key={i.id} className="flex items-center justify-between py-2">
                <div>
                  <span className="text-body font-medium">{i.invoice_number}</span>
                  <span className="ml-2 text-label text-ink-3">{i.partner_name}</span>
                  <div className="text-label text-ink-3">
                    Total <span className="tnum">{i.total}</span> · Saldo <span className="tnum">{i.outstanding}</span> {i.currency}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-subtle px-2 py-0.5 text-caption font-medium text-ink-2">{STATUS[i.status] ?? i.status}</span>
                  {i.status !== 'void' && i.status !== 'paid' && (
                    <Button variant="secondary" size="sm" loading={busy} disabled={busy} onClick={() => anular(i.id)}>
                      Anular
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
