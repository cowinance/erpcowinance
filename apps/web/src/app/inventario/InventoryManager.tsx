'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

interface Unit {
  code: string;
  name: string;
}
interface Category {
  id: string;
  name: string;
  kind: string;
}
interface Item {
  id: string;
  name: string;
  unit: string;
  category_name: string | null;
  is_active: boolean;
}
interface Warehouse {
  id: string;
  name: string;
}

const KINDS: [string, string][] = [
  ['feed', 'Alimento'],
  ['veterinary', 'Veterinario'],
  ['agrochemical', 'Agroquímico'],
  ['seed', 'Semilla'],
  ['fuel', 'Combustible'],
  ['spare_part', 'Repuesto'],
  ['supply', 'Insumo'],
  ['product', 'Producto'],
];
const kindLabel = (k: string) => KINDS.find(([c]) => c === k)?.[1] ?? k;

export function InventoryManager({ units, categories, items, warehouses }: { units: Unit[]; categories: Category[]; items: Item[]; warehouses: Warehouse[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Categoría
  const [catName, setCatName] = useState('');
  const [catKind, setCatKind] = useState('supply');
  // Ítem
  const [itemName, setItemName] = useState('');
  const [itemUnit, setItemUnit] = useState(units[0]?.code ?? '');
  const [itemCat, setItemCat] = useState('');
  // Depósito
  const [whName, setWhName] = useState('');

  async function post(path: string, data: any, reset: () => void) {
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

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="text-label text-danger">
          {error}
        </p>
      )}

      <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
        {/* Ítems */}
        <Card>
          <CardTitle action={<span className="text-label text-ink-3">{items.length}</span>}>Ítems</CardTitle>
          <div className="mb-3 space-y-2">
            <Input value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="Nombre del ítem" aria-label="Nombre del ítem" />
            <div className="flex gap-2">
              <Select value={itemUnit} onChange={(e) => setItemUnit(e.target.value)} controlSize="sm" aria-label="Unidad">
                {units.map((u) => (
                  <option key={u.code} value={u.code}>
                    {u.code}
                  </option>
                ))}
              </Select>
              <Select value={itemCat} onChange={(e) => setItemCat(e.target.value)} controlSize="sm" aria-label="Categoría del ítem">
                <option value="">Sin categoría</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              size="sm"
              fullWidth
              loading={busy}
              disabled={busy}
              onClick={() => post('/inventory/items', { name: itemName, unit: itemUnit, category_id: itemCat || undefined }, () => setItemName(''))}
            >
              Agregar ítem
            </Button>
          </div>
          {items.length === 0 ? (
            <p className="py-3 text-center text-label text-ink-3">Sin ítems.</p>
          ) : (
            <ul className="space-y-1">
              {items.map((i) => (
                <li key={i.id} className="flex items-center justify-between text-body">
                  <span className={i.is_active ? '' : 'text-ink-3 line-through'}>{i.name}</span>
                  <span className="text-label text-ink-3">
                    {i.unit}
                    {i.category_name ? ` · ${i.category_name}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Categorías */}
        <Card>
          <CardTitle action={<span className="text-label text-ink-3">{categories.length}</span>}>Categorías</CardTitle>
          <div className="mb-3 space-y-2">
            <Input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="Nombre de la categoría" aria-label="Nombre de la categoría" />
            <Select value={catKind} onChange={(e) => setCatKind(e.target.value)} controlSize="sm" aria-label="Tipo de categoría">
              {KINDS.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </Select>
            <Button size="sm" fullWidth loading={busy} disabled={busy} onClick={() => post('/inventory/categories', { name: catName, kind: catKind }, () => setCatName(''))}>
              Agregar categoría
            </Button>
          </div>
          {categories.length === 0 ? (
            <p className="py-3 text-center text-label text-ink-3">Sin categorías.</p>
          ) : (
            <ul className="space-y-1">
              {categories.map((c) => (
                <li key={c.id} className="flex items-center justify-between text-body">
                  <span>{c.name}</span>
                  <span className="text-label text-ink-3">{kindLabel(c.kind)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Depósitos */}
        <Card>
          <CardTitle action={<span className="text-label text-ink-3">{warehouses.length}</span>}>Depósitos</CardTitle>
          <div className="mb-3 space-y-2">
            <Input value={whName} onChange={(e) => setWhName(e.target.value)} placeholder="Nombre del depósito" aria-label="Nombre del depósito" />
            <Button size="sm" fullWidth loading={busy} disabled={busy} onClick={() => post('/inventory/warehouses', { name: whName }, () => setWhName(''))}>
              Agregar depósito
            </Button>
          </div>
          {warehouses.length === 0 ? (
            <p className="py-3 text-center text-label text-ink-3">Sin depósitos.</p>
          ) : (
            <ul className="space-y-1">
              {warehouses.map((w) => (
                <li key={w.id} className="text-body">
                  {w.name}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
