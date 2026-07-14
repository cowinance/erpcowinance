'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

interface Machine {
  id: string;
  name: string;
  type: string | null;
  make: string | null;
  engine_hours: number | null;
  odometer_km: number | null;
  status: string;
}
interface Named {
  id: string;
  name?: string;
  full_name?: string;
  unit?: string;
}

const MNT_TYPES: [string, string][] = [
  ['preventive', 'Preventivo'],
  ['corrective', 'Correctivo'],
  ['inspection', 'Inspección'],
];
const mntLabel = (k: string) => MNT_TYPES.find(([c]) => c === k)?.[1] ?? k;
const STATUS: Record<string, string> = { active: 'Activa', maintenance: 'En mantenimiento', retired: 'Retirada' };

export function MachineDetail({ machine, maintenance, fuel, items, warehouses, employees }: { machine: Machine; maintenance: any[]; fuel: any[]; items: Named[]; warehouses: Named[]; employees: Named[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Mantenimiento
  const [mntType, setMntType] = useState('preventive');
  const [mntDesc, setMntDesc] = useState('');
  const [mntCost, setMntCost] = useState('');
  const [mntHours, setMntHours] = useState('');
  // Combustible
  const [liters, setLiters] = useState('');
  const [fuelItem, setFuelItem] = useState('');
  const [fuelWh, setFuelWh] = useState(warehouses[0]?.id ?? '');
  const [odo, setOdo] = useState('');
  const [operator, setOperator] = useState('');

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

  function recordMnt() {
    post(`/machinery/${machine.id}/maintenance`, { type: mntType, description: mntDesc || undefined, cost: mntCost ? Number(mntCost) : undefined, engine_hours: mntHours ? Number(mntHours) : undefined }).then(() => { setMntDesc(''); setMntCost(''); setMntHours(''); });
  }
  function recordFuel() {
    const data: any = { liters: Number(liters), operator_id: operator || undefined, odometer_km: odo ? Number(odo) : undefined };
    if (fuelItem) {
      data.item_id = fuelItem;
      data.warehouse_id = fuelWh;
    }
    post(`/machinery/${machine.id}/fuel`, data).then(() => { setLiters(''); setOdo(''); });
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/maquinaria" className="text-label text-brand hover:underline">
          ← Maquinaria
        </Link>
        <h1 className="mt-1 text-xl font-semibold">{machine.name}</h1>
        <p className="mt-0.5 text-body text-ink-3">
          {machine.make ? `${machine.make} · ` : ''}
          {machine.engine_hours != null ? `${machine.engine_hours} h · ` : ''}
          {machine.odometer_km != null ? `${machine.odometer_km} km · ` : ''}
          <span className="font-medium text-ink-2">{STATUS[machine.status] ?? machine.status}</span>
        </p>
      </div>
      {error && <p role="alert" className="text-label text-danger">{error}</p>}

      <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        {/* Mantenimiento */}
        <Card className="self-start">
          <CardTitle>Registrar mantenimiento</CardTitle>
          <div className="space-y-2">
            <Select value={mntType} onChange={(e) => setMntType(e.target.value)} aria-label="Tipo de mantenimiento">
              {MNT_TYPES.map(([c, l]) => (
                <option key={c} value={c}>
                  {l}
                </option>
              ))}
            </Select>
            <Input value={mntDesc} onChange={(e) => setMntDesc(e.target.value)} placeholder="Descripción" aria-label="Descripción del mantenimiento" />
            <div className="flex gap-2">
              <Input type="number" value={mntCost} onChange={(e) => setMntCost(e.target.value)} placeholder="Costo" aria-label="Costo del mantenimiento" />
              <Input type="number" value={mntHours} onChange={(e) => setMntHours(e.target.value)} placeholder="Horas" aria-label="Horas del motor" />
            </div>
            <Button size="sm" fullWidth loading={busy} disabled={busy} onClick={recordMnt}>
              Registrar mantenimiento
            </Button>
          </div>
          <div className="mt-3 border-t border-subtle pt-2">
            {maintenance.length === 0 ? (
              <p className="py-1 text-center text-label text-ink-3">Sin mantenimientos.</p>
            ) : (
              <ul className="space-y-1">
                {maintenance.map((m) => (
                  <li key={m.id} className="flex justify-between text-label">
                    <span className="text-ink-2">{mntLabel(m.type)}{m.description ? ` · ${m.description}` : ''}</span>
                    <span className="tnum text-ink-3">{m.cost != null ? `$${m.cost}` : '—'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        {/* Combustible */}
        <Card className="self-start">
          <CardTitle>Registrar combustible</CardTitle>
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input type="number" value={liters} onChange={(e) => setLiters(e.target.value)} placeholder="Litros" aria-label="Litros" />
              <Input type="number" value={odo} onChange={(e) => setOdo(e.target.value)} placeholder="Odómetro (km)" aria-label="Odómetro" />
            </div>
            <Select value={fuelItem} onChange={(e) => setFuelItem(e.target.value)} controlSize="sm" aria-label="Ítem de combustible">
              <option value="">Sin descontar stock</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.unit})
                </option>
              ))}
            </Select>
            {fuelItem && (
              <Select value={fuelWh} onChange={(e) => setFuelWh(e.target.value)} controlSize="sm" aria-label="Depósito del combustible">
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            )}
            <Select value={operator} onChange={(e) => setOperator(e.target.value)} controlSize="sm" aria-label="Operario">
              <option value="">Sin operario</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name}
                </option>
              ))}
            </Select>
            <Button size="sm" fullWidth loading={busy} disabled={busy} onClick={recordFuel}>
              Registrar carga
            </Button>
          </div>
          <div className="mt-3 border-t border-subtle pt-2">
            {fuel.length === 0 ? (
              <p className="py-1 text-center text-label text-ink-3">Sin cargas.</p>
            ) : (
              <ul className="space-y-1">
                {fuel.map((f) => (
                  <li key={f.id} className="flex justify-between text-label">
                    <span className="text-ink-2">
                      {f.liters} L{f.item_name ? ` · ${f.item_name}` : ''}
                    </span>
                    <span className="tnum text-ink-3">{f.total_cost != null ? `$${f.total_cost}` : '—'}</span>
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
