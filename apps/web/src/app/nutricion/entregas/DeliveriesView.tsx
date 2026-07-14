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
interface Delivery {
  id: string;
  lot_name: string;
  ration_name: string | null;
  delivered_at: string;
  quantity_kg: number;
  animals_count: number | null;
  total_cost: number | null;
}

export function DeliveriesView({ deliveries, rations, lots, warehouses }: { deliveries: Delivery[]; rations: Named[]; lots: Named[]; warehouses: Named[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rationId, setRationId] = useState(rations[0]?.id ?? '');
  const [lotId, setLotId] = useState(lots[0]?.id ?? '');
  const [whId, setWhId] = useState(warehouses[0]?.id ?? '');
  const [qty, setQty] = useState('');

  const canDeliver = rations.length > 0 && lots.length > 0 && warehouses.length > 0;

  async function submit() {
    if (busy) return;
    const n = Number(qty);
    if (!rationId || !lotId || !whId || !(n > 0)) return setError('Elegí ración, lote, depósito y una cantidad positiva.');
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/nutrition/feed-deliveries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ ration_id: rationId, lot_id: lotId, warehouse_id: whId, quantity_kg: n }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.title ?? `Error ${res.status}`);
      }
      setQty('');
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
        <CardTitle>Nueva entrega</CardTitle>
        {error && <p role="alert" className="mb-2 text-label text-danger">{error}</p>}
        {!canDeliver ? (
          <p className="text-label text-ink-3">Necesitás al menos una ración, un lote y un depósito.</p>
        ) : (
          <div className="space-y-2">
            <Select value={rationId} onChange={(e) => setRationId(e.target.value)} aria-label="Ración">
              {rations.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
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
            <Select value={whId} onChange={(e) => setWhId(e.target.value)} aria-label="Depósito">
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
            <div className="flex gap-2">
              <Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Cantidad (kg)" aria-label="Cantidad en kg" />
              <Button size="sm" loading={busy} disabled={busy} onClick={submit}>
                Entregar
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card className="col-span-2 self-start max-lg:col-span-3">
        <CardTitle action={<span className="text-label text-ink-3">{deliveries.length}</span>}>Entregas</CardTitle>
        {deliveries.length === 0 ? (
          <p className="py-3 text-center text-label text-ink-3">Sin entregas.</p>
        ) : (
          <table className="w-full text-body">
            <thead>
              <tr className="h-8 border-b border-subtle text-left text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">
                <th>Lote</th>
                <th>Ración</th>
                <th className="text-right">Kg</th>
                <th className="text-right">Cabezas</th>
                <th className="text-right">Costo</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => (
                <tr key={d.id} className="h-8 border-b border-subtle last:border-0">
                  <td>{d.lot_name}</td>
                  <td className="text-ink-2">{d.ration_name ?? '—'}</td>
                  <td className="tnum text-right">{d.quantity_kg}</td>
                  <td className="tnum text-right">{d.animals_count ?? '—'}</td>
                  <td className="tnum text-right font-medium">{d.total_cost ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
