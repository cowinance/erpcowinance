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
  is_active?: boolean;
  track_batches?: boolean;
}
interface Warehouse {
  id: string;
  name: string;
}
interface Batch {
  id: string;
  item_id: string;
  batch_number: string;
}
interface Stock {
  item_id: string;
  item_name: string;
  unit: string;
  warehouse_name: string;
  quantity: number;
}
interface Movement {
  id: string;
  movement_type: string;
  quantity: number;
  item_name: string;
  unit: string;
}

const TYPES: [string, string][] = [
  ['in', 'Entrada'],
  ['out', 'Salida'],
  ['consumption', 'Consumo'],
  ['adjustment', 'Ajuste (+/−)'],
];
const typeLabel = (k: string) => TYPES.find(([c]) => c === k)?.[1] ?? k;
const fmtQty = (q: number) => (q > 0 ? `+${q}` : String(q));

export function StockPanel({ items, warehouses, stock, movements, batches }: { items: Item[]; warehouses: Warehouse[]; stock: Stock[]; movements: Movement[]; batches: Batch[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const canOp = items.length > 0 && warehouses.length > 0;
  const itemById = (id: string) => items.find((i) => i.id === id);
  const batchesOf = (id: string) => batches.filter((b) => b.item_id === id);

  // Movimiento
  const [mItem, setMItem] = useState(items[0]?.id ?? '');
  const [mWh, setMWh] = useState(warehouses[0]?.id ?? '');
  const [mType, setMType] = useState('in');
  const [mQty, setMQty] = useState('');
  const [mBatch, setMBatch] = useState('');
  // Transfer
  const [tItem, setTItem] = useState(items[0]?.id ?? '');
  const [tFrom, setTFrom] = useState(warehouses[0]?.id ?? '');
  const [tTo, setTTo] = useState(warehouses[1]?.id ?? '');
  const [tQty, setTQty] = useState('');
  const [tBatch, setTBatch] = useState('');
  // Lote
  const [bItem, setBItem] = useState(items[0]?.id ?? '');
  const [bNum, setBNum] = useState('');

  async function send(path: string, data: any, reset: () => void) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(data) });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.title ?? `Error ${res.status}`);
      }
      reset();
      router.refresh();
    } catch (e: any) {
      setError(e.message ?? 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  }

  function registerMovement() {
    const n = Number(mQty);
    if (!mItem || !mWh || !Number.isFinite(n) || n === 0) return setError('Elegí ítem, depósito y una cantidad distinta de 0.');
    const signed = mType === 'in' ? Math.abs(n) : mType === 'out' || mType === 'consumption' ? -Math.abs(n) : n;
    send('/inventory/movements', { item_id: mItem, warehouse_id: mWh, movement_type: mType, quantity: signed, batch_id: mBatch || undefined }, () => setMQty(''));
  }
  function transfer() {
    const n = Number(tQty);
    if (!tItem || !tFrom || !tTo || tFrom === tTo || !Number.isFinite(n) || n <= 0) return setError('Elegí ítem, depósitos distintos y una cantidad positiva.');
    send('/inventory/transfers', { item_id: tItem, from_warehouse_id: tFrom, to_warehouse_id: tTo, quantity: n, batch_id: tBatch || undefined }, () => setTQty(''));
  }
  function addBatch() {
    if (!bItem || !bNum.trim()) return setError('Elegí ítem y número de lote.');
    send('/inventory/batches', { item_id: bItem, batch_number: bNum.trim() }, () => setBNum(''));
  }

  const ItemSelect = ({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) => (
    <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {items.map((i) => (
        <option key={i.id} value={i.id}>
          {i.name} ({i.unit})
        </option>
      ))}
    </Select>
  );
  const BatchSelect = ({ itemId, value, onChange, label }: { itemId: string; value: string; onChange: (v: string) => void; label: string }) => {
    if (!itemById(itemId)?.track_batches) return null;
    return (
      <Select value={value} onChange={(e) => onChange(e.target.value)} controlSize="sm" aria-label={label}>
        <option value="">Elegir lote…</option>
        {batchesOf(itemId).map((b) => (
          <option key={b.id} value={b.id}>
            {b.batch_number}
          </option>
        ))}
      </Select>
    );
  };

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="text-label text-danger">
          {error}
        </p>
      )}
      <div className="grid grid-cols-5 gap-4 max-lg:grid-cols-1">
        {/* Operaciones */}
        <div className="col-span-2 space-y-4 max-lg:col-span-5">
          <Card>
            <CardTitle>Registrar movimiento</CardTitle>
            {!canOp ? (
              <p className="text-label text-ink-3">Creá al menos un ítem y un depósito.</p>
            ) : (
              <div className="space-y-2">
                <ItemSelect value={mItem} onChange={setMItem} label="Ítem del movimiento" />
                <Select value={mWh} onChange={(e) => setMWh(e.target.value)} aria-label="Depósito del movimiento">
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </Select>
                <BatchSelect itemId={mItem} value={mBatch} onChange={setMBatch} label="Lote del movimiento" />
                <div className="flex gap-2">
                  <Select value={mType} onChange={(e) => setMType(e.target.value)} controlSize="sm" aria-label="Tipo de movimiento">
                    {TYPES.map(([c, l]) => (
                      <option key={c} value={c}>
                        {l}
                      </option>
                    ))}
                  </Select>
                  <Input type="number" value={mQty} onChange={(e) => setMQty(e.target.value)} placeholder="Cantidad" aria-label="Cantidad" />
                </div>
                <Button size="sm" fullWidth loading={busy} disabled={busy} onClick={registerMovement}>
                  Registrar
                </Button>
              </div>
            )}
          </Card>

          <Card>
            <CardTitle>Transferir entre depósitos</CardTitle>
            {warehouses.length < 2 ? (
              <p className="text-label text-ink-3">Necesitás al menos dos depósitos.</p>
            ) : (
              <div className="space-y-2">
                <ItemSelect value={tItem} onChange={setTItem} label="Ítem a transferir" />
                <div className="flex gap-2">
                  <Select value={tFrom} onChange={(e) => setTFrom(e.target.value)} controlSize="sm" aria-label="Depósito origen">
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </Select>
                  <Select value={tTo} onChange={(e) => setTTo(e.target.value)} controlSize="sm" aria-label="Depósito destino">
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <BatchSelect itemId={tItem} value={tBatch} onChange={setTBatch} label="Lote a transferir" />
                <div className="flex gap-2">
                  <Input type="number" value={tQty} onChange={(e) => setTQty(e.target.value)} placeholder="Cantidad" aria-label="Cantidad a transferir" />
                  <Button size="sm" loading={busy} disabled={busy} onClick={transfer}>
                    Transferir
                  </Button>
                </div>
              </div>
            )}
          </Card>

          <Card>
            <CardTitle>Lotes</CardTitle>
            {items.length === 0 ? (
              <p className="text-label text-ink-3">Creá un ítem primero.</p>
            ) : (
              <div className="flex gap-2">
                <ItemSelect value={bItem} onChange={setBItem} label="Ítem del lote" />
                <Input value={bNum} onChange={(e) => setBNum(e.target.value)} placeholder="N° de lote" aria-label="Número de lote" fullWidth={false} />
                <Button size="sm" loading={busy} disabled={busy} onClick={addBatch}>
                  Agregar
                </Button>
              </div>
            )}
          </Card>
        </div>

        {/* Existencias + kardex */}
        <Card className="col-span-3 self-start max-lg:col-span-5">
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
    </div>
  );
}
