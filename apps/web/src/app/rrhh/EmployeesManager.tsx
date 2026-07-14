'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

interface Employee {
  id: string;
  full_name: string;
  role: string | null;
  employment_type: string | null;
  hire_date: string | null;
  termination_date: string | null;
  is_active: boolean;
}

const TYPES: [string, string][] = [
  ['permanent', 'Permanente'],
  ['temporary', 'Temporario'],
  ['contractor', 'Contratista'],
];
const typeLabel = (k: string | null) => (k ? TYPES.find(([c]) => c === k)?.[1] ?? k : '—');

export function EmployeesManager({ employees }: { employees: Employee[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [type, setType] = useState('permanent');

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
        <CardTitle>Nuevo empleado</CardTitle>
        {error && <p role="alert" className="mb-2 text-label text-danger">{error}</p>}
        <div className="space-y-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre y apellido" aria-label="Nombre del empleado" />
          <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Puesto (opcional)" aria-label="Puesto" />
          <Select value={type} onChange={(e) => setType(e.target.value)} controlSize="sm" aria-label="Tipo de contratación">
            {TYPES.map(([c, l]) => (
              <option key={c} value={c}>
                {l}
              </option>
            ))}
          </Select>
          <Button size="sm" fullWidth loading={busy} disabled={busy} onClick={() => call('POST', '/hr/employees', { full_name: name, role: role || undefined, employment_type: type }, () => { setName(''); setRole(''); })}>
            Agregar empleado
          </Button>
        </div>
      </Card>

      <Card className="col-span-2 self-start max-lg:col-span-3">
        <CardTitle action={<span className="text-label text-ink-3">{employees.length}</span>}>Empleados</CardTitle>
        {employees.length === 0 ? (
          <p className="py-3 text-center text-label text-ink-3">Sin empleados.</p>
        ) : (
          <ul className="divide-y divide-subtle">
            {employees.map((e) => (
              <li key={e.id} className="flex items-center justify-between py-2">
                <div>
                  <span className={e.is_active ? 'text-body font-medium' : 'text-body text-ink-3 line-through'}>{e.full_name}</span>
                  <div className="text-label text-ink-3">
                    {typeLabel(e.employment_type)}
                    {e.role ? ` · ${e.role}` : ''}
                  </div>
                </div>
                {e.is_active ? (
                  <Button variant="secondary" size="sm" loading={busy} disabled={busy} onClick={() => call('POST', `/hr/employees/${e.id}/terminate`, {})}>
                    Dar de baja
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" loading={busy} disabled={busy} onClick={() => call('POST', `/hr/employees/${e.id}/reactivate`)}>
                    Reactivar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
