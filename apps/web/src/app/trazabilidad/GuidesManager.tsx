'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

interface Guide {
  id: string;
  guide_number: string;
  to_partner_name: string | null;
  issued_at: string;
  animal_count: number | null;
  status: string;
}
interface Partner {
  id: string;
  name: string;
}

const STATUS: Record<string, string> = { issued: 'Emitida', in_transit: 'En tránsito', completed: 'Completada', canceled: 'Anulada' };
const ACTIONS: Record<string, [string, string][]> = {
  issued: [['in_transit', 'En tránsito'], ['canceled', 'Anular']],
  in_transit: [['completed', 'Completar'], ['canceled', 'Anular']],
};

export function GuidesManager({ guides, partners }: { guides: Guide[]; partners: Partner[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [number, setNumber] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [count, setCount] = useState('');

  async function call(method: string, path: string, data?: any) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}${path}`, { method, headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: data ? JSON.stringify(data) : undefined });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.title ?? `Error ${res.status}`);
      }
      router.refresh();
    } catch (e: any) {
      setError(e.message ?? 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
      <Card className="self-start">
        <CardTitle>Nueva guía</CardTitle>
        {error && <p role="alert" className="mb-2 text-label text-danger">{error}</p>}
        <div className="space-y-2">
          <Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="N° de guía" aria-label="Número de guía" />
          <Select value={partnerId} onChange={(e) => setPartnerId(e.target.value)} aria-label="Socio destino">
            <option value="">Destino (opcional)</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Input type="number" value={count} onChange={(e) => setCount(e.target.value)} placeholder="Cabezas" aria-label="Cabezas" />
          <Button size="sm" fullWidth loading={busy} disabled={busy || !number.trim()} onClick={() => call('POST', '/traceability/guides', { guide_number: number, to_partner_id: partnerId || undefined, animal_count: count ? Number(count) : undefined }).then(() => { setNumber(''); setCount(''); })}>
            Emitir guía
          </Button>
        </div>
      </Card>

      <Card className="col-span-2 self-start max-lg:col-span-3">
        <CardTitle action={<span className="text-label text-ink-3">{guides.length}</span>}>Guías</CardTitle>
        {guides.length === 0 ? (
          <p className="py-3 text-center text-label text-ink-3">Sin guías.</p>
        ) : (
          <ul className="divide-y divide-subtle">
            {guides.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <span className="text-body font-medium">{g.guide_number}</span>
                  <span className="ml-2 text-label text-ink-3">
                    {g.to_partner_name ?? '—'}
                    {g.animal_count != null ? ` · ${g.animal_count} cab.` : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-subtle px-2 py-0.5 text-caption font-medium text-ink-2">{STATUS[g.status] ?? g.status}</span>
                  {(ACTIONS[g.status] ?? []).map(([to, label]) => (
                    <Button key={to} variant="secondary" size="sm" loading={busy} disabled={busy} onClick={() => call('PATCH', `/traceability/guides/${g.id}/status`, { status: to })}>
                      {label}
                    </Button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
