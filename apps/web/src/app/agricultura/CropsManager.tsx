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
  paddock_name: string;
  crop_type: string;
  variety: string | null;
  area_ha: number | null;
  status: string;
}
interface Paddock {
  id: string;
  name: string;
}

const STATUS: Record<string, string> = { planned: 'Planificado', growing: 'En crecimiento', harvested: 'Cosechado', failed: 'Perdido' };
const ACTIONS: Record<string, [string, string][]> = {
  planned: [['growing', 'Sembrar'], ['failed', 'Perder']],
  growing: [['failed', 'Perder']],
};

export function CropsManager({ crops, paddocks }: { crops: Crop[]; paddocks: Paddock[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [paddockId, setPaddockId] = useState(paddocks[0]?.id ?? '');
  const [cropType, setCropType] = useState('');
  const [variety, setVariety] = useState('');
  const [area, setArea] = useState('');

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
        <CardTitle>Nuevo cultivo</CardTitle>
        {error && <p role="alert" className="mb-2 text-label text-danger">{error}</p>}
        {paddocks.length === 0 ? (
          <p className="text-label text-ink-3">Necesitás un potrero primero.</p>
        ) : (
          <div className="space-y-2">
            <Select value={paddockId} onChange={(e) => setPaddockId(e.target.value)} aria-label="Potrero">
              {paddocks.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <Input value={cropType} onChange={(e) => setCropType(e.target.value)} placeholder="Cultivo (p.ej. Maíz)" aria-label="Tipo de cultivo" />
            <Input value={variety} onChange={(e) => setVariety(e.target.value)} placeholder="Variedad (opcional)" aria-label="Variedad" />
            <Input type="number" value={area} onChange={(e) => setArea(e.target.value)} placeholder="Área (ha)" aria-label="Área en hectáreas" />
            <Button
              size="sm"
              fullWidth
              loading={busy}
              disabled={busy || !cropType.trim()}
              onClick={() => call('POST', '/agriculture/crops', { paddock_id: paddockId, crop_type: cropType, variety: variety || undefined, area_ha: area ? Number(area) : undefined }).then(() => { setCropType(''); setVariety(''); setArea(''); })}
            >
              Agregar cultivo
            </Button>
          </div>
        )}
      </Card>

      <Card className="col-span-2 self-start max-lg:col-span-3">
        <CardTitle action={<span className="text-label text-ink-3">{crops.length}</span>}>Cultivos</CardTitle>
        {crops.length === 0 ? (
          <p className="py-3 text-center text-label text-ink-3">Sin cultivos.</p>
        ) : (
          <ul className="divide-y divide-subtle">
            {crops.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <Link href={`/agricultura/${c.id}`} className="text-body font-medium text-brand hover:underline">
                    {c.crop_type}
                  </Link>
                  <span className="ml-2 text-label text-ink-3">
                    {c.paddock_name}
                    {c.area_ha ? ` · ${c.area_ha} ha` : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-subtle px-2 py-0.5 text-caption font-medium text-ink-2">{STATUS[c.status] ?? c.status}</span>
                  {(ACTIONS[c.status] ?? []).map(([to, label]) => (
                    <Button key={to} variant="secondary" size="sm" loading={busy} disabled={busy} onClick={() => call('PATCH', `/agriculture/crops/${c.id}/status`, { status: to })}>
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
