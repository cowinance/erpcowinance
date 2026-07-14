'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

interface Crop {
  id: string;
  crop_type: string;
  variety: string | null;
  paddock_name: string;
  area_ha: number | null;
  status: string;
}
interface Named {
  id: string;
  name?: string;
  full_name?: string;
  unit?: string;
}

const OP_TYPES: [string, string][] = [
  ['planting', 'Siembra'],
  ['fertilization', 'Fertilización'],
  ['spraying', 'Fumigación'],
  ['irrigation', 'Riego'],
  ['tillage', 'Laboreo'],
  ['harvest', 'Cosecha'],
];
const opLabel = (k: string) => OP_TYPES.find(([c]) => c === k)?.[1] ?? k;
const STATUS: Record<string, string> = { planned: 'Planificado', growing: 'En crecimiento', harvested: 'Cosechado', failed: 'Perdido' };

export function CropDetail({ crop, operations, harvests, items, warehouses, employees }: { crop: Crop; operations: any[]; harvests: any[]; items: Named[]; warehouses: Named[]; employees: Named[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Labor
  const [opType, setOpType] = useState('fertilization');
  const [opItem, setOpItem] = useState('');
  const [opWh, setOpWh] = useState(warehouses[0]?.id ?? '');
  const [opQty, setOpQty] = useState('');
  const [opOperator, setOpOperator] = useState('');
  // Cosecha
  const [yieldQty, setYieldQty] = useState('');
  const [destItem, setDestItem] = useState('');
  const [destWh, setDestWh] = useState(warehouses[0]?.id ?? '');

  async function post(path: string, data: any) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(data) });
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

  function recordOp() {
    const data: any = { operation_type: opType, operator_id: opOperator || undefined };
    if (opItem) {
      data.inventory_item_id = opItem;
      data.quantity = Number(opQty);
      data.warehouse_id = opWh;
    }
    post(`/agriculture/crops/${crop.id}/operations`, data).then(() => setOpQty(''));
  }
  function recordHarvest() {
    const data: any = { yield_quantity: Number(yieldQty) };
    if (destItem) {
      data.destination_item_id = destItem;
      data.warehouse_id = destWh;
    }
    post(`/agriculture/crops/${crop.id}/harvests`, data).then(() => setYieldQty(''));
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/agricultura" className="text-label text-brand hover:underline">
          ← Agricultura
        </Link>
        <h1 className="mt-1 text-xl font-semibold">
          {crop.crop_type} {crop.variety ? <span className="text-ink-3">· {crop.variety}</span> : null}
        </h1>
        <p className="mt-0.5 text-body text-ink-3">
          {crop.paddock_name}
          {crop.area_ha ? ` · ${crop.area_ha} ha` : ''} · <span className="font-medium text-ink-2">{STATUS[crop.status] ?? crop.status}</span>
        </p>
      </div>
      {error && <p role="alert" className="text-label text-danger">{error}</p>}

      <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        {/* Labores */}
        <Card className="self-start">
          <CardTitle>Registrar labor</CardTitle>
          <div className="space-y-2">
            <Select value={opType} onChange={(e) => setOpType(e.target.value)} aria-label="Tipo de labor">
              {OP_TYPES.map(([c, l]) => (
                <option key={c} value={c}>
                  {l}
                </option>
              ))}
            </Select>
            <Select value={opItem} onChange={(e) => setOpItem(e.target.value)} controlSize="sm" aria-label="Insumo">
              <option value="">Sin insumo</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.unit})
                </option>
              ))}
            </Select>
            {opItem && (
              <div className="flex gap-2">
                <Select value={opWh} onChange={(e) => setOpWh(e.target.value)} controlSize="sm" aria-label="Depósito del insumo">
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </Select>
                <Input type="number" value={opQty} onChange={(e) => setOpQty(e.target.value)} placeholder="Cantidad" aria-label="Cantidad del insumo" />
              </div>
            )}
            <Select value={opOperator} onChange={(e) => setOpOperator(e.target.value)} controlSize="sm" aria-label="Operario">
              <option value="">Sin operario</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name}
                </option>
              ))}
            </Select>
            <Button size="sm" fullWidth loading={busy} disabled={busy} onClick={recordOp}>
              Registrar labor
            </Button>
          </div>
          <div className="mt-3 border-t border-subtle pt-2">
            {operations.length === 0 ? (
              <p className="py-1 text-center text-label text-ink-3">Sin labores.</p>
            ) : (
              <ul className="space-y-1">
                {operations.map((o) => (
                  <li key={o.id} className="flex justify-between text-label">
                    <span className="text-ink-2">
                      {opLabel(o.operation_type)}
                      {o.item_name ? ` · ${o.item_name}` : ''}
                    </span>
                    <span className="tnum text-ink-3">{o.cost != null ? `$${o.cost}` : '—'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        {/* Cosechas */}
        <Card className="self-start">
          <CardTitle>Registrar cosecha</CardTitle>
          <div className="space-y-2">
            <Input type="number" value={yieldQty} onChange={(e) => setYieldQty(e.target.value)} placeholder="Rinde total (kg)" aria-label="Rinde total" />
            <Select value={destItem} onChange={(e) => setDestItem(e.target.value)} controlSize="sm" aria-label="Ítem destino">
              <option value="">No sumar a stock</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.unit})
                </option>
              ))}
            </Select>
            {destItem && (
              <Select value={destWh} onChange={(e) => setDestWh(e.target.value)} controlSize="sm" aria-label="Depósito destino">
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            )}
            <Button size="sm" fullWidth loading={busy} disabled={busy} onClick={recordHarvest}>
              Registrar cosecha
            </Button>
          </div>
          <div className="mt-3 border-t border-subtle pt-2">
            {harvests.length === 0 ? (
              <p className="py-1 text-center text-label text-ink-3">Sin cosechas.</p>
            ) : (
              <ul className="space-y-1">
                {harvests.map((h) => (
                  <li key={h.id} className="flex justify-between text-label">
                    <span className="text-ink-2">{h.harvest_date}</span>
                    <span className="tnum">
                      {h.yield_quantity} {h.yield_unit ?? 'kg'}
                      {h.yield_per_ha ? ` · ${h.yield_per_ha}/ha` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
