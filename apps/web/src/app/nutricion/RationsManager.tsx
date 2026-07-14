'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

interface Ration {
  id: string;
  name: string;
  cost_per_kg: number;
  is_active: boolean;
}
interface Item {
  id: string;
  name: string;
  unit: string;
}
interface Ingredient {
  inventory_item_id: string;
  pct: string;
}

const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

export function RationsManager({ rations, items }: { rations: Ration[]; items: Item[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Ration | null>(null);
  const [ings, setIngs] = useState<Ingredient[]>([]);

  const total = round3(ings.reduce((s, i) => s + (Number(i.pct) || 0), 0));
  const balanced = Math.abs(total - 100) < 0.01;

  async function call(method: string, path: string, data?: any) {
    setError('');
    const res = await fetch(`${API_URL}${path}`, { method, headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: data ? JSON.stringify(data) : undefined });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      throw new Error(j?.title ?? `Error ${res.status}`);
    }
    return res.json().catch(() => null);
  }

  async function createRation() {
    if (busy || !name.trim()) return;
    setBusy(true);
    try {
      await call('POST', '/nutrition/rations', { name: name.trim() });
      setName('');
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function selectRation(r: Ration) {
    setSelected(r);
    setError('');
    try {
      const detail = await call('GET', `/nutrition/rations/${r.id}`);
      setIngs((detail?.ingredients ?? []).map((i: any) => ({ inventory_item_id: i.inventory_item_id, pct: String(i.pct) })));
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function saveIngredients() {
    if (busy || !selected) return;
    setBusy(true);
    try {
      const ingredients = ings.filter((i) => i.inventory_item_id && Number(i.pct) > 0).map((i) => ({ inventory_item_id: i.inventory_item_id, pct: Number(i.pct) }));
      await call('PUT', `/nutrition/rations/${selected.id}/ingredients`, { ingredients });
      router.refresh();
      setSelected(null);
      setIngs([]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const setIng = (idx: number, patch: Partial<Ingredient>) => setIngs((l) => l.map((x, i) => (i === idx ? { ...x, ...patch } : x)));

  return (
    <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
      {/* Raciones */}
      <Card className="self-start">
        <CardTitle action={<span className="text-label text-ink-3">{rations.length}</span>}>Raciones</CardTitle>
        {error && <p role="alert" className="mb-2 text-label text-danger">{error}</p>}
        <div className="mb-3 flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre de la ración" aria-label="Nombre de la ración" />
          <Button size="sm" loading={busy} disabled={busy} onClick={createRation}>
            Agregar
          </Button>
        </div>
        {rations.length === 0 ? (
          <p className="py-3 text-center text-label text-ink-3">Sin raciones.</p>
        ) : (
          <ul className="space-y-1">
            {rations.map((r) => (
              <li key={r.id}>
                <button
                  className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-body hover:bg-sunken ${selected?.id === r.id ? 'bg-sunken' : ''}`}
                  onClick={() => selectRation(r)}
                >
                  <span>{r.name}</span>
                  <span className="tnum text-label text-ink-3">${r.cost_per_kg}/kg</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Editor de ingredientes */}
      <Card className="self-start">
        <CardTitle>Ingredientes {selected ? `· ${selected.name}` : ''}</CardTitle>
        {!selected ? (
          <p className="py-3 text-center text-label text-ink-3">Elegí una ración para editar su composición.</p>
        ) : (
          <div className="space-y-2">
            {ings.map((ing, i) => (
              <div key={i} className="flex gap-1">
                <Select value={ing.inventory_item_id} onChange={(e) => setIng(i, { inventory_item_id: e.target.value })} controlSize="sm" aria-label={`Ingrediente ${i + 1}`}>
                  <option value="">Elegí ítem…</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name} ({it.unit})
                    </option>
                  ))}
                </Select>
                <Input type="number" value={ing.pct} onChange={(e) => setIng(i, { pct: e.target.value })} placeholder="%" aria-label={`Porcentaje ${i + 1}`} fullWidth={false} />
              </div>
            ))}
            <Button variant="secondary" size="sm" onClick={() => setIngs((l) => [...l, { inventory_item_id: '', pct: '' }])}>
              + Ingrediente
            </Button>
            <div className="flex items-center justify-between border-t border-subtle pt-2 text-label">
              <span className={balanced ? 'text-success' : 'text-danger'}>Σ {total}%</span>
              <Button size="sm" loading={busy} disabled={busy || !balanced} onClick={saveIngredients}>
                Guardar
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
