'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

interface Lab {
  id: string;
  name: string;
  type: string | null;
}

const TYPES = ['genetics', 'pathology', 'milk', 'soil', 'serology', 'other'];
const TYPE_ES: Record<string, string> = { genetics: 'Genética', pathology: 'Patología', milk: 'Leche', soil: 'Suelo', serology: 'Serología', other: 'Otro' };

export function LabsManager({ labs }: { labs: Lab[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState('');

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
        <CardTitle>Nuevo laboratorio</CardTitle>
        {error && <p role="alert" className="mb-2 text-label text-danger">{error}</p>}
        <div className="space-y-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" aria-label="Nombre" />
          <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Tipo">
            <option value="">Tipo (opcional)</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_ES[t]}
              </option>
            ))}
          </Select>
          <Button size="sm" fullWidth loading={busy} disabled={busy || !name.trim()} onClick={() => call('POST', '/lab/labs', { name, type: type || undefined }).then(() => { setName(''); setType(''); })}>
            Agregar laboratorio
          </Button>
        </div>
      </Card>

      <Card className="col-span-2 self-start max-lg:col-span-3">
        <CardTitle action={<span className="text-label text-ink-3">{labs.length}</span>}>Laboratorios</CardTitle>
        {labs.length === 0 ? (
          <p className="py-3 text-center text-label text-ink-3">Sin laboratorios.</p>
        ) : (
          <ul className="divide-y divide-subtle">
            {labs.map((l) => (
              <li key={l.id} className="flex items-center justify-between py-2">
                <div>
                  <span className="text-body font-medium">{l.name}</span>
                  {l.type && <span className="ml-2 text-label text-ink-3">{TYPE_ES[l.type] ?? l.type}</span>}
                </div>
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => call('DELETE', `/lab/labs/${l.id}`)} aria-label={`Borrar ${l.name}`}>
                  ✕
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
