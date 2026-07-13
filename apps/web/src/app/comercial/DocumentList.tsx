'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { Button } from '@/components/Button';

interface Doc {
  id: string;
  document_number: string | null;
  party_name: string;
  total: number;
  currency: string;
  status: string;
  date: string;
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Borrador',
  confirmed: 'Confirmada',
  received: 'Recibida',
  delivered: 'Entregada',
  invoiced: 'Facturada',
  paid: 'Pagada',
  canceled: 'Anulada',
};

// Acciones ofrecidas por estado (la API valida la transición real; el web solo ofrece los botones).
const ACTIONS: Record<'purchase' | 'sale', Record<string, [string, string][]>> = {
  purchase: {
    draft: [['confirmed', 'Confirmar'], ['received', 'Recibir'], ['canceled', 'Anular']],
    confirmed: [['received', 'Recibir'], ['canceled', 'Anular']],
    received: [['paid', 'Pagar']],
  },
  sale: {
    draft: [['confirmed', 'Confirmar'], ['delivered', 'Entregar'], ['canceled', 'Anular']],
    confirmed: [['delivered', 'Entregar'], ['canceled', 'Anular']],
    delivered: [['invoiced', 'Facturar'], ['paid', 'Pagar']],
    invoiced: [['paid', 'Pagar']],
  },
};

export function DocumentList({ kind, docs }: { kind: 'purchase' | 'sale'; docs: Doc[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const path = kind === 'sale' ? 'sales' : 'purchases';

  async function transition(id: string, status: string) {
    if (busy) return;
    setBusy(id + status);
    setError('');
    try {
      const res = await fetch(`${API_URL}/commerce/${path}/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.title ?? `Error ${res.status}`);
      }
      router.refresh();
    } catch (e: any) {
      setError(e.message ?? 'No se pudo actualizar.');
    } finally {
      setBusy('');
    }
  }

  return (
    <Card className="col-span-2 self-start max-lg:col-span-3">
      <CardTitle action={<span className="text-label text-ink-3">{docs.length}</span>}>{kind === 'sale' ? 'Ventas' : 'Compras'}</CardTitle>
      {error && (
        <p role="alert" className="mb-2 text-label text-danger">
          {error}
        </p>
      )}
      {docs.length === 0 ? (
        <p className="py-3 text-center text-label text-ink-3">Sin {kind === 'sale' ? 'ventas' : 'compras'} todavía.</p>
      ) : (
        <ul className="divide-y divide-subtle">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <span className="text-body font-medium">{d.party_name}</span>
                <span className="ml-2 text-label text-ink-3">{d.document_number ?? d.date}</span>
                <div className="text-label text-ink-3">
                  <span className="tnum">{d.total}</span> {d.currency}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-subtle px-2 py-0.5 text-caption font-medium text-ink-2">{STATUS_LABEL[d.status] ?? d.status}</span>
                {(ACTIONS[kind][d.status] ?? []).map(([to, label]) => (
                  <Button key={to} secondary size="sm" loading={busy === d.id + to} disabled={!!busy} onClick={() => transition(d.id, to)}>
                    {label}
                  </Button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
