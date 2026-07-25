'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

interface Batch {
  id: string;
  batch_code: string;
  sire_id: string | null;
  sire_tag: string | null;
  sire_name_external: string | null;
  straws_available: number;
  /** Desglose de GT-2: cuántas de las disponibles están realmente ubicadas en un termo. */
  straws_located: number;
  straws_unlocated: number;
  /** Ubicación heredada en texto libre (pre GT-2): la pista para el inventario físico. */
  legacy_location?: string | null;
}
interface Animal {
  id: string;
  tag: string | null;
  name: string | null;
}

export function SemenManager({ batches, animals }: { batches: Batch[]; animals: Animal[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [sireId, setSireId] = useState('');
  const [sireExt, setSireExt] = useState('');
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
        <CardTitle>Nueva partida</CardTitle>
        {error && <p role="alert" className="mb-2 text-label text-danger">{error}</p>}
        <div className="space-y-2">
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Código de partida" aria-label="Código de partida" />
          <Select value={sireId} onChange={(e) => setSireId(e.target.value)} controlSize="sm" aria-label="Toro interno">
            <option value="">Toro interno (opcional)</option>
            {animals.map((a) => (
              <option key={a.id} value={a.id}>
                {a.tag ?? a.name ?? a.id.slice(0, 8)}
              </option>
            ))}
          </Select>
          <Input value={sireExt} onChange={(e) => setSireExt(e.target.value)} placeholder="o Toro externo (nombre)" aria-label="Toro externo" />
          <Input type="number" value={straws} onChange={(e) => setStraws(e.target.value)} placeholder="Pajuelas iniciales" aria-label="Pajuelas iniciales" />
          <Button
            size="sm"
            fullWidth
            loading={busy}
            disabled={busy || !code.trim()}
            onClick={() => call('POST', '/genetics/semen', { batch_code: code, sire_id: sireId || undefined, sire_name_external: sireExt || undefined, straws_available: straws ? Number(straws) : 0 }).then(() => { setCode(''); setSireExt(''); setStraws(''); })}
          >
            Agregar partida
          </Button>
        </div>
      </Card>

      <Card className="col-span-2 self-start max-lg:col-span-3">
        <CardTitle action={<span className="text-label text-ink-3">{batches.length}</span>}>Partidas</CardTitle>
        {batches.length === 0 ? (
          <p className="py-3 text-center text-label text-ink-3">Sin partidas.</p>
        ) : (
          <ul className="divide-y divide-subtle">
            {batches.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-y-1 py-2">
                <div className="min-w-0">
                  <span className="text-body font-medium">{b.batch_code}</span>
                  <span className="ml-2 text-label text-ink-3">{b.sire_tag ?? b.sire_name_external ?? '—'}</span>
                  {/* Lo que el contador nunca pudo decir: cuántas de esas se pueden ir a buscar de
                      verdad. Un saldo completo con media partida sin ubicar parece sano y no lo es. */}
                  {b.straws_unlocated > 0 && (
                    <a
                      href={`/genetica/pajuelas?semen_batch_id=${b.id}`}
                      className="ml-2 rounded-md bg-warning/10 px-1.5 py-0.5 text-caption text-warning hover:underline"
                    >
                      {b.straws_unlocated} sin ubicar
                      {b.legacy_location ? ` · antes: ${b.legacy_location}` : ''}
                    </a>
                  )}
                  {b.straws_located > 0 && b.straws_unlocated === 0 && (
                    <a href={`/genetica/pajuelas?semen_batch_id=${b.id}`} className="ml-2 text-caption text-ink-3 hover:underline">
                      ubicadas
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" disabled={busy || b.straws_available <= 0} onClick={() => call('POST', `/genetics/semen/${b.id}/adjust`, { delta: -1, reason: 'loss' })} aria-label={`Restar pajuela ${b.batch_code}`}>
                    −
                  </Button>
                  <span className="tnum w-8 text-center font-medium">{b.straws_available}</span>
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => call('POST', `/genetics/semen/${b.id}/adjust`, { delta: 1, reason: 'acquisition' })} aria-label={`Sumar pajuela ${b.batch_code}`}>
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
