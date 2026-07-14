'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
  is_postable: boolean;
}
interface Period {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
}

const TYPES: [string, string][] = [
  ['asset', 'Activo'],
  ['liability', 'Pasivo'],
  ['equity', 'Patrimonio'],
  ['income', 'Ingreso'],
  ['expense', 'Gasto'],
];
const typeLabel = (k: string) => TYPES.find(([c]) => c === k)?.[1] ?? k;

export function AccountsManager({ accounts, periods, costCenters }: { accounts: Account[]; periods: Period[]; costCenters: { id: string; name: string; level: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState('asset');
  const [postable, setPostable] = useState(true);
  const [pName, setPName] = useState('');
  const [pStart, setPStart] = useState('');
  const [pEnd, setPEnd] = useState('');

  async function call(method: string, path: string, data: any, reset?: () => void) {
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
    <div className="space-y-4">
      {error && (
        <p role="alert" className="text-label text-danger">
          {error}
        </p>
      )}
      <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
        {/* Plan de cuentas */}
        <Card className="col-span-2 self-start max-lg:col-span-3">
          <CardTitle action={<span className="text-label text-ink-3">{accounts.length}</span>}>Plan de cuentas</CardTitle>
          <div className="mb-3 grid grid-cols-[1fr_2fr] gap-2">
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Código" aria-label="Código de cuenta" />
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" aria-label="Nombre de cuenta" />
            <Select value={type} onChange={(e) => setType(e.target.value)} controlSize="sm" aria-label="Tipo de cuenta">
              {TYPES.map(([c, l]) => (
                <option key={c} value={c}>
                  {l}
                </option>
              ))}
            </Select>
            <label className="flex items-center gap-2 text-label text-ink-2">
              <input type="checkbox" checked={postable} onChange={(e) => setPostable(e.target.checked)} aria-label="Imputable" />
              Imputable
            </label>
          </div>
          <Button size="sm" fullWidth loading={busy} disabled={busy} onClick={() => call('POST', '/finance/accounts', { code, name, type, is_postable: postable }, () => { setCode(''); setName(''); })}>
            Agregar cuenta
          </Button>
          {accounts.length === 0 ? (
            <p className="py-3 text-center text-label text-ink-3">Sin cuentas.</p>
          ) : (
            <table className="mt-3 w-full text-body">
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id} className="h-8 border-b border-subtle last:border-0">
                    <td className="tnum pr-2 text-ink-3">{a.code}</td>
                    <td>{a.name}</td>
                    <td className="text-right text-label text-ink-3">
                      {typeLabel(a.type)}
                      {a.is_postable ? '' : ' · grupo'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* Períodos + centros de costo */}
        <div className="space-y-4">
          <Card>
            <CardTitle>Períodos fiscales</CardTitle>
            <div className="mb-3 space-y-2">
              <Input value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Nombre (p.ej. Ejercicio 2030)" aria-label="Nombre del período" />
              <div className="flex gap-2">
                <Input type="date" value={pStart} onChange={(e) => setPStart(e.target.value)} aria-label="Inicio del período" />
                <Input type="date" value={pEnd} onChange={(e) => setPEnd(e.target.value)} aria-label="Fin del período" />
              </div>
              <Button size="sm" fullWidth loading={busy} disabled={busy} onClick={() => call('POST', '/finance/periods', { name: pName, start_date: pStart, end_date: pEnd }, () => setPName(''))}>
                Agregar período
              </Button>
            </div>
            {periods.length === 0 ? (
              <p className="py-2 text-center text-label text-ink-3">Sin períodos.</p>
            ) : (
              <ul className="space-y-1">
                {periods.map((p) => (
                  <li key={p.id} className="flex items-center justify-between text-label">
                    <span>{p.name}</span>
                    <Button variant="secondary" size="sm" loading={busy} disabled={busy} onClick={() => call('PATCH', `/finance/periods/${p.id}/status`, { status: p.status === 'open' ? 'closed' : 'open' })}>
                      {p.status === 'open' ? 'Abierto' : 'Cerrado'}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardTitle action={<span className="text-label text-ink-3">{costCenters.length}</span>}>Centros de costo</CardTitle>
            {costCenters.length === 0 ? (
              <p className="py-2 text-center text-label text-ink-3">Sin centros de costo.</p>
            ) : (
              <ul className="space-y-1">
                {costCenters.map((c) => (
                  <li key={c.id} className="flex justify-between text-label">
                    <span>{c.name}</span>
                    <span className="text-ink-3">{c.level}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
