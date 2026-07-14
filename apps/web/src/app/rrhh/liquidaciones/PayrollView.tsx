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
}
interface Run {
  id: string;
  period: string;
  status: string;
  total_amount: number;
}
interface Line {
  employee_id: string;
  gross: string;
  deductions: string;
}

const STATUS: Record<string, string> = { draft: 'Borrador', approved: 'Aprobada', paid: 'Pagada' };
const ACTIONS: Record<string, [string, string] | null> = { draft: ['approved', 'Aprobar'], approved: ['paid', 'Pagar'], paid: null };
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const emptyLine = (): Line => ({ employee_id: '', gross: '', deductions: '' });

export function PayrollView({ payroll, employees }: { payroll: Run[]; employees: Employee[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const totalGross = round2(lines.reduce((s, l) => s + (Number(l.gross) || 0), 0));
  const totalNet = round2(lines.reduce((s, l) => s + Math.max(0, (Number(l.gross) || 0) - (Number(l.deductions) || 0)), 0));

  async function call(method: string, path: string, data?: any) {
    setError('');
    const res = await fetch(`${API_URL}${path}`, { method, headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: data ? JSON.stringify(data) : undefined });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      throw new Error(j?.title ?? `Error ${res.status}`);
    }
    return res.json().catch(() => null);
  }

  async function create() {
    if (busy) return;
    if (!period) return setError('Elegí el período.');
    const items = lines.filter((l) => l.employee_id && Number(l.gross) > 0).map((l) => ({ employee_id: l.employee_id, gross: Number(l.gross), deductions: Number(l.deductions) || 0 }));
    if (items.length === 0) return setError('Agregá al menos una línea con empleado y bruto.');
    setBusy(true);
    try {
      await call('POST', '/hr/payroll', { period, items });
      setLines([emptyLine()]);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function transition(id: string, status: string) {
    if (busy) return;
    setBusy(true);
    try {
      await call('PATCH', `/hr/payroll/${id}/status`, { status });
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
      <Card className="self-start">
        <CardTitle>Nueva liquidación</CardTitle>
        {error && <p role="alert" className="mb-2 text-label text-danger">{error}</p>}
        {employees.length === 0 ? (
          <p className="text-label text-ink-3">Cargá empleados activos primero.</p>
        ) : (
          <div className="space-y-2">
            <Input type="date" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Período" />
            <div className="space-y-1 border-t border-subtle pt-2">
              {lines.map((l, i) => (
                <div key={i} className="space-y-1">
                  <Select value={l.employee_id} onChange={(e) => setLine(i, { employee_id: e.target.value })} controlSize="sm" aria-label={`Empleado línea ${i + 1}`}>
                    <option value="">Elegí empleado…</option>
                    {employees.map((em) => (
                      <option key={em.id} value={em.id}>
                        {em.full_name}
                      </option>
                    ))}
                  </Select>
                  <div className="flex gap-1">
                    <Input type="number" value={l.gross} onChange={(e) => setLine(i, { gross: e.target.value })} placeholder="Bruto" aria-label={`Bruto línea ${i + 1}`} />
                    <Input type="number" value={l.deductions} onChange={(e) => setLine(i, { deductions: e.target.value })} placeholder="Deduc." aria-label={`Deducciones línea ${i + 1}`} />
                  </div>
                </div>
              ))}
              <Button variant="secondary" size="sm" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
                + Empleado
              </Button>
            </div>
            <div className="flex items-center justify-between border-t border-subtle pt-2 text-label text-ink-3">
              <span>Bruto <span className="tnum">{totalGross}</span> · Neto <span className="tnum">{totalNet}</span></span>
              <Button size="sm" loading={busy} disabled={busy} onClick={create}>
                Crear
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card className="col-span-2 self-start max-lg:col-span-3">
        <CardTitle action={<span className="text-label text-ink-3">{payroll.length}</span>}>Liquidaciones</CardTitle>
        {payroll.length === 0 ? (
          <p className="py-3 text-center text-label text-ink-3">Sin liquidaciones.</p>
        ) : (
          <ul className="divide-y divide-subtle">
            {payroll.map((r) => {
              const action = ACTIONS[r.status];
              return (
                <li key={r.id} className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-body font-medium">{r.period}</span>
                    <div className="tnum text-label text-ink-3">{r.total_amount}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-subtle px-2 py-0.5 text-caption font-medium text-ink-2">{STATUS[r.status] ?? r.status}</span>
                    {action && (
                      <Button variant="secondary" size="sm" loading={busy} disabled={busy} onClick={() => transition(r.id, action[0])}>
                        {action[1]}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
