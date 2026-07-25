'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

interface Embryo {
  id: string;
  donor_dam_id: string | null;
  stage: string | null;
  production_method: string | null;
  straws_available: number;
  straws_located: number;
  straws_unlocated: number;
}
interface Animal {
  id: string;
  tag: string | null;
  name: string | null;
}

const METHODS: [string, string][] = [
  ['in_vivo', 'In vivo'],
  ['ivf', 'FIV'],
];

export function EmbryosManager({ embryos, animals }: { embryos: Embryo[]; animals: Animal[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [donor, setDonor] = useState('');
  const [method, setMethod] = useState('in_vivo');
  const [stage, setStage] = useState('');
  const [straws, setStraws] = useState('');

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
        <CardTitle>Nuevo embrión</CardTitle>
        {error && <p role="alert" className="mb-2 text-label text-danger">{error}</p>}
        <div className="space-y-2">
          <Select value={donor} onChange={(e) => setDonor(e.target.value)} controlSize="sm" aria-label="Donante">
            <option value="">Donante (opcional)</option>
            {animals.map((a) => (
              <option key={a.id} value={a.id}>
                {a.tag ?? a.name ?? a.id.slice(0, 8)}
              </option>
            ))}
          </Select>
          <Select value={method} onChange={(e) => setMethod(e.target.value)} controlSize="sm" aria-label="Método de producción">
            {METHODS.map(([c, l]) => (
              <option key={c} value={c}>
                {l}
              </option>
            ))}
          </Select>
          <Input value={stage} onChange={(e) => setStage(e.target.value)} placeholder="Estadio (opcional)" aria-label="Estadio" />
          <Input type="number" value={straws} onChange={(e) => setStraws(e.target.value)} placeholder="Unidades iniciales" aria-label="Unidades iniciales" />
          <Button size="sm" fullWidth loading={busy} disabled={busy} onClick={() => call('POST', '/genetics/embryos', { donor_dam_id: donor || undefined, production_method: method, stage: stage || undefined, straws_available: straws ? Number(straws) : 0 }).then(() => { setStage(''); setStraws(''); })}>
            Agregar embrión
          </Button>
        </div>
      </Card>

      <Card className="col-span-2 self-start max-lg:col-span-3">
        <CardTitle action={<span className="text-label text-ink-3">{embryos.length}</span>}>Embriones</CardTitle>
        {embryos.length === 0 ? (
          <p className="py-3 text-center text-label text-ink-3">Sin embriones.</p>
        ) : (
          <ul className="divide-y divide-subtle">
            {embryos.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-y-1 py-2">
                <div className="min-w-0">
                  <span className="text-body font-medium">{METHODS.find(([c]) => c === e.production_method)?.[1] ?? e.production_method ?? 'Embrión'}</span>
                  {e.stage && <span className="ml-2 text-label text-ink-3">{e.stage}</span>}
                  {/* Cada embrión de la colecta es una unidad distinguible: hay que poder ir a
                      buscar EL que se planificó, no uno cualquiera del montón. */}
                  <a
                    href={`/genetica/pajuelas?embryo_id=${e.id}`}
                    className={`ml-2 rounded-md px-1.5 py-0.5 text-caption hover:underline ${e.straws_unlocated > 0 ? 'bg-warning/10 text-warning' : 'text-ink-3'}`}
                  >
                    {e.straws_unlocated > 0 ? `${e.straws_unlocated} sin ubicar` : 'ver unidades'}
                  </a>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" disabled={busy || e.straws_available <= 0} onClick={() => call('POST', `/genetics/embryos/${e.id}/adjust`, { delta: -1, reason: 'loss' })} aria-label={`Restar embrión ${e.id.slice(0, 8)}`}>
                    −
                  </Button>
                  <span className="tnum w-8 text-center font-medium">{e.straws_available}</span>
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => call('POST', `/genetics/embryos/${e.id}/adjust`, { delta: 1, reason: 'acquisition' })} aria-label={`Sumar embrión ${e.id.slice(0, 8)}`}>
                    +
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
