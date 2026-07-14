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
              <li key={b.id} className="flex items-center justify-between py-2">
                <div>
                  <span className="text-body font-medium">{b.batch_code}</span>
                  <span className="ml-2 text-label text-ink-3">{b.sire_tag ?? b.sire_name_external ?? '—'}</span>
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
