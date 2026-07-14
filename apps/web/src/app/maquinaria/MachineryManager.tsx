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
  model: string | null;
  status: string;
}

const TYPES: [string, string][] = [
  ['tractor', 'Tractor'],
  ['harvester', 'Cosechadora'],
  ['truck', 'Camión'],
  ['atv', 'Cuatriciclo'],
  ['mixer', 'Mixer'],
  ['implement', 'Implemento'],
  ['other', 'Otro'],
];
const typeLabel = (k: string | null) => (k ? TYPES.find(([c]) => c === k)?.[1] ?? k : '—');
const STATUS: Record<string, string> = { active: 'Activa', maintenance: 'En mantenimiento', retired: 'Retirada' };
const ACTIONS: Record<string, [string, string][]> = {
  active: [['maintenance', 'A mantenimiento'], ['retired', 'Retirar']],
  maintenance: [['active', 'Activar'], ['retired', 'Retirar']],
};

export function MachineryManager({ machines }: { machines: Machine[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState('tractor');
  const [make, setMake] = useState('');

  async function call(method: string, path: string, data?: any, reset?: () => void) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}${path}`, { method, headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: data ? JSON.stringify(data) : undefined });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.title ?? `Error ${res.status}`);
      }
      reset?.();
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
        <CardTitle>Nueva máquina</CardTitle>
        {error && <p role="alert" className="mb-2 text-label text-danger">{error}</p>}
        <div className="space-y-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre / identificación" aria-label="Nombre de la máquina" />
          <Select value={type} onChange={(e) => setType(e.target.value)} controlSize="sm" aria-label="Tipo de máquina">
            {TYPES.map(([c, l]) => (
              <option key={c} value={c}>
                {l}
              </option>
            ))}
          </Select>
          <Input value={make} onChange={(e) => setMake(e.target.value)} placeholder="Marca (opcional)" aria-label="Marca" />
          <Button size="sm" fullWidth loading={busy} disabled={busy || !name.trim()} onClick={() => call('POST', '/machinery', { name, type, make: make || undefined }, () => { setName(''); setMake(''); })}>
            Agregar máquina
          </Button>
        </div>
      </Card>

      <Card className="col-span-2 self-start max-lg:col-span-3">
        <CardTitle action={<span className="text-label text-ink-3">{machines.length}</span>}>Máquinas</CardTitle>
        {machines.length === 0 ? (
          <p className="py-3 text-center text-label text-ink-3">Sin máquinas.</p>
        ) : (
          <ul className="divide-y divide-subtle">
            {machines.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <Link href={`/maquinaria/${m.id}`} className="text-body font-medium text-brand hover:underline">
                    {m.name}
                  </Link>
                  <span className="ml-2 text-label text-ink-3">
                    {typeLabel(m.type)}
                    {m.make ? ` · ${m.make}` : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-subtle px-2 py-0.5 text-caption font-medium text-ink-2">{STATUS[m.status] ?? m.status}</span>
                  {(ACTIONS[m.status] ?? []).map(([to, label]) => (
                    <Button key={to} variant="secondary" size="sm" loading={busy} disabled={busy} onClick={() => call('PATCH', `/machinery/${m.id}/status`, { status: to })}>
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
