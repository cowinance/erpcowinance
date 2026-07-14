'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

interface Cert {
  id: string;
  entity_type: string;
  entity_id: string;
  scheme: string;
  issuer: string | null;
  valid_until: string | null;
  status: string;
  is_expired: boolean;
}
interface Animal {
  id: string;
  tag: string | null;
  name: string | null;
}
interface Lot {
  id: string;
  name: string;
}

const STATUS: Record<string, string> = { active: 'Activa', suspended: 'Suspendida', revoked: 'Revocada' };
const ACTIONS: Record<string, [string, string][]> = {
  active: [['suspended', 'Suspender'], ['revoked', 'Revocar']],
  suspended: [['active', 'Activar'], ['revoked', 'Revocar']],
};

export function CertificationsManager({ certs, animals, lots }: { certs: Cert[]; animals: Animal[]; lots: Lot[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [type, setType] = useState<'animal' | 'lot'>('animal');
  const [entityId, setEntityId] = useState('');
  const [scheme, setScheme] = useState('');
  const [issuer, setIssuer] = useState('');
  const [validUntil, setValidUntil] = useState('');

  const entities = type === 'animal' ? animals : lots;
  const entityLabel = (e: Animal | Lot) => ('name' in e && (e as Lot).name) || (e as Animal).tag || (e as Animal).name || e.id.slice(0, 8);
  const nameOf = (c: Cert) => {
    const src = c.entity_type === 'lot' ? lots : animals;
    const e: any = src.find((x) => x.id === c.entity_id);
    return e ? (e.name ?? e.tag ?? c.entity_id.slice(0, 8)) : c.entity_id.slice(0, 8);
  };

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
        <CardTitle>Nueva certificación</CardTitle>
        {error && <p role="alert" className="mb-2 text-label text-danger">{error}</p>}
        <div className="space-y-2">
          <Select value={type} onChange={(e) => { setType(e.target.value as 'animal' | 'lot'); setEntityId(''); }} controlSize="sm" aria-label="Tipo de entidad">
            <option value="animal">Animal</option>
            <option value="lot">Lote</option>
          </Select>
          <Select value={entityId} onChange={(e) => setEntityId(e.target.value)} aria-label="Entidad">
            <option value="">Elegí {type === 'animal' ? 'animal' : 'lote'}…</option>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {entityLabel(e)}
              </option>
            ))}
          </Select>
          <Input value={scheme} onChange={(e) => setScheme(e.target.value)} placeholder="Esquema (p.ej. SENASA)" aria-label="Esquema" />
          <Input value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="Emisor (opcional)" aria-label="Emisor" />
          <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} aria-label="Válida hasta" />
          <Button size="sm" fullWidth loading={busy} disabled={busy || !entityId || !scheme.trim()} onClick={() => call('POST', '/traceability/certifications', { entity_type: type, entity_id: entityId, scheme, issuer: issuer || undefined, valid_until: validUntil || undefined }).then(() => { setScheme(''); setIssuer(''); setValidUntil(''); })}>
            Agregar certificación
          </Button>
        </div>
      </Card>

      <Card className="col-span-2 self-start max-lg:col-span-3">
        <CardTitle action={<span className="text-label text-ink-3">{certs.length}</span>}>Certificaciones</CardTitle>
        {certs.length === 0 ? (
          <p className="py-3 text-center text-label text-ink-3">Sin certificaciones.</p>
        ) : (
          <ul className="divide-y divide-subtle">
            {certs.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <span className="text-body font-medium">{c.scheme}</span>
                  <span className="ml-2 text-label text-ink-3">
                    {c.entity_type === 'lot' ? 'Lote' : 'Animal'} {nameOf(c)}
                    {c.valid_until ? ` · vence ${c.valid_until}` : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {c.is_expired && <span className="rounded-full bg-sunken px-2 py-0.5 text-caption font-medium text-warning">Vencida</span>}
                  <span className="rounded-full bg-subtle px-2 py-0.5 text-caption font-medium text-ink-2">{STATUS[c.status] ?? c.status}</span>
                  {(ACTIONS[c.status] ?? []).map(([to, label]) => (
                    <Button key={to} variant="secondary" size="sm" loading={busy} disabled={busy} onClick={() => call('PATCH', `/traceability/certifications/${c.id}/status`, { status: to })}>
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
