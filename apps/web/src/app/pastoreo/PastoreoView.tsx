'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

interface Named {
  id: string;
  name: string;
}
interface Grazing {
  id: string;
  paddock_name: string;
  lot_name: string;
  entry_date: string;
  exit_date: string | null;
  grazing_days: number | null;
  forage_consumed_kg_dm_ha: number | null;
  is_open: boolean;
}
interface Occupancy {
  paddock_id: string;
  paddock_name: string;
  lot_name: string | null;
  occupied: boolean;
  days_grazing: number | null;
  days_rest: number | null;
}

export function PastoreoView({ grazings, occupancy, paddocks, lots }: { grazings: Grazing[]; occupancy: Occupancy[]; paddocks: Named[]; lots: Named[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [paddockId, setPaddockId] = useState(paddocks[0]?.id ?? '');
  const [lotId, setLotId] = useState(lots[0]?.id ?? '');
  const [pre, setPre] = useState('');
  const [post, setPost] = useState<Record<string, string>>({});

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

  const canEnter = paddocks.length > 0 && lots.length > 0;

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="text-label text-danger">{error}</p>}
      <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
        <Card className="self-start">
          <CardTitle>Ingresar a un potrero</CardTitle>
          {!canEnter ? (
            <p className="text-label text-ink-3">Necesitás potreros y lotes.</p>
          ) : (
            <div className="space-y-2">
              <Select value={paddockId} onChange={(e) => setPaddockId(e.target.value)} aria-label="Potrero">
                {paddocks.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <Select value={lotId} onChange={(e) => setLotId(e.target.value)} aria-label="Lote">
                {lots.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
              <Input type="number" value={pre} onChange={(e) => setPre(e.target.value)} placeholder="Forraje pre (kg MS/ha)" aria-label="Forraje pre" />
              <Button size="sm" fullWidth loading={busy} disabled={busy} onClick={() => call('POST', '/grazing', { paddock_id: paddockId, lot_id: lotId, pre_grazing_kg_dm_ha: pre ? Number(pre) : undefined }).then(() => setPre(''))}>
                Ingresar
              </Button>
            </div>
          )}
        </Card>

        <Card className="col-span-2 self-start max-lg:col-span-3">
          <CardTitle>Ocupación de potreros</CardTitle>
          {occupancy.length === 0 ? (
            <p className="py-3 text-center text-label text-ink-3">Sin potreros.</p>
          ) : (
            <table className="w-full text-body">
              <thead>
                <tr className="h-8 border-b border-subtle text-left text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">
                  <th>Potrero</th>
                  <th>Estado</th>
                  <th className="text-right">Días</th>
                </tr>
              </thead>
              <tbody>
                {occupancy.map((o) => (
                  <tr key={o.paddock_id} className="h-8 border-b border-subtle last:border-0">
                    <td>{o.paddock_name}</td>
                    <td className={o.occupied ? 'text-warning' : 'text-success'}>
                      {o.occupied ? `Ocupado · ${o.lot_name}` : 'Libre'}
                    </td>
                    <td className="tnum text-right text-ink-3">
                      {o.occupied ? (o.days_grazing != null ? `${o.days_grazing} pastoreo` : '—') : o.days_rest != null ? `${o.days_rest} descanso` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card>
        <CardTitle action={<span className="text-label text-ink-3">{grazings.length}</span>}>Pastoreos</CardTitle>
        {grazings.length === 0 ? (
          <p className="py-3 text-center text-label text-ink-3">Sin pastoreos.</p>
        ) : (
          <table className="w-full text-body">
            <thead>
              <tr className="h-8 border-b border-subtle text-left text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">
                <th>Potrero</th>
                <th>Lote</th>
                <th>Entrada</th>
                <th className="text-right">Días</th>
                <th className="text-right">Forraje cons.</th>
                <th className="text-right">Salida</th>
              </tr>
            </thead>
            <tbody>
              {grazings.map((g) => (
                <tr key={g.id} className="h-8 border-b border-subtle last:border-0">
                  <td>{g.paddock_name}</td>
                  <td className="text-ink-2">{g.lot_name}</td>
                  <td className="text-ink-3">{g.entry_date}</td>
                  <td className="tnum text-right">{g.grazing_days ?? '—'}</td>
                  <td className="tnum text-right">{g.forage_consumed_kg_dm_ha ?? '—'}</td>
                  <td className="text-right">
                    {g.is_open ? (
                      <div className="flex items-center justify-end gap-1">
                        <Input type="number" value={post[g.id] ?? ''} onChange={(e) => setPost((p) => ({ ...p, [g.id]: e.target.value }))} placeholder="post" aria-label={`Forraje post ${g.paddock_name}`} fullWidth={false} />
                        <Button variant="secondary" size="sm" loading={busy} disabled={busy} onClick={() => call('PATCH', `/grazing/${g.id}/exit`, { post_grazing_kg_dm_ha: post[g.id] ? Number(post[g.id]) : undefined })}>
                          Salir
                        </Button>
                      </div>
                    ) : (
                      <span className="text-ink-3">{g.exit_date}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
