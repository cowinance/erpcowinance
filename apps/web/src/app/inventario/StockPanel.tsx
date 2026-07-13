'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

interface Item {
  id: string;
  name: string;
  unit: string;
}
interface Warehouse {
  id: string;
  name: string;
}
interface Stock {
  item_id: string;
  item_name: string;
  unit: string;
  warehouse_name: string;
  quantity: number;
  avg_cost: number | null;
}
interface Movement {
  id: string;
  movement_type: string;
  quantity: number;
  occurred_at: string;
  item_name: string;
  unit: string;
  warehouse_name: string;
}

const TYPES: [string, string][] = [
  ['in', 'Entrada'],
  ['out', 'Salida'],
  ['consumption', 'Consumo'],
  ['adjustment', 'Ajuste (+/−)'],
];
const typeLabel = (k: string) => TYPES.find(([c]) => c === k)?.[1] ?? k;
const fmtQty = (q: number) => (q > 0 ? `+${q}` : String(q));

export function StockPanel({ items, warehouses, stock, movements }: { items: Item[]; warehouses: Warehouse[]; stock: Stock[]; movements: Movement[] }) {
  const router = useRouter();
  const [itemId, setItemId] = useState(items[0]?.id ?? '');
  const [whId, setWhId] = useState(warehouses[0]?.id ?? '');
  const [type, setType] = useState('in');
  const [qty, setQty] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const canRegister = items.length > 0 && warehouses.length > 0;

  async function register() {
    if (busy) return;
    setError('');
    const n = Number(qty);
    if (!itemId || !whId || !Number.isFinite(n) || n === 0) {
      setError('Elegí ítem, depósito y una cantidad distinta de 0.');
      return;
    }
    // Cantidad SIGNADA por tipo: entrada +, salida/consumo −, ajuste según lo tipeado.
    const signed = type === 'in' ? Math.abs(n) : type === 'out' || type === 'consumption' ? -Math.abs(n) : n;
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/inventory/movements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ item_id: itemId, warehouse_id: whId, movement_type: type, quantity: signed }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.title ?? `Error ${res.status}`);
      }
      setQty('');
      router.refresh();
    } catch (e: any) {
      setError(e.message ?? 'No se pudo registrar el movimiento.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-5 gap-4 max-lg:grid-cols-1">
      {/* Registrar movimiento */}
      <Card className="col-span-2 self-start max-lg:col-span-5">
        <CardTitle>Registrar movimiento</CardTitle>
        {error && (
          <p role="alert" className="mb-2 text-label text-danger">
            {error}
          </p>
        )}
        {!canRegister ? (
          <p className="text-label text-ink-3">Creá al menos un ítem y un depósito para registrar movimientos.</p>
        ) : (
          <div className="space-y-2">
            <Select value={itemId} onChange={(e) => setItemId(e.target.value)} aria-label="Ítem del movimiento">
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.unit})
                </option>
              ))}
            </Select>
            <Select value={whId} onChange={(e) => setWhId(e.target.value)} aria-label="Depósito del movimiento">
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
            <div className="flex gap-2">
              <Select value={type} onChange={(e) => setType(e.target.value)} controlSize="sm" aria-label="Tipo de movimiento">
                {TYPES.map(([c, l]) => (
                  <option key={c} value={c}>
                    {l}
                  </option>
                ))}
              </Select>
              <Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Cantidad" aria-label="Cantidad" />
            </div>
            <Button size="sm" fullWidth loading={busy} disabled={busy} onClick={register}>
              Registrar
            </Button>
          </div>
        )}
      </Card>

      {/* Existencias + kardex */}
      <Card className="col-span-3 max-lg:col-span-5">
        <CardTitle action={<span className="text-label text-ink-3">{stock.length} existencias</span>}>Existencias</CardTitle>
        {stock.length === 0 ? (
          <p className="py-3 text-center text-label text-ink-3">Sin existencias.</p>
        ) : (
          <table className="w-full text-body">
            <thead>
              <tr className="h-8 border-b border-subtle text-left text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">
                <th>Ítem</th>
                <th>Depósito</th>
                <th className="text-right">Cantidad</th>
              </tr>
            </thead>
            <tbody>
              {stock.map((s, i) => (
                <tr key={`${s.item_id}-${i}`} className="h-8 border-b border-subtle last:border-0">
                  <td>{s.item_name}</td>
                  <td className="text-ink-2">{s.warehouse_name}</td>
                  <td className="tnum text-right font-medium">
                    {s.quantity} {s.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="mt-4 mb-1 text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">Últimos movimientos</div>
        {movements.length === 0 ? (
          <p className="py-2 text-center text-label text-ink-3">Sin movimientos.</p>
        ) : (
          <ul className="space-y-1">
            {movements.slice(0, 8).map((m) => (
              <li key={m.id} className="flex items-center justify-between text-label">
                <span className="text-ink-2">
                  {typeLabel(m.movement_type)} · {m.item_name}
                </span>
                <span className={`tnum font-medium ${m.quantity < 0 ? 'text-warning' : 'text-success'}`}>
                  {fmtQty(m.quantity)} {m.unit}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
