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
interface Task {
  id: string;
  title: string;
}
interface Farm {
  id: string;
  name: string;
}
interface Log {
  id: string;
  employee_name: string;
  work_date: string;
  hours: number;
  task_title: string | null;
  farm_name: string | null;
  notes: string | null;
}
interface SummaryRow {
  employee_id: string;
  employee_name: string;
  total_hours: number;
  days_worked: number;
  entries: number;
}

const today = () => new Date().toISOString().slice(0, 10);

export function WorkLogsView({ logs, summary, employees, tasks, farms }: { logs: Log[]; summary: SummaryRow[]; employees: Employee[]; tasks: Task[]; farms: Farm[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [workDate, setWorkDate] = useState(today());
  const [hours, setHours] = useState('');
  const [taskId, setTaskId] = useState('');
  const [farmId, setFarmId] = useState('');
  const [notes, setNotes] = useState('');

  async function create() {
    if (busy) return;
    setError('');
    if (!employeeId) return setError('Elegí el empleado.');
    if (!(Number(hours) > 0)) return setError('Cargá las horas (mayor que 0).');
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/hr/work-logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ employee_id: employeeId, work_date: workDate, hours: Number(hours), task_id: taskId || null, farm_id: farmId || null, notes: notes || null }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.title ?? `Error ${res.status}`);
      }
      setHours('');
      setNotes('');
      setTaskId('');
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      await fetch(`${API_URL}/hr/work-logs/${id}`, { method: 'DELETE', headers: authHeaders() });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
      <Card className="self-start">
        <CardTitle>Nuevo parte</CardTitle>
        {error && <p role="alert" className="mb-2 text-label text-danger">{error}</p>}
        {employees.length === 0 ? (
          <p className="text-label text-ink-3">Cargá empleados activos primero.</p>
        ) : (
          <div className="space-y-2">
            <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} aria-label="Empleado">
              <option value="">Elegí empleado…</option>
              {employees.map((em) => (
                <option key={em.id} value={em.id}>
                  {em.full_name}
                </option>
              ))}
            </Select>
            <div className="flex gap-1">
              <Input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} aria-label="Fecha" />
              <Input type="number" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="Horas" aria-label="Horas" min="0" max="24" step="0.5" />
            </div>
            <Select value={taskId} onChange={(e) => setTaskId(e.target.value)} controlSize="sm" aria-label="Tarea (opcional)">
              <option value="">Sin tarea…</option>
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </Select>
            <Select value={farmId} onChange={(e) => setFarmId(e.target.value)} controlSize="sm" aria-label="Finca (opcional)">
              <option value="">Sin finca…</option>
              {farms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Nota (opcional)" aria-label="Nota" />
            <div className="flex justify-end border-t border-subtle pt-2">
              <Button size="sm" loading={busy} disabled={busy} onClick={create}>
                Registrar
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card className="self-start">
        <CardTitle action={<span className="text-label text-ink-3">horas · días</span>}>Resumen por empleado</CardTitle>
        {summary.length === 0 ? (
          <p className="py-3 text-center text-label text-ink-3">Sin partes cargados.</p>
        ) : (
          <ul className="divide-y divide-subtle">
            {summary.map((r) => (
              <li key={r.employee_id} className="flex items-center justify-between py-2">
                <span className="text-body font-medium">{r.employee_name}</span>
                <span className="tnum text-label text-ink-3">
                  {r.total_hours} h · {r.days_worked} d
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="self-start max-lg:col-span-3">
        <CardTitle action={<span className="text-label text-ink-3">{logs.length}</span>}>Partes</CardTitle>
        {logs.length === 0 ? (
          <p className="py-3 text-center text-label text-ink-3">Sin partes.</p>
        ) : (
          <ul className="divide-y divide-subtle">
            {logs.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <span className="text-body font-medium">{l.employee_name}</span>
                  <div className="truncate text-label text-ink-3">
                    {l.work_date} · <span className="tnum">{l.hours}</span> h
                    {l.task_title ? ` · ${l.task_title}` : ''}
                    {l.farm_name ? ` · ${l.farm_name}` : ''}
                  </div>
                </div>
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => remove(l.id)} aria-label={`Borrar parte de ${l.employee_name}`}>
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
